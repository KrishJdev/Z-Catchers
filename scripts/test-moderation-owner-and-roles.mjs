import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';

const sqlFile = path => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const schema = sqlFile('supabase/schema.sql').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
const migration = sqlFile('supabase/migrations/20261126_moderation_owner_and_roles.sql');
const bootstrapTemplate = sqlFile('supabase/bootstrap_moderation_owner.sql');
assert.ok(schema.endsWith(migration), 'The fresh-install schema mirrors the role migration');

const withDatabase = async (initialSchema, test) => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
    `);
    await db.exec(initialSchema);
    await test(db);
  } finally {
    await db.close();
  }
};

const insertMember = async (db, discordId, role = 'member', active = true) => {
  const { rows: [member] } = await db.query(`
    INSERT INTO public.members (discord_username, discord_id, journal_url, bedtime_local, timezone, role, is_active)
    VALUES ('Role fixture', $1, 'https://discord.com/channels/123/456', '23:00', 'UTC', $2, $3)
    RETURNING id, discord_id
  `, [discordId, role, active]);
  return member;
};
const bootstrap = (owner, moderators = []) => bootstrapTemplate
  .replace('owner_id constant uuid := NULL;', `owner_id constant uuid := '${owner.id}';`)
  .replace('owner_discord_id constant text := NULL;', `owner_discord_id constant text := '${owner.discord_id}';`)
  .replace("approved_moderators constant jsonb := '[]';",
    `approved_moderators constant jsonb := '${JSON.stringify(moderators.map(mod => ({
      member_id: mod.id, discord_id: mod.discord_id,
    })))}';`);
const getRole = async (db, member) => (await db.query(
  'SELECT role FROM public.members WHERE id = $1', [member.id],
)).rows[0].role;

await withDatabase(schema.slice(0, -migration.length), async db => {
  const owner = await insertMember(db, '1001');
  const moderator = await insertMember(db, '1002', 'moderator');
  const carryover = await insertMember(db, '1003');
  const inactive = await insertMember(db, '1004', 'member', false);
  await db.query("UPDATE public.members SET pending_bedtime_local = '23:30', pending_effective_at = '2026-12-01T00:00Z' WHERE id = $1", [owner.id]);
  const getQueue = () => db.query('SELECT pending_bedtime_local, pending_effective_at FROM public.members WHERE id = $1', [owner.id]);
  const before = await getQueue();
  await db.exec(migration);

  const rejectBootstrap = async (input, message) => {
    await assert.rejects(() => db.exec(input), message);
    await db.exec('ROLLBACK');
  };
  await rejectBootstrap(bootstrapTemplate, /Supply the verified owner/);
  await rejectBootstrap(bootstrap(inactive), /No active profile/);
  await rejectBootstrap(bootstrap({ ...owner, discord_id: moderator.discord_id }), /No active profile/);
  await rejectBootstrap(bootstrap(owner, [carryover, inactive]), /approved moderator/);
  assert.equal(await getRole(db, owner), 'member');
  assert.equal(await getRole(db, carryover), 'member');
  await db.exec(bootstrap(owner, [carryover]));
  const roles = () => db.query('SELECT id, role, updated_at FROM public.members ORDER BY id');
  const saved = await roles();
  await db.exec(bootstrap(owner, [carryover]));
  assert.deepEqual(await roles(), saved);
  await rejectBootstrap(bootstrap(moderator), /different owner/);
  assert.equal(await getRole(db, owner), 'owner');
  assert.equal(await getRole(db, moderator), 'moderator');
  assert.equal(await getRole(db, carryover), 'moderator');
  assert.deepEqual(await getQueue(), before);
  await db.query('SELECT public.set_moderator($1,$2,$3,$4,$5)',
    [owner.id, owner.discord_id, carryover.id, 'moderator', 'member']);
  await db.exec(bootstrap(owner, [carryover]));
  assert.equal(await getRole(db, carryover), 'member', 'A bootstrap retry preserves later revocations');
  await assert.rejects(() => insertMember(db, '1005', 'owner'), { code: '23505' });
  await assert.rejects(() => insertMember(db, '1005', 'admin'), { code: '23514' });
  for (const statement of [
    'DELETE FROM public.members WHERE id = $1',
    "UPDATE public.members SET role = 'member' WHERE id = $1",
    'UPDATE public.members SET is_active = false WHERE id = $1',
    "UPDATE public.members SET discord_id = '9999' WHERE id = $1",
  ]) {
    await assert.rejects(() => db.query(statement, [owner.id]), { code: 'PT403' });
  }
  await db.query("UPDATE public.members SET discord_username = 'Updated display name' WHERE id = $1", [owner.id]);
});

