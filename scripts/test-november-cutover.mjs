import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  insertLegacyNovemberFixtures, seedNovemberFixtures, verifyNovemberPreview, verifyNovemberRollover,
} from './fixtures/november-cutover-smoke.mjs';

const db = new PGlite();
const ledger = readFileSync('supabase/migrations/20261122_punishment_strike_ledger.sql', 'utf8');
const schema = readFileSync('supabase/schema.sql', 'utf8').split(ledger.split('\n', 1)[0])[0]
  .replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const taskApi = readFileSync('supabase/migrations/20261123_punishment_task_apis.sql', 'utf8');

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
  await sql(schema);
  const fixtures = await insertLegacyNovemberFixtures(sql);
  await sql(ledger);
  assert.equal(await sql('SELECT count(*) FROM public.punishments'), '0');
  await sql(taskApi);
  const preview = await verifyNovemberPreview(sql, fixtures);
  await assert.rejects(sql(`SELECT public.seed_november_punishments('${fixtures['rollover-east']}')`), { code: 'PT409' });
  await sql('UPDATE public.punishment_rollout SET activated_at = clock_timestamp() WHERE singleton');
  const thresholds = await seedNovemberFixtures(sql, preview);
  assert.deepEqual(await seedNovemberFixtures(sql, preview), thresholds);
  await verifyNovemberRollover(sql, fixtures);
  console.log('Verified the migrated November fixtures, inactive seed fence, idempotent active seed and timezone rollover.');
} finally {
  await db.close();
}
