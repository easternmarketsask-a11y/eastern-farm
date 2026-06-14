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
      fetch(STOCKWISE_BASE + '/api/public/game-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: event }),
        keepalive: true,   // survive page unload (e.g. tracking on close)
      }).catch(function () {});
    } catch (_) { /* analytics must never break gameplay */ }
  }

  window.Farm = window.Farm || {};
  Farm.track = track;
})();
