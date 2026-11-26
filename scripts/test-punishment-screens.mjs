import assert from 'node:assert/strict';
import { createElement } from 'react';
import { DateTime } from 'luxon';
import { renderToStaticMarkup } from 'react-dom/server';
import { BottomNav } from '../src/components/BottomNav.tsx';
import { Header } from '../src/components/Header.tsx';
import { MemberCard } from '../src/components/MemberCard.tsx';
import { EmptyPunishments, PunishmentDetails, PunishmentReadNotice } from '../src/components/PunishmentList.tsx';
import { PUNISHMENT_ROLLOUT_CLOSED, PUNISHMENT_SERVICE_UNAVAILABLE,
  readPunishmentFailure } from '../src/lib/punishmentAvailability.ts';
import { computeMemberState, getPunishmentDeadlineOptions, getPunishmentDeadlineState,
  punishmentDeadlineInputValue } from '../src/lib/sleepEngine.ts';
import { withoutMetastrikeReasons } from '../src/lib/rosterPrivacy.ts';
import { fetchMetastrikes, metastrikeDate, metastrikeQuotaLabel, metastrikeReasonError } from '../src/lib/metastrikeScreens.ts';

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const member = {
  id: 'fox',
  discord_username: 'Fox',
  timezone: 'Asia/Kolkata',
  bedtime_local: '23:00',
  wake_time_local: '07:00',
  journal_url: 'https://discord.com/channels/123/456',
  open_punishment_count: 0,
};
const memberNav = render(BottomNav, { activeTab: 'sleep', isModerator: false });
assert.match(memberNav, /aria-current="page"[^>]*>.*My Sleep/);
assert.doesNotMatch(memberNav, />Mod<|Alerts|My Time/);
assert.match(render(BottomNav, { activeTab: 'roster', isModerator: true }), />Mod<\/button>/);

for (const role of ['member', 'moderator']) {
  const header = render(Header, {
    viewerTimezone: member.timezone,
    currentUser: { ...member, role, is_moderator: true },
    isPushEnabled: true,
    isSleepShieldActive: true,
    onOpenMod: () => {},
  });
  assert.match(header, /Mod Panel/);
  assert.match(header, /aria-label="Notification settings\. Push notifications on for this device"/);
  assert.match(header, /aria-label="Open profile"/);
  assert.match(header, /role="status"[^>]*>.*Sleep Shield active<\/span>/);
}

const state = computeMemberState(member, member.timezone);
const card = (currentMemberId, count) => render(MemberCard, {
  member: { ...member, open_punishment_count: count },
  currentMemberId,
  state,
  onOpenPunishments: () => {},
});
assert.doesNotMatch(card(member.id, 0), /Punishments/);
assert.doesNotMatch(card(member.id, null), /Punishments/);
assert.doesNotMatch(card('other', 2), /Punishments/);

for (const [status, label] of [
  ['pending', 'Pending'], ['awaiting_assignment', 'Awaiting assignment'],
  ['assigned', 'Assigned'], ['completed', 'Completed'],
]) {
  const row = render(PunishmentDetails, { item: {
    status,
    earned_cycle_date: '2026-11-30',
    completed_at: status === 'completed' ? '2026-12-01T10:00:00Z' : null,
    title: status === 'assigned' ? 'Wind down' : null,
    instructions: status === 'assigned' ? '<two lines>' : null,
  } });
  assert.ok(row.includes(label));
  assert.match(row, /dateTime="2026-11-30"/i);
  if (status === 'assigned') assert.match(row, /Wind down.*&lt;two lines&gt;/);
  if (status === 'completed') assert.match(row, /2026-12-01T10:00:00Z/);
}
const optionsAt = (input, zone, now) => getPunishmentDeadlineOptions(input, zone, DateTime.fromISO(now));
for (const zone of ['Asia/Kolkata', 'GMT+05:30']) {
  assert.deepEqual(optionsAt('2026-12-05T23:30', zone, '2026-12-01T00:00Z'), {
    ambiguous: false, future: [{ instant: '2026-12-05T18:00:00.000Z', offset: 'UTC+05:30' }],
  });
  assert.equal(punishmentDeadlineInputValue('2026-12-05T18:00:00Z', zone), '2026-12-05T23:30');
}
assert.equal(optionsAt('2027-03-14T02:30', 'America/Los_Angeles', '2027-03-10T00:00Z'), null);
const repeatedHour = now => optionsAt('2027-11-07T01:30', 'America/Los_Angeles', now);
const first = { instant: '2027-11-07T08:30:00.000Z', offset: 'UTC-07:00' };
const second = { instant: '2027-11-07T09:30:00.000Z', offset: 'UTC-08:00' };
assert.deepEqual(repeatedHour('2027-11-07T08:00Z'), { ambiguous: true, future: [first, second] });
assert.deepEqual(repeatedHour('2027-11-07T09:00Z'), { ambiguous: true, future: [second] });
assert.deepEqual(repeatedHour('2027-11-07T09:30Z'), { ambiguous: true, future: [] });
const dueItem = { status: 'assigned', earned_cycle_date: '2026-11-30', due_at: '2026-12-05T18:00:00Z',
  member_timezone: 'Asia/Kolkata' };
