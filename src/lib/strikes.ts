import { DateTime } from 'luxon';
import {
  supabaseAdmin,
  isSupabaseConfigured,
  updateMemberSafe,
  getInMemoryMember,
  syncInMemoryMemberCache,
  sanitizeMemberPayload,
  getMemberByIdSafe,
} from './db.ts';
import type { Member, NightlyStrikeLog, StrikeRecordType } from './db.ts';
import {
  computeMemberState,
  checkMonthlyStrikeReset,
  getCurrentStrikeMonth,
  getSleepCycleDate,
  toValidLuxonZone,
  getNightScheduleDateTime,
  getNextScheduledBedtimeAfter,
} from './sleepEngine.ts';

/**
 * In-memory fallback cache when PostgreSQL tables/columns have not yet been migrated in Supabase.
 * Preserved on globalThis across Next.js API route chunks, hot-module reloads, and offline development.
 */
interface InMemoryStrikeStore {
  logs: Map<string, NightlyStrikeLog>; // Key: `${target_member_id}_${sleep_cycle_date}`
  memberCounts: Map<
    string,
    { strikes_used: number; metastrikes_used: number; strikes_count?: number; metastrikes_count?: number; strike_cycle_month: string }
  >;
}

const globalForStrikeStore = globalThis as unknown as {
  __memoryStrikeStore?: InMemoryStrikeStore;
};

const memoryStore: InMemoryStrikeStore =
  globalForStrikeStore.__memoryStrikeStore || {
    logs: new Map(),
    memberCounts: new Map(),
  };

globalForStrikeStore.__memoryStrikeStore = memoryStore;

/**
 * Utility to clear the in-memory strike store (primarily used by test suites).
 */
export function clearInMemoryStrikeStore(): void {
  memoryStore.logs.clear();
  memoryStore.memberCounts.clear();
}

/**
 * Returns the store key for a nightly strike log
 */
export function getStrikeLogKey(targetMemberId: string, sleepCycleDate: string): string {
  return `${targetMemberId}_${sleepCycleDate}`;
}

/**
 * Resolves effective strikes, metastrikes, and strike cycle month for a member,
 * reconciling alias columns (strikes_used / strikes_count), lazy monthly resets,
 * and verified nightly strike logs.
 */
export async function resolveMemberStrikeCounts(
  member: Member,
  nowUtc = DateTime.utc(),
  loggedCounts?: { loggedStrikes?: number; loggedMetas?: number }
): Promise<{
  strikes_used: number;
  metastrikes_used: number;
  strike_cycle_month: string;
  reset: boolean;
}> {
  const currentMonth = getCurrentStrikeMonth(member, nowUtc);
  const fallback = memoryStore.memberCounts.get(member.id);
  const inMem = getInMemoryMember(member.id);

  // Safely reconcile alias columns on the member record itself
  const memberStrikes = Math.max(
    typeof member.strikes_used === 'number' ? member.strikes_used : 0,
    typeof member.strikes_count === 'number' ? member.strikes_count : 0
  );
  const memberMetas = Math.max(
    typeof member.metastrikes_used === 'number' ? member.metastrikes_used : 0,
    typeof member.metastrikes_count === 'number' ? member.metastrikes_count : 0
  );

  // Default uninitialized cycle month to current month rather than January 2026 to prevent false reset wiping
  const strike_cycle_month =
    member.strike_cycle_month ||
    (fallback?.strike_cycle_month === currentMonth ? fallback.strike_cycle_month : undefined) ||
    (inMem?.strike_cycle_month === currentMonth ? inMem.strike_cycle_month : undefined) ||
    currentMonth;

  // Use cached counts only when each cache source's strike_cycle_month matches the active member cycle
  const fallbackMatchesCycle = Boolean(fallback?.strike_cycle_month && fallback.strike_cycle_month === strike_cycle_month);
  const inMemMatchesCycle = Boolean(inMem?.strike_cycle_month && inMem.strike_cycle_month === strike_cycle_month);

  const fallbackStrikes = Math.max(
    fallbackMatchesCycle && typeof fallback?.strikes_used === 'number' ? fallback.strikes_used : 0,
    fallbackMatchesCycle && typeof fallback?.strikes_count === 'number' ? fallback.strikes_count : 0,
    inMemMatchesCycle && typeof inMem?.strikes_used === 'number' ? inMem.strikes_used : 0,
    inMemMatchesCycle && typeof inMem?.strikes_count === 'number' ? inMem.strikes_count : 0
  );
  const fallbackMetas = Math.max(
    fallbackMatchesCycle && typeof fallback?.metastrikes_used === 'number' ? fallback.metastrikes_used : 0,
    fallbackMatchesCycle && typeof fallback?.metastrikes_count === 'number' ? fallback.metastrikes_count : 0,
    inMemMatchesCycle && typeof inMem?.metastrikes_used === 'number' ? inMem.metastrikes_used : 0,
    inMemMatchesCycle && typeof inMem?.metastrikes_count === 'number' ? inMem.metastrikes_count : 0
  );

  const hasMemberCounts =
    typeof member.strikes_count === 'number' || typeof member.strikes_used === 'number';

  let strikes_used: number;
  let metastrikes_used: number;

  if (isSupabaseConfigured && hasMemberCounts) {
    // A successful database read takes precedence over stale cached counts or logs
    strikes_used = memberStrikes;
    metastrikes_used = memberMetas;
  } else {
    // When database read fails or is unconfigured, fall back to matching cached member counts
    strikes_used = Math.max(memberStrikes, fallbackStrikes);
    metastrikes_used = Math.max(memberMetas, fallbackMetas);
  }

  const dummyMember: Member = {
    ...member,
    strikes_used,
    metastrikes_used,
    strike_cycle_month,
  };

  const { reset, activeMember } = checkMonthlyStrikeReset(dummyMember, nowUtc);

  if (reset) {
    strikes_used = 0;
    metastrikes_used = 0;
    const nextCycleMonth = activeMember.strike_cycle_month || currentMonth;

    // Keep memory store and Supabase in sync with aliases (strikes_used/strikes_count)
    await updateMemberStrikeCounts(member.id, 0, 0, nextCycleMonth);

    return {
      strikes_used: 0,
      metastrikes_used: 0,
      strike_cycle_month: nextCycleMonth,
      reset: true,
    };
  }

  // When DB read failed or DB is not configured, reconcile with verified strike logs from nightly_strike_logs
  if (!(isSupabaseConfigured && hasMemberCounts)) {
    let effectiveLoggedStrikes = 0;
    let effectiveLoggedMetas = 0;

    if (loggedCounts) {
      effectiveLoggedStrikes = loggedCounts.loggedStrikes ?? 0;
      effectiveLoggedMetas = loggedCounts.loggedMetas ?? 0;
    } else {
      for (const log of memoryStore.logs.values()) {
        if (
          log.target_member_id === member.id &&
          log.sleep_cycle_date.startsWith(strike_cycle_month)
        ) {
          if (log.record_type === 'strike') effectiveLoggedStrikes++;
          else if (log.record_type === 'metastrike') effectiveLoggedMetas++;
        }
      }
    }

    if (effectiveLoggedStrikes > strikes_used) {
      strikes_used = Math.min(3, effectiveLoggedStrikes);
    }
    if (effectiveLoggedMetas > metastrikes_used) {
      metastrikes_used = Math.min(3, effectiveLoggedMetas);
    }
  }

  // Auto-heal member row if stored counts were lagging behind verified strike records or if stored month is missing
  const needsMonthPersist = !member.strike_cycle_month && Boolean(strike_cycle_month);
  if (member.id && (strikes_used > memberStrikes || metastrikes_used > memberMetas || needsMonthPersist)) {
    const repairConditions: Record<string, any> = {};
    if (typeof member.strikes_used === 'number') {
      repairConditions.strikes_used = member.strikes_used;
    } else if (typeof member.strikes_count === 'number') {
      repairConditions.strikes_count = member.strikes_count;
    }
    if (typeof member.metastrikes_used === 'number') {
      repairConditions.metastrikes_used = member.metastrikes_used;
    } else if (typeof member.metastrikes_count === 'number') {
      repairConditions.metastrikes_count = member.metastrikes_count;
    }
    if (member.strike_cycle_month === null || member.strike_cycle_month === undefined) {
      repairConditions.strike_cycle_month = null;
    }
    // Wait for the repair to settle before returning so subsequent strike mutations cannot be overwritten by a late repair
    await updateMemberStrikeCounts(
      member.id,
      strikes_used,
      metastrikes_used,
      strike_cycle_month,
      Object.keys(repairConditions).length > 0 ? repairConditions : undefined
    );
  }

  return {
    strikes_used,
    metastrikes_used,
    strike_cycle_month,
    reset: false,
  };
}

