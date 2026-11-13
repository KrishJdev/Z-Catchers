import assert from 'assert';

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
if (!process.env.MOD_SECRET_PASSCODE) {
  process.env.MOD_SECRET_PASSCODE = 'super_secret_fox_mod_2026';
}

const {
  clearAllPinRateLimitsPersistent,
  clearInMemoryPinRateLimits,
} = await import('../src/lib/rateLimit.ts');
const { hashPin, createSessionToken } = await import('../src/lib/auth.ts');
const { supabaseAdmin } = await import('../src/lib/db.ts');
const { POST: handleUpdateSchedule } = await import('../src/app/api/members/update-schedule/route.ts');

console.log('🧪 Starting Update Schedule Moderator Rate Limiting & IDOR Prevention Tests (GH #34, ZC-20)...\n');

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
          eq: (col, keyVal) => {
            rateLimitsDb.delete(keyVal);
            return Promise.resolve({ data: null, error: null });
          },
          in: (col, keys) => {
            for (const k of keys) {
              rateLimitsDb.delete(k);
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    }

    if (table === 'members') {
      return {
        select: (fields = '*') => ({
          limit: (n) => Promise.resolve({ data: currentMemberRow ? [{ ...currentMemberRow }] : [], error: null }),
          eq: (col, val) => ({
            single: () => {
              if (currentMemberRow && currentMemberRow[col] === val) {
                return Promise.resolve({ data: { ...currentMemberRow }, error: null });
              }
              return Promise.resolve({ data: null, error: { message: 'Member not found', code: 'PGRST116' } });
            },
            maybeSingle: () => {
              if (currentMemberRow && currentMemberRow[col] === val) {
                return Promise.resolve({ data: { ...currentMemberRow }, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
        update: (updates) => {
          const filters = [];
          const updateBuilder = {
            eq: (col, val) => {
              filters.push({ type: 'eq', col, val });
              return updateBuilder;
            },
            is: (col, val) => {
              filters.push({ type: 'is', col, val });
              return updateBuilder;
            },
            select: () => ({
              single: () => {
                const matches = filters.every((f) => {
                  if (f.type === 'eq') return currentMemberRow && currentMemberRow[f.col] === f.val;
                  if (f.type === 'is') {
                    return currentMemberRow && (f.val === null ? currentMemberRow[f.col] === null : currentMemberRow[f.col] === f.val);
                  }
                  return true;
                });
                if (matches) {
                  currentMemberRow = { ...currentMemberRow, ...updates };
                  return Promise.resolve({ data: { ...currentMemberRow }, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Condition not met' } });
              },
              maybeSingle: () => {
                const matches = filters.every((f) => {
                  if (f.type === 'eq') return currentMemberRow && currentMemberRow[f.col] === f.val;
                  if (f.type === 'is') {
                    return currentMemberRow && (f.val === null ? currentMemberRow[f.col] === null : currentMemberRow[f.col] === f.val);
                  }
                  return true;
                });
                if (matches) {
                  currentMemberRow = { ...currentMemberRow, ...updates };
                  return Promise.resolve({ data: { ...currentMemberRow }, error: null });
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
          return updateBuilder;
        },
      };
    }

    return origFrom.call(supabaseAdmin, table);
  };

  try {
    // -------------------------------------------------------------
    // Test Case 1: Unlinked unclaimed profile cannot be claimed when mod_passcode rate limit is exceeded
    // -------------------------------------------------------------
    console.log('--- 1. IDOR Prevention: Mod Rate Limit Exhaustion Aborts Immediately ---');
    clearInMemoryPinRateLimits();
    await clearAllPinRateLimitsPersistent();
    rateLimitsDb.clear();

    const unclaimedMember = {
      id: 'member-unclaimed-1',
      discord_username: 'UnclaimedFox',
      discord_handle: 'unclaimed_fox',
      discord_id: null,
      journal_url: 'https://discord.com/channels/123/456',
      bedtime_local: '22:00',
      wake_time_local: '06:00',
      timezone: 'America/New_York',
      role: 'member',
      passcode_hash: null, // Unclaimed profile
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    currentMemberRow = { ...unclaimedMember };

    const testClientIp = '198.51.100.42';

    // Simulate 5 failed moderator passcode attempts to exhaust the rate limit
    for (let i = 1; i <= 5; i++) {
      const req = new Request('http://localhost:3000/api/members/update-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testClientIp,
        },
        body: JSON.stringify({
          member_id: unclaimedMember.id,
          mod_passcode: 'wrong_mod_passcode_' + i,
          pin: '9999', // Attacker trying to set PIN and claim
          bedtime_local: '23:30',
        }),
      });

      const res = await handleUpdateSchedule(req);
      testAssert(
        res.status === 401,
        `Attempt ${i}: Invalid mod passcode returns HTTP 401 (not claimed)`
      );
      testAssert(
        currentMemberRow.passcode_hash === null,
        `Attempt ${i}: Profile passcode_hash remains null (unclaimed)`
      );
    }

    // 6th attempt: Rate limit is now exhausted. Must return HTTP 429 Too Many Requests
    // and MUST NOT fall through to profile claim
    const rateLimitedReq = new Request('http://localhost:3000/api/members/update-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': testClientIp,
      },
      body: JSON.stringify({
        member_id: unclaimedMember.id,
        mod_passcode: 'even_correct_or_wrong_mod_passcode',
        pin: '9999',
        bedtime_local: '01:00',
      }),
    });

    const rateLimitedRes = await handleUpdateSchedule(rateLimitedReq);
    testAssert(
      rateLimitedRes.status === 429,
      'Exhausted mod rate limit returns HTTP 429 Too Many Requests'
    );
    const retryAfter = rateLimitedRes.headers.get('Retry-After');
    testAssert(
      Boolean(retryAfter && Number(retryAfter) > 0),
      `HTTP 429 response includes valid Retry-After header: ${retryAfter}s`
    );
    const rateLimitedData = await rateLimitedRes.json();
    testAssert(
      rateLimitedData.error && rateLimitedData.error.includes('Too many failed moderator passcode attempts'),
      'HTTP 429 body explains moderator passcode rate limiting'
    );
    testAssert(
      currentMemberRow.passcode_hash === null,
      'Profile passcode_hash is STILL null - attacker was completely prevented from claiming profile'
    );
    testAssert(
      currentMemberRow.bedtime_local === '22:00',
      'Schedule was not mutated during rate-limited attack'
    );

    // -------------------------------------------------------------
    // Test Case 2: Invalid moderator passcode rejects immediately with 401
    // -------------------------------------------------------------
    console.log('\n--- 2. Invalid Moderator Passcode Rejection ---');
    clearInMemoryPinRateLimits();
    await clearAllPinRateLimitsPersistent();
    rateLimitsDb.clear();
    currentMemberRow = { ...unclaimedMember };

    const invalidModReq = new Request('http://localhost:3000/api/members/update-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.55',
      },
      body: JSON.stringify({
        member_id: unclaimedMember.id,
        mod_passcode: 'completely_wrong_passcode',
        pin: '4321',
        bedtime_local: '23:00',
      }),
    });

    const invalidModRes = await handleUpdateSchedule(invalidModReq);
    testAssert(invalidModRes.status === 401, 'Invalid mod passcode returns HTTP 401');
    const invalidModData = await invalidModRes.json();
    testAssert(invalidModData.error === 'Invalid moderator passcode.', 'Error message indicates invalid moderator passcode');
    testAssert(currentMemberRow.passcode_hash === null, 'Passcode hash remains unset');

    // -------------------------------------------------------------
    // Test Case 3: Legitimate profile claim without mod_passcode succeeds
    // -------------------------------------------------------------
    console.log('\n--- 3. Legitimate Profile Claim (No Mod Passcode) ---');
    clearInMemoryPinRateLimits();
    await clearAllPinRateLimitsPersistent();
    rateLimitsDb.clear();
    currentMemberRow = { ...unclaimedMember };

    // Missing/short PIN should fail with 400
    const shortPinReq = new Request('http://localhost:3000/api/members/update-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.60',
      },
      body: JSON.stringify({
        member_id: unclaimedMember.id,
        pin: '12', // Too short
        bedtime_local: '23:00',
      }),
    });
    const shortPinRes = await handleUpdateSchedule(shortPinReq);
    testAssert(shortPinRes.status === 400, 'Claiming with short PIN returns HTTP 400');

    // Valid 4-digit PIN claims the profile
    const validClaimReq = new Request('http://localhost:3000/api/members/update-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.60',
      },
      body: JSON.stringify({
        member_id: unclaimedMember.id,
        pin: '5555',
        bedtime_local: '23:00',
      }),
    });
    const validClaimRes = await handleUpdateSchedule(validClaimReq);
    testAssert(validClaimRes.status === 200, 'Legitimate claim with 4-digit PIN returns HTTP 200');
    testAssert(Boolean(currentMemberRow.passcode_hash), 'Profile passcode_hash is now successfully set');

    // -------------------------------------------------------------
    // Test Case 4: Valid moderator passcode bypasses cooldown and resets failure count
    // -------------------------------------------------------------
    console.log('\n--- 4. Valid Moderator Override & Cooldown Bypass ---');
    clearInMemoryPinRateLimits();
    await clearAllPinRateLimitsPersistent();
    rateLimitsDb.clear();

    const claimedMember = {
      ...unclaimedMember,
      passcode_hash: hashPin('5555'),
      bedtime_local: '22:00',
    };
    currentMemberRow = { ...claimedMember };

    const validModReq = new Request('http://localhost:3000/api/members/update-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.70',
      },
      body: JSON.stringify({
        member_id: claimedMember.id,
        mod_passcode: process.env.MOD_SECRET_PASSCODE,
        bedtime_local: '02:00',
        wake_time_local: '10:00',
      }),
    });

    const validModRes = await handleUpdateSchedule(validModReq);
    testAssert(validModRes.status === 200, 'Valid moderator override returns HTTP 200');
    const validModData = await validModRes.json();
    testAssert(validModData.cooldown_applied === false, 'Moderator override bypasses 48-hour cooldown');
    testAssert(validModData.pending_effective_at === null, 'pending_effective_at is null');
    testAssert(currentMemberRow.bedtime_local === '02:00', 'Active bedtime_local updated immediately to 02:00');

    // -------------------------------------------------------------
    // Test Case 5: Authenticated Session Owner Mod Passcode Rate Limiting
    // -------------------------------------------------------------
    console.log('\n--- 5. Authenticated Session Owner Mod Passcode Rate Limiting ---');
    clearInMemoryPinRateLimits();
    await clearAllPinRateLimitsPersistent();
    rateLimitsDb.clear();
    currentMemberRow = { ...claimedMember };

    const ownerToken = createSessionToken({ memberId: claimedMember.id, isModerator: false });

    for (let i = 1; i <= 5; i++) {
      const ownerModReq = new Request('http://localhost:3000/api/members/update-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ownerToken}`,
          'x-forwarded-for': '198.51.100.80',
        },
        body: JSON.stringify({
          member_id: claimedMember.id,
          mod_passcode: 'bad_owner_mod_passcode_' + i,
          bedtime_local: '01:00',
        }),
      });

      const res = await handleUpdateSchedule(ownerModReq);
      testAssert(res.status === 401, `Owner attempt ${i}: Invalid mod passcode returns HTTP 401`);
    }

    // 6th attempt by owner must return HTTP 429
    const ownerRateLimitedReq = new Request('http://localhost:3000/api/members/update-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerToken}`,
        'x-forwarded-for': '198.51.100.80',
      },
      body: JSON.stringify({
        member_id: claimedMember.id,
        mod_passcode: 'another_attempt',
        bedtime_local: '01:00',
      }),
    });

    const ownerRateLimitedRes = await handleUpdateSchedule(ownerRateLimitedReq);
    testAssert(
      ownerRateLimitedRes.status === 429,
      'Session owner exceeding mod passcode attempts receives HTTP 429'
    );

    // But owner updating without mod_passcode is permitted (subject to normal 48h cooldown)
    const ownerNormalReq = new Request('http://localhost:3000/api/members/update-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerToken}`,
        'x-forwarded-for': '198.51.100.80',
      },
      body: JSON.stringify({
        member_id: claimedMember.id,
        bedtime_local: '01:00',
        wake_time_local: '09:00',
      }),
    });

    const ownerNormalRes = await handleUpdateSchedule(ownerNormalReq);
    testAssert(ownerNormalRes.status === 200, 'Session owner without mod_passcode succeeds');
    const ownerNormalData = await ownerNormalRes.json();
    testAssert(ownerNormalData.cooldown_applied === true, 'Normal edit applies 48-hour cooldown');
    testAssert(Boolean(ownerNormalData.pending_effective_at), 'Pending effective timestamp is present');
  } finally {
    supabaseAdmin.from = origFrom;
  }

  if (failed) {
    console.error('\n❌ Some tests failed in Update Schedule Mod Rate Limiting suite!');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed in Update Schedule Mod Rate Limiting suite!');
  }
}

run().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
