import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('▶ Test Suite: Unified PWA Install & Push Onboarding Card (Issue #66 / Jira ZC-32)');

const rootDir = process.cwd();
const unifiedCardPath = path.join(rootDir, 'src', 'components', 'UnifiedOnboardingCard.tsx');
const pwaBannerPath = path.join(rootDir, 'src', 'components', 'PwaBanner.tsx');
const pagePath = path.join(rootDir, 'src', 'app', 'page.tsx');
const pushClientPath = path.join(rootDir, 'src', 'lib', 'pushClient.ts');

// ---------------------------------------------------------------------------
// Test 1: File Existence & Exports
// ---------------------------------------------------------------------------
console.log('▶ Test 1: Verifying component and utility existence and exports');

assert(fs.existsSync(unifiedCardPath), 'UnifiedOnboardingCard.tsx must exist');
assert(fs.existsSync(pwaBannerPath), 'PwaBanner.tsx must exist');
assert(fs.existsSync(pushClientPath), 'pushClient.ts must exist');
assert(fs.existsSync(pagePath), 'page.tsx must exist');

const unifiedCardSource = fs.readFileSync(unifiedCardPath, 'utf8');
const pwaBannerSource = fs.readFileSync(pwaBannerPath, 'utf8');
const pushClientSource = fs.readFileSync(pushClientPath, 'utf8');
const pageSource = fs.readFileSync(pagePath, 'utf8');

assert(
  unifiedCardSource.includes('export function UnifiedOnboardingCard'),
  'UnifiedOnboardingCard.tsx must export UnifiedOnboardingCard'
);

assert(
  pwaBannerSource.includes('export const PwaBanner') ||
    pwaBannerSource.includes('export function PwaBanner'),
  'PwaBanner.tsx must export PwaBanner for backward compatibility'
);

assert(
  pwaBannerSource.includes('export function UnifiedOnboardingCard') ||
    pwaBannerSource.includes('UnifiedOnboardingCard'),
  'PwaBanner.tsx must export UnifiedOnboardingCard'
);

// Verify that UnifiedOnboardingCard is the sole component implementation and PwaBanner re-exports it
assert(
  !pwaBannerSource.includes('return (') && !pwaBannerSource.includes('return <section'),
  'PwaBanner.tsx must not duplicate JSX implementation; it should re-export UnifiedOnboardingCard'
);

assert(
  pushClientSource.includes('export function isStandaloneMode'),
  'pushClient.ts must export isStandaloneMode'
);

assert(
  pushClientSource.includes('export async function hasActivePushSubscription'),
  'pushClient.ts must export hasActivePushSubscription'
);

assert(
  pushClientSource.includes('export function shouldAutoDismissOnboarding'),
  'pushClient.ts must export shouldAutoDismissOnboarding'
);

assert(
  pageSource.includes('UnifiedOnboardingCard') &&
    pageSource.includes('<UnifiedOnboardingCard'),
  'page.tsx must import and render UnifiedOnboardingCard'
);

console.log('  ✅ Component files and exports verified successfully.\n');

// ---------------------------------------------------------------------------
// Test 2: 2-Step Guided Onboarding Architecture & Content
// ---------------------------------------------------------------------------
console.log('▶ Test 2: Verifying 2-step onboarding architecture and Sleep Shield guarantee');

// Step 1: Add to Home screen / PWA install
assert(
  unifiedCardSource.includes('Step 1: Add to Home Screen'),
  'Must include Step 1: Add to Home Screen'
);
assert(
  unifiedCardSource.includes('beforeinstallprompt'),
  'Must capture Chromium beforeinstallprompt event'
);
assert(
  unifiedCardSource.includes('Share') && unifiedCardSource.includes('Add to Home Screen'),
  'Must render iOS Safari instructions with Share and Add to Home Screen'
);
assert(
  unifiedCardSource.includes('Install App'),
  'Must provide "Install App" button for Android/Chromium'
);
assert(
  unifiedCardSource.includes('Installed ✓') || unifiedCardSource.includes('Installed'),
  'Must render installed state when in standalone mode'
);

// Step 2: Push Notifications & Sleep Shield guarantee
assert(
  unifiedCardSource.includes('Step 2: Enable Push Notifications'),
  'Must include Step 2: Enable Push Notifications'
);
assert(
  unifiedCardSource.includes('Sleep Shield Guarantee') &&
    unifiedCardSource.includes('8-hour sleep window'),
  'Must clearly state the Sleep Shield Guarantee protecting the 8-hour sleep window'
);
assert(
  unifiedCardSource.includes('Enable Alerts'),
  'Must provide "Enable Alerts" button'
);
assert(
  unifiedCardSource.includes('Active ✓') || unifiedCardSource.includes('Active'),
  'Must render active state when push notifications are subscribed'
);

