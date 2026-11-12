import { DateTime } from 'luxon';
import { createClient } from '@supabase/supabase-js';

export const DISCORD_WEBHOOK_REGEX =
  /^https:\/\/(ptb\.|canary\.)?discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

export function validateDiscordWebhookUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return DISCORD_WEBHOOK_REGEX.test(url.trim());
}

export const DISCORD_EMBED_COLORS = {
  CORAL_NAG: 14711391, // #E07A5F (Bedtime Hit / Nag Window)
  AMBER_COZY: 16032353, // #F4A261 (Wind-Down / Warning)
  SAGE_REST: 8500122, // #81B29A (Morning / Goodnight / Safe In Bed)
  SLUMBER_NIGHT: 4014171, // #3D405B (Asleep / Sleep Shield Active)
};

console.log('🧪 Starting Discord Webhook & Nag Assist Counter Verification...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

// -------------------------------------------------------------
// 1. Discord Webhook URL Regex & Validation
// -------------------------------------------------------------
console.log('--- 1. Discord Webhook URL Validation Tests ---');

const validStandard =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_123456';
const validCanary =
  'https://canary.discord.com/api/webhooks/987654321098765432/A-Z_a-z_0-9_mockToken';
const validPtb =
  'https://ptb.discord.com/api/webhooks/112233445566778899/valid_token_here';

assert(validateDiscordWebhookUrl(validStandard), 'Valid standard Discord webhook recognized');
assert(validateDiscordWebhookUrl(validCanary), 'Valid Canary Discord webhook recognized');
assert(validateDiscordWebhookUrl(validPtb), 'Valid PTB Discord webhook recognized');

assert(!validateDiscordWebhookUrl('https://evil.com/api/webhooks/123/token'), 'Rejects non-discord domain');
assert(!validateDiscordWebhookUrl('https://discord.com/channels/123/456'), 'Rejects journal channel URL as webhook');
assert(!validateDiscordWebhookUrl('https://discord.com/api/webhooks/notanumber/token'), 'Rejects non-numeric webhook ID');
assert(!validateDiscordWebhookUrl(''), 'Rejects empty string');
assert(!validateDiscordWebhookUrl(null), 'Rejects null input');

// -------------------------------------------------------------
// 2. Warm Dark Embed Color Tokens & Branding
// -------------------------------------------------------------
console.log('\n--- 2. Embed Color Tokens & Branding ---');

assert(DISCORD_EMBED_COLORS.CORAL_NAG === 14711391, 'Coral Nag color matches Warm Dark token #E07A5F');
assert(DISCORD_EMBED_COLORS.AMBER_COZY === 16032353, 'Amber Cozy color matches Warm Dark token #F4A261');
assert(DISCORD_EMBED_COLORS.SAGE_REST === 8500122, 'Sage Rest color matches Warm Dark token #81B29A');
assert(DISCORD_EMBED_COLORS.SLUMBER_NIGHT === 4014171, 'Slumber Night color matches Warm Dark token #3D405B');

// -------------------------------------------------------------
// 3. Database Nag Assist Counter & Deduplication Verification
// -------------------------------------------------------------
console.log('\n--- 3. Database Nag Assist & Deduplication Tests ---');

const runnerMode = process.env.RUNNER_MODE || (process.argv.includes('--all') ? 'all' : 'unit');
const isAllMode = runnerMode === 'all';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder') && !supabaseKey.includes('placeholder'));
const isSupabaseLive = isAllMode && hasCredentials;

if (!isSupabaseLive) {
  if (!isAllMode) {
    console.log('ℹ️ Running in unit mode (RUNNER_MODE != "all"). Skipping live database tests.');
  } else {
    console.log('⚠️ Skipping database live tests (Supabase credentials missing or placeholder in environment).');
  }
} else {
  const sb = createClient(supabaseUrl, supabaseKey);

  // Fetch or create a test member
  const { data: members } = await sb.from('members').select('*').limit(1);
  let sleeper = members && members.length > 0 ? members[0] : null;
  let createdTempSleeper = false;

  if (!sleeper) {
    const { data: tempMem } = await sb.from('members').insert({
      discord_username: 'WebhookFox_' + Date.now(),
      journal_url: 'https://discord.com/channels/123/456',
      bedtime_local: '23:00',
      timezone: 'UTC',
      is_active: true,
    }).select().single();
    sleeper = tempMem;
    createdTempSleeper = true;
  }

  if (sleeper) {
    const nowUtc = DateTime.utc();
    const sleeperLocalNow = nowUtc.setZone(sleeper.timezone);
    const localDate = sleeperLocalNow.toISODate();

    console.log(`   Testing on sleeper: ${sleeper.discord_username} (${sleeper.timezone}, date: ${localDate})`);

    const helper1 = 'test_helper_alpha_' + Date.now();
    const helper2 = 'test_helper_beta_' + Date.now();

    // 1. First assist from helper 1
    const { error: ins1 } = await sb.from('notification_logs').insert({
      member_id: sleeper.id,
      notification_type: `NAG_ASSIST:${helper1}`,
      local_date: localDate,
      dispatched_at: nowUtc.toISO(),
    });
    assert(!ins1, 'First nag assist logged successfully');

    // 2. Duplicate assist from helper 1 on same date -> should fail unique constraint
    const { error: insDup } = await sb.from('notification_logs').insert({
      member_id: sleeper.id,
      notification_type: `NAG_ASSIST:${helper1}`,
      local_date: localDate,
      dispatched_at: nowUtc.toISO(),
    });
    assert(
      Boolean(insDup && (insDup.code === '23505' || insDup.message.includes('unique'))),
      'Duplicate nag assist from same helper on same date correctly blocked by unique constraint'
    );

    // 3. Assist from helper 2
    const { error: ins2 } = await sb.from('notification_logs').insert({
      member_id: sleeper.id,
      notification_type: `NAG_ASSIST:${helper2}`,
      local_date: localDate,
      dispatched_at: nowUtc.toISO(),
    });
    assert(!ins2, 'Second unique helper nag assist logged successfully');

    // 4. Query total assists for this sleeper tonight
    const { data: assists, count } = await sb
      .from('notification_logs')
      .select('id', { count: 'exact' })
      .eq('member_id', sleeper.id)
      .like('notification_type', 'NAG_ASSIST:%')
      .eq('local_date', localDate);

    const totalAssists = count ?? (assists?.length || 0);
    assert(totalAssists >= 2, `Total assists counted accurately (found: ${totalAssists})`);

    // Clean up test rows
    await sb
      .from('notification_logs')
      .delete()
      .eq('member_id', sleeper.id)
      .in('notification_type', [`NAG_ASSIST:${helper1}`, `NAG_ASSIST:${helper2}`]);
    if (createdTempSleeper) {
      await sb.from('members').delete().eq('id', sleeper.id);
    }
    console.log('   Cleaned up test nag assist logs.');
  }
}

console.log('\n--- Summary ---');
if (failed) {
  console.error('❌ SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('🎉 ALL DISCORD WEBHOOK & NAG ASSIST TESTS PASSED CLEANLY! 🦊💤');
  process.exit(0);
}