await withDatabase(schema, async db => {
  await assert.rejects(() => insertMember(db, null, 'owner'), { code: '23514' });
  await assert.rejects(() => insertMember(db, '1001', 'owner', false), { code: '23514' });
  const owner = await insertMember(db, '1001');
  const member = await insertMember(db, '1002');
  const moderator = await insertMember(db, '1003', 'moderator');
  const inactive = await insertMember(db, '1004', 'member', false);
  const unlinked = await insertMember(db, null);
  await db.exec(bootstrap(owner));

  const rpc = (actor, discordId, target, oldRole, newRole) => db.query(
    'SELECT public.set_moderator($1,$2,$3,$4,$5) AS role', [actor, discordId, target, oldRole, newRole],
  );
  for (const role of ['anon', 'authenticated']) {
    await db.exec('SET ROLE ' + role);
    await assert.rejects(() => rpc(owner.id, owner.discord_id, member.id, 'member', 'moderator'), { code: '42501' });
    await assert.rejects(() => db.query('SELECT * FROM public.moderator_role_changes'), { code: '42501' });
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  await assert.rejects(() => db.query('DELETE FROM public.moderator_role_changes'), { code: '42501' });
  await assert.rejects(() => rpc(owner.id, owner.discord_id, member.id, 'member', 'owner'), { code: 'PT400' });
  await db.exec('RESET ROLE');
  await db.exec("ALTER TABLE public.moderator_role_changes ADD CONSTRAINT simulated_audit_failure CHECK (new_role <> 'moderator')");
  await assert.rejects(() => rpc(owner.id, owner.discord_id, member.id, 'member', 'moderator'), { code: '23514' });
  assert.equal(await getRole(db, member), 'member', 'A failed audit insert rolls back the role change');
  await db.exec('ALTER TABLE public.moderator_role_changes DROP CONSTRAINT simulated_audit_failure');

  // Run the real route and signed-session auth against a local Data API fixture backed by Postgres.
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/rest/v1/members') {
      const { rows } = await db.query('SELECT * FROM public.members WHERE id = $1', [url.searchParams.get('id').slice(3)]);
      return response.end(JSON.stringify(rows[0] ?? null));
    }
    if (url.pathname !== '/rest/v1/rpc/set_moderator') return response.writeHead(404).end('{}');
    try {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const { p_actor_id, p_actor_discord_id, p_target_id, p_expected_role, p_new_role } = JSON.parse(raw);
      const { rows: [result] } = await rpc(p_actor_id, p_actor_discord_id, p_target_id, p_expected_role, p_new_role);
      response.end(JSON.stringify(result.role));
    } catch (error) {
      const status = /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : 500;
      response.writeHead(status).end(JSON.stringify({ code: error.code, message: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:' + server.address().port;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fixture-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key';
    process.env.SESSION_SECRET = 'fixture-session-secret-for-moderation-tests';
    process.env.MOD_SECRET_PASSCODE = 'fixture-moderator-passcode';
    process.env.MOD_DISCORD_IDS = inactive.discord_id;
    const { createSessionToken, verifyModeratorSession } = await import('../src/lib/auth.ts');
    const { POST } = await import('../src/app/api/mod/route.ts');
    const session = (row, discordId = row.discord_id) => 'zcatchers_session=' +
      createSessionToken({ memberId: row.id, discordId, isModerator: true });
    const origin = 'http://localhost:3000';
    const ownerCookie = session(owner);
    const promote = { action: 'set_moderator', member_id: member.id, expected_role: 'member', new_role: 'moderator' };
    const revoke = { ...promote, expected_role: 'moderator', new_role: 'member' };
    const post = (cookie, body, headers = {}) => POST(new Request(origin + '/api/mod', {
      method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }));
    const expect = async (response, status) => {
      const result = await response;
      const body = await result.json();
      assert.equal(result.status, status, JSON.stringify(body));
      return body;
    };

    await expect(post('', { ...promote, mod_passcode: process.env.MOD_SECRET_PASSCODE }), 401);
    await expect(post('', promote, { 'x-mod-passcode': process.env.MOD_SECRET_PASSCODE }), 401);
    await expect(post(session(owner, null), promote), 401);
    for (const cookie of [session(owner, member.discord_id), session(member, owner.discord_id), session(member), session(moderator), session(inactive)]) {
      await expect(post(cookie, promote), 403);
    }
    await expect(post(ownerCookie, promote, { Origin: '' }), 403);
    await expect(post(ownerCookie, promote, { Origin: 'null' }), 403);
    await expect(post(ownerCookie, promote, { Origin: 'http://localhost:3001' }), 403);
    await expect(post(ownerCookie, promote, { 'Sec-Fetch-Site': 'cross-site' }), 403);
    await expect(post(ownerCookie, { ...promote, new_role: 'owner' }), 400);
    await expect(post(ownerCookie, { ...promote, member_id: owner.id }), 403);
    for (const target of [inactive, unlinked]) await expect(post(ownerCookie, { ...promote, member_id: target.id }), 409);
    await expect(post(ownerCookie, { action: 'edit_member', member_id: member.id, role: 'owner' }), 400);
    await expect(post(ownerCookie, { action: 'edit_member', member_id: member.id, is_moderator: true }), 400);
    await expect(post(ownerCookie, { action: 'edit_member', member_id: owner.id, discord_username: 'Changed' }), 403);

    const existingMemberSession = new Request(origin, { headers: { Cookie: session(member) } });
    assert.equal((await verifyModeratorSession(existingMemberSession)).authorized, false);
    const edits = await Promise.all([post(ownerCookie, promote), post(ownerCookie, promote)]);
    assert.deepEqual(edits.map(result => result.status).sort(), [200, 409]);
    assert.equal((await edits.find(result => result.ok).json()).role, 'moderator');
    assert.equal((await verifyModeratorSession(existingMemberSession)).authorized, true);
    await db.query('UPDATE public.members SET is_active = false WHERE id = $1', [member.id]);
    assert.equal((await expect(post(ownerCookie, revoke), 200)).role, 'member');
    assert.equal(await getRole(db, member), 'member');
    await db.query('UPDATE public.members SET is_active = true WHERE id = $1', [member.id]);
    assert.equal((await verifyModeratorSession(existingMemberSession)).authorized, false);

    const { rows } = await db.query(`
      SELECT actor_member_id, target_member_id, old_role, new_role, changed_at IS NOT NULL AS recorded
      FROM public.moderator_role_changes ORDER BY changed_at
    `);
    assert.deepEqual(rows, [
      { actor_member_id: owner.id, target_member_id: member.id, old_role: 'member', new_role: 'moderator', recorded: true },
      { actor_member_id: owner.id, target_member_id: member.id, old_role: 'moderator', new_role: 'member', recorded: true },
    ]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

console.log('Moderation migration, bootstrap, live owner authorization and audited role changes passed.');
