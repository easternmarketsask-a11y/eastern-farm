/* service-worker.js — Eastern Farm PWA app-shell cache (root scope '/').
 *
 * Lives at the repo ROOT so its scope is '/', which lets it cache both the
 * app shell under /src/ AND apply a network-first policy to /data/*.json
 * (a /src/-scoped worker could not see /data/, a sibling of /src/).
 *
 * Strategy (2026-08-13 起)：
 *   🔒 **SW 只从缓存回答，从不代替浏览器上网。** 这是本文件最高的不变量，
 *      违反它就等于把「页面可能永久白屏」重新装回去（下方 fetch 处理器有长注释）。
 *   - **只拦预缓存清单里的那 62 个文件**（PRECACHE_SET 同步判断）；
 *     其余同源请求（地图/作物图片、世界杯、任何新文件）一律同步 return，
 *     交给浏览器原生处理。Cache Storage 因此稳定在这 62 个文件，不再随按需缓存长大。
 *   - 清单内：**缓存优先**，命中即刻返回，绝不等网络（2026-08-12 实测：
 *     上一版「在线优先+超时」的超时只管响应头不管内容体，手机弱网
 *     「连上了但爬不动」时会把卡死的流交给页面，缓存形同虚设）。
 *   - 清单内但缓存意外丢失 → **有界**网络（fetchBounded 8 秒真 abort）；
 *     失败时导航兜底 app shell。绝不无限期等待。
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
const CACHE_VERSION = 'ef-2608211635';
const CACHE = 'eastern-farm-' + CACHE_VERSION;
// Precache the FULL app shell — HTML + CSS + every JS module + data JSON — so a SW
// update (which clears the old cache) followed by a flaky mobile network can never leave
// the game unable to load (the old SW only precached HTML/CSS, so the JS could vanish →
// stuck-can't-enter). Images stay network-first/on-demand (the game degrades gracefully
// without them). Cached individually below so one missing file can't block the rest.
const PRECACHE = [
  '/',                       // root redirect page — cached so a navigation fallback to "/" keeps correct relative paths
  '/fix.html',               // 🔒 急救页必须预缓存：它是"别的都打不开时"的出路，自己绝不能依赖网络
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
  '/src/js/seasons.js', '/src/js/harvest-status.js', '/src/js/warehouse.js', '/src/js/stall.js', '/src/js/life-story.js', '/src/js/orders.js',
  '/src/js/kitchen.js',
  '/src/js/shop.js', '/src/js/tasks.js', '/src/js/events.js', '/src/js/storekeeper.js',
  '/src/js/rewards.js', '/src/js/store-rewards.js', '/src/js/achievements.js', '/src/js/tutorial.js', '/src/js/guide.js', '/src/js/feedback.js',
  '/src/js/spotlight.js', '/src/js/login-nudge.js', '/src/js/promo.js', '/src/js/share.js',
  '/src/js/music.js', '/src/js/pathfind.js', '/src/js/farmer.js', '/src/js/mapview-iso.js', '/src/js/main.js', '/src/js/pwa-install.js',
  '/data/achievements.json', '/data/ai-neighbors.json', '/data/coupons.json', '/data/crops.json',
  '/data/ep-shop.json', '/data/events.json', '/data/i18n.json', '/data/news.json', '/data/tasks.json',
  '/data/recipes.json', '/data/chapters.json',
];
// 2026-08-11 世界杯退场：worldcup.html / worldcup.css / worldcup.js / wc2026.json
// 一并移出预缓存。四个文件仍在仓库里、worldcup.html 直链仍可打开（联网时正常走
// 网络加载），只是不再让每个玩家在装 PWA 时先下载一份赛事资料。

/* 🔒 同步可查的预缓存清单（2026-08-13）——「拦不拦截」必须是**同步**判断。
   `respondWith()` 只能在 fetch 处理器执行期间同步调用；一旦先 `await` 去查缓存，
   就已经接管了这个请求，之后即使没命中也只能自己想办法给出响应 —— 而历史上
   「自己想办法」就是 `await fetch(req)` 无超时，也就是**能永久挂住页面**。
   有了这个 Set，不在清单里的东西可以同步 `return`，彻底交还浏览器。 */
const PRECACHE_SET = new Set(PRECACHE);

/* 有界的网络取用：给 fetch 装上真正的中止闸。
   ⚠️ 单纯 Promise.race 是不够的 —— `fetch()` 在**响应头**到达时就 resolve，
   race 赢了不代表内容体下完了，卡住的流照样会交给页面（2026-08-12 实测教训）。
   所以这里用 AbortController **真的把它掐掉**，让上层拿到一个明确的失败，
   而不是一个永远读不完的 body。 */
function fetchBounded(req, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(); } catch (e) {} }, ms);
  return fetch(req, { signal: ac.signal }).then(
    (res) => { clearTimeout(timer); return res; },
    (err) => { clearTimeout(timer); throw err; }
  );
}

