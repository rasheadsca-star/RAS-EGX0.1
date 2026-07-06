/* EGX Pro Hub V8.10.4 Cache Rescue Service Worker
   Purpose: stop stale app-shell problems by using network-first for index/html/data.
*/
const CACHE_NAME = "egx-pro-hub-shell-v8-10-4-cache-rescue";
const SHELL_FILES = [
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES).catch(() => null))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone()).catch(() => null);
    }
    return fresh;
  } catch (e) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request, { cache: "no-store" });
  if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => null);
  return fresh;
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  if (
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.includes("/data/") ||
    url.pathname.endsWith(".json")
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.pathname.includes("/icons/") || url.pathname.endsWith("manifest.json")) {
    event.respondWith(cacheFirst(event.request));
  }
});
