import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { DateTime } from 'luxon';

const db = new PGlite();
const schema = readFileSync('supabase/schema.sql', 'utf8').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const migration = readFileSync('supabase/migrations/20261130_private_strike_history.sql', 'utf8');
const migrationStart = schema.indexOf('-- Keep private nightly strike and pass history');
assert.ok(migrationStart > 0);
assert.equal(schema.slice(migrationStart, schema.indexOf('-- Install reviewed Metastrikes')).trim(), migration.trim());

const result = async (sql, args) => (await db.query(sql, args)).rows[0]?.result;
const history = (member, month = '2026-11') => result(
  'SELECT public.get_member_strike_history($1, $2, $3) AS result', [member.id, member.discord_id, month + '-01']);
const automaticReason = 'Automated 10-minute bedtime strike (missed bedtime check-in)';
let server;

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
  `);
  await db.exec(schema.slice(0, migrationStart));
  const { rows: [member, other, mod] } = await db.query(`
    INSERT INTO public.members (discord_username, discord_id, journal_url, bedtime_local, timezone, role)
    VALUES ('History Fox', '111', 'https://discord.com/channels/123/456', '23:00', 'Asia/Tokyo', 'member'),
      ('Other Fox', '222', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'member'),
      ('Staff Fox', '333', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'moderator')
    RETURNING id, discord_id
  `);
  await db.query(`
    INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, reason, created_at, updated_at)
    VALUES ($1, '2026-10-28', 'strike', NULL, '2026-10-28T13:00Z', '2026-10-28T13:10Z'),
      ($1, '2026-11-01', 'strike', $2, '2026-11-01T13:00Z', '2026-11-01T14:10Z'),
      ($1, '2026-11-02', 'strike', $2, '2026-11-02T13:00Z', '2026-11-02T14:10Z'),
      ($1, '2026-11-03', 'pending_vote', NULL, '2026-11-03T14:00Z', '2026-11-03T14:00Z'),
      ($1, '2026-11-05', 'metastrike', 'private legacy reason', '2026-11-05T13:00Z', '2026-11-05T13:00Z'),
      ($3, '2026-11-01', 'strike', 'other member evidence', '2026-11-01T23:10Z', '2026-11-01T23:10Z')
  `, [member.id, automaticReason, other.id]);
  const legacyRemoval = await result(`SELECT id AS result FROM public.nightly_strike_logs
    WHERE target_member_id = $1 AND sleep_cycle_date = '2026-11-01'`, [member.id]);
  const correct = async (cycle, key, source = null) => result(
    'SELECT public.record_verified_november_correction($1, $2, $3, $4, $5, $6) AS result',
    [member.id, cycle, key, mod.id, 'private staff evidence', source]);
  await correct('2026-11-01', 'legacy-clear', legacyRemoval);
  await db.query(`
    INSERT INTO public.strike_moderator_corrections (member_id, cycle_date, action, actor, reason, details, recorded_at)
    SELECT $1, '2026-11-02', 'moderator_pass', $2, 'private staff evidence', to_jsonb(n), '2026-11-02T15:00Z'
    FROM public.nightly_strike_logs AS n WHERE n.target_member_id = $1 AND n.sleep_cycle_date = '2026-11-02'
  `, [member.id, mod.id]);
  await db.query(`UPDATE public.nightly_strike_logs SET record_type = 'metastrike', updated_at = '2026-11-02T15:00Z'
    WHERE target_member_id = $1 AND sleep_cycle_date = '2026-11-02'`, [member.id]);
  await db.query("INSERT INTO public.sleep_logs (member_id, cycle_date, status) VALUES ($1, '2026-11-06', 'late')", [member.id]);
  await db.query(`INSERT INTO public.notification_logs (member_id, local_date, notification_type)
    VALUES ($1, '2026-11-06', 'AUTO_BEDTIME_STRIKE')`, [member.id]);

  await db.exec(migration);
  const afterUpgrade = await history(member);
  await db.exec(migration);
  assert.deepEqual(await history(member), afterUpgrade);
  assert.deepEqual(afterUpgrade.entries.map(e => [e.cycle_date, e.status, e.counts]), [
    ['2026-11-05', 'protected', false],
    ['2026-11-02', 'replaced', false],
    ['2026-11-02', 'protected', false],
    ['2026-11-01', 'removed', false],
  ]);
  const removal = afterUpgrade.entries.at(-1);
  assert.equal(removal.source_id, legacyRemoval);
  assert.equal(DateTime.fromISO(removal.issued_at).toUTC().toISO(), '2026-11-01T14:10:00.000Z');
  assert.ok(removal.changed_at);
  assert.equal(afterUpgrade.entries.find(e => e.status === 'replaced').changed_at, '2026-11-02T15:00:00+00:00');
  assert.equal(afterUpgrade.entries.find(e => e.cycle_date === '2026-11-02' && e.record_type === 'metastrike').replaced_strike, true);
  const legacy = (await history(member, '2026-10')).entries[0];
  assert.equal(legacy.issued_at, null);
  assert.equal(legacy.counts, true);
  assert.equal((await history(member, '2026-09')).entries.length, 0);
  assert.doesNotMatch(JSON.stringify(afterUpgrade), /private|other member|evidence_key|actor|reason/);

  // An inactive ledger still captures new history from the legacy writer.
  const legacyWrite = (cycle, previous, type, now) => result(`
    SELECT public.apply_nightly_strike($1, $2, '2026-11', $3, $4, $5, $6, '2026-11-01T00:00Z') AS result
  `, [member.id, cycle, previous, type, automaticReason, now]);
  const legacyStrike = await legacyWrite('2026-11-03', 'pending_vote', 'strike', '2026-11-03T14:10Z');
  assert.equal(legacyStrike.log.record_type, 'strike');
  await assert.rejects(legacyWrite('2026-11-03', 'pending_vote', 'strike', '2026-11-03T14:11Z'), /changed/);
  assert.equal((await history(member)).entries.filter(e => e.source_id === legacyStrike.log.id).length, 1);
  const clearedNightly = await correct('2026-11-03', 'live-clear', legacyStrike.log.id);
  assert.equal(await correct('2026-11-03', 'live-clear', legacyStrike.log.id), clearedNightly);
  assert.equal((await history(member)).entries.find(e => e.source_id === legacyStrike.log.id).status, 'removed');

  const manual = await correct('2026-11-04', 'dated-add');
  assert.equal(await correct('2026-11-04', 'dated-add'), manual);
  const countedManual = (await history(member)).entries.find(e => e.source_id === manual);
  assert.equal(countedManual.source_type, 'moderator');
  assert.equal(countedManual.issued_at, null);
  assert.equal(countedManual.counts, true);
  assert.ok(countedManual.recorded_at);
  await correct('2026-11-04', 'dated-remove', manual);
  const removedManual = (await history(member)).entries.find(e => e.source_id === manual);
  assert.equal(removedManual.recorded_at, countedManual.recorded_at);
  assert.ok(removedManual.changed_at);
  assert.equal(removedManual.status, 'removed');

  await db.exec("UPDATE public.punishment_rollout SET activated_at = '2026-11-01T00:00Z'");
  const write = (previous, type, at) => result(`
    SELECT public.apply_nightly_strike($1, '2026-11-30', '2026-12', $2, $3, $4, $5,
      '2026-12-01T00:00Z', '2026-11-30T15:10Z', '2099-12-01T14:00Z', $6,
      (SELECT strike_schedule_revision FROM public.members WHERE id = $1)) AS result
  `, [member.id, previous, type, automaticReason, at, type === 'clear' ? mod.id : null]);

  // A write rolled back after updating the nightly record leaves no history entry.
  await assert.rejects(db.transaction(async tx => {
    await tx.query(`INSERT INTO public.nightly_strike_logs
      (target_member_id, sleep_cycle_date, record_type) VALUES ($1, '2026-11-29', 'strike')`, [member.id]);
    throw new Error('rollback fixture');
  }), /rollback fixture/);
  assert.equal((await history(member)).entries.some(e => e.cycle_date === '2026-11-29'), false);

  const issued = await write(null, 'strike', '2026-12-01T00:10Z');
  assert.equal((await write(null, 'strike', '2026-12-01T00:11Z')).reason, 'already_issued');
  const rollover = (await history(member)).entries.filter(e => e.source_id === issued.log.id);
  assert.equal(rollover.length, 1);
  assert.equal(rollover[0].counts, true);
  assert.equal(rollover[0].cycle_date, '2026-11-30');
  assert.equal(rollover[0].issuance_timezone, 'Asia/Tokyo');
  assert.ok(DateTime.fromISO(rollover[0].issued_at).setZone('Asia/Tokyo').toISODate() >= '2026-12-01');
  assert.equal(rollover[0].replacement_until, '2099-12-01T14:00:00+00:00');
  assert.deepEqual((await history(member, '2026-12')).entries, []);
  assert.equal((await history(member)).entries.filter(e => e.counts).length, await result(`
    SELECT count(*)::int AS result FROM public.members m,
      LATERAL public.verified_monthly_strikes(m, '2026-11-01') WHERE m.id = $1
  `, [member.id]));

  await db.query("UPDATE public.members SET timezone = 'America/Los_Angeles' WHERE id = $1", [member.id]);
  assert.equal((await history(member)).timezone, 'America/Los_Angeles');
  assert.equal((await history(member)).entries[0].issuance_timezone, 'Asia/Tokyo');

  await write('strike', 'metastrike', '2026-12-01T00:12Z');
  await assert.rejects(write('strike', 'metastrike', '2026-12-01T00:13Z'), /changed/);
  const changed = (await history(member)).entries.filter(e => e.source_id === issued.log.id);
  assert.deepEqual(changed.map(e => e.status), ['replaced', 'protected']);
  assert.equal(changed[0].issued_at, rollover[0].issued_at);
  assert.ok(changed[0].changed_at);
  assert.equal(changed[1].replaced_strike, true);
  assert.equal(changed[1].issuance_timezone, 'America/Los_Angeles');
  await write('metastrike', 'clear', '2026-12-01T00:14Z');
  await write('metastrike', 'clear', '2026-12-01T00:14Z');
  assert.deepEqual((await history(member)).entries.slice(0, 2).map(e => e.status), ['replaced', 'reversed']);

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT * FROM public.nightly_strike_history'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM public.nightly_strike_logs'), /permission denied/);
    await assert.rejects(history(member), /permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.query("UPDATE public.members SET pending_timezone = 'GMT+05:30', pending_effective_at = now() - interval '1 hour' WHERE id = $1", [member.id]);
  await db.exec('SET ROLE service_role');
  assert.equal((await history(member)).timezone, 'GMT+05:30');
  await assert.rejects(db.query('SELECT * FROM public.nightly_strike_history'), /permission denied/);
  await db.exec('RESET ROLE');
  await db.query('UPDATE public.members SET pending_timezone = NULL, pending_effective_at = NULL WHERE id = $1', [member.id]);

  let failHistory = false;
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url, 'http://localhost');
    try {
      switch (url.pathname) {
        case '/rest/v1/rpc/get_member_strike_history': {
          if (failHistory) return res.writeHead(500).end(JSON.stringify({ code: '57014', message: 'private query data' }));
          let raw = '';
          for await (const chunk of req) raw += chunk;
          const { p_member_id, p_discord_id, p_month } = JSON.parse(raw);
          return res.end(JSON.stringify(await result(
            'SELECT public.get_member_strike_history($1, $2, $3) AS result', [p_member_id, p_discord_id, p_month])));
        }
        case '/rest/v1/members': {
          const id = url.searchParams.get('id')?.slice(3);
          const { rows } = id ? await db.query('SELECT * FROM public.members WHERE id = $1', [id])
            : await db.query('SELECT * FROM public.members WHERE is_active');
          for (const profile of rows) {
            profile.strike_cycle_month = DateTime.utc().setZone(profile.timezone).toFormat('yyyy-MM');
          }
          return res.end(JSON.stringify(id ? rows[0] : rows.map(profile => ({ ...profile, metastrike_reason: 'Legacy roster secret' }))));
        }
        case '/rest/v1/rpc/get_member_punishments': {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          const { p_member_id, p_discord_id, p_details } = JSON.parse(raw);
          return res.end(JSON.stringify(await result('SELECT public.get_member_punishments($1,$2,$3) AS result',
            [p_member_id, p_discord_id, p_details])));
        }
        case '/rest/v1/sleep_logs': {
          if (!url.searchParams.has('member_id')) return res.end('[]');
          const { rows } = await db.query('SELECT * FROM public.sleep_logs WHERE member_id = $1',
            [url.searchParams.get('member_id').slice(3)]);
          return res.end(JSON.stringify(rows));
        }
        case '/rest/v1/nightly_strike_logs': {
          if (url.searchParams.get('target_member_id')?.startsWith('in.')) {
            const filters = url.searchParams.get('sleep_cycle_date');
            if (!filters?.startsWith('in.')) return res.end('[]');
            const dates = filters.slice(4,-1).split(',');
            const { rows } = await db.query('SELECT * FROM public.nightly_strike_logs WHERE sleep_cycle_date = ANY($1::text[])', [dates]);
            return res.end(JSON.stringify(rows));
          }
          assert.equal(url.searchParams.get('select'), 'sleep_cycle_date,record_type');
          const { rows } = await db.query('SELECT sleep_cycle_date, record_type FROM public.nightly_strike_logs WHERE target_member_id = $1',
            [url.searchParams.get('target_member_id').slice(3)]);
          return res.end(JSON.stringify(rows.filter(row => row.sleep_cycle_date.startsWith('2026-11'))));
        }
        case '/rest/v1/notification_logs':
          return res.end('[]');
        default:
          return res.writeHead(404).end('{}');
      }
    } catch (error) {
      const status = /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : 500;
      res.writeHead(status).end(JSON.stringify({ code: error.code, message: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:' + server.address().port;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
  process.env.SESSION_SECRET = 'test-secret-strike-history';

  const { createSessionToken } = await import('../src/lib/auth.ts');
  const { GET: getStrikes } = await import('../src/app/api/members/strikes/route.ts');
  const { GET: getSleep } = await import('../src/app/api/members/sleep-history/route.ts');
  const { GET: getRoster } = await import('../src/app/api/members/route.ts');
  const { getSleepCycleDate } = await import('../src/lib/sleepEngine.ts');
  const request = (who, extra = '', discordId = who?.discord_id) => new Request(
    'http://localhost/api/members/strikes?month=2026-11' + extra,
    who ? { headers: { Cookie: 'zcatchers_session=' + createSessionToken({ memberId: who.id, discordId }) } } : {});
  async function expectHistory(req, status) {
    const response = await getStrikes(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    return response.json();
  }
  await expectHistory(request(null), 401);
  await expectHistory(request(member, '&memberId=' + other.id), 403);
  await expectHistory(request(mod, '&memberId=' + member.id), 403);
  await expectHistory(request(member, '', other.discord_id), 403);
  for (const month of ['', '2026-13', '2026-11-30', '0000-11']) {
    await expectHistory(new Request(request(member).url.replace('2026-11', month), request(member)), 400);
  }
  const privateRead = await expectHistory(request(member), 200);
  assert.deepEqual(privateRead, await history(member));
  await db.query('UPDATE public.members SET is_active = false WHERE id = $1', [member.id]);
  await expectHistory(request(member), 403);
  await db.query('UPDATE public.members SET is_active = true WHERE id = $1', [member.id]);

  failHistory = true;
  const originalError = console.error;
  const diagnostics = [];
  console.error = (...args) => diagnostics.push(args);
  try {
    assert.deepEqual(await expectHistory(request(member), 503), { error: 'Strike history is currently unavailable.' });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(diagnostics, [['[strikes] Monthly history read failed', { databaseCode: '57014' }]]);
  const shared = await getSleep(new Request('http://localhost/api/members/sleep-history?month=2026-11&memberId=' + member.id,
    request(other)));
  assert.equal(shared.status, 200);
  const sharedBody = await shared.json();
  assert.equal(sharedBody.logs.find(log => log.cycle_date === '2026-11-06').status, 'late');
  assert.equal(privateRead.entries.some(e => e.cycle_date === '2026-11-06'), false);
  assert.doesNotMatch(JSON.stringify(sharedBody), /source_id|issued_at|changed_at|replacement_until|private staff evidence|private legacy reason/);

  const { rows: [currentProfile] } = await db.query('SELECT * FROM public.members WHERE id = $1', [other.id]);
  const cycle = getSleepCycleDate(currentProfile, DateTime.utc(), false);
  await db.query(`INSERT INTO public.nightly_strike_logs (target_member_id, sleep_cycle_date, record_type, reason)
    VALUES ($1, $2, 'metastrike', 'Private nightly roster secret') ON CONFLICT (target_member_id, sleep_cycle_date)
    DO UPDATE SET record_type = EXCLUDED.record_type, reason = EXCLUDED.reason`, [other.id, cycle]);
  for (const viewer of [null, other, member, mod]) {
    const roster = await getRoster(new Request('http://localhost/api/members', request(viewer)));
    assert.equal(roster.status, 200);
    assert.equal(roster.headers.get('Cache-Control'), 'private, no-store');
    const body = await roster.json();
    const row = body.members.find(profile => profile.id === other.id);
    assert.equal(row.is_metastrike_active, true);
    assert.equal(row.tonight_strike_log.record_type, 'metastrike');
    assert.equal('reason' in row.tonight_strike_log, false);
    assert.doesNotMatch(JSON.stringify(body), /metastrike_reason|roster secret/i);
  }

  await db.query('DELETE FROM public.members WHERE id = $1', [member.id]);
  assert.equal(await result('SELECT count(*)::int AS result FROM public.nightly_strike_history WHERE member_id = $1',
    [member.id]), 0);
  console.log('Verified migration, transaction capture, original timestamps, dated corrections, rollover, retry, and private monthly reads.');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
}
