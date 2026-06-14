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
      if (Farm.tasks) Farm.tasks.onEvent('buy_seed', { cropId });
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
      const html = `
        <h2 class="modal-title">${Farm.i18n.t('btn_plant')}</h2>
        <p class="modal-subtitle">${lang === 'en' ? 'Choose a seed to plant' : '选择要种的种子'}</p>
        <div class="seed-list">
          ${ownedCropIds.map(id => {
            const c = Farm.crops.get(id);
            if (!c) return '';
            const locked = c.unlock_level > playerLevel;
            const owned = seeds[id] || 0;
            return `
              <div class="seed-card ${locked ? 'locked' : ''}" data-crop-id="${id}" data-action="plant">
                <span class="seed-icon">${cropFace(c)}</span>
                <div>
                  <div class="seed-name">${c[nameKey]}</div>
                  <div class="seed-meta">
                    <span class="seed-sell"><span class="seed-label">${marketPriceLabel}</span><span class="seed-value">${coin}${c.sell_price}</span></span>
                    <span class="seed-time">⏱${formatMinutes(c.grow_minutes)}</span>
                    <span class="seed-owned">× ${owned}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
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
          if (Farm.tasks) Farm.tasks.onEvent('plant', { cropId });

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
            Farm.ui.toast('🌱 ' + def[Farm.state.data.language === 'en' ? 'name_en' : 'name_zh']);
          }
        };
      });
    },
  };

  function formatMinutes(min) {
    if (min < 60) return min + 'm';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? h + 'h' : h + 'h' + m + 'm';
  }

  window.Farm = window.Farm || {};
  window.Farm.shop = shop;
})();
