import { DateTime } from 'luxon';
import {
  supabaseAdmin,
  isSupabaseConfigured,
  Member,
  PushSubscriptionRecord,
  fetchAllNotificationLogs,
  updateMemberSafe,
} from '@/lib/db';
import { checkCooldownPromotion, computeMemberState, getSleepCycleDate } from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';
import { sendPushNotification } from '@/lib/pushServer';
import { sendBedtimeDiscordWebhook } from '@/lib/discordWebhook';

// Preserve in-memory fallback cron locks on globalThis across module reloads and chunks
const globalForCronLocks = globalThis as unknown as {
  __cronLocks?: Map<string, { lockedAt: number; expiresAt: number; metadata?: Record<string, unknown> }>;
};

const inMemoryCronLocks =
  globalForCronLocks.__cronLocks ||
  new Map<string, { lockedAt: number; expiresAt: number; metadata?: Record<string, unknown> }>();
globalForCronLocks.__cronLocks = inMemoryCronLocks;

/**
 * Acquires a distributed idempotency lock backed by Supabase 'cron_locks' table
 * with seamless in-memory fallback for offline/test environments.
 *
 * @param lockKey - Unique lock key (e.g. `cron_window:<YYYY-MM-DDTHH:mm>` or `notif:<member_id>:<date>:<event_type>`)
 * @param ttlSeconds - Time-to-live in seconds before the lock automatically expires
 * @param metadata - Optional metadata context stored with the lock record
 * @returns boolean - True if lock was acquired, false if already held by another runner
 */
export async function acquireCronLock(
  lockKey: string,
  ttlSeconds: number,
  metadata: Record<string, unknown> = {}
): Promise<boolean> {
  const nowMs = Date.now();
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  // 1. In-memory check first
  const existingMem = inMemoryCronLocks.get(lockKey);
  if (existingMem && existingMem.expiresAt > nowMs) {
    return false; // Active lock held in memory
  }

  // Set local in-memory lock
  inMemoryCronLocks.set(lockKey, {
    lockedAt: nowMs,
    expiresAt: expiresAtMs,
    metadata,
  });

  // 2. Persistent Supabase check if configured
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: existing, error: selectErr } = await supabaseAdmin
        .from('cron_locks')
        .select('lock_key, expires_at')
        .eq('lock_key', lockKey)
        .maybeSingle();

      if (!selectErr && existing) {
        const existingExpiresMs = new Date(existing.expires_at).getTime();
        if (existingExpiresMs > nowMs) {
          // Lock is actively held in database
          inMemoryCronLocks.set(lockKey, {
            lockedAt: nowMs,
            expiresAt: existingExpiresMs,
            metadata,
          });
          return false;
        }

        // Lock expired; renew lock conditioning on row still being expired
        const { data: updatedRow, error: updateErr } = await supabaseAdmin
          .from('cron_locks')
          .update({
            locked_at: nowIso,
            expires_at: expiresAtIso,
            metadata,
          })
          .eq('lock_key', lockKey)
          .lte('expires_at', nowIso)
          .select('lock_key')
          .maybeSingle();

        if (updateErr || !updatedRow) {
          inMemoryCronLocks.delete(lockKey);
          return false;
        }
        return true;
      }

      // No existing lock; insert new lock
      const { error: insertErr } = await supabaseAdmin
        .from('cron_locks')
        .insert({
          lock_key: lockKey,
          locked_at: nowIso,
          expires_at: expiresAtIso,
          metadata,
        });

      if (insertErr) {
        // Concurrent runner acquired it first
        inMemoryCronLocks.delete(lockKey);
        return false;
      }

      return true;
    } catch {
      // Fallback to in-memory lock status
      return true;
    }
  }

  return true;
}

/**
 * Releases a cron lock early if needed.
 */
export async function releaseCronLock(lockKey: string): Promise<void> {
  inMemoryCronLocks.delete(lockKey);
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      await supabaseAdmin.from('cron_locks').delete().eq('lock_key', lockKey);
    } catch {
      // Non-blocking
    }
  }
}

