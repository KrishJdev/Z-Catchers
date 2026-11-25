import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createECDH, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import webpush from 'web-push';
import {
  insertLegacyNovemberFixtures, novemberAccounts, seedNovemberFixtures,
  verifyNovemberPreview, verifyNovemberRollover,
} from './fixtures/november-cutover-smoke.mjs';

const workdir = process.env.DISPATCH_SMOKE_WORKDIR;
assert.ok(process.env.GITHUB_ACTIONS === 'true' && workdir, 'Use the isolated dispatcher CI job.');
const container = 'supabase_db_zc_dispatch_smoke';
const nextCli = 'node_modules/next/dist/bin/next';
const appOrigin = 'http://127.0.0.1:3181';
const dispatcherPath = '/api/cron/dispatch-notifications';
const fixtureSecret = () => randomBytes(32).toString('hex');
const cronSecret = fixtureSecret();
const bypassSecret = fixtureSecret();
const retiredPasscode = fixtureSecret();
const discordAccounts = {
  overdue: '100000000000000001',
  'database-mod': '100000000000000002',
  'second-mod': '100000000000000003',
  newcomer: '100000000000000004',
  'task-member': '100000000000000005',
  'review-member': '100000000000000008',
  'legacy-metastrike': '100000000000000009',
  'release-assignment': '100000000000000011',
  owner: '100000000000000100',
  'recovered-owner': '100000000000000101',
  ...novemberAccounts,
};
assert.equal(new Set(Object.values(discordAccounts)).size, Object.keys(discordAccounts).length,
  'Each smoke-test Discord account needs a distinct ID');
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const localSupabase = parseEnv(execFileSync(
  'supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8' },
));
const apiUrl = localSupabase.API_URL;
const anonKey = localSupabase.ANON_KEY || localSupabase.PUBLISHABLE_KEY;
const serviceKey = localSupabase.SERVICE_ROLE_KEY || localSupabase.SECRET_KEY;
assert.ok(anonKey && serviceKey, 'Supabase CLI must provide local API keys.');
assert.equal(new URL(apiUrl).origin, 'http://127.0.0.1:54321', 'Only the disposable CI Data API is supported.');

const psql = ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];

function sql(input) {
  return execFileSync('docker', psql, { input, encoding: 'utf8' }).trim();
}

function sqlSession(name) {
  const child = spawn('docker', psql);
  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const done = new Promise(resolve => {
    child.on('close', code => resolve({ code, output: output.trim(), errors }));
  });
  child.stdin.write(`BEGIN; SET LOCAL application_name = '${name}'; SET LOCAL statement_timeout = '30s';\n`);
  return { child, done };
}

async function concurrentSql(first, second, beforeCommit = '') {
  const writer = sqlSession('zc_ledger_writer');
  let waiter;
  try {
    writer.child.stdin.write(first + ";\nSET LOCAL application_name = 'zc_ledger_writer_ready';\n");
    await waitFor(() => sql(`SELECT 1 FROM pg_stat_activity
      WHERE application_name = 'zc_ledger_writer_ready' AND state = 'idle in transaction'`), 10_000,
    () => 'First PostgreSQL session did not reach its transaction barrier');
    waiter = sqlSession('zc_ledger_waiter');
    waiter.child.stdin.end(second + '; COMMIT;\n');
    await waitFor(() => sql(`SELECT 1 FROM pg_stat_activity
      WHERE application_name = 'zc_ledger_waiter' AND wait_event_type = 'Lock'`), 10_000,
    () => 'Second PostgreSQL session did not wait on a lock');
    writer.child.stdin.end(beforeCommit + '\nCOMMIT;\n');
    const results = await Promise.all([writer.done, waiter.done]);
    for (const row of results) assert.equal(row.code, 0, row.errors);
    return results.map(row => JSON.parse(row.output));
  } finally {
    if (writer.child.exitCode === null) writer.child.kill();
    if (waiter && waiter.child.exitCode === null) waiter.child.kill();
  }
}

async function waitFor(check, timeoutMs, failureMessage) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await check();
    if (result) return result;
    await wait(500);
  } while (Date.now() < deadline);
  assert.fail(failureMessage());
}

function cookieFrom(response, name) {
  const cookie = response.headers.getSetCookie().find(header => header.startsWith(name + '='));
  assert.ok(cookie, `Expected the ${name} cookie on HTTP ${response.status}`);
  return cookie.split(';', 1)[0];
}

async function discordCallback(account) {
  const start = await fetch(appOrigin + '/api/auth/discord', { redirect: 'manual' });
  assert.equal(start.status, 302);
  const authorizeUrl = new URL(start.headers.get('location'));
  assert.equal(authorizeUrl.origin + authorizeUrl.pathname, 'https://discord.com/oauth2/authorize');
  const callbackUrl = new URL(authorizeUrl.searchParams.get('redirect_uri'));
  assert.equal(callbackUrl.href, appOrigin + '/api/auth/discord/callback');
  callbackUrl.searchParams.set('code', account);
  callbackUrl.searchParams.set('state', authorizeUrl.searchParams.get('state'));

  const callback = await fetch(callbackUrl, {
    redirect: 'manual',
    headers: { Cookie: cookieFrom(start, 'zcatchers_oauth_state') },
  });
  assert.equal(callback.status, 302);
  return callback;
}

async function signIn(account, id, isModerator, role) {
  const callback = await discordCallback(account);
  assert.equal(callback.headers.get('location'), appOrigin + '/');
  const cookie = cookieFrom(callback, 'zcatchers_session');
  const state = await fetch(appOrigin + '/api/auth/me', { headers: { Cookie: cookie } });
  assert.equal(state.status, 200);
  const { authenticated, member } = await state.json();
  assert.equal(authenticated, true);
  assert.equal(member.id, id);
  assert.equal(member.role, role);
  assert.equal(member.is_moderator, isModerator);
  return cookieFrom(state, 'zcatchers_session');
}

