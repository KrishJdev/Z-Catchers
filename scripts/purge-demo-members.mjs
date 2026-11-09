import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials missing in environment.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('🧹 Purging pre-seeded demo profiles (Aoi, SarahK, Marcus, Arjun)...');
  const seedNames = ['Aoi', 'SarahK', 'Marcus', 'Arjun'];

  const { data: found, error: findErr } = await supabaseAdmin
    .from('members')
    .select('id, discord_username')
    .in('discord_username', seedNames);

  if (findErr) {
    console.error('❌ Error finding members:', findErr.message);
    process.exit(1);
  }

  if (!found || found.length === 0) {
    console.log('ℹ️ No pre-seeded demo profiles found in database. The den is already clean!');
    return;
  }

  console.log(`Found ${found.length} demo profiles to remove:`, found.map(m => m.discord_username).join(', '));

  const { error: delErr } = await supabaseAdmin
    .from('members')
    .delete()
    .in('discord_username', seedNames);

  if (delErr) {
    console.error('❌ Error deleting demo profiles:', delErr.message);
    process.exit(1);
  }

  console.log('✅ Successfully removed all pre-seeded demo profiles from Supabase! 🦊 Den is ready for real members.');
}

run().catch(console.error);
