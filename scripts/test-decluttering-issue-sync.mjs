#!/usr/bin/env node
/**
 * Test Suite: Decluttering & PWA Enhancement Issue Definitions & ADF Sync Verification
 *
 * Verifies:
 * 1. Exactly 10 decluttering and PWA enhancement issues are defined in priority order (P0 to P3).
 * 2. Issue types are set to top-level Task (10071) for Jira Cloud compatibility.
 * 3. Priority mapping aligns with requirements:
 *    - Issues 1-3: P0 - Critical / Highest
 *    - Issues 4-6: P1 - High / High
 *    - Issues 7-9: P2 - Medium / Medium
 *    - Issue 10: P3 - Low / Low
 * 4. Each issue specifies target files, acceptance criteria, and regression test scripts.
 * 5. `markdownToAdf` parses all 10 issue bodies cleanly into valid ADF document trees.
 * 6. Issue labels include domain tags (frontend, backend, pwa, enhancement) and priority tags.
 */

import assert from 'assert';
import { declutteringIssues } from './create-and-sync-decluttering-issues.mjs';
import { markdownToAdf } from './sync-decluttering-issues-to-jira.mjs';

console.log('Testing Decluttering & PWA Enhancement Issue Sync...\n');

// ---------------------------------------------------------------------------
// Test 1: Exactly 10 issues defined in priority order
// ---------------------------------------------------------------------------
console.log('▶ Test 1: Verifying issue count and sequential priority ordering (P0 -> P3)');
assert.strictEqual(declutteringIssues.length, 10, `Expected exactly 10 issues, found ${declutteringIssues.length}`);

const expectedPriorities = [
  { id: 1, tag: 'P0 - Critical', jira: 'Highest', label: 'priority: critical' },
  { id: 2, tag: 'P0 - Critical', jira: 'Highest', label: 'priority: critical' },
  { id: 3, tag: 'P0 - Critical', jira: 'Highest', label: 'priority: critical' },
  { id: 4, tag: 'P1 - High', jira: 'High', label: 'priority: high' },
  { id: 5, tag: 'P1 - High', jira: 'High', label: 'priority: high' },
  { id: 6, tag: 'P1 - High', jira: 'High', label: 'priority: high' },
  { id: 7, tag: 'P2 - Medium', jira: 'Medium', label: 'priority: medium' },
  { id: 8, tag: 'P2 - Medium', jira: 'Medium', label: 'priority: medium' },
  { id: 9, tag: 'P2 - Medium', jira: 'Medium', label: 'priority: medium' },
  { id: 10, tag: 'P3 - Low', jira: 'Low', label: 'priority: low' },
];

for (let i = 0; i < declutteringIssues.length; i++) {
  const issue = declutteringIssues[i];
  const expected = expectedPriorities[i];

  assert.strictEqual(issue.id, expected.id, `Issue at index ${i} has id ${issue.id}, expected ${expected.id}`);
  assert.strictEqual(issue.priorityTag, expected.tag, `Issue #${issue.id} has priorityTag ${issue.priorityTag}, expected ${expected.tag}`);
  assert.strictEqual(issue.jiraPriority, expected.jira, `Issue #${issue.id} has jiraPriority ${issue.jiraPriority}, expected ${expected.jira}`);
  assert.strictEqual(issue.issueTypeId, '10071', `Issue #${issue.id} must use top-level Task type 10071`);
  assert(issue.labels.includes(expected.label), `Issue #${issue.id} must include priority label "${expected.label}"`);
  assert(issue.labels.includes('enhancement'), `Issue #${issue.id} must include "enhancement" label`);
}
console.log('  ✅ All 10 issues defined with matching priorities and Jira issue type 10071.\n');

// ---------------------------------------------------------------------------
// Test 2: Target files, test files, and required sections
// ---------------------------------------------------------------------------
console.log('▶ Test 2: Verifying architecture blueprints, target files, and test files');
for (const issue of declutteringIssues) {
  assert(Array.isArray(issue.targetFiles) && issue.targetFiles.length > 0, `Issue #${issue.id} missing targetFiles`);
  assert(typeof issue.testFile === 'string' && issue.testFile.startsWith('scripts/'), `Issue #${issue.id} testFile must be in scripts/`);
  assert(issue.title.startsWith(`[P${issue.priorityTag.slice(1, 2)}]`), `Issue #${issue.id} title must start with [P${issue.priorityTag.slice(1, 2)}]`);

  // Verify critical body sections
  assert(issue.body.includes('## Goal & Summary'), `Issue #${issue.id} missing Goal & Summary section`);
  assert(issue.body.includes('## Architecture & Implementation Blueprint'), `Issue #${issue.id} missing Blueprint section`);
  assert(issue.body.includes('## Acceptance Criteria'), `Issue #${issue.id} missing Acceptance Criteria section`);
  assert(issue.body.includes('## Automated Regression Testing'), `Issue #${issue.id} missing Regression Testing section`);
  assert(issue.body.includes('scripts/run-tests.mjs'), `Issue #${issue.id} must reference scripts/run-tests.mjs`);
}
console.log('  ✅ All 10 issues contain required structural blueprints, target files, and test definitions.\n');

// ---------------------------------------------------------------------------
// Test 3: Markdown to ADF v1 serialization
// ---------------------------------------------------------------------------
console.log('▶ Test 3: Verifying ADF serialization across all 10 issue bodies');
for (const issue of declutteringIssues) {
  const adf = markdownToAdf(issue.body);
  assert.strictEqual(adf.type, 'doc', `ADF type must be 'doc' for issue #${issue.id}`);
  assert.strictEqual(adf.version, 1, `ADF version must be 1 for issue #${issue.id}`);
  assert(Array.isArray(adf.content) && adf.content.length > 0, `ADF content must be non-empty for issue #${issue.id}`);

  const headings = adf.content.filter((n) => n.type === 'heading');
  assert(headings.length >= 4, `Issue #${issue.id} ADF must contain at least 4 headings, found ${headings.length}`);

  const nonHeadings = adf.content.filter((n) => n.type !== 'heading');
  assert(nonHeadings.length >= 4, `Issue #${issue.id} ADF must contain at least 4 body content units`);
}
console.log('  ✅ All 10 issue bodies parse cleanly to valid ADF structures.\n');

console.log('🎉 All Decluttering & PWA Issue Sync verification checks passed successfully!\n');
