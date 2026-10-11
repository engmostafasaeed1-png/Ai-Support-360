/* AI Support 360: service worker for push alerts ONLY.
 * It shows a notification for every push message and opens the portal when the notification is tapped. It has no fetch handler and no cache, so it can
 * never serve an old version of the app. Every push message MUST show a notification (Safari on iPhone removes the subscription otherwise).
 * The message is a small JSON written by the function critical-request-alert: { title, body, url, tag, urgent, sent_at }. */

const FALLBACK = { title: 'AI Support 360', body: 'You have a new alert. Open the portal to see it.', url: '/consultant/open-tickets', tag: 'ai-support-360', urgent: false };

/** Only the path of the address is kept and it is always opened on this worker's own origin (a message can never send the consultant to another site). */
function safeUrl(raw) {
  try {
    const u = new URL(String(raw || ''), self.location.origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return FALLBACK.url;
    return u.pathname + u.search + u.hash;
  } catch (e) {
    return FALLBACK.url;
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = FALLBACK;
  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === 'object') data = Object.assign({}, FALLBACK, parsed);
  } catch (e) {
    data = FALLBACK;
  }
  const urgent = data.urgent === true;
  const options = {
    body: String(data.body || '').slice(0, 300),
    icon: '/icon-192.png',
    badge: '/favicon-32.png',
    tag: String(data.tag || FALLBACK.tag).slice(0, 80),
    renotify: true,
    requireInteraction: urgent,
    vibrate: urgent ? [300, 150, 300, 150, 600] : [150],
    timestamp: Number(data.sent_at) || Date.now(),
    data: { url: safeUrl(data.url) },
  };
  event.waitUntil(self.registration.showNotification(String(data.title || FALLBACK.title).slice(0, 80), options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || FALLBACK.url, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        } catch (e) {
          // try the next window, or open a new one
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

