/* EGX Pro Hub V7.13 — Safe PWA Service Worker */
const CACHE_NAME = 'egx-pro-hub-shell-v7-13';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES).catch(()=>{})));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
function isDataRequest(url){ return url.pathname.includes('/data/') || url.pathname.endsWith('.json'); }
async function networkFirst(req){
  const cache=await caches.open(CACHE_NAME);
  try{ const fresh=await fetch(req,{cache:'no-store'}); if(fresh && fresh.ok) cache.put(req, fresh.clone()); return fresh; }
  catch(e){ const cached=await cache.match(req); if(cached) return cached; throw e; }
}
async function shellFirst(req){
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(req);
  if(cached) return cached;
  const fresh=await fetch(req); if(fresh && fresh.ok) cache.put(req, fresh.clone()); return fresh;
}
self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.method !== 'GET') return;
  const url=new URL(req.url);
  if(url.origin !== location.origin) return;
  if(req.mode === 'navigate') { event.respondWith(networkFirst(req).catch(()=>caches.match('./index.html'))); return; }
  if(isDataRequest(url)) { event.respondWith(networkFirst(req)); return; }
  event.respondWith(shellFirst(req));
});
self.addEventListener('message', event => { if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });
