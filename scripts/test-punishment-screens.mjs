import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BottomNav } from '../src/components/BottomNav.tsx';
import { Header } from '../src/components/Header.tsx';
import { MemberCard } from '../src/components/MemberCard.tsx';
import { PunishmentDetails } from '../src/components/PunishmentList.tsx';
import { computeMemberState } from '../src/lib/sleepEngine.ts';

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
assert.match(card(member.id, 0), /View punishments, 0 open/);
assert.doesNotMatch(card(member.id, null), /View punishments/);
assert.doesNotMatch(card('other', 2), /View punishments/);

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
console.log('Punishment screens passed navigation, badge ownership, lifecycle labels, and task text rendering coverage.');
