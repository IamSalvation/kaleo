self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  // Pass-through fetch (no offline caching for now, just enables PWA install)
  event.respondWith(fetch(event.request));
});
