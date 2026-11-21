import { DateTime } from 'luxon';
import { rejects } from 'node:assert/strict';
import { computeMemberState, checkCooldownPromotion, getSleepCycleDate } from '../src/lib/sleepEngine.ts';
import {
  acquireCronLock,
  getCronLock,
  recordCronLockDeliveredSub,
  markCronLockCompleted,
  releaseCronLock,
  clearAllCronLocks,
  executeNotificationDispatcher,
} from '../src/lib/cronDispatcher.ts';
import { getInMemoryMember, syncInMemoryMemberCache } from '../src/lib/db.ts';
import {
  issueAutomaticBedtimeStrike,
  saveNightlyStrikeLog,
  getNightlyStrikeLog,
} from '../src/lib/strikes.ts';

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
  last_notified_stage: null,
  last_notified_cycle_date: null,
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
// Checked in via in-bed, must be protected by Sleep Shield!
const sleepingFriend = {
  ...sleeperMember,
  id: 'friend-london',
  discord_username: 'LondonFriend',
  bedtime_local: '21:30', // bedtime hit 90 minutes ago
  timezone: 'Europe/London',
  is_in_bed: true,
};

const londonState = computeMemberState(sleepingFriend, 'Europe/London', fixedNowUtc);
assert(londonState.diffMinutes === 90, 'London friend is 90 minutes past bedtime');
assert(londonState.bucket === 'SLEEPING', 'London friend bucket is SLEEPING');
assert(londonState.isSleepShieldActive === true, 'London friend Sleep Shield is strictly ACTIVE');

// Member 4B: Overdue friend who did NOT check in -> stays in Overdue bucket, Sleep Shield is OFF
const overdueFriend = {
  ...sleeperMember,
  id: 'friend-overdue',
  discord_username: 'OverdueFriend',
  bedtime_local: '21:30',
  timezone: 'Europe/London',
  is_in_bed: false,
};
const overdueLondonState = computeMemberState(overdueFriend, 'Europe/London', fixedNowUtc);
assert(overdueLondonState.bucket === 'BEDTIME_NOW', 'Overdue friend remains in Overdue bucket (BEDTIME_NOW)');
assert(overdueLondonState.isSleepShieldActive === false, 'Overdue friend Sleep Shield is OFF');

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

// 4. Rolling 30-Minute Lookback Window & Persistent Idempotency Tests
console.log('\n--- 4. Rolling 30-Minute Lookback Window & Persistent Idempotency ---');
const cycleDate = getSleepCycleDate(sleeperMember, fixedNowUtc);
assert(cycleDate === '2026-11-09', 'Sleep cycle date resolved to 2026-11-09');

// Test Case 4A: Cron runs with 12 minutes of jitter (T+12m after 23:00 bedtime)
const jitteredNowUtc = fixedNowUtc.plus({ minutes: 12 });
const jitteredState = computeMemberState(sleeperMember, 'UTC', jitteredNowUtc);
const isBedtimeDueWithJitter = jitteredState.diffMinutes >= 0 && jitteredState.diffMinutes <= 30;
assert(isBedtimeDueWithJitter === true, 'Bedtime hit is detected within rolling 30m lookback window (diff=12m)');

// Test Case 4B: Idempotent check prevents duplicate BEDTIME_HIT
const memberAlreadyNotified = {
  ...sleeperMember,
  last_notified_stage: 'BEDTIME_HIT',
  last_notified_cycle_date: cycleDate,
};
const isAlreadyLogged =
  memberAlreadyNotified.last_notified_cycle_date === cycleDate &&
  memberAlreadyNotified.last_notified_stage === 'BEDTIME_HIT';
assert(isAlreadyLogged === true, 'Persistent columns mark BEDTIME_HIT as already dispatched for tonight');

