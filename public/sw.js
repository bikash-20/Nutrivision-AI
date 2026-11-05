// Bump this on every deploy so the SW invalidates old precached assets.
// Convention: nutrision-v{N} where N increments per push.
const CACHE_NAME = 'nutrivision-v7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png',
  '/icon-96.png',
  '/icon-192.png',
  '/icon-512.png',
  '/nutrivision-ai.jpeg',
];

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(STATIC_ASSETS);
  const page = await cache.match('/');
  if (!page) return;
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
    .map((match) => new URL(match[1], self.location.origin).pathname);
  await cache.addAll(assets);

  const stylesheets = assets.filter((asset) => asset.endsWith('.css'));
  const fontAssets = [];
  for (const stylesheet of stylesheets) {
    const response = await cache.match(stylesheet);
    if (!response) continue;
    const css = await response.text();
    for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const url = new URL(match[1], new URL(stylesheet, self.location.origin));
      if (url.origin === self.location.origin) fontAssets.push(url.pathname);
    }
  }
  if (fontAssets.length) await cache.addAll([...new Set(fontAssets)]);
}

// Cache the production JS/CSS bundles as part of first install for offline launch.
self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for HTML/API/sw.js, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) schemes
  if (!url.protocol.startsWith('http')) return;

  // Always network-first for the SW file itself so a new deployment is
  // picked up on the next page load (without requiring a hard refresh).
  if (url.pathname === '/sw.js') return;

  // Keep account and health API responses out of Cache Storage. The app has
  // device-local fallbacks; caching these responses could mix users on shared devices.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Static assets (JS/CSS/images): cache-first, but revalidate in the
  // background so the next visit picks up new bundles (the old bundle
  // remains in cache for one extra visit, which is fine — no broken state).
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // HTML pages: network-first
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});
