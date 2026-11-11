import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials missing in environment.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

/**
 * Explicit allowlist of legacy test profile UUIDs designated for database purge.
 * Restricts deletion strictly to known development/test accounts ('Krish' and 'FoxOAuth_1794391141330').
 */
export const LEGACY_MEMBER_IDS_TO_PURGE = [
  '6124098d-6c85-487f-9ea5-1c73ea30b272', // Krish
  '03b9af0a-9891-488e-9818-4c7f62e9ad81', // FoxOAuth_1794391141330
];

/**
 * Safely locates and purges designated legacy test member profiles from Supabase.
 * Enforces an explicit allowlist check, unlinks associated push subscriptions and
 * notification logs, deletes allowlisted members, and verifies the resulting
 * member count is zero.
 *
 * @returns {Promise<void>} Resolves when purge and zero-count verification complete successfully.
 * @throws {Error} If discovery, unlinking, deletion, or verification fails.
 */
export async function purgeOldProfiles() {
  console.log('🧹 Purging allowlisted legacy profiles from database...');

  // Find allowlisted legacy members
  const { data: members, error: findErr } = await supabaseAdmin
    .from('members')
    .select('id, discord_username, discord_handle, created_at')
    .in('id', LEGACY_MEMBER_IDS_TO_PURGE);

  if (findErr) {
    throw new Error(`Error finding allowlisted legacy members: ${findErr.message}`);
  }

  // Ensure only allowlisted profiles can reach the deletion flow
  const allowlistedMembers = (members || []).filter((m) =>
    LEGACY_MEMBER_IDS_TO_PURGE.includes(m.id)
  );

  if (allowlistedMembers.length === 0) {
    console.log('ℹ️ No allowlisted legacy profiles found in database. The den is already clean!');
  } else {
    console.log(`Found ${allowlistedMembers.length} allowlisted profile(s) to remove:`);
    for (const m of allowlistedMembers) {
      console.log(
        `  - [${m.id}] ${m.discord_username} (${m.discord_handle || 'no handle'}) created at ${m.created_at}`
      );
    }

    const memberIds = allowlistedMembers.map((m) => m.id);

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
      throw new Error(`Error deleting allowlisted members: ${delErr.message}`);
    }

    console.log('  ✓ Deleted allowlisted member profiles');
  }

  // 4. Verify table is empty: fail if count cannot be verified or any members remain
  const { count, error: countErr } = await supabaseAdmin
    .from('members')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    throw new Error(`Failed to verify members count: ${countErr.message}`);
  }

  if (typeof count !== 'number' || count !== 0) {
    throw new Error(
      `Members table verification failed: expected 0 remaining members, but found ${count}`
    );
  }

  console.log('✅ Members table successfully verified: 0 remaining.');
  console.log('🎉 Successfully purged all old profiles from Supabase! The website is fresh and ready.');
}

/**
 * Entry point execution wrapper for running the profile purge script from CLI.
 *
 * @returns {Promise<void>} Resolves on process completion.
 */
async function run() {
  await purgeOldProfiles();
}

run().catch((err) => {
  console.error('Fatal error during purge:', err);
  process.exit(1);
});
