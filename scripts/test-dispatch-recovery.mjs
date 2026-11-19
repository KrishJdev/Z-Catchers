import assert from 'node:assert/strict';
import { DateTime } from 'luxon';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://unit.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.DISCORD_COMMUNITY_WEBHOOK_URL = 'disabled';
const { supabaseAdmin } = await import('../src/lib/db.ts');
const { Settings } = await import('../src/lib/sleepEngine.ts');
const { executeNotificationDispatcher, clearAllCronLocks } = await import('../src/lib/cronDispatcher.ts');
const { webpush } = await import('../src/lib/pushServer.ts');
const { GET } = await import('../src/app/api/cron/dispatch-notifications/route.ts');
const { POST: nag } = await import('../src/app/api/members/nag-notif/route.ts');
const sleeper = {
  id: 'sleeper', discord_username: 'Night Fox', bedtime_local: '23:00', wake_time_local: '07:00',
  timezone: 'UTC', created_at: '2026-11-19T12:00Z', is_active: true,
  last_notified_cycle_date: null, last_notified_stage: null,
};
const tables = {
  members: [sleeper, { ...sleeper, id: 'peer', bedtime_local: '22:00' }],
  notification_logs: [], sleep_logs: [], cron_locks: [], nightly_strike_logs: [],
  push_subscriptions: ['device-a', 'device-b', 'peer'].map(id => ({
    id, endpoint: id, member_id: id === 'peer' ? 'peer' : 'sleeper', notify_personal: true, notify_community: true,
  })),
};
let databaseError;
supabaseAdmin.from = table => {
  let rows = tables[table];
  assert.ok(rows, table);
  let updates;
  let deleting = false;
  const query = {
    select() { return this; },
    eq(key, value) { rows = rows.filter(row => row[key] === value); return this; },
    lte(key, value) { rows = rows.filter(row => row[key] <= value); return this; },
    gte(key, value) { rows = rows.filter(row => row[key] >= value); return this; },
    in(key, values) { rows = rows.filter(row => values.includes(row[key])); return this; },
    like(key, prefix) { rows = rows.filter(row => row[key].startsWith(prefix.replace(/%$/, ''))); return this; },
    order() { return this; }, limit() { return this; }, range() { return this; },
    async insert(row) { tables[table].push(structuredClone(row)); return { error: null }; },
    async upsert(row) { tables[table].push(structuredClone(row)); return { error: null }; },
    update(fields) { updates = fields; return this; },
    delete() { deleting = true; return this; },
    result() {
      if (updates) rows.forEach(row => Object.assign(row, structuredClone(updates)));
      if (deleting) tables[table] = tables[table].filter(row => !rows.includes(row));
      return { data: structuredClone(rows), error: null };
    },
    async maybeSingle() {
      if (table === 'cron_locks' && databaseError) return { data: null, error: databaseError };
      return { data: this.result().data[0] ?? null, error: null };
    },
    single() { return this.maybeSingle(); },
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); },
  };
  return query;
};

const attempts = [];
webpush.sendNotification = async (sub, payload, options) => {
  assert.ok(options.TTL >= 0 && options.TTL < 25 * 60);
  attempts.push(sub.endpoint);
  if (sub.endpoint === 'device-b' && attempts.length === 2) throw Object.assign(new Error('busy'), { statusCode: 503 });
  return { statusCode: 201 };
};
const run = iso => executeNotificationDispatcher({ forcedMemberId: sleeper.id, testNowUtc: DateTime.fromISO(iso) });
const first = await run('2026-11-19T22:35Z');
assert.equal(first.windDownDispatched, 1);
assert.equal(first.details.errors.length, 1);
assert.equal(tables.notification_logs.length, 0);
clearAllCronLocks(); // New worker after the failed worker's lease expires.
tables.cron_locks[0].expires_at = '2026-01-01T00:00:00Z';
const retry = await run('2026-11-19T22:40Z');
assert.equal(retry.details.errors.length, 0);
assert.deepEqual(attempts, ['device-a', 'device-b', 'device-b']);
assert.equal(tables.notification_logs[0].notification_type, 'WIND_DOWN_30M');
assert.equal((await run('2026-11-19T22:45Z')).windDownDispatched, 0);

tables.members.push({ ...sleeper, id: 'awake', bedtime_local: '01:00' });
tables.push_subscriptions.push({ ...tables.push_subscriptions[2], id: 'awake', member_id: 'awake', endpoint: 'awake' });
for (const id of ['sleeping', 'rested', 'winding-down']) {
  tables.members.push({ ...sleeper, id, bedtime_local: id === 'winding-down' ? '23:10' : '22:00' });
  tables.push_subscriptions.push({ ...tables.push_subscriptions[2], id, member_id: id, endpoint: id });
}
tables.sleep_logs.push({ member_id: 'sleeping', cycle_date: '2026-11-19', in_bed_at: '2026-11-19T22:00Z' },
  { member_id: 'rested', cycle_date: '2026-11-19', in_bed_at: '2026-11-19T22:00Z', woke_up_at: '2026-11-19T22:50Z' });
const bedtime = await run('2026-11-19T23:00Z');
assert.equal(bedtime.communityNagsDispatched, 2);
assert.deepEqual(attempts.slice(-4), ['device-a', 'device-b', 'peer', 'awake']);
assert.equal(bedtime.bedtimeHitDispatched, 2);
for (const id of ['sleeping', 'rested', 'winding-down']) assert.ok(!attempts.includes(id));
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
