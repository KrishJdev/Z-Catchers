import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import webpush from 'web-push';

const workdir = process.env.DISPATCH_SMOKE_WORKDIR;
assert.ok(process.env.GITHUB_ACTIONS === 'true' && workdir, 'Use the isolated dispatcher CI job.');
const container = 'supabase_db_zc_dispatch_smoke';
const nextCli = 'node_modules/next/dist/bin/next';
const appOrigin = 'http://127.0.0.1:3181';
const dispatcherPath = '/api/cron/dispatch-notifications';
const fixtureSecret = () => randomBytes(32).toString('hex');
const cronSecret = fixtureSecret();
const bypassSecret = fixtureSecret();
const modPasscode = fixtureSecret();
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const localSupabase = parseEnv(execFileSync(
  'supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8' },
));
const apiUrl = localSupabase.API_URL;
const anonKey = localSupabase.ANON_KEY || localSupabase.PUBLISHABLE_KEY;
const serviceKey = localSupabase.SERVICE_ROLE_KEY || localSupabase.SECRET_KEY;
assert.ok(anonKey && serviceKey, 'Supabase CLI must provide local API keys.');
assert.equal(new URL(apiUrl).origin, 'http://127.0.0.1:54321', 'Only the disposable CI Data API is supported.');

function sql(input) {
  return execFileSync('docker', [
    'exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
  ], { input, encoding: 'utf8' }).trim();
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

sql(readFileSync('supabase/schema.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261118_sleep_logs_member_uuid.sql', 'utf8'));
sql(readFileSync('supabase/migrations/20261119_dispatch_accountability.sql', 'utf8'));
sql(`
  UPDATE public.members SET is_active = false;
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
  VAPID_PRIVATE_KEY: privateKey,
  VAPID_SUBJECT: 'mailto:notifications@example.test',
  NODE_EXTRA_CA_CERTS: certPath,
  SESSION_SECRET: fixtureSecret(),
  PIN_SALT: fixtureSecret(),
  CRON_SECRET: cronSecret,
  MOD_SECRET_PASSCODE: modPasscode,
};
const db = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });
let app;
try {
  execFileSync(process.execPath, [nextCli, 'build'], { env, stdio: 'inherit' });
  app = spawn(process.execPath, [nextCli, 'start', '-H', '127.0.0.1', '-p', '3181'], { env, stdio: 'inherit' });
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
  ];
  const { data: members } = await db.from('members').insert(fixtures.map(({ name, offset }) => {
    const bed = local.plus({ minutes: offset });
    return {
      discord_username: name,
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
  await db.from('sleep_logs').insert({
    member_id: memberId('checked-in'), cycle_date: cycle, in_bed_at: now.minus({ minutes: 19 }).toISO(),
  }).throwOnError();
  await db.from('push_subscriptions').insert(fixtures.map(({ name, personal, community }) => ({
    member_id: memberId(name), endpoint: relayOrigin + '/push/' + name,
    p256dh_key: createECDH('prime256v1').generateKeys().toString('base64url'),
    auth_key: randomBytes(16).toString('base64url'),
    notify_personal: personal, notify_community: community,
  }))).throwOnError();

  const dryRun = await fetch(appOrigin + dispatcherPath + '?dry_run=true', {
    headers: { Authorization: 'Bearer ' + cronSecret },
  });
  assert.equal(dryRun.status, 200, await dryRun.text());
  assert.equal(pushes.length, 0);
  assert.equal(sql('SELECT count(*) FROM public.nightly_strike_logs'), '0');

  sql(`
    SELECT vault.create_secret('${relayOrigin}', 'zcatchers_app_url');
    SELECT vault.create_secret('${cronSecret}', 'zcatchers_cron_secret');
    SELECT vault.create_secret('${bypassSecret}', 'zcatchers_vercel_bypass');
  `);
  sql(readFileSync('supabase/schedule_dispatch.sql', 'utf8'));
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
  assert.equal(second.body.windDownDispatched + second.body.bedtimeHitDispatched
    + second.body.communityNagsDispatched + second.body.autoStrikesDispatched, 0);
  assert.deepEqual(pushes.sort(), ['awake', 'overdue', 'overdue', 'wind-down']);
  await waitFor(() => sql('SELECT count(*) FROM net._http_response WHERE status_code = 200') === '2',
    10_000, () => 'pg_net did not record both HTTP 200 responses.');

  assert.equal(sql(`
    SELECT sleep_cycle_date, record_type, strikes_used, strikes_count
    FROM public.nightly_strike_logs JOIN public.members ON target_member_id = members.id
  `), `${cycle}|strike|1|1`);
  const nag = () => fetch(appOrigin + '/api/members/nag-notif', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_member_id: memberId('overdue') }),
  });
  const outcomes = await Promise.all([nag(), nag()]);
  const statuses = outcomes.map(response => response.status).sort();
  assert.deepEqual(statuses, [200, 429], JSON.stringify(await Promise.all(outcomes.map(response => response.json()))));
  assert.equal(pushes.length, 5);
  assert.equal(pushes.at(-1), 'overdue');

  const metastrike = await fetch(appOrigin + '/api/members/strikes/metastrike', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mod-passcode': modPasscode },
    body: JSON.stringify({
      member_id: memberId('overdue'), action: 'convert_retroactive', sleep_cycle_date: cycle, reason: 'CI fixture',
    }),
  });
  assert.equal(metastrike.status, 200, await metastrike.text());
  assert.equal(sql(`
    SELECT record_type, strikes_used, strikes_count, metastrikes_used, metastrikes_count
    FROM public.nightly_strike_logs JOIN public.members ON target_member_id = members.id
  `), 'metastrike|0|0|1|1');
  console.log('Verified two authenticated cron runs, encrypted pushes, Sleep Shield, atomic nag cooldown, and strike replacement.');
} finally {
  app?.kill();
  await new Promise(resolve => relay.close(resolve));
}
