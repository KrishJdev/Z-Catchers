import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { computeMemberState } from '../src/lib/sleepEngine.ts';

console.log('▶ Test Suite: Smart Status Bucket Folding by Default (Issue #64 / Jira ZC-30)');

const rootDir = process.cwd();
const statusBucketPath = path.join(rootDir, 'src', 'components', 'StatusBucket.tsx');
const pagePath = path.join(rootDir, 'src', 'app', 'page.tsx');

// ---------------------------------------------------------------------------
// Test 1: File Existence & Component Export
// ---------------------------------------------------------------------------
console.log('▶ Test 1: Verifying StatusBucket.tsx exists and exports valid component');
assert(fs.existsSync(statusBucketPath), 'StatusBucket.tsx component file must exist');

const statusBucketSource = fs.readFileSync(statusBucketPath, 'utf8');
assert(
  statusBucketSource.includes('export function StatusBucket') ||
    statusBucketSource.includes('export const StatusBucket'),
  'StatusBucket.tsx must export StatusBucket component'
);
console.log('  ✅ StatusBucket.tsx exists and exports valid React component.\n');

// ---------------------------------------------------------------------------
// Test 2: Golden Operating Rules & Design Token Compliance
// ---------------------------------------------------------------------------
console.log('▶ Test 2: Verifying Warm Dark design tokens and 44x44px mobile touch targets');

// Mobile touch target compliance (>= 44px min-h)
assert(
  statusBucketSource.includes('min-h-[44px]'),
  'StatusBucket toggle button must enforce min-h-[44px] for mobile touch accessibility'
);

// Warm Dark UI Tokens
assert(
  statusBucketSource.includes('bg-night-surface') && statusBucketSource.includes('border-night-border'),
  'Must use Warm Dark night surface and border tokens'
);
assert(
  statusBucketSource.includes('text-cream-primary') || statusBucketSource.includes('text-cream-secondary'),
  'Must use Warm Dark cream typography tokens'
);
assert(
  statusBucketSource.includes('bg-night-elevated'),
  'Must use Warm Dark night-elevated background token for pills and hover states'
);

// Tabular numbers for clean numeric layout
assert(
  statusBucketSource.includes('tabular-nums'),
  'Count pill must use tabular-nums to prevent layout jitter'
);
console.log('  ✅ Warm Dark tokens, tabular-nums, and 44px touch targets verified.\n');

// ---------------------------------------------------------------------------
// Test 3: Collapsed Header UX, Chevron Smooth Transitions, & Count Pill Phrasing
// ---------------------------------------------------------------------------
console.log('▶ Test 3: Verifying smooth chevron transitions and member count pill phrasing');

// Smooth CSS transitions on chevron
assert(
  statusBucketSource.includes('transition-transform') && statusBucketSource.includes('duration-200'),
  'Chevron icon must use transition-transform duration-200 for smooth 60fps accordion animation'
);
assert(
  statusBucketSource.includes('rotate-90') || statusBucketSource.includes('-rotate-90'),
  'Chevron icon must toggle rotation classes between collapsed and expanded states'
);

// Clean member count pill phrasing ("fox" / "foxes")
assert(
  statusBucketSource.includes("count === 1 ? 'fox' : 'foxes'") ||
    statusBucketSource.includes('foxes'),
  'Count pill must format member count with fox / foxes terminology'
);

// Accessibility attributes (aria-expanded, aria-controls)
assert(
  statusBucketSource.includes('aria-expanded'),
  'Accordion trigger button must include aria-expanded attribute'
);
assert(
  statusBucketSource.includes('aria-controls'),
  'Accordion trigger button must link to content via aria-controls'
);
console.log('  ✅ Smooth chevron transitions, count pill phrasing, and a11y verified.\n');

// ---------------------------------------------------------------------------
// Test 4: Active Session User Override Preservation
// ---------------------------------------------------------------------------
console.log('▶ Test 4: Verifying session persistence for accordion user overrides');

assert(
  statusBucketSource.includes('sessionStorage'),
  'StatusBucket must utilize sessionStorage to preserve user expand/collapse overrides during active session'
);
assert(
  statusBucketSource.includes("typeof window === 'undefined'"),
  'Must guard sessionStorage access for SSR and zero layout shift'
);
console.log('  ✅ Session override persistence and SSR guards verified.\n');

// ---------------------------------------------------------------------------
// Test 5: Dashboard Wiring & Passive vs Actionable Default Folding
// ---------------------------------------------------------------------------
console.log('▶ Test 5: Verifying page.tsx defaultExpanded configuration across all 4 buckets');
assert(fs.existsSync(pagePath), 'page.tsx must exist');

const pageSource = fs.readFileSync(pagePath, 'utf8');

