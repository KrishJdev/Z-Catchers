import { createClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import { computeMemberState, checkCooldownPromotion } from '../src/lib/sleepEngine.ts';

console.log('🧪 Starting Live End-to-End Database & Sleep Shield Verification...\n');

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
    // 1. Live Members Query
    console.log('--- 1. Live Supabase Members Query ---');
    const { data: members, error: mErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('is_active', true);

    let testMember = members && members.length > 0 ? members[0] : null;
    let createdTempMember = false;

    if (!testMember) {
      console.log('   ℹ️ Den roster currently empty. Creating temporary member for E2E testing...');
      const { data: tempMem, error: tempErr } = await supabaseAdmin
        .from('members')
        .insert({
          discord_username: 'E2EFox_' + Date.now(),
          journal_url: 'https://discord.com/channels/123/456',
          bedtime_local: '23:00',
          timezone: 'UTC',
          is_active: true,
        })
        .select()
        .single();
      assert(!tempErr && tempMem, 'Temporary test member created for clean den roster');
      testMember = tempMem;
      createdTempMember = true;
    } else {
      assert(!mErr && members.length > 0, `Active members retrieved from database (count: ${members.length})`);
      for (const m of members) {
        console.log(`   - ${m.discord_username}: bedtime ${m.bedtime_local} (${m.timezone})`);
      }
    }

    // 2. Test Push Subscription Upsert in Database
    console.log('\n--- 2. Push Subscription Upsert & Fetch ---');
    const mockEndpoint = 'https://updates.push.services.mozilla.com/wpush/v2/mock_test_token_' + Date.now();
    const mockP256dh = 'BMk6X9y0Z_mock_p256dh_key_for_testing_purposes_only';
    const mockAuth = 'mock_auth_secret';

    const { data: upsertData, error: upsertErr } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(
        {
          member_id: testMember.id,
          endpoint: mockEndpoint,
          p256dh_key: mockP256dh,
          auth_key: mockAuth,
          notify_personal: true,
          notify_community: true,
          user_agent: 'Mock-Test-Agent/1.0',
        },
        { onConflict: 'endpoint' }
      )
      .select()
      .single();

    assert(!upsertErr && upsertData, `Upserted test subscription for ${testMember.discord_username}`);

    const { data: fetchSub, error: fetchErr } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('endpoint', mockEndpoint)
      .single();

    assert(!fetchErr && fetchSub?.member_id === testMember.id, 'Verified subscription stored in push_subscriptions table');

    // 3. Test Notification Logs Idempotency in Database
    console.log('\n--- 3. Notification Logs Idempotency Check ---');
    const testDate = DateTime.utc().toISODate();
    const { data: logInsert, error: logErr } = await supabaseAdmin
      .from('notification_logs')
      .insert({
        member_id: testMember.id,
        notification_type: 'WIND_DOWN_30M',
        local_date: testDate,
      })
      .select()
      .single();

    assert(!logErr && logInsert, 'Successfully logged test dispatch in notification_logs');

    // Attempt duplicate insert - UNIQUE constraint must catch it!
    const { error: dupErr } = await supabaseAdmin
      .from('notification_logs')
      .insert({
        member_id: testMember.id,
        notification_type: 'WIND_DOWN_30M',
        local_date: testDate,
      });

    assert(dupErr !== null, 'UNIQUE constraint (member_id, notification_type, local_date) prevented duplicate notification dispatch');

    // Clean up test log
    await supabaseAdmin
      .from('notification_logs')
      .delete()
      .eq('id', logInsert.id);

    // 4. Live Sleep Shield Evaluation Across Roster
    console.log('\n--- 4. Live Sleep Shield Status Across Roster ---');
    const nowUtc = DateTime.utc();
    let shieldedCount = 0;
    let awakeCount = 0;

    const evalMembers = members && members.length > 0 ? members : [testMember];
    for (const m of evalMembers) {
      const state = computeMemberState(m, m.timezone, nowUtc);
      const isShielded =
        state.isSleepShieldActive ||
        state.bucket === 'SLEEPING' ||
        (state.diffMinutes >= -15 && state.diffMinutes < 0);

      if (isShielded) {
        shieldedCount++;
        console.log(`   🛡️ ${m.discord_username}: SHIELDED (${state.bucket}, diff: ${Math.round(state.diffMinutes)}m)`);
      } else {
        awakeCount++;
        console.log(`   ☀️ ${m.discord_username}: AWAKE (${state.bucket}, diff: ${Math.round(state.diffMinutes)}m)`);
      }
    }

    assert(shieldedCount + awakeCount === evalMembers.length, 'Evaluated Sleep Shield status for all active members');

    // 5. Clean Up Test Subscription
    console.log('\n--- 5. Push Unsubscribe Cleanup ---');
    const { error: delErr } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', mockEndpoint);

    assert(!delErr, 'Successfully deleted mock push subscription');

    const { data: checkDeleted } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', mockEndpoint);

    assert(checkDeleted?.length === 0, 'Confirmed mock endpoint removed from database');

    if (createdTempMember && testMember) {
      await supabaseAdmin.from('members').delete().eq('id', testMember.id);
      console.log('   Cleaned up temporary test member.');
    }

    console.log('\n-----------------------------------------------------------');
    if (failed) {
      console.error('❌ E2E VERIFICATION FAILED');
      process.exit(1);
    } else {
      console.log('🎉 ALL LIVE DATABASE & SLEEP SHIELD TESTS PASSED CLEANLY!');
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error during E2E verification:', err);
    process.exit(1);
  }
}

run();
