import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DateTime } from 'luxon';
import { MyScheduleModal } from '../src/components/MyScheduleModal.tsx';

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
  assert(headerContent.includes('aria-label="Open account settings"'), 'Header avatar names the Account settings destination');
  assert(headerContent.includes('onClick={onOpenProfile}'), 'Header avatar opens Account settings');

  // 2. MyScheduleModal: Verify Website Username is editable and Discord Handle is auto-filled & locked
  console.log('\n--- 2. MyScheduleModal Profile Form Fields ---');
  const scheduleContent = fs.readFileSync(path.resolve('src/components/MyScheduleModal.tsx'), 'utf8');
  assert(scheduleContent.includes('Website Username'), 'Modal labels the editable username as "Website Username"');
  assert(scheduleContent.includes('value={username}') && scheduleContent.includes('onChange={(e) => setUsername(e.target.value)}'), 'Website Username is fully user-editable');
  assert(scheduleContent.includes('Auto-filled from Discord'), 'Discord Handle displays "Auto-filled from Discord" indicator');
  assert(scheduleContent.includes('readOnly') && scheduleContent.includes('disabled') && scheduleContent.includes('value={handle}'), 'Discord Handle is read-only, disabled, and auto-filled');
  assert(scheduleContent.includes("openView('edit')") && scheduleContent.includes("openView('schedule')"), 'Profile opens separate editors');

  const currentUser = {
    id: 'fox', discord_username: 'Rowan Fox', discord_handle: '@rowan',
    timezone: 'Europe/Athens', bedtime_local: '23:00', wake_time_local: '07:00',
    pending_effective_at: DateTime.utc().plus({ days: 1 }).toISO(),
    pending_bedtime_local: '23:20', pending_wake_time_local: '07:40',
  };
  const renderAccount = member => renderToStaticMarkup(createElement(MyScheduleModal, {
    isOpen: true, currentUser: member, viewerTimezone: 'Asia/Kolkata',
    onClose() {}, onLogout() {}, async onRefreshRoster() {},
  }));
  const account = renderAccount(currentUser);
  assert(/Account settings.*Rowan Fox.*@rowan.*Edit profile.*Sleep schedule.*Pending change applies.*Sign out/.test(account),
    'Account sheet shows the identity, separate editor actions, pending schedule, and sign out');
  assert(/Pending change applies.*23:20 bedtime, 07:40 wake/.test(account), 'Account settings shows both pending times alongside the effective date');
  const wakeOnly = renderAccount({ ...currentUser, pending_bedtime_local: null });
  assert(/Pending change applies/.test(wakeOnly) && !/07:40 wake/.test(wakeOnly), 'A wake-only change shows its effective date');

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
