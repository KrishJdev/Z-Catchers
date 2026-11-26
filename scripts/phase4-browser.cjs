const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PHASE4_PLAYWRIGHT || 'playwright');

const output = process.env.PHASE4_ARTIFACT || 'phase4-screenshots';
const now = new Date('2026-11-26T18:45:00Z');
const avatar = color => 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="' + color + '"/><path fill="#f5ebe1" d="M7 9l9 5h8l9-5-1 14c-1 7-6 10-12 12-6-2-11-5-12-12z"/><path fill="' + color + '" d="M12 21l4 2-4 1zm16 0-4 2 4 1zm-10 6h4l-2 3z"/></svg>');
const self = {
  id: '1', discord_id: '2000001', discord_username: 'Rowan', discord_handle: 'rowan',
  timezone: 'Asia/Kolkata', bedtime_local: '23:00', wake_time_local: '07:00', is_active: true,
  weekly_schedule: { thu: { bedtime: '22:45', wake_time: '06:55' } }, role: 'moderator', is_moderator: true,
  streak_days: 6, open_punishment_count: 1, strikes_count: 1, avatar_url: avatar('#906344'),
  journal_url: 'https://discord.com/channels/123/451', pending_effective_at: '2026-11-28T18:45:00Z',
  pending_bedtime_local: '23:15', pending_wake_time_local: '07:15', pending_timezone: 'Asia/Kolkata',
};
const peer = {
  id: '2', discord_id: '2000002', discord_username: 'A Very Long Display Name for a California Night Fox',
  timezone: 'America/Los_Angeles', bedtime_local: '23:15', wake_time_local: '07:40', is_active: true,
  role: 'member', streak_days: 4, strikes_count: 2, avatar_url: avatar('#795c76'),
  journal_url: 'https://discord.com/channels/123/452',
};
const profiles = [self, peer];
const logs = [
  { cycle_date: '2026-11-23', status: 'on_time', in_bed_local_time: '22:56', woke_up_local_time: '07:06',
    target_bedtime: '23:00', target_wake_time: '07:00', wake_source: 'button', duration_minutes: 490 },
  { cycle_date: '2026-11-25', status: 'late', in_bed_local_time: '23:35', woke_up_local_time: '07:10',
    target_bedtime: '23:00', target_wake_time: '07:00', wake_source: 'manual', duration_minutes: 455 },
  { cycle_date: '2026-11-26', status: 'missed', target_bedtime: '22:45', target_wake_time: '06:55' },
];
const strike = {
  cycle_date: '2026-11-25', record_type: 'strike', source_type: 'moderator', counts: true,
  status: 'counted', issued_at: '2026-11-25T18:00:00Z', issuance_timezone: self.timezone,
};
const pass = { ...strike, record_type: 'metastrike', counts: false, status: 'protected' };
const activeQuota = { month: '2026-11', used: 1, reserved: 0, remaining: 2 };
const servers = [];

