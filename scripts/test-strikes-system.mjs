import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';

// Auto-load .env.local if present
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // Ignore missing .env.local
}
import {
  computeMemberState,
  checkMonthlyStrikeReset,
  getCurrentStrikeMonth,
  getSleepCycleDate,
} from '../src/lib/sleepEngine.ts';
import {
  recordStrikeVote,
  convertStrikeToMetastrike,
  useProactiveMetastrike,
  modAdjustStrikes,
  modClearStrikeLog,
  resolveMemberStrikeCounts,
  updateMemberStrikeCounts,
  getNightlyStrikeLog,
  getNightlyStrikeLogsBatch,
  getRecentEligibleStrikeLog,
  getRecentEligibleStrikeLogsBatch,
  saveNightlyStrikeLog,
} from '../src/lib/strikes.ts';
import {
  checkVoteRateLimitPersistent,
  recordVoteAttemptPersistent,
  checkPinRateLimitSync,
} from '../src/lib/rateLimit.ts';

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

async function run() {
  // Test member fixtures
  const dummyMember = {
    id: 'test-sleeper-prod-1',
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
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
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
  const graceVoteResult = await recordStrikeVote(dummyMember, 'friend-voter-1', '2026-11-10', t3);
  assert(graceVoteResult.success === false, 'recordStrikeVote rejected during 5-minute grace period');
  assert(
    graceVoteResult.error && graceVoteResult.error.includes('Grace period is active'),
    'recordStrikeVote returns grace period error message'
  );

  console.log('\n--- 2. Community 2-Vote Strike Workflow ---');
  // Test 2A: Self-voting rejection
  const selfVote = await recordStrikeVote(dummyMember, dummyMember.id, '2026-11-10', t6);
  assert(selfVote.success === false, 'Self-voting is rejected');
  assert(selfVote.error === 'You cannot vote to strike yourself.', 'Self-voting returns error message');

  // Test 2B: In-bed check-in guard
  const checkedInMember = { ...dummyMember, is_in_bed: true };
  const inBedVote = await recordStrikeVote(checkedInMember, 'voter-alice', '2026-11-10', t6);
  assert(inBedVote.success === false, 'Strike voting rejected when member is checked into bed');
  assert(inBedVote.error && inBedVote.error.includes('checked into bed'), 'Returns in-bed protection error');

  // Test 2C: 1st Vote from Friend 1
  const vote1 = await recordStrikeVote(dummyMember, 'voter-alice', '2026-11-10', t6);
  assert(vote1.success === true, '1st vote succeeded');
  assert(vote1.strikeIssued === false, '1st vote does NOT issue strike yet');
  assert(vote1.votesCount === 1, 'Votes count is 1/2');
  assert(vote1.log?.record_type === 'pending_vote', 'Record type is pending_vote');

  // Test 2D: Duplicate vote rejection from Friend 1
  const dupeVote = await recordStrikeVote(dummyMember, 'voter-alice', '2026-11-10', t6);
  assert(dupeVote.success === false, 'Duplicate vote from same user is rejected');
  assert(
    dupeVote.error && dupeVote.error.includes('already voted'),
    'Duplicate vote returns already voted error'
  );

  // Test 2E: 2nd Unique Vote from Friend 2 -> Triggers Strike
  const vote2 = await recordStrikeVote(dummyMember, 'voter-bob', '2026-11-10', t6);
  assert(vote2.success === true, '2nd vote succeeded');
  assert(vote2.strikeIssued === true, '2nd vote issues STRIKE');
  assert(vote2.votesCount === 2, 'Votes count reached 2/2');
  assert(vote2.log?.record_type === 'strike', 'Record type updated to strike');
  assert(vote2.strikesUsed === 1, 'Target member strikes_used incremented to 1');

  // Test 2F: Attempting 3rd vote after strike is already issued
  const vote3 = await recordStrikeVote(dummyMember, 'voter-charlie', '2026-11-10', t6);
  assert(vote3.success === false, 'Voting blocked after strike is already issued');
  assert(vote3.error && vote3.error.includes('already been issued'), 'Returns strike already issued error');

  console.log('\n--- 3. Retroactive Metastrike (24-Hour Swap) ---');
  // Member currently has 1 strike from tonight
  const sleeperWithStrike = {
    ...dummyMember,
    strikes_used: 1,
    strikes_count: 1,
    metastrikes_used: 0,
    metastrikes_count: 0,
  };

  const convertRes = await convertStrikeToMetastrike(
    sleeperWithStrike,
    'Family Emergency',
    '2026-11-10',
    t6.plus({ hours: 2 }) // 2 hours after strike (well within 24h)
  );
  assert(convertRes.success === true, 'Strike successfully converted to Metastrike within 24h');
  assert(convertRes.strikesUsed === 0, 'Strikes decremented back to 0');
  assert(convertRes.metastrikesUsed === 1, 'Metastrikes incremented to 1');
  assert(convertRes.log?.record_type === 'metastrike', 'Log record_type updated to metastrike');
  assert(convertRes.log?.reason === 'Family Emergency', 'Metastrike reason saved properly');

  // Test 3B: Conversion fails if past 24 hours
  const expiredMember = {
    id: 'test-sleeper-expired',
    discord_username: 'ExpiredFox',
    discord_handle: '@expired',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'GMT+00:00',
    role: 'member',
    is_active: true,
    strikes_used: 1,
    metastrikes_used: 0,
    strike_cycle_month: '2026-11',
  };

  await saveNightlyStrikeLog({
    id: 'expired-log-1',
    target_member_id: expiredMember.id,
    sleep_cycle_date: '2026-11-08',
    record_type: 'strike',
    voter_ids: ['voter-a', 'voter-b'],
    created_at: DateTime.utc().minus({ hours: 26 }).toISO(),
    updated_at: DateTime.utc().minus({ hours: 26 }).toISO(),
  });
  await updateMemberStrikeCounts(expiredMember.id, 1, 0, '2026-11');

  const expiredConvert = await convertStrikeToMetastrike(
    expiredMember,
    'Late excuse',
    '2026-11-08',
    DateTime.utc()
  );
  assert(expiredConvert.success === false, 'Conversion rejected past 24-hour window');
  assert(expiredConvert.error && expiredConvert.error.includes('24-hour window'), 'Returns 24h expired error');

  // Test 3C: Conversion across cycle change without explicit sleep_cycle_date (resolves via getRecentEligibleStrikeLog)
  const rolloverMember = {
    id: 'test-sleeper-rollover',
    discord_username: 'RolloverFox',
    discord_handle: '@rollover',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'UTC',
    role: 'member',
    is_active: true,
    strikes_used: 1,
    strikes_count: 1,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: '2026-11',
  };

  const strikeTime = DateTime.fromISO('2026-11-10T23:15:00.000Z', { zone: 'utc' });
  await saveNightlyStrikeLog({
    id: 'rollover-log-1',
    target_member_id: rolloverMember.id,
    sleep_cycle_date: '2026-11-10',
    record_type: 'strike',
    voter_ids: ['voter-a', 'voter-b'],
    created_at: strikeTime.toISO(),
    updated_at: strikeTime.toISO(),
  });
  await updateMemberStrikeCounts(rolloverMember.id, 1, 0, '2026-11');

  // Next afternoon: 14:00 UTC next day (14h 45m after strike, well within 24h, but cycle date has rolled over to 2026-11-11)
  const nextDayTime = DateTime.fromISO('2026-11-11T14:00:00.000Z', { zone: 'utc' });
  const rolloverConvert = await convertStrikeToMetastrike(
    rolloverMember,
    'Next afternoon conversion',
    undefined, // No explicit sleepCycleDate provided
    nextDayTime
  );
  assert(rolloverConvert.success === true, 'Conversion resolves recent strike across cycle change');
  assert(rolloverConvert.log?.sleep_cycle_date === '2026-11-10', 'Correctly targeted previous cycle date of strike');
  assert(rolloverConvert.strikesUsed === 0, 'Strikes decremented to 0');
  assert(rolloverConvert.metastrikesUsed === 1, 'Metastrikes incremented to 1');

  const postConversionEligible = await getRecentEligibleStrikeLog(rolloverMember.id, nextDayTime);
  assert(postConversionEligible === null, 'No eligible strikes remain after conversion');

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
    strikes_count: 0,
    metastrikes_used: 1,
    metastrikes_count: 1,
    strike_cycle_month: '2026-11',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const proactiveRes = await useProactiveMetastrike(
    freshMember,
    'Monthly Battle Night',
    '2026-11-11',
    DateTime.fromISO('2026-11-11T20:00:00.000Z')
  );
  assert(proactiveRes.success === true, 'Proactive metastrike successfully used');
  assert(proactiveRes.metastrikesUsed === 2, 'Metastrikes used incremented to 2');
  assert(proactiveRes.log?.record_type === 'metastrike', 'Nightly log created with record_type metastrike');

  // Verify that strike votes are strictly blocked when proactive metastrike is active
  const blockedVote = await recordStrikeVote(
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
    id: 'test-nov-member',
    strikes_used: 2,
    strikes_count: 2,
    metastrikes_used: 3,
    metastrikes_count: 3,
    strike_cycle_month: '2026-11',
  };

  // Evaluate in December 2026 using resolveMemberStrikeCounts
  const decTime = DateTime.fromISO('2026-12-01T08:00:00.000Z');
  const resetCheck = await resolveMemberStrikeCounts(novemberMember, decTime);
  assert(resetCheck.reset === true, 'Detected month rollover to December 2026');
  assert(resetCheck.strikes_used === 0, 'Strikes reset to 0 in new month');
  assert(resetCheck.metastrikes_used === 0, 'Metastrikes reset to 0 in new month');
  assert(resetCheck.strike_cycle_month === '2026-12', 'strike_cycle_month updated to 2026-12');

  // Test 5B: No reset when still in same month
  const sameMonthMember = {
    ...dummyMember,
    id: 'test-same-month-member',
    strikes_used: 2,
    strikes_count: 2,
    metastrikes_used: 1,
    metastrikes_count: 1,
    strike_cycle_month: '2026-11',
  };
  const sameMonthCheck = await resolveMemberStrikeCounts(
    sameMonthMember,
    DateTime.fromISO('2026-11-25T12:00:00.000Z')
  );
  assert(sameMonthCheck.reset === false, 'No reset when in same month');
  assert(sameMonthCheck.strikes_used === 2, 'Strikes preserved within same month');

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
    strikes_count: 0,
    metastrikes_used: 3,
    metastrikes_count: 3,
    strike_cycle_month: '2026-11',
  };
  await updateMemberStrikeCounts(maxedMetasMember.id, 0, 3, '2026-11');

  const overLimitMeta = await useProactiveMetastrike(
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
  const modCountsRes = await modAdjustStrikes(dummyMember.id, 2, 1);
  assert(modCountsRes.success === true, 'Mod adjusted strikes_used successfully');
  const modCounts = await resolveMemberStrikeCounts(dummyMember);
  assert(modCounts.strikes_used === 2, 'Mod adjusted strikes_used to 2');
  assert(modCounts.metastrikes_used === 1, 'Mod adjusted metastrikes_used to 1');

  // Mod Clear Nightly Log
  await saveNightlyStrikeLog({
    id: 'test-mod-clear',
    target_member_id: dummyMember.id,
    sleep_cycle_date: '2026-11-13',
    record_type: 'strike',
    voter_ids: ['voter-1', 'voter-2'],
    created_at: DateTime.utc().toISO(),
    updated_at: DateTime.utc().toISO(),
  });
  await modAdjustStrikes(dummyMember.id, 3, 1);

  const clearSuccess = await modClearStrikeLog(dummyMember.id, '2026-11-13');
  assert(clearSuccess.success === true, 'Mod successfully cleared strike log');
  const clearedLog = await getNightlyStrikeLog(dummyMember.id, '2026-11-13');
  assert(clearedLog === null, 'Log is cleanly removed from store');
  const postClearCounts = await resolveMemberStrikeCounts(dummyMember);
  assert(postClearCounts.strikes_used === 2, 'Strikes decremented back to 2 upon clearing strike');

  console.log('\n--- 7. Batched Queries, Voter Rate Limiting & Precedence ---');
  // 7A: Batched Nightly Strike Logs Retrieval
  const batchRequests = [
    { targetMemberId: dummyMember.id, sleepCycleDate: '2026-11-10' },
    { targetMemberId: 'non-existent-member', sleepCycleDate: '2026-11-10' },
  ];
  const batchLogs = await getNightlyStrikeLogsBatch(batchRequests);
  assert(batchLogs instanceof Map, 'getNightlyStrikeLogsBatch returns a Map');
  assert(batchLogs.has(`${dummyMember.id}_2026-11-10`), 'Contains requested member strike log');
  assert(!batchLogs.has('non-existent-member_2026-11-10'), 'Does not contain missing member');

  // 7B: Batched Recent Eligible Strikes Retrieval (<24h)
  const now = DateTime.utc();
  await saveNightlyStrikeLog({
    id: 'batch-recent-1',
    target_member_id: 'batch-sleeper-1',
    sleep_cycle_date: '2026-11-11',
    record_type: 'strike',
    voter_ids: ['voter-x', 'voter-y'],
    created_at: now.minus({ hours: 2 }).toISO(),
    updated_at: now.minus({ hours: 2 }).toISO(),
  });
  await saveNightlyStrikeLog({
    id: 'batch-recent-2',
    target_member_id: 'batch-sleeper-2',
    sleep_cycle_date: '2026-11-09',
    record_type: 'strike',
    voter_ids: ['voter-x', 'voter-y'],
    created_at: now.minus({ hours: 26 }).toISO(), // Expired (>24h)
    updated_at: now.minus({ hours: 26 }).toISO(),
  });

  const recentBatch = await getRecentEligibleStrikeLogsBatch(['batch-sleeper-1', 'batch-sleeper-2'], now);
  assert(recentBatch.has('batch-sleeper-1'), 'Batched recent strikes includes strike within 24h');
  assert(recentBatch.get('batch-sleeper-1')?.id === 'batch-recent-1', 'Resolves correct strike log ID');
  assert(!recentBatch.has('batch-sleeper-2'), 'Batched recent strikes excludes strike older than 24h');

  // 7C: Voter-scoped persistent rate limiting isolation
  const voterKey = 'voter-isolated-test-1';
  const initialVoterCheck = await checkVoteRateLimitPersistent(voterKey, 3, 60000);
  assert(initialVoterCheck.allowed === true, 'Initial voter rate limit check is allowed');

  await recordVoteAttemptPersistent(voterKey, 60000);
  await recordVoteAttemptPersistent(voterKey, 60000);
  await recordVoteAttemptPersistent(voterKey, 60000);

  const blockedVoterCheck = await checkVoteRateLimitPersistent(voterKey, 3, 60000);
  assert(blockedVoterCheck.allowed === false, 'Voter blocked after exceeding max attempts');
  assert(blockedVoterCheck.retryAfterSeconds > 0, 'Returns retryAfterSeconds');

  // Confirm PIN rate limiting is NOT affected by voter counter
  const pinCheck = checkPinRateLimitSync('127.0.0.1', voterKey);
  assert(pinCheck.allowed === true, 'PIN rate limit remains allowed and unaffected by voter rate limit');

  // 7D: Batched Recent Eligible Strikes Database-Backed Integration Test
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isSupabaseLive = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder') && !supabaseKey.includes('placeholder'));

  if (isSupabaseLive) {
    console.log('\n--- 7D: Database-Backed Batched Recent Eligible Strikes Integration Test ---');
    const { createClient } = await import('@supabase/supabase-js');
    const dbAdmin = createClient(supabaseUrl, supabaseKey);
    const testNow = DateTime.utc();

    let dbMember1Id = null;
    let dbMember2Id = null;

    try {
      const u1 = `DbTest1_${Date.now()}`;
      const u2 = `DbTest2_${Date.now()}`;

      const { data: m1, error: m1Err } = await dbAdmin
        .from('members')
        .insert({
          discord_username: u1,
          discord_handle: `@${u1.toLowerCase()}`,
          journal_url: 'https://discord.com/channels/123456789/987654321',
          bedtime_local: '23:00',
          wake_time_local: '07:00',
          timezone: 'GMT+00:00',
          role: 'member',
          is_active: true,
        })
        .select()
        .single();
      assert(!m1Err && m1?.id, 'Seeded valid DB member 1 with UUID');
      if (m1?.id) dbMember1Id = m1.id;

      const { data: m2, error: m2Err } = await dbAdmin
        .from('members')
        .insert({
          discord_username: u2,
          discord_handle: `@${u2.toLowerCase()}`,
          journal_url: 'https://discord.com/channels/123456789/987654322',
          bedtime_local: '23:00',
          wake_time_local: '07:00',
          timezone: 'GMT+00:00',
          role: 'member',
          is_active: true,
        })
        .select()
        .single();
      assert(!m2Err && m2?.id, 'Seeded valid DB member 2 with UUID');
      if (m2?.id) dbMember2Id = m2.id;

      if (dbMember1Id && dbMember2Id) {
        // Strike within 24h for member 1
        const { data: log1, error: log1Err } = await dbAdmin
          .from('nightly_strike_logs')
          .insert({
            target_member_id: dbMember1Id,
            sleep_cycle_date: '2026-11-11',
            record_type: 'strike',
            voter_ids: ['voter-db-1'],
            created_at: testNow.minus({ hours: 2 }).toISO(),
            updated_at: testNow.minus({ hours: 2 }).toISO(),
          })
          .select()
          .single();

        if (log1Err && (log1Err.code === 'PGRST205' || log1Err.code === '42P01')) {
          console.log(
            'ℹ️ Table nightly_strike_logs is pending migration in remote Supabase schema cache; skipping live DB strike row assertions.'
          );
        } else {
          assert(!log1Err && log1?.id, 'Seeded valid DB strike log fixture within 24h');

          // Expired strike (>24h) for member 2
          const { data: log2, error: log2Err } = await dbAdmin
            .from('nightly_strike_logs')
            .insert({
              target_member_id: dbMember2Id,
              sleep_cycle_date: '2026-11-09',
              record_type: 'strike',
              voter_ids: ['voter-db-2'],
              created_at: testNow.minus({ hours: 26 }).toISO(),
              updated_at: testNow.minus({ hours: 26 }).toISO(),
            })
            .select()
            .single();
          assert(!log2Err && log2?.id, 'Seeded valid DB expired strike log fixture (>24h)');

          const dbBatchResults = await getRecentEligibleStrikeLogsBatch([dbMember1Id, dbMember2Id], testNow);
          assert(dbBatchResults instanceof Map, 'DB batch query returns Map');
          assert(dbBatchResults.has(dbMember1Id), 'DB batch includes strike within 24h');
          assert(dbBatchResults.get(dbMember1Id)?.id === log1?.id, 'DB batch resolves correct strike log ID from database');
          assert(!dbBatchResults.has(dbMember2Id), 'DB batch excludes strike older than 24h');
        }
      }
    } finally {
      // Clean up all seeded fixtures in database
      const idsToDelete = [dbMember1Id, dbMember2Id].filter(Boolean);
      if (idsToDelete.length > 0) {
        await dbAdmin.from('nightly_strike_logs').delete().in('target_member_id', idsToDelete);
        await dbAdmin.from('members').delete().in('id', idsToDelete);
        console.log('🧹 Cleaned up all seeded database integration test fixtures');
      }
    }
  } else {
    console.log('\n--- 7D: DB-Backed Batched Recent Eligible Strikes Test Skipped (Supabase credentials not in env) ---');
  }

  console.log('\n======================================================');
  if (failed) {
    console.error('❌ SOME ACCOUNTABILITY TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL ACCOUNTABILITY SYSTEM TESTS PASSED CLEANLY!');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Test run failure:', err);
  process.exit(1);
});
