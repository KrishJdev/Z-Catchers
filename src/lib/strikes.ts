import { DateTime } from 'luxon';
import { supabaseAdmin, isSupabaseConfigured } from './db.ts';
import type { Member, NightlyStrikeLog, StrikeRecordType } from './db.ts';
import { computeMemberState, checkMonthlyStrikeReset, getSleepCycleDate } from './sleepEngine.ts';

/**
 * In-memory fallback cache when PostgreSQL tables/columns have not yet been migrated in Supabase.
 * Ensures zero downtime, complete test compatibility, and transparent operation.
 */
interface InMemoryStrikeStore {
  logs: Map<string, NightlyStrikeLog>; // Key: `${target_member_id}_${sleep_cycle_date}`
  memberCounts: Map<
    string,
    { strikes_used: number; metastrikes_used: number; strikes_count?: number; metastrikes_count?: number; strike_cycle_month: string }
  >;
}

const memoryStore: InMemoryStrikeStore = {
  logs: new Map(),
  memberCounts: new Map(),
};

/**
 * Returns the store key for a nightly strike log
 */
export function getStrikeLogKey(targetMemberId: string, sleepCycleDate: string): string {
  return `${targetMemberId}_${sleepCycleDate}`;
}

/**
 * Resolves effective strikes, metastrikes, and strike cycle month for a member,
 * handling lazy monthly resets.
 */
export async function resolveMemberStrikeCounts(
  member: Member,
  nowUtc = DateTime.utc()
): Promise<{
  strikes_used: number;
  metastrikes_used: number;
  strike_cycle_month: string;
  reset: boolean;
}> {
  // Check in-memory store first (reflects latest updates in tests and serverless cache)
  const fallback = memoryStore.memberCounts.get(member.id);
  let strikes_used =
    typeof fallback?.strikes_used === 'number'
      ? fallback.strikes_used
      : typeof member.strikes_count === 'number'
      ? member.strikes_count
      : typeof member.strikes_used === 'number'
      ? member.strikes_used
      : 0;
  let metastrikes_used =
    typeof fallback?.metastrikes_used === 'number'
      ? fallback.metastrikes_used
      : typeof member.metastrikes_count === 'number'
      ? member.metastrikes_count
      : typeof member.metastrikes_used === 'number'
      ? member.metastrikes_used
      : 0;
  let strike_cycle_month =
    fallback?.strike_cycle_month || member.strike_cycle_month || '2026-01';

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
    strike_cycle_month = activeMember.strike_cycle_month!;

    // Keep memory store and Supabase in sync with aliases (strikes_used/strikes_count)
    await updateMemberStrikeCounts(member.id, 0, 0, strike_cycle_month);
  }

  return {
    strikes_used,
    metastrikes_used,
    strike_cycle_month,
    reset,
  };
}

/**
 * Updates a member's strike counts in Supabase (with resilient fallback).
 */
export async function updateMemberStrikeCounts(
  memberId: string,
  strikesUsed: number,
  metastrikesUsed: number,
  cycleMonth: string
): Promise<void> {
  const clampedStrikes = Math.max(0, Math.min(3, strikesUsed));
  const clampedMetastrikes = Math.max(0, Math.min(3, metastrikesUsed));

  memoryStore.memberCounts.set(memberId, {
    strikes_used: clampedStrikes,
        strikes_count: clampedStrikes,
        metastrikes_used: clampedMetastrikes,
        metastrikes_count: clampedMetastrikes,
    strike_cycle_month: cycleMonth,
  });

  if (isSupabaseConfigured) {
    try {
      const { error } = await supabaseAdmin
        .from('members')
        .update({
          strikes_used: clampedStrikes,
          strikes_count: clampedStrikes,
          metastrikes_used: clampedMetastrikes,
          metastrikes_count: clampedMetastrikes,
          strike_cycle_month: cycleMonth,
          updated_at: DateTime.utc().toISO(),
        })
        .eq('id', memberId);

      if (error && error.code !== '42703') {
        console.warn('Could not update member strike counts in DB:', error.message);
      }
    } catch (e) {
      console.warn('DB update exception:', e);
    }
  }
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

      if (!error && data) {
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
    } catch {
      // Fall back to memory store
    }
  }

  return memoryStore.logs.get(key) || null;
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
  const requestedKeySet = new Set(requests.map((r) => getStrikeLogKey(r.targetMemberId, r.sleepCycleDate)));

  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabaseAdmin
        .from('nightly_strike_logs')
        .select('*')
        .in('target_member_id', targetMemberIds);

      if (!error && Array.isArray(data)) {
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

  // Populate any missing from memory store
  for (const req of requests) {
    const key = getStrikeLogKey(req.targetMemberId, req.sleepCycleDate);
    if (!result.has(key)) {
      const fallback = memoryStore.logs.get(key);
      if (fallback) {
        result.set(key, fallback);
      }
    }
  }

  return result;
}