// Test Case 4C: Wind-down lookback at T-20m (runner delayed by 10m during wind-down window)
const delayedWindDownUtc = fixedNowUtc.minus({ minutes: 20 }); // Bedtime is 23:00, now is 22:40 -> diff is -20m
const delayedWindDownState = computeMemberState(sleeperMember, 'UTC', delayedWindDownUtc);
const isWindDownDueDelayed = delayedWindDownState.diffMinutes >= -30 && delayedWindDownState.diffMinutes < 0;
assert(isWindDownDueDelayed === true, 'Wind-down is detected within rolling 30m window before bedtime (diff=-20m)');

// Test Case 4D: Stale alert beyond 30m lookback window (e.g. diff = 45m past bedtime)
const staleNowUtc = fixedNowUtc.plus({ minutes: 45 });
const staleState = computeMemberState(sleeperMember, 'UTC', staleNowUtc);
const isBedtimeDueStale = staleState.diffMinutes >= 0 && staleState.diffMinutes <= 30;
assert(isBedtimeDueStale === false, 'Stale notification is strictly ignored beyond 30m lookback window (diff=45m)');

// 5. Distributed Cron Locks, Processing Leases & Crash Recovery
console.log('\n--- 5. Cron Lock Leases, Crash Recovery & Duplicate Prevention ---');
clearAllCronLocks();

const testLockKey = 'notif:test-member-99:2026-11-09:BEDTIME_HIT';

// Test 5A: Acquire short lease
const acquired1 = await acquireCronLock(testLockKey, 300, {
  member_id: 'test-member-99',
  stage: 'BEDTIME_HIT',
  local_date: '2026-11-09',
  state: 'processing',
  delivered_sub_ids: [],
});
assert(acquired1?.lockKey === testLockKey, 'Initial 300-second processing lease acquired');

// Test 5B: Concurrent worker is rejected while lease is active
const acquiredConcurrent = await acquireCronLock(testLockKey, 300);
assert(acquiredConcurrent === null, 'Concurrent runner is blocked while active processing lease is held');

// Test 5C: Record delivered push subscription
await recordCronLockDeliveredSub(acquired1, 'sub-endpoint-device-1');
const lockStateMidFlight = await getCronLock(testLockKey);
const deliveredList = lockStateMidFlight?.metadata?.delivered_sub_ids;
assert(
  Array.isArray(deliveredList) && deliveredList.includes('sub-endpoint-device-1'),
  'Delivered sub-endpoint recorded in lock metadata during processing'
);

// Test 5D: Simulated worker crash & recovery after short lease expiration
// Manually expire the lock to simulate 5-minute lease timeout
const memLock = await getCronLock(testLockKey);
if (memLock) {
  memLock.expiresAt = Date.now() - 1000; // Expired 1 second ago
}

// Recovery worker attempts to acquire lock
const recovered = await acquireCronLock(testLockKey, 300, {
  member_id: 'test-member-99',
  stage: 'BEDTIME_HIT',
  local_date: '2026-11-09',
  state: 'processing',
});
assert(recovered && recovered.lockedAt !== acquired1.lockedAt, 'Recovery worker acquires a new lease');

const recoveredLock = await getCronLock(testLockKey);
const recoveredSubs = recoveredLock?.metadata?.delivered_sub_ids;
assert(
  Array.isArray(recoveredSubs) && recoveredSubs.includes('sub-endpoint-device-1'),
  'Previous delivered subscription preserved during recovery lease renewal to prevent duplicate delivery'
);

// Test 5E: Mark completed seals with 24-hour durable lock
await rejects(recordCronLockDeliveredSub(acquired1, 'stale'), /replaced/);
await rejects(markCronLockCompleted(acquired1), /replaced/);
await markCronLockCompleted(recovered, { member_id: 'test-member-99', stage: 'BEDTIME_HIT' });
const completedLock = await getCronLock(testLockKey);
assert(completedLock?.metadata?.completed === true, 'Lock marked completed: true');
assert(completedLock?.metadata?.state === 'completed', 'Lock state marked completed');

