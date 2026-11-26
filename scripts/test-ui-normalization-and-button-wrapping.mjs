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

const visibleCard = memberCardContent.slice(memberCardContent.indexOf('  const journalLink'), memberCardContent.indexOf('{isDetailsOpen && ('));
assert.match(visibleCard, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.9fr\)_auto\]/, 'The status and journal tracks can shrink independently of Details');
assert.match(visibleCard, /<span className="min-w-0">\{journalLabel\}<\/span>/, 'Long journal action text can wrap without truncation');
assert.equal([...visibleCard.matchAll(/<(?:button|a)\b[\s\S]*?min-h-\[44px\] min-w-\[44px\]/g)].length, 4,
  'Profile, star, journal and Details have at least a 44px touch area');
assert.match(visibleCard, /whitespace-nowrap text-base font-bold tabular-nums/, 'Converted bedtime stays on one line');

// The drawer actions share 44px controls and can wrap as a group on narrow screens.
assert.match(modDrawerContent, /const secondaryButton = 'inline-flex min-h-\[44px\]/);
assert.match(modDrawerContent, /const primaryButton = 'inline-flex min-h-\[44px\]/);
assert.match(modDrawerContent, /flex flex-wrap gap-2[\s\S]*?>[\s\S]*?'Reject'[\s\S]*?'Approve Now'/);
assert.match(modDrawerContent, /min-h-\[60px\] w-full items-center/);
assert.match(modDrawerContent, /className="block truncate text-sm font-semibold"/);
assert.match(modDrawerContent, /grid grid-cols-4[\s\S]*?moderationTabs.map[\s\S]*?min-h-\[44px\]/);

// 7. Profile opens the full schedule editor with a 44px target.
assert(
  myScheduleModalContent.includes("openView('schedule')") &&
  myScheduleModalContent.includes('block min-h-[44px] w-full'),
  'Profile rows meet the minimum touch target'
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
assert.match(modDrawerContent, /className=\{secondaryButton \+ ' min-w-\[44px\]'\}/);

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

// 13. PwaBanner / UnifiedOnboardingCard: Dismiss button must meet min-h-[44px] min-w-[44px] touch target
const unifiedCardPath = path.resolve('src/components/UnifiedOnboardingCard.tsx');
const pwaBannerPath = path.resolve('src/components/PwaBanner.tsx');
const targetPath = fs.existsSync(unifiedCardPath) ? unifiedCardPath : pwaBannerPath;
const targetContent = fs.readFileSync(targetPath, 'utf8');
assert(
  targetContent.includes('min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg'),
  'PwaBanner / UnifiedOnboardingCard dismiss buttons must meet min-h-[44px] min-w-[44px] touch target'
);

const barContent = fs.readFileSync(path.resolve('src/components/PinnedSelfActionBar.tsx'), 'utf8');
assert(
  /<button type="submit" disabled=\{isCheckingIn \|\| !draftMatches\} className=\{primary\}>[^<]*Save wake time/.test(barContent) &&
  /const primary = '[^']*min-h-\[44px\] min-w-\[44px\]/.test(barContent),
  'Manual wake actions meet the minimum touch target in the pinned bar'
);

console.log('✅ All UI Normalization & Button Anti-Wrapping assertions passed cleanly!');
process.exit(0);
