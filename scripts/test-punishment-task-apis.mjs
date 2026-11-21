import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { DateTime } from 'luxon';

const db = new PGlite();
const schema = readFileSync('supabase/schema.sql', 'utf8').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const migration = readFileSync('supabase/migrations/20261123_punishment_task_apis.sql', 'utf8');
assert.equal('-- Expose the punishment workflow' + schema.split('-- Expose the punishment workflow')[1], migration);
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
`);
await db.exec(schema);
await db.exec(migration);

const { rows: members } = await db.query(`INSERT INTO public.members
  (discord_username, discord_id, journal_url, bedtime_local, timezone, role)
  VALUES ('Member', '111', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'member'),
    ('Other Member', '222', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'member'),
    ('Database Mod', '333', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'moderator'),
    ('Discord Mod', '444', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'member')
  RETURNING id, discord_id, role, is_active`);
const [member, other, dbMod, discordMod] = members;

await db.query(`INSERT INTO public.nightly_strike_logs
  (target_member_id, sleep_cycle_date, record_type, updated_at, replacement_until)
  VALUES ($1, '2026-11-01', 'strike', '2026-11-01T23:10Z', '2026-11-02T23:00Z'),
    ($1, '2026-11-02', 'strike', '2026-11-02T23:10Z', '2026-11-03T23:00Z'),
    ($1, '2026-11-03', 'strike', '2026-11-03T23:10Z', '2026-11-04T23:00Z'),
    ($1, '2026-11-04', 'strike', '2026-11-04T23:10Z', '2026-11-05T23:00Z'),
    ($1, '2026-11-05', 'strike', '2026-11-05T23:10Z', '2026-11-06T23:00Z'),
    ($1, '2026-11-06', 'strike', '2026-11-06T23:10Z', clock_timestamp() + interval '2 hours'),
    ($1, '2026-11-07', 'pending_vote', '2026-11-07T23:10Z', NULL)`, [member.id]);

// Exercise real route handlers and signed sessions with PGlite behind a small Data API fixture.
const rpc = {
  get_member_punishments: ['p_member_id', 'p_discord_id', 'p_details'],
  get_moderator_punishments: ['p_id', 'p_status', 'p_offset'],
  update_punishment: ['p_id', 'p_action', 'p_actor', 'p_title', 'p_instructions',
    'p_cycle', 'p_source', 'p_reason', 'p_request_id'],
};
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/rest/v1/members') {
    const memberId = url.searchParams.get('id')?.slice(3);
    return res.end(JSON.stringify(members.find(row => row.id === memberId) ?? null));
  }
  const name = url.pathname.split('/').at(-1);
  if (!rpc[name]) return res.writeHead(404).end('{}');
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const placeholders = rpc[name].map((_, index) => '$' + (index + 1));
    const { rows } = await db.query(`SELECT public.${name}(${placeholders.join(',')}) AS result`,
      rpc[name].map(key => body[key] ?? null));
    res.end(JSON.stringify(rows[0].result));
  } catch (error) {
    const status = /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : 500;
    res.writeHead(status).end(JSON.stringify({ code: error.code, message: error.message }));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

try {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:' + server.address().port;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
  process.env.SESSION_SECRET = 'test-session-secret-for-punishment-task-apis';
  process.env.MOD_DISCORD_IDS = discordMod.discord_id;

  const { createSessionToken } = await import('../src/lib/auth.ts');
  const { GET: getMember } = await import('../src/app/api/members/punishments/route.ts');
  const { GET: getMod, POST: postMod } = await import('../src/app/api/mod/punishments/route.ts');
  const { getOpenPunishmentCount } = await import('../src/lib/punishments.ts');
  const cookie = (row, discordId = row.discord_id, isModerator = false) => 'zcatchers_session=' +
    createSessionToken({ memberId: row.id, discordId, isModerator });
  const memberCookie = cookie(member);
  const dbModCookie = cookie(dbMod);
  const discordModCookie = cookie(discordMod);
  const get = (handler, session, query = '') => handler(new Request('http://localhost/punishments' + query,
    { headers: session ? { Cookie: session } : {} }));
  const post = (session, body) => postMod(new Request('http://localhost/punishments', {
    method: 'POST',
    headers: { Cookie: session ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  async function expect(result, status = 200) {
    const response = await result;
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    return body;
  }

  await expect(get(getMember), 401);
  await expect(get(getMember, memberCookie, '?memberId=' + other.id), 403);
  await expect(get(getMember, cookie(member, other.discord_id)), 403);
  await expect(get(getMod, cookie(member, member.discord_id, true)), 401);
  await expect(get(getMod, dbModCookie), 503);
  await expect(get(getMember, memberCookie), 503);
  assert.equal(await getOpenPunishmentCount(member.id, member.discord_id), null);

  await db.exec("UPDATE public.punishment_rollout SET activated_at = '2026-11-01T00:00Z'");
  await db.query('SELECT public.seed_november_punishments($1)', [member.id]);
  await expect(get(getMember, memberCookie), 503);
  await db.exec('UPDATE public.punishment_rollout SET screens_visible = true');
  assert.equal(await getOpenPunishmentCount(member.id, other.discord_id), null);
  assert.equal(await getOpenPunishmentCount(other.id, other.discord_id), 0);
  assert.equal(await getOpenPunishmentCount(member.id, member.discord_id), 2);
  const summary = await expect(get(getMember, memberCookie));
  const [ready, pending] = summary.open_items;
  assert.equal(summary.member_id, member.id);
  assert.equal(summary.month, DateTime.utc().toFormat('yyyy-MM'));
  assert.equal(summary.open_count, 2);
  assert.equal(summary.strikes_used, summary.month === '2026-11' ? 6 : 0);
  assert.equal(summary.strikes_toward_next, 0);
  assert.deepEqual(summary.history, []);
  assert.equal(ready.status, 'awaiting_assignment');
  assert.equal(pending.status, 'pending');
  assert.equal((await expect(get(getMember, cookie(other)))).open_count, 0);

  const queue = await expect(get(getMod, dbModCookie));
  assert.deepEqual(queue.items.map(item => item.id), [ready.id]);
  assert.equal(queue.items[0].member_name, 'Member');
  assert.deepEqual((await expect(get(getMod, discordModCookie, '?status=pending'))).items.map(item => item.id), [pending.id]);
  const detail = await expect(get(getMod, discordModCookie, '?punishment_id=' + ready.id));
  assert.equal(detail.verified_strikes.length, 6);
  const assignment = { action: 'assign', punishment_id: ready.id, title: '  Wind-down plan  ' };
  await expect(post(null, assignment), 401);
  await expect(post(memberCookie, assignment), 401);
  await expect(post(dbModCookie, { ...assignment, member_id: other.id }), 400);
  await expect(post(dbModCookie, { ...assignment, punishment_id: pending.id }), 409);
  await expect(post(dbModCookie, { ...assignment, title: ' '.repeat(10) }), 400);
  assert.equal((await expect(post(dbModCookie, assignment))).item.title, 'Wind-down plan');
  assert.equal((await expect(post(dbModCookie, assignment))).open_count, 2);

  const edit = { action: 'edit', punishment_id: ready.id, title: 'Journal', instructions: 'Two lines' };
  assert.equal((await expect(post(discordModCookie, edit))).item.instructions, 'Two lines');
  await expect(post(discordModCookie, edit));
  const completion = { action: 'complete', punishment_id: ready.id };
  for (let i = 0; i < 2; i += 1) {
    const result = await expect(post(dbModCookie, completion));
    assert.equal(result.item.status, 'completed');
    assert.equal(result.open_count, 1);
  }

  const source = detail.verified_strikes.at(-1);
  const correction = { action: 'remove_strike', punishment_id: pending.id,
    cycle_date: source.cycle_date, source_id: source.source_id, reason: 'Corrected check-in', request_id: other.id };
  await expect(post(memberCookie, correction), 401);
  await expect(post(discordModCookie, { ...correction, cycle_date: '2026-12-06' }), 400);
  const removed = await expect(post(discordModCookie, correction));
  assert.equal(removed.item.status, 'canceled');
  assert.equal(removed.open_count, 0);
  assert.equal((await expect(post(discordModCookie, correction))).correction_id, removed.correction_id);
  await expect(post(discordModCookie, { ...correction, reason: 'Conflicting retry' }), 409);

  const afterCorrection = await expect(get(getMember, memberCookie));
  assert.equal(afterCorrection.open_count, 0);
  assert.deepEqual(afterCorrection.open_items, []);
  assert.equal(afterCorrection.history[0].title, 'Journal');
  if (summary.month === '2026-11') assert.equal(afterCorrection.strikes_toward_next, 2);

  const restored = await expect(post(discordModCookie, {
    action: 'add_strike', punishment_id: pending.id, cycle_date: '2026-11-06', request_id: dbMod.id, reason: 'Verified missed check-in',
  }));
  assert.equal(restored.item.id, pending.id);
  assert.equal(restored.item.status, 'awaiting_assignment');
  assert.equal(restored.open_count, 1);
  const { rows: audit } = await db.query(`SELECT action, actor, occurred_at FROM public.punishment_actions
    WHERE punishment_id = $1 AND action IN ('assigned', 'edited', 'completed') ORDER BY id`, [ready.id]);
  assert.deepEqual(audit.map(({ action, actor }) => [action, actor]),
    [['assigned', dbMod.id], ['edited', discordMod.id], ['completed', dbMod.id]]);
  assert.ok(audit.every(row => row.occurred_at));

  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT public.get_member_punishments($1, $2, true)', [member.id, member.discord_id]), /permission denied/);
  await assert.rejects(db.query("SELECT public.get_moderator_punishments(NULL, 'assigned', 0)"), /permission denied/);
  await assert.rejects(db.query("SELECT public.update_punishment($1, 'complete', 'fake')", [ready.id]), /permission denied/);
} finally {
  await new Promise(resolve => server.close(resolve));
  await db.close();
}
