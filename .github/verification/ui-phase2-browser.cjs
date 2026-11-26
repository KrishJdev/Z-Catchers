const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PHASE2_PLAYWRIGHT || 'playwright');

const folders = [process.env.PHASE2_BASELINE, process.cwd()];
const artifact = process.env.PHASE2_ARTIFACT_DIR || path.resolve('phase2-screenshots');
const servers = [];
const now = '2026-11-26T18:45:00Z';
const avatar = tone => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="' + tone + '"/><path fill="#f5ebe1" d="M7 9l9 5h8l9-5-1 14c-1 7-6 10-12 12-6-2-11-5-12-12z"/><path fill="' + tone + '" d="M12 21l4 2-4 1zm16 0l-4 2 4 1zm-10 6h4l-2 3z"/></svg>');
const profile = (id, name, zone, bed, wake, tone, extra = {}) => ({
  id, discord_username: name, timezone: zone, bedtime_local: bed, wake_time_local: wake,
  is_active: true, discord_id: '200000' + id, role: 'member',
  journal_url: 'https://discord.com/channels/123/45' + id, avatar_url: avatar(tone), ...extra,
});
const self = profile('1', 'Rowan', 'Asia/Kolkata', '23:30', '07:30', '#8c573c', { open_punishment_count: 2, streak_days: 14 });
const overdue = profile('2', 'The Very Long Display Name of a Fox in Tokyo', 'Asia/Tokyo', '03:30', '11:00', '#aa6d3f',
  { role: 'moderator', is_moderator: true, streak_days: 10, open_punishment_count: 9, strikes_count: 1,
    nag_assists_count: 2, pending_bedtime_local: '04:00', pending_timezone: 'Asia/Tokyo', pending_effective_at: '2026-11-28T18:45:00Z' });
const grace = profile('3', 'Ari', 'Europe/Athens', '20:42', '04:30', '#73584f');
const winding = profile('4', 'Juniper', 'America/New_York', '14:05', '22:00', '#795247');
const awake = profile('5', 'London Fox', 'Europe/London', '22:30', '07:00', '#785a3e');
const sleeping = profile('6', 'California Fox', 'America/Los_Angeles', '10:00', '18:00', '#665646',
  { is_in_bed: true, in_bed_at: '2026-11-26T18:00:00Z' });
const quiet = profile('7', 'Sage', 'Europe/London', '23:00', '06:00', '#6d493a');
const peers = [overdue, grace, winding, awake, sleeping, quiet];
const profiles = [self, ...peers];
const card = (page, member) => page.getByRole('region', { name: member.discord_username + ' member card', exact: true });
const detailsButton = (page, member) => card(page, member).getByRole('button', { name: 'Details for ' + member.discord_username });
const profileButton = (page, member) => card(page, member).getByRole('button', { name: "View " + member.discord_username + "'s profile", exact: true });
const bucket = (page, id) => page.locator('#bucket-heading-' + id);

