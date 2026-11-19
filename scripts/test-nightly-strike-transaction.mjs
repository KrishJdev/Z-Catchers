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
  await db.exec(`drop function public.apply_nightly_strike(uuid,text,text,text,text,text,timestamptz,timestamptz);
    drop function public.claim_manual_nag(uuid,text,date,timestamptz);
    drop table public.cron_locks, public.nightly_strike_logs;
    alter table members drop column strikes_count;
    create policy "Public can view active members" on members for select using (is_active);
    create policy "Public can register push subscriptions" on push_subscriptions for insert with check (true);`);
  const migration = readFileSync('supabase/migrations/20261119_dispatch_accountability.sql', 'utf8');
  const convertKeys = readFileSync('supabase/migrations/20261118_sleep_logs_member_uuid.sql', 'utf8');
  await db.exec(`alter table public.sleep_logs drop constraint sleep_logs_member_id_fkey;
    alter table public.sleep_logs alter column member_id type text using member_id::text;
    insert into public.sleep_logs(member_id, cycle_date)
      values ((select upper(id::text) from public.members limit 1), '2026-11-01'), ('legacy-orphan', '2026-11-02');`);
  await assert.rejects(db.exec(migration), /requires sleep_logs.member_id to be UUID/);
  await assert.rejects(db.exec(convertKeys), /invalid or orphan member IDs/);
  assert.equal((await db.query('select member_id from public.sleep_logs')).rows.length, 2);
  await db.exec("delete from public.sleep_logs where member_id = 'legacy-orphan'");
  await db.exec(convertKeys);
  await db.exec(convertKeys);
  assert.equal((await db.query("select pg_typeof(member_id)::text as type from public.sleep_logs")).rows[0].type, 'uuid');
  await assert.rejects(db.query("insert into public.sleep_logs(member_id, cycle_date) values (gen_random_uuid(), '2026-11-03')"), /foreign key/);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`grant select, update on public.members to service_role;
    grant select, insert, update on public.notification_logs to service_role;
    grant select, insert on public.sleep_logs to service_role;
    set role service_role;
    insert into public.cron_locks(lock_key, expires_at) values ('upgrade-test', now());`);
  const { rows: [member] } = await db.query('select id from members limit 1');
  const claim = async at => (await db.query(
    "select claim_manual_nag($1,'MANUAL_NAG:OVERDUE:anon_target','2026-11-19',$2) as remaining",
    [member.id, at])).rows[0].remaining;
  assert.equal(await claim('2026-11-19T23:00Z'), 0);
  assert.equal(await claim('2026-11-19T23:00Z'), 900);
  assert.equal(await claim('2026-11-19T23:14:59Z'), 1);
  assert.equal(await claim('2026-11-19T23:15Z'), 0);
  const apply = async (cycle, previous, type) => {
    const { rows: [row] } = await db.query(
      "select apply_nightly_strike($1,$2,'2026-11',$3,$4,'test','2026-11-19 00:10Z','2026-11-01 00:00Z') as result",
      [member.id, cycle, previous, type]);
    return row.result;
  };
  assert.equal((await apply('2026-11-16', null, 'strike')).strikesUsed, 1);
  await assert.rejects(db.query(
    "select apply_nightly_strike($1,'2026-10-31','2026-10',null,'strike','test','2026-10-31 23:50Z','2026-10-01 00:00Z')",
    [member.id]), { code: 'PT409' });
  assert.equal((await db.query('select strikes_used from members where id = $1', [member.id])).rows[0].strikes_used, 1);
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
  await db.exec('reset role; alter table members add constraint test_write_failure check (strikes_used = 0); set role service_role');
  await assert.rejects(apply('2026-11-20', null, 'strike'), /test_write_failure/);
  const { rows } = await db.query("select * from nightly_strike_logs where sleep_cycle_date = '2026-11-20'");
  assert.equal(rows.length, 0);
  await db.exec('reset role; alter table members drop constraint test_write_failure; set role service_role');
  const { rows: [{ result: december }] } = await db.query(
    "select apply_nightly_strike($1,'2026-12-01','2026-12',null,'strike','test','2026-12-01 00:10Z','2026-12-01 00:00Z') as result",
    [member.id]);
  assert.equal(december.strikesUsed, 1);
  assert.equal(december.metastrikesUsed, 0);
  await db.exec(`reset role;
    grant select on members, public.cron_locks, public.nightly_strike_logs to anon;
    grant insert on push_subscriptions to anon;
    set role anon`);
  assert.equal((await db.query('select id from members')).rows.length, 0);
  assert.equal((await db.query('select lock_key from public.cron_locks')).rows.length, 0);
  assert.equal((await db.query('select id from public.nightly_strike_logs')).rows.length, 0);
  await assert.rejects(db.query("insert into push_subscriptions(member_id, endpoint, p256dh_key, auth_key) values ($1,'test','test','test')", [member.id]), /row-level security/);
  await assert.rejects(apply('2026-11-21', null, 'strike'), /permission denied/);
  await db.exec(`reset role;
    create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
    create schema cron; create table cron.jobs(name text primary key, schedule text, command text);
    create function cron.schedule(text,text,text) returns void language sql as
      'insert into cron.jobs values ($1,$2,$3) on conflict (name) do update set command = excluded.command';
    create schema net; create function net.http_get(url text, headers jsonb, timeout_milliseconds integer)
      returns jsonb language sql as 'select jsonb_build_object(''url'', url, ''headers'', headers, ''timeout'', timeout_milliseconds)';`);
  const schedule = readFileSync('supabase/schedule_dispatch.sql', 'utf8');
  await assert.rejects(db.exec(schedule), /Vault first/);
  await db.exec("insert into vault.decrypted_secrets values ('zcatchers_app_url','https://unit.invalid/'), ('zcatchers_cron_secret','fixture')");
  await db.exec(schedule);
  await db.exec(schedule);
  const jobs = (await db.query('select * from cron.jobs')).rows;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].schedule, '* * * * *');
  const request = async () => (await db.query(jobs[0].command)).rows[0].http_get;
  assert.deepEqual(await request(), {
    url: 'https://unit.invalid/api/cron/dispatch-notifications',
    headers: { Authorization: 'Bearer fixture' },
    timeout: 55000,
  });
  await db.exec("insert into vault.decrypted_secrets values ('zcatchers_vercel_bypass','preview-fixture')");
  assert.equal((await request()).headers['x-vercel-protection-bypass'], 'preview-fixture');
} finally {
  await db.close();
}