// 1. Actionable Buckets: Nag Now & Winding Down must be defaultExpanded={true}
const nagNowBlock = pageSource.match(/title="Nag Now"[\s\S]*?defaultExpanded=\{([a-z]+)\}/);
assert(nagNowBlock, 'Nag Now status bucket must specify defaultExpanded');
assert.strictEqual(
  nagNowBlock[1],
  'true',
  'Nag Now bucket must be defaultExpanded={true} so overdue friends appear immediately'
);

const windingDownBlock = pageSource.match(/title="Winding Down"[\s\S]*?defaultExpanded=\{([a-z]+)\}/);
assert(windingDownBlock, 'Winding Down status bucket must specify defaultExpanded');
assert.strictEqual(
  windingDownBlock[1],
  'true',
  'Winding Down bucket must be defaultExpanded={true} for pre-bedtime accountability'
);

// 2. Passive Buckets: Awake & Sleeping must be defaultExpanded={false}
const awakeBlock = pageSource.match(/title="Awake"[\s\S]*?defaultExpanded=\{([a-z]+)\}/);
assert(awakeBlock, 'Awake status bucket must specify defaultExpanded');
assert.strictEqual(
  awakeBlock[1],
  'false',
  'Awake bucket must be defaultExpanded={false} to declutter passive daytime cards'
);

const sleepingBlock = pageSource.match(/title="Sleeping"[\s\S]*?defaultExpanded=\{([a-z]+)\}/);
assert(sleepingBlock, 'Sleeping status bucket must specify defaultExpanded');
assert.strictEqual(
  sleepingBlock[1],
  'false',
  'Sleeping bucket must be defaultExpanded={false} to declutter sleeping cards'
);

// 3. Accurate member count passing
assert(
  pageSource.includes('count={categorized.nagNow.length}'),
  'Nag Now bucket must receive accurate categorized.nagNow count'
);
assert(
  pageSource.includes('count={categorized.windingDown.length}'),
  'Winding Down bucket must receive accurate categorized.windingDown count'
);
assert(
  pageSource.includes('count={categorized.awake.length}'),
  'Awake bucket must receive accurate categorized.awake count'
);
assert(
  pageSource.includes('count={categorized.sleeping.length}'),
  'Sleeping bucket must receive accurate categorized.sleeping count'
);
console.log('  ✅ Actionable buckets expanded, passive buckets folded by default, and counts wired.\n');

// ---------------------------------------------------------------------------
// Test 6: Sleep Engine Integration & Status Categorization
// ---------------------------------------------------------------------------
console.log('▶ Test 6: Verifying sleepEngine status evaluation integration for bucketing');

// Mock members
const baseMember = {
  id: 'member-1',
  discord_id: '1234567890',
  discord_username: 'SnoozyFox',
  bedtime_local: '23:00',
  timezone: 'America/New_York',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// 1. Daytime awake -> AWAKE bucket (should fold into collapsed Awake bucket)
const daytimeNow = DateTime.fromISO('2026-11-14T14:00:00', { zone: 'America/New_York' }).toUTC();
const awakeState = computeMemberState(baseMember, 'America/New_York', daytimeNow);
assert.strictEqual(awakeState.bucket, 'AWAKE', 'Daytime member should be in AWAKE bucket');

// 2. 30 mins before bedtime -> WINDING_DOWN bucket (should surface in expanded Winding Down bucket)
const windDownNow = DateTime.fromISO('2026-11-14T22:30:00', { zone: 'America/New_York' }).toUTC();
const windDownState = computeMemberState(baseMember, 'America/New_York', windDownNow);
assert.strictEqual(windDownState.bucket, 'WINDING_DOWN', 'Member 30m before bedtime should be in WINDING_DOWN bucket');

// 3. 15 mins after bedtime without check-in -> BEDTIME_NOW bucket (should surface in expanded Nag Now bucket)
const nagNowTime = DateTime.fromISO('2026-11-14T23:15:00', { zone: 'America/New_York' }).toUTC();
const nagNowState = computeMemberState(baseMember, 'America/New_York', nagNowTime);
assert.strictEqual(nagNowState.bucket, 'BEDTIME_NOW', 'Overdue member should be in BEDTIME_NOW bucket for Nag Now');

// 4. In-bed early check-in or asleep -> SLEEPING bucket (should fold into collapsed Sleeping bucket)
const inBedMember = { ...baseMember, is_in_bed: true };
const sleepingState = computeMemberState(inBedMember, 'America/New_York', daytimeNow);
assert.strictEqual(sleepingState.bucket, 'SLEEPING', 'Checked-in member should be in SLEEPING bucket');

console.log('  ✅ Sleep engine categorization cleanly separates active vs passive status buckets.\n');

console.log('🎉 All Smart Status Bucket Folding tests passed successfully! 🦊💤');
