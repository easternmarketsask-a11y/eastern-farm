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
/* ---- Firebase Cloud Messaging (background notifications) ----
 * Wrapped in try/catch: if importScripts fails (offline / CDN blocked), the
 * caching logic below still works — only background push init is skipped. We
 * keep FCM in THIS root worker (not a separate firebase-messaging-sw.js) so we
 * never register two competing root-scope service workers. */
try {
  importScripts(
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js'
  );
  firebase.initializeApp({
    apiKey: 'AIzaSyDDhVm_n_TyV2mtp517qUoLU4A9HB1k3No',
    projectId: 'eastern-market-members',
    messagingSenderId: '515107029536',
    appId: '1:515107029536:web:9f6caef22bae67aa5af245',
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const n = (payload && payload.notification) || {};
    self.registration.showNotification(n.title || '东方农场', {
      body: n.body || '',
      icon: '/src/icons/icon-192.png',
      badge: '/src/icons/icon-192.png',
      data: { url: '/src/index.html' },
    });
  });
} catch (e) {
  // Offline or CDN unavailable — caching still works without FCM.
}

// Clicking a notification focuses an open game tab, or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/src/index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.indexOf('/src/') !== -1 && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

const CACHE_VERSION = 'ef-v99';
const CACHE = 'eastern-farm-' + CACHE_VERSION;
// Precache the FULL app shell — HTML + CSS + every JS module + data JSON — so a SW
// update (which clears the old cache) followed by a flaky mobile network can never leave
// the game unable to load (the old SW only precached HTML/CSS, so the JS could vanish →
// stuck-can't-enter). Images stay network-first/on-demand (the game degrades gracefully
// without them). Cached individually below so one missing file can't block the rest.
const PRECACHE = [
  '/src/index.html',
  '/src/css/style.css',
  '/src/css/animations.css',
  '/src/manifest.webmanifest',
  '/src/icons/icon-192.png',
  '/src/icons/icon-512.png',
  '/src/icons/icon-maskable-512.png',
  '/src/js/analytics.js', '/src/js/i18n.js', '/src/js/weather.js', '/src/js/state.js',
  '/src/js/audio.js', '/src/js/crops.js', '/src/js/crop-art.js', '/src/js/ui.js',
  '/src/js/coach.js', '/src/js/firebase-init.js', '/src/js/firebase-queue.js',
  '/src/js/firebase-points.js', '/src/js/firebase-auth.js', '/src/js/firebase-game-sync.js',
  '/src/js/firebase-push.js', '/src/js/ep-shop.js', '/src/js/ai-neighbors.js',
  '/src/js/social-steal.js', '/src/js/neighbors.js', '/src/js/home-report.js',
  '/src/js/daily.js', '/src/js/login-calendar.js', '/src/js/farm.js', '/src/js/tending.js',
  '/src/js/seasons.js', '/src/js/harvest-status.js', '/src/js/warehouse.js', '/src/js/orders.js',
  '/src/js/shop.js', '/src/js/tasks.js', '/src/js/events.js', '/src/js/storekeeper.js',
  '/src/js/rewards.js', '/src/js/achievements.js', '/src/js/tutorial.js', '/src/js/guide.js',
  '/src/js/spotlight.js', '/src/js/login-nudge.js', '/src/js/promo.js', '/src/js/share.js',
  '/src/js/mapview.js', '/src/js/mapview-iso.js', '/src/js/main.js', '/src/js/pwa-install.js',
  '/data/achievements.json', '/data/ai-neighbors.json', '/data/coupons.json', '/data/crops.json',
  '/data/ep-shop.json', '/data/events.json', '/data/i18n.json', '/data/news.json', '/data/tasks.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache each individually so one missing/failed file doesn't abort the whole precache
      .then((cache) => Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {}))))
      .catch(() => {})
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

  // Network-first for ALL same-origin GETs (latest code/data when online; cache is the
  // offline fallback). CRITICAL for flaky mobile / in-app browsers: a fetch that HANGS
  // (no response, no error — common on captive-portal/in-app WebViews) would otherwise
  // stall the page forever. So we RACE the network against a timeout that falls back to
  // the cached copy — the game loads from cache instead of hanging on a dead socket.
  const fromCache = () => caches.match(req).then((cached) => {
    if (cached) return cached;
    if (req.mode === 'navigate') return caches.match('/src/index.html');
    return Response.error();
  });
  const TIMEOUT = req.mode === 'navigate' ? 4000 : 6000;
  const network = fetch(req).then((res) => {
    if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(fromCache()), TIMEOUT));
  event.respondWith(Promise.race([network, timeout]).catch(fromCache));
});
