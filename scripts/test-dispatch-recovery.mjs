import assert from 'node:assert/strict';
import { DateTime } from 'luxon';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://unit.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.DISCORD_COMMUNITY_WEBHOOK_URL = 'disabled';
process.env.MOD_SECRET_PASSCODE = 'dispatcher-fixture-mod';
const { fetchAllRows, supabaseAdmin } = await import('../src/lib/db.ts');
const { Settings } = await import('../src/lib/sleepEngine.ts');
const { acquireCronLock, clearAllCronLocks, executeNotificationDispatcher, getCronLock, recordCronLockDeliveredSub } = await import('../src/lib/cronDispatcher.ts');
const { resolveMemberStrikeCounts, getStrikeAlertTotal } = await import('../src/lib/strikes.ts');
const { webpush } = await import('../src/lib/pushServer.ts');
const { GET } = await import('../src/app/api/cron/dispatch-notifications/route.ts');
const { GET: getRoster } = await import('../src/app/api/members/route.ts');
const { GET: getModRoster } = await import('../src/app/api/mod/route.ts');
const { POST: nag } = await import('../src/app/api/members/nag-notif/route.ts');
const { createSessionToken } = await import('../src/lib/auth.ts');
const sleeper = {
  id: 'sleeper', discord_username: 'Night Fox', bedtime_local: '23:00', wake_time_local: '07:00',
  timezone: 'UTC', created_at: '2026-11-19T12:00Z', is_active: true,
  last_notified_cycle_date: null, last_notified_stage: null,
  pending_effective_at: null, pending_bedtime_local: null,
  strikes_used: 0, strikes_count: 0, metastrikes_used: 0, metastrikes_count: 0, strike_cycle_month: '2026-11',
};
const tables = {
  members: [sleeper, { ...sleeper, id: 'peer', bedtime_local: '22:00' }],
  notification_logs: [], sleep_logs: [], cron_locks: [], nightly_strike_logs: [], rate_limits: [],
  push_subscriptions: ['device-a', 'device-b', 'peer'].map(id => ({
    id, endpoint: id, member_id: id === 'peer' ? 'peer' : 'sleeper', notify_personal: true, notify_community: true,
  })),
};
let databaseError;
let receiptFailures = 0;
let receiptAttempts = 0;
let memberUpdate;
let sleepEvidenceErrorFor;
let onSleepEvidenceRead;
let onNightlyStrikeRead;
let failedNagDeletes = 0;
let nagDeleteAttempts = 0;
let nextId = 0;
let claimNag;
let applyStrike;
let cycleTotal = null;
let refreshProjection = id => ({ data: null, error: { message: 'Unexpected refresh for ' + id } });
supabaseAdmin.rpc = async (name, params) => {
  if (name === 'claim_manual_nag') return claimNag(params);
  if (name === 'apply_nightly_strike') return applyStrike(params);
  if (name === 'refresh_member_strike_projection') return refreshProjection(params.p_member_id);
  if (name === 'get_strike_cycle_total') return { data: cycleTotal, error: null };
  const lease = tables.cron_locks.find(row => row.lock_key === params.p_key);
  if (name === 'renew_cron_lease') {
    if (lease?.locked_at !== params.p_previous_locked_at || lease.expires_at > params.p_locked_at || lease.metadata.completed) {
      return { data: null, error: null };
    }
    lease.locked_at = params.p_locked_at;
    lease.expires_at = params.p_expires_at;
    lease.metadata = { ...params.p_metadata, delivered_sub_ids: [...new Set([
      ...(lease.metadata.delivered_sub_ids ?? []), ...params.p_metadata.delivered_sub_ids,
    ])] };
    return { data: structuredClone(lease.metadata), error: null };
  }
  assert.equal(name, 'complete_cron_stage');
  if (lease?.locked_at !== params.p_locked_at || Date.parse(lease.expires_at) <= Date.now() || lease.metadata.completed) {
    return { data: false, error: null };
  }
  lease.metadata = { ...lease.metadata, ...params.p_metadata, completed: true, state: 'completed' };
  tables.notification_logs.push({
    member_id: lease.metadata.member_id, notification_type: lease.metadata.stage, local_date: lease.metadata.local_date,
  });
  return { data: true, error: null };
};
supabaseAdmin.from = table => {
  let rows = [...tables[table]];
  for (const row of rows) {
    if (table !== 'cron_locks' && row.id === undefined) row.id = `row-${String(++nextId).padStart(5, '0')}`;
  }
  assert.ok(rows, table);
  let updates;
  let deleting = false;
  let filterMemberId;
  const query = {
    select() { return this; },
    eq(key, value) {
      if (key === 'member_id') filterMemberId = value;
      const [column, field] = key.split('->>');
      rows = rows.filter(row => (field ? row[column]?.[field] : row[column]) === value);
      return this;
    },
    lte(key, value) { rows = rows.filter(row => row[key] <= value); return this; },
    gt(key, value) { rows = rows.filter(row => row[key] > value); return this; },
    gte(key, value) { rows = rows.filter(row => row[key] >= value); return this; },
    in(key, values) { rows = rows.filter(row => values.includes(row[key])); return this; },
    like(key, prefix) { rows = rows.filter(row => row[key].startsWith(prefix.replace(/%$/, ''))); return this; },
    not(key, _operator, value) { rows = rows.filter(row => row[key] !== value); return this; },
    order(key) { rows.sort((a, b) => a[key] < b[key] ? -1 : Number(a[key] > b[key])); return this; },
    limit(max) { rows = rows.slice(0, max); return this; }, range() { return this; },
    async insert(row) { tables[table].push(structuredClone(row)); return { error: null }; },
    async upsert(row) { tables[table].push(structuredClone(row)); return { error: null }; },
    update(fields) { updates = fields; return this; },
    delete() { deleting = true; return this; },
    result() {
      if (table === 'sleep_logs' && filterMemberId) onSleepEvidenceRead?.();
      if (table === 'nightly_strike_logs') onNightlyStrikeRead?.();
      if (table === 'sleep_logs' && filterMemberId && filterMemberId === sleepEvidenceErrorFor) {
        return { data: null, error: { message: 'sleep evidence unavailable' } };
      }
      if (table === 'notification_logs' && deleting) {
        nagDeleteAttempts++;
        if (failedNagDeletes > 0) {
          failedNagDeletes--;
          return { data: null, error: { message: 'claim cleanup unavailable' } };
        }
      }
      if (table === 'cron_locks' && updates?.metadata?.delivered_sub_ids?.length && !updates.expires_at) {
        receiptAttempts++;
        if (receiptFailures > 0) {
          receiptFailures--;
          return { data: null, error: { message: 'temporary receipt failure' } };
        }
      }
      if (table === 'members' && updates && memberUpdate && rows.length === 1) {
        const response = memberUpdate(rows[0], updates);
        if (response) return response;
      }
      if (updates) rows.forEach(row => Object.assign(row, structuredClone(updates)));
      if (deleting) tables[table] = tables[table].filter(row => !rows.includes(row));
      return { data: structuredClone(rows), error: null };
    },
    async maybeSingle() {
      if (table === 'cron_locks' && databaseError) return { data: null, error: databaseError };
      const { data, error } = this.result();
      return { data: data?.[0] ?? null, error };
    },
    single() { return this.maybeSingle(); },
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); },
  };
  return query;
};