async function post(path, cookie, body, expectedStatus = 200, headers = {}) {
  const response = await fetch(appOrigin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify({ error: payload.error })}`);
  if (response.ok) assert.equal(payload.success, true, path);
  return payload;
}

const memberTasks = '/api/members/punishments';
const modTasks = '/api/mod/punishments';
async function getTaskData(path, cookie, expectedStatus = 200) {
  const response = await fetch(appOrigin + path, { headers: { Cookie: cookie } });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  return body;
}

async function getRolloverProgress(cookie, timezone, novemberStrikes) {
  const localMonth = () => DateTime.utc().setZone(timezone).toFormat('yyyy-MM');
  const requestMonth = localMonth();
  const summary = await getTaskData(memberTasks, cookie);
  const responseMonth = localMonth();
  // A request that spans local midnight can read either month's progress.
  const expectedMonth = [requestMonth, responseMonth].find(month => month === summary.month);
  assert.ok(expectedMonth, `Expected ${timezone} month ${requestMonth} or ${responseMonth}, got ${summary.month}`);
  assert.equal(summary.strikes_used, expectedMonth === '2026-11' ? novemberStrikes : 0);
  assert.equal(summary.strikes_toward_next, 0);
  return summary;
}

function setupCertificate() {
  const gateway = execFileSync('docker', [
    'inspect', container, '--format', '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}',
  ], { encoding: 'utf8' }).trim();
  assert.match(gateway, /^(?:\d{1,3}\.){3}\d{1,3}$/);
  const certPath = join(workdir, 'zc-smoke.crt');
  const keyPath = join(workdir, 'zc-smoke.key');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Z Catchers CI',
    '-addext', `subjectAltName=IP:${gateway}`, '-keyout', keyPath, '-out', certPath,
  ]);
  // The local Postgres image ships Alpine's CA bundle without update-ca-certificates.
  execFileSync('docker', ['exec', '-i', '-u', 'root', container, 'sh', '-ec', [
    'bundle=/etc/ssl/certs/ca-certificates.crt',
    'cp "$bundle" /tmp/zc-smoke-ca.pem',
    'cat >> /tmp/zc-smoke-ca.pem',
    'chmod 644 /tmp/zc-smoke-ca.pem',
    'mv /tmp/zc-smoke-ca.pem "$bundle"',
  ].join('\n')], { input: readFileSync(certPath) });
  return { gateway, certPath, keyPath };
}

const schema = readFileSync('supabase/schema.sql', 'utf8');
const ledgerMigration = readFileSync('supabase/migrations/20261122_punishment_strike_ledger.sql', 'utf8');
const ledgerStart = schema.indexOf(ledgerMigration.split('\n', 1)[0]);
assert.ok(ledgerStart > 0, 'Expected the pre-ledger schema before the appended ledger migration.');
sql(schema.slice(0, ledgerStart));
sql('UPDATE public.members SET is_active = false');
sql(readFileSync('supabase/migrations/20261118_sleep_logs_member_uuid.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261119_dispatch_accountability.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261120_cron_stage_completion.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261121_push_subscription_rotation.sql', 'utf8'));
const novemberMembers = await insertLegacyNovemberFixtures(sql);
sql(ledgerMigration);
assert.equal(sql('SELECT count(*) FROM public.punishments'), '0');
sql(readFileSync('supabase/migrations/20261123_punishment_task_apis.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261124_guard_active_wake.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261125_verify_punishment_cutover.sql', 'utf8'));
// Start with a linked Owner candidate and a pending request on the legacy schema.
// Keep these accounts away from bedtime during the dispatcher checks below.
const cutoverBedtime = DateTime.utc().plus({ hours: 6 });
const cutoverSchedule = `'${cutoverBedtime.toFormat('HH:mm')}', '${cutoverBedtime.plus({ hours: 8 }).toFormat('HH:mm')}'`;
const cutoverOwnerId = sql(`
  INSERT INTO public.members (discord_username, discord_id, journal_url, timezone, bedtime_local, wake_time_local)
  VALUES ('Owner fixture', '${discordAccounts.owner}', 'https://discord.com/channels/123/456', 'UTC',
    ${cutoverSchedule})
  RETURNING id
`);
const cutoverMemberId = sql(`
  INSERT INTO public.members (
    discord_username, journal_url, timezone, bedtime_local, wake_time_local,
    pending_bedtime_local, pending_wake_time_local, pending_timezone, pending_effective_at
  )
  VALUES ('Pending schedule fixture', 'https://discord.com/channels/123/456', 'UTC',
    ${cutoverSchedule},
    '22:30', '06:30', 'Asia/Kolkata', now() + interval '47 hours')
  RETURNING id
`);
const cutoverQueue = () => sql(`
  SELECT jsonb_object_agg(field, value) FROM public.members, jsonb_each(to_jsonb(members)) AS fields(field, value)
  WHERE members.id = '${cutoverMemberId}' AND left(field, 8) = 'pending_'
`);
const queuedBeforeCutover = cutoverQueue();
assert.equal(JSON.parse(queuedBeforeCutover).pending_bedtime_local, '22:30');
sql(readFileSync('supabase/migrations/20261126_moderation_owner_and_roles.sql', 'utf8'));
const ownerBootstrap = readFileSync('supabase/bootstrap_moderation_owner.sql', 'utf8')
  .replace('owner_id constant uuid := NULL;', `owner_id constant uuid := '${cutoverOwnerId}';`)
  .replace('owner_discord_id constant text := NULL;', `owner_discord_id constant text := '${discordAccounts.owner}';`);
sql(ownerBootstrap);
sql(ownerBootstrap);
sql(readFileSync('supabase/migrations/20261127_moderation_live_roles.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261128_punishment_diagnostics.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261129_staff_strike_corrections.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261130_private_strike_history.sql', 'utf8'));
assert.equal(cutoverQueue(), queuedBeforeCutover);
assert.equal(sql("SELECT id, discord_id, is_active FROM public.members WHERE role = 'owner'"),
  `${cutoverOwnerId}|${discordAccounts.owner}|t`);
const novemberPreview = await verifyNovemberPreview(sql, novemberMembers);
sql(`
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
  NOTIFY pgrst, 'reload schema';
`);

const { gateway, certPath, keyPath } = setupCertificate();
const scheduledRuns = [];
const pushes = [];
const relay = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, async (request, response) => {
  if (request.method === 'POST' && request.url.startsWith('/push/')) {
    assert.match(request.headers.authorization ?? '', /^vapid /i);
    assert.equal(request.headers['content-encoding'], 'aes128gcm');
    for await (const _chunk of request) { /* Drain the encrypted notification. */ }
    pushes.push(request.url.slice('/push/'.length));
    response.writeHead(201).end();
    return;
  }
  if (request.method !== 'GET' || request.url !== dispatcherPath
      || request.headers['x-vercel-protection-bypass'] !== bypassSecret) {
    response.writeHead(401).end();
    return;
  }
  try {
    const result = await fetch(appOrigin + dispatcherPath, {
      headers: { Authorization: request.headers.authorization ?? '' },
      signal: AbortSignal.timeout(50_000),
    });
    const body = await result.json();
    scheduledRuns.push({ status: result.status, body });
    response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  } catch (error) {
    console.error('Cron relay failed:', error.message);
    response.writeHead(502).end();
  }
});
await new Promise((resolve, reject) => {
  relay.once('error', reject);
  relay.listen(0, gateway, resolve);
});
const relayOrigin = `https://${gateway}:${relay.address().port}`;

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey,
  NEXT_PUBLIC_APP_URL: appOrigin,
  VAPID_PRIVATE_KEY: privateKey,
  VAPID_SUBJECT: 'mailto:notifications@example.test',
  NODE_EXTRA_CA_CERTS: certPath,
  SESSION_SECRET: fixtureSecret(),
  PIN_SALT: fixtureSecret(),
  CRON_SECRET: cronSecret,
  MOD_SECRET_PASSCODE: retiredPasscode,
  MOD_DISCORD_IDS: discordAccounts.overdue,
  DISCORD_CLIENT_ID: '100000000000000010',
  DISCORD_CLIENT_SECRET: fixtureSecret(),
  DISCORD_COMMUNITY_WEBHOOK_URL: '',
  DISCORD_SMOKE_ACCOUNTS: JSON.stringify(discordAccounts),
};
const db = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });
let app;
try {
  execFileSync(process.execPath, [nextCli, 'build'], { env, stdio: 'inherit' });
  app = spawn(process.execPath, [
    '--import', './scripts/fixtures/discord-oauth-smoke.mjs', nextCli, 'start', '-H', '127.0.0.1', '-p', '3181',
  ], { env, stdio: 'inherit' });
  await waitFor(async () => {
    const response = await fetch(appOrigin + dispatcherPath).catch(() => null);
    return response?.status === 401;
  }, 20_000, () => 'The production server did not reject an unauthenticated cron request.');

  // Select an evening timezone to avoid making these wall-clock fixtures straddle midnight.
  const now = DateTime.utc();
  const local = ['Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'UTC',
    'Europe/Athens', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Tokyo', 'Pacific/Auckland']
    .map(zone => now.setZone(zone))
    .find(time => time.hour >= 18 && time.hour <= 21);
  assert.ok(local, 'Expected an IANA timezone between 18:00 and 22:00');
  const fixtures = [
    { name: 'wind-down', offset: 18, personal: true, community: false },
    { name: 'overdue', offset: -16, personal: true, community: false },
    { name: 'checked-in', offset: -16, personal: true, community: true },
    { name: 'awake', offset: 100, personal: false, community: true },
    { name: 'pre-launch-miss', offset: -50, personal: false, community: false },
    { name: 'quiet-before-bed', offset: 10, personal: false, community: true },
    { name: 'rested', offset: -120, personal: true, community: true },
  ];
  const { data: members } = await db.from('members').insert(fixtures.map(({ name, offset }) => {
    const bed = local.plus({ minutes: offset });
    return {
      discord_username: name,
      discord_id: discordAccounts[name] ?? null,
      journal_url: 'https://discord.com/channels/123/456',
      timezone: local.zoneName,
      bedtime_local: bed.toFormat('HH:mm'),
      wake_time_local: bed.plus({ hours: 8 }).toFormat('HH:mm'),
      created_at: now.minus({ hours: 3 }).toISO(),
      strike_cycle_month: local.toFormat('yyyy-MM'),
    };
  })).select('id,discord_username').throwOnError();
  const memberId = name => members.find(member => member.discord_username === name).id;
  const cycle = local.toISODate();
  const regularId = memberId('overdue');
  const regularCookie = await signIn('overdue', regularId, false, 'member');
  await db.from('sleep_logs').insert([
    { member_id: memberId('checked-in'), cycle_date: cycle, in_bed_at: now.minus({ minutes: 19 }).toISO() },
    { member_id: memberId('rested'), cycle_date: cycle, in_bed_at: now.minus({ minutes: 125 }).toISO(),
      woke_up_at: now.minus({ minutes: 60 }).toISO(), wake_source: 'button' },
  ]).throwOnError();
  const subscriptions = fixtures.map(({ name, personal, community }) => ({
    member_id: memberId(name), endpoint: relayOrigin + '/push/' + name,
    p256dh_key: createECDH('prime256v1').generateKeys().toString('base64url'),
    auth_key: randomBytes(16).toString('base64url'),
    notify_personal: personal, notify_community: community,
  }));
  const [regularSubscription] = subscriptions.filter(sub => sub.member_id === regularId);
  await db.from('push_subscriptions').insert(subscriptions.filter(sub => sub.member_id !== regularId)).throwOnError();
  await post('/api/push/subscribe', regularCookie, {
    member_id: regularId,
    notify_personal: regularSubscription.notify_personal,
    notify_community: regularSubscription.notify_community,
    subscription: {
      endpoint: regularSubscription.endpoint,
      keys: { p256dh: regularSubscription.p256dh_key, auth: regularSubscription.auth_key },
    },
  });

  assert.equal((await getTaskData(memberTasks, regularCookie, 503)).code, 'PUNISHMENT_ROLLOUT_CLOSED');
  assert.equal((await getTaskData('/api/members', regularCookie)).members
    .find(member => member.id === regularId).open_punishment_count, null);
  const dispatchState = () => sql(`SELECT (SELECT count(*) FROM public.nightly_strike_logs),
    (SELECT count(*) FROM public.notification_logs), (SELECT count(*) FROM public.cron_locks),
    (SELECT count(*) FROM public.punishments)`);
  const beforeDryRun = dispatchState();
  const dryRun = await fetch(appOrigin + dispatcherPath + '?dry_run=true', {
    headers: { Authorization: 'Bearer ' + cronSecret },
  });
  const dryResult = await dryRun.json();
  assert.equal(dryRun.status, 200, JSON.stringify(dryResult));
  assert.equal(dryRun.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(dryResult.details.autoStrikeRecipients.sort(), ['overdue', 'pre-launch-miss']);
  assert.equal(dispatchState(), beforeDryRun);
  assert.equal(pushes.length, 0);

  // Put the activation between the cutoffs for the pre-launch and live misses.
  const activation = now.minus({ minutes: 30 }).toISO();
  sql(`UPDATE public.punishment_rollout SET activated_at = '${activation}' WHERE singleton AND activated_at IS NULL`);
  assert.equal((await getTaskData(memberTasks, regularCookie, 503)).code, 'PUNISHMENT_ROLLOUT_CLOSED');
  sql(`
    SELECT vault.create_secret('${relayOrigin}', 'zcatchers_app_url');
    SELECT vault.create_secret('${cronSecret}', 'zcatchers_cron_secret');
    SELECT vault.create_secret('${bypassSecret}', 'zcatchers_vercel_bypass');
  `);
  sql(readFileSync('supabase/schedule_dispatch.sql', 'utf8'));
  assert.equal(sql("SELECT schedule FROM cron.job WHERE jobname = 'zcatchers-dispatch' AND active"), '* * * * *');
  for (const id of sql('SELECT id FROM public.members ORDER BY id').split('\n')) {
    if (!Object.values(novemberMembers).includes(id)) sql(`SELECT public.seed_november_punishments('${id}')`);
  }
  const firstSeed = await seedNovemberFixtures(sql, novemberPreview);
  await waitFor(() => scheduledRuns.length >= 1, 90_000, () => 'Expected a scheduled dispatch during the November cutover.');
  assert.deepEqual(await seedNovemberFixtures(sql, novemberPreview), firstSeed);
  await waitFor(() => scheduledRuns.length >= 2, 150_000, () => {
    const http = sql("SELECT status_code, error_msg FROM net._http_response ORDER BY id DESC LIMIT 5");
    const cron = sql("SELECT status, return_message FROM cron.job_run_details ORDER BY runid DESC LIMIT 5");
    return `Expected two scheduled HTTP calls. pg_net: ${http || 'no responses'}. Cron: ${cron || 'no runs'}.`;
  });
  const [first, second] = scheduledRuns;
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(first.body.windDownDispatched, 1);
  assert.equal(first.body.bedtimeHitDispatched, 1);
  assert.equal(first.body.communityNagsDispatched, 1);
  assert.equal(first.body.autoStrikesDispatched, 1);
  assert.equal(first.body.strikeWriteFailures, 0);
  assert.equal(second.body.strikeWriteFailures, 0);
  assert.deepEqual(first.body.details.autoStrikeRecipients, ['overdue']);
  for (const name of ['checked-in', 'quiet-before-bed', 'rested']) {
    assert.ok(first.body.details.suppressedDueToSleepShield.some(recipient => recipient.startsWith(name + ' (')), name);
  }
  assert.equal(second.body.windDownDispatched + second.body.bedtimeHitDispatched
    + second.body.communityNagsDispatched + second.body.autoStrikesDispatched, 0);
  assert.deepEqual(pushes.sort(), ['awake', 'overdue', 'overdue', 'wind-down']);
  await waitFor(() => sql('SELECT count(*) FROM net._http_response WHERE status_code = 200') === '2',
    10_000, () => 'pg_net did not record both HTTP 200 responses.');
  sql("SELECT cron.unschedule('zcatchers-dispatch')");

  assert.equal(sql(`
    SELECT sleep_cycle_date, record_type, strikes_used, strikes_count, replacement_until IS NOT NULL
    FROM public.nightly_strike_logs JOIN public.members ON target_member_id = members.id WHERE members.id = '${regularId}'
  `), `${cycle}|strike|1|1|t`);
  assert.equal(sql(`
    SELECT count(*) FROM public.nightly_strike_logs WHERE target_member_id IN
      ('${memberId('pre-launch-miss')}', '${memberId('checked-in')}', '${memberId('rested')}')
  `), '0');
  assert.equal(sql(`SELECT public.get_strike_cycle_total('${regularId}', '${cycle}')`), '1');
  assert.equal(sql(`SELECT verified_strikes FROM public.november_punishment_preview() WHERE member_id = '${regularId}'`),
    cycle.startsWith('2026-11-') ? '1' : '0');
  console.log('Verified hidden rollout, authenticated dry run, active writer, skipped pre-launch miss, and two identical November seeds with active Cron.');
  await verifyNovemberRollover(sql, novemberMembers);
  console.log(sql(readFileSync('scripts/fixtures/rolling-punishment-audit.sql', 'utf8')));
  const senderPayload = Buffer.from(JSON.stringify({ memberId: memberId('awake'), exp: Date.now() + 60_000 })).toString('base64url');
  const senderSignature = createHmac('sha256', env.SESSION_SECRET).update(senderPayload).digest('base64url');
  const nag = (token) => fetch(appOrigin + '/api/members/nag-notif', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ target_member_id: memberId('overdue') }),
  });
  assert.equal((await nag()).status, 401);
  const senderToken = `${senderPayload}.${senderSignature}`;
  const outcomes = await Promise.all([nag(senderToken), nag(senderToken)]);
  const statuses = outcomes.map(response => response.status).sort();
  assert.deepEqual(statuses, [200, 429], JSON.stringify(await Promise.all(outcomes.map(response => response.json()))));
  assert.equal(pushes.length, 5);
  assert.equal(pushes.at(-1), 'overdue');

  await post('/api/members/strikes/metastrike', regularCookie, {
    member_id: regularId, action: 'convert_retroactive', sleep_cycle_date: cycle, reason: 'CI fixture',
  });
  assert.equal(sql(`
    SELECT record_type, strikes_used, strikes_count, metastrikes_used, metastrikes_count
    FROM public.nightly_strike_logs JOIN public.members ON target_member_id = members.id WHERE members.id = '${regularId}'
  `), 'metastrike|0|0|1|1');
  console.log('Verified two authenticated Supabase Cron runs, encrypted pushes, Sleep Shield, atomic nag cooldown, and member strike replacement.');

  const profile = {
    journal_url: 'https://discord.com/channels/123/456',
    timezone: local.zoneName,
    bedtime_local: local.plus({ hours: 1 }).toFormat('HH:mm'),
    wake_time_local: local.plus({ hours: 9 }).toFormat('HH:mm'),
  };
  const callback = await discordCallback('newcomer');
  const join = new URL(callback.headers.get('location'));
  assert.equal(join.origin + join.pathname, appOrigin + '/join');
  const onboardingCookie = cookieFrom(callback, 'zcatchers_claim_token');
  await post('/api/auth/claim-profile', onboardingCookie, { ...profile, journal_url: 123 }, 400);
  await post('/api/auth/claim-profile', onboardingCookie, { ...profile, wake_time_local: profile.bedtime_local }, 400);
  await post('/api/auth/claim-profile', onboardingCookie, {
    ...profile, weekly_schedule: { mon: { bedtime: 123, wake_time: '07:00' } },
  }, 400);
  const { member: newcomer } = await post('/api/auth/claim-profile', cookieFrom(callback, 'zcatchers_claim_token'), {
    ...profile, timezone: 'UTC', claim_token: join.searchParams.get('claim_token'), option: 'new',
  }, 201);
  const newcomerCookie = await signIn('newcomer', newcomer.id, false, 'member');
  const claimCookie = cookieFrom(callback, 'zcatchers_claim_token');
  await post('/api/auth/claim-profile', claimCookie, { option: 'claim', target_member_id: regularId }, 400);
  await post('/api/mod', '', { action: 'verify', mod_passcode: retiredPasscode }, 401);
  assert.equal((await fetch(appOrigin + '/api/mod', {
    headers: { 'x-mod-passcode': retiredPasscode },
  })).status, 401);
  for (const [path, body] of [
    ['/api/members/update-schedule', { member_id: regularId, bedtime_local: profile.bedtime_local }],
    ['/api/members/cancel-pending', { member_id: regularId }],
    ['/api/members/in-bed', { memberId: regularId, action: 'check_in' }],
    ['/api/members/wake-up', { memberId: regularId, mode: 'button' }],
    ['/api/members/strikes/metastrike', { member_id: regularId }],
  ]) {
    await post(path, '', { ...body, pin: '1234', new_pin: '1234' }, 401);
    await post(path, newcomerCookie, body, 403);
  }

  const proactive = await post('/api/members/strikes/metastrike', newcomerCookie, { member_id: newcomer.id });
  assert.equal(proactive.log.record_type, 'metastrike');
  assert.equal(proactive.metastrikes_used, 1);

  await post('/api/mod', regularCookie, { action: 'verify' }, 403);
  const moderatorSessions = new Map();
  for (const account of ['database-mod', 'second-mod']) {
    const { data: moderator } = await db.from('members').insert({
      ...profile, role: 'moderator', discord_username: account, discord_id: discordAccounts[account],
    }).select('id').single().throwOnError();
    const cookie = await signIn(account, moderator.id, true, 'moderator');
    moderatorSessions.set(account, cookie);
    assert.equal((await fetch(appOrigin + '/api/mod', { headers: { Cookie: cookie } })).status, 200);
    for (const action of ['verify', 'add_member', 'reset_pin']) {
      await post('/api/mod', cookie, { action, member_id: regularId }, 400);
    }
    await post('/api/mod', cookie, { action: 'approve_cooldown', member_id: regularId }, 400);
    await post('/api/mod', cookie, { action: 'edit_member', member_id: regularId, timezone: 'Asia/Kolkata' }, 400);
    await post('/api/mod', cookie, { action: 'toggle_active', member_id: regularId, is_active: false }, 403);
    await post('/api/mod/webhook', cookie, { action: 'test' }, 403);
  }
  const dbModCookie = moderatorSessions.get('database-mod');
  const secondModCookie = moderatorSessions.get('second-mod');

  const previousBedtime = local.minus({ minutes: 16 }).toFormat('HH:mm');
  const scheduleStart = DateTime.utc();
  const pending = await post('/api/members/update-schedule', regularCookie, {
    member_id: regularId, bedtime_local: profile.bedtime_local,
  });
  assert.equal(pending.cooldown_applied, true);
  assert.ok(DateTime.fromISO(pending.pending_effective_at) >= scheduleStart.plus({ hours: 48 }));
  assert.ok(DateTime.fromISO(pending.pending_effective_at) <= DateTime.utc().plus({ hours: 48 }));
  assert.equal(pending.member.bedtime_local.slice(0, 5), previousBedtime);
  const cancelled = await post('/api/members/cancel-pending', regularCookie, {
    member_id: regularId, action: 'schedule',
  });
  assert.equal(cancelled.member.pending_effective_at, null);
  assert.equal(cancelled.member.bedtime_local.slice(0, 5), previousBedtime);

  const inBed = action => post('/api/members/in-bed', regularCookie, { memberId: regularId, action });
  const checkIn = await inBed('check_in');
  assert.equal(checkIn.is_in_bed, true);
  const sleepRows = async () => {
    const { data } = await db.from('sleep_logs').select('in_bed_at,woke_up_at,wake_source')
      .eq('member_id', regularId).eq('cycle_date', checkIn.local_date).throwOnError();
    return data;
  };
  assert.ok((await sleepRows())[0]?.in_bed_at);
  assert.equal((await inBed('cancel')).is_in_bed, false);
  assert.deepEqual(await sleepRows(), []);
  assert.equal((await inBed('check_in')).local_date, checkIn.local_date);
  const activeCheckIn = (await sleepRows())[0].in_bed_at;
  const wake = await post('/api/members/wake-up', regularCookie, {
    memberId: regularId, mode: 'button', expectedInBedAt: activeCheckIn,
  });
  await post('/api/members/wake-up', regularCookie, {
    memberId: regularId, mode: 'manual', wokeUpTime: '06:10', expectedInBedAt: activeCheckIn,
  }, 409);
  assert.equal(wake.isDurable, true);
  assert.ok((await sleepRows())[0]?.woke_up_at);
  assert.equal((await sleepRows())[0].wake_source, 'button');

  const receivedBeforeTest = pushes.length;
  const testPush = await post('/api/push/test', regularCookie, {});
  assert.equal(testPush.delivered, 1);
  assert.deepEqual(pushes.slice(receivedBeforeTest), ['overdue']);
  const override = await post('/api/members/update-schedule', regularCookie, {
    member_id: regularId, bedtime_local: profile.bedtime_local,
  });
  assert.equal(override.cooldown_applied, true);
  const approval = { action: 'approve_cooldown', member_id: regularId, expected_pending: override.member };
  const staleTimezone = override.member.pending_timezone === 'Asia/Kolkata' ? 'UTC' : 'Asia/Kolkata';
  await post('/api/mod', dbModCookie, {
    ...approval, expected_pending: { ...override.member, pending_timezone: staleTimezone },
  }, 409);
  await post('/api/mod', dbModCookie, approval);
  assert.equal(sql(`SELECT actor_id FROM public.moderation_actions WHERE target_id = '${regularId}' AND action = 'approve_cooldown'`),
    sql(`SELECT id FROM public.members WHERE discord_id = '${discordAccounts['database-mod']}'`));

  const { data: approved } = await db.from('members').select('bedtime_local,pending_effective_at')
    .eq('id', regularId).single().throwOnError();
  assert.equal(approved.bedtime_local.slice(0, 5), profile.bedtime_local);
  assert.equal(approved.pending_effective_at, null);

  const subscribePath = '/api/push/subscribe';
  const pushPayload = (endpoint) => ({
    endpoint,
    keys: { p256dh: regularSubscription.p256dh_key, auth: regularSubscription.auth_key },
  });
  const legacyEndpoint = relayOrigin + '/push/legacy-rotation';
  const replacementEndpoint = relayOrigin + '/push/credential-rotation';
  const rotation = (previous, next, credential) => ({
    background: true, old_endpoint: previous, subscription: pushPayload(next), rotation_credential: credential,
  });
  await post(subscribePath, newcomerCookie, {
    member_id: regularId, subscription: pushPayload(regularSubscription.endpoint),
  }, 403);
  await post(subscribePath, '', rotation(regularSubscription.endpoint, legacyEndpoint));
  const credential = fixtureSecret();
  const upgraded = await post(subscribePath, regularCookie, {
    member_id: regularId, subscription: pushPayload(legacyEndpoint), rotation_credential: credential,
  });
  assert.equal(upgraded.notifyPersonal, regularSubscription.notify_personal);
  assert.equal(upgraded.notifyCommunity, regularSubscription.notify_community);
  await post(subscribePath, '', rotation(legacyEndpoint, replacementEndpoint), 401);
  const next = rotation(legacyEndpoint, replacementEndpoint, credential);
  await post(subscribePath, '', next);
  await post(subscribePath, '', next); // Lost response and exact retry.
  await post('/api/push/unsubscribe', regularCookie, {
    member_id: regularId, endpoint: legacyEndpoint, rotation_credential: credential,
  });
  await post(subscribePath, '', rotation(legacyEndpoint, replacementEndpoint, credential), 401);
  console.log('Verified legacy push upgrade, sessionless rotation, exact retry and credential revocation.');

  console.log('Verified Discord onboarding and returning sessions, both moderator types, schedule cooldown and cancellation, check-in and undo, wake-up, Metastrikes, and push subscription and delivery.');

  // Use an eligible cutoff and a closed replacement window for these synthetic transaction races.
  const raceMember = name => sql(`INSERT INTO public.members
    (discord_username, journal_url, bedtime_local, timezone) VALUES ('${name}',
    'https://discord.com/channels/123/456', '23:00', 'UTC') RETURNING id;`);
  const automatic = (member, day) => `SELECT public.apply_nightly_strike('${member}', '2026-11-${day}',
    '2026-11', NULL, 'strike', 'smoke', clock_timestamp(), '2026-11-01T00:00Z',
    '${activation}'::timestamptz, '${activation}'::timestamptz, NULL, 0)`;
  const dispatchRace = raceMember('Concurrent Dispatch');
  const [issued, repeated] = await concurrentSql(automatic(dispatchRace, 12), automatic(dispatchRace, 12));
  assert.equal(issued.cycleStrikesUsed, 1);
  assert.equal(repeated.reason, 'already_issued');
  assert.equal(repeated.log.id, issued.log.id);
  assert.equal(sql(`SELECT count(*) FROM public.nightly_strike_history WHERE source_id = '${issued.log.id}'`), '1');

  const checkInRace = raceMember('Concurrent Check-In');
  const [, protectedCycle] = await concurrentSql(`INSERT INTO public.notification_logs(member_id, notification_type, local_date)
    VALUES ('${checkInRace}', 'IN_BED_EARLY', '2026-11-12') RETURNING to_jsonb(id)`, automatic(checkInRace, 12));
  assert.equal(protectedCycle.reason, 'already_checked_in');
  assert.equal(sql(`SELECT count(*) FROM public.nightly_strike_logs WHERE target_member_id = '${checkInRace}'`), '0');

  const seedRace = raceMember('Concurrent November Seed');
  sql(`INSERT INTO public.nightly_strike_logs(target_member_id, sleep_cycle_date, record_type, created_at, updated_at)
    VALUES ('${seedRace}', '2026-11-10', 'strike', '2026-11-10T23:10Z', '2026-11-10T23:10Z'),
      ('${seedRace}', '2026-11-11', 'strike', '2026-11-11T23:10Z', '2026-11-11T23:10Z');`);
  const seed = `SELECT public.seed_november_punishments('${seedRace}')`;
  const [, threshold] = await concurrentSql(seed, automatic(seedRace, 12));
  assert.equal(threshold.cycleStrikesUsed, 3);
  await concurrentSql(seed, seed);
  assert.equal(sql(`SELECT count(*) FROM public.punishments WHERE member_id = '${seedRace}'`), '1');
  assert.equal(sql(`SELECT count(*) FROM public.punishment_actions JOIN public.punishments ON punishment_id = punishments.id
    WHERE member_id = '${seedRace}' AND action = 'earned'`), '1');
  console.log('Verified concurrent dispatch with another worker, durable check-in, and two November seed sessions.');

  assert.equal((await getTaskData(memberTasks, regularCookie, 503)).code, 'PUNISHMENT_ROLLOUT_CLOSED');
  assert.equal((await getTaskData('/api/members', regularCookie)).members
    .find(member => member.id === regularId).open_punishment_count, null);
  const { data: owner } = await db.from('members').select('id,bedtime_local')
    .eq('id', cutoverOwnerId).single().throwOnError();
  const ownerCookie = await signIn('owner', owner.id, true, 'owner');
  assert.equal((await getTaskData(modTasks, ownerCookie, 503)).code, 'PUNISHMENT_ROLLOUT_CLOSED');
  assert.equal((await getTaskData(modTasks, dbModCookie, 503)).code, 'PUNISHMENT_ROLLOUT_CLOSED');
  const westThreshold = firstSeed.find(item => item.member_id === novemberMembers['rollover-west']);
  sql(`UPDATE public.punishments SET assignable_at = assignable_at + interval '1 hour' WHERE id = '${westThreshold.id}'`);
  assert.equal(sql('SELECT issue FROM public.punishment_ledger_issues()'), 'unassigned_task_dates_differ');
  const [, openedAt] = await concurrentSql(`SELECT public.seed_november_punishments('${westThreshold.member_id}')`,
    'SELECT to_jsonb(public.show_verified_november_punishments())');
  assert.equal(DateTime.fromISO(openedAt).toMillis(), DateTime.fromISO(activation).toMillis());
  assert.equal(sql('SELECT count(*) FROM public.punishment_ledger_issues()'), '0');
  console.log('Verified that the visibility check waits for a concurrent seed and reads its committed repair.');

  assert.ok(dbModCookie && secondModCookie);
  await getTaskData(memberTasks, '', 401);
  await getTaskData(memberTasks + '?memberId=' + regularId, newcomerCookie, 403);
  await getTaskData(modTasks, regularCookie, 403);
  const pendingTask = firstSeed.find(item => item.status === 'pending');
  for (const cookie of [ownerCookie, dbModCookie]) {
    for (const [status, task] of [['awaiting_assignment', westThreshold], ['pending', pendingTask]]) {
      const { items } = await getTaskData(`${modTasks}?status=${status}`, cookie);
      assert.ok(items.some(item => item.id === task.id), `Missing ${status} task after opening the gate`);
    }
  }
  for (const [account, strikes, openCount] of [['rollover-west', 3, 1], ['rollover-east', 6, 2]]) {
    const id = novemberMembers[account];
    const { data: { timezone } } = await db.from('members').update({ is_active: true }).eq('id', id)
      .select('timezone').single().throwOnError();
    const cookie = await signIn(account, id, false, 'member');
    const historyPath = '/api/members/strikes?month=2026-11';
    await getTaskData(historyPath + '&memberId=' + id, regularCookie, 403);
    const { entries } = await getTaskData(historyPath, cookie);
    assert.equal(entries.filter(entry => entry.counts).length, strikes);
    assert.ok(entries.some(entry => entry.counts && entry.issued_at === null));
    assert.doesNotMatch(JSON.stringify(entries), /"reason"|"actor"|"details"/);
    const before = await getRolloverProgress(cookie, timezone, strikes);
    assert.equal(before.open_count, openCount);
    const [task] = before.open_items;
    assert.equal(task.earned_month, '2026-11-01');
    assert.equal(task.status, 'awaiting_assignment');
    const assigningCookie = account === 'rollover-west' ? ownerCookie : dbModCookie;
    await post(modTasks, assigningCookie, { action: 'assign', punishment_id: task.id, title: 'Wind-down plan' });
    const { items } = await getTaskData(`${modTasks}?status=assigned`, assigningCookie);
    assert.ok(items.some(item => item.id === task.id));
    const completed = await post(modTasks, secondModCookie, { action: 'complete', punishment_id: task.id });
    assert.equal(completed.open_count, openCount - 1);
    const after = await getRolloverProgress(cookie, timezone, strikes);
    assert.equal(after.history[0].id, task.id);
    assert.equal(after.open_count, openCount - 1);
  }
  console.log('Verified Owner and Moderator punishment access, the November-to-December rollover, and assignment and completion.');
  {
    const correctionMember = raceMember('Dated Roster Correction');
    const review = '/api/mod?view=strike_month&month=2026-11&member_id=' + correctionMember;
    assert.equal((await getTaskData(review, dbModCookie)).open_count, 0);
    assert.equal((await getTaskData(review, dbModCookie)).strikes_used, 0);
    await getTaskData(review, regularCookie, 403);
    await getTaskData('/api/mod?view=strike_month&member_id=' + owner.id, ownerCookie, 403);

    const reviewOrigin = { Origin: appOrigin };
    const correction = {
      member_id: correctionMember, action: 'add_strike', cycle_date: '2026-11-10',
      reason: 'Verified disposable fixture', request_id: randomUUID(),
    };
    await post('/api/mod', dbModCookie, correction, 200, reviewOrigin);
    await post('/api/mod', dbModCookie, { ...correction, cycle_date: '2026-11-11', request_id: randomUUID() }, 200, reviewOrigin);
    const moderatorId = sql(`SELECT id FROM public.members WHERE discord_id = '${discordAccounts['database-mod']}'`);
    const requestId = randomUUID();
    const third = `SELECT public.moderate_dated_strike('${moderatorId}', '${discordAccounts['database-mod']}',
      '${correctionMember}', 'add_strike', '2026-11-12', NULL, 'Concurrent exact retry', '${requestId}')`;
    const [thirdResult, replay] = await concurrentSql(third, third);
    assert.deepEqual(thirdResult, replay);
    assert.equal(thirdResult.open_count, 1);
    assert.equal(thirdResult.strikes_used, 3);
    const rosterCorrectionTask = (await getTaskData(modTasks, dbModCookie)).items.find(item => item.member_id === correctionMember);
    assert.ok(rosterCorrectionTask);

    const rosterRemoval = {
      ...correction, action: 'remove_strike', cycle_date: '2026-11-12',
      request_id: randomUUID(), source_id: thirdResult.correction_id,
    };
    const removed = await post('/api/mod', dbModCookie, rosterRemoval, 200, reviewOrigin);
    assert.equal(removed.open_count, 0);
    assert.equal(removed.strikes_used, 2);
    assert.deepEqual(await post('/api/mod', dbModCookie, rosterRemoval, 200, reviewOrigin), removed);
    assert.equal(sql(`SELECT status FROM public.punishments WHERE id = '${rosterCorrectionTask.id}'`), 'canceled');
    const restored = await post('/api/mod', dbModCookie, {
      ...correction, cycle_date: '2026-11-12', request_id: randomUUID(),
    }, 200, reviewOrigin);
    assert.equal(restored.open_count, 1);
    assert.ok((await getTaskData(modTasks, dbModCookie)).items.some(item => item.id === rosterCorrectionTask.id));
    console.log('Verified roster corrections with zero tasks, concurrent exact retry, cancellation and reopening.');
  }

  const queue = await getTaskData(modTasks, dbModCookie);
  const { id: taskId } = queue.items.find(item => item.member_id === seedRace);
  const assignment = { action: 'assign', punishment_id: taskId, title: 'Wind-down plan' };
  await post(modTasks, regularCookie, assignment, 403);
  await post(modTasks, dbModCookie, assignment);
  const edited = await post(modTasks, secondModCookie, { ...assignment, action: 'edit', title: 'Journal' });
  assert.equal(edited.item.title, 'Journal');
  assert.equal(edited.open_count, 1);

  const complete = "SELECT public.update_punishment('" + taskId + "', 'complete', 'moderator-fixture')";
  const completions = await concurrentSql(complete, complete);
  assert.deepEqual(completions.map(result => result.open_count), [0, 0]);
  assert.deepEqual(completions.map(result => result.item.status), ['completed', 'completed']);
  assert.equal(sql("SELECT count(*) FROM public.punishment_actions WHERE punishment_id = '" + taskId +
    "' AND action = 'completed'"), '1');

  await db.from('members').update({ discord_id: discordAccounts['task-member'] }).eq('id', seedRace).throwOnError();
  const taskMemberCookie = await signIn('task-member', seedRace, false, 'member');
  const ownSummary = await getTaskData(memberTasks, taskMemberCookie);
  const { members: roster } = await getTaskData('/api/members', taskMemberCookie);
  assert.equal(ownSummary.history[0].id, taskId);
  assert.equal(ownSummary.open_count, 0);
  assert.equal(roster.find(member => member.id === seedRace).open_punishment_count, 0);
  assert.ok(roster.filter(member => member.id !== seedRace).every(member => !('open_punishment_count' in member)));
  assert.ok(roster.every(member => !('has_voted_strike' in member) && !member.tonight_strike_log?.voter_ids));

  const wakeRace = raceMember('Concurrent Wake');
  sql(`INSERT INTO public.notification_logs (member_id, notification_type, local_date, dispatched_at)
    VALUES ('${wakeRace}', 'IN_BED_EARLY', '2026-11-20', '2026-11-20T23:00:00Z')`);
  const recordWake = (time, source) => `public.complete_active_check_in(NULL, '2026-11-20T23:00:00Z',
    jsonb_build_object('member_id', '${wakeRace}', 'cycle_date', '2026-11-20', 'timezone', 'UTC',
      'woke_up_at', '2026-11-21T${time}:00Z', 'woke_up_local_time', '${time}',
      'wake_source', '${source}', 'status', 'on_time'))`;
  const staleWake = `CREATE FUNCTION pg_temp.try_wake() RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN RETURN ${recordWake('06:20', 'manual')};
    EXCEPTION WHEN SQLSTATE 'PT409' THEN RETURN jsonb_build_object('conflict', true); END; $$;
    SELECT pg_temp.try_wake()`;
  const [savedWake, wakeConflict] = await concurrentSql(`SELECT ${recordWake('06:35', 'button')}`, staleWake);
  assert.equal(savedWake.sleep_log.woke_up_local_time, '06:35');
  assert.equal(wakeConflict.conflict, true);
  assert.equal(sql(`SELECT woke_up_local_time FROM public.sleep_logs WHERE member_id = '${wakeRace}'`), '06:35');

  const correctionRace = raceMember('Concurrent Correction');
  for (const day of ['14', '15', '16']) sql(automatic(correctionRace, day));
  const correctionTask = sql("SELECT id FROM public.punishments WHERE member_id = '" + correctionRace + "'");
  const source = sql("SELECT id FROM public.nightly_strike_logs WHERE target_member_id = '" + correctionRace +
    "' AND sleep_cycle_date = '2026-11-16'");
  const remove = "SELECT public.update_punishment('" + correctionTask + "', 'remove_strike', 'moderator-fixture', " +
    "p_cycle => '2026-11-16', p_source => '" + source + "', p_reason => 'Verified check-in', " +
    "p_request_id => gen_random_uuid())";
  const tryAssign = `CREATE FUNCTION pg_temp.try_assign() RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN RETURN public.update_punishment('${correctionTask}', 'assign', 'moderator-fixture', 'Journal');
    EXCEPTION WHEN SQLSTATE 'PT409' THEN RETURN jsonb_build_object('conflict', true); END; $$;
    SELECT pg_temp.try_assign()`;
  const [removed, assignConflict] = await concurrentSql(remove, tryAssign);
  assert.equal(removed.item.status, 'canceled');
  assert.equal(removed.open_count, 0);
  assert.equal(assignConflict.conflict, true);
  assert.equal(sql(`SELECT change_type FROM public.nightly_strike_history WHERE source_id = '${source}'`), 'removed');
  console.log('Verified authenticated punishment APIs, private roster counts, concurrent wake-up and task completion, and assignment racing a correction.');

  // Rehearse the supported rollback after activation: hide screens and keep the active writer and history.
  sql('UPDATE public.punishment_rollout SET screens_visible = false WHERE singleton');
  assert.equal((await getTaskData(memberTasks, taskMemberCookie, 503)).code, 'PUNISHMENT_ROLLOUT_CLOSED');
  assert.equal((await getTaskData(modTasks, dbModCookie, 503)).code, 'PUNISHMENT_ROLLOUT_CLOSED');
  assert.equal(sql(`SELECT activated_at = '${activation}'::timestamptz FROM public.punishment_rollout`), 't');
  const whileHidden = JSON.parse(sql(automatic(raceMember('Hidden Writer'), 17)));
  assert.equal(whileHidden.cycleStrikesUsed, 1);
  assert.equal(sql(`SELECT status FROM public.punishments WHERE id = '${taskId}'`), 'completed');
  sql('SELECT public.show_verified_november_punishments()');
  assert.equal((await getTaskData(memberTasks, taskMemberCookie)).history[0].id, taskId);
  console.log('Verified visibility rollback and reopening preserve completed history and keep the new writer active.');

  const origin = { Origin: appOrigin };
  const promote = { action: 'set_moderator', member_id: newcomer.id, expected_role: 'member', new_role: 'moderator' };
  const revoke = { ...promote, expected_role: 'moderator', new_role: 'member' };
  await post('/api/mod', dbModCookie, promote, 403, origin);
  await post('/api/mod', secondModCookie, promote, 403, origin);
  await post('/api/mod', '', { ...promote, mod_passcode: retiredPasscode }, 401, origin);
  await post('/api/mod', ownerCookie, promote, 403, { Origin: 'https://cross-origin.example' });
  await post('/api/mod', ownerCookie, { action: 'toggle_active', member_id: owner.id, is_active: false }, 403, origin);
  await post('/api/mod', ownerCookie, { action: 'delete_member', member_id: owner.id }, 403, origin);
  const ownerSchedule = await post('/api/members/update-schedule', ownerCookie, {
    member_id: owner.id, bedtime_local: owner.bedtime_local.slice(0, 5) === '21:30' ? '21:40' : '21:30',
  });
  assert.equal(ownerSchedule.cooldown_applied, true);

  const readCutoverRequest = async cookie => {
    const response = await fetch(appOrigin + '/api/mod', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const { members } = await response.json();
    return members.find(member => member.id === cutoverMemberId);
  };
  const ownerReviewed = await readCutoverRequest(ownerCookie);
  assert.equal(DateTime.fromISO(ownerReviewed.pending_effective_at).toMillis(),
    DateTime.fromISO(JSON.parse(queuedBeforeCutover).pending_effective_at).toMillis());
  const approveCutoverRequest = {
    action: 'approve_cooldown', member_id: cutoverMemberId, expected_pending: ownerReviewed,
  };
  await post('/api/mod', '', { ...approveCutoverRequest, mod_passcode: retiredPasscode }, 401,
    { ...origin, 'x-mod-passcode': retiredPasscode });
  await post('/api/mod', newcomerCookie, approveCutoverRequest, 403, origin);
  assert.equal(cutoverQueue(), queuedBeforeCutover);
  assert.equal((await post('/api/mod', ownerCookie, promote, 200, origin)).role, 'moderator');
  const moderatorReviewed = await readCutoverRequest(newcomerCookie);
  assert.equal(moderatorReviewed.pending_effective_at, ownerReviewed.pending_effective_at);
  await post('/api/mod', newcomerCookie, { ...approveCutoverRequest, expected_pending: moderatorReviewed }, 200, origin);
  assert.equal(sql(`SELECT bedtime_local, timezone, pending_effective_at IS NULL FROM public.members
    WHERE id = '${cutoverMemberId}'`), '22:30|Asia/Kolkata|t');
  assert.equal(sql(`SELECT actor_id FROM public.moderation_actions
    WHERE target_id = '${cutoverMemberId}' AND action = 'approve_cooldown'`), newcomer.id);
  assert.equal((await post('/api/mod', ownerCookie, revoke, 200, origin)).role, 'member');
  await post('/api/mod', newcomerCookie, approveCutoverRequest, 403, origin);
  assert.equal((await fetch(appOrigin + '/api/mod', { headers: { Cookie: newcomerCookie } })).status, 403);
  console.log('Verified the upgrade preserved the queued request, a promoted session approved it, and its next request after revocation was denied.');

  const grant = `public.set_moderator('${owner.id}', '${discordAccounts.owner}', '${newcomer.id}', 'member', 'moderator')`;
  const tryGrant = `CREATE FUNCTION pg_temp.try_grant() RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN RETURN to_jsonb(${grant});
    EXCEPTION WHEN SQLSTATE 'PT409' THEN RETURN jsonb_build_object('conflict', true); END; $$;
    SELECT pg_temp.try_grant()`;
  const [granted, roleConflict] = await concurrentSql(`SELECT to_jsonb(${grant})`, tryGrant);
  assert.equal(granted, 'moderator');
  assert.equal(roleConflict.conflict, true);
  assert.equal(sql(`SELECT count(*) FROM public.moderator_role_changes
    WHERE actor_member_id = '${owner.id}' AND target_member_id = '${newcomer.id}'`), '3');
  const targetRace = raceMember('Concurrent Target Promotion');
  const modId = sql(`SELECT id FROM public.members WHERE discord_id = '${discordAccounts['database-mod']}'`);
  const promoteTarget = `UPDATE public.members SET role = 'moderator' WHERE id = '${targetRace}' RETURNING to_jsonb(role)`;
  const tryProtectedEdit = `CREATE FUNCTION pg_temp.try_protected_edit() RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN RETURN public.moderate_roster_member('${modId}', '${discordAccounts['database-mod']}',
      '${targetRace}', 'cancel_cooldown');
    EXCEPTION WHEN SQLSTATE 'PT403' THEN RETURN jsonb_build_object('forbidden', true); END; $$;
    SELECT pg_temp.try_protected_edit()`;
  const [promotedTarget, protectedEdit] = await concurrentSql(promoteTarget, tryProtectedEdit);
  assert.equal(promotedTarget, 'moderator');
  assert.equal(protectedEdit.forbidden, true);

  sql(`UPDATE public.members SET pending_bedtime_local = '21:30', pending_wake_time_local = '07:30',
    pending_timezone = 'UTC', pending_effective_at = '2026-11-25T09:00Z' WHERE id = '${regularId}'`);
  const reviewedPending = sql(`SELECT jsonb_build_object(
    'pending_effective_at', pending_effective_at, 'pending_bedtime_local', pending_bedtime_local,
    'pending_wake_time_local', pending_wake_time_local, 'pending_timezone', pending_timezone,
    'pending_weekend_bedtime_local', pending_weekend_bedtime_local, 'pending_weekend_wake_time_local', pending_weekend_wake_time_local,
    'pending_weekly_schedule', pending_weekly_schedule)
    FROM public.members WHERE id = '${regularId}'`);
  const replacePending = `UPDATE public.members SET pending_bedtime_local = '22:00'
    WHERE id = '${regularId}' RETURNING to_jsonb(pending_bedtime_local)`;
  const tryStaleApproval = `CREATE FUNCTION pg_temp.try_stale_approval() RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN RETURN public.moderate_roster_member('${modId}', '${discordAccounts['database-mod']}', '${regularId}',
      'approve_cooldown', p_expected_pending => '${reviewedPending}');
    EXCEPTION WHEN SQLSTATE 'PT409' THEN RETURN jsonb_build_object('conflict', true); END; $$;
    SELECT pg_temp.try_stale_approval()`;
  const [replacement, staleApproval] = await concurrentSql(replacePending, tryStaleApproval);
  assert.equal(replacement, '22:00');
  assert.equal(staleApproval.conflict, true);
  assert.equal(sql(`SELECT pending_bedtime_local FROM public.members WHERE id = '${regularId}'`), '22:00');

  const sleepCancellationRace = raceMember('Concurrent Sleep Cancellation');
  const sleeperDiscordId = '100000000000000998';
  const sleepVersion = '2026-11-21T00:00:00Z';
  const sleepCycleDate = '2026-11-20';
  const checkInTime = '2026-11-20T23:00:00Z';
  sql(`UPDATE public.members SET discord_id = '${sleeperDiscordId}', updated_at = '${sleepVersion}',
      last_notified_stage = 'IN_BED_EARLY', last_notified_cycle_date = '${sleepCycleDate}' WHERE id = '${sleepCancellationRace}';
    INSERT INTO public.notification_logs (member_id, local_date, notification_type, dispatched_at)
      VALUES ('${sleepCancellationRace}', '${sleepCycleDate}', 'IN_BED_EARLY', '${checkInTime}');
    INSERT INTO public.sleep_logs (member_id, cycle_date, in_bed_at, updated_at)
      VALUES ('${sleepCancellationRace}', '${sleepCycleDate}', '${checkInTime}', '${sleepVersion}');`);
  const cancelSleep = `SELECT public.cancel_own_sleep_check_in(
    '${sleepCancellationRace}', '${sleeperDiscordId}', '${sleepCycleDate}', false, '${sleepVersion}')`;
  const tryStaleStaffWake = `CREATE FUNCTION pg_temp.try_stale_staff_wake() RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN RETURN public.moderate_sleep('${modId}', '${discordAccounts['database-mod']}', '${sleepCancellationRace}',
      'log_wake', '${sleepCycleDate}', '2026-11-21T07:00Z', '${sleepVersion}',
      p_entry => jsonb_build_object('in_bed_at', '${checkInTime}', 'woke_up_at', '2026-11-21T07:00Z'),
      p_expected_in_bed_at => '${checkInTime}', p_expected_sleep_updated_at => '${sleepVersion}');
    EXCEPTION WHEN SQLSTATE 'PT409' THEN RETURN jsonb_build_object('conflict', true); END; $$;
    SELECT pg_temp.try_stale_staff_wake()`;
  const [selfCancelled, staffWakeConflict] = await concurrentSql(cancelSleep, tryStaleStaffWake);
  assert.equal(selfCancelled.last_notified_stage, null);
  assert.equal(staffWakeConflict.conflict, true);
  assert.equal(sql(`SELECT count(*) FROM public.sleep_logs WHERE member_id = '${sleepCancellationRace}'`), '0');
  assert.equal(sql(`SELECT count(*) FROM public.notification_logs WHERE member_id = '${sleepCancellationRace}'`), '0');
  console.log('Verified self-service sleep cancellation and a concurrent staff wake serialize without restoring deleted evidence.');

  {
    const legacyPassPath = '/api/members/strikes/metastrike';
    const assignedMember = raceMember('Metastrike Release Assignment');
    sql(`UPDATE public.members SET discord_id = '${discordAccounts['release-assignment']}' WHERE id = '${assignedMember}';`);
    for (const day of ['10', '11', '12']) sql(automatic(assignedMember, day));
    const assignedCookie = await signIn('release-assignment', assignedMember, false, 'member');
    const [preUpgradeTask] = (await getTaskData(memberTasks, assignedCookie)).open_items;
    assert.equal(preUpgradeTask.status, 'awaiting_assignment');
    const assignedTaskId = preUpgradeTask.id;
    await post(modTasks, dbModCookie, {
      action: 'assign', punishment_id: assignedTaskId, title: 'Existing assignment', instructions: 'Keep the plan',
    });
    const legacySnapshot = () => sql(`
      SELECT jsonb_build_object(
        'passes', (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id)
          FROM (SELECT id, target_member_id, sleep_cycle_date, reason, pass_used_on
            FROM public.nightly_strike_logs WHERE record_type = 'metastrike') n),
        'balances', (SELECT jsonb_agg(to_jsonb(b) ORDER BY member_id, month_start) FROM public.strike_pass_months b),
        'assignment', (SELECT to_jsonb(p) FROM public.punishments p WHERE id = '${assignedTaskId}'),
        'completed', (SELECT to_jsonb(p) FROM public.punishments p WHERE id = '${taskId}')
      )
    `);
    const beforeUpgrade = legacySnapshot();
    assert.ok(JSON.parse(beforeUpgrade).passes.length > 0);
    sql(readFileSync('supabase/migrations/20261201_reviewed_metastrikes.sql', 'utf8'));
    sql("NOTIFY pgrst, 'reload schema'");
    assert.equal(legacySnapshot(), beforeUpgrade);
    assert.equal(sql(`SELECT reviewed_metastrikes_required, metastrike_requests_open FROM public.punishment_rollout WHERE singleton`), 'f|f');
    await waitFor(async () => {
      const { error } = await db.rpc('read_moderation_metastrikes', {
        p_actor_id: modId, p_actor_discord_id: discordAccounts['database-mod'],
      });
      if (error?.code === 'PGRST202') return false;
      assert.equal(error, null);
      return true;
    }, 10_000, () => 'PostgREST did not load the reviewed Metastrike migration');

    const reviewMember = raceMember('Reviewed Metastrike Member');
    const legacyMember = raceMember('Legacy Metastrike Client');
    sql(`UPDATE public.members SET discord_id = '${discordAccounts['legacy-metastrike']}' WHERE id = '${legacyMember}';`);
    const legacyCookie = await signIn('legacy-metastrike', legacyMember, false, 'member');
    const oldClient = { member_id: legacyMember, action: 'proactive' };
    assert.equal((await post(legacyPassPath, legacyCookie, oldClient, 200, origin)).metastrikes_used, 1);
    console.log('Verified the additive Metastrike migration preserves legacy balances and task records before enabling review.');
    const prior = DateTime.utc().startOf('month').minus({ months: 1 });
    sql(`UPDATE public.members SET discord_id = '${discordAccounts['review-member']}',
      created_at = '${prior.toISO()}' WHERE id = '${reviewMember}';
      SELECT public.seed_november_punishments('${reviewMember}');`);
    const reviewCookie = await signIn('review-member', reviewMember, false, 'member');
    const memberReviewPath = '/api/members/strikes/metastrike/requests';
    const staffReviewPath = '/api/mod/metastrikes';
    assert.equal((await getTaskData(memberReviewPath, reviewCookie)).submissions_open, false);
    assert.equal(sql(`UPDATE public.punishment_rollout SET reviewed_metastrikes_required = true,
      metastrike_requests_open = true WHERE singleton AND activated_at IS NOT NULL AND screens_visible
      AND NOT reviewed_metastrikes_required AND NOT metastrike_requests_open RETURNING 1;`), '1');
    const reviewWindow = await getTaskData(memberReviewPath, reviewCookie);
    assert.equal(reviewWindow.choices.length, 7);
    const chosenCycle = reviewWindow.choices.at(-1);
    assert.equal(chosenCycle.unavailable_reason, null);
    const reviewRequest = { action: 'submit', request_id: randomUUID(), cycle_date: chosenCycle.cycle_date,
      reason: 'Private disposable request reason' };
    await post(memberReviewPath, reviewCookie, reviewRequest, 403, { Origin: 'https://other.example' });
    const pending = await post(memberReviewPath, reviewCookie, reviewRequest, 200, origin);
    assert.equal(pending.item.status, 'pending');
    assert.equal(pending.quota.reserved, 1);
    assert.deepEqual(await post(memberReviewPath, reviewCookie, reviewRequest, 200, origin), pending);
    await getTaskData(staffReviewPath, reviewCookie, 403);
    const staffReview = await getTaskData(staffReviewPath, dbModCookie);
    assert.equal(staffReview.pending_count, 1);
    assert.equal(staffReview.items[0].reason, reviewRequest.reason);
    const blockedLegacyWrite = { member_id: reviewMember, action: 'proactive' };
    assert.match((await post(legacyPassPath, reviewCookie, blockedLegacyWrite, 409, origin)).error, /reviewed request/i);
    const approvedReview = await post(staffReviewPath, dbModCookie, {
      action: 'approve', request_id: reviewRequest.request_id, expected_source_id: null,
    }, 200, origin);
    assert.equal(approvedReview.item.status, 'approved');
    assert.equal(approvedReview.item.quota.used, 1);
    assert.equal(approvedReview.item.quota.reserved, 0);
    const privateHistory = await getTaskData(memberReviewPath + '?month=' + chosenCycle.cycle_date.slice(0, 7), reviewCookie);
    assert.equal(privateHistory.items[0].status, 'approved');
    assert.equal(privateHistory.items[0].reviewer_id, undefined);
    assert.equal((await getTaskData(memberReviewPath + '?month=' + chosenCycle.cycle_date.slice(0, 7), regularCookie)).items.length, 0);
    assert.equal(sql(`SELECT reason FROM public.nightly_strike_logs WHERE id = '${approvedReview.item.pass_source_id}'`), 'Approved Metastrike');

    // A stored request can outlive its submission window and cross a local month boundary.
    const makeAcceptedReview = (target, sourceId, cycleDate = '2026-11-12') => {
      const id = randomUUID();
      const cutoff = DateTime.fromISO(cycleDate + 'T23:10Z', { setZone: true });
      sql(`INSERT INTO public.metastrike_requests(id,member_id,cycle_date,timezone,cutoff_at,reason,submitted_at,submitted_source_id)
        VALUES ('${id}','${target}','${cycleDate}','UTC','${cutoff.toISO()}','Previously accepted request',
          '${cutoff.plus({ hours: 1 }).toISO()}','${sourceId}');`);
      return id;
    };

    const heldCycle = '2026-11-12';
    const heldSource = sql(`SELECT id FROM public.nightly_strike_logs
      WHERE target_member_id = '${assignedMember}' AND sleep_cycle_date = '${heldCycle}'`);
    const heldRequest = makeAcceptedReview(assignedMember, heldSource, heldCycle);
    const taskDetail = modTasks + '?punishment_id=' + assignedTaskId;
    const heldTask = (await getTaskData(taskDetail, dbModCookie)).item;
    assert.equal(heldTask.status, 'assigned');
    assert.equal(heldTask.metastrike_hold, true);
    assert.equal(heldTask.instructions, 'Keep the plan');
    const completeHeld = { action: 'complete', punishment_id: assignedTaskId };
    assert.match((await post(modTasks, dbModCookie, completeHeld, 409, origin)).error, /on hold/i);

    const priorIssue = prior.plus({ days: 14, hours: 23, minutes: 10 });
    const priorStrikeCycle = priorIssue.toISODate();
    const priorSource = sql(`INSERT INTO public.nightly_strike_logs
      (target_member_id, sleep_cycle_date, record_type, created_at, updated_at)
      VALUES ('${reviewMember}', '${priorStrikeCycle}', 'strike', '${priorIssue.toISO()}', '${priorIssue.toISO()}')
      RETURNING id`);
    const priorRequest = makeAcceptedReview(reviewMember, priorSource, priorStrikeCycle);

    const reviewSnapshot = () => sql(`SELECT jsonb_build_array(
      (SELECT to_jsonb(r) FROM public.metastrike_requests r WHERE id = '${heldRequest}'),
      (SELECT to_jsonb(r) FROM public.metastrike_requests r WHERE id = '${reviewRequest.request_id}'),
      (SELECT to_jsonb(b) FROM public.strike_pass_months b WHERE member_id = '${reviewMember}'
        AND month_start = '${chosenCycle.cycle_date.slice(0, 7)}-01'),
      (SELECT to_jsonb(p) FROM public.punishments p WHERE id = '${assignedTaskId}')
    )`);
    const beforePause = reviewSnapshot();
    sql(`UPDATE public.punishment_rollout SET metastrike_requests_open = false
      WHERE singleton AND reviewed_metastrikes_required`);
    assert.equal(reviewSnapshot(), beforePause);
    assert.equal((await getTaskData(memberReviewPath, reviewCookie)).submissions_open, false);
    assert.match((await post(memberReviewPath, reviewCookie, { ...reviewRequest, request_id: randomUUID() }, 409, origin)).error, /closed/i);
    assert.equal((await post(memberReviewPath, reviewCookie, reviewRequest, 200, origin)).item.status, 'approved');
    assert.equal((await getTaskData(taskDetail, dbModCookie)).item.metastrike_hold, true);
    sql('UPDATE public.punishment_rollout SET screens_visible = false WHERE singleton');
    assert.equal(reviewSnapshot(), beforePause);
    const unusedLegacyWrite = { member_id: seedRace, action: 'proactive' };
    assert.match((await post(legacyPassPath, taskMemberCookie, unusedLegacyWrite, 409, origin)).error, /reviewed request/i);
    await getTaskData(modTasks, dbModCookie, 503);
    assert.equal(sql(`SELECT activated_at = '${activation}'::timestamptz AND reviewed_metastrikes_required
      FROM public.punishment_rollout WHERE singleton`), 't');
    assert.equal(JSON.parse(sql(automatic(raceMember('Paused Metastrike Writer'), 18))).log.record_type, 'strike');
    const pausedDispatch = await fetch(appOrigin + dispatcherPath, { headers: { Authorization: 'Bearer ' + cronSecret } });
    const pausedDispatchResult = await pausedDispatch.json();
    assert.equal(pausedDispatch.status, 200, JSON.stringify(pausedDispatchResult));
    assert.deepEqual(pausedDispatchResult.details.errors, []);
    assert.equal(pausedDispatchResult.strikeWriteFailures, 0);

    const approveHeld = { action: 'approve', request_id: heldRequest, expected_source_id: heldSource };
    const replaced = await post(staffReviewPath, dbModCookie, approveHeld, 200, origin);
    assert.equal(replaced.item.status, 'approved');
    assert.equal(replaced.item.quota.used, 1);
    assert.equal(replaced.item.reviewer_id, modId);
    assert.deepEqual((await post(staffReviewPath, dbModCookie, approveHeld, 200, origin)).item, replaced.item);
    assert.equal(sql(`SELECT status, instructions FROM public.punishments WHERE id = '${assignedTaskId}'`),
      'canceled|Keep the plan');
    assert.equal(sql(`SELECT count(*) FROM public.punishment_actions WHERE punishment_id = '${assignedTaskId}' AND action = 'canceled'`), '1');
    const calendar = await getTaskData('/api/members/strikes?month=2026-11', assignedCookie);
    assert.deepEqual(calendar.entries.filter(entry => entry.cycle_date === heldCycle)
      .map(entry => [entry.status, entry.counts]).sort(), [['protected', false], ['replaced', false]]);

    const approvePrior = { action: 'approve', request_id: priorRequest, expected_source_id: priorSource };
    const crossMonth = await post(staffReviewPath, dbModCookie, approvePrior, 200, origin);
    assert.equal(crossMonth.item.quota.month, prior.toFormat('yyyy-MM'));
    assert.equal(crossMonth.item.quota.used, 1);
    assert.notEqual(crossMonth.projection.month, crossMonth.item.quota.month);
    assert.deepEqual((await post(staffReviewPath, dbModCookie, approvePrior, 200, origin)).item, crossMonth.item);
    assert.equal(sql(`SELECT pass_charged_month FROM public.nightly_strike_logs WHERE id = '${priorSource}'`), prior.toISODate());

    assert.equal(sql('SELECT count(*) FROM public.recent_punishment_ledger_issues()'), '0');
    sql('SELECT public.show_verified_november_punishments()');
    sql('UPDATE public.punishment_rollout SET metastrike_requests_open = true WHERE singleton AND reviewed_metastrikes_required AND screens_visible');
    assert.equal((await getTaskData(memberReviewPath, reviewCookie)).submissions_open, true);
    assert.equal((await getTaskData(memberTasks, taskMemberCookie)).history[0].id, taskId);
    console.log('Verified additive Metastrike upgrade, legacy balances, safe pause, continued strikes and decisions, and previous-month reconciliation.');

    const decideReview = (id, source) =>
      `public.decide_metastrike('${modId}','${discordAccounts['database-mod']}','${id}','approve','${source}')`;
    const approvedRace = makeAcceptedReview(dispatchRace, issued.log.id);
    const approvalSql = `SELECT ${decideReview(approvedRace, issued.log.id)}`;
    const [winningReview, followingDispatcher] = await concurrentSql(approvalSql, automatic(dispatchRace, 12));
    assert.equal(winningReview.item.status, 'approved');
    assert.equal(followingDispatcher.reason, 'metastrike_active');
    assert.equal(JSON.parse(sql(approvalSql)).item.pass_source_id, issued.log.id);
    assert.equal(sql(`SELECT used FROM public.strike_pass_months WHERE member_id = '${dispatchRace}' AND month_start = '2026-11-01'`), '1');
    assert.equal(sql(`SELECT count(*) FROM public.metastrike_requests WHERE id = '${approvedRace}' AND status = 'approved'`), '1');

    const correctionRace = raceMember('Concurrent Metastrike Correction');
    const correctionSource = JSON.parse(sql(automatic(correctionRace, 12))).log.id;
    const correctedRequest = makeAcceptedReview(correctionRace, correctionSource);
    const correctionFirst = `SELECT public.moderate_dated_strike('${modId}','${discordAccounts['database-mod']}',
      '${correctionRace}', 'remove_strike', '2026-11-12', '${correctionSource}', 'Corrected evidence', '${randomUUID()}')`;
    const staleReview = `CREATE FUNCTION pg_temp.try_metastrike_review() RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN RETURN ${decideReview(correctedRequest, correctionSource)};
      EXCEPTION WHEN SQLSTATE 'PT409' THEN RETURN jsonb_build_object('conflict', true); END; $$;
      SELECT pg_temp.try_metastrike_review()`;
    const [, blockedReview] = await concurrentSql(correctionFirst, staleReview);
    assert.equal(blockedReview.conflict, true);
    assert.equal(sql(`SELECT status FROM public.metastrike_requests WHERE id = '${correctedRequest}'`), 'pending');
    console.log('Verified reviewed Metastrike HTTP routes, the legacy write fence, and concurrent dispatch and correction in PostgreSQL.');
  }

  sql(readFileSync('supabase/migrations/20261202_roster_strike_permissions.sql', 'utf8'));
  sql(readFileSync('supabase/migrations/20261203_staff_strikes_and_profile_history.sql', 'utf8'));
  const peerModId = sql(`SELECT id FROM public.members WHERE discord_id = '${discordAccounts['second-mod']}'`);
  const strikeReview = memberId => '/api/mod?view=strike_month&month=2026-11&member_id=' + memberId;
  const rosterStrike = {
    action: 'add_strike', cycle_date: '2026-11-10', reason: 'Verified disposable staff fixture',
  };
  const ownerStrike = await post('/api/mod', ownerCookie, {
    ...rosterStrike, member_id: owner.id, request_id: randomUUID(),
  }, 200, origin);
  const ownerReview = await getTaskData(strikeReview(owner.id), dbModCookie);
  assert.ok(ownerReview.verified_strikes.some(strike => strike.source_id === ownerStrike.correction_id));
  const profilePath = '/api/members/strikes?view=profile&month=2026-11&memberId=' + owner.id;
  const profileHistory = await getTaskData(profilePath, regularCookie);
  assert.ok(profileHistory.entries.some(entry => entry.cycle_date === rosterStrike.cycle_date
    && entry.record_type === 'strike' && entry.source_type === 'moderator' && entry.status === 'counted'));
  assert.doesNotMatch(JSON.stringify(profileHistory), /source_id|replacement_until|Verified disposable staff fixture/);
  await getTaskData(profilePath, '', 401);
  await post('/api/mod', dbModCookie, {
    ...rosterStrike, action: 'remove_strike', member_id: owner.id, source_id: ownerStrike.correction_id, request_id: randomUUID(),
  }, 200, origin);
  await getTaskData(strikeReview(modId), dbModCookie, 403);
  await post('/api/mod', dbModCookie, { ...rosterStrike, member_id: modId, request_id: randomUUID() }, 403, origin);

  const reciprocalStrike = (actorId, account, targetId) => `SELECT public.moderate_dated_strike(
    '${actorId}', '${discordAccounts[account]}', '${targetId}', 'add_strike', '${rosterStrike.cycle_date}',
    NULL, 'Concurrent staff correction', '${randomUUID()}')`;
  const [peerStrike, moderatorStrike] = await concurrentSql(
    reciprocalStrike(modId, 'database-mod', peerModId), reciprocalStrike(peerModId, 'second-mod', modId));
  for (const [cookie, memberId, added] of [[dbModCookie, peerModId, peerStrike], [secondModCookie, modId, moderatorStrike]]) {
    await post('/api/mod', cookie, {
      ...rosterStrike, action: 'remove_strike', member_id: memberId, source_id: added.correction_id, request_id: randomUUID(),
    }, 200, origin);
  }
  const promotionId = '00000000-0000-4000-8000-000000000001';
  const promotionDiscordId = '100000000000004012';
  assert.ok(promotionId < modId);
  sql(`INSERT INTO public.members(id, discord_id, discord_username, journal_url, bedtime_local, timezone)
    VALUES ('${promotionId}', '${promotionDiscordId}', 'Concurrent Strike Promotion',
      'https://discord.com/channels/123/456', '23:00', 'UTC')`);
  const promoteDuringCorrection = `SELECT to_jsonb(public.set_moderator('${owner.id}', '${discordAccounts.owner}',
    '${promotionId}', 'member', 'moderator'))`;
  // The correction must wait on the lower-ID target without first locking its actor.
  const lockActorBeforePromotionCommits = `DO $$ BEGIN
    PERFORM FROM public.members WHERE id = '${modId}' FOR NO KEY UPDATE;
  END $$;`;
  const [promotedDuringCorrection, correctedDuringPromotion] = await concurrentSql(
    promoteDuringCorrection, reciprocalStrike(modId, 'database-mod', promotionId), lockActorBeforePromotionCommits);
  assert.equal(promotedDuringCorrection, 'moderator');
  assert.equal(correctedDuringPromotion.strikes_used, 1);
  console.log('Verified Owner self-correction, Moderator self-denial, reciprocal corrections and a concurrent promotion.');

  sql(readFileSync('supabase/migrations/20261204_punishment_deadlines.sql', 'utf8'));
  const deadlineMember = raceMember('Deadline Smoke Fox');
  for (const day of ['11', '12', '13']) {
    await post('/api/mod', dbModCookie, {
      ...rosterStrike, cycle_date: '2026-11-' + day, member_id: deadlineMember, request_id: randomUUID(),
    }, 200, origin);
  }
  const deadlineTask = sql(`SELECT id FROM public.punishments WHERE member_id = '${deadlineMember}'`);
  const dueAt = DateTime.utc().plus({ days: 7 }).startOf('second');
  const assignedWithDeadline = await post(modTasks, dbModCookie, {
    action: 'assign', punishment_id: deadlineTask, title: 'Journal check-in', due_at: dueAt.toISO(),
  }, 200, origin);
  assert.equal(DateTime.fromISO(assignedWithDeadline.item.due_at).toMillis(), dueAt.toMillis());
  const extendedDueAt = dueAt.plus({ days: 2 });
  const extendedDeadline = await post(modTasks, dbModCookie, {
    action: 'edit', punishment_id: deadlineTask, title: 'Journal check-in', due_at: extendedDueAt.toISO(),
  }, 200, origin);
  assert.equal(DateTime.fromISO(extendedDeadline.item.due_at).toMillis(), extendedDueAt.toMillis());
  const deadlineDone = await post(modTasks, dbModCookie, {
    action: 'complete', punishment_id: deadlineTask,
  }, 200, origin);
  assert.equal(deadlineDone.item.due_at, extendedDeadline.item.due_at);
  assert.equal(deadlineDone.item.status, 'completed');
  console.log('Verified assignment, deadline extension and completion through the PostgREST task API.');

  const recovery = readFileSync('supabase/recover_moderation_owner.sql', 'utf8')
    .replace('owner_id constant uuid := NULL;', `owner_id constant uuid := '${owner.id}';`)
    .replace('old_discord_id constant text := NULL;', `old_discord_id constant text := '${discordAccounts.owner}';`)
    .replace('new_discord_id constant text := NULL;', `new_discord_id constant text := '${discordAccounts['recovered-owner']}';`);
  sql(recovery);
  const recoveredOwner = () => sql("SELECT id, discord_id, is_active, updated_at FROM public.members WHERE role = 'owner'");
  const recoveryResult = recoveredOwner();
  assert.ok(recoveryResult.startsWith(`${owner.id}|${discordAccounts['recovered-owner']}|t|`));
  sql(recovery);
  assert.equal(recoveredOwner(), recoveryResult);
  const revokeAfterRecovery = { action: 'set_moderator', member_id: newcomer.id, expected_role: 'moderator', new_role: 'member' };
  await post('/api/mod', ownerCookie, revokeAfterRecovery, 403, origin);
  const recoveredCookie = await signIn('recovered-owner', owner.id, true, 'owner');
  await post('/api/mod', recoveredCookie, revokeAfterRecovery, 200, origin);
  console.log('Verified the operator recovery preserves the sole Owner profile, invalidates the old session and accepts the recovered identity.');

} finally {
  app?.kill();
  await new Promise(resolve => relay.close(resolve));
}
