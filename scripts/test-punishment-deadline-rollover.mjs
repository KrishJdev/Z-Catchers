import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const schema = read('supabase/schema.sql').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const migration = read('supabase/migrations/20261204_punishment_deadlines.sql');
const migrationStart = schema.indexOf(migration);
assert.ok(migrationStart > 0, 'The fresh-install schema mirrors the deadline migration');

const db = new PGlite();
const november = '2099-11-01';
const december = '2099-12-01';
const priorCycle = '2099-11-30';
const beforeRollover = '2099-11-30T18:29:59Z';
const rollover = '2099-11-30T18:30:00Z'; // Midnight in Asia/Kolkata.
const dueAt = '2099-12-05T18:00:00Z';

const result = async (sql, args) => (await db.query(sql, args)).rows[0]?.result;
const balance = (id, month) => result(
  'SELECT used AS result FROM public.strike_pass_months WHERE member_id = $1 AND month_start = $2', [id, month]);
const refresh = (id, at) => result('SELECT public.refresh_member_strike_projection($1, $2) AS result', [id, at]);
const state = id => result(
  'SELECT jsonb_agg(to_jsonb(p) ORDER BY threshold_number) AS result FROM public.punishments p WHERE member_id = $1', [id]);
const write = (id, date, previousType, type, actor = null) => result(
  'SELECT public.apply_nightly_strike($1,$2,$3,$4,$5,$6,$7,$7,NULL,NULL,$8,NULL) AS result',
  [id, date, '2099-12', previousType, type, 'Fixture', rollover, actor]);

