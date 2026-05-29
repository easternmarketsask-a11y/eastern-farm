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
      this.renderDecorations();
    },

    renderDecorations() {
      const layer = document.getElementById('farmDecorations');
      if (!layer) return;
      layer.innerHTML = '';
      // Settings toggle: hide pets + balloons + other animated decor
      if (Farm.state.data.decorationsHidden) return;
      if (!Farm.epShop || !Farm.epShop.items.length) return;
      const decos = Farm.state.data.decorations || [];
      // Find pets (animated) vs static decorations
      const pets = [];
      const statics = [];
      decos.forEach(d => {
        const item = Farm.epShop.items.find(i => i.id === d.itemId);
        if (!item || !item.decoration_emoji) return;
        if (item.category === 'pet') pets.push(item.decoration_emoji);
        else statics.push(item.decoration_emoji);
      });
      // Static decorations as a row
      if (statics.length > 0) {
        const row = document.createElement('div');
        row.className = 'farm-deco-row';
        statics.forEach((emoji, i) => {
          const span = document.createElement('span');
          span.className = 'farm-deco-static';
          span.textContent = emoji;
          span.style.animationDelay = (i * 0.3) + 's';
          row.appendChild(span);
        });
        layer.appendChild(row);
      }
      // Pets — each wanders horizontally
      pets.forEach((emoji, i) => {
        const pet = document.createElement('div');
        pet.className = 'farm-deco-pet';
        pet.textContent = emoji;
        pet.style.animationDelay = (i * -2) + 's';
        layer.appendChild(pet);
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
        // Tutorial hint: pulse the FIRST empty unlocked plot for brand-new
        // players who have never grown anything. Drops the moment they
        // plant + harvest their first crop (cropsEverGrown becomes non-empty).
        const noHarvestsYet = (Farm.state.data.cropsEverGrown || []).length === 0;
        const isFirstEmpty = Farm.state.data.plots
          .slice(0, idx).every(p => !p.unlocked || p.crop);
        if (noHarvestsYet && isFirstEmpty) el.classList.add('tutorial-hint');
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
          this.offerAccelerate(idx, plot, def);
        }
      };

      return el;
    },

    // Show option to spend an acceleration ticket on a growing plot.
    offerAccelerate(plotIdx, plot, def) {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const remaining = Farm.crops.formatTimeRemaining(Farm.crops.timeRemaining(plot));
      const charges = (Farm.state.data.activeEffects && Farm.state.data.activeEffects.accelerationCharges) || 0;
      if (charges <= 0) {
        // No tickets — just show the standard timer toast
        Farm.ui.toast(def[nameKey] + ' · ' + remaining);
        return;
      }
      // Has tickets: offer to use one
      const html = `
        <h2 class="modal-title">⚡ ${lang === 'en' ? 'Speed Up?' : '加速生长？'}</h2>
        <p style="text-align:center;margin:16px 0;">
          ${def[nameKey]} · ${lang === 'en' ? remaining + ' left' : '还剩 ' + remaining}
        </p>
        <p style="text-align:center;font-size:13px;color:var(--warm-text-soft);margin-bottom:16px;">
          ${lang === 'en'
            ? 'Use 1 ⚡ Acceleration Ticket to mature instantly?'
            : '使用 1 张 ⚡ 加速券立刻成熟？'}
          <br>${lang === 'en' ? 'You have ' : '你有 '}<strong>${charges}</strong> ⚡
        </p>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
          <button class="btn" id="accelConfirm">⚡ ${lang === 'en' ? 'Use' : '使用'}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      document.getElementById('accelConfirm').onclick = () => {
        if (Farm.state.data.activeEffects.accelerationCharges <= 0) {
          Farm.ui.toast(lang === 'en' ? 'No tickets left' : '没有加速券了');
          Farm.ui.hideModal();
          return;
        }
        Farm.state.data.activeEffects.accelerationCharges -= 1;
        // Set plantedAt back in time so the crop is now mature
        plot.plantedAt = Date.now() - def.grow_minutes * 60000 - 1000;
        Farm.state.save();
        Farm.ui.hideModal();
        this.renderGrid();
        if (Farm.audio) Farm.audio.play('achievement');
        Farm.ui.toast(lang === 'en' ? '⚡ Mature! Tap to harvest.' : '⚡ 已成熟，点击收获！', 2200);
      };
    },

    harvestPlot(plotIdx, evt) {
      const plot = Farm.state.data.plots[plotIdx];
      // First-harvest celebration: capture flag BEFORE the harvest mutates
      // totalHarvests, so we know whether this is the inaugural pick.
      const isFirstHarvestEver = !Farm.state.data.firstHarvestCelebrated;
      const result = Farm.crops.harvest(plot);
      if (!result.ok) {
        // Warehouse-full is the only user-facing failure we surface
        // (other reasons like "not_mature" / "unknown" can't be triggered
        // by a normal click flow).
        if (result.reason === 'warehouse_full') {
          if (Farm.audio) Farm.audio.play('error');
          if (Farm.warehouse && Farm.warehouse.openFullDialog) {
            Farm.warehouse.openFullDialog();
          }
        }
        return;
      }

      if (Farm.audio) Farm.audio.play('harvest');

      // Polish: play the "pop" animation BEFORE the grid re-render wipes
      // this plot. The crop scales up + fades out so picking feels alive.
      // Deferred renderGrid by 350ms (matches harvestPop duration).
      const harvestedEl = document.querySelector('.plot[data-plot-id="' + plotIdx + '"]');
      if (harvestedEl) harvestedEl.classList.add('harvesting');

      // Update warehouse badge with new count
      if (Farm.warehouse && Farm.warehouse.refreshBadge) Farm.warehouse.refreshBadge();

      // V2: floating "📦 +1" feedback since coins aren't credited until
      // delivery. EP bonuses (jackpot etc.) still float separately because
      // those ARE credited immediately on harvest.
      if (evt && evt.target) {
        const rect = evt.target.getBoundingClientRect();
        const lang = Farm.state.data.language;
        Farm.ui.floatText('📦 +1 ' + (lang === 'en' ? 'silo' : '入库'),
          rect.left + rect.width/2 - 20, rect.top);
        if (result.eastPoints > 0) {
          setTimeout(() => {
            Farm.ui.floatText('+' + result.eastPoints + ' <span class="points-icon"></span>',
              rect.left + rect.width/2 - 15, rect.top, '#9b59b6');
          }, 300);
        }
      }

      // Celebratory toasts for the variable-reward layers (P0.3)
      const lang = Farm.state.data.language;
      (result.bonusReasons || []).forEach((br, i) => {
        let msg = '';
        if (br.kind === 'jackpot') {
          msg = (lang === 'en' ? '🎰 Golden Nugget! +' : '🎰 金疙瘩！+') + br.amount + ' <span class="points-icon"></span>';
        } else if (br.kind === 'first_harvest') {
          msg = (lang === 'en' ? '🌅 First harvest of the day +' : '🌅 今日首收 +') + br.amount + ' <span class="points-icon"></span>';
        } else if (br.kind === 'weekend') {
          msg = (lang === 'en' ? '☄️ Weekend Meteor 2× +' : '☄️ 周末流星雨 ×2 +') + br.amount + ' <span class="points-icon"></span>';
        }
        if (msg) {
          setTimeout(() => {
            Farm.ui.toast(msg, 2800);
            if (Farm.audio) Farm.audio.play(br.kind === 'jackpot' ? 'achievement' : 'coin');
          }, 600 + i * 700);
        }
      });
      // Queue overflow notice (only when nothing credited or significant queue)
      if (result.epQueued > 0 && result.epCredited === 0) {
        setTimeout(() => {
          Farm.ui.toast(
            (lang === 'en' ? '🚦 Daily EP cap reached. ' : '🚦 今日积分已达上限，') +
            (lang === 'en' ? '+' + result.epQueued + ' queued for tomorrow' : '+' + result.epQueued + ' 排队明日入账'),
            3000);
        }, 900);
      }

      // Update HUD
      Farm.ui.refreshHUD();

      // First-harvest celebration: confetti + a hint pointing to the silo
      // (so the player knows the crop didn't just disappear — they need to
      // deliver to Eastern Market next).
      if (isFirstHarvestEver) {
        Farm.state.data.firstHarvestCelebrated = true;
        Farm.state.save();
        if (Farm.ui && Farm.ui.showConfetti) Farm.ui.showConfetti(28, 2400);
        setTimeout(() => {
          Farm.ui.toast(Farm.i18n.t('toast_first_harvest'), 3600);
        }, 900);
      }

      // Level up?
      if (result.levelInfo && result.levelInfo.leveledUp) {
        const li = result.levelInfo;
        const epAward = 5 * (li.newLevel - li.oldLevel);   // 5 EP per level gained
        const coinAward = 50 * (li.newLevel - li.oldLevel);
        setTimeout(() => {
          Farm.state.addCoins(coinAward);
          Farm.state.addEastPoints(epAward, {
            source: 'level_up',
            description: 'Level ' + li.oldLevel + ' → ' + li.newLevel,
          });
          Farm.ui.refreshHUD();
          this.renderGrid();  // unlock new plots
          // Celebratory modal instead of a tiny toast (per owner request:
          // make level-up feel meaningful + preview the next milestone)
          Farm.ui.showLevelUpModal(li.oldLevel, li.newLevel, { epAwarded: epAward });
        }, 500);
      }

      // Refresh grid (clear plot) — deferred to let the harvest-pop animation
      // finish (350ms). If the plot is a multi-harvest crop, render
      // immediately so the next-harvest timer starts visible.
      const renderDelay = (plot.harvestsLeft > 0) ? 0 : 350;
      setTimeout(() => this.renderGrid(), renderDelay);

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