const attempts = [];
webpush.sendNotification = async (sub, payload, options) => {
  assert.ok(options.TTL > 0 && options.TTL <= 25 * 60);
  attempts.push(sub.endpoint);
  if (sub.endpoint === 'device-a' && JSON.parse(payload).title.includes("Catch Some Z")) {
    tables.sleep_logs.push({ member_id: 'live-check-in', cycle_date: '2026-11-19', in_bed_at: '2026-11-19T23:00Z' });
  }
  if (sub.endpoint === 'device-b' && attempts.length === 2) throw Object.assign(new Error('busy'), { statusCode: 503 });
  return { statusCode: 201 };
};
const run = iso => executeNotificationDispatcher({ forcedMemberId: sleeper.id, testNowUtc: DateTime.fromISO(iso) });
receiptFailures = 1;
const first = await run('2026-11-19T22:35Z');
assert.equal(first.windDownDispatched, 1);
assert.equal(first.details.errors.length, 1);
assert.equal(tables.notification_logs.length, 0);
assert.equal(receiptAttempts, 2);
clearAllCronLocks(); // New worker after the failed worker's lease expires.
tables.cron_locks[0].expires_at = '2026-01-01T00:00:00Z';
const retry = await run('2026-11-19T22:40Z');
assert.equal(retry.details.errors.length, 0);
assert.deepEqual(attempts, ['device-a', 'device-b', 'device-b']);
assert.equal(tables.notification_logs[0].notification_type, 'WIND_DOWN_30M');
assert.equal((await run('2026-11-19T22:45Z')).windDownDispatched, 0);

tables.members.push({ ...sleeper, id: 'awake', bedtime_local: '01:00' });
tables.push_subscriptions.push({ ...tables.push_subscriptions[2], id: 'awake', member_id: 'awake', endpoint: 'awake' });
for (const id of ['sleeping', 'rested', 'winding-down', 'live-check-in']) {
  const bedtime = id === 'winding-down' ? '23:10' : id === 'live-check-in' ? '23:30' : '22:00';
  tables.members.push({ ...sleeper, id, bedtime_local: bedtime });
  tables.push_subscriptions.push({ ...tables.push_subscriptions[2], id, member_id: id, endpoint: id });
}
tables.sleep_logs.push({ member_id: 'sleeping', cycle_date: '2026-11-19', in_bed_at: '2026-11-19T22:00Z' },
  { member_id: 'rested', cycle_date: '2026-11-19', in_bed_at: '2026-11-19T22:00Z', woke_up_at: '2026-11-19T22:50Z' });
