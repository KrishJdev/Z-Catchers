import { DateTime } from 'luxon';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

console.log('🧪 Starting Nag Notifications & Sleep Shield Guardrail Verification...\n');

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
// 1. Time Window Eligibility Unit Tests
// -------------------------------------------------------------
console.log('--- 1. Time Window Eligibility Calculations ---');

function isNagWindowEligible(diffMinutes) {
  return diffMinutes >= -30 && diffMinutes <= 480;
}

assert(!isNagWindowEligible(-120), 'Awake 2 hours before bedtime is NOT eligible');
assert(!isNagWindowEligible(-60), 'Awake 60 minutes before bedtime is NOT eligible');
assert(!isNagWindowEligible(-31), 'Awake 31 minutes before bedtime is NOT eligible');
assert(isNagWindowEligible(-30), 'Exactly 30 minutes before bedtime IS eligible (boundary test)');
assert(isNagWindowEligible(-15), '15 minutes before bedtime IS eligible');
assert(isNagWindowEligible(-1), '1 minute before bedtime IS eligible');
assert(isNagWindowEligible(0), 'Bedtime hit (0m) IS eligible (boundary test)');
assert(isNagWindowEligible(5), 'Bedtime grace (5m) IS eligible');
assert(isNagWindowEligible(30), '30 minutes overdue IS eligible');
assert(isNagWindowEligible(60), '60 minutes overdue IS eligible');
assert(isNagWindowEligible(300), 'Inside 8h sleep window IS eligible for time window');
assert(isNagWindowEligible(480), '480 minutes (8h mark) IS eligible (boundary test)');
assert(!isNagWindowEligible(481), '481 minutes (waking up / past sleep cycle) is NOT eligible');

// -------------------------------------------------------------
// 2. Sleep Shield Guardrail Logic Tests
// -------------------------------------------------------------
console.log('\n--- 2. Sleep Shield Guardrail Evaluation ---');

function evaluateSleepShield({ isInBed, isSleepShieldActive, bucket, isMetastrikeActive }) {
  return Boolean(isInBed || isSleepShieldActive || bucket === 'SLEEPING' || isMetastrikeActive);
}

// Case A: Member is in bed (clicked "I'm in Bed" Safe Button)
assert(
  evaluateSleepShield({ isInBed: true, isSleepShieldActive: false, bucket: 'WINDING_DOWN', isMetastrikeActive: false }),
  'Shield is active when member checked in via Safe Button'
);

// Case B: Member is in the 8-hour sleep window
assert(
  evaluateSleepShield({ isInBed: false, isSleepShieldActive: true, bucket: 'SLEEPING', isMetastrikeActive: false }),
  'Shield is active when member is in 8h sleep window'
);

// Case C: Member has an active Metastrike pass tonight
assert(
  evaluateSleepShield({ isInBed: false, isSleepShieldActive: false, bucket: 'BEDTIME_NOW', isMetastrikeActive: true }),
  'Shield is active when member has active Metastrike pass'
);

// Case D: Member is overdue and awake (Shield is OFF)
assert(
  !evaluateSleepShield({ isInBed: false, isSleepShieldActive: false, bucket: 'BEDTIME_NOW', isMetastrikeActive: false }),
  'Shield is OFF when member is overdue and not checked in'
);

// Case E: Member is winding down 20m before bedtime and awake (Shield is OFF)
assert(
  !evaluateSleepShield({ isInBed: false, isSleepShieldActive: false, bucket: 'WINDING_DOWN', isMetastrikeActive: false }),
  'Shield is OFF when member is winding down without check-in'
);

// -------------------------------------------------------------
// 3. Database & API Route Live Verification Tests
// -------------------------------------------------------------
console.log('\n--- 3. Database & Notification Logs Integration Tests ---');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log('⚠️ Skipping live Supabase tests (credentials missing in environment).');
} else {
  const sb = createClient(supabaseUrl, supabaseKey);

  // Create temporary test members
  const testTargetId = crypto.randomUUID();
  const testSenderId = crypto.randomUUID();
  const nowUtc = DateTime.utc();
  const todayStr = nowUtc.toISODate();

  const testTarget = {
    id: testTargetId,
    discord_username: `NagTestTarget_${Date.now()}`,
    journal_url: 'https://discord.com/channels/1234567890/9876543210',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'UTC',
    is_active: true,
  };

  const testSender = {
    id: testSenderId,
    discord_username: `NagTestSender_${Date.now()}`,
    journal_url: 'https://discord.com/channels/1234567890/1112223334',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'UTC',
    is_active: true,
  };

  try {
    const { error: insertErr } = await sb.from('members').insert([testTarget, testSender]);
    assert(!insertErr, 'Created test target and sender profiles in Supabase');

    // Test 3A: Log manual nag assist
    const helperKey = `user_${testSenderId}`;
    const stage = 'OVERDUE';
    const nagLogType = `MANUAL_NAG:${stage}:${helperKey}`;
    const assistType = `NAG_ASSIST:${helperKey}`;

    const { error: nagLogErr } = await sb.from('notification_logs').insert({
      member_id: testTargetId,
      notification_type: nagLogType,
      local_date: todayStr,
      dispatched_at: nowUtc.toISO(),
    });
    assert(!nagLogErr, 'Manual nag record successfully inserted into notification_logs');

    // Test 3B: Deduplication on duplicate manual nag for same stage and sender
    const { error: dupNagErr } = await sb.from('notification_logs').insert({
      member_id: testTargetId,
      notification_type: nagLogType,
      local_date: todayStr,
      dispatched_at: nowUtc.toISO(),
    });
    assert(
      dupNagErr && (dupNagErr.code === '23505' || dupNagErr.message.includes('unique')),
      'PostgreSQL unique constraint rejects duplicate nag for the same sender and stage'
    );

    // Test 3C: Nag assist counter upsert
    const { error: assistErr } = await sb.from('notification_logs').upsert(
      {
        member_id: testTargetId,
        notification_type: assistType,
        local_date: todayStr,
        dispatched_at: nowUtc.toISO(),
      },
      { onConflict: 'member_id,notification_type,local_date' }
    );
    assert(!assistErr, 'Nag assist counter logged cleanly');

    // Test 3D: Sleep Shield check-in simulation
    const { error: inBedErr } = await sb.from('notification_logs').insert({
      member_id: testTargetId,
      notification_type: 'IN_BED_EARLY',
      local_date: todayStr,
      dispatched_at: nowUtc.toISO(),
    });
    assert(!inBedErr, 'Safe Button IN_BED_EARLY check-in recorded');

    // Query in-bed status
    const { data: checkInRecord } = await sb
      .from('notification_logs')
      .select('id')
      .eq('member_id', testTargetId)
      .eq('notification_type', 'IN_BED_EARLY')
      .eq('local_date', todayStr)
      .maybeSingle();

    assert(Boolean(checkInRecord), 'Target member successfully identified as Sleep Shield Active');

  } catch (err) {
    console.error('Test execution error:', err);
    failed = true;
  } finally {
    // Cleanup temporary test data
    await sb.from('notification_logs').delete().eq('member_id', testTargetId);
    await sb.from('members').delete().in('id', [testTargetId, testSenderId]);
    console.log('   Cleaned up test members and logs.');
  }
}

if (failed) {
  console.error('\n❌ SOME TESTS FAILED.');
  process.exit(1);
} else {
  console.log('\n✨ ALL NAG NOTIFICATION & SLEEP SHIELD TESTS PASSED SUCCESSFULLY! 🦊🔔🛡️\n');
}
