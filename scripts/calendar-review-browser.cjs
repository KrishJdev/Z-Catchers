const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const origin = 'http://127.0.0.1:3196';
const testTime = new Date('2026-12-01T03:00:00Z');
const summary = { totalLoggedNights: 1, avgDurationMinutes: 475, avgBedtime: '23:05', avgWakeTime: '07:00', onTimePercentage: 100 };

function deferred() {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  return { pending, release };
}

function snapshot(id, requestedMonth, wake) {
  const peer = id === 'peer';
  const month = requestedMonth ?? (peer ? '2026-11' : '2026-12');
  const date = month === '2026-11' ? '2026-11-30' : month + '-01';
  return {
    member: { id, name: peer ? 'Night Fox' : 'Calendar tester', timezone: peer ? 'America/New_York' : 'Asia/Kolkata',
      bedtime: peer ? '21:30' : '23:00', wake_time: '07:00', sleep_bucket: peer ? 'BEDTIME_NOW' : 'AWAKE' },
    month, summary,
    logs: [{ cycle_date: date, status: 'on_time', in_bed_local_time: '23:05', woke_up_local_time: month === '2026-11' ? wake : '07:09',
      duration_minutes: 475, wake_source: 'manual', target_bedtime: '23:00', target_wake_time: '07:00' }],
  };
}

async function setup(browser, width = 390, isMobile = true) {
  const context = await browser.newContext({
    viewport: { width, height: 844 }, isMobile, hasTouch: isMobile, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => console.error('Calendar fixture page error:', error.message));
  await page.clock.setFixedTime(testTime);
  const state = { reads: [], writes: [], wake: '07:00', failHistory: false };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const response = (json, status = 200) => route.fulfill({ json, status });
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/members/sleep-history') {
      const month = url.searchParams.get('month');
      const id = url.searchParams.get('memberId');
      state.reads.push({ id, month });
      if (state.historyGate && state.historyGate.month === month) await state.historyGate.pending;
      if (state.failHistory) return response({ error: 'Fixture history unavailable' }, 503);
      return response(snapshot(id, month, state.wake));
    }
    if (url.pathname === '/api/members/strikes') {
      const month = url.searchParams.get('month');
      return response({ month, timezone: 'Asia/Kolkata', entries: [{
        cycle_date: month + '-01', record_type: 'strike', source_type: 'moderator',
        status: 'counted', counts: true, issued_at: month + '-02T00:00:00Z',
      }] });
    }
    if (url.pathname === '/api/members/strikes/metastrike/requests') {
      return response({ items: [], quota: { month: url.searchParams.get('month'), used: 0, reserved: 0, remaining: 3 } });
    }
    if (url.pathname === '/api/members/wake-up') {
      const payload = route.request().postDataJSON();
      state.writes.push(payload);
      if (state.saveGate) await state.saveGate.pending;
      state.wake = payload.wokeUpTime;
      return response({ formatted_duration: '8h 10m' });
    }
    if (url.pathname.startsWith('/api/')) return response({});
    return route.continue();
  });
  await page.goto(origin + '/calendar-review-fixture', { waitUntil: 'networkidle' });
  return { context, page, state };
}

const inspector = dialog => dialog.locator('#selected-sleep-night');

async function timezoneAndTargets(browser, isMobile) {
  const { context, page, state } = await setup(browser, 320, isMobile);
  try {
    state.historyGate = { ...deferred(), month: null };
    await page.getByRole('button', { name: 'Open by ID' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Status unavailable', { exact: true }).waitFor();
    const defaultRead = state.historyGate;
    defaultRead.release();
    await dialog.getByRole('heading', { name: 'November 2026', exact: true }).waitFor();
    await dialog.getByText('Overdue', { exact: true }).waitFor();
    await dialog.getByText('10:00 PM local', { exact: false }).waitFor();
    assert.equal(state.reads.length, 1);
    assert.equal(state.reads[0].month, null);
    const today = dialog.getByRole('button', { name: /^November 30,/ });
    assert.equal(await today.getAttribute('aria-current'), 'date');
    const targets = await dialog.getByRole('region', { name: 'Sleep calendar' }).locator('button[aria-controls="selected-sleep-night"]').evaluateAll(
      buttons => buttons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }))
    );
    assert.equal(targets.length, 30);
    assert(targets.every(({ width, height }) => width >= 44 && height >= 44), JSON.stringify(targets[0]));
    assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
    console.log('320 px (' + (isMobile ? 'touch viewport' : 'desktop viewport') + ') and ID-only local status passed');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });

    state.historyGate = { ...deferred(), month: null };
    const pendingDefault = page.waitForResponse(res => res.url().includes('/api/members/sleep-history?memberId=peer') && !res.url().includes('&month='));
    await page.getByRole('button', { name: 'Open by ID' }).click();
    await dialog.getByRole('heading', { name: 'December 2026', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Next month' }).click();
    await dialog.getByRole('button', { name: /^January 1,/ }).waitFor();
    state.historyGate.release();
    await pendingDefault;
    await dialog.getByRole('heading', { name: 'January 2027', exact: true }).waitFor();
    await inspector(dialog).getByText('07:09', { exact: true }).waitFor();
    console.log('Explicit month survived the late default response');
  } finally { await context.close(); }
}

