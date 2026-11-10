import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials missing in environment.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const DEMO_MEMBERS = [
  {
    discord_username: 'Aoi',
    discord_handle: 'aoi_jp',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Aoi',
    journal_url: 'https://discord.com/channels/123456789/987654321',
    bedtime_local: '23:30',
    wake_time_local: '07:30',
    timezone: 'GMT+09:00',
    weekend_bedtime_local: '00:30',
    weekend_wake_time_local: '09:00',
    role: 'member',
  },
  {
    discord_username: 'SarahK',
    discord_handle: 'sarah_ny',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=SarahK',
    journal_url: 'https://discord.com/channels/123456789/987654322',
    bedtime_local: '22:45',
    wake_time_local: '06:45',
    timezone: 'GMT-05:00',
    weekend_bedtime_local: '23:45',
    weekend_wake_time_local: '08:30',
    role: 'member',
  },
  {
    discord_username: 'Marcus',
    discord_handle: 'marcus_ldn',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Marcus',
    journal_url: 'https://discord.com/channels/123456789/987654323',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'GMT+00:00',
    weekend_bedtime_local: null,
    weekend_wake_time_local: null,
    role: 'moderator',
  },
  {
    discord_username: 'Arjun',
    discord_handle: 'arjun_in',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Arjun',
    journal_url: 'https://discord.com/channels/123456789/987654324',
    bedtime_local: '00:15',
    wake_time_local: '08:00',
    timezone: 'GMT+05:30',
    weekend_bedtime_local: '01:30',
    weekend_wake_time_local: '09:30',
    role: 'member',
  },
];

async function run() {
  console.log('🌱 Seeding demo profiles (Aoi, SarahK, Marcus, Arjun)...');
  for (const m of DEMO_MEMBERS) {
    const { data: existing } = await supabaseAdmin
      .from('members')
      .select('id')
      .eq('discord_username', m.discord_username)
      .maybeSingle();

    if (!existing) {
      await supabaseAdmin.from('members').insert(m);
      console.log(`   + Added demo member: ${m.discord_username}`);
    } else {
      console.log(`   = Demo member ${m.discord_username} already exists`);
    }
  }
  console.log('✅ Demo seeding complete.');
}

run().catch(console.error);
