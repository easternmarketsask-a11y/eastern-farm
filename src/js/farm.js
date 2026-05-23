/**
 * farm.js — Farm grid rendering and plot interactions.
 */
(function() {
  const farm = {
    renderGrid() {
      const grid = document.getElementById('farmGrid');
      grid.innerHTML = '';
      Farm.state.data.plots.forEach((plot, idx) => {
        const el = this.createPlotElement(plot, idx);
        grid.appendChild(el);
      });
    },

    createPlotElement(plot, idx) {
      const el = document.createElement('div');
      el.className = 'plot';
      el.dataset.plotId = idx;

      if (!plot.unlocked) {
        el.classList.add('locked');
        const requiredLevels = { 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 4, 10: 5, 11: 5 };
        const lvl = requiredLevels[idx] || 2;
        const hint = document.createElement('div');
        hint.className = 'lock-hint';
        hint.textContent = 'Lv ' + lvl;
        el.appendChild(hint);
        el.onclick = () => Farm.ui.toast(Farm.i18n.t('plot_locked_hint_template', { n: lvl }));
        return el;
      }

      if (!plot.crop) {
        el.classList.add('empty');
        el.onclick = () => Farm.shop.openSeedPickerForPlot(idx);
        return el;
      }

      const def = Farm.crops.get(plot.crop);
      if (!def) {
        el.classList.add('empty');
        return el;
      }

      const stage = Farm.crops.getStage(plot);
      const isMature = stage >= 2;

      el.classList.add(isMature ? 'ready' : 'growing');

      const iconEl = document.createElement('div');
      iconEl.className = 'crop-icon';
      iconEl.dataset.stage = String(stage);
      const size = isMature ? 64 : 50;
      iconEl.innerHTML = Farm.cropArt.svg(plot.crop, stage, size);
      el.appendChild(iconEl);

      if (!isMature) {
        const bar = document.createElement('div');
        bar.className = 'grow-bar';
        const fill = document.createElement('div');
        fill.className = 'grow-fill';
        fill.style.width = (Farm.crops.getProgress(plot) * 100) + '%';
        bar.appendChild(fill);
        el.appendChild(bar);

        const timeLabel = document.createElement('div');
        timeLabel.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.85);position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.3);padding:1px 5px;border-radius:6px;';
        timeLabel.textContent = Farm.crops.formatTimeRemaining(Farm.crops.timeRemaining(plot));
        el.appendChild(timeLabel);
      } else {
        if (plot.harvestsLeft > 1) {
          const badge = document.createElement('div');
          badge.style.cssText = 'position:absolute;top:2px;left:2px;font-size:10px;background:var(--barn-red);color:#fff;padding:1px 5px;border-radius:6px;font-weight:700;';
          badge.textContent = '×' + plot.harvestsLeft;
          el.appendChild(badge);
        }
      }

      el.onclick = (e) => {
        if (isMature) {
          this.harvestPlot(idx, e);
        } else {
          const lang = Farm.state.data.language;
          const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
          Farm.ui.toast(def[nameKey] + ' · ' + Farm.crops.formatTimeRemaining(Farm.crops.timeRemaining(plot)));
        }
      };

      return el;
    },

    harvestPlot(plotIdx, evt) {
      const plot = Farm.state.data.plots[plotIdx];
      const result = Farm.crops.harvest(plot);
      if (!result.ok) return;

      if (Farm.audio) Farm.audio.play('harvest');

      // Floating +N coins
      if (evt && evt.target) {
        const rect = evt.target.getBoundingClientRect();
        Farm.ui.floatText('+' + result.coins + ' 🪙',
          rect.left + rect.width/2 - 15, rect.top);
        if (result.eastPoints > 0) {
          setTimeout(() => {
            Farm.ui.floatText('+' + result.eastPoints + ' 🎫',
              rect.left + rect.width/2 - 15, rect.top, '#9b59b6');
          }, 300);
        }
      }

      // Update HUD
      Farm.ui.refreshHUD();

      // Level up?
      if (result.levelInfo && result.levelInfo.leveledUp) {
        setTimeout(() => {
          Farm.ui.toast('🎉 Lv ' + result.levelInfo.newLevel + ' ' + Farm.i18n.t('toast_level_up'), 3500);
          Farm.state.addEastPoints(5);
          Farm.ui.refreshHUD();
          this.renderGrid();  // unlock new plots
          if (Farm.audio) Farm.audio.play('levelUp');
        }, 500);
      }

      // Refresh grid (clear plot)
      this.renderGrid();

      // Notify tasks system
      if (Farm.tasks) Farm.tasks.onEvent('harvest', { cropId: result.cropId, coins: result.coins });
      // Check achievements (covers totalHarvests, festival_harvests, level, crops_set)
      if (Farm.achievements) Farm.achievements.checkAll();
    },

    // Tick — update growth timers visually (called every second)
    tick() {
      Farm.state.data.plots.forEach((plot, idx) => {
        if (!plot.unlocked || !plot.crop) return;
        const el = document.querySelector('.plot[data-plot-id="' + idx + '"]');
        if (!el) return;
        const wasMature = el.classList.contains('ready');
        const isMature = Farm.crops.isMature(plot);
        const currentStage = Farm.crops.getStage(plot);

        // Update progress bar or transition to ready
        if (wasMature !== isMature) {
          this.renderGrid();
          return;
        }
        if (!isMature) {
          const fill = el.querySelector('.grow-fill');
          if (fill) fill.style.width = (Farm.crops.getProgress(plot) * 100) + '%';
          const time = el.querySelector('div[style*="top:4px"]');
          if (time) time.textContent = Farm.crops.formatTimeRemaining(Farm.crops.timeRemaining(plot));

          // Stage icon swap (SVG re-render only when stage actually changes)
          const icon = el.querySelector('.crop-icon');
          if (icon && icon.dataset.stage !== String(currentStage)) {
            icon.dataset.stage = String(currentStage);
            icon.innerHTML = Farm.cropArt.svg(plot.crop, currentStage, 50);
          }
        }
      });
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.farm = farm;
})();
