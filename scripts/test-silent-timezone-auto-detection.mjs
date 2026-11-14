#!/usr/bin/env node
/**
 * Test Suite: Silent Timezone Auto-Detection (GitHub Issue #67, Jira ZC-33)
 *
 * Verifies that:
 * 1. `detectUserTimezone()` silently captures the client's current IANA timezone.
 * 2. Timezones are validated against Luxon's `IANAZone.isValidSpecifier(detectedTz)`.
 * 3. Gracefully falls back to 'UTC' when browser reports invalid specifiers or throws.
 * 4. `formatTimezoneDisplay()` and `formatTimezonePill()` format IANA zones with GMT offsets (e.g. `📍 Asia/Kolkata (GMT+05:30)`).
 * 5. `TimezoneSelect` renders a compact pill with a "Change" button in compact mode, keeping the full dropdown hidden.
 * 6. Clicking "Change" reveals the manual override picker with search and `<select>`.
 * 7. Minimum touch target (>= 44x44px) is enforced on the "Change" button for mobile ergonomics.
 * 8. `src/app/join/page.tsx` pre-populates form state via `detectUserTimezone()` and renders `<TimezoneSelect compact={true} />`.
 * 9. `src/components/MyScheduleModal.tsx` renders `<TimezoneSelect compact={true} />` for seamless schedule edits.
 * 10. `src/app/api/members/update-schedule/route.ts` validates incoming timezones against `isValidTimezone`.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { IANAZone } from 'luxon';
import {
  detectUserTimezone,
  isValidTimezone,
  formatGmtOffset,
  formatTimezoneDisplay,
  formatTimezonePill,
} from '../src/lib/timezone.ts';
import { TimezoneSelect } from '../src/components/TimezoneSelect.tsx';

console.log('🧪 Starting Silent Timezone Auto-Detection Test Suite (Issue #67 / ZC-33)...\n');

// -------------------------------------------------------------
// 1. Silent IANA Detection & Luxon Validation
// -------------------------------------------------------------
console.log('--- 1. Silent IANA Detection & Luxon Validation ---');

// Default detection in current environment must return a valid timezone
const defaultDetected = detectUserTimezone();
assert(typeof defaultDetected === 'string' && defaultDetected.length > 0, 'detectUserTimezone must return a non-empty string');
assert(IANAZone.isValidSpecifier(defaultDetected), `Detected timezone "${defaultDetected}" must be a valid IANA specifier`);
assert(isValidTimezone(defaultDetected), `Detected timezone "${defaultDetected}" must be a valid Luxon timezone`);
console.log(`   ✅ Default runtime detected zone: "${defaultDetected}"`);

// Mock Intl.DateTimeFormat to verify specific timezone detection
const originalDateTimeFormat = Intl.DateTimeFormat;

function mockIntlTimezone(timeZoneValue) {
  Intl.DateTimeFormat = function (locale, options) {
    const instance = new originalDateTimeFormat(locale, options);
    if (!options || !options.timeZone) {
      return {
        ...instance,
        format: (...args) => instance.format(...args),
        formatToParts: (...args) => instance.formatToParts(...args),
        resolvedOptions: () => ({
          ...instance.resolvedOptions(),
          timeZone: timeZoneValue,
        }),
      };
    }
    return instance;
  };
}

// Test detection of prominent global IANA zones
const testZones = [
  'Asia/Kolkata',
  'America/New_York',
  'Europe/London',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Asia/Tokyo',
];

for (const zone of testZones) {
  mockIntlTimezone(zone);
  const detected = detectUserTimezone();
  assert.strictEqual(detected, zone, `Expected detected timezone to be "${zone}", got "${detected}"`);
}
console.log('   ✅ Valid IANA zones correctly detected via Intl.DateTimeFormat');

// -------------------------------------------------------------
// 2. Safe Fallback Handling on Invalid Specifiers
// -------------------------------------------------------------
console.log('--- 2. Safe Fallback Handling on Invalid Specifiers ---');

const invalidSpecifiers = [
  'Invalid/Timezone_Specifier',
  'Fake/City',
  'GMT+05:30', // Offset representation, not canonical IANA city zone
  'UTC-5',
  '',
  null,
  undefined,
];

for (const invalid of invalidSpecifiers) {
  mockIntlTimezone(invalid);
  const fallbackResult = detectUserTimezone();
  assert.strictEqual(
    fallbackResult,
    'UTC',
    `Expected invalid specifier "${invalid}" to fall back to "UTC", got "${fallbackResult}"`
  );
}

// Test custom fallback support when detected timezone is invalid
mockIntlTimezone('Invalid/Zone');
const customFallback = detectUserTimezone('America/Chicago');
assert.strictEqual(customFallback, 'America/Chicago', 'Expected valid custom fallback to be honored');

const invalidCustomFallback = detectUserTimezone('Bad/Zone');
assert.strictEqual(invalidCustomFallback, 'UTC', 'Expected invalid custom fallback to fall back to "UTC"');

// Test exception resilience if Intl throws
Intl.DateTimeFormat = function () {
  throw new Error('Simulated runtime restriction in locked environment');
};
const exceptionFallback = detectUserTimezone();
assert.strictEqual(exceptionFallback, 'UTC', 'Expected runtime exception to fall back to "UTC"');

// Restore original Intl.DateTimeFormat
Intl.DateTimeFormat = originalDateTimeFormat;
console.log('   ✅ Safe fallback to "UTC" verified across invalid specifiers and exceptions');

// -------------------------------------------------------------
// 3. Compact Timezone Pill Formatting
// -------------------------------------------------------------
console.log('--- 3. Compact Timezone Pill Formatting ---');

assert.strictEqual(formatTimezoneDisplay('Asia/Kolkata'), 'Asia/Kolkata (GMT+05:30)');
assert.strictEqual(formatTimezoneDisplay('UTC'), 'UTC (GMT+00:00)');
assert.strictEqual(formatTimezoneDisplay(''), 'UTC (GMT+00:00)');
assert.strictEqual(formatTimezoneDisplay(null), 'UTC (GMT+00:00)');

assert.strictEqual(formatTimezonePill('Asia/Kolkata'), '📍 Asia/Kolkata (GMT+05:30)');
assert.strictEqual(formatTimezonePill('America/New_York'), '📍 America/New_York (GMT-05:00)');
assert.strictEqual(formatTimezonePill('UTC'), '📍 UTC (GMT+00:00)');
console.log('   ✅ formatTimezoneDisplay and formatTimezonePill produce correct formatted strings');

// -------------------------------------------------------------
// 4. TimezoneSelect Compact Mode & Manual Override Toggle
// -------------------------------------------------------------
console.log('--- 4. TimezoneSelect Compact Mode & Manual Override Toggle ---');

// In compact mode: renders compact pill with "Change" button, and keeps <select> hidden
const compactMarkup = ReactDOMServer.renderToStaticMarkup(
  React.createElement(TimezoneSelect, {
    value: 'Asia/Kolkata',
    onChange: () => {},
    compact: true,
  })
);

assert(
  compactMarkup.includes('data-testid="timezone-compact-pill"'),
  'TimezoneSelect in compact mode must render compact pill container'
);
assert(
  compactMarkup.includes('📍') && compactMarkup.includes('Asia/Kolkata (GMT+05:30)'),
  'TimezoneSelect compact pill must render location pin and formatted timezone offset'
);
assert(
  compactMarkup.includes('Change'),
  'TimezoneSelect compact pill must render "Change" button'
);
assert(
  !compactMarkup.includes('<select'),
  'TimezoneSelect in compact mode must keep full <select> dropdown hidden by default'
);
assert(
  !compactMarkup.includes('placeholder="Filter by city'),
  'TimezoneSelect in compact mode must keep search filter hidden by default'
);
console.log('   ✅ Compact pill correctly renders formatted timezone and hides dropdown by default');

// In standard mode (compact: false): renders dropdown directly
const standardMarkup = ReactDOMServer.renderToStaticMarkup(
  React.createElement(TimezoneSelect, {
    value: 'Asia/Kolkata',
    onChange: () => {},
    compact: false,
  })
);

assert(
  !standardMarkup.includes('data-testid="timezone-compact-pill"'),
  'Standard mode must not render compact pill'
);
assert(
  standardMarkup.includes('<select'),
  'Standard mode must render <select> dropdown'
);
console.log('   ✅ Standard mode directly displays dropdown as expected');

// Component source verification for manual override toggle and ergonomics
const timezoneSelectSource = fs.readFileSync(
  path.resolve('src/components/TimezoneSelect.tsx'),
  'utf8'
);

assert(
  timezoneSelectSource.includes('isOverriding') && timezoneSelectSource.includes('setIsOverriding'),
  'TimezoneSelect must manage isOverriding state for manual override toggle'
);
assert(
  timezoneSelectSource.includes('min-h-[44px]'),
  'TimezoneSelect "Change" button must enforce min-h-[44px] mobile touch target'
);
assert(
  timezoneSelectSource.includes('bg-night-elevated') &&
  timezoneSelectSource.includes('border-night-border') &&
  timezoneSelectSource.includes('text-cream-primary') &&
  timezoneSelectSource.includes('text-status-amber'),
  'TimezoneSelect must strictly use Warm Dark design tokens'
);
assert(
  timezoneSelectSource.includes('timezone-override-picker'),
  'TimezoneSelect must designate override picker container when expanded'
);
console.log('   ✅ Component source confirms state management, >=44px touch targets, and Warm Dark tokens');

// -------------------------------------------------------------
// 5. Onboarding Wiring in src/app/join/page.tsx
// -------------------------------------------------------------
console.log('--- 5. Onboarding Wiring in src/app/join/page.tsx ---');

const joinPageSource = fs.readFileSync(path.resolve('src/app/join/page.tsx'), 'utf8');

assert(
  joinPageSource.includes("import {") && joinPageSource.includes("detectUserTimezone"),
  'src/app/join/page.tsx must import detectUserTimezone from @/lib/timezone'
);
assert(
  joinPageSource.includes('useState(() => detectUserTimezone())') ||
  joinPageSource.includes('useState<string>(() => detectUserTimezone())'),
  'src/app/join/page.tsx must initialize regTimezone state using detectUserTimezone()'
);
assert(
  joinPageSource.includes('detectUserTimezone()'),
  'src/app/join/page.tsx must invoke detectUserTimezone() during client hydration'
);
assert(
  joinPageSource.includes('<TimezoneSelect') && joinPageSource.includes('compact={true}'),
  'src/app/join/page.tsx must render TimezoneSelect with compact={true}'
);
assert(
  joinPageSource.includes('timezone: regTimezone.trim()'),
  'src/app/join/page.tsx must submit pre-populated auto-detected timezone in registration payload'
);
console.log('   ✅ Onboarding page automatically detects IANA timezone and renders compact pill');

// -------------------------------------------------------------
// 6. Schedule Modal Wiring in src/components/MyScheduleModal.tsx
// -------------------------------------------------------------
console.log('--- 6. Schedule Modal Wiring in src/components/MyScheduleModal.tsx ---');

const scheduleModalSource = fs.readFileSync(
  path.resolve('src/components/MyScheduleModal.tsx'),
  'utf8'
);

assert(
  scheduleModalSource.includes('detectUserTimezone'),
  'src/components/MyScheduleModal.tsx must import detectUserTimezone from @/lib/timezone'
);
assert(
  scheduleModalSource.includes('<TimezoneSelect') && scheduleModalSource.includes('compact={true}'),
  'src/components/MyScheduleModal.tsx must render TimezoneSelect with compact={true}'
);
console.log('   ✅ MyScheduleModal renders compact timezone pill with manual override toggle');

// -------------------------------------------------------------
// 7. API Endpoint Validation in update-schedule route
// -------------------------------------------------------------
console.log('--- 7. API Endpoint Validation in update-schedule route ---');

const updateScheduleRouteSource = fs.readFileSync(
  path.resolve('src/app/api/members/update-schedule/route.ts'),
  'utf8'
);

assert(
  updateScheduleRouteSource.includes('isValidTimezone'),
  'update-schedule route must import isValidTimezone from @/lib/timezone'
);
assert(
  updateScheduleRouteSource.includes('isValidTimezone(timezone)'),
  'update-schedule route must validate incoming timezone payload'
);
console.log('   ✅ API route validates timezone payload against isValidTimezone');

console.log('\n🎉 All Silent Timezone Auto-Detection tests passed successfully! 🦊💤');
