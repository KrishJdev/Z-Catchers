import { DateTime } from 'luxon';
import {
  supabaseAdmin,
  isSupabaseConfigured,
  Member,
  PushSubscriptionRecord,
  fetchAllNotificationLogs,
  updateMemberSafe,
  hydrateMemberWeekendHours,
  getAllInMemoryMembers,
} from '@/lib/db';
import { checkCooldownPromotion, computeMemberState, getSleepCycleDate, getNightScheduleDateTime } from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';
import { sendPushNotification } from '@/lib/pushServer';
import { sendBedtimeDiscordWebhook, sendStrikeDiscordWebhook } from '@/lib/discordWebhook';
import { issueAutomaticBedtimeStrike, getNightlyStrikeLog, resolveMemberStrikeCounts } from '@/lib/strikes';

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
  if (existingMem && (existingMem.expiresAt > nowMs || existingMem.metadata?.completed === true)) {
    return false; // Active lock held in memory or completed
  }

  // If re-acquiring an expired in-memory lock, preserve any delivered_sub_ids from the previous run
  const prevDeliveredMem = Array.isArray(existingMem?.metadata?.delivered_sub_ids)
    ? (existingMem!.metadata!.delivered_sub_ids as string[])
    : [];
  const mergedMemMetadata = {
    ...metadata,
    delivered_sub_ids: Array.from(
      new Set([
        ...prevDeliveredMem,
        ...(Array.isArray(metadata.delivered_sub_ids)
          ? (metadata.delivered_sub_ids as string[])
          : []),
      ])
    ),
  };

  // Set local in-memory lock
  inMemoryCronLocks.set(lockKey, {
    lockedAt: nowMs,
    expiresAt: expiresAtMs,
    metadata: mergedMemMetadata,
  });

  // 2. Persistent Supabase check if configured
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: existing, error: selectErr } = await supabaseAdmin
        .from('cron_locks')
        .select('lock_key, expires_at, metadata')
        .eq('lock_key', lockKey)
        .maybeSingle();

      if (!selectErr && existing) {
        const existingExpiresMs = new Date(existing.expires_at).getTime();
        const existingMeta = (existing.metadata || {}) as Record<string, unknown>;
        const isCompleted = existingMeta.completed === true;

        if (existingExpiresMs > nowMs || isCompleted) {
          // Lock is actively held in database or completed
          inMemoryCronLocks.set(lockKey, {
            lockedAt: nowMs,
            expiresAt: existingExpiresMs,
            metadata: existingMeta,
          });
          return false;
        }

        // Lock expired; renew lock conditioning on row still being expired.
        // Merge any previously recorded delivered_sub_ids to prevent duplicates across retries.
        const prevDelivered = Array.isArray(existingMeta.delivered_sub_ids)
          ? (existingMeta.delivered_sub_ids as string[])
          : [];
        const mergedMetadata = {
          ...metadata,
          delivered_sub_ids: Array.from(
            new Set([
              ...prevDelivered,
              ...(Array.isArray(metadata.delivered_sub_ids)
                ? (metadata.delivered_sub_ids as string[])
                : []),
            ])
          ),
        };

        const { data: updatedRow, error: updateErr } = await supabaseAdmin
          .from('cron_locks')
          .update({
            locked_at: nowIso,
            expires_at: expiresAtIso,
            metadata: mergedMetadata,
          })
          .eq('lock_key', lockKey)
          .lte('expires_at', nowIso)
          .select('lock_key')
          .maybeSingle();

        if (updateErr || !updatedRow) {
          inMemoryCronLocks.delete(lockKey);
          return false;
        }

        inMemoryCronLocks.set(lockKey, {
          lockedAt: nowMs,
          expiresAt: expiresAtMs,
          metadata: mergedMetadata,
        });

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
 * Retrieves the current lock status and metadata for a given lock key.
 */
export async function getCronLock(lockKey: string): Promise<{
  lockedAt: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
} | null> {
  const mem = inMemoryCronLocks.get(lockKey);
  if (mem) return mem;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('cron_locks')
        .select('locked_at, expires_at, metadata')
        .eq('lock_key', lockKey)
        .maybeSingle();

      if (!error && data) {
        return {
          lockedAt: new Date(data.locked_at).getTime(),
          expiresAt: new Date(data.expires_at).getTime(),
          metadata: (data.metadata || {}) as Record<string, unknown>,
        };
      }
    } catch {
      // Non-blocking fallback
    }
  }

  return null;
}