const bedtime = await run('2026-11-19T23:00Z');
assert.equal(bedtime.communityNagsDispatched, 2);
assert.deepEqual(attempts.slice(-4), ['device-a', 'device-b', 'awake', 'peer']);
assert.equal(bedtime.bedtimeHitDispatched, 2);
for (const id of ['sleeping', 'rested', 'winding-down', 'live-check-in']) assert.ok(!attempts.includes(id));
tables.sleep_logs.push({ member_id: sleeper.id, cycle_date: '2026-11-19', in_bed_at: '2026-11-19T22:55Z' });
assert.equal((await run('2026-11-19T23:10Z')).autoStrikesDispatched, 0);

// The prior wake flag belongs to a different night. A failed catch-up write
// must leave the cycle eligible once the worker lease expires.
tables.sleep_logs.length = 0;
sleeper.is_woke_up = true;
sleeper.last_wake_cycle_date = '2026-11-18';
let rpcCalls = 0;
applyStrike = async params => {
  assert.equal(params.p_cycle, '2026-11-19');
  rpcCalls++;
  return rpcCalls === 1 ? { error: { message: 'write interrupted' } }
    : { data: { log: { record_type: 'strike' }, strikesUsed: 1 } };
};
const missed = await run('2026-11-20T15:00Z');
assert.match(missed.details.errors[0], /write interrupted/);
assert.ok(!tables.notification_logs.some(row => row.notification_type === 'AUTO_BEDTIME_STRIKE'));
clearAllCronLocks();
tables.cron_locks.at(-1).expires_at = '2026-01-01T00:00:00Z';
assert.equal((await run('2026-11-20T15:05Z')).autoStrikesDispatched, 1);
assert.equal((await run('2026-11-20T15:10Z')).autoStrikesDispatched, 0);
assert.equal(rpcCalls, 2);

// A member still awake at +10 receives the strike alert as well as the earlier alarm.
applyStrike = async () => ({ data: { log: { record_type: 'strike' }, strikesUsed: 2 } });
const missedTonight = await run('2026-11-20T23:10Z');
assert.equal(missedTonight.autoStrikesDispatched, 1);
assert.deepEqual(attempts.slice(-2), ['device-a', 'device-b']);

tables.notification_logs.length = 0;
clearAllCronLocks();
tables.cron_locks.length = 0;
sleeper.created_at = '2026-11-19T23:30Z';
assert.equal((await run('2026-11-20T15:15Z')).autoStrikesDispatched, 0);
assert.equal(rpcCalls, 2);

databaseError = { message: 'lock table unavailable' };
process.env.CRON_SECRET = 'test-cron-secret';
const response = await GET(new Request('http://localhost/api/cron/dispatch-notifications', {
  headers: { Authorization: 'Bearer test-cron-secret' },
}));
assert.equal(response.status, 500);
assert.match((await response.json()).error, /lock table unavailable/);

Settings.now = () => Date.parse('2026-11-20T23:15:00Z');
const sender = createSessionToken('peer');
const manual = (type = 'bedtime', token = sender) => nag(new Request('http://localhost/api/members/nag-notif', {
  method: 'POST', headers: token ? { Cookie: `zcatchers_session=${token}` } : {},
  body: JSON.stringify({ target_member_id: sleeper.id, type }),
}));
let manualClaimCalls = 0;
claimNag = async ({ p_member_id, p_type, p_cycle, p_now }) => {
  manualClaimCalls++;
  const existing = tables.notification_logs.find(row => row.member_id === p_member_id &&
    row.notification_type === p_type && row.local_date === p_cycle);
  if (existing) {
    const seconds = 900 + (Date.parse(existing.dispatched_at) - Date.parse(p_now)) / 1000;
    if (seconds > 0) return { data: seconds, error: null };
    existing.dispatched_at = p_now;
  } else {
    tables.notification_logs.push({ member_id: p_member_id, notification_type: p_type, local_date: p_cycle, dispatched_at: p_now });
  }
  return { data: 0, error: null };
};
assert.equal((await manual('bedtime', null)).status, 401);
assert.equal((await manual('bedtime', createSessionToken(sleeper.id))).status, 400);
assert.equal(manualClaimCalls, 0);
const delivered = await (await manual()).json();
assert.equal(delivered.deliveredCount, 2, JSON.stringify(delivered));
assert.equal((await manual()).status, 429);
const isBedtimeClaim = row => row.notification_type === 'MANUAL_NAG:OVERDUE:user_peer';
const clearBedtimeClaim = () => {
  tables.notification_logs = tables.notification_logs.filter(row => !isBedtimeClaim(row));
};
const unavailablePush = () => { throw Object.assign(new Error('busy'), { statusCode: 503 }); };
clearBedtimeClaim();
webpush.sendNotification = async () => unavailablePush();
failedNagDeletes = 1;
const retryableNag = await manual();
assert.equal(retryableNag.status, 503);
assert.match((await retryableNag.json()).error, /Please retry/);
assert.equal(nagDeleteAttempts, 2);
assert.equal(tables.notification_logs.filter(isBedtimeClaim).length, 0);

