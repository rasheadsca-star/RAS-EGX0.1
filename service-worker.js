// EGX Pro Hub V10.3 Accuracy Tracker Hardening
const CACHE_NAME='egx-pro-hub-v1030-accuracy-tracker-hardening';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.pathname.includes('/data/') || url.searchParams.has('v')){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));
    return;
  }
  event.respondWith(fetch(req).catch(()=>caches.match(req)));
});
