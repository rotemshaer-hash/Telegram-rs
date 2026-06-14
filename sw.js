// Kidemy Service Worker — auto-update on every deploy
const VERSION = '4.9.5';

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

// Same-origin only — cross-origin CDN requests (Firebase, fonts, etc.)
// are handled by the browser natively so they never fail due to missing cache
self.addEventListener('fetch', e => {
  if(!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
