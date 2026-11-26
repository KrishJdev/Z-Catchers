import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DateTime, Settings } from 'luxon';
import { PinnedSelfActionBar } from '../src/components/PinnedSelfActionBar.tsx';

const require = createRequire(import.meta.url);
const cjsSettings = require('luxon').Settings;
const originalClock = Settings.now;
const originalCjsClock = cjsSettings.now;

const member = {
  id: 'member',
  discord_username: 'Fox',
  timezone: 'Asia/Kolkata',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
};
const action = async () => true;

function render(at, updates = {}, isCheckingIn = false) {
  const now = DateTime.fromISO(at, { setZone: true }).toMillis();
  Settings.now = cjsSettings.now = () => now;
  return renderToStaticMarkup(createElement(PinnedSelfActionBar, {
    currentUser: { ...member, ...updates },
    onCheckIn: action,
    onWakeUp: action,
    onCancelInBed: action,
    isCheckingIn,
  }));
}

try {
  for (const time of ['20:30', '22:30', '23:20']) {
    const html = render(`2026-11-21T${time}:00+05:30`);
    assert.match(html, /I’m in bed/);
    assert.doesNotMatch(html, /Enter wake time|Undo check-in/);
    assert.match(html, /11:00 PM/);
    assert.doesNotMatch(html, /\bfixed\b|Nag them!/);
    assert.equal((html.match(/<button[^>]*>/g) ?? []).length, 1);
  }

  const windDown = render('2026-11-21T22:30:00+05:30');
  assert.match(windDown, /Bedtime in 30m/);
  const overdue = render('2026-11-21T23:20:00+05:30');
  assert.match(overdue, /Past bedtime/);

  const sleeping = render('2026-11-22T06:30:00+05:30', {
    is_in_bed: true,
    in_bed_at: '2026-11-21T23:00:00+05:30',
  }, true);
  assert.match(sleeping, /I woke up/);
  assert.match(sleeping, /Enter wake time/);
  assert.match(sleeping, /Undo check-in/);
  assert.match(sleeping, /Checked in for the night/);
  assert.equal((sleeping.match(/bg-status-amber\s/g) ?? []).length, 1);
  assert.match(sleeping, /col-span-2 flex flex-wrap/);
  assert.equal((sleeping.match(/min-h-\[44px\] min-w-\[44px\]/g) ?? []).length, 3);
  assert.equal((sleeping.match(/ disabled=""/g) ?? []).length, 3);
  const pastWake = render('2026-11-22T07:30:00+05:30', {
    is_in_bed: true,
    in_bed_at: '2026-11-21T23:00:00+05:30',
  });
  assert.match(pastWake, /Past wake time \(7:00 AM\)/);
  const woke = render('2026-11-22T06:30:00+05:30', {
    is_woke_up: true,
    last_wake_cycle_date: '2026-11-21',
    last_woke_up_at: '2026-11-22T06:25:00+05:30',
  });
  assert.match(woke, /Back to bed/);
  const awake = render('2026-11-21T13:00:00+05:30');
  assert.doesNotMatch(awake, /I’m in bed|Undo check-in/);
  assert.doesNotMatch(awake, /<button/);
} finally {
  Settings.now = originalClock;
  cjsSettings.now = originalCjsClock;
}
console.log('Pinned nightly actions passed for awake, early, winding-down, overdue, and sleeping states.');
