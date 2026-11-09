import { DateTime } from 'luxon';
import {
  isWeekendNight,
  getBedtimeForNight,
  getNightBedtimeDateTime,
  computeMemberState,
  checkCooldownPromotion,
} from '../src/lib/sleepEngine.ts';

console.log('🧪 Starting Weekend Hours (Friday & Saturday Nights) Verification...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

// 1. Verify Weekend Nights Definition (Friday & Saturday Nights)
console.log('--- 1. Day of Week & Weekend Night Verification ---');
// 2026-11-09 is Monday, 2026-11-10 is Tuesday, ..., 2026-11-13 is Friday, 2026-11-14 is Saturday, 2026-11-15 is Sunday
const monday = DateTime.fromISO('2026-11-09T22:00:00', { zone: 'America/New_York' });
const tuesday = DateTime.fromISO('2026-11-10T22:00:00', { zone: 'America/New_York' });
const wednesday = DateTime.fromISO('2026-11-11T22:00:00', { zone: 'America/New_York' });
const thursday = DateTime.fromISO('2026-11-12T22:00:00', { zone: 'America/New_York' });
const friday = DateTime.fromISO('2026-11-13T22:00:00', { zone: 'America/New_York' });
const saturday = DateTime.fromISO('2026-11-14T22:00:00', { zone: 'America/New_York' });
const sunday = DateTime.fromISO('2026-11-15T22:00:00', { zone: 'America/New_York' });

assert(isWeekendNight(monday) === false, 'Monday night is NOT weekend');
assert(isWeekendNight(tuesday) === false, 'Tuesday night is NOT weekend');
assert(isWeekendNight(wednesday) === false, 'Wednesday night is NOT weekend');
assert(isWeekendNight(thursday) === false, 'Thursday night is NOT weekend');
assert(isWeekendNight(friday) === true, 'Friday night IS weekend');
assert(isWeekendNight(saturday) === true, 'Saturday night IS weekend');
assert(isWeekendNight(sunday) === false, 'Sunday night is NOT weekend');

// 2. Member Bedtime Resolution
console.log('\n--- 2. Member Bedtime Resolution Across Days ---');
const memberWithWeekend = {
  id: 'member-weekend-1',
  discord_username: 'WeekendSleeper',
  discord_handle: 'weekendsleeper',
  avatar_url: null,
  journal_url: 'https://discord.com/channels/123/456',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  timezone: 'America/New_York',
  weekend_bedtime_local: '01:30',
  weekend_wake_time_local: '09:30',
  pending_bedtime_local: null,
  pending_wake_time_local: null,
  pending_timezone: null,
  pending_effective_at: null,
  role: 'member',
  passcode_hash: null,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const thursdayBedtime = getBedtimeForNight(memberWithWeekend, thursday);
assert(thursdayBedtime.bedtimeStr === '23:00' && !thursdayBedtime.isWeekend, 'Thursday uses regular bedtime 23:00');

const fridayBedtime = getBedtimeForNight(memberWithWeekend, friday);
assert(fridayBedtime.bedtimeStr === '01:30' && fridayBedtime.isWeekend, 'Friday night uses weekend bedtime 01:30');

const saturdayBedtime = getBedtimeForNight(memberWithWeekend, saturday);
assert(saturdayBedtime.bedtimeStr === '01:30' && saturdayBedtime.isWeekend, 'Saturday night uses weekend bedtime 01:30');

const sundayBedtime = getBedtimeForNight(memberWithWeekend, sunday);
assert(sundayBedtime.bedtimeStr === '23:00' && !sundayBedtime.isWeekend, 'Sunday night uses regular bedtime 23:00');

// Member without weekend hours configured: always uses regular bedtime
const memberWithoutWeekend = {
  ...memberWithWeekend,
  weekend_bedtime_local: null,
  weekend_wake_time_local: null,
};
const fridayNoWeekend = getBedtimeForNight(memberWithoutWeekend, friday);
assert(fridayNoWeekend.bedtimeStr === '23:00' && !fridayNoWeekend.isWeekend, 'Member without weekend hours uses regular bedtime on Friday');

// 3. Exact Bedtime Timestamp & Midnight Crossover
console.log('\n--- 3. Midnight Crossover & Candidate Timestamps ---');
// Friday night bedtime is 01:30 AM (past midnight, calendar date Saturday)
const fridayNightDt = getNightBedtimeDateTime(memberWithWeekend, friday);
assert(
  fridayNightDt.bedtimeDateTime.toFormat('yyyy-MM-dd HH:mm') === '2026-11-14 01:30',
  'Friday night 01:30 occurs on Saturday Nov 14 at 01:30 AM'
);
assert(fridayNightDt.isWeekend === true, 'Friday night marked as weekend');

// Member with before-midnight weekend bedtime (e.g. 23:45)
const memberPreMidnight = {
  ...memberWithWeekend,
  weekend_bedtime_local: '23:45',
};
const fridayPreMidnight = getNightBedtimeDateTime(memberPreMidnight, friday);
assert(
  fridayPreMidnight.bedtimeDateTime.toFormat('yyyy-MM-dd HH:mm') === '2026-11-13 23:45',
  'Friday night 23:45 occurs on Friday Nov 13 at 23:45'
);

// 4. Live computeMemberState across different times
console.log('\n--- 4. computeMemberState on Weekdays vs Weekends ---');
// Scenario A: Thursday evening at 22:30 (Weekday Winding Down)
const thursdayNowUtc = DateTime.fromISO('2026-11-12T22:30:00', { zone: 'America/New_York' }).toUTC();
const thursdayState = computeMemberState(memberWithWeekend, 'America/New_York', thursdayNowUtc);
assert(thursdayState.bucket === 'WINDING_DOWN', 'Thursday 22:30 is WINDING_DOWN for 23:00 bedtime');
assert(thursdayState.isWeekendSchedule === false, 'Thursday is not weekend schedule');
assert(thursdayState.formattedSleeperTime === '11:00 PM', 'Formatted bedtime is 11:00 PM');

// Scenario B: Friday evening at 23:00 (On regular schedule, user would be at bedtime, but weekend is 01:30!)
const friday11pmUtc = DateTime.fromISO('2026-11-13T23:00:00', { zone: 'America/New_York' }).toUTC();
const friday11pmState = computeMemberState(memberWithWeekend, 'America/New_York', friday11pmUtc);
assert(friday11pmState.bucket === 'AWAKE', 'Friday 23:00 is AWAKE because weekend bedtime is 01:30');
assert(friday11pmState.isWeekendSchedule === true, 'Friday bedtime is marked as weekend schedule');
assert(friday11pmState.formattedSleeperTime === '1:30 AM', 'Formatted bedtime shows 1:30 AM');

// Scenario C: Saturday early morning at 01:15 AM (Friday night Winding Down at T-15m!)
const saturdayEarlyUtc = DateTime.fromISO('2026-11-14T01:15:00', { zone: 'America/New_York' }).toUTC();
const saturdayEarlyState = computeMemberState(memberWithWeekend, 'America/New_York', saturdayEarlyUtc);
assert(saturdayEarlyState.bucket === 'WINDING_DOWN', 'Saturday 01:15 AM is WINDING_DOWN for Friday night 01:30');
assert(saturdayEarlyState.isWeekendSchedule === true, 'Friday night sleep cycle is weekend schedule');
assert(Math.round(saturdayEarlyState.diffMinutes) === -15, 'Diff is -15 minutes');

// Scenario D: Saturday early morning at 01:40 AM (Friday night BEDTIME_NOW!)
const saturdayNagUtc = DateTime.fromISO('2026-11-14T01:40:00', { zone: 'America/New_York' }).toUTC();
const saturdayNagState = computeMemberState(memberWithWeekend, 'America/New_York', saturdayNagUtc);
assert(saturdayNagState.bucket === 'BEDTIME_NOW', 'Saturday 01:40 AM is BEDTIME_NOW (10m after 01:30)');
assert(saturdayNagState.isWeekendSchedule === true, 'Friday night BEDTIME_NOW is weekend schedule');

// Scenario E: Sunday evening at 22:45 (Sunday night Winding Down for Weekday 23:00 bedtime!)
const sundayNightUtc = DateTime.fromISO('2026-11-15T22:45:00', { zone: 'America/New_York' }).toUTC();
const sundayNightState = computeMemberState(memberWithWeekend, 'America/New_York', sundayNightUtc);
assert(sundayNightState.bucket === 'WINDING_DOWN', 'Sunday 22:45 is WINDING_DOWN for regular 23:00 bedtime');
assert(sundayNightState.isWeekendSchedule === false, 'Sunday night reverts back to regular weekday bedtime');
assert(sundayNightState.formattedSleeperTime === '11:00 PM', 'Sunday night shows 11:00 PM');

// 5. Cooldown Promotion with Weekend Fields
console.log('\n--- 5. Cooldown Promotion with Weekend Schedule ---');
const pendingMember = {
  ...memberWithWeekend,
  pending_bedtime_local: '22:30',
  pending_weekend_bedtime_local: '02:00',
  pending_weekend_wake_time_local: '10:00',
  pending_effective_at: DateTime.utc().minus({ minutes: 1 }).toISO(),
};

const promotion = checkCooldownPromotion(pendingMember);
assert(promotion.promoted === true, 'Cooldown past effective date is promoted');
assert(promotion.activeMember.bedtime_local === '22:30', 'Regular bedtime promoted to 22:30');
assert(promotion.activeMember.weekend_bedtime_local === '02:00', 'Weekend bedtime promoted to 02:00');
assert(promotion.activeMember.weekend_wake_time_local === '10:00', 'Weekend wake time promoted to 10:00');
assert(promotion.activeMember.pending_weekend_bedtime_local === null, 'pending_weekend_bedtime_local cleared');
assert(promotion.activeMember.pending_effective_at === null, 'pending_effective_at cleared');

if (failed) {
  console.error('\n❌ SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('\n🎉 ALL 20 WEEKEND HOURS TESTS PASSED CLEANLY!');
}
