/* EGX Pro Hub V9.3 Execution Decision Queue — cache rescue service worker */
const CACHE_NAME = 'egx-pro-hub-v9-3-execution-decision-queue';
self.addEventListener('install', event => {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
async function networkFirst(request) {
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    return fresh;
  } catch (e) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    return cached || new Response('Offline and no cached copy available', { status: 503 });
  }
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname.includes('/data/') || url.searchParams.has('v')) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(networkFirst(event.request));
});
