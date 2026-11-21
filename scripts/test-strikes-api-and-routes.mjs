import assert from 'assert';
import { DateTime } from 'luxon';

// Enforce offline in-memory test isolation before loading any database modules
process.env.NODE_ENV = 'test';
process.env.PIN_SALT = process.env.PIN_SALT || 'test-salt-secret-12345';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-at-least-32-chars-long-for-testing!!';
process.env.MOD_SECRET_PASSCODE = process.env.MOD_SECRET_PASSCODE || 'test-mod-secret-passcode';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon-key';

// Dynamically import database and route handlers after environment isolation is sealed
const { setInMemoryMember, syncInMemoryMemberCache } = await import('../src/lib/db.ts');
const { createSessionToken } = await import('../src/lib/auth.ts');
const { computeMemberState, getSleepCycleDate } = await import('../src/lib/sleepEngine.ts');
const { GET: getStrikes, POST: postStrikeVote } = await import('../src/app/api/members/strikes/route.ts');
const { POST: postMetastrike } = await import('../src/app/api/members/strikes/metastrike/route.ts');
const { POST: postModAction } = await import('../src/app/api/mod/route.ts');
const { issueAutomaticBedtimeStrike } = await import('../src/lib/strikes.ts');

console.log('🧪 Starting Community Strikes & Metastrikes API Routes Verification...\n');

