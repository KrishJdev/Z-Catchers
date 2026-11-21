import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  insertLegacyNovemberFixtures, seedNovemberFixtures, verifyNovemberPreview, verifyNovemberRollover,
} from './fixtures/november-cutover-smoke.mjs';

const db = new PGlite();
const ledger = readFileSync('supabase/migrations/20261122_punishment_strike_ledger.sql', 'utf8');
const schema = readFileSync('supabase/schema.sql', 'utf8');
const legacySchema = schema.split(ledger.split('\n', 1)[0])[0]
  .replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const taskApi = readFileSync('supabase/migrations/20261123_punishment_task_apis.sql', 'utf8');
const cutover = readFileSync('supabase/migrations/20261125_verify_punishment_cutover.sql', 'utf8');
assert.ok(schema.includes(cutover), 'The fresh-install schema mirrors the cutover migration');

async function sql(input) {
  const results = await db.exec(input);
  return results.flatMap(result => result.rows).map(row => {
    const [value] = Object.values(row);
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }).join('\n');
}

try {
  await sql(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
  `);
  await sql(legacySchema);
  const fixtures = await insertLegacyNovemberFixtures(sql);
  await sql(ledger);
  assert.equal(await sql('SELECT count(*) FROM public.punishments'), '0');
  await sql(taskApi);
  await sql(cutover);
  assert.equal(await sql(`
    SELECT bool_and(NOT has_function_privilege(role_name, function_name, 'EXECUTE'))
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
    CROSS JOIN (VALUES ('public.punishment_ledger_issues(date)'),
      ('public.show_verified_november_punishments()')) AS functions(function_name)
  `), 'true');
  const preview = await verifyNovemberPreview(sql, fixtures);
  await assert.rejects(sql(`SELECT public.seed_november_punishments('${fixtures['rollover-east']}')`), { code: 'PT409' });
  const show = 'SELECT public.show_verified_november_punishments()';
  const visibility = 'SELECT screens_visible FROM public.punishment_rollout WHERE singleton';
  const issues = async () => (await db.query('SELECT * FROM public.punishment_ledger_issues() ORDER BY issue')).rows;
  await assert.rejects(sql(show), { code: 'PT409' });
  const activation = await sql(`UPDATE public.punishment_rollout SET activated_at = clock_timestamp()
    WHERE singleton RETURNING activated_at`);
  await assert.rejects(sql(show), { code: 'PT409' });
  assert.equal(await sql(visibility), 'false');
  const initialIssues = await issues();
  assert.equal(initialIssues.filter(row => row.issue === 'missing_task').length, 3);
  assert.ok(initialIssues.some(row => row.member_id === fixtures['counter-only']
    && row.issue === 'missing_november_pass_balance'));

  // The legacy schema can include demo rows outside the named fixture set.
  const otherMembers = await db.query('SELECT id FROM public.members WHERE id <> ALL($1::uuid[])',
    [Object.values(fixtures)]);
  for (const { id } of otherMembers.rows) await db.query('SELECT public.seed_november_punishments($1)', [id]);
  const thresholds = await seedNovemberFixtures(sql, preview);
  assert.deepEqual(await seedNovemberFixtures(sql, preview), thresholds);
  await verifyNovemberRollover(sql, fixtures);
  assert.deepEqual(await issues(), []);

  const westTask = thresholds.find(row => row.member_id === fixtures['rollover-west']).id;
  const pendingTask = thresholds.find(row => row.status === 'pending').id;
  await sql('BEGIN');
  await db.query("DELETE FROM public.punishment_actions WHERE punishment_id = $1 AND action = 'earned'", [westTask]);
  await db.query("UPDATE public.punishments SET status = 'canceled' WHERE id = $1", [westTask]);
  await db.query("UPDATE public.punishments SET status = 'awaiting_assignment' WHERE id = $1", [pendingTask]);
  assert.deepEqual((await issues()).map(row => row.issue),
    ['eligible_task_canceled', 'invalid_earned_action_count', 'task_assignable_before_deadline']);
  await sql('ROLLBACK');

  // A seed can make the deadline eligible after the caller's statement started.
  // This also happens when the visibility check waits for the seed's rollout lock.
  await sql(`DO $$
    BEGIN
      PERFORM pg_sleep(0.02);
      UPDATE public.nightly_strike_logs SET replacement_until = clock_timestamp()
      WHERE target_member_id = '${fixtures['rollover-west']}' AND sleep_cycle_date = '2026-11-03';
      PERFORM public.seed_november_punishments('${fixtures['rollover-west']}');
      PERFORM public.show_verified_november_punishments();
    END;
  $$;`);
  assert.equal(await sql(show), activation);
  assert.equal(await sql(visibility), 'true');
  await db.query("SELECT public.update_punishment($1, 'assign', 'fixture-moderator', 'Journal')", [westTask]);
  await db.query("SELECT public.update_punishment($1, 'complete', 'fixture-moderator')", [westTask]);
  await sql('UPDATE public.punishment_rollout SET screens_visible = false WHERE singleton');
  const source = await db.query(`SELECT id FROM public.nightly_strike_logs
    WHERE target_member_id = $1 AND sleep_cycle_date = '2026-11-03'`, [fixtures['rollover-west']]);
  await db.query(`SELECT public.record_verified_november_correction($1, '2026-11-03', 'verified-removal',
    'fixture-moderator', 'Verified check-in', $2)`, [fixtures['rollover-west'], source.rows[0].id]);
  assert.deepEqual(await issues(), []);
  assert.equal(await sql(show), activation);
  assert.equal(await sql(`SELECT status FROM public.punishments WHERE id = '${westTask}'`), 'completed');

  // Simulate a broken writer in a later month. The audit should flag its stray open task.
  await db.query(`UPDATE public.punishments SET earned_month = '2026-12-01', status = 'assigned' WHERE id = $1`, [westTask]);
  assert.equal(await sql("SELECT issue FROM public.punishment_ledger_issues('2026-12-01')"), 'ineligible_open_task');
  console.log('Verified that only operators can inspect discrepancies and that November visibility requires a reconciled ledger.');
} finally {
  await db.close();
}
