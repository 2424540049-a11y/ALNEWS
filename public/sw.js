const STATIC_CACHE = "shfe-futures-static-v43";
const STATIC_ASSETS = [
  "/", "/index.html", "/styles.css?v=43", "/app.js?v=43",
  "/vendor/lightweight-charts.standalone.production.js", "/chart-engine.js?v=43", "/news-feed.js?v=43",
  "/install.html", "/install.css?v=43", "/install.js?v=43",
  "/news-reader.html", "/news-reader.css?v=43", "/news-reader.js?v=43",
  "/news-summary-lab.html", "/news-summary-lab.css", "/news-summary-lab.js",
  "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"
];
// One fixed cache entry per known resource; query strings cannot grow the cache.
const ASSET_KEYS = new Map(STATIC_ASSETS.map(asset => [new URL(asset, self.location.origin).pathname, asset]));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(STATIC_ASSETS.map(async asset => {
      const response = await fetch(new Request(asset, { cache: "reload" }));
      if (!response.ok) throw new Error(`Cannot cache ${asset}: HTTP ${response.status}`);
      await cache.put(asset, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => /^shfe-futures-(?:static|data)-v\d+$/.test(key) && key !== STATIC_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // APIs retain their own freshness/error semantics, including POST APIs.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.method !== "GET") return;
  const key = ASSET_KEYS.get(url.pathname);
  const navigation = event.request.mode === "navigate";
  if (!key && !navigation) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (key && response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.put(key, copy)).catch(() => {}));
      }
      return response;
    } catch {
      const cache = await caches.open(STATIC_CACHE);
      const cached = key ? await cache.match(key) : null;
      if (cached) return cached;
      if (navigation) {
        const home = await cache.match("/index.html");
        if (home) return home;
      }
      return new Response("离线资源暂不可用，请联网后重试。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
