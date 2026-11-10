import { DateTime } from 'luxon';
import { computeMemberState, checkCooldownPromotion } from '../src/lib/sleepEngine.ts';

console.log('🧪 Starting Web Push Notification Engine & Cron Dispatcher Verification...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

// 1. Timezone & Sleep Shield Calculations for Dispatcher
console.log('--- 1. Cron Dispatcher Window & Sleep Shield Verification ---');

// Mock reference time: 2026-11-09 23:00 UTC
const fixedNowUtc = DateTime.fromISO('2026-11-09T23:00:00.000Z', { zone: 'utc' });

// Member 1: Bedtime is exactly NOW (23:00 UTC) -> T-0 BEDTIME_HIT
const sleeperMember = {
  id: 'sleeper-1',
  discord_username: 'SleeperFox',
  discord_handle: 'sleeper',
  avatar_url: null,
  journal_url: 'https://discord.com/channels/123/456',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  timezone: 'UTC',
  pending_bedtime_local: null,
  pending_wake_time_local: null,
  pending_timezone: null,
  pending_effective_at: null,
  role: 'member',
  passcode_hash: null,
  is_active: true,
  created_at: fixedNowUtc.toISO(),
  updated_at: fixedNowUtc.toISO(),
};

const sleeperState = computeMemberState(sleeperMember, 'UTC', fixedNowUtc);
assert(sleeperState.diffMinutes === 0, 'Sleeper diffMinutes is exactly 0m');
assert(sleeperState.bucket === 'BEDTIME_NOW', 'Sleeper bucket is BEDTIME_NOW');

// Member 2: Bedtime in 30 minutes (23:30 UTC) -> T-30 WIND_DOWN_30M
const windDownMember = {
  ...sleeperMember,
  id: 'winddown-1',
  discord_username: 'WindDownFox',
  bedtime_local: '23:30',
};

const windDownState = computeMemberState(windDownMember, 'UTC', fixedNowUtc);
assert(windDownState.diffMinutes === -30, 'Wind-down diffMinutes is exactly -30m');
assert(windDownState.bucket === 'WINDING_DOWN', 'Wind-down bucket is WINDING_DOWN');

// Member 3: Friend in Tokyo (currently 8:00 AM JST) -> AWAKE (Safe to receive nag!)
const tokyoFriend = {
  ...sleeperMember,
  id: 'friend-tokyo',
  discord_username: 'TokyoFriend',
  bedtime_local: '23:30', // 23:30 JST (in 15.5 hours)
  timezone: 'Asia/Tokyo',
};

const tokyoState = computeMemberState(tokyoFriend, 'Asia/Tokyo', fixedNowUtc);
assert(tokyoState.bucket === 'AWAKE', 'Tokyo friend is AWAKE');
assert(tokyoState.isSleepShieldActive === false, 'Tokyo friend Sleep Shield is OFF (eligible for community nag)');

// Member 4: Friend in London (currently 23:00 GMT, bedtime was 21:30 GMT -> 90m into sleep window)
// Must be protected by Sleep Shield!
const sleepingFriend = {
  ...sleeperMember,
  id: 'friend-london',
  discord_username: 'LondonFriend',
  bedtime_local: '21:30', // bedtime hit 90 minutes ago
  timezone: 'Europe/London',
};

const londonState = computeMemberState(sleepingFriend, 'Europe/London', fixedNowUtc);
assert(londonState.diffMinutes === 90, 'London friend is 90 minutes past bedtime');
assert(londonState.bucket === 'SLEEPING', 'London friend bucket is SLEEPING');
assert(londonState.isSleepShieldActive === true, 'London friend Sleep Shield is strictly ACTIVE');

// Member 5: Friend whose bedtime is in 10 minutes (23:10 UTC) -> Within 15-minute quiet shield
const aboutToSleepFriend = {
  ...sleeperMember,
  id: 'friend-about-to-sleep',
  discord_username: 'QuietFox',
  bedtime_local: '23:10',
  timezone: 'UTC',
};

const quietState = computeMemberState(aboutToSleepFriend, 'UTC', fixedNowUtc);
const isQuietShieldActive =
  quietState.isSleepShieldActive ||
  quietState.bucket === 'SLEEPING' ||
  (quietState.diffMinutes >= -15 && quietState.diffMinutes < 0);

assert(
  isQuietShieldActive === true,
  'Friend within 15 minutes before bedtime has Sleep Shield suppression enabled'
);

// 2. Dispatcher Community Filtering Logic Test
console.log('\n--- 2. Sleep Shield Community Recipient Filtering Simulation ---');
const communityCandidates = [tokyoFriend, sleepingFriend, aboutToSleepFriend];
const eligibleRecipients = [];
const suppressedRecipients = [];

for (const candidate of communityCandidates) {
  const state = computeMemberState(candidate, candidate.timezone, fixedNowUtc);
  const isShielded =
    state.isSleepShieldActive ||
    state.bucket === 'SLEEPING' ||
    (state.diffMinutes >= -15 && state.diffMinutes < 0);

  if (isShielded) {
    suppressedRecipients.push(candidate.discord_username);
  } else {
    eligibleRecipients.push(candidate.discord_username);
  }
}

assert(
  eligibleRecipients.length === 1 && eligibleRecipients[0] === 'TokyoFriend',
  'Only awake Tokyo friend receives the nag push'
);
assert(
  suppressedRecipients.includes('LondonFriend'),
  'Sleeping London friend is safely shielded from notifications'
);
assert(
  suppressedRecipients.includes('QuietFox'),
  'Quiet fox winding down within 15m is safely shielded from notifications'
);

// 3. 48-Hour Cooldown Promotion in Cron Simulation
console.log('\n--- 3. 48-Hour Cooldown Promotion Simulation in Cron ---');
const expiredPendingMember = {
  ...sleeperMember,
  bedtime_local: '22:00',
  pending_bedtime_local: '23:30',
  pending_timezone: 'Asia/Kolkata',
  pending_effective_at: fixedNowUtc.minus({ minutes: 10 }).toISO(),
};

const promotionResult = checkCooldownPromotion(expiredPendingMember, fixedNowUtc);
assert(promotionResult.promoted === true, 'Expired pending schedule promoted during cron pass');
assert(promotionResult.activeMember.bedtime_local === '23:30', 'New bedtime takes effect');
assert(promotionResult.activeMember.timezone === 'Asia/Kolkata', 'New timezone takes effect');
assert(promotionResult.activeMember.pending_bedtime_local === null, 'Pending fields cleared');

// 4. Test Summary
console.log('\n-----------------------------------------------------------');
if (failed) {
  console.error('❌ SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('🎉 ALL PUSH ENGINE & CRON SLEEP SHIELD TESTS PASSED!');
  process.exit(0);
}
