import { DateTime } from 'luxon';
import {
  supabaseAdmin,
  isSupabaseConfigured,
  safeDatabaseErrorCode,
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
import { checkCooldownPromotion, computeMemberState, getCurrentStrikeMonth, getSleepCycleDate, getNightScheduleDateTime, getNextScheduledBedtime, getPreviousScheduledBedtime, resolveActiveSleepCycleWindow } from '@/lib/sleepEngine';
import { toValidLuxonZone } from '@/lib/timezone';
import { pushTtlBefore, sendPushNotification } from '@/lib/pushServer';
import { sendBedtimeDiscordWebhook, sendStrikeDiscordWebhook } from '@/lib/discordWebhook';
import { issueAutomaticBedtimeStrike, getNightlyStrikeLog, getStrikeAlertTotal } from '@/lib/strikes';

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

type CronLease = Readonly<{ lockKey: string; lockedAt: number }>;

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
 * @returns The captured lease, or null if another run holds the lock
 */
export async function acquireCronLock(
  lockKey: string,
  ttlSeconds: number,
  metadata: Record<string, unknown> = {}
): Promise<CronLease | null> {
  const clock = Date.now();
  const existingMem = inMemoryCronLocks.get(lockKey);
  if (existingMem && (existingMem.expiresAt > clock || existingMem.metadata?.completed === true)) return null;

  const nowMs = Math.max(clock, (existingMem?.lockedAt ?? -1) + 1);
  const lease = { lockKey, lockedAt: nowMs };
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  // If re-acquiring an expired in-memory lock, preserve any delivered_sub_ids from the previous run
  const mergedMemMetadata = {
    ...metadata,
    delivered_sub_ids: [...new Set([...deliveredSubIds(existingMem?.metadata), ...deliveredSubIds(metadata)])],
  };

  // Set local in-memory lock
  const pendingLock = {
    lockedAt: nowMs,
    expiresAt: expiresAtMs,
    metadata: mergedMemMetadata,
  };
  inMemoryCronLocks.set(lockKey, pendingLock);
  const stillAcquiring = () => inMemoryCronLocks.get(lockKey) === pendingLock && Date.now() < expiresAtMs;
  const restorePreviousLock = () => {
    if (inMemoryCronLocks.get(lockKey) !== pendingLock) return;
    if (existingMem) inMemoryCronLocks.set(lockKey, existingMem);
    else inMemoryCronLocks.delete(lockKey);
  };

  // 2. Persistent Supabase check if configured
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: existing, error: selectErr } = await supabaseAdmin
        .from('cron_locks')
        .select('lock_key, locked_at, expires_at, metadata')
        .eq('lock_key', lockKey)
        .maybeSingle();

      if (selectErr) throw new Error(`Could not read cron lock: ${selectErr.message}`);
      if (!stillAcquiring()) {
        restorePreviousLock();
        return null;
      }
      if (existing) {
        const existingExpiresMs = new Date(existing.expires_at).getTime();
        const existingMeta = (existing.metadata || {}) as Record<string, unknown>;
        const isCompleted = existingMeta.completed === true;
        const delivered = [...new Set([...deliveredSubIds(existingMeta), ...mergedMemMetadata.delivered_sub_ids])];

        if (existingExpiresMs > nowMs || isCompleted) {
          // Lock is actively held in database or completed
          inMemoryCronLocks.set(lockKey, {
            lockedAt: new Date(existing.locked_at).getTime(),
            expiresAt: existingExpiresMs,
            metadata: { ...existingMeta, delivered_sub_ids: delivered },
          });
          return null;
        }

        const { data: renewedMetadata, error: updateErr } = await supabaseAdmin.rpc('renew_cron_lease', {
          p_key: lockKey,
          p_previous_locked_at: existing.locked_at,
          p_locked_at: nowIso,
          p_expires_at: expiresAtIso,
          p_metadata: mergedMemMetadata,
        });

        if (updateErr) throw new Error(`Could not renew cron lock: ${updateErr.message}`);
        if (!renewedMetadata || !stillAcquiring()) {
          restorePreviousLock();
          return null;
        }

        inMemoryCronLocks.set(lockKey, {
          lockedAt: nowMs,
          expiresAt: expiresAtMs,
          metadata: renewedMetadata,
        });

        return lease;
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
        restorePreviousLock();
        return null;
      }
      if (!stillAcquiring()) {
        restorePreviousLock();
        return null;
      }

      return lease;
    } catch (error) {
      restorePreviousLock();
      throw error;
    }
  }

  return lease;
}

