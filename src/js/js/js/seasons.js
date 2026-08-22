/* seasons.js — auto seasonal skin for the farm (Farm.seasons).
 *
 * Repaints the farm scene by season (spring/summer/autumn/winter) and overlays
 * gentle falling particles (petals / butterflies / leaves / snow). Season is
 * derived from the local month (Saskatoon). The CSS palettes live in style.css
 * under #farm.season-*. Call Farm.seasons.apply() on boot.
 *
 * Manual override (for fun / preview): Farm.seasons.apply('winter').
 */
(function () {
  const ORDER = ['spring', 'summer', 'autumn', 'winter'];
  const PARTICLES = {
    spring: ['🌸', '🌸', '🌷'],
    summer: ['🦋', '🦋', '🐝'],
    autumn: ['🍂', '🍁', '🍂'],
    winter: ['❄️', '❄️', '🌨'],
  };

  function monthSeason() {
    const ds = Farm.state.getDateString();        // YYYY-MM-DD (local)
    const m = parseInt(ds.slice(5, 7), 10) || 1;
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    if (m >= 9 && m <= 11) return 'autumn';
    return 'winter';
  }

  const seasons = {
    current: null,

    apply(forced) {
      const farm = document.getElementById('farm');
      if (!farm) return;
      const s = (forced && PARTICLES[forced]) ? forced : monthSeason();
      this.current = s;
      ORDER.forEach((k) => farm.classList.remove('season-' + k));
      farm.classList.add('season-' + s);

      // Falling-particle overlay (pointer-events:none so it never blocks taps).
      let layer = document.getElementById('seasonParticles');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'seasonParticles';
        layer.className = 'season-particles';
        farm.appendChild(layer);
      }
      layer.innerHTML = '';
      const set = PARTICLES[s] || [];
      const N = 11;
      for (let i = 0; i < N; i++) {
        const sp = document.createElement('span');
        sp.className = 'season-particle';
        sp.textContent = set[i % set.length];
        sp.style.left = ((i * 8.7 + 4) % 94) + '%';
        sp.style.animationDelay = (i * 0.8).toFixed(1) + 's';
        sp.style.animationDuration = (7 + (i % 5)) + 's';
        sp.style.fontSize = (13 + (i % 3) * 5) + 'px';
        layer.appendChild(sp);
      }
    },
  };

  window.Farm = window.Farm || {};
  Farm.seasons = seasons;
})();
