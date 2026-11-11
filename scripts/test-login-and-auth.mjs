import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { hashPin, verifyPin, createSessionToken, verifySessionToken } from '../src/lib/auth.ts';

// Auto-load .env.local if present
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

console.log('🧪 Starting Member PIN Login & Session Auth Verification...\n');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials missing in environment.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

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
  try {
    // 1. Pure Crypto Unit Tests
    console.log('--- 1. PIN Hashing & Verification Logic ---');
    const pin = '4821';
    const hash = hashPin(pin);
    assert(hash && hash.length === 64, 'hashPin produces 64-char SHA256 hex string');
    assert(verifyPin('4821', hash), 'verifyPin returns true for correct PIN');
    assert(!verifyPin('0000', hash), 'verifyPin returns false for incorrect PIN');
    assert(!verifyPin('', hash), 'verifyPin returns false for empty PIN');
    assert(!verifyPin('4821', null), 'verifyPin returns false for null stored hash');

    console.log('\n--- 2. HMAC-SHA256 Session Token Tests ---');
    const mockMemberId = 'mem_test_' + Date.now();
    const token = createSessionToken(mockMemberId);
    assert(token && token.includes('.'), 'createSessionToken creates valid payload.signature token');

    const decoded = verifySessionToken(token);
    assert(decoded && decoded.memberId === mockMemberId, 'verifySessionToken decodes correct memberId');

    // Tampered token test
    const tampered = token.slice(0, -4) + 'abcd';
    const tamperedResult = verifySessionToken(tampered);
    assert(tamperedResult === null, 'verifySessionToken strictly rejects tampered signatures');

    // Malformed token test
    assert(verifySessionToken('invalid.token.extra') === null, 'Rejects tokens with invalid part count');
    assert(verifySessionToken('') === null, 'Rejects empty token');

    // 2. Database Integration Test with Clean Lifecycle
    console.log('\n--- 3. Database Auth & Claim Lifecycle Test ---');
    const testUsername = `TestFox_${Date.now()}`;
    const { data: newMember, error: createErr } = await supabaseAdmin
      .from('members')
      .insert({
        discord_username: testUsername,
        discord_handle: `${testUsername}#0001`,
        journal_url: 'https://discord.com/channels/123456789/987654321',
        bedtime_local: '23:30',
        wake_time_local: '07:30',
        timezone: 'Asia/Kolkata',
        role: 'member',
        passcode_hash: null, // Unclaimed
        is_active: true,
      })
      .select()
      .single();

    assert(!createErr && newMember, `Created unclaimed test member ${testUsername}`);

    // Simulate first-time login claiming profile
    console.log('   Testing first-time PIN claim...');
    const chosenPin = '7392';
    const claimedHash = hashPin(chosenPin);
    const { error: claimErr } = await supabaseAdmin
      .from('members')
      .update({ passcode_hash: claimedHash })
      .eq('id', newMember.id);

    assert(!claimErr, 'Successfully claimed profile with 4-digit PIN');

    // Simulate subsequent login verification
    const { data: fetchedMember } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', newMember.id)
      .single();

    assert(verifyPin('7392', fetchedMember.passcode_hash), 'Login succeeds with claimed PIN 7392');
    assert(!verifyPin('1111', fetchedMember.passcode_hash), 'Login fails with wrong PIN 1111');

    // Generate session token for authenticated user
    const memberSessionToken = createSessionToken(newMember.id);
    const sessionVerification = verifySessionToken(memberSessionToken);
    assert(
      sessionVerification?.memberId === newMember.id,
      'Session token authenticates as test member'
    );

    // 4. Push Subscription Binding & Sleep Shield Guardrail Check
    console.log('\n--- 4. Push Subscription Profile Binding Test ---');
    const testEndpoint = `https://updates.push.mock/auth-test-${Date.now()}`;
    const { data: subData, error: subErr } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert({
        member_id: newMember.id,
        endpoint: testEndpoint,
        p256dh_key: 'mock_p256_auth_test_key',
        auth_key: 'mock_auth_key_123',
        notify_personal: true,
        notify_community: true,
      })
      .select()
      .single();

    assert(!subErr && subData, 'Push subscription successfully bound to authenticated member');
    assert(subData?.member_id === newMember.id, 'Subscription member_id strictly matches authenticated user');

    // Clean up test records
    console.log('\n--- 5. Cleanup ---');
    await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', testEndpoint);
    await supabaseAdmin.from('members').delete().eq('id', newMember.id);
    console.log('   Cleaned up test member and subscriptions.');

    if (failed) {
      console.error('\n❌ SOME TESTS FAILED.');
      process.exit(1);
    } else {
      console.log('\n✨ ALL AUTH & LOGIN TESTS PASSED SUCCESSFULLY! 🦊💤');
    }
  } catch (err) {
    console.error('Unexpected test error:', err);
    process.exit(1);
  }
}

run();
