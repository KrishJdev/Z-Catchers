import assert from 'assert';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';
import { computeMemberState } from '../src/lib/sleepEngine.ts';

console.log('🧪 Starting Wind-Down Status for Awake Members Unit Verification...\n');

// 1. Mock Member Setup: Bedtime at 02:00 AM in GMT+05:30 (Cycle Date: previous evening)
const mockMember = {
  id: 'krishhh-test-id',
  discord_username: 'Krishhh',
  discord_handle: 'Krishhh#0001',
  avatar_url: null,
  journal_url: 'https://discord.com/channels/123456789/987654321',
  bedtime_local: '02:00',
  wake_time_local: '10:00',
  timezone: 'GMT+05:30',
  role: 'member',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// -------------------------------------------------------------
// Test Case 1: T - 8 minutes before bedtime with is_woke_up = true
// (Exact user scenario: 1:52:29 AM GMT+05:30 for 02:00 AM bedtime)
// -------------------------------------------------------------
console.log('--- 1. Wind-Down Window (-60m to 0m) Evaluation ---');
const timeTMinus8m = DateTime.fromISO('2026-11-13T01:52:29', { zone: 'UTC+05:30' }).toUTC();

const stateWindDownWithWokeUp = computeMemberState(
  { ...mockMember, is_in_bed: false, is_woke_up: true },
  'GMT+05:30',
  timeTMinus8m
);

assert.strictEqual(
  stateWindDownWithWokeUp.bucket,
  'WINDING_DOWN',
  'Member with is_woke_up=true at T-8m must be placed in WINDING_DOWN bucket'
);
assert.strictEqual(
  stateWindDownWithWokeUp.status,
  'WINDING_DOWN',
  'Member status must be WINDING_DOWN'
);
assert.strictEqual(
  stateWindDownWithWokeUp.statusText,
  'Bedtime in 8m',
  'Status text must display minutes remaining until bedtime'
);
assert.strictEqual(
  stateWindDownWithWokeUp.isSleepShieldActive,
  false,
  'Sleep Shield must be off during wind-down when not in bed'
);
console.log('✅ PASSED: Member with is_woke_up=true is correctly placed in WINDING_DOWN at T-8m.');

// -------------------------------------------------------------
// Test Case 2: T - 30 minutes before bedtime with last_wake_cycle_date set
// -------------------------------------------------------------
const timeTMinus30m = DateTime.fromISO('2026-11-13T01:30:00', { zone: 'UTC+05:30' }).toUTC();

const stateWindDownWithCycleDate = computeMemberState(
  { ...mockMember, is_in_bed: false, is_woke_up: false, last_wake_cycle_date: '2026-11-12' },
  'GMT+05:30',
  timeTMinus30m
);

assert.strictEqual(
  stateWindDownWithCycleDate.bucket,
  'WINDING_DOWN',
  'Member with last_wake_cycle_date at T-30m must be placed in WINDING_DOWN bucket'
);
assert.strictEqual(
  stateWindDownWithCycleDate.statusText,
  'Bedtime in 30m',
  'Status text must display Bedtime in 30m'
);
console.log('✅ PASSED: Member with last_wake_cycle_date set is correctly placed in WINDING_DOWN at T-30m.');

// -------------------------------------------------------------
// Test Case 3: Checked into bed early during wind-down window
// -------------------------------------------------------------
console.log('\n--- 2. In-Bed Early Check-In Precedence ---');
const stateInBedEarly = computeMemberState(
  { ...mockMember, is_in_bed: true, is_woke_up: false },
  'GMT+05:30',
  timeTMinus8m
);

assert.strictEqual(
  stateInBedEarly.bucket,
  'SLEEPING',
  'Member who checked in early at T-8m must be in SLEEPING bucket'
);
assert.strictEqual(
  stateInBedEarly.isSleepShieldActive,
  true,
  'Sleep Shield must be active for in-bed member'
);
console.log('✅ PASSED: In-Bed check-in takes precedence during wind-down.');

// -------------------------------------------------------------
// Test Case 4: More than 60m before bedtime (T - 90m) remains AWAKE
// -------------------------------------------------------------
console.log('\n--- 3. Outside Wind-Down Window (> 60m before bedtime) ---');
const timeTMinus90m = DateTime.fromISO('2026-11-13T00:30:00', { zone: 'UTC+05:30' }).toUTC();

const stateAwakeBeforeWindDown = computeMemberState(
  { ...mockMember, is_in_bed: false, is_woke_up: true },
  'GMT+05:30',
  timeTMinus90m
);

assert.strictEqual(
  stateAwakeBeforeWindDown.bucket,
  'AWAKE',
  'Member at T-90m must be in AWAKE bucket'
);
console.log('✅ PASSED: Member at T-90m is in AWAKE bucket.');

// -------------------------------------------------------------
// Test Case 5: Waking up after bedtime (T + 30m) transitions to AWAKE
// -------------------------------------------------------------
console.log('\n--- 4. Post-Bedtime Wake-Up Transitions ---');
const timeTPlus30m = DateTime.fromISO('2026-11-13T02:30:00', { zone: 'UTC+05:30' }).toUTC();

const stateWokeUpAfterBedtime = computeMemberState(
  { ...mockMember, is_in_bed: false, is_woke_up: true },
  'GMT+05:30',
  timeTPlus30m
);

assert.strictEqual(
  stateWokeUpAfterBedtime.bucket,
  'AWAKE',
  'Member who woke up at T+30m transitions to AWAKE bucket'
);
console.log('✅ PASSED: Member waking up after bedtime transitions to AWAKE.');

// -------------------------------------------------------------
// Test Case 6: Component UI Status Pill Order Verification
// -------------------------------------------------------------
console.log('\n--- 5. MemberCard Status Pill Hierarchy Verification ---');
const memberCardPath = path.join(process.cwd(), 'src/components/MemberCard.tsx');
const memberCardContent = fs.readFileSync(memberCardPath, 'utf8');

assert.match(memberCardContent, /const isWindingDown = bucket === 'WINDING_DOWN'/);
assert.match(memberCardContent, /else if \(isWindingDown\) \{[\s\S]*?statusLabel = /,
  'The card renders the wind-down countdown from the resolved bucket');

// -------------------------------------------------------------
// Test Case 7: Early Wake-Up 2 Hours Before Scheduled Wake Time
// (Requirement: User wakes up early before wake_time and must remain AWAKE)
// -------------------------------------------------------------
console.log('\n--- 6. Early Wake-Up 2 Hours Before Scheduled Wake Time ---');
const standardMember = {
  id: 'standard-early-wake-member',
  discord_username: 'EarlyFox',
  discord_handle: 'EarlyFox#0001',
  avatar_url: null,
  journal_url: 'https://discord.com/channels/123456789/987654321',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  timezone: 'America/New_York',
  role: 'member',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// Night of 2026-11-16: Bedtime 23:00, Wake time 2026-11-17 07:00
// Checked in at 23:00, woke up at 05:00 AM (2 hours before 07:00 AM scheduled wake time)
const earlyWakeMember = {
  ...standardMember,
  in_bed_at: '2026-11-16T23:00:00.000-05:00',
  last_woke_up_at: '2026-11-17T05:00:00.000-05:00',
  last_wake_cycle_date: '2026-11-16',
  is_in_bed: false,
  is_woke_up: true,
};

// Evaluate at 05:05 AM (5 minutes after wake-up, still ~2 hours before 07:00 wake_time)
const timeEarlyWake5m = DateTime.fromISO('2026-11-17T05:05:00', { zone: 'America/New_York' }).toUTC();
const stateEarlyWake5m = computeMemberState(earlyWakeMember, 'America/New_York', timeEarlyWake5m);

assert.strictEqual(
  stateEarlyWake5m.bucket,
  'AWAKE',
  'Member waking up 2 hours before scheduled wake_time must be placed in AWAKE bucket at 05:05'
);
assert.strictEqual(
  stateEarlyWake5m.status,
  'AWAKE',
  'Member status must be AWAKE at 05:05'
);
assert.strictEqual(
  stateEarlyWake5m.isOverdue,
  false,
  'Member must NOT be overdue when waking up before wake_time'
);
assert.strictEqual(
  stateEarlyWake5m.isSleepShieldActive,
  false,
  'Sleep Shield must be deactivated upon early wake-up'
);
assert.strictEqual(
  stateEarlyWake5m.needsWakeUpLog,
  false,
  'needsWakeUpLog must be false once wake-up is completed'
);
console.log('✅ PASSED: Member waking up 2h before wake_time is AWAKE at 05:05 with no snap-back to sleeping/overdue.');

// Evaluate at 05:30 AM (1.5 hours before 07:00 wake_time)
const timeEarlyWake30m = DateTime.fromISO('2026-11-17T05:30:00', { zone: 'America/New_York' }).toUTC();
const stateEarlyWake30m = computeMemberState(earlyWakeMember, 'America/New_York', timeEarlyWake30m);

assert.strictEqual(
  stateEarlyWake30m.bucket,
  'AWAKE',
  'Member must remain in AWAKE bucket at 05:30'
);
assert.strictEqual(
  stateEarlyWake30m.isOverdue,
  false,
  'Member must NOT snap back into overdue at 05:30'
);
console.log('✅ PASSED: Member remains AWAKE at 05:30 (1.5h before scheduled wake_time).');

// Evaluate at 06:45 AM (15 minutes before 07:00 wake_time)
const timeEarlyWakePreWake = DateTime.fromISO('2026-11-17T06:45:00', { zone: 'America/New_York' }).toUTC();
const stateEarlyWakePreWake = computeMemberState(earlyWakeMember, 'America/New_York', timeEarlyWakePreWake);

assert.strictEqual(
  stateEarlyWakePreWake.bucket,
  'AWAKE',
  'Member must remain in AWAKE bucket at 06:45'
);
assert.strictEqual(
  stateEarlyWakePreWake.isOverdue,
  false,
  'Member must NOT snap back into overdue at 06:45'
);
console.log('✅ PASSED: Member remains AWAKE at 06:45 (15m before scheduled wake_time).');

// -------------------------------------------------------------
// Test Case 8: Check-In During Wind-Down + Early Wake-Up Before Bedtime
// (Requirement: User checks in at T-30m, wakes up at T-15m, stays AWAKE)
// -------------------------------------------------------------
console.log('\n--- 7. Check-In During Wind-Down & Early Wake-Up Before Bedtime ---');

// Bedtime: 23:00. Check-in at 22:30 (T - 30m). Wakes up at 22:45 (T - 15m before bedtime).
const windDownEarlyWakeMember = {
  ...standardMember,
  in_bed_at: '2026-11-16T22:30:00.000-05:00',
  last_woke_up_at: '2026-11-16T22:45:00.000-05:00',
  last_wake_cycle_date: '2026-11-16',
  is_in_bed: false,
  is_woke_up: true,
};

// Evaluate at 22:46 (14m before bedtime, still inside the scheduled wind-down window)
const timePreBedtime14m = DateTime.fromISO('2026-11-16T22:46:00', { zone: 'America/New_York' }).toUTC();
const statePreBedtime14m = computeMemberState(windDownEarlyWakeMember, 'America/New_York', timePreBedtime14m);

assert.strictEqual(
  statePreBedtime14m.bucket,
  'AWAKE',
  'Member who woke up at T-15m must NOT revert to WINDING_DOWN at T-14m'
);
assert.strictEqual(
  statePreBedtime14m.status,
  'AWAKE',
  'Member status must be AWAKE at T-14m'
);
assert.strictEqual(
  statePreBedtime14m.isOverdue,
  false,
  'Member must NOT be overdue at T-14m'
);
console.log('✅ PASSED: Member who woke up early before bedtime does NOT revert to WINDING_DOWN.');

// Evaluate at 23:05 (+5 minutes after scheduled bedtime, inside grace window)
const timePostBedtime5m = DateTime.fromISO('2026-11-16T23:05:00', { zone: 'America/New_York' }).toUTC();
const statePostBedtime5m = computeMemberState(windDownEarlyWakeMember, 'America/New_York', timePostBedtime5m);

assert.strictEqual(
  statePostBedtime5m.bucket,
  'AWAKE',
  'Member who completed sleep cycle must NOT revert to BEDTIME_GRACE / BEDTIME_NOW at 23:05'
);
assert.strictEqual(
  statePostBedtime5m.isOverdue,
  false,
  'isOverdue must be false for completed sleep cycle'
);
console.log('✅ PASSED: Member who completed sleep cycle does NOT revert to BEDTIME_GRACE / BEDTIME_NOW after bedtime.');

// Evaluate at 01:00 AM (2 hours into scheduled sleep window)
const timeOvernight1am = DateTime.fromISO('2026-11-17T01:00:00', { zone: 'America/New_York' }).toUTC();
const stateOvernight1am = computeMemberState(windDownEarlyWakeMember, 'America/New_York', timeOvernight1am);

assert.strictEqual(
  stateOvernight1am.bucket,
  'AWAKE',
  'Member who completed sleep cycle must NOT revert to SLEEPING or OVERDUE overnight'
);
assert.strictEqual(
  stateOvernight1am.isOverdue,
  false,
  'isOverdue must remain false throughout night'
);
console.log('✅ PASSED: Member who completed sleep cycle remains cleanly AWAKE throughout scheduled sleep window.');

// -------------------------------------------------------------
// Test Case 9: Post-Midnight Bedtime Early Check-In & Early Wake-Up
// (Bedtime: 02:00 AM, Wake Time: 10:00 AM in GMT+05:30)
// -------------------------------------------------------------
console.log('\n--- 8. Post-Midnight Bedtime Early Check-In & Wake-Up ---');
// Cycle date for 02:00 AM bedtime on 2026-11-13 is '2026-11-12'
// Checked in at 01:30 AM (T - 30m), woke up at 01:45 AM (T - 15m before 02:00 AM bedtime)
const postMidnightWakeMember = {
  ...mockMember,
  in_bed_at: '2026-11-13T01:30:00.000+05:30',
  last_woke_up_at: '2026-11-13T01:45:00.000+05:30',
  last_wake_cycle_date: '2026-11-12',
  is_in_bed: false,
  is_woke_up: true,
};

// Evaluate at 01:46 AM (T - 14m before post-midnight bedtime)
const timePostMidnight14m = DateTime.fromISO('2026-11-13T01:46:00', { zone: 'UTC+05:30' }).toUTC();
const statePostMidnight14m = computeMemberState(postMidnightWakeMember, 'GMT+05:30', timePostMidnight14m);

assert.strictEqual(
  statePostMidnight14m.bucket,
  'AWAKE',
  'Post-midnight member waking up before bedtime must be AWAKE at 01:46 AM'
);
assert.strictEqual(
  statePostMidnight14m.isOverdue,
  false,
  'Must not be overdue at 01:46 AM'
);

// Evaluate at 02:15 AM (15m after post-midnight bedtime)
const timePostMidnightAfterBedtime = DateTime.fromISO('2026-11-13T02:15:00', { zone: 'UTC+05:30' }).toUTC();
const statePostMidnightAfterBedtime = computeMemberState(postMidnightWakeMember, 'GMT+05:30', timePostMidnightAfterBedtime);

assert.strictEqual(
  statePostMidnightAfterBedtime.bucket,
  'AWAKE',
  'Post-midnight member who completed sleep cycle must remain AWAKE at 02:15 AM'
);
assert.strictEqual(
  statePostMidnightAfterBedtime.isOverdue,
  false,
  'Must not revert to overdue at 02:15 AM'
);

// Evaluate at 06:00 AM (4 hours before 10:00 AM wake time)
const timePostMidnight6am = DateTime.fromISO('2026-11-13T06:00:00', { zone: 'UTC+05:30' }).toUTC();
const statePostMidnight6am = computeMemberState(postMidnightWakeMember, 'GMT+05:30', timePostMidnight6am);

assert.strictEqual(
  statePostMidnight6am.bucket,
  'AWAKE',
  'Post-midnight member must remain AWAKE at 06:00 AM before wake_time'
);
console.log('✅ PASSED: Post-midnight bedtime early check-in and early wake-up handled cleanly across all hours.');

// -------------------------------------------------------------
// Test Case 10: Re-Entry Guard (Going back to bed after early wake-up)
// -------------------------------------------------------------
console.log('\n--- 9. Re-Entry Guard (Going Back to Bed After Early Wake-Up) ---');
// User woke up early at 05:00 AM, then goes back to bed at 06:00 AM inside the same sleep window
const reEntryMember = {
  ...standardMember,
  in_bed_at: '2026-11-17T06:00:00.000-05:00',
  last_woke_up_at: null,
  last_wake_cycle_date: null,
  is_in_bed: true,
  is_woke_up: false,
};

// Evaluate at 06:15 AM (after re-entering bed)
const timeReEntry = DateTime.fromISO('2026-11-17T06:15:00', { zone: 'America/New_York' }).toUTC();
const stateReEntry = computeMemberState(reEntryMember, 'America/New_York', timeReEntry);

assert.strictEqual(
  stateReEntry.bucket,
  'SLEEPING',
  'Member who went back to bed at 06:00 must be in SLEEPING bucket'
);
assert.strictEqual(
  stateReEntry.status,
  'SLEEPING',
  'Status must be SLEEPING upon re-entry'
);
assert.strictEqual(
  stateReEntry.isSleepShieldActive,
  true,
  'Sleep Shield must be reactivated upon re-entering bed'
);
assert.strictEqual(
  stateReEntry.needsWakeUpLog,
  true,
  'needsWakeUpLog must be true while in bed again'
);
console.log('✅ PASSED: Re-entry guard allows going back to bed deterministically with active Sleep Shield.');

console.log('\n✨ ALL WIND-DOWN STATUS FOR AWAKE MEMBERS TESTS PASSED SUCCESSFULLY! ✨');
