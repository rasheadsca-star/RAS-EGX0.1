// V8.11.0 Plain Recovery Service Worker - disables old cache
self.addEventListener('install', function(event){ self.skipWaiting(); });
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){ return Promise.all(keys.map(function(k){ return caches.delete(k); })); })
      .then(function(){ return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function(event){ /* network default */ });
