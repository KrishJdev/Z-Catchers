import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { DateTime } from 'luxon';
import { metastrikeCycleContext } from '../src/lib/metastrikes.ts';

const db = new PGlite();
const schema = readFileSync('supabase/schema.sql', 'utf8').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const migration = readFileSync('supabase/migrations/20261201_reviewed_metastrikes.sql', 'utf8');
const migrationStart = schema.indexOf(migration);
assert.ok(migrationStart > 0, 'Expected the reviewed Metastrikes migration in schema.sql.');

const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const result = async (sql, args) => (await first(sql, args))?.result;
const rejects = (operation, code, message) => assert.rejects(operation,
  error => error.code === code && (!message || message.test(error.message)));
const now = () => DateTime.utc();
const day = (at, delta) => at.plus({ days: delta }).toISODate();
const addMember = name => first(`
  INSERT INTO public.members (discord_username, discord_id, journal_url, bedtime_local, timezone, created_at)
  VALUES ($1, $1, 'https://discord.com/channels/123/456', '23:30', 'UTC', '2026-10-01') RETURNING *
`, [name]);
const member = id => first('SELECT * FROM public.members WHERE id = $1', [id]);
const changeRole = (profile, role) => first(
  'UPDATE public.members SET role = $2 WHERE id = $1 RETURNING *', [profile.id, role]);
const apply = (profile, cycle, type, previous = null) => result(`
  SELECT public.apply_nightly_strike($1, $2, to_char(clock_timestamp(), 'YYYY-MM'), $3, $4,
    'fixture', clock_timestamp(), date_trunc('month', clock_timestamp()), clock_timestamp() - interval '5 minutes',
    clock_timestamp() + interval '1 day', NULL, $5) AS result
`, [profile.id, cycle, previous, type, profile.strike_schedule_revision]);
const evidence = (profile, date) => result('SELECT public.get_metastrike_cycle_evidence($1,$2) AS result', [profile.id, date]);
const context = async (profile, cycle) => {
  const at = now();
  const actual = await member(profile.id);
  return metastrikeCycleContext(actual, at, await evidence(actual, day(at, -1)), cycle);
};
const own = async (profile, action, id, cycle = null, reason = null, snapshot = null, month = null, discord = profile.discord_id) =>
  result('SELECT public.member_metastrikes($1,$2,$3,$4,$5,$6,$7,$8) AS result',
    [profile.id, discord, action, id, cycle, reason, snapshot, month]);
const submit = async (profile, cycle, reason = '  Private reason  ', id = randomUUID(), snapshot) =>
  own(profile, 'submit', id, cycle, reason, snapshot ?? await context(profile, cycle));
const decide = async (actor, item, action = 'approve', source = null, reason = null, snapshot = null) =>
  result('SELECT public.decide_metastrike($1,$2,$3,$4,$5,$6,$7) AS result',
    [actor.id, actor.discord_id, item.id, action, source, reason, snapshot]);
const queue = (actor, id = null, pending = true) =>
  result('SELECT public.read_moderation_metastrikes($1,$2,$3,$4,0) AS result',
    [actor.id, actor.discord_id, id, pending]);
const insertStrike = (profile, cycle) => first(`INSERT INTO public.nightly_strike_logs
  (target_member_id, sleep_cycle_date, record_type, updated_at)
  VALUES ($1,$2,'strike',clock_timestamp() - interval '1 day') RETURNING id`, [profile.id, cycle]);
const taskStatus = profile => first('SELECT * FROM public.punishment_task_status WHERE member_id = $1', [profile.id]);
const charge = (profile, month) => first(
  'SELECT used FROM public.strike_pass_months WHERE member_id = $1 AND month_start = $2', [profile.id, month]);
