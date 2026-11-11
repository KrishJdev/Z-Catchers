import fs from 'fs';
import path from 'path';

// 1. Auto-load .env.local FIRST before dynamic imports
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // Ignore missing .env.local
}

// 2. Dynamically import modules now that process.env is populated
const {
  hashPin,
  verifyPin,
  createSessionToken,
  verifySessionToken,
  createClaimToken,
  verifyClaimToken,
  isModDiscordId,
  SESSION_MAX_AGE_SECONDS,
  getSessionSecret,
  getPinSalt,
} = await import('../src/lib/auth.ts');

const { updateMemberSafe, insertMemberSafe, supabaseAdmin } = await import('../src/lib/db.ts');

console.log('🧪 Starting Discord OAuth2 & Rolling Session Auth Verification...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function run() {
  let newMember = null;
  let testModMember = null;
  let testEndpoint = null;
  try {
    // 1. Session Token Payload & Rolling 90-Day Math
    console.log('--- 1. Session Token & 90-Day Rolling Payload Tests ---');
    const mockMemberId = 'mem_test_' + Date.now();
    const mockDiscordId = '123456789012345678';

    const token = createSessionToken(
      {
        memberId: mockMemberId,
        discordId: mockDiscordId,
        isModerator: true,
      },
      90
    );

    assert(token && token.includes('.'), 'createSessionToken creates valid payload.signature token');

    const decoded = verifySessionToken(token);
    assert(decoded && decoded.memberId === mockMemberId, 'verifySessionToken decodes memberId correctly');
    assert(decoded && decoded.discordId === mockDiscordId, 'verifySessionToken decodes discordId correctly');
    assert(decoded && decoded.isModerator === true, 'verifySessionToken decodes isModerator flag correctly');

    const expectedMinExp = Date.now() + 1000 * 60 * 60 * 24 * 89; // at least 89 days
    const expectedMaxExp = Date.now() + 1000 * 60 * 60 * 24 * 91; // at most 91 days
    assert(
      decoded && decoded.exp > expectedMinExp && decoded.exp < expectedMaxExp,
      'Session token expiration is 90 days from creation'
    );

    // Backward compatibility with legacy string argument
    const legacyToken = createSessionToken(mockMemberId);
    const legacyDecoded = verifySessionToken(legacyToken);
    assert(
      legacyDecoded && legacyDecoded.memberId === mockMemberId,
      'Backward-compatible string argument decodes memberId'
    );
    assert(legacyDecoded && legacyDecoded.isModerator === false, 'Legacy token defaults isModerator to false');

    // Tampered token test
    const tampered = token.slice(0, -4) + 'abcd';
    assert(verifySessionToken(tampered) === null, 'verifySessionToken strictly rejects tampered signatures');

    // Malformed token test
    assert(verifySessionToken('invalid.token.extra') === null, 'Rejects tokens with invalid part count');
    assert(verifySessionToken('') === null, 'Rejects empty token');

    // 1B. Production Environment Secret Fallback Tests
    console.log('\n--- 1B. Production Environment Secret Fallback Tests ---');
    const origNodeEnv = process.env.NODE_ENV;
    const origSessionSecret = process.env.SESSION_SECRET;
    const origPinSalt = process.env.PIN_SALT;

    try {
      // Simulate production without SESSION_SECRET or PIN_SALT set
      process.env.NODE_ENV = 'production';
      delete process.env.SESSION_SECRET;
      delete process.env.PIN_SALT;

      let caughtSecretErr = null;
      let prodSecret = null;
      try {
        prodSecret = getSessionSecret();
      } catch (err) {
        caughtSecretErr = err;
      }
      assert(caughtSecretErr === null, 'getSessionSecret() does not throw in production when SESSION_SECRET is unset');
      assert(typeof prodSecret === 'string' && prodSecret.length > 0, 'getSessionSecret() returns non-empty derived or fallback secret');

      let caughtSaltErr = null;
      let prodSalt = null;
      try {
        prodSalt = getPinSalt();
      } catch (err) {
        caughtSaltErr = err;
      }
      assert(caughtSaltErr === null, 'getPinSalt() does not throw in production when PIN_SALT is unset');
      assert(typeof prodSalt === 'string' && prodSalt.length > 0, 'getPinSalt() returns non-empty salt in production');

      // Create session and claim tokens under production mode without explicit SESSION_SECRET
      const prodSessionToken = createSessionToken({
        memberId: mockMemberId,
        discordId: mockDiscordId,
        isModerator: false,
      });
      assert(prodSessionToken && prodSessionToken.includes('.'), 'createSessionToken works in production without SESSION_SECRET');
      const prodSessionDecoded = verifySessionToken(prodSessionToken);
      assert(prodSessionDecoded && prodSessionDecoded.memberId === mockMemberId, 'verifySessionToken decodes token created without SESSION_SECRET');

      const prodClaimToken = createClaimToken({
        discordId: mockDiscordId,
        discordUsername: 'ProdFox',
        avatarUrl: null,
        isModerator: false,
      });
      assert(prodClaimToken && prodClaimToken.includes('.'), 'createClaimToken works in production without SESSION_SECRET');
      const prodClaimDecoded = verifyClaimToken(prodClaimToken);
      assert(prodClaimDecoded && prodClaimDecoded.discordUsername === 'ProdFox', 'verifyClaimToken decodes token created without SESSION_SECRET');

      // Secret rotation / transition test: verify that when SESSION_SECRET is later added,
      // tokens signed under fallback still verify cleanly
      process.env.SESSION_SECRET = 'new-explicit-rotated-secret-32-chars-long';
      const crossVerifiedSession = verifySessionToken(prodSessionToken);
      assert(crossVerifiedSession && crossVerifiedSession.memberId === mockMemberId, 'verifySessionToken validates fallback token even after explicit SESSION_SECRET is configured');

      const crossVerifiedClaim = verifyClaimToken(prodClaimToken);
      assert(crossVerifiedClaim && crossVerifiedClaim.discordUsername === 'ProdFox', 'verifyClaimToken validates fallback claim token even after explicit SESSION_SECRET is configured');
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      if (origSessionSecret !== undefined) process.env.SESSION_SECRET = origSessionSecret;
      else delete process.env.SESSION_SECRET;
      if (origPinSalt !== undefined) process.env.PIN_SALT = origPinSalt;
      else delete process.env.PIN_SALT;
    }

    // 2. Claim Token Tests
    console.log('\n--- 2. Claim Token Lifecycle Tests ---');
    const mockSuggestedId = 'sug_test_' + Date.now();
    const claimToken = createClaimToken(
      {
        discordId: mockDiscordId,
        discordUsername: 'SleepyFoxDev',
        avatarUrl: 'https://cdn.discordapp.com/avatars/123/abc.png',
        isModerator: false,
        suggestedMemberId: mockSuggestedId,
      },
      60
    );

    assert(claimToken && claimToken.includes('.'), 'createClaimToken creates valid claim token');
    const claimDecoded = verifyClaimToken(claimToken);
    assert(claimDecoded && claimDecoded.discordId === mockDiscordId, 'verifyClaimToken decodes discordId');
    assert(claimDecoded && claimDecoded.discordUsername === 'SleepyFoxDev', 'verifyClaimToken decodes username');
    assert(
      claimDecoded && claimDecoded.suggestedMemberId === mockSuggestedId,
      'verifyClaimToken decodes suggestedMemberId'
    );
    assert(verifyClaimToken(claimToken.slice(0, -4) + 'xyz') === null, 'Rejects tampered claim token');

    // 3. Moderator Role Enforcement via Discord Snowflake
    console.log('\n--- 3. Moderator Role Enforcement via MOD_DISCORD_IDS ---');
    process.env.MOD_DISCORD_IDS = '999888777,123456789012345678,555444333';
    assert(isModDiscordId('123456789012345678'), 'isModDiscordId returns true for ID listed in MOD_DISCORD_IDS');
    assert(isModDiscordId('999888777'), 'isModDiscordId returns true for first ID');
    assert(isModDiscordId('555444333'), 'isModDiscordId returns true for last ID');
    assert(!isModDiscordId('111222333'), 'isModDiscordId returns false for unlisted Discord ID');
    assert(!isModDiscordId(null), 'isModDiscordId safely returns false for null');
    assert(!isModDiscordId(''), 'isModDiscordId safely returns false for empty string');

    // 4. Database Integration & Discord Profile Claim Lifecycle
    console.log('\n--- 4. Database Integration & Discord Profile Claim Lifecycle ---');
    const testDiscordId = 'disc_' + Date.now();
    const testUsername = `FoxOAuth_${Date.now()}`;

    // Create unclaimed legacy profile using insertMemberSafe
    const { data: createdMember, error: createErr } = await insertMemberSafe({
      discord_username: testUsername,
      discord_handle: `${testUsername}#0001`,
      journal_url: 'https://discord.com/channels/123456789/987654321',
      bedtime_local: '23:30',
      wake_time_local: '07:30',
      timezone: 'Asia/Kolkata',
      role: 'member',
      passcode_hash: null, // Legacy unclaimed
      is_active: true,
    });
    newMember = createdMember;

    assert(!createErr && newMember, `Created unclaimed test member ${testUsername}`);

    // Claim profile with Discord ID using updateMemberSafe (auto schema adaptation)
    console.log('   Testing Discord profile claim binding...');
    const avatarUrl = `https://cdn.discordapp.com/avatars/${testDiscordId}/mock_avatar.png`;

    const { data: claimedMember, error: claimErr } = await updateMemberSafe(
      newMember.id,
      {
        discord_id: testDiscordId,
        avatar_url: avatarUrl,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      },
      { requireUnlinkedDiscord: true }
    );

    assert(!claimErr && claimedMember, 'updateMemberSafe successfully claimed profile without schema crashes');

    // Attempt concurrent/duplicate claim on already linked member with requireUnlinkedDiscord: true
    const { data: rivalClaimData, error: rivalClaimErr } = await updateMemberSafe(
      newMember.id,
      {
        discord_id: 'rival_discord_id_123',
        avatar_url: 'https://cdn.discordapp.com/avatars/rival/avatar.png',
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      },
      { requireUnlinkedDiscord: true }
    );

    assert(
      !rivalClaimErr && rivalClaimData === null,
      'requireUnlinkedDiscord returns null data without error on lost race/already linked profile (HTTP 409 trigger)'
    );

    // Generate authenticated 90-day session token
    const memberSessionToken = createSessionToken(
      {
        memberId: newMember.id,
        discordId: testDiscordId,
        isModerator: false,
      },
      90
    );

    const sessionVerification = verifySessionToken(memberSessionToken);
    assert(sessionVerification?.memberId === newMember.id, 'Session token authenticates as claimed member');
    assert(sessionVerification?.discordId === testDiscordId, 'Session token contains discord_id');

    // 4B. Regression Test: Revocation After Token Issuance
    console.log('\n--- 4B. Revocation After Token Issuance Regression Test ---');
    const { verifyModeratorAuthorization } = await import('../src/lib/auth.ts');

    const nonModDiscordId = 'revoked_mod_user_' + Date.now();
    const staleModClaimToken = createClaimToken(
      {
        discordId: nonModDiscordId,
        discordUsername: 'RevokedMod',
        avatarUrl: null,
        isModerator: true, // Stale token issued before user was removed from MOD_DISCORD_IDS
        suggestedMemberId: null,
      },
      60
    );

    const decodedClaim = verifyClaimToken(staleModClaimToken);
    assert(decodedClaim?.isModerator === true, 'Claim token carries cached isModerator: true');
    assert(isModDiscordId(decodedClaim.discordId) === false, 'Live allowlist correctly marks revoked ID as non-moderator');

    // Verify session with stale token claims rejected by verifyModeratorAuthorization when member is not mod
    const staleSessionToken = createSessionToken(
      {
        memberId: newMember.id,
        discordId: nonModDiscordId,
        isModerator: true, // Stale token claims isModerator: true
      },
      90
    );

    const testReq = new Request('http://localhost:3000/api/mod', {
      headers: {
        cookie: `zcatchers_session=${staleSessionToken}`,
      },
    });

    const modAuthResult = await verifyModeratorAuthorization(testReq);
    assert(
      modAuthResult.authorized === false,
      'verifyModeratorAuthorization ignores stale isModerator session claim and checks live DB/allowlist'
    );

    // 5. Rolling Renewal Simulation on /api/auth/me
    console.log('\n--- 5. Rolling Session Renewal Verification ---');
    // Simulate /api/auth/me renewal
    const renewedSessionToken = createSessionToken(
      {
        memberId: sessionVerification.memberId,
        discordId: sessionVerification.discordId,
        isModerator: sessionVerification.isModerator,
      },
      90
    );

    const renewedDecoded = verifySessionToken(renewedSessionToken);
    assert(
      renewedDecoded && renewedDecoded.exp > Date.now() + 1000 * 60 * 60 * 24 * 89,
      'Renewed session is valid for rolling 90 days'
    );
    assert(SESSION_MAX_AGE_SECONDS === 60 * 60 * 24 * 90, 'SESSION_MAX_AGE_SECONDS constant is exactly 90 days');

    // 6. Push Subscription Binding to Authenticated Member
    console.log('\n--- 6. Push Subscription Profile Binding Test ---');
    testEndpoint = `https://updates.push.mock/oauth-test-${Date.now()}`;
    const { data: subData, error: subErr } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert({
        member_id: newMember.id,
        endpoint: testEndpoint,
        p256dh_key: 'mock_p256_oauth_test_key',
        auth_key: 'mock_auth_key_oauth_123',
        notify_personal: true,
        notify_community: true,
      })
      .select()
      .single();

    assert(!subErr && subData, 'Push subscription successfully bound to Discord-authenticated member');
    assert(subData?.member_id === newMember.id, 'Subscription member_id matches claimed Discord member');

    // 7. Deprecated PIN Routes Verification
    console.log('\n--- 7. Deprecated PIN Authentication Endpoints ---');
    const { POST: loginPost } = await import('../src/app/api/auth/login/route.ts');
    const { POST: registerPost } = await import('../src/app/api/auth/register/route.ts');

    const loginRes = await loginPost();
    assert(loginRes.status === 410, 'POST /api/auth/login returns 410 Gone');
    const loginJson = await loginRes.json();
    assert(loginJson.deprecated === true, 'POST /api/auth/login includes deprecated: true');
    assert(loginJson.auth_url === '/api/auth/discord', 'POST /api/auth/login references /api/auth/discord');

    const regRes = await registerPost();
    assert(regRes.status === 410, 'POST /api/auth/register returns 410 Gone');
    const regJson = await regRes.json();
    assert(regJson.deprecated === true, 'POST /api/auth/register includes deprecated: true');

    if (failed) {
      console.error('\n❌ SOME TESTS FAILED.');
      process.exitCode = 1;
    } else {
      console.log('\n✨ ALL DISCORD OAUTH2 & AUTH PIPELINE TESTS PASSED SUCCESSFULLY! 🦊💤');
    }
  } catch (err) {
    console.error('Unexpected test error:', err);
    process.exitCode = 1;
  } finally {
    // 8. Cleanup
    if (testEndpoint || newMember?.id || testModMember?.id) {
      console.log('\n--- 8. Cleanup ---');
      if (testEndpoint) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', testEndpoint);
      }
      if (newMember?.id) {
        await supabaseAdmin.from('members').delete().eq('id', newMember.id);
      }
      if (testModMember?.id) {
        await supabaseAdmin.from('members').delete().eq('id', testModMember.id);
      }
      console.log('   Cleaned up test members and subscriptions.');
    }
  }
}

run();
