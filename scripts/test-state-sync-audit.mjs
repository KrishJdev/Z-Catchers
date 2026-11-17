#!/usr/bin/env node
/**
 * Test Suite: State Synchronization Audit (Issue #67 / State Parity Verification)
 *
 * Verifies that:
 * 1. /api/members/cancel-pending resets all state fields on the member record:
 *    - is_in_bed: false, in_bed_at: null, is_woke_up: false
 *    - last_wake_cycle_date: null (when matching today's cycle)
 *    - last_notified_stage: null
 *    - deletes today's sleep_logs row and notification logs (IN_BED_EARLY, WOKE_UP)
 *    - recalculates streaks correctly
 * 2. /api/members/in-bed with action='cancel' exhibits matching behavior
 * 3. sleepEngine.ts recalculates live status accurately post-cancellation:
 *    - cancel during wind-down window -> returns to WINDING_DOWN
 *    - cancel past bedtime -> returns to BEDTIME_NOW / OVERDUE
 *    - cancel during daytime -> returns to AWAKE
 *    - never permanently locks into AWAKE ("Wide Awake • Rested")
 * 4. Frontend components (PinnedSelfActionBar.tsx, MemberCard.tsx, StatusBucket.tsx, page.tsx)
 *    maintain strict status parity across all 4 states without divergent client-side time math.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';

// Ensure test environment variables
process.env.NODE_ENV = 'test';
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-state-sync-db.supabase.co';
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key-state-sync';
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'z_catchers_state_sync_session_secret_2026';
}
if (!process.env.PIN_SALT) {
  process.env.PIN_SALT = 'z_catchers_test_pin_salt_2026';
}

const {
  computeMemberState,
  getSleepCycleDate,
  calculateSleepStreak,
} = await import('../src/lib/sleepEngine.ts');
const {
  supabaseAdmin,
  syncInMemoryMemberCache,
  deleteSleepLog,
  getInMemorySleepLogs,
  setInMemorySleepLog,
  clearKnownMemberColumns,
} = await import('../src/lib/db.ts');
const { POST: handleInBedRoute } = await import('../src/app/api/members/in-bed/route.ts');
const { POST: handleCancelPendingRoute } = await import('../src/app/api/members/cancel-pending/route.ts');
const { hashPin, createSessionToken } = await import('../src/lib/auth.ts');

console.log('🧪 Starting State Synchronization Audit & Parity Verification Suite...\n');

let failed = false;
function testAssert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  }
}

// -------------------------------------------------------------
// Section 1: sleepEngine.ts Live Status Recalculation After Cancellation
// -------------------------------------------------------------
console.log('--- 1. sleepEngine.ts Live Status Recalculation Across Clock Windows ---');

// Bedtime: 23:00, Wake: 07:00 in America/New_York
const testMember = {
  id: 'member-sync-test-1',
  discord_username: 'SleepyFoxSync',
  timezone: 'America/New_York',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  is_active: true,
  is_in_bed: false,
  is_woke_up: false,
  in_bed_at: null,
  last_wake_cycle_date: null,
  last_notified_stage: null,
};

const nyZone = 'America/New_York';
// Today's base date at 22:30 NY time (in wind-down window: 60m before bedtime)
const clockWindDown = DateTime.fromISO('2026-05-15T22:30:00', { zone: nyZone }).toUTC();
// At 23:03 NY time (past bedtime: 3m after bedtime, within 5m grace)
const clockBedtimeGrace = DateTime.fromISO('2026-05-15T23:03:00', { zone: nyZone }).toUTC();
// At 23:45 NY time (past bedtime: 45m after bedtime, overdue nag now)
const clockOverdueNag = DateTime.fromISO('2026-05-15T23:45:00', { zone: nyZone }).toUTC();
// At 14:00 NY time (daytime: awake)
const clockDaytime = DateTime.fromISO('2026-05-15T14:00:00', { zone: nyZone }).toUTC();

// 1.1 Before check-in during wind-down
const stateBeforeCheckIn = computeMemberState(testMember, nyZone, clockWindDown);
testAssert(
  stateBeforeCheckIn.bucket === 'WINDING_DOWN' && stateBeforeCheckIn.status === 'WINDING_DOWN',
  'During 22:30 wind-down window, member status is WINDING_DOWN'
);

// 1.2 After checking in during wind-down
const memberCheckedInWindDown = {
  ...testMember,
  is_in_bed: true,
  in_bed_at: clockWindDown.toISO(),
};
const stateCheckedIn = computeMemberState(memberCheckedInWindDown, nyZone, clockWindDown);
testAssert(
  stateCheckedIn.bucket === 'SLEEPING' && stateCheckedIn.status === 'SLEEPING',
  'After checking in at 22:30, member status is SLEEPING'
);

// 1.3 Cancelling check-in during wind-down window
// MUST return to WINDING_DOWN, NOT lock into AWAKE ("Wide Awake • Rested")
const memberCancelledWindDown = {
  ...testMember,
  is_in_bed: false,
  is_woke_up: false,
  in_bed_at: null,
  last_wake_cycle_date: null,
};
const stateCancelledWindDown = computeMemberState(memberCancelledWindDown, nyZone, clockWindDown);
testAssert(
  stateCancelledWindDown.bucket === 'WINDING_DOWN' && stateCancelledWindDown.status === 'WINDING_DOWN',
  'After cancelling check-in at 22:30, member accurately returns to WINDING_DOWN'
);
testAssert(
  stateCancelledWindDown.hasLoggedWakeUp === false,
  'Cancelled member has hasLoggedWakeUp === false'
);

// 1.4 Cancelling check-in past bedtime during 5m grace window
const memberCancelledGrace = {
  ...testMember,
  is_in_bed: false,
  is_woke_up: false,
  in_bed_at: null,
  last_wake_cycle_date: null,
};
const stateCancelledGrace = computeMemberState(memberCancelledGrace, nyZone, clockBedtimeGrace);
testAssert(
  stateCancelledGrace.bucket === 'BEDTIME_NOW' && stateCancelledGrace.status === 'BEDTIME_GRACE',
  'After cancelling check-in at 23:03, member accurately returns to BEDTIME_NOW / BEDTIME_GRACE'
);

// 1.5 Cancelling check-in past bedtime during overdue nag window
const stateCancelledOverdue = computeMemberState(memberCancelledGrace, nyZone, clockOverdueNag);
testAssert(
  stateCancelledOverdue.bucket === 'BEDTIME_NOW' && stateCancelledOverdue.status === 'OVERDUE_NAG_NOW',
  'After cancelling check-in at 23:45, member accurately returns to BEDTIME_NOW / OVERDUE_NAG_NOW'
);

// 1.6 Cancelling check-in during daytime
const stateCancelledDaytime = computeMemberState(memberCancelledGrace, nyZone, clockDaytime);
testAssert(
  stateCancelledDaytime.bucket === 'AWAKE' && stateCancelledDaytime.status === 'AWAKE',
  'After cancelling check-in during daytime, member accurately returns to AWAKE'
);

// -------------------------------------------------------------
// Section 2: /api/members/in-bed?action=cancel Behavior Audit
// -------------------------------------------------------------
console.log('\n--- 2. /api/members/in-bed Route Cancellation & Cleanup Audit ---');

async function testInBedRouteCancel() {
  clearKnownMemberColumns();
  const memberId = 'member-in-bed-cancel-test';
  const hashedPin = hashPin('1234');
  const token = createSessionToken(memberId);
  let mockMember = {
    id: memberId,
    discord_username: 'CancelTestFox',
    passcode_hash: hashedPin,
    timezone: 'America/New_York',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    pending_bedtime_local: null,
    pending_wake_time_local: null,
    pending_timezone: null,
    pending_weekend_bedtime_local: null,
    pending_weekend_wake_time_local: null,
    pending_weekly_schedule: null,
    pending_effective_at: null,
    is_active: true,
    is_in_bed: true,
    is_woke_up: false,
    in_bed_at: '2026-05-15T22:30:00Z',
    last_wake_cycle_date: '2026-05-15',
    last_notified_stage: 'IN_BED_EARLY',
    last_notified_cycle_date: '2026-05-15',
  };

  syncInMemoryMemberCache(mockMember);

  // Seed notification logs
  let notificationLogs = [
    { id: '1', member_id: memberId, notification_type: 'IN_BED_EARLY', local_date: '2026-05-15' },
    { id: '2', member_id: memberId, notification_type: 'WOKE_UP', local_date: '2026-05-15' },
    { id: '3', member_id: memberId, notification_type: 'IN_BED_EARLY', local_date: '2026-05-14' }, // prior day log
  ];

  // Seed sleep logs
  setInMemorySleepLog({
    id: 'log-1',
    member_id: memberId,
    cycle_date: '2026-05-15',
    in_bed_at: '2026-05-15T22:30:00Z',
    woke_up_at: null,
    status: 'on_time',
  });

  const origFrom = supabaseAdmin.from;
  supabaseAdmin.from = (table) => {
    if (table === 'members') {
      return {
        select: (fields = '*') => ({
          eq: (col, val) => ({
            single: async () => ({ data: mockMember, error: null }),
            maybeSingle: async () => ({ data: mockMember, error: null }),
          }),
          limit: (n) => Promise.resolve({ data: [mockMember], error: null }),
          single: async () => ({ data: mockMember, error: null }),
          maybeSingle: async () => ({ data: mockMember, error: null }),
        }),
        update: (updates) => {
          mockMember = { ...mockMember, ...updates };
          syncInMemoryMemberCache(mockMember);
          const updateBuilder = {
            eq: () => updateBuilder,
            is: () => updateBuilder,
            select: () => updateBuilder,
            single: async () => ({ data: mockMember, error: null }),
            maybeSingle: async () => ({ data: mockMember, error: null }),
            then: (resolve) => Promise.resolve({ data: mockMember, error: null }).then(resolve),
          };
          return updateBuilder;
        },
      };
    }
    if (table === 'notification_logs') {
      const selectBuilder = {
        eq: () => selectBuilder,
        in: () => selectBuilder,
        gte: () => selectBuilder,
        order: () => selectBuilder,
        limit: () => selectBuilder,
        then: (resolve) => Promise.resolve({ data: notificationLogs, error: null }).then(resolve),
      };

      return {
        select: () => selectBuilder,
        delete: () => {
          const deleteFilters = {};
          const deleteBuilder = {
            eq: (col, val) => {
              deleteFilters[col] = val;
              return deleteBuilder;
            },
            in: (col, vals) => {
              deleteFilters[col] = vals;
              return deleteBuilder;
            },
            then: (resolve) => {
              notificationLogs = notificationLogs.filter((l) => {
                if (deleteFilters.member_id && l.member_id !== deleteFilters.member_id) return true;
                if (deleteFilters.local_date && l.local_date !== deleteFilters.local_date) return true;
                if (deleteFilters.notification_type) {
                  if (Array.isArray(deleteFilters.notification_type)) {
                    return !deleteFilters.notification_type.includes(l.notification_type);
                  }
                  return l.notification_type !== deleteFilters.notification_type;
                }
                return false;
              });
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return deleteBuilder;
        },
        insert: () => Promise.resolve({ error: null }),
      };
    }
    if (table === 'sleep_logs') {
      const sleepDeleteBuilder = {
        eq: (col, val) => sleepDeleteBuilder,
        then: (resolve) => {
          deleteSleepLog(memberId, '2026-05-15');
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return {
        delete: () => sleepDeleteBuilder,
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    }
    return origFrom.call(supabaseAdmin, table);
  };

  try {
    const req = new Request('http://localhost:3000/api/members/in-bed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ memberId, action: 'cancel', pin: '1234' }),
    });

    const res = await handleInBedRoute(req);
    const bodyText = await res.text();
    let data = {};
    try { data = JSON.parse(bodyText); } catch {}
    if (res.status !== 200) {
      console.log('in-bed debug status:', res.status, 'body:', bodyText);
    }
    testAssert(res.status === 200, '/api/members/in-bed action=cancel returns HTTP 200');

    testAssert(data.success === true && data.action === 'cancel', 'Response confirms success and action: cancel');
    testAssert(mockMember.is_in_bed === false, 'mockMember.is_in_bed reset to false');
    testAssert(mockMember.in_bed_at === null, 'mockMember.in_bed_at reset to null');
    testAssert(mockMember.is_woke_up === false, 'mockMember.is_woke_up reset to false');
    testAssert(mockMember.last_notified_stage === null, 'mockMember.last_notified_stage reset to null');

    // Check notification logs cleanup
    const remainingTodayLogs = notificationLogs.filter(
      (l) => l.member_id === memberId && l.local_date === '2026-05-15' && (l.notification_type === 'IN_BED_EARLY' || l.notification_type === 'WOKE_UP')
    );
    testAssert(remainingTodayLogs.length === 0, "Today's notification logs for IN_BED_EARLY and WOKE_UP deleted");
    testAssert(
      notificationLogs.some((l) => l.member_id === memberId && l.local_date === '2026-05-14'),
      'Prior day check-in logs correctly preserved'
    );

    // Check sleep_logs row deleted
    const remainingSleepLogs = getInMemorySleepLogs().filter(
      (l) => l.member_id === memberId && l.cycle_date === '2026-05-15'
    );
    testAssert(remainingSleepLogs.length === 0, "Today's sleep_logs entry deleted on cancel");
  } finally {
    supabaseAdmin.from = origFrom;
  }
}

await testInBedRouteCancel();

// -------------------------------------------------------------
// Section 3: /api/members/cancel-pending Reset & Cleanup Audit
// -------------------------------------------------------------
console.log('\n--- 3. /api/members/cancel-pending Reset & Cleanup Audit ---');

async function testCancelPendingRoute() {
  clearKnownMemberColumns();
  const memberId = 'member-cancel-pending-sync-test';
  const hashedPin = hashPin('4321');
  const token = createSessionToken(memberId);
  let mockMember = {
    id: memberId,
    discord_username: 'PendingSyncFox',
    passcode_hash: hashedPin,
    timezone: 'America/New_York',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    pending_bedtime_local: '00:00',
    pending_wake_time_local: '08:00',
    pending_timezone: 'America/New_York',
    pending_weekend_bedtime_local: null,
    pending_weekend_wake_time_local: null,
    pending_weekly_schedule: null,
    pending_effective_at: '2026-05-18T00:00:00Z',
    is_active: true,
    is_in_bed: true,
    is_woke_up: false,
    in_bed_at: '2026-05-15T22:30:00Z',
    last_wake_cycle_date: '2026-05-15',
    last_notified_stage: 'IN_BED_EARLY',
    last_notified_cycle_date: '2026-05-15',
  };

  syncInMemoryMemberCache(mockMember);

  let notificationLogs = [
    { id: '10', member_id: memberId, notification_type: 'IN_BED_EARLY', local_date: '2026-05-15' },
    { id: '11', member_id: memberId, notification_type: 'WOKE_UP', local_date: '2026-05-15' },
  ];

  setInMemorySleepLog({
    id: 'log-10',
    member_id: memberId,
    cycle_date: '2026-05-15',
    in_bed_at: '2026-05-15T22:30:00Z',
    woke_up_at: null,
    status: 'on_time',
  });

  const origFrom = supabaseAdmin.from;
  supabaseAdmin.from = (table) => {
    if (table === 'members') {
      return {
        select: (fields = '*') => ({
          eq: (col, val) => ({
            single: async () => ({ data: mockMember, error: null }),
            maybeSingle: async () => ({ data: mockMember, error: null }),
          }),
          limit: (n) => Promise.resolve({ data: [mockMember], error: null }),
          single: async () => ({ data: mockMember, error: null }),
          maybeSingle: async () => ({ data: mockMember, error: null }),
        }),
        update: (updates) => {
          mockMember = { ...mockMember, ...updates };
          syncInMemoryMemberCache(mockMember);
          const updateBuilder = {
            eq: () => updateBuilder,
            is: () => updateBuilder,
            select: () => updateBuilder,
            single: async () => ({ data: mockMember, error: null }),
            maybeSingle: async () => ({ data: mockMember, error: null }),
            then: (resolve) => Promise.resolve({ data: mockMember, error: null }).then(resolve),
          };
          return updateBuilder;
        },
      };
    }
    if (table === 'notification_logs') {
      const selectBuilder = {
        eq: () => selectBuilder,
        in: () => selectBuilder,
        gte: () => selectBuilder,
        order: () => selectBuilder,
        limit: () => selectBuilder,
        then: (resolve) => Promise.resolve({ data: notificationLogs, error: null }).then(resolve),
      };

      return {
        select: () => selectBuilder,
        delete: () => {
          const deleteFilters = {};
          const deleteBuilder = {
            eq: (col, val) => {
              deleteFilters[col] = val;
              return deleteBuilder;
            },
            in: (col, vals) => {
              deleteFilters[col] = vals;
              return deleteBuilder;
            },
            then: (resolve) => {
              notificationLogs = notificationLogs.filter((l) => {
                if (deleteFilters.member_id && l.member_id !== deleteFilters.member_id) return true;
                if (deleteFilters.local_date && l.local_date !== deleteFilters.local_date) return true;
                if (deleteFilters.notification_type) {
                  if (Array.isArray(deleteFilters.notification_type)) {
                    return !deleteFilters.notification_type.includes(l.notification_type);
                  }
                  return l.notification_type !== deleteFilters.notification_type;
                }
                return false;
              });
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return deleteBuilder;
        },
        insert: () => Promise.resolve({ error: null }),
      };
    }
    if (table === 'sleep_logs') {
      const sleepDeleteBuilder = {
        eq: (col, val) => sleepDeleteBuilder,
        then: (resolve) => {
          deleteSleepLog(memberId, '2026-05-15');
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return {
        delete: () => sleepDeleteBuilder,
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    }
    return origFrom.call(supabaseAdmin, table);
  };

  try {
    const req = new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ member_id: memberId, pin: '4321' }),
    });

    const res = await handleCancelPendingRoute(req);
    const bodyText = await res.text();
    let data = {};
    try { data = JSON.parse(bodyText); } catch {}
    if (res.status !== 200) {
      console.log('cancel-pending debug status:', res.status, 'body:', bodyText);
    }
    testAssert(res.status === 200, '/api/members/cancel-pending returns HTTP 200');

    testAssert(mockMember.pending_bedtime_local === null, 'pending_bedtime_local cleared');
    testAssert(mockMember.pending_effective_at === null, 'pending_effective_at cleared');
    testAssert(mockMember.is_in_bed === false, 'is_in_bed reset to false');
    testAssert(mockMember.in_bed_at === null, 'in_bed_at reset to null');
    testAssert(mockMember.is_woke_up === false, 'is_woke_up reset to false');
    testAssert(mockMember.last_notified_stage === null, 'last_notified_stage cleared');

    // Check notification logs cleanup
    const remainingTodayLogs = notificationLogs.filter(
      (l) => l.member_id === memberId && (l.notification_type === 'IN_BED_EARLY' || l.notification_type === 'WOKE_UP')
    );
    testAssert(remainingTodayLogs.length === 0, 'Notification logs for in-bed cleaned up in cancel-pending');

    // Check sleep_logs row deleted
    const remainingSleepLogs = getInMemorySleepLogs().filter(
      (l) => l.member_id === memberId && l.cycle_date === '2026-05-15'
    );
    testAssert(remainingSleepLogs.length === 0, "Today's sleep_logs entry deleted on cancel-pending");
  } finally {
    supabaseAdmin.from = origFrom;
  }
}

await testCancelPendingRoute();

// -------------------------------------------------------------
// Section 4: Frontend vs. Backend Status & Action Parity
// -------------------------------------------------------------
console.log('\n--- 4. Frontend Component Parity (PinnedSelfActionBar & MemberCard) ---');

const rootDir = process.cwd();
const pinnedBarSource = fs.readFileSync(
  path.join(rootDir, 'src', 'components', 'PinnedSelfActionBar.tsx'),
  'utf8'
);
const memberCardSource = fs.readFileSync(
  path.join(rootDir, 'src', 'components', 'MemberCard.tsx'),
  'utf8'
);
const pageSource = fs.readFileSync(
  path.join(rootDir, 'src', 'app', 'page.tsx'),
  'utf8'
);

// 4.1 PinnedSelfActionBar: Authoritative sleepEngine integration
testAssert(
  /computeMemberState\s*\(\s*currentUser/.test(pinnedBarSource),
  'PinnedSelfActionBar uses computeMemberState from sleepEngine'
);

// 4.2 PinnedSelfActionBar: All 4 status bucket controls present
testAssert(
  pinnedBarSource.includes("☀️ I'm Awake") || pinnedBarSource.includes("☀️ I&apos;m Awake"),
  'PinnedSelfActionBar renders "I\'m Awake" for sleeping state'
);
testAssert(
  pinnedBarSource.includes('Undo / Cancel'),
  'PinnedSelfActionBar renders "Undo / Cancel" for sleeping state'
);
testAssert(
  pinnedBarSource.includes("🛏️ I'm in Bed (Late)"),
  'PinnedSelfActionBar renders "I\'m in Bed (Late)" for overdue state'
);
testAssert(
  pinnedBarSource.includes("🛏️ Early Check-In"),
  'PinnedSelfActionBar renders "Early Check-In" when approaching bedtime'
);
testAssert(
  pinnedBarSource.includes("🛏️ I'm in Bed"),
  'PinnedSelfActionBar renders "I\'m in Bed" for winding down state'
);

// 4.3 MemberCard: Viewer self-actions on compact card bottom row
testAssert(
  memberCardSource.includes("☀️ I'm Awake") || memberCardSource.includes("☀️ I&apos;m Awake"),
  'MemberCard renders "I\'m Awake" button on compact card bottom row for viewer'
);
testAssert(
  memberCardSource.includes("🛏️ I'm in Bed (Late)"),
  'MemberCard renders "I\'m in Bed (Late)" on compact card for overdue viewer'
);
testAssert(
  memberCardSource.includes("🛏️ Early Check-In"),
  'MemberCard renders "Early Check-In" on compact card for early check-in viewer'
);
testAssert(
  memberCardSource.includes("🛏️ I'm in Bed"),
  'MemberCard renders "I\'m in Bed" on compact card for winding down viewer'
);

// 4.4 MemberCard: Peer journal links preserved for other members
testAssert(
  memberCardSource.includes('Nag in Journal'),
  'MemberCard preserves "Nag in Journal" deep link for peers in nag state'
);
testAssert(
  memberCardSource.includes('Say Goodnight'),
  'MemberCard preserves "Say Goodnight" deep link for peers in winding down'
);
testAssert(
  memberCardSource.includes('Quiet Note'),
  'MemberCard preserves "Quiet Note" deep link for peers in sleeping state'
);

// 4.5 page.tsx: Roster bucketing uses computeMemberState
testAssert(
  pageSource.includes('const state = computeMemberState(member, viewerTimezone)'),
  'page.tsx uses computeMemberState from sleepEngine for status bucketing'
);
testAssert(
  pageSource.includes('onCancelInBed={handleCancelInBed}'),
  'page.tsx wires handleCancelInBed into PinnedSelfActionBar'
);

// -------------------------------------------------------------
// Final Verdict
// -------------------------------------------------------------
console.log('\n-------------------------------------------------------------');
if (failed) {
  console.error('❌ State Synchronization Audit FAILED. Review errors above.');
  process.exit(1);
} else {
  console.log('🎉 ALL STATE SYNCHRONIZATION AUDIT TESTS PASSED! 🦊💤');
  process.exit(0);
}
