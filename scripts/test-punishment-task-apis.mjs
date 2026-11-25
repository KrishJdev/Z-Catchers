import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { DateTime } from 'luxon';

const db = new PGlite();
const schema = readFileSync('supabase/schema.sql', 'utf8').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const migration = readFileSync('supabase/migrations/20261123_punishment_task_apis.sql', 'utf8');
assert.equal('-- Expose the punishment workflow' + schema.split('-- Expose the punishment workflow')[1].split('\n-- Complete a specific open check-in')[0], migration);
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
`);
await db.exec(schema);
await db.exec(readFileSync('supabase/migrations/20261128_punishment_diagnostics.sql', 'utf8'));

const { rows: members } = await db.query(`INSERT INTO public.members
  (discord_username, discord_id, journal_url, bedtime_local, timezone, role)
  VALUES ('Member', '111', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'member'),
    ('Other Member', '222', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'member'),
    ('Database Mod', '333', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'moderator'),
    ('Other Mod', '444', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'moderator'),
    ('Owner', '555', 'https://discord.com/channels/123/456', '23:00', 'UTC', 'owner')
  RETURNING id, discord_id, role, is_active`);
const [member, other, dbMod, secondMod, owner] = members;

// At this instant Los Angeles is in November and Tokyo is in December.
const boundary = '2026-11-30T23:30Z';
const progressMonth = async effectiveAt => {
  await db.query(`UPDATE public.members SET timezone = 'America/Los_Angeles',
    pending_timezone = 'Asia/Tokyo', pending_effective_at = $2 WHERE id = $1`, [member.id, effectiveAt]);
  const { rows: [{ month }] } = await db.query(`SELECT to_char(public.punishment_progress_month(m, $2), 'YYYY-MM') AS month
    FROM public.members AS m WHERE m.id = $1`, [member.id, boundary]);
  return month;
};
assert.equal(await progressMonth('2026-11-30T23:31Z'), '2026-11');
assert.equal(await progressMonth(boundary), '2026-12');
assert.equal(await progressMonth(null), '2026-11');
await db.query(`UPDATE public.members SET timezone = 'UTC', pending_timezone = NULL WHERE id = $1`, [member.id]);

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
  read_moderation_punishments: ['p_actor_id', 'p_actor_discord_id', 'p_id', 'p_status', 'p_offset'],
  moderate_punishment: ['p_actor_id', 'p_actor_discord_id', 'p_id', 'p_action', 'p_title', 'p_instructions',
    'p_cycle', 'p_source', 'p_reason', 'p_request_id'],
};
let failingDependency;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options);
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://supabase-fixture.test');
  if (url.pathname === failingDependency) {
    return Response.json({ code: '57014', message: 'private query details' }, { status: 500 });
  }
  if (url.pathname === '/rest/v1/members') {
    const memberId = url.searchParams.get('id')?.slice(3);
    const { rows } = await db.query('SELECT id, discord_id, role, is_active FROM public.members WHERE id = $1', [memberId]);
    return Response.json(rows[0] ?? null);
  }
  const name = url.pathname.split('/').at(-1);
  if (!rpc[name]) return Response.json({}, { status: 404 });
  try {
    const body = await request.json();
    const keys = name === 'moderate_punishment' && 'p_due_at' in body ? [...rpc[name], 'p_due_at'] : rpc[name];
    const placeholders = keys.map((_, index) => '$' + (index + 1));
    const { rows } = await db.query(`SELECT public.${name}(${placeholders.join(',')}) AS result`,
      keys.map(key => body[key] ?? null));
    return Response.json(rows[0].result);
  } catch (error) {
    const status = /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : 500;
    return Response.json({ code: error.code, message: error.message }, { status });
  }
};

try {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase-fixture.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
  process.env.SESSION_SECRET = 'test-session-secret-for-punishment-task-apis';
  process.env.MOD_DISCORD_IDS = member.discord_id;

  const { createSessionToken } = await import('../src/lib/auth.ts');
  const { GET: getMember } = await import('../src/app/api/members/punishments/route.ts');
  const { GET: getMod, POST: postMod } = await import('../src/app/api/mod/punishments/route.ts');
  const { getOpenPunishmentCount } = await import('../src/lib/punishments.ts');
  const { PUNISHMENT_ROLLOUT_CLOSED, PUNISHMENT_SERVICE_UNAVAILABLE } = await import('../src/lib/punishmentAvailability.ts');
  const cookie = (row, discordId = row.discord_id, isModerator = false) => 'zcatchers_session=' +
    createSessionToken({ memberId: row.id, discordId, isModerator });
  const memberCookie = cookie(member);
  const dbModCookie = cookie(dbMod);
  const secondModCookie = cookie(secondMod);
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
  await expect(get(getMod, cookie(member, member.discord_id, true)), 403);
  assert.equal((await expect(get(getMod, dbModCookie), 503)).code, PUNISHMENT_ROLLOUT_CLOSED);
  assert.equal((await expect(get(getMember, memberCookie), 503)).code, PUNISHMENT_ROLLOUT_CLOSED);
  const write = { action: 'complete', punishment_id: member.id };
  assert.equal((await expect(post(dbModCookie, write), 503)).code, PUNISHMENT_ROLLOUT_CLOSED);

  const diagnostics = [];
  const originalConsoleError = console.error;
  try {
    console.error = (...args) => diagnostics.push(args);
    for (const [path, request, operation] of [
      ['/rest/v1/rpc/get_member_punishments', () => get(getMember, memberCookie), 'member read'],
      ['/rest/v1/rpc/read_moderation_punishments', () => get(getMod, dbModCookie), 'moderator read'],
      ['/rest/v1/rpc/moderate_punishment', () => post(dbModCookie, write), 'moderator write'],
      ['/rest/v1/members', () => get(getMod, dbModCookie), 'moderator read'],
    ]) {
      failingDependency = path;
      const body = await expect(request(), 503);
      assert.equal(body.code, PUNISHMENT_SERVICE_UNAVAILABLE);
      assert.doesNotMatch(JSON.stringify(body), /private query details|57014/);
      assert.deepEqual(diagnostics.pop(), ['[punishments] Dependency failure', { operation, databaseCode: '57014' }]);
    }
    failingDependency = '/rest/v1/rpc/get_member_punishments';
    assert.equal(await getOpenPunishmentCount(member.id, member.discord_id), null);
    assert.deepEqual(diagnostics.pop(), ['[punishments] Dependency failure', {
      operation: 'roster count', databaseCode: '57014',
    }]);
  } finally {
    failingDependency = undefined;
    console.error = originalConsoleError;
  }
  assert.equal(await getOpenPunishmentCount(member.id, member.discord_id), null);

  await db.exec('BEGIN; TRUNCATE public.punishment_rollout');
  try {
    assert.equal((await expect(get(getMember, memberCookie), 503)).code, PUNISHMENT_SERVICE_UNAVAILABLE);
  } finally {
    await db.exec('ROLLBACK');
  }

  await db.exec("UPDATE public.punishment_rollout SET activated_at = '2026-11-01T00:00Z'");
  await db.query('SELECT public.seed_november_punishments($1)', [member.id]);
  assert.equal((await expect(get(getMember, memberCookie), 503)).code, PUNISHMENT_ROLLOUT_CLOSED);
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
  const empty = await expect(get(getMember, cookie(other)));
  assert.equal(empty.open_count, 0);
  assert.deepEqual(empty.open_items, []);

  const queue = await expect(get(getMod, dbModCookie));
  assert.deepEqual(queue.items.map(item => item.id), [ready.id]);
  assert.equal(queue.items[0].member_name, 'Member');
  assert.equal(queue.items[0].member_timezone, 'UTC');
  assert.equal(queue.items[0].due_at, null);
  assert.deepEqual((await expect(get(getMod, secondModCookie, '?status=pending'))).items.map(item => item.id), [pending.id]);
  const detail = await expect(get(getMod, secondModCookie, '?punishment_id=' + ready.id));
  assert.equal(detail.verified_strikes.length, 6);
  const assignment = { action: 'assign', punishment_id: ready.id, title: '  Wind-down plan  ' };
  await db.query("UPDATE public.members SET role = 'moderator' WHERE id = $1", [member.id]);
  await expect(post(dbModCookie, assignment), 403);
  await expect(get(getMod, dbModCookie, '?punishment_id=' + ready.id), 403);
  assert.deepEqual((await expect(get(getMod, dbModCookie))).items, []);
  assert.equal((await expect(get(getMod, cookie(owner), '?punishment_id=' + ready.id))).item.id, ready.id);
  await db.query("UPDATE public.members SET role = 'member' WHERE id = $1", [member.id]);
  await expect(post(null, assignment), 401);
  await expect(post(memberCookie, assignment), 403);
  await expect(post(dbModCookie, { ...assignment, member_id: other.id }), 400);
  await expect(post(dbModCookie, { ...assignment, punishment_id: pending.id }), 409);
  await expect(post(dbModCookie, { ...assignment, title: ' '.repeat(10) }), 400);
  await expect(post(dbModCookie, { ...assignment, due_at: '2026-12-05T18:00' }), 400);
  for (const due_at of ['2099-12-05T18:00+00:00', '2099-12-05T18:00:00.1234Z',
    '2099-12-05T18:00:00+05:60', '2099-12-05T18:00:00-16:00']) {
    assert.equal((await expect(post(dbModCookie, { ...assignment, due_at }), 400)).error,
      'Enter a valid completion deadline with a timezone.');
  }
  await expect(post(dbModCookie, { ...assignment, due_at: DateTime.utc().minus({ minutes: 1 }).toISO() }), 400);
  const assigned = await expect(post(dbModCookie, assignment));
  assert.equal(assigned.item.title, 'Wind-down plan');
  assert.equal(DateTime.fromISO(assigned.item.due_at).toMillis(),
    DateTime.fromISO(assigned.item.assigned_at).plus({ days: 7 }).toMillis());
  const assignmentRetry = await expect(post(dbModCookie, assignment));
  assert.equal(assignmentRetry.open_count, 2);
  assert.equal(assignmentRetry.item.due_at, assigned.item.due_at);

  const edit = { action: 'edit', punishment_id: ready.id, title: 'Journal', instructions: 'Two lines' };
  const overdueAt = DateTime.utc().minus({ minutes: 5 }).startOf('second');
  await db.query('UPDATE public.punishments SET due_at = $2 WHERE id = $1', [ready.id, overdueAt.toISO()]);
  const extendedTo = DateTime.utc().plus({ days: 10 }).startOf('second');
  const extended = await expect(post(secondModCookie, { ...edit, due_at: extendedTo.setZone('UTC+05:30').toISO() }));
  assert.equal(extended.item.instructions, 'Two lines');
  assert.equal(DateTime.fromISO(extended.item.due_at).toMillis(), extendedTo.toMillis());
  assert.equal((await expect(post(secondModCookie, edit))).item.due_at, extended.item.due_at);
  await expect(post(secondModCookie, { ...edit, due_at: extendedTo.toISO() }));
  const memberRead = await expect(get(getMember, memberCookie));
  assert.equal(memberRead.open_items.find(item => item.id === ready.id).due_at, extended.item.due_at);
  const assignedQueue = await expect(get(getMod, dbModCookie, '?status=assigned'));
  assert.equal(assignedQueue.items.find(item => item.id === ready.id).due_at, extended.item.due_at);
  await db.query('UPDATE public.punishments SET due_at = $2 WHERE id = $1', [ready.id, overdueAt.toISO()]);
  const completion = { action: 'complete', punishment_id: ready.id };
  for (let i = 0; i < 2; i += 1) {
    const result = await expect(post(dbModCookie, completion));
    assert.equal(result.item.status, 'completed');
    assert.equal(DateTime.fromISO(result.item.due_at).toMillis(), overdueAt.toMillis());
    assert.equal(result.open_count, 1);
  }

  const source = detail.verified_strikes.at(-1);
  const correction = { action: 'remove_strike', punishment_id: pending.id,
    cycle_date: source.cycle_date, source_id: source.source_id, reason: 'Corrected check-in', request_id: other.id };
  await expect(post(memberCookie, correction), 403);
  await expect(post(secondModCookie, { ...correction, cycle_date: '2026-12-06' }), 400);
  const removed = await expect(post(secondModCookie, correction));
  assert.equal(removed.item.status, 'canceled');
  assert.equal(removed.open_count, 0);
  assert.equal((await expect(post(secondModCookie, correction))).correction_id, removed.correction_id);
  await expect(post(secondModCookie, { ...correction, reason: 'Conflicting retry' }), 409);

  const afterCorrection = await expect(get(getMember, memberCookie));
  assert.equal(afterCorrection.open_count, 0);
  assert.deepEqual(afterCorrection.open_items, []);
  assert.equal(afterCorrection.history[0].title, 'Journal');
  if (summary.month === '2026-11') assert.equal(afterCorrection.strikes_toward_next, 2);

  const restored = await expect(post(secondModCookie, {
    action: 'add_strike', punishment_id: pending.id, cycle_date: '2026-11-06', request_id: dbMod.id, reason: 'Verified missed check-in',
  }));
  assert.equal(restored.item.id, pending.id);
  assert.equal(restored.item.status, 'awaiting_assignment');
  assert.equal(restored.open_count, 1);
  const { rows: audit } = await db.query(`SELECT action, actor, occurred_at, details FROM public.punishment_actions
    WHERE punishment_id = $1 AND action IN ('assigned', 'edited', 'completed') ORDER BY id`, [ready.id]);
  assert.deepEqual(audit.map(({ action, actor }) => [action, actor]),
    [['assigned', dbMod.id], ['edited', secondMod.id], ['completed', dbMod.id]]);
  assert.ok(audit.every(row => row.occurred_at));
  assert.equal(audit[0].details.due_at, assigned.item.due_at);
  assert.equal(DateTime.fromISO(audit[1].details.previous_due_at).toMillis(), overdueAt.toMillis());
  assert.equal(audit[1].details.due_at, extended.item.due_at);

  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT public.get_member_punishments($1, $2, true)', [member.id, member.discord_id]), /permission denied/);
  await assert.rejects(db.query("SELECT public.get_moderator_punishments(NULL, 'assigned', 0)"), /permission denied/);
  await assert.rejects(db.query("SELECT public.update_punishment($1, 'complete', 'fake')", [ready.id]), /permission denied/);
} finally {
  globalThis.fetch = realFetch;
  await db.close();
}
