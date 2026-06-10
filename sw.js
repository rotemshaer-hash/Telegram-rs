// Kidemy Service Worker — auto-update on every deploy
const VERSION = '4.6.2';

// Activate immediately without waiting for old tabs to close
self.addEventListener('install', () => self.skipWaiting());

// On activation: delete all old caches + claim all open tabs
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Always fetch from network — never serve stale content
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
