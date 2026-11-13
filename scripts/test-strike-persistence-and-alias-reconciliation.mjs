import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';

// Auto-load .env.local if present
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // Ignore missing .env.local
}

import {
  resolveMemberStrikeCounts,
  updateMemberStrikeCounts,
  getMonthlyStrikeCountsBatch,
  saveNightlyStrikeLog,
  deleteNightlyStrikeLog,
  clearInMemoryStrikeStore,
} from '../src/lib/strikes.ts';
import { checkMonthlyStrikeReset, getCurrentStrikeMonth } from '../src/lib/sleepEngine.ts';
import {
  setInMemoryMember,
  getInMemoryMember,
  clearInMemoryMembers,
} from '../src/lib/db.ts';

console.log('🧪 Starting Strike Persistence, Alias Reconciliation & Log Ground-Truth Verification...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function run() {
  clearInMemoryStrikeStore();
  clearInMemoryMembers();

  const baseMember = {
    id: 'test-persist-member-1',
    discord_username: 'PersistFox',
    discord_handle: '@persistfox',
    avatar_url: null,
    journal_url: 'https://discord.com/channels/123456789/987654321',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    timezone: 'UTC',
    role: 'member',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log('--- 1. Alias Asymmetry Safety (0 in one alias must never clobber active count) ---');
  // Scenario 1A: strikes_used is 1, strikes_count is 0 (e.g. unmigrated default column in DB)
  const memberWithStrikesUsedOnly = {
    ...baseMember,
    id: 'mem-asym-1',
    strikes_used: 1,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: '2026-11',
  };
  const res1A = await resolveMemberStrikeCounts(memberWithStrikesUsedOnly, DateTime.fromISO('2026-11-14T02:00:00Z'));
  assert(res1A.strikes_used === 1, 'strikes_used=1 is preserved despite strikes_count=0');
  assert(res1A.reset === false, 'Did not trigger false reset');

  // Scenario 1B: strikes_used is 0, strikes_count is 2
  const memberWithStrikesCountOnly = {
    ...baseMember,
    id: 'mem-asym-2',
    strikes_used: 0,
    strikes_count: 2,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: '2026-11',
  };
  const res1B = await resolveMemberStrikeCounts(memberWithStrikesCountOnly, DateTime.fromISO('2026-11-14T02:00:00Z'));
  assert(res1B.strikes_used === 2, 'strikes_count=2 is preserved despite strikes_used=0');

  // Scenario 1C: metastrikes_used is 2, metastrikes_count is 0
  const memberWithMetaUsedOnly = {
    ...baseMember,
    id: 'mem-asym-3',
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 2,
    metastrikes_count: 0,
    strike_cycle_month: '2026-11',
  };
  const res1C = await resolveMemberStrikeCounts(memberWithMetaUsedOnly, DateTime.fromISO('2026-11-14T02:00:00Z'));
  assert(res1C.metastrikes_used === 2, 'metastrikes_used=2 is preserved despite metastrikes_count=0');

  console.log('\n--- 2. Uninitialized strike_cycle_month Resilience ---');
  // Scenario 2A: strike_cycle_month is undefined or null (should NOT reset to 0 in November 2026)
  const uninitializedMember = {
    ...baseMember,
    id: 'mem-uninit-1',
    strikes_used: 2,
    strikes_count: 2,
    metastrikes_used: 1,
    metastrikes_count: 1,
    strike_cycle_month: null,
  };
  const novTime = DateTime.fromISO('2026-11-14T10:00:00Z');
  const res2A = await resolveMemberStrikeCounts(uninitializedMember, novTime);
  assert(res2A.reset === false, 'Missing strike_cycle_month does NOT trigger reset');
  assert(res2A.strikes_used === 2, 'Strikes preserved when strike_cycle_month is null');
  assert(res2A.metastrikes_used === 1, 'Metastrikes preserved when strike_cycle_month is null');
  assert(res2A.strike_cycle_month === '2026-11', 'Defaults strike_cycle_month to active current month (2026-11)');

  // Scenario 2B: Genuine rollover to next month (2026-11 to 2026-12) DOES reset
  const novActiveMember = {
    ...baseMember,
    id: 'mem-rollover-1',
    strikes_used: 2,
    metastrikes_used: 1,
    strike_cycle_month: '2026-11',
  };
  const decTime = DateTime.fromISO('2026-12-01T05:00:00Z');
  const res2B = await resolveMemberStrikeCounts(novActiveMember, decTime);
  assert(res2B.reset === true, 'Genuine rollover to next month triggers reset=true');
  assert(res2B.strikes_used === 0, 'Strikes reset to 0 on new month');
  assert(res2B.metastrikes_used === 0, 'Metastrikes reset to 0 on new month');
  assert(res2B.strike_cycle_month === '2026-12', 'strike_cycle_month updated to 2026-12');

  console.log('\n--- 3. Global In-Memory Persistence & Multi-Cache Synchronization ---');
  const sharedMemberId = 'mem-global-persist-1';
  setInMemoryMember({
    ...baseMember,
    id: sharedMemberId,
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: '2026-11',
  });

  // Call updateMemberStrikeCounts
  await updateMemberStrikeCounts(sharedMemberId, 2, 1, '2026-11');

  // Verify memoryMembers is synchronized
  const inMemAfterUpdate = getInMemoryMember(sharedMemberId);
  assert(inMemAfterUpdate?.strikes_used === 2, 'updateMemberStrikeCounts synchronized strikes_used to memoryMembers');
  assert(inMemAfterUpdate?.strikes_count === 2, 'updateMemberStrikeCounts synchronized strikes_count to memoryMembers');
  assert(inMemAfterUpdate?.metastrikes_used === 1, 'updateMemberStrikeCounts synchronized metastrikes_used to memoryMembers');

  // Verify resolveMemberStrikeCounts recovers count even from a stale input object
  const staleInputObject = {
    ...baseMember,
    id: sharedMemberId,
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: '2026-11',
  };
  const res3 = await resolveMemberStrikeCounts(staleInputObject, novTime);
  assert(res3.strikes_used === 2, 'resolveMemberStrikeCounts recovers stored strikes (2) even when passed stale object with 0');
  assert(res3.metastrikes_used === 1, 'resolveMemberStrikeCounts recovers stored metastrikes (1) even when passed stale object with 0');

  console.log('\n--- 4. Nightly Strike Log Ground-Truth Reconciliation ---');
  const loggedMemberId = 'mem-logged-truth-1';
  // Save confirmed strike log and metastrike log for November
  await saveNightlyStrikeLog({
    id: 'log-truth-strike-1',
    target_member_id: loggedMemberId,
    sleep_cycle_date: '2026-11-10',
    record_type: 'strike',
    voter_ids: ['voter-1', 'voter-2'],
    created_at: '2026-11-10T23:30:00Z',
    updated_at: '2026-11-10T23:30:00Z',
  });
  await saveNightlyStrikeLog({
    id: 'log-truth-meta-1',
    target_member_id: loggedMemberId,
    sleep_cycle_date: '2026-11-12',
    record_type: 'metastrike',
    voter_ids: [],
    reason: 'Monthly Battle',
    created_at: '2026-11-12T23:30:00Z',
    updated_at: '2026-11-12T23:30:00Z',
  });

  // Call resolveMemberStrikeCounts on a member object whose strikes_used in members table was somehow 0
  const desyncedMember = {
    ...baseMember,
    id: loggedMemberId,
    strikes_used: 0,
    strikes_count: 0,
    metastrikes_used: 0,
    metastrikes_count: 0,
    strike_cycle_month: '2026-11',
  };

  const res4 = await resolveMemberStrikeCounts(desyncedMember, novTime);
  assert(res4.strikes_used === 1, 'Reconciled 1 active strike from nightly_strike_logs despite member.strikes_used=0');
  assert(res4.metastrikes_used === 1, 'Reconciled 1 active metastrike from nightly_strike_logs despite member.metastrikes_used=0');

  // Verify batch resolution
  const batchCounts = await getMonthlyStrikeCountsBatch([loggedMemberId, 'non-existent-id'], '2026-11');
  assert(batchCounts.get(loggedMemberId)?.strikes === 1, 'getMonthlyStrikeCountsBatch counted 1 strike');
  assert(batchCounts.get(loggedMemberId)?.metastrikes === 1, 'getMonthlyStrikeCountsBatch counted 1 metastrike');
  assert(batchCounts.get('non-existent-id')?.strikes === 0, 'getMonthlyStrikeCountsBatch returns 0 for non-existent member');

  console.log('\n======================================================');
  if (failed) {
    console.error('❌ STRIKE PERSISTENCE TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL STRIKE PERSISTENCE TESTS PASSED CLEANLY!');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
