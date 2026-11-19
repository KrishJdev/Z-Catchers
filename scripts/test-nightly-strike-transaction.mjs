import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';`);
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  // gen_random_uuid is built into PostgreSQL. PGlite omits the optional pgcrypto extension.
  const localSchema = schema.replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
  await db.exec(localSchema);
  await db.exec(localSchema);
  assert.equal((await db.query('select id from members')).rows.length, 4);
  await db.exec(`alter table members drop column strikes_count;
    create policy "Public can view active members" on members for select using (is_active);
    create policy "Public can register push subscriptions" on push_subscriptions for insert with check (true);`);
  await db.exec(readFileSync('supabase/migrations/20261119_dispatch_accountability.sql', 'utf8'));
  const { rows: [member] } = await db.query('select id from members limit 1');
  const claim = async at => (await db.query(
    "select claim_manual_nag($1,'MANUAL_NAG:OVERDUE:anon_target','2026-11-19',$2) as remaining",
    [member.id, at])).rows[0].remaining;
  assert.deepEqual(await Promise.all([claim('2026-11-19T23:00Z'), claim('2026-11-19T23:00Z')]), [0, 900]);
  assert.equal(await claim('2026-11-19T23:14:59Z'), 1);
  assert.equal(await claim('2026-11-19T23:15Z'), 0);
  const apply = async (cycle, previous, type) => {
    const { rows: [row] } = await db.query(
      "select apply_nightly_strike($1,$2,'2026-11',$3,$4,'test','2026-11-19 00:10Z','2026-11-01 00:00Z') as result",
      [member.id, cycle, previous, type]);
    return row.result;
  };
  assert.equal((await apply('2026-11-16', null, 'strike')).strikesUsed, 1);
  await assert.rejects(apply('2026-11-16', null, 'strike'), /changed/);
  const converted = await apply('2026-11-16', 'strike', 'metastrike');
  assert.equal(converted.strikesUsed, 0);
  assert.equal(converted.metastrikesUsed, 1);
  await assert.rejects(apply('2026-11-16', null, 'strike'), /changed/);
  await db.query("insert into sleep_logs(member_id,cycle_date,in_bed_at) values ($1,'2026-11-17',now())", [member.id]);
  assert.equal((await apply('2026-11-17', null, 'strike')).reason, 'already_checked_in');
  await apply('2026-11-18', null, 'metastrike');
  await apply('2026-11-19', null, 'metastrike');
  await assert.rejects(apply('2026-11-20', null, 'metastrike'), /all 3/);
  const cleared = await apply('2026-11-19', 'metastrike', 'clear');
  assert.equal(cleared.metastrikesUsed, 2);
  await assert.rejects(apply('2026-11-19', 'metastrike', 'clear'), /changed/);

  // Force a failure in the second write. Both tables must retain the original state.
  await db.exec('alter table members add constraint test_write_failure check (strikes_used = 0)');
  await assert.rejects(apply('2026-11-20', null, 'strike'), /test_write_failure/);
  const { rows } = await db.query("select * from nightly_strike_logs where sleep_cycle_date = '2026-11-20'");
  assert.equal(rows.length, 0);
  await db.exec('grant select on members to anon; grant insert on push_subscriptions to anon; set role anon');
  assert.equal((await db.query('select id from members')).rows.length, 0);
  await assert.rejects(db.query("insert into push_subscriptions(member_id, endpoint, p256dh_key, auth_key) values ($1,'test','test','test')", [member.id]), /row-level security/);
  await assert.rejects(apply('2026-11-21', null, 'strike'), /permission denied/);
  await db.exec(`reset role;
    create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
    create schema cron; create table cron.jobs(name text primary key, schedule text, command text);
    create function cron.schedule(text,text,text) returns void language sql as
      'insert into cron.jobs values ($1,$2,$3) on conflict (name) do update set command = excluded.command';
    create schema net; create function net.http_get(url text, headers jsonb, timeout_milliseconds integer)
      returns text language sql as 'select url || chr(32) || (headers->>''Authorization'')';`);
  const schedule = readFileSync('supabase/schedule_dispatch.sql', 'utf8');
  await assert.rejects(db.exec(schedule), /Vault first/);
  await db.exec("insert into vault.decrypted_secrets values ('zcatchers_app_url','https://unit.invalid/'), ('zcatchers_cron_secret','fixture')");
  await db.exec(schedule);
  await db.exec(schedule);
  const jobs = (await db.query('select * from cron.jobs')).rows;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].schedule, '* * * * *');
  assert.equal((await db.query(jobs[0].command)).rows[0].http_get,
    'https://unit.invalid/api/cron/dispatch-notifications Bearer fixture');
} finally {
  await db.close();
}