const realNow = Date.now;
const dueMs = DateTime.fromISO(dueItem.due_at).toMillis();
try {
  Date.now = () => dueMs - 1;
  assert.equal(getPunishmentDeadlineState(dueItem.due_at, 'GMT+05:30').remainingMs, 1);
  assert.match(render(PunishmentDetails, { item: dueItem }), /Due .*(?:11|23):30/);
  assert.match(render(PunishmentDetails, { item: { ...dueItem, member_timezone: 'GMT+05:30' } }), /Due .*(?:11|23):30/);
  assert.doesNotMatch(render(PunishmentDetails, { item: dueItem }), /Overdue/);
  Date.now = () => dueMs;
  assert.match(render(PunishmentDetails, { item: dueItem }), /Overdue.*(?:11|23):30/);
  assert.doesNotMatch(render(PunishmentDetails, { item: { ...dueItem, status: 'completed' } }), /Overdue/);
  assert.match(render(PunishmentDetails, { item: { ...dueItem, due_at: null } }), /No deadline set/);
} finally {
  Date.now = realNow;
}

const legacyReasons = {
  metastrike_reason: 'private top-level reason',
  tonight_strike_log: { record_type: 'metastrike', sleep_cycle_date: '2026-11-30', reason: 'private nightly reason' },
  convertible_strike_log: { record_type: 'strike', sleep_cycle_date: '2026-11-29', reason: 'private old reason' },
};
const sanitized = withoutMetastrikeReasons({ ...member, ...legacyReasons });
assert.doesNotMatch(JSON.stringify(sanitized), /reason|private/);
assert.deepEqual(sanitized.tonight_strike_log, { record_type: 'metastrike', sleep_cycle_date: '2026-11-30' });
assert.equal(sanitized.convertible_strike_log.sleep_cycle_date, '2026-11-29');
const sharedCard = render(MemberCard, {
  member: { ...member, ...legacyReasons, is_metastrike_active: true },
  currentMemberId: 'another-profile', state: { ...state, status: 'AWAKE' }, onOpenMetastrike: () => {},
});
assert.doesNotMatch(sharedCard, /private .* reason|Request Metastrike/);

for (const [status, action] of [['pending', 'Assignment'], ['assigned', 'Completion']]) {
  const item = { status, metastrike_hold: true, earned_cycle_date: '2026-11-30', title: 'Saved work', instructions: 'Keep it' };
  assert.ok(render(PunishmentDetails, { item }).includes(action + ' on hold for Metastrike review.'));
  assert.match(render(PunishmentDetails, { item }), /Saved work.*Keep it/);
  assert.doesNotMatch(render(PunishmentDetails, { item: { ...item, metastrike_hold: false } }), /on hold/);
}

assert.ok(metastrikeReasonError('  \t  '));
assert.ok(metastrikeReasonError('🦊'.repeat(501)));
assert.equal(metastrikeReasonError(' 🦊 '), '');
assert.equal(metastrikeReasonError(' ' + '🦊'.repeat(500) + ' '), '');
assert.match(metastrikeDate('2026-11-30'), /\b(?:Nov 30|30 Nov)\b/);
assert.equal(metastrikeQuotaLabel({ month: '2026-12', used: 1, reserved: 2, remaining: 0 }),
  'December 2026 · 1 used · 2 reserved · 0 remaining');

const realFetch = globalThis.fetch;
try {
  for (const [status, error] of [[401, 'Sign in'], [409, 'The nightly strike source changed. Refresh before deciding.']]) {
    globalThis.fetch = async (_path, options) => {
      assert.equal(options.cache, 'no-store');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { action: 'approve', expected_source_id: null });
      return Response.json({ error }, { status });
    };
    await assert.rejects(fetchMetastrikes('/fixture', { body: { action: 'approve', expected_source_id: null } }),
      failure => failure.status === status && (status === 401 ? /expired/.test(failure.message) : failure.message === error));
  }
} finally {
  globalThis.fetch = realFetch;
}

const unavailable = body => new Response(JSON.stringify(body), { status: 503 });
const closed = await readPunishmentFailure(unavailable({ code: PUNISHMENT_ROLLOUT_CLOSED }));
const temporary = await readPunishmentFailure(unavailable({ code: PUNISHMENT_SERVICE_UNAVAILABLE }));
assert.equal(await readPunishmentFailure(new Response('<html>', { status: 503 })), temporary);
assert.equal(await readPunishmentFailure(new Response(null, { status: 401 })), 'sign-in');
assert.equal(await readPunishmentFailure(new Response(null, { status: 403 })), 'forbidden');

const notice = failure => render(PunishmentReadNotice, { failure, onRetry: () => {} });
assert.match(notice(closed), /Punishments are closed for now/);
assert.doesNotMatch(notice(closed), /Retry|No punishments/);
assert.match(notice(temporary), /role="alert".*Could not load punishments.*Retry/);
assert.doesNotMatch(notice(temporary), /No punishments/);
for (const children of ['No punishments in the queue.', 'No open punishments.']) {
  const empty = render(EmptyPunishments, { children });
  assert.ok(empty.includes(children));
  assert.doesNotMatch(empty, /Retry|Could not load|closed for now/);
}
console.log('Punishment screens passed navigation, badge privacy, task rendering, and closed, retry, and empty states.');
