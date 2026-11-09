import assert from 'assert';
import { DateTime } from 'luxon';
import {
  GMT_OFFSETS,
  toValidLuxonZone,
  isValidTimezone,
  formatGmtOffset,
  computeMemberState,
} from '../src/lib/sleepEngine.ts';

console.log('🧪 Running GMT Timezone Privacy & Format Test Suite...');

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
console.log('   ✅ toValidLuxonZone translates all offsets correctly.');

// 3. Test isValidTimezone
console.log('3. Testing isValidTimezone validation...');
assert.strictEqual(isValidTimezone('GMT+05:30'), true);
assert.strictEqual(isValidTimezone('GMT-05:00'), true);
assert.strictEqual(isValidTimezone('GMT+00:00'), true);
assert.strictEqual(isValidTimezone('America/New_York'), true);
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
console.log('🎉 All GMT Timezone Privacy test cases passed successfully!');
