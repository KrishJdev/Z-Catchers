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
  getNextScheduledBedtime,
} from '../src/lib/sleepEngine.ts';
import {
  convertStrikeToMetastrike,
  useProactiveMetastrike,
  issueAutomaticBedtimeStrike,
  modAdjustPasses,
  modClearMetastrikeLog,
  resolveMemberStrikeCounts,
  updateMemberStrikeCounts,
  getNightlyStrikeLog,
  getNightlyStrikeLogsBatch,
  getRecentEligibleStrikeLog,
  getRecentEligibleStrikeLogsBatch,
  saveNightlyStrikeLog,
} from '../src/lib/strikes.ts';

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
  assert(state0.statusText.includes('Grace Period'), 'At 23:00, statusText displays grace period');

  // Test 1B: 3 minutes past bedtime (23:03 UTC) -> diffMinutes = 3
  const t3 = DateTime.fromISO('2026-11-10T23:03:00.000Z');
  const state3 = computeMemberState(dummyMember, 'GMT+00:00', t3);
  assert(state3.status === 'BEDTIME_GRACE', 'At 23:03, status remains BEDTIME_GRACE');

  // Test 1C: 6 minutes past bedtime (23:06 UTC) -> diffMinutes = 6
  const t6 = DateTime.fromISO('2026-11-10T23:06:00.000Z');
  const state6 = computeMemberState(dummyMember, 'GMT+00:00', t6);
  assert(state6.bucket === 'BEDTIME_NOW', 'At 23:06, bucket is BEDTIME_NOW');
  assert(state6.status === 'OVERDUE_NAG_NOW', 'At 23:06, status transitions to OVERDUE_NAG_NOW');

  console.log('\n--- 2. Automated 10-Minute Bedtime Strike Engine ---');
  // Test 2A: Member is 9 minutes past bedtime without checking in -> 0 strikes issued
  const t9 = DateTime.fromISO('2026-11-10T23:09:00.000Z');
  const state9 = computeMemberState(dummyMember, 'GMT+00:00', t9);
  assert(state9.diffMinutes === 9, 'At 23:09, diffMinutes is 9 (< 10m cutoff)');
  assert(state9.diffMinutes < 10, '9 minutes past bedtime is strictly before 10-minute auto-strike cutoff');

  // Test 2B: Member is 10+ minutes past bedtime without checking in -> 1 normal strike automatically issued
  const t10 = DateTime.fromISO('2026-11-10T23:10:00.000Z');
  const state10 = computeMemberState(dummyMember, 'GMT+00:00', t10);
  assert(state10.diffMinutes >= 10, 'At 23:10, diffMinutes is 10 (>= 10m cutoff)');
  const autoStrike1 = await issueAutomaticBedtimeStrike(dummyMember, '2026-11-10', t10);
  assert(autoStrike1.success === true, 'Automatic strike issued at +10 minutes past bedtime');
  assert(autoStrike1.strikeIssued === true, 'strikeIssued is true');
  assert(autoStrike1.strikesUsed === 1, 'Member strikes_used incremented to 1');
  assert(autoStrike1.log?.record_type === 'strike', 'Nightly strike log created with record_type strike');

  // Test 2C: Subsequent cron runs in the same cycle issue 0 additional strikes (Idempotency)
  const t15 = DateTime.fromISO('2026-11-10T23:15:00.000Z');
  const autoStrikeDupe = await issueAutomaticBedtimeStrike(dummyMember, '2026-11-10', t15);
  assert(autoStrikeDupe.strikeIssued === false, 'Duplicate automatic strike in same sleep cycle yields 0 new strikes');
  assert(autoStrikeDupe.reason === 'already_issued', 'Reason indicates strike already issued');
  assert(autoStrikeDupe.strikesUsed === 1, 'strikes_used remains 1');

  // Test 2D: Member who checked into bed -> 0 strikes issued
  const checkedInMember = { ...dummyMember, id: 'test-checked-in-sleeper', is_in_bed: true };
  const inBedStrike = await issueAutomaticBedtimeStrike(checkedInMember, '2026-11-10', t10);
  assert(inBedStrike.strikeIssued === false, 'Automatic strike strictly prevented when member is in bed');
  assert(inBedStrike.reason === 'already_checked_in', 'Reason indicates member checked into bed');

  // Test 2F: Member with three strikes can receive a fourth
  const maxStrikesMember = {
    ...dummyMember,
    id: 'test-max-strikes-sleeper',
    strikes_used: 3,
    strikes_count: 3,
  };
  const maxStrikeRes = await issueAutomaticBedtimeStrike(maxStrikesMember, '2026-11-10', t10);
  assert(maxStrikeRes.strikeIssued === true, 'Member with three strikes receives another strike');
  assert(maxStrikeRes.strikesUsed === 4, 'Monthly count advances to four');

  // Test 2G: Next scheduled bedtime evaluation across midnight boundaries
  const midnightMember = {
    ...dummyMember,
    id: 'test-midnight-sleeper',
    bedtime_local: '01:00',
    wake_time_local: '09:00',
    timezone: 'UTC',
  };
  // At 00:30 UTC, next bedtime is 01:00 UTC today (derived from yesterday evening cycle offset -1)
  const at0030 = DateTime.fromISO('2026-11-11T00:30:00.000Z');
  const nextBedtime = getNextScheduledBedtime(midnightMember, at0030);
  assert(nextBedtime.toFormat('yyyy-MM-dd HH:mm') === '2026-11-11 01:00', 'Next bedtime at 00:30 is 01:00 today, not tomorrow');

  console.log('\n--- 3. Pre-Next-Bedtime Metastrike Replacement Workflow ---');
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
    t10.plus({ hours: 2 }) // 2 hours after strike (well before next bedtime)
  );
  assert(convertRes.success === true, 'Strike successfully replaced with Metastrike before next bedtime');
  assert(convertRes.strikesUsed === 0, 'Strikes decremented back to 0');
  assert(convertRes.metastrikesUsed === 1, 'Metastrikes incremented to 1');
  assert(convertRes.log?.record_type === 'metastrike', 'Log record_type updated to metastrike');
  assert(convertRes.log?.reason === 'Family Emergency', 'Metastrike reason saved properly');

  // Test 3B: Next afternoon before next scheduled bedtime (e.g. 14:00 UTC next day, next bedtime 23:00)
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
    voter_ids: [],
    created_at: strikeTime.toISO(),
    updated_at: strikeTime.toISO(),
  });
  await updateMemberStrikeCounts(rolloverMember.id, 1, 0, '2026-11');

  // Next afternoon: 14:00 UTC next day (currentLocalTime < nextScheduledBedtime)
  const nextDayTime = DateTime.fromISO('2026-11-11T14:00:00.000Z', { zone: 'utc' });
  const rolloverConvert = await convertStrikeToMetastrike(
    rolloverMember,
    'Next afternoon conversion',
    undefined, // No explicit sleepCycleDate provided
    nextDayTime
  );
  assert(rolloverConvert.success === true, 'Conversion resolves recent strike across cycle change before next bedtime');
  assert(rolloverConvert.log?.sleep_cycle_date === '2026-11-10', 'Correctly targeted previous cycle date of strike');
  assert(rolloverConvert.strikesUsed === 0, 'Strikes decremented to 0');
  assert(rolloverConvert.metastrikesUsed === 1, 'Metastrikes incremented to 1');

  const postConversionEligible = await getRecentEligibleStrikeLog(rolloverMember.id, nextDayTime, rolloverMember);
  assert(postConversionEligible === null, 'No eligible strikes remain after conversion');

  // Test 3C: Conversion fails if past next scheduled bedtime
  const expiredMember = {
    id: 'test-sleeper-expired',
    discord_username: 'ExpiredFox',
    discord_handle: '@expired',
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

  // Strike from 2026-11-08 (bedtime was 2026-11-08 23:00)
  await saveNightlyStrikeLog({
    id: 'expired-log-1',
    target_member_id: expiredMember.id,
    sleep_cycle_date: '2026-11-08',
    record_type: 'strike',
    voter_ids: [],
    created_at: DateTime.fromISO('2026-11-08T23:15:00.000Z', { zone: 'utc' }).toISO(),
    updated_at: DateTime.fromISO('2026-11-08T23:15:00.000Z', { zone: 'utc' }).toISO(),
  });
  await updateMemberStrikeCounts(expiredMember.id, 1, 0, '2026-11');

  // Evaluating on 2026-11-09 at 23:30 UTC (next scheduled bedtime was 23:00 on Nov 9, which has already arrived)
  const pastNextBedtime = DateTime.fromISO('2026-11-09T23:30:00.000Z', { zone: 'utc' });
  const expiredConvert = await convertStrikeToMetastrike(
    expiredMember,
    'Late excuse',
    '2026-11-08',
    pastNextBedtime
  );
  assert(expiredConvert.success === false, 'Conversion rejected past next scheduled bedtime');
  assert(
    expiredConvert.error && expiredConvert.error.includes('next scheduled bedtime'),
    'Returns next scheduled bedtime expired error'
  );

  // Test 3D: Submitting via useProactiveMetastrike after +10m auto strike automatically converts/replaces the strike
  const autoSwapMember = {
    id: 'test-sleeper-autoswap',
    discord_username: 'AutoSwapFox',
    discord_handle: '@autoswap',
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
  await saveNightlyStrikeLog({
    id: 'autoswap-strike-log',
    target_member_id: autoSwapMember.id,
    sleep_cycle_date: '2026-11-10',
    record_type: 'strike',
    voter_ids: [],
    created_at: t10.toISO(),
    updated_at: t10.toISO(),
  });
  await updateMemberStrikeCounts(autoSwapMember.id, 1, 0, '2026-11');

  const autoSwapRes = await useProactiveMetastrike(
    autoSwapMember,
    'Modal excuse after bedtime strike',
    '2026-11-10',
    t10.plus({ hours: 1 })
  );
  assert(autoSwapRes.success === true, 'useProactiveMetastrike automatically replaces existing strike');
  assert(autoSwapRes.strikesUsed === 0, 'Strikes decremented to 0');
  assert(autoSwapRes.metastrikesUsed === 1, 'Metastrikes incremented to 1');
  assert(autoSwapRes.log?.record_type === 'metastrike', 'Record type updated to metastrike');

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

  // Verify that automatic bedtime strikes are strictly blocked when proactive metastrike is active
  const autoStrikeBlocked = await issueAutomaticBedtimeStrike(
    freshMember,
    '2026-11-11',
    DateTime.fromISO('2026-11-11T23:45:00.000Z')
  );
  assert(autoStrikeBlocked.strikeIssued === false, '0 normal strikes issued when proactive metastrike is active');
  assert(autoStrikeBlocked.reason === 'metastrike_active', 'Reason indicates member is protected by active Metastrike');

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
  const passReviewMember = { ...dummyMember, id: 'test-pass-review' };
  const owner = { id: 'test-mod', discordId: '1234', role: 'owner' };
  await updateMemberStrikeCounts(passReviewMember.id, 2, 0, '2026-11');
  const modCountsRes = await modAdjustPasses(passReviewMember.id, 1, false, owner);
  assert(modCountsRes.success === true, 'Mod adjusted metastrikes_used successfully');
  const modCounts = await resolveMemberStrikeCounts(passReviewMember);
  assert(modCounts.strikes_used === 2, 'Pass adjustment preserves the existing strike total');
  assert(modCounts.metastrikes_used === 1, 'Mod adjusted metastrikes_used to 1');

  const log = {
    id: 'test-mod-clear',
    target_member_id: passReviewMember.id,
    sleep_cycle_date: '2026-11-13',
    record_type: 'strike',
    voter_ids: ['voter-1', 'voter-2'],
    created_at: DateTime.utc().toISO(),
    updated_at: DateTime.utc().toISO(),
  };
  await saveNightlyStrikeLog(log);
  const rejectStrike = await modClearMetastrikeLog(passReviewMember.id, log.sleep_cycle_date, owner);
  assert(rejectStrike.status === 409, 'Pass reversal rejects a regular strike');
  assert((await getNightlyStrikeLog(passReviewMember.id, log.sleep_cycle_date)).record_type === 'strike',
    'Rejected regular strike remains in the store');
  await saveNightlyStrikeLog({ ...log, record_type: 'metastrike', voter_ids: [] });
  const clearResult = await modClearMetastrikeLog(passReviewMember.id, log.sleep_cycle_date, owner);
  assert(clearResult.success && clearResult.cleared, 'Mod cleared the Metastrike');
  assert(await getNightlyStrikeLog(passReviewMember.id, log.sleep_cycle_date) === null, 'Pass log removed from store');
  const postClearCounts = await resolveMemberStrikeCounts(passReviewMember);
  assert(postClearCounts.strikes_used === 2, 'Pass reversal preserves strikes');
  assert(postClearCounts.metastrikes_used === 0, 'Pass reversal restores the balance');

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

  // 7D: Batched Recent Eligible Strikes Database-Backed Integration Test
  const runnerMode = process.env.RUNNER_MODE || (process.argv.includes('--all') ? 'all' : 'unit');
  const isAllMode = runnerMode === 'all';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasCredentials = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder') && !supabaseKey.includes('placeholder'));
  const isSupabaseLive = isAllMode && hasCredentials;

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
