/**
 * spotlight.js — Hand-held first-session onboarding (Farm.spotlight)
 *
 * The welcome tutorial sets expectations and the coach teaches single rules,
 * but neither walks a brand-new player THROUGH the core loop. A curious person
 * who opens the game and doesn't complete a harvest in the first minute usually
 * never comes back. This fixes that: a dimmed overlay with a spotlight "hole"
 * over the exact thing to tap, an arrow, and one line of text — guiding the
 * player through plant → harvest → sell in ~60 seconds.
 *
 * Key trick (borrowed from Hay Day): the FIRST crop matures INSTANTLY so the
 * player experiences the whole loop now, not "come back in 30 minutes".
 *
 * State-driven, not modal-hooked: each step advances when the relevant game
 * STATE changes (plot gets a crop / totalHarvests++ / totalDeliveries++), so it
 * never breaks when a modal's internal markup changes. While any modal is open
 * the overlay hides itself and lets the player interact normally.
 *
 *   Farm.spotlight.maybeStart()  → start if first-timer and not done/skipped
 */
(function() {
  const L = () => (Farm.state.data.language === 'en' ? 'en' : 'zh');

  function firstEmptyPlotIdx() {
    const plots = Farm.state.data.plots || [];
    for (let i = 0; i < plots.length; i++) {
      if (plots[i] && plots[i].unlocked && !plots[i].crop) return i;
    }
    return -1;
  }

  function modalOpen() {
    const m = document.getElementById('modal');
    return m && !m.classList.contains('hidden');
  }

  // Force the onboarding crop to be ripe right now (plantedAt back in time),
  // mirroring the acceleration-ticket logic in farm.js openPlotCare.
  function forceMature(idx) {
    const plot = Farm.state.data.plots[idx];
    if (!plot || !plot.crop) return;
    const def = Farm.crops.get(plot.crop);
    if (!def) return;
    plot.plantedAt = Date.now() - def.grow_minutes * 60000 - 1000;
    plot.watered = false;
    Farm.state.save();
    if (Farm.farm && Farm.farm.renderGrid) Farm.farm.renderGrid();
    if (Farm.harvestStatus) Farm.harvestStatus.render();
  }

  const spotlight = {
    _active: false,
    _step: 0,            // 0 plant · 1 harvest · 2 sell
    _targetIdx: -1,
    _baseHarvests: 0,
    _baseDeliveries: 0,
    _tick: null,
    _el: null,
    _scrolled2: false,

    maybeStart() {
      const d = Farm.state.data;
      if (!d || d.spotlightDone) return;
      // Only for genuine newcomers — never grown anything yet.
      if ((d.cropsEverGrown || []).length > 0) { d.spotlightDone = true; Farm.state.save(); return; }
      if (this._active) return;
      // Need at least one empty plot to plant into.
      if (firstEmptyPlotIdx() < 0) return;
      this.start();
    },

    start() {
      this._active = true;
      this._step = 0;
      this._scrolled2 = false;
      this._targetIdx = firstEmptyPlotIdx();
      this._baseHarvests = Farm.state.data.totalHarvests || 0;
      this._baseDeliveries = Farm.state.data.totalDeliveries || 0;
      this._build();
      // Tick drives positioning + advancement. 200ms feels responsive without
      // thrashing layout.
      this._tick = setInterval(() => this._update(), 200);
      this._update();
    },

    _build() {
      let el = document.getElementById('spotlightOverlay');
      if (el) el.remove();
      el = document.createElement('div');
      el.id = 'spotlightOverlay';
      el.innerHTML = `
        <div class="sl-hole" id="slHole"></div>
        <div class="sl-bubble" id="slBubble">
          <div class="sl-bubble-text" id="slBubbleText"></div>
          <button class="sl-skip" id="slSkip"></button>
        </div>
        <div class="sl-arrow" id="slArrow">👆</div>
      `;
      document.body.appendChild(el);
      this._el = el;
      const skip = document.getElementById('slSkip');
      skip.textContent = L() === 'en' ? 'Skip' : '跳过引导';
      skip.onclick = (e) => { e.stopPropagation(); this.skip(); };
    },

    _stepCopy() {
      const en = L() === 'en';
      if (this._step === 0) return en
        ? 'Tap this glowing plot to plant your first crop.'
        : '点这块发光的地，种下第一棵菜。';
      if (this._step === 1) return en
        ? 'It\'s ripe! Tap to harvest it into your barn.'
        : '熟啦！点一下收进谷仓。';
      return en
        ? 'Tap the barn to sell your crop to Eastern Market for coins.'
        : '点谷仓，把菜卖给东方超市换农场币。';
    },

    _targetEl() {
      if (this._step === 0 || this._step === 1) {
        return document.querySelector('.plot[data-plot-id="' + this._targetIdx + '"]');
      }
      return document.querySelector('.warehouse-img');
    },

    _update() {
      if (!this._active) return;
      const d = Farm.state.data;

      // Advance on state change (independent of overlay visibility).
      if (this._step === 0) {
        // The overlay is click-through, so the player may plant in ANY plot, not
        // just the highlighted one. Advance on whichever plot got a crop, and
        // re-target the spotlight to it for the harvest step.
        let idx = (d.plots[this._targetIdx] && d.plots[this._targetIdx].crop) ? this._targetIdx : -1;
        if (idx < 0) {
          for (let i = 0; i < d.plots.length; i++) {
            if (d.plots[i] && d.plots[i].unlocked && d.plots[i].crop) { idx = i; break; }
          }
        }
        if (idx >= 0) {
          this._targetIdx = idx;
          // Planted! Magic-grow it instantly so the loop completes now.
          forceMature(idx);
          if (Farm.audio) Farm.audio.play('achievement');
          Farm.ui.toast(L() === 'en' ? '✨ Magic growth — instantly ripe!' : '✨ 魔法生长，瞬间长大！', 2200);
          this._step = 1;
          this._baseHarvests = d.totalHarvests || 0;
        }
      } else if (this._step === 1) {
        if ((d.totalHarvests || 0) > this._baseHarvests) {
          this._step = 2;
          this._baseDeliveries = d.totalDeliveries || 0;
        }
      } else if (this._step === 2) {
        if ((d.totalDeliveries || 0) > this._baseDeliveries) {
          this.finish();
          return;
        }
        // The barn sits at the bottom of the farm — usually below the fold.
        // Scroll it into view once so the spotlight isn't pointing off-screen.
        if (!this._scrolled2 && !modalOpen()) {
          const barn = document.querySelector('.warehouse-img');
          if (barn) { barn.scrollIntoView({ block: 'center', behavior: 'smooth' }); this._scrolled2 = true; }
        }
      }

      // While a modal is open, get out of the way entirely.
      if (modalOpen()) { this._el.style.display = 'none'; return; }
      this._el.style.display = 'block';

      const target = this._targetEl();
      const hole = document.getElementById('slHole');
      const bubble = document.getElementById('slBubble');
      const bubbleText = document.getElementById('slBubbleText');
      const arrow = document.getElementById('slArrow');
      bubbleText.textContent = this._stepCopy();

      if (!target) {
        // Target not on screen yet — show bubble centered, no hole.
        hole.style.display = 'none';
        arrow.style.display = 'none';
        bubble.style.left = '50%';
        bubble.style.top = '50%';
        bubble.style.transform = 'translate(-50%, -50%)';
        return;
      }

      const r = target.getBoundingClientRect();
      const pad = 8;
      hole.style.display = 'block';
      hole.style.left = (r.left - pad) + 'px';
      hole.style.top = (r.top - pad) + 'px';
      hole.style.width = (r.width + pad * 2) + 'px';
      hole.style.height = (r.height + pad * 2) + 'px';

      const vh = window.innerHeight;
      const below = r.bottom < vh * 0.62;   // place bubble below if room, else above
      bubble.style.transform = 'translateX(-50%)';
      bubble.style.left = Math.max(120, Math.min(window.innerWidth - 120, r.left + r.width / 2)) + 'px';
      if (below) {
        bubble.style.top = (r.bottom + 26) + 'px';
        arrow.style.top = (r.bottom + 2) + 'px';
        arrow.textContent = '👆';
      } else {
        bubble.style.top = (r.top - 24) + 'px';
        bubble.style.transform = 'translate(-50%, -100%)';
        arrow.style.top = (r.top - 30) + 'px';
        arrow.textContent = '👇';
      }
      arrow.style.display = 'block';
      arrow.style.left = (r.left + r.width / 2) + 'px';
    },

    _teardown() {
      this._active = false;
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
      if (this._el) { this._el.remove(); this._el = null; }
      Farm.state.data.spotlightDone = true;
      Farm.state.save();
    },

    skip() {
      if (Farm.track) Farm.track('spotlight_skip');
      this._teardown();
    },

    finish() {
      if (Farm.track) Farm.track('spotlight_done');
      this._teardown();
      // Small completion reward + warm close — instant gratification for
      // finishing the loop. (Login bonus + first-plant bonus are separate.)
      Farm.state.addCoins(50);
      if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      if (Farm.audio) Farm.audio.play('levelUp');
      Farm.ui.toast(L() === 'en'
        ? '🎉 You did it! Plant → Harvest → Sell. +50 coins'
        : '🎉 学会啦！种 → 收 → 卖，就这么简单。+50 农场币', 3600);
      if (Farm.ui.showConfetti) Farm.ui.showConfetti(36, 2400);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.spotlight = spotlight;
})();
