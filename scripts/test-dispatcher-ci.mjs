import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createECDH, createHmac, randomBytes } from 'node:crypto';
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
  owner: '100000000000000100',
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

async function concurrentSql(first, second) {
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
    writer.child.stdin.end('COMMIT;\n');
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
sql(readFileSync('supabase/migrations/20261126_moderation_owner_and_roles.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261127_moderation_live_roles.sql', 'utf8'));
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

  await getTaskData(memberTasks, regularCookie, 503);
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
  assert.deepEqual(dryResult.details.autoStrikeRecipients.sort(), ['overdue', 'pre-launch-miss']);
  assert.equal(dispatchState(), beforeDryRun);
  assert.equal(pushes.length, 0);

  // Put the activation between the cutoffs for the pre-launch and live misses.
  const activation = now.minus({ minutes: 30 }).toISO();
  sql(`UPDATE public.punishment_rollout SET activated_at = '${activation}' WHERE singleton AND activated_at IS NULL`);
  await getTaskData(memberTasks, regularCookie, 503);
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

  await getTaskData(memberTasks, regularCookie, 503);
  assert.equal((await getTaskData('/api/members', regularCookie)).members
    .find(member => member.id === regularId).open_punishment_count, null);
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
  for (const [account, strikes, openCount] of [['rollover-west', 3, 1], ['rollover-east', 6, 2]]) {
    const id = novemberMembers[account];
    const { data: { timezone } } = await db.from('members').update({ is_active: true }).eq('id', id)
      .select('timezone').single().throwOnError();
    const cookie = await signIn(account, id, false, 'member');
    const before = await getRolloverProgress(cookie, timezone, strikes);
    assert.equal(before.open_count, openCount);
    const [task] = before.open_items;
    assert.equal(task.earned_month, '2026-11-01');
    assert.equal(task.status, 'awaiting_assignment');
    await post(modTasks, dbModCookie, { action: 'assign', punishment_id: task.id, title: 'Wind-down plan' });
    const completed = await post(modTasks, secondModCookie, { action: 'complete', punishment_id: task.id });
    assert.equal(completed.open_count, openCount - 1);
    const after = await getRolloverProgress(cookie, timezone, strikes);
    assert.equal(after.history[0].id, task.id);
    assert.equal(after.open_count, openCount - 1);
  }
  console.log('Verified November-to-December rollover in Tokyo and Los Angeles and assignment and completion of November work.');
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
  console.log('Verified authenticated punishment APIs, private roster counts, concurrent wake-up and task completion, and assignment racing a correction.');

  // Rehearse the supported rollback after activation: hide screens and keep the active writer and history.
  sql('UPDATE public.punishment_rollout SET screens_visible = false WHERE singleton');
  await getTaskData(memberTasks, taskMemberCookie, 503);
  await getTaskData(modTasks, dbModCookie, 503);
  assert.equal(sql(`SELECT activated_at = '${activation}'::timestamptz FROM public.punishment_rollout`), 't');
  const whileHidden = JSON.parse(sql(automatic(raceMember('Hidden Writer'), 17)));
  assert.equal(whileHidden.cycleStrikesUsed, 1);
  assert.equal(sql(`SELECT status FROM public.punishments WHERE id = '${taskId}'`), 'completed');
  sql('SELECT public.show_verified_november_punishments()');
  assert.equal((await getTaskData(memberTasks, taskMemberCookie)).history[0].id, taskId);
  console.log('Verified visibility rollback and reopening preserve completed history and keep the new writer active.');

  const { data: owner } = await db.from('members').insert({
    ...profile, discord_username: 'Owner fixture', discord_id: discordAccounts.owner,
  }).select('id,bedtime_local').single().throwOnError();
  const ownerBootstrap = readFileSync('supabase/bootstrap_moderation_owner.sql', 'utf8')
    .replace('owner_id constant uuid := NULL;', `owner_id constant uuid := '${owner.id}';`)
    .replace('owner_discord_id constant text := NULL;', `owner_discord_id constant text := '${discordAccounts.owner}';`);
  sql(ownerBootstrap);
  sql(ownerBootstrap);
  const ownerCookie = await signIn('owner', owner.id, true, 'owner');
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
    member_id: owner.id, bedtime_local: owner.bedtime_local === '21:30' ? '21:40' : '21:30',
  });
  assert.equal(ownerSchedule.cooldown_applied, true);
  assert.equal((await post('/api/mod', ownerCookie, promote, 200, origin)).role, 'moderator');
  const edit = { action: 'edit_member', member_id: regularId, discord_username: 'Regular fixture' };
  await post('/api/mod', newcomerCookie, edit);
  assert.equal((await post('/api/mod', ownerCookie, revoke, 200, origin)).role, 'member');
  await post('/api/mod', newcomerCookie, edit, 403);

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
  console.log('Verified owner-only bootstrap and role changes, live revocation, and transaction races for target promotion and schedule replacement.');

} finally {
  app?.kill();
  await new Promise(resolve => relay.close(resolve));
}