webpush.sendNotification = async () => {
  const [claim] = tables.notification_logs.filter(isBedtimeClaim);
  claim.dispatched_at = '2026-11-20T23:30:00.000Z';
  Settings.now = () => Date.parse('2026-11-20T23:31:00Z');
  unavailablePush();
};
const replacedNag = await manual();
assert.equal(replacedNag.status, 503);
assert.equal(replacedNag.headers.get('Retry-After'), '840');
assert.equal((await replacedNag.json()).cooldownSeconds, 840);
assert.deepEqual(tables.notification_logs.filter(isBedtimeClaim).map(row => row.dispatched_at), ['2026-11-20T23:30:00.000Z']);

clearBedtimeClaim();
webpush.sendNotification = async () => unavailablePush();
failedNagDeletes = 2;
const uncertainNag = await manual();
assert.equal(uncertainNag.status, 503);
assert.equal(uncertainNag.headers.get('Retry-After'), '900');
assert.equal((await uncertainNag.json()).cooldownSeconds, 900);
tables.sleep_logs.push({ member_id: sleeper.id, cycle_date: '2026-11-20', in_bed_at: '2026-11-20T23:12Z' });
assert.equal((await (await manual()).json()).shieldActive, true);

Settings.now = () => Date.parse('2026-11-21T08:00:00Z');
tables.sleep_logs.at(-1).woke_up_at = '2026-11-21T07:20Z';
const wakeNag = () => manual('wake_up');
const alreadyAwake = await wakeNag();
assert.equal(alreadyAwake.status, 400);
assert.match((await alreadyAwake.json()).error, /already awake/);
delete tables.sleep_logs.at(-1).woke_up_at;
webpush.sendNotification = async () => ({ statusCode: 201 });
assert.equal((await (await wakeNag()).json()).deliveredCount, 2);
assert.ok(tables.notification_logs.some(row => row.notification_type === 'MANUAL_NAG:WAKE_UP:user_peer' && row.local_date === '2026-11-20'));
// A successful cancellation deletes both sources of check-in evidence.
tables.sleep_logs.length = 0;
assert.equal((await (await wakeNag()).json()).shieldActive, true);

// A worker retaining an accepted push in memory must carry its receipt into the next lease.
databaseError = undefined;
const lockKey = 'test-receipt-renewal';
const receiptLease = await acquireCronLock(lockKey, 300);
assert.ok(receiptLease);
receiptFailures = 3;
await assert.rejects(recordCronLockDeliveredSub(receiptLease, 'accepted'), /temporary receipt failure/);
(await getCronLock(lockKey)).expiresAt = 0;
tables.cron_locks.find(row => row.lock_key === lockKey).expires_at = '2026-01-01T00:00:00Z';
assert.ok(await acquireCronLock(lockKey, 300));
assert.deepEqual((await getCronLock(lockKey)).metadata.delivered_sub_ids, ['accepted']);
assert.deepEqual(tables.cron_locks.find(row => row.lock_key === lockKey).metadata.delivered_sub_ids, ['accepted']);

// The deadline and copy are recalculated per subscription from the same selected bedtime.
tables.members = [sleeper];
Object.assign(sleeper, {
  created_at: '2026-11-20T12:00Z', last_wake_cycle_date: null, is_woke_up: false,
  last_notified_cycle_date: null, last_notified_stage: null,
});
tables.sleep_logs = [];
tables.notification_logs = [];
tables.cron_locks = [];
clearAllCronLocks();
tables.push_subscriptions = tables.push_subscriptions.filter(sub => sub.member_id === sleeper.id);
tables.push_subscriptions.push({ ...tables.push_subscriptions[0], id: 'device-c', endpoint: 'device-c' });
let clock = Date.parse('2026-11-20T22:58:00Z');
Settings.now = () => clock;
const windDowns = [];
webpush.sendNotification = async (sub, payload, { TTL }) => {
  windDowns.push({ device: sub.endpoint, body: JSON.parse(payload).body, TTL });
  clock += 61_000;
  return { statusCode: 201 };
};
assert.equal((await executeNotificationDispatcher({ forcedMemberId: sleeper.id })).windDownDispatched, 2);
assert.deepEqual(windDowns.map(send => [send.device, send.TTL]), [['device-a', 120], ['device-b', 59]]);
assert.match(windDowns[0].body, /^2 minutes/);
assert.match(windDowns[1].body, /^1 minute/);

