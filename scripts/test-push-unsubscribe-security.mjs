import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Configure test environment variables prior to module imports
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-test-db.supabase.co';
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key-test-security';
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'z_catchers_test_session_secret_2026_push_security';
}

const { supabaseAdmin } = await import('../src/lib/db.ts');
const { createSessionToken } = await import('../src/lib/auth.ts');
const { POST: handleUnsubscribePost, DELETE: handleUnsubscribeDelete } = await import('../src/app/api/push/unsubscribe/route.ts');

console.log('🧪 Starting Push Unsubscribe Security & Authorization Verification Suite...\n');

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
  let queries = [];

  function installQueryStub(mockError = null, results = []) {
    queries = [];
    supabaseAdmin.from = (table) => {
      if (table === 'members') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: { id: 'owner' }, error: null }; },
        };
      }
      const q = {
        table,
        op: null,
        filters: [],
        delete() {
          this.op = 'delete';
          return this;
        },
        eq(col, val) {
          this.filters.push({ col, val });
          return this;
        },
        is(col, val) {
          this.filters.push({ col, val });
          return this;
        },
        select() { return this; },
        then(resolve) {
          return Promise.resolve({ data: results.shift() ?? null, error: mockError }).then(resolve);
        },
      };
      queries.push(q);
      return q;
    };
  }

  function restoreQueryStub() {
    supabaseAdmin.from = origFrom;
    queries = [];
  }

  try {
    const memberAliceId = 'mem_alice_secure_001';
    const memberMalloryId = 'mem_mallory_attacker_002';
    const aliceToken = createSessionToken({ memberId: memberAliceId, discordId: '100000000000000111' });
    const malloryToken = createSessionToken({ memberId: memberMalloryId, discordId: '100000000000000222' });
    const aliceEndpoint = 'https://fcm.googleapis.com/fcm/send/alice-device-token-123';

    // -------------------------------------------------------------
    // 1. Unauthenticated Request Rejection (GH #31 / #46)
    // -------------------------------------------------------------
    console.log('--- 1. Unauthenticated Push Endpoint Deletion Prevention ---');
    installQueryStub();

    // 1.1 Anonymous request with target endpoint -> HTTP 401
    const unauthReqWithEndpoint = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: aliceEndpoint }),
    });
    const unauthRes1 = await handleUnsubscribePost(unauthReqWithEndpoint);
    const unauthJson1 = await unauthRes1.json();

    testAssert(unauthRes1.status === 401, 'Anonymous request with endpoint returns HTTP 401 Unauthorized');
    testAssert(
      unauthJson1.error && unauthJson1.error.includes('Sign in with Discord'),
      'Returns informative unauthorized message for anonymous endpoint deletion'
    );
    testAssert(queries.length === 0, 'No database delete query executed for unauthenticated request');

    // 1.2 Anonymous request with empty body -> HTTP 401
    const unauthReqEmpty = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const unauthRes2 = await handleUnsubscribePost(unauthReqEmpty);
    testAssert(unauthRes2.status === 401, 'Anonymous request with empty body returns HTTP 401 Unauthorized');
    testAssert(queries.length === 0, 'No database delete query executed for anonymous empty request');

    // 1.3 Forged/invalid authorization header -> HTTP 401
    const invalidAuthReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.tampered.token.payload',
      },
      body: JSON.stringify({ endpoint: aliceEndpoint }),
    });
    const invalidAuthRes = await handleUnsubscribePost(invalidAuthReq);
    testAssert(invalidAuthRes.status === 401, 'Request with invalid Bearer token returns HTTP 401 Unauthorized');
    testAssert(queries.length === 0, 'No database delete query executed for invalid token');

    // -------------------------------------------------------------
    // 2. Authenticated Endpoint Unsubscription Scoping
    // -------------------------------------------------------------
    console.log('\n--- 2. Authenticated Endpoint Unsubscription Scoping ---');
    installQueryStub();

    // 2.1 Legitimate owner (Alice) unsubscribes specific endpoint via Bearer header
    const aliceAuthReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ endpoint: aliceEndpoint }),
    });
    const aliceRes = await handleUnsubscribePost(aliceAuthReq);
    const aliceJson = await aliceRes.json();

    testAssert(aliceRes.status === 200, 'Authenticated owner request returns HTTP 200 OK');
    testAssert(aliceJson.success === true, 'Response JSON confirms success: true');
    testAssert(queries.length === 1, 'Exactly one database query triggered');
    testAssert(queries[0].table === 'push_subscriptions', 'Query targets push_subscriptions table');
    testAssert(queries[0].op === 'delete', 'Query performs delete operation');

    const hasEndpointFilter = queries[0].filters.some(
      (f) => f.col === 'endpoint' && f.val === aliceEndpoint
    );
    const hasAliceMemberFilter = queries[0].filters.some(
      (f) => f.col === 'member_id' && f.val === memberAliceId
    );
    testAssert(hasEndpointFilter, 'Query enforces .eq("endpoint", endpoint)');
    testAssert(hasAliceMemberFilter, 'Query strictly enforces .eq("member_id", sessionMemberId)');

    // 2.2 Legitimate owner unsubscribes via Cookie header
    installQueryStub();
    const cookieReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `zcatchers_session=${aliceToken}; other_cookie=123`,
      },
      body: JSON.stringify({ endpoint: aliceEndpoint }),
    });
    const cookieRes = await handleUnsubscribePost(cookieReq);
    testAssert(cookieRes.status === 200, 'Authenticated session via Cookie returns HTTP 200 OK');
    testAssert(queries.length === 1 && queries[0].filters.some((f) => f.col === 'member_id' && f.val === memberAliceId),
      'Cookie-authenticated request enforces member_id filter');

    // -------------------------------------------------------------
    // 3. Cross-Member Deletion Prevention (IDOR / DoS Protection)
    // -------------------------------------------------------------
    console.log('\n--- 3. Cross-Member IDOR & DoS Prevention ---');
    installQueryStub();

    // Mallory tries to unsubscribe Alice's endpoint using Mallory's valid session
    const malloryAttackReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${malloryToken}`,
      },
      body: JSON.stringify({ endpoint: aliceEndpoint }),
    });
    const malloryRes = await handleUnsubscribePost(malloryAttackReq);
    const malloryJson = await malloryRes.json();

    testAssert(malloryRes.status === 200, 'Endpoint returns HTTP 200 (safe PostgREST behavior)');
    testAssert(queries.length === 1, 'Query executed');
    const malloryMemberFilter = queries[0].filters.some(
      (f) => f.col === 'member_id' && f.val === memberMalloryId
    );
    const aliceInFilters = queries[0].filters.some(
      (f) => f.col === 'member_id' && f.val === memberAliceId
    );
    testAssert(malloryMemberFilter, 'Query scopes deletion strictly to Mallory (sessionMemberId)');
    testAssert(!aliceInFilters, 'Alice member ID is NOT in query filters');

    // -------------------------------------------------------------
    // 4. Invalid Endpoint Format Validation
    // -------------------------------------------------------------
    console.log('\n--- 4. Input Validation for Endpoint Parameter ---');
    installQueryStub();

    // Whitespace-only endpoint -> HTTP 400
    const whitespaceReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ endpoint: '   ' }),
    });
    const whitespaceRes = await handleUnsubscribePost(whitespaceReq);
    testAssert(whitespaceRes.status === 400, 'Whitespace endpoint rejected with HTTP 400');
    testAssert(queries.length === 0, 'No query executed for whitespace endpoint');

    // Non-string endpoint -> HTTP 400
    const nonStringReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ endpoint: 12345 }),
    });
    const nonStringRes = await handleUnsubscribePost(nonStringReq);
    testAssert(nonStringRes.status === 400, 'Numeric endpoint rejected with HTTP 400');
    testAssert(queries.length === 0, 'No query executed for numeric endpoint');

    // Malformed JSON payload -> HTTP 400 (Must NOT fall through to member-wide delete)
    const malformedJsonReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: '{"endpoint": "incomplete_json_payload...',
    });
    const malformedJsonRes = await handleUnsubscribePost(malformedJsonReq);
    testAssert(malformedJsonRes.status === 400, 'Malformed JSON rejected with HTTP 400 before database execution');
    testAssert(queries.length === 0, 'No query executed for malformed JSON request');

    // Non-object JSON payload (array) -> HTTP 400
    const arrayJsonReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify(['malicious', 'array']),
    });
    const arrayJsonRes = await handleUnsubscribePost(arrayJsonReq);
    testAssert(arrayJsonRes.status === 400, 'Array JSON body rejected with HTTP 400');
    testAssert(queries.length === 0, 'No query executed for array JSON body');

    // -------------------------------------------------------------
    // 5. Member-Wide Push Subscription Removal
    // -------------------------------------------------------------
    console.log('\n--- 5. Member-Wide Push Subscription Removal ---');
    installQueryStub();

    // Authenticated member omits endpoint -> removes all subscriptions for that member
    const memberWideReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({}),
    });
    const memberWideRes = await handleUnsubscribePost(memberWideReq);
    const memberWideJson = await memberWideRes.json();

    testAssert(memberWideRes.status === 200, 'Member-wide unsubscription returns HTTP 200 OK');
    testAssert(memberWideJson.success === true, 'Member-wide confirms success: true');
    testAssert(queries.length === 1, 'One query executed for member-wide unsubscription');
    testAssert(queries[0].filters.length === 1 && queries[0].filters[0].col === 'member_id' && queries[0].filters[0].val === memberAliceId,
      'Query deletes all subscriptions strictly matching member_id = Alice');

    // -------------------------------------------------------------
    // 6. DELETE HTTP Method Support
    // -------------------------------------------------------------
    console.log('\n--- 6. HTTP DELETE Method Support ---');
    installQueryStub();

    // 6.1 DELETE with JSON body
    const deleteReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ endpoint: aliceEndpoint }),
    });
    const deleteRes = await handleUnsubscribeDelete(deleteReq);
    testAssert(deleteRes.status === 200, 'DELETE /api/push/unsubscribe with body returns HTTP 200 OK');
    testAssert(queries.length === 1 && queries[0].op === 'delete', 'DELETE method executes database delete');

    // 6.2 DELETE with URL query parameter (?endpoint=...) and no body
    installQueryStub();
    const queryDeleteReq = new Request(`http://localhost:3000/api/push/unsubscribe?endpoint=${encodeURIComponent(aliceEndpoint)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
      },
    });
    const queryDeleteRes = await handleUnsubscribeDelete(queryDeleteReq);
    testAssert(queryDeleteRes.status === 200, 'DELETE with URL query parameter ?endpoint=... returns HTTP 200 OK');
    testAssert(queries.length === 1 && queries[0].op === 'delete', 'Query param DELETE executes database delete');
    const hasQueryEndpointFilter = queries[0]?.filters.some(
      (f) => f.col === 'endpoint' && f.val === aliceEndpoint
    );
    const hasQueryMemberFilter = queries[0]?.filters.some(
      (f) => f.col === 'member_id' && f.val === memberAliceId
    );
    testAssert(hasQueryEndpointFilter, 'Query param DELETE enforces .eq("endpoint", endpoint)');
    testAssert(hasQueryMemberFilter, 'Query param DELETE strictly enforces .eq("member_id", sessionMemberId) without accidental member-wide deletion');

    // -------------------------------------------------------------
    // 7. Client-Side Authorization Injection Verification (GH #36)
    // -------------------------------------------------------------
    console.log('\n--- 7. Client-Side Authorization Injection Checks ---');

    const pushModalContent = fs.readFileSync(path.resolve('src/components/PushModal.tsx'), 'utf8');
    testAssert(
      pushModalContent.includes('getStoredAuthToken') &&
      pushModalContent.includes("headers['Authorization'] = `Bearer ${token}`;") &&
      pushModalContent.includes("fetch('/api/push/test'"),
      'PushModal.tsx injects Authorization Bearer header into /api/push/test'
    );

    // A retry for a revoked credential may only fall back to unprovisioned rows.
    installQueryStub(null, [[], []]);
    const retriedUnlink = await handleUnsubscribePost(new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ endpoint: aliceEndpoint, rotation_credential: 'ab'.repeat(32) }),
    }));
    assert.equal(retriedUnlink.status, 200);
    assert.equal(queries.length, 2);
    assert.ok(queries[1].filters.some(filter => filter.col === 'rotation_digest' && filter.val === null));

    // -------------------------------------------------------------
    // 8. Database Error Handling
    // -------------------------------------------------------------
    console.log('\n--- 8. Database Error Resilience ---');
    installQueryStub({ message: 'Simulated connection failure' });

    const dbErrReq = new Request('http://localhost:3000/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ endpoint: aliceEndpoint }),
    });
    const dbErrRes = await handleUnsubscribePost(dbErrReq);
    const dbErrJson = await dbErrRes.json();

    testAssert(dbErrRes.status === 503, 'Database failure returns HTTP 503');
    testAssert(dbErrJson.error === 'Could not unlink notifications. Try again.', 'Returns a safe failure message');

  } finally {
    restoreQueryStub();
  }

  if (failed) {
    console.error('\n❌ SOME PUSH UNSUBSCRIBE SECURITY CHECKS FAILED.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL PUSH UNSUBSCRIBE SECURITY VERIFICATIONS PASSED CLEANLY! 🦊🔐💤');
    process.exit(0);
  }
}

run();
