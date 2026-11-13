if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

import { hashPin, verifyPin } from '../src/lib/auth.ts';
import { checkCooldownPromotion, computeMemberState } from '../src/lib/sleepEngine.ts';
import { DateTime } from 'luxon';

console.log('🧪 Starting Self-Service Schedule & 48-Hour Cooldown Verification...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

// 1. PIN Security Tests
console.log('--- 1. PIN Security Tests ---');
const pin = '4821';
const hashed = hashPin(pin);
assert(hashed && hashed.length === 64, 'hashPin produces 64-char sha256 hex');
assert(verifyPin('4821', hashed) === true, 'verifyPin accepts correct PIN');
assert(verifyPin('0000', hashed) === false, 'verifyPin rejects wrong PIN');
assert(verifyPin('', hashed) === false, 'verifyPin rejects empty PIN');
assert(verifyPin('4821', null) === false, 'verifyPin handles null hash safely');

// 2. Discord Journal Regex Tests
console.log('\n--- 2. Discord Journal URL Regex Tests ---');
const DISCORD_JOURNAL_REGEX = /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;
assert(
  DISCORD_JOURNAL_REGEX.test('https://discord.com/channels/123456789/987654321'),
  'Standard Discord thread URL is valid'
);
assert(
  DISCORD_JOURNAL_REGEX.test('https://canary.discord.com/channels/123456789/987654321/11223344'),
  'Canary Discord thread URL with message id is valid'
);
assert(
  DISCORD_JOURNAL_REGEX.test('https://ptb.discord.com/channels/123456789/987654321'),
  'PTB Discord thread URL is valid'
);
assert(
  !DISCORD_JOURNAL_REGEX.test('http://discord.com/channels/123/456'),
  'Insecure HTTP is rejected'
);
assert(
  !DISCORD_JOURNAL_REGEX.test('https://evil-discord.com/channels/123/456'),
  'Phishing domain is rejected'
);
assert(
  !DISCORD_JOURNAL_REGEX.test('javascript:alert(1)'),
  'XSS javascript URI is rejected'
);

// 3. 48-Hour Cooldown & Self-Healing Promotion Tests
console.log('\n--- 3. 48-Hour Cooldown & Promotion Tests ---');
const mockMember = {
  id: 'test-1',
  discord_username: 'TestUser',
  discord_handle: 'test_user',
  avatar_url: null,
  journal_url: 'https://discord.com/channels/111/222',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  timezone: 'America/New_York',
  pending_bedtime_local: '01:00',
  pending_wake_time_local: '09:00',
  pending_timezone: 'America/Los_Angeles',
  pending_effective_at: DateTime.utc().plus({ hours: 47, minutes: 55 }).toISO(),
  role: 'member',
  passcode_hash: hashed,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Test pending not yet reached: active schedule must be preserved!
const notPromoted = checkCooldownPromotion(mockMember);
assert(notPromoted.promoted === false, 'Pending change in future is not promoted');
assert(notPromoted.activeMember.bedtime_local === '23:00', 'Active bedtime stays 23:00');
assert(notPromoted.activeMember.timezone === 'America/New_York', 'Active timezone stays America/New_York');

// Test pending reached in past: must promote pending to active and clear pending fields!
const pastMember = {
  ...mockMember,
  pending_effective_at: DateTime.utc().minus({ minutes: 5 }).toISO(),
};
const promoted = checkCooldownPromotion(pastMember);
assert(promoted.promoted === true, 'Pending change past effective date is promoted');
assert(promoted.activeMember.bedtime_local === '01:00', 'Promoted bedtime becomes 01:00');
assert(promoted.activeMember.timezone === 'America/Los_Angeles', 'Promoted timezone becomes America/Los_Angeles');
assert(promoted.activeMember.pending_bedtime_local === null, 'pending_bedtime_local cleared');
assert(promoted.activeMember.pending_effective_at === null, 'pending_effective_at cleared');

// 4. Timezone Computation with Pending Notice Banner
console.log('\n--- 4. Member State & Cooldown Notice Banner ---');
const state = computeMemberState(mockMember, 'Asia/Kolkata');
assert(state.pendingNotice !== null && state.pendingNotice.includes('Schedule shifting in'), 'Member state displays pending notice');
console.log('Pending Notice Text:', state.pendingNotice);
console.log('Formatted Sleeper Time:', state.formattedSleeperTime);
console.log('Formatted Viewer Time:', state.formattedViewerTime);

if (failed) {
  console.error('\n❌ SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('\n🎉 ALL 14 LOGIC & COOLDOWN TESTS PASSED CLEANLY!');
}