try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;");
  await db.exec("CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text'");
  await db.exec(schema.slice(0, migrationStart));
  const { rows: [inactive, active] } = await db.query(
    "INSERT INTO public.members (discord_username, discord_id, journal_url, bedtime_local, timezone, " +
    "strike_cycle_month, strikes_used, strikes_count, metastrikes_used, metastrikes_count) " +
    "VALUES ('Inactive Fox', '111', 'https://discord.com/channels/123/456', '23:00', 'GMT+05:30', '2099-11', 1, 1, 2, 2), " +
    "('Active Fox', '222', 'https://discord.com/channels/123/456', '23:00', 'Asia/Kolkata', '2099-11', 6, 6, 2, 2) RETURNING id"
  );
  await db.query(
    "INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, updated_at, replacement_until) " +
    "VALUES ($1, $2, 'strike', $3, '2099-12-01T17:30Z')", [inactive.id, priorCycle, beforeRollover]);
  await db.query(
    "INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, created_at, updated_at, replacement_until) " +
    "SELECT $1, d::text, 'strike', d::timestamptz, d::timestamptz, " +
    "CASE WHEN d = date '2099-11-30' THEN '2099-12-01T17:30Z'::timestamptz ELSE d::timestamptz + interval '1 day' END " +
    "FROM unnest(ARRAY['2099-11-05','2099-11-10','2099-11-15','2099-11-20','2099-11-25','2099-11-30']::date[]) AS d", [active.id]);
  // Simulate an already assigned task installed before deadlines existed.
  await db.query(
    "INSERT INTO public.punishments (member_id, earned_month, threshold_number, earned_cycle_date, qualified_at, " +
    "assignable_at, status, title, assigned_at) VALUES ($1, $2, 1, '2099-11-15', '2099-11-15T19:00Z', " +
    "'2099-11-16T19:00Z', 'assigned', 'Do the task', '2099-11-29T10:00Z')", [active.id, november]);

  await db.exec(migration);
  await db.exec(migration);
  const zones = await result(`SELECT jsonb_build_object(
    'east', '2099-11-30T18:30Z'::timestamptz AT TIME ZONE public.strike_member_zone('GMT+05:30'),
    'west', '2099-12-01T03:30Z'::timestamptz AT TIME ZONE public.strike_member_zone('GMT-03:30'),
    'named', public.strike_member_zone('Asia/Kolkata'),
    'fallback', public.strike_member_zone('GMT+05:60'),
    'missing', public.strike_member_zone(NULL)) AS result`);
  assert.deepEqual(zones, {
    east: '2099-12-01T00:00:00', west: '2099-12-01T00:00:00',
    named: 'Asia/Kolkata', fallback: 'UTC', missing: 'UTC',
  });
  assert.deepEqual(await result(`SELECT jsonb_build_array(
    public.punishment_member_zone(m, $3), public.punishment_progress_month(m, $2),
    public.punishment_progress_month(m, $3)) AS result FROM public.members m WHERE id = $1`,
  [inactive.id, beforeRollover, rollover]), ['GMT+05:30', november, december]);
  const [oldTask] = await state(active.id);
  assert.equal(oldTask.due_at, null);
  const { rows: [mod] } = await db.query(
    "INSERT INTO public.members (discord_username, discord_id, journal_url, bedtime_local, timezone, role) " +
    "VALUES ('Moderator Fox', '333', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'moderator') RETURNING id");
  await db.exec("UPDATE public.punishment_rollout SET activated_at = NULL, screens_visible = false");

  const legacy = await write(inactive.id, priorCycle, 'strike', 'metastrike');
  assert.equal(legacy.metastrikesUsed, 0);
  assert.equal(legacy.log.pass_charged_month, november);
  assert.equal(await balance(inactive.id, november), 3);
  await write(inactive.id, priorCycle, 'metastrike', 'clear', mod.id);
  assert.equal(await balance(inactive.id, november), 2);

  await db.query(`INSERT INTO public.nightly_strike_logs
    (target_member_id, sleep_cycle_date, record_type, pass_used_on, pass_charged_month, updated_at) VALUES
    ($1, '2099-11-27', 'metastrike', '2099-11-28', NULL, $2),
    ($1, '2099-11-28', 'metastrike', NULL, NULL, $3),
    ($1, '2099-11-29', 'metastrike', '2099-11-30', '2099-12-01', $2)`,
  [inactive.id, rollover, beforeRollover]);
  await db.query('UPDATE public.members SET metastrikes_count = 1, metastrikes_used = 1 WHERE id = $1', [inactive.id]);
  assert.equal((await write(inactive.id, '2099-11-27', 'metastrike', 'clear', mod.id)).metastrikesUsed, 1);
  assert.equal(await balance(inactive.id, november), 1);
  assert.equal((await write(inactive.id, '2099-11-28', 'metastrike', 'clear', mod.id)).metastrikesUsed, 1);
  assert.equal(await balance(inactive.id, november), 0);
  assert.equal((await write(inactive.id, '2099-11-29', 'metastrike', 'clear', mod.id)).metastrikesUsed, 0);
  assert.equal(await balance(inactive.id, november), 0);

  await db.exec("UPDATE public.punishment_rollout SET activated_at = '2026-11-01T00:00Z', screens_visible = true");
  await assert.rejects(db.query(
    "SELECT public.moderate_punishment($1,'333',NULL,'assign',NULL,NULL,NULL,NULL,NULL,NULL,NULL)", [mod.id]),
  { code: 'PT404' });
  await db.query('SELECT public.reconcile_punishments(m, $2, $3) FROM public.members m WHERE id = $1',
    [active.id, november, beforeRollover]);
  const deadline = await result(
    "SELECT public.moderate_punishment($1,'333',$2,'edit','Do the task',NULL,NULL,NULL,NULL,NULL,$3) AS result",
    [mod.id, oldTask.id, dueAt]);
  assert.equal(deadline.item.due_at, '2099-12-05T18:00:00+00:00');
  assert.equal(deadline.item.member_timezone, 'Asia/Kolkata');
  assert.deepEqual(await refresh(active.id, beforeRollover), {
    strikesUsed: 6, metastrikesUsed: 2, month: '2099-11', reset: false,
  });
  assert.deepEqual(await refresh(active.id, rollover), {
    strikesUsed: 0, metastrikesUsed: 0, month: '2099-12', reset: true,
  });
  const tasksAfterRollover = await state(active.id);
  assert.equal(tasksAfterRollover.length, 2);
  assert.equal(tasksAfterRollover[0].status, 'assigned');
  assert.equal(tasksAfterRollover[0].due_at, deadline.item.due_at);
  assert.equal(tasksAfterRollover[1].status, 'pending');

  const converted = await write(active.id, priorCycle, 'strike', 'metastrike');
  assert.equal(converted.log.pass_charged_month, november);
  assert.equal(converted.log.pass_used_on, december);
  assert.equal(converted.cycleStrikesUsed, 5);
  assert.equal(converted.metastrikesUsed, 0);
  assert.equal(await balance(active.id, november), 3);
  assert.equal(await balance(active.id, december), 0);
  await assert.rejects(write(active.id, priorCycle, 'strike', 'metastrike'), { code: 'PT409' });
  await assert.rejects(write(active.id, '2099-11-25', 'strike', 'metastrike', mod.id),
    { code: 'PT400', message: /November 2099/ });
  const tasksAfterReplacement = await state(active.id);
  assert.equal(tasksAfterReplacement[1].status, 'canceled');
  assert.equal(tasksAfterReplacement[0].due_at, deadline.item.due_at);

  await write(active.id, priorCycle, 'metastrike', 'clear', mod.id);
  assert.equal(await balance(active.id, november), 2);
  assert.equal(await balance(active.id, december), 0);
  console.log('Verified both monthly balances, deadline carryover, and cross-month instant replacement and refund.');
} finally {
  await db.close();
}
