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
    _baseOrders: 0,
    _tick: null,
    _el: null,
    _scrolled2: false,

    maybeStart() {
      const d = Farm.state.data;
      if (!d || d.spotlightDone) return;
      // iso（现在是唯一视图）自 2026-07-02 起支持：isoView.plotScreenRect/
      // barnScreenRect 提供 canvas 上的目标矩形。没有这两个 API 就没法给聚光灯
      // 定位 → 跳过引导（留给 guide 弹窗兜底）。
      // （2026-08-11：原来还要挡一下 topdown 像素视图，那套渲染器已删。）
      if (Farm.isoView && Farm.isoView._on && !Farm.isoView.plotScreenRect) return;
      // 「毕业」判定放宽（audit P1 引导中断不恢复 2026-07-07）：旧守卫用
      // cropsEverGrown>0 会把「种过但半途刷新」的玩家静默标记完成——引导
      // 后半段（收/卖）永远缺课。改为「已有变现记录」才算走完闭环；种过
      // 没卖过的半途玩家由 start() 的断点续接接回对应步骤。
      if ((d.totalDeliveries || 0) > 0 || (d.totalOrdersFilled || 0) > 0) {
        d.spotlightDone = true; Farm.state.save(); return;
      }
      if (this._active) return;
      // 第 0 步需要一块空地可种；续接场景（地里已有菜 / 仓库已有货）不需要。
      const hasCrop = (d.plots || []).some(p => p && p.crop);
      const hasStock = (d.warehouse || []).length > 0;
      if (!hasCrop && !hasStock && firstEmptyPlotIdx() < 0) return;
      this.start();
    },

    start() {
      const d = Farm.state.data;
      this._active = true;
      this._scrolled2 = false;
      this._baseHarvests = d.totalHarvests || 0;
      this._baseDeliveries = d.totalDeliveries || 0;
      this._baseOrders = d.totalOrdersFilled || 0;
      // 断点续接（audit P1 2026-07-07）：刷新/关页打断后按实际进度落到对应
      // 步骤，而不是永远从第 0 步重来。仓库有货 → 直接教卖（step 2）；地里
      // 有菜 → 教收（step 1，与首棵一致魔法速熟，别让续接的人干等）。
      const grownIdx = (d.plots || []).findIndex(p => p && p.unlocked && p.crop);
      if ((d.warehouse || []).length > 0) {
        this._step = 2;
        this._targetIdx = grownIdx;   // step 2 的目标是谷仓，此值不参与定位
      } else if (grownIdx >= 0) {
        this._step = 1;
        this._targetIdx = grownIdx;
        forceMature(grownIdx);
      } else {
        this._step = 0;
        this._targetIdx = firstEmptyPlotIdx();
      }
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
        : '已成熟。点一下收入谷仓。';
      /* 🔒 2026-08-22：谷仓不再收菜，第三步改成「把菜交给东超」。
         这一步靠 totalDeliveries 变大推进，而那个计数已经搬到订单交付上
         （orders.fulfill），所以推进条件不用改。
         新手第一次收获只有一棵也交得掉：每日基础补货里必有一样是玩家
         手上最多的菜（store-demand.makeStaples），不会卡在这一步。 */
      return en
        ? 'Tap Eastern Market to hand your crop over and get coins.'
        : '点东超，把菜交给它换农场币。';
    },

    // 目标屏幕矩形 {left, top, width, height} —— classic 视图查 DOM，
    // iso 视图问 isoView 的坐标 API。返回 null = 暂无目标（气泡居中显示）。
    _targetRect() {
      const iso = Farm.isoView && Farm.isoView._on;
      if (this._step === 0 || this._step === 1) {
        if (iso) return Farm.isoView.plotScreenRect(this._targetIdx);
        const el = document.querySelector('.plot[data-plot-id="' + this._targetIdx + '"]');
        return el ? el.getBoundingClientRect() : null;
      }
      if (iso) return Farm.isoView.barnScreenRect ? Farm.isoView.barnScreenRect() : null;
      const el = document.querySelector('.warehouse-img');
      return el ? el.getBoundingClientRect() : null;
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
          this._baseOrders = d.totalOrdersFilled || 0;
        }
      } else if (this._step === 2) {
        // 完成条件同时接受「一键卖货」与「交东超订单」（audit P0 引导死锁）：
        // 玩家照 all_reserved toast 的建议去交订单也算学会了变现，不再卡死。
        if ((d.totalDeliveries || 0) > this._baseDeliveries ||
            (d.totalOrdersFilled || 0) > this._baseOrders) {
          this.finish();
          return;
        }
        // The barn sits at the bottom of the farm — usually below the fold.
        // Scroll it into view once so the spotlight isn't pointing off-screen.
        // (classic 视图专用；iso 是全屏 canvas 无滚动，谷仓由相机取景保证在画面里)
        if (!this._scrolled2 && !modalOpen() && !(Farm.isoView && Farm.isoView._on)) {
          const barn = document.querySelector('.warehouse-img');
          if (barn) { barn.scrollIntoView({ block: 'center', behavior: 'smooth' }); this._scrolled2 = true; }
        }
      }

      // While a modal is open, get out of the way entirely.
      if (modalOpen()) { this._el.style.display = 'none'; return; }
      this._el.style.display = 'block';

      let r = this._targetRect();
      // iso 相机可能把目标平移出视口——目标中心在屏幕外时退回居中气泡，
      // 免得聚光洞指向看不见的地方。
      if (r) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) r = null;
      }
      const hole = document.getElementById('slHole');
      const bubble = document.getElementById('slBubble');
      const bubbleText = document.getElementById('slBubbleText');
      const arrow = document.getElementById('slArrow');
      bubbleText.textContent = this._stepCopy();

      if (!r) {
        // Target not on screen yet — show bubble centered, no hole.
        hole.style.display = 'none';
        arrow.style.display = 'none';
        bubble.style.left = '50%';
        bubble.style.top = '50%';
        bubble.style.transform = 'translate(-50%, -50%)';
        return;
      }

      r = { left: r.left, top: r.top, width: r.width, height: r.height,
            right: r.left + r.width, bottom: r.top + r.height };
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
        : '种、收、卖。+50 农场币', 3200);
      if (Farm.ui.showConfetti) Farm.ui.showConfetti(36, 2400);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.spotlight = spotlight;
})();
