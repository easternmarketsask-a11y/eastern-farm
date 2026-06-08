/* service-worker.js — Eastern Farm PWA app-shell cache (root scope '/').
 *
 * Lives at the repo ROOT so its scope is '/', which lets it cache both the
 * app shell under /src/ AND apply a network-first policy to /data/*.json
 * (a /src/-scoped worker could not see /data/, a sibling of /src/).
 *
 * Strategy:
 *   - /data/*.json        → network-first (always try fresh; fall back to cache offline)
 *   - navigations         → network, fall back to cached /src/index.html offline
 *   - other same-origin GET (css/js/icons) → stale-while-revalidate
 *   - cross-origin (Firebase/gstatic CDN) → not intercepted
 *
 * Bump CACHE_VERSION whenever shell assets change so old caches are purged.
 * (Task 5a will extend this file with Firebase Cloud Messaging background
 *  handling via importScripts — keep that integration in THIS worker so we
 *  don't register two competing root-scope service workers.)
 */
const CACHE_VERSION = 'ef-v1';
const CACHE = 'eastern-farm-' + CACHE_VERSION;
const PRECACHE = [
  '/src/index.html',
  '/src/css/style.css',
  '/src/css/animations.css',
  '/src/manifest.webmanifest',
  '/src/icons/icon-192.png',
  '/src/icons/icon-512.png',
  '/src/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {})            // a missing asset must not abort install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;  // leave Firebase/CDN alone

  // Game data: network-first so crops/tasks/events/news stay fresh; the cached
  // copy is only a last-resort offline fallback.
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Navigations: prefer live network; offline, serve the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/src/index.html'))
    );
    return;
  }

  // Static shell assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networked = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || networked;
    })
  );
});
