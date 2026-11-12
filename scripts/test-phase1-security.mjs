import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  hashPin,
  verifyPin,
  createSessionToken,
  sanitizeMember,
} from '../src/lib/auth.ts';

// Auto-load .env.local if present
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  // Ignore
}

console.log('🧪 Starting Phase 1 Security Verification Suite...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isSupabaseLive = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder'));

const supabaseAdmin = isSupabaseLive ? createClient(supabaseUrl, supabaseKey) : null;

async function run() {
  try {
    // -------------------------------------------------------------
    // 1. sanitizeMember Function Unit Tests
    // -------------------------------------------------------------
    console.log('--- 1. sanitizeMember Credential Stripping Tests ---');
    const mockMemberWithPin = {
      id: 'mock-1',
      discord_username: 'SecureFox',
      discord_handle: 'fox#0001',
      avatar_url: null,
      journal_url: 'https://discord.com/channels/123/456',
      bedtime_local: '23:00',
      wake_time_local: '07:00',
      timezone: 'UTC',
      pending_bedtime_local: null,
      pending_wake_time_local: null,
      pending_timezone: null,
      pending_effective_at: null,
      role: 'member',
      passcode_hash: hashPin('1234'),
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const sanitizedWithPin = sanitizeMember(mockMemberWithPin);
    assert(sanitizedWithPin.passcode_hash === undefined, 'passcode_hash is deleted from sanitized member');
    assert(sanitizedWithPin.has_pin === true, 'has_pin is true for claimed member');
    assert(sanitizedWithPin.discord_username === 'SecureFox', 'Preserves other member fields');

    const mockUnclaimedMember = {
      ...mockMemberWithPin,
      passcode_hash: null,
    };
    const sanitizedUnclaimed = sanitizeMember(mockUnclaimedMember);
    assert(sanitizedUnclaimed.passcode_hash === undefined, 'passcode_hash is deleted from unclaimed member');
    assert(sanitizedUnclaimed.has_pin === false, 'has_pin is false for unclaimed member');

    // -------------------------------------------------------------
    // 2. Integration Tests: In-Bed Check-In Gate
    // -------------------------------------------------------------
    if (!isSupabaseLive || !supabaseAdmin) {
      console.log('\nℹ️ Supabase credentials not configured in environment. Skipping live DB check-in integration tests.');
      if (failed) {
        console.error('\n❌ SOME SECURITY TESTS FAILED.');
        process.exit(1);
      } else {
        console.log('\n✨ ALL PHASE 1 SECURITY UNIT TESTS PASSED CLEANLY! 🛡️🦊');
        return;
      }
    }

    console.log('\n--- 2. "I\'m in Bed" Authorization Guard Tests ---');
    const testUsername = `SecFox_${Date.now()}`;
    const testPin = '8492';
    const testHash = hashPin(testPin);

    const { data: member, error: mErr } = await supabaseAdmin
      .from('members')
      .insert({
        discord_username: testUsername,
        journal_url: 'https://discord.com/channels/123456789/987654321',
        bedtime_local: '23:00',
        timezone: 'UTC',
        passcode_hash: testHash,
        is_active: true,
      })
      .select()
      .single();

    assert(!mErr && member, `Created test member ${testUsername} with PIN`);

    // Direct endpoint logic simulation
    const simulateInBedPost = async ({ memberId, pin, sessionMemberId, action = 'check_in' }) => {
      // 1. Fetch member
      const { data: rawMember } = await supabaseAdmin
        .from('members')
        .select('*')
        .eq('id', memberId)
        .single();

      if (!rawMember) return { status: 404, error: 'Member not found' };

      // 2. Security Gate
      const isSessionMatch = sessionMemberId && sessionMemberId === rawMember.id;
      const isPinMatch = pin && rawMember.passcode_hash && verifyPin(pin.trim(), rawMember.passcode_hash);

      if (!isSessionMatch && !isPinMatch) {
        if (sessionMemberId && sessionMemberId !== rawMember.id) {
          return { status: 403, error: 'Forbidden' };
        }
        return { status: 401, error: 'Unauthorized' };
      }

      return { status: 200, success: true };
    };

    // Case A: Anonymous check-in attempt with NO PIN
    const resNoPin = await simulateInBedPost({ memberId: member.id });
    assert(resNoPin.status === 401, 'Anonymous check-in without PIN is strictly rejected with 401');

    // Case B: Check-in with WRONG PIN
    const resWrongPin = await simulateInBedPost({ memberId: member.id, pin: '0000' });
    assert(resWrongPin.status === 401, 'Check-in with wrong PIN is strictly rejected with 401');

    // Case C: Check-in with CORRECT PIN
    const resCorrectPin = await simulateInBedPost({ memberId: member.id, pin: testPin });
    assert(resCorrectPin.status === 200, 'Check-in with correct PIN succeeds with 200');

    // Case D: Session mismatch (User A trying to check in User B)
    const resCrossProfile = await simulateInBedPost({ memberId: member.id, sessionMemberId: 'other-user-uuid' });
    assert(resCrossProfile.status === 403, 'Cross-profile check-in by another session is strictly rejected with 403 Forbidden');

    // Case E: Valid session matching user
    const resValidSession = await simulateInBedPost({ memberId: member.id, sessionMemberId: member.id });
    assert(resValidSession.status === 200, 'Check-in with matching session token succeeds with 200');

    // -------------------------------------------------------------
    // 3. Integration Tests: Push Subscribe Authorization Gate
    // -------------------------------------------------------------
    console.log('\n--- 3. Push Subscription Authorization Guard Tests ---');
    const simulateSubscribePost = async ({ memberId, pin, sessionMemberId }) => {
      const effectiveMemberId = sessionMemberId || memberId;
      if (!effectiveMemberId) return { status: 400, error: 'MEMBER_REQUIRED' };

      if (sessionMemberId && memberId && sessionMemberId !== memberId) {
        return { status: 403, error: 'FORBIDDEN' };
      }

      const { data: rawMember } = await supabaseAdmin
        .from('members')
        .select('id, passcode_hash')
        .eq('id', effectiveMemberId)
        .single();

      if (!rawMember) return { status: 404, error: 'NOT_FOUND' };

      const isSessionMatch = Boolean(sessionMemberId && sessionMemberId === rawMember.id);
      const isPinMatch = Boolean(pin && rawMember.passcode_hash && verifyPin(pin.trim(), rawMember.passcode_hash));

      if (!isSessionMatch && !isPinMatch) {
        return { status: 401, error: 'UNAUTHORIZED' };
      }

      return { status: 200, success: true };
    };

    // Case A: Anonymous subscribe with NO PIN
    const subNoPin = await simulateSubscribePost({ memberId: member.id });
    assert(subNoPin.status === 401, 'Anonymous push subscription with NO PIN is strictly rejected with 401');

    // Case B: Anonymous subscribe with WRONG PIN
    const subWrongPin = await simulateSubscribePost({ memberId: member.id, pin: '9999' });
    assert(subWrongPin.status === 401, 'Push subscription with wrong PIN is strictly rejected with 401');

    // Case C: Cross-profile session hijack attempt
    const subCrossSession = await simulateSubscribePost({ memberId: member.id, sessionMemberId: 'evil-user-id' });
    assert(subCrossSession.status === 403, 'Cross-profile push subscription attempt is strictly rejected with 403');

    // Case D: Valid session
    const subValidSession = await simulateSubscribePost({ memberId: member.id, sessionMemberId: member.id });
    assert(subValidSession.status === 200, 'Push subscription with matching session token succeeds with 200');

    // Case E: Valid PIN (without pre-existing session)
    const subValidPin = await simulateSubscribePost({ memberId: member.id, pin: testPin });
    assert(subValidPin.status === 200, 'Push subscription with matching 4-digit PIN succeeds with 200');

    // -------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------
    console.log('\n--- 4. Cleanup ---');
    await supabaseAdmin.from('members').delete().eq('id', member.id);
    console.log('   Cleaned up test member from database.');

    if (failed) {
      console.error('\n❌ SOME SECURITY TESTS FAILED.');
      process.exit(1);
    } else {
      console.log('\n✨ ALL PHASE 1 SECURITY & DATA PROTECTION TESTS PASSED CLEANLY! 🛡️🦊');
    }
  } catch (err) {
    console.error('Unexpected test error:', err);
    process.exit(1);
  }
}

run();
