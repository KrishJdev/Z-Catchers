import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { DateTime } from 'luxon';

// 1. Auto-load .env.local if present
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
  // Ignore
}

// 2. Dynamic imports
const {
  upsertSleepLog,
  getMemberSleepLogs,
  getInMemorySleepLogs,
  clearInMemorySleepLogs,
  setInMemoryMember,
  clearInMemoryMembers,
} = await import('../src/lib/db.ts');

const {
  createSessionToken,
  hashPin,
} = await import('../src/lib/auth.ts');

const { computeMemberState, getSleepCycleDate } = await import('../src/lib/sleepEngine.ts');
const { POST: handleWakeUpPost } = await import('../src/app/api/members/wake-up/route.ts');
const { GET: handleSleepHistoryGet } = await import('../src/app/api/members/sleep-history/route.ts');

console.log('🧪 Starting "I Woke Up" Mechanic & Sleep History Calendar Verification...\n');

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

  const testMemberId = 'mem_fox_test_' + Date.now();
  const testTz = 'America/New_York';
  const testPinHash = hashPin('1234');

  const mockTestMember = {
    id: testMemberId,
    discord_id: 'disc_fox_12345',
    discord_username: 'SleepyFoxDev',
    discord_handle: 'sleepyfox#0001',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=SleepyFoxDev',
    journal_url: 'https://discord.com/channels/123456789/987654321',
    bedtime_local: '23:30',
    wake_time_local: '07:30',
    timezone: testTz,
    role: 'member',
    passcode_hash: testPinHash,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  setInMemoryMember(mockTestMember);

  // -------------------------------------------------------------
  // 1. DB & In-Memory Storage Layer (sleep_logs)
  // -------------------------------------------------------------
  console.log('--- 1. Storage Layer: upsertSleepLog & getMemberSleepLogs ---');

  const cycleDate1 = '2026-11-10';
  const { data: log1, error: err1 } = await upsertSleepLog({
    member_id: testMemberId,
    cycle_date: cycleDate1,
    timezone: testTz,
    target_bedtime: '23:30',
    target_wake_time: '07:30',
    in_bed_at: '2026-11-10T23:30:00.000-05:00',
    in_bed_local_time: '23:30',
    status: 'on_time',
  });

  testAssert(!err1 && log1, 'upsertSleepLog successfully creates check-in record');
  testAssert(log1?.in_bed_local_time === '23:30', 'in_bed_local_time matches check-in time');
  testAssert(log1?.status === 'on_time', 'initial status is on_time');

  // Update wake-up on the same cycle date
  const { data: log1Updated, error: err1Up } = await upsertSleepLog({
    member_id: testMemberId,
    cycle_date: cycleDate1,
    woke_up_at: '2026-11-11T07:30:00.000-05:00',
    woke_up_local_time: '07:30',
    wake_source: 'button',
    duration_minutes: 480,
  });

  testAssert(!err1Up && log1Updated, 'upsertSleepLog updates existing record with wake data');
  testAssert(log1Updated?.in_bed_local_time === '23:30', 'preserves original in_bed_local_time');
  testAssert(log1Updated?.woke_up_local_time === '07:30', 'sets woke_up_local_time');
  testAssert(log1Updated?.wake_source === 'button', 'sets wake_source to button');
  testAssert(log1Updated?.duration_minutes === 480, 'sets duration_minutes to 480');

  // Query logs by range
  const { data: queriedLogs } = await getMemberSleepLogs(testMemberId, '2026-11-01', '2026-11-30');
  testAssert(queriedLogs && queriedLogs.length === 1, 'getMemberSleepLogs retrieves records within range');
  testAssert(queriedLogs?.[0].cycle_date === cycleDate1, 'retrieved record matches cycle_date');

  // -------------------------------------------------------------
  // 2. Instant Wake-Up API Route (POST /api/members/wake-up: button)
  // -------------------------------------------------------------
  console.log('\n--- 2. Instant Wake-Up API (mode: button) ---');

  // 2A. Unauthorized without session or PIN
  const unauthReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: testMemberId, mode: 'button' }),
  });
  const unauthRes = await handleWakeUpPost(unauthReq);
  testAssert(unauthRes.status === 401, 'Unauthorized request rejected with HTTP 401');

  // 2B. Authenticated session for target member
  const validSessionToken = createSessionToken({
    memberId: testMemberId,
    discordId: mockTestMember.discord_id,
    isModerator: false,
  });

  const authReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validSessionToken}`,
    },
    body: JSON.stringify({ memberId: testMemberId, mode: 'button' }),
  });
  const authRes = await handleWakeUpPost(authReq);
  const authJson = await authRes.json();

  testAssert(authRes.status === 200, 'Authenticated wake-up request returns HTTP 200');
  testAssert(authJson.success === true, 'Response contains success: true');
  testAssert(authJson.sleep_log?.wake_source === 'button', 'Wake source is recorded as "button"');
  testAssert(typeof authJson.sleep_log?.woke_up_local_time === 'string', 'woke_up_local_time is populated');
  testAssert(authJson.member?.last_woke_up_at !== null, 'Member last_woke_up_at timestamp updated');
  testAssert(authJson.member?.last_wake_cycle_date !== null, 'Member last_wake_cycle_date updated');

  // -------------------------------------------------------------
  // 3. Manual Wake-Up API Route (POST /api/members/wake-up: manual)
  // -------------------------------------------------------------
  console.log('\n--- 3. Manual Wake-Up API (mode: manual) ---');

  // 3A. Invalid time format validation
  const invalidTimeReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validSessionToken}`,
    },
    body: JSON.stringify({
      memberId: testMemberId,
      mode: 'manual',
      wokeUpTime: '25:99', // Invalid
    }),
  });
  const invalidTimeRes = await handleWakeUpPost(invalidTimeReq);
  testAssert(invalidTimeRes.status === 400, 'Invalid HH:mm format rejected with HTTP 400');

  // 3B. Past cycle date manual wake-up with cross-midnight duration
  const testPastCycle = DateTime.utc().setZone(testTz).minus({ days: 2 }).toISODate();
  
  // Seed past check-in: in bed at 23:30
  await upsertSleepLog({
    member_id: testMemberId,
    cycle_date: testPastCycle,
    timezone: testTz,
    target_bedtime: '23:30',
    target_wake_time: '07:30',
    in_bed_local_time: '23:30',
    status: 'on_time',
  });

  const manualReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validSessionToken}`,
    },
    body: JSON.stringify({
      memberId: testMemberId,
      mode: 'manual',
      cycleDate: testPastCycle,
      wokeUpTime: '07:15',
    }),
  });
  const manualRes = await handleWakeUpPost(manualReq);
  const manualJson = await manualRes.json();

  testAssert(manualRes.status === 200, 'Manual wake-up on valid cycle date returns HTTP 200');
  testAssert(manualJson.sleep_log?.wake_source === 'manual', 'Wake source is recorded as "manual"');
  testAssert(manualJson.sleep_log?.woke_up_local_time === '07:15', 'woke_up_local_time matches manual input 07:15');
  // 23:30 to 07:15 = 465 minutes (7h 45m)
  testAssert(manualJson.duration_minutes === 465, 'Cross-midnight sleep duration computed accurately (465 minutes = 7h 45m)');
  testAssert(manualJson.formatted_duration === '7h 45m', 'Formatted duration string matches "7h 45m"');

  // 3C. Rejection of cycle dates older than 7 days
  const oldCycleDate = DateTime.utc().setZone(testTz).minus({ days: 10 }).toISODate();
  const oldCycleReq = new Request('http://localhost:3000/api/members/wake-up', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validSessionToken}`,
    },
    body: JSON.stringify({
      memberId: testMemberId,
      mode: 'manual',
      cycleDate: oldCycleDate,
      wokeUpTime: '08:00',
    }),
  });
  const oldCycleRes = await handleWakeUpPost(oldCycleReq);
  testAssert(oldCycleRes.status === 400, 'Cycle dates older than 7 days rejected with HTTP 400');

  // -------------------------------------------------------------
  // 4. Sleep History API Route (GET /api/members/sleep-history)
  // -------------------------------------------------------------
  console.log('\n--- 4. Sleep History API (GET /api/members/sleep-history) ---');

  // 4A. Missing memberId parameter
  const missingMemReq = new Request('http://localhost:3000/api/members/sleep-history');
  const missingMemRes = await handleSleepHistoryGet(missingMemReq);
  testAssert(missingMemRes.status === 400, 'Missing memberId parameter rejected with HTTP 400');

  // 4B. Non-existent member
  const nonExistentReq = new Request('http://localhost:3000/api/members/sleep-history?memberId=non_existent_123');
  const nonExistentRes = await handleSleepHistoryGet(nonExistentReq);
  testAssert(nonExistentRes.status === 404, 'Non-existent member returns HTTP 404');

  // 4C. Valid member history fetch with computed summary
  const currentMonth = DateTime.utc().setZone(testTz).toFormat('yyyy-MM');
  const historyReq = new Request(
    `http://localhost:3000/api/members/sleep-history?memberId=${testMemberId}&month=${currentMonth}`
  );
  const historyRes = await handleSleepHistoryGet(historyReq);
  const historyJson = await historyRes.json();

  testAssert(historyRes.status === 200, 'Sleep history returns HTTP 200');
  testAssert(historyJson.member?.name === 'SleepyFoxDev', 'Returns correct member name');
  testAssert(historyJson.member?.timezone === testTz, 'Returns correct member timezone');
  testAssert(Array.isArray(historyJson.logs), 'Returns logs array');
  testAssert(historyJson.summary !== undefined, 'Returns summary statistics object');
  testAssert(typeof historyJson.summary.totalLoggedNights === 'number', 'Summary has totalLoggedNights count');
  testAssert(typeof historyJson.summary.onTimePercentage === 'number', 'Summary has onTimePercentage');
  testAssert(historyJson.summary.avgBedtime !== null, 'Summary has avgBedtime calculated');
  testAssert(historyJson.summary.avgWakeTime !== null, 'Summary has avgWakeTime calculated');

  // -------------------------------------------------------------
  // 5. Sleep Engine Immediate State Transition & needsWakeUpLog
  // -------------------------------------------------------------
  console.log('\n--- 5. Sleep Engine Immediate State Transitions ---');

  const testCycleDate = '2026-11-12';
  const sleeperNowMorning = DateTime.fromISO('2026-11-12T07:15:00', { zone: testTz });

  // 5A. Member in bed, wake-up NOT logged yet
  const memberInBedWithoutWake = {
    ...mockTestMember,
    is_in_bed: true,
    last_wake_cycle_date: null,
  };
  const stateInBed = computeMemberState(
    memberInBedWithoutWake,
    testTz,
    sleeperNowMorning.toUTC(),
    true
  );
  testAssert(stateInBed.bucket === 'SLEEPING', 'Member in bed is in SLEEPING bucket');
  testAssert(stateInBed.isSleepShieldActive === true, 'Sleep Shield is ACTIVE while in bed');
  testAssert(stateInBed.needsWakeUpLog === true, 'needsWakeUpLog is TRUE when wake-up has not been logged');

  // 5B. Member logs wake-up for current cycle
  const memberWokeUp = {
    ...mockTestMember,
    is_in_bed: false,
    last_woke_up_at: sleeperNowMorning.toUTC().toISO(),
    last_wake_cycle_date: '2026-11-11', // Morning of Nov 12 concludes Nov 11 cycle
  };
  const stateWokeUp = computeMemberState(
    memberWokeUp,
    testTz,
    sleeperNowMorning.toUTC(),
    false
  );
  testAssert(stateWokeUp.bucket === 'AWAKE', 'Logging wake-up immediately transitions to AWAKE');
  testAssert(stateWokeUp.isSleepShieldActive === false, 'Sleep Shield deactivated upon wake-up');
  testAssert(stateWokeUp.needsWakeUpLog === false, 'needsWakeUpLog is FALSE once wake-up is logged');

  // -------------------------------------------------------------
  // 6. UI Components & Touch UX Verification
  // -------------------------------------------------------------
  console.log('\n--- 6. UI Components & Touch UX Verification ---');

  // 6A. SleepCalendarModal component
  const modalPath = path.resolve('src/components/SleepCalendarModal.tsx');
  testAssert(fs.existsSync(modalPath), 'SleepCalendarModal.tsx exists');
  const modalContent = fs.readFileSync(modalPath, 'utf8');

  testAssert(modalContent.includes('grid-cols-7'), 'Calendar renders 7-column day grid (Mon-Sun)');
  testAssert(modalContent.includes('min-h-[48px]'), 'Calendar day cells enforce >= 48px touch targets');
  testAssert(modalContent.includes('Avg Sleep') || modalContent.includes('avgDurationMinutes'), 'Renders average sleep duration pill');
  testAssert(modalContent.includes('Avg Bed') || modalContent.includes('avgBedtime'), 'Renders average bedtime/wake pill');
  testAssert(modalContent.includes('On-Time') || modalContent.includes('onTimePercentage'), 'Renders on-time rate pill');
  testAssert(modalContent.includes('wokeUpTime') && modalContent.includes('type="time"'), 'Provides manual wake time picker for self-editing');

  // 6B. MemberCard component wake-up & calendar actions
  const memberCardContent = fs.readFileSync(path.resolve('src/components/MemberCard.tsx'), 'utf8');
  testAssert(memberCardContent.includes('I Woke Up') || memberCardContent.includes('☀️'), 'MemberCard renders "☀️ I Woke Up" button');
  testAssert(memberCardContent.includes('Enter Time'), 'MemberCard provides "Enter Time" manual wake picker');
  testAssert(memberCardContent.includes('History') || memberCardContent.includes('onOpenSleepCalendar'), 'MemberCard wires up sleep history calendar trigger');
  testAssert(memberCardContent.includes('min-h-[44px]'), 'MemberCard buttons enforce >= 44px touch targets');

  // 6C. Page hero banner controls & calendar modal wiring
  const pageContent = fs.readFileSync(path.resolve('src/app/page.tsx'), 'utf8');
  testAssert(pageContent.includes('SleepCalendarModal'), 'page.tsx imports and renders SleepCalendarModal');
  testAssert(pageContent.includes('I Woke Up') || pageContent.includes('☀️'), 'page.tsx hero banner provides "☀️ I Woke Up" button');
  testAssert(pageContent.includes('handleWakeUp'), 'page.tsx implements handleWakeUp action handler');

  // 6D. MyScheduleModal history trigger
  const scheduleContent = fs.readFileSync(path.resolve('src/components/MyScheduleModal.tsx'), 'utf8');
  testAssert(scheduleContent.includes('onOpenSleepCalendar'), 'MyScheduleModal accepts onOpenSleepCalendar prop');
  testAssert(scheduleContent.includes('Calendar') || scheduleContent.includes('History'), 'MyScheduleModal provides calendar trigger button');

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n============================================================');
  if (failed) {
    console.error('❌ SOME TESTS FAILED in test-sleep-history-and-wakeup.mjs');
    process.exit(1);
  } else {
    console.log('🎉 ALL "I WOKE UP" & SLEEP HISTORY TESTS PASSED CLEANLY! ☀️📅');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
