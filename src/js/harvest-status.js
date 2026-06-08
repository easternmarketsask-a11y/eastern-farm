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
        textEl.textContent = Farm.i18n.t('harvest_status_ready', { n: matureCount });
        btnEl.textContent = '🌾 ' + Farm.i18n.t('harvest_status_btn_all');
        btnEl.classList.remove('hidden');
        btnEl.onclick = () => this.harvestAll();
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
      for (let idx = 0; idx < plots.length; idx++) {
        const plot = plots[idx];
        if (!plot.unlocked || !plot.crop) continue;
        if (!Farm.crops.isMature(plot)) continue;
        if (Farm.state.isWarehouseFull()) break; // harvestPlot would surface the dialog anyway, but stop the loop cleanly
        Farm.farm.harvestPlot(idx);
      }
      this.render();
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.harvestStatus = harvestStatus;
})();
