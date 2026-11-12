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

const windingDownPillIndex = memberCardContent.indexOf("if (bucket === 'WINDING_DOWN')");
const awakePillIndex = memberCardContent.indexOf("if (isWokeUp)");

assert(
  windingDownPillIndex !== -1,
  'MemberCard must check bucket === WINDING_DOWN for status pill'
);
assert(
  awakePillIndex !== -1,
  'MemberCard must check isWokeUp for status pill'
);
assert(
  windingDownPillIndex < awakePillIndex,
  'WINDING_DOWN status pill check must precede isWokeUp check so wind-down pill is displayed'
);
console.log('✅ PASSED: MemberCard checks WINDING_DOWN before isWokeUp in getStatusPillConfig.');

console.log('\n✨ ALL WIND-DOWN STATUS FOR AWAKE MEMBERS TESTS PASSED SUCCESSFULLY! ✨');
