/**
 * ep-shop.js — Eastern Point shop (decorations, consumables, plot expansion).
 *
 * Items loaded from data/ep-shop.json. Each item has a `kind` that drives
 * the purchase effect (see `_apply` below). Owned consumables stack in
 * state.activeEffects.* counters; decorations get pushed to state.decorations
 * for permanent display.
 *
 * Lottery wheel: weighted-random prize from `_lottery_prizes`. Triggered by
 * the daily free spin (state.dailyClaims.lotterySpunFree) or by spending an
 * acceleration_ticket from inventory.
 */
(function() {
  const shop = {
    items: [],
    lotteryPrizes: [],
    loaded: false,

    async load() {
      try {
        const res = await fetch('../data/ep-shop.json');
        const data = await res.json();
        this.items = data.items || [];
        this.lotteryPrizes = data._lottery_prizes || [];
        this.loaded = true;
      } catch (e) {
        console.error('ep-shop load failed', e);
        this.loaded = true;
      }
    },

    // ============ Purchase flow ============
    canBuy(item) {
      const data = Farm.state.data;
      if (data.eastPoints < item.cost_ep) return { ok: false, reason: 'insufficient_ep' };
      if (item.kind === 'extra_plot' && data.extraPlots >= (item.max_owned || 4)) {
        return { ok: false, reason: 'max_owned' };
      }
      return { ok: true };
    },

    buy(itemId, opts) {
      opts = opts || {};
      const item = this.items.find(i => i.id === itemId);
      if (!item) return { ok: false, reason: 'unknown' };
      const can = this.canBuy(item);
      if (!can.ok) return can;

      // Guard: spendEastPoints can return false if balance was concurrently
      // reduced (e.g. by Firebase pull updating state.eastPoints between
      // canBuy and spend). Without this check, the effect would still apply
      // and the player gets a free item. defense-in-depth.
      const spent = Farm.state.spendEastPoints(item.cost_ep, {
        source: 'ep_shop:' + item.id,
        description: '积分商城: ' + (item.name_zh || item.id),
      });
      if (!spent) return { ok: false, reason: 'insufficient_ep' };
      const effect = this._apply(item, opts);
      Farm.ui.refreshHUD();
      if (Farm.audio) Farm.audio.play('coin');
      return { ok: true, effect, item };
    },

    _apply(item, opts) {
      switch (item.kind) {
        case 'stack_consumable':
          // E.g. acceleration_ticket → state.activeEffects.accelerationCharges++
          Farm.state.data.activeEffects[item.stock_key] =
            (Farm.state.data.activeEffects[item.stock_key] || 0) + 1;
          Farm.state.save();
          return { kind: 'consumable_added', stockKey: item.stock_key };

        case 'festival_seeds':
          // Add 5 random festival seeds
          const festIds = Object.keys(Farm.crops.festivalCrops || {});
          if (festIds.length === 0) return { kind: 'noop' };
          const granted = {};
          for (let i = 0; i < 5; i++) {
            const cid = festIds[Math.floor(Math.random() * festIds.length)];
            Farm.state.addSeed(cid, 1);
            granted[cid] = (granted[cid] || 0) + 1;
          }
          return { kind: 'festival_seeds', granted };

        case 'decoration':
          Farm.state.addDecoration(item.id);
          return { kind: 'decoration_placed', itemId: item.id };

        case 'extra_plot':
          Farm.state.addExtraPlot();
          if (Farm.farm) Farm.farm.renderGrid();
          return { kind: 'plot_added', total: 12 + Farm.state.data.extraPlots };

        case 'instant_spin':
          return this.spinLottery({ source: 'ticket' });

        default:
          return { kind: 'unknown' };
      }
    },

    // ============ Lottery wheel ============
    spinLottery(opts) {
      opts = opts || {};
      const totalWeight = this.lotteryPrizes.reduce((s, p) => s + (p.weight || 1), 0);
      let roll = Math.random() * totalWeight;
      let picked = this.lotteryPrizes[0];
      for (const p of this.lotteryPrizes) {
        roll -= (p.weight || 1);
        if (roll <= 0) { picked = p; break; }
      }

      // Apply prize
      switch (picked.kind) {
        case 'coins':
          Farm.state.addCoins(picked.amount);
          break;
        case 'ep':
          Farm.state.addEastPoints(picked.amount, {
            source: 'lottery_wheel_prize',
            description: 'Lottery wheel EP prize: ' + picked.id,
          });
          break;
        case 'seed_pack':
          // Random unlocked-crop seeds
          const playerLevel = Farm.state.data.level;
          const avail = Farm.crops.all().filter(c => c.unlock_level <= playerLevel);
          if (avail.length > 0) {
            for (let i = 0; i < picked.amount; i++) {
              const c = avail[Math.floor(Math.random() * avail.length)];
              Farm.state.addSeed(c.id, 1);
            }
          }
          break;
        case 'shop_item':
          const tplItem = this.items.find(i => i.id === picked.itemId);
          if (tplItem && tplItem.stock_key) {
            Farm.state.data.activeEffects[tplItem.stock_key] =
              (Farm.state.data.activeEffects[tplItem.stock_key] || 0) + (picked.amount || 1);
            Farm.state.save();
          }
          break;
      }
      Farm.ui.refreshHUD();
      if (Farm.audio) Farm.audio.play(picked.kind === 'ep' && picked.amount >= 100 ? 'achievement' : 'coin');
      return { kind: 'lottery_prize', prize: picked, source: opts.source || 'unknown' };
    },

    // ============ View ============
    open() {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const descKey = lang === 'en' ? 'desc_en' : 'desc_zh';
      const balance = Farm.state.data.eastPoints;

      const groups = { consumable: [], pet: [], decoration: [], upgrade: [] };
      this.items.forEach(it => {
        const cat = it.category || 'consumable';
        if (groups[cat]) groups[cat].push(it);
      });

      const renderItem = (it) => {
        const can = this.canBuy(it);
        const owned = it.kind === 'extra_plot'
          ? Farm.state.data.extraPlots
          : it.stock_key
            ? Farm.state.data.activeEffects[it.stock_key] || 0
            : (it.kind === 'decoration'
                ? Farm.state.data.decorations.filter(d => d.itemId === it.id).length
                : 0);
        const ownedBadge = owned > 0
          ? `<div class="ep-shop-owned">×${owned}</div>` : '';
        const disabled = !can.ok ? 'disabled' : '';
        const buttonLabel = can.ok
          ? `${it.cost_ep} 🎫`
          : (can.reason === 'max_owned' ? (lang === 'en' ? 'MAX' : '已满')
                                         : (lang === 'en' ? 'Not enough' : '积分不足'));
        return `
          <div class="ep-shop-card ${disabled}" data-id="${it.id}">
            ${ownedBadge}
            <div class="ep-shop-icon">${it.icon}</div>
            <div class="ep-shop-name">${it[nameKey]}</div>
            <div class="ep-shop-desc">${it[descKey]}</div>
            <button class="ep-shop-buy" data-buy="${it.id}" ${disabled}>${buttonLabel}</button>
          </div>
        `;
      };

      const sectionLabels = {
        consumable: lang === 'en' ? '⚡ Consumables' : '⚡ 消耗品',
        pet: lang === 'en' ? '🐾 Pets' : '🐾 宠物',
        decoration: lang === 'en' ? '🎍 Decorations' : '🎍 装饰品',
        upgrade: lang === 'en' ? '🏞 Upgrades' : '🏞 升级',
      };

      let body = '';
      Object.keys(groups).forEach(cat => {
        if (groups[cat].length === 0) return;
        body += `<h3 class="ep-shop-section">${sectionLabels[cat]}</h3>`;
        body += `<div class="ep-shop-grid">${groups[cat].map(renderItem).join('')}</div>`;
      });

      const html = `
        <h2 class="modal-title">🛍️ ${lang === 'en' ? 'EP Shop' : '积分商城'}</h2>
        <div class="ep-shop-balance">
          ${lang === 'en' ? 'Your balance' : '余额'}: <strong>🎫 ${balance}</strong>
        </div>
        ${body}
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      // Bind buy buttons
      document.querySelectorAll('[data-buy]').forEach(btn => {
        if (btn.hasAttribute('disabled')) return;
        btn.onclick = (e) => {
          e.stopPropagation();
          const itemId = btn.dataset.buy;
          const r = this.buy(itemId);
          if (!r.ok) {
            Farm.ui.toast(lang === 'en' ? 'Cannot buy' : '无法购买');
            return;
          }
          // Show effect feedback
          this._showPurchaseFeedback(r.item, r.effect);
          // Re-render shop with updated balance
          setTimeout(() => this.open(), 350);
        };
      });
    },

    _showPurchaseFeedback(item, effect) {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      let msg = '';
      switch (effect.kind) {
        case 'consumable_added':
          msg = item.icon + ' ' + item[nameKey] + ' +1';
          break;
        case 'festival_seeds':
          msg = '🌸 ' + (lang === 'en' ? 'Festival seeds added!' : '节日种子已入库！');
          break;
        case 'decoration_placed':
          msg = item.icon + ' ' + (lang === 'en' ? 'Placed on your farm!' : '已摆放到农场！');
          break;
        case 'plot_added':
          msg = '🏞 ' + (lang === 'en' ? 'Plot unlocked! Total: ' + effect.total : '新地块解锁！共 ' + effect.total + ' 块');
          break;
        case 'lottery_prize':
          const prize = effect.prize;
          msg = '🎁 ' + (lang === 'en' ? prize.label_en : prize.label_zh);
          break;
        default:
          msg = '✅ ' + item[nameKey];
      }
      Farm.ui.toast(msg, 2500);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.epShop = shop;
})();
