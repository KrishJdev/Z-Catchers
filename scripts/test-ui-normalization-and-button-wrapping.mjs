#!/usr/bin/env node
/**
 * Test suite: UI Normalization & Button Sizing / Anti-Wrapping Verification
 * Verifies that ModDrawer, MyScheduleModal, MetastrikeModal, and MemberCard have
 * normalized button dimensions, anti-wrapping attributes, proper flex constraints,
 * and no duplicate icon/emoji artifacts.
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log('🧪 Starting UI Normalization & Button Anti-Wrapping Test Suite...');

const modDrawerPath = path.resolve('src/components/ModDrawer.tsx');
const myScheduleModalPath = path.resolve('src/components/MyScheduleModal.tsx');
const metastrikeModalPath = path.resolve('src/components/MetastrikeModal.tsx');
const memberCardPath = path.resolve('src/components/MemberCard.tsx');

const modDrawerContent = fs.readFileSync(modDrawerPath, 'utf8');
const myScheduleModalContent = fs.readFileSync(myScheduleModalPath, 'utf8');
const metastrikeModalContent = fs.readFileSync(metastrikeModalPath, 'utf8');
const memberCardContent = fs.readFileSync(memberCardPath, 'utf8');

// 1. ModDrawer: Approve Now button must have whitespace-nowrap and no duplicate lightning emoji
assert(
  !modDrawerContent.includes('<span>⚡ Approve Now</span>'),
  'ModDrawer should not have duplicate ⚡ emoji next to Zap icon in Approve Now button'
);
assert(
  modDrawerContent.includes('<span>Approve Now</span>'),
  'ModDrawer must have clean <span>Approve Now</span>'
);
assert(
  modDrawerContent.includes('whitespace-nowrap shrink-0') &&
  modDrawerContent.includes('min-h-[40px] flex items-center justify-center gap-1.5 rounded-xl bg-status-sage px-4 py-2 text-xs font-bold text-night-bg transition-opacity hover:opacity-95 disabled:opacity-50 whitespace-nowrap shrink-0 shadow-sm'),
  'Approve Now button must include whitespace-nowrap, shrink-0, and min-h-[40px] to prevent multi-line vertical wrapping'
);

// 2. ModDrawer: Reject button must have whitespace-nowrap and shrink-0
assert(
  modDrawerContent.includes('min-h-[40px] rounded-xl border border-night-border bg-night-bg px-3.5 py-2 text-xs font-semibold text-cream-secondary transition-colors hover:border-status-coral/40 hover:text-status-coral disabled:opacity-50 whitespace-nowrap shrink-0'),
  'Reject button must have whitespace-nowrap and shrink-0'
);

// 3. ModDrawer: Card layout must use sm:items-start and min-w-0 flex-1
assert(
  modDrawerContent.includes('sm:items-start sm:justify-between'),
  'ModDrawer pending approval cards must use sm:items-start for consistent top alignment'
);
assert(
  modDrawerContent.includes('flex items-start gap-3 min-w-0 flex-1'),
  'ModDrawer pending approval cards must have min-w-0 flex-1 to prevent content overflow'
);

// 4. ModDrawer: 7-day routine diff chips must have whitespace-nowrap and tabular-nums
assert(
  modDrawerContent.includes('flex flex-wrap gap-1.5 text-xs') &&
  modDrawerContent.includes('whitespace-nowrap') &&
  (modDrawerContent.includes('tabular-nums line-through') || modDrawerContent.includes('line-through tabular-nums')),
  '7-Day routine schedule diff chips must be a flex-wrap container with tabular-nums and whitespace-nowrap'
);

// 5. ModDrawer: Tab bar must have normalized pill badges on Full Roster
assert(
  modDrawerContent.includes('Full Roster</span>\n                <span\n                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold'),
  'ModDrawer Full Roster tab must feature a normalized count pill badge'
);

// 6. ModDrawer: Full Roster member item actions must have shrink-0
assert(
  modDrawerContent.includes('self-end sm:self-auto shrink-0'),
  'ModDrawer Full Roster action buttons wrapper must have shrink-0'
);

// 7. MyScheduleModal: Must not have duplicate 📅 emoji in Calendar button
assert(
  !myScheduleModalContent.includes('<span>📅 View My Sleep & Wake Calendar</span>'),
  'MyScheduleModal must not have duplicate 📅 emoji next to Calendar icon'
);
assert(
  myScheduleModalContent.includes('<span>View My Sleep & Wake Calendar</span>'),
  'MyScheduleModal must have clean <span>View My Sleep & Wake Calendar</span>'
);

// 8. MyScheduleModal: Active tab styling must use bg-status-amber text-night-bg font-bold shadow and min-h-[44px]
assert(
  myScheduleModalContent.includes('bg-status-amber text-night-bg font-bold shadow') &&
  myScheduleModalContent.includes('min-h-[44px]'),
  'MyScheduleModal active tab must use the normalized bg-status-amber text-night-bg font-bold shadow and min-h-[44px]'
);
assert(
  myScheduleModalContent.includes('min-h-[44px]') &&
  myScheduleModalContent.includes('Cancel Shift'),
  'MyScheduleModal Cancel Shift button must have min-h-[44px]'
);

// 9. MetastrikeModal: Close button must be normalized with min-h-[44px] min-w-[44px]
assert(
  metastrikeModalContent.includes('min-h-[44px] min-w-[44px] flex items-center justify-center'),
  'MetastrikeModal close button must meet min-h-[44px] min-w-[44px] touch target'
);

// 10. ModDrawer: Webhook and Add Member buttons normalized with min-h-[44px] and whitespace-nowrap
assert(
  modDrawerContent.includes('min-h-[44px] items-center justify-center gap-2 rounded-xl bg-status-amber px-3.5 text-xs font-bold text-night-bg transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shadow-sm'),
  'Webhook test button must have min-h-[44px] and whitespace-nowrap'
);
assert(
  modDrawerContent.includes('min-h-[44px] items-center justify-center gap-2 rounded-xl border border-status-sage/40 bg-status-sage/15 px-3.5 text-xs font-bold text-status-sage transition-colors hover:bg-status-sage/25 disabled:opacity-50 whitespace-nowrap shadow-sm'),
  'Webhook digest button must have min-h-[44px] and whitespace-nowrap'
);
assert(
  modDrawerContent.includes('min-h-[44px] min-w-[44px] rounded-md bg-night-elevated text-xs font-bold text-cream-secondary'),
  'ModDrawer strike adjusters must have min-h-[44px] min-w-[44px]'
);
assert(
  modDrawerContent.includes('min-h-[44px] whitespace-nowrap') &&
  modDrawerContent.includes('Pending Approvals'),
  'ModDrawer tabs must have min-h-[44px] and whitespace-nowrap'
);

// 11. SleepCalendarModal: Edit Schedule button normalized with min-h-[44px] and whitespace-nowrap shrink-0
const sleepCalendarModalPath = path.resolve('src/components/SleepCalendarModal.tsx');
const sleepCalendarContent = fs.readFileSync(sleepCalendarModalPath, 'utf8');
assert(
  sleepCalendarContent.includes('min-h-[44px] whitespace-nowrap shrink-0') &&
  sleepCalendarContent.includes('Edit Schedule'),
  'SleepCalendarModal Edit Schedule button must have min-h-[44px] and whitespace-nowrap shrink-0'
);

// 12. SleepCalendarModal: Log/Edit wake-up button normalized with min-h-[44px] and whitespace-nowrap shrink-0
assert(
  sleepCalendarContent.includes('min-h-[44px] whitespace-nowrap shrink-0'),
  'SleepCalendarModal wake-up log/edit button must have min-h-[44px] and whitespace-nowrap shrink-0'
);

// 13. PwaBanner: Dismiss button must meet min-h-[44px] min-w-[44px] touch target
const pwaBannerPath = path.resolve('src/components/PwaBanner.tsx');
const pwaBannerContent = fs.readFileSync(pwaBannerPath, 'utf8');
assert(
  pwaBannerContent.includes('min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg'),
  'PwaBanner dismiss buttons must meet min-h-[44px] min-w-[44px] touch target'
);

// 14. HomePage: Hero manual wake form buttons have whitespace-nowrap and shrink-0
const homePagePath = path.resolve('src/app/page.tsx');
const homePageContent = fs.readFileSync(homePagePath, 'utf8');
assert(
  homePageContent.includes('Save Wake Time') &&
  homePageContent.includes('whitespace-nowrap shrink-0'),
  'HomePage hero manual wake time form buttons must have whitespace-nowrap and shrink-0'
);

console.log('✅ All UI Normalization & Button Anti-Wrapping assertions passed cleanly!');
process.exit(0);
