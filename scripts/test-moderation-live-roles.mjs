import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { DateTime } from 'luxon';

const migration = readFileSync('supabase/migrations/20261127_moderation_live_roles.sql', 'utf8');
const schema = readFileSync('supabase/schema.sql', 'utf8').replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', '');
assert.ok(schema.endsWith(migration));
const db = new PGlite();
const roleSetup = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
`;
await db.exec(roleSetup);
await db.exec(schema.slice(0, -migration.length));
const { rows: [owner, mod, member, peer, candidate] } = await db.query(`
  INSERT INTO public.members (discord_username, discord_id, journal_url, bedtime_local, timezone, role)
  VALUES ('Owner', '1001', 'https://discord.com/channels/1/2', '23:00', 'UTC', 'owner'),
    ('Moderator', '1002', 'https://discord.com/channels/1/2', '23:00', 'UTC', 'moderator'),
    ('Member', '1003', 'https://discord.com/channels/1/2', '23:00', 'UTC', 'member'),
    ('Peer', '1004', 'https://discord.com/channels/1/2', '23:00', 'UTC', 'moderator'),
    ('Candidate', '1005', 'https://discord.com/channels/1/2', '23:00', 'UTC', 'member')
  RETURNING *
`);
await db.query(`INSERT INTO public.strike_moderator_corrections
  (member_id, cycle_date, action, actor, reason, recorded_at)
  VALUES ($1, '2026-11-01', 'legacy_set_counts', 'master_mod', 'Historical correction', statement_timestamp())`, [member.id]);
await db.exec(migration); // Apply to an existing roster and historical audit.
assert.equal((await db.query("SELECT actor FROM public.strike_moderator_corrections WHERE reason = 'Historical correction'")).rows[0].actor,
  'master_mod');
assert.equal((await db.query("SELECT to_regprocedure('public.reserve_moderator_passcode_attempt(text,timestamptz)') AS fn")).rows[0].fn, null);

process.env.NODE_ENV = 'test';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://moderation-fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'moderation-fixture-service-key';
process.env.SESSION_SECRET = 'moderation-fixture-session-secret';
process.env.MOD_SECRET_PASSCODE = 'retired-passcode';
process.env.MOD_DISCORD_IDS = member.discord_id;

const { supabaseAdmin } = await import('../src/lib/db.ts');
const { getScheduleCooldownEffectiveAt, Settings } = await import('../src/lib/sleepEngine.ts');
const { createSessionToken } = await import('../src/lib/auth.ts');
const { pendingScheduleSnapshot } = await import('../src/lib/pendingSchedule.ts');
const { GET: authMe } = await import('../src/app/api/auth/me/route.ts');
const { POST: modRoute } = await import('../src/app/api/mod/route.ts');
const { GET: webhook, POST: webhookPost } = await import('../src/app/api/mod/webhook/route.ts');
const { POST: updateSchedule } = await import('../src/app/api/members/update-schedule/route.ts');
const { POST: cancelPending } = await import('../src/app/api/members/cancel-pending/route.ts');
const { POST: inBed } = await import('../src/app/api/members/in-bed/route.ts');
const { POST: wakeUp } = await import('../src/app/api/members/wake-up/route.ts');
const { POST: metastrike } = await import('../src/app/api/members/strikes/metastrike/route.ts');

let readFailure = false;
let beforeRpc;
const parameters = {
  set_moderator: ['p_actor_id', 'p_actor_discord_id', 'p_target_id', 'p_expected_role', 'p_new_role'],
  moderate_roster_member: ['p_actor_id', 'p_actor_discord_id', 'p_target_id', 'p_action',
    'p_updates', 'p_expected_updated_at', 'p_expected_pending'],
  moderate_sleep: ['p_actor_id', 'p_actor_discord_id', 'p_target_id', 'p_action', 'p_cycle',
    'p_now', 'p_expected_updated_at', 'p_entry', 'p_guarded', 'p_expected_in_bed_at', 'p_expected_sleep_updated_at'],
  cancel_own_sleep_check_in: ['p_member_id', 'p_discord_id', 'p_cycle', 'p_clear_pending', 'p_expected_updated_at'],
  moderate_strike_counts: ['p_actor_id', 'p_actor_discord_id', 'p_member_id', 'p_strikes', 'p_passes', 'p_relative'],
  moderate_nightly_strike: ['p_actor_id', 'p_actor_discord_id', 'p_member_id', 'p_cycle', 'p_month',
    'p_previous_type', 'p_type', 'p_reason', 'p_now', 'p_month_start', 'p_strike_cutoff', 'p_replacement_until',
    'p_schedule_revision'],
};

const getMember = async id => (await db.query('SELECT * FROM public.members WHERE id = $1', [id])).rows[0];
supabaseAdmin.from = table => {
  const filters = [];
  let fields;
  const addFilter = (column, value) => filters.push([column, value]);
  const result = async () => {
    if (table === 'sleep_logs' || table === 'notification_logs' || table === 'nightly_strike_logs') {
      const conditions = filters.map(([key], index) => `${key} = $${index + 1}`).join(' AND ');
      const { rows } = await db.query('SELECT * FROM public.' + table +
        (conditions ? ' WHERE ' + conditions : ''), filters.map(([, value]) => value));
      return { data: JSON.parse(JSON.stringify(rows)), error: null };
    }
    assert.equal(table, 'members');
    if (readFailure) return { data: null, error: { message: 'Read unavailable' } };
    const conditions = filters.map(([key], i) => `${key} IS NOT DISTINCT FROM $${i + 1}`).join(' AND ');
    const values = filters.map(([, value]) => value);
    const predicate = conditions ? ' WHERE ' + conditions : '';
    const statement = fields
      ? 'UPDATE public.members SET ' + Object.keys(fields).map((key, i) => `${key} = $${values.length + i + 1}`).join(', ')
        + predicate + ' RETURNING *'
      : 'SELECT * FROM public.members' + predicate;
    const { rows } = await db.query(statement, [...values, ...Object.values(fields ?? {})]);
    return { data: JSON.parse(JSON.stringify(rows)), error: null };
  };
  return {
    select() { return this; },
    eq(key, value) { addFilter(key, value); return this; },
    is(key, value) { addFilter(key, value); return this; },
    in() { return this; },
    gte() { return this; },
    lte() { return this; },
    order() { return this; },
    limit() { return this; },
    update(values) { fields = values; return this; },
    async maybeSingle() {
      const { data, error } = await result();
      return { data: data?.[0] ?? null, error };
    },
    single() { return this.maybeSingle(); },
    then(resolve, reject) { return result().then(resolve, reject); },
  };
};
supabaseAdmin.rpc = async (name, body) => {
  assert.ok(parameters[name], name);
  if (beforeRpc) {
    const prepare = beforeRpc;
    beforeRpc = undefined;
    await prepare();
  }
  const args = parameters[name].filter(key => key in body);
  try {
    const { rows: [{ result }] } = await db.query(
      `SELECT public.${name}(${args.map((key, i) => `${key} => $${i + 1}`).join(', ')}) AS result`,
      args.map(key => body[key]));
    return { data: result, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

const session = (row, discordId = row.discord_id) => createSessionToken({
  memberId: row.id, discordId, isModerator: true, // Simulate a stale compatibility claim.
});
const ownerSession = session(owner);
const modSession = session(mod);
const memberSession = session(member);
const origin = 'http://localhost:3000';
const request = (token, body, headers = {}) => new Request(origin + '/api/mod', {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin,
    ...(token && { Cookie: 'zcatchers_session=' + token }), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function expect(handler, status, token, body, headers) {
  const response = await handler(request(token, body, headers));
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}

const realNow = Settings.now;
try {
  const edit = { action: 'edit_member', member_id: member.id, discord_username: 'Edited' };
  const retired = process.env.MOD_SECRET_PASSCODE;
  await expect(modRoute, 401, null, { ...edit, mod_passcode: retired }, { 'x-mod-passcode': retired });
  await expect(modRoute, 401, session(mod, member.discord_id), edit);
  await expect(modRoute, 403, memberSession, edit);
  await expect(modRoute, 403, modSession, edit, { Origin: 'https://other.example' });
  await expect(modRoute, 403, modSession, edit, { Host: '[abc]' });
  await expect(webhookPost, 403, ownerSession, { action: 'test' }, { Host: '[abc]' });
  await expect(modRoute, 400, modSession, { action: 'verify' });
  await expect(modRoute, 400, ownerSession, { ...edit, role: 'owner' });
  await expect(modRoute, 400, ownerSession, { ...edit, is_moderator: true });
  await expect(modRoute, 403, modSession, { ...edit, member_id: peer.id });
  await expect(modRoute, 403, modSession, { ...edit, member_id: mod.id });
  await expect(modRoute, 403, ownerSession, { ...edit, member_id: owner.id });
  await expect(modRoute, 403, modSession, { action: 'toggle_active', member_id: member.id, is_active: false });
  await expect(modRoute, 403, ownerSession, { action: 'delete_member', member_id: owner.id });
  await expect(webhook, 401, null, undefined, { 'x-mod-passcode': retired });
  await expect(webhook, 403, modSession);
  await expect(webhookPost, 403, modSession, { action: 'test' });
  await expect(webhook, 200, ownerSession);
  assert.equal((await expect(authMe, 200, memberSession)).member.is_moderator, false);
  assert.equal((await expect(authMe, 200, modSession)).member.is_moderator, true);
  readFailure = true;
  await expect(modRoute, 503, modSession, edit);
  await expect(authMe, 503, modSession);
  readFailure = false;

  const beforeDst = DateTime.fromISO('2026-03-07T12:00', { zone: 'America/New_York' });
  const afterCooldown = getScheduleCooldownEffectiveAt(beforeDst);
  assert.equal(afterCooldown.diff(beforeDst, 'hours').hours, 48);
  assert.equal(afterCooldown.hour, 13);

  const editSelf = (row, bedtime) => ({ member_id: row.id, bedtime_local: bedtime, mod_passcode: retired });
  for (const row of [member, mod, owner]) {
    const start = DateTime.utc();
    const result = await expect(updateSchedule, 200, session(row), editSelf(row, '22:45'));
    assert.equal(result.cooldown_applied, true);
    assert.ok(DateTime.fromISO(result.pending_effective_at) >= start.plus({ hours: 48 }));
    assert.equal((await getMember(row.id)).bedtime_local, '23:00');
  }
  await expect(updateSchedule, 403, modSession, editSelf(member, '22:10'));
  await expect(updateSchedule, 401, null, editSelf(member, '22:10'));
  await expect(modRoute, 400, modSession, { ...edit, bedtime_local: '22:10' });

  const original = (await expect(updateSchedule, 200, memberSession, editSelf(member, '22:40'))).member;
  const approval = { action: 'approve_cooldown', member_id: member.id, expected_pending: pendingScheduleSnapshot(original) };
  await expect(modRoute, 400, modSession, { ...approval, expected_pending: null });
  await db.query("UPDATE public.members SET pending_bedtime_local = '22:20' WHERE id = $1", [member.id]);
  await expect(modRoute, 409, modSession, approval); // Even the same timestamp must match the reviewed fields.
  const reviewed = JSON.parse(JSON.stringify(await getMember(member.id)));
  const approveReviewed = { ...approval, expected_pending: pendingScheduleSnapshot(reviewed) };
  beforeRpc = () => db.query("UPDATE public.members SET role = 'moderator' WHERE id = $1", [member.id]);
  await expect(modRoute, 403, modSession, approveReviewed);
  await expect(modRoute, 200, ownerSession, approveReviewed);
  await expect(modRoute, 409, ownerSession, approveReviewed);
  const applied = await getMember(member.id);
  assert.equal(applied.bedtime_local, '22:20');
  assert.equal(applied.pending_effective_at, null);
  await db.query("UPDATE public.members SET role = 'member' WHERE id = $1", [member.id]);

  const legacyWeekly = { ...applied.weekly_schedule,
    tue: { bedtime: '21:45', wake_time: '08:00' },
    fri: { bedtime: '00:15', wake_time: '08:30' },
  };
  await db.query(`UPDATE public.members SET weekly_schedule = $2, weekend_bedtime_local = '00:15',
    pending_bedtime_local = '22:05', pending_weekly_schedule = NULL, pending_effective_at = '2027-01-01T12:00Z'
    WHERE id = $1`, [member.id, legacyWeekly]);
  const legacy = await getMember(member.id);
  const approvedLegacy = await expect(modRoute, 200, modSession, {
    ...approval, expected_pending: pendingScheduleSnapshot(JSON.parse(JSON.stringify(legacy))),
  });
  assert.equal(approvedLegacy.member.weekly_schedule.tue.bedtime, '22:05');
  assert.equal(approvedLegacy.member.weekly_schedule.tue.wake_time, '08:00');
  assert.deepEqual(approvedLegacy.member.weekly_schedule.fri, legacyWeekly.fri);
  assert.equal(approvedLegacy.member.weekend_bedtime_local, '00:15');

  const scheduleEdit = { ...edit, action: 'edit_schedule', bedtime_local: '22:10' };
  const expected_updated_at = approvedLegacy.member.updated_at;
  await expect(modRoute, 400, modSession, scheduleEdit);
  await expect(modRoute, 400, modSession, { ...scheduleEdit, expected_updated_at, bedtime_local: '07:00' });
  await expect(modRoute, 200, modSession, { ...scheduleEdit, expected_updated_at });
  await expect(modRoute, 409, modSession, { ...scheduleEdit, expected_updated_at, bedtime_local: '21:20' });
  assert.equal((await getMember(member.id)).bedtime_local, '22:10');
  await expect(modRoute, 200, ownerSession, { action: 'toggle_active', member_id: peer.id, is_active: false });
  await expect(modRoute, 401, session(peer), edit);
  await expect(modRoute, 200, ownerSession, { action: 'toggle_active', member_id: peer.id, is_active: true });

  for (const [handler, body] of [
    [cancelPending, { member_id: peer.id }],
    [inBed, { memberId: peer.id, action: 'cancel' }],
    [wakeUp, { memberId: peer.id, mode: 'manual', wokeUpTime: '07:30' }],
    [metastrike, { member_id: peer.id }],
  ]) {
    await expect(handler, 401, null, { ...body, mod_passcode: retired }, { 'x-mod-passcode': retired });
    await expect(handler, 403, modSession, body);
  }
  await expect(cancelPending, 200, ownerSession, { member_id: peer.id, action: 'schedule' });
  const sleepTestNow = DateTime.fromISO('2026-11-24T23:40Z').toMillis();
  Settings.now = () => sleepTestNow;
  const checkIn = await expect(inBed, 200, modSession, { memberId: member.id, action: 'check_in' });
  assert.equal(checkIn.is_in_bed, true);
  const { rows: [sleep] } = await db.query('SELECT * FROM public.sleep_logs WHERE member_id = $1', [member.id]);
  const wake = await expect(wakeUp, 200, modSession, { memberId: member.id, expectedInBedAt: sleep.in_bed_at.toISOString() });
  assert.equal(wake.isDurable, true);
  const staffCancelled = await expect(inBed, 200, modSession, { memberId: member.id, action: 'cancel' });
  assert.equal(staffCancelled.local_date, wake.sleep_log.cycle_date, JSON.stringify({
    checkIn: checkIn.local_date, wake: wake.sleep_log.cycle_date, cancelled: staffCancelled.local_date,
  }));
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.sleep_logs WHERE member_id = $1', [member.id])).rows[0].count, 0);
  // A receipt and history change without a members.updated_at change must still reject the stale entry.
  await expect(inBed, 200, modSession, { memberId: member.id, action: 'check_in' });
  beforeRpc = async () => {
    await db.query('DELETE FROM public.notification_logs WHERE member_id = $1', [member.id]);
    await db.query('DELETE FROM public.sleep_logs WHERE member_id = $1', [member.id]);
  };
  await expect(wakeUp, 409, modSession, { memberId: member.id });
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.sleep_logs WHERE member_id = $1', [member.id])).rows[0].count, 0);

  const unguarded = await expect(wakeUp, 200, modSession, { memberId: member.id });
  assert.equal(unguarded.sleep_log.in_bed_at, null);
  await expect(inBed, 200, memberSession, { memberId: member.id, action: 'cancel' });

  const queued = await expect(updateSchedule, 200, memberSession, editSelf(member, '22:35'));
  await expect(inBed, 200, modSession, { memberId: member.id, action: 'check_in' });
  // A failure in the final member update rolls back both receipt and history deletes.
  await db.exec(`ALTER TABLE public.members ADD CONSTRAINT test_cancel_rollback
    CHECK (id <> '${member.id}' OR last_notified_stage IS NOT NULL) NOT VALID`);
  await expect(inBed, 500, memberSession, { memberId: member.id, action: 'cancel' });
  assert.equal((await getMember(member.id)).last_notified_stage, 'IN_BED_EARLY');
  const countCycleRows = async table => (await db.query(
    `SELECT count(*)::int AS count FROM public.${table} WHERE member_id = $1`, [member.id])).rows[0].count;
  assert.equal(await countCycleRows('sleep_logs'), 1);
  assert.equal(await countCycleRows('notification_logs'), 1);
  await db.exec('ALTER TABLE public.members DROP CONSTRAINT test_cancel_rollback');

  await expect(inBed, 200, memberSession, { memberId: member.id, action: 'cancel' });
  assert.equal((await getMember(member.id)).pending_bedtime_local, queued.member.pending_bedtime_local);
  await expect(inBed, 200, modSession, { memberId: member.id, action: 'check_in' });
  const cancelledSleep = await expect(cancelPending, 200, memberSession, { member_id: member.id, action: 'in_bed' });
  assert.equal(cancelledSleep.member.pending_effective_at, null);
  assert.equal(cancelledSleep.is_in_bed, false);
  assert.equal(await countCycleRows('sleep_logs'), 0);
  assert.equal(await countCycleRows('notification_logs'), 0);

  const pass = await expect(metastrike, 200, modSession, { member_id: member.id, reason: 'Verified absence' });
  assert.equal(pass.log.record_type, 'metastrike');
  const clear = { action: 'clear_strike_log', member_id: member.id, sleep_cycle_date: pass.sleep_cycle_date };
  await expect(modRoute, 403, modSession, clear);
  await expect(modRoute, 200, ownerSession, clear);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM public.nightly_strike_logs WHERE target_member_id = $1",
    [member.id])).rows[0].count, 0);
  const corrections = (await db.query("SELECT action, actor FROM public.strike_moderator_corrections WHERE member_id = $1 ORDER BY recorded_at",
    [member.id])).rows;
  assert.ok(corrections.some(row => row.action === 'moderator_pass' && row.actor === mod.id));
  assert.ok(corrections.some(row => row.action === 'clear_nightly' && row.actor === owner.id));
  await expect(modRoute, 403, modSession, { action: 'adjust_strikes', member_id: member.id, strike_delta: 1 });

  beforeRpc = () => db.query("UPDATE public.members SET role = 'member' WHERE id = $1", [mod.id]);
  await expect(modRoute, 403, modSession, edit);
  await expect(modRoute, 403, modSession, edit);
  assert.equal((await expect(authMe, 200, modSession)).member.is_moderator, false);

  const candidateSession = createSessionToken({
    memberId: candidate.id, discordId: candidate.discord_id, isModerator: false,
  });
  const promote = { action: 'set_moderator', member_id: candidate.id, expected_role: 'member', new_role: 'moderator' };
  const revoke = { ...promote, expected_role: 'moderator', new_role: 'member' };
  const pending = (await expect(updateSchedule, 200, memberSession, editSelf(member, '22:15'))).member;
  const approve = { ...approval, expected_pending: pendingScheduleSnapshot(pending) };
  await expect(modRoute, 403, candidateSession, approve);
  assert.equal((await expect(modRoute, 200, ownerSession, promote)).role, 'moderator');
  await expect(modRoute, 409, ownerSession, promote);
  assert.equal((await expect(authMe, 200, candidateSession)).member.role, 'moderator');
  assert.equal((await expect(modRoute, 200, candidateSession, approve)).member.bedtime_local, '22:15');
  assert.equal((await expect(modRoute, 200, ownerSession, revoke)).role, 'member');
  await expect(modRoute, 403, candidateSession, approve);
  assert.equal((await expect(authMe, 200, candidateSession)).member.is_moderator, false);

  const { rows: audit } = await db.query('SELECT actor_id, target_id, action FROM public.moderation_actions ORDER BY id');
  assert.deepEqual(audit.filter(row => row.target_id === member.id), [
    { actor_id: owner.id, target_id: member.id, action: 'approve_cooldown' },
    { actor_id: mod.id, target_id: member.id, action: 'approve_cooldown' },
    { actor_id: mod.id, target_id: member.id, action: 'edit_schedule' },
    { actor_id: mod.id, target_id: member.id, action: 'check_in' },
    { actor_id: mod.id, target_id: member.id, action: 'log_wake' },
    { actor_id: mod.id, target_id: member.id, action: 'cancel_checkin' },
    { actor_id: mod.id, target_id: member.id, action: 'check_in' },
    { actor_id: mod.id, target_id: member.id, action: 'log_wake' },
    { actor_id: mod.id, target_id: member.id, action: 'check_in' },
    { actor_id: mod.id, target_id: member.id, action: 'check_in' },
    { actor_id: candidate.id, target_id: member.id, action: 'approve_cooldown' },
  ]);
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query("SELECT public.moderate_roster_member($1,$2,$3,'cancel_cooldown')",
    [owner.id, owner.discord_id, member.id]), { code: '42501' });
} finally {
  Settings.now = realNow;
  await db.close();
}
console.log('Live staff roles, cooldown approval races, transactional corrections and staff audit passed.');
