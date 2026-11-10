import {
  checkPinRateLimit,
  recordPinFailure,
  resetPinFailure,
  clearAllPinRateLimits,
} from '../src/lib/rateLimit.ts';

console.log('🧪 Starting PIN Verification Rate Limiting Verification Suite...\n');

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
// 1. Initial State & Clean Start
// -------------------------------------------------------------
console.log('--- 1. Initial State & Clean Start ---');
clearAllPinRateLimits();

const initialCheck = checkPinRateLimit('1.1.1.1', 'member-1');
assert(initialCheck.allowed === true, 'Initial attempt is allowed');
assert(initialCheck.retryAfterSeconds === 0, 'Initial retryAfterSeconds is 0');

// -------------------------------------------------------------
// 2. IP Rate Limit Enforcement
// -------------------------------------------------------------
console.log('\n--- 2. IP Rate Limit Enforcement (5 failed attempts max) ---');
clearAllPinRateLimits();

const ip = '198.51.100.50';

for (let i = 1; i <= 4; i++) {
  recordPinFailure(ip, `target-${i}`);
  const check = checkPinRateLimit(ip, `target-${i}`);
  assert(check.allowed === true, `Attempt ${i} is still allowed`);
}

// 5th failure
recordPinFailure(ip, 'target-5');
const checkBlocked = checkPinRateLimit(ip, 'target-new');
assert(checkBlocked.allowed === false, '6th attempt from same IP is blocked');
assert(checkBlocked.retryAfterSeconds > 0, 'Retry-After header seconds reported');

// -------------------------------------------------------------
// 3. Per-Member Shared Rate Limit Across IPs
// -------------------------------------------------------------
console.log('\n--- 3. Per-Member Rate Limit Enforcement Across Different IPs ---');
clearAllPinRateLimits();

const memberTarget = 'member-victim-uuid-1234';

// 5 failed attempts from 5 completely different IPs
for (let i = 1; i <= 5; i++) {
  recordPinFailure(`10.0.0.${i}`, memberTarget);
}

// 6th attempt from a 6th completely new IP
const crossIpCheck = checkPinRateLimit('172.16.0.99', memberTarget);
assert(crossIpCheck.allowed === false, 'Target member is blocked even when attacker rotates to a new IP');
assert(crossIpCheck.retryAfterSeconds > 0, 'Retry-After reported for member target');

// Verify that an unrelated member from the new IP is NOT blocked
const unrelatedMemberCheck = checkPinRateLimit('172.16.0.99', 'member-innocent-uuid-5678');
assert(unrelatedMemberCheck.allowed === true, 'Unrelated member from new IP is allowed');

// -------------------------------------------------------------
// 4. Reset Failure Behavior on Success
// -------------------------------------------------------------
console.log('\n--- 4. Reset Failure Behavior on Success ---');
clearAllPinRateLimits();

const testIp = '203.0.113.10';
const memberA = 'member-a-id';
const memberB = 'member-b-id';

// Record 3 failures on Member A
recordPinFailure(testIp, memberA);
recordPinFailure(testIp, memberA);
recordPinFailure(testIp, memberA);

// Member B logs in successfully
resetPinFailure(testIp, memberB);

// Member A's failed count must still remain tracked (not wiped by Member B's login)
recordPinFailure(testIp, memberA);
recordPinFailure(testIp, memberA);
const memberABlocked = checkPinRateLimit(testIp, memberA);
assert(memberABlocked.allowed === false, 'Member A hits limit after 5 total failures (not wiped by Member B)');

// Member A provides correct PIN and resets
resetPinFailure(testIp, memberA);
const memberAUnblocked = checkPinRateLimit('99.99.99.99', memberA);
assert(memberAUnblocked.allowed === true, 'Member A target is cleared after successful reset');

// IP failure tracking must NOT be cleared by a member reset (prevents brute-force IP evasion)
const ipStillTracked = checkPinRateLimit(testIp, 'other-member');
assert(ipStillTracked.allowed === false, 'IP attempt count is preserved to prevent attacker resetting IP limits');

// -------------------------------------------------------------
// 5. Edge Cases: Empty or Whitespace Identifiers
// -------------------------------------------------------------
console.log('\n--- 5. Edge Cases: Empty or Whitespace Identifiers ---');
clearAllPinRateLimits();

recordPinFailure('1.2.3.4', '');
recordPinFailure('1.2.3.4', '   ');
const checkEmpty = checkPinRateLimit('5.6.7.8', '');
assert(checkEmpty.allowed === true, 'Empty target IDs do not share a single global empty bucket');

// -------------------------------------------------------------
// 6. Sliding Window Expiration
// -------------------------------------------------------------
console.log('\n--- 6. Sliding Window Expiration ---');
clearAllPinRateLimits();

// Record failure with windowMs = 50ms
recordPinFailure('192.0.2.1', 'member-expiry', 50);
recordPinFailure('192.0.2.1', 'member-expiry', 50);
recordPinFailure('192.0.2.1', 'member-expiry', 50);
recordPinFailure('192.0.2.1', 'member-expiry', 50);
recordPinFailure('192.0.2.1', 'member-expiry', 50);

const immediateCheck = checkPinRateLimit('192.0.2.1', 'member-expiry', 5, 50);
assert(immediateCheck.allowed === false, 'Immediately blocked when reaching max attempts');

await new Promise((resolve) => setTimeout(resolve, 60));

const expiredCheck = checkPinRateLimit('192.0.2.1', 'member-expiry', 5, 50);
assert(expiredCheck.allowed === true, 'Allowed again after sliding window expires');

// -------------------------------------------------------------
// 7. Multi-Target Failure Recording (No Double Counting of Client IP)
// -------------------------------------------------------------
console.log('\n--- 7. Multi-Target Failure Recording (No Double Counting of Client IP) ---');
clearAllPinRateLimits();

const multiTargetIp = '198.51.100.99';
const canonicalId = 'canonical-uuid-1111';
const usernameAlias = 'alias-username-alice';

// 4 attempts where primary is canonicalId (with IP) and secondary is alias (with empty IP)
for (let i = 1; i <= 4; i++) {
  recordPinFailure(multiTargetIp, canonicalId);
  recordPinFailure('', usernameAlias);
}

const checkAfter4 = checkPinRateLimit(multiTargetIp, canonicalId);
assert(checkAfter4.allowed === true, 'IP is not prematurely blocked after 4 multi-target attempts');

// 5th attempt triggers lockout exactly on 5th failure
recordPinFailure(multiTargetIp, canonicalId);
recordPinFailure('', usernameAlias);

const checkAfter5 = checkPinRateLimit(multiTargetIp, canonicalId);
assert(checkAfter5.allowed === false, 'IP is blocked on exactly the 5th attempt');
const checkAliasBlocked = checkPinRateLimit('9.9.9.9', usernameAlias);
assert(checkAliasBlocked.allowed === false, 'Username alias target is also tracked and blocked across IPs');

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
if (failed) {
  console.error('\n❌ SOME RATE LIMITING TESTS FAILED!');
  process.exit(1);
} else {
  console.log('\n🎉 ALL PIN RATE LIMITING TESTS PASSED CLEANLY!\n');
}
