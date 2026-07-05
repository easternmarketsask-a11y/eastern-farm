/**
 * shop.js — Seed shop. Modal showing all unlocked crops, buy with coins.
 * Also handles "plant seed into specific plot" flow.
 */
(function() {
  // Card icon: real crop art (the recognizable SVG sprites) when available,
  // emoji from crops.json as fallback. Festival-only crops keep their emoji —
  // they have no dedicated art and would render as a generic sprout.
  function cropFace(c) {
    try {
      if (!c.festival_only && Farm.cropArt && Farm.cropArt.icon) {
        const svg = Farm.cropArt.icon(c.id, 32);
        if (svg) return svg;
      }
    } catch (e) { /* fall through to emoji */ }
    return c.icon || '🌱';
  }

  const shop = {
    // ===== 操作舒适度改造第 2 批（2026-07-05）内存态，不进存档 =====
    _stickySeed: null,     // 粘性连续种植：当前连种的种子 id（null = 未激活）
    _stickyTimer: null,    // 8 秒无操作自动退出的计时器
    _pendingPlotIdx: null, // 无种子从选种器跳进商店时记下的原地块（买完自动种回）

    open() {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const playerLevel = Farm.state.data.level;
      const allCrops = Farm.crops.all();
      const activeFestival = Farm.events && Farm.events.getActiveFestivalId();

      let cropsToShow = [...allCrops];
      // Add festival-only crops for active festival
      if (activeFestival) {
        Object.values(Farm.crops.festivalCrops).forEach(fc => {
          if (fc.festival_only === activeFestival) cropsToShow.push(fc);
        });
      }

      const specialId = Farm.daily ? Farm.daily.getSpecialSeedId() : null;
      const coin = '<span class="coin-icon"></span>';
      const seedPriceLabel = lang === 'en' ? 'Seed price' : '种子价格';
      const html = `
        <h2 class="modal-title">🛒 ${Farm.i18n.t('shop_title')}</h2>
        <p class="modal-subtitle">${Farm.i18n.t('shop_subtitle')}</p>
        <div class="seed-list">
          ${cropsToShow.map(c => {
            const locked = c.unlock_level > playerLevel;
            const owned = Farm.state.data.seeds[c.id] || 0;
            const isSpecial = !locked && c.id === specialId;
            const price = isSpecial ? Farm.daily.discountedSeedCost(c.id) : c.seed_cost;
            // Shop card shows ONLY seed price (what player pays). Sell price
            // belongs on the plant-picker card instead — different context,
            // different number to highlight (Chris's UX direction).
            const priceCell = isSpecial
              ? `<span class="seed-cost"><span class="seed-label">${seedPriceLabel}</span><span class="seed-value"><s style="color:#bbb;font-weight:400;">${coin}${c.seed_cost}</s> <strong style="color:var(--barn-red);">${coin}${price}</strong></span></span>`
              : `<span class="seed-cost"><span class="seed-label">${seedPriceLabel}</span><span class="seed-value">${coin}${c.seed_cost}</span></span>`;
            const specialBadge = isSpecial
              ? '<div class="seed-special-badge">⭐ ' + (lang === 'en' ? 'TODAY -50%' : '今日 -50%') + '</div>'
              : '';
            const statusCell = locked
              ? `<span style="color:#999;">Lv ${c.unlock_level}</span>`
              : `<span class="seed-owned">× ${owned}</span>`;
            return `
              <div class="seed-card ${locked ? 'locked' : ''} ${isSpecial ? 'special' : ''}" data-crop-id="${c.id}" data-action="buy">
                ${specialBadge}
                <span class="seed-icon">${cropFace(c)}</span>
                <div>
                  <div class="seed-name">${c[nameKey]}</div>
                  <div class="seed-meta">
                    ${priceCell}
                    <span class="seed-time">⏱${formatMinutes(c.grow_minutes)}</span>
                    ${statusCell}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      // Bind click on each seed card
      document.querySelectorAll('.seed-card[data-action="buy"]').forEach(card => {
        if (card.classList.contains('locked')) return;
        card.onclick = () => {
          const cropId = card.dataset.cropId;
          this.buySeed(cropId);
        };
      });
    },

    buySeed(cropId) {
      const def = Farm.crops.get(cropId);
      if (!def) return;
      const price = (Farm.daily && Farm.daily.discountedSeedCost(cropId)) || def.seed_cost;
      if (!Farm.state.spendCoins(price)) {
        Farm.ui.toast(Farm.i18n.t('toast_not_enough_coins'));
        if (Farm.audio) Farm.audio.play('error');
        return;
      }
      Farm.state.addSeed(cropId, 1);
      Farm.ui.refreshHUD();
      if (Farm.audio) Farm.audio.play('buy');
      // cost 供周任务 spend_coins 计数（真实花费，含特价折扣）
      if (Farm.tasks) Farm.tasks.onEvent('buy_seed', { cropId, cost: price });
      // 无种子买完回填原地块（UX 第 2 批 #4）：从选种器跳来买种的，买完直接
      // 种回那块地（比重开选种器更顺滑），种完 toast。地块已被占/已锁则放弃回填。
      const pending = this._pendingPlotIdx;
      if (pending != null) {
        const p = Farm.state.data.plots[pending];
        if (p && p.unlocked && !p.crop) {
          this._pendingPlotIdx = null;
          const r = this._plantOne(pending, cropId);
          if (r.ok) {
            Farm.ui.hideModal();
            Farm.farm.renderGrid();
            if (Farm.harvestStatus) Farm.harvestStatus.render();
            if (Farm.audio) Farm.audio.play('plant');
            const lang = Farm.state.data.language;
            if (!r.firstPlant) {
              Farm.ui.toast('🌱 ' + def[lang === 'en' ? 'name_en' : 'name_zh'] + readyHint(def), 1800);
              this._stickyStart(cropId, 1900);   // 买完种上后同样进入连续种植
            }
            return;
          }
        }
      }
      Farm.ui.toast('🌱 +1 ' + def[Farm.state.data.language === 'en' ? 'name_en' : 'name_zh']);
      // Refresh shop UI inline
      this.open();
    },

    // ============ Plant flow ============
    openSeedPickerForPlot(plotIdx) {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const seeds = Farm.state.data.seeds;
      const playerLevel = Farm.state.data.level;
      const ownedCropIds = Object.keys(seeds).filter(id => seeds[id] > 0);

      if (ownedCropIds.length === 0) {
        // Auto-open shop。记下原地块：买完种子直接种回这块地（UX 第 2 批 #4），
        // 不再让玩家买完后自己找回刚才点的那块空地。
        Farm.ui.toast(Farm.i18n.t('toast_not_enough_seeds'));
        this._pendingPlotIdx = plotIdx;
        setTimeout(() => this.open(), 600);
        return;
      }

      const coin = '<span class="coin-icon"></span>';
      // Plant picker — different context, different label. Show ONLY the
      // market purchase price (what Eastern Market will pay for the
      // harvested crop), reinforcing the brand connection too.
      const marketPriceLabel = lang === 'en' ? 'Market price' : '市场收购价';
      const renderCard = (id, isLast) => {
        const c = Farm.crops.get(id);
        if (!c) return '';
        const locked = c.unlock_level > playerLevel;
        const owned = seeds[id] || 0;
        // 应季作物：收购价 +15%（与仓库结算同源），加当季徽章
        const inSeason = Farm.crops.isInSeason && Farm.crops.isInSeason(c);
        const unit = Farm.crops.sellPriceOf ? Farm.crops.sellPriceOf(c) : c.sell_price;
        const priceHtml = inSeason
          ? `<span class="seed-value"><strong style="color:var(--barn-red);">${coin}${unit}</strong> <span class="season-tag">${Farm.crops.seasonEmoji()}${lang === 'en' ? 'In season' : '应季'}</span></span>`
          : `<span class="seed-value">${coin}${unit}</span>`;
        // 「上次」标：lastSeedId 对应的卡置顶时加小标（UX 第 2 批 #3）
        const lastTag = isLast ? `<span class="seed-last-tag">${lang === 'en' ? 'Last' : '上次'}</span>` : '';
        // 「种满所有空地」批量按钮（UX 第 2 批 #1）：种子不够会自动按现价买
        const fillBtn = locked ? '' :
          `<button type="button" class="seed-fill-btn" data-fill-crop="${id}">🌱 ${lang === 'en' ? 'Plant all empty' : '种满所有空地'}</button>`;
        return `
          <div class="seed-card ${locked ? 'locked' : ''}" data-crop-id="${id}" data-action="plant">
            <span class="seed-icon">${cropFace(c)}</span>
            <div>
              <div class="seed-name">${c[nameKey]}${lastTag}</div>
              <div class="seed-meta">
                <span class="seed-sell"><span class="seed-label">${marketPriceLabel}</span>${priceHtml}</span>
                <span class="seed-time">⏱${formatMinutes(c.grow_minutes)}</span>
                <span class="seed-owned">× ${owned}</span>
              </div>
            </div>
            ${fillBtn}
          </div>
        `;
      };
      // 按生长时长分三组，把「早中晚回访节奏」直接教给玩家：
      // 会话内连种 / 饭后回来收 / 睡前种睡醒收（离线档现在是最高币/h，见 crops.json 重调）
      const GROUPS = [
        { max: 40,       zh: '⚡ 马上好（40 分钟内）',   en: '⚡ Quick (under 40 min)' },
        { max: 180,      zh: '🍚 饭后好（1–3 小时）',    en: '🍚 A meal away (1–3 h)' },
        { max: Infinity, zh: '🌙 睡一觉好（3 小时以上）', en: '🌙 Overnight (3 h+)' },
      ];
      // 上次种子置顶（UX 第 2 批 #3）：lastSeedId 有库存时单独放在最前（组外），
      // 其余仍按生长时长分组。
      const lastId = Farm.state.data.lastSeedId;
      const hasLast = !!(lastId && (seeds[lastId] || 0) > 0 && Farm.crops.get(lastId));
      const sorted = ownedCropIds
        .filter(id => !(hasLast && id === lastId))
        .map(id => Farm.crops.get(id)).filter(Boolean)
        .sort((a, b) => a.grow_minutes - b.grow_minutes);
      let lastGroup = -1;
      const listHtml = (hasLast ? renderCard(lastId, true) : '') + sorted.map(c => {
        const gi = GROUPS.findIndex(g => c.grow_minutes <= g.max);
        let header = '';
        if (gi !== lastGroup) {
          lastGroup = gi;
          header = `<div class="seed-group-title">${lang === 'en' ? GROUPS[gi].en : GROUPS[gi].zh}</div>`;
        }
        return header + renderCard(c.id);
      }).join('');
      const html = `
        <h2 class="modal-title">${Farm.i18n.t('btn_plant')}</h2>
        <p class="modal-subtitle">${lang === 'en' ? 'Choose a seed to plant' : '选择要种的种子'}</p>
        <div class="seed-list">
          ${listHtml}
        </div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
          <button class="btn" id="goToShopBtn">🛒 ${Farm.i18n.t('nav_shop')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      document.getElementById('goToShopBtn').onclick = () => {
        // 从选种器进商店：记下原地块，买完种子直接种回（UX 第 2 批 #4）
        this._pendingPlotIdx = plotIdx;
        this.open();
      };

      // 「种满所有空地」按钮（卡片内嵌，stopPropagation 防触发整卡种一块）
      document.querySelectorAll('.seed-fill-btn[data-fill-crop]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.plantAllEmpty(btn.dataset.fillCrop);
        };
      });

      document.querySelectorAll('.seed-card[data-action="plant"]').forEach(card => {
        if (card.classList.contains('locked')) return;
        card.onclick = () => {
          const cropId = card.dataset.cropId;
          const result = this._plantOne(plotIdx, cropId);
          if (!result.ok) {
            Farm.ui.toast(Farm.i18n.t('toast_not_enough_seeds'));
            if (Farm.audio) Farm.audio.play('error');
            return;
          }
          Farm.ui.hideModal();
          Farm.farm.renderGrid();
          if (Farm.harvestStatus) Farm.harvestStatus.render();
          const def = Farm.crops.get(cropId);
          if (Farm.audio) Farm.audio.play('plant');
          if (!result.firstPlant) {
            Farm.ui.toast('🌱 ' + def[Farm.state.data.language === 'en' ? 'name_en' : 'name_zh']
              + readyHint(def), 1800);
            // 粘性连续种植（UX 第 2 批 #2，Hay Day 式）：种下后 tap 其它空地直接连种。
            // 首种教学时不激活（别抢首种庆祝/店主提示的风头）。
            this._stickyStart(cropId, 1900);
          }
        };
      });
    },

    // ============ 共享种植执行器（UX 第 2 批） ============
    // 单块选种 / 粘性连种 / 种满所有空地 / 买种回填 都走这里，保证任务 plant
    // 事件、图鉴、首种奖励、lastSeedId 联动完全一致（开发铁律：统一模板）。
    // 只负责数据层 + 事件；渲染（renderGrid/关 modal/音效/常规 toast）由调用方做。
    _plantOne(plotIdx, cropId) {
      const plot = Farm.state.data.plots[plotIdx];
      if (!plot || !plot.unlocked || plot.crop) return { ok: false, reason: 'plot_unavailable' };
      // First-plant bonus: gate on a persistent flag, not the
      // cropsEverGrown array, so resetting seeds can't re-trigger.
      const isFirstPlantEver = !Farm.state.data.firstPlantCelebrated;
      const result = Farm.crops.plant(plot, cropId);
      if (!result.ok) return result;
      Farm.state.data.lastSeedId = cropId;   // 「上次种子」置顶数据源
      Farm.state.save();
      // Pass the authoritative "first time in collection" flag (computed in
      // crops.plant BEFORE recordPlant) so the "try a new crop" task counts
      // only genuinely-new crops — not a replant of the most-recent one.
      if (Farm.tasks) Farm.tasks.onEvent('plant', { cropId, isNew: result.isNewToCollection });
      if (isFirstPlantEver) {
        Farm.state.data.firstPlantCelebrated = true;
        if (Farm.track) Farm.track('plant_first');
        Farm.state.addCoins(10);
        Farm.ui.refreshHUD();
        // Replace the usual "已种下" toast with a louder first-time one
        Farm.ui.toast(Farm.i18n.t('toast_first_plant'), 3200);
        // 首次种植：店主提示"等它长大、熟了发光"（晚于首种奖励 toast）
        if (Farm.coach) Farm.coach.fire('first_plant', 3600);
        result.firstPlant = true;
      }
      return result;
    },

    // 种子不够时按现价买 1 颗（沿用 buySeed 的价格与任务联动）。买不起返回 false。
    _buyOneForPlanting(cropId) {
      const def = Farm.crops.get(cropId);
      if (!def) return false;
      const price = (Farm.daily && Farm.daily.discountedSeedCost(cropId)) || def.seed_cost;
      if (!Farm.state.spendCoins(price)) return false;
      Farm.state.addSeed(cropId, 1);
      if (Farm.tasks) Farm.tasks.onEvent('buy_seed', { cropId, cost: price });
      return price;
    },

    // ============ 「种满所有空地」（UX 第 2 批 #1） ============
    // 按所选种子把所有可种空地一次种完；库存不够就现价购买，钱不够种到哪算哪。
    plantAllEmpty(cropId) {
      const lang = Farm.state.data.language;
      const def = Farm.crops.get(cropId);
      if (!def) return;
      const plots = Farm.state.data.plots || [];
      let planted = 0, spent = 0, stoppedNoCoins = false;
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        if (!p || !p.unlocked || p.crop) continue;
        if ((Farm.state.data.seeds[cropId] || 0) <= 0) {
          const price = this._buyOneForPlanting(cropId);
          if (price === false) { stoppedNoCoins = true; break; }
          spent += price;
        }
        const r = this._plantOne(i, cropId);   // 逐块种 → plant 任务事件逐块发
        if (!r.ok) break;
        planted++;
      }
      if (planted === 0) {
        Farm.ui.toast(stoppedNoCoins
          ? Farm.i18n.t('toast_not_enough_coins')
          : (lang === 'en' ? 'No empty plots to plant' : '没有可种的空地'));
        if (Farm.audio) Farm.audio.play('error');
        return;
      }
      Farm.ui.hideModal();
      Farm.farm.renderGrid();
      if (Farm.harvestStatus) Farm.harvestStatus.render();
      if (Farm.isoView && Farm.isoView._on) Farm.isoView.render();
      Farm.ui.refreshHUD();
      if (Farm.audio) Farm.audio.play('plant');
      const coin = '<span class="coin-icon"></span>';
      let msg = lang === 'en'
        ? ('🌱 Planted ' + planted + ' plot' + (planted > 1 ? 's' : ''))
        : ('🌱 已种 ' + planted + ' 块');
      if (spent > 0) msg += lang === 'en' ? (' (seeds cost ' + coin + spent + ')') : ('（买种花费 ' + coin + spent + '）');
      if (stoppedNoCoins) msg += lang === 'en' ? ' · coins ran out' : ' · 农场币不够啦';
      Farm.ui.toast(msg, 3200);
    },

    // ============ 粘性连续种植（UX 第 2 批 #2，Hay Day 式） ============
    // 内存态（不进存档）。激活期间 tap 空地直接种同款；退出条件：tap 非空地/
    // 建筑、打开任何面板（ui.showModal 里挂钩）、8 秒无操作。退出静默不打扰。
    stickyActive() { return !!this._stickySeed; },
    _stickyStart(cropId, hintDelay) {
      this._stickySeed = cropId;
      this._stickyTouch();
      const def = Farm.crops.get(cropId);
      if (!def) return;
      const lang = Farm.state.data.language;
      const name = def[lang === 'en' ? 'name_en' : 'name_zh'];
      // 轻量提示（复用 toast，延迟到「已种下」toast 之后）
      setTimeout(() => {
        if (this._stickySeed !== cropId) return;   // 已退出就别提示了
        Farm.ui.toast(lang === 'en'
          ? ('🌱 Chain planting: ' + name + ' · tap empty plots to keep planting'
            + ' · tap anywhere else to stop')
          : ('🌱 连续种植中：' + name + ' · 点空地连种，点其他地方结束'), 2600);
      }, hintDelay || 0);
    },
    _stickyTouch() {
      clearTimeout(this._stickyTimer);
      this._stickyTimer = setTimeout(() => this.stickyEnd(), 8000);
    },
    stickyEnd() {
      clearTimeout(this._stickyTimer);
      this._stickyTimer = null;
      this._stickySeed = null;
    },
    // tap 空地时由地图视图调用。返回 true = 本次 tap 已被粘性种植消费
    //（不再弹选种器）；false = 粘性未激活/失效，走原选种器流程。
    stickyPlant(plotIdx) {
      const cropId = this._stickySeed;
      if (!cropId) return false;
      const def = Farm.crops.get(cropId);
      if (!def) { this.stickyEnd(); return false; }
      if ((Farm.state.data.seeds[cropId] || 0) <= 0) {
        // 没库存但买得起 → 自动买；钱不够 → toast 并退出粘性
        if (this._buyOneForPlanting(cropId) === false) {
          Farm.ui.toast(Farm.i18n.t('toast_not_enough_coins'));
          if (Farm.audio) Farm.audio.play('error');
          this.stickyEnd();
          return true;   // tap 已消费（给了失败反馈，不再弹选种器）
        }
      }
      const r = this._plantOne(plotIdx, cropId);
      if (!r.ok) { this.stickyEnd(); return false; }
      this._stickyTouch();   // 有操作 → 重置 8 秒退出计时
      Farm.farm.renderGrid();
      if (Farm.harvestStatus) Farm.harvestStatus.render();
      if (Farm.audio) Farm.audio.play('plant');
      Farm.ui.refreshHUD();
      return true;
    },
  };

  // 回访锚点：种下后告诉玩家「几点回来收」，把作物计时器的早中晚节奏
  // 显性化（妈妈+孩子客群不该自己心算 grow_minutes）。1 小时内说分钟，
  // 更长换算成本地钟点 + 中文时段词。
  function readyHint(def) {
    try {
      const lang = Farm.state.data.language;
      const mins = Math.round(def.grow_minutes / (Farm.crops.growMultiplier() || 1));
      if (mins <= 60) {
        return lang === 'en' ? ` · ready in ~${mins} min` : ` · 约 ${mins} 分钟后成熟`;
      }
      const eta = new Date(Date.now() + mins * 60000);
      const h = eta.getHours(), m = eta.getMinutes();
      const mm = (m < 10 ? '0' : '') + m;
      if (lang === 'en') {
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return ` · ready ~${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}${eta.getDate() !== new Date().getDate() ? ' tomorrow' : ''}`;
      }
      const period = h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : '晚上';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const tomorrow = eta.getDate() !== new Date().getDate() ? '明天' : '';
      return ` · 预计${tomorrow}${period} ${h12}:${mm} 成熟，到点来收～`;
    } catch (_) { return ''; }
  }

  function formatMinutes(min) {
    if (min < 60) return min + 'm';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? h + 'h' : h + 'h' + m + 'm';
  }

  window.Farm = window.Farm || {};
  window.Farm.shop = shop;
})();
