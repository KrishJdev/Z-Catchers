
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = readFileSync('supabase/migrations/20261122_punishment_strike_ledger.sql', 'utf8');
const schema = readFileSync('supabase/schema.sql', 'utf8').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const setup = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
`;

async function rows(sql, params = []) {
  return (await db.query(sql, params)).rows;
}

async function result(sql, params = []) {
  return (await rows(sql, params))[0]?.result;
}

const items = member => rows(`SELECT * FROM public.punishment_task_status WHERE member_id = $1
  ORDER BY earned_month, threshold_number`, [member]);
const preview = async member => (await rows('SELECT * FROM public.november_punishment_preview() WHERE member_id = $1', [member]))[0];
const seed = member => result('SELECT public.seed_november_punishments($1) AS result', [member]);
async function apply(member, cycle, { previous = null, type = 'strike',
  now = cycle + 'T23:15Z', cutoff = cycle + 'T23:10Z', deadline = '2026-12-01T23:00Z', moderator = null } = {}) {
  return result(`SELECT public.apply_nightly_strike($1, $2, to_char($5::timestamptz, 'YYYY-MM'), $3, $4,
    'fixture', $5, date_trunc('month', $5::timestamptz), $6, $7, $8) AS result`,
  [member, cycle, previous, type, now, cutoff, deadline, moderator]);
}

try {
  assert.equal(schema.split('-- Install the ledger without activating')[1], migration.split('-- Install the ledger without activating')[1],
    'The fresh-install schema mirrors the migration');
  await db.exec(setup);
  await db.exec(schema.split('-- Install the ledger without activating')[0]);
  const [{ id: seeded }, { id: live }, { id: counterOnly }, { id: disputed }] =
    await rows('SELECT id FROM public.members ORDER BY discord_username');
  await db.exec('UPDATE public.members SET timezone = \'UTC\', bedtime_local = \'23:00\', weekly_schedule = NULL');
  await rows(`UPDATE public.members SET strikes_used = 3, strikes_count = 2, metastrikes_used = 2
    WHERE id = $1`, [seeded]);
  await rows('UPDATE public.members SET strikes_used = 3, strikes_count = 3 WHERE id = $1', [counterOnly]);
  await rows(`INSERT INTO public.nightly_strike_logs(target_member_id, sleep_cycle_date, record_type, created_at, updated_at)
    VALUES ($1,'2026-11-04','strike','2026-11-04 23:10Z','2026-11-04 23:10Z'),
    ($1,'2026-11-30','strike','2026-12-01 00:15Z','2026-12-01 00:15Z'),
    ($1,'2026-11-31','strike','2026-11-04 23:10Z','2026-11-04 23:10Z'),
    ($1,'2026-11-03','pending_vote','2026-11-03 23:10Z','2026-11-03 23:10Z'),
    ($1,'2026-11-02','metastrike','2026-11-02 23:10Z','2026-11-02 23:10Z'),
    ($1,'2026-10-31','strike','2026-11-01 01:00Z','2026-11-01 01:00Z'),
    ($2,'2026-11-04','strike','2026-11-04 23:10Z','2026-11-04 23:10Z')`, [seeded, disputed]);

  await db.exec(migration);
  await db.exec(migration);
  await db.exec(schema);
  assert.equal(await result('SELECT count(*)::int AS result FROM public.punishments'), 0);
  assert.deepEqual(await rows('SELECT activated_at, screens_visible FROM public.punishment_rollout'),
    [{ activated_at: null, screens_visible: false }]);
  assert.equal((await preview(seeded)).verified_strikes, 2);
  assert.match((await preview(seeded)).verified_rows[0].replacement_until, /^2026-11-05T23:00/);
  await rows(`UPDATE public.nightly_strike_logs SET replacement_until = greatest(clock_timestamp() + interval '2 hours',
    '2026-12-01T23:00Z'::timestamptz) WHERE target_member_id = $1 AND sleep_cycle_date = '2026-11-30'`, [seeded]);
  assert.equal((await preview(seeded)).counter_discrepancy, true);
  assert.equal((await preview(seeded)).used_passes, 2);
  assert.equal((await preview(counterOnly)).verified_strikes, 0);
  assert.deepEqual((await preview(counterOnly)).thresholds, []);
  assert.equal((await apply(counterOnly, '2026-11-05')).reason, 'already_at_max_strikes');
  await assert.rejects(seed(seeded), /Activate the ledger/);

  const correction = (member, date, key, source = null) => result(`SELECT public.record_verified_november_correction
    ($1, $2, $3, 'mod-a', 'verified journal correction', $4) AS result`, [member, date, key, source]);
  const correctionId = await correction(seeded, '2026-11-04', 'ticket-1');
  assert.equal(await correction(seeded, '2026-11-04', 'ticket-1'), correctionId);
  await assert.rejects(correction(seeded, '2026-11-05', 'ticket-1'), /different correction/);
  const [voided] = (await preview(disputed)).verified_rows;
  await correction(disputed, '2026-11-04', 'ticket-2', voided.source_id);
  assert.equal((await preview(disputed)).verified_strikes, 0);
  assert.equal((await preview(seeded)).thresholds[0].status, 'pending');
  assert.equal(await result('SELECT count(*)::int AS result FROM public.punishments'), 0);

  await db.exec(`UPDATE public.punishment_rollout SET activated_at = least(clock_timestamp(), '2026-11-08 00:00Z'::timestamptz)`);
  await assert.rejects(db.exec(`UPDATE public.punishment_rollout SET activated_at = NULL`), /cannot be changed/);
  await assert.rejects(result(`SELECT public.apply_nightly_strike($1,'2026-11-20','2026-11',null,
    'strike','legacy','2026-11-20 23:11Z','2026-11-01') AS result`, [counterOnly]), /compatible app/);
  await seed(seeded);
  const firstSeed = await items(seeded);
  assert.equal(firstSeed.length, 1);
  assert.equal(firstSeed[0].earned_cycle_date.toISOString().slice(0, 10), '2026-11-30');
  assert.equal(firstSeed[0].status, 'pending');
  await seed(seeded);
  assert.deepEqual(await items(seeded), firstSeed);
  assert.equal(await result('SELECT count(*)::int AS result FROM public.punishment_actions WHERE punishment_id = $1',
    [firstSeed[0].id]), 1);
  assert.equal(await result(`SELECT used AS result FROM public.strike_pass_months
    WHERE member_id = $1 AND month_start = '2026-11-01'`, [seeded]), 2);

  assert.equal((await apply(live, '2026-11-07', { now: '2026-11-08T08:00Z' })).reason, 'cycle_before_activation');
  const assign = (id, action) => result(`SELECT public.manage_punishment_task($1, $2, 'mod-a', 'Journal check-in', NULL)
    AS result`, [id, action]);
  await assert.rejects(assign(firstSeed[0].id, 'assign'), /state that permits/);

  await rows(`INSERT INTO public.notification_logs(member_id, notification_type, local_date)
    VALUES ($1, 'IN_BED_EARLY', '2026-11-08')`, [live]);
  assert.equal((await apply(live, '2026-11-08')).reason, 'already_checked_in');
  await rows(`INSERT INTO public.sleep_logs(member_id, cycle_date, in_bed_at)
    VALUES ($1, '2026-11-09', '2026-11-09T23:05Z')`, [live]);
  assert.equal((await apply(live, '2026-11-09')).reason, 'already_checked_in');

  for (let i = 1; i <= 9; i++) {
    const cycle = '2026-11-' + (i + 9);
    if (i === 3) {
      await db.exec('ALTER TABLE public.punishments ADD CONSTRAINT fixture_threshold_failure CHECK (threshold_number <> 1) NOT VALID');
      await assert.rejects(apply(live, cycle), /fixture_threshold_failure/);
      assert.equal((await items(live)).length, 0);
      assert.equal(await result('SELECT count(*)::int AS result FROM public.nightly_strike_logs WHERE target_member_id = $1', [live]), 2);
      await db.exec('ALTER TABLE public.punishments DROP CONSTRAINT fixture_threshold_failure');
    }
    const issued = await apply(live, cycle, { deadline: cycle + 'T23:20Z' });
    assert.equal(issued.strikesUsed, issued.month === '2026-11' ? i : 0);
    assert.equal(issued.cycleStrikesUsed, i);
    assert.equal((await apply(live, cycle)).reason, 'already_issued');
    assert.equal((await items(live)).length, Math.floor(i / 3));
  }
  const [first, second, third] = await items(live);
  assert.equal(first.effective_status, 'awaiting_assignment');
  assert.equal((await assign(first.id, 'assign')).status, 'assigned');
  assert.equal((await assign(first.id, 'complete')).status, 'completed');
  assert.equal((await assign(first.id, 'complete')).status, 'completed');
  assert.equal(await result(`SELECT count(*)::int AS result FROM public.punishment_actions
    WHERE punishment_id = $1 AND action = 'completed'`, [first.id]), 1);

  assert.equal((await apply(live, '2026-11-19')).cycleStrikesUsed, 10);

  const [{ deadline: borderDeadline }] = await rows("select greatest(clock_timestamp() + interval '2 hours', '2026-12-01T23:00Z') AS deadline");
  const border = await apply(live, '2026-11-30', {
    now: '2026-12-01T00:25Z', cutoff: '2026-12-01T00:10Z', deadline: borderDeadline.toISOString(),
  });
  assert.equal(border.cycleStrikesUsed, 11);
  assert.equal(border.strikesUsed, 0);
  await rows("UPDATE public.members SET timezone = 'Asia/Kolkata' WHERE id = $1", [live]);
  const converted = await apply(live, '2026-11-30', { previous: 'strike', type: 'metastrike', now: '2026-12-01T02:00Z' });
  assert.equal(converted.cycleStrikesUsed, 10);
  assert.equal(converted.metastrikesUsed, 1);
  assert.equal(converted.strikesUsed, 0);
  assert.ok(converted.month >= '2026-12');

  const clear = cycle => apply(live, cycle, { previous: 'strike', type: 'clear',
    now: '2026-12-01T03:00Z', moderator: 'mod-a' });
  await clear('2026-11-19');
  const canceled = await clear('2026-11-18');
  assert.equal(canceled.cycleStrikesUsed, 8);
  assert.equal(canceled.strikesUsed, 0);
  assert.equal((await items(live))[2].effective_status, 'canceled');
  assert.equal((await apply(live, '2026-11-18')).reason, 'moderator_cleared');
  const replacement = await apply(live, '2026-11-29', {
    now: '2026-12-01T03:01Z', deadline: '2026-12-01T00:00Z',
  });
  assert.equal(replacement.cycleStrikesUsed, 9);
  assert.equal((await items(live))[2].id, third.id);
  assert.equal((await items(live))[2].status, 'awaiting_assignment');

  // A correction and later recovery at a completed threshold preserve its task and identity.
  for (const day of [29, 17, 16, 15, 14, 13, 12]) await clear('2026-11-' + day);
  assert.equal((await items(live))[0].status, 'completed');
  assert.equal((await items(live))[0].title, 'Journal check-in');
  assert.equal((await items(live))[1].id, second.id);
  await correction(live, '2026-11-04', 'restore-completed');
  assert.equal((await items(live))[0].id, first.id);
  assert.equal((await items(live))[0].status, 'completed');

  await seed(counterOnly);
  assert.equal((await items(counterOnly)).length, 0);
  const adjust = (strikes, passes, relative) => result(`SELECT public.adjust_member_strikes($1,$2,$3,$4,
    'mod-a','fixture correction') AS result`, [counterOnly, strikes, passes, relative]);
  assert.equal((await adjust(6, 3, false)).strikesUsed, 6);
  assert.equal((await adjust(null, -1, true)).metastrikesUsed, 2);
  assert.equal((await adjust(-1, null, true)).strikesUsed, 5);
  assert.equal((await items(counterOnly))[1].status, 'canceled');

  await db.exec('SET ROLE service_role');
  await assert.rejects(db.exec('UPDATE public.punishments SET status = \'completed\''), /permission denied/);
  assert.equal((await items(live)).length, 3);
  await db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(preview(live), /permission denied/);
  await assert.rejects(seed(live), /permission denied/);
  await assert.rejects(items(live), /permission denied/);
  await assert.rejects(assign(first.id, 'complete'), /permission denied/);
} finally {
  await db.close();
}
