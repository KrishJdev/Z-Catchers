#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
const mode = args.includes('--all') ? 'all' : 'unit';

// Unit tests: offline/standalone verification suites that do not require live external services
const UNIT_TESTS = [
  'test-audit-issue-sync.mjs',
  'test-demo-seed-fingerprint.mjs',
  'test-discord-webhook-and-assists.mjs',
  'test-gmt-timezones.mjs',
  'test-in-bed-and-streaks.mjs',
  'test-login-and-auth.mjs',
  'test-logout-flow.mjs',
  'test-nag-notifications.mjs',
  'test-phase1-pwa-push.mjs',
  'test-phase1-security.mjs',
  'test-phase2-mobile-touch-ux.mjs',
  'test-phase35-pwa-phone-robustness.mjs',
  'test-pin-rate-limiting.mjs',
  'test-profile-and-schedule-tab.mjs',
  'test-push-and-cron.mjs',
  'test-schedule-cooldown.mjs',
  'test-signup-and-profiles.mjs',
  'test-strikes-system.mjs',
  'test-wake-up-and-overflow.mjs',
  'test-weekend-hours.mjs',
];

// E2E tests: require live Supabase database or running network services
const E2E_TESTS = [
  'test-e2e-api-endpoints.mjs',
];

const testFiles = mode === 'all' ? [...UNIT_TESTS, ...E2E_TESTS] : UNIT_TESTS;

console.log(`\n🦊 Z-Catchers Unified Test Runner [Mode: ${mode.toUpperCase()}]`);
console.log(`Running ${testFiles.length} test suites...\n${'='.repeat(60)}`);

let passedCount = 0;
let failedCount = 0;
const failures = [];

const startTime = Date.now();

for (const file of testFiles) {
  const filePath = path.resolve('scripts', file);
  if (!fs.existsSync(filePath)) {
    console.error(`⚠️ Test file not found: scripts/${file}`);
    failedCount++;
    failures.push({ file, error: 'File not found' });
    continue;
  }

  process.stdout.write(`▶ Running scripts/${file} ... `);
  const childArgs = [];
  const hasTsLoader = process.execArgv.some((arg) => arg.includes('tsx') || arg.includes('strip-types'));
  if (hasTsLoader) {
    childArgs.push(...process.execArgv);
  } else {
    childArgs.push('--import', 'tsx');
  }
  childArgs.push(filePath);

  const result = spawnSync(process.execPath, childArgs, {
    stdio: 'pipe',
    env: { ...process.env, RUNNER_MODE: mode },
    encoding: 'utf8',
  });

  if (result.status === 0) {
    console.log(`✅ PASSED`);
    passedCount++;
  } else {
    console.log(`❌ FAILED (Exit Code ${result.status})`);
    failedCount++;
    failures.push({
      file,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
}

const duration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log(`\n${'='.repeat(60)}`);
console.log(`Test Execution Summary (${duration}s):`);
console.log(`  Total Suites:  ${testFiles.length}`);
console.log(`  Passed:        ${passedCount}`);
console.log(`  Failed:        ${failedCount}`);

if (failures.length > 0) {
  console.log(`\n❌ Failed Test Suites:`);
  for (const f of failures) {
    console.log(`\n--- Output from scripts/${f.file} ---`);
    if (f.stdout) console.log(f.stdout);
    if (f.stderr) console.error(f.stderr);
  }
  process.exit(1);
} else {
  console.log(`\n🎉 All ${passedCount} test suites passed cleanly! 🦊💤\n`);
  process.exit(0);
}