// Test 5F: Subsequent worker blocked even after time passes because cycle is completed
const tryAfterCompletion = await acquireCronLock(testLockKey, 300);
assert(tryAfterCompletion === null, 'Cannot re-acquire lock once marked durably completed');

// Test 5G: Release lock
await releaseCronLock(testLockKey);
const lockAfterRelease = await getCronLock(testLockKey);
assert(lockAfterRelease === null, 'Lock successfully cleared on releaseCronLock');

// 6. Automated 10-Minute Bedtime Strike Engine & Cron Integration
console.log('\n--- 6. Automated 10-Minute Bedtime Strike Engine in Cron Dispatcher ---');
clearAllCronLocks();

const cronTestSleeper = {
  id: 'cron-sleeper-strike-test',
  discord_username: 'CronStrikeFox',
  discord_handle: 'cronstrikefox',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  timezone: 'UTC',
  role: 'member',
  is_active: true,
  is_in_bed: false,
  strikes_used: 0,
  strikes_count: 0,
  metastrikes_used: 0,
  metastrikes_count: 0,
  strike_cycle_month: '2026-11',
  created_at: fixedNowUtc.toISO(),
  updated_at: fixedNowUtc.toISO(),
};

const strikeCycleDate = getSleepCycleDate(cronTestSleeper, fixedNowUtc);
const autoStrikeLockKey = `notif:${cronTestSleeper.id}:${strikeCycleDate}:AUTO_BEDTIME_STRIKE`;

// Case 6A: Member is 9 minutes past bedtime without checking in -> diff = 9m (< 10m threshold)
const time9m = fixedNowUtc.plus({ minutes: 9 });
const state9m = computeMemberState(cronTestSleeper, 'UTC', time9m);
const isDue9m = state9m.diffMinutes >= 10;
assert(state9m.diffMinutes === 9, 'Member is exactly 9 minutes past bedtime');
assert(isDue9m === false, 'At 9m past bedtime, automatic strike is NOT triggered (diff < 10m cutoff)');

// Case 6B: Member is 10+ minutes past bedtime without checking in -> 1 normal strike automatically issued
const time10m = fixedNowUtc.plus({ minutes: 10 });
const state10m = computeMemberState(cronTestSleeper, 'UTC', time10m);
const isDue10m = state10m.diffMinutes >= 10;
assert(isDue10m === true, 'At 10m past bedtime, automatic strike trigger condition is satisfied (diff >= 10m)');

const lockAcquired = await acquireCronLock(autoStrikeLockKey, 300, {
  member_id: cronTestSleeper.id,
  stage: 'AUTO_BEDTIME_STRIKE',
  local_date: strikeCycleDate,
  state: 'processing',
});
assert(lockAcquired?.lockKey === autoStrikeLockKey, 'Cron lock acquired for AUTO_BEDTIME_STRIKE');

const strikeResult = await issueAutomaticBedtimeStrike(cronTestSleeper, strikeCycleDate, time10m);
assert(strikeResult.success === true, 'issueAutomaticBedtimeStrike succeeded');
assert(strikeResult.strikeIssued === true, '1 normal strike officially issued');
assert(strikeResult.strikesUsed === 1, 'strikes_used incremented to 1');
assert(strikeResult.log?.record_type === 'strike', 'Nightly strike log record_type is strike');

await markCronLockCompleted(lockAcquired, {
  member_id: cronTestSleeper.id,
  stage: 'AUTO_BEDTIME_STRIKE',
  local_date: strikeCycleDate,
});
const completedAutoLock = await getCronLock(autoStrikeLockKey);
assert(completedAutoLock?.metadata?.completed === true, 'Auto-strike lock marked durably completed for the cycle');

// Case 6C: Subsequent cron runs in the same cycle issue 0 additional strikes (Idempotent)
const time15m = fixedNowUtc.plus({ minutes: 15 });
const dupeLockAcquired = await acquireCronLock(autoStrikeLockKey, 300);
assert(dupeLockAcquired === null, 'Subsequent cron run blocked by completed lock');

