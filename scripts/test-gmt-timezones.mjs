import assert from 'assert';
import { DateTime } from 'luxon';
import {
  GMT_OFFSETS,
  toValidLuxonZone,
  isValidTimezone,
  formatGmtOffset,
  computeMemberState,
  COMMON_IANA_TIMEZONES,
  detectUserTimezone,
} from '../src/lib/sleepEngine.ts';

console.log('🧪 Running IANA & GMT Timezone Precision & DST Test Suite...');

// 1. Verify GMT_OFFSETS array
console.log('1. Checking GMT_OFFSETS list...');
assert(Array.isArray(GMT_OFFSETS), 'GMT_OFFSETS must be an array');
assert(GMT_OFFSETS.length >= 35, 'Must contain all standard global offsets');
assert(GMT_OFFSETS.includes('GMT+00:00'), 'Must include GMT+00:00');
assert(GMT_OFFSETS.includes('GMT+05:30'), 'Must include GMT+05:30');
assert(GMT_OFFSETS.includes('GMT-05:00'), 'Must include GMT-05:00');
assert(GMT_OFFSETS.includes('GMT+14:00'), 'Must include GMT+14:00');
assert(GMT_OFFSETS.includes('GMT-12:00'), 'Must include GMT-12:00');
console.log(`   ✅ GMT_OFFSETS contains ${GMT_OFFSETS.length} global offsets.`);

// 2. Test toValidLuxonZone mapping
console.log('2. Testing toValidLuxonZone mapping...');
assert.strictEqual(toValidLuxonZone('GMT+05:30'), 'UTC+05:30');
assert.strictEqual(toValidLuxonZone('GMT-05:00'), 'UTC-05:00');
assert.strictEqual(toValidLuxonZone('GMT+00:00'), 'UTC+00:00');
assert.strictEqual(toValidLuxonZone('GMT+5'), 'UTC+05:00');
assert.strictEqual(toValidLuxonZone('GMT-8'), 'UTC-08:00');
assert.strictEqual(toValidLuxonZone('+05:30'), 'UTC+05:30');
assert.strictEqual(toValidLuxonZone('-04:00'), 'UTC-04:00');
assert.strictEqual(toValidLuxonZone('UTC+5:30'), 'UTC+05:30');
assert.strictEqual(toValidLuxonZone('UTC'), 'UTC');
assert.strictEqual(toValidLuxonZone('GMT'), 'UTC');
assert.strictEqual(toValidLuxonZone('America/New_York'), 'America/New_York');
assert.strictEqual(toValidLuxonZone('Europe/Athens'), 'Europe/Athens');
assert.strictEqual(toValidLuxonZone('Asia/Kolkata'), 'Asia/Kolkata');
console.log('   ✅ toValidLuxonZone translates all offsets and preserves IANA identifiers correctly.');

// 3. Test isValidTimezone
console.log('3. Testing isValidTimezone validation...');
assert.strictEqual(isValidTimezone('GMT+05:30'), true);
assert.strictEqual(isValidTimezone('GMT-05:00'), true);
assert.strictEqual(isValidTimezone('GMT+00:00'), true);
assert.strictEqual(isValidTimezone('America/New_York'), true);
assert.strictEqual(isValidTimezone('Europe/Athens'), true);
assert.strictEqual(isValidTimezone('Asia/Kolkata'), true);
assert.strictEqual(isValidTimezone('UTC'), true);
assert.strictEqual(isValidTimezone('GMT+99:00'), false);
assert.strictEqual(isValidTimezone('Invalid/City'), false);
assert.strictEqual(isValidTimezone(''), false);
assert.strictEqual(isValidTimezone(null), false);
console.log('   ✅ isValidTimezone validates valid & invalid values properly.');

// 4. Test formatGmtOffset (location privacy masking)
console.log('4. Testing formatGmtOffset location privacy...');
assert.strictEqual(formatGmtOffset('Asia/Kolkata'), 'GMT+05:30');
assert.strictEqual(formatGmtOffset('UTC'), 'GMT+00:00');
assert.strictEqual(formatGmtOffset('GMT'), 'GMT+00:00');
assert.strictEqual(formatGmtOffset('GMT+5:30'), 'GMT+05:30');
assert.strictEqual(formatGmtOffset('GMT-5:00'), 'GMT-05:00');
assert.strictEqual(formatGmtOffset('+05:30'), 'GMT+05:30');
console.log('   ✅ formatGmtOffset masks city names and normalizes offsets.');

