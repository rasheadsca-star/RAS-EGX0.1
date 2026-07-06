/* EGX Pro Hub V8.10.1 Stable Rebuild - Network First SW */
const CACHE_NAME = "egx-pro-hub-stable-rebuild-v8101-20260706";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Always fetch fresh app shell and market data to avoid stale broken versions.
  if (url.pathname.endsWith("/") || url.pathname.endsWith("index.html") || url.pathname.includes("/data/") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
