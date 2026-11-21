import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

let device;
let dbCreated = false;
const store = {
  get() { return { result: structuredClone(device) }; },
  put(value) { device = structuredClone(value); return {}; },
};
const db = {
  createObjectStore() {},
  close() {},
  transaction() {
    const transaction = { objectStore: () => store };
    queueMicrotask(() => transaction.oncomplete());
    return transaction;
  },
};
const indexedDB = {
  open() {
    const request = { result: db };
    queueMicrotask(() => {
      if (!dbCreated) request.onupgradeneeded();
      dbCreated = true;
      request.onsuccess();
    });
    return request;
  },
};

const sub = suffix => ({
  endpoint: 'https://push.example.test/' + suffix,
  toJSON() { return { endpoint: this.endpoint, keys: { p256dh: suffix, auth: suffix } }; },
});
const initial = sub('initial');
const replacement = sub('replacement');
const later = sub('later');
let browserSubscription = initial;
let nextResponse = 'ok';
const listeners = new Map();
const requests = [];
const broadcasts = [];
runInNewContext(readFileSync('public/sw.js', 'utf8'), {
  indexedDB,
  crypto: webcrypto,
  fetch: async (path, init) => {
    const body = JSON.parse(init.body);
    requests.push({ path, body, credentials: init.credentials });
    if (body.rotation_credential) assert.equal(device.credential, body.rotation_credential, 'Credential is durable before sending');
    if (nextResponse === 'offline') throw new TypeError('Network unavailable');
    if (nextResponse === 'unauthorized') return Response.json({}, { status: 401 });
    if (nextResponse === 'server_error') return Response.json({}, { status: 503 });
    return Response.json({ success: true, notifyPersonal: false, notifyCommunity: true });
  },
  self: {
    addEventListener: (name, listener) => listeners.set(name, listener),
    navigator: { userAgent: 'worker fixture' },
    registration: { pushManager: { getSubscription: async () => browserSubscription } },
    clients: { matchAll: async () => [{ postMessage: message => broadcasts.push(structuredClone(message)) }] },
  },
});

async function dispatch(name, event) {
  let finished;
  listeners.get(name)({ ...event, waitUntil: promise => { finished = promise; } });
  assert.ok(finished);
  await finished;
}
const action = async (action, memberId = 'signed-in') => {
  let reply;
  await dispatch('message', {
    data: { type: 'PUSH_DEVICE', action, memberId },
    ports: [{ postMessage: result => { reply = structuredClone(result); } }],
  });
  return reply;
};
const change = async (oldSubscription, newSubscription) => {
  browserSubscription = newSubscription;
  await dispatch('pushsubscriptionchange', { oldSubscription, newSubscription });
};

assert.equal((await action('sync')).success, true);
assert.match(device.credential, /^[a-f0-9]{64}$/);
assert.equal(device.endpoint, initial.endpoint);
const credential = device.credential;
nextResponse = 'unauthorized';
await change(initial, replacement);
assert.equal((await action('status')).repair, 'sign_in');
assert.equal(device.endpoint, initial.endpoint);
assert.deepEqual(broadcasts.at(-1), { type: 'PUSH_DEVICE_CHANGED', active: false });
assert.equal(requests.at(-1).credentials, 'omit');
assert.equal(requests.at(-1).body.rotation_credential, credential);
assert.equal(requests.at(-1).body.old_endpoint, initial.endpoint);
assert.equal((await action('sync', 'different-member')).repair, 'sign_in');

nextResponse = 'server_error';
await action('sync');
assert.equal(device.repair, 'retry');
assert.equal(device.endpoint, initial.endpoint);
nextResponse = 'offline';
await change(replacement, later);
assert.equal(device.repair, 'retry');
assert.equal(device.endpoint, initial.endpoint);
nextResponse = 'ok';
assert.equal((await action('sync')).success, true);
assert.equal(requests.at(-1).credentials, 'same-origin');
assert.equal(requests.at(-1).body.old_endpoint, initial.endpoint);
assert.equal(requests.at(-1).body.notify_personal, undefined);
assert.equal(device.endpoint, later.endpoint);
assert.equal(device.repair, undefined);
assert.equal(device.notifyPersonal, false);

nextResponse = 'server_error';
assert.equal((await action('unlink')).success, false);
assert.equal(device.credential, credential);
nextResponse = 'ok';
browserSubscription.unsubscribe = async () => { browserSubscription = undefined; };
assert.equal((await action('unlink')).success, true);
assert.deepEqual(device, { disabled: true });
const count = requests.length;
await change(later, replacement);
assert.equal(requests.length, count);
