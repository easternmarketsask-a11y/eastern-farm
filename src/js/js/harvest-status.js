/**
 * harvest-status.js — Home-screen "when are my crops ready" status bar.
 *
 * Three states:
 *   1. Some plots mature        → "🌾 N 棵已熟可收" + Harvest All button
 *   2. None mature, some growing → "⏳ 下一批 X 后成熟" (earliest remaining time)
 *   3. Nothing planted at all    → "🌱 地都空着，种点什么吧"
 *
 * Iso 农场：点胶囊走农户排队摘（enqueueHarvestAll），摘完才进仓。
 * 其它视图仍直接循环 Farm.farm.harvestPlot()。
 */
(function() {
  const harvestStatus = {

    // Compute current state from plots and update the DOM. The center status
    // pill IS the action now (no separate clunky "全收" button): when crops are
    // ready, tapping the pill harvests all; when the silo is full, it opens the
    // sell/expand dialog; while growing/empty it's just a label.
    render() {
      const textEl = document.getElementById('harvestStatusText');
      const centerEl = document.getElementById('harvestStatusCenter');
      const btnEl = document.getElementById('harvestStatusBtn');
      if (!textEl || !centerEl) return;
      if (btnEl) btnEl.classList.add('hidden');  // retired in favour of tappable pill
      const lang = Farm.state.data.language;

      // Set the pill's clickable state + visual variant in one place.
      const setAction = (handler, variant) => {
        centerEl.onclick = handler || null;
        centerEl.classList.toggle('is-actionable', !!handler);
        centerEl.classList.toggle('is-warning', variant === 'warning');
      };

      const plots = (Farm.state.data.plots || []).filter(p => p.unlocked && p.crop);
      let matureCount = 0;
      let earliestRemaining = null;
      plots.forEach(plot => {
        if (Farm.crops.isMature(plot)) {
          matureCount++;
        } else {
          const remaining = Farm.crops.timeRemaining(plot);
          if (earliestRemaining === null || remaining < earliestRemaining) {
            earliestRemaining = remaining;
          }
        }
      });

      if (matureCount > 0) {
        const full = Farm.state.isWarehouseFull && Farm.state.isWarehouseFull();
        if (full) {
          // Silo full → tapping the pill opens the sell/expand dialog.
          textEl.textContent = (lang === 'en'
            ? '📦 Barn full · ' + matureCount + ' waiting · sell'
            : '📦 谷仓满了 · ' + matureCount + ' 棵 · 去卖货');
          setAction(() => {
            if (Farm.warehouse && Farm.warehouse.openFullDialog) Farm.warehouse.openFullDialog();
          }, 'warning');
        } else {
          // Ready → tapping the pill harvests everything.
          textEl.textContent = Farm.i18n.t('harvest_status_ready', { n: matureCount });
          setAction(() => this.harvestAll(), 'ready');
        }
      } else if (earliestRemaining !== null) {
        if (this._signHintDue()) {
          this._renderSignHint(textEl, setAction, lang);
        } else {
          textEl.textContent = Farm.i18n.t('harvest_status_growing', {
            time: Farm.crops.formatTimeRemaining(earliestRemaining),
          });
          setAction(null);
        }
      } else {
        if (this._signHintDue()) {
          this._renderSignHint(textEl, setAction, lang);
        } else {
          textEl.textContent = Farm.i18n.t('harvest_status_empty');
          setAction(null);
        }
      }
    },

    // 未签到时，growing/empty 空闲态与原文案 20 秒轮播签到提示（签到自动弹窗
    // 已禁用、入口深四层——借首屏常驻胶囊做二级入口，点击直达签到日历）。
    // 有熟菜可收时绝不抢位：收获永远是第一优先动作。
    _signHintDue() {
      try {
        const cal = Farm.state.data.loginCalendar || {};
        if (cal.lastSignDate === Farm.state.getDateString()) return false;
        if (!Farm.loginCalendar || !Farm.loginCalendar.open) return false;
        return Math.floor(Date.now() / 20000) % 2 === 1;   // 20s 轮播相位
      } catch (_) { return false; }
    },

    _renderSignHint(textEl, setAction, lang) {
      // Kept short so the pill stays one line on 360px (audit B3 P1); the
      // tappable pill already draws a › chevron, so no trailing arrow here.
      textEl.textContent = (lang === 'en'
        ? '📅 Check-in gift'
        : '📅 签到领奖励');
      setAction(() => {
        if (Farm.audio) Farm.audio.play('tap');
        Farm.loginCalendar.open();
      }, 'ready');
    },

    // Harvest every mature plot by reusing farm.js's single-plot harvest
    // entry point (Farm.farm.harvestPlot). Stops as soon as the warehouse
    // is full — a light "silo full" toast is shown below (the sell/expand
    // decision modal stays behind the status pill's「去卖货」action).
    harvestAll() {
      if (Farm.isoView && Farm.isoView.active && Farm.isoView.active()
          && Farm.farmer && Farm.farmer.enqueueHarvestAll) {
        const iso = Farm.isoView;
        const plots = Farm.state.data.plots || [];
        let start = -1, best = Infinity;
        const a = Farm.farmer._actor && Farm.farmer._actor();
        const fx = (a && a.gx != null) ? a.gx : 0;
        const fy = (a && a.gy != null) ? a.gy : 0;
        for (let i = 0; i < plots.length; i++) {
          const p = plots[i];
          if (!p || !p.unlocked || !p.crop || !Farm.crops.isMature(p)) continue;
          const dx = iso._plotGX(i) - fx, dy = iso._plotGY(i) - fy;
          const d = dx * dx + dy * dy;
          if (start < 0 || d < best) { best = d; start = i; }
        }
        if (start >= 0) Farm.farmer.enqueueHarvestAll(start);
        if (Farm.audio) Farm.audio.play('tap');
        return;
      }
      const plots = Farm.state.data.plots;
      let picked = 0;
      let blockedByFull = false;
      for (let idx = 0; idx < plots.length; idx++) {
        const plot = plots[idx];
        if (!plot.unlocked || !plot.crop) continue;
        if (!Farm.crops.isMature(plot)) continue;
        // Warehouse full → stop and remember WHY, so we can tell the player.
        // (Previously this just `break`-ed silently, so tapping "全收" with a
        // full silo looked like a no-op / bug.)
        if (Farm.state.isWarehouseFull()) { blockedByFull = true; break; }
        // iso 视图下给 harvestPlot 传该地块的屏幕矩形（audit B2 P2：一键全收的
        // 采摘粒子全部错位在 (0,0)——批量路径没有 evt，farm.js 只能拿隐藏 DOM
        // 地块的 0×0 rect 兜底）。plotScreenRect 已含相机/缩放；DOM 视图下返回
        // null，走原路径不受影响。
        let evt;
        if (Farm.isoView && Farm.isoView.plotScreenRect) {
          const rc = Farm.isoView.plotScreenRect(idx);
          if (rc) evt = { target: { getBoundingClientRect: () => rc } };
        }
        Farm.farm.harvestPlot(idx, evt);
        picked++;
      }

      // If the silo blocked us (already full, or filled mid-sweep with crops
      // still standing), tell the player with a light toast instead of a
      // modal（UX 第 3 批 #10：收获路径的仓满是高频阻断，不打断）。谷仓
      // 头顶红点（第 2 批）+ 本胶囊随即切到「仓库满了·去卖货」态，点它才
      // 打开需要决策的卖货/扩建 modal。Defer slightly so any picked-crop
      // celebration shows first.
      if (blockedByFull) {
        if (Farm.audio) Farm.audio.play('error');
        const langFull = Farm.state.data.language;
        setTimeout(() => {
          Farm.ui.toast(langFull === 'en'
            ? '📦 Barn full — tap it to sell & free up space'
            : '📦 谷仓满了，点谷仓卖货腾空间', 3000);
        }, picked >= 1 ? 600 : 0);
      }
      // Bumper-harvest celebration: summary float + golden coin rain + sound,
      // scaled by how many plots were picked so a big sweep feels like a big
      // payoff.
      if (picked >= 1) {
        const lang = Farm.state.data.language;
        Farm.ui.floatText('🌾 ' + (lang === 'en' ? 'Bumper harvest ×' : '丰收 ×') + picked,
          window.innerWidth / 2 - 40, 130, '#c44536');
        if (Farm.ui.coinBurst) Farm.ui.coinBurst(picked >= 6 ? 3 : picked >= 3 ? 2 : 1);
        if (Farm.audio) {
          Farm.audio.play('harvest');
          // a quick coin flourish; more coins for bigger sweeps
          const chimes = Math.min(3, Math.ceil(picked / 2));
          for (let c = 0; c < chimes; c++) {
            setTimeout(() => Farm.audio.play('coin'), 120 + c * 110);
          }
          if (picked >= 6) setTimeout(() => Farm.audio.play('achievement'), 460);
        }
      }
      this.render();
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.harvestStatus = harvestStatus;
})();