/**
 * Updates a member's strike counts in memory and Supabase (with resilient schema fallback).
 */
export async function updateMemberStrikeCounts(
  memberId: string,
  strikesUsed: number,
  metastrikesUsed: number,
  cycleMonth: string,
  conditions?: Record<string, any>
): Promise<{ success: boolean; data?: Member | null; error?: any }> {
  const clampedStrikes = Math.max(0, Math.min(3, strikesUsed));
  const clampedMetastrikes = Math.max(0, Math.min(3, metastrikesUsed));

  // If no conditions required, update in-memory cache optimistically
  if (!conditions) {
    memoryStore.memberCounts.set(memberId, {
      strikes_used: clampedStrikes,
      strikes_count: clampedStrikes,
      metastrikes_used: clampedMetastrikes,
      metastrikes_count: clampedMetastrikes,
      strike_cycle_month: cycleMonth,
    });

    const inMem = getInMemoryMember(memberId);
    if (inMem) {
      syncInMemoryMemberCache({
        ...inMem,
        strikes_used: clampedStrikes,
        strikes_count: clampedStrikes,
        metastrikes_used: clampedMetastrikes,
        metastrikes_count: clampedMetastrikes,
        strike_cycle_month: cycleMonth,
      });
    }
  }

  // Use updateMemberSafe for resilient Supabase update with auto-column stripping and schema cache mismatch recovery
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await updateMemberSafe(
        memberId,
        {
          strikes_used: clampedStrikes,
          strikes_count: clampedStrikes,
          metastrikes_used: clampedMetastrikes,
          metastrikes_count: clampedMetastrikes,
          strike_cycle_month: cycleMonth,
          updated_at: DateTime.utc().toISO(),
        },
        conditions ? { conditions } : {}
      );

      if (error) {
        console.warn('Could not update member strike counts in DB:', error);
        return { success: false, error };
      }

      if (conditions && !data) {
        return { success: false, error: 'Condition mismatch during atomic update' };
      }

      // If conditions were passed, only commit to memory if conditional DB write succeeded
      if (conditions && data) {
        memoryStore.memberCounts.set(memberId, {
          strikes_used: clampedStrikes,
          strikes_count: clampedStrikes,
          metastrikes_used: clampedMetastrikes,
          metastrikes_count: clampedMetastrikes,
          strike_cycle_month: cycleMonth,
        });

        const inMem = getInMemoryMember(memberId);
        if (inMem) {
          syncInMemoryMemberCache({
            ...inMem,
            strikes_used: clampedStrikes,
            strikes_count: clampedStrikes,
            metastrikes_used: clampedMetastrikes,
            metastrikes_count: clampedMetastrikes,
            strike_cycle_month: cycleMonth,
          });
        }
      }

      return { success: true, data };
    } catch (e) {
      console.warn('Could not update member strike counts in DB:', e);
      return { success: false, error: e };
    }
  }

  // Offline / in-memory conditional update
  if (conditions) {
    memoryStore.memberCounts.set(memberId, {
      strikes_used: clampedStrikes,
      strikes_count: clampedStrikes,
      metastrikes_used: clampedMetastrikes,
      metastrikes_count: clampedMetastrikes,
      strike_cycle_month: cycleMonth,
    });

    const inMem = getInMemoryMember(memberId);
    if (inMem) {
      syncInMemoryMemberCache({
        ...inMem,
        strikes_used: clampedStrikes,
        strikes_count: clampedStrikes,
        metastrikes_used: clampedMetastrikes,
        metastrikes_count: clampedMetastrikes,
        strike_cycle_month: cycleMonth,
      });
    }
  }

  return { success: true };
}

