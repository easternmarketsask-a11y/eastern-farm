(function () {
  'use strict';
  var KEY = 'em_games_recent_v1';
  var routes = {
    farm: { path: '/src/index.html', label: '继续经营 · Continue your farm' },
    table: { path: '/src/dinner.html', label: '继续摆桌 · Continue your table' }
  };
  function route(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(routes, id) ? routes[id] : null; }
  function init() {
    var game = document.body.dataset.game;
    var current = route(game);
    if (current) {
      try { localStorage.setItem(KEY, JSON.stringify({ id: game, path: current.path, at: Date.now() })); }
      catch (_) { /* Storage restrictions must never stop a game. */ }
    }
    var resume = document.querySelector('[data-resume-game]');
    if (resume) {
      try {
        var last = JSON.parse(localStorage.getItem(KEY));
        var known = last && route(last.id);
        if (known && last.path === known.path) {
          resume.href = known.path;
          resume.querySelector('[data-resume-label]').textContent = known.label;
          resume.hidden = false;
        }
      } catch (_) { /* No recent game is normal for first visits. */ }
    }
    document.querySelectorAll('[data-cover]').forEach(function (img) {
      function fallback() { img.hidden = true; if (img.parentElement) img.parentElement.classList.add('cover-unavailable'); }
      img.addEventListener('error', fallback, { once: true });
      if (img.complete && !img.naturalWidth) fallback();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
