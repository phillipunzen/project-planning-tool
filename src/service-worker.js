// The build supplies a version derived from the app and offline resources.
const CACHE_NAME = "projektwerk-pwa-__PWA_VERSION__";
const OFFLINE_ASSETS = __PWA_ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(
          OFFLINE_ASSETS.map((url) => new Request(url, { cache: "reload" })),
        ),
      ),
  );
  // Updates wait until existing app windows close, preserving open drafts.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith("projektwerk-pwa-") && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Sessions, SSO, project data, uploads and writes always go to the server.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/uploads" ||
    url.pathname.startsWith("/uploads/")
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match("/offline.html")) || Response.error();
      }),
    );
  } else if (OFFLINE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(url.pathname)) || fetch(request);
      })(),
    );
  }
});