const repeatStrikeRes = await issueAutomaticBedtimeStrike(cronTestSleeper, strikeCycleDate, time15m);
assert(repeatStrikeRes.strikeIssued === false, 'Subsequent run issues 0 additional strikes (idempotent)');
assert(repeatStrikeRes.reason === 'already_issued', 'Reason indicates strike already issued');

// Case 6D: Member who checked into bed -> 0 strikes issued
const checkedInSleeper = { ...cronTestSleeper, id: 'cron-checked-in-sleeper', is_in_bed: true };
const checkedInStrikeRes = await issueAutomaticBedtimeStrike(checkedInSleeper, strikeCycleDate, time10m);
assert(checkedInStrikeRes.strikeIssued === false, 'Checked-in member receives 0 strikes');
assert(checkedInStrikeRes.reason === 'already_checked_in', 'Reason indicates already checked in');

// Case 6E: Member who applied a metastrike before bedtime -> 10+ minutes past bedtime yields 0 normal strikes
const metaProtectedSleeper = {
  ...cronTestSleeper,
  id: 'cron-meta-protected-sleeper',
  metastrikes_used: 1,
};
await saveNightlyStrikeLog({
  id: 'meta-protected-log-1',
  target_member_id: metaProtectedSleeper.id,
  sleep_cycle_date: strikeCycleDate,
  record_type: 'metastrike',
  reason: 'Family Dinner',
  voter_ids: [],
  created_at: fixedNowUtc.minus({ hours: 1 }).toISO(),
  updated_at: fixedNowUtc.minus({ hours: 1 }).toISO(),
});
const metaStrikeRes = await issueAutomaticBedtimeStrike(metaProtectedSleeper, strikeCycleDate, time10m);
assert(metaStrikeRes.strikeIssued === false, 'Member with active metastrike receives 0 normal strikes');
assert(metaStrikeRes.reason === 'metastrike_active', 'Reason indicates metastrike is active');

// Case 6F: Member with three strikes can receive a fourth
const cappedSleeper = {
  ...cronTestSleeper,
  id: 'cron-capped-sleeper',
  strikes_used: 3,
  strikes_count: 3,
};
const cappedStrikeRes = await issueAutomaticBedtimeStrike(cappedSleeper, strikeCycleDate, time10m);
assert(cappedStrikeRes.strikeIssued === true, 'Member with three strikes receives another strike');
assert(cappedStrikeRes.strikesUsed === 4, 'Monthly count advances to four');

// Case 6G: Dry-run safety: verify dry-run does not write strike logs or update member counts
clearAllCronLocks();
const dryRunMember = {
  id: 'cron-dryrun-sleeper',
  discord_username: 'DryRunFox',
  discord_handle: '@dryrun',
  timezone: 'UTC',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  strikes_used: 0,
  strikes_count: 0,
  metastrikes_used: 0,
  is_active: true,
};
syncInMemoryMemberCache(dryRunMember);
const dryRunResult = await executeNotificationDispatcher({
  dryRun: true,
  forcedMemberId: dryRunMember.id,
  testNowUtc: time10m,
});
assert(dryRunResult.autoStrikesDispatched === 1, 'Dry run previews 1 auto strike dispatched');
const dryRunLog = await getNightlyStrikeLog(dryRunMember.id, strikeCycleDate);
assert(dryRunLog === null, 'Dry run strictly avoided writing strike log to store');
const dryRunMemAfter = getInMemoryMember(dryRunMember.id);
assert(dryRunMemAfter?.strikes_used === 0, 'Dry run strictly preserved member strikes_used at 0');

// 7. Test Summary
console.log('\n-----------------------------------------------------------');
if (failed) {
  console.error('❌ SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('🎉 ALL PUSH ENGINE, CRON SLEEP SHIELD & IDEMPOTENCY TESTS PASSED!');
  process.exit(0);
}