/**
 * Resolves the most recent strike log for a member eligible for retroactive conversion within 24 hours.
 *
 * @param targetMemberId - ID of member to check
 * @param nowUtc - Current UTC DateTime
 * @returns The most recent strike log within 24 hours, or null
 */
export async function getRecentEligibleStrikeLog(
  targetMemberId: string,
  nowUtc = DateTime.utc()
): Promise<NightlyStrikeLog | null> {
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

      if (!error && data) {
        const createdAt = DateTime.fromISO(data.created_at, { zone: 'utc' });
        if (nowUtc.diff(createdAt, 'hours').hours <= 24) {
          return {
            id: data.id,
            target_member_id: data.target_member_id,
            sleep_cycle_date: data.sleep_cycle_date,
            record_type: data.record_type as StrikeRecordType,
            voter_ids: Array.isArray(data.voter_ids) ? data.voter_ids : [],
            reason: data.reason || null,
            created_at: data.created_at,
            updated_at: data.updated_at,
          };
        }
      }
    } catch {
      // Fall through to memory store
    }
  }

  // Check in-memory store
  let bestCandidate: NightlyStrikeLog | null = null;
  let bestTime = 0;
  for (const log of memoryStore.logs.values()) {
    if (log.target_member_id === targetMemberId && log.record_type === 'strike') {
      const createdAt = DateTime.fromISO(log.created_at, { zone: 'utc' });
      const ageHours = nowUtc.diff(createdAt, 'hours').hours;
      if (ageHours <= 24 && createdAt.toMillis() > bestTime) {
        bestTime = createdAt.toMillis();
        bestCandidate = log;
      }
    }
  }

  return bestCandidate;
}

/**
 * Upserts a nightly strike log in DB (with resilient fallback).
 */