/**
 * Records a delivered subscription ID or notification target in the lock metadata
 * so interrupted dispatch recovery will not resend duplicate alerts.
 */
export async function recordCronLockDeliveredSub(
  lockKey: string,
  subId: string
): Promise<void> {
  const mem = inMemoryCronLocks.get(lockKey);
  const delivered: string[] = Array.isArray(mem?.metadata?.delivered_sub_ids)
    ? [...(mem.metadata.delivered_sub_ids as string[])]
    : [];
  if (!delivered.includes(subId)) {
    delivered.push(subId);
  }
  const updatedMeta = { ...(mem?.metadata || {}), delivered_sub_ids: delivered };
  if (mem) {
    mem.metadata = updatedMeta;
  }

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('cron_locks')
        .update({ metadata: updatedMeta })
        .eq('lock_key', lockKey);
    } catch {
      // Non-blocking fallback
    }
  }
}

/**
 * Seals a completed notification dispatch with a durable 24-hour lock
 * and marks completed: true.
 */
export async function markCronLockCompleted(
  lockKey: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const nowMs = Date.now();
  const ttlSeconds = 86400; // 24 hours durable completion
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  const currentMem = inMemoryCronLocks.get(lockKey);
  const completedMeta = {
    ...(currentMem?.metadata || {}),
    ...metadata,
    completed: true,
    state: 'completed',
    completed_at: nowIso,
  };

  inMemoryCronLocks.set(lockKey, {
    lockedAt: nowMs,
    expiresAt: expiresAtMs,
    metadata: completedMeta,
  });

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('cron_locks')
        .update({
          expires_at: expiresAtIso,
          metadata: completedMeta,
        })
        .eq('lock_key', lockKey);
    } catch {
      // Non-blocking fallback
    }
  }
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
  autoStrikesDispatched: number;
  discordWebhooksCount: number;
  sleepShieldSuppressionsCount: number;
  prunedSubscriptionsCount: number;
  details: {
    windDownRecipients: string[];
    bedtimeRecipients: string[];
    communityNagRecipients: string[];
    autoStrikeRecipients: string[];
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
  testNowUtc?: DateTime<true>;
} = {}): Promise<DispatchResults> {
  const nowUtc: DateTime<true> = options.testNowUtc || DateTime.utc();
  const results: DispatchResults = {
    timestamp: nowUtc.toISO() || '',
    evaluatedMembersCount: 0,
    promotionsCount: 0,
    windDownDispatched: 0,
    bedtimeHitDispatched: 0,
    communityNagsDispatched: 0,
    autoStrikesDispatched: 0,
    discordWebhooksCount: 0,
    sleepShieldSuppressionsCount: 0,
    prunedSubscriptionsCount: 0,
    details: {
      windDownRecipients: [],
      bedtimeRecipients: [],
      communityNagRecipients: [],
      autoStrikeRecipients: [],
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
  let rawMembers: Member[] = [];
  if (isSupabaseConfigured) {
    const { data, error: membersError } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('is_active', true);

    if (membersError) {
      results.details.errors.push(`Failed to fetch active members: ${membersError?.message}`);
      return results;
    }
    rawMembers = (data as Member[]) || [];
  } else {
    rawMembers = getAllInMemoryMembers().filter((m) => m.is_active);
  }

  // 2. Perform self-healing 48-hour cooldown promotions
  const activeMembers: Member[] = [];
  for (const rawM of rawMembers as Member[]) {
    const m = hydrateMemberWeekendHours(rawM);
    const { promoted, activeMember } = checkCooldownPromotion(m, nowUtc);
    if (promoted && !options.dryRun) {
      results.promotionsCount++;
      await updateMemberSafe(m.id, {
        bedtime_local: activeMember.bedtime_local,
        wake_time_local: activeMember.wake_time_local,
        timezone: activeMember.timezone,
        weekend_bedtime_local: activeMember.weekend_bedtime_local || null,
        weekend_wake_time_local: activeMember.weekend_wake_time_local || null,
        weekly_schedule: activeMember.weekly_schedule || m.weekly_schedule || null,
        pending_bedtime_local: null,
        pending_wake_time_local: null,
        pending_timezone: null,
        pending_weekend_bedtime_local: null,
        pending_weekend_wake_time_local: null,
        pending_weekly_schedule: null,
        pending_effective_at: null,
        updated_at: nowUtc.toISO(),
      });
    }
    activeMembers.push(activeMember);
  }

  results.evaluatedMembersCount = activeMembers.length;

  // 3. Fetch all active push subscriptions
  let allSubscriptions: PushSubscriptionRecord[] = [];
  if (isSupabaseConfigured) {
    const { data, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*');

    if (subError) {
      results.details.errors.push(`Failed to fetch push subscriptions: ${subError?.message}`);
      return results;
    }
    allSubscriptions = (data as PushSubscriptionRecord[]) || [];
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
      .in('notification_type', ['WIND_DOWN_30M', 'BEDTIME_HIT', 'IN_BED_EARLY', 'AUTO_BEDTIME_STRIKE', 'WOKE_UP'])
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
    notificationType: 'WIND_DOWN_30M' | 'BEDTIME_HIT' | 'IN_BED_EARLY' | 'AUTO_BEDTIME_STRIKE' | 'WOKE_UP',
    localDate: string
  ): boolean => {
    return dispatchedSet.has(`${memberId}:${notificationType}:${localDate}`);
  };

  // Helper to log dispatch and update in-memory cache
  const recordDispatch = async (
    memberId: string,
    notificationType: 'WIND_DOWN_30M' | 'BEDTIME_HIT' | 'AUTO_BEDTIME_STRIKE',
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
    if (notificationType !== 'AUTO_BEDTIME_STRIKE') {
      await updateMemberSafe(memberId, {
        last_notified_stage: notificationType,
        last_notified_cycle_date: localDate,
      });
    }
  };

  // 4. Evaluate each member
  const NOTIFICATION_LEASE_SECONDS = 300; // 5-minute processing lease to allow quick recovery if worker crashes

  for (const member of activeMembers) {
    // If testing a single member, filter others
    if (options.forcedMemberId && member.id !== options.forcedMemberId) {
      continue;
    }

    const sleeperZone = toValidLuxonZone(member.timezone);
    const sleeperNow = nowUtc.setZone(sleeperZone);
    const yesterdayDate = sleeperNow.minus({ days: 1 }).startOf('day').toISODate()!;
    const hasYesterdayInBed =
      (member.last_notified_cycle_date === yesterdayDate && member.last_notified_stage === 'IN_BED_EARLY') ||
      hasBeenDispatched(member.id, 'IN_BED_EARLY', yesterdayDate);
    const hasYesterdayWokeUp =
      Boolean(member.last_wake_cycle_date === yesterdayDate || member.is_woke_up);
    const isYesterdaySessionOpen = hasYesterdayInBed && !hasYesterdayWokeUp;

    const localDate = getSleepCycleDate(member, nowUtc, isYesterdaySessionOpen || Boolean(member.is_in_bed));
    if (!localDate) continue;

    // Check if sleeper has checked in early via "I'm in Bed" Safe Button for tonight
    const hasInBedEarly =
      (member.last_notified_cycle_date === localDate && member.last_notified_stage === 'IN_BED_EARLY') ||
      hasBeenDispatched(member.id, 'IN_BED_EARLY', localDate);
    const hasWokeUpForLocalDate =
      Boolean(member.last_wake_cycle_date === localDate || member.is_woke_up) ||
      hasBeenDispatched(member.id, 'WOKE_UP', localDate);
    const alreadyInBed = hasInBedEarly && !hasWokeUpForLocalDate;

    const state = computeMemberState(member, member.timezone, nowUtc, alreadyInBed);
    const diff = state.diffMinutes;

    // Check 1: T-Minus 30 Minutes Window (WIND_DOWN_30M)
    // Due-and-not-yet-logged: Wind-down is due starting 30 minutes before bedtime until bedtime (-30 <= diff < 0)
    // Works reliably with 1-min, 5-min or jittered schedulers, protected against duplicates by persistent tracking columns & audit log
    const windDownLockKey = `notif:${member.id}:${localDate}:WIND_DOWN_30M`;
    const isWindDownDue = diff >= -30 && diff < 0;
    const isWindDownAlreadyLogged =
      (member.last_notified_cycle_date === localDate &&
        (member.last_notified_stage === 'WIND_DOWN_30M' || member.last_notified_stage === 'BEDTIME_HIT')) ||
      hasBeenDispatched(member.id, 'WIND_DOWN_30M', localDate) ||
      inMemoryCronLocks.get(windDownLockKey)?.metadata?.completed === true;

    if (isWindDownDue && !isWindDownAlreadyLogged) {
      if (!options.dryRun) {
        const lockAcquired = await acquireCronLock(
          windDownLockKey,
          NOTIFICATION_LEASE_SECONDS,
          { member_id: member.id, stage: 'WIND_DOWN_30M', local_date: localDate, state: 'processing', delivered_sub_ids: [] }
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
        if (!options.dryRun) {
          await markCronLockCompleted(windDownLockKey, { member_id: member.id, stage: 'WIND_DOWN_30M', local_date: localDate });
        }
      } else {
        const memberSubs = subscriptionsByMember.get(member.id) || [];
        const personalSubs = memberSubs.filter((s) => s.notify_personal);

        // Check if prior interrupted run delivered to any subscriptions
        const existingLock = await getCronLock(windDownLockKey);
        const deliveredSubs = new Set<string>(
          Array.isArray(existingLock?.metadata?.delivered_sub_ids)
            ? (existingLock.metadata.delivered_sub_ids as string[])
            : []
        );

        for (const sub of personalSubs) {
          if (deliveredSubs.has(sub.id)) {
            continue; // Skip already delivered subscription to avoid duplicate push
          }
          const sent = await deliverPush(sub, {
            title: '🕯️ Z Catchers: Wind-Down Time',
            body: `30 minutes until your bedtime (${state.formattedSleeperTime}). Start wrapping up!`,
            url: member.journal_url,
          });
          if (sent) {
            results.windDownDispatched++;
            if (!options.dryRun) {
              await recordCronLockDeliveredSub(windDownLockKey, sub.id);
            }
          }
        }

        results.details.windDownRecipients.push(member.discord_username);
        await recordDispatch(member.id, 'WIND_DOWN_30M', localDate);
        if (!options.dryRun) {
          await markCronLockCompleted(windDownLockKey, { member_id: member.id, stage: 'WIND_DOWN_30M', local_date: localDate });
        }
      }
    }

    // Check 2: T-Minus 0 Minutes Bedtime Hit Window (BEDTIME_HIT)
    // Evaluates a rolling 30-minute lookback window (0 <= diff <= 30) ensuring triggers even with GitHub Actions cron jitter
    // Idempotent persistent checks guarantee each notification stage fires at most once per sleep cycle
    const bedtimeLockKey = `notif:${member.id}:${localDate}:BEDTIME_HIT`;
    const isBedtimeDue = diff >= 0 && diff <= 30;
    const isBedtimeAlreadyLogged =
      (member.last_notified_cycle_date === localDate && member.last_notified_stage === 'BEDTIME_HIT') ||
      hasBeenDispatched(member.id, 'BEDTIME_HIT', localDate) ||
      inMemoryCronLocks.get(bedtimeLockKey)?.metadata?.completed === true;

    if (isBedtimeDue && !isBedtimeAlreadyLogged) {
      if (!options.dryRun) {
        const lockAcquired = await acquireCronLock(
          bedtimeLockKey,
          NOTIFICATION_LEASE_SECONDS,
          { member_id: member.id, stage: 'BEDTIME_HIT', local_date: localDate, state: 'processing', delivered_sub_ids: [] }
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
        if (!options.dryRun) {
          await markCronLockCompleted(bedtimeLockKey, { member_id: member.id, stage: 'BEDTIME_HIT', local_date: localDate });
        }
      } else {
        // Check if prior interrupted run delivered to any subscriptions
        const existingLock = await getCronLock(bedtimeLockKey);
        const deliveredSubs = new Set<string>(
          Array.isArray(existingLock?.metadata?.delivered_sub_ids)
            ? (existingLock.metadata.delivered_sub_ids as string[])
            : []
        );

        // Dispatch A: To the sleeper member (personal notification)
        const memberSubs = subscriptionsByMember.get(member.id) || [];
        const personalSubs = memberSubs.filter((s) => s.notify_personal);

        for (const sub of personalSubs) {
          if (deliveredSubs.has(sub.id)) {
            continue; // Skip already delivered subscription to avoid duplicate push
          }
          const sent = await deliverPush(sub, {
            title: "🌙 Time to Catch Some Z's!",
            body: `It's ${state.formattedSleeperTime}. Head to your Discord journal and check in for the night.`,
            url: member.journal_url,
          });
          if (sent) {
            results.bedtimeHitDispatched++;
            if (!options.dryRun) {
              await recordCronLockDeliveredSub(bedtimeLockKey, sub.id);
            }
          }
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
          const peerInBedEarly = peerLocalDate
            ? (peer.last_notified_cycle_date === peerLocalDate && peer.last_notified_stage === 'IN_BED_EARLY') ||
              hasBeenDispatched(peer.id, 'IN_BED_EARLY', peerLocalDate)
            : false;
          const peerWokeUp = peerLocalDate
            ? Boolean(peer.last_wake_cycle_date === peerLocalDate || peer.is_woke_up) ||
              hasBeenDispatched(peer.id, 'WOKE_UP', peerLocalDate)
            : false;
          const peerInBed = peerInBedEarly && !peerWokeUp;

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
            if (deliveredSubs.has(sub.id)) {
              continue; // Skip already delivered subscription to avoid duplicate push
            }
            const sent = await deliverPush(sub, {
              title: `🔔 Z Catchers Alert: ${member.discord_username}`,
              body: `It's ${member.discord_username}'s bedtime! Tap to jump into their Discord journal and tell them to sleep.`,
              url: member.journal_url,
            });
            if (sent) {
              results.communityNagsDispatched++;
              if (!options.dryRun) {
                await recordCronLockDeliveredSub(bedtimeLockKey, sub.id);
              }
            }
          }
          results.details.communityNagRecipients.push(peer.discord_username);
        }

        // Dispatch C: Discord Community Webhook Broadcast (Phase 3.2)
        if (!options.dryRun) {
          const webhookAlreadyDelivered = deliveredSubs.has('discord_webhook');
          if (!webhookAlreadyDelivered) {
            const webhookRes = await sendBedtimeDiscordWebhook(member, member.streak_days || 0, {
              effectiveBedtime: state.formattedSleeperTime,
            });
            if (webhookRes.success) {
              results.discordWebhooksCount++;
              results.details.discordWebhooksDispatched.push(member.discord_username);
              await recordCronLockDeliveredSub(bedtimeLockKey, 'discord_webhook');
            } else if (webhookRes.error && !webhookRes.error.includes('not configured')) {
              results.details.errors.push(`Discord Webhook (${member.discord_username}): ${webhookRes.error}`);
            }
          }
        }

        await recordDispatch(member.id, 'BEDTIME_HIT', localDate);
        if (!options.dryRun) {
          await markCronLockCompleted(bedtimeLockKey, { member_id: member.id, stage: 'BEDTIME_HIT', local_date: localDate });
        }
      }
    }

    // Check 3: Automated 10-Minute Bedtime Strike Engine
    // Evaluates currentLocalTime >= scheduledBedtime + 10 minutes (diff >= 10).
    // Automatically issues 1 normal strike if the member has neither checked in via in-bed
    // nor applied an excused Metastrike for this sleep cycle.
    const strikeLockKey = `notif:${member.id}:${localDate}:AUTO_BEDTIME_STRIKE`;
    const isWokeUpForTonight =
      Boolean(member.last_wake_cycle_date === localDate) ||
      hasBeenDispatched(member.id, 'WOKE_UP', localDate);
    const isStrikeDue =
      diff >= 10 &&
      !alreadyInBed &&
      !isWokeUpForTonight &&
      (state.isOverdue || (!state.isPastWakeTime && !state.hasLoggedWakeUp));
    const isStrikeAlreadyLogged =
      hasBeenDispatched(member.id, 'AUTO_BEDTIME_STRIKE', localDate) ||
      inMemoryCronLocks.get(strikeLockKey)?.metadata?.completed === true;

    if (isStrikeDue && !isStrikeAlreadyLogged) {
      if (alreadyInBed) {
        // Sleeper is safely in bed! No strike issued.
      } else {
        const existingStrikeLog = await getNightlyStrikeLog(member.id, localDate);
        if (existingStrikeLog?.record_type === 'metastrike') {
          // Protected by an excused Metastrike for this sleep cycle! Skip.
        } else {
          // Guard against state mutation during dry runs
          if (options.dryRun) {
            if (!existingStrikeLog) {
              results.autoStrikesDispatched++;
              results.details.autoStrikeRecipients.push(member.discord_username);
            }
            continue;
          }

          // Acquire lock to prevent race conditions across parallel runners
          const lockAcquired = await acquireCronLock(
            strikeLockKey,
            NOTIFICATION_LEASE_SECONDS,
            { member_id: member.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: localDate, state: 'processing', delivered_sub_ids: [] }
          );
          if (!lockAcquired) {
            continue;
          }

          let shouldDeliverAlerts = false;
          let strikeCount = 1;

          if (existingStrikeLog?.record_type === 'strike') {
            // Strike already recorded (e.g. from an earlier interrupted run),
            // resume any undelivered member/community alerts without re-issuing or re-incrementing strike
            const counts = await resolveMemberStrikeCounts(member, nowUtc);
            strikeCount = counts.strikes_used || 1;
            shouldDeliverAlerts = true;
          } else {
            // Issue 1 automatic normal strike
            const strikeResult = await issueAutomaticBedtimeStrike(member, localDate, nowUtc);

            if (strikeResult.strikeIssued) {
              results.autoStrikesDispatched++;
              results.details.autoStrikeRecipients.push(member.discord_username);
              strikeCount = strikeResult.strikesUsed ?? 1;
              shouldDeliverAlerts = true;
            } else if (!strikeResult.success) {
              // Durable persistence failure: log error and leave lock incomplete so next run can retry
              results.details.errors.push(
                `Auto Bedtime Strike (${member.discord_username}): ${strikeResult.error || 'Failed to issue strike'}`
              );
              continue;
            } else {
              // Non-strike completion (already checked in, metastrike active, or already at max strikes)
              await recordDispatch(member.id, 'AUTO_BEDTIME_STRIKE', localDate);
              await markCronLockCompleted(strikeLockKey, { member_id: member.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: localDate });
              continue;
            }
          }

          if (shouldDeliverAlerts) {
            const existingLock = await getCronLock(strikeLockKey);
            const deliveredSubs = new Set<string>(
              Array.isArray(existingLock?.metadata?.delivered_sub_ids)
                ? (existingLock.metadata.delivered_sub_ids as string[])
                : []
            );

            // 1. Deliver Push Notification to the sleeper
            const memberSubs = subscriptionsByMember.get(member.id) || [];
            const personalSubs = memberSubs.filter((s) => s.notify_personal);

            for (const sub of personalSubs) {
              if (deliveredSubs.has(sub.id)) continue;
              const sent = await deliverPush(sub, {
                title: '⚠️ Z Catchers: Bedtime Strike Recorded',
                body: `You missed your scheduled bedtime check-in by 10 minutes. A normal strike has been recorded. You can replace it with a Metastrike anytime before your next bedtime.`,
                url: member.journal_url,
              });
              if (sent) {
                await recordCronLockDeliveredSub(strikeLockKey, sub.id);
              }
            }

            // 2. Dispatch Discord Webhook Alert
            const webhookAlreadyDelivered = deliveredSubs.has('discord_webhook');
            if (!webhookAlreadyDelivered) {
              const webhookRes = await sendStrikeDiscordWebhook(
                member,
                strikeCount,
                'Automated 10-minute bedtime strike (missed bedtime check-in)'
              );
              if (webhookRes.success) {
                results.discordWebhooksCount++;
                results.details.discordWebhooksDispatched.push(
                  `${member.discord_username} (Strike Alert)`
                );
                await recordCronLockDeliveredSub(strikeLockKey, 'discord_webhook');
              } else if (webhookRes.error && !webhookRes.error.includes('not configured')) {
                results.details.errors.push(`Discord Webhook (${member.discord_username}): ${webhookRes.error}`);
              }
            }

            await recordDispatch(member.id, 'AUTO_BEDTIME_STRIKE', localDate);
            await markCronLockCompleted(strikeLockKey, { member_id: member.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: localDate });
          }
        }
      }
    }

    // Check 3b: Missed-Bedtime Evaluation for Prior Cycle (if dispatch resumes after scheduled wake)
    // When dispatch runs during daytime (after yesterday's wake time and before tonight's bedtime),
    // check if yesterday's cycle missed bedtime without ever checking in, lacking both in-bed
    // and metastrike records, and hasn't yet been struck.
    if (localDate !== yesterdayDate && !hasYesterdayInBed && !hasYesterdayWokeUp) {
      const yesterdayNightDt = sleeperNow.minus({ days: 1 }).startOf('day');
      const yNightSched = getNightScheduleDateTime(member, yesterdayNightDt);
      const todayNightDt = sleeperNow.startOf('day');
      const tNightSched = getNightScheduleDateTime(member, todayNightDt);

      const isDaytimeAfterWake = sleeperNow >= yNightSched.wakeDateTime && sleeperNow < tNightSched.bedtimeDateTime;
      const memberCreatedDt = member.created_at
        ? DateTime.fromISO(member.created_at, { zone: sleeperZone }).startOf('day')
        : null;
      const memberExistedYesterday = !memberCreatedDt || memberCreatedDt <= yesterdayNightDt;

      if (isDaytimeAfterWake && memberExistedYesterday) {
        const yesterdayBedtimePassed10m = sleeperNow >= yNightSched.bedtimeDateTime.plus({ minutes: 10 });
        const yesterdayStrikeLockKey = `notif:${member.id}:${yesterdayDate}:AUTO_BEDTIME_STRIKE`;
        const isYesterdayStrikeLogged =
          hasBeenDispatched(member.id, 'AUTO_BEDTIME_STRIKE', yesterdayDate) ||
          inMemoryCronLocks.get(yesterdayStrikeLockKey)?.metadata?.completed === true;

        if (yesterdayBedtimePassed10m && !isYesterdayStrikeLogged) {
          const yesterdayStrikeLog = await getNightlyStrikeLog(member.id, yesterdayDate);
          if (!yesterdayStrikeLog) {
            if (options.dryRun) {
              results.autoStrikesDispatched++;
              results.details.autoStrikeRecipients.push(`${member.discord_username} (Prior Day)`);
            } else {
              const lockAcquired = await acquireCronLock(
                yesterdayStrikeLockKey,
                NOTIFICATION_LEASE_SECONDS,
                { member_id: member.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: yesterdayDate, state: 'processing', delivered_sub_ids: [] }
              );
              if (lockAcquired) {
                const strikeResult = await issueAutomaticBedtimeStrike(member, yesterdayDate, nowUtc);
                if (strikeResult.strikeIssued) {
                  results.autoStrikesDispatched++;
                  results.details.autoStrikeRecipients.push(`${member.discord_username} (Prior Day)`);
                }
                await recordDispatch(member.id, 'AUTO_BEDTIME_STRIKE', yesterdayDate);
                await markCronLockCompleted(yesterdayStrikeLockKey, { member_id: member.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: yesterdayDate });
              }
            }
          }
        }
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
