import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Configure test environment variables prior to module imports
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'z_catchers_test_session_secret_2026_rate_limit';
}
if (!process.env.PIN_SALT) {
  process.env.PIN_SALT = 'z_catchers_test_pin_salt_2026';
}

const {
  checkPinRateLimitPersistent,
  recordPinFailurePersistent,
  resetPinFailurePersistent,
  clearAllPinRateLimitsPersistent,
  clearAllPinRateLimits,
} = await import('../src/lib/rateLimit.ts');
const { hashPin } = await import('../src/lib/auth.ts');
const { supabaseAdmin } = await import('../src/lib/db.ts');
const { POST: handleCancelPending } = await import('../src/app/api/members/cancel-pending/route.ts');
const { POST: handlePushSubscribe } = await import('../src/app/api/push/subscribe/route.ts');

console.log('🧪 Starting Persistent Rate Limiting Verification Suite (GH #32, ZC-18)...\n');

let failed = false;
function testAssert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  }
}

async function run() {
  const origFrom = supabaseAdmin.from;

  // In-memory mock database tables for offline deterministic execution
  const rateLimitsDb = new Map(); // key -> { key, count, window_start, expires_at }
  let currentMemberRow = null;
  let pushSubs = [];

  // Setup universal table router for supabaseAdmin.from
  supabaseAdmin.from = (table) => {
    if (table === 'rate_limits') {
      return {
        select: (fields = '*') => ({
          in: (col, keys) => ({
            gt: (col2, nowIso) => {
              const rows = [];
              for (const k of keys) {
                const entry = rateLimitsDb.get(k);
                if (entry && entry.expires_at > nowIso) {
                  rows.push({ key: entry.key, count: entry.count, expires_at: entry.expires_at });
                }
              }
              return Promise.resolve({ data: rows, error: null });
            },
          }),
          eq: (col, keyVal) => ({
            maybeSingle: () => {
              const entry = rateLimitsDb.get(keyVal);
              return Promise.resolve({
                data: entry ? { count: entry.count, expires_at: entry.expires_at } : null,
                error: null,
              });
            },
          }),
        }),
        update: (updates) => ({
          eq: (col, keyVal) => {
            return {
              lte: (col2, nowIso) => ({
                select: () => ({
                  maybeSingle: () => {
                    const existing = rateLimitsDb.get(keyVal);
                    if (existing && existing.expires_at <= nowIso) {
                      rateLimitsDb.set(keyVal, { ...existing, ...updates });
                      return Promise.resolve({ data: { key: keyVal }, error: null });
                    }
                    return Promise.resolve({ data: null, error: null });
                  },
                }),
              }),
              eq: (col2, expectedCount) => ({
                gt: (col3, nowIso) => ({
                  select: () => ({
                    maybeSingle: () => {
                      const existing = rateLimitsDb.get(keyVal);
                      if (existing && existing.count === expectedCount && existing.expires_at > nowIso) {
                        rateLimitsDb.set(keyVal, { ...existing, ...updates });
                        return Promise.resolve({ data: { key: keyVal }, error: null });
                      }
                      return Promise.resolve({ data: null, error: null });
                    },
                  }),
                }),
              }),
            };
          },
        }),
        insert: (record) => {
          if (rateLimitsDb.has(record.key)) {
            return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
          }
          rateLimitsDb.set(record.key, { ...record });
          return Promise.resolve({ data: record, error: null });
        },
        delete: () => ({
          in: (col, keys) => {
            for (const k of keys) {
              rateLimitsDb.delete(k);
            }
            return Promise.resolve({ data: null, error: null });
          },
          lt: (col, nowIso) => {
            for (const [k, v] of rateLimitsDb.entries()) {
              if (v.expires_at < nowIso) rateLimitsDb.delete(k);
            }
            return Promise.resolve({ data: null, error: null });
          },
          neq: () => {
            rateLimitsDb.clear();
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    }

    if (table === 'members') {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        limit: () => builder,
        then: (resolve) => Promise.resolve({ data: [currentMemberRow], error: null }).then(resolve),
        single: async () => ({ data: currentMemberRow, error: null }),
        maybeSingle: async () => ({ data: currentMemberRow, error: null }),
        update: (updates) => {
          currentMemberRow = { ...currentMemberRow, ...updates };
          return builder;
        },
      };
      return builder;
    }

    if (table === 'push_subscriptions') {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        upsert: (record) => {
          pushSubs.push(record);
          return builder;
        },
        single: async () => ({ data: pushSubs[pushSubs.length - 1] || {}, error: null }),
      };
      return builder;
    }

    return origFrom.call(supabaseAdmin, table);
  };

  try {
    // -------------------------------------------------------------
    // 1. Static AST / Code Inspection (Zero Non-Persistent Rate Limit Calls)
    // -------------------------------------------------------------
    console.log('--- 1. Static Verification: Enforce Persistent Rate Limiting Imports & Calls ---');

    const cancelPendingCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/members/cancel-pending/route.ts'),
      'utf8'
    );
    const subscribeCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/push/subscribe/route.ts'),
      'utf8'
    );

    // Assert cancel-pending uses persistent imports
    testAssert(
      cancelPendingCode.includes('checkPinRateLimitPersistent') &&
        cancelPendingCode.includes('recordPinFailurePersistent') &&
        cancelPendingCode.includes('resetPinFailurePersistent'),
      'cancel-pending imports persistent rate limiting functions from @/lib/rateLimit'
    );
    testAssert(
      !cancelPendingCode.includes('checkPinRateLimit(') &&
        !cancelPendingCode.includes('recordPinFailure(') &&
        !cancelPendingCode.includes('resetPinFailure('),
      'cancel-pending contains zero non-persistent rate limit calls'
    );

    // Assert push/subscribe uses persistent imports
    testAssert(
      subscribeCode.includes('checkPinRateLimitPersistent') &&
        subscribeCode.includes('recordPinFailurePersistent') &&
        subscribeCode.includes('resetPinFailurePersistent'),
      'push/subscribe imports persistent rate limiting functions from @/lib/rateLimit'
    );
    testAssert(
      !subscribeCode.includes('checkPinRateLimit(') &&
        !subscribeCode.includes('recordPinFailure(') &&
        !subscribeCode.includes('resetPinFailure('),
      'push/subscribe contains zero non-persistent rate limit calls'
    );

    // -------------------------------------------------------------
    // 2. Cancel-Pending: Member PIN Rate Limit Enforcement (5 Failed Attempts Max)
    // -------------------------------------------------------------
    console.log('\n--- 2. Cancel-Pending: Member PIN Persistent Rate Limiting ---');
    await clearAllPinRateLimitsPersistent();
    clearAllPinRateLimits();
    rateLimitsDb.clear();

    const testPin = '1234';
    const wrongPin = '9999';
    const testHash = hashPin(testPin);
    const memberId = 'mem_rate_test_cancel_001';

    currentMemberRow = {
      id: memberId,
      discord_username: 'TestFox',
      discord_id: null,
      passcode_hash: testHash,
      role: 'member',
      is_active: true,
      bedtime_local: '23:00',
      wake_time_local: '07:00',
      timezone: 'America/New_York',
      pending_bedtime_local: '01:00',
      pending_effective_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    };

    const clientIp = '198.51.100.77';

    // 2.1 Send 5 failed PIN attempts
    for (let i = 1; i <= 5; i++) {
      const req = new Request('http://localhost:3000/api/members/cancel-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': clientIp,
        },
        body: JSON.stringify({
          member_id: memberId,
          pin: wrongPin,
        }),
      });

      const res = await handleCancelPending(req);
      const json = await res.json();
      testAssert(res.status === 401, `Attempt ${i}: Invalid PIN returns HTTP 401 Unauthorized`);
      testAssert(json.error && json.error.includes('Invalid PIN'), `Attempt ${i}: Returns Invalid PIN message`);
    }

    // 2.2 6th attempt should be blocked with HTTP 429 and Retry-After
    const reqBlocked = new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': clientIp,
      },
      body: JSON.stringify({
        member_id: memberId,
        pin: testPin, // Even with correct PIN, must be blocked
      }),
    });

    const resBlocked = await handleCancelPending(reqBlocked);
    const jsonBlocked = await resBlocked.json();
    testAssert(resBlocked.status === 429, '6th attempt is blocked with HTTP 429 Too Many Requests');
    testAssert(
      jsonBlocked.error && jsonBlocked.error.includes('Too many failed attempts'),
      'Returns rate limit exceeded error message'
    );
    testAssert(
      resBlocked.headers.get('Retry-After') !== null && Number(resBlocked.headers.get('Retry-After')) > 0,
      'Response includes Retry-After header with positive duration'
    );

    // 2.3 Clear member rate limit and test success resets failure tracking
    await resetPinFailurePersistent(clientIp, memberId);

    // Legitimate user IP (proves member target was unblocked by reset)
    const legitUserIp = '203.0.113.50';
    const reqSuccess = new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': legitUserIp,
      },
      body: JSON.stringify({
        member_id: memberId,
        pin: testPin,
      }),
    });

    const resSuccess = await handleCancelPending(reqSuccess);
    const jsonSuccess = await resSuccess.json();
    testAssert(resSuccess.status === 200, 'Valid PIN returns HTTP 200 OK after rate reset');
    testAssert(jsonSuccess.success === true, 'Response confirms pending schedule change cancelled');
    testAssert(currentMemberRow.pending_bedtime_local === null, 'Pending schedule fields successfully cleared');

    // -------------------------------------------------------------
    // 3. Cancel-Pending: Moderator Passcode Rate Limiting
    // -------------------------------------------------------------
    console.log('\n--- 3. Cancel-Pending: Moderator Passcode Persistent Rate Limiting ---');
    await clearAllPinRateLimitsPersistent();
    clearAllPinRateLimits();
    rateLimitsDb.clear();

    const modClientIp = '203.0.113.88';
    process.env.MOD_SECRET_PASSCODE = 'super_secret_fox_mod_2026';

    // 3.1 Send 5 invalid moderator passcode attempts
    for (let i = 1; i <= 5; i++) {
      const req = new Request('http://localhost:3000/api/members/cancel-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': modClientIp,
        },
        body: JSON.stringify({
          member_id: memberId,
          mod_passcode: 'wrong_passcode_' + i,
        }),
      });

      const res = await handleCancelPending(req);
      testAssert(
        res.status === 401 || res.status === 403 || res.status === 429,
        `Mod attempt ${i}: Rejected with HTTP ${res.status}`
      );
    }

    // 3.2 6th attempt with mod_passcode must return HTTP 429
    const reqModBlocked = new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': modClientIp,
      },
      body: JSON.stringify({
        member_id: memberId,
        mod_passcode: process.env.MOD_SECRET_PASSCODE,
      }),
    });

    const resModBlocked = await handleCancelPending(reqModBlocked);
    const jsonModBlocked = await resModBlocked.json();
    testAssert(resModBlocked.status === 429, '6th moderator passcode attempt is blocked with HTTP 429');
    testAssert(
      jsonModBlocked.error && jsonModBlocked.error.includes('Too many failed moderator passcode attempts'),
      'Returns moderator lockout message'
    );
    testAssert(
      resModBlocked.headers.get('Retry-After') !== null,
      'Response includes Retry-After header'
    );

    // -------------------------------------------------------------
    // 4. Push/Subscribe: Member PIN Rate Limit Enforcement
    // -------------------------------------------------------------
    console.log('\n--- 4. Push/Subscribe: Member PIN Persistent Rate Limiting ---');
    await clearAllPinRateLimitsPersistent();
    clearAllPinRateLimits();
    rateLimitsDb.clear();

    const subMemberId = 'mem_rate_test_subscribe_002';
    const subPin = '5678';
    const subHash = hashPin(subPin);
    const subClientIp = '192.0.2.44';

    currentMemberRow = {
      id: subMemberId,
      discord_username: 'SubFox',
      timezone: 'Europe/London',
      passcode_hash: subHash,
      is_active: true,
    };

    pushSubs = [];

    const validSubscriptionPayload = {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-endpoint-sub-1',
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t04ad70-bpR587W2FS25G0UVx0G3qnbV_JSpACkvRhchg',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    };

    // 4.1 Send 5 failed PIN attempts in subscribe
    for (let i = 1; i <= 5; i++) {
      const req = new Request('http://localhost:3000/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': subClientIp,
        },
        body: JSON.stringify({
          member_id: subMemberId,
          pin: '0000',
          subscription: validSubscriptionPayload,
        }),
      });

      const res = await handlePushSubscribe(req);
      testAssert(res.status === 401, `Subscribe attempt ${i}: Invalid PIN returns HTTP 401 Unauthorized`);
    }

    // 4.2 6th attempt should be blocked with HTTP 429
    const reqSubBlocked = new Request('http://localhost:3000/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': subClientIp,
      },
      body: JSON.stringify({
        member_id: subMemberId,
        pin: subPin, // Even with correct PIN, must be blocked
        subscription: validSubscriptionPayload,
      }),
    });

    const resSubBlocked = await handlePushSubscribe(reqSubBlocked);
    const jsonSubBlocked = await resSubBlocked.json();
    testAssert(resSubBlocked.status === 429, '6th subscribe attempt is blocked with HTTP 429 Too Many Requests');
    testAssert(
      jsonSubBlocked.error && jsonSubBlocked.error.includes('Too many failed attempts'),
      'Returns rate limit exceeded error message for subscribe'
    );
    testAssert(
      resSubBlocked.headers.get('Retry-After') !== null && Number(resSubBlocked.headers.get('Retry-After')) > 0,
      'Subscribe 429 response includes valid Retry-After header'
    );

    // 4.3 Reset rate limit and verify successful subscription with correct PIN
    await resetPinFailurePersistent(subClientIp, subMemberId);

    const legitSubIp = '198.51.100.99';
    const reqSubSuccess = new Request('http://localhost:3000/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': legitSubIp,
      },
      body: JSON.stringify({
        member_id: subMemberId,
        pin: subPin,
        subscription: validSubscriptionPayload,
      }),
    });

    const resSubSuccess = await handlePushSubscribe(reqSubSuccess);
    testAssert(resSubSuccess.status === 200, 'Valid PIN returns HTTP 200 OK after rate reset');

    console.log('\n--- 5. Cross-Route Isolation & Persistent Verification ---');
    // Verify an unrelated member from an unrelated IP is NOT rate limited
    const otherRateCheck = await checkPinRateLimitPersistent('10.10.10.10', 'mem_unrelated_009');
    testAssert(otherRateCheck.allowed === true, 'Unrelated member and IP is allowed');
    testAssert(otherRateCheck.retryAfterSeconds === 0, 'Unrelated member has 0 retryAfterSeconds');

  } finally {
    await clearAllPinRateLimitsPersistent();
    supabaseAdmin.from = origFrom;
    clearAllPinRateLimits();
  }

  if (failed) {
    console.error('\n❌ SOME TESTS FAILED in Persistent Rate Limiting Suite!');
    process.exitCode = 1;
  } else {
    console.log('\n🎉 ALL PERSISTENT RATE LIMITING TESTS PASSED CLEANLY! 🦊🔒');
  }
}

run().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exitCode = 1;
});
