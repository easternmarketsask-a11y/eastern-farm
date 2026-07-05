/**
 * warehouse.js — Eastern Market仓库 (Warehouse / Silo) UI.
 *
 * Harvested crops go into state.warehouse (see state.js addToWarehouse).
 * Player opens this panel to deliver everything to Eastern Market for
 * coins. First delivery of the day gets +20% bonus to encourage daily
 * play without punishing those who don't.
 *
 * No spoilage — Eastern Market only buys quality produce.
 *
 * Capacity-limited: when full, Farm.crops.harvest() blocks new harvests
 * (so player has to come deliver). Default capacity = 20.
 */
(function () {
  const warehouse = {

    // Open the warehouse modal: summary table of held crops + estimated
    // total value + "deliver" button with bonus indicator.
    open() {
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const wh = Farm.state.data.warehouse || [];
      const capacity = Farm.state.data.warehouseCapacity || 20;
      const count = wh.length;
      const summary = Farm.state.getWarehouseSummary();
      // 「给小东留着」：订单板需要的数量不会被一键卖货卖掉（deliverWarehouse
      // 同一逻辑）——面板展示的合计只算真正会卖出的部分，避免虚报。
      const reserve = (Farm.orders && Farm.orders.reservedNeeds) ? Farm.orders.reservedNeeds() : {};
      let reservedCount = 0;
      let sellValue = 0;
      Object.keys(summary).forEach(cropId => {
        const def = Farm.crops.get(cropId);
        if (!def) return;
        const keepQty = Math.min(summary[cropId], reserve[cropId] || 0);
        reservedCount += keepQty;
        const unitP = Farm.crops.sellPriceOf ? Farm.crops.sellPriceOf(def) : def.sell_price;
        sellValue += unitP * (summary[cropId] - keepQty);
      });
      const firstOfDay = !Farm.state.data.dailyClaims.firstDeliveryDone;
      const bonus = (count > 0 && firstOfDay) ? Math.round(sellValue * 0.2) : 0;
      const total = sellValue + bonus;
      const coin = '<span class="coin-icon"></span>';

      const titleZh = '📦 我的仓库';
      const titleEn = '📦 My Warehouse';
      const emptyZh = '仓库空空如也<br><span style="font-size:12px;color:var(--warm-text-soft);">先去地里种点东西收获吧</span>';
      const emptyEn = 'Your warehouse is empty<br><span style="font-size:12px;color:var(--warm-text-soft);">Plant + harvest some crops first</span>';

      let body;
      if (count === 0) {
        body = `<div style="text-align:center;padding:30px 16px;font-size:14px;line-height:1.6;color:var(--warm-text);">${lang === 'en' ? emptyEn : emptyZh}</div>`;
      } else {
        // List unique crops with their counts + sell value
        const rows = Object.keys(summary).map(cropId => {
          const def = Farm.crops.get(cropId);
          if (!def) return '';
          const qty = summary[cropId];
          // 应季 +15%：展示价与 getWarehouseValue 的结算价同源（sellPriceOf）
          const unit = Farm.crops.sellPriceOf ? Farm.crops.sellPriceOf(def) : def.sell_price;
          const inSeason = Farm.crops.isInSeason && Farm.crops.isInSeason(def);
          const seasonTag = inSeason
            ? ` <span class="season-tag">${Farm.crops.seasonEmoji()}${lang === 'en' ? 'In season +15%' : '应季 +15%'}</span>`
            : '';
          const lineValue = unit * qty;
          const keepQty = Math.min(qty, reserve[cropId] || 0);
          const keptNote = keepQty > 0
            ? ` <span style="color:var(--leaf-dark);font-weight:700;">🛒${lang === 'en' ? 'keep ' : '留'}${keepQty}</span>`
            : '';
          return `
            <div class="wh-row">
              <span class="wh-icon">${def.icon}</span>
              <div class="wh-info">
                <div class="wh-name">${def[nameKey]}${seasonTag}</div>
                <div class="wh-sub">${qty} × ${coin}${unit}${keptNote}</div>
              </div>
              <div class="wh-line-value">${coin}${lineValue}</div>
            </div>
          `;
        }).join('');

        const bonusLineHtml = bonus > 0
          ? `<div class="wh-bonus-line">
               <span class="wh-bonus-badge">🌅 ${lang === 'en' ? 'Daily 1st delivery' : '今日首单'} +20%</span>
               <span class="wh-bonus-value">+${coin}${bonus}</span>
             </div>`
          : '';

        body = `
          <div class="wh-cap">
            <span>${lang === 'en' ? 'Storage' : '容量'}: <strong>${count}/${capacity}</strong></span>
            ${count >= capacity ? `<span style="color:var(--barn-red);font-weight:700;">${lang === 'en' ? 'FULL' : '已满'}</span>` : ''}
          </div>
          <div class="wh-list">${rows}</div>
          ${reservedCount > 0
            ? `<div style="font-size:12px;color:var(--warm-text-soft);padding:6px 4px 0;">🛒 ${lang === 'en'
                ? `${reservedCount} item(s) reserved for 小东's orders — won't be sold`
                : `已为小东订单留 ${reservedCount} 件，一键卖货不会卖掉`}</div>`
            : ''}
          ${bonusLineHtml}
          <div class="wh-total">
            <span class="wh-total-label">${lang === 'en' ? 'Sell now for' : '本次可卖'}</span>
            <span class="wh-total-value">${coin}${total}</span>
          </div>
        `;
      }

      const deliverBtn = count === 0
        ? ''
        : `<button class="btn wh-deliver-btn" id="whDeliverBtn">🏪 ${lang === 'en' ? 'Sell to Eastern Market' : '卖给东方超市'}</button>`;

      // Expand-warehouse button — always available (not just when full)
      // so eager players can pre-buy capacity.
      const tier = Farm.state.warehouseExpansionTier();
      const expandBtn = tier.atMax
        ? ''
        : `<button class="btn wh-expand-btn" id="whExpandBtn">🏗 ${lang === 'en' ? 'Expand silo to ' : '扩建到 '}${tier.nextCapacity} · ${coin}${tier.cost}</button>`;

      const html = `
        <h2 class="modal-title">${lang === 'en' ? titleEn : titleZh}</h2>
        ${body}
        <div class="btn-row" style="margin-top:14px;">
          ${deliverBtn || `<button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>`}
        </div>
        ${expandBtn ? `<div style="margin-top:8px;text-align:center;">${expandBtn}</div>` : ''}
      `;
      Farm.ui.showModal(html);

      const deliverEl = document.getElementById('whDeliverBtn');
      if (deliverEl) {
        deliverEl.onclick = () => this.deliver();
      }
      const expandEl = document.getElementById('whExpandBtn');
      if (expandEl) {
        expandEl.onclick = () => this._tryExpand();
      }
    },

    // Special dialog shown when player tries to harvest but warehouse is
    // full. Offers 2 explicit choices instead of just a toast: sell now
    // (clear silo) OR expand capacity (spend coins).
    openFullDialog() {
      const lang = Farm.state.data.language;
      const coin = '<span class="coin-icon"></span>';
      const tier = Farm.state.warehouseExpansionTier();
      const value = Farm.state.getWarehouseValue();
      const cap = Farm.state.data.warehouseCapacity || 20;

      const sellBtn = `
        <button class="btn wh-full-choice wh-full-sell" id="whFullSell">
          <div class="wh-full-choice-title">🏪 ${lang === 'en' ? 'Sell to Eastern Market' : '卖给东方超市'}</div>
          <div class="wh-full-choice-sub">${lang === 'en' ? 'Get' : '得到'} ${coin}${value}${lang === 'en' ? ' now + free silo space' : '，仓库立刻清空'}</div>
        </button>`;

      const expandBtn = tier.atMax
        ? `<div class="wh-full-maxed">🏆 ${lang === 'en' ? 'Silo is already maxed out' : '仓库已是最大容量'}</div>`
        : `<button class="btn wh-full-choice wh-full-expand" id="whFullExpand">
            <div class="wh-full-choice-title">🏗 ${lang === 'en' ? 'Expand silo' : '扩建仓库'}</div>
            <div class="wh-full-choice-sub">${cap} → ${tier.nextCapacity} ${lang === 'en' ? '· cost' : '· 花费'} ${coin}${tier.cost}</div>
          </button>`;

      const html = `
        <h2 class="modal-title">📦 ${lang === 'en' ? 'Silo is full!' : '仓库满了！'}</h2>
        <p class="modal-subtitle">${lang === 'en'
          ? 'Pick one to keep harvesting:'
          : '挑一个继续收割:'}</p>
        <div class="wh-full-choices">
          ${sellBtn}
          ${expandBtn}
        </div>
      `;
      Farm.ui.showModal(html);

      const sellEl = document.getElementById('whFullSell');
      if (sellEl) sellEl.onclick = () => this.deliver();
      const expandEl = document.getElementById('whFullExpand');
      if (expandEl) expandEl.onclick = () => this._tryExpand();
    },

    _tryExpand() {
      const lang = Farm.state.data.language;
      const result = Farm.state.expandWarehouse();
      if (!result.ok) {
        if (result.reason === 'insufficient_coins') {
          Farm.ui.toast(lang === 'en' ? '🪙 Not enough farm coins' : '🪙 农场币不够', 2200);
        } else if (result.reason === 'at_max') {
          Farm.ui.toast(lang === 'en' ? '🏆 Silo is already max' : '🏆 已是最大容量', 2200);
        }
        if (Farm.audio) Farm.audio.play('error');
        return;
      }
      Farm.ui.hideModal();
      Farm.ui.refreshHUD();
      this.refreshBadge();
      if (Farm.harvestStatus) Farm.harvestStatus.render();
      if (Farm.audio) Farm.audio.play('achievement');
      Farm.ui.toast(lang === 'en'
        ? `🏗 Silo expanded to ${result.newCapacity}! -<span class="coin-icon"></span>${result.cost}`
        : `🏗 仓库扩到 ${result.newCapacity} 件！-<span class="coin-icon"></span>${result.cost}`, 2800);
    },

    // Execute the delivery: credit coins + animate + close modal.
    deliver() {
      const lang = Farm.state.data.language;
      const result = Farm.state.deliverWarehouse();
      if (!result.ok) {
        if (result.reason === 'all_reserved') {
          Farm.ui.toast(lang === 'en'
            ? '🛒 Everything in the silo is reserved for 小东\'s orders — deliver them instead!'
            : '🛒 仓库里的菜都是给小东订单留的，去交订单更划算！', 3200);
        } else {
          Farm.ui.toast(lang === 'en' ? 'Warehouse is empty' : '仓库是空的');
        }
        return;
      }
      Farm.ui.hideModal();
      // Juice (2026-06-11): coins fly from screen center up to the HUD
      // counter, THEN the number ticks up — sell feels like real money moving.
      if (Farm.ui.flyCoins) {
        Farm.ui.flyCoins(window.innerWidth / 2, window.innerHeight * 0.45,
          Math.min(10, Math.max(4, result.itemCount)));
        setTimeout(() => Farm.ui.refreshHUD(), 300);
      } else {
        Farm.ui.refreshHUD();
      }
      if (Farm.audio) Farm.audio.play('coin');

      // Celebration toast with breakdown
      const coin = '<span class="coin-icon"></span>';
      let msg;
      if (result.firstOfDay && result.bonusCoins > 0) {
        msg = (lang === 'en'
          ? `🏪 Sold ${result.itemCount} items to Eastern Market! +${coin}${result.totalCoins} (incl. 🌅+${coin}${result.bonusCoins} daily bonus)`
          : `🏪 卖给东方超市 ${result.itemCount} 件！+${coin}${result.totalCoins}（含 🌅 今日首单 +${coin}${result.bonusCoins}）`);
      } else {
        msg = (lang === 'en'
          ? `🏪 Sold ${result.itemCount} items to Eastern Market! +${coin}${result.totalCoins}`
          : `🏪 卖给东方超市 ${result.itemCount} 件！+${coin}${result.totalCoins}`);
      }
      Farm.ui.toast(msg, 3200);

      // Update the warehouse badge on the topbar / nav
      if (this.refreshBadge) this.refreshBadge();
      // Silo emptied → 小东 orders are no longer fillable; refresh his badge
      if (Farm.orders && Farm.orders.refreshBadge) Farm.orders.refreshBadge();
      // Silo now has room → clear any "仓库满了" state on the harvest bar.
      if (Farm.harvestStatus) Farm.harvestStatus.render();

      // Fire tasks event so future "deliver N times today" tasks can hook
      if (Farm.tasks && Farm.tasks.onEvent) {
        Farm.tasks.onEvent('deliver', { itemCount: result.itemCount, coins: result.totalCoins });
      }
      // 首次卖货：解释赚币 + 首单加成（晚于卖货庆祝 toast）
      if (Farm.coach) Farm.coach.fire('first_sell', 2000);
      // 漏斗:首次卖货(totalDeliveries 刚自增到 1)
      if (Farm.track && (Farm.state.data.totalDeliveries || 0) === 1) Farm.track('sell_first');
      // 游客刚赚到第一笔 = 最佳转化时机：一次性引导登录(领礼包+云端存档)。
      if (Farm.loginNudge) Farm.loginNudge.maybe();
    },

    // Refresh the floating barn button's "14/20" badge after harvest/deliver.
    refreshBadge() {
      // dock 谷仓钮的将满/满仓点同步刷新（收获/卖货后立即，不等 2s 轮询）。
      // 放在 warehouseBtn 早退之前——iso 视图下经典农场的浮动谷仓钮可能不在 DOM。
      if (Farm.ui && Farm.ui.refreshDockDots) Farm.ui.refreshDockDots();
      const btn = document.getElementById('warehouseBtn');
      if (!btn) return;
      const wh = Farm.state.data.warehouse || [];
      const cap = Farm.state.data.warehouseCapacity || 20;
      const count = wh.length;
      const badge = btn.querySelector('.warehouse-badge');
      if (badge) {
        badge.textContent = count + '/' + cap;
        badge.classList.toggle('full', count >= cap);
      }
    },

    // Install the warehouse barn into the farm view, positioned BELOW
    // the farm grid. Was previously a floating circle in the top-right
    // corner; redesigned as a recognizable barn building so it feels
    // like part of the farm layout.
    installButton() {
      if (document.getElementById('warehouseBtn')) return;
      const farmEl = document.getElementById('farm');
      if (!farmEl) return;

      const btn = document.createElement('button');
      btn.id = 'warehouseBtn';
      btn.className = 'warehouse-btn';
      btn.setAttribute('aria-label', '仓库 Warehouse');
      // 真插画谷仓（Gemini「快乐仓库」按轮廓抠图，透明底）——直接坐在
      // 草地上像一座真建筑，配 CSS 地面椭圆影自然融入农场。
      btn.innerHTML = `
        <img class="warehouse-img" src="assets/images/warehouse-barn.png" alt="">
        <span class="warehouse-label">仓库 / Warehouse</span>
        <span class="warehouse-badge">0/20</span>
      `;
      btn.onclick = () => {
        if (Farm.audio) Farm.audio.play('tap');
        this.open();
      };
      farmEl.appendChild(btn);
      this.refreshBadge();
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.warehouse = warehouse;
})();
