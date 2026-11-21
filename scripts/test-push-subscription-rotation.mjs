import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'phase-one-rotation-fixture';
const { createSessionToken } = await import('../src/lib/auth.ts');
const { supabaseAdmin } = await import('../src/lib/db.ts');
const { POST } = await import('../src/app/api/push/subscribe/route.ts');
const base = 'https://push.example.test';
const owners = [
  { id: '10000000-0000-4000-8000-000000000001', discordId: '100000000000000001' },
  { id: '10000000-0000-4000-8000-000000000002', discordId: '100000000000000002' },
];
const credential = 'ab'.repeat(32);
const secondCredential = 'cd'.repeat(32);
const at = name => base + '/' + name;
const sub = name => ({
  endpoint: at(name),
  keys: { p256dh: 'public-' + name, auth: 'auth-' + name },
});
const enroll = (name, extra = {}) => ({ subscription: sub(name), ...extra });
const rotate = (previous, name, secret) => enroll(name, {
  background: true, old_endpoint: at(previous), rotation_credential: secret,
});

const db = new PGlite();
const oldRpc = supabaseAdmin.rpc;
try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE rate_limits (key text PRIMARY KEY, count integer, window_start timestamptz, expires_at timestamptz);
    CREATE TABLE members (id uuid PRIMARY KEY, discord_id text, is_active boolean DEFAULT true);
    CREATE TABLE push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id uuid NOT NULL REFERENCES members(id),
      endpoint text NOT NULL UNIQUE, p256dh_key text NOT NULL, auth_key text NOT NULL,
      notify_personal boolean DEFAULT true, notify_community boolean DEFAULT true, user_agent text
    );
  `);
  const migration = readFileSync('supabase/migrations/20261121_push_subscription_rotation.sql', 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  for (const owner of owners) {
    await db.query('INSERT INTO members (id, discord_id) VALUES ($1, $2)', [owner.id, owner.discordId]);
  }
  const permissions = await db.query(`
    SELECT has_function_privilege('anon', oid, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated,
           has_function_privilege('service_role', oid, 'EXECUTE') AS service_role
    FROM pg_proc WHERE proname = 'bind_push_subscription'
  `);
  assert.deepEqual(permissions.rows, [{ anon: false, authenticated: false, service_role: true }]);

  supabaseAdmin.rpc = async (name, args) => {
    assert.equal(name, 'bind_push_subscription');
    const { rows } = await db.query(`
      SELECT bind_push_subscription($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value
    `, [args.p_member_id, args.p_discord_id, args.p_endpoint, args.p_previous, args.p_p256dh,
      args.p_auth, args.p_digest, args.p_personal, args.p_community, args.p_user_agent]);
    return { data: rows[0].value, error: null };
  };
  const post = async (payload, status, owner, code) => {
    const request = new Request('https://zcatchers.test/api/push/subscribe', {
      method: 'POST',
      headers: owner ? { Cookie: 'zcatchers_session=' + createSessionToken({
        memberId: owner.id, discordId: owner.discordId,
      }) } : {},
      body: JSON.stringify(payload),
    });
    const response = await POST(request);
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    if (code) assert.equal(result.code, code);
    return result;
  };

  await post(enroll('device', { member_id: owners[0].id, pin: '1234' }), 401, null, 'discord_required');
  await post(enroll('device', { member_id: owners[0].id }), 403, owners[1], 'wrong_account');
  await post(enroll('device', { rotation_credential: credential, notify_community: false }), 200, owners[0]);
  await post(enroll('other', { rotation_credential: secondCredential }), 200, owners[1]);
  const firstRow = (await db.query('SELECT * FROM push_subscriptions WHERE endpoint = $1', [at('device')])).rows[0];
  assert.equal(firstRow.rotation_digest, createHash('sha256').update(credential).digest('hex'));

  await post(rotate('device', 'device-next'), 401, null, 'credential_required');
  await post(rotate('device', 'device-next', secondCredential), 409, null, 'stale_endpoint');
  await post(rotate('device', 'other', credential), 409, null, 'endpoint_conflict');
  await post(enroll('device'), 409, owners[1], 'endpoint_conflict');
  assert.deepEqual((await db.query('SELECT * FROM push_subscriptions WHERE id = $1', [firstRow.id])).rows[0], firstRow);

  const replaced = await post({ ...rotate('device', 'device-next', credential), notify_community: true }, 200);
  assert.equal(replaced.notifyCommunity, false);
  assert.equal((await post(rotate('device', 'device-next', credential), 200)).notifyCommunity, false);
  const retried = await post(enroll('device-next', {
    old_endpoint: at('device'), rotation_credential: credential, notify_personal: false,
  }), 200, owners[0]);
  assert.equal(retried.notifyPersonal, false);
  assert.equal(retried.notifyCommunity, false);
  const inexact = rotate('device', 'device-next', credential);
  inexact.subscription.keys.auth = 'unconfirmed';
  await post(inexact, 409, null, 'stale_endpoint');
  await post(rotate('device', 'third', credential), 409, null, 'stale_endpoint');
  assert.equal((await db.query('SELECT endpoint FROM push_subscriptions WHERE id = $1', [firstRow.id])).rows[0].endpoint, at('device-next'));
  const repair = enroll('current-browser-endpoint', {
    old_endpoint: at('device'), rotation_credential: credential,
  });
  assert.equal((await post(repair, 409, owners[0], 'stale_endpoint')).confirmedEndpoint, at('device-next'));
  assert.equal((await post(repair, 409, owners[1], 'binding_missing')).confirmedEndpoint, undefined);
  repair.old_endpoint = at('device-next');
  assert.equal((await post(repair, 200, owners[0])).notifyCommunity, false);

  await post(enroll('legacy', { notify_personal: false }), 200, owners[0]);
  assert.equal((await post(rotate('legacy', 'legacy-next'), 200)).notifyPersonal, false);
  assert.equal((await post(rotate('legacy', 'legacy-next'), 200)).notifyPersonal, false);
  const legacyUpgrade = 'ef'.repeat(32);
  assert.equal((await post(enroll('legacy-next', {
    old_endpoint: at('legacy'), rotation_credential: legacyUpgrade,
  }), 200, owners[0])).notifyPersonal, false);
  await post(rotate('legacy-next', 'legacy-final'), 401, null, 'credential_required');
  await post(rotate('legacy-next', 'legacy-final', legacyUpgrade), 200);

  await post(rotate('deleted', 'other', 'ff'.repeat(32)), 401, null, 'credential_required');
  const missing = enroll('fresh', { old_endpoint: at('deleted'), rotation_credential: 'ff'.repeat(32) });
  await post(missing, 409, owners[0], 'binding_missing');
  await post(enroll('other', { rotation_credential: 'ff'.repeat(32) }), 409, owners[0], 'endpoint_conflict');
  delete missing.old_endpoint;
  assert.equal((await post({ ...missing, notify_personal: false }, 200, owners[0])).notifyPersonal, false);

  const reserve = async (key, release = null) => (await db.query(
    'SELECT reserve_moderator_passcode_attempt($1, $2) AS result', [key, release],
  )).rows[0].result;
  const reserved = await Promise.all(Array.from({ length: 8 }, () => reserve('moderator')));
  assert.equal(reserved.filter(attempt => attempt.window_start).length, 5);
  assert.equal(reserved.filter(attempt => attempt.retry_after > 0).length, 3);
  const window = reserved.find(attempt => attempt.window_start).window_start;
  assert.ok((await reserve('moderator', '2000-01-01T00:00:00Z')).released);
  assert.ok((await reserve('moderator')).retry_after > 0);
  assert.ok((await reserve('moderator', window)).released);
  assert.ok((await reserve('moderator')).window_start);
  assert.ok((await reserve('another-moderator')).window_start);

  await db.query('UPDATE members SET is_active = false WHERE id = $1', [owners[0].id]);
  await post(rotate('current-browser-endpoint', 'disabled', credential), 403, null, 'inactive_owner');
  await db.query('DELETE FROM push_subscriptions WHERE id = $1', [firstRow.id]);
  await post(rotate('current-browser-endpoint', 'unlinked', credential), 401, null, 'credential_required');
} finally {
  supabaseAdmin.rpc = oldRpc;
  await db.close();
}