// A failed promotion stays out of the roster while a concurrent change uses the stored schedule.
tables.notification_logs = [];
tables.cron_locks = [];
clearAllCronLocks();
const pending = { ...sleeper, bedtime_local: '20:00', pending_bedtime_local: '23:00', pending_effective_at: '2026-11-20T20:00Z',
  last_notified_cycle_date: null, last_notified_stage: null };
tables.members.push({ ...pending, id: 'failed' }, { ...pending, id: 'concurrent' });
tables.push_subscriptions = [...tables.push_subscriptions.slice(0, 1),
  ...['failed', 'concurrent'].map(id => ({
    ...tables.push_subscriptions[0], id, endpoint: id, member_id: id, notify_community: false,
  }))];
memberUpdate = (member, updates) => {
  if (!('pending_effective_at' in updates)) return;
  if (member.id === 'failed') return { data: null, error: { message: 'write failed' } };
  Object.assign(member, { bedtime_local: '23:10', pending_bedtime_local: null, pending_effective_at: null });
  return { data: [], error: null };
};
const promotionSends = [];
webpush.sendNotification = async sub => {
  promotionSends.push(sub.endpoint);
  return { statusCode: 201 };
};
const afterPromotion = await executeNotificationDispatcher({ testNowUtc: DateTime.fromISO('2026-11-20T23:00Z') });
assert.match(afterPromotion.details.errors[0], /failed/);
assert.equal(afterPromotion.evaluatedMembersCount, 2);
assert.deepEqual(promotionSends, ['concurrent', 'device-a']);

// A competing monthly rollover returns the persisted counts. A DB error surfaces separately.
refreshProjection = () => ({ data: { strikesUsed: 2, metastrikesUsed: 1, month: '2026-12', reset: false }, error: null });
const november = { ...sleeper };
const december = DateTime.fromISO('2026-12-01T00:02Z');
cycleTotal = 9;
assert.deepEqual(await getStrikeAlertTotal(november, '2026-11-30', december), { count: 9, month: '2026-11' });
cycleTotal = null;
assert.deepEqual(await resolveMemberStrikeCounts(november, december), {
  strikes_used: 2, metastrikes_used: 1, strike_cycle_month: '2026-12', reset: false,
});
refreshProjection = () => ({ data: null, error: { message: 'rollover database unavailable' } });
Object.assign(sleeper, november);
await assert.rejects(resolveMemberStrikeCounts(november, december), /rollover database unavailable/);
memberUpdate = undefined;
refreshProjection = () => ({ data: { strikesUsed: 0, metastrikesUsed: 0, month: '2026-12', reset: true }, error: null });
assert.deepEqual(await resolveMemberStrikeCounts(november, december), {
  strikes_used: 0, metastrikes_used: 0, strike_cycle_month: '2026-12', reset: true,
});

// A committed strike retries its remaining alert after the scheduled wake time.
Object.assign(sleeper, november, { wake_time_local: '23:14' });
tables.members = [sleeper];
tables.push_subscriptions = ['device-a', 'device-b'].map(id => ({
  id, endpoint: id, member_id: sleeper.id, notify_personal: true, notify_community: false,
}));
tables.notification_logs = [{ member_id: sleeper.id, notification_type: 'BEDTIME_HIT', local_date: '2026-11-20' }];
tables.cron_locks = [];
clearAllCronLocks();
let strikeWrites = 0;
applyStrike = async params => {
  strikeWrites++;
  const log = {
    target_member_id: sleeper.id, sleep_cycle_date: params.p_cycle, record_type: 'strike', updated_at: params.p_now,
  };
  tables.nightly_strike_logs.push(log);
  sleeper.strikes_used++;
  return { data: { log, strikesUsed: sleeper.strikes_used } };
};
const alertAttempts = [];
webpush.sendNotification = async (sub, payload, { TTL }) => {
  assert.match(JSON.parse(payload).title, /Strike Recorded/);
  assert.equal(TTL, 300);
  alertAttempts.push(sub.endpoint);
  if (alertAttempts.length === 2) throw Object.assign(new Error('unavailable'), { statusCode: 503 });
  return { statusCode: 201 };
};
const firstStrike = await run('2026-11-20T23:12Z');
assert.equal(firstStrike.autoStrikesDispatched, 1);
assert.equal(firstStrike.details.errors.length, 1);
const strikeKey = 'notif:sleeper:2026-11-20:AUTO_BEDTIME_STRIKE';
(await getCronLock(strikeKey)).expiresAt = 0;
tables.cron_locks.find(row => row.lock_key === strikeKey).expires_at = '2026-01-01T00:00:00Z';
onNightlyStrikeRead = () => {
  sleeper.strikes_used = 2;
  onNightlyStrikeRead = undefined;
};
const originalFetch = globalThis.fetch;
const webhookPayloads = [];
process.env.DISCORD_COMMUNITY_WEBHOOK_URL = 'https://discord.com/api/webhooks/123456789/fixture';
globalThis.fetch = async (url, options) => {
  assert.equal(url, process.env.DISCORD_COMMUNITY_WEBHOOK_URL);
  webhookPayloads.push(JSON.parse(options.body));
  return new Response(null, { status: 204 });
};
try {
  assert.deepEqual((await run('2026-11-20T23:18Z')).details.errors, []);
} finally {
  globalThis.fetch = originalFetch;
  process.env.DISCORD_COMMUNITY_WEBHOOK_URL = 'disabled';
}
assert.equal(webhookPayloads.length, 1);
assert.match(webhookPayloads[0].embeds[0].description, /2 strikes.*November 2026/);
assert.equal(strikeWrites, 1);
assert.deepEqual(alertAttempts, ['device-a', 'device-b', 'device-b']);
assert.equal(tables.cron_locks.find(row => row.lock_key === strikeKey).metadata.alert_outcome, 'complete');

