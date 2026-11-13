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
      pending_wake_time_local: '09:00',
      pending_timezone: 'America/New_York',
      pending_weekend_bedtime_local: null,
      pending_weekend_wake_time_local: null,
      pending_weekly_schedule: null,
      weekly_schedule: null,
      pending_effective_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    };

    const clientIp = '198.51.100.77';

    // 2.0 Test requests without a PIN return 401 without recording a PIN failure
    const reqNoPin = new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': clientIp,
      },
      body: JSON.stringify({
        member_id: memberId,
        // pin omitted
      }),
    });
    const resNoPin = await handleCancelPending(reqNoPin);
    const jsonNoPin = await resNoPin.json();
    testAssert(resNoPin.status === 401, 'Request without PIN returns HTTP 401 Unauthorized');
    testAssert(jsonNoPin.error && jsonNoPin.error.includes('PIN is required'), 'Returns PIN is required error');
    testAssert(!rateLimitsDb.has(`ip:${clientIp}`), 'Request without PIN does not increment IP rate limit counter');
    testAssert(!rateLimitsDb.has(`target:${memberId}`), 'Request without PIN does not increment target rate limit counter');

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

    // Verify expected persisted rows in rateLimitsDb
    const persistedIpRow = rateLimitsDb.get(`ip:${clientIp}`);
    const persistedTargetRow = rateLimitsDb.get(`target:${memberId}`);
    testAssert(persistedIpRow && persistedIpRow.count === 5, 'rateLimitsDb contains persisted row with count=5 for IP');
    testAssert(persistedTargetRow && persistedTargetRow.count === 5, 'rateLimitsDb contains persisted row with count=5 for target');

    // Clear ONLY the in-memory PIN rate-limit state before the 6th request to verify persistent database lookup
    clearInMemoryPinRateLimits();

    // 2.2 6th attempt should be blocked with HTTP 429 and Retry-After via persistent lookup
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
    testAssert(resBlocked.status === 429, '6th attempt is blocked with HTTP 429 Too Many Requests (persisted)');
    testAssert(
      jsonBlocked.error && jsonBlocked.error.includes('Too many failed attempts'),
      'Returns rate limit exceeded error message'
    );
    testAssert(
      resBlocked.headers.get('Retry-After') !== null && Number(resBlocked.headers.get('Retry-After')) > 0,
      'Response includes Retry-After header with positive duration'
    );

    // 2.2b Cold instance test: Seed persisted lockout directly in rateLimitsDb with zero in-memory entries
    clearInMemoryPinRateLimits();
    const coldMemberId = 'mem_cold_test_99';
    const coldIp = '198.51.100.99';
    const coldPin = '4321';
    rateLimitsDb.set(`target:${coldMemberId}`, {
      key: `target:${coldMemberId}`,
      count: 5,
      window_start: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    // Point currentMemberRow to cold member
    const savedMemberRow = currentMemberRow;
    currentMemberRow = {
      id: coldMemberId,
      discord_username: 'ColdFox',
      discord_id: null,
      passcode_hash: hashPin(coldPin),
      role: 'member',
      is_active: true,
      bedtime_local: '23:00',
      wake_time_local: '07:00',
      timezone: 'America/New_York',
      pending_bedtime_local: '01:00',
      pending_wake_time_local: '09:00',
      pending_timezone: 'America/New_York',
      pending_weekend_bedtime_local: null,
      pending_weekend_wake_time_local: null,
      pending_weekly_schedule: null,
      weekly_schedule: null,
      pending_effective_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    };

    const reqCold = new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': coldIp,
      },
      body: JSON.stringify({
        member_id: coldMemberId,
        pin: coldPin,
      }),
    });

    const resCold = await handleCancelPending(reqCold);
    const jsonCold = await resCold.json();
    testAssert(resCold.status === 429, 'Cold instance with seeded persisted lockout returns HTTP 429');
    testAssert(jsonCold.error && jsonCold.error.includes('Too many failed attempts'), 'Cold instance returns rate limit message');
    testAssert(resCold.headers.get('Retry-After') !== null, 'Cold instance response includes Retry-After header');

    // Restore member row for next assertions
    currentMemberRow = savedMemberRow;

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

    // 2.4 Scenario: Successful authentication with prior non-lockout failures resets rateLimitsDb automatically
    // Seed 2 prior failures without pre-calling resetPinFailurePersistent
    await recordPinFailurePersistent(clientIp, memberId);
    await recordPinFailurePersistent(clientIp, memberId);
    testAssert(rateLimitsDb.has(`target:${memberId}`), 'target:memberId has active failure entries prior to valid submission');

    // Re-seed pending fields for second cancellation assertion
    currentMemberRow.pending_bedtime_local = '02:00';
    currentMemberRow.pending_wake_time_local = '10:00';

    const reqAutoReset = new Request('http://localhost:3000/api/members/cancel-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.60',
      },
      body: JSON.stringify({
        member_id: memberId,
        pin: testPin,
      }),
    });
    const resAutoReset = await handleCancelPending(reqAutoReset);
    testAssert(resAutoReset.status === 200, 'Valid PIN through route succeeds with fewer than 5 prior failures');
    testAssert(!rateLimitsDb.has(`target:${memberId}`), 'Route automatically resets rateLimitsDb target entry upon successful authentication');

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

    // Verify expected persisted rows in rateLimitsDb
    const subIpRow = rateLimitsDb.get(`ip:${subClientIp}`);
    const subTargetRow = rateLimitsDb.get(`target:${subMemberId}`);
    testAssert(subIpRow && subIpRow.count === 5, 'rateLimitsDb contains persisted row with count=5 for subscribe IP');
    testAssert(subTargetRow && subTargetRow.count === 5, 'rateLimitsDb contains persisted row with count=5 for subscribe target');

    // Clear ONLY in-memory state before 6th attempt to verify persistent lockout lookup
    clearInMemoryPinRateLimits();

    // 4.2 6th attempt should be blocked with HTTP 429 (persisted)
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
    testAssert(resSubBlocked.status === 429, '6th subscribe attempt is blocked with HTTP 429 Too Many Requests (persisted)');
    testAssert(
      jsonSubBlocked.error && jsonSubBlocked.error.includes('Too many failed attempts'),
      'Returns rate limit exceeded error message for subscribe'
    );
    testAssert(
      resSubBlocked.headers.get('Retry-After') !== null && Number(resSubBlocked.headers.get('Retry-After')) > 0,
      'Subscribe 429 response includes valid Retry-After header'
    );

    // 4.2b Cold instance test for subscribe: Seed persisted lockout directly with zero in-memory entries
    clearInMemoryPinRateLimits();
    const coldSubMemberId = 'mem_cold_sub_99';
    rateLimitsDb.set(`target:${coldSubMemberId}`, {
      key: `target:${coldSubMemberId}`,
      count: 5,
      window_start: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    const savedSubMember = currentMemberRow;
    currentMemberRow = {
      id: coldSubMemberId,
      discord_username: 'ColdSubFox',
      passcode_hash: hashPin('9876'),
      is_active: true,
    };
    const reqColdSub = new Request('http://localhost:3000/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.88',
      },
      body: JSON.stringify({
        member_id: coldSubMemberId,
        pin: '9876',
        subscription: validSubscriptionPayload,
      }),
    });
    const resColdSub = await handlePushSubscribe(reqColdSub);
    testAssert(resColdSub.status === 429, 'Cold instance subscribe request blocked with HTTP 429 from persisted row');
    currentMemberRow = savedSubMember;

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

    // 4.4 Scenario: Successful subscribe with prior non-lockout failures resets rateLimitsDb automatically
    await recordPinFailurePersistent('192.0.2.77', subMemberId);
    await recordPinFailurePersistent('192.0.2.77', subMemberId);
    testAssert(rateLimitsDb.has(`target:${subMemberId}`), 'target:subMemberId has active failure entries prior to valid submission');

    const reqSubAutoReset = new Request('http://localhost:3000/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.0.2.78',
      },
      body: JSON.stringify({
        member_id: subMemberId,
        pin: subPin,
        subscription: validSubscriptionPayload,
      }),
    });
    const resSubAutoReset = await handlePushSubscribe(reqSubAutoReset);
    testAssert(resSubAutoReset.status === 200, 'Valid PIN returns HTTP 200 on subscribe with prior failures');
    testAssert(!rateLimitsDb.has(`target:${subMemberId}`), 'Subscribe route resets rateLimitsDb target:subMemberId upon successful auth');

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
