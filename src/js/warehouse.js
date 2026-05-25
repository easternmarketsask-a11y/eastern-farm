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
      const baseValue = Farm.state.getWarehouseValue();
      const firstOfDay = !Farm.state.data.dailyClaims.firstDeliveryDone;
      const bonus = (count > 0 && firstOfDay) ? Math.round(baseValue * 0.2) : 0;
      const total = baseValue + bonus;
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
          const lineValue = def.sell_price * qty;
          return `
            <div class="wh-row">
              <span class="wh-icon">${def.icon}</span>
              <div class="wh-info">
                <div class="wh-name">${def[nameKey]}</div>
                <div class="wh-sub">${qty} × ${coin}${def.sell_price}</div>
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
          ${bonusLineHtml}
          <div class="wh-total">
            <span class="wh-total-label">${lang === 'en' ? 'Total' : '合计'}</span>
            <span class="wh-total-value">${coin}${total}</span>
          </div>
        `;
      }

      const deliverBtn = count === 0
        ? ''
        : `<button class="btn wh-deliver-btn" id="whDeliverBtn">🚚 ${lang === 'en' ? 'Deliver to Eastern Market' : '送货到东方超市'}</button>`;

      const html = `
        <h2 class="modal-title">${lang === 'en' ? titleEn : titleZh}</h2>
        ${body}
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
          ${deliverBtn}
        </div>
      `;
      Farm.ui.showModal(html);

      const deliverEl = document.getElementById('whDeliverBtn');
      if (deliverEl) {
        deliverEl.onclick = () => this.deliver();
      }
    },

    // Execute the delivery: credit coins + animate + close modal.
    deliver() {
      const lang = Farm.state.data.language;
      const result = Farm.state.deliverWarehouse();
      if (!result.ok) {
        Farm.ui.toast(lang === 'en' ? 'Warehouse is empty' : '仓库是空的');
        return;
      }
      Farm.ui.hideModal();
      Farm.ui.refreshHUD();
      if (Farm.audio) Farm.audio.play('coin');

      // Celebration toast with breakdown
      const coin = '<span class="coin-icon"></span>';
      let msg;
      if (result.firstOfDay && result.bonusCoins > 0) {
        msg = (lang === 'en'
          ? `🚚 Delivered ${result.itemCount} items! +${coin}${result.totalCoins} (incl. 🌅+${coin}${result.bonusCoins} daily bonus)`
          : `🚚 送货 ${result.itemCount} 件！+${coin}${result.totalCoins}（含 🌅 今日首单 +${coin}${result.bonusCoins}）`);
      } else {
        msg = (lang === 'en'
          ? `🚚 Delivered ${result.itemCount} items! +${coin}${result.totalCoins}`
          : `🚚 送货 ${result.itemCount} 件！+${coin}${result.totalCoins}`);
      }
      Farm.ui.toast(msg, 3200);

      // Update the warehouse badge on the topbar / nav
      if (this.refreshBadge) this.refreshBadge();

      // Fire tasks event so future "deliver N times today" tasks can hook
      if (Farm.tasks && Farm.tasks.onEvent) {
        Farm.tasks.onEvent('deliver', { itemCount: result.itemCount, coins: result.totalCoins });
      }
    },

    // Refresh the floating barn button's "14/20" badge after harvest/deliver.
    refreshBadge() {
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

    // Install the floating barn button into the farm view. Called once
    // during main.js boot after the farm grid renders.
    installButton() {
      // Don't double-install
      if (document.getElementById('warehouseBtn')) return;
      const farmEl = document.getElementById('farm');
      if (!farmEl) return;

      const btn = document.createElement('button');
      btn.id = 'warehouseBtn';
      btn.className = 'warehouse-btn';
      btn.setAttribute('aria-label', '仓库 Warehouse');
      btn.innerHTML = `
        <span class="warehouse-icon">📦</span>
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