/**
 * Fetches a single nightly strike log for a member and sleep cycle date.
 */
export async function getNightlyStrikeLog(
  targetMemberId: string,
  sleepCycleDate: string
): Promise<NightlyStrikeLog | null> {
  const key = getStrikeLogKey(targetMemberId, sleepCycleDate);

  // Try DB first if configured
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabaseAdmin
        .from('nightly_strike_logs')
        .select('*')
        .eq('target_member_id', targetMemberId)
        .eq('sleep_cycle_date', sleepCycleDate)
        .maybeSingle();

      if (!error) {
        if (data) {
          const parsedLog: NightlyStrikeLog = {
            id: data.id,
            target_member_id: data.target_member_id,
            sleep_cycle_date: data.sleep_cycle_date,
            record_type: data.record_type as StrikeRecordType,
            voter_ids: Array.isArray(data.voter_ids) ? data.voter_ids : [],
            reason: data.reason || null,
            created_at: data.created_at,
            updated_at: data.updated_at,
          };
          memoryStore.logs.set(key, parsedLog);
          return parsedLog;
        }
        // After a successful query, treat missing row as authoritative and do not fill from memory
        return null;
      }
    } catch {
      // Fall back to memory store on exception
    }
  }

  return memoryStore.logs.get(key) || null;
}

/**
 * Resolves active strike and metastrike counts from nightly_strike_logs for multiple members within the given month.
 *
 * @param memberIds - Array of target member IDs
 * @param targetMonth - Target calendar month in 'YYYY-MM' format (defaults to current UTC month)
 * @returns Map of memberId to { strikes: number, metastrikes: number }
 */
export async function getMonthlyStrikeCountsBatch(
  memberIds: string[],
  targetMonth = DateTime.utc().toFormat('yyyy-MM')
): Promise<Map<string, { strikes: number; metastrikes: number }>> {
  const result = new Map<string, { strikes: number; metastrikes: number }>();
  if (!memberIds.length) return result;

  const uniqueIds = Array.from(new Set(memberIds));
  for (const id of uniqueIds) {
    result.set(id, { strikes: 0, metastrikes: 0 });
  }

  const dt = DateTime.fromISO(`${targetMonth}-01`, { zone: 'utc' });
  const startDate = dt.isValid ? dt.startOf('month').toISODate()! : `${targetMonth}-01`;
  const endDate = dt.isValid ? dt.endOf('month').toISODate()! : `${targetMonth}-31`;

  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabaseAdmin
        .from('nightly_strike_logs')
        .select('target_member_id, record_type, sleep_cycle_date')
        .in('target_member_id', uniqueIds)
        .gte('sleep_cycle_date', startDate)
        .lte('sleep_cycle_date', endDate)
        .in('record_type', ['strike', 'metastrike']);

      if (!error && Array.isArray(data)) {
        const countedStrikeDates = new Map<string, Set<string>>();
        const countedMetaDates = new Map<string, Set<string>>();

        for (const row of data) {
          if (row.record_type === 'strike') {
            const set = countedStrikeDates.get(row.target_member_id) || new Set<string>();
            set.add(row.sleep_cycle_date);
            countedStrikeDates.set(row.target_member_id, set);
          } else if (row.record_type === 'metastrike') {
            const set = countedMetaDates.get(row.target_member_id) || new Set<string>();
            set.add(row.sleep_cycle_date);
            countedMetaDates.set(row.target_member_id, set);
          }
        }

        for (const id of uniqueIds) {
          const strikes = countedStrikeDates.get(id)?.size || 0;
          const metastrikes = countedMetaDates.get(id)?.size || 0;
          result.set(id, { strikes, metastrikes });
        }
      }
    } catch {
      // Fall through to memory store on exception
    }
  }

  // Also reconcile with in-memory logs
  const inMemoryStrikesByMember = new Map<string, Set<string>>();
  const inMemoryMetasByMember = new Map<string, Set<string>>();

  for (const log of memoryStore.logs.values()) {
    if (
      uniqueIds.includes(log.target_member_id) &&
      log.sleep_cycle_date >= startDate &&
      log.sleep_cycle_date <= endDate
    ) {
      if (log.record_type === 'strike') {
        const dates = inMemoryStrikesByMember.get(log.target_member_id) || new Set<string>();
        dates.add(log.sleep_cycle_date);
        inMemoryStrikesByMember.set(log.target_member_id, dates);
      } else if (log.record_type === 'metastrike') {
        const dates = inMemoryMetasByMember.get(log.target_member_id) || new Set<string>();
        dates.add(log.sleep_cycle_date);
        inMemoryMetasByMember.set(log.target_member_id, dates);
      }
    }
  }

  for (const id of uniqueIds) {
    const current = result.get(id) || { strikes: 0, metastrikes: 0 };
    const memStrikes = inMemoryStrikesByMember.get(id)?.size || 0;
    const memMetas = inMemoryMetasByMember.get(id)?.size || 0;
    current.strikes = Math.min(3, Math.max(current.strikes, memStrikes));
    current.metastrikes = Math.min(3, Math.max(current.metastrikes, memMetas));
    result.set(id, current);
  }

  return result;
}

/**
 * Fetches nightly strike logs for multiple members and their cycle dates in a single batched query.
 *
 * @param requests - List of member IDs and their corresponding sleep cycle dates
 * @returns Map of strike log key to NightlyStrikeLog
 */