/**
 * Clears all in-memory cron locks (useful for test resets).
 */
export function clearAllCronLocks(): void {
  inMemoryCronLocks.clear();
}

export interface DispatchResults {
  timestamp: string;
  evaluatedMembersCount: number;
  promotionsCount: number;
  windDownDispatched: number;
  bedtimeHitDispatched: number;
  communityNagsDispatched: number;
  discordWebhooksCount: number;
  sleepShieldSuppressionsCount: number;
  prunedSubscriptionsCount: number;
  details: {
    windDownRecipients: string[];
    bedtimeRecipients: string[];
    communityNagRecipients: string[];
    discordWebhooksDispatched: string[];
    suppressedDueToSleepShield: string[];
    errors: string[];
  };
}

/**
 * Executes the 1-minute cron notification dispatcher.
 * Enforces:
 * 1. Self-healing 48-hour schedule cooldown promotion.
 * 2. Early "I'm in Bed" Safe Button check-in suppression (anti-spam guarantee).
 * 3. Idempotent T-30m and T-0m triggers via notification_logs.
 * 4. Non-negotiable Sleep Shield guardrail (never wake sleeping or winding down members).
 * 5. Auto-pruning of expired push subscriptions (HTTP 404/410).
 */
export async function executeNotificationDispatcher(options: {
  dryRun?: boolean;
  forcedMemberId?: string;
} = {}): Promise<DispatchResults> {
  const nowUtc = DateTime.utc();
  const results: DispatchResults = {
    timestamp: nowUtc.toISO() || '',
    evaluatedMembersCount: 0,
    promotionsCount: 0,
    windDownDispatched: 0,
    bedtimeHitDispatched: 0,
    communityNagsDispatched: 0,
    discordWebhooksCount: 0,
    sleepShieldSuppressionsCount: 0,
    prunedSubscriptionsCount: 0,
    details: {
      windDownRecipients: [],
      bedtimeRecipients: [],
      communityNagRecipients: [],
      discordWebhooksDispatched: [],
      suppressedDueToSleepShield: [],
      errors: [],
    },
  };

  // 0. Window-level concurrency lock (prevents dual-execution when multiple runners fire in the same minute)
  const timeWindowBucket = nowUtc.toFormat("yyyy-MM-dd'T'HH:mm");
  const windowLockKey = `cron_window:${timeWindowBucket}`;

  if (!options.dryRun && !options.forcedMemberId) {
    const lockAcquired = await acquireCronLock(windowLockKey, 55, {
      source: 'cron_dispatcher',
      window: timeWindowBucket,
    });
    if (!lockAcquired) {
      results.details.errors.push(
        `Dispatch window ${timeWindowBucket} is already locked by another runner. Skipping execution to prevent duplicate notifications.`
      );
      return results;
    }
  }

  // 1. Fetch all active members
  const { data: rawMembers, error: membersError } = await supabaseAdmin
    .from('members')
    .select('*')
    .eq('is_active', true);

  if (membersError || !rawMembers) {
    results.details.errors.push(`Failed to fetch active members: ${membersError?.message}`);
    return results;
  }

  // 2. Perform self-healing 48-hour cooldown promotions
  const activeMembers: Member[] = [];
  for (const m of rawMembers as Member[]) {
    const { promoted, activeMember } = checkCooldownPromotion(m, nowUtc);
    if (promoted && !options.dryRun) {
      results.promotionsCount++;
      await updateMemberSafe(m.id, {
        bedtime_local: activeMember.bedtime_local,
        wake_time_local: activeMember.wake_time_local,
        timezone: activeMember.timezone,
        weekend_bedtime_local: activeMember.weekend_bedtime_local || null,
        weekend_wake_time_local: activeMember.weekend_wake_time_local || null,
        pending_bedtime_local: null,
        pending_wake_time_local: null,
        pending_timezone: null,
        pending_weekend_bedtime_local: null,
        pending_weekend_wake_time_local: null,
        pending_effective_at: null,
        updated_at: nowUtc.toISO(),
      });
    }
    activeMembers.push(activeMember);
  }

  results.evaluatedMembersCount = activeMembers.length;

  // 3. Fetch all active push subscriptions
  const { data: allSubscriptions, error: subError } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*');

  if (subError) {
    results.details.errors.push(`Failed to fetch push subscriptions: ${subError?.message}`);
    return results;
  }

  const subscriptionsByMember = new Map<string, PushSubscriptionRecord[]>();
  for (const sub of (allSubscriptions as PushSubscriptionRecord[]) || []) {
    const list = subscriptionsByMember.get(sub.member_id) || [];
    list.push(sub);
    subscriptionsByMember.set(sub.member_id, list);
  }

  const deadEndpoints: string[] = [];

  // Helper to send to a subscription and track dead endpoints
  const deliverPush = async (
    sub: PushSubscriptionRecord,
    payload: { title: string; body: string; url?: string }
  ) => {
    if (options.dryRun) return true;

    const res = await sendPushNotification(
      {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh_key,
          auth: sub.auth_key,
        },
      },
      payload
    );

    if (!res.success) {
      if (res.statusCode === 404 || res.statusCode === 410) {
        deadEndpoints.push(sub.endpoint);
      }
      return false;
    }
    return true;
  };

  // 3b. Pre-fetch recent notification logs in a single batch query (paginated to avoid PostgREST row cap)
  const twoDaysAgo = nowUtc.minus({ days: 2 }).toISODate() || '2026-01-01';
  const { data: recentLogs, error: logsError } = await fetchAllNotificationLogs<{
    member_id: string;
    notification_type: string;
    local_date: string;
  }>((q) =>
    q.select('member_id, notification_type, local_date')
      .in('notification_type', ['WIND_DOWN_30M', 'BEDTIME_HIT', 'IN_BED_EARLY'])
      .gte('local_date', twoDaysAgo)
  );

  // If fetching idempotency logs fails, ABORT immediately to prevent duplicate alerts
  if (logsError) {
    throw new Error(
      `Failed to fetch notification idempotency logs: ${logsError?.message}. Aborting dispatch to prevent duplicate notifications.`
    );
  }

  const dispatchedSet = new Set<string>();
  for (const log of (recentLogs || [])) {
    dispatchedSet.add(`${log.member_id}:${log.notification_type}:${log.local_date}`);
  }

  // Helper to check idempotency / status log (O(1) in-memory lookup)
  const hasBeenDispatched = (
    memberId: string,
    notificationType: 'WIND_DOWN_30M' | 'BEDTIME_HIT' | 'IN_BED_EARLY',
    localDate: string
  ): boolean => {
    return dispatchedSet.has(`${memberId}:${notificationType}:${localDate}`);
  };

  // Helper to log dispatch and update in-memory cache
  const recordDispatch = async (
    memberId: string,
    notificationType: 'WIND_DOWN_30M' | 'BEDTIME_HIT',
    localDate: string
  ) => {
    dispatchedSet.add(`${memberId}:${notificationType}:${localDate}`);
    if (options.dryRun) return;

    // 1. Audit trail in notification_logs table (idempotent upsert)
    await supabaseAdmin.from('notification_logs').upsert(
      {
        member_id: memberId,
        notification_type: notificationType,
        local_date: localDate,
        dispatched_at: nowUtc.toISO(),
      },
      { onConflict: 'member_id,notification_type,local_date' }
    );

    // 2. Persistent tracking columns on members table for atomic idempotency
    await updateMemberSafe(memberId, {
      last_notified_stage: notificationType,
      last_notified_cycle_date: localDate,
    });
  };

  // 4. Evaluate each member
  for (const member of activeMembers) {
    // If testing a single member, filter others
    if (options.forcedMemberId && member.id !== options.forcedMemberId) {
      continue;
    }

    const localDate = getSleepCycleDate(member, nowUtc);
    if (!localDate) continue;

    // Check if sleeper has checked in early via "I'm in Bed" Safe Button for tonight
    const alreadyInBed =
      (member.last_notified_cycle_date === localDate && member.last_notified_stage === 'IN_BED_EARLY') ||
      hasBeenDispatched(member.id, 'IN_BED_EARLY', localDate);

    const state = computeMemberState(member, member.timezone, nowUtc, alreadyInBed);
    const diff = state.diffMinutes;

    // Check 1: T-Minus 30 Minutes Window (WIND_DOWN_30M)
    // Due-and-not-yet-logged: Wind-down is due starting 30 minutes before bedtime until bedtime (-30 <= diff < 0)
    // Works reliably with 1-min, 5-min or jittered schedulers, protected against duplicates by persistent tracking columns & audit log
    const isWindDownDue = diff >= -30 && diff < 0;
    const isWindDownAlreadyLogged =
      (member.last_notified_cycle_date === localDate &&
        (member.last_notified_stage === 'WIND_DOWN_30M' || member.last_notified_stage === 'BEDTIME_HIT')) ||
      hasBeenDispatched(member.id, 'WIND_DOWN_30M', localDate);

    if (isWindDownDue && !isWindDownAlreadyLogged) {
      if (!options.dryRun) {
        const lockAcquired = await acquireCronLock(
          `notif:${member.id}:${localDate}:WIND_DOWN_30M`,
          86400,
          { member_id: member.id, stage: 'WIND_DOWN_30M', local_date: localDate }
        );
        if (!lockAcquired) {
          continue;
        }
      }

      if (alreadyInBed) {
        // Sleeper is already safely in bed! Suppress wind-down notification
        results.sleepShieldSuppressionsCount++;
        results.details.suppressedDueToSleepShield.push(
          `${member.discord_username} (Wind-down skipped: already checked in as in bed)`
        );
        await recordDispatch(member.id, 'WIND_DOWN_30M', localDate);
      } else {
        const memberSubs = subscriptionsByMember.get(member.id) || [];
        const personalSubs = memberSubs.filter((s) => s.notify_personal);

        for (const sub of personalSubs) {
          const sent = await deliverPush(sub, {
            title: '🕯️ Z Catchers: Wind-Down Time',
            body: `30 minutes until your bedtime (${state.formattedSleeperTime}). Start wrapping up!`,
            url: member.journal_url,
          });
          if (sent) results.windDownDispatched++;
        }

        results.details.windDownRecipients.push(member.discord_username);
        await recordDispatch(member.id, 'WIND_DOWN_30M', localDate);
      }
    }

    // Check 2: T-Minus 0 Minutes Bedtime Hit Window (BEDTIME_HIT)
    // Evaluates a rolling 30-minute lookback window (0 <= diff <= 30) ensuring triggers even with GitHub Actions cron jitter
    // Idempotent persistent checks guarantee each notification stage fires at most once per sleep cycle
    const isBedtimeDue = diff >= 0 && diff <= 30;
    const isBedtimeAlreadyLogged =
      (member.last_notified_cycle_date === localDate && member.last_notified_stage === 'BEDTIME_HIT') ||
      hasBeenDispatched(member.id, 'BEDTIME_HIT', localDate);

    if (isBedtimeDue && !isBedtimeAlreadyLogged) {
      if (!options.dryRun) {
        const lockAcquired = await acquireCronLock(
          `notif:${member.id}:${localDate}:BEDTIME_HIT`,
          86400,
          { member_id: member.id, stage: 'BEDTIME_HIT', local_date: localDate }
        );
        if (!lockAcquired) {
          continue;
        }
      }

      if (alreadyInBed) {
        // ANTI-SPAM GUARANTEE: Member checked in early via Safe Button!
        // Suppress personal bedtime hit AND suppress community nag notifications!
        results.sleepShieldSuppressionsCount++;
        results.details.suppressedDueToSleepShield.push(
          `${member.discord_username} (Checked in early via Safe Button — nag alerts suppressed)`
        );
        await recordDispatch(member.id, 'BEDTIME_HIT', localDate);
      } else {
        // Dispatch A: To the sleeper member (personal notification)
        const memberSubs = subscriptionsByMember.get(member.id) || [];
        const personalSubs = memberSubs.filter((s) => s.notify_personal);

        for (const sub of personalSubs) {
          const sent = await deliverPush(sub, {
            title: "🌙 Time to Catch Some Z's!",
            body: `It's ${state.formattedSleeperTime}. Head to your Discord journal and check in for the night.`,
            url: member.journal_url,
          });
          if (sent) results.bedtimeHitDispatched++;
        }
        results.details.bedtimeRecipients.push(member.discord_username);

        // Dispatch B: To the community friends (STRICTLY GUARDED BY SLEEP SHIELD)
        for (const peer of activeMembers) {
          if (peer.id === member.id) continue;

          const peerSubs = subscriptionsByMember.get(peer.id) || [];
          const communitySubs = peerSubs.filter((s) => s.notify_community);
          if (communitySubs.length === 0) continue;

          // Check if peer is in bed or sleep shielded
          const peerLocalDate = getSleepCycleDate(peer, nowUtc);
          const peerInBed = peerLocalDate
            ? (peer.last_notified_cycle_date === peerLocalDate && peer.last_notified_stage === 'IN_BED_EARLY') ||
              hasBeenDispatched(peer.id, 'IN_BED_EARLY', peerLocalDate)
            : false;

          const peerState = computeMemberState(peer, peer.timezone, nowUtc, peerInBed);

          // SLEEP SHIELD GUARDRAIL:
          // 1. Peer is in SLEEPING bucket (isSleepShieldActive = true, or checked in early)
          // 2. Peer is winding down within 15 minutes before their own bedtime (-15 <= diff < 0)
          const isPeerShieldActive =
            peerState.isSleepShieldActive ||
            peerState.bucket === 'SLEEPING' ||
            peerInBed ||
            (peerState.diffMinutes >= -15 && peerState.diffMinutes < 0);

          if (isPeerShieldActive) {
            results.sleepShieldSuppressionsCount++;
            results.details.suppressedDueToSleepShield.push(
              `${peer.discord_username} (Shield Active: ${peerState.bucket}, diff: ${Math.round(
                peerState.diffMinutes
              )}m)`
            );
            continue; // STRICTLY SKIP SLEEPING PEER!
          }

          // Peer is awake and safe to receive nag notification!
          for (const sub of communitySubs) {
            const sent = await deliverPush(sub, {
              title: `🔔 Z Catchers Alert: ${member.discord_username}`,
              body: `It's ${member.discord_username}'s bedtime! Tap to jump into their Discord journal and tell them to sleep.`,
              url: member.journal_url,
            });
            if (sent) results.communityNagsDispatched++;
          }
          results.details.communityNagRecipients.push(peer.discord_username);
        }

        // Dispatch C: Discord Community Webhook Broadcast (Phase 3.2)
        if (!options.dryRun) {
          const webhookRes = await sendBedtimeDiscordWebhook(member, member.streak_days || 0, {
            effectiveBedtime: state.formattedSleeperTime,
          });
          if (webhookRes.success) {
            results.discordWebhooksCount++;
            results.details.discordWebhooksDispatched.push(member.discord_username);
          } else if (webhookRes.error && !webhookRes.error.includes('not configured')) {
            results.details.errors.push(`Discord Webhook (${member.discord_username}): ${webhookRes.error}`);
          }
        }

        await recordDispatch(member.id, 'BEDTIME_HIT', localDate);
      }
    }
  }

  // 5. Clean up dead subscriptions
  if (deadEndpoints.length > 0 && !options.dryRun) {
    const uniqueDead = Array.from(new Set(deadEndpoints));
    results.prunedSubscriptionsCount = uniqueDead.length;
    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .in('endpoint', uniqueDead);
  }

  return results;
}