async function start(folder, port) {
  const cli = require.resolve('next/dist/bin/next');
  const server = spawn(process.execPath, [cli, 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: folder, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(server);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Next startup timed out')), 60000);
    server.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      if (String(chunk).includes('Ready in')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    server.on('exit', code => { clearTimeout(timer); reject(Error('Next exited ' + code)); });
    server.on('error', reject);
  });
  return 'http://127.0.0.1:' + port;
}

async function setup(browser, origin, width) {
  const context = await browser.newContext({
    viewport: { width, height: width < 768 ? 844 : 900 }, isMobile: width < 768, hasTouch: width < 768,
    timezoneId: 'Asia/Kolkata', serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.clock.setFixedTime(now);
  await context.addInitScript(() => {
    localStorage.setItem('zcatchers_unified_onboarding_dismissed_at', String(Date.now()));
    sessionStorage.setItem('zc_bucket_awake_expanded', 'true');
  });
  const requested = { strikes: [], wake: [], privateHistory: 0, failLogs: false, failStrikes: false, failWake: true };
  const sleepLogs = logs.map(log => ({ ...log }));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const query = url.searchParams;
    const month = query.get('month');
    const json = (value, status = 200) => route.fulfill({ status, json: value });
    if (url.origin === 'https://discord.com') return route.fulfill({ body: 'Fixture journal' });
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/auth/me') return json({ authenticated: true, member: self });
    if (url.pathname === '/api/members') return json({ members: profiles });
    if (url.pathname === '/api/mod') return json({ members: profiles, actor: { id: self.id, role: 'moderator' } });
    if (url.pathname === '/api/members/sleep-history') {
      if (requested.failLogs) return json({ error: 'Fixture sleep read failed' }, 503);
      const target = profiles.find(item => item.id === query.get('memberId'));
      return json({
        member: { id: target.id, name: target.discord_username, timezone: target.timezone, current_streak: target.streak_days },
        month, logs: month === '2026-11' ? sleepLogs : [],
        summary: { totalLoggedNights: month === '2026-11' ? 3 : 0, avgDurationMinutes: 473,
          avgBedtime: '23:16', avgWakeTime: '07:08', onTimePercentage: 33 },
      });
    }
    if (url.pathname === '/api/members/strikes') {
      const view = query.get('view');
      requested.strikes.push(view);
      if (requested.failStrikes) return json({ error: 'Fixture strike read failed' }, 503);
      return json({ month, timezone: view === 'self' ? self.timezone : peer.timezone,
        entries: month === '2026-11' ? [strike, pass] : [] });
    }
    if (url.pathname === '/api/members/wake-up') {
      const payload = route.request().postDataJSON();
      requested.wake.push(payload);
      if (requested.failWake) { requested.failWake = false; return json({ error: 'Fixture wake save failed' }, 503); }
      sleepLogs[1].woke_up_local_time = payload.wokeUpTime;
      return json({ formatted_duration: '7h 35m' });
    }
    if (url.pathname === '/api/members/strikes/metastrike/requests') {
      requested.privateHistory++;
      return json({
        submissions_open: true, current_cycle: '2026-11-26', quota: activeQuota, items: [], timezone: self.timezone,
        choices: ['2026-11-26', '2026-11-25'].map(cycle_date => ({ cycle_date, quota: activeQuota, unavailable_reason: null })),
      });
    }
    if (url.pathname === '/api/members/punishments') return json({
      month: '2026-11', strikes_used: 1, strikes_toward_next: 1, strikes_per_punishment: 3,
      metastrikes_used: 1, open_count: 1, history: [],
      open_items: [{ id: 'open', title: 'October wind-down task', status: 'assigned',
        earned_cycle_date: '2026-10-30', due_at: '2026-11-25T19:00:00Z', member_timezone: self.timezone }],
    });
    if (url.pathname.startsWith('/api/')) return json({});
    return route.continue();
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('button', { name: "View " + peer.discord_username + "'s profile" }).waitFor();
  return { context, page, requested };
}

const peerTrigger = page => page.getByRole('button', { name: "View " + peer.discord_username + "'s profile" });
const day = (dialog, number) => dialog.getByRole('button', { name: new RegExp('^November ' + number + ',') });
const screenshot = (page, name) => page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled' });

async function captureBaseline(browser, origin, width) {
  const { context, page } = await setup(browser, origin, width);
  try {
    await peerTrigger(page).click();
    await day(page.getByRole('dialog', { name: peer.discord_username }), 25).waitFor();
    await screenshot(page, 'before-profile-' + width);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'My Sleep', exact: true }).click();
    await day(page.getByRole('dialog', { name: 'My Sleep' }), 25).waitFor();
    await screenshot(page, 'before-my-sleep-' + width);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open profile', exact: true }).click();
    await page.getByRole('dialog', { name: 'Profile', exact: true }).waitFor();
    await screenshot(page, 'before-account-' + width);
  } finally { await context.close(); }
}

async function verify(browser, origin, width) {
  const { context, page, requested } = await setup(browser, origin, width);
  const capture = width === 390 || width === 1440;
  try {
    await peerTrigger(page).click();
    const profile = page.getByRole('dialog', { name: peer.discord_username });
    const journal = profile.getByRole('link', { name: 'Open journal' });
    assert.equal(await journal.getAttribute('href'), peer.journal_url);
    const star = profile.getByRole('button', { name: 'Star member' });
    await star.click();
    assert.equal(await star.getAttribute('aria-pressed'), 'true');
    await profile.getByText('10:45 AM local', { exact: false }).waitFor();
    await profile.getByRole('button', { name: /November 25.*Late check-in.*Strike history.*Metastrike history/ }).waitFor();
    assert.equal(await day(profile, 26).getAttribute('aria-current'), 'date');
    const touching = await day(profile, 25).boundingBox();
    assert(touching.width >= 44 && touching.height >= 44, 'Accessible day size at ' + width);
    if (capture) await screenshot(page, 'after-profile-' + width);
    await day(profile, 25).press('Enter');
    const inspector = profile.locator('#selected-sleep-night');
    await inspector.getByText('Strike counts', { exact: false }).waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'selected-sleep-night');
    assert.equal(await day(profile, 25).getAttribute('aria-pressed'), 'true');
    assert.equal(await profile.getByRole('button', { name: /Wake-Up Time|Request Metastrike|Punishments/ }).count(), 0);
    assert.equal(requested.privateHistory, 0);
    assert(requested.strikes.every(view => view === 'profile'));
    const grid = await profile.getByRole('region', { name: 'Sleep calendar' }).boundingBox();
    const detail = await inspector.boundingBox();
    if (width >= 1024) assert(detail.x >= grid.x + grid.width && Math.abs(detail.y - grid.y) < 2);
    else {
      const gap = detail.y - (grid.y + grid.height);
      assert(gap >= 0 && gap <= 14, 'Inspector gap at ' + width + ' px was ' + gap);
    }
    assert(await profile.evaluate(element => element.scrollWidth <= element.clientWidth));
    await profile.getByRole('button', { name: 'Schedule', exact: true }).click();
    await profile.getByRole('heading', { name: 'Weekly schedule', exact: true }).waitFor();
    await profile.getByRole('button', { name: 'Calendar', exact: true }).click();
    assert.equal(await day(profile, 25).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    await profile.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('View A Very Long'));

    await page.getByRole('button', { name: 'My Sleep', exact: true }).click();
    const my = page.getByRole('dialog', { name: 'My Sleep' });
    await my.getByText('10:45 PM', { exact: true }).waitFor();
    await my.getByText('6:55 AM', { exact: true }).waitFor();
    await day(my, 25).waitFor();
    if (capture) await screenshot(page, 'after-my-sleep-' + width);
    await day(my, 25).click();
    const edit = my.locator('#selected-sleep-night');
    await edit.getByRole('button', { name: 'Request Metastrike' }).click();
    const passDialog = page.getByRole('dialog', { name: /Request.*Metastrike/ });
    await passDialog.getByRole('combobox').waitFor();
    assert.equal(await passDialog.getByRole('combobox').inputValue(), '2026-11-25');
    await page.keyboard.press('Escape');
    await passDialog.waitFor({ state: 'hidden' });

    await edit.getByRole('button', { name: 'Edit Wake-Up Time' }).click();
    await edit.getByLabel('Enter wake time:').fill('07:20');
    await edit.getByRole('button', { name: 'Save Wake Time' }).click();
    await edit.getByRole('alert').getByText('Fixture wake save failed').waitFor();
    assert.equal(await edit.getByLabel('Enter wake time:').inputValue(), '07:20');
    await edit.getByRole('button', { name: 'Save Wake Time' }).click();
    await edit.getByRole('status').getByText(/Logged!/).waitFor();
    assert.equal(requested.wake.length, 2);
    assert(requested.wake.every(value => value.memberId === self.id && value.cycleDate === '2026-11-25'));

    requested.failLogs = true;
    requested.failStrikes = true;
    await my.getByRole('button', { name: 'Previous month' }).click();
    await my.getByText('Fixture sleep read failed', { exact: true }).waitFor();
    await my.getByRole('button', { name: 'Retry strike history' }).waitFor();
    requested.failLogs = false;
    requested.failStrikes = false;
    await my.getByRole('button', { name: 'Retry sleep logs' }).click();
    await my.getByRole('button', { name: 'Retry strike history' }).click();
    await my.getByText('No sleep activity recorded for this night.').waitFor();
    await my.getByText('No recorded strikes or Metastrikes this month.').waitFor();
    await my.getByRole('button', { name: 'Next month' }).click();
    await day(my, 25).waitFor();
    await my.getByRole('button', { name: 'Punishments', exact: true }).click();
    await my.getByRole('region', { name: 'Monthly progress' }).getByText('November 2026').waitFor();
    await my.getByRole('region', { name: /Open punishments/ }).getByText('October wind-down task').waitFor();
    await my.getByText(/Overdue.*due/).waitFor();
    await my.getByRole('region', { name: 'Completed history' }).waitFor();
    if (capture) await screenshot(page, 'after-punishments-' + width);
    await page.keyboard.press('Escape');

    const selfCard = page.getByRole('region', { name: 'Rowan member card' });
    await selfCard.getByRole('button', { name: 'Details for Rowan' }).click();
    await page.getByRole('dialog', { name: 'Rowan', exact: true }).getByRole('button', { name: /Punishments/ }).click();
    await my.getByRole('button', { name: 'Punishments', pressed: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open account settings' }).click();
    const account = page.getByRole('dialog', { name: 'Account settings', exact: true });
    await account.getByRole('button', { name: /Sleep schedule.*Pending change applies/ }).waitFor();
    await account.getByText('@rowan').waitFor();
    if (capture) await screenshot(page, 'after-account-' + width);
    await account.getByRole('button', { name: 'Edit profile', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit profile', exact: true }).getByText('Website Username', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to account settings' }).click();
    await account.getByRole('button', { name: /Sleep schedule/ }).click();
    await page.getByRole('dialog', { name: 'Sleep schedule', exact: true }).waitFor();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: width < 768 ? 'Mod' : 'Mod Panel', exact: true }).click();
    await page.getByRole('navigation', { name: 'Moderation views' }).getByRole('button', { name: 'Roster', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search roster' }).waitFor();
    await page.keyboard.press('Escape');
    console.log('Phase 4 responsive and interaction checks passed at ' + width + ' px');
  } finally { await context.close(); }
}

async function main() {
  mkdirSync(output, { recursive: true });
  const [before, after] = await Promise.all([start(process.env.PHASE4_BASELINE, 3196), start(process.cwd(), 3197)]);
  const browser = await chromium.launch({ executablePath: process.env.PHASE4_BROWSER || undefined });
  try {
    await Promise.all([captureBaseline(browser, before, 390), captureBaseline(browser, before, 1440)]);
    const widths = [360, 390, 430, 768, 1024, 1440];
    const results = await Promise.allSettled(widths.map(width => verify(browser, after, width)));
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') console.error('Phase 4 verification failed at ' + widths[index] + ' px', result.reason);
    }
    if (results.some(result => result.status === 'rejected')) throw new Error('One or more browser widths failed');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const server of servers) server.kill();
});
