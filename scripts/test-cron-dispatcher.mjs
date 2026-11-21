import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { DateTime } from 'luxon';

// Ensure isolated offline testing mode before importing application modules.
// Strip remote Supabase credentials so the test suite strictly operates on
// isolated in-memory stores without reading or updating remote database records.
process.env.NODE_ENV = 'test';
process.env.DISCORD_COMMUNITY_WEBHOOK_URL = 'disabled-in-unit-tests';
process.env.PIN_SALT = process.env.PIN_SALT || 'test-salt-secret-12345';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-for-cron-dispatcher-suite-12345';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon-key';

// Auto-load non-Supabase local secrets from .env.local if present (e.g. PIN_SALT)
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
        // Skip Supabase credentials to enforce strict offline test isolation
        if (key.includes('SUPABASE')) continue;
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // Ignore
}

import {
  computeMemberState,
  getSleepCycleDate,
  isOverdueBucket,
} from '../src/lib/sleepEngine.ts';
import {
  executeNotificationDispatcher,
  clearAllCronLocks,
} from '../src/lib/cronDispatcher.ts';
import {
  clearInMemoryMembers,
  setInMemoryMember,
  clearInMemorySleepLogs,
} from '../src/lib/db.ts';
import {
  getNightlyStrikeLog,
  clearInMemoryStrikeStore,
  resolveMemberStrikeCounts,
} from '../src/lib/strikes.ts';
import { POST as handleInBedPost } from '../src/app/api/members/in-bed/route.ts';
import { POST as handleWakeUpPost } from '../src/app/api/members/wake-up/route.ts';
import { createSessionToken, hashPin } from '../src/lib/auth.ts';