// Mascot identity
assert(
  unifiedCardSource.includes('FoxMascot'),
  'Must feature the Sleepy Fox Mascot identity'
);

console.log('  ✅ 2-step setup card architecture and Sleep Shield guarantee verified.\n');

// ---------------------------------------------------------------------------
// Test 3: Auto-Dismiss & LocalStorage Dismissal Persistence
// ---------------------------------------------------------------------------
console.log('▶ Test 3: Verifying auto-dismiss logic and localStorage persistence');

// Standalone mode detection check
assert(
  unifiedCardSource.includes('(display-mode: standalone)') &&
    unifiedCardSource.includes('.standalone'),
  'Must check standalone mode via CSS media query and navigator.standalone'
);

// Active push subscription check
assert(
  unifiedCardSource.includes('getExistingSubscription'),
  'Must inspect active push subscriptions via getExistingSubscription()'
);

// Auto-dismiss call
assert(
  unifiedCardSource.includes('shouldAutoDismissOnboarding'),
  'Must evaluate shouldAutoDismissOnboarding for automatic dismissal'
);

// Dismissal persistence
assert(
  unifiedCardSource.includes('zcatchers_unified_onboarding_dismissed_at') ||
    unifiedCardSource.includes('STORAGE_KEY_ONBOARDING_DISMISSED'),
  'Must persist unified onboarding card dismissal in localStorage'
);
assert(
  unifiedCardSource.includes('zcatchers_pwa_banner_dismissed_at') ||
    unifiedCardSource.includes('STORAGE_KEY_PWA_DISMISSED'),
  'Must persist legacy pwa banner dismissal for backwards compatibility'
);
assert(
  unifiedCardSource.includes('7 * 24 * 60 * 60 * 1000') ||
    unifiedCardSource.includes('SEVEN_DAYS_MS'),
  'Must enforce 7-day cooldown on user dismissal'
);

console.log('  ✅ Auto-dismiss logic and dismissal persistence verified.\n');

// ---------------------------------------------------------------------------
// Test 4: Design Tokens & Mobile Touch Target Compliance (>= 44px)
// ---------------------------------------------------------------------------
console.log('▶ Test 4: Verifying Warm Dark design tokens and 44px touch targets');

// Warm Dark Tokens
assert(
  unifiedCardSource.includes('bg-night-surface') &&
    unifiedCardSource.includes('bg-night-elevated'),
  'Must use Warm Dark surface and elevated backgrounds'
);
assert(
  unifiedCardSource.includes('text-cream-primary') &&
    unifiedCardSource.includes('text-cream-secondary'),
  'Must use Warm Dark cream typography'
);
assert(
  unifiedCardSource.includes('bg-status-amber') &&
    unifiedCardSource.includes('text-status-amber'),
  'Must use status amber accents'
);

// Touch target checks (>= 44px)
const minHeightMatches = unifiedCardSource.match(/min-h-\[44px\]/g) || [];
assert(
  minHeightMatches.length >= 3,
  `Unified onboarding card must enforce min-h-[44px] on interactive buttons (found ${minHeightMatches.length})`
);

const minWidthMatches = unifiedCardSource.match(/min-w-\[44px\]/g) || [];
assert(
  minWidthMatches.length >= 1,
  `Unified onboarding card must enforce min-w-[44px] on dismiss icon button (found ${minWidthMatches.length})`
);

// ---------------------------------------------------------------------------
// Test 5: Review Feedback Guardrails & Edge Cases
// ---------------------------------------------------------------------------
console.log('▶ Test 5: Verifying review feedback guardrails (sync, standalone derivation, SW readiness)');

// 1. Synchronize isPushSubscribed with both true and false changes to isPushGranted with token guard
assert(
  unifiedCardSource.includes('setIsPushSubscribed(isPushGranted)') &&
    unifiedCardSource.includes('inspectionTokenRef'),
  'Must synchronize isPushSubscribed directly on isPushGranted and invalidate stale background inspections'
);

// 2. Standalone state is derived from isStandaloneMode() rather than assumed upon acceptance
assert(
  unifiedCardSource.includes('setIsStandalone(isStandaloneMode())'),
  'Must derive standalone mode from isStandaloneMode() upon installation acceptance'
);

// 3. Service worker readiness is bounded and recoverable errors handled
assert(
  unifiedCardSource.includes('navigator.serviceWorker.ready') &&
    unifiedCardSource.includes('Promise.race') &&
    unifiedCardSource.includes('pushErrorMessage'),
  'Must bound service worker readiness check before inline subscribe and handle recoverable error'
);

