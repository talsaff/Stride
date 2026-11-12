// Offline support. Online: always fetch the latest files (network first) and
// keep a copy. Offline: serve the copy. Bump VERSION when app files change.
const VERSION = 'stride-v27';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/icons.js', 'js/storage.js', 'js/google.js', 'js/push.js',
  'js/engine/config.js', 'js/engine/schema.js', 'js/engine/history.js', 'js/engine/feedback.js',
  'js/engine/readiness.js', 'js/engine/safety.js', 'js/engine/generator.js', 'js/engine/progression.js',
  'js/engine/engine.js', 'js/engine/personalization.js', 'js/engine/profile.js',
  'js/engine/medals.js', 'js/engine/schedule.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      // Revalidate with the server so updates show up right away.
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});

// ---------------------------------------------------------------- push reminders

self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Stride time 🏃', {
    body: msg.body || 'Time to move!',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: msg.tag || 'stride',
    data: { url: msg.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.focus(); return; } }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