async function serve(folder, port) {
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [process.cwd()] }), 'dev',
    '--hostname', '127.0.0.1', '--port', String(port)], { cwd: folder, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(server);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Next did not start on ' + port)), 35000);
    server.stdout.on('data', output => {
      process.stdout.write(output);
      if (String(output).includes('Ready in')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', output => process.stderr.write(output));
    server.on('exit', code => { clearTimeout(timer); reject(Error('Next exited ' + code)); });
    server.on('error', reject);
  });
  return 'http://127.0.0.1:' + port;
}

async function fixture(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 768,
    hasTouch: width < 768, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.clock.install({ time: new Date(now) });
  await context.addInitScript(() => {
    localStorage.setItem('zcatchers_unified_onboarding_dismissed_at', String(Date.now()));
    sessionStorage.setItem('zc_bucket_awake_expanded', 'true');
    sessionStorage.setItem('zc_bucket_sleeping_expanded', 'true');
  });
  const assists = [];
  const nags = [];
  let failNextAssist = false;
  let failRoster = false;
  let emptyRoster = false;
  let punishmentReads = 0;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const respond = (json, status = 200) => route.fulfill({ json, status });
    if (url.origin === 'https://discord.com') return route.fulfill({ body: 'Fixture journal' });
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/auth/me') return respond({ authenticated: true, member: self });
    if (url.pathname === '/api/members') return failRoster ? route.abort() : respond({ members: emptyRoster ? [] : profiles });
    if (url.pathname === '/api/members/nag-assist') {
      assists.push(route.request().postDataJSON());
      if (failNextAssist) {
        failNextAssist = false;
        return respond({ error: 'Fixture read failure' }, 503);
      }
      return respond({ message: 'Recorded' });
    }
    if (url.pathname === '/api/members/nag-notif') {
      nags.push(route.request().postDataJSON());
      return respond({ success: true, message: 'Fixture sent' });
    }
    if (url.pathname === '/api/members/sleep-history') {
      const target = profiles.find(member => member.id === url.searchParams.get('memberId')) || self;
      return respond({ member: { ...target, name: target.discord_username }, logs: [] });
    }
    if (url.pathname === '/api/members/punishments') {
      punishmentReads++;
      return respond({ current_month: '2026-11', tasks: [] });
    }
    if (url.pathname.startsWith('/api/')) return respond({});
    return route.continue();
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await card(page, overdue).waitFor();
  await page.locator('[aria-label="App Setup Guide"]').waitFor({ state: 'hidden' });
  return { context, page, assists, nags, punishmentReads: () => punishmentReads,
    failNextAssist: () => { failNextAssist = true; }, failRoster: value => { failRoster = value; },
    emptyRoster: () => { emptyRoster = true; } };
}

async function capture(browser, before, after, width) {
  for (const [version, origin] of [['before', before], ['after', after]]) {
    const { page, context } = await fixture(browser, origin, width);
    try {
      const height = (await card(page, overdue).boundingBox()).height;
      console.log(version + ' ' + width + 'px overdue card: ' + height + 'px');
      await page.screenshot({ path: path.join(artifact, version + '-' + width + '.png'), animations: 'disabled', fullPage: true });
      if (version === 'after') {
        await detailsButton(page, overdue).click();
        await page.getByRole('dialog', { name: overdue.discord_username }).waitFor();
        await page.screenshot({ path: path.join(artifact, 'details-' + width + '.png'), animations: 'disabled' });
      }
    } finally { await context.close(); }
  }
}

async function verifyLayout(page, width) {
  const states = [[overdue, 'Nag in Journal'], [grace, 'Nag in Journal'], [winding, 'Say Goodnight'],
    [awake, 'Journal'], [sleeping, 'Quiet Note'], [self, 'Journal']];
  for (const [member, action] of states) {
    const region = card(page, member);
    const link = region.getByRole('link', { name: action, exact: true });
    assert.equal(await link.getAttribute('href'), member.journal_url);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await region.getByRole('button').count(), 3);
    assert.equal(await region.getByText('your time', { exact: true }).count(), 1);
    assert.equal(await region.getByText('Punishments', { exact: false }).count(), 0);
    const measurements = await region.evaluate(element => {
      const cardRect = element.getBoundingClientRect();
      return [...element.querySelectorAll('a,button')].map(control => {
        const rect = control.getBoundingClientRect();
        return { width: rect.width, height: rect.height, fits: rect.left >= cardRect.left && rect.right <= cardRect.right };
      });
    });
    assert(measurements.every(item => item.width >= 44 && item.height >= 44 && item.fits), width + 'px: touch bounds for ' + member.discord_username);
    assert(await link.evaluate(anchor => anchor.scrollWidth <= anchor.clientWidth), width + 'px: journal fits');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await card(page, overdue).getByText('12:00 AM', { exact: true }).count(), 1);
  assert.equal(await card(page, grace).getByText('2m grace', { exact: true }).count(), 1);
  assert.equal(await card(page, self).getByText('You', { exact: true }).count(), 1);
  assert.equal(await card(page, sleeping).getByText('In bed', { exact: true }).count(), 1);
  assert.equal(await card(page, overdue).getByText('Moderator', { exact: true }).count(), 0);
  if (width >= 768) {
    const boxes = await Promise.all([self, overdue, grace].map(member => detailsButton(page, member).boundingBox()));
    assert(boxes.slice(0, width >= 1280 ? 3 : 2).every(box => box.y === boxes[0].y && box.height === boxes[0].height), 'Desktop actions align at ' + width);
  }
}

async function openJournal(page, link) {
  const href = await link.getAttribute('href');
  const popupEvent = page.context().waitForEvent('page');
  await link.click();
  const popup = await popupEvent;
  try {
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(popup.url(), href);
  } finally { await popup.close(); }
}

