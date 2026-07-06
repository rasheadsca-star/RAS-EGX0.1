/* EGX Pro Hub V9.8 Trusted Coverage Loop — cache rescue service worker */
const CACHE_NAME = 'egx-pro-hub-v9-8-trusted-coverage-loop';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function networkFirst(request){
  try { return await fetch(request, { cache: 'no-store' }); }
  catch(e){ const cache = await caches.open(CACHE_NAME); const cached = await cache.match(request); return cached || new Response('Offline and no cached copy available', { status: 503 }); }
}
self.addEventListener('fetch', event => { if(event.request.method !== 'GET') return; event.respondWith(networkFirst(event.request)); });
