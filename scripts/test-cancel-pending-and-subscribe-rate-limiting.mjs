import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Configure test environment variables prior to module imports
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-rate-limiting-db.supabase.co';
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key-rate-limiting';
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
  clearInMemoryPinRateLimits,
} = await import('../src/lib/rateLimit.ts');
const { supabaseAdmin } = await import('../src/lib/db.ts');
const { POST: handleCancelPending } = await import('../src/app/api/members/cancel-pending/route.ts');

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

    const memberId = 'cancel-discord-member';
    currentMemberRow = { id: memberId, is_active: true, timezone: 'UTC' };

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

    // Verify expected persisted rows in rateLimitsDb for moderator gate
    const modIpRow = rateLimitsDb.get(`ip:${modClientIp}`);
    const modTargetRow = rateLimitsDb.get(`target:mod_gate_ip:${modClientIp}`);
    testAssert(
      (modTargetRow && modTargetRow.count >= 5) || (modIpRow && modIpRow.count >= 5),
      'rateLimitsDb contains persisted row with count>=5 for moderator attempt'
    );

    // Clear ONLY in-memory state before 6th attempt to verify persistent lockout lookup
    clearInMemoryPinRateLimits();

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
    testAssert(resModBlocked.status === 429, '6th moderator passcode attempt is blocked with HTTP 429 (persisted)');
    testAssert(
      jsonModBlocked.error && jsonModBlocked.error.includes('Too many failed moderator passcode attempts'),
      'Returns moderator lockout message'
    );
    testAssert(
      resModBlocked.headers.get('Retry-After') !== null,
      'Response includes Retry-After header'
    );

    // 3.2b Cold instance test: Seed persisted moderator lockout directly without prior local memory
    clearInMemoryPinRateLimits();
    const coldModIp = '198.51.100.111';
    rateLimitsDb.set(`target:mod_gate_ip:${coldModIp}`, {
      key: `target:mod_gate_ip:${coldModIp}`,
      count: 5,
      window_start: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    const reqColdMod = new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': coldModIp,
      },
      body: JSON.stringify({
        member_id: memberId,
        mod_passcode: process.env.MOD_SECRET_PASSCODE,
      }),
    });
    const resColdMod = await handleCancelPending(reqColdMod);
    testAssert(resColdMod.status === 429, 'Cold instance moderator request blocked with HTTP 429 from persisted row');

    // -------------------------------------------------------------
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
