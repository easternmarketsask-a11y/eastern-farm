/* service-worker.js — Eastern Farm PWA app-shell cache (root scope '/').
 *
 * Lives at the repo ROOT so its scope is '/', which lets it cache both the
 * app shell under /src/ AND apply a network-first policy to /data/*.json
 * (a /src/-scoped worker could not see /data/, a sibling of /src/).
 *
 * Strategy (2026-08-12 起)：
 *   - 同源 GET 一律 **缓存优先**：命中即刻返回，绝不等网络（详见下方 fetch 处理器
 *     里的长注释与实测数据——上一版「在线优先+超时」的超时只管响应头不管内容体，
 *     手机弱网「连上了但爬不动」时会把卡死的流交给页面，缓存形同虚设）。
 *   - 未命中缓存 → 走网络并顺手缓存；离线且未缓存的导航 → 兜底 app shell
 *   - /service-worker.js 与 cache:'no-store' 请求 → 不拦截（新鲜度信标要真网络）
 *   - cross-origin (Firebase/gstatic CDN) → not intercepted
 *   - 版本更新由 install 整包预缓存 + activate 清旧缓存 + index.html 内联新鲜度守卫负责
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
const CACHE_VERSION = 'ef-2608121923';
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

/* ===== 取用策略：缓存优先（2026-08-12 根因修复）=====
 *
 * 🔒 只要缓存里有，就立刻给，绝不等网络。
 *
 * 上一版（2026-07-11 起）是「在线优先 + 超时回退缓存」，看着有兜底，实际有个致命漏洞：
 *   `fetch()` 在**响应头**到达时就 resolve，不等内容体。
 *   所以那个 3.5s / 4s / 6s 超时只保护「连上了没」，完全不保护「数据下完了没」。
 * 手机信号飘时最典型的场景恰恰是「连上了、然后数据爬不动」——这时 Promise.race 早已
 * 判网络赢，SW 把一个卡死的流交给页面，而缓存里那份好的**一次都不会被用到**。
 * `css/style.css` 是阻塞渲染的 → 页面白屏；50 个 defer JS 全卡 → 永远进不去。
 *
 * 2026-08-12 实测（生产站，缓存已装满 61 条、index/style/main/state 全在）：
 *   全速     → 0.3 秒可玩
 *   10kbps   → 1.2 秒画出开屏，**45 秒仍进不去**  ← 东西全在本地却不肯用
 * 改成缓存优先后同一条件下回到秒开（见 commit 说明）。
 *
 * 「永不困在旧代码」（2026-07-11 那次改动的初衷）**不靠这里保证**，靠的是
 * index.html 里内联的「新鲜度守卫」：controllerchange 自动刷新 +
 * 版本信标（`fetch('/service-worker.js?v=…', {cache:'no-store'})` 比对
 * 线上 CACHE_VERSION 与本页 <meta ef-build>，不一致就自愈刷新）。
 * 新版本经由「新 SW 安装时整包预缓存 + activate 清旧缓存」下发。
 * ⚠️ 改这里前先读那段守卫（index.html 底部），别把两处的职责搞混。
 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;  // leave Firebase/CDN alone

  // 🔒 新鲜度信标必须真的走网络，否则自愈机制会被自己的缓存骗过去（版本永远"一致"）。
  // 它请求的是 /service-worker.js?v=<时间戳>，而下面 match 用了 ignoreSearch，
  // 不排除的话会命中缓存里的 /service-worker.js → 永远读到旧 CACHE_VERSION。
  if (url.pathname === '/service-worker.js') return;
  if (req.cache === 'no-store') return;
  // 🔒 急救页永远走网络（/fix.html）——它存在的意义就是「别的都打不开时的出路」，
  // 一旦被自己的缓存困住就彻底失去意义。整页 ~4KB 零依赖，走网络代价可忽略。
  if (url.pathname === '/fix.html') return;

  event.respondWith((async () => {
    // 缓存优先：命中即刻返回。ignoreSearch 让 ?fresh= / ?v= 之类的查询串也能命中
    // （本站静态资源不靠查询串区分版本，版本由 CACHE_VERSION 整包管理）。
    try {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
    } catch (e) { /* 缓存不可用就走网络 */ }

    // 没缓存才下网络，顺手存起来（首访、按需加载的地图/图片走这条）
    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (e) {
      // 离线且未缓存：导航兜底到 app shell，让游戏至少打得开
      if (req.mode === 'navigate') {
        const shell = (await caches.match('/src/index.html')) || (await caches.match('/'));
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
