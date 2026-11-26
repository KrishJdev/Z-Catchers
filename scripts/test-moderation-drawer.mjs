import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModDrawer } from '../src/components/ModDrawer.tsx';
import { RosterRoleAction } from '../src/components/RosterRoleAction.tsx';
import { ModeratorScheduleComparison } from '../src/components/ModeratorScheduleComparison.tsx';

const member = {
  id: 'candidate',
  role: 'member',
  is_active: true,
  discord_id: '1005',
  discord_username: 'Night Fox',
  discord_handle: 'nightfox',
};
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const roleAction = (overrides = {}, props = {}) => render(RosterRoleAction, {
  member: { ...member, ...overrides },
  isOwner: true,
  ...props,
});

assert.match(roleAction(), /Make moderator for Night Fox/);
assert.doesNotMatch(roleAction(), />Confirm<|>Cancel</);
const confirmation = roleAction({}, { confirming: true });
assert.match(confirmation, /Make <strong>Night Fox<\/strong>.*@nightfox.* a moderator\?/);
assert.match(confirmation, /aria-expanded="true"/);
assert.match(confirmation, />Confirm<\/button>.*>Cancel<\/button>/);
assert.equal((confirmation.match(/min-h-\[44px\]/g) || []).length, 3);
assert.match(roleAction({}, { confirming: true, busy: true }), /disabled=""[^>]*>Saving…/);

assert.equal(roleAction({}, { isOwner: false }), '');
assert.equal(roleAction({ role: 'owner' }), '');
assert.equal(roleAction({ is_active: false }), '');
assert.equal(roleAction({ discord_id: null }), '');
assert.equal(roleAction({ discord_id: 'invalid' }), '');
assert.match(roleAction({ role: 'moderator', is_active: false, discord_id: null }, { confirming: true }),
  /Remove moderator access for <strong>Night Fox<\/strong>/);

const drawer = (role, isOpen = true) => render(ModDrawer, {
  isOpen,
  viewerTimezone: 'Asia/Kolkata',
  currentUser: { ...member, role, is_moderator: role !== 'member' },
});
assert.equal(drawer('member'), '');
assert.equal(drawer('owner', false), '');
for (const role of ['owner', 'moderator']) {
  const markup = drawer(role);
  assert.match(markup, /<dialog[^>]*aria-labelledby="mod-panel-title"/);
  assert.match(markup, /Close moderator panel/);
  assert.match(markup, new RegExp(role === 'owner' ? '>Owner</span>' : '>Moderator</span>'));
  assert.doesNotMatch(markup, /type="password"|>Unlock<|>Lock</);
}
assert.match(drawer('owner'), /Advanced<\/button>/);
assert.doesNotMatch(drawer('moderator'), /Advanced<\/button>/);
assert.match(drawer('owner'), /<header[^>]*shrink-0[\s\S]*?<nav aria-label="Moderation views"/);
assert.match(drawer('owner'), /aria-pressed="true"[^>]*>Approvals/);
for (const name of ['Roster', 'Punishments', 'Metastrikes']) {
  assert.match(drawer('owner'), new RegExp('aria-pressed="false"[^>]*min-h-\\[44px\\][^>]*>' + name));
}

const compare = overrides => render(ModeratorScheduleComparison, {
  member: {
    ...member,
    timezone: 'Asia/Kolkata',
    bedtime_local: '23:00',
    wake_time_local: '07:00',
    ...overrides,
  },
});
const daily = compare({ pending_bedtime_local: '23:30', pending_wake_time_local: '07:30' });
assert.match(daily, />Every night</);
assert.match(daily, /Current .*Asia\/Kolkata.*Bedtime<\/dt><dd>23:00.*Wake<\/dt><dd>07:00/);
assert.match(daily, /Requested .*Asia\/Kolkata.*Bedtime<\/dt><dd>23:30.*Wake<\/dt><dd>07:30/);

const standard = { bedtime: '23:00', wake_time: '07:00' };
const weekly = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, standard]));
const custom = compare({
  weekly_schedule: { ...weekly, fri: { bedtime: '00:15', wake_time: '08:00' } },
  pending_weekly_schedule: { ...weekly, fri: { bedtime: '00:15', wake_time: '09:00' } },
});
assert.match(custom, />Fri<.*Bedtime<\/dt><dd>00:15.*Wake<\/dt><dd>08:00.*Requested .*Wake<\/dt><dd>09:00/);
assert.doesNotMatch(custom, />Mon<|>Sat<|>Every night</);

const legacy = compare({
  weekly_schedule: { ...weekly, fri: { bedtime: '00:15', wake_time: '08:00' } },
  pending_wake_time_local: '06:30',
});
assert.match(legacy, />Mon, Tue, Wed, Thu, Sun<.*Wake<\/dt><dd>06:30/);
assert.doesNotMatch(legacy, />Fri<|>Sat<|00:15/);
const weekend = compare({
  weekend_bedtime_local: '00:30', weekend_wake_time_local: '08:30',
  pending_weekend_bedtime_local: '00:30', pending_weekend_wake_time_local: '09:00',
});
assert.match(weekend, />Fri, Sat<.*Wake<\/dt><dd>08:30.*Wake<\/dt><dd>09:00/);
const timezone = compare({ pending_timezone: 'Europe/Athens' });
assert.match(timezone, />Every night<.*Current .*Asia\/Kolkata.*Requested .*Europe\/Athens/);
console.log('Moderation drawer passed role visibility, account confirmation, touch targets, and approval schedule comparisons.');