function localCronLease(lease: CronLease) {
  const mem = inMemoryCronLocks.get(lease.lockKey);
  if (mem?.lockedAt !== lease.lockedAt || mem.metadata?.completed === true) {
    throw new Error('Cron lease was replaced or completed.');
  }
  return mem;
}

async function verifyCronLease(lease: CronLease | null): Promise<void> {
  if (!lease) return; // Dry runs do not hold a lease or send.
  const mem = localCronLease(lease);
  if (Date.now() >= mem.expiresAt) throw new Error('Cron lease expired before dispatch.');
  if (isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin.from('cron_locks').select('lock_key')
      .eq('lock_key', lease.lockKey).eq('locked_at', new Date(lease.lockedAt).toISOString())
      .gt('expires_at', new Date().toISOString()).maybeSingle();
    if (error || !data) throw new Error(error?.message || 'Cron lease expired or was replaced before dispatch.');
    if (Date.now() >= localCronLease(lease).expiresAt) throw new Error('Cron lease expired before dispatch.');
  }
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
  lease: CronLease,
  subId: string
): Promise<void> {
  const mem = localCronLease(lease);
  const delivered = [...new Set([...deliveredSubIds(mem.metadata), subId])];
  const updatedMeta = { ...mem.metadata, delivered_sub_ids: delivered };
  mem.metadata = updatedMeta;

  if (isSupabaseConfigured && supabaseAdmin) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = Date.now();
      if (now >= localCronLease(lease).expiresAt) break;
      const { data, error } = await supabaseAdmin
        .from('cron_locks')
        .update({ metadata: updatedMeta })
        .eq('lock_key', lease.lockKey)
        .eq('locked_at', new Date(lease.lockedAt).toISOString())
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
  lease: CronLease,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const nowMs = Date.now();
  const ttlSeconds = 86400; // 24 hours durable completion
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  const currentMem = localCronLease(lease);
  if (nowMs >= currentMem.expiresAt) throw new Error('Cron lease expired before stage completion.');
  const completedMeta = {
    ...currentMem.metadata,
    ...metadata,
    completed: true,
    state: 'completed',
    completed_at: nowIso,
  };

  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.rpc('complete_cron_stage', {
      p_key: lease.lockKey,
      p_locked_at: new Date(lease.lockedAt).toISOString(),
      p_metadata: metadata,
    });
    if (error || !data) throw new Error(error?.message || 'Cron lease expired before stage completion.');
  }

  localCronLease(lease);
  inMemoryCronLocks.set(lease.lockKey, { lockedAt: lease.lockedAt, expiresAt: expiresAtMs, metadata: completedMeta });
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
  strikeWriteFailures: number;
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
    strikeWriteFailures: 0,
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
    const { data, error: membersError } = await fetchAllRows<Member>('members', '*', q => q.eq('is_active', true));

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
    const { data, error: subError } = await fetchAllRows<PushSubscriptionRecord>('push_subscriptions', '*', q => q);

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
  }>('member_id, notification_type, local_date', q =>
    q.in('notification_type', ['WIND_DOWN_30M', 'BEDTIME_HIT', 'IN_BED_EARLY', 'AUTO_BEDTIME_STRIKE', 'WOKE_UP'])
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
      'sleep_logs', 'member_id, cycle_date, in_bed_at, woke_up_at', q => q.gte('cycle_date', twoDaysAgo))
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
    localDate: string,
    updateTracking = true
  ) => {
    dispatchedSet.add(`${memberId}:${notificationType}:${localDate}`);
    if (options.dryRun) return;

    // The database completion RPC owns the durable audit and tracking fields.
    if (!isSupabaseConfigured && updateTracking && notificationType !== 'AUTO_BEDTIME_STRIKE') {
      await updateMemberSafe(memberId, {
        last_notified_stage: notificationType,
        last_notified_cycle_date: localDate,
      });
    }
  };

  // 4. Evaluate each member
  const NOTIFICATION_LEASE_SECONDS = 300; // 5-minute processing lease to allow quick recovery if worker crashes

  const reportStageError = (memberId: string, stage: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    results.details.errors.push(`${stage} for ${memberId}: ${message}`);
  };
  const runNotificationStage = async (
    memberId: string, cycle: string, stage: 'WIND_DOWN_30M' | 'BEDTIME_HIT',
    run: (lease: CronLease | null, finish: (suppressed?: boolean) => Promise<void>) => Promise<void>
  ) => {
    const key = `notif:${memberId}:${cycle}:${stage}`;
    try {
      const lease = options.dryRun ? null : await acquireCronLock(key, NOTIFICATION_LEASE_SECONDS,
        { member_id: memberId, stage, local_date: cycle, state: 'processing' });
      if (!lease && !options.dryRun) return;
      await run(lease, async (suppressed = false) => {
        if (lease) await markCronLockCompleted(lease, { delivery_outcome: suppressed ? 'suppressed' : 'complete' });
        await recordDispatch(memberId, stage, cycle, !suppressed);
      });
    } catch (error) {
      reportStageError(memberId, stage, error);
    }
  };

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
      fetchAllNotificationLogs<{ notification_type: SleepEvidence; local_date: string }>('notification_type, local_date', q =>
        q.eq('member_id', memberId)
          .in('notification_type', ['IN_BED_EARLY', 'WOKE_UP']).gte('local_date', fromDate)),
      fetchAllRows<{ cycle_date: string; in_bed_at: string | null; woke_up_at: string | null }>(
        'sleep_logs', 'cycle_date, in_bed_at, woke_up_at', q => q.eq('member_id', memberId).gte('cycle_date', fromDate)),
    ]);
    if (stored.error || !stored.data || logs.error || sleep.error) {
      throw new Error(`Could not verify current sleep status for ${memberId}.`);
    }
    if (!stored.data.is_active) return null;
    const evidence = new Set(logs.data.map(log => `${log.notification_type}:${log.local_date}`));
    for (const log of sleep.data) {
      if (log.in_bed_at) evidence.add(`IN_BED_EARLY:${log.cycle_date}`);
      if (log.woke_up_at) evidence.add(`WOKE_UP:${log.cycle_date}`);
    }
    return { member: stored.data, hasEvidence: (type: SleepEvidence, cycle: string) => evidence.has(`${type}:${cycle}`) };
  };

  const targetIsProtected = async (memberId: string, cycle: string, lease: CronLease | null) => {
    if (!lease || !isSupabaseConfigured) {
      const snapshot = memberStates.get(memberId)!;
      return snapshot.alreadyInBed || snapshot.restedDuringQuietHours
        || (snapshot.localDate === cycle && snapshot.hasWokeUpForLocalDate);
    }
    const fresh = await reloadSleepEvidence(memberId);
    if (!fresh) return true;
    const latest = resolveMemberState(fresh.member, currentTime(), fresh.hasEvidence);
    return latest.alreadyInBed || latest.restedDuringQuietHours
      || fresh.hasEvidence('IN_BED_EARLY', cycle) || fresh.hasEvidence('WOKE_UP', cycle)
      || fresh.member.last_wake_cycle_date === cycle;
  };

  const pendingStrikeCycles = new Map<string, Set<string>>();
  if (!options.dryRun) {
    const pending = isSupabaseConfigured
      ? await fetchAllRows<{ metadata: Record<string, unknown> }>('cron_locks', 'metadata', q =>
        q.eq('metadata->>stage', 'AUTO_BEDTIME_STRIKE').eq('metadata->>state', 'processing'))
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

    // Wind-down reminders expire at the bedtime selected at the start of the run.
    const isWindDownAlreadyLogged =
      (member.last_notified_cycle_date === localDate &&
        (member.last_notified_stage === 'WIND_DOWN_30M' || member.last_notified_stage === 'BEDTIME_HIT')) ||
      hasBeenDispatched(member.id, 'WIND_DOWN_30M', localDate);

    if (diff >= -30 && diff < 0 && !isWindDownAlreadyLogged) {
      await runNotificationStage(member.id, localDate, 'WIND_DOWN_30M', async (lease, finish) => {
        const suppress = async () => {
          results.sleepShieldSuppressionsCount++;
          results.details.suppressedDueToSleepShield.push(
            `${member.discord_username} (Wind-down skipped during quiet hours or completed check-in)`
          );
          await finish(true);
        };
        if (await targetIsProtected(member.id, localDate, lease)) return suppress();

        const errorsBefore = results.details.errors.length;
        const personalSubs = (subscriptionsByMember.get(member.id) || []).filter(sub => sub.notify_personal);
        const deliveredSubs = new Set(deliveredSubIds(lease ? localCronLease(lease).metadata : undefined));
        for (const sub of personalSubs) {
          if (deliveredSubs.has(sub.id)) continue;
          if (await targetIsProtected(member.id, localDate, lease)) return suppress();
          await verifyCronLease(lease);
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
            if (lease) await recordCronLockDeliveredSub(lease, sub.id);
          }
        }
        if (results.details.errors.length === errorsBefore) {
          if (deliveredSubs.size > 0) results.details.windDownRecipients.push(member.discord_username);
          await finish();
        }
      });
    }

    // A run inside the 30-minute recovery window can deliver an outstanding bedtime alert.
    const isBedtimeAlreadyLogged =
      (member.last_notified_cycle_date === localDate && member.last_notified_stage === 'BEDTIME_HIT') ||
      hasBeenDispatched(member.id, 'BEDTIME_HIT', localDate);

    if (diff >= 0 && diff < 30 && !isBedtimeAlreadyLogged) {
      await runNotificationStage(member.id, localDate, 'BEDTIME_HIT', async (lease, finish) => {
        const errorsBefore = results.details.errors.length;
        const deliveredSubs = new Set(deliveredSubIds(lease ? localCronLease(lease).metadata : undefined));
        const suppress = async () => {
          results.sleepShieldSuppressionsCount++;
          results.details.suppressedDueToSleepShield.push(`${member.discord_username} (Bedtime alerts suppressed)`);
          await finish(true);
        };

        if (await targetIsProtected(member.id, localDate, lease)) return suppress();

        const personalSubs = (subscriptionsByMember.get(member.id) || []).filter(sub => sub.notify_personal);
        for (const sub of personalSubs) {
          if (deliveredSubs.has(sub.id)) continue;
          if (await targetIsProtected(member.id, localDate, lease)) return suppress();
          await verifyCronLease(lease);
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
            if (lease) await recordCronLockDeliveredSub(lease, sub.id);
          }
        }
        if (personalSubs.some(sub => deliveredSubs.has(sub.id))) {
          results.details.bedtimeRecipients.push(member.discord_username);
        }

        for (const peer of activeMembers) {
          if (peer.id === member.id) continue;
          const communitySubs = (subscriptionsByMember.get(peer.id) || []).filter(sub => sub.notify_community);
          if (communitySubs.length === 0) continue;
          if (peerQuiet(memberStates.get(peer.id)!)) {
            results.sleepShieldSuppressionsCount++;
            results.details.suppressedDueToSleepShield.push(`${peer.discord_username} (Shield Active)`);
            continue;
          }

          for (const sub of communitySubs) {
            if (deliveredSubs.has(sub.id)) continue;
            let deadline = bedtimeAlertDeadline;
            if (lease && isSupabaseConfigured) {
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
            if (await targetIsProtected(member.id, localDate, lease)) return suppress();
            await verifyCronLease(lease);
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
              if (lease) await recordCronLockDeliveredSub(lease, sub.id);
            }
          }
          if (communitySubs.some(sub => deliveredSubs.has(sub.id))) {
            results.details.communityNagRecipients.push(peer.discord_username);
          }
        }

        if (lease && !deliveredSubs.has('discord_webhook') && currentTime() < bedtimeAlertDeadline) {
          if (await targetIsProtected(member.id, localDate, lease)) return suppress();
          await verifyCronLease(lease);
          if (currentTime() < bedtimeAlertDeadline) {
            const webhookRes = await sendBedtimeDiscordWebhook(member, member.streak_days || 0, {
              effectiveBedtime: state.formattedSleeperTime,
            });
            if (webhookRes.success) {
              results.discordWebhooksCount++;
              results.details.discordWebhooksDispatched.push(member.discord_username);
              await recordCronLockDeliveredSub(lease, 'discord_webhook');
            } else if (webhookRes.error && !webhookRes.error.includes('not configured')) {
              results.details.errors.push(`Discord Webhook (${member.discord_username}): ${webhookRes.error}`);
            }
          }
        }
        if (results.details.errors.length === errorsBefore) await finish();
      });
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

      try {
        const lease = await acquireCronLock(strikeLockKey, NOTIFICATION_LEASE_SECONDS,
          { member_id: member.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: cycle, state: 'processing' });
        if (!lease) continue;

        const finishStrike = async (alertOutcome: 'complete' | 'expired' | 'not_issued' | 'prior_cycle' | 'converted') => {
          await markCronLockCompleted(lease, { alert_outcome: alertOutcome });
          await recordDispatch(member.id, 'AUTO_BEDTIME_STRIKE', cycle);
        };
        if (converted) {
          await finishStrike('converted');
          continue;
        }
        let alertTotal: { count: number; month: string } | undefined;
        if (!committed) {
          if (!shouldIssue) {
            await finishStrike('not_issued');
            continue;
          }
          await verifyCronLease(lease);
          const issuedAt = currentTime();
          const strikeResult = await issueAutomaticBedtimeStrike(member, cycle, issuedAt);
          if (!strikeResult.success) {
            results.strikeWriteFailures++;
            results.details.errors.push('Automatic strike write failed.');
            console.error('[dispatcher] Automatic strike write failed', {
              databaseCode: safeDatabaseErrorCode(strikeResult.databaseCode),
            });
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
          if (strikeResult.cycleStrikesUsed !== undefined) {
            alertTotal = { count: strikeResult.cycleStrikesUsed, month: cycle.slice(0, 7) };
          } else if (strikeResult.strikeIssued && strikeResult.strikesUsed !== undefined) {
            alertTotal = { count: strikeResult.strikesUsed, month: getCurrentStrikeMonth(member, issuedAt) };
          }
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
        const deliveredSubs = new Set(deliveredSubIds(localCronLease(lease).metadata));
        const personalSubs = (subscriptionsByMember.get(member.id) || []).filter(sub => sub.notify_personal);
        for (const sub of personalSubs) {
          if (deliveredSubs.has(sub.id)) continue;
          if (await targetIsProtected(member.id, cycle, lease)) break;
          await verifyCronLease(lease);
          const ttl = pushTtlBefore(deadline, currentTime(), PUSH_TTL_SECONDS);
          if (ttl < 1) break;
          const sent = await deliverPush(sub, {
            title: '⚠️ Z Catchers: Bedtime Strike Recorded',
            body: 'You missed your scheduled bedtime check-in by 10 minutes. A normal strike has been recorded. Open My Sleep to check your Metastrike options.',
            url: member.journal_url,
          }, ttl);
          if (sent) await recordCronLockDeliveredSub(lease, sub.id);
        }

        if (!deliveredSubs.has('discord_webhook') && currentTime() < deadline) {
          if (!alertTotal) {
            const stored = await getMemberByIdSafe(member.id, { requireFresh: true });
            if (stored.error || !stored.data) throw new Error('Could not read current member strike counts.');
            if (!stored.data.is_active) {
              await finishStrike('complete');
              continue;
            }
            alertTotal = await getStrikeAlertTotal(stored.data, cycle, currentTime());
          }
          await verifyCronLease(lease);
          if (currentTime() < deadline) {
            const webhookRes = await sendStrikeDiscordWebhook(member, alertTotal.count, alertTotal.month,
              'Automated 10-minute bedtime strike (missed bedtime check-in)');
            if (webhookRes.success) {
              results.discordWebhooksCount++;
              results.details.discordWebhooksDispatched.push(`${member.discord_username} (Strike Alert)`);
              await recordCronLockDeliveredSub(lease, 'discord_webhook');
            } else if (webhookRes.error && !webhookRes.error.includes('not configured')) {
              results.details.errors.push(`Discord Webhook (${member.discord_username}): ${webhookRes.error}`);
            }
          }
        }

        if (currentTime() >= deadline) await finishStrike('expired');
        else if (results.details.errors.length === errorsBeforeStrike) await finishStrike('complete');
      } catch (error) {
        reportStageError(member.id, 'AUTO_BEDTIME_STRIKE', error);
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