const expiredCycle = '2026-11-17';
const expiredKey = `notif:sleeper:${expiredCycle}:AUTO_BEDTIME_STRIKE`;
tables.nightly_strike_logs.push({
  target_member_id: sleeper.id, sleep_cycle_date: expiredCycle, record_type: 'strike', updated_at: `${expiredCycle}T23:10Z`,
});
tables.cron_locks.push({
  lock_key: expiredKey, locked_at: `${expiredCycle}T23:10Z`, expires_at: `${expiredCycle}T23:15Z`,
  metadata: { member_id: sleeper.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: expiredCycle, state: 'processing' },
});
assert.equal((await run('2026-11-21T23:45Z')).details.errors.length, 0);
assert.equal(strikeWrites, 1);
assert.equal(alertAttempts.length, 3);
assert.equal(tables.cron_locks.find(row => row.lock_key === expiredKey).metadata.alert_outcome, 'expired');

// A target who checks in after the first bedtime push suppresses the remaining stage.
const primary = { ...sleeper, wake_time_local: '07:00', last_notified_stage: null, last_notified_cycle_date: null };
const other = { ...primary, id: 'z-other', bedtime_local: '01:00' };
tables.members = [primary, other];
tables.notification_logs = [];
tables.sleep_logs = [];
tables.cron_locks = [];
tables.push_subscriptions.push({ ...tables.push_subscriptions[0], id: 'other-device', endpoint: 'other-device',
  member_id: other.id, notify_community: true });
clearAllCronLocks();
const bedtimeSends = [];
webpush.sendNotification = async sub => {
  bedtimeSends.push(sub.endpoint);
  tables.sleep_logs.push({ member_id: primary.id, cycle_date: '2026-11-20', in_bed_at: '2026-11-20T23:00Z' });
  return { statusCode: 201 };
};
assert.equal((await run('2026-11-20T23:00Z')).bedtimeHitDispatched, 1);
const bedtimeKey = 'notif:sleeper:2026-11-20:BEDTIME_HIT';
const bedtimeStage = () => tables.cron_locks.find(row => row.lock_key === bedtimeKey);
assert.deepEqual(bedtimeSends, ['device-a']);
assert.deepEqual(bedtimeStage().metadata.delivered_sub_ids, ['device-a']);
assert.equal(bedtimeStage().metadata.delivery_outcome, 'suppressed');

// Wind-down and strike alerts also recheck Sleep Shield between devices.
for (const [stage, at, title, outcome] of [
  ['WIND_DOWN_30M', '22:45', /Wind-Down/, { delivery_outcome: 'suppressed' }],
  ['AUTO_BEDTIME_STRIKE', '23:15', /Strike Recorded/, { alert_outcome: 'complete' }],
]) {
  tables.notification_logs = stage === 'AUTO_BEDTIME_STRIKE'
    ? [{ member_id: primary.id, notification_type: 'BEDTIME_HIT', local_date: '2026-11-20' }]
    : [];
  tables.sleep_logs = [];
  tables.cron_locks = [];
  clearAllCronLocks();
  const sends = [];
  webpush.sendNotification = async (sub, payload) => {
    assert.match(JSON.parse(payload).title, title);
    sends.push(sub.endpoint);
    tables.sleep_logs.push({ member_id: primary.id, cycle_date: '2026-11-20', in_bed_at: `2026-11-20T${at}Z` });
    return { statusCode: 201 };
  };
  assert.deepEqual((await run(`2026-11-20T${at}Z`)).details.errors, []);
  assert.deepEqual(sends, ['device-a']);
  const { metadata } = tables.cron_locks.find(row => row.lock_key === `notif:sleeper:2026-11-20:${stage}`);
  assert.deepEqual(metadata.delivered_sub_ids, ['device-a']);
  for (const [key, value] of Object.entries(outcome)) assert.equal(metadata[key], value);
  assert.ok(tables.notification_logs.some(row => row.member_id === primary.id && row.notification_type === stage));
}