export async function getNightlyStrikeLogsBatch(
  requests: { targetMemberId: string; sleepCycleDate: string }[]
): Promise<Map<string, NightlyStrikeLog>> {
  const result = new Map<string, NightlyStrikeLog>();
  if (!requests.length) return result;

  const targetMemberIds = Array.from(new Set(requests.map((r) => r.targetMemberId)));
  const cycleDates = Array.from(new Set(requests.map((r) => r.sleepCycleDate)));
  const requestedKeySet = new Set(requests.map((r) => getStrikeLogKey(r.targetMemberId, r.sleepCycleDate)));

  let querySucceeded = false;
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabaseAdmin
        .from('nightly_strike_logs')
        .select('*')
        .in('target_member_id', targetMemberIds)
        .in('sleep_cycle_date', cycleDates);

      if (!error && Array.isArray(data)) {
        querySucceeded = true;
        for (const row of data) {
          const key = getStrikeLogKey(row.target_member_id, row.sleep_cycle_date);
          if (requestedKeySet.has(key)) {
            const parsedLog: NightlyStrikeLog = {
              id: row.id,
              target_member_id: row.target_member_id,
              sleep_cycle_date: row.sleep_cycle_date,
              record_type: row.record_type as StrikeRecordType,
              voter_ids: Array.isArray(row.voter_ids) ? row.voter_ids : [],
              reason: row.reason || null,
              created_at: row.created_at,
              updated_at: row.updated_at,
            };
            result.set(key, parsedLog);
            memoryStore.logs.set(key, parsedLog);
          }
        }
      }
    } catch {
      // Fall back to memory store
    }
  }

  // Populate from in-memory store ONLY when Supabase is unconfigured or the query failed.
  // After a successful query, treat missing rows as authoritative and do not fill them from memory.
  if (!querySucceeded) {
    for (const req of requests) {
      const key = getStrikeLogKey(req.targetMemberId, req.sleepCycleDate);
      if (!result.has(key)) {
        const fallback = memoryStore.logs.get(key);
        if (fallback) {
          result.set(key, fallback);
        }
      }
    }
  }

  return result;
}

/**
 * Validates whether a strike is eligible for replacement by a Metastrike.
 * A strike is eligible at any point during the current cycle—all the way until
 * the member's next scheduled bedtime in their local timezone.
 */
export function isStrikeEligibleForReplacement(
  member: Member,
  strikeLog: NightlyStrikeLog,
  nowUtc = DateTime.utc(),
  isModerator = false
): boolean {
  if (isModerator) return true;
  if (strikeLog.record_type !== 'strike') return false;

  const normalizedZone = toValidLuxonZone(member.timezone);
  const sleeperZone = DateTime.now().setZone(normalizedZone).isValid ? normalizedZone : 'UTC';
  const sleeperNow = nowUtc.setZone(sleeperZone);

  // Bedtime of the cycle when strike occurred
  const cycleNightDt = DateTime.fromISO(strikeLog.sleep_cycle_date, { zone: sleeperZone }).startOf('day');
  const cycleSched = getNightScheduleDateTime(member, cycleNightDt);
  const cycleBedtime = cycleSched.bedtimeDateTime;

  // The next scheduled bedtime occurring strictly after that cycle's bedtime
  const nextScheduledBedtime = getNextScheduledBedtimeAfter(member, cycleBedtime);

  // Eligible as long as current local time is before the next scheduled bedtime
  return sleeperNow < nextScheduledBedtime;
}

/**
 * Resolves the most recent strike log for a member eligible for replacement before their next scheduled bedtime.
 *
 * @param targetMemberId - ID of member to check
 * @param nowUtc - Current UTC DateTime
 * @param targetMember - Optional target member entity
 * @returns The most recent eligible strike log, or null
 */
export async function getRecentEligibleStrikeLog(
  targetMemberId: string,
  nowUtc = DateTime.utc(),
  targetMember?: Member | null
): Promise<NightlyStrikeLog | null> {
  let member = targetMember;
  if (!member && isSupabaseConfigured) {
    const { data } = await getMemberByIdSafe(targetMemberId);
    member = data as Member | null;
  }
  if (!member) {
    member = getInMemoryMember(targetMemberId) || null;
  }

  // Check DB first if configured
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabaseAdmin
        .from('nightly_strike_logs')
        .select('*')
        .eq('target_member_id', targetMemberId)
        .eq('record_type', 'strike')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error) {
        if (data) {
          const log: NightlyStrikeLog = {
            id: data.id,
            target_member_id: data.target_member_id,
            sleep_cycle_date: data.sleep_cycle_date,
            record_type: data.record_type as StrikeRecordType,
            voter_ids: Array.isArray(data.voter_ids) ? data.voter_ids : [],
            reason: data.reason || null,
            created_at: data.created_at,
            updated_at: data.updated_at,
          };
          const isEligible = member
            ? isStrikeEligibleForReplacement(member, log, nowUtc)
            : nowUtc.diff(DateTime.fromISO(data.created_at, { zone: 'utc' }), 'hours').hours <= 24;
          if (isEligible) {
            return log;
          }
        }
        // After a successful query, treat missing row as authoritative and do not fill from memory
        return null;
      }
    } catch {
      // Fall through to memory store on exception
    }
  }

  // Check in-memory store ONLY when Supabase is unconfigured or query failed
  let bestCandidate: NightlyStrikeLog | null = null;
  let bestTime = 0;
  for (const log of memoryStore.logs.values()) {
    if (log.target_member_id === targetMemberId && log.record_type === 'strike') {
      const isEligible = member
        ? isStrikeEligibleForReplacement(member, log, nowUtc)
        : nowUtc.diff(DateTime.fromISO(log.created_at, { zone: 'utc' }), 'hours').hours <= 24;
      const createdAt = DateTime.fromISO(log.created_at, { zone: 'utc' });
      if (isEligible && createdAt.toMillis() > bestTime) {
        bestTime = createdAt.toMillis();
        bestCandidate = log;
      }
    }
  }

  return bestCandidate;
}

