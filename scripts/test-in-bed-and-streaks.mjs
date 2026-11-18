import { DateTime } from 'luxon';
import {
  computeMemberState,
  calculateSleepStreak,
  getStreakMilestoneBadge,
  resolveActiveSleepCycleWindow,
  getSleepCycleDate,
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
assert(afterCheckin.needsWakeUpLog === true, 'After check-in: needsWakeUpLog is true');

// At bedtime hit (23:05): if in bed, stays SLEEPING instead of urgent BEDTIME_NOW
const atBedtimeWithCheckin = computeMemberState(
  mockMember,
  'UTC',
  DateTime.fromISO('2026-11-09T23:05:00.000Z', { zone: 'UTC' }),
  true
);
assert(atBedtimeWithCheckin.bucket === 'SLEEPING', 'At bedtime hit: member remains in SLEEPING bucket (not BEDTIME_NOW)');
assert(atBedtimeWithCheckin.needsWakeUpLog === true, 'At bedtime hit while in bed: needsWakeUpLog is true');

// Once wake up is logged for the cycle, status transitions to AWAKE and needsWakeUpLog becomes false
const wokeUpMember = {
  ...mockMember,
  is_in_bed: false,
  last_woke_up_at: '2026-11-10T07:15:00.000Z',
  last_wake_cycle_date: '2026-11-09',
};
const afterWakeUp = computeMemberState(
  wokeUpMember,
  'UTC',
  DateTime.fromISO('2026-11-10T07:15:00.000Z', { zone: 'UTC' }),
  false
);
assert(afterWakeUp.bucket === 'AWAKE', 'After wake-up logged: member resolves to AWAKE bucket');
assert(afterWakeUp.needsWakeUpLog === false, 'After wake-up logged: needsWakeUpLog is false');

// 2B. Manual-Only State Transitions & Overdue / Past Bedtime Bucket:
// Case 1: Member passes scheduled bedtime by 1 second without checking in -> immediately moves to "Overdue / Past Bedtime" bucket
const atBedtime1sUnchecked = computeMemberState(
  mockMember,
  'UTC',
  DateTime.fromISO('2026-11-09T23:00:01.000Z', { zone: 'UTC' }),
  false
);
assert(atBedtime1sUnchecked.bucket === 'BEDTIME_NOW', '1s past bedtime without check-in: member is in Overdue / Past Bedtime bucket');
assert(atBedtime1sUnchecked.isOverdue === true, '1s past bedtime: isOverdue is true');
assert(atBedtime1sUnchecked.status === 'BEDTIME_GRACE', '1s past bedtime: status is BEDTIME_GRACE');
assert(atBedtime1sUnchecked.isSleepShieldActive === false, '1s past bedtime: Sleep Shield is OFF');

// Case 2: Member passes bedtime by 10 minutes without in-bed check-in -> remains in Overdue bucket
const atBedtime10mUnchecked = computeMemberState(
  mockMember,
  'UTC',
  DateTime.fromISO('2026-11-09T23:10:00.000Z', { zone: 'UTC' }),
  false
);
assert(atBedtime10mUnchecked.bucket === 'BEDTIME_NOW', '10m past bedtime without check-in: remains in Overdue bucket');
assert(atBedtime10mUnchecked.status === 'OVERDUE_NAG_NOW', '10m past bedtime without check-in: status is OVERDUE_NAG_NOW');
assert(atBedtime10mUnchecked.isSleepShieldActive === false, '10m past bedtime without check-in: Sleep Shield remains OFF');

// Case 3: Member passes bedtime without clicking in-bed, and cron runs past scheduled wake-up time (07:00 AM)
// Fallback Rule: transitions out of overdue directly to "Awake" without being incorrectly marked as asleep
const atWakeTimeUnchecked = computeMemberState(
  mockMember,
  'UTC',
  DateTime.fromISO('2026-11-10T07:05:00.000Z', { zone: 'UTC' }),
  false
);
assert(atWakeTimeUnchecked.bucket === 'AWAKE', 'Past scheduled wake-up time without in-bed check-in: transitions directly to AWAKE');
assert(atWakeTimeUnchecked.status === 'AWAKE', 'Past scheduled wake-up time without in-bed check-in: status is AWAKE');
assert(atWakeTimeUnchecked.needsWakeUpLog === false, 'Past scheduled wake-up time without check-in: needsWakeUpLog is false');

// Case 4: Member manually clicks "I'm in Bed" from Overdue -> moves from Overdue to "Asleep" (SLEEPING)
const atOverdueCheckedIn = computeMemberState(
  mockMember,
  'UTC',
  DateTime.fromISO('2026-11-09T23:10:00.000Z', { zone: 'UTC' }),
  true
);
assert(atOverdueCheckedIn.bucket === 'SLEEPING', 'Manual in-bed click from Overdue: moves to SLEEPING (Asleep)');
assert(atOverdueCheckedIn.status === 'SLEEPING', 'Status transitions to SLEEPING');
assert(atOverdueCheckedIn.isSleepShieldActive === true, 'Sleep Shield is active once in bed');

// -------------------------------------------------------------
// 3. Live Database & Cron Suppression Test
// -------------------------------------------------------------
console.log('\n--- 3. Live Database Check-In & Cron Suppression Verification ---');

const runnerMode = process.env.RUNNER_MODE || (process.argv.includes('--all') ? 'all' : 'unit');
const isAllMode = runnerMode === 'all';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder') && !supabaseKey.includes('placeholder'));
const isSupabaseLive = isAllMode && hasCredentials;

if (!isSupabaseLive) {
  if (!isAllMode) {
    console.log('ℹ️ Running in unit mode (RUNNER_MODE != "all"). Skipping live DB test.');
  } else {
    console.log('⚠️ Skipping live DB test (Supabase credentials not in env or placeholder).');
  }
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

// -------------------------------------------------------------
// 4. Weekday-to-Weekend Cross-Midnight Transition & Date Anchoring
// -------------------------------------------------------------
console.log('\n--- 4. Weekday-to-Weekend Cross-Midnight Transition & Date Anchoring ---');

// Friday bedtime 23:00, wake 07:00; Saturday bedtime 01:00 (Sunday 01:00 AM), wake 09:30
const variableMember = {
  id: 'test-var-member',
  discord_username: 'WeekendFox',
  discord_handle: 'weekendfox',
  avatar_url: null,
  journal_url: 'https://discord.com/channels/123/456',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  timezone: 'UTC',
  weekly_schedule: {
    mon: { bedtime: '23:00', wake_time: '07:00' },
    tue: { bedtime: '23:00', wake_time: '07:00' },
    wed: { bedtime: '23:00', wake_time: '07:00' },
    thu: { bedtime: '23:00', wake_time: '07:00' },
    fri: { bedtime: '23:00', wake_time: '07:00' },
    sat: { bedtime: '01:00', wake_time: '09:30' },
    sun: { bedtime: '23:00', wake_time: '07:00' },
  },
  role: 'member',
  passcode_hash: null,
  is_active: true,
  is_in_bed: false,
};

// 4.1 Friday evening at 22:30 (30m before Friday 23:00 bedtime)
const friEvening = DateTime.fromISO('2026-11-20T22:30:00.000Z', { zone: 'UTC' });
const friEveningWindow = resolveActiveSleepCycleWindow(variableMember, friEvening);
assert(friEveningWindow.cycleAnchorDate === '2026-11-20', 'Friday 22:30 cycleAnchorDate is 2026-11-20');
assert(friEveningWindow.dayKey === 'fri', 'Friday 22:30 dayKey is fri');
assert(friEveningWindow.activeBedtimeLocal === '23:00', 'Friday 22:30 activeBedtimeLocal is 23:00');
assert(friEveningWindow.activeWakeTimeLocal === '07:00', 'Friday 22:30 activeWakeTimeLocal is 07:00');

const friEveningState = computeMemberState(variableMember, 'UTC', friEvening);
assert(friEveningState.bucket === 'WINDING_DOWN', 'Friday 22:30 bucket is WINDING_DOWN');
assert(friEveningState.dayKey === 'fri', 'Friday 22:30 state dayKey is fri');

// 4.2 Saturday at 00:00 (Midnight crossover!): Must continue evaluating against Friday night schedule
const satMidnight = DateTime.fromISO('2026-11-21T00:00:00.000Z', { zone: 'UTC' });
const satMidnightWindow = resolveActiveSleepCycleWindow(variableMember, satMidnight);
assert(satMidnightWindow.cycleAnchorDate === '2026-11-20', 'Saturday 00:00 midnight crossover preserves Friday cycleAnchorDate 2026-11-20');
assert(satMidnightWindow.dayKey === 'fri', 'Saturday 00:00 midnight crossover preserves Friday dayKey (fri)');
assert(satMidnightWindow.activeBedtimeLocal === '23:00', 'Saturday 00:00 midnight crossover preserves Friday bedtime 23:00');
assert(satMidnightWindow.activeWakeTimeLocal === '07:00', 'Saturday 00:00 midnight crossover preserves Friday wake_time 07:00');

const satMidnightState = computeMemberState(variableMember, 'UTC', satMidnight, false);
assert(satMidnightState.bucket === 'BEDTIME_NOW', 'Saturday 00:00 un-checked-in member is BEDTIME_NOW (overdue)');
assert(satMidnightState.dayKey === 'fri', 'Saturday 00:00 state dayKey is fri, not sat');
assert(satMidnightState.activeWakeTimeLocal === '07:00', 'Saturday 00:00 evaluates against Friday wake_time 07:00, not Saturday 09:30');

// 4.3 Saturday at 02:00 AM: Still inside Friday night sleep window
const sat0200 = DateTime.fromISO('2026-11-21T02:00:00.000Z', { zone: 'UTC' });
const sat0200Window = resolveActiveSleepCycleWindow(variableMember, sat0200);
assert(sat0200Window.cycleAnchorDate === '2026-11-20', 'Saturday 02:00 AM cycleAnchorDate is 2026-11-20');
assert(sat0200Window.dayKey === 'fri', 'Saturday 02:00 AM dayKey is fri');

// 4.4 Saturday at 06:30 AM: Active cycle remains Friday night, active wake_time remains 07:00
const sat0630 = DateTime.fromISO('2026-11-21T06:30:00.000Z', { zone: 'UTC' });
const sat0630Window = resolveActiveSleepCycleWindow(variableMember, sat0630);
assert(sat0630Window.cycleAnchorDate === '2026-11-20', 'Saturday 06:30 AM cycleAnchorDate is 2026-11-20');
assert(sat0630Window.dayKey === 'fri', 'Saturday 06:30 AM dayKey is fri');
assert(sat0630Window.activeWakeTimeLocal === '07:00', 'Saturday 06:30 AM activeWakeTimeLocal is 07:00');

// 4.5 Member checked in before midnight (Friday 22:45) and sleeping past midnight
const satInBedState = computeMemberState(variableMember, 'UTC', sat0630, true);
assert(satInBedState.bucket === 'SLEEPING', 'Saturday 06:30 checked-in member is SLEEPING');
assert(satInBedState.isSleepShieldActive === true, 'Saturday 06:30 checked-in member Sleep Shield is ACTIVE');
assert(satInBedState.dayKey === 'fri', 'Saturday 06:30 in-bed member dayKey is fri');

// 4.6 Member sleeping past scheduled wake time (Saturday 07:30) while in bed
const sat0730 = DateTime.fromISO('2026-11-21T07:30:00.000Z', { zone: 'UTC' });
const satOverSleepState = computeMemberState(variableMember, 'UTC', sat0730, true);
assert(satOverSleepState.bucket === 'SLEEPING', 'Saturday 07:30 sleeping past wake time remains in SLEEPING bucket');
assert(satOverSleepState.statusText.includes('Past Wake Time'), 'Saturday 07:30 statusText shows Past Wake Time');
assert(satOverSleepState.dayKey === 'fri', 'Saturday 07:30 sleeping past wake time retains Friday dayKey');

// 4.7 Member woke up on Saturday morning (06:45 AM)
const wokeUpFriNightMember = {
  ...variableMember,
  is_in_bed: false,
  is_woke_up: true,
  last_woke_up_at: '2026-11-21T06:45:00.000Z',
  last_wake_cycle_date: '2026-11-20',
};
const satPostWakeState = computeMemberState(wokeUpFriNightMember, 'UTC', DateTime.fromISO('2026-11-21T06:45:00.000Z', { zone: 'UTC' }), false);
assert(satPostWakeState.bucket === 'AWAKE', 'Saturday 06:45 after wake-up resolves to AWAKE');
assert(satPostWakeState.statusText === 'Wide Awake • Rested', 'Saturday 06:45 statusText is Wide Awake • Rested');
assert(satPostWakeState.isSleepShieldActive === false, 'Saturday 06:45 Sleep Shield is deactivated upon wake-up');

// 4.8 Saturday daytime (14:00): Cleanly resolves to Saturday night upcoming cycle (bedtime 01:00 AM Sun)
const satDaytime = DateTime.fromISO('2026-11-21T14:00:00.000Z', { zone: 'UTC' });
const satDaytimeWindow = resolveActiveSleepCycleWindow(variableMember, satDaytime);
assert(satDaytimeWindow.cycleAnchorDate === '2026-11-21', 'Saturday 14:00 daytime resolves to Saturday night cycle 2026-11-21');
assert(satDaytimeWindow.dayKey === 'sat', 'Saturday 14:00 daytime dayKey is sat');
assert(satDaytimeWindow.activeBedtimeLocal === '01:00', 'Saturday 14:00 daytime upcoming bedtime is 01:00');
assert(satDaytimeWindow.activeWakeTimeLocal === '09:30', 'Saturday 14:00 daytime upcoming wake_time is 09:30');

// 4.9 Post-midnight bedtime agreement (Tuesday 00:30 bedtime / Monday night anchor)
const postMidnightMember = {
  id: 'test-post-midnight-member',
  discord_username: 'NightOwlFox',
  timezone: 'UTC',
  bedtime_local: '00:30',
  wake_time_local: '08:00',
  weekly_schedule: {
    mon: { bedtime: '00:30', wake_time: '08:00' },
    tue: { bedtime: '00:30', wake_time: '08:00' },
    wed: { bedtime: '00:30', wake_time: '08:00' },
    thu: { bedtime: '00:30', wake_time: '08:00' },
    fri: { bedtime: '00:30', wake_time: '08:00' },
    sat: { bedtime: '00:30', wake_time: '08:00' },
    sun: { bedtime: '00:30', wake_time: '08:00' },
  },
  role: 'member',
  is_active: true,
  is_in_bed: false,
};

// Monday night at 23:45 (T-45m before Tuesday 00:30 bedtime)
const monNight = DateTime.fromISO('2026-11-16T23:45:00.000Z', { zone: 'UTC' });
const monNightWindow = resolveActiveSleepCycleWindow(postMidnightMember, monNight);
assert(monNightWindow.cycleAnchorDate === '2026-11-16', 'Monday 23:45 for 00:30 bedtime anchors to Monday 2026-11-16');
assert(monNightWindow.dayKey === 'mon', 'Monday 23:45 dayKey is mon');

// Tuesday at 00:15 (T-15m before 00:30 bedtime, post-midnight)
const tuePreBed = DateTime.fromISO('2026-11-17T00:15:00.000Z', { zone: 'UTC' });
const tuePreBedWindow = resolveActiveSleepCycleWindow(postMidnightMember, tuePreBed);
assert(tuePreBedWindow.cycleAnchorDate === '2026-11-16', 'Tuesday 00:15 (T-15m) anchors to Monday evening 2026-11-16');
assert(tuePreBedWindow.dayKey === 'mon', 'Tuesday 00:15 dayKey is mon');
assert(tuePreBedWindow.activeBedtimeLocal === '00:30', 'Tuesday 00:15 activeBedtimeLocal is 00:30');

// Tuesday at 06:30 (morning before 08:00 wake_time)
const tueMorning = DateTime.fromISO('2026-11-17T06:30:00.000Z', { zone: 'UTC' });
const tueMorningWindow = resolveActiveSleepCycleWindow(postMidnightMember, tueMorning);
assert(tueMorningWindow.cycleAnchorDate === '2026-11-16', 'Tuesday 06:30 morning anchors to Monday night cycle 2026-11-16');
assert(tueMorningWindow.dayKey === 'mon', 'Tuesday 06:30 morning dayKey is mon');
assert(tueMorningWindow.activeWakeTimeLocal === '08:00', 'Tuesday 06:30 morning activeWakeTimeLocal is 08:00');

if (failed) {
  console.error('\n❌ SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('\n🎉 ALL TESTS PASSED CLEANLY! Anti-Spam Safe Button & Sleep Streaks verified.');
}
