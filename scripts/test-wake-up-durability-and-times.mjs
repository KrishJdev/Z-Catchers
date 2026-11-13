import assert from 'assert';
import { DateTime } from 'luxon';

const {
  upsertSleepLog,
  getMemberSleepLogs,
  clearInMemorySleepLogs,
  setInMemoryMember,
  clearInMemoryMembers,
} = await import('../src/lib/db.ts');

const {
  createSessionToken,
  hashPin,
} = await import('../src/lib/auth.ts');

const {
  resolveActiveSleepCycle,
  computeMemberState,
  getSleepCycleDate,
} = await import('../src/lib/sleepEngine.ts');

const { POST: handleWakeUpPost } = await import('../src/app/api/members/wake-up/route.ts');

console.log('🧪 Starting Wake-Up Durability & Time Engine Verification...\n');

let failed = false;
function testAssert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  }
}

async function run() {
  clearInMemorySleepLogs();
  clearInMemoryMembers();

  // Test Member 1: Krish in Asia/Kolkata (GMT+05:30) with 02:00 AM bedtime, 08:30 AM wake time
  const testMemberId = 'mem_krish_wake_test_' + Date.now();
  const testTz = 'Asia/Kolkata';
  const testPinHash = hashPin('1234');

  const mockKrishMember = {
    id: testMemberId,
    discord_id: 'disc_krish_12345',
    discord_username: 'Krishhh',
    discord_handle: 'krish#0001',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/987654321',
    bedtime_local: '02:00',
    wake_time_local: '08:30',
    timezone: testTz,
    role: 'member',
    passcode_hash: testPinHash,
    is_active: true,
    is_in_bed: true,
    is_woke_up: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  setInMemoryMember(mockKrishMember);

  // --------------------------------------------------------------------------
  // 1. Storage Fallback Verification (upsertSleepLog resilience)
  // --------------------------------------------------------------------------
  console.log('--- 1. Storage Fallback & In-Memory Durability ---');

  const cycleDate = '2026-11-12';
  const { data: logEntry, error: logErr } = await upsertSleepLog({
    member_id: testMemberId,
    cycle_date: cycleDate,
    timezone: testTz,
    target_bedtime: '02:00',
    target_wake_time: '08:30',
    in_bed_local_time: '02:15',
    woke_up_local_time: '08:30',
    wake_source: 'button',
    duration_minutes: 375,
    status: 'on_time',
  });

  testAssert(!logErr && logEntry !== null, 'upsertSleepLog succeeds and returns non-null data');
  testAssert(logEntry?.cycle_date === cycleDate, 'upsertSleepLog saves cycle_date correctly');
  testAssert(logEntry?.duration_minutes === 375, 'upsertSleepLog duration_minutes is preserved');

  const { data: retrievedLogs } = await getMemberSleepLogs(testMemberId, cycleDate, cycleDate);
  testAssert(retrievedLogs && retrievedLogs.length === 1, 'getMemberSleepLogs retrieves the saved log');
  testAssert(retrievedLogs?.[0].woke_up_local_time === '08:30', 'getMemberSleepLogs returns accurate woke_up_local_time');

  // --------------------------------------------------------------------------
  // 2. Active Sleep Cycle Preservation During Daytime (resolveActiveSleepCycle)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Active Sleep Cycle Daytime Resolution ---');

  // Time: 10:50 AM next day (morning after 02:00 AM bedtime)
  const morning1050AmKolkata = DateTime.fromISO('2026-11-13T10:50:44', { zone: 'Asia/Kolkata' });
  const activeMorningCycle = resolveActiveSleepCycle(mockKrishMember, morning1050AmKolkata, true);
  testAssert(
    activeMorningCycle.cycleEveningDate === '2026-11-12',
    'Morning at 10:50 AM anchors to yesterday evening cycle (2026-11-12)'
  );

  // Time: 2:00 PM next day (afternoon, user still in bed before waking up)
  const afternoon2PmKolkata = DateTime.fromISO('2026-11-13T14:00:00', { zone: 'Asia/Kolkata' });
  const activeAfternoonCycle = resolveActiveSleepCycle(mockKrishMember, afternoon2PmKolkata, true);
  testAssert(
    activeAfternoonCycle.cycleEveningDate === '2026-11-12',
    'Afternoon at 2:00 PM while in-bed remains anchored to current sleep cycle (2026-11-12) until wind-down'
  );

  // Time: 11:30 PM next night (after today wind-down window begins for next night)
  const lateNightKolkata = DateTime.fromISO('2026-11-13T23:30:00', { zone: 'Asia/Kolkata' });
  const nextNightCycle = resolveActiveSleepCycle(mockKrishMember, lateNightKolkata, false);
  testAssert(
    nextNightCycle.cycleEveningDate === '2026-11-13',
    'Transitions to today cycle (2026-11-13) once tonight wind-down begins'
  );

  // --------------------------------------------------------------------------
  // 3. Instant Wake-Up API Route (POST /api/members/wake-up: button)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Instant Wake-Up API Route ---');

  const validToken = createSessionToken({
    memberId: testMemberId,
    discordId: mockKrishMember.discord_id,
    isModerator: false,
  });

  const instantWakeReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`,
    },
    body: JSON.stringify({ memberId: testMemberId, mode: 'button' }),
  });

  const instantWakeRes = await handleWakeUpPost(instantWakeReq);
  const instantWakeJson = await instantWakeRes.json();

  testAssert(instantWakeRes.status === 200, 'POST /api/members/wake-up returns HTTP 200 without throwing 500 error');
  testAssert(instantWakeJson.success === true, 'Response contains success: true');
  testAssert(instantWakeJson.member?.is_in_bed === false, 'Response member has is_in_bed: false');
  testAssert(instantWakeJson.member?.is_woke_up === true, 'Response member has is_woke_up: true');
  testAssert(instantWakeJson.sleep_log?.wake_source === 'button', 'sleep_log.wake_source is "button"');
  testAssert(typeof instantWakeJson.sleep_log?.woke_up_local_time === 'string', 'sleep_log has woke_up_local_time');

  // Verify computeMemberState after wake-up is AWAKE
  const stateAfterWake = computeMemberState(
    { ...mockKrishMember, is_in_bed: false, is_woke_up: true, last_wake_cycle_date: activeMorningCycle.cycleEveningDate },
    'Asia/Kolkata',
    morning1050AmKolkata.toUTC()
  );
  testAssert(stateAfterWake.bucket === 'AWAKE', 'computeMemberState resolves to AWAKE after waking up');
  testAssert(stateAfterWake.isSleepShieldActive === false, 'Sleep Shield is inactive after waking up');
  testAssert(stateAfterWake.needsWakeUpLog === false, 'needsWakeUpLog is false after waking up');

  // --------------------------------------------------------------------------
  // 4. Manual Wake-Up Time Entry Route (POST /api/members/wake-up: manual)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Manual Wake-Up Time Entry ---');

  // 4A. Valid manual entry: user woke up at 08:30 AM
  const validManualReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`,
    },
    body: JSON.stringify({
      memberId: testMemberId,
      mode: 'manual',
      wokeUpTime: '08:30',
      cycleDate: '2026-11-12',
    }),
  });

  const validManualRes = await handleWakeUpPost(validManualReq);
  const validManualJson = await validManualRes.json();

  testAssert(validManualRes.status === 200, 'Valid manual wake-up time returns HTTP 200');
  testAssert(validManualJson.sleep_log?.wake_source === 'manual', 'Recorded wake_source is "manual"');
  testAssert(validManualJson.sleep_log?.woke_up_local_time === '08:30', 'woke_up_local_time matches 08:30');
  testAssert(typeof validManualJson.duration_minutes === 'number', 'duration_minutes is computed as a number');
  testAssert(typeof validManualJson.formatted_duration === 'string', 'formatted_duration is generated');

  // 4B. Future wake-up time rejected (e.g. entering tomorrow or time past current clock)
  const futureManualReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`,
    },
    body: JSON.stringify({
      memberId: testMemberId,
      mode: 'manual',
      wokeUpTime: '23:59',
      cycleDate: DateTime.now().setZone(testTz).plus({ days: 1 }).toISODate(),
    }),
  });

  const futureManualRes = await handleWakeUpPost(futureManualReq);
  testAssert(futureManualRes.status === 400, 'Future wake-up time is rejected with HTTP 400');

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n============================================================');
  if (failed) {
    console.error('❌ Some tests failed.');
    process.exit(1);
  } else {
    console.log('🎉 All Wake-Up Durability & Time Engine tests PASSED cleanly! 🦊☀️');
  }
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