const setRollout = (fields) => db.exec('UPDATE public.punishment_rollout SET ' + fields + ' WHERE singleton;');

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
  `);
  await db.exec(schema.slice(0, migrationStart));
  await db.exec(migration);
  const fox = await addMember('111111111111111100');
  const other = await addMember('111111111111111101');
  const mod = await changeRole(await addMember('111111111111111102'), 'moderator');
  const secondMod = await changeRole(await addMember('111111111111111103'), 'moderator');
  const owner = await changeRole(await addMember('111111111111111104'), 'owner');
  const settling = await addMember('111111111111111105');
  const completedMember = await addMember('111111111111111106');
  const previous = await addMember('111111111111111107');
  const nextDay = day(now(), 7);
  await rejects(submit(fox, nextDay), 'PT409', /closed/);
  assert.equal((await apply(other, nextDay, 'metastrike')).log.record_type, 'metastrike');
  await setRollout("activated_at = '2026-11-01', screens_visible = true, reviewed_metastrikes_required = true, metastrike_requests_open = true");

  const emptyEvidence = { checked_at: null, checked_in: false, woke: false, last_woke_up_at: null, last_wake_cycle_date: null };
  const dst = metastrikeCycleContext({ ...fox, timezone: 'America/New_York', bedtime_local: '02:30' },
    DateTime.fromISO('2027-03-14T06:50Z'), emptyEvidence);
  assert.equal(dst.anchor, '2027-03-13');
  assert.equal(dst.cutoffs['2027-03-13'], '2027-03-14T07:40:00.000Z');
  const effective = metastrikeCycleContext({ ...fox, pending_timezone: 'Asia/Kolkata', pending_bedtime_local: '01:00',
    pending_effective_at: '2026-11-15T00:00Z' }, DateTime.fromISO('2026-11-30T20:00Z'), emptyEvidence);
  assert.equal(effective.anchor, '2026-11-30');
  assert.equal(effective.local_month, '2026-12');
  assert.equal(effective.cutoffs[effective.anchor], '2026-11-30T19:40:00.000Z');
  const openMorning = metastrikeCycleContext(fox, DateTime.fromISO('2026-11-25T09:00Z'),
    { ...emptyEvidence, checked_in: true, checked_at: '2026-11-24T23:15Z' });
  assert.equal(openMorning.anchor, '2026-11-24');

  const current = await context(fox);
  const anchor = DateTime.fromISO(current.anchor, { zone: 'utc' });
  const month = anchor.startOf('month').toISODate();
  const at = offset => day(anchor, offset);
  const past = await insertStrike(fox, at(-3));
  const listed = await own(fox, 'list', null, null, null, current, month);
  assert.deepEqual(listed.choices.map(c => c.cycle_date), [-3,-2,-1,0,1,2,3].map(at));
  assert.equal(listed.choices[1].unavailable_reason, 'nightly_strike_required');
  assert.equal((await queue(mod)).pending_count, 0);
  await rejects(own(fox, 'list', null, null, null, current, month, other.discord_id), 'PT403');
  await rejects(submit(fox, at(-4)), 'PT400');
  await rejects(submit(fox, at(4)), 'PT400');
  await rejects(submit(fox, at(-2)), 'PT409', /Past cycles/);
  await rejects(submit(fox, at(3), ' \t \n '), 'PT400');
  await rejects(submit(owner, at(1)), 'PT403');
  const stale = await context(fox, at(3));
  await db.query("UPDATE public.members SET bedtime_local = '23:45' WHERE id = $1", [fox.id]);
  await rejects(submit(fox, at(3), 'Reason', randomUUID(), stale), 'PT409', /sleep cycle changed/);

  const pastRequest = await submit(fox, at(-3));
  assert.equal(pastRequest.item.reason, 'Private reason');
  assert.equal(pastRequest.item.reviewer_id, undefined);
  assert.equal((await submit(fox, at(-3), 'Private reason', pastRequest.item.id)).item.id, pastRequest.item.id);
  await rejects(submit(fox, at(-3), 'Different reason', pastRequest.item.id), 'PT409');
  const future = await submit(fox, at(3));
  const stars = await submit(fox, at(2));
  assert.equal(future.item.status, 'pending');
  assert.equal(future.quota.used, 0);
  const futureAt = DateTime.fromISO(at(3), { zone: 'utc' });
  const otherFutureDays = [at(1), at(0)].filter(cycle => cycle.slice(0, 7) === futureAt.toFormat('yyyy-MM'));
  for (const cycle of otherFutureDays) {
    const quota = (await own(fox, 'list', null, null, null, await context(fox), futureAt.startOf('month').toISODate())).quota;
    if (quota.remaining === 0) await rejects(submit(fox, cycle), 'PT409', /slots/);
  }
  const quotaMember = await addMember('111111111111111119');
  const quotaMonth = listed.choices.find(choice => listed.choices.filter(otherChoice =>
    otherChoice.cycle_date.slice(0, 7) === choice.cycle_date.slice(0, 7)).length >= 4).cycle_date.slice(0, 7);
  const quotaDates = listed.choices.filter(choice => choice.cycle_date.startsWith(quotaMonth)).map(choice => choice.cycle_date).slice(0, 4);
  for (const cycle of quotaDates) if (cycle < current.anchor) await insertStrike(quotaMember, cycle);
  await db.query("UPDATE public.members SET created_at = '2026-10-01' WHERE id = $1", [quotaMember.id]);
  const reserved = [];
  for (const cycle of quotaDates.slice(0, 3)) reserved.push(await submit(quotaMember, cycle));
  assert.equal(reserved[2].quota.reserved, 3);
  await rejects(submit(quotaMember, quotaDates[3]), 'PT409', /slots/);
  if (quotaMonth === now().toFormat('yyyy-MM')) {
    await rejects(result(`SELECT public.moderate_strike_counts($1,$2,$3,NULL,1,true) AS result`,
      [owner.id, owner.discord_id, quotaMember.id]), 'PT409', /reserved/);
  }
  for (const reservation of reserved) await own(quotaMember, 'withdraw', reservation.item.id);
  const reservations = await submit(mod, at(3));
  await rejects(decide(mod, reservations.item, 'decline', null, 'No'), 'PT403');
  await rejects(decide(secondMod, reservations.item, 'decline', null, 'No'), 'PT403');
  assert.equal((await queue(mod)).items.some(item => item.id === reservations.item.id), false);
  assert.equal((await queue(owner)).items.some(item => item.id === reservations.item.id), true);
  await rejects(decide(owner, reservations.item, 'decline', null, '\t'), 'PT400');
  assert.equal((await decide(owner, reservations.item, 'decline', null, '  Not eligible  ')).item.decision_reason, 'Not eligible');
  const privateDecisions = await own(mod, 'list', null, null, null, await context(mod), futureAt.startOf('month').toISODate());
  assert.equal(privateDecisions.items[0].decision_reason, 'Not eligible');
  assert.equal(privateDecisions.items[0].reviewer_id, undefined);
  await rejects(own(other, 'withdraw', stars.item.id), 'PT404');
  const withdrawn = await own(fox, 'withdraw', stars.item.id);
  assert.equal(withdrawn.item.status, 'withdrawn');
  assert.equal((await own(fox, 'withdraw', stars.item.id)).quota.remaining, withdrawn.quota.remaining);
  await rejects(apply(fox, at(3), 'metastrike'), 'PT409', /reviewed request/);
  const proactive = await decide(mod, future.item, 'approve', null, null, await context(fox, at(3)));
  assert.equal(proactive.item.status, 'approved');
  assert.equal((await decide(mod, future.item)).item.pass_source_id, proactive.item.pass_source_id);
  assert.equal((await apply(await member(fox.id), at(3), 'strike')).reason, 'metastrike_active');
  const pass = await first('SELECT * FROM public.nightly_strike_logs WHERE id = $1', [proactive.item.pass_source_id]);
  assert.equal(pass.reason, 'Approved Metastrike');
  assert.ok(pass.pass_charged_month.toISOString().startsWith(at(3).slice(0, 7)));
  assert.equal((await charge(fox, futureAt.startOf('month').toISODate())).used, 1);
  await rejects(decide(secondMod, future.item), 'PT409', /already been decided/);

  // A changed nightly ID cannot be approved through a refresh of an unrelated strike.
  await db.query('DELETE FROM public.nightly_strike_logs WHERE id = $1', [past.id]);
  const replacementSource = await insertStrike(fox, at(-3));
  await rejects(decide(mod, pastRequest.item, 'approve', past.id), 'PT409', /source/);
  await rejects(decide(mod, pastRequest.item, 'approve', replacementSource.id), 'PT409', /source/);
  await decide(mod, pastRequest.item, 'decline', null, 'Original strike changed');

  // A pending request leaves dispatch free to issue a strike and affect the task ledger.
  const settleCycle = at(0);
  const request = await submit(settling, settleCycle);
  const settlingSnapshot = await context(settling, settleCycle);
  settlingSnapshot.cutoff = now().minus({ minutes: 1 }).toISO();
  await rejects(decide(mod, request.item, 'approve', null, null, settlingSnapshot), 'PT409', /still pending/);
  const stableDates = [at(-1), at(-2)].every(cycle => cycle.slice(0,7) === month.slice(0,7)) ? [at(-1), at(-2)] : [at(1), at(2)];
  for (const cycle of stableDates) await insertStrike(settling, cycle);
  const issued = await apply(settling, settleCycle, 'strike');
  assert.equal(issued.log.record_type, 'strike');
  assert.equal((await taskStatus(settling)).effective_status, 'pending');
  await rejects(decide(mod, request.item, 'approve', null, null, settlingSnapshot), 'PT409', /source/);
  const approved = await decide(mod, request.item, 'approve', issued.log.id);
  assert.equal(approved.item.status, 'approved');
  assert.equal((await taskStatus(settling)).status, 'canceled');
  const history = await result('SELECT public.get_member_strike_history($1,$2,$3) AS result',
    [settling.id, settling.discord_id, month]);
  assert.ok(JSON.stringify(history).includes('replaced'));

  // An accepted pending request protects an already assigned task from completion only while it matters.
  const heldCycle = stableDates[0];
  const heldStrike = await insertStrike(completedMember, heldCycle);
  await insertStrike(completedMember, stableDates[1]);
  await apply(completedMember, settleCycle, 'strike');
  await db.query("UPDATE public.punishments SET status='assigned', title='Existing title', instructions='Keep this' WHERE member_id=$1",
    [completedMember.id]);
  const heldRequest = await submit(completedMember, heldCycle);
  const held = await taskStatus(completedMember);
  assert.equal(held.metastrike_hold, true);
  const complete = () => result("SELECT public.moderate_punishment($1,$2,$3,'complete') AS result", [mod.id, mod.discord_id, held.id]);
  await rejects(complete(), 'PT409', /on hold/);
  await decide(mod, heldRequest.item, 'decline', null, 'Insufficient evidence');
  assert.equal((await taskStatus(completedMember)).instructions, 'Keep this');
  await complete();
  const again = await submit(completedMember, heldCycle);
  await decide(mod, again.item, 'approve', heldStrike.id);
  assert.equal((await taskStatus(completedMember)).status, 'completed');

  // Use a stored past request to exercise a decision after rollover and outside the submission window.
  const priorMonth = now().startOf('month').minus({ months: 1 });
  const priorCycle = priorMonth.endOf('month').toISODate();
  const old = await insertStrike(previous, priorCycle);
  const pastId = randomUUID();
  await db.query(`INSERT INTO public.metastrike_requests
    (id,member_id,cycle_date,timezone,cutoff_at,reason,submitted_at,submitted_source_id)
    VALUES ($1,$2,$3,'UTC',$3::date + interval '1 day','Accepted before rollover',$3::date,$4)`,
    [pastId, previous.id, priorCycle, old.id]);
  await decide(mod, { id: pastId }, 'approve', old.id);
  assert.equal((await charge(previous, priorMonth.toISODate())).used, 1);
  assert.equal((await member(previous.id)).metastrikes_used, 0);
  await result(`SELECT public.moderate_nightly_strike($1,$2,$3,$4,to_char(clock_timestamp(),'YYYY-MM'),
    'metastrike','clear','Reversal',clock_timestamp(),date_trunc('month',clock_timestamp()),NULL,NULL,$5) AS result`,
    [owner.id, owner.discord_id, previous.id, priorCycle, previous.strike_schedule_revision]);
  assert.equal((await charge(previous, priorMonth.toISODate())).used, 0);

  const protectedRequest = await submit(other, at(2));
  await db.query("INSERT INTO public.notification_logs(member_id,notification_type,local_date) VALUES ($1,'IN_BED_EARLY',$2)", [other.id, at(2)]);
  const closed = await decide(mod, protectedRequest.item, 'approve');
  assert.equal(closed.item.status, 'closed');
  assert.equal(closed.item.quota.reserved, 0);
  assert.equal(closed.item.quota.used, protectedRequest.quota.used);
  await setRollout('metastrike_requests_open = false');
  await rejects(submit(fox, at(2)), 'PT409', /closed/);
  await rejects(setRollout('reviewed_metastrikes_required = false'), 'P0001');
  await rejects(apply(fox, at(2), 'metastrike'), 'PT409', /reviewed request/);
  await db.exec(migration);
  assert.equal((await queue(mod, future.item.id)).item.status, 'approved');
  await db.exec('SET ROLE anon;');
  await rejects(queue(mod), '42501');
  await db.exec('RESET ROLE; SET ROLE service_role;');
  await rejects(db.query('SELECT * FROM public.metastrike_requests'), '42501');
  assert.equal((await taskStatus(completedMember)).status, 'completed');
  assert.equal((await queue(mod)).pending_count, 0);

  console.log('Reviewed Metastrike date, authorization, quota, dispatch, audit, task and reversal checks passed.');
} finally {
  await db.close();
}
