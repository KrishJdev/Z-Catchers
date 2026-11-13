import assert from 'assert';
import { DateTime, Settings } from 'luxon';

// Ensure Supabase configuration is present prior to importing db.ts
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-test-db.supabase.co';
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key-test-durability';
}

const {
  upsertSleepLog,
  getMemberSleepLogs,
  clearInMemorySleepLogs,
  setInMemoryMember,
  clearInMemoryMembers,
  isTestMemberFixture,
  isSupabaseConfigured,
  supabaseAdmin,
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

// Freeze Luxon clock to a fixed reference time (10:50:44 AM IST on 2026-11-13)
// so all route tests, date guards, and cycle resolutions remain 100% deterministic on every run.
const originalNow = Settings.now;
const FIXED_CLOCK_ISO = '2026-11-13T10:50:44.000+05:30';
const fixedReferenceDt = DateTime.fromISO(FIXED_CLOCK_ISO);
const fixedNowMillis = fixedReferenceDt.toMillis();
Settings.now = () => fixedNowMillis;

async function run() {
  try {
    clearInMemorySleepLogs();
    clearInMemoryMembers();

    // Test Member 1: Krish in Asia/Kolkata (GMT+05:30) with 02:00 AM bedtime, 08:30 AM wake time
    const testMemberId = 'mem_krish_wake_test_fixture';
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
      created_at: new Date(fixedNowMillis).toISOString(),
      updated_at: new Date(fixedNowMillis).toISOString(),
    };

    setInMemoryMember(mockKrishMember);

    // --------------------------------------------------------------------------
    // 1. Storage Fallback & Schema Cache Resilience
    // --------------------------------------------------------------------------
    console.log('--- 1. Storage Fallback & Schema Cache Resilience ---');

    // 1A. Standard fixture member upsert
    const cycleDate = '2026-11-12';
    const { data: logEntry, error: logErr, isDurable: isFixtureDurable } = await upsertSleepLog({
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

    testAssert(!logErr && logEntry !== null, 'upsertSleepLog succeeds and returns non-null data for fixture');
    testAssert(logEntry?.cycle_date === cycleDate, 'upsertSleepLog saves cycle_date correctly');
    testAssert(logEntry?.duration_minutes === 375, 'upsertSleepLog duration_minutes is preserved');

    const { data: retrievedLogs } = await getMemberSleepLogs(testMemberId, cycleDate, cycleDate);
    testAssert(retrievedLogs && retrievedLogs.length === 1, 'getMemberSleepLogs retrieves the saved log');
    testAssert(retrievedLogs?.[0].woke_up_local_time === '08:30', 'getMemberSleepLogs returns accurate woke_up_local_time');

    // 1B. Non-fixture member ID test with stubbed pre-read PGRST205 error
    console.log('\n--- 1B. Non-Fixture PGRST205 Schema Cache Graceful Degradation ---');
    const stubNonFixtureId = 'usr_prod_krish_non_fixture';
    testAssert(isTestMemberFixture(stubNonFixtureId) === false, 'stubNonFixtureId is not classified as a test fixture');
    testAssert(isSupabaseConfigured === true, 'isSupabaseConfigured is true prior to test');

    const originalFrom = supabaseAdmin.from;
    let stubUpsertAttempted = false;

    // Stub supabaseAdmin.from to intercept sleep_logs queries without live network access
    supabaseAdmin.from = (table) => {
      if (table === 'sleep_logs') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: {
                    code: 'PGRST205',
                    message: "Could not find the table 'public.sleep_logs' in the schema cache",
                  },
                }),
              }),
            }),
          }),
          upsert: () => {
            stubUpsertAttempted = true;
            return {
              select: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            };
          },
        };
      }
      return originalFrom.call(supabaseAdmin, table);
    };

    try {
      const { data: nonFixtureData, error: nonFixtureErr, isDurable: nonFixtureDurable } = await upsertSleepLog({
        member_id: stubNonFixtureId,
        cycle_date: '2026-11-12',
        timezone: testTz,
        target_bedtime: '02:00',
        target_wake_time: '08:30',
        woke_up_local_time: '08:30',
        duration_minutes: 390,
      });

      testAssert(nonFixtureErr === null, 'PGRST205 pre-read returns null error');
      testAssert(nonFixtureData !== null, 'PGRST205 pre-read returns non-null fallback data');
      testAssert(nonFixtureDurable === false, 'isDurable is strictly false under schema cache failure');
      testAssert(stubUpsertAttempted === false, 'No durable upsert is attempted when pre-read schema check fails');
      testAssert(nonFixtureData?.duration_minutes === 390, 'Fallback record preserves duration_minutes in memory');
    } finally {
      supabaseAdmin.from = originalFrom;
    }

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

    // 3B. Button mode with mismatched historical cycleDate must be rejected with 400
    const historicalButtonReq = new Request('http://localhost:3000/api/members/wake-up', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ memberId: testMemberId, mode: 'button', cycleDate: '2026-11-10' }),
    });
    const historicalButtonRes = await handleWakeUpPost(historicalButtonReq);
    testAssert(historicalButtonRes.status === 400, 'Button mode with mismatched historical cycleDate returns HTTP 400');

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

    // 4A. Valid manual entry: user woke up at 08:30 AM for cycle 2026-11-12
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

    testAssert(validManualRes.status === 200, 'Valid manual wake-up time returns HTTP 200 independently of execution date');
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
        cycleDate: fixedReferenceDt.setZone(testTz).plus({ days: 1 }).toISODate(),
      }),
    });

    const futureManualRes = await handleWakeUpPost(futureManualReq);
    testAssert(futureManualRes.status === 400, 'Future wake-up time is rejected with HTTP 400');

    // 4C. Historical cycle older than 7 days rejected
    const staleManualReq = new Request('http://localhost:3000/api/members/wake-up', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        memberId: testMemberId,
        mode: 'manual',
        wokeUpTime: '08:30',
        cycleDate: '2026-11-01',
      }),
    });
    const staleManualRes = await handleWakeUpPost(staleManualReq);
    testAssert(staleManualRes.status === 400, 'Manual wake-up for cycle older than 7 days is rejected with HTTP 400');

  } finally {
    // Always restore the Luxon clock
    Settings.now = originalNow;
  }

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