export async function saveNightlyStrikeLog(log: NightlyStrikeLog): Promise<NightlyStrikeLog> {
  const key = getStrikeLogKey(log.target_member_id, log.sleep_cycle_date);
  memoryStore.logs.set(key, log);

  if (isSupabaseConfigured) {
    try {
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

      if (!error && data) {
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
    } catch {
      // In-memory fallback already populated
    }
  }

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
 * COMMUNITY 2-VOTE STRIKE WORKFLOW
 *
 * Rules:
 * 1. Caller cannot be the target member.
 * 2. Target member's local time must be past Bedtime + 5 minutes (status: OVERDUE_NAG_NOW).
 * 3. Locked during 5-minute grace period (status: BEDTIME_GRACE).
 * 4. Locked if target member has activated an excused Metastrike for tonight.
 * 5. Locked if a strike has already been issued tonight.
 * 6. Each voter can only vote once per target per sleep cycle date.
 * 7. When the 2nd unique vote is cast, record_type becomes 'strike' and target member's strikes_used increments by 1.
 */
export async function recordStrikeVote(
  targetMember: Member,
  voterId: string,
  sleepCycleDate?: string,
  nowUtc = DateTime.utc()
): Promise<{
  success: boolean;
  log?: NightlyStrikeLog;
  strikeIssued?: boolean;
  votesCount?: number;
  strikesUsed?: number;
  error?: string;
}> {
  // Rule 1: No self-voting
  if (targetMember.id === voterId) {
    return { success: false, error: 'You cannot vote to strike yourself.' };
  }

  const cycleDate = sleepCycleDate || getSleepCycleDate(targetMember, nowUtc);

  // Check if target member has an IN_BED_EARLY notification logged for this cycle date
  let hasInBedLog = false;
  if (isSupabaseConfigured) {
    try {
      const { data: inBedEntry } = await supabaseAdmin
        .from('notification_logs')
        .select('id')
        .eq('member_id', targetMember.id)
        .eq('notification_type', 'IN_BED_EARLY')
        .eq('local_date', cycleDate)
        .maybeSingle();

      if (inBedEntry) {
        hasInBedLog = true;
      }
    } catch {
      // Non-blocking in case of DB issues
    }
  }

  const isCheckedIn = Boolean(
    targetMember.is_in_bed ||
    hasInBedLog ||
    (targetMember.last_notified_stage === 'IN_BED_EARLY' &&
      targetMember.last_notified_cycle_date === cycleDate)
  );

  // Pass isCheckedIn so computeMemberState sets checkedInEarly = true
  const targetWithInBed: Member = { ...targetMember, is_in_bed: isCheckedIn };
  const state = computeMemberState(targetWithInBed, targetMember.timezone, nowUtc, isCheckedIn);

  // Rule 2: Check in-bed check-in status
  if (isCheckedIn || state.checkedInEarly) {
    return {
      success: false,
      error: `Strike voting is blocked. ${targetMember.discord_username} has already checked into bed for tonight.`,
    };
  }

  // Rule 3: Check grace period and overdue status
  if (state.status === 'BEDTIME_GRACE') {
    return {
      success: false,
      error: `Grace period is active (${state.statusText}). Strike voting is locked for 5 minutes after bedtime.`,
    };
  }

  if (state.status !== 'OVERDUE_NAG_NOW') {
    return {
      success: false,
      error: 'Strike voting is only permitted when a member is overdue past their 5-minute bedtime grace period.',
    };
  }

  // Resolve target member's current monthly counts (with lazy reset)
  const counts = await resolveMemberStrikeCounts(targetMember, nowUtc);

  // Atomic cross-instance vote recording with optimistic concurrency
  if (isSupabaseConfigured) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const existingLog = await getNightlyStrikeLog(targetMember.id, cycleDate);

      if (existingLog) {
        // Rule 4: Metastrike shield active
        if (existingLog.record_type === 'metastrike') {
          return {
            success: false,
            error: `Strike voting is blocked. ${targetMember.discord_username} is protected by an excused Metastrike tonight (${existingLog.reason || 'Excused'}).`,
          };
        }

        // Rule 5: Strike already issued
        if (existingLog.record_type === 'strike') {
          return {
            success: false,
            error: `A strike has already been issued for ${targetMember.discord_username} tonight.`,
          };
        }

        // Rule 6: Pending vote - Check if caller has already voted
        if (existingLog.record_type === 'pending_vote') {
          if (existingLog.voter_ids.includes(voterId)) {
            return {
              success: false,
              error: 'You have already voted to strike this member tonight.',
            };
          }

          const updatedVoterIds = [...existingLog.voter_ids, voterId];
          const strikeIssued = updatedVoterIds.length >= 2;
          const newRecordType: StrikeRecordType = strikeIssued ? 'strike' : 'pending_vote';

          let newStrikesUsed = counts.strikes_used;
          if (strikeIssued) {
            newStrikesUsed = Math.min(3, counts.strikes_used + 1);
          }

          try {
            const { data: updatedData, error: updateErr } = await supabaseAdmin
              .from('nightly_strike_logs')
              .update({
                record_type: newRecordType,
                voter_ids: updatedVoterIds,
                updated_at: nowUtc.toISO(),
              })
              .eq('id', existingLog.id)
              .eq('updated_at', existingLog.updated_at || existingLog.created_at)
              .select('*')
              .maybeSingle();

            if (updateErr) {
              // DB table or schema limitation -> break to in-memory fallback
              break;
            }

            if (!updatedData) {
              // Concurrent write updated this row, retry loop
              continue;
            }

            if (strikeIssued) {
              await updateMemberStrikeCounts(
                targetMember.id,
                newStrikesUsed,
                counts.metastrikes_used,
                counts.strike_cycle_month
              );
            }

            const parsedLog: NightlyStrikeLog = {
              id: updatedData.id,
              target_member_id: updatedData.target_member_id,
              sleep_cycle_date: updatedData.sleep_cycle_date,
              record_type: updatedData.record_type as StrikeRecordType,
              voter_ids: Array.isArray(updatedData.voter_ids) ? updatedData.voter_ids : [],
              reason: updatedData.reason || null,
              created_at: updatedData.created_at,
              updated_at: updatedData.updated_at,
            };
            const key = getStrikeLogKey(targetMember.id, cycleDate);
            memoryStore.logs.set(key, parsedLog);

            return {
              success: true,
              log: parsedLog,
              strikeIssued,
              votesCount: updatedVoterIds.length,
              strikesUsed: newStrikesUsed,
            };
          } catch {
            break;
          }
        }
      } else {
        // First vote for this member tonight: attempt insert
        const newLogPayload = {
          id: crypto.randomUUID(),
          target_member_id: targetMember.id,
          sleep_cycle_date: cycleDate,
          record_type: 'pending_vote',
          voter_ids: [voterId],
          reason: null,
          created_at: nowUtc.toISO(),
          updated_at: nowUtc.toISO(),
        };

        try {
          const { data: insertedData, error: insertErr } = await supabaseAdmin
            .from('nightly_strike_logs')
            .insert(newLogPayload)
            .select('*')
            .maybeSingle();

          if (insertErr) {
            if (insertErr.code === '23505') {
              // Concurrent insert won race, retry loop to add vote to newly created row
              continue;
            }
            break;
          }

          if (insertedData) {
            const parsedLog: NightlyStrikeLog = {
              id: insertedData.id,
              target_member_id: insertedData.target_member_id,
              sleep_cycle_date: insertedData.sleep_cycle_date,
              record_type: 'pending_vote',
              voter_ids: [voterId],
              reason: null,
              created_at: insertedData.created_at,
              updated_at: insertedData.updated_at,
            };
            const key = getStrikeLogKey(targetMember.id, cycleDate);
            memoryStore.logs.set(key, parsedLog);
            return {
              success: true,
              log: parsedLog,
              strikeIssued: false,
              votesCount: 1,
              strikesUsed: counts.strikes_used,
            };
          }
        } catch {
          break;
        }
      }
    }
  }

  // Resilient in-memory fallback (used when Supabase is unreachable or in mock tests)
  const fallbackKey = getStrikeLogKey(targetMember.id, cycleDate);
  const fallbackLog = memoryStore.logs.get(fallbackKey);

  if (fallbackLog) {
    if (fallbackLog.record_type === 'metastrike') {
      return {
        success: false,
        error: `Strike voting is blocked. ${targetMember.discord_username} is protected by an excused Metastrike tonight (${fallbackLog.reason || 'Excused'}).`,
      };
    }
    if (fallbackLog.record_type === 'strike') {
      return {
        success: false,
        error: `A strike has already been issued for ${targetMember.discord_username} tonight.`,
      };
    }
    if (fallbackLog.voter_ids.includes(voterId)) {
      return {
        success: false,
        error: 'You have already voted to strike this member tonight.',
      };
    }

    const updatedVoterIds = [...fallbackLog.voter_ids, voterId];
    const strikeIssued = updatedVoterIds.length >= 2;
    const newRecordType: StrikeRecordType = strikeIssued ? 'strike' : 'pending_vote';
    const newStrikesUsed = strikeIssued
      ? Math.min(3, counts.strikes_used + 1)
      : counts.strikes_used;

    if (strikeIssued) {
      await updateMemberStrikeCounts(
        targetMember.id,
        newStrikesUsed,
        counts.metastrikes_used,
        counts.strike_cycle_month
      );
    }

    const updatedLog: NightlyStrikeLog = {
      ...fallbackLog,
      record_type: newRecordType,
      voter_ids: updatedVoterIds,
      updated_at: nowUtc.toISO(),
    };
    memoryStore.logs.set(fallbackKey, updatedLog);

    return {
      success: true,
      log: updatedLog,
      strikeIssued,
      votesCount: updatedVoterIds.length,
      strikesUsed: newStrikesUsed,
    };
  }

  const newLog: NightlyStrikeLog = {
    id: crypto.randomUUID(),
    target_member_id: targetMember.id,
    sleep_cycle_date: cycleDate,
    record_type: 'pending_vote',
    voter_ids: [voterId],
    reason: null,
    created_at: nowUtc.toISO(),
    updated_at: nowUtc.toISO(),
  };

  const saved = await saveNightlyStrikeLog(newLog);

  return {
    success: true,
    log: saved,
    strikeIssued: false,
    votesCount: 1,
    strikesUsed: counts.strikes_used,
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
      return {
        success: false,
        error:
          'A strike was already issued tonight. Use "Convert to Metastrike" within 24 hours to swap it.',
      };
    }
  }

  const newMetastrikesUsed = counts.metastrikes_used + 1;

  // Atomic conditional update on member row to prevent concurrent limit bypass across instances
  if (isSupabaseConfigured) {
    try {
      const { data: updatedMember, error: memberErr } = await supabaseAdmin
        .from('members')
        .update({
          metastrikes_used: newMetastrikesUsed,
          metastrikes_count: newMetastrikesUsed,
          strike_cycle_month: counts.strike_cycle_month,
          updated_at: nowUtc.toISO(),
        })
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
    const recent = await getRecentEligibleStrikeLog(member.id, nowUtc);
    cycleDate = recent ? recent.sleep_cycle_date : getSleepCycleDate(member, nowUtc);
  }

  const existingLog = await getNightlyStrikeLog(member.id, cycleDate);

  if (!existingLog || existingLog.record_type !== 'strike') {
    return {
      success: false,
      error: 'No active strike was found for tonight to convert.',
    };
  }

  // Verify 24-hour window
  const createdAt = DateTime.fromISO(existingLog.created_at, { zone: 'utc' });
  const hoursSinceStrike = nowUtc.diff(createdAt, 'hours').hours;

  if (hoursSinceStrike > 24 && !isModeratorOverride) {
    return {
      success: false,
      error: 'The 24-hour window to convert this strike to a Metastrike has expired.',
    };
  }

  const newStrikesUsed = Math.max(0, counts.strikes_used - 1);
  const newMetastrikesUsed = Math.min(3, counts.metastrikes_used + 1);

  await updateMemberStrikeCounts(
    member.id,
    newStrikesUsed,
    newMetastrikesUsed,
    counts.strike_cycle_month
  );

  const cleanReason = (reason || '').trim() || 'Retroactive Conversion';

  const updatedLog: NightlyStrikeLog = {
    ...existingLog,
    record_type: 'metastrike',
    reason: cleanReason,
    updated_at: nowUtc.toISO(),
  };

  const saved = await saveNightlyStrikeLog(updatedLog);

  return {
    success: true,
    log: saved,
    strikesUsed: newStrikesUsed,
    metastrikesUsed: newMetastrikesUsed,
  };
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
    const { data: member } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', memberId)
      .single();

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

    if (isSupabaseConfigured) {
      const { data: rawMember } = await supabaseAdmin
        .from('members')
        .select('*')
        .eq('id', memberId)
        .single();

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
      }
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
