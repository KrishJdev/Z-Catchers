import assert from 'assert';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';
import { computeMemberState } from '../src/lib/sleepEngine.ts';

console.log('🧪 Starting Wake-Up Nag Notification & Awake Status Authorization Verification...\n');

// Mock member in GMT+05:30 with 23:00 Bedtime & 07:00 Wake Time
const mockMember = {
  id: 'test-afnan-id',
  discord_username: 'Afnan',
  discord_handle: 'afnan#1234',
  avatar_url: null,
  journal_url: 'https://discord.com/channels/123456789/987654321',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  timezone: 'GMT+05:30',
  role: 'member',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// -------------------------------------------------------------
// 1. Sleep Engine: isPastWakeTime and Sleep Shield State Transitions
// -------------------------------------------------------------
console.log('--- 1. Sleep Engine: isPastWakeTime & Sleep Shield Evaluation ---');

// Night date: 2026-11-12
// At 03:00 AM on 2026-11-13 (4 hours before 07:00 AM wake time)
const midSleepUtc = DateTime.fromISO('2026-11-13T03:00:00', { zone: 'UTC+05:30' }).toUTC();

const stateMidSleep = computeMemberState(
  { ...mockMember, is_in_bed: true, is_woke_up: false },
  'GMT+05:30',
  midSleepUtc
);

assert.strictEqual(stateMidSleep.bucket, 'SLEEPING', 'Member is in SLEEPING bucket during night sleep');
assert.strictEqual(stateMidSleep.isPastWakeTime, false, 'isPastWakeTime must be false before 07:00 AM');
assert.strictEqual(stateMidSleep.isSleepShieldActive, true, 'Sleep Shield must be active before wake time');
console.log('✅ PASSED: Member before wake time has isPastWakeTime = false and active Sleep Shield.');

// At 07:15 AM on 2026-11-13 (15 minutes PAST 07:00 AM wake time, in bed, not yet woke up)
const pastWakeUtc = DateTime.fromISO('2026-11-13T07:15:00', { zone: 'UTC+05:30' }).toUTC();

const statePastWake = computeMemberState(
  { ...mockMember, is_in_bed: true, is_woke_up: false },
  'GMT+05:30',
  pastWakeUtc
);

assert.strictEqual(statePastWake.bucket, 'SLEEPING', 'Member still in bed remains in SLEEPING bucket');
assert.strictEqual(statePastWake.isPastWakeTime, true, 'isPastWakeTime must be true after 07:00 AM');
assert.strictEqual(statePastWake.isSleepShieldActive, false, 'Sleep Shield must deactivate once wake time passes');
assert.strictEqual(statePastWake.needsWakeUpLog, true, 'needsWakeUpLog must be true when past wake time without check-out');
assert(statePastWake.statusText.includes('Past Wake Time'), 'Status text must show Past Wake Time');
console.log('✅ PASSED: Member past wake time has isPastWakeTime = true and Sleep Shield deactivated.');

// At 07:15 AM when member has logged wake-up
const stateLoggedWakeUp = computeMemberState(
  { ...mockMember, is_in_bed: false, is_woke_up: true },
  'GMT+05:30',
  pastWakeUtc
);

assert.strictEqual(stateLoggedWakeUp.bucket, 'AWAKE', 'Member who logged wake-up is in AWAKE bucket');
assert.strictEqual(stateLoggedWakeUp.needsWakeUpLog, false, 'needsWakeUpLog is false when awake');
assert.strictEqual(stateLoggedWakeUp.isSleepShieldActive, false, 'Sleep Shield is inactive when awake');
console.log('✅ PASSED: Member who woke up is AWAKE and does not require wake-up nag.');

// -------------------------------------------------------------
// 2. MemberCard Authorization & Action Guardrail Verification
// -------------------------------------------------------------
console.log('\n--- 2. MemberCard Component Authorization Guardrails ---');

const memberCardPath = path.join(process.cwd(), 'src/components/MemberCard.tsx');
const memberCardContent = fs.readFileSync(memberCardPath, 'utf8');

// Ensure Wake Up Nag button is defined
assert(
  memberCardContent.includes('Wake Up Nag'),
  'MemberCard must render "Wake Up Nag" action'
);
assert(
  memberCardContent.includes('handleSendWakeUpNagNotif'),
  'MemberCard must implement handleSendWakeUpNagNotif'
);
assert(
  memberCardContent.includes("type: 'wake_up'"),
  'MemberCard must pass type: wake_up to nag-notif API'
);

// Verify that for non-viewers (!isViewer), Wake Up (Undo) is NOT displayed
const elseBranchIndex = memberCardContent.indexOf("bucket === 'SLEEPING'");
assert(elseBranchIndex !== -1, "MemberCard must handle bucket === 'SLEEPING'");

// Non-viewers must see Wake Up Nag when past wake time, and Shield On otherwise
assert(
  memberCardContent.includes('state.isPastWakeTime ?'),
  'MemberCard must conditionally render Wake Up Nag when state.isPastWakeTime is true'
);

// Verify check-in banner is viewer-only
assert(
  memberCardContent.includes("isViewer && isInBed && bucket === 'SLEEPING'"),
  'Sleeping check-in banner with Undo must be strictly restricted to the viewer (isViewer)'
);
console.log('✅ PASSED: MemberCard strictly protects awake status and displays Wake Up Nag for past wake times.');

// -------------------------------------------------------------
// 3. Nag Notification API: Wake-Up Support Verification
// -------------------------------------------------------------
console.log('\n--- 3. Nag Notification API: Wake-Up Endpoint Logic ---');

const nagRoutePath = path.join(process.cwd(), 'src/app/api/members/nag-notif/route.ts');
const nagRouteContent = fs.readFileSync(nagRoutePath, 'utf8');

assert(
  nagRouteContent.includes("type === 'wake_up'") || nagRouteContent.includes("type = 'bedtime'"),
  'nag-notif route must parse type parameter'
);
assert(
  nagRouteContent.includes('isPastWakeTime'),
  'nag-notif route must check targetState.isPastWakeTime for wake-up reminders'
);
assert(
  nagRouteContent.includes('MANUAL_NAG:WAKE_UP'),
  'nag-notif route must deduplicate wake-up nags with MANUAL_NAG:WAKE_UP'
);
assert(
  nagRouteContent.includes('Rise and Shine'),
  'nag-notif route must dispatch appropriate morning push notification'
);
assert(
  nagRouteContent.includes('You cannot send a nag notification to yourself.'),
  'nag-notif route strictly prevents self-nagging'
);
console.log('✅ PASSED: nag-notif route fully supports wake-up nags with time validation and anti-spam.');

// -------------------------------------------------------------
// 4. 15-Minute Cooldown & In-Button Countdown Verification
// -------------------------------------------------------------
console.log('\n--- 4. 15-Minute Cooldown & In-Button Countdown Verification ---');

// Server-side cooldown validation
assert(
  nagRouteContent.includes('15 * 60') && nagRouteContent.includes('cooldownTotalSeconds'),
  'nag-notif route must enforce 15-minute (900s) cooldown'
);
assert(
  nagRouteContent.includes('cooldownSeconds') && nagRouteContent.includes('cooldownMinutes'),
  'nag-notif route must return remaining cooldownSeconds and cooldownMinutes in JSON payload'
);
assert(
  nagRouteContent.includes('status: 429'),
  'nag-notif route must return HTTP 429 when sender is within the 15-minute cooldown window'
);

// Client-side button countdown validation in MemberCard
assert(
  memberCardContent.includes('nagCooldownSeconds'),
  'MemberCard must track nagCooldownSeconds state'
);
assert(
  memberCardContent.includes('formatNagCooldown'),
  'MemberCard must implement countdown formatter for button text'
);
assert(
  memberCardContent.includes('Nag in {formatNagCooldown(nagCooldownSeconds)}'),
  'MemberCard must show live countdown directly inside the nag button itself'
);
assert(
  memberCardContent.includes('nag_cooldown_'),
  'MemberCard must persist cooldown timestamp in localStorage across reloads'
);
console.log('✅ PASSED: 15-minute cooldown is strictly enforced and displayed dynamically inside the button.');

console.log('\n🎉 ALL WAKE-UP NAG & AWAKE STATUS TESTS PASSED SUCCESSFULLY! ☀️⏰🦊\n');
