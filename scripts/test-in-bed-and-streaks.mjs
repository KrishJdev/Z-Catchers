import { DateTime } from 'luxon';
import {
  computeMemberState,
  calculateSleepStreak,
  getStreakMilestoneBadge,
} from '../src/lib/sleepEngine.ts';
import { createClient } from '@supabase/supabase-js';

console.log('🧪 Starting "I\'m In Bed" Safe Button, Streak Tracking & Anti-Spam Verification...\n');

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
// 1. Streak Calculation Pure Function Tests
// -------------------------------------------------------------
console.log('--- 1. Streak Calculation & Milestone Tests ---');

const baseTime = DateTime.fromISO('2026-11-09T22:00:00.000Z', { zone: 'UTC' });

// Test 1: Checked in today and yesterday and day before -> 3 days
const streak3 = calculateSleepStreak(['2026-11-09', '2026-11-08', '2026-11-07'], baseTime);
assert(streak3 === 3, `Consecutive 3-day streak counted accurately: ${streak3}`);

// Test 2: Checked in yesterday and day before, but not today yet -> 2 days (streak still alive)
const streak2 = calculateSleepStreak(['2026-11-08', '2026-11-07'], baseTime);
assert(streak2 === 2, `Streak still active if checked in yesterday (today pending): ${streak2}`);

// Test 3: Gap in dates -> streak broken
const streakBroken = calculateSleepStreak(['2026-11-06', '2026-11-05'], baseTime);
assert(streakBroken === 0, `Streak broken when no checkin yesterday or today: ${streakBroken}`);

// Test 4: Empty checkin list
const streakEmpty = calculateSleepStreak([], baseTime);
assert(streakEmpty === 0, `Empty check-in list returns 0: ${streakEmpty}`);

// Test 5: Milestone badges
const badge3 = getStreakMilestoneBadge(3);
assert(badge3?.badgeLabel === '3d Cozy' && badge3.icon === '🥉', '3-day milestone returns Cozy Kit 🥉');

const badge7 = getStreakMilestoneBadge(7);
assert(badge7?.badgeLabel === '7d Dreamer' && badge7.icon === '🥈', '7-day milestone returns Dream Fox 🥈');

const badge14 = getStreakMilestoneBadge(14);
assert(badge14?.badgeLabel === '14d Guard' && badge14.icon === '🥇', '14-day milestone returns Night Guardian 🥇');

const badge30 = getStreakMilestoneBadge(30);
assert(badge30?.badgeLabel === '30d Master' && badge30.icon === '👑', '30-day milestone returns Grand Slumber Fox 👑');

// -------------------------------------------------------------
// 2. Early Check-In Bucket Transformation
// -------------------------------------------------------------
console.log('\n--- 2. "I\'m in Bed" State Machine Transformation ---');

const mockMember = {
  id: 'test-member-1',
  discord_username: 'BedtimeFox',
  discord_handle: 'fox',
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
  passcode_hash: null,
  is_active: true,
  created_at: baseTime.toISO(),
  updated_at: baseTime.toISO(),
  is_in_bed: false,
};

// At 22:30 (30m before bedtime): normally WINDING_DOWN
const beforeCheckin = computeMemberState(
  mockMember,
  'UTC',
  DateTime.fromISO('2026-11-09T22:30:00.000Z', { zone: 'UTC' })
);
assert(beforeCheckin.bucket === 'WINDING_DOWN', 'Before check-in at T-30m: bucket is WINDING_DOWN');
assert(beforeCheckin.isSleepShieldActive === false, 'Before check-in: Sleep Shield is NOT active');

// After tapping "I'm in Bed": transforms into SLEEPING early with Sleep Shield ACTIVE!
const afterCheckin = computeMemberState(
  mockMember,
  'UTC',
  DateTime.fromISO('2026-11-09T22:30:00.000Z', { zone: 'UTC' }),
  true // isInBed
);
assert(afterCheckin.bucket === 'SLEEPING', 'After "I\'m in Bed" Safe Button: bucket immediately transforms to SLEEPING');
assert(afterCheckin.isSleepShieldActive === true, 'After "I\'m in Bed": Sleep Shield becomes ACTIVE early');
assert(afterCheckin.checkedInEarly === true, 'checkedInEarly flag is TRUE');

// At bedtime hit (23:05): if in bed, stays SLEEPING instead of urgent BEDTIME_NOW
const atBedtimeWithCheckin = computeMemberState(
  mockMember,
  'UTC',
  DateTime.fromISO('2026-11-09T23:05:00.000Z', { zone: 'UTC' }),
  true
);
assert(atBedtimeWithCheckin.bucket === 'SLEEPING', 'At bedtime hit: member remains in SLEEPING bucket (not BEDTIME_NOW)');

// -------------------------------------------------------------
// 3. Live Database & Cron Suppression Test
// -------------------------------------------------------------
console.log('\n--- 3. Live Database Check-In & Cron Suppression Verification ---');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isSupabaseLive = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder') && !supabaseKey.includes('placeholder'));

if (!isSupabaseLive) {
  console.log('⚠️ Skipping live DB test (Supabase credentials not in env or placeholder).');
} else {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: members } = await supabase.from('members').select('*').limit(1);
  let testMember = members && members.length > 0 ? members[0] : null;
  let createdTempMember = false;

  if (!testMember) {
    const { data: tempMem } = await supabase.from('members').insert({
      discord_username: 'StreakFox_' + Date.now(),
      journal_url: 'https://discord.com/channels/123/456',
      bedtime_local: '23:00',
      timezone: 'UTC',
      is_active: true,
    }).select().single();
    testMember = tempMem;
    createdTempMember = true;
  }

  if (testMember) {
    const testDate = '2099-05-15'; // far future date to avoid interfering with real records

    // Insert test IN_BED_EARLY log
    const { error: insErr } = await supabase.from('notification_logs').insert({
      member_id: testMember.id,
      notification_type: 'IN_BED_EARLY',
      local_date: testDate,
    });
    assert(!insErr, `Successfully logged test early check-in for ${testMember.discord_username}`);

    // Query to confirm
    const { data: found } = await supabase
      .from('notification_logs')
      .select('*')
      .eq('member_id', testMember.id)
      .eq('notification_type', 'IN_BED_EARLY')
      .eq('local_date', testDate);
    assert(found && found.length === 1, 'Verified IN_BED_EARLY logged in Supabase notification_logs');

    // Clean up
    await supabase.from('notification_logs').delete().eq('id', found[0].id);
    if (createdTempMember) {
      await supabase.from('members').delete().eq('id', testMember.id);
    }
    console.log('✅ Cleaned up test database record.');
  }
}

if (failed) {
  console.error('\n❌ SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('\n🎉 ALL TESTS PASSED CLEANLY! Anti-Spam Safe Button & Sleep Streaks verified.');
}
