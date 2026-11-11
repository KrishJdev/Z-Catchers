import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials missing in environment.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('🧹 Purging old profiles from database...');
  
  // Find all members
  const { data: members, error: findErr } = await supabaseAdmin
    .from('members')
    .select('id, discord_username, discord_handle, created_at');

  if (findErr) {
    console.error('❌ Error finding members:', findErr.message);
    process.exit(1);
  }

  if (!members || members.length === 0) {
    console.log('ℹ️ No profiles found in database. The den is already clean!');
    return;
  }

  console.log(`Found ${members.length} profile(s) to remove:`);
  for (const m of members) {
    console.log(`  - [${m.id}] ${m.discord_username} (${m.discord_handle || 'no handle'}) created at ${m.created_at}`);
  }

  const memberIds = members.map((m) => m.id);

  // 1. Delete associated push subscriptions
  const { error: pushErr } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .in('member_id', memberIds);
  if (pushErr) {
    console.warn('⚠️ Warning deleting push_subscriptions:', pushErr.message);
  } else {
    console.log('  ✓ Cleaned up associated push subscriptions');
  }

  // 2. Delete associated notification logs
  const { error: notifErr } = await supabaseAdmin
    .from('notification_logs')
    .delete()
    .in('member_id', memberIds);
  if (notifErr) {
    console.warn('⚠️ Warning deleting notification_logs:', notifErr.message);
  } else {
    console.log('  ✓ Cleaned up associated notification logs');
  }

  // 3. Delete members
  const { error: delErr } = await supabaseAdmin
    .from('members')
    .delete()
    .in('id', memberIds);

  if (delErr) {
    console.error('❌ Error deleting members:', delErr.message);
    process.exit(1);
  }

  // 4. Verify table is empty
  const { count, error: countErr } = await supabaseAdmin
    .from('members')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.warn('⚠️ Warning verifying members count:', countErr.message);
  } else {
    console.log(`✅ Members table successfully verified: ${count} remaining.`);
  }

  console.log('🎉 Successfully purged all old profiles from Supabase! The website is fresh and ready.');
}

run().catch((err) => {
  console.error('Fatal error during purge:', err);
  process.exit(1);
});