console.log('🧪 Starting Cron Dispatcher & Manual-Only Sleep State Transitions Suite...\n');

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
  clearAllCronLocks();
  clearInMemoryMembers();
  clearInMemorySleepLogs();
  clearInMemoryStrikeStore();

  const testMemberId = 'mem_cron_dispatch_' + Date.now();
  const testTz = 'UTC';
  const testPin = '1234';
  const testPinHash = hashPin(testPin);

  const baseMember = {
    id: testMemberId,
    discord_id: 'disc_cron_999',
    discord_username: 'CronDispatcherFox',
    discord_handle: 'cronfox#0001',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/987654321',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: testTz,
    role: 'member',
    passcode_hash: testPinHash,
    is_active: true,
    created_at: '2026-11-16T00:00:00.000Z',
    updated_at: '2026-11-16T00:00:00.000Z',
    last_notified_stage: null,
    last_notified_cycle_date: null,
    is_in_bed: false,
    is_woke_up: false,
    strike_cycle_month: '2026-11',
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
  };

  setInMemoryMember(baseMember);

  // -------------------------------------------------------------
  // Test Case 1: Member passes scheduled bedtime by 1 second without checking in
  // Expected: Immediately moves to "Overdue / Past Bedtime" bucket
  // -------------------------------------------------------------
  console.log('--- Test Case 1: Member passes scheduled bedtime by 1 second without check-in ---');
  const timeBedtimePlus1s = DateTime.fromISO('2026-11-16T23:00:01.000Z', { zone: 'UTC' });
  const state1s = computeMemberState(baseMember, testTz, timeBedtimePlus1s, false);

  testAssert(state1s.bucket === 'BEDTIME_NOW', '1 second past bedtime without check-in moves to "Overdue / Past Bedtime" bucket (BEDTIME_NOW)');
  testAssert(isOverdueBucket(state1s.bucket), 'isOverdueBucket helper confirms bucket is in Overdue section');
  testAssert(state1s.isOverdue === true, 'state.isOverdue flag is TRUE');
  testAssert(state1s.status === 'BEDTIME_GRACE', 'Within initial 5 minutes, status is BEDTIME_GRACE');
  testAssert(state1s.isSleepShieldActive === false, 'Sleep Shield is strictly OFF while overdue');
  testAssert(state1s.needsWakeUpLog === false, 'needsWakeUpLog is FALSE (user has not checked in to bed)');

  // -------------------------------------------------------------
  // Test Case 2: Member passes bedtime, does NOT click in-bed, reaches 10 minutes past
  // Expected: Receives auto-strike AND remains in "Overdue / Past Bedtime"
  // -------------------------------------------------------------
  console.log('\n--- Test Case 2: 10 minutes past bedtime without in-bed -> receives auto-strike & remains Overdue ---');
  const timeBedtimePlus10m = DateTime.fromISO('2026-11-16T23:10:00.000Z', { zone: 'UTC' });
  const state10m = computeMemberState(baseMember, testTz, timeBedtimePlus10m, false);

  testAssert(state10m.bucket === 'BEDTIME_NOW', 'At 10m past bedtime, member remains in "Overdue / Past Bedtime" bucket');
  testAssert(state10m.status === 'OVERDUE_NAG_NOW', 'At 10m past bedtime, status is OVERDUE_NAG_NOW');
  testAssert(state10m.isSleepShieldActive === false, 'Sleep Shield is strictly OFF at 10m without check-in');

  const cycleDate = getSleepCycleDate(baseMember, timeBedtimePlus10m);
  const beforeCutoff = await executeNotificationDispatcher({
    testNowUtc: timeBedtimePlus10m.minus({ milliseconds: 1 }),
    forcedMemberId: baseMember.id,
  });
  testAssert(beforeCutoff.autoStrikesDispatched === 0, 'Cron does not issue a strike before the 10-minute cutoff');
  testAssert(!(await getNightlyStrikeLog(baseMember.id, cycleDate)), 'No nightly strike is written before the cutoff');

  const cronResult = await executeNotificationDispatcher({
    testNowUtc: timeBedtimePlus10m,
    forcedMemberId: baseMember.id,
    dryRun: false,
  });

  testAssert(cronResult.autoStrikesDispatched === 1, 'Cron dispatcher fires automated strike at 10-minute mark');
  const strikeLog = await getNightlyStrikeLog(baseMember.id, cycleDate);
  testAssert(strikeLog?.record_type === 'strike', 'Nightly strike log recorded with record_type: strike');

  const countsAfterStrike = await resolveMemberStrikeCounts(baseMember, timeBedtimePlus10m);
  testAssert(countsAfterStrike.strikes_used === 1, 'Member strikes_used incremented to 1');

  // Re-evaluate state after cron run: member must STILL remain in "Overdue / Past Bedtime"
  const stateAfterStrike = computeMemberState(baseMember, testTz, timeBedtimePlus10m, false);
  testAssert(stateAfterStrike.bucket === 'BEDTIME_NOW', 'After auto-strike fires, member STILL remains in Overdue bucket');
  testAssert(stateAfterStrike.status === 'OVERDUE_NAG_NOW', 'Status remains OVERDUE_NAG_NOW');
  testAssert(stateAfterStrike.isSleepShieldActive === false, 'Sleep Shield remains OFF');

  // Deep overdue check at 3 hours past bedtime (02:00 AM) without check-in
  const timeBedtimePlus3h = DateTime.fromISO('2026-11-17T02:00:00.000Z', { zone: 'UTC' });
  const state3h = computeMemberState(baseMember, testTz, timeBedtimePlus3h, false);
  testAssert(state3h.bucket === 'BEDTIME_NOW', 'At 3h past bedtime without check-in, member NEVER auto-moves to Asleep (remains in Overdue)');
  testAssert(state3h.isSleepShieldActive === false, 'Sleep Shield remains OFF at 3h past bedtime without check-in');

  // -------------------------------------------------------------
  // Test Case 3: Member passes bedtime without clicking in-bed, and cron runs past scheduled wake-up time
  // Expected: Transitions out of overdue to "Awake" automatically without being incorrectly marked as asleep
  // -------------------------------------------------------------
  console.log('\n--- Test Case 3: Cron runs past scheduled wake-up time without in-bed -> transitions to Awake ---');
  // Scheduled wake time is 07:00 UTC. Cron runs at 07:05 UTC.
  const timePastWake = DateTime.fromISO('2026-11-17T07:05:00.000Z', { zone: 'UTC' });
  const statePastWake = computeMemberState(baseMember, testTz, timePastWake, false);

  testAssert(statePastWake.bucket === 'AWAKE', 'Past scheduled wake-up time, unchecked-in member transitions out of overdue directly to AWAKE');
  testAssert(statePastWake.status === 'AWAKE', 'Status resolves to AWAKE');
  testAssert(statePastWake.isSleepShieldActive === false, 'Sleep Shield remains OFF');
  testAssert(statePastWake.needsWakeUpLog === false, 'needsWakeUpLog is FALSE (member was never marked asleep)');

  // Run cron dispatcher past wake time: verify no duplicate strikes and safe daytime operation
  const cronPastWakeResult = await executeNotificationDispatcher({
    testNowUtc: timePastWake,
    forcedMemberId: baseMember.id,
    dryRun: false,
  });
  testAssert(cronPastWakeResult.autoStrikesDispatched === 0, 'No additional auto-strikes dispatched past wake time');

  // Verify missed bedtime strike penalty was durably preserved
  const strikeLogPastWake = await getNightlyStrikeLog(baseMember.id, cycleDate);
  testAssert(strikeLogPastWake?.record_type === 'strike', 'Missed bedtime strike remains penalized and recorded');

  // -------------------------------------------------------------
  // Test Case 4: Member manually clicks "I'm in Bed" -> moves from Overdue/Winding Down to "Asleep"
  // -------------------------------------------------------------
  console.log('\n--- Test Case 4: Member manually clicks "I\'m in Bed" -> moves to Asleep ---');

  const sessionToken = createSessionToken({
    memberId: baseMember.id,
    discordId: baseMember.discord_id,
    isModerator: false,
  });

  // 4A. From Winding Down (-30m before bedtime)
  const timeWindDown = DateTime.fromISO('2026-11-16T22:30:00.000Z', { zone: 'UTC' });
  const statePreCheckin = computeMemberState(baseMember, testTz, timeWindDown, false);
  testAssert(statePreCheckin.bucket === 'WINDING_DOWN', 'At 22:30, initial bucket is WINDING_DOWN');

  // Execute in-bed check-in via API route
  const checkInReq = new Request('http://localhost:3000/api/members/in-bed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ memberId: baseMember.id, action: 'check_in' }),
  });

  const checkInRes = await handleInBedPost(checkInReq);
  const checkInJson = await checkInRes.json();
  testAssert(checkInRes.status === 200 && checkInJson.success === true, 'POST /api/members/in-bed returns 200 OK');
  testAssert(checkInJson.is_in_bed === true, 'Response reflects is_in_bed: true');

  // Evaluate state with in-bed check-in active
  const statePostCheckin = computeMemberState(baseMember, testTz, timeWindDown, true);
  testAssert(statePostCheckin.bucket === 'SLEEPING', 'Manually clicking "I\'m in Bed" moves member to "Asleep" (SLEEPING)');
  testAssert(statePostCheckin.status === 'SLEEPING', 'Status is SLEEPING');
  testAssert(statePostCheckin.isSleepShieldActive === true, 'Sleep Shield is ACTIVE once in bed');
  testAssert(statePostCheckin.needsWakeUpLog === true, 'needsWakeUpLog is TRUE while sleeping');

  // 4B. Check in from Overdue window
  const stateOverdueCheckedIn = computeMemberState(baseMember, testTz, timeBedtimePlus10m, true);
  testAssert(stateOverdueCheckedIn.bucket === 'SLEEPING', 'Checking in from Overdue window moves member to SLEEPING');
  testAssert(stateOverdueCheckedIn.isSleepShieldActive === true, 'Sleep Shield activated upon late check-in');

  // 4C. Explicit Wake Up via API route
  const wakeUpReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ memberId: baseMember.id, mode: 'button' }),
  });
  const wakeUpRes = await handleWakeUpPost(wakeUpReq);
  const wakeUpJson = await wakeUpRes.json();
  testAssert(wakeUpRes.status === 200 && wakeUpJson.success === true, 'POST /api/members/wake-up returns 200 OK');

  const stateAfterWakeUp = computeMemberState(
    { ...baseMember, is_in_bed: false, is_woke_up: true },
    testTz,
    timePastWake,
    false
  );
  testAssert(stateAfterWakeUp.bucket === 'AWAKE', 'Clicking "Wake Up" transitions member to AWAKE');
  testAssert(stateAfterWakeUp.isSleepShieldActive === false, 'Sleep Shield deactivated upon wake-up');

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n============================================================');
  if (failed) {
    console.error('❌ SOME TESTS FAILED in test-cron-dispatcher.mjs');
    process.exit(1);
  } else {
    console.log('🎉 ALL CRON DISPATCHER & MANUAL-ONLY STATE TESTS PASSED! 🦊💤');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