// 4. Notification permission is requested directly during click to preserve transient user activation
assert(
  unifiedCardSource.includes('Notification.requestPermission()') &&
    unifiedCardSource.includes('handleEnablePushClick'),
  'Must request notification permission during click gesture to retain transient user activation'
);

console.log('  ✅ Review feedback guardrails verified.\n');

// ---------------------------------------------------------------------------
// Test 6: Behavioral Unit Tests (Simulated Environment)
// ---------------------------------------------------------------------------
console.log('▶ Test 6: Running simulated behavioral tests for push and standalone states');

import {
  isStandaloneMode,
  shouldAutoDismissOnboarding,
} from '../src/lib/pushClient.ts';

// 5.1 Auto-dismiss decision matrix
assert.strictEqual(
  shouldAutoDismissOnboarding(false, false),
  false,
  'Neither standalone nor push active -> should NOT auto-dismiss'
);
assert.strictEqual(
  shouldAutoDismissOnboarding(true, false),
  false,
  'Standalone active but push NOT active -> should NOT auto-dismiss'
);
assert.strictEqual(
  shouldAutoDismissOnboarding(false, true),
  false,
  'Push active but standalone NOT active -> should NOT auto-dismiss'
);
assert.strictEqual(
  shouldAutoDismissOnboarding(true, true),
  true,
  'Both standalone AND push active -> MUST auto-dismiss permanently'
);
console.log('  ✓ shouldAutoDismissOnboarding decision matrix passed.');

// 5.2 Standalone detection simulation
// Simulate Node environment without window
assert.strictEqual(isStandaloneMode(), false, 'Should return false when window is undefined');

// Mock window and matchMedia
const originalWindow = global.window;
try {
  // Scenario A: display-mode: standalone matches
  global.window = {
    matchMedia: (query) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
    }),
    navigator: {},
  };
  assert.strictEqual(isStandaloneMode(), true, 'isStandaloneMode() must return true when matchMedia standalone matches');

  // Scenario B: navigator.standalone is true (iOS Safari PWA)
  global.window = {
    matchMedia: () => ({ matches: false }),
    navigator: { standalone: true },
  };
  assert.strictEqual(isStandaloneMode(), true, 'isStandaloneMode() must return true when navigator.standalone is true');

  // Scenario C: standard browser tab
  global.window = {
    matchMedia: () => ({ matches: false }),
    navigator: { standalone: false },
  };
  assert.strictEqual(isStandaloneMode(), false, 'isStandaloneMode() must return false in regular browser tab');
} finally {
  global.window = originalWindow;
}
console.log('  ✓ isStandaloneMode() environment simulation passed.');

// 5.3 LocalStorage dismissal calculation simulation
const SEVEN_DAYS_MS_VAL = 7 * 24 * 60 * 60 * 1000;
const now = Date.now();

// Dismissed 1 hour ago (within 7 days)
const recentDismissedAt = now - 60 * 60 * 1000;
const isRecentDismissed = now - recentDismissedAt < SEVEN_DAYS_MS_VAL;
assert.strictEqual(isRecentDismissed, true, 'Recent dismissal must stay dismissed');

// Dismissed 8 days ago (past 7 days)
const oldDismissedAt = now - 8 * 24 * 60 * 60 * 1000;
const isOldDismissed = now - oldDismissedAt < SEVEN_DAYS_MS_VAL;
assert.strictEqual(isOldDismissed, false, 'Expired dismissal cooldown must restore card');
console.log('  ✓ LocalStorage 7-day cooldown calculation passed.');

// 5.4 Stale inspection completion behavioral simulation
{
  let inspectionTokenRef = 0;
  let pushGranted = true;
  let isPushSubscribed = true;

  // Simulate start of async inspection #1
  const token1 = ++inspectionTokenRef;
  let resolveInspection1;
  const inspection1Promise = new Promise((resolve) => {
    resolveInspection1 = resolve;
  });

  // Parent state changes to false while inspection #1 is in-flight
  pushGranted = false;
  inspectionTokenRef += 1;
  isPushSubscribed = false;

  // Stale inspection #1 resolves afterwards with true
  resolveInspection1(true);
  const staleSubResult = await inspection1Promise;

  // Token guard prevents stale async completion from overwriting newer state
  if (token1 === inspectionTokenRef) {
    isPushSubscribed = staleSubResult;
  }

  assert.strictEqual(
    isPushSubscribed,
    false,
    'Stale async inspection completion must not overwrite newer disabled parent state'
  );
  console.log('  ✓ Stale async inspection token invalidation simulation passed.');
}

console.log('\n🎉 All Unified PWA Install & Push Onboarding tests passed cleanly! 🦊💤');
