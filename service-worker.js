/* EGX Pro Hub V9.8.8.4.3.2.2.3.2.1 Safe PWA Service Worker */
const CACHE_NAME = "egx-pro-hub-shell-v9-8-8";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES).catch(()=>null)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, {cache: "no-store"});
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // Market/data JSON must always try network first to avoid stale prices.
  if (url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Main shell and icons can be cache-first.
  if (url.pathname.endsWith("/") || url.pathname.endsWith("index.html") || url.pathname.includes("/icons/") || url.pathname.endsWith("manifest.json")) {
    event.respondWith(cacheFirst(event.request));
  }
});
