import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModDrawer } from '../src/components/ModDrawer.tsx';
import { RosterRoleAction } from '../src/components/RosterRoleAction.tsx';

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
assert.match(drawer('owner'), /> Advanced<\/button>/);
assert.doesNotMatch(drawer('moderator'), /> Advanced<\/button>/);
console.log('Moderation drawer passed role visibility, account confirmation, and mobile target coverage.');
