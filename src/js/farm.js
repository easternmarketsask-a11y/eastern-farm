/**
 * farm.js — Farm grid rendering and plot interactions.
 */
(function() {
  // Combo tracking: consecutive harvests within COMBO_WINDOW ms build a combo
  // count, surfaced as a "🔥 连击 ×N" float for a juicier rapid-harvest feel.
  let _comboCount = 0;
  let _comboLast = 0;
  const COMBO_WINDOW = 1500;

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
      // Settings toggle: hide pets + static decor from farm view
      if (Farm.state.data.decorationsHidden) { layer.style.minHeight = '0'; return; }
      if (!Farm.epShop || !Farm.epShop.items.length) return;
      const decos = Farm.state.data.decorations || [];
      const pets = [];
      const statics = [];
      decos.forEach(d => {
        const item = Farm.epShop.items.find(i => i.id === d.itemId);
        if (!item || !item.decoration_emoji) return;
        if (item.category === 'pet') pets.push(item.decoration_emoji);
        else statics.push(item.decoration_emoji);
      });

      // The decoration layer is a grassy "farmyard" below the fields.
      // Scatter the static decorations across it at stable (deterministic)
      // positions so they read like a real, lived-in farm — not a flat row.
      const hasAny = statics.length > 0 || pets.length > 0;
      layer.style.minHeight = hasAny ? '150px' : '0';

      statics.forEach((emoji, i) => {
        const span = document.createElement('span');
        span.className = 'farm-deco-static';
        span.textContent = emoji;
        // Spread horizontally with per-index jitter; stagger over 3 depth tiers
        // (further-back tier sits higher + slightly smaller = simple depth).
        const left = 6 + ((i * 31 + (i % 2) * 17) % 80);   // 6%..86%
        const tier = i % 3;                                 // 0 front .. 2 back
        span.style.left = left + '%';
        span.style.bottom = (8 + tier * 40) + 'px';
        span.style.fontSize = (44 - tier * 6) + 'px';       // 44 / 38 / 32
        span.style.zIndex = String(10 - tier);
        span.style.animationDelay = (i * 0.4) + 's';
        layer.appendChild(span);
      });

      // Pets wander along the front of the yard.
      pets.forEach((emoji, i) => {
        const pet = document.createElement('div');
        pet.className = 'farm-deco-pet';
        pet.textContent = emoji;
        pet.style.bottom = (2 + (i % 2) * 34) + 'px';
        pet.style.animationDelay = (i * -3) + 's';
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
        // 粘性连续种植（UX 第 2 批 #2）：粘性种子激活时直接连种，否则弹选种器
        el.onclick = () => {
          if (Farm.shop.stickyPlant && Farm.shop.stickyPlant(idx)) return;
          Farm.shop.openSeedPickerForPlot(idx);
        };
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
      const size = isMature ? 80 : 62;
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

        // 打理标记：已浇水 → 整块地变深色湿土 + 左上角一滴水
        if (plot.watered) {
          el.classList.add('is-watered');
          const wb = document.createElement('div');
          wb.className = 'plot-watered-badge';
          wb.textContent = '💧';
          el.appendChild(wb);
        }
        // 施肥标记：已施肥的在长作物左下角一颗星
        if (plot.fertilized) {
          const fb = document.createElement('div');
          fb.className = 'plot-fertilized-badge';
          fb.textContent = '🌟';
          el.appendChild(fb);
        }
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
          this.openPlotCare(idx, plot, def);
        }
      };

      return el;
    },

    // 「地块打理」弹窗：点一块生长中的作物 → 浇水 / 施肥 / 加速 三合一入口。
    // 浇水免费(每周期1次)、施肥(T2)消耗化肥、加速消耗加速券。
    openPlotCare(plotIdx, plot, def) {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const remaining = Farm.crops.formatTimeRemaining(Farm.crops.timeRemaining(plot));
      const eff = Farm.state.data.activeEffects || {};
      const charges = eff.accelerationCharges || 0;
      const canWater = Farm.tending && Farm.tending.canWater(plot);

      // 浇水行：可浇 → 按钮（说明=缩短成熟时间）；已浇 → 灰提示
      const waterHtml = canWater
        ? `<button class="btn care-btn" id="careWater">💧 ${lang === 'en' ? 'Water · 20% faster' : '浇水 · 缩短 20% 时间'}</button>`
        : (plot.watered
            ? `<div class="care-note">💧 ${Farm.i18n.t('tending_water_done')}</div>`
            : '');

      // 施肥行：已施肥 → 灰提示；有化肥 → 施肥按钮；没化肥 → 引导去商城买
      // （以前没库存时整行隐藏，玩家以为"施肥没做"，故改成可发现的入口）
      const fertCount = (Farm.tending && Farm.tending.fertilizerCount) ? Farm.tending.fertilizerCount() : 0;
      const canFert = Farm.tending && Farm.tending.canFertilize(plot);
      const fertHtml = plot.fertilized
        ? `<div class="care-note">🌟 ${Farm.i18n.t('tending_fert_done')}</div>`
        : (canFert
            ? `<button class="btn care-btn" id="careFert">🌟 ${lang === 'en' ? 'Fertilize · ×2 yield' : '施肥 · 产量翻倍'} <span style="opacity:.7;">(${fertCount})</span></button>`
            : `<button class="btn care-btn" id="careFertNone" disabled>🌟 ${lang === 'en' ? 'Fertilize · ×2 yield' : '施肥 · 产量翻倍'} <span style="opacity:.8;font-size:11px;">${lang === 'en' ? '· needs fertilizer' : '· 需要化肥'}</span></button>`);

      // 加速行：有券才显示（没券不唠叨）
      const accelHtml = charges > 0
        ? `<button class="btn secondary care-btn" id="careAccel">⚡ ${lang === 'en' ? 'Speed up now' : '立刻成熟'} <span style="opacity:.7;">(${charges})</span></button>`
        : '';

      const html = `
        <h2 class="modal-title">${def[nameKey]}</h2>
        <p style="text-align:center;margin:10px 0 4px;color:var(--warm-text-soft);font-size:13px;">
          ${lang === 'en' ? remaining + ' left' : '还剩 ' + remaining}
        </p>
        <p style="text-align:center;margin:0 0 14px;color:var(--warm-text-soft);font-size:11px;opacity:.85;">
          ${lang === 'en' ? 'Optional boosts — crops grow & harvest fine without them.' : '都是可选加成，不打理也照常生长收获'}
        </p>
        <div class="care-actions">
          ${waterHtml}
          ${fertHtml}
          ${accelHtml}
        </div>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      const waterBtn = document.getElementById('careWater');
      if (waterBtn) waterBtn.onclick = () => {
        Farm.ui.hideModal();
        if (Farm.tending) Farm.tending.waterPlot(plotIdx);
      };

      const fertBtn = document.getElementById('careFert');
      if (fertBtn) fertBtn.onclick = () => {
        Farm.ui.hideModal();
        if (Farm.tending) Farm.tending.fertilizePlot(plotIdx);
      };


      const accelBtn = document.getElementById('careAccel');
      if (accelBtn) accelBtn.onclick = () => {
        if ((Farm.state.data.activeEffects.accelerationCharges || 0) <= 0) {
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
          // 失败反馈统一（UX 第 3 批 #10）：收获时仓满是高频阻断，降级为
          // 轻量 toast + 谷仓红点（iso 谷仓 ≥80% 自动亮点、满仓变红，第 2 批
          // 已加），不再弹 modal 打断连续收获。需要决策的「卖货/扩建」modal
          // （warehouse.openFullDialog）保留在状态胶囊「去卖货」入口。
          const lang = Farm.state.data.language;
          Farm.ui.toast(lang === 'en'
            ? '📦 Silo full — tap the barn to sell & free up space'
            : '📦 仓库满了，点谷仓卖货腾空间', 3000);
          if (Farm.harvestStatus) Farm.harvestStatus.render();   // 胶囊切到「去卖货」态
          if (Farm.warehouse && Farm.warehouse.refreshBadge) Farm.warehouse.refreshBadge();
        }
        return;
      }

      if (Farm.harvestStatus) Farm.harvestStatus.render();

      // Combo: rapid consecutive harvests within COMBO_WINDOW build a streak.
      // Computed BEFORE the harvest chime so each consecutive pick steps the
      // pitch up a semitone (Hay Day-style do-re-mi), resetting after 1.5s idle.
      const _now = Date.now();
      _comboCount = (_now - _comboLast < COMBO_WINDOW) ? _comboCount + 1 : 1;
      _comboLast = _now;
      const _comboStep = Math.min(_comboCount - 1, 7);

      if (Farm.audio) Farm.audio.play('harvest', { step: _comboStep });
      // Short haptic pulse on every pick — the tactile half of Hay Day's
      // harvest feel. iOS Safari ignores vibrate() but it's harmless there.
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }

      // Polish: play the "pop" animation BEFORE the grid re-render wipes
      // this plot. The crop scales up + fades out so picking feels alive.
      // Deferred renderGrid by 350ms (matches harvestPop duration).
      const harvestedEl = document.querySelector('.plot[data-plot-id="' + plotIdx + '"]');
      if (harvestedEl) {
        harvestedEl.classList.add('harvesting');
        // 采摘爆裂：叶子+星光从地块中心炸开（juice 2026-06-11）
        const hr = harvestedEl.getBoundingClientRect();
        // In map mode the plot DOM is hidden (rect is 0×0) — fall back to the
        // event's on-screen rect so the burst lands on the map plot, not (0,0).
        let bx = hr.left + hr.width / 2, by = hr.top + hr.height / 2;
        if ((hr.width === 0 || hr.height === 0) && evt && evt.target) {
          const er = evt.target.getBoundingClientRect();
          bx = er.left + er.width / 2; by = er.top + er.height / 2;
        }
        if (Farm.ui && Farm.ui.burst) Farm.ui.burst(bx, by, ['🍃', '✨', '🌿'], 8);
      }

      // Update warehouse badge with new count
      if (Farm.warehouse && Farm.warehouse.refreshBadge) Farm.warehouse.refreshBadge();
      // New crops in the silo may make a 小东 order fillable → refresh his badge
      if (Farm.orders && Farm.orders.refreshBadge) Farm.orders.refreshBadge();
      // 首次收获入仓：教"菜进了仓库，攒着卖"（晚于首收撒花的 toast）
      if (Farm.coach) Farm.coach.fire('first_warehouse', 1600);

      // V2: floating "📦 +1" feedback since coins aren't credited until
      // delivery. EP bonuses (jackpot etc.) still float separately because
      // those ARE credited immediately on harvest.
      if (evt && evt.target) {
        const rect = evt.target.getBoundingClientRect();
        const lang = Farm.state.data.language;
        // 飘字带上「谷仓 N/M」（UX 第 2 批 #5）：让玩家边收边看到仓储在涨、
        // 快满时有预期（数据与 state.isWarehouseFull 同口径）
        const whN = (Farm.state.data.warehouse || []).length;
        const whCap = Farm.state.data.warehouseCapacity || 20;
        Farm.ui.floatText('📦 ' + (result.bumper ? '+2 ' : '+1 ') + (lang === 'en' ? 'silo ' : '入库 ')
          + whN + '/' + whCap,
          rect.left + rect.width/2 - 20, rect.top);
        if (result.bumper) {
          Farm.ui.floatText('🌟 ' + (lang === 'en' ? 'Double!' : '双倍收获'),
            rect.left + rect.width/2 - 22, rect.top - 24, '#e08a00');
        }
        if (result.eastPoints > 0) {
          setTimeout(() => {
            Farm.ui.floatText('+' + result.eastPoints + ' <span class="points-icon"></span>',
              rect.left + rect.width/2 - 15, rect.top, '#9b59b6');
          }, 300);
        }
        // Combo badge floats above the plot once the player chains ≥2 picks.
        if (_comboCount >= 2) {
          Farm.ui.floatText('🔥 ' + (lang === 'en' ? 'Combo ×' : '连击 ×') + _comboCount,
            rect.left + rect.width/2 - 22, rect.top - 24, '#c44536');
          if (Farm.audio) Farm.audio.play('coin', { step: _comboStep });
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

      // Gentle one-time push-permission pre-prompt (self-throttling: only fires
      // once, when permission is still 'default' and the player is logged in).
      if (Farm.push && Farm.push.maybePromptAfterHarvest) Farm.push.maybePromptAfterHarvest();

      // First-harvest celebration: confetti + a hint pointing to the silo
      // (so the player knows the crop didn't just disappear — they need to
      // deliver to Eastern Market next).
      if (isFirstHarvestEver) {
        Farm.state.data.firstHarvestCelebrated = true;
        if (Farm.track) Farm.track('harvest_first');
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
          // 升到解锁等级（Lv7）→ 顺菜解锁庆祝提示（等升级弹窗关掉后再弹）
          const unlockLv = (Farm.socialConfig && Farm.socialConfig.STEAL_UNLOCK_LEVEL) || 7;
          if (li.oldLevel < unlockLv && li.newLevel >= unlockLv && Farm.coach) {
            Farm.coach.fire('steal_unlocked', 1200);
          }
          // Limited-time promo: reaching Lv3 this week → bonus coins. Waits
          // for the level-up modal to close before showing its own.
          if (Farm.promo && Farm.promo.check) Farm.promo.check();
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
      if (Farm.harvestStatus) Farm.harvestStatus.render();
      // iso 画布视图激活时短路 DOM 部分（2026-07-05 UX 第 1 批 #12）：DOM 地块
      // 藏在 display:none 的 #farmGrid 里，每秒 querySelector + 改写隐藏 DOM 纯
      // 空转（iso 自己每秒 render 画布）。胶囊刷新在上面保留；原挂在 DOM 分支
      // 里的「首次有菜熟」coach 提示改为数据层边沿检测，行为不丢。
      if (Farm.isoView && Farm.isoView._on && Farm.isoView.active && Farm.isoView.active()) {
        const anyMature = (Farm.state.data.plots || []).some(
          (p) => p.unlocked && p.crop && Farm.crops.isMature(p));
        if (anyMature && !this._isoHadMature && Farm.coach) Farm.coach.fire('first_mature', 400);
        this._isoHadMature = anyMature;
        return;
      }
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
          // 刚成熟的瞬间：squash-and-stretch 弹跳 + 星光爆裂（juice 2026-06-11）。
          // renderGrid 重建了 DOM，所以效果挂在新元素上。
          if (isMature) {
            const fresh = document.querySelector('.plot[data-plot-id="' + idx + '"]');
            if (fresh) {
              fresh.classList.add('just-matured');
              setTimeout(() => fresh.classList.remove('just-matured'), 600);
              const r = fresh.getBoundingClientRect();
              if (Farm.ui && Farm.ui.burst) {
                Farm.ui.burst(r.left + r.width / 2, r.top + r.height / 2, ['✨', '⭐', '🌟'], 6);
              }
              if (Farm.audio) Farm.audio.play('plant');
              if (Farm.coach) Farm.coach.fire('first_mature', 400);   // 首次有菜熟：教收获
            }
          }
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
            icon.innerHTML = Farm.cropArt.svg(plot.crop, currentStage, currentStage >= 2 ? 80 : 62);
          }
        }
      });
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.farm = farm;
})();