/**
 * Resolves recent strike logs for multiple members eligible for replacement before their next scheduled bedtime.
 * Avoids any monthly-reset writes on this retrieval path and groups results in memory per member.
 *
 * @param targetMemberIds - List of member IDs to retrieve recent eligible strikes for
 * @param nowUtc - Current UTC DateTime (defaults to DateTime.utc())
 * @param membersMap - Optional Map of member entities by ID
 * @returns Map of targetMemberId to the most recent eligible NightlyStrikeLog
 */
export async function getRecentEligibleStrikeLogsBatch(
  targetMemberIds: string[],
  nowUtc = DateTime.utc(),
  membersMap?: Map<string, Member>
): Promise<Map<string, NightlyStrikeLog>> {
  const result = new Map<string, NightlyStrikeLog>();
  if (!targetMemberIds.length) return result;

  const uniqueIds = Array.from(new Set(targetMemberIds));
  const sinceIso = nowUtc.minus({ hours: 48 }).toISO();

  const resolvedMembers = new Map<string, Member>();
  if (membersMap) {
    for (const [id, m] of membersMap.entries()) resolvedMembers.set(id, m);
  }
  for (const id of uniqueIds) {
    if (!resolvedMembers.has(id)) {
      const mem = getInMemoryMember(id);
      if (mem) resolvedMembers.set(id, mem);
    }
  }

  let querySucceeded = false;
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabaseAdmin
        .from('nightly_strike_logs')
        .select('*')
        .in('target_member_id', uniqueIds)
        .eq('record_type', 'strike')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        querySucceeded = true;
        for (const row of data) {
          if (!result.has(row.target_member_id)) {
            const parsedLog: NightlyStrikeLog = {
              id: row.id,
              target_member_id: row.target_member_id,
              sleep_cycle_date: row.sleep_cycle_date,
              record_type: row.record_type as StrikeRecordType,
              voter_ids: Array.isArray(row.voter_ids) ? row.voter_ids : [],
              reason: row.reason || null,
              created_at: row.created_at,
              updated_at: row.updated_at,
            };
            const member = resolvedMembers.get(row.target_member_id);
            const isEligible = member
              ? isStrikeEligibleForReplacement(member, parsedLog, nowUtc)
              : nowUtc.diff(DateTime.fromISO(row.created_at, { zone: 'utc' }), 'hours').hours <= 24;
            if (isEligible) {
              result.set(row.target_member_id, parsedLog);
            }
          }
        }
      }
    } catch {
      // Fall through to memory store
    }
  }

  // Populate from in-memory store ONLY when Supabase is unconfigured or the query failed.
  if (!querySucceeded) {
    for (const memberId of uniqueIds) {
      if (!result.has(memberId)) {
        let bestCandidate: NightlyStrikeLog | null = null;
        let bestTime = 0;
        const member = resolvedMembers.get(memberId);
        for (const log of memoryStore.logs.values()) {
          if (log.target_member_id === memberId && log.record_type === 'strike') {
            const isEligible = member
              ? isStrikeEligibleForReplacement(member, log, nowUtc)
              : nowUtc.diff(DateTime.fromISO(log.created_at, { zone: 'utc' }), 'hours').hours <= 24;
            const createdAt = DateTime.fromISO(log.created_at, { zone: 'utc' });
            if (isEligible && createdAt.toMillis() > bestTime) {
              bestTime = createdAt.toMillis();
              bestCandidate = log;
            }
          }
        }
        if (bestCandidate) {
          result.set(memberId, bestCandidate);
        }
      }
    }
  }

  return result;
}

/**
 * Upserts a nightly strike log in DB (with resilient fallback).
 */
export async function saveNightlyStrikeLog(
  log: NightlyStrikeLog,
  options?: { requireDurable?: boolean }
): Promise<NightlyStrikeLog> {
  const key = getStrikeLogKey(log.target_member_id, log.sleep_cycle_date);

  if (isSupabaseConfigured) {
    try {
      // Guard against automatic strike overwriting a metastrike row in DB
      if (log.record_type === 'strike') {
        const { data: existingRow } = await supabaseAdmin
          .from('nightly_strike_logs')
          .select('record_type')
          .eq('target_member_id', log.target_member_id)
          .eq('sleep_cycle_date', log.sleep_cycle_date)
          .maybeSingle();

        if (existingRow?.record_type === 'metastrike') {
          throw new Error('Cycle is protected by an existing Metastrike');
        }
      }

      const payload = {
        id: log.id,
        target_member_id: log.target_member_id,
        sleep_cycle_date: log.sleep_cycle_date,
        record_type: log.record_type,
        voter_ids: log.voter_ids,
        reason: log.reason || null,
        created_at: log.created_at,
        updated_at: log.updated_at || DateTime.utc().toISO(),
      };

      const { data, error } = await supabaseAdmin
        .from('nightly_strike_logs')
        .upsert(payload, { onConflict: 'target_member_id, sleep_cycle_date' })
        .select('*')
        .single();

      if (error) {
        if (options?.requireDurable) {
          throw error;
        }
      } else if (data) {
        const persisted: NightlyStrikeLog = {
          id: data.id,
          target_member_id: data.target_member_id,
          sleep_cycle_date: data.sleep_cycle_date,
          record_type: data.record_type as StrikeRecordType,
          voter_ids: Array.isArray(data.voter_ids) ? data.voter_ids : [],
          reason: data.reason || null,
          created_at: data.created_at,
          updated_at: data.updated_at,
        };
        memoryStore.logs.set(key, persisted);
        return persisted;
      }
    } catch (e) {
      if (options?.requireDurable) {
        throw e;
      }
      // In-memory fallback already populated
    }
  }

  memoryStore.logs.set(key, log);
  return log;
}

