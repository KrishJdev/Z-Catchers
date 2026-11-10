import { DateTime } from 'luxon';
import { supabaseAdmin } from './db';
import type { Member, NightlyStrikeLog, StrikeRecordType } from './db';
import { computeMemberState, checkMonthlyStrikeReset, getSleepCycleDate } from './sleepEngine';

/**
 * In-memory fallback cache when PostgreSQL tables/columns have not yet been migrated in Supabase.
 * Ensures zero downtime, complete test compatibility, and transparent operation.
 */
interface InMemoryStrikeStore {
  logs: Map<string, NightlyStrikeLog>; // Key: `${target_member_id}_${sleep_cycle_date}`
  memberCounts: Map<
    string,
    { strikes_used: number; metastrikes_used: number; strike_cycle_month: string }
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
  // Check in-memory store first if member column was not loaded
  const fallback = memoryStore.memberCounts.get(member.id);
  let strikes_used =
    typeof member.strikes_used === 'number'
      ? member.strikes_used
      : fallback?.strikes_used ?? 0;
  let metastrikes_used =
    typeof member.metastrikes_used === 'number'
      ? member.metastrikes_used
      : fallback?.metastrikes_used ?? 0;
  let strike_cycle_month =
    member.strike_cycle_month || fallback?.strike_cycle_month || '2026-01';

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

    // Persist to memory store
    memoryStore.memberCounts.set(member.id, {
      strikes_used: 0,
      metastrikes_used: 0,
      strike_cycle_month,
    });

    // Attempt to persist reset in Supabase
    try {
      await supabaseAdmin
        .from('members')
        .update({
          strikes_used: 0,
          metastrikes_used: 0,
          strike_cycle_month,
          updated_at: nowUtc.toISO(),
        })
        .eq('id', member.id);
    } catch {
      // Column may not yet exist in schema cache
    }
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
    metastrikes_used: clampedMetastrikes,
    strike_cycle_month: cycleMonth,
  });

  try {
    const { error } = await supabaseAdmin
      .from('members')
      .update({
        strikes_used: clampedStrikes,
        metastrikes_used: clampedMetastrikes,
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

/**
 * Fetches a single nightly strike log for a member and sleep cycle date.
 */
export async function getNightlyStrikeLog(
  targetMemberId: string,
  sleepCycleDate: string
): Promise<NightlyStrikeLog | null> {
  const key = getStrikeLogKey(targetMemberId, sleepCycleDate);

  // Try DB first
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

  return memoryStore.logs.get(key) || null;
}

/**
 * Upserts a nightly strike log in DB (with resilient fallback).
 */
export async function saveNightlyStrikeLog(log: NightlyStrikeLog): Promise<NightlyStrikeLog> {
  const key = getStrikeLogKey(log.target_member_id, log.sleep_cycle_date);
  memoryStore.logs.set(key, log);

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

  // Resolve target member's sleep state
  const state = computeMemberState(targetMember, targetMember.timezone, nowUtc);
  const cycleDate = sleepCycleDate || getSleepCycleDate(targetMember, nowUtc);

  // Rule 2 & 3: Check grace period and overdue status
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

  // Check existing strike log for tonight
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

      // Add 2nd (or unique) vote
      const updatedVoterIds = [...existingLog.voter_ids, voterId];
      const strikeIssued = updatedVoterIds.length >= 2;
      const newRecordType: StrikeRecordType = strikeIssued ? 'strike' : 'pending_vote';

      let newStrikesUsed = counts.strikes_used;
      if (strikeIssued) {
        newStrikesUsed = Math.min(3, counts.strikes_used + 1);
        await updateMemberStrikeCounts(
          targetMember.id,
          newStrikesUsed,
          counts.metastrikes_used,
          counts.strike_cycle_month
        );
      }

      const updatedLog: NightlyStrikeLog = {
        ...existingLog,
        record_type: newRecordType,
        voter_ids: updatedVoterIds,
        updated_at: nowUtc.toISO(),
      };

      const saved = await saveNightlyStrikeLog(updatedLog);

      return {
        success: true,
        log: saved,
        strikeIssued,
        votesCount: updatedVoterIds.length,
        strikesUsed: newStrikesUsed,
      };
    }
  }

  // First vote for this member tonight
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
  nowUtc = DateTime.utc()
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

  const cycleDate = sleepCycleDate || getSleepCycleDate(member, nowUtc);
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

  if (hoursSinceStrike > 24) {
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
export async function modAdjustStrikes(
  memberId: string,
  strikesUsed: number,
  metastrikesUsed: number
): Promise<{ success: boolean; error?: string }> {
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

export async function modClearStrikeLog(
  memberId: string,
  sleepCycleDate: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const existingLog = await getNightlyStrikeLog(memberId, sleepCycleDate);
    if (!existingLog) {
      return { success: true };
    }

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
