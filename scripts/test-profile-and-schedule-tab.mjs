import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Profile & Schedule Tab Redundancy & Auto-fill Handle Verification...\n');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  }
}

async function run() {
  // 1. Header Navigation: Verify My Schedule button is removed and Profile button exists
  console.log('--- 1. Header Navigation Redundancy Elimination ---');
  const headerContent = fs.readFileSync(path.resolve('src/components/Header.tsx'), 'utf8');
  assert(!headerContent.includes('<span>My Schedule</span>'), 'Header does not render redundant "My Schedule" button');
  assert(headerContent.includes('currentUser.discord_username'), 'Header renders authenticated user profile pill');
  assert(headerContent.includes('title={`Logged in as @${currentUser.discord_username}. Tap to view your profile & schedule.`}'), 'Header profile pill has clear title pointing to profile & schedule');
  assert(headerContent.includes('onClick={onOpenSchedule}'), 'Header profile pill triggers schedule modal');

  // 2. MyScheduleModal: Verify Website Username is editable and Discord Handle is auto-filled & locked
  console.log('\n--- 2. MyScheduleModal Profile Form Fields ---');
  const scheduleContent = fs.readFileSync(path.resolve('src/components/MyScheduleModal.tsx'), 'utf8');
  assert(scheduleContent.includes('Website Username'), 'Modal labels the editable username as "Website Username"');
  assert(scheduleContent.includes('value={username}') && scheduleContent.includes('onChange={(e) => setUsername(e.target.value)}'), 'Website Username is fully user-editable');
  assert(scheduleContent.includes('Auto-filled from Discord'), 'Discord Handle displays "Auto-filled from Discord" indicator');
  assert(scheduleContent.includes('readOnly') && scheduleContent.includes('disabled') && scheduleContent.includes('value={handle}'), 'Discord Handle is read-only, disabled, and auto-filled');
  assert(scheduleContent.includes('My Profile &amp; Schedule') || scheduleContent.includes('My Profile & Schedule'), 'Modal title reflects unified "My Profile & Schedule"');

  // 3. Fallback auto-derivation of handle if discord_handle was null
  console.log('\n--- 3. Discord Handle Fallback Auto-population ---');
  assert(scheduleContent.includes('const rawHandle =') && scheduleContent.includes('activeMember.discord_handle'), 'Active member handle is auto-filled into form state');
  assert(scheduleContent.includes('startsWith(\'@\')'), 'Discord Handle ensures "@" prefix formatting');

  if (failed) {
    console.error('\n❌ Profile & Schedule verification failed.');
    process.exit(1);
  } else {
    console.log('\n✨ ALL PROFILE & SCHEDULE TAB TESTS PASSED CLEANLY! 🦊🎉');
  }
}

run();