/**
 * Deletes a nightly strike log (used by Moderator Override / Undo).
 */
export async function deleteNightlyStrikeLog(
  targetMemberId: string,
  sleepCycleDate: string
): Promise<boolean> {
  const key = getStrikeLogKey(targetMemberId, sleepCycleDate);
  memoryStore.logs.delete(key);

  if (isSupabaseConfigured) {
    try {
      const { error } = await supabaseAdmin
        .from('nightly_strike_logs')
        .delete()
        .eq('target_member_id', targetMemberId)
        .eq('sleep_cycle_date', sleepCycleDate);

      return !error;
    } catch {
      return true;
    }
  }
  return true;
}

/**
 * AUTOMATED 10-MINUTE BEDTIME STRIKE ENGINE
 *
 * Automatically issues 1 normal strike if a member has not logged "In Bed"
 * within 10 minutes past their scheduled bedtime, provided they have not
 * checked in via in-bed or applied an excused Metastrike for this sleep cycle.
 *
 * Idempotent across multiple runs in the same sleep cycle.
 */
export async function issueAutomaticBedtimeStrike(
  member: Member,
  sleepCycleDate?: string,
  nowUtc = DateTime.utc()
): Promise<{
  success: boolean;
  strikeIssued: boolean;
  log?: NightlyStrikeLog;
  strikesUsed?: number;
  reason?: string;
  error?: string;
}> {
  const cycleDate = sleepCycleDate || getSleepCycleDate(member, nowUtc);

  // 1. Check if member already checked into bed for this cycle
  let hasInBedLog = false;
  if (isSupabaseConfigured) {
    try {
      const { data: inBedEntry } = await supabaseAdmin
        .from('notification_logs')
        .select('id')
        .eq('member_id', member.id)
        .eq('notification_type', 'IN_BED_EARLY')
        .eq('local_date', cycleDate)
        .maybeSingle();

      if (inBedEntry) hasInBedLog = true;
    } catch {
      // Non-blocking
    }
  }

  const isCheckedIn = Boolean(
    member.is_in_bed ||
    hasInBedLog ||
    (member.last_notified_stage === 'IN_BED_EARLY' && member.last_notified_cycle_date === cycleDate)
  );

  if (isCheckedIn) {
    return {
      success: true,
      strikeIssued: false,
      reason: 'already_checked_in',
      error: 'Member has already checked into bed for this cycle.',
    };
  }

  // 2. Check existing nightly strike log for this cycle (idempotency & metastrike protection)
  const existingLog = await getNightlyStrikeLog(member.id, cycleDate);
  if (existingLog) {
    if (existingLog.record_type === 'metastrike') {
      return {
        success: true,
        strikeIssued: false,
        reason: 'metastrike_active',
        log: existingLog,
        error: 'Member is protected by an excused Metastrike for tonight.',
      };
    }
    if (existingLog.record_type === 'strike') {
      const counts = await resolveMemberStrikeCounts(member, nowUtc);
      return {
        success: true,
        strikeIssued: false,
        reason: 'already_issued',
        log: existingLog,
        strikesUsed: counts.strikes_used,
        error: 'A strike has already been issued for this sleep cycle.',
      };
    }
  }

  // 3. Resolve member's monthly strike counts and verify not already capped
  const counts = await resolveMemberStrikeCounts(member, nowUtc);
  if (counts.strikes_used >= 3) {
    return {
      success: true,
      strikeIssued: false,
      reason: 'already_at_max_strikes',
      strikesUsed: counts.strikes_used,
      error: 'Member has already reached the maximum limit of 3 strikes for this month.',
    };
  }

  const newStrikesUsed = counts.strikes_used + 1;

  // Re-verify existing log immediately prior to commit (protect against concurrent metastrike)
  const freshLog = await getNightlyStrikeLog(member.id, cycleDate);
  if (freshLog?.record_type === 'metastrike') {
    return {
      success: true,
      strikeIssued: false,
      reason: 'metastrike_active',
      log: freshLog,
      error: 'Member is protected by an excused Metastrike for tonight.',
    };
  }

  // Update member strike counts with conditional concurrency check
  const updateRes = await updateMemberStrikeCounts(
    member.id,
    newStrikesUsed,
    counts.metastrikes_used,
    counts.strike_cycle_month,
    isSupabaseConfigured
      ? {
          strikes_used: counts.strikes_used,
          metastrikes_used: counts.metastrikes_used,
        }
      : undefined
  );

  if (!updateRes.success) {
    // If conditional check failed, re-check if metastrike was applied concurrently
    const conflictLog = await getNightlyStrikeLog(member.id, cycleDate);
    if (conflictLog?.record_type === 'metastrike') {
      return {
        success: true,
        strikeIssued: false,
        reason: 'metastrike_active',
        log: conflictLog,
        error: 'Member is protected by an excused Metastrike for tonight.',
      };
    }
    return {
      success: false,
      strikeIssued: false,
      reason: 'db_update_failed',
      error: updateRes.error ? `Failed to persist strike count: ${updateRes.error.message || updateRes.error}` : 'Failed to update member strike counts',
    };
  }

  // 4. Save nightly strike log
  const strikeLog: NightlyStrikeLog = {
    id: existingLog?.id || crypto.randomUUID(),
    target_member_id: member.id,
    sleep_cycle_date: cycleDate,
    record_type: 'strike',
    voter_ids: [],
    reason: 'Automated 10-minute bedtime strike (missed bedtime check-in)',
    created_at: existingLog?.created_at || nowUtc.toISO(),
    updated_at: nowUtc.toISO(),
  };

  try {
    const saved = await saveNightlyStrikeLog(strikeLog, { requireDurable: isSupabaseConfigured });
    return {
      success: true,
      strikeIssued: true,
      log: saved,
      strikesUsed: newStrikesUsed,
    };
  } catch (err: any) {
    // Rollback strike count on nightly log failure
    await updateMemberStrikeCounts(
      member.id,
      counts.strikes_used,
      counts.metastrikes_used,
      counts.strike_cycle_month
    );
    return {
      success: false,
      strikeIssued: false,
      reason: 'db_log_failed',
      error: `Failed to persist nightly strike log: ${err?.message || err}`,
    };
  }
}

