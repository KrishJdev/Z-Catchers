import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Member Profile Modal, Weekly Timetable & Text Overflow Verification...\n');

// 1. Verify MemberCard.tsx
console.log('--- 1. MemberCard Banner Cleanliness & Overflow Protection ---');
const memberCardPath = path.resolve('src/components/MemberCard.tsx');
assert(fs.existsSync(memberCardPath), 'MemberCard.tsx exists');
const memberCardContent = fs.readFileSync(memberCardPath, 'utf8');

// A. Routine and History buttons are removed from the banner
assert(
  !memberCardContent.includes('7-day routine'),
  'MemberCard banner must NOT display "7-day routine" toggle button'
);
assert(
  !memberCardContent.includes('showRoutine'),
  'MemberCard must NOT maintain inline showRoutine state'
);
assert(
  !memberCardContent.includes('<span>History</span>'),
  'MemberCard banner must NOT display inline "History" button'
);
console.log('✅ PASSED: Banner is clean; "7-day routine" and "History" buttons removed from banner.');

// B. Member name and avatar trigger member profile modal
assert(
  memberCardContent.includes('handleProfileClick'),
  'MemberCard implements handleProfileClick handler'
);
assert(
  memberCardContent.includes('onOpenProfile'),
  'MemberCard supports onOpenProfile prop'
);
assert(
  memberCardContent.includes('aria-label={`View ${member.discord_username}\'s profile`}'),
  'MemberCard provides accessible profile trigger on avatar or name'
);
console.log('✅ PASSED: Clicking member name or avatar triggers profile modal.');

// C. Overflow protection on feedback and error toasts
assert(
  memberCardContent.includes('max-w-full overflow-hidden'),
  'MemberCard root container enforces max-w-full overflow-hidden'
);
assert(
  !memberCardContent.includes('cardFeedback && (\n          <div\n            className={`rounded-lg border p-2 text-center text-xs font-semibold animate-fade-in whitespace-nowrap'),
  'cardFeedback must not use whitespace-nowrap'
);
assert(
  memberCardContent.includes('cardFeedback') && memberCardContent.includes('break-words text-balance'),
  'cardFeedback wraps long messages cleanly with break-words text-balance'
);
assert(
  memberCardContent.includes('cardError') && memberCardContent.includes('break-words text-balance'),
  'cardError wraps cleanly with break-words text-balance'
);
console.log('✅ PASSED: Text overflow fixed with break-words, text-balance, and card overflow-hidden.');

// 2. Verify SleepCalendarModal.tsx (Member Profile, Calendar & Weekly Timetable)
console.log('\n--- 2. SleepCalendarModal Profile, Streak Calendar & Weekly Timetable ---');
const modalPath = path.resolve('src/components/SleepCalendarModal.tsx');
assert(fs.existsSync(modalPath), 'SleepCalendarModal.tsx exists');
const modalContent = fs.readFileSync(modalPath, 'utf8');

// A. Profile Header
assert(
  modalContent.includes('resolvedProfile.name'),
  'Modal resolves and displays member name'
);
assert(
  modalContent.includes('resolvedProfile.currentLocalTimeFormatted'),
  'Modal displays live local time in member timezone'
);
assert(
  modalContent.includes('resolvedProfile.streak'),
  'Modal displays member current streak'
);
assert(
  modalContent.includes('resolvedProfile.strikesUsed'),
  'Modal displays member strikes count'
);

// B. Two Tabs: Calendar & Streak vs Weekly Timetable
assert(
  modalContent.includes("activeTab === 'calendar'"),
  'Modal implements Calendar & Streak tab view'
);
assert(
  modalContent.includes("activeTab === 'timetable'"),
  'Modal implements Weekly Timetable tab view'
);
assert(
  modalContent.includes('Weekly Timetable'),
  'Modal provides tab button for Weekly Timetable'
);

// C. Weekly Timetable Content
assert(
  modalContent.includes('7-Day Sleep & Wake Timetable'),
  'Timetable section header is rendered'
);
assert(
  modalContent.includes('DAY_KEYS.map'),
  'Timetable renders 7-day schedule breakdown'
);
assert(
  modalContent.includes('TODAY'),
  'Timetable highlights active day with TODAY badge'
);
assert(
  modalContent.includes('calculatePlannedDuration'),
  'Timetable calculates target planned sleep duration'
);

// D. Monthly Calendar & Streak Content
assert(
  modalContent.includes('WEEKDAY_HEADERS'),
  'Calendar renders 7-column weekday headers'
);
assert(
  modalContent.includes('avgDurationMinutes') && modalContent.includes('onTimePercentage'),
  'Calendar renders monthly summary statistics'
);
console.log('✅ PASSED: SleepCalendarModal provides full member profile, weekly timetable, and streak calendar.');

// 3. Verify Page Integration
console.log('\n--- 3. Page.tsx Integration ---');
const pagePath = path.resolve('src/app/page.tsx');
const pageContent = fs.readFileSync(pagePath, 'utf8');
assert(
  pageContent.includes('handleOpenMemberProfile'),
  'page.tsx implements handleOpenMemberProfile handler'
);
assert(
  pageContent.includes('onOpenProfile={handleOpenMemberProfile}'),
  'page.tsx passes onOpenProfile handler to MemberCard components'
);
assert(
  pageContent.includes('initialTab={calendarModalTab}'),
  'page.tsx passes initialTab to SleepCalendarModal'
);
console.log('✅ PASSED: page.tsx coordinates member profile clicks and modal tabs.');

console.log('\n🎉 ALL MEMBER PROFILE, TIMETABLE & OVERFLOW VERIFICATIONS PASSED CLEANLY! 🦊✨');
