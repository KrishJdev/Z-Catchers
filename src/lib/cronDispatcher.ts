import { DateTime } from 'luxon';
import {
  supabaseAdmin,
  isSupabaseConfigured,
  Member,
  PushSubscriptionRecord,
  fetchAllNotificationLogs,
  fetchAllRows,
  updateMemberSafe,
  hydrateMemberWeekendHours,
  getAllInMemoryMembers,
  getInMemorySleepLogs,
  getMemberByIdSafe,
} from '@/lib/db';
import { checkCooldownPromotion, computeMemberState, getSleepCycleDate, getNightScheduleDateTime, getNextScheduledBedtime, getPreviousScheduledBedtime, resolveActiveSleepCycleWindow } from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';
import { pushTtlBefore, sendPushNotification } from '@/lib/pushServer';
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

const PUSH_TTL_SECONDS = 300;
const STRIKE_ALERT_MINUTES = 30;

function deliveredSubIds(metadata?: Record<string, unknown>): string[] {
  return Array.isArray(metadata?.delivered_sub_ids) ? metadata.delivered_sub_ids as string[] : [];
}

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
  const mergedMemMetadata = {
    ...metadata,
    delivered_sub_ids: [...new Set([...deliveredSubIds(existingMem?.metadata), ...deliveredSubIds(metadata)])],
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

      if (selectErr) throw new Error(`Could not read cron lock: ${selectErr.message}`);
      if (existing) {
        const existingExpiresMs = new Date(existing.expires_at).getTime();
        const existingMeta = (existing.metadata || {}) as Record<string, unknown>;
        const isCompleted = existingMeta.completed === true;
        const delivered = [...new Set([...deliveredSubIds(existingMeta), ...mergedMemMetadata.delivered_sub_ids])];

        if (existingExpiresMs > nowMs || isCompleted) {
          // Lock is actively held in database or completed
          inMemoryCronLocks.set(lockKey, {
            lockedAt: nowMs,
            expiresAt: existingExpiresMs,
            metadata: { ...existingMeta, delivered_sub_ids: delivered },
          });
          return false;
        }

        // Lock expired; renew lock conditioning on row still being expired.
        // Merge any previously recorded delivered_sub_ids to prevent duplicates across retries.
        const mergedMetadata = { ...metadata, delivered_sub_ids: delivered };

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

        if (updateErr) throw new Error(`Could not renew cron lock: ${updateErr.message}`);
        if (!updatedRow) {
          if (existingMem) inMemoryCronLocks.set(lockKey, existingMem);
          else inMemoryCronLocks.delete(lockKey);
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
          metadata: mergedMemMetadata,
        });

      if (insertErr) {
        if (insertErr.code !== '23505') throw new Error(`Could not acquire cron lock: ${insertErr.message}`);
        // Concurrent runner acquired it first
        if (existingMem) inMemoryCronLocks.set(lockKey, existingMem);
        else inMemoryCronLocks.delete(lockKey);
        return false;
      }

      return true;
    } catch (error) {
      if (existingMem) inMemoryCronLocks.set(lockKey, existingMem);
      else inMemoryCronLocks.delete(lockKey);
      throw error;
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
  const delivered = [...new Set([...deliveredSubIds(mem?.metadata), subId])];
  const updatedMeta = { ...(mem?.metadata || {}), delivered_sub_ids: delivered };
  if (mem) {
    mem.metadata = updatedMeta;
  }

  if (isSupabaseConfigured && supabaseAdmin) {
    if (!mem) throw new Error('Missing cron lease for delivery receipt.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = Date.now();
      if (inMemoryCronLocks.get(lockKey) !== mem || now >= mem.expiresAt) break;
      const { data, error } = await supabaseAdmin
        .from('cron_locks')
        .update({ metadata: updatedMeta })
        .eq('lock_key', lockKey)
        .eq('locked_at', new Date(mem.lockedAt).toISOString())
        .gt('expires_at', new Date(now).toISOString())
        .select('lock_key')
        .maybeSingle();
      if (data && !error) return;
      if (!error) break;
      if (attempt === 2) throw new Error(`Could not save delivery receipt: ${error.message}`);
    }
    throw new Error('Cron lease expired while saving delivery receipt.');
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

  if (isSupabaseConfigured && supabaseAdmin) {
    if (!currentMem) throw new Error('Missing cron lease for stage completion.');
    const { data, error } = await supabaseAdmin
      .from('cron_locks')
      .update({ expires_at: expiresAtIso, metadata: completedMeta })
      .eq('lock_key', lockKey)
      .eq('locked_at', new Date(currentMem.lockedAt).toISOString())
      .gt('expires_at', nowIso)
      .select('lock_key').maybeSingle();
    if (error || !data) throw new Error(error?.message || 'Cron lease expired before stage completion.');
  }

  inMemoryCronLocks.set(lockKey, { lockedAt: nowMs, expiresAt: expiresAtMs, metadata: completedMeta });
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
  const currentTime = () => options.testNowUtc || DateTime.utc();
  const nowUtc = currentTime();
  if (process.env.NODE_ENV === 'production' && !isSupabaseConfigured) {
    throw new Error('The dispatcher requires a configured Supabase service role.');
  }
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
      return results;
    }
  }

  // 1. Fetch all active members
  let rawMembers: Member[] = [];
  if (isSupabaseConfigured) {
    const { data, error: membersError } = await fetchAllRows<Member>('members',
      q => q.select('*').eq('is_active', true));

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
      const promotion = await updateMemberSafe(m.id, {
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
      }, { conditions: { pending_effective_at: m.pending_effective_at } })
        .catch(error => ({ data: null, error }));
      if (promotion.error) {
        results.details.errors.push(`Could not promote the pending schedule for ${m.id}. It will be rechecked on the next run.`);
        continue;
      }
      if (promotion.data) {
        results.promotionsCount++;
        if (promotion.data.is_active) activeMembers.push(promotion.data);
      } else {
        const stored = await getMemberByIdSafe(m.id, { requireFresh: true });
        if (stored.error || !stored.data) {
          results.details.errors.push(`Could not verify the stored schedule for ${m.id} after a concurrent update.`);
        } else if (stored.data.is_active) {
          activeMembers.push(stored.data);
        }
      }
      continue;
    }
    activeMembers.push(activeMember);
  }

  results.evaluatedMembersCount = activeMembers.length;

  // 3. Fetch all active push subscriptions
  let allSubscriptions: PushSubscriptionRecord[] = [];
  if (isSupabaseConfigured) {
    const { data, error: subError } = await fetchAllRows<PushSubscriptionRecord>('push_subscriptions',
      q => q.select('*'));

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
    payload: { title: string; body: string; url?: string },
    ttlSeconds: number
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
      payload,
      ttlSeconds
    );

    if (!res.success) {
      if (res.statusCode === 404 || res.statusCode === 410) {
        deadEndpoints.push(sub.endpoint);
      } else {
        results.details.errors.push(`Push to subscription ${sub.id} failed (HTTP ${res.statusCode ?? 'unavailable'}).`);
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

  // A check-in survives notification-stage updates and a subsequent wake-up.
  const sleepHistory = isSupabaseConfigured
    ? await fetchAllRows<{ member_id: string; cycle_date: string; in_bed_at: string | null; woke_up_at: string | null }>(
      'sleep_logs', q => q.select('member_id, cycle_date, in_bed_at, woke_up_at').gte('cycle_date', twoDaysAgo))
    : { data: getInMemorySleepLogs(), error: null };
  if (sleepHistory.error) throw new Error(`Could not verify sleep history: ${sleepHistory.error.message}`);
  for (const log of sleepHistory.data) {
    if (log.in_bed_at) dispatchedSet.add(`${log.member_id}:IN_BED_EARLY:${log.cycle_date}`);
    if (log.woke_up_at) dispatchedSet.add(`${log.member_id}:WOKE_UP:${log.cycle_date}`);
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
    if (isSupabaseConfigured) {
      const { error } = await supabaseAdmin.from('notification_logs').upsert(
        {
          member_id: memberId,
          notification_type: notificationType,
          local_date: localDate,
          dispatched_at: nowUtc.toISO(),
        },
        { onConflict: 'member_id,notification_type,local_date' }
      );
      if (error) throw new Error(`Could not record ${notificationType}: ${error.message}`);
    }

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

  type SleepEvidence = 'IN_BED_EARLY' | 'WOKE_UP';
  const resolveMemberState = (member: Member, at: DateTime<true>, hasEvidence: (type: SleepEvidence, cycle: string) => boolean) => {
    const sleeperZone = toValidLuxonZone(member.timezone);
    const sleeperNow = at.setZone(sleeperZone);
    const yesterdayDate = sleeperNow.minus({ days: 1 }).startOf('day').toISODate()!;
    const checkInAt = member.in_bed_at ? DateTime.fromISO(member.in_bed_at, { zone: sleeperZone }) : null;
    const checkInCycle = checkInAt?.isValid ? getSleepCycleDate(member, checkInAt, true) : null;
    const hasYesterdayInBed =
      (member.last_notified_cycle_date === yesterdayDate && member.last_notified_stage === 'IN_BED_EARLY') ||
      hasEvidence('IN_BED_EARLY', yesterdayDate) ||
      checkInCycle === yesterdayDate;
    const hasYesterdayWokeUp = member.last_wake_cycle_date === yesterdayDate ||
      hasEvidence('WOKE_UP', yesterdayDate);
    const isYesterdaySessionOpen = hasYesterdayInBed && !hasYesterdayWokeUp;

    const localDate = getSleepCycleDate(member, at, isYesterdaySessionOpen || Boolean(member.is_in_bed));

    // Check if sleeper has checked in early via "I'm in Bed" Safe Button for tonight
    const hasInBedEarly = Boolean(member.is_in_bed && (checkInCycle === localDate || (!checkInCycle && !member.last_notified_cycle_date))) ||
      (member.last_notified_cycle_date === localDate && member.last_notified_stage === 'IN_BED_EARLY') ||
      hasEvidence('IN_BED_EARLY', localDate);
    const hasWokeUpForLocalDate =
      member.last_wake_cycle_date === localDate ||
      hasEvidence('WOKE_UP', localDate);
    const alreadyInBed = hasInBedEarly && !hasWokeUpForLocalDate;

    const previousBedtime = getPreviousScheduledBedtime(member, at);
    const previousCycle = previousBedtime.cycleEveningDate;
    const restedDuringQuietHours = at < previousBedtime.bedtimeDateTime.plus({ hours: 8 }) && (
      checkInCycle === previousCycle || member.last_wake_cycle_date === previousCycle ||
      (member.last_notified_stage === 'IN_BED_EARLY' && member.last_notified_cycle_date === previousCycle) ||
      hasEvidence('IN_BED_EARLY', previousCycle) ||
      hasEvidence('WOKE_UP', previousCycle)
    );
    const state = computeMemberState(member, member.timezone, at, alreadyInBed);
    return { state, restedDuringQuietHours, alreadyInBed, hasWokeUpForLocalDate, localDate, sleeperNow,
      sleeperZone, yesterdayDate, hasYesterdayInBed, hasYesterdayWokeUp };
  };

  const memberStates = new Map(activeMembers.map(member => [member.id, resolveMemberState(member, nowUtc,
    (type, cycle) => hasBeenDispatched(member.id, type, cycle))]));
  type DispatchMemberState = ReturnType<typeof resolveMemberState>;
  const peerQuiet = ({ state, alreadyInBed, restedDuringQuietHours }: DispatchMemberState) =>
    restedDuringQuietHours || state.isSleepShieldActive || state.bucket === 'SLEEPING' || alreadyInBed
      || (state.diffMinutes >= -15 && state.diffMinutes < 0);

  const reloadSleepEvidence = async (memberId: string) => {
    const fromDate = currentTime().minus({ days: 2 }).toISODate()!;
    const [stored, logs, sleep] = await Promise.all([
      getMemberByIdSafe(memberId, { requireFresh: true }),
      fetchAllNotificationLogs<{ notification_type: SleepEvidence; local_date: string }>(q =>
        q.select('notification_type, local_date').eq('member_id', memberId)
          .in('notification_type', ['IN_BED_EARLY', 'WOKE_UP']).gte('local_date', fromDate)),
      fetchAllRows<{ cycle_date: string; in_bed_at: string | null; woke_up_at: string | null }>('sleep_logs', q =>
        q.select('cycle_date, in_bed_at, woke_up_at').eq('member_id', memberId).gte('cycle_date', fromDate)),
    ]);
    if (stored.error || !stored.data || logs.error || sleep.error) {
      results.details.errors.push(`Could not verify current sleep status for ${memberId}.`);
      return null;
    }
    if (!stored.data.is_active) return null;
    const evidence = new Set(logs.data.map(log => `${log.notification_type}:${log.local_date}`));
    for (const log of sleep.data) {
      if (log.in_bed_at) evidence.add(`IN_BED_EARLY:${log.cycle_date}`);
      if (log.woke_up_at) evidence.add(`WOKE_UP:${log.cycle_date}`);
    }
    return { member: stored.data, hasEvidence: (type: SleepEvidence, cycle: string) => evidence.has(`${type}:${cycle}`) };
  };

  const pendingStrikeCycles = new Map<string, Set<string>>();
  if (!options.dryRun) {
    const pending = isSupabaseConfigured
      ? await fetchAllRows<{ metadata: Record<string, unknown> }>('cron_locks', q =>
        q.select('metadata').eq('metadata->>stage', 'AUTO_BEDTIME_STRIKE').eq('metadata->>state', 'processing'))
      : { data: [...inMemoryCronLocks.values()], error: null };
    if (pending.error) throw new Error(`Could not read pending strike alerts: ${pending.error.message}`);
    for (const { metadata } of pending.data) {
      if (metadata?.stage !== 'AUTO_BEDTIME_STRIKE' || metadata.state !== 'processing') continue;
      const { member_id: id, local_date: cycle } = metadata;
      if (typeof id !== 'string' || typeof cycle !== 'string') continue;
      const cycles = pendingStrikeCycles.get(id) ?? new Set<string>();
      cycles.add(cycle);
      pendingStrikeCycles.set(id, cycles);
    }
  }

  for (const member of activeMembers) {
    // If testing a single member, filter others
    if (options.forcedMemberId && member.id !== options.forcedMemberId) {
      continue;
    }

    const { state, restedDuringQuietHours, alreadyInBed, hasWokeUpForLocalDate, localDate, sleeperNow, sleeperZone,
      yesterdayDate, hasYesterdayInBed, hasYesterdayWokeUp } = memberStates.get(member.id)!;
    const diff = state.diffMinutes;
    const bedtime = resolveActiveSleepCycleWindow(member, nowUtc, alreadyInBed).bedtimeTimestamp;
    const bedtimeAlertDeadline = bedtime.plus({ minutes: 30 });

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

    if (isWindDownDue && !isWindDownAlreadyLogged && (options.dryRun || await acquireCronLock(
      windDownLockKey, NOTIFICATION_LEASE_SECONDS,
      { member_id: member.id, stage: 'WIND_DOWN_30M', local_date: localDate, state: 'processing' }
    ))) {
      const errorsBeforeWindDown = results.details.errors.length;

      if (alreadyInBed || restedDuringQuietHours || hasWokeUpForLocalDate) {
        // Sleeper is already safely in bed! Suppress wind-down notification
        results.sleepShieldSuppressionsCount++;
        results.details.suppressedDueToSleepShield.push(
          `${member.discord_username} (Wind-down skipped during quiet hours or completed check-in)`
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
        const deliveredSubs = new Set(deliveredSubIds(existingLock?.metadata));

        for (const sub of personalSubs) {
          if (deliveredSubs.has(sub.id)) {
            continue; // Skip already delivered subscription to avoid duplicate push
          }
          const at = currentTime();
          const ttl = pushTtlBefore(bedtime, at, 30 * 60);
          if (ttl < 1) break;
          const remainingMinutes = Math.ceil(bedtime.diff(at, 'minutes').minutes);
          const sent = await deliverPush(sub, {
            title: '🕯️ Z Catchers: Wind-Down Time',
            body: `${remainingMinutes} ${remainingMinutes === 1 ? 'minute' : 'minutes'} until your bedtime (${state.formattedSleeperTime}). Start wrapping up!`,
            url: member.journal_url,
          }, ttl);
          if (sent) {
            deliveredSubs.add(sub.id);
            results.windDownDispatched++;
            if (!options.dryRun) {
              await recordCronLockDeliveredSub(windDownLockKey, sub.id);
            }
          }
        }

        if (results.details.errors.length === errorsBeforeWindDown) {
          if (deliveredSubs.size > 0) results.details.windDownRecipients.push(member.discord_username);
          await recordDispatch(member.id, 'WIND_DOWN_30M', localDate);
          if (!options.dryRun) {
            await markCronLockCompleted(windDownLockKey, { member_id: member.id, stage: 'WIND_DOWN_30M', local_date: localDate });
          }
        }
      }
    }

    // Check 2: T-Minus 0 Minutes Bedtime Hit Window (BEDTIME_HIT)
    // A run inside the 30-minute recovery window can deliver an outstanding alert.
    // Idempotent persistent checks guarantee each notification stage fires at most once per sleep cycle
    const bedtimeLockKey = `notif:${member.id}:${localDate}:BEDTIME_HIT`;
    const isBedtimeDue = diff >= 0 && diff < 30;
    const isBedtimeAlreadyLogged =
      (member.last_notified_cycle_date === localDate && member.last_notified_stage === 'BEDTIME_HIT') ||
      hasBeenDispatched(member.id, 'BEDTIME_HIT', localDate) ||
      inMemoryCronLocks.get(bedtimeLockKey)?.metadata?.completed === true;

    const canDispatchBedtime = isBedtimeDue && !isBedtimeAlreadyLogged &&
      (options.dryRun || await acquireCronLock(bedtimeLockKey, NOTIFICATION_LEASE_SECONDS,
        { member_id: member.id, stage: 'BEDTIME_HIT', local_date: localDate, state: 'processing' }));
    if (canDispatchBedtime) {
      const errorsBeforeBedtime = results.details.errors.length;

      if (alreadyInBed || hasWokeUpForLocalDate) {
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
        const deliveredSubs = new Set(deliveredSubIds(existingLock?.metadata));

        // Dispatch A: To the sleeper member (personal notification)
        const memberSubs = subscriptionsByMember.get(member.id) || [];
        const personalSubs = memberSubs.filter((s) => s.notify_personal && !restedDuringQuietHours);

        for (const sub of personalSubs) {
          if (deliveredSubs.has(sub.id)) {
            continue; // Skip already delivered subscription to avoid duplicate push
          }
          const ttl = pushTtlBefore(bedtimeAlertDeadline, currentTime(), PUSH_TTL_SECONDS);
          if (ttl < 1) break;
          const sent = await deliverPush(sub, {
            title: "🌙 Time to Catch Some Z's!",
            body: `It's ${state.formattedSleeperTime}. Head to your Discord journal and check in for the night.`,
            url: member.journal_url,
          }, ttl);
          if (sent) {
            deliveredSubs.add(sub.id);
            results.bedtimeHitDispatched++;
            if (!options.dryRun) {
              await recordCronLockDeliveredSub(bedtimeLockKey, sub.id);
            }
          }
        }
        if (personalSubs.some(sub => deliveredSubs.has(sub.id))) {
          results.details.bedtimeRecipients.push(member.discord_username);
        }

        for (const peer of activeMembers) {
          if (peer.id === member.id) continue;

          const peerSubs = subscriptionsByMember.get(peer.id) || [];
          const communitySubs = peerSubs.filter((s) => s.notify_community);
          if (communitySubs.length === 0) continue;

          if (peerQuiet(memberStates.get(peer.id)!)) {
            results.sleepShieldSuppressionsCount++;
            results.details.suppressedDueToSleepShield.push(`${peer.discord_username} (Shield Active)`);
            continue;
          }

          // Peer is awake and safe to receive nag notification!
          for (const sub of communitySubs) {
            if (deliveredSubs.has(sub.id)) {
              continue; // Skip already delivered subscription to avoid duplicate push
            }
            let deadline = bedtimeAlertDeadline;
            if (!options.dryRun && isSupabaseConfigured) {
              const fresh = await reloadSleepEvidence(peer.id);
              if (!fresh) break;
              const at = currentTime();
              const quietStarts = getNextScheduledBedtime(fresh.member, at).minus({ minutes: 15 });
              if (peerQuiet(resolveMemberState(fresh.member, at, fresh.hasEvidence)) || at >= quietStarts) {
                results.sleepShieldSuppressionsCount++;
                results.details.suppressedDueToSleepShield.push(`${peer.discord_username} (Shield Active on recheck)`);
                break;
              }
              if (quietStarts < deadline) deadline = quietStarts;
            }
            const ttl = pushTtlBefore(deadline, currentTime(), PUSH_TTL_SECONDS);
            if (ttl < 1) break;
            const sent = await deliverPush(sub, {
              title: `🔔 Z Catchers Alert: ${member.discord_username}`,
              body: `It's ${member.discord_username}'s bedtime! Tap to jump into their Discord journal and tell them to sleep.`,
              url: member.journal_url,
            }, ttl);
            if (sent) {
              deliveredSubs.add(sub.id);
              results.communityNagsDispatched++;
              if (!options.dryRun) {
                await recordCronLockDeliveredSub(bedtimeLockKey, sub.id);
              }
            }
          }
          if (communitySubs.some(sub => deliveredSubs.has(sub.id))) {
            results.details.communityNagRecipients.push(peer.discord_username);
          }
        }

        // Broadcast to the configured Discord channel.
        if (!options.dryRun) {
          const webhookAlreadyDelivered = deliveredSubs.has('discord_webhook');
          if (!webhookAlreadyDelivered && currentTime() < bedtimeAlertDeadline) {
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

        if (results.details.errors.length === errorsBeforeBedtime) {
          await recordDispatch(member.id, 'BEDTIME_HIT', localDate);
          if (!options.dryRun) {
            await markCronLockCompleted(bedtimeLockKey, { member_id: member.id, stage: 'BEDTIME_HIT', local_date: localDate });
          }
        }
      }
    }

    // Evaluate outstanding alerts even when a check-in or wake-up made the member ineligible for a new strike.
    const isStrikeDue = diff >= 10
      && (!member.created_at || DateTime.fromISO(member.created_at) <= bedtime)
      && !alreadyInBed && !hasWokeUpForLocalDate
      && (state.isOverdue || (!state.isPastWakeTime && !state.hasLoggedWakeUp));
    const yesterdaySchedule = getNightScheduleDateTime(member, sleeperNow.minus({ days: 1 }).startOf('day'));
    const todaySchedule = getNightScheduleDateTime(member, sleeperNow.startOf('day'));
    const isPriorStrikeDue = localDate !== yesterdayDate && !hasYesterdayInBed && !hasYesterdayWokeUp
      && sleeperNow >= yesterdaySchedule.wakeDateTime && sleeperNow < todaySchedule.bedtimeDateTime
      && sleeperNow >= yesterdaySchedule.bedtimeDateTime.plus({ minutes: 10 })
      && (!member.created_at || DateTime.fromISO(member.created_at) <= yesterdaySchedule.bedtimeDateTime);

    const pendingCycles = pendingStrikeCycles.get(member.id);
    const strikeCycles = new Set(pendingCycles);
    if (isStrikeDue) strikeCycles.add(localDate);
    if (isPriorStrikeDue) strikeCycles.add(yesterdayDate);
    for (const cycle of strikeCycles) {
      const strikeLockKey = `notif:${member.id}:${cycle}:AUTO_BEDTIME_STRIKE`;
      if (hasBeenDispatched(member.id, 'AUTO_BEDTIME_STRIKE', cycle)) continue;

      const isCurrentDue = cycle === localDate && isStrikeDue;
      const isPriorDue = cycle === yesterdayDate && isPriorStrikeDue;
      let strike;
      try {
        strike = await getNightlyStrikeLog(member.id, cycle, { requireFresh: true });
      } catch {
        results.details.errors.push(`Could not verify the nightly strike for ${member.id} on ${cycle}.`);
        continue;
      }
      const committed = strike?.record_type === 'strike';
      const converted = strike?.record_type === 'metastrike';
      const wasPending = pendingCycles?.has(cycle);
      if (converted && !wasPending) continue;
      const shouldIssue = isCurrentDue || (isPriorDue && !strike);
      if (!committed && !wasPending && !shouldIssue) continue;
      if (options.dryRun) {
        if (!committed) {
          results.autoStrikesDispatched++;
          results.details.autoStrikeRecipients.push(isCurrentDue ? member.discord_username : `${member.discord_username} (Prior Day)`);
        }
        continue;
      }

      if (!(await acquireCronLock(strikeLockKey, NOTIFICATION_LEASE_SECONDS,
        { member_id: member.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: cycle, state: 'processing' }))) {
        // A completed lease may have survived a failed audit write.
        if (inMemoryCronLocks.get(strikeLockKey)?.metadata?.completed === true) {
          await recordDispatch(member.id, 'AUTO_BEDTIME_STRIKE', cycle);
        }
        continue;
      }

      const finishStrike = async (alertOutcome: 'complete' | 'expired' | 'not_issued' | 'prior_cycle' | 'converted') => {
        await markCronLockCompleted(strikeLockKey, { alert_outcome: alertOutcome });
        await recordDispatch(member.id, 'AUTO_BEDTIME_STRIKE', cycle);
      };
      if (converted) {
        await finishStrike('converted');
        continue;
      }
      let issuedCount: number | undefined;
      if (!committed) {
        if (!shouldIssue) {
          await finishStrike('not_issued');
          continue;
        }
        const strikeResult = await issueAutomaticBedtimeStrike(member, cycle, currentTime());
        if (!strikeResult.success) {
          results.details.errors.push(`Auto Bedtime Strike (${member.discord_username}): ${strikeResult.error}`);
          continue;
        }
        if (strikeResult.strikeIssued) {
          results.autoStrikesDispatched++;
          results.details.autoStrikeRecipients.push(isCurrentDue ? member.discord_username : `${member.discord_username} (Prior Day)`);
        }
        if (strikeResult.log?.record_type !== 'strike') {
          await finishStrike('not_issued');
          continue;
        }
        if (!isCurrentDue && strikeResult.strikeIssued) {
          await finishStrike('prior_cycle');
          continue;
        }
        strike = strikeResult.log;
        issuedCount = strikeResult.strikesUsed;
      }

      const committedAt = DateTime.fromISO(strike?.updated_at || strike?.created_at || '');
      const scheduled = getNightScheduleDateTime(member, DateTime.fromISO(cycle, { zone: sleeperZone }));
      const deadline = (committedAt.isValid ? committedAt : scheduled.bedtimeDateTime.plus({ minutes: 10 }))
        .plus({ minutes: STRIKE_ALERT_MINUTES });
      if (currentTime() >= deadline) {
        await finishStrike('expired');
        continue;
      }

      const errorsBeforeStrike = results.details.errors.length;
      const deliveredSubs = new Set(deliveredSubIds((await getCronLock(strikeLockKey))?.metadata));
      const personalSubs = (subscriptionsByMember.get(member.id) || []).filter(sub => sub.notify_personal);
      if (!alreadyInBed && !restedDuringQuietHours && !(cycle === localDate && hasWokeUpForLocalDate)) {
        for (const sub of personalSubs) {
          if (deliveredSubs.has(sub.id)) continue;
          const ttl = pushTtlBefore(deadline, currentTime(), PUSH_TTL_SECONDS);
          if (ttl < 1) break;
          const sent = await deliverPush(sub, {
            title: '⚠️ Z Catchers: Bedtime Strike Recorded',
            body: 'You missed your scheduled bedtime check-in by 10 minutes. A normal strike has been recorded. You can replace it with a Metastrike anytime before your next bedtime.',
            url: member.journal_url,
          }, ttl);
          if (sent) await recordCronLockDeliveredSub(strikeLockKey, sub.id);
        }
      }

      if (!deliveredSubs.has('discord_webhook') && currentTime() < deadline) {
        const strikeCount = issuedCount ?? (await resolveMemberStrikeCounts(member, currentTime())).strikes_used;
        if (currentTime() < deadline) {
          const webhookRes = await sendStrikeDiscordWebhook(member, strikeCount || 1,
            'Automated 10-minute bedtime strike (missed bedtime check-in)');
          if (webhookRes.success) {
            results.discordWebhooksCount++;
            results.details.discordWebhooksDispatched.push(`${member.discord_username} (Strike Alert)`);
            await recordCronLockDeliveredSub(strikeLockKey, 'discord_webhook');
          } else if (webhookRes.error && !webhookRes.error.includes('not configured')) {
            results.details.errors.push(`Discord Webhook (${member.discord_username}): ${webhookRes.error}`);
          }
        }
      }

      if (currentTime() >= deadline) await finishStrike('expired');
      else if (results.details.errors.length === errorsBeforeStrike) await finishStrike('complete');
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