/**
 * Peer strike voting has been disabled and superseded by the Automated 10-Minute Bedtime Strike Engine.
 */
export async function recordStrikeVote(
  _targetMember: Member,
  _voterId: string,
  _sleepCycleDate?: string,
  _nowUtc = DateTime.utc()
): Promise<{
  success: boolean;
  log?: NightlyStrikeLog;
  strikeIssued?: boolean;
  votesCount?: number;
  strikesUsed?: number;
  error?: string;
}> {
  return {
    success: false,
    error: 'Peer strike voting has been disabled. Bedtime strikes are issued automatically 10 minutes past scheduled bedtime.',
  };
}

/**
 * PROACTIVE METASTRIKE (EXCUSE PASS) WORKFLOW
 *
 * Rules:
 * 1. Member can activate a Metastrike on their own profile for tonight.
 * 2. Member must have metastrikes_used < 3 (max 3 per month).
 * 3. Consumes 1 Metastrike (metastrikes_used + 1).
 * 4. Locks tonight's sleep cycle date with record_type 'metastrike' and reason.
 * 5. Disables strike votes for the night.
 */
export async function useProactiveMetastrike(
  member: Member,
  reason: string,
  sleepCycleDate?: string,
  nowUtc = DateTime.utc()
): Promise<{
  success: boolean;
  log?: NightlyStrikeLog;
  metastrikesUsed?: number;
  strikesUsed?: number;
  error?: string;
}> {
  const counts = await resolveMemberStrikeCounts(member, nowUtc);

  if (counts.metastrikes_used >= 3) {
    return {
      success: false,
      error: 'You have used all 3 Metastrikes for this month. Excuses reset on the 1st of next month.',
    };
  }

  const cycleDate = sleepCycleDate || getSleepCycleDate(member, nowUtc);
  const existingLog = await getNightlyStrikeLog(member.id, cycleDate);

  if (existingLog) {
    if (existingLog.record_type === 'metastrike') {
      return {
        success: false,
        error: 'You have already activated a Metastrike for tonight.',
      };
    }
    if (existingLog.record_type === 'strike') {
      if (isStrikeEligibleForReplacement(member, existingLog, nowUtc)) {
        return convertStrikeToMetastrike(member, reason, cycleDate, nowUtc);
      }
      return {
        success: false,
        error:
          'The window to replace this strike with a Metastrike has expired (next scheduled bedtime has arrived).',
      };
    }
  }

  const newMetastrikesUsed = counts.metastrikes_used + 1;

  // Atomic conditional update on member row to prevent concurrent limit bypass across instances
  if (isSupabaseConfigured) {
    try {
      const updatePayload: Record<string, unknown> = {
        metastrikes_used: newMetastrikesUsed,
        metastrikes_count: newMetastrikesUsed,
        strike_cycle_month: counts.strike_cycle_month,
        updated_at: nowUtc.toISO(),
      };
      const cleanPayload = await sanitizeMemberPayload(updatePayload);
      const { data: updatedMember, error: memberErr } = await supabaseAdmin
        .from('members')
        .update(cleanPayload)
        .eq('id', member.id)
        .lt('metastrikes_used', 3)
        .select('id, metastrikes_used')
        .maybeSingle();

      if (!memberErr && !updatedMember) {
        return {
          success: false,
          error: 'You have used all 3 Metastrikes for this month. Excuses reset on the 1st of next month.',
        };
      }
    } catch {
      // Non-blocking in case DB table is unreachable
    }
  }

  await updateMemberStrikeCounts(
    member.id,
    counts.strikes_used,
    newMetastrikesUsed,
    counts.strike_cycle_month
  );

  const cleanReason = (reason || '').trim() || 'Excused Night';

  const metastrikeLog: NightlyStrikeLog = {
    id: existingLog?.id || crypto.randomUUID(),
    target_member_id: member.id,
    sleep_cycle_date: cycleDate,
    record_type: 'metastrike',
    voter_ids: [],
    reason: cleanReason,
    created_at: existingLog?.created_at || nowUtc.toISO(),
    updated_at: nowUtc.toISO(),
  };

  const saved = await saveNightlyStrikeLog(metastrikeLog);

  return {
    success: true,
    log: saved,
    metastrikesUsed: newMetastrikesUsed,
  };
}

/**
 * RETROACTIVE METASTRIKE (24-HOUR SWAP) WORKFLOW
 *
 * Rules:
 * 1. Target member received a 2-vote strike within the last 24 hours.
 * 2. Member has metastrikes_used < 3.
 * 3. Swaps strike for metastrike:
 *    - Decrements strikes_used by 1
 *    - Increments metastrikes_used by 1
 *    - Updates nightly log record_type to 'metastrike'
 */
