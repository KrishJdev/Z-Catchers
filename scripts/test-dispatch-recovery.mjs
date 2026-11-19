import assert from 'node:assert/strict';
import { DateTime } from 'luxon';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://unit.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.DISCORD_COMMUNITY_WEBHOOK_URL = 'disabled';
const { supabaseAdmin } = await import('../src/lib/db.ts');
const { Settings } = await import('../src/lib/sleepEngine.ts');
const { acquireCronLock, clearAllCronLocks, executeNotificationDispatcher, getCronLock, recordCronLockDeliveredSub } = await import('../src/lib/cronDispatcher.ts');
const { resolveMemberStrikeCounts } = await import('../src/lib/strikes.ts');
const { webpush } = await import('../src/lib/pushServer.ts');
const { GET } = await import('../src/app/api/cron/dispatch-notifications/route.ts');
const { POST: nag } = await import('../src/app/api/members/nag-notif/route.ts');
const sleeper = {
  id: 'sleeper', discord_username: 'Night Fox', bedtime_local: '23:00', wake_time_local: '07:00',
  timezone: 'UTC', created_at: '2026-11-19T12:00Z', is_active: true,
  last_notified_cycle_date: null, last_notified_stage: null,
  pending_effective_at: null, pending_bedtime_local: null,
  strikes_used: 0, strikes_count: 0, metastrikes_used: 0, metastrikes_count: 0, strike_cycle_month: '2026-11',
};
const tables = {
  members: [sleeper, { ...sleeper, id: 'peer', bedtime_local: '22:00' }],
  notification_logs: [], sleep_logs: [], cron_locks: [], nightly_strike_logs: [],
  push_subscriptions: ['device-a', 'device-b', 'peer'].map(id => ({
    id, endpoint: id, member_id: id === 'peer' ? 'peer' : 'sleeper', notify_personal: true, notify_community: true,
  })),
};
let databaseError;
let receiptFailures = 0;
let receiptAttempts = 0;
let memberUpdate;
supabaseAdmin.from = table => {
  let rows = tables[table];
  assert.ok(rows, table);
  let updates;
  let deleting = false;
  const query = {
    select() { return this; },
    eq(key, value) {
      const [column, field] = key.split('->>');
      rows = rows.filter(row => (field ? row[column]?.[field] : row[column]) === value);
      return this;
    },
    lte(key, value) { rows = rows.filter(row => row[key] <= value); return this; },
    gt(key, value) { rows = rows.filter(row => row[key] > value); return this; },
    gte(key, value) { rows = rows.filter(row => row[key] >= value); return this; },
    in(key, values) { rows = rows.filter(row => values.includes(row[key])); return this; },
    like(key, prefix) { rows = rows.filter(row => row[key].startsWith(prefix.replace(/%$/, ''))); return this; },
    order() { return this; }, limit() { return this; }, range() { return this; },
    async insert(row) { tables[table].push(structuredClone(row)); return { error: null }; },
    async upsert(row) { tables[table].push(structuredClone(row)); return { error: null }; },
    update(fields) { updates = fields; return this; },
    delete() { deleting = true; return this; },
    result() {
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
assert.deepEqual(attempts.slice(-4), ['device-a', 'device-b', 'peer', 'awake']);
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
supabaseAdmin.rpc = async (name, params) => {
  assert.equal(name, 'apply_nightly_strike');
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
supabaseAdmin.rpc = async () => ({ data: { log: { record_type: 'strike' }, strikesUsed: 2 } });
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
const manual = () => nag(new Request('http://localhost/api/members/nag-notif', {
  method: 'POST', body: JSON.stringify({ target_member_id: sleeper.id }),
}));
supabaseAdmin.rpc = async name => {
  assert.equal(name, 'claim_manual_nag');
  return { data: 0, error: null };
};
const delivered = await (await manual()).json();
assert.equal(delivered.deliveredCount, 2, JSON.stringify(delivered));
webpush.sendNotification = async () => { throw Object.assign(new Error('busy'), { statusCode: 503 }); };
assert.equal((await manual()).status, 503);
tables.sleep_logs.push({ member_id: sleeper.id, cycle_date: '2026-11-20', in_bed_at: '2026-11-20T23:12Z' });
assert.equal((await (await manual()).json()).shieldActive, true);

// A worker retaining an accepted push in memory must carry its receipt into the next lease.
databaseError = undefined;
const lockKey = 'test-receipt-renewal';
assert.equal(await acquireCronLock(lockKey, 300), true);
receiptFailures = 3;
await assert.rejects(recordCronLockDeliveredSub(lockKey, 'accepted'), /temporary receipt failure/);
(await getCronLock(lockKey)).expiresAt = 0;
tables.cron_locks.find(row => row.lock_key === lockKey).expires_at = '2026-01-01T00:00:00Z';
assert.equal(await acquireCronLock(lockKey, 300), true);
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
assert.deepEqual(promotionSends, ['device-a', 'concurrent']);

// A competing monthly rollover returns the persisted counts. A DB error surfaces separately.
memberUpdate = (member, fields) => {
  if (fields.strike_cycle_month !== '2026-12') return;
  Object.assign(member, { strike_cycle_month: '2026-12', strikes_used: 2, metastrikes_used: 1 });
  return { data: [], error: null };
};
const november = { ...sleeper };
const december = DateTime.fromISO('2026-12-01T00:02Z');
assert.deepEqual(await resolveMemberStrikeCounts(november, december), {
  strikes_used: 2, metastrikes_used: 1, strike_cycle_month: '2026-12', reset: false,
});
memberUpdate = () => ({ data: null, error: { message: 'rollover database unavailable' } });
Object.assign(sleeper, november);
await assert.rejects(resolveMemberStrikeCounts(november, december), /rollover database unavailable/);
memberUpdate = undefined;
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
supabaseAdmin.rpc = async (name, params) => {
  assert.equal(name, 'apply_nightly_strike');
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
assert.equal((await run('2026-11-20T23:18Z')).details.errors.length, 0);
assert.equal(strikeWrites, 1);
assert.deepEqual(alertAttempts, ['device-a', 'device-b', 'device-b']);
assert.equal(tables.cron_locks.find(row => row.lock_key === strikeKey).metadata.alert_outcome, 'complete');

const expiredCycle = '2026-11-17';
const expiredKey = `notif:sleeper:${expiredCycle}:AUTO_BEDTIME_STRIKE`;
tables.nightly_strike_logs.push({
  target_member_id: sleeper.id, sleep_cycle_date: expiredCycle, record_type: 'strike', updated_at: `${expiredCycle}T23:10Z`,
});
tables.cron_locks.push({
  lock_key: expiredKey, expires_at: `${expiredCycle}T23:15Z`,
  metadata: { member_id: sleeper.id, stage: 'AUTO_BEDTIME_STRIKE', local_date: expiredCycle, state: 'processing' },
});
assert.equal((await run('2026-11-21T23:45Z')).details.errors.length, 0);
assert.equal(strikeWrites, 1);
assert.equal(alertAttempts.length, 3);
assert.equal(tables.cron_locks.find(row => row.lock_key === expiredKey).metadata.alert_outcome, 'expired');
