// Z Catchers Service Worker
// Versioned Shell, Offline Fallback, Multi-Device Push & Deep-Link Actions

const CACHE_NAME = 'z-catchers-shell-v3';

const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/badge-72x72.png',
  '/icons/icon.svg',
];

// Offline fallback HTML with Warm Dark Sleepy Fox aesthetic
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Z Catchers • Fox Den Offline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #120F0D;
      color: #F5EBE1;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      text-align: center;
    }
    .card {
      background-color: #1C1714;
      border: 1px solid #332B24;
      border-radius: 1.5rem;
      padding: 2rem 1.5rem;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .fox-icon {
      width: 72px;
      height: 72px;
      margin: 0 auto 1.25rem;
      display: block;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 700;
      color: #F5EBE1;
      margin-bottom: 0.5rem;
    }
    p {
      font-size: 0.875rem;
      line-height: 1.5;
      color: #B0A295;
      margin-bottom: 1.5rem;
    }
    .btn-reconnect {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      background-color: #E59843;
      color: #120F0D;
      font-weight: 600;
      font-size: 0.875rem;
      border: none;
      border-radius: 0.75rem;
      padding: 0.75rem 1.5rem;
      cursor: pointer;
      transition: opacity 0.2s;
      min-height: 44px;
      width: 100%;
    }
    .btn-reconnect:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="card">
    <svg class="fox-icon" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="46" fill="#26201B" stroke="#332B24" stroke-width="2"/>
      <path d="M26 36L40 50L28 62C26 58 25 54 25 50C25 45 25.5 40.5 26 36Z" fill="#E07A5F"/>
      <path d="M74 36L60 50L72 62C74 58 75 54 75 50C75 45 74.5 40.5 74 36Z" fill="#E07A5F"/>
      <path d="M30 40L50 68L70 40C64 34 56 32 50 32C44 32 36 34 30 40Z" fill="#E07A5F"/>
      <path d="M42 54L50 64L58 54C55 52 45 52 42 54Z" fill="#F5EBE1"/>
      <circle cx="50" cy="61" r="2.5" fill="#120F0D"/>
      <path d="M36 46C38 46 40 47.5 40 49" stroke="#120F0D" stroke-width="2" stroke-linecap="round"/>
      <path d="M64 46C62 46 60 47.5 60 49" stroke="#120F0D" stroke-width="2" stroke-linecap="round"/>
      <path d="M70 26L76 26L70 32L76 32" stroke="#F4A261" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h1>Fox Den Offline</h1>
    <p>You appear to be offline right now. The den needs an active network connection to track bedtimes and sync Sleep Shields.</p>
    <button class="btn-reconnect" onclick="window.location.reload()">
      Reconnect
    </button>
  </div>
</body>
</html>`;

// 1. Install Event: Cache critical shell assets and skip waiting immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache failed for some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Prune stale caches and immediately claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              console.log('[SW] Deleting stale cache:', name);
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Network-first for navigation with Warm Dark offline fallback; strictly bypass /api/*
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Bypass non-GET requests and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Strictly Network-Only for all API routes (never stale-cache live schedules, check-ins or strikes)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests: Network-first with Warm Dark Sleepy Fox offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return new Response(OFFLINE_HTML, {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          });
        })
    );
    return;
  }

  // Static icons & manifest: Cache-first with network fallback
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Next.js static assets (_next/static): Stale-while-revalidate
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        });
        return cachedResponse || fetchPromise;
      })
    );
  }
});

// 4. Push Notification Delivery
self.addEventListener('push', function (event) {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || '/icons/icon-192x192.png',
      badge: data.badge || '/icons/badge-72x72.png',
      vibrate: [200, 100, 200],
      tag: data.tag || 'zcatchers-alert',
      renotify: true,
      actions: data.actions || [
        { action: 'in_bed', title: "🛌 I'm in Bed" },
        { action: 'open_journal', title: '💬 Nag in Discord' },
      ],
      data: {
        url: data.url || '/',
        timestamp: Date.now(),
      },
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'Z Catchers', options)
    );
  } catch (err) {
    console.error('[SW] Error handling push event:', err);
  }
});

// 5. Notification Click Handler & Deep-Linking (e.g., /?action=in-bed or Discord Journal)
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || '/';
  
  let targetActionUrl = rawUrl;
  if (event.action === 'in_bed') {
    targetActionUrl = '/?action=in-bed';
  } else if (event.action === 'open_journal') {
    if (rawUrl && rawUrl.includes('discord.com')) {
      targetActionUrl = rawUrl;
    }
  }

  const targetUrl = new URL(targetActionUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const isExternal = !targetUrl.startsWith(self.location.origin);
      if (isExternal) {
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
        return;
      }

      // Check for existing open window client
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) {
            client.navigate(targetUrl);
          }
          if ('postMessage' in client) {
            client.postMessage({
              type: 'NOTIFICATION_ACTION',
              url: targetUrl,
              action: targetActionUrl.includes('action=in-bed') ? 'in-bed' : undefined,
            });
          }
          return;
        }
      }

      // If no window is currently open, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// 6. Keep one durable device binding so foreground sync and background rotation
// can retry a failed request without losing the endpoint that was last confirmed.
let bindingQueue = Promise.resolve();

function withPushBinding(task) {
  const result = bindingQueue.then(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('zcatchers-push', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('device');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const access = (mode, change) => new Promise((resolve, reject) => {
      const tx = db.transaction('device', mode);
      const request = change(tx.objectStore('device'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    try {
      const binding = await access('readonly', store => store.get('binding')) || {};
      const save = next => access('readwrite', store => store.put(next, 'binding'));
      return await task(binding, save);
    } finally {
      db.close();
    }
  });
  bindingQueue = result.catch(() => {});
  return result;
}

async function requestPushApi(path, options, parseBody = false) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    const data = parseBody ? await response.json().catch(() => ({})) : undefined;
    return { response, data };
  } finally {
    clearTimeout(deadline);
  }
}

async function sendPushBinding(subscription, binding, details) {
  try {
    const { response, data } = await requestPushApi('/api/push/subscribe', {
      method: 'POST',
      credentials: details.background ? 'omit' : 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...details,
        subscription,
        old_endpoint: binding.endpoint,
        rotation_credential: binding.credential,
        user_agent: self.navigator.userAgent,
      }),
    }, true);
    if (!response.ok || !data.success) {
      return {
        success: false,
        code: data.code,
        confirmedEndpoint: data.confirmedEndpoint,
        error: data.error || 'Could not sync device alerts. Try again.',
        repair: response.status === 401 || response.status === 403 ? 'sign_in' : 'retry',
      };
    }
    return data;
  } catch {
    return { success: false, repair: 'retry', error: 'Could not reach the server. Try again when online.' };
  }
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'PUSH_DEVICE' || !event.ports[0]) return;
  const { action, memberId, notifyPersonal, notifyCommunity, enable, applicationServerKey } = event.data;
  event.waitUntil(withPushBinding(async (binding, save) => {
    if (action === 'status') {
      return { repair: binding.repair, disabled: binding.disabled, memberId: binding.memberId,
        notifyPersonal: binding.notifyPersonal, notifyCommunity: binding.notifyCommunity };
    }

    if (binding.memberId && binding.memberId !== memberId) {
      return { success: false, repair: 'sign_in', error: 'Sign in with the Discord account that linked this device.' };
    }

    let subscription = await self.registration.pushManager.getSubscription();
    if (action === 'unlink') {
      const endpoint = binding.endpoint || subscription?.endpoint;
      if (endpoint || binding.credential) {
        const { response } = await requestPushApi('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, rotation_credential: binding.credential, member_id: memberId }),
        });
        if (!response.ok) {
          return { success: false, error: 'Could not unlink this device. Check your sign-in and try again.' };
        }
      }
      await save({ disabled: true });
      await subscription?.unsubscribe().catch(() => false);
      return { success: true };
    }

    if (action !== 'sync' || !memberId || (binding.disabled && !enable)) return { success: false };
    if (!enable && !subscription && !binding.endpoint && !binding.repair) return { success: false };
    const { disabled, ...saved } = binding;
    const credential = binding.credential || Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      byte => byte.toString(16).padStart(2, '0')
    ).join('');
    const staged = { ...saved, credential };

    try {
      if (!subscription && applicationServerKey) {
        subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      }
    } catch {
      await save({ ...staged, repair: 'retry' });
      return { success: false, repair: 'retry', error: 'Push registration failed. Try again on this device.' };
    }
    if (!subscription) return { success: false };

    // Commit the credential in worker storage before the server disables legacy rotation.
    await save(staged);
    const details = { member_id: memberId, notify_personal: notifyPersonal, notify_community: notifyCommunity };
    let result = await sendPushBinding(subscription.toJSON(), staged, details);
    if (result.code === 'binding_missing') {
      const current = await self.registration.pushManager.getSubscription();
      if (current?.endpoint === subscription.endpoint) {
        result = await sendPushBinding(current.toJSON(), { ...staged, endpoint: undefined }, {
          ...details,
          notify_personal: notifyPersonal ?? saved.notifyPersonal,
          notify_community: notifyCommunity ?? saved.notifyCommunity,
        });
      }
    } else if (result.confirmedEndpoint && result.confirmedEndpoint !== staged.endpoint) {
      const current = await self.registration.pushManager.getSubscription();
      if (current?.endpoint === subscription.endpoint) {
        result = await sendPushBinding(current.toJSON(), { ...staged, endpoint: result.confirmedEndpoint }, details);
      }
    }
    if (!result.success) {
      await save({ ...staged, repair: result.repair });
      return result;
    }
    await save({
      memberId,
      credential,
      credentialConfirmed: true,
      endpoint: subscription.endpoint,
      notifyPersonal: result.notifyPersonal,
      notifyCommunity: result.notifyCommunity,
    });
    return result;
  }).then(
    result => event.ports[0].postMessage(result),
    () => event.ports[0].postMessage({ success: false, repair: 'retry', error: 'Could not sync device alerts. Try again.' })
  ));
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(withPushBinding(async (binding, save) => {
    if (binding.disabled) return;

    const previous = binding.endpoint || event.oldSubscription?.endpoint;
    const staged = { ...binding, endpoint: previous };
    let subscription;
    try {
      subscription = event.newSubscription || await self.registration.pushManager.getSubscription();
      if (!subscription && event.oldSubscription) {
        subscription = await self.registration.pushManager.subscribe(event.oldSubscription.options);
      }
    } catch {
      subscription = null;
    }
    if (!subscription || !previous) {
      await save({ ...staged, repair: 'retry' });
      await notifyPushBindingChanged(false);
      return;
    }
    // A queued event may already have been superseded by a foreground sync.
    const browserSubscription = await self.registration.pushManager.getSubscription();
    if (browserSubscription && browserSubscription.endpoint !== subscription.endpoint) return;
    let usedCredential = Boolean(staged.credential);
    let result = await sendPushBinding(subscription.toJSON(), staged, { background: true });
    if (usedCredential && !staged.credentialConfirmed && result.code === 'credential_required') {
      usedCredential = false;
      result = await sendPushBinding(subscription.toJSON(), { ...staged, credential: undefined }, { background: true });
    }
    if (!result.success) {
      await save({ ...staged, repair: result.repair });
      await notifyPushBindingChanged(false);
      return;
    }
    const { repair, ...confirmed } = staged;
    await save({
      ...confirmed,
      credentialConfirmed: usedCredential,
      endpoint: subscription.endpoint,
      notifyPersonal: result.notifyPersonal,
      notifyCommunity: result.notifyCommunity,
    });
    await notifyPushBindingChanged(true);
  }).catch(() => {}));
});

async function notifyPushBindingChanged(active) {
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    client.postMessage({ type: 'PUSH_DEVICE_CHANGED', active });
  }
}
