import assert from 'assert';
import { DateTime } from 'luxon';
import { computeMemberState } from '../src/lib/sleepEngine.ts';
import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Sleeping State to Awake Undo & Leave Quiet Note Overflow Verification...\n');

// Mock member in GMT+05:30 with 01:00 AM bedtime
const mockMember = {
  id: 'test-member-reaous',
  discord_username: 'reaous',
  discord_handle: 'reaous#0001',
  avatar_url: null,
  journal_url: 'https://discord.com/channels/123456789/987654321',
  bedtime_local: '01:00',
  wake_time_local: '09:00',
  timezone: 'GMT+05:30',
  role: 'member',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// 1. Check-In & Sleep State Transition Tests
console.log('--- 1. Sleep State Machine Transitions ---');

// Time: 01:30 AM local (30 mins after bedtime)
const time30mPastBedtimeUtc = DateTime.fromISO('2026-11-12T01:30:00', { zone: 'UTC+05:30' }).toUTC();

// State A: Member has set to sleep via "I'm in Bed"
const stateAsleep = computeMemberState(
  { ...mockMember, is_in_bed: true, is_woke_up: false },
  'GMT+05:30',
  time30mPastBedtimeUtc
);
assert.strictEqual(stateAsleep.bucket, 'SLEEPING', 'Member should be in SLEEPING bucket when is_in_bed is true');
assert.strictEqual(stateAsleep.isSleepShieldActive, true, 'Sleep Shield must be active when in bed');
console.log('✅ PASSED: In-Bed member correctly in SLEEPING bucket with active Sleep Shield.');

// State B: Member undid sleep / woke up (e.g. set to sleep by mistake)
const stateAwake = computeMemberState(
  { ...mockMember, is_in_bed: false, is_woke_up: true },
  'GMT+05:30',
  time30mPastBedtimeUtc
);
assert.strictEqual(stateAwake.bucket, 'AWAKE', 'Member must transition to AWAKE bucket when is_woke_up is true');
assert.strictEqual(stateAwake.isSleepShieldActive, false, 'Sleep Shield must be deactivated when waking up');
console.log('✅ PASSED: Undoing sleep state via is_woke_up moves member directly to AWAKE bucket with Sleep Shield off.');

// State C: Even during the deep 8-hour sleep window (e.g. 03:00 AM, 120 mins after bedtime)
const time120mPastBedtimeUtc = DateTime.fromISO('2026-11-12T03:00:00', { zone: 'UTC+05:30' }).toUTC();

// Normal unsaved state would be SLEEPING by default
const stateDefaultInWindow = computeMemberState(
  { ...mockMember, is_in_bed: false, is_woke_up: false },
  'GMT+05:30',
  time120mPastBedtimeUtc
);
assert.strictEqual(stateDefaultInWindow.bucket, 'SLEEPING', 'Default in 8h window is SLEEPING');

// When is_woke_up is set to true (undid sleep state)
const stateWokeUpInWindow = computeMemberState(
  { ...mockMember, is_in_bed: false, is_woke_up: true },
  'GMT+05:30',
  time120mPastBedtimeUtc
);
assert.strictEqual(stateWokeUpInWindow.bucket, 'AWAKE', 'Explicit wake-up overrides 8h sleep window into AWAKE');
assert.strictEqual(stateWokeUpInWindow.isSleepShieldActive, false, 'Sleep Shield off for woke-up member');
console.log('✅ PASSED: Member waking up within 8h window transitions cleanly to AWAKE bucket.');

// 2. MemberCard & Layout Overflow Verification
console.log('\n--- 2. Leave Quiet Note Overflow Layout Verification ---');
const memberCardContent = fs.readFileSync(path.join(process.cwd(), 'src/components/MemberCard.tsx'), 'utf8');

// Ensure flex-1 and min-w-0 on action bar elements in SLEEPING state
assert(
  memberCardContent.includes("bucket === 'SLEEPING'"),
  'MemberCard must handle bucket === SLEEPING'
);
assert(
  memberCardContent.includes('Wake Up (Undo)'),
  'MemberCard must provide Wake Up (Undo) option in sleeping state'
);
assert(
  memberCardContent.includes('flex-1 min-w-0') && memberCardContent.includes('Leave quiet note'),
  'Leave quiet note anchor must have flex-1 min-w-0 to prevent horizontal overflow'
);
assert(
  memberCardContent.includes('truncate') && memberCardContent.includes('Leave quiet note'),
  'Leave quiet note text must have truncate to safely fit narrow card widths'
);
console.log('✅ PASSED: MemberCard includes Wake Up (Undo) button and flex-1 min-w-0 truncation for Leave quiet note.');

// 3. Page Hero Banner Verification
console.log('\n--- 3. Page Hero Banner Undo Option Verification ---');
const pageContent = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');

assert(
  pageContent.includes('Wake Up / Undo'),
  'Page hero banner must provide prominent Wake Up / Undo button'
);
assert(
  pageContent.includes('isModerator={Boolean(currentUser?.role === \'moderator\' || currentUser?.is_moderator)}'),
  'Page must pass isModerator to MemberCard across status buckets'
);
console.log('✅ PASSED: Page hero banner features prominent Wake Up / Undo button.');

// 4. ModDrawer Moderator Undo Verification
console.log('\n--- 4. ModDrawer Wake Up / Undo Sleep Option Verification ---');
const modDrawerContent = fs.readFileSync(path.join(process.cwd(), 'src/components/ModDrawer.tsx'), 'utf8');

assert(
  modDrawerContent.includes('Wake Up / Undo Sleep'),
  'ModDrawer must feature Wake Up / Undo Sleep action for checked-in members'
);
console.log('✅ PASSED: ModDrawer provides moderators with Wake Up / Undo Sleep administration action.');

console.log('\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
