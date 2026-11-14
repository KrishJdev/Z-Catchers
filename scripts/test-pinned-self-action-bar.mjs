import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('▶ Test Suite: Pinned Self-Action Bar (Issue #62 / Jira ZC-28)');

const rootDir = process.cwd();
const componentPath = path.join(rootDir, 'src', 'components', 'PinnedSelfActionBar.tsx');
const pagePath = path.join(rootDir, 'src', 'app', 'page.tsx');

// ---------------------------------------------------------------------------
// Test 1: File Existence & Export
// ---------------------------------------------------------------------------
console.log('▶ Test 1: Verifying PinnedSelfActionBar.tsx exists and exports properly');
assert(fs.existsSync(componentPath), 'PinnedSelfActionBar.tsx component file must exist');

const componentSource = fs.readFileSync(componentPath, 'utf8');
assert(
  componentSource.includes('export function PinnedSelfActionBar') ||
    componentSource.includes('export const PinnedSelfActionBar'),
  'PinnedSelfActionBar.tsx must export PinnedSelfActionBar component'
);
console.log('  ✅ PinnedSelfActionBar.tsx exists and exports valid React component.\n');

// ---------------------------------------------------------------------------
// Test 2: Golden Operating Rules & Design Token Compliance
// ---------------------------------------------------------------------------
console.log('▶ Test 2: Verifying design tokens, touch targets, and timezone rules');

// Timezone Math must use luxon
assert(
  componentSource.includes("from 'luxon'"),
  'PinnedSelfActionBar must import luxon for timezone and cooldown evaluation'
);
assert(
  !componentSource.includes('new Date().getTimezoneOffset()'),
  'Must not use native getTimezoneOffset'
);

// Fixed positioning above BottomNav on mobile (bottom-16) and screen bottom on desktop (md:bottom-0)
assert(
  componentSource.includes('bottom-16') && componentSource.includes('md:bottom-0'),
  'PinnedSelfActionBar must be positioned with fixed bottom-16 md:bottom-0'
);
assert(
  componentSource.includes('z-30'),
  'PinnedSelfActionBar must have z-30 layering'
);

// Mobile touch target compliance (>= 44x44px)
const minHeightMatches = componentSource.match(/min-h-\[44px\]/g) || [];
assert(
  minHeightMatches.length >= 2,
  `PinnedSelfActionBar must enforce min-h-[44px] on interactive buttons (found ${minHeightMatches.length})`
);
const minWidthMatches = componentSource.match(/min-w-\[44px\]/g) || [];
assert(
  minWidthMatches.length >= 2,
  `PinnedSelfActionBar must enforce min-w-[44px] on interactive buttons (found ${minWidthMatches.length})`
);

// Warm Dark UI Tokens
assert(
  componentSource.includes('bg-night-surface') || componentSource.includes('bg-night-elevated'),
  'Must use Warm Dark surface or elevated background tokens'
);
assert(
  componentSource.includes('text-cream-primary') || componentSource.includes('text-cream-secondary'),
  'Must use Warm Dark cream typography tokens'
);
assert(
  componentSource.includes('bg-status-amber') || componentSource.includes('text-status-amber'),
  'Must use status-amber theme accents'
);
console.log('  ✅ Golden rules, Warm Dark design tokens, and 44x44px touch targets verified.\n');

// ---------------------------------------------------------------------------
// Test 3: Context-Aware Presentation (Awake, Asleep, Pending Cooldown)
// ---------------------------------------------------------------------------
console.log('▶ Test 3: Verifying context-aware action presentation logic');

// Check-in button ("I'm in Bed")
assert(
  componentSource.includes("I&apos;m in Bed") || componentSource.includes("I'm in Bed"),
  'Must include prominent "I\'m in Bed" check-in action'
);

// Wake-up button ("I'm Awake")
assert(
  componentSource.includes("I&apos;m Awake") || componentSource.includes("I'm Awake"),
  'Must include prominent "I\'m Awake" wake-up action'
);

// Cancel Pending cooldown action
assert(
  componentSource.includes('Cancel Pending') || componentSource.includes('cancel-pending'),
  'Must include "Cancel Pending" schedule change cooldown action'
);

// Sleep Shield status indicator when asleep
assert(
  componentSource.includes('Sleep Shield Active'),
  'Must render Sleep Shield status indicator when member is in bed'
);

// Optimistic UI state handling & settlement cleanup
assert(
  componentSource.includes('setOptimisticInBed') && componentSource.includes('setOptimisticInBed(null)'),
  'Must clear optimisticInBed upon request settlement so authoritative props govern state'
);
assert(
  componentSource.includes('setIsCancellingPending') && componentSource.includes('setIsCancellingPending(false)'),
  'Must clear cancellation suppression once the request settles'
);
console.log('  ✅ Context-aware presentation logic verified.\n');

// ---------------------------------------------------------------------------
// Test 4: Dashboard Mounting in src/app/page.tsx
// ---------------------------------------------------------------------------
console.log('▶ Test 4: Verifying mounting and wiring in src/app/page.tsx');
assert(fs.existsSync(pagePath), 'src/app/page.tsx must exist');
const pageSource = fs.readFileSync(pagePath, 'utf8');

// Component imported
assert(
  pageSource.includes("import { PinnedSelfActionBar } from '@/components/PinnedSelfActionBar'"),
  'page.tsx must import PinnedSelfActionBar'
);

// Only rendered when session / currentUser is active (unauthenticated visitors do not see it)
assert(
  pageSource.includes('{currentUser && (') && pageSource.includes('<PinnedSelfActionBar'),
  'PinnedSelfActionBar must only render when currentUser is authenticated'
);

// Action wiring
assert(
  pageSource.includes('onCheckIn={handleCheckIn}'),
  'Must wire onCheckIn handler'
);
assert(
  pageSource.includes('onWakeUp={handleWakeUp}'),
  'Must wire onWakeUp handler'
);
assert(
  pageSource.includes('onCancelPending={handleCancelPending}'),
  'Must wire onCancelPending handler'
);

// handleCancelPending implementation calling /api/members/cancel-pending
assert(
  pageSource.includes('/api/members/cancel-pending'),
  'page.tsx must implement handleCancelPending calling /api/members/cancel-pending'
);

// Adequate container bottom clearance (pb-36 md:pb-24) to avoid obscuring card content
assert(
  pageSource.includes('pb-36') && pageSource.includes('md:pb-24'),
  'page.tsx main container must have pb-36 md:pb-24 bottom padding clearance'
);
console.log('  ✅ Dashboard mounting, authentication guard, and action wiring verified.\n');

console.log('🎉 All Pinned Self-Action Bar (Issue #62) tests passed successfully!\n');