export async function convertStrikeToMetastrike(
  member: Member,
  reason: string,
  sleepCycleDate?: string,
  nowUtc = DateTime.utc(),
  isModeratorOverride = false
): Promise<{
  success: boolean;
  log?: NightlyStrikeLog;
  strikesUsed?: number;
  metastrikesUsed?: number;
  error?: string;
}> {
  const counts = await resolveMemberStrikeCounts(member, nowUtc);

  if (counts.metastrikes_used >= 3) {
    return {
      success: false,
      error: 'You have used all 3 Metastrikes for this month. No passes remaining.',
    };
  }

  let cycleDate = sleepCycleDate;
  if (!cycleDate) {
    const recent = await getRecentEligibleStrikeLog(member.id, nowUtc, member);
    cycleDate = recent ? recent.sleep_cycle_date : getSleepCycleDate(member, nowUtc);
  }

  const existingLog = await getNightlyStrikeLog(member.id, cycleDate);

  if (!existingLog || existingLog.record_type !== 'strike') {
    return {
      success: false,
      error: 'No active strike was found to convert.',
    };
  }

  // Verify eligibility window (pre-next-bedtime replacement)
  if (!isModeratorOverride && !isStrikeEligibleForReplacement(member, existingLog, nowUtc, isModeratorOverride)) {
    return {
      success: false,
      error: 'The window to convert this strike to a Metastrike has expired (next scheduled bedtime has arrived).',
    };
  }

  const newStrikesUsed = Math.max(0, counts.strikes_used - 1);
  const newMetastrikesUsed = Math.min(3, counts.metastrikes_used + 1);

  const updateRes = await updateMemberStrikeCounts(
    member.id,
    newStrikesUsed,
    newMetastrikesUsed,
    counts.strike_cycle_month,
    isSupabaseConfigured
      ? {
          strikes_used: counts.strikes_used,
          metastrikes_used: counts.metastrikes_used,
        }
      : undefined
  );

  if (!updateRes.success) {
    return {
      success: false,
      error: 'Could not convert strike due to concurrent count modification. Please retry.',
    };
  }

  const cleanReason = (reason || '').trim() || 'Retroactive Conversion';

  const updatedLog: NightlyStrikeLog = {
    ...existingLog,
    record_type: 'metastrike',
    reason: cleanReason,
    updated_at: nowUtc.toISO(),
  };

  try {
    const saved = await saveNightlyStrikeLog(updatedLog, { requireDurable: isSupabaseConfigured });
    return {
      success: true,
      log: saved,
      strikesUsed: newStrikesUsed,
      metastrikesUsed: newMetastrikesUsed,
    };
  } catch (err: any) {
    // Rollback strike counts on log persistence failure
    await updateMemberStrikeCounts(
      member.id,
      counts.strikes_used,
      counts.metastrikes_used,
      counts.strike_cycle_month
    );
    return {
      success: false,
      error: `Failed to persist Metastrike conversion: ${err?.message || err}`,
    };
  }
}

/**
 * MODERATOR OVERRIDE OPERATIONS
 */
/**
 * Moderator action to manually override a member's strikes and metastrikes count.
 *
 * @param memberId - Target member ID
 * @param strikesUsed - New strikes count (0-3)
 * @param metastrikesUsed - New metastrikes count (0-3)
 * @returns Result object with success flag and optional error message
 */
export async function modAdjustStrikes(
  memberId: string,
  strikesUsed: number,
  metastrikesUsed: number
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    const counts = await resolveMemberStrikeCounts({ id: memberId } as Member);
    await updateMemberStrikeCounts(
      memberId,
      strikesUsed,
      metastrikesUsed,
      counts.strike_cycle_month
    );
    return { success: true };
  }
  try {
    const { data: member } = await getMemberByIdSafe(memberId);

    if (!member) {
      return { success: false, error: 'Member not found.' };
    }

    const counts = await resolveMemberStrikeCounts(member as Member);
    await updateMemberStrikeCounts(
      memberId,
      strikesUsed,
      metastrikesUsed,
      counts.strike_cycle_month
    );

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

/**
 * Moderator action to clear an accidental strike or metastrike log and adjust counts.
 *
 * @param memberId - Target member ID
 * @param sleepCycleDate - Sleep cycle date string ('YYYY-MM-DD')
 * @returns Result object with success flag and optional error message
 */
export async function modClearStrikeLog(
  memberId: string,
  sleepCycleDate: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const existingLog = await getNightlyStrikeLog(memberId, sleepCycleDate);
    if (!existingLog) {
      return { success: true };
    }

    const { data: rawMember } = await getMemberByIdSafe(memberId);

    if (rawMember) {
      const member = rawMember as Member;
      const counts = await resolveMemberStrikeCounts(member);

      let newStrikes = counts.strikes_used;
      let newMetas = counts.metastrikes_used;

      if (existingLog.record_type === 'strike') {
        newStrikes = Math.max(0, counts.strikes_used - 1);
      } else if (existingLog.record_type === 'metastrike') {
        newMetas = Math.max(0, counts.metastrikes_used - 1);
      }

      await updateMemberStrikeCounts(
        memberId,
        newStrikes,
        newMetas,
        counts.strike_cycle_month
      );
    } else {
      const counts = await resolveMemberStrikeCounts({ id: memberId } as Member);
      let newStrikes = counts.strikes_used;
      let newMetas = counts.metastrikes_used;

      if (existingLog.record_type === 'strike') {
        newStrikes = Math.max(0, counts.strikes_used - 1);
      } else if (existingLog.record_type === 'metastrike') {
        newMetas = Math.max(0, counts.metastrikes_used - 1);
      }

      await updateMemberStrikeCounts(
        memberId,
        newStrikes,
        newMetas,
        counts.strike_cycle_month
      );
    }

    await deleteNightlyStrikeLog(memberId, sleepCycleDate);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

/**
 * Hydrates a member profile with their tonight strike log and voting status for the client.
 */
export async function hydrateMemberStrikes(
  member: Member,
  nowUtc = DateTime.utc(),
  voterId?: string | null
): Promise<Member> {
  const counts = await resolveMemberStrikeCounts(member, nowUtc);
  const cycleDate = getSleepCycleDate(member, nowUtc);
  const tonightLog = await getNightlyStrikeLog(member.id, cycleDate);

  const isMetastrikeActive = tonightLog?.record_type === 'metastrike';
  const hasVotedStrike = Boolean(voterId && tonightLog?.voter_ids?.includes(voterId));

  return {
    ...member,
    strikes_used: counts.strikes_used,
    metastrikes_used: counts.metastrikes_used,
    strike_cycle_month: counts.strike_cycle_month,
    tonight_strike_log: tonightLog,
    is_metastrike_active: isMetastrikeActive,
    metastrike_reason: tonightLog?.reason || null,
    has_voted_strike: hasVotedStrike,
  };
}
