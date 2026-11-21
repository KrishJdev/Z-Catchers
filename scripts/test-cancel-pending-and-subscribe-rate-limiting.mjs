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

    return origFrom.call(supabaseAdmin, table);
  };

  try {
    const accountIp = '198.51.100.111';
    const accountKey = 'member-rate-fixture';
    await clearAllPinRateLimitsPersistent();
    for (let i = 0; i < 5; i++) await recordPinFailurePersistent(accountIp, accountKey);
    clearInMemoryPinRateLimits();
    const blocked = await checkPinRateLimitPersistent(accountIp, accountKey);
    testAssert(!blocked.allowed && blocked.retryAfterSeconds > 0, 'Account rate limit persists across instances');
    await resetPinFailurePersistent(accountIp, accountKey);
    testAssert(!rateLimitsDb.has(`target:${accountKey}`) && rateLimitsDb.has(`ip:${accountIp}`),
      'Account reset clears the target while preserving the shared IP limit');

    const memberId = 'cancel-discord-member';
    currentMemberRow = { id: memberId, is_active: true, timezone: 'UTC' };

    // Retired credentials cannot cancel a pending change or hit the account rate limiter.
    await clearAllPinRateLimitsPersistent();
    rateLimitsDb.clear();
    const retired = 'retired-moderation-credential';
    process.env.MOD_SECRET_PASSCODE = retired;
    const retiredRequest = await handleCancelPending(new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mod-passcode': retired },
      body: JSON.stringify({ member_id: memberId, mod_passcode: retired }),
    }));
    testAssert(retiredRequest.status === 401, 'Retired credential cannot cancel a pending change');
    testAssert(rateLimitsDb.size === 0, 'Retired credential does not consume account rate limits');

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
