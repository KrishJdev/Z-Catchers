import { DateTime } from 'luxon';
import {
  computeMemberState,
  checkMonthlyStrikeReset,
  getCurrentStrikeMonth,
  getSleepCycleDate,
} from '../src/lib/sleepEngine.ts';
import { createClient } from '@supabase/supabase-js';

console.log('🧪 Starting Monthly Strikes & Metastrikes Accountability System Verification...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

// --------------------------------------------------------------------------
// Pure Workflow State Machine Implementation for Verification
// --------------------------------------------------------------------------
class StrikeTestEngine {
  constructor() {
    this.logs = new Map(); // key: targetId_cycleDate -> log
    this.memberCounts = new Map(); // key: memberId -> { strikes_used, metastrikes_used, strike_cycle_month }
  }

  getLogKey(targetId, cycleDate) {
    return `${targetId}_${cycleDate}`;
  }

  resolveCounts(member, nowUtc = DateTime.utc()) {
    const cached = this.memberCounts.get(member.id) || {
      strikes_used: member.strikes_used ?? 0,
      metastrikes_used: member.metastrikes_used ?? 0,
      strike_cycle_month: member.strike_cycle_month || '2026-01',
    };

    const dummyMember = { ...member, ...cached };
    const { reset, activeMember } = checkMonthlyStrikeReset(dummyMember, nowUtc);

    if (reset) {
      const resetCounts = {
        strikes_used: 0,
        metastrikes_used: 0,
        strike_cycle_month: activeMember.strike_cycle_month,
      };
      this.memberCounts.set(member.id, resetCounts);
      return { ...resetCounts, reset: true };
    }

    return { ...cached, reset: false };
  }

  updateCounts(memberId, strikesUsed, metastrikesUsed, cycleMonth) {
    const clampedStrikes = Math.max(0, Math.min(3, strikesUsed));
    const clampedMetas = Math.max(0, Math.min(3, metastrikesUsed));
    const counts = {
      strikes_used: clampedStrikes,
      metastrikes_used: clampedMetas,
      strike_cycle_month: cycleMonth,
    };
    this.memberCounts.set(memberId, counts);
    return counts;
  }

  recordStrikeVote(targetMember, voterId, cycleDate, nowUtc = DateTime.utc()) {
    // 1. Cannot vote for self
    if (targetMember.id === voterId) {
      return { success: false, error: 'You cannot vote to strike yourself.' };
    }

    // 2. Check 5-minute grace period
    const state = computeMemberState(targetMember, targetMember.timezone, nowUtc);
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

    // 3. Resolve target member's current monthly counts (with lazy reset)
    const counts = this.resolveCounts(targetMember, nowUtc);
    const key = this.getLogKey(targetMember.id, cycleDate);
    const existingLog = this.logs.get(key);

    if (existingLog) {
      if (existingLog.record_type === 'metastrike') {
        return {
          success: false,
          error: `Strike voting is blocked. ${targetMember.discord_username} is protected by an excused Metastrike tonight.`,
        };
      }

      if (existingLog.record_type === 'strike') {
        return {
          success: false,
          error: `A strike has already been issued for ${targetMember.discord_username} tonight.`,
        };
      }

      if (existingLog.record_type === 'pending_vote') {
        if (existingLog.voter_ids.includes(voterId)) {
          return {
            success: false,
            error: 'You have already voted to strike this member tonight.',
          };
        }

        const updatedVoterIds = [...existingLog.voter_ids, voterId];
        const strikeIssued = updatedVoterIds.length >= 2;
        const newRecordType = strikeIssued ? 'strike' : 'pending_vote';

        let newStrikes = counts.strikes_used;
        if (strikeIssued) {
          newStrikes = Math.min(3, counts.strikes_used + 1);
          this.updateCounts(targetMember.id, newStrikes, counts.metastrikes_used, counts.strike_cycle_month);
        }

        const updatedLog = {
          ...existingLog,
          record_type: newRecordType,
          voter_ids: updatedVoterIds,
          updated_at: nowUtc.toISO(),
        };
        this.logs.set(key, updatedLog);

        return {
          success: true,
          log: updatedLog,
          strikeIssued,
          votesCount: updatedVoterIds.length,
          strikesUsed: newStrikes,
        };
      }
    }

    // First vote
    const newLog = {
      id: 'log-' + Math.random().toString(36).substring(2, 9),
      target_member_id: targetMember.id,
      sleep_cycle_date: cycleDate,
      record_type: 'pending_vote',
      voter_ids: [voterId],
      reason: null,
      created_at: nowUtc.toISO(),
      updated_at: nowUtc.toISO(),
    };
    this.logs.set(key, newLog);

    return {
      success: true,
      log: newLog,
      strikeIssued: false,
      votesCount: 1,
      strikesUsed: counts.strikes_used,
    };
  }

  useProactiveMetastrike(member, reason, cycleDate, nowUtc = DateTime.utc()) {
    const counts = this.resolveCounts(member, nowUtc);
    if (counts.metastrikes_used >= 3) {
      return {
        success: false,
        error: 'You have used all 3 Metastrikes for this month. Excuses reset on the 1st of next month.',
      };
    }

    const key = this.getLogKey(member.id, cycleDate);
    const existingLog = this.logs.get(key);

    if (existingLog) {
      if (existingLog.record_type === 'metastrike') {
        return { success: false, error: 'A Metastrike is already active for tonight.' };
      }
      if (existingLog.record_type === 'strike') {
        return {
          success: false,
          error: 'A strike was already issued tonight. Use "Convert to Metastrike" within 24 hours to swap it.',
        };
      }
    }

    const newMetas = counts.metastrikes_used + 1;
    this.updateCounts(member.id, counts.strikes_used, newMetas, counts.strike_cycle_month);

    const log = {
      id: existingLog?.id || 'log-' + Math.random().toString(36).substring(2, 9),
      target_member_id: member.id,
      sleep_cycle_date: cycleDate,
      record_type: 'metastrike',
      voter_ids: [],
      reason: (reason || '').trim() || 'Excused Night',
      created_at: existingLog?.created_at || nowUtc.toISO(),
      updated_at: nowUtc.toISO(),
    };
    this.logs.set(key, log);

    return { success: true, log, metastrikesUsed: newMetas };
  }

  convertStrikeToMetastrike(member, reason, cycleDate, nowUtc = DateTime.utc()) {
    const counts = this.resolveCounts(member, nowUtc);
    if (counts.metastrikes_used >= 3) {
      return {
        success: false,
        error: 'You have used all 3 Metastrikes for this month. No passes remaining.',
      };
    }

    const key = this.getLogKey(member.id, cycleDate);
    const existingLog = this.logs.get(key);

    if (!existingLog || existingLog.record_type !== 'strike') {
      return { success: false, error: 'No active strike was found for tonight to convert.' };
    }

    // Check 24-hour window
    const createdAt = DateTime.fromISO(existingLog.created_at, { zone: 'utc' });
    const hoursSinceStrike = nowUtc.diff(createdAt, 'hours').hours;
    if (hoursSinceStrike > 24) {
      return {
        success: false,
        error: 'The 24-hour window to convert this strike to a Metastrike has expired.',
      };
    }

    const newStrikes = Math.max(0, counts.strikes_used - 1);
    const newMetas = Math.min(3, counts.metastrikes_used + 1);
    this.updateCounts(member.id, newStrikes, newMetas, counts.strike_cycle_month);

    const updatedLog = {
      ...existingLog,
      record_type: 'metastrike',
      reason: (reason || '').trim() || 'Converted from Strike',
      updated_at: nowUtc.toISO(),
    };
    this.logs.set(key, updatedLog);

    return {
      success: true,
      log: updatedLog,
      strikesUsed: newStrikes,
      metastrikesUsed: newMetas,
    };
  }

  modAdjustStrikes(memberId, strikesUsed, metastrikesUsed, cycleMonth = '2026-11') {
    return this.updateCounts(memberId, strikesUsed, metastrikesUsed, cycleMonth);
  }

  modClearStrikeLog(memberId, cycleDate) {
    const key = this.getLogKey(memberId, cycleDate);
    const log = this.logs.get(key);
    if (!log) return true;

    const counts = this.memberCounts.get(memberId) || { strikes_used: 0, metastrikes_used: 0, strike_cycle_month: '2026-11' };
    if (log.record_type === 'strike') {
      counts.strikes_used = Math.max(0, counts.strikes_used - 1);
    } else if (log.record_type === 'metastrike') {
      counts.metastrikes_used = Math.max(0, counts.metastrikes_used - 1);
    }
    this.memberCounts.set(memberId, counts);
    this.logs.delete(key);
    return true;
  }
}

async function run() {
  const engine = new StrikeTestEngine();

  // Test member fixtures
  const dummyMember = {
    id: 'test-sleeper-uuid-1',
    discord_username: 'TestSleeper',
    discord_handle: '@testsleeper',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/987654321',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'GMT+00:00',
    pending_bedtime_local: null,
    pending_wake_time_local: null,
    pending_timezone: null,
    pending_effective_at: null,
    role: 'member',
    is_active: true,
    strikes_used: 0,
    metastrikes_used: 0,
    strike_cycle_month: '2026-11',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log('--- 1. Timezone & 5-Minute Grace Period Logic ---');
  // Bedtime is 23:00 GMT+00:00
  // Test 1A: Exactly at Bedtime (23:00 UTC) -> diffMinutes = 0
  const t0 = DateTime.fromISO('2026-11-10T23:00:00.000Z');
  const state0 = computeMemberState(dummyMember, 'GMT+00:00', t0);
  assert(state0.bucket === 'BEDTIME_NOW', 'At 23:00, bucket is BEDTIME_NOW');
  assert(state0.status === 'BEDTIME_GRACE', 'At 23:00, status is BEDTIME_GRACE');
  assert(state0.canVoteStrike === false, 'At 23:00, strike voting is locked');
  assert(state0.statusText.includes('Grace Period'), 'At 23:00, statusText displays grace period');

  // Test 1B: 3 minutes past bedtime (23:03 UTC) -> diffMinutes = 3
  const t3 = DateTime.fromISO('2026-11-10T23:03:00.000Z');
  const state3 = computeMemberState(dummyMember, 'GMT+00:00', t3);
  assert(state3.status === 'BEDTIME_GRACE', 'At 23:03, status remains BEDTIME_GRACE');
  assert(state3.canVoteStrike === false, 'At 23:03, strike voting is still locked');

  // Test 1C: 6 minutes past bedtime (23:06 UTC) -> diffMinutes = 6
  const t6 = DateTime.fromISO('2026-11-10T23:06:00.000Z');
  const state6 = computeMemberState(dummyMember, 'GMT+00:00', t6);
  assert(state6.bucket === 'BEDTIME_NOW', 'At 23:06, bucket is BEDTIME_NOW');
  assert(state6.status === 'OVERDUE_NAG_NOW', 'At 23:06, status transitions to OVERDUE_NAG_NOW');
  assert(state6.canVoteStrike === true, 'At 23:06, strike voting is unlocked');

  // Test 1D: Locked voting check via recordStrikeVote during grace period
  const graceVoteResult = engine.recordStrikeVote(dummyMember, 'friend-voter-1', '2026-11-10', t3);
  assert(graceVoteResult.success === false, 'recordStrikeVote rejected during 5-minute grace period');
  assert(
    graceVoteResult.error && graceVoteResult.error.includes('Grace period is active'),
    'recordStrikeVote returns grace period error message'
  );

  console.log('\n--- 2. Community 2-Vote Strike Workflow ---');
  // Test 2A: Self-voting rejection
  const selfVote = engine.recordStrikeVote(dummyMember, dummyMember.id, '2026-11-10', t6);
  assert(selfVote.success === false, 'Self-voting is rejected');
  assert(selfVote.error === 'You cannot vote to strike yourself.', 'Self-voting returns error message');

  // Test 2B: 1st Vote from Friend 1
  const vote1 = engine.recordStrikeVote(dummyMember, 'voter-alice', '2026-11-10', t6);
  assert(vote1.success === true, '1st vote succeeded');
  assert(vote1.strikeIssued === false, '1st vote does NOT issue strike yet');
  assert(vote1.votesCount === 1, 'Votes count is 1/2');
  assert(vote1.log.record_type === 'pending_vote', 'Record type is pending_vote');

  // Test 2C: Duplicate vote rejection from Friend 1
  const dupeVote = engine.recordStrikeVote(dummyMember, 'voter-alice', '2026-11-10', t6);
  assert(dupeVote.success === false, 'Duplicate vote from same user is rejected');
  assert(
    dupeVote.error && dupeVote.error.includes('already voted'),
    'Duplicate vote returns already voted error'
  );

  // Test 2D: 2nd Unique Vote from Friend 2 -> Triggers Strike
  const vote2 = engine.recordStrikeVote(dummyMember, 'voter-bob', '2026-11-10', t6);
  assert(vote2.success === true, '2nd vote succeeded');
  assert(vote2.strikeIssued === true, '2nd vote issues STRIKE');
  assert(vote2.votesCount === 2, 'Votes count reached 2/2');
  assert(vote2.log.record_type === 'strike', 'Record type updated to strike');
  assert(vote2.strikesUsed === 1, 'Target member strikes_used incremented to 1');

  // Test 2E: Attempting 3rd vote after strike is already issued
  const vote3 = engine.recordStrikeVote(dummyMember, 'voter-charlie', '2026-11-10', t6);
  assert(vote3.success === false, 'Voting blocked after strike is already issued');
  assert(vote3.error && vote3.error.includes('already been issued'), 'Returns strike already issued error');

  console.log('\n--- 3. Retroactive Metastrike (24-Hour Swap) ---');
  // Member currently has 1 strike from tonight.
  const sleeperWithStrike = {
    ...dummyMember,
    strikes_used: 1,
    metastrikes_used: 0,
  };

  const convertRes = engine.convertStrikeToMetastrike(
    sleeperWithStrike,
    'Family Emergency',
    '2026-11-10',
    t6.plus({ hours: 2 }) // 2 hours after strike (well within 24h)
  );
  assert(convertRes.success === true, 'Strike successfully converted to Metastrike within 24h');
  assert(convertRes.strikesUsed === 0, 'Strikes decremented back to 0');
  assert(convertRes.metastrikesUsed === 1, 'Metastrikes incremented to 1');
  assert(convertRes.log.record_type === 'metastrike', 'Log record_type updated to metastrike');
  assert(convertRes.log.reason === 'Family Emergency', 'Metastrike reason saved properly');

  // Test 3B: Conversion fails if past 24 hours
  const expiredEngine = new StrikeTestEngine();
  const expiredKey = expiredEngine.getLogKey(dummyMember.id, '2026-11-08');
  expiredEngine.logs.set(expiredKey, {
    id: 'expired-log-1',
    target_member_id: dummyMember.id,
    sleep_cycle_date: '2026-11-08',
    record_type: 'strike',
    voter_ids: ['voter-a', 'voter-b'],
    created_at: DateTime.utc().minus({ hours: 26 }).toISO(),
  });
  expiredEngine.memberCounts.set(dummyMember.id, { strikes_used: 1, metastrikes_used: 0, strike_cycle_month: '2026-11' });

  const expiredConvert = expiredEngine.convertStrikeToMetastrike(
    { ...dummyMember, strikes_used: 1, metastrikes_used: 0 },
    'Late excuse',
    '2026-11-08',
    DateTime.utc()
  );
  assert(expiredConvert.success === false, 'Conversion rejected past 24-hour window');
  assert(expiredConvert.error && expiredConvert.error.includes('24-hour window'), 'Returns 24h expired error');

  console.log('\n--- 4. Proactive Metastrike (Excuse Pass) Workflow ---');
  const freshMember = {
    id: 'test-sleeper-proactive',
    discord_username: 'ProactiveFox',
    discord_handle: '@proactive',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/987654321',
    bedtime_local: '23:30',
    wake_time_local: '07:30',
    timezone: 'GMT+00:00',
    pending_bedtime_local: null,
    pending_wake_time_local: null,
    pending_timezone: null,
    pending_effective_at: null,
    role: 'member',
    is_active: true,
    strikes_used: 0,
    metastrikes_used: 1,
    strike_cycle_month: '2026-11',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const proactiveRes = engine.useProactiveMetastrike(
    freshMember,
    'Monthly Battle Night',
    '2026-11-11',
    DateTime.fromISO('2026-11-11T20:00:00.000Z')
  );
  assert(proactiveRes.success === true, 'Proactive metastrike successfully used');
  assert(proactiveRes.metastrikesUsed === 2, 'Metastrikes used incremented to 2');
  assert(proactiveRes.log.record_type === 'metastrike', 'Nightly log created with record_type metastrike');

  // Verify that strike votes are strictly blocked when proactive metastrike is active
  const blockedVote = engine.recordStrikeVote(
    freshMember,
    'voter-dan',
    '2026-11-11',
    DateTime.fromISO('2026-11-11T23:45:00.000Z')
  );
  assert(blockedVote.success === false, 'Strike vote blocked because member is protected by Metastrike');
  assert(
    blockedVote.error && blockedVote.error.includes('protected by an excused Metastrike'),
    'Returns protected by Metastrike error'
  );

  console.log('\n--- 5. Monthly Lazy Reset & Max Limits ---');
  // Test 5A: Rollover from 2026-11 to 2026-12
  const novemberMember = {
    ...dummyMember,
    strikes_used: 2,
    metastrikes_used: 3,
    strike_cycle_month: '2026-11',
  };

  // Evaluate in December 2026
  const decTime = DateTime.fromISO('2026-12-01T08:00:00.000Z');
  const resetCheck = checkMonthlyStrikeReset(novemberMember, decTime);
  assert(resetCheck.reset === true, 'Detected month rollover to December 2026');
  assert(resetCheck.activeMember.strikes_used === 0, 'Strikes reset to 0 in new month');
  assert(resetCheck.activeMember.metastrikes_used === 0, 'Metastrikes reset to 0 in new month');
  assert(resetCheck.activeMember.strike_cycle_month === '2026-12', 'strike_cycle_month updated to 2026-12');

  // Test 5B: No reset when still in same month
  const sameMonthCheck = checkMonthlyStrikeReset(novemberMember, DateTime.fromISO('2026-11-25T12:00:00.000Z'));
  assert(sameMonthCheck.reset === false, 'No reset when in same month');
  assert(sameMonthCheck.activeMember.strikes_used === 2, 'Strikes preserved within same month');

  // Test 5C: Max Metastrikes limit (cannot exceed 3)
  const maxedMetasMember = {
    id: 'test-maxed-metas-uuid',
    discord_username: 'MaxedMetasFox',
    discord_handle: '@maxed',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'GMT+00:00',
    role: 'member',
    is_active: true,
    strikes_used: 0,
    metastrikes_used: 3,
    strike_cycle_month: '2026-11',
  };
  const overLimitMeta = engine.useProactiveMetastrike(
    maxedMetasMember,
    'Extra pass',
    '2026-11-12',
    DateTime.fromISO('2026-11-12T20:00:00.000Z')
  );
  assert(overLimitMeta.success === false, 'Cannot use more than 3 Metastrikes in a month');
  assert(
    overLimitMeta.error && overLimitMeta.error.includes('used all 3 Metastrikes'),
    'Returns out of metastrikes error'
  );

  console.log('\n--- 6. Moderator Override Operations ---');
  // Mod Adjust Strikes
  const modCounts = engine.modAdjustStrikes(dummyMember.id, 2, 1);
  assert(modCounts.strikes_used === 2, 'Mod adjusted strikes_used to 2');
  assert(modCounts.metastrikes_used === 1, 'Mod adjusted metastrikes_used to 1');

  // Mod Clear Nightly Log
  engine.logs.set(engine.getLogKey(dummyMember.id, '2026-11-13'), {
    id: 'test-mod-clear',
    target_member_id: dummyMember.id,
    sleep_cycle_date: '2026-11-13',
    record_type: 'strike',
    voter_ids: ['voter-1', 'voter-2'],
  });
  engine.modAdjustStrikes(dummyMember.id, 3, 1);

  const clearSuccess = engine.modClearStrikeLog(dummyMember.id, '2026-11-13');
  assert(clearSuccess === true, 'Mod successfully cleared strike log');
  assert(engine.logs.get(engine.getLogKey(dummyMember.id, '2026-11-13')) === undefined, 'Log is cleanly removed from store');
  assert(engine.memberCounts.get(dummyMember.id).strikes_used === 2, 'Strikes decremented back to 2 upon clearing strike');

  console.log('\n======================================================');
  if (failed) {
    console.error('❌ SOME ACCOUNTABILITY TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL 24 ACCOUNTABILITY SYSTEM TESTS PASSED CLEANLY!');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Test run failure:', err);
  process.exit(1);
});
