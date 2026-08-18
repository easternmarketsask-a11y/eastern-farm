/**
 * analytics.js — privacy-safe anonymous funnel counter (Farm.track)
 *
 * Goal: see the REAL guest→login funnel (the backend only sees logged-in
 * members; guests are otherwise invisible). This pings StockWise's public
 * counter endpoint — NO personal info, just "event X happened once more".
 * Backend whitelists the event names and increments farm_analytics/{date};
 * the StockWise 游戏管理 panel renders the funnel.
 *
 *   Farm.track('open')   fire-and-forget; never throws, never blocks gameplay.
 *
 * Only a fixed set of events is accepted server-side (open / open_guest /
 * login / plant_first / harvest_first / sell_first / spotlight_done /
 * spotlight_skip / login_nudge_shown / login_nudge_accept).
 */
(function () {
  const STOCKWISE_BASE = 'https://stockwise-app-873982544406.us-central1.run.app';

  function track(event) {
    try {
      var body = { event: event };
      // 🏠 店主自己那台设备（?owner=1 设过）不进客人计数，后端记 owner_hits
      if (window.__efIsOwnerDevice) body.owner = true;
      /* 👥 访客 id 由 index.html 的 <head> 内联段生成（那段跑得最早，
         open_attempt 就靠它发）。这里只**复用**，不自己再造一个 ——
         两处各生成一次的话，同一个人会被数成两个。 */
      else if (window.__efVisitorId) body.visitor = window.__efVisitorId;
      fetch(STOCKWISE_BASE + '/api/public/game-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,   // survive page unload (e.g. tracking on close)
      }).catch(function () {});
    } catch (_) { /* analytics must never break gameplay */ }
  }

  /* 一次页面加载只发一次的事件用这个（2026-08-17 加）。

     🔴 起因：open_guest 一直在**双发**。boot 在 ~100ms 跑到 main.js 的兜底
     （那时 Firebase SDK 还没到，被判成"离线→访客"），~300ms SDK 落地后
     firebase-auth 的 onAuthStateChanged 又记一次。后台「其中访客」因此比
     「成功进入」还多（8/17 实测 191 vs 132），而访客本该是进入的子集。

     这个双发是 2026-08-12 加载改造的副作用：在那之前 SDK 是 <script defer>
     同步加载的，boot 跑到那行时它早就在了，兜底根本不会命中。改成动态晚加载
     之后，兜底几乎每次都先开火 —— 没人发现，因为埋点坏了不会报错。

     🔒 凡是「一次加载最多算一次」的事件，一律走 trackOnce，别用 track。 */
  var _once = {};
  function trackOnce(event) {
    if (_once[event]) return;
    _once[event] = true;
    track(event);
  }

  window.Farm = window.Farm || {};
  Farm.track = track;
  Farm.trackOnce = trackOnce;
})();
