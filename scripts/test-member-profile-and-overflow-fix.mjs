import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DateTime } from 'luxon';
import { SleepCalendarModal } from '../src/components/SleepCalendarModal.tsx';

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
  memberCardContent.includes('aria-label={`View ${member.discord_username}\'s profile'),
  'MemberCard provides an accessible shared avatar and name trigger'
);
assert(
  memberCardContent.includes('min-h-[44px] min-w-[44px]') && memberCardContent.includes('handleProfileClick'),
  'Username button enforces min-h-[44px] min-w-[44px] touch targets'
);
assert(
  memberCardContent.includes('flex flex-wrap items-center justify-between gap-x-2 gap-y-1'),
  'Schedule row supports flex-wrap with horizontal and vertical gaps'
);
console.log('✅ PASSED: Clicking member name or avatar triggers profile modal with >= 44x44px touch targets and responsive schedule wrapping.');

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
  modalContent.includes("localNow.toFormat('h:mm a')"),
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
  modalContent.includes("key: 'timetable', label: 'Schedule'"),
  'Schedule opens the existing timetable view'
);

// C. Weekly Timetable Content
assert(
  modalContent.includes('Weekly schedule'),
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
assert(
  modalContent.includes('justOpened') && modalContent.includes('prevIsOpenRef'),
  'Calendar modal refreshes history when reopened or identities change'
);
console.log('✅ PASSED: SleepCalendarModal provides full member profile, weekly timetable, and streak calendar.');

const member = {
  id: 'fox', discord_username: 'A long name in Kolkata', timezone: 'Asia/Kolkata',
  bedtime_local: '23:00', wake_time_local: '07:00',
  journal_url: 'https://discord.com/channels/123/456/789',
  weekly_schedule: { mon: { bedtime: '21:45', wake_time: '06:15' } },
};
const profileMarkup = (props = {}) => renderToStaticMarkup(createElement(SleepCalendarModal, {
  isOpen: true, member, memberId: member.id, onClose: () => {}, onToggleStar: () => {},
  ...props,
}));
const previousNow = Date.now;
try {
  const currentTime = DateTime.fromISO('2026-11-30T18:45:00Z').toMillis();
  Date.now = () => currentTime;
  const peer = profileMarkup({ isStarred: true });
  assert.match(peer, /Overdue.*12:15 AM local/);
  assert.match(peer, /href="https:\/\/discord\.com\/channels\/123\/456\/789".*Open journal/);
  assert.match(peer, /aria-label="Star member" aria-pressed="true"/);
  assert.match(peer, /aria-current="date"[^>]*aria-label="December 1, No sleep activity recorded"/);
  assert.doesNotMatch(peer, />Punishments<|Request Metastrike|Edit Wake-Up Time/);
  assert.doesNotMatch(profileMarkup({ member: { ...member, journal_url: 'https://example.com/channels/123/456' } }), /Open journal/);
  const personal = profileMarkup({ isMySleep: true, currentUser: member, onRequestMetastrike: () => {} });
  assert.match(personal, />Tonight<.*9:45 PM.*6:15 AM/);
  assert.match(personal, /aria-pressed="true"[^>]*>Calendar<.*>Schedule<.*>Punishments</);
  assert.ok(personal.indexOf('aria-label="Sleep calendar"') < personal.indexOf('id="selected-sleep-night"'));
  assert.match(profileMarkup({ isMySleep: true, currentUser: member, initialTab: 'punishments' }), /Loading punishments/);
} finally {
  Date.now = previousNow;
}

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
  pageContent.includes('initialTab={calendarView.tab}'),
  'page.tsx passes initialTab to SleepCalendarModal'
);
console.log('✅ PASSED: page.tsx coordinates member profile clicks and modal tabs.');

console.log('\n🎉 ALL MEMBER PROFILE, TIMETABLE & OVERFLOW VERIFICATIONS PASSED CLEANLY! 🦊✨');