/* 🔒 预缓存必须绕开浏览器 HTTP 缓存（2026-08-15 根因修复，别改回 cache.add(u)）
   ---------------------------------------------------------------------------
   Chris 2026-08-15：「刷新了页面宠物还是巨大」。线上文件明明是新的、SW 版本号也
   是新的，他刷新多少次都是旧代码。

   根因：`cache.add(url)` **走浏览器的 HTTP 缓存**。GitHub Pages 对所有静态文件发
   `Cache-Control: max-age=600`，于是新版 SW 安装时拿到的是**上一版的文件**，把它们
   装进了**新版本号的缓存**里，然后缓存优先地一直发下去。
     缓存名 eastern-farm-ef-2608150722 ← 新
     里面的 mapview-iso.js            ← 旧
   刷新完全救不了：陈旧的东西就在缓存里面，刷新只是再从同一份缓存拿一遍。
   而版本信标看到「线上版本 ≠ 本页版本」只会 reload，reload 又回到同一份脏缓存，
   一次性防循环闸随即永久压住自愈 → 玩家被钉死在旧代码上，直到下一次部署。

   `cache: 'reload'` 让每一项都真的走网络。回归测试
   `scripts/verify/sw-update-test.mjs` 用一台发 max-age=600 的本地服务器复现了
   整个场景（改之前必红、改之后转绿）。 */
function precacheAll() {
  return caches.open(CACHE).then((cache) => Promise.all(PRECACHE.map((u) => {
    let req;
    try { req = new Request(u, { cache: 'reload' }); } catch (e) { req = u; }   // 老浏览器兜底
    // 逐项 catch：某一个文件缺失/失败不该让整包预缓存夭折
    return cache.add(req).catch(() => cache.add(u).catch(() => {}));
  }))).catch(() => {});
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAll().then(() => self.skipWaiting()));
});

/* 页面发现「本页版本 ≠ 线上版本」时的自愈通道（见 index.html 新鲜度守卫）。
   只 reload 救不了脏缓存 —— 必须让 SW 用 cache:'reload' 重新抓一遍，
   否则页面重新加载时那些子资源仍可能命中同一份陈旧的 HTTP 缓存。 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'refresh-precache') return;
  event.waitUntil(precacheAll().then(() => {
    try { if (event.source && event.source.postMessage) event.source.postMessage({ type: 'precache-refreshed' }); } catch (e) {}
  }));
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
  /* ⚠️ 急救页 /fix.html 一定要走下面的**缓存优先**，绝不能在这里 return 放行网络。
     2026-08-12 我第一版就是写成「永远走网络」，理由听起来很对（"不能被旧缓存困住"），
     实测直接打脸：同样的卡流条件下，农场秒开、**急救页自己空白卡死** ——
     它在唯一需要它的场景里必然失效，等于不存在。
     🔒 对救命路径而言「打得开」压倒「是最新的」。它随每次部署整包预缓存更新，
     而它要做的事（注销 SW + 清缓存）本来也不依赖是不是最新版。 */

  /* 🔒 只管预缓存清单里的那 62 个文件，别的一律**同步 return**（2026-08-13）。
     ------------------------------------------------------------------------
     改之前是「同源 GET 全都拦，没命中就 `await fetch(req)`」——那个 fetch **没有
     超时**，而它包在 respondWith 里，所以手机弱网「连上了、数据爬不动」时
     respondWith 永不 resolve = **页面被无限期挂住**。同一类错在后台
     (StockWise PR #88) 已经修过一次，后台由此定规「导航一律不拦截」。

     ⚠️ 这个坑最阴的地方：它连**急救页自己**都能挡住。/fix.html 存在的意义就是
     「别的都打不开时」，而它跟别的资源走同一条 respondWith —— 要救人的和被救的
     困在同一个坑里。急救出口能被它要救的东西挡住，这个设计本身就是错的。

     现在的不变量：**SW 只从缓存回答，从不代替浏览器上网。**
       - 不在清单里（地图/作物图片、世界杯、任何新文件）→ 同步 return，
         浏览器原生处理（有它自己的超时、重试、HTTP 缓存）。顺带好处：
         Cache Storage 不再随按需缓存无限增长，稳定在这 62 个文件。
       - 在清单里 → 缓存优先；万一缓存被系统清了，才走**有界**网络（8 秒真中止）。
     这样能被我们挂住的窗口只剩「清单内文件且缓存恰好丢失」，且有硬上界。 */
  if (!PRECACHE_SET.has(url.pathname)) return;

  event.respondWith((async () => {
    // 缓存优先：命中即刻返回。ignoreSearch 让 ?fresh= / ?v= 之类的查询串也能命中
    // （本站静态资源不靠查询串区分版本，版本由 CACHE_VERSION 整包管理）。
    try {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
    } catch (e) { /* 缓存不可用就走下面的有界网络 */ }

    // 走到这里说明缓存里本该有却没有（被系统清了 / 预缓存那一项失败过）。
    // 🔒 必须有界：宁可给一个明确的失败让人重试，也绝不无限期挂着。
    try {
      const res = await fetchBounded(req, 8000);
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (e) {
      // 离线/超时且未缓存：导航兜底到 app shell，让游戏至少打得开
      if (req.mode === 'navigate') {
        const shell = (await caches.match('/src/index.html')) || (await caches.match('/'));
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