let failed = false;
function testAssert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function run() {
  // 1. Fixture Setup: In-Memory Members with Distinct Schedules
  console.log('--- 1. Member Fixture & Cache Hydration ---');
  const nowUtc = DateTime.utc();
  const currentMonth = nowUtc.toFormat('yyyy-MM');

  // Overdue target (30m overdue): scheduled bedtime 30 minutes ago, wake time 8 hours later
  const pastBedtimeLocal = nowUtc.minus({ minutes: 30 }).toFormat('HH:mm');
  const futureWakeLocal = nowUtc.plus({ hours: 7, minutes: 30 }).toFormat('HH:mm');

  // Overdue target (90m overdue past the initial 60m bedtime window)
  const pastBedtime90mLocal = nowUtc.minus({ minutes: 90 }).toFormat('HH:mm');
  const futureWake90mLocal = nowUtc.plus({ hours: 6, minutes: 30 }).toFormat('HH:mm');

  const voterAlice = {
    discord_id: '100000000000000111',
    id: 'mem_voter_alice_001',
    discord_username: 'AliceVoter',
    discord_handle: 'alice#0001',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/111111111',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'UTC',
    role: 'member',
    is_active: true,
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: currentMonth,
    created_at: nowUtc.toISO(),
    updated_at: nowUtc.toISO(),
  };

  const voterBob = {
    discord_id: '100000000000000222',
    id: 'mem_voter_bob_002',
    discord_username: 'BobVoter',
    discord_handle: 'bob#0002',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/222222222',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'UTC',
    role: 'member',
    is_active: true,
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: currentMonth,
    created_at: nowUtc.toISO(),
    updated_at: nowUtc.toISO(),
  };

  const targetCharlie = {
    discord_id: '100000000000000333',
    id: 'mem_target_charlie_003',
    discord_username: 'CharlieSleeper',
    discord_handle: 'charlie#0003',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/333333333',
    bedtime_local: pastBedtimeLocal,
    wake_time_local: futureWakeLocal,
    timezone: 'UTC',
    role: 'member',
    is_active: true,
    is_in_bed: false,
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: currentMonth,
    created_at: nowUtc.toISO(),
    updated_at: nowUtc.toISO(),
  };

  // Checked-in control: member scheduled 30m ago who safely checked in early
  const targetDaveCheckedIn = {
    id: 'mem_target_dave_004',
    discord_username: 'DaveCheckedIn',
    discord_handle: 'dave#0004',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/444444444',
    bedtime_local: pastBedtimeLocal,
    wake_time_local: futureWakeLocal,
    timezone: 'UTC',
    role: 'member',
    is_active: true,
    is_in_bed: true,
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: currentMonth,
    created_at: nowUtc.toISO(),
    updated_at: nowUtc.toISO(),
  };

  // 90-minute overdue fixture (in the 60-480m overdue window)
  const targetEve90mOverdue = {
    id: 'mem_target_eve_005',
    discord_username: 'Eve90mOverdue',
    discord_handle: 'eve#0005',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/555555555',
    bedtime_local: pastBedtime90mLocal,
    wake_time_local: futureWake90mLocal,
    timezone: 'UTC',
    role: 'member',
    is_active: true,
    is_in_bed: false,
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: currentMonth,
    created_at: nowUtc.toISO(),
    updated_at: nowUtc.toISO(),
  };

  setInMemoryMember(voterAlice);
  setInMemoryMember(voterBob);
  setInMemoryMember(targetCharlie);
  setInMemoryMember(targetDaveCheckedIn);
  setInMemoryMember(targetEve90mOverdue);

  const aliceToken = createSessionToken({ memberId: voterAlice.id, discordId: voterAlice.discord_id });
  const bobToken = createSessionToken({ memberId: voterBob.id, discordId: voterBob.discord_id });
  const charlieToken = createSessionToken({ memberId: targetCharlie.id, discordId: targetCharlie.discord_id });

  testAssert(Boolean(aliceToken && bobToken && charlieToken), 'Generated valid session tokens for members');

  // 2. GET /api/members/strikes Validation
  console.log('\n--- 2. GET /api/members/strikes Endpoint ---');
  {
    // Missing memberId parameter
    const resNoParam = await getStrikes(new Request('http://localhost:3000/api/members/strikes'));
    testAssert(resNoParam.status === 400, 'GET /api/members/strikes rejects missing memberId with 400');

    // Non-existent memberId
    const resNotFound = await getStrikes(new Request('http://localhost:3000/api/members/strikes?memberId=non-existent-uuid'));
    testAssert(resNotFound.status === 404, 'GET /api/members/strikes returns 404 for unknown member');

    // Valid existing member
    const resValid = await getStrikes(new Request(`http://localhost:3000/api/members/strikes?memberId=${targetCharlie.id}`));
    testAssert(resValid.status === 200, 'GET /api/members/strikes returns 200 for existing member via safe memory fallback');
    const dataValid = await resValid.json();
    testAssert(dataValid.member_id === targetCharlie.id, 'Response contains target member_id');
    testAssert(typeof dataValid.strikes_used === 'number', 'Response contains numeric strikes_used');
    testAssert(dataValid.is_strike_issued === false, 'Initial state has no strike issued');
  }

  // 3. POST /api/members/strikes Rejection (Peer Strike Voting Disabled)
  console.log('\n--- 3. POST /api/members/strikes Disabled Peer Voting ---');
  {
    // Any peer strike vote is strictly rejected with 403 Forbidden
    const resVote = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resVote.status === 403, 'POST /api/members/strikes rejects peer strike voting with 403 Forbidden');
    const voteBody = await resVote.json();
    testAssert(voteBody.code === 'PEER_VOTING_DISABLED', 'Rejection code is PEER_VOTING_DISABLED');
    testAssert(voteBody.error.includes('Peer strike voting has been disabled'), 'Error explains peer strike voting is disabled');
  }

  // 4. Automated Bedtime Strike Execution (30m Overdue Member)
  console.log('\n--- 4. Automated Bedtime Strike Execution ---');
  {
    const cycleDate = getSleepCycleDate(targetCharlie, nowUtc);
    const autoStrikeRes = await issueAutomaticBedtimeStrike(targetCharlie, cycleDate, nowUtc);
    testAssert(autoStrikeRes.success === true, 'issueAutomaticBedtimeStrike succeeded for 30m overdue Charlie');
    testAssert(autoStrikeRes.strikeIssued === true, 'Automated strike officially issued for tonight');
    testAssert((autoStrikeRes.strikesUsed || 0) >= 1, 'Target member strikes_used incremented');
    testAssert(autoStrikeRes.log?.record_type === 'strike', 'Log record_type is strike');

    // Duplicate check in same cycle -> 0 additional strikes
    const autoStrikeDupe = await issueAutomaticBedtimeStrike(targetCharlie, cycleDate, nowUtc.plus({ minutes: 5 }));
    testAssert(autoStrikeDupe.strikeIssued === false, 'Duplicate automatic strike yields 0 new strikes');
    testAssert(autoStrikeDupe.reason === 'already_issued', 'Reason indicates already_issued');

    // Verified by GET endpoint
    const resGetAfterStrike = await getStrikes(new Request(`http://localhost:3000/api/members/strikes?memberId=${targetCharlie.id}`));
    const dataAfterStrike = await resGetAfterStrike.json();
    testAssert(dataAfterStrike.is_strike_issued === true, 'GET reflects is_strike_issued: true for tonight');
    testAssert(dataAfterStrike.strikes_used >= 1, 'GET reflects updated strikes_used count');
  }

  // 4B. 90-Minute Overdue Fixture Verification (Issue #40 State Machine Rebalancing)
  console.log('\n--- 4B. 90-Minute Overdue Fixture Verification ---');
  {
    const stateEve = computeMemberState(targetEve90mOverdue, targetEve90mOverdue.timezone, nowUtc, false);
    testAssert(stateEve.status === 'OVERDUE_NAG_NOW', '90m overdue member without check-in has status: OVERDUE_NAG_NOW');
    testAssert(stateEve.canVoteStrike === false, '90m overdue member has canVoteStrike: false (peer voting disabled)');

    const resVoteEve = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ target_member_id: targetEve90mOverdue.id }),
    }));
    testAssert(resVoteEve.status === 403, 'Peer vote against 90m overdue member is rejected with 403 Forbidden');

    const cycleDateEve = getSleepCycleDate(targetEve90mOverdue, nowUtc);
    const autoStrikeEve = await issueAutomaticBedtimeStrike(targetEve90mOverdue, cycleDateEve, nowUtc);
    testAssert(autoStrikeEve.strikeIssued === true, 'Automated strike issued for 90m overdue member');
  }

  // 5. Metastrike Retroactive Conversion & Proactive Protection
  console.log('\n--- 5. Metastrike Retroactive Conversion & Protection ---');
  {
    const cycleDate = getSleepCycleDate(targetCharlie, nowUtc);
    // Charlie retroactively converts the strike to a Metastrike
    const resConvert = await postMetastrike(new Request('http://localhost:3000/api/members/strikes/metastrike', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${charlieToken}` },
      body: JSON.stringify({
        member_id: targetCharlie.id,
        action: 'convert_retroactive',
        reason: 'Family Emergency',
        sleep_cycle_date: cycleDate,
      }),
    }));
    if (resConvert.status !== 200) {
      const errBody = await resConvert.clone().json().catch(() => ({}));
      console.error(`❌ convert_retroactive returned ${resConvert.status}:`, errBody);
    }
    testAssert(resConvert.status === 200, 'POST /api/members/strikes/metastrike conversion returns 200 OK');
    const convertBody = await resConvert.json();
    testAssert(convertBody.metastrikes_used >= 1, 'Metastrikes count incremented upon conversion');

    // Verified by GET endpoint
    const resGetAfterConvert = await getStrikes(new Request(`http://localhost:3000/api/members/strikes?memberId=${targetCharlie.id}`));
    const dataAfterConvert = await resGetAfterConvert.json();
    testAssert(dataAfterConvert.is_metastrike_active === true, 'GET confirms is_metastrike_active: true');
    testAssert(dataAfterConvert.is_strike_issued === false, 'GET confirms strike was cleared/converted');

    // Peer voting remains disabled
    const resVoteProtected = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resVoteProtected.status === 403, 'Peer strike voting remains disabled (403)');
  }

  // 6. Moderator Clear Strike Log & Override
  console.log('\n--- 6. Moderator Clear Strike Log & Override ---');
  {
    const resClearMod = await postModAction(new Request('http://localhost:3000/api/mod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'clear_strike_log',
        mod_passcode: process.env.MOD_SECRET_PASSCODE,
        member_id: targetCharlie.id,
      }),
    }));
    testAssert(resClearMod.status === 200, 'Moderator clear_strike_log action succeeds with 200 OK');

    const resGetAfterMod = await getStrikes(new Request(`http://localhost:3000/api/members/strikes?memberId=${targetCharlie.id}`));
    const dataAfterMod = await resGetAfterMod.json();
    testAssert(dataAfterMod.is_metastrike_active === false, 'Moderator clear removed active metastrike log');
  }

  if (failed) {
    console.error('\n❌ SOME STRIKE API ROUTE TESTS FAILED.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL STRIKE API ROUTE TESTS PASSED SUCCESSFULLY! 🦊⚡');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
