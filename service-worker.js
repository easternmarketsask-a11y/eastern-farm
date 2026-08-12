/* service-worker.js — Eastern Farm PWA app-shell cache (root scope '/').
 *
 * Lives at the repo ROOT so its scope is '/', which lets it cache both the
 * app shell under /src/ AND apply a network-first policy to /data/*.json
 * (a /src/-scoped worker could not see /data/, a sibling of /src/).
 *
 * Strategy:
 *   - navigations (HTML docs) → network-first with a SHORT timeout, ALWAYS falling back to
 *       the cached shell. A SW must never be able to hang a navigation (iOS Safari will sit
 *       on a blank screen forever if respondWith never resolves).
 *   - /data/*.json            → network-first (try fresh, timeout→cache fallback offline)
 *   - static sub-resources (css/js/icons) → network-first with a 4s timeout, cache fallback
 *       (2026-07-11: changed FROM stale-while-revalidate. SWR served old cached JS until the
 *       new SW activated, so iOS frozen tabs / a broken update chain trapped users on
 *       weeks-old code. Network-first means online users ALWAYS run the latest code (matching
 *       the network-first HTML — no more new-HTML/old-JS mismatch); slow/offline falls back to
 *       cache so the game still opens in any state. Verified: online=fresh, server-killed=boots
 *       from cache.)
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

// CACHE_VERSION 由 deploy.sh 在每次部署时自动注入时间戳（ef-YYMMDDHHMM），
// 不再手动 +1 —— 忘 bump 会让全体 PWA 用户静默停在旧版（iOS 要删 App 才能救）。
const CACHE_VERSION = 'ef-2608112115';
const CACHE = 'eastern-farm-' + CACHE_VERSION;
// Precache the FULL app shell — HTML + CSS + every JS module + data JSON — so a SW
// update (which clears the old cache) followed by a flaky mobile network can never leave
// the game unable to load (the old SW only precached HTML/CSS, so the JS could vanish →
// stuck-can't-enter). Images stay network-first/on-demand (the game degrades gracefully
// without them). Cached individually below so one missing file can't block the rest.
const PRECACHE = [
  '/',                       // root redirect page — cached so a navigation fallback to "/" keeps correct relative paths
  '/src/index.html',
  '/src/css/style.css',
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
  '/src/js/kitchen.js',
  '/src/js/shop.js', '/src/js/tasks.js', '/src/js/events.js', '/src/js/storekeeper.js',
  '/src/js/rewards.js', '/src/js/achievements.js', '/src/js/tutorial.js', '/src/js/guide.js',
  '/src/js/spotlight.js', '/src/js/login-nudge.js', '/src/js/promo.js', '/src/js/share.js',
  '/src/js/mapview-iso.js', '/src/js/main.js', '/src/js/pwa-install.js',
  '/data/achievements.json', '/data/ai-neighbors.json', '/data/coupons.json', '/data/crops.json',
  '/data/ep-shop.json', '/data/events.json', '/data/i18n.json', '/data/news.json', '/data/tasks.json',
  '/data/recipes.json',
];
// 2026-08-11 世界杯退场：worldcup.html / worldcup.css / worldcup.js / wc2026.json
// 一并移出预缓存。四个文件仍在仓库里、worldcup.html 直链仍可打开（联网时正常走
// 网络加载），只是不再让每个玩家在装 PWA 时先下载一份赛事资料。

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

  // Best-effort background fetch: cache a fresh 200, return the response (or null on fail).
  const fetchAndCache = () => fetch(req).then((res) => {
    if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  }).catch(() => null);

  // NAVIGATIONS (HTML documents) → network-first with a SHORT timeout, then ALWAYS fall back
  // to the cached shell. CRITICAL: a SW must never be able to hang a navigation. A prior
  // version served navigations via an un-timed fetch, so on iOS Safari a hung document fetch
  // left the page stuck on a blank screen forever (WeChat's webview runs no SW, so it was
  // unaffected — that asymmetry was the tell). Racing a timeout guarantees the page always
  // resolves: fresh HTML when the network is healthy, cached shell within a few seconds when
  // it isn't.
  if (req.mode === 'navigate') {
    const shell = () => caches.match(req)
      .then((c) => c || caches.match('/src/index.html'))
      .then((c) => c || Response.error());
    const net = fetchAndCache();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3500));
    event.respondWith(
      Promise.race([net, timeout]).then((res) => res || shell()).catch(shell)
    );
    return;
  }

  // /data/*.json → network-first (fresh game data), timeout→cache so a HUNG fetch on flaky
  // mobile / in-app WebViews can't stall boot's data load forever.
  if (url.pathname.startsWith('/data/') && url.pathname.endsWith('.json')) {
    const fromCache = () => caches.match(req).then((c) => c || Response.error());
    const net = fetchAndCache();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 6000));
    event.respondWith(Promise.race([net, timeout]).then((res) => res || fromCache()).catch(fromCache));
    return;
  }

  // Static sub-resources (css/js/icons) → NETWORK-FIRST with a short timeout, cache fallback.
  // 改动理由（2026-07-11，Chris「根源解决，别让任何客人卡在旧版」）：原来是
  // stale-while-revalidate（先给旧缓存 JS、后台再更新），新代码非得等新 SW 激活才生效
  // → iOS 冻结标签页 / 更新链失败时，客人被永久困在几周前的旧代码里（Chris 亲历）。
  // 改成在线优先：只要网络正常就永远拿最新代码（与 network-first 的 HTML 版本一致，
  // 杜绝 HTML 新 / JS 旧的错配）；网络慢(>4s)或离线才回退缓存 → 离线照常能玩、
  // 「任何状态下都打得开」。速度代价靠浏览器 HTTP 缓存(max-age=600)兜住，可接受。
  const fromCacheStatic = () => caches.match(req).then((c) => c || Response.error());
  const netStatic = fetchAndCache();
  const timeoutStatic = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  event.respondWith(
    Promise.race([netStatic, timeoutStatic]).then((res) => res || fromCacheStatic()).catch(fromCacheStatic)
  );
});
