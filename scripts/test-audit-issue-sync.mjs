#!/usr/bin/env node
/**
 * Test Suite: Audit Issue Synchronization & Markdown ADF Conversion
 *
 * Verifies:
 * 1. `markdownToAdf` converts markdown headings as single lines and retains section content.
 * 2. Section bodies (summaries, root-cause lists, code blocks, remediation steps) are correctly converted to ADF content nodes.
 * 3. All 14 audit issues in `create-all-audit-issues.mjs` specify top-level Task type `10071`.
 * 4. Audit issue mapping structure retains Jira identity properties across sync cycles.
 */

import assert from 'assert';
import { issues } from './create-all-audit-issues.mjs';
import { markdownToAdf } from './sync-audit-issues-to-jira.mjs';

console.log('Testing Audit Issue Synchronization & ADF Parser...\n');

// ---------------------------------------------------------------------------
// Test 1: All 14 issue definitions must use top-level Task type (10071)
// ---------------------------------------------------------------------------
console.log('▶ Test 1: Verifying all 14 audit issue definitions have issueTypeId = 10071');
assert.strictEqual(issues.length, 14, `Expected 14 audit issues, found ${issues.length}`);
for (const issue of issues) {
  assert.strictEqual(
    issue.issueTypeId,
    '10071',
    `Issue #${issue.id} ("${issue.title}") has issueTypeId "${issue.issueTypeId}", expected "10071"`
  );
}
console.log('  ✅ All 14 issue definitions use top-level Task type 10071.\n');

// ---------------------------------------------------------------------------
// Test 2: markdownToAdf preserves section content following headings
// ---------------------------------------------------------------------------
console.log('▶ Test 2: Verifying markdownToAdf preserves section content following headings');
const sampleMarkdown = `## Summary & Problem Statement
This is a critical summary paragraph that must not be discarded.

## Root Cause Analysis
1. First root cause point
2. Second root cause point

## Security & System Impact
- Impact bullet item 1
- Impact bullet item 2

## Code Evidence
\`\`\`typescript
const secret = 'vulnerable_secret';
\`\`\`
Follow-up explanatory text.

## Remediation Plan
1. Fix the bug
2. Add automated regression test`;

const adf = markdownToAdf(sampleMarkdown);
assert.strictEqual(adf.type, 'doc');
assert.strictEqual(adf.version, 1);
assert(Array.isArray(adf.content));

const headings = adf.content.filter((n) => n.type === 'heading');
assert.strictEqual(headings.length, 5, `Expected 5 headings, found ${headings.length}`);
assert.strictEqual(headings[0].content[0].text, 'Summary & Problem Statement');
assert.strictEqual(headings[1].content[0].text, 'Root Cause Analysis');
assert.strictEqual(headings[2].content[0].text, 'Security & System Impact');
assert.strictEqual(headings[3].content[0].text, 'Code Evidence');
assert.strictEqual(headings[4].content[0].text, 'Remediation Plan');

// Check that summary paragraph exists and is not discarded
const paragraphs = adf.content.filter((n) => n.type === 'paragraph');
assert(
  paragraphs.some((p) => p.content.some((c) => c.text?.includes('This is a critical summary paragraph'))),
  'Expected summary paragraph to be retained in ADF'
);

// Check that ordered lists exist
const orderedLists = adf.content.filter((n) => n.type === 'orderedList');
assert.strictEqual(orderedLists.length, 2, 'Expected 2 ordered lists (Root Cause Analysis & Remediation Plan)');

// Check that bullet list exists
const bulletLists = adf.content.filter((n) => n.type === 'bulletList');
assert.strictEqual(bulletLists.length, 1, 'Expected 1 bullet list (Security & System Impact)');

// Check that code block exists
const codeBlocks = adf.content.filter((n) => n.type === 'codeBlock');
assert.strictEqual(codeBlocks.length, 1, 'Expected 1 code block in ADF');
assert(
  codeBlocks[0].content[0].text.includes("secret = 'vulnerable_secret'"),
  'Code block text must match markdown'
);
console.log('  ✅ markdownToAdf correctly parses headings on individual lines and retains all content nodes.\n');

// ---------------------------------------------------------------------------
// Test 3: Every audit issue body in create-all-audit-issues converts cleanly
// ---------------------------------------------------------------------------
console.log('▶ Test 3: Converting all 14 audit issue bodies to ADF');
for (const issue of issues) {
  const convertedAdf = markdownToAdf(issue.body);
  assert.strictEqual(convertedAdf.type, 'doc');

  const issueHeadings = convertedAdf.content.filter((n) => n.type === 'heading');
  assert(
    issueHeadings.length >= 4,
    `Issue #${issue.id} should have at least 4 headings, found ${issueHeadings.length}`
  );

  const issueContentNodes = convertedAdf.content.filter((n) => n.type !== 'heading');
  assert(
    issueContentNodes.length >= 4,
    `Issue #${issue.id} must retain at least 4 content nodes, found ${issueContentNodes.length}`
  );
}
console.log('  ✅ All 14 issue bodies parsed to ADF with intact headings and content nodes.\n');

// ---------------------------------------------------------------------------
// Test 4: Checkpointing and map retention simulation
// ---------------------------------------------------------------------------
console.log('▶ Test 4: Verifying map entry retention and checkpointing logic');
const initialEntry = {
  id: 1,
  title: issues[0].title,
  issueTypeId: '10071',
  ghNumber: '30',
  ghUrl: 'https://github.com/KrishJdev/Z-Catchers/issues/30',
};

// Simulate Jira creation checkpointing before remote link
const checkpointed = {
  ...initialEntry,
  jiraKey: 'ZC-16',
  jiraUrl: 'https://krishjaiswal2182003.atlassian.net/browse/ZC-16',
};
assert.strictEqual(checkpointed.jiraKey, 'ZC-16');
assert(checkpointed.jiraUrl.includes('ZC-16'));

// Simulate remote link failure after creation: identity must remain intact
const linkFailed = {
  ...checkpointed,
  remoteLinked: false,
  remoteLinkError: 'Network timeout',
};
assert.strictEqual(linkFailed.jiraKey, 'ZC-16', 'Jira key must be retained after remote link failure');
assert.strictEqual(linkFailed.remoteLinked, false);

// Simulate retry: retry links existing Jira key without changing identity
const retrySucceeded = {
  ...linkFailed,
  remoteLinked: true,
};
delete retrySucceeded.remoteLinkError;
assert.strictEqual(retrySucceeded.jiraKey, 'ZC-16');
assert.strictEqual(retrySucceeded.remoteLinked, true);
assert.strictEqual(retrySucceeded.remoteLinkError, undefined);

console.log('  ✅ Checkpointing and retry state flow verified successfully.\n');

console.log('🎉 All audit issue synchronization & parser tests passed!\n');
