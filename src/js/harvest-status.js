/**
 * harvest-status.js — Home-screen "when are my crops ready" status bar.
 *
 * Three states:
 *   1. Some plots mature        → "🌾 N 棵已熟可收" + Harvest All button
 *   2. None mature, some growing → "⏳ 下一批 X 后成熟" (earliest remaining time)
 *   3. Nothing planted at all    → "🌱 地都空着，种点什么吧"
 *
 * Reuses Farm.farm.harvestPlot() for the actual harvest logic (single source
 * of truth — this module only orchestrates looping + UI).
 */
(function() {
  const harvestStatus = {

    // Compute current state from plots and update the DOM.
    render() {
      const textEl = document.getElementById('harvestStatusText');
      const btnEl = document.getElementById('harvestStatusBtn');
      if (!textEl || !btnEl) return;

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
          // Silo full: don't pretend "全收" will work — say why, and turn the
          // button into the fix (sell / expand).
          const lang = Farm.state.data.language;
          textEl.textContent = (lang === 'en'
            ? '📦 Silo full · ' + matureCount + ' crops waiting'
            : '📦 仓库满了 · ' + matureCount + ' 棵等着收');
          btnEl.textContent = (lang === 'en' ? '🏪 Sell / expand' : '🏪 卖货 / 扩容');
          btnEl.classList.remove('hidden');
          btnEl.onclick = () => {
            if (Farm.warehouse && Farm.warehouse.openFullDialog) Farm.warehouse.openFullDialog();
          };
        } else {
          textEl.textContent = Farm.i18n.t('harvest_status_ready', { n: matureCount });
          btnEl.textContent = '🌾 ' + Farm.i18n.t('harvest_status_btn_all');
          btnEl.classList.remove('hidden');
          btnEl.onclick = () => this.harvestAll();
        }
      } else if (earliestRemaining !== null) {
        textEl.textContent = Farm.i18n.t('harvest_status_growing', {
          time: Farm.crops.formatTimeRemaining(earliestRemaining),
        });
        btnEl.classList.add('hidden');
        btnEl.onclick = null;
      } else {
        textEl.textContent = Farm.i18n.t('harvest_status_empty');
        btnEl.classList.add('hidden');
        btnEl.onclick = null;
      }
    },

    // Harvest every mature plot by reusing farm.js's single-plot harvest
    // entry point (Farm.farm.harvestPlot). Stops as soon as the warehouse
    // is full — harvestPlot() itself surfaces the "warehouse full" dialog
    // via Farm.crops.harvest()'s warehouse_full result, so nothing is lost.
    harvestAll() {
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
        Farm.farm.harvestPlot(idx);
        picked++;
      }

      // If the silo blocked us (already full, or filled mid-sweep with crops
      // still standing), surface the sell/expand dialog instead of doing
      // nothing. Defer slightly so any picked-crop celebration shows first.
      if (blockedByFull) {
        if (Farm.audio) Farm.audio.play('error');
        if (Farm.warehouse && Farm.warehouse.openFullDialog) {
          setTimeout(() => Farm.warehouse.openFullDialog(), picked >= 1 ? 600 : 0);
        }
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
