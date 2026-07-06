// V8.10.5 Emergency stable rollback service worker cleanup
// This SW intentionally clears old EGX Pro Hub caches and then unregisters itself.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) client.navigate(client.url);
      await self.registration.unregister();
    } catch (e) {}
  })());
});
self.addEventListener('fetch', () => {});
