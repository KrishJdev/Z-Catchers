import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { DateTime } from 'luxon';
import { hasRosterSleepShield } from '../src/lib/sleepEngine.ts';

const schema = readFileSync('supabase/schema.sql', 'utf8').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const migration = readFileSync('supabase/migrations/20261124_guard_active_wake.sql', 'utf8');
const migrationStart = schema.indexOf(migration);
assert.ok(migrationStart > 0, 'The fresh-install schema mirrors the active wake migration');

const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
  `);
  await db.exec(schema.slice(0, migrationStart));
  const date = '2026-11-20';
  const checkedInAt = '2026-11-20T23:00:00Z';
  const changedAt = '2026-11-20T23:30:00Z';
  const wakeAt = '2026-11-21T06:35:00Z';
  const earlierWake = '2026-11-21T06:20:00Z';
  const insertMember = async (discordId, timestamp) => {
    const { rows: [member] } = await db.query(`
      INSERT INTO public.members (discord_username, discord_id, journal_url, bedtime_local, timezone,
        last_notified_cycle_date, last_notified_stage)
      VALUES ($1, $1, 'https://discord.com/channels/123/456', '23:00', 'UTC', $2, 'IN_BED_EARLY')
      RETURNING id
    `, [discordId, date]);
    if (timestamp) {
      await db.query(`INSERT INTO public.notification_logs (member_id, notification_type, local_date, dispatched_at)
        VALUES ($1, 'IN_BED_EARLY', $2, $3)`, [member.id, date, timestamp]);
    }
    return member.id;
  };
  const mainMemberId = await insertMember('101', checkedInAt);
  const replacedMemberId = await insertMember('202', changedAt);
  const legacyMemberId = await insertMember('303', null);
  const alreadyLoggedId = await insertMember('404', checkedInAt);
  await db.query(`INSERT INTO public.sleep_logs (member_id, cycle_date, in_bed_at, woke_up_at)
    VALUES ($1, $3, $4, NULL), ($2, $3, $4, $5)`, [mainMemberId, alreadyLoggedId, date, checkedInAt, wakeAt]);

  // Applying the migration to a database with open check-ins changes none of those records.
  await db.exec(migration);
  const record = async (memberId, discordId, expectedInBedAt, time = wakeAt, source = 'manual') => {
    const wake = DateTime.fromISO(time, { zone: 'utc' });
    const { rows: [{ result }] } = await db.query(`
      SELECT public.complete_active_check_in($1, $2, $3) AS result
    `, [discordId, expectedInBedAt, JSON.stringify({
      member_id: memberId, cycle_date: date, timezone: 'UTC', target_bedtime: '23:00', target_wake_time: '07:00',
      in_bed_at: expectedInBedAt, in_bed_local_time: expectedInBedAt ? '23:00' : null, woke_up_at: time,
      woke_up_local_time: wake.toFormat('HH:mm'), wake_source: source, duration_minutes: 455, status: 'on_time',
    })]);
    return result;
  };

  await assert.rejects(() => record(replacedMemberId, '202', checkedInAt), { code: 'PT409' });
  await assert.rejects(() => record(alreadyLoggedId, '404', checkedInAt, earlierWake), { code: 'PT409' });
  await assert.rejects(() => record(mainMemberId, 'unknown', checkedInAt), { code: 'PT403' });
  const first = await record(mainMemberId, '101', checkedInAt, wakeAt, 'button');
  assert.equal(first.member.last_notified_stage, null);
  assert.equal(first.member.last_wake_cycle_date, date);
  assert.equal(first.sleep_log.woke_up_local_time, '06:35');
  await assert.rejects(() => record(mainMemberId, '101', checkedInAt, earlierWake), { code: 'PT409' });
  const { rows: [saved] } = await db.query(`
    SELECT sl.woke_up_local_time, m.last_notified_stage,
      (SELECT count(*)::integer FROM public.notification_logs WHERE member_id = $1 AND notification_type = 'WOKE_UP') AS receipts
    FROM public.sleep_logs AS sl JOIN public.members AS m ON m.id = sl.member_id WHERE m.id = $1
  `, [mainMemberId]);
  assert.deepEqual(saved, { woke_up_local_time: '06:35', last_notified_stage: null, receipts: 1 });
  const legacy = await record(legacyMemberId, '303', null);
  assert.equal(legacy.sleep_log.in_bed_at, null);
  assert.equal(legacy.member.last_wake_cycle_date, date);

  await db.exec('SET ROLE authenticated');
  await assert.rejects(() => record(replacedMemberId, '202', changedAt), { code: '42501' });
} finally {
  await db.close();
}

const member = { timezone: 'UTC', bedtime_local: '23:00', wake_time_local: '07:00' };
const overdue = DateTime.fromISO('2026-11-20T23:20:00Z', { zone: 'utc' });
assert.equal(hasRosterSleepShield(member, overdue), false);
assert.equal(hasRosterSleepShield({ ...member, is_metastrike_active: true }, overdue), true);
assert.equal(hasRosterSleepShield({ ...member, is_in_bed: true }, overdue), true);
const rested = { ...member, last_wake_cycle_date: '2026-11-20', is_woke_up: true };
assert.equal(hasRosterSleepShield(rested, overdue.plus({ hours: 6 })), true);
assert.equal(hasRosterSleepShield(rested, overdue.plus({ hours: 8 })), false);

console.log('Active wake transactions and the roster Sleep Shield projection passed.');