async function focusAndWake(browser) {
  const { context, page, state } = await setup(browser);
  try {
    state.historyGate = { ...deferred(), month: '2026-12' };
    await page.getByRole('button', { name: 'Open My Sleep', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'My Sleep', exact: true });
    const earlyStrike = dialog.getByRole('button', { name: /Dec 1.*Strike counts/ });
    await earlyStrike.click();
    assert.equal(await inspector(dialog).count(), 0);
    state.historyGate.release();
    await page.waitForFunction(() => document.activeElement?.id === 'selected-sleep-night');
    await inspector(dialog).getByRole('heading', { name: /December 1, 2026/ }).waitFor();

    await dialog.getByRole('button', { name: 'Previous month' }).click();
    await dialog.getByRole('button', { name: /^November 30,/ }).click();
    await inspector(dialog).getByRole('button', { name: 'Edit Wake-Up Time' }).click();
    await inspector(dialog).getByLabel('Enter wake time:').fill('07:15');
    state.failHistory = true;
    await inspector(dialog).getByRole('button', { name: 'Save Wake Time' }).click();
    await dialog.getByText('Fixture history unavailable', { exact: true }).waitFor();
    await inspector(dialog).getByRole('status').getByText(/Logged!/).waitFor();
    assert.equal(await inspector(dialog).getByText('07:00', { exact: true }).count(), 0);
    state.failHistory = false;
    await dialog.getByRole('button', { name: 'Retry sleep logs' }).click();
    await inspector(dialog).getByText('07:15', { exact: true }).waitFor();
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].cycleDate, '2026-11-30');

    await inspector(dialog).getByRole('button', { name: 'Edit Wake-Up Time' }).click();
    await inspector(dialog).getByLabel('Enter wake time:').fill('07:20');
    state.saveGate = deferred();
    await inspector(dialog).getByRole('button', { name: 'Save Wake Time' }).click();
    await dialog.getByRole('button', { name: 'Saving...' }).waitFor();
    await dialog.getByRole('button', { name: 'Next month' }).click();
    await dialog.getByRole('button', { name: /^December 1,/ }).waitFor();
    const refresh = page.waitForResponse(res => res.url().includes('/api/members/sleep-history?') && res.url().includes('month=2026-12'));
    state.saveGate.release();
    await refresh;
    await inspector(dialog).getByText('07:09', { exact: true }).waitFor();
    assert.equal(state.writes.length, 2);
    assert.equal(state.writes[1].cycleDate, '2026-11-30');
    assert.equal(state.reads.at(-1).month, '2026-12');
    assert.equal(await inspector(dialog).getByRole('status').count(), 0);
    state.historyGate = { ...deferred(), month: '2026-11' };
    const november = page.waitForResponse(res => res.url().includes('/api/members/sleep-history?') && res.url().includes('month=2026-11'));
    await dialog.getByRole('button', { name: 'Previous month' }).click();
    await dialog.getByRole('region', { name: 'Strike history' }).getByRole('button', { name: /Nov 1.*Strike counts/ }).click();
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
    state.historyGate.release();
    await november;
    await dialog.getByRole('button', { name: 'Calendar', exact: true }).click();
    await inspector(dialog).waitFor();
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'selected-sleep-night');
    console.log('Delayed inspector focus, cancellation on tab switch, refresh-only retry, and navigation during a save passed');
  } finally { await context.close(); }
}

async function main() {
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3196'],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Next did not start')), 45000);
      server.stdout.on('data', output => {
        process.stdout.write(output);
        if (String(output).includes('Ready in')) { clearTimeout(timer); resolve(); }
      });
      server.on('error', reject);
      server.on('exit', code => { clearTimeout(timer); reject(Error('Next exited ' + code)); });
    });
    const browser = await chromium.launch({ executablePath: process.env.CALENDAR_BROWSER || undefined });
    try {
      const cases = [timezoneAndTargets(browser, true), timezoneAndTargets(browser, false), focusAndWake(browser)];
      const results = await Promise.allSettled(cases);
      for (const result of results) if (result.status === 'rejected') console.error(result.reason);
      assert(results.every(result => result.status === 'fulfilled'));
    } finally { await browser.close(); }
  } finally { server.kill(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