async function verifyControls(browser, origin) {
  const run = await fixture(browser, origin, 390);
  const { page, context, assists, nags } = run;
  try {
    const target = card(page, overdue);
    const star = target.getByRole('button', { name: 'Star ' + overdue.discord_username });
    await star.tap();
    assert.equal(await star.getAttribute('aria-pressed'), 'true');
    const starred = page.getByRole('button', { name: 'Starred', exact: true });
    await starred.tap();
    await target.waitFor();
    assert.equal(await card(page, grace).count(), 0);
    await page.getByRole('button', { name: 'All', exact: true }).tap();

    const trigger = detailsButton(page, overdue);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const details = page.getByRole('dialog', { name: overdue.discord_username });
    await details.getByText('Local schedule: 3:30 AM', { exact: false }).waitFor();
    await details.getByText('Schedule shifting in', { exact: false }).waitFor();
    await details.getByText('Moderator', { exact: true }).waitFor();
    await details.getByText('Monthly strikes', { exact: false }).waitFor();
    assert.equal(await details.getByRole('button', { name: /Punishments/ }).count(), 0);
    assert.equal(await details.getByRole('button', { name: 'Request Metastrike' }).count(), 0);
    const close = details.getByRole('button', { name: 'Close details' });
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    assert(await details.getByRole('button', { name: 'Nag Notif' }).evaluate(el => document.activeElement === el));
    await page.keyboard.press('Tab');
    assert(await close.evaluate(el => document.activeElement === el));
    await page.keyboard.press('Escape');
    await details.waitFor({ state: 'hidden' });
    assert(await trigger.evaluate(el => document.activeElement === el));
    await trigger.tap();
    await close.tap();
    assert(await trigger.evaluate(el => document.activeElement === el));
    await trigger.tap();
    await page.mouse.click(10, 10);
    await details.waitFor({ state: 'hidden' });
    assert(await trigger.evaluate(el => document.activeElement === el));

    await profileButton(page, overdue).tap();
    await page.locator('dialog[open]').getByRole('heading', { name: overdue.discord_username, exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'hidden' });

    await detailsButton(page, self).tap();
    const ownDetails = page.getByRole('dialog', { name: self.discord_username });
    await ownDetails.getByRole('button', { name: 'Punishments (2 open)' }).tap();
    const sleep = page.getByRole('dialog', { name: 'My Sleep' });
    assert.equal(await sleep.getByRole('button', { name: 'Punishments', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(120);
    assert(run.punishmentReads() > 0);
    await page.keyboard.press('Escape');
    await sleep.waitFor({ state: 'hidden' });

    run.failNextAssist();
    await openJournal(page, target.getByRole('link', { name: 'Nag in Journal' }));
    await target.getByRole('link', { name: 'Nag in Journal' }).waitFor();
    await openJournal(page, target.getByRole('link', { name: 'Nag in Journal' }));
    const reopened = target.getByRole('link', { name: 'Nagged! Reopen Journal' });
    await reopened.waitFor();
    await openJournal(page, reopened);
    const wind = card(page, winding);
    await openJournal(page, wind.getByRole('link', { name: 'Say Goodnight' }));
    await wind.getByRole('link', { name: 'Noted! Reopen Journal' }).waitFor();
    await openJournal(page, card(page, sleeping).getByRole('link', { name: 'Quiet Note' }));
    await openJournal(page, card(page, self).getByRole('link', { name: 'Journal', exact: true }));
    assert.deepEqual(assists, [{ sleeper_id: overdue.id }, { sleeper_id: overdue.id }, { sleeper_id: winding.id }]);
    assert.deepEqual(nags, []);

    await detailsButton(page, sleeping).tap();
    const sleepingDetails = page.getByRole('dialog', { name: sleeping.discord_username });
    await sleepingDetails.getByRole('button', { name: 'Shield On' }).tap();
    await sleepingDetails.getByText('Sleep Shield', { exact: false }).first().waitFor();
    assert.deepEqual(nags, []);
    await page.keyboard.press('Escape');
    await sleepingDetails.waitFor({ state: 'hidden' });

    await trigger.tap();
    await details.getByRole('button', { name: 'Nag Notif' }).tap();
    await details.getByRole('button', { name: /Nag in/ }).waitFor();
    assert.equal(nags.length, 1);
    await page.keyboard.press('Escape');
    await details.waitFor({ state: 'hidden' });

    for (const width of [360, 768, 1024, 1440, 1600]) {
      await page.setViewportSize({ width, height: 844 });
      for (const name of ['Nagged! Reopen Journal', 'Noted! Reopen Journal']) {
        const link = page.getByRole('link', { name, exact: true });
        assert(await link.evaluate(anchor => {
          const text = anchor.querySelector('span');
          return anchor.scrollWidth <= anchor.clientWidth && text.scrollWidth <= text.clientWidth;
        }), width + 'px: full reopen label');
      }
    }
    await page.screenshot({ path: path.join(artifact, 'desktop-reopened-journals.png'), fullPage: true });
    run.failRoster(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await target.waitFor();
    run.failRoster(false);
    run.emptyRoster();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.getByText('Welcome to the Fox Den!').waitFor();
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(artifact, { recursive: true });
  const [before, after] = await Promise.all(folders.map((folder, index) => serve(folder, 3191 + index)));
  const browser = await chromium.launch({ executablePath: process.env.PHASE2_BROWSER || undefined });
  try {
    for (const width of [390, 1440]) await capture(browser, before, after, width);
    for (const width of [360, 390, 430, 768, 1024, 1440, 1600]) {
      const { page, context } = await fixture(browser, after, width);
      try { await verifyLayout(page, width); }
      finally { await context.close(); }
    }
    await verifyControls(browser, after);
    console.log('Responsive roster, journal assist and retries, profile navigation, star toggle, Details focus, Sleep Shield and private punishments passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => servers.forEach(server => server.kill()));

