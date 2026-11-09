import { isDemoSeedMember, DEMO_SEED_FINGERPRINTS } from '../src/lib/demoSeed.ts';

console.log('🧪 Starting Demo Seed Fingerprint & Safe Purge Verification Suite...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

// -------------------------------------------------------------
// 1. Positive Identifications (Pre-seeded Demo Profiles)
// -------------------------------------------------------------
console.log('--- 1. Positive Matching for Pre-seeded Demo Profiles ---');

for (const seed of DEMO_SEED_FINGERPRINTS) {
  assert(
    isDemoSeedMember(seed),
    `Pre-seeded profile "${seed.discord_username}" (${seed.discord_handle}) is correctly identified as a demo profile`
  );
}

// Case insensitivity and whitespace resilience
const trimmedAoi = {
  discord_username: ' aoi ',
  discord_handle: ' AOI_JP ',
  journal_url: 'https://discord.com/channels/123456789/987654321',
};
assert(
  isDemoSeedMember(trimmedAoi),
  'Demo detection handles case differences and whitespace trimming'
);

// -------------------------------------------------------------
// 2. Negative Tests (Real Users with Common Names)
// -------------------------------------------------------------
console.log('\n--- 2. Protection of Real Members with Common Names ---');

// Real user named Marcus with real Discord journal thread
const realMarcus = {
  discord_username: 'Marcus',
  discord_handle: 'marcus_real',
  journal_url: 'https://discord.com/channels/9988776655/1122334455',
};
assert(
  !isDemoSeedMember(realMarcus),
  'Real user named "Marcus" with real Discord journal is NOT identified as demo'
);

// Real user named Arjun with same handle but real Discord server thread
const realArjun = {
  discord_username: 'Arjun',
  discord_handle: 'arjun_in',
  journal_url: 'https://discord.com/channels/5544332211/9988776655',
};
assert(
  !isDemoSeedMember(realArjun),
  'Real user named "Arjun" with different journal thread is NOT identified as demo'
);

// Real user with demo journal URL but different username/handle
const imposter = {
  discord_username: 'NotAoi',
  discord_handle: 'aoi_jp',
  journal_url: 'https://discord.com/channels/123456789/987654321',
};
assert(
  !isDemoSeedMember(imposter),
  'User with mismatched username is NOT identified as demo'
);

// -------------------------------------------------------------
// 3. Edge Cases & Safety
// -------------------------------------------------------------
console.log('\n--- 3. Edge Cases & Falsy Input Safety ---');

assert(!isDemoSeedMember(null), 'Null input returns false');
assert(!isDemoSeedMember(undefined), 'Undefined input returns false');
assert(!isDemoSeedMember({}), 'Empty object returns false');
assert(!isDemoSeedMember({ discord_username: '' }), 'Empty username returns false');
assert(!isDemoSeedMember({ discord_username: 'SarahK' }), 'Missing handle & journal returns false');

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
if (failed) {
  console.error('\n❌ SOME DEMO SEED FINGERPRINT TESTS FAILED!');
  process.exit(1);
} else {
  console.log('\n🎉 ALL 11 DEMO SEED FINGERPRINT TESTS PASSED CLEANLY!\n');
}
