#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DateTime } from 'luxon';
import { MemberCard } from '../src/components/MemberCard.tsx';
import { computeMemberState } from '../src/lib/sleepEngine.ts';

const viewerTimezone = 'Asia/Kolkata';
const member = {
  id: 'tokyo-fox',
  discord_username: 'A Very Long Roster Display Name for a Tokyo Fox',
  timezone: 'Asia/Tokyo',
  bedtime_local: '03:30',
  wake_time_local: '11:00',
  journal_url: 'https://canary.discord.com/channels/123/456/789',
  role: 'moderator',
  streak_days: 10,
  open_punishment_count: 2,
  pending_bedtime_local: '04:00',
  pending_timezone: 'Asia/Tokyo',
  pending_effective_at: '2026-11-28T18:30:00Z',
};

function renderCard(instant, overrides = {}, props = {}) {
  const target = { ...member, ...overrides };
  const state = computeMemberState(target, viewerTimezone, DateTime.fromISO(instant));
  return renderToStaticMarkup(createElement(MemberCard, {
    member: target,
    currentMemberId: 'viewer',
    state,
    onToggleStar() {},
    onOpenProfile() {},
    onOpenPunishments() {},
    ...props,
  }));
}

const distinctStates = [
  ['2026-11-26T18:45:00Z', {}, '15m overdue', 'Nag in Journal', /\bbg-status-coral\b/],
  ['2026-11-26T18:32:00Z', {}, '3m grace', 'Nag in Journal', /\bbg-status-coral\b/],
  ['2026-11-26T18:15:00Z', { is_woke_up: true }, 'In 15m', 'Say Goodnight', /\bborder-status-amber\/50\b/],
  ['2026-11-26T17:00:00Z', {}, 'Awake', 'Journal', /\bbg-night-elevated\b/],
  ['2026-11-26T19:30:00Z', { is_in_bed: true, in_bed_at: '2026-11-26T18:20:00Z' }, 'In bed', 'Quiet Note', /\bbg-night-elevated\b/],
];

for (const [instant, overrides, status, action, style] of distinctStates) {
  const markup = renderCard(instant, overrides);
  assert.ok(markup.includes('>' + status + '<'), status);
  const links = [...markup.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.equal(links.length, 1);
  assert.ok(links[0].includes('>' + action + '<'), action);
  assert.match(links[0], style);
  assert.ok(links[0].includes('href="' + member.journal_url + '"'));
  assert.match(links[0], /target="_blank" rel="noopener noreferrer"/);
  const profileButtons = [...markup.matchAll(/<button\b[^>]*aria-label="View [^"]*profile[^"]*"[^>]*>[\s\S]*?<\/button>/g)];
  assert.equal(profileButtons.length, 1);
  assert.match(profileButtons[0][0], /<img\b[^>]*alt=""/);
  assert.ok(profileButtons[0][0].includes(member.discord_username));
  assert.match(markup, />12:00 AM<\/span><span[^>]*>your time<\/span>/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /aria-expanded="false" aria-haspopup="dialog" aria-label="Details for [^"]+"[^>]*>Details<\/button>/);
  assert.doesNotMatch(markup, /Monthly strikes|Moderator<|days on track|Schedule shifting|Local schedule|Punishments|03:30|3:30 AM/);
}

const self = renderCard('2026-11-26T18:45:00Z', {}, { currentMemberId: member.id, isStarred: true });
assert.match(self, />You<\/span>/);
assert.match(self, />Journal<\/span>/);
assert.match(self, /aria-pressed="true"/);
assert.doesNotMatch(self, /Punishments|Nag in Journal|I.m in Bed|I Woke Up|Early Check-In/);

const selfSleeping = renderCard('2026-11-26T19:30:00Z', { is_in_bed: true, in_bed_at: '2026-11-26T18:20:00Z' }, {
  currentMemberId: member.id,
});
assert.match(selfSleeping, />Quiet Note<\/span>/);

const source = readFileSync(new URL('../src/components/MemberCard.tsx', import.meta.url), 'utf8');
const details = source.slice(source.indexOf('{isDetailsOpen && ('));
assert.match(details, /role="dialog"[\s\S]*aria-modal="true"/);
assert.match(details, /Local schedule: \{formattedSleeperTime\}[\s\S]*state\.formattedWakeTime[\s\S]*formatGmtOffset\(member\.timezone\)/);
assert.match(details, /\{roleLabel[\s\S]*streakMilestone\?\.badgeLabel[\s\S]*pendingNotice/);
assert.match(details, /Monthly strikes \{strikesUsed\}[\s\S]*sheet-meta-/);
assert.match(details, /isViewer && typeof member\.open_punishment_count === 'number' && onOpenPunishments[\s\S]*Punishments <span/);
assert.match(details, /Sleep Calendar[\s\S]*onOpenMetastrike && isViewer[\s\S]*Request Metastrike/);
assert.match(details, /localNagCount[\s\S]*nagged tonight/);
assert.match(details, /handleSendNagNotif[\s\S]*formatNagCooldown/);
assert.match(source, /onClick=\{recordsJournalAssist \? handleNagJournalClick : undefined\}/);
assert.match(source, /recordsJournalAssist = !isViewer && !isSleeping && \(isNagNow \|\| isWindingDown\)/);
assert.match(source, /Nagged! Reopen Journal[\s\S]*Noted! Reopen Journal/);
assert.match(source, /const detailsTrigger = detailsTriggerRef.current;[\s\S]*e.key === 'Escape'[\s\S]*last.focus\(\)[\s\S]*first.focus\(\)[\s\S]*detailsTrigger\?\.focus\(\{ preventScroll: true \}\)/);
console.log('Passed member card states, converted bedtime and Details regression checks.');

