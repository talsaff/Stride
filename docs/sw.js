// Offline support: cache the app shell, serve it cache-first, refresh in the
// background. Bump VERSION whenever app files change.
const VERSION = 'stride-v4';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/icons.js', 'js/storage.js', 'js/google.js',
  'js/engine/config.js', 'js/engine/schema.js', 'js/engine/history.js', 'js/engine/feedback.js',
  'js/engine/readiness.js', 'js/engine/safety.js', 'js/engine/generator.js', 'js/engine/progression.js',
  'js/engine/engine.js', 'js/engine/personalization.js', 'js/engine/profile.js',
  'js/engine/medals.js', 'js/engine/schedule.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
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
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