// A fresh evidence read failure leaves prior receipts intact and the stage retryable.
tables.notification_logs = [];
tables.sleep_logs = [];
tables.cron_locks = [];
clearAllCronLocks();
webpush.sendNotification = async () => {
  sleepEvidenceErrorFor = primary.id;
  return { statusCode: 201 };
};
const evidenceFailure = await run('2026-11-20T23:00Z');
assert.match(evidenceFailure.details.errors[0], /Could not verify current sleep status/);
assert.deepEqual(bedtimeStage().metadata.delivered_sub_ids, ['device-a']);
assert.equal(bedtimeStage().metadata.state, 'processing');
sleepEvidenceErrorFor = undefined;

// An exhausted receipt write leaves the failed stage pending while unrelated work continues.
const otherWindDown = { ...other, bedtime_local: '23:00' };
tables.members = [primary, otherWindDown];
tables.cron_locks = [];
clearAllCronLocks();
receiptFailures = 3;
const isolatedSends = [];
webpush.sendNotification = async sub => {
  isolatedSends.push(sub.endpoint);
  return { statusCode: 201 };
};
const stageFailure = await executeNotificationDispatcher({ testNowUtc: DateTime.fromISO('2026-11-20T22:45Z') });
assert.match(stageFailure.details.errors[0], /WIND_DOWN_30M for sleeper.*temporary receipt failure/);
assert.deepEqual(isolatedSends, ['device-a', 'other-device']);
const windDownKey = 'notif:sleeper:2026-11-20:WIND_DOWN_30M';
assert.equal(tables.cron_locks.find(row => row.lock_key === windDownKey).metadata.state, 'processing');
assert.deepEqual((await getCronLock(windDownKey)).metadata.delivered_sub_ids, ['device-a']);

// A replacement lease acquired while a provider is in flight is untouched by the stale run.
tables.cron_locks = [];
clearAllCronLocks();
const staleSends = [];
webpush.sendNotification = async sub => {
  staleSends.push(sub.endpoint);
  (await getCronLock(windDownKey)).expiresAt = 0;
  const row = tables.cron_locks.find(lock => lock.lock_key === windDownKey);
  row.expires_at = '2026-01-01T00:00:00Z';
  assert.ok(await acquireCronLock(windDownKey, 300, { stage: 'replacement' }));
  return { statusCode: 201 };
};
const staleRun = await run('2026-11-20T22:45Z');
assert.match(staleRun.details.errors[0], /lease was replaced/);
assert.deepEqual(staleSends, ['device-a']);
const replacement = tables.cron_locks.find(row => row.lock_key === windDownKey);
assert.equal(replacement.metadata.stage, 'replacement');
assert.deepEqual(replacement.metadata.delivered_sub_ids, []);
assert.equal(replacement.metadata.completed, undefined);

// A replacement in the database alone blocks a stale worker before its first push.
tables.cron_locks = [];
clearAllCronLocks();
onSleepEvidenceRead = () => {
  const row = bedtimeStage();
  row.locked_at = new Date(Date.parse(row.locked_at) + 1000).toISOString();
  row.metadata = { state: 'processing', delivered_sub_ids: ['replacement-receipt'] };
  onSleepEvidenceRead = undefined;
};
const pushesBeforeLeaseLoss = staleSends.length;
const lostLease = await run('2026-11-20T23:00Z');
assert.match(lostLease.details.errors[0], /expired or was replaced before dispatch/);
assert.equal(staleSends.length, pushesBeforeLeaseLoss);
assert.deepEqual(bedtimeStage().metadata.delivered_sub_ids, ['replacement-receipt']);

