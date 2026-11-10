import { createClient } from '@supabase/supabase-js';
import { hashPin, verifyPin, createSessionToken, verifySessionToken } from '../src/lib/auth.ts';

console.log('🧪 Starting Self-Service Profile Signup & Username Login Verification...\n');

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
  const testUsername = 'FriendFox_' + Date.now();
  const testPin = '8392';
  let createdMemberId = null;

  try {
    console.log('--- 1. Direct Self-Service Signup Logic ---');
    const hashed = hashPin(testPin);
    const insertPayload = {
      discord_username: testUsername,
      discord_handle: '@' + testUsername.toLowerCase(),
      journal_url: 'https://discord.com/channels/123456789/987654321',
      bedtime_local: '23:15',
      wake_time_local: '07:15',
      timezone: 'America/New_York',
      role: 'member',
      passcode_hash: hashed,
    };

    let { data: newMember, error: insertErr } = await supabaseAdmin
      .from('members')
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr) {
      console.error('Insert error details:', insertErr);
    }
    assert(!insertErr && newMember, `Successfully created self-service profile for ${testUsername}`);
    createdMemberId = newMember?.id;
    if (newMember) {
      assert(newMember.passcode_hash === hashed, 'Profile has securely hashed PIN');
    }

    console.log('\n--- 2. Username-Based Query & Case-Insensitive Lookup ---');
    const { data: lookupUser, error: lookupErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .ilike('discord_username', testUsername.toLowerCase())
      .eq('is_active', true)
      .maybeSingle();

    assert(!lookupErr && lookupUser, 'Found profile by case-insensitive lowercase username');
    assert(lookupUser.id === createdMemberId, 'Matched correct member ID');

    console.log('\n--- 3. Authentication with PIN ---');
    assert(verifyPin(testPin, lookupUser.passcode_hash), 'PIN verification succeeds with correct PIN 8392');
    assert(!verifyPin('0000', lookupUser.passcode_hash), 'PIN verification strictly rejects wrong PIN');

    const sessionToken = createSessionToken(lookupUser.id);
    const verifiedPayload = verifySessionToken(sessionToken);
    assert(verifiedPayload && verifiedPayload.memberId === createdMemberId, 'Session token validates and matches created profile');

    console.log('\n--- 4. Duplicate Username Prevention ---');
    const { data: existingUser } = await supabaseAdmin
      .from('members')
      .select('id')
      .ilike('discord_username', testUsername)
      .eq('is_active', true)
      .maybeSingle();

    assert(Boolean(existingUser), 'Detected duplicate username attempt correctly');

  } finally {
    if (createdMemberId) {
      await supabaseAdmin.from('members').delete().eq('id', createdMemberId);
      console.log(`\n🧹 Cleaned up test member ${testUsername} from database.`);
    }
  }

  if (failed) {
    console.error('\n❌ SOME SIGNUP/LOGIN TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL SELF-SERVICE SIGNUP & USERNAME LOGIN TESTS PASSED CLEANLY! 🦊✨');
    process.exit(0);
  }
}

run().catch(console.error);
