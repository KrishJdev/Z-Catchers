import assert from 'assert';
import { DateTime } from 'luxon';
import { syncInMemoryMemberCache } from '../src/lib/db.ts';
import { createSessionToken } from '../src/lib/auth.ts';
import { GET as getStrikes, POST as postStrikeVote } from '../src/app/api/members/strikes/route.ts';
import { POST as postMetastrike } from '../src/app/api/members/strikes/metastrike/route.ts';
import { POST as postModAction } from '../src/app/api/mod/route.ts';

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long-for-testing!!';
}
if (!process.env.MOD_SECRET_PASSCODE) {
  process.env.MOD_SECRET_PASSCODE = 'test-mod-secret-passcode';
}

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

  // Overdue target: scheduled bedtime 30 minutes ago, wake time 8 hours later
  const pastBedtimeLocal = nowUtc.minus({ minutes: 30 }).toFormat('HH:mm');
  const futureWakeLocal = nowUtc.plus({ hours: 7, minutes: 30 }).toFormat('HH:mm');

  const voterAlice = {
    id: 'voter-alice-uuid-001',
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
    id: 'voter-bob-uuid-002',
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
    id: 'target-charlie-uuid-003',
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

  syncInMemoryMemberCache(voterAlice);
  syncInMemoryMemberCache(voterBob);
  syncInMemoryMemberCache(targetCharlie);

  const aliceToken = createSessionToken(voterAlice.id);
  const bobToken = createSessionToken(voterBob.id);
  const charlieToken = createSessionToken(targetCharlie.id);

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

  // 3. POST /api/members/strikes Authentication & Guardrails
  console.log('\n--- 3. POST /api/members/strikes Auth & Guardrails ---');
  {
    // Missing target_member_id
    const resNoTarget = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({}),
    }));
    testAssert(resNoTarget.status === 400, 'POST rejects missing target_member_id with 400');

    // Missing Authorization header
    const resNoAuth = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resNoAuth.status === 401, 'POST rejects unauthenticated request with 401');

    // Non-existent voter token
    const fakeToken = createSessionToken('non-existent-voter-uuid');
    const resFakeVoter = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fakeToken}` },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resFakeVoter.status === 401, 'POST rejects non-existent voter profile with 401');

    // Self-voting prevention
    const resSelfVote = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${charlieToken}` },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resSelfVote.status === 400, 'POST rejects self-voting with 400');
    const selfVoteBody = await resSelfVote.json();
    testAssert(selfVoteBody.error.includes('strike yourself'), 'Self-voting error message mentions self-strike restriction');
  }

  // 4. Community 2-Vote Strike Workflow
  console.log('\n--- 4. Community 2-Vote Strike Workflow Execution ---');
  {
    // 1st Vote: Alice votes against overdue Charlie
    const resVote1 = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resVote1.status === 200, '1st strike vote returns 200 OK');
    const vote1Body = await resVote1.json();
    testAssert(vote1Body.strike_issued === false, '1st vote does not issue strike immediately');
    testAssert(vote1Body.votes_count === 1, 'Votes count is 1/2');

    // Duplicate vote by Alice
    const resDupVote = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resDupVote.status === 400, 'Duplicate vote from same voter rejected with 400');
    const dupBody = await resDupVote.json();
    testAssert(dupBody.error.includes('already voted'), 'Duplicate vote error indicates already voted');

    // 2nd Vote: Bob votes against Charlie -> triggers strike
    const resVote2 = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resVote2.status === 200, '2nd strike vote returns 200 OK');
    const vote2Body = await resVote2.json();
    testAssert(vote2Body.strike_issued === true, '2nd vote officially issues a STRIKE');
    testAssert(vote2Body.votes_count === 2, 'Votes count reached 2/2');
    testAssert(vote2Body.strikes_used >= 1, 'Target member strikes_used incremented');

    // Verified by GET endpoint
    const resGetAfterStrike = await getStrikes(new Request(`http://localhost:3000/api/members/strikes?memberId=${targetCharlie.id}`));
    const dataAfterStrike = await resGetAfterStrike.json();
    testAssert(dataAfterStrike.is_strike_issued === true, 'GET reflects is_strike_issued: true for tonight');
    testAssert(dataAfterStrike.strikes_used >= 1, 'GET reflects updated strikes_used count');
  }

  // 5. Metastrike Retroactive Conversion & Proactive Protection
  console.log('\n--- 5. Metastrike Retroactive Conversion & Protection ---');
  {
    // Charlie retroactively converts the strike to a Metastrike
    const resConvert = await postMetastrike(new Request('http://localhost:3000/api/members/strikes/metastrike', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${charlieToken}` },
      body: JSON.stringify({
        member_id: targetCharlie.id,
        action: 'convert_retroactive',
        reason: 'Family Emergency',
      }),
    }));
    testAssert(resConvert.status === 200, 'POST /api/members/strikes/metastrike conversion returns 200 OK');
    const convertBody = await resConvert.json();
    testAssert(convertBody.metastrikes_used >= 1, 'Metastrikes count incremented upon conversion');

    // Verified by GET endpoint
    const resGetAfterConvert = await getStrikes(new Request(`http://localhost:3000/api/members/strikes?memberId=${targetCharlie.id}`));
    const dataAfterConvert = await resGetAfterConvert.json();
    testAssert(dataAfterConvert.is_metastrike_active === true, 'GET confirms is_metastrike_active: true');
    testAssert(dataAfterConvert.is_strike_issued === false, 'GET confirms strike was cleared/converted');

    // Voting again while protected by Metastrike should be blocked
    const resVoteProtected = await postStrikeVote(new Request('http://localhost:3000/api/members/strikes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ target_member_id: targetCharlie.id }),
    }));
    testAssert(resVoteProtected.status === 400, 'Strike voting blocked against member protected by Metastrike');
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
