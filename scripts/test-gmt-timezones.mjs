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
  ALL_IANA_TIMEZONES,
  ALL_TIMEZONES,
  isKnownTimezone,
  getTimezoneGroups,
  filterTimezoneGroups,
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

// 8. Test Global IANA Timezone Catalog (ALL_IANA_TIMEZONES and ALL_TIMEZONES)
console.log('8. Testing comprehensive global IANA & GMT catalog...');
assert(Array.isArray(ALL_IANA_TIMEZONES), 'ALL_IANA_TIMEZONES must be an array');
assert(ALL_IANA_TIMEZONES.length >= 400, 'Must cover 400+ canonical global timezones');
assert(ALL_TIMEZONES.length >= ALL_IANA_TIMEZONES.length + GMT_OFFSETS.length, 'ALL_TIMEZONES contains all IANA + GMT');

// Test presence of previously missing user timezones across various continents
const criticalZones = [
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Stockholm',
  'Europe/Vienna',
  'America/Edmonton',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'Africa/Nairobi',
  'Africa/Casablanca',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Pacific/Fiji',
];

for (const zone of criticalZones) {
  assert(ALL_IANA_TIMEZONES.includes(zone), `Must include ${zone} in comprehensive catalog`);
  assert(isValidTimezone(zone), `Zone ${zone} must be valid in Luxon`);
  assert(isKnownTimezone(zone), `Zone ${zone} must be recognized as known`);
}
console.log(`   ✅ Global catalog covers ${ALL_IANA_TIMEZONES.length} canonical IANA zones with 100% Luxon validity.`);

// 9. Test Categorized Timezone Groups
console.log('9. Testing categorized timezone groups (getTimezoneGroups)...');
const groups = getTimezoneGroups();
assert(Array.isArray(groups) && groups.length >= 8, 'Must return at least 8 structured groups');
const groupLabels = groups.map((g) => g.label);
assert(groupLabels.includes('Popular Timezones'), 'Must include Popular Timezones group');
assert(groupLabels.includes('Standard GMT Offsets'), 'Must include Standard GMT Offsets group');
assert(groupLabels.includes('Americas'), 'Must include Americas group');
assert(groupLabels.includes('Europe'), 'Must include Europe group');
assert(groupLabels.includes('Asia'), 'Must include Asia group');
assert(groupLabels.includes('Africa'), 'Must include Africa group');
assert(groupLabels.includes('Oceania & Pacific'), 'Must include Oceania & Pacific group');

for (const group of groups) {
  assert(group.options.length > 0, `Group "${group.label}" must contain options`);
  for (const opt of group.options) {
    assert(typeof opt.value === 'string' && opt.value.length > 0, 'Option value must be non-empty');
    assert(typeof opt.label === 'string' && opt.label.length > 0, 'Option label must be non-empty');
  }
}
console.log(`   ✅ getTimezoneGroups structured ${groups.length} groups with valid options.`);

// 10. Test Search Filtering (filterTimezoneGroups)
console.log('10. Testing search filtering (filterTimezoneGroups)...');
const karachiFiltered = filterTimezoneGroups(groups, 'karachi');
assert(karachiFiltered.length > 0, 'Must find matches for "karachi"');
assert(
  karachiFiltered.some((g) => g.options.some((o) => o.value === 'Asia/Karachi')),
  'Must find Asia/Karachi when querying "karachi"'
);

const plus530Filtered = filterTimezoneGroups(groups, '+5:30');
assert(plus530Filtered.length > 0, 'Must find matches for "+5:30"');
assert(
  plus530Filtered.some((g) => g.options.some((o) => o.value === 'Asia/Kolkata' || o.value === 'GMT+05:30')),
  'Must match Asia/Kolkata and GMT+05:30 for "+5:30"'
);

const gmtMinus5Filtered = filterTimezoneGroups(groups, 'GMT-5');
assert(gmtMinus5Filtered.length > 0, 'Must find matches for "GMT-5"');
assert(
  gmtMinus5Filtered.some((g) => g.options.some((o) => o.value === 'GMT-05:00')),
  'Must match GMT-05:00 for "GMT-5"'
);

// Precise hour-only search (+1 must NOT match +10..+14, while +5 matches partial-minute +05:30)
const plus1Filtered = filterTimezoneGroups(groups, '+1');
assert(plus1Filtered.length > 0, 'Must find matches for "+1"');
assert(
  plus1Filtered.some((g) => g.options.some((o) => o.value === 'GMT+01:00')),
  'Must match GMT+01:00 for "+1"'
);
assert(
  !plus1Filtered.some((g) => g.options.some((o) => o.value === 'GMT+10:00')),
  'Must NOT match GMT+10:00 for "+1"'
);
assert(
  !plus1Filtered.some((g) => g.options.some((o) => o.value === 'GMT+12:00')),
  'Must NOT match GMT+12:00 for "+1"'
);

const plus5Filtered = filterTimezoneGroups(groups, '+5');
assert(plus5Filtered.length > 0, 'Must find matches for "+5"');
assert(
  plus5Filtered.some((g) => g.options.some((o) => o.value === 'Asia/Kolkata' || o.value === 'GMT+05:30')),
  'Must match partial-minute GMT+05:30 (Asia/Kolkata) when querying hour "+5"'
);

// 11. Preserving existing user timezones
console.log('11. Verifying existing user timezones are preserved and valid...');
const existingUserZones = ['Asia/Tokyo', 'America/New_York', 'Europe/London', 'Asia/Kolkata'];
for (const tz of existingUserZones) {
  assert(isKnownTimezone(tz), `Existing user timezone ${tz} must be recognized`);
  assert(isValidTimezone(tz), `Existing user timezone ${tz} must remain valid`);
}
assert(ALL_IANA_TIMEZONES.every(isValidTimezone), 'All exposed ALL_IANA_TIMEZONES must pass isValidTimezone');
console.log('   ✅ All existing user timezones remain intact and fully supported.');

console.log('🎉 All IANA & GMT Timezone Precision and DST test cases passed successfully!');
