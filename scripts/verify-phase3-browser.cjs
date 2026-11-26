const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const children = [];
const screens = path.resolve('phase3-screenshots');
const photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><circle fill="#ae653c" cx="18" cy="18" r="18"/><path fill="#f5ebe1" d="M6 8l8 5h8l8-5-2 14-10 7L8 22z"/></svg>');
const normal = { bedtime: '23:00', wake_time: '07:00' };
const weekly = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, normal]));
const name = 'An Exceptionally Long Display Name for the Den in Athens';
const profile = (id, username, role = 'member', extra = {}) => ({
  id, discord_username: username, discord_handle: 'den-' + id, role, is_moderator: role !== 'member',
  discord_id: '2000' + id, is_active: true, timezone: 'Asia/Kolkata', bedtime_local: '23:00', wake_time_local: '07:00',
  journal_url: 'https://discord.com/channels/123/45' + id, avatar_url: photo,
  updated_at: '2026-11-26T10:00:00Z', strikes_used: 1, metastrikes_used: 1, can_review_strikes: true, ...extra,
});
async function serve(folder, port) {
  const processHandle = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1',
    '--port', String(port)], { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
  children.push(processHandle);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Next startup timed out for port ' + port)), 60000);
    processHandle.stdout.on('data', data => {
      process.stdout.write(data);
      if (String(data).includes('Ready in')) { clearTimeout(timer); resolve(); }
    });
    processHandle.on('error', reject);
  });
  return 'http://127.0.0.1:' + port;
}
async function fixture(browser, url, width, role = 'owner', previous = false) {
  const actor = profile('1', 'Rowan', role, { can_review_strikes: role === 'owner' });
  const target = profile('2', name, 'member', {
    timezone: 'Europe/Athens', weekly_schedule: weekly, is_in_bed: true, pending_timezone: 'Europe/Athens',
    pending_effective_at: '2026-11-27T20:30:00Z',
    pending_weekly_schedule: { ...weekly, fri: { bedtime: '00:15', wake_time: '08:00' } },
  });
  const people = [actor, target, profile('3', 'Cedar Staff', 'moderator'),
    ...Array.from({ length: 18 }, (_, i) => profile(String(i+4), 'Juniper ' + String(i+1).padStart(2, '0')))];
  const writes = [];
  const flags = { rosterFailure: false, queueFailure: true };
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Kolkata',
    isMobile: width < 768, hasTouch: width < 768, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('zcatchers_unified_onboarding_dismissed_at', String(Date.now()));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(new Date('2026-11-26T18:00:00Z'));
  const review = { month: '2026-11', current_month: '2026-11', latest_cycle_date: '2026-11-26',
    verified_strikes: [], strikes_used: 1, open_count: 0 };
  await context.route('**/*', async route => {
    const request = route.request();
    const endpoint = new URL(request.url());
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (endpoint.origin !== url) return route.abort();
    switch (endpoint.pathname) {
      case '/api/auth/me': return reply({ authenticated: true, member: actor });
      case '/api/members': return reply({ members: people });
      case '/api/mod':
        if (request.method() === 'POST') {
          const data = request.postDataJSON();
          writes.push(data);
          if (data.action === 'add_strike') return reply({ ...review, strikes_used: 2 });
          if (data.action === 'approve_cooldown') {
            target.pending_effective_at = null;
            return reply({ message: 'Fixture schedule approved' });
          }
          return reply({ message: 'Fixture saved' });
        }
        if (endpoint.searchParams.get('view') === 'strike_month') return reply(review);
        if (flags.rosterFailure) return reply({ error: 'Temporary roster error' }, 503);
        if (actor.role === 'member') return reply({ error: 'Forbidden' }, 403);
        return reply({ members: people });
      case '/api/mod/punishments': return flags.queueFailure ? reply({ error: 'Temporary queue error' }, 503) : reply({ items: [], next_offset: null });
      case '/api/mod/metastrikes': return flags.queueFailure ? reply({ error: 'Temporary queue error' }, 503) : reply({ items: [], next_offset: null, pending_count: 0 });
      case '/api/mod/webhook': return reply({ configured: true, maskedUrl: 'https://discord.com/api/webhooks/***' });
      default: return endpoint.pathname.startsWith('/api/') ? reply({}) : route.continue();
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const entry = page.getByRole('button', { name: width < 768 ? 'Mod' : 'Mod Panel', exact: true });
  if (role === 'member') {
    await page.getByRole('button', { name: "View Rowan's profile", exact: true }).waitFor();
    assert.equal(await entry.count(), 0);
    return { context };
  }
  await entry.click();
  const dialog = page.getByRole('dialog', { name: 'Mod Panel' });
  await dialog.waitFor();
  return { context, page, dialog, actor, target, writes, flags };
}
const roster = dialog => dialog.getByRole('button', { name: /^Roster/ }).click();
const shot = (page, name) => page.screenshot({ path: path.join(screens, name + '.png'), animations: 'disabled' });
const waitForFocus = (page, id) => page.waitForFunction(id => document.activeElement?.id === id, id);
async function check(browser, url, width) {
  const { context, page, dialog, target, writes, flags } = await fixture(browser, url, width);
  try {
    await dialog.getByText('Fri', { exact: true }).waitFor();
    await dialog.getByText('08:00', { exact: true }).waitFor();
    assert.equal(await dialog.getByText('Sat', { exact: true }).count(), 0);
    const capture = width === 390 || width === 1440;
    if (capture) await shot(page, 'after-approvals-' + width);
    await roster(dialog);
    const row = dialog.getByRole('button', { name: new RegExp(name) });
    const search = dialog.getByRole('searchbox');
    const header = dialog.getByRole('navigation', { name: 'Moderation views' });
    await row.waitFor();
    const headerTop = (await header.boundingBox()).y;
    assert((await header.getByRole('button', { name: 'Metastrikes' }).boundingBox()).height >= 44);
    assert(await dialog.evaluate(el => el.clientWidth === el.scrollWidth));
    if (capture) await shot(page, 'after-roster-' + width);
    if (width === 390) {
      const visible = await dialog.locator('button[id^="mod-roster-member-"]').evaluateAll(rows =>
        rows.filter(row => row.getBoundingClientRect().bottom <= row.closest('dialog').getBoundingClientRect().bottom).length);
      assert(visible >= 3);
      await search.fill('juniper');
      const last = dialog.getByRole('button', { name: /^Juniper 18/ });
      await last.scrollIntoViewIfNeeded();
      const saved = await last.evaluate(row => row.closest('section').parentElement.parentElement.scrollTop);
      assert(saved > 0);
      await last.click();
      await dialog.getByRole('button', { name: 'Back to roster' }).click();
      await waitForFocus(page, 'mod-roster-member-21');
      assert.equal(await search.inputValue(), 'juniper');
      assert.equal(await last.evaluate(row => row.closest('section').parentElement.parentElement.scrollTop), saved);
      assert.equal((await header.boundingBox()).y, headerTop);
      await search.fill('');
    }
    await row.click();
    await dialog.getByRole('heading', { name }).waitFor();
    assert.equal(await search.isVisible(), width >= 1280);
    assert(await dialog.evaluate(el => el.clientWidth === el.scrollWidth));
    if (capture) await shot(page, 'after-detail-' + width);
    if (width === 390) {
      await dialog.getByRole('button', { name: 'Deactivate member', exact: true }).click();
      await dialog.locator('#mod-member-confirm-active').getByText(name, { exact: true }).waitFor();
      await dialog.locator('#mod-member-confirm-active').getByRole('button', { name: 'Cancel' }).click();
      assert.equal(writes.length, 0);
      await dialog.getByRole('button', { name: /^Edit strikes/ }).click();
      await dialog.getByLabel('Sleep-cycle date').fill('2026-11-25');
      await dialog.getByLabel('Correction reason').fill('Fixture dated strike');
      await dialog.getByRole('button', { name: 'Add strike', exact: true }).click();
      await dialog.getByText('Strike added.', { exact: true }).waitFor();
      assert.equal(writes[0].cycle_date, '2026-11-25');
      await dialog.getByRole('button', { name: 'Back to member' }).click();
      await dialog.getByRole('button', { name: /^Edit schedule/ }).click();
      await page.setViewportSize({ width: 390, height: 470 });
      await dialog.getByRole('button', { name: 'Save & Apply Immediately' }).scrollIntoViewIfNeeded();
      assert(await header.isVisible());
      target.role = 'owner';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await dialog.getByRole('button', { name: 'Close edit form' }).waitFor({ state: 'hidden' });
      assert.equal(await dialog.getByRole('button', { name: /^Edit schedule/ }).count(), 0);
      target.role = 'member';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await dialog.getByRole('button', { name: /^Edit schedule/ }).waitFor();
      await header.getByRole('button', { name: /^Approvals/ }).click();
      flags.rosterFailure = true;
      await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
      await dialog.getByRole('button', { name: 'Retry roster refresh' }).waitFor();
      flags.rosterFailure = false;
      await dialog.getByRole('button', { name: 'Retry roster refresh' }).click();
      await dialog.getByRole('button', { name: 'Approve Now' }).click();
      await dialog.getByText('Fixture schedule approved', { exact: true }).waitFor();
      assert.equal(writes[1].expected_pending.pending_weekly_schedule.fri.wake_time, '08:00');
      for (const [tab, empty] of [['Punishments', 'No punishments in the queue.'], ['Metastrikes', 'No pending requests.']]) {
        flags.queueFailure = true;
        await header.getByRole('button', { name: tab }).click();
        const retry = dialog.getByRole('button', { name: 'Retry', exact: true });
        await retry.waitFor();
        flags.queueFailure = false;
        await retry.click();
        await dialog.getByText(empty, { exact: true }).waitFor();
      }
      await dialog.getByRole('button', { name: 'Advanced', exact: true }).click();
      await dialog.getByRole('button', { name: 'Send Test Bedtime Embed' }).waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
    console.log('Responsive drawer passed at ' + width + 'px.');
  } finally { await context.close(); }
}
async function main() {
  fs.mkdirSync(screens, { recursive: true });
  const [before, after] = await Promise.all([serve(process.env.PHASE3_BASELINE, 3191), serve(process.cwd(), 3192)]);
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) {
      const { context, page, dialog } = await fixture(browser, before, width, 'owner', true);
      try {
        await roster(dialog);
        await dialog.getByText(name, { exact: true }).waitFor();
        await shot(page, 'before-roster-' + width);
      } finally { await context.close(); }
    }
    for (const width of [360, 390, 430, 768, 1024, 1440]) await check(browser, after, width);
    const member = await fixture(browser, after, 390, 'member');
    await member.context.close();
    const mod = await fixture(browser, after, 1440, 'moderator');
    try {
      assert.equal(await mod.dialog.getByRole('button', { name: 'Advanced' }).count(), 0);
      await roster(mod.dialog);
      await mod.dialog.getByRole('button', { name: /^Rowan/ }).click();
      await mod.dialog.getByRole('heading', { name: 'Rowan' }).waitFor();
      assert.equal(await mod.dialog.getByRole('button', { name: /^Edit strikes|^Edit schedule|^Deactivate member/ }).count(), 0);
      await mod.dialog.getByRole('button', { name: /^Cedar Staff/ }).click();
      await mod.dialog.getByRole('button', { name: /^Edit strikes/ }).waitFor();
      assert.equal(await mod.dialog.getByRole('button', { name: /^Edit schedule|^Deactivate member/ }).count(), 0);
      mod.actor.role = 'member';
      mod.actor.is_moderator = false;
      await mod.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await mod.dialog.waitFor({ state: 'hidden' });
    } finally { await mod.context.close(); }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const child of children) child.kill();
});
