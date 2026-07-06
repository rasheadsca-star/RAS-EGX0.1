// EGX Pro Hub V8.10.6 Emergency Cache Reset Service Worker
// This file intentionally does not cache anything.
self.addEventListener('install', event => {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => fetch(event.request)));
});
