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
      /* 2026-08-22：一键卖货没了，谷仓不再需要「给订单留货」这套预留逻辑
         （能动库存的只剩菜摊，单次 ≤3 棵，影响可忽略）。 */
      const reserve = {};
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

      const titleZh = '我的谷仓';   // 与底部 dock「谷仓」同名（2026-08-15 统一叫法）
      const titleEn = 'My Barn';

      let body;
      if (count === 0) {
        body = `<div class="wh-empty">
          <img src="assets/images/warehouse-barn.webp" alt="" width="140" height="100">
          <div class="wh-empty-title">${lang === 'en' ? 'Your barn is empty' : '谷仓空空如也'}</div>
          <div class="wh-empty-hint">${lang === 'en' ? 'Plant and harvest some crops first' : '先去地里种点东西收获吧'}</div>
        </div>`;
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
              <span class="wh-icon">${(Farm.cropArt && Farm.cropArt.icon) ? Farm.cropArt.icon(cropId, 30) : def.icon}</span>
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

        `;
      }

      /* 🔒 2026-08-22：谷仓不再收菜。东方超市只按订单进货（store-demand.js），
         所以这里只剩一个「去看东超要什么」的入口，不再有一键卖光。 */
      const deliverBtn = `<button class="btn wh-deliver-btn" id="whDeliverBtn">📋 ${lang === 'en' ? "See what Eastern Market needs" : '看东超要什么'}</button>`;

      // Expand-warehouse button — always available (not just when full)
      // so eager players can pre-buy capacity.
      const tier = Farm.state.warehouseExpansionTier();
      const expandBtn = tier.atMax
        ? ''
        : `<button class="btn wh-expand-btn" id="whExpandBtn">🏗 ${lang === 'en' ? 'Expand barn to ' : '扩建到 '}${tier.nextCapacity} · ${coin}${tier.cost}</button>`;

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
        deliverEl.onclick = () => { Farm.ui.hideModal(); if (Farm.orders) Farm.orders.open(); };
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
          <div class="wh-full-choice-title">📋 ${lang === 'en' ? "See what Eastern Market needs" : '看东超要什么'}</div>
          <div class="wh-full-choice-sub">${lang === 'en' ? 'Fill an order to free up space' : '交一单就能腾出地方'}</div>
        </button>`;

      const expandBtn = tier.atMax
        ? `<div class="wh-full-maxed">🏆 ${lang === 'en' ? 'Barn is already maxed out' : '谷仓已是最大容量'}</div>`
        : `<button class="btn wh-full-choice wh-full-expand" id="whFullExpand">
            <div class="wh-full-choice-title">🏗 ${lang === 'en' ? 'Expand barn' : '扩建谷仓'}</div>
            <div class="wh-full-choice-sub">${cap} → ${tier.nextCapacity} ${lang === 'en' ? '· cost' : '· 花费'} ${coin}${tier.cost}</div>
          </button>`;

      const html = `
        <h2 class="modal-title">${lang === 'en' ? 'Barn is full!' : '谷仓满了！'}</h2>
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
      if (sellEl) sellEl.onclick = () => { Farm.ui.hideModal(); if (Farm.orders) Farm.orders.open(); };
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
          Farm.ui.toast(lang === 'en' ? '🏆 Barn is already max' : '🏆 已是最大容量', 2200);
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
        ? `🏗 Barn expanded to ${result.newCapacity}! -<span class="coin-icon"></span>${result.cost}`
        : `🏗 谷仓扩到 ${result.newCapacity} 件！-<span class="coin-icon"></span>${result.cost}`, 2800);
    },

    /* 🗑 deliver() 已于 2026-08-22 删除：东方超市不再无限收购。
       谷仓只管存货，卖菜一律走东超的订单板（orders.js）。
       别再加回「一键卖光」——那是这次改动要取消的东西。 */


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
        <img class="warehouse-img" src="assets/images/warehouse-barn.webp" alt="" loading="lazy">
        <span class="warehouse-label">谷仓 / Barn</span>
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