// 5. Test computeMemberState with GMT offset timezones
console.log('5. Testing computeMemberState with GMT offset timezones...');
const dummyMember = {
  id: 'test-1',
  discord_username: 'TestFox',
  journal_url: 'https://discord.com/channels/123/456',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  timezone: 'GMT+05:30',
  pending_bedtime_local: null,
  pending_wake_time_local: null,
  pending_timezone: null,
  pending_effective_at: null,
  role: 'member',
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// 17:30 UTC is 23:00 in GMT+05:30 (bedtime hit)
const bedtimeNowUtc = DateTime.fromISO('2026-11-10T17:30:00.000Z');
const stateAtBedtime = computeMemberState(dummyMember, 'GMT+00:00', bedtimeNowUtc);
assert.strictEqual(stateAtBedtime.bucket, 'BEDTIME_NOW');
assert.strictEqual(stateAtBedtime.formattedSleeperTime, '11:00 PM');
assert.strictEqual(stateAtBedtime.formattedViewerTime, '5:30 PM');
console.log('   ✅ computeMemberState accurately converts GMT offset timezones.');

// 6. Test strict IANA timezone identifiers and Luxon integration
console.log('6. Testing strict IANA timezones (Europe/Athens, America/New_York, Asia/Kolkata)...');
assert(COMMON_IANA_TIMEZONES.includes('Europe/Athens'), 'Must include Europe/Athens in common IANA zones');
assert(COMMON_IANA_TIMEZONES.includes('America/New_York'), 'Must include America/New_York in common IANA zones');
assert(COMMON_IANA_TIMEZONES.includes('Asia/Kolkata'), 'Must include Asia/Kolkata in common IANA zones');
assert(isValidTimezone(detectUserTimezone()), 'detectUserTimezone returns a valid zone');

const athensMember = {
  ...dummyMember,
  id: 'athens-1',
  discord_username: 'AthensFox',
  bedtime_local: '23:30',
  timezone: 'Europe/Athens',
};

// Test Athens in winter (EET = UTC+2): 21:30 UTC is 23:30 in Athens
const athensWinterUtc = DateTime.fromISO('2026-11-10T21:30:00.000Z');
const athensState = computeMemberState(athensMember, 'UTC', athensWinterUtc);
assert.strictEqual(athensState.bucket, 'BEDTIME_NOW');
assert.strictEqual(athensState.formattedSleeperTime, '11:30 PM');
assert.strictEqual(athensState.formattedViewerTime, '9:30 PM');
console.log('   ✅ Strict IANA timezone Europe/Athens evaluates with exact Luxon zone math.');

// 7. Test Daylight Saving Time (DST) Transitions
console.log('7. Testing Daylight Saving Time (DST) Transitions...');
const nyMember = {
  ...dummyMember,
  id: 'ny-1',
  discord_username: 'NewYorkFox',
  bedtime_local: '23:00',
  timezone: 'America/New_York',
};

// In 2026:
// - Summer (EDT = UTC-4): 2026-07-15. Bedtime 23:00 EDT occurs at 2026-07-16 03:00 UTC.
const summerUtc = DateTime.fromISO('2026-07-16T03:00:00.000Z');
const summerState = computeMemberState(nyMember, 'UTC', summerUtc);
assert.strictEqual(summerState.bucket, 'BEDTIME_NOW');
assert.strictEqual(summerState.diffMinutes, 0);
assert.strictEqual(summerState.formattedViewerTime, '3:00 AM');

// - Winter (EST = UTC-5): 2026-12-15. Bedtime 23:00 EST occurs at 2026-12-16 04:00 UTC.
const winterUtc = DateTime.fromISO('2026-12-16T04:00:00.000Z');
const winterState = computeMemberState(nyMember, 'UTC', winterUtc);
assert.strictEqual(winterState.bucket, 'BEDTIME_NOW');
assert.strictEqual(winterState.diffMinutes, 0);
assert.strictEqual(winterState.formattedViewerTime, '4:00 AM');

// Cross-Timezone DST test: Viewer in Asia/Kolkata (UTC+5:30, no DST) viewing America/New_York across DST
// Summer (EDT): 23:00 EDT -> 03:00 UTC -> 08:30 IST
const viewerInKolkataSummer = computeMemberState(nyMember, 'Asia/Kolkata', summerUtc);
assert.strictEqual(viewerInKolkataSummer.formattedViewerTime, '8:30 AM');

// Winter (EST): 23:00 EST -> 04:00 UTC -> 09:30 IST
const viewerInKolkataWinter = computeMemberState(nyMember, 'Asia/Kolkata', winterUtc);
assert.strictEqual(viewerInKolkataWinter.formattedViewerTime, '9:30 AM');

console.log('   ✅ DST transitions in America/New_York accurately shift UTC & viewer times between EDT and EST.');
console.log('🎉 All IANA & GMT Timezone Precision and DST test cases passed successfully!');
