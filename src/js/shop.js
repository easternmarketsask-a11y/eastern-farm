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
      Farm.ui.toast('🌱 +1 ' + def[Farm.state.data.language === 'en' ? 'name_en' : 'name_zh']);
      if (Farm.audio) Farm.audio.play('buy');
      // Refresh shop UI inline
      this.open();
      // cost 供周任务 spend_coins 计数（真实花费，含特价折扣）
      if (Farm.tasks) Farm.tasks.onEvent('buy_seed', { cropId, cost: price });
    },

    // ============ Plant flow ============
    openSeedPickerForPlot(plotIdx) {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const seeds = Farm.state.data.seeds;
      const playerLevel = Farm.state.data.level;
      const ownedCropIds = Object.keys(seeds).filter(id => seeds[id] > 0);

      if (ownedCropIds.length === 0) {
        // Auto-open shop
        Farm.ui.toast(Farm.i18n.t('toast_not_enough_seeds'));
        setTimeout(() => this.open(), 600);
        return;
      }

      const coin = '<span class="coin-icon"></span>';
      // Plant picker — different context, different label. Show ONLY the
      // market purchase price (what Eastern Market will pay for the
      // harvested crop), reinforcing the brand connection too.
      const marketPriceLabel = lang === 'en' ? 'Market price' : '市场收购价';
      const renderCard = (id) => {
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
        return `
          <div class="seed-card ${locked ? 'locked' : ''}" data-crop-id="${id}" data-action="plant">
            <span class="seed-icon">${cropFace(c)}</span>
            <div>
              <div class="seed-name">${c[nameKey]}</div>
              <div class="seed-meta">
                <span class="seed-sell"><span class="seed-label">${marketPriceLabel}</span>${priceHtml}</span>
                <span class="seed-time">⏱${formatMinutes(c.grow_minutes)}</span>
                <span class="seed-owned">× ${owned}</span>
              </div>
            </div>
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
      const sorted = ownedCropIds
        .map(id => Farm.crops.get(id)).filter(Boolean)
        .sort((a, b) => a.grow_minutes - b.grow_minutes);
      let lastGroup = -1;
      const listHtml = sorted.map(c => {
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

      document.getElementById('goToShopBtn').onclick = () => this.open();

      document.querySelectorAll('.seed-card[data-action="plant"]').forEach(card => {
        if (card.classList.contains('locked')) return;
        card.onclick = () => {
          const cropId = card.dataset.cropId;
          const plot = Farm.state.data.plots[plotIdx];
          // First-plant bonus: gate on a persistent flag, not the
          // cropsEverGrown array, so resetting seeds can't re-trigger.
          const isFirstPlantEver = !Farm.state.data.firstPlantCelebrated;
          const result = Farm.crops.plant(plot, cropId);
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
          } else {
            Farm.ui.toast('🌱 ' + def[Farm.state.data.language === 'en' ? 'name_en' : 'name_zh']
              + readyHint(def), 3200);
          }
        };
      });
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