// Roster loading and alert resumption both isolate a failed monthly rollover.
const badRollover = { ...primary, strike_cycle_month: '2026-11' };
const goodRollover = { ...otherWindDown, strike_cycle_month: '2026-12' };
tables.members = [badRollover, goodRollover];
tables.notification_logs = tables.members.map(member => ({
  member_id: member.id, notification_type: 'BEDTIME_HIT', local_date: '2026-12-01',
}));
tables.nightly_strike_logs = tables.members.map(member => ({
  target_member_id: member.id, sleep_cycle_date: '2026-12-01', record_type: 'strike', updated_at: '2026-12-01T23:10Z',
}));
tables.cron_locks = [];
clearAllCronLocks();
refreshProjection = id => {
  assert.equal(id, primary.id);
  return { data: null, error: { message: 'rollover failed' } };
};
Settings.now = () => Date.parse('2026-12-01T23:15Z');
const roster = await getRoster(new Request('http://localhost/api/members'));
assert.equal(roster.status, 200);
const rosterMembers = (await roster.json()).members;
assert.deepEqual(rosterMembers.map(member => member.id), [primary.id, other.id]);
assert.equal(rosterMembers[0].strike_counts_unavailable, true);
assert.equal(rosterMembers[0].strikes_used, undefined);
assert.equal(rosterMembers[0].metastrikes_count, undefined);
assert.equal(rosterMembers[1].strike_counts_unavailable, false);
const modRoster = await getModRoster(new Request('http://localhost/api/mod', {
  headers: { 'x-mod-passcode': process.env.MOD_SECRET_PASSCODE },
}));
assert.equal(modRoster.status, 200);
const modMembers = (await modRoster.json()).members;
assert.equal(modMembers.length, 2);
assert.equal(modMembers.find(member => member.id === primary.id).strike_counts_unavailable, true);
assert.equal(modMembers.find(member => member.id === primary.id).strikes_count, undefined);
webpush.sendNotification = async () => ({ statusCode: 201 });
const resumed = await executeNotificationDispatcher({ testNowUtc: DateTime.fromISO('2026-12-01T23:15Z') });
assert.match(resumed.details.errors[0], /AUTO_BEDTIME_STRIKE for sleeper.*rollover failed/);
assert.ok(tables.notification_logs.some(row => row.member_id === other.id && row.notification_type === 'AUTO_BEDTIME_STRIKE'));
assert.ok(!tables.notification_logs.some(row => row.member_id === primary.id && row.notification_type === 'AUTO_BEDTIME_STRIKE'));

// A legacy writer can commit after midnight while still returning the issuance month's count.
const monthEnd = { ...sleeper, id: 'month-end', bedtime_local: '23:40', wake_time_local: '07:00',
  is_woke_up: false, last_wake_cycle_date: null, strike_cycle_month: '2026-11' };
tables.members = [monthEnd];
tables.notification_logs = [{ member_id: monthEnd.id, notification_type: 'BEDTIME_HIT', local_date: '2026-11-30' }];
tables.nightly_strike_logs = [];
tables.sleep_logs = [];
tables.push_subscriptions = [];
tables.cron_locks = [];
clearAllCronLocks();
let boundaryClock = Date.parse('2026-11-30T23:59:59Z');
const previousClock = Settings.now;
Settings.now = () => boundaryClock;
const boundaryWebhooks = [];
process.env.DISCORD_COMMUNITY_WEBHOOK_URL = 'https://discord.com/api/webhooks/123456789/fixture';
globalThis.fetch = async (_url, options) => {
  boundaryWebhooks.push(JSON.parse(options.body));
  return new Response(null, { status: 204 });
};
applyStrike = async params => {
  assert.equal(params.p_month, '2026-11');
  boundaryClock = Date.parse('2026-12-01T00:00:01Z');
  return { data: { log: { record_type: 'strike', updated_at: params.p_now }, strikesUsed: 3 } };
};
try {
  const dispatch = await executeNotificationDispatcher({ forcedMemberId: monthEnd.id });
  assert.deepEqual(dispatch.details.errors, []);
  assert.equal(dispatch.autoStrikesDispatched, 1);
  assert.equal(boundaryWebhooks.length, 1);
  assert.match(boundaryWebhooks[0].embeds[0].description, /3 strikes.*November 2026/);
} finally {
  Settings.now = previousClock;
  globalThis.fetch = originalFetch;
  process.env.DISCORD_COMMUNITY_WEBHOOK_URL = 'disabled';
}

// Removing a subscription already read on page one must not shift the last row past page two.
let rows = [{ id: 'a', endpoint: 'A' }, { id: 'b', endpoint: 'B' }, { id: 'c', endpoint: 'C' }];
let pageReads = 0;
supabaseAdmin.from = table => {
  assert.equal(table, 'push_subscriptions');
  let cursor;
  let limit;
  return {
    select(columns) { assert.equal(columns, 'id, endpoint'); return this; },
    order(column) { assert.equal(column, 'id'); return this; },
    limit(size) { limit = size; return this; },
    gt(column, value) { assert.equal(column, 'id'); cursor = value; return this; },
    then(resolve) {
      const data = rows.filter(row => cursor === undefined || row.id > cursor).slice(0, Math.min(limit, 2));
      if (++pageReads === 1) rows = rows.slice(1);
      resolve({ data, error: null });
    },
  };
};
const subscriptions = await fetchAllRows('push_subscriptions', 'endpoint', q => q, 10);
assert.equal(subscriptions.error, null);
assert.deepEqual(subscriptions.data.map(row => row.id), ['a', 'b', 'c']);
assert.equal(pageReads, 3);
