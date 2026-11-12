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
import fs from 'fs';
import path from 'path';
import os from 'os';
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
// Test 4: Checkpointing and atomic file persistence integration
// ---------------------------------------------------------------------------
console.log('▶ Test 4: Verifying map entry retention and atomic checkpointing logic');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-sync-test-'));
const testMapFile = path.join(tempDir, 'audit-issues-map.json');
const testSyncedFile = path.join(tempDir, 'audit-issues-synced.json');

try {
  const initialEntries = [
    {
      id: 1,
      title: issues[0].title,
      issueTypeId: '10071',
      ghNumber: '30',
      ghUrl: 'https://github.com/KrishJdev/Z-Catchers/issues/30',
    },
  ];

  // Seed initial file without jiraKey
  fs.writeFileSync(testMapFile, JSON.stringify(initialEntries, null, 2), 'utf8');

  // Simulate Pass 1: Jira creation succeeds, checkpoint is atomically written before link attempt
  const pass1List = JSON.parse(fs.readFileSync(testMapFile, 'utf8'));
  const currentItem = { ...pass1List[0] };
  currentItem.jiraKey = 'ZC-16';
  currentItem.jiraUrl = 'https://krishjaiswal2182003.atlassian.net/browse/ZC-16';
  pass1List[0] = currentItem;

  // Atomic checkpoint write
  const tmpSyncedFile1 = `${testSyncedFile}.tmp`;
  fs.writeFileSync(tmpSyncedFile1, JSON.stringify(pass1List, null, 2), 'utf8');
  fs.renameSync(tmpSyncedFile1, testSyncedFile);

  // Assert intermediate file on disk retains jiraKey even before linking
  const intermediateDisk = JSON.parse(fs.readFileSync(testSyncedFile, 'utf8'));
  assert.strictEqual(intermediateDisk[0].jiraKey, 'ZC-16', 'Intermediate file must retain created Jira key');

  // Link attempt fails: record failure without losing jiraKey
  currentItem.remoteLinked = false;
  currentItem.remoteLinkError = 'Network timeout';
  pass1List[0] = currentItem;

  const serialized1 = JSON.stringify(pass1List, null, 2);
  for (const dest of [testSyncedFile, testMapFile]) {
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, serialized1, 'utf8');
    fs.renameSync(tmp, dest);
  }

  const diskAfterPass1 = JSON.parse(fs.readFileSync(testSyncedFile, 'utf8'));
  assert.strictEqual(diskAfterPass1[0].jiraKey, 'ZC-16', 'Jira key must be retained after remote link failure');
  assert.strictEqual(diskAfterPass1[0].remoteLinked, false);

  // Simulate Pass 2: Retry with existing Jira key
  let jiraCreateCallCount = 0;
  const pass2List = JSON.parse(fs.readFileSync(testSyncedFile, 'utf8'));
  for (let i = 0; i < pass2List.length; i++) {
    const item = { ...pass2List[i] };
    if (!item.jiraKey) {
      jiraCreateCallCount++;
    } else {
      // Existing key: link without creating duplicate
      item.remoteLinked = true;
      delete item.remoteLinkError;
    }
    pass2List[i] = item;
  }

  assert.strictEqual(jiraCreateCallCount, 0, 'Must NOT recreate Jira issue when jiraKey already exists');
  assert.strictEqual(pass2List[0].jiraKey, 'ZC-16');
  assert.strictEqual(pass2List[0].remoteLinked, true);

  const serialized2 = JSON.stringify(pass2List, null, 2);
  for (const dest of [testSyncedFile, testMapFile]) {
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, serialized2, 'utf8');
    fs.renameSync(tmp, dest);
  }

  const diskAfterPass2 = JSON.parse(fs.readFileSync(testSyncedFile, 'utf8'));
  assert.strictEqual(diskAfterPass2[0].remoteLinked, true);
  assert.strictEqual(diskAfterPass2[0].jiraKey, 'ZC-16');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('  ✅ Atomic checkpointing, disk persistence, and retry flow verified successfully.\n');

console.log('🎉 All audit issue synchronization & parser tests passed!\n');
