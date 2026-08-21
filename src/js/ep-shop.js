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
    // Items priced with `cost_coins` are bought with 农场币; otherwise `cost_ep`
    // (超市积分). Returns { amount, currency: 'coins' | 'ep' }.
    priceOf(item) {
      // 扩地（农场币入口）走单一递增定价源，与 iso 建造面板同价（B5 地块统一）。
      if (item.kind === 'extra_plot' && item.cost_coins != null && Farm.state.extraPlotCoinCost) {
        return { amount: Farm.state.extraPlotCoinCost(), currency: 'coins' };
      }
      if (item.cost_coins != null) return { amount: item.cost_coins, currency: 'coins' };
      return { amount: item.cost_ep || 0, currency: 'ep' };
    },

    // 今日购买计数（自复位、懒创建，不进 STARTER/dailyClaims 三处重建面——与
    // orderEp/kitchen/stealGrace 同模式）。仅对带 daily_buy_cap 的消耗品生效。
    _dailyBuys() {
      const d = Farm.state.data;
      const today = Farm.state.getDateString();
      if (!d.shopDailyBuys || d.shopDailyBuys.date !== today) d.shopDailyBuys = { date: today, counts: {} };
      return d.shopDailyBuys;
    },
    boughtToday(itemId) { return this._dailyBuys().counts[itemId] || 0; },
    dailyCapLeft(item) {
      if (!item || item.daily_buy_cap == null) return Infinity;
      return Math.max(0, item.daily_buy_cap - this.boughtToday(item.id));
    },

    canBuy(item) {
      const data = Farm.state.data;
      // 等级解锁（2026-08-14 商城扩充）：高档商品随等级逐步开放，
      // 给商城一条「往上看」的进度线。放最前——没到级连价格都不用比。
      if (item.min_level != null && (data.level || 1) < item.min_level) {
        return { ok: false, reason: 'level_locked' };
      }
      // 限购件数（拖拉机/奶牛这类 prestige 单品 ×1 = 稀缺感）。
      // extra_plot 的帽子在下面单独算，这里只管装饰/宠物。
      if (item.max_owned != null && item.kind === 'decoration'
          && this._ownedCount(item) >= item.max_owned) {
        return { ok: false, reason: 'max_owned' };
      }
      const price = this.priceOf(item);
      const balance = price.currency === 'coins' ? data.coins : data.eastPoints;
      if (balance < price.amount) {
        return { ok: false, reason: price.currency === 'coins' ? 'insufficient_coins' : 'insufficient_ep' };
      }
      const cap = (Farm.state.EXTRA_PLOT_CAP != null) ? Farm.state.EXTRA_PLOT_CAP : (item.max_owned || 4);
      if (item.kind === 'extra_plot' && data.extraPlots >= cap) {
        return { ok: false, reason: 'max_owned' };
      }
      // 每日限购（催熟剂/化肥）：封住「无限购 = 印钞」循环，保留新手期爽感。
      if (item.daily_buy_cap != null && this.dailyCapLeft(item) <= 0) {
        return { ok: false, reason: 'daily_cap' };
      }
      return { ok: true };
    },

    buy(itemId, opts) {
      opts = opts || {};
      const item = this.items.find(i => i.id === itemId);
      if (!item) return { ok: false, reason: 'unknown' };
      const can = this.canBuy(item);
      if (!can.ok) return can;

      // Guard: spend can return false if the balance was concurrently reduced
      // (e.g. a Firebase pull updating state between canBuy and spend). Without
      // this the effect would still apply and the player gets a free item.
      const price = this.priceOf(item);
      const spent = price.currency === 'coins'
        ? Farm.state.spendCoins(price.amount)
        : Farm.state.spendEastPoints(price.amount, {
            source: 'ep_shop:' + item.id,
            description: '农场商城兑换 / Farm shop: ' + (item.name_zh || item.id) + (item.name_en ? ' / ' + item.name_en : ''),
          });
      if (!spent) return { ok: false, reason: price.currency === 'coins' ? 'insufficient_coins' : 'insufficient_ep' };
      const effect = this._apply(item, opts);
      // 记一笔今日购买（仅限带 daily_buy_cap 的品）。
      if (item.daily_buy_cap != null) {
        const db = this._dailyBuys();
        db.counts[item.id] = (db.counts[item.id] || 0) + 1;
        Farm.state.save();
      }
      Farm.ui.refreshHUD();
      if (Farm.audio) Farm.audio.play('coin');
      return { ok: true, effect, item };
    },

    _apply(item, opts) {
      switch (item.kind) {
        case 'stack_consumable':
          // E.g. acceleration_ticket → state.activeEffects.accelerationCharges++
          // item.amount 支持礼包装（×5 捆）一次加多张（2026-08-14 商城扩充）。
          Farm.state.data.activeEffects[item.stock_key] =
            (Farm.state.data.activeEffects[item.stock_key] || 0) + (item.amount || 1);
          Farm.state.save();
          return { kind: 'consumable_added', stockKey: item.stock_key, amount: (item.amount || 1) };

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
          // 买的是小动物 → 走动小动物开关自动打开（2026-08-15）。商城文案承诺
          //「在农场里蹦蹦跳跳」，付了钱却因为默认关闭什么都看不到，等于白买。
          if (item.category === 'pet') Farm.state.data.petsEnabled = true;
          // Re-render the decoration layer so the new item shows on the farm
          // immediately (otherwise it only appears after the next renderGrid).
          if (Farm.farm && Farm.farm.renderDecorations) Farm.farm.renderDecorations();
          return { kind: 'decoration_placed', itemId: item.id };

        case 'extra_plot':
          Farm.state.addExtraPlot();
          if (Farm.farm) Farm.farm.renderGrid();
          if (Farm.isoView && Farm.isoView._on) Farm.isoView.render();
          return { kind: 'plot_added', total: (Farm.state.data.plots || []).length };

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
            description: '大转盘积分奖 / Lottery wheel prize: ' + picked.id,
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
    _shopTab: 'consumable',   // 当前分类 tab

    // 精选/卖点徽章（按 item id，纯展示，制造购买欲望）。
    _itemTag(id, lang) {
      const T = {
        fertilizer_pro:      { zh: '🔥 热门', en: '🔥 Hot',   c: '#e8522a' },
        extra_plot_coins:    { zh: '⭐ 推荐', en: '⭐ Best',  c: '#3a8c50' },
        extra_plot:          { zh: '⭐ 推荐', en: '⭐ Best',  c: '#3a8c50' },
        guard_dog:           { zh: '🛡 护院', en: '🛡 Guard', c: '#5a7a2e' },
        acceleration_ticket: { zh: '⚡ 超值', en: '⚡ Value', c: '#d68f00' },
        festival_seed_pack:  { zh: '🌸 限定', en: '🌸 Ltd',   c: '#c0556a' },
      };
      const t = T[id];
      return t ? { text: lang === 'en' ? t.en : t.zh, color: t.c } : null;
    },

    /* 卡片图标：有手绘走动贴图的宠物直接用贴图（买到手在农场里就是这个样子，
       别让 emoji 小鸡变成画出来的母鸡）；其余仍用 emoji。表与 mapview-iso.ANIMALS 同源。 */
    _iconHtml(it) {
      const SPR = { pet_chick: 'animal_chicken', pet_cat: 'animal_cat', pet_rabbit: 'animal_rabbit', decoration_dog: 'animal_dog', guard_dog: 'animal_dog' };
      const f = SPR[it.id];
      if (!f) return it.icon;
      return '<img src="assets/images/map/' + f + '.webp" alt="" style="width:46px;height:46px;object-fit:contain;display:block;margin:0 auto;"/>';
    },
    _ownedCount(it) {
      if (it.kind === 'extra_plot') return Farm.state.data.extraPlots || 0;
      if (it.stock_key) return Farm.state.data.activeEffects[it.stock_key] || 0;
      if (it.kind === 'decoration') return Farm.state.data.decorations.filter(d => d.itemId === it.id).length;
      return 0;
    },

    _cardHtml(it, lang) {
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const descKey = lang === 'en' ? 'desc_en' : 'desc_zh';
      const can = this.canBuy(it);
      const owned = this._ownedCount(it);
      const ownedBadge = owned > 0 ? `<div class="ep-shop-owned">×${owned}</div>` : '';
      const tag = this._itemTag(it.id, lang);
      const tagBadge = tag ? `<div class="ep-shop-tag" style="background:${tag.color};">${tag.text}</div>` : '';
      const price = this.priceOf(it);
      const curIcon = price.currency === 'coins' ? 'coin-icon' : 'points-icon';
      const affordable = can.ok;
      const btnCls = affordable ? 'ep-shop-buy' : 'ep-shop-buy ep-shop-buy--off';
      const buttonLabel = affordable
        ? `${price.amount} <span class="${curIcon}"></span>`
        : (can.reason === 'max_owned' ? (lang === 'en' ? '✓ MAX' : '✓ 已满')
          : can.reason === 'daily_cap' ? (lang === 'en' ? 'Daily max' : '今日已满')
          : can.reason === 'level_locked' ? (lang === 'en' ? `Lv ${it.min_level}` : `Lv ${it.min_level} 解锁`)
                                       : `${price.amount} <span class="${curIcon}"></span>`);
      const dis = affordable ? '' : 'disabled';
      const cat = it.category || 'consumable';
      // 每日限购品：显示今日剩余次数，让玩家一眼知道额度（而非买到才发现被拦）。
      const capNote = (it.daily_buy_cap != null)
        ? `<div class="ep-shop-cap-note" style="font-size:11px;color:var(--warm-text-soft,#9a8f7d);margin-top:2px;">${lang === 'en'
            ? ('Today: ' + this.dailyCapLeft(it) + '/' + it.daily_buy_cap + ' left')
            : ('今日剩 ' + this.dailyCapLeft(it) + '/' + it.daily_buy_cap)}</div>`
        : '';
      return `
        <div class="ep-shop-card cat-${cat} ${affordable ? '' : 'disabled'}" data-id="${it.id}">
          ${tagBadge}${ownedBadge}
          <div class="ep-shop-icon cat-${cat}">${this._iconHtml(it)}</div>
          <div class="ep-shop-name">${it[nameKey]}</div>
          <div class="ep-shop-desc">${it[descKey]}</div>
          ${capNote}
          <button class="${btnCls}" data-buy="${it.id}" ${dis}>${buttonLabel}</button>
        </div>`;
    },

    open(tab) {
      if (Farm.shop && Farm.shop.open) {
        Farm.shop.open(tab || 'consumable');
        return;
      }
      const lang = Farm.state.data.language;
      const EN = lang === 'en';
      if (tab) this._shopTab = tab;
      const coins = (Farm.state.data.coins || 0).toLocaleString();
      const balance = (Farm.state.data.eastPoints || 0).toLocaleString();

      const groups = { consumable: [], decoration: [], pet: [], upgrade: [] };
      this.items.forEach(it => {
        const cat = it.category || 'consumable';
        if (groups[cat]) groups[cat].push(it);
      });
      const tabs = [
        { key: 'consumable', icon: '⚡', zh: '道具',  en: 'Items' },
        { key: 'decoration', icon: '🎍', zh: '装饰',  en: 'Decor' },
        { key: 'pet',        icon: '🐾', zh: '宠物',  en: 'Pets' },
        { key: 'upgrade',    icon: '🏞', zh: '扩建',  en: 'Expand' },
      ].filter(t => (groups[t.key] || []).length > 0);
      if (!tabs.some(t => t.key === this._shopTab)) this._shopTab = (tabs[0] || {}).key || 'consumable';

      const tabsHtml = tabs.map(t => `
        <button class="ep-shop-tab ${t.key === this._shopTab ? 'active' : ''}" data-shop-tab="${t.key}">
          <span class="ep-shop-tab-icon">${t.icon}</span>${EN ? t.en : t.zh}
        </button>`).join('');

      const list = groups[this._shopTab] || [];
      const grid = list.length
        ? `<div class="ep-shop-grid">${list.map(it => this._cardHtml(it, lang)).join('')}</div>`
        : `<div class="ef-empty"><div class="ef-empty-icon">🌱</div><div class="ef-empty-title">${EN ? 'Nothing here yet' : '这里还是空的'}</div><div class="ef-empty-hint">${EN ? 'Check another shelf' : '换个分类看看'}</div></div>`;

      const html = `
        <h2 class="modal-title">${EN ? 'Farm Shop' : '农场商城'}</h2>
        <div class="ep-shop-balance">
          <span class="ep-shop-bal-chip coins"><span class="coin-icon"></span> ${coins}</span>
          <span class="ep-shop-bal-chip points"><span class="points-icon"></span> ${balance}</span>
        </div>
        <div class="ep-shop-tabs">${tabsHtml}</div>
        <div id="epShopBody">${grid}</div>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn secondary" onclick="Farm.ui.hideModal()" style="width:100%;">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      if (Farm.audio) Farm.audio.play('tap');

      // Tab switch (re-render in place)
      document.querySelectorAll('[data-shop-tab]').forEach(btn => {
        btn.onclick = () => { if (Farm.audio) Farm.audio.play('tap'); this.open(btn.dataset.shopTab); };
      });

      // Buy buttons
      document.querySelectorAll('[data-buy]').forEach(btn => {
        if (btn.hasAttribute('disabled')) return;
        btn.onclick = (e) => {
          e.stopPropagation();
          const r = this.buy(btn.dataset.buy);
          if (!r.ok) {
            Farm.ui.toast(r.reason === 'insufficient_coins' || r.reason === 'insufficient_ep'
              ? (EN ? 'Not enough coins or points' : '余额不足')
              : r.reason === 'daily_cap'
                ? (EN ? 'Daily purchase limit reached' : '今日购买次数已满')
              : (EN ? 'Cannot buy' : '无法购买'), 2400);
            if (Farm.audio) Farm.audio.play('error');
            return;
          }
          this._showPurchaseFeedback(r.item, r.effect);
          setTimeout(() => this.open(), 350);   // 保持当前 tab
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
