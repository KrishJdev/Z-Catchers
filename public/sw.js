// Z Catchers Service Worker
// Handles background push notifications & Discord journal deep linking

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

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
      data: {
        url: data.url || '/',
        timestamp: Date.now(),
      },
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'Z Catchers', options)
    );
  } catch (err) {
    console.error('Error handling push event in service worker:', err);
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If target URL is an external link (e.g., Discord thread), open window directly
      const isExternal = targetUrl.startsWith('http') && !targetUrl.startsWith(self.location.origin);
      if (isExternal) {
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      }

      // Check if an existing app tab is already open to focus
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if (targetUrl !== '/') {
            return client.navigate(targetUrl);
          }
          return;
        }
      }

      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
