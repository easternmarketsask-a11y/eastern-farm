/**
 * orders.js — 小东订单板 / Eastern Market Order Board (Hay Day-style).
 *
 * 小东 (the storekeeper NPC) posts a rotating board of 3 orders. Each order
 * asks for a few specific crops; the player delivers them FROM the warehouse
 * for a COIN PREMIUM (~1.5× bulk-sell value) + XP, and occasionally a little
 * 超市积分. This is the core "grow variety on purpose" loop:
 *
 *   harvest → warehouse → 小东 wants these → deliver → coins+XP (+EP) → repeat
 *
 * Why this drives engagement (the "建造/种植欲望" lever Chris asked for):
 *   - orders pay MORE than dumping the silo, and the card shows "多赚 +N"
 *   - bigger/multi-crop orders pay disproportionately more → grow variety
 *   - a green "全部可交付" state + badge on 小东 nudge the return visit
 *
 * Currency discipline (per project rules): COINS are the main reward and are
 * abundant; 超市积分 stays SCARCE — only ~1 in 4 orders grant any, and order
 * EP is hard-capped per day (ORDER_EP_DAILY_CAP) so it can't be farmed.
 *
 * No timers / no pressure (cozy): a delivered slot refills immediately, and
 * any order can be swapped for a fresh one for free (换一单) — there's no
 * exploit because rewards still require actually growing + delivering crops.
 */
(function () {
  const ORDER_SLOTS = 3;
  const COIN_PREMIUM = 1.5;        // orders pay 1.5× the bulk warehouse value
  const ORDER_EP_DAILY_CAP = 4;    // max 超市积分 earnable from orders per day

  const orders = {

    // ---- daily EP cap bookkeeping (self-resetting, no daily-reset coupling) ----
    _epState() {
      const d = Farm.state.data;
      const today = Farm.state.getDateString();
      if (!d.orderEp || d.orderEp.date !== today) d.orderEp = { date: today, earned: 0 };
      return d.orderEp;
    },
    _epRemainingToday() {
      return Math.max(0, ORDER_EP_DAILY_CAP - this._epState().earned);
    },

    // Candidate crops an order can ask for: unlocked at the player's level.
    // Prefer crops the player has actually grown so requests feel relevant;
    // fall back to all unlocked if they've grown very few.
    _candidatePool() {
      const lvl = Farm.state.data.level || 1;
      const unlocked = Farm.crops.all().filter(c => (c.unlock_level || 1) <= lvl);
      if (unlocked.length === 0) return [];
      const grown = Farm.state.data.cropsEverGrown || [];
      const grownUnlocked = unlocked.filter(c => grown.includes(c.id));
      // Use grown set once it's varied enough to make interesting orders,
      // otherwise everything unlocked (so brand-new players still get orders).
      return grownUnlocked.length >= 2 ? grownUnlocked : unlocked;
    },

    _rand(n) { return Math.floor(Math.random() * n); },

    // Build one fresh order from the candidate pool.
    _makeOrder() {
      const pool = this._candidatePool();
      if (pool.length === 0) return null;

      // line count: mostly 1–2 crops, occasionally 3; +1 tier at Lv10+ (B5:
      // 订单规模随等级放宽一档，给中后期「攒一仓库交大单」的目标感)。
      const level = Farm.state.data.level || 1;
      const lineMax = Math.min(4, 3 + Math.floor(level / 10));   // Lv1-9:3, Lv10+:4
      const r = Math.random();
      let lineCount = r < 0.4 ? 1 : (r < 0.74 ? 2 : (r < 0.92 ? 3 : 4));
      lineCount = Math.min(lineCount, lineMax, pool.length);

      // pick distinct crops
      const picks = pool.slice();
      for (let i = picks.length - 1; i > 0; i--) { const j = this._rand(i + 1); const t = picks[i]; picks[i] = picks[j]; picks[j] = t; }
      const chosen = picks.slice(0, lineCount);

      // qty ceiling grows with level (+1 per 6 levels, capped +3) so bigger
      // orders pull on the warehouse/plots instead of staying 1-3 forever.
      const qtyBonus = Math.min(3, Math.floor(level / 6));
      const items = chosen.map(def => {
        // higher-value crops are requested in smaller quantities so a single
        // order never demands an unreasonable pile of an expensive crop
        const maxQty = ((def.sell_price || 5) >= 18 ? 3 : 4) + qtyBonus;
        const qty = 1 + this._rand(maxQty);   // 1..maxQty
        return { cropId: def.id, qty };
      });

      // coins = bulk value × premium, with a small bonus for multi-crop orders
      const bulk = items.reduce((s, it) => {
        const def = Farm.crops.get(it.cropId);
        return s + (def ? (def.sell_price || 0) * it.qty : 0);
      }, 0);
      const variety = 1 + (lineCount - 1) * 0.12;   // 1.0 / 1.12 / 1.24
      const coins = Math.max(5, Math.round(bulk * COIN_PREMIUM * variety));

      // xp scales with total produce delivered
      const totalQty = items.reduce((s, it) => s + it.qty, 0);
      const xp = Math.max(4, totalQty * 3 + (lineCount - 1) * 4);

      // 超市积分: scarce. ~25% of orders carry EP; 3-crop orders a bit more / +2.
      let points = 0;
      const pr = Math.random();
      if (lineCount === 3 && pr < 0.45) points = 2;
      else if (pr < 0.25) points = 1;

      return {
        id: 'ord_' + Date.now().toString(36) + '_' + this._rand(100000).toString(36),
        items, coins, xp, points,
        createdAt: Date.now(),
      };
    },

    // Ensure the board always has ORDER_SLOTS valid orders. Drops any order
    // whose crops are no longer known (e.g. data edits), tops up the rest.
    ensure() {
      const d = Farm.state.data;
      if (!Array.isArray(d.orders)) d.orders = [];
      // prune invalid
      d.orders = d.orders.filter(o => o && Array.isArray(o.items) && o.items.length &&
        o.items.every(it => Farm.crops.get(it.cropId)));
      let added = false;
      let guard = 0;
      while (d.orders.length < ORDER_SLOTS && guard++ < 20) {
        const o = this._makeOrder();
        if (!o) break;
        d.orders.push(o);
        added = true;
      }
      if (added) Farm.state.save();
      return d.orders;
    },

    // Is this order fully deliverable from the current warehouse?
    _canFill(order) {
      // aggregate need (an order *could* list the same crop twice defensively)
      const need = {};
      order.items.forEach(it => { need[it.cropId] = (need[it.cropId] || 0) + it.qty; });
      return Object.keys(need).every(cid => Farm.state.warehouseCount(cid) >= need[cid]);
    },

    // How many orders on the board can be filled right now (for the badge).
    fillableCount() {
      const list = (Farm.state.data.orders || []);
      return list.reduce((n, o) => n + (this._canFill(o) ? 1 : 0), 0);
    },

    // 订单板当前需要的作物汇总 {cropId: qty}。仓库一键卖货（state.deliverWarehouse）
    // 会按这份清单自动保留，玩家攒给小东的菜不会被按散卖价卖掉。
    reservedNeeds() {
      const need = {};
      (Farm.state.data.orders || []).forEach(o => {
        (o.items || []).forEach(it => { need[it.cropId] = (need[it.cropId] || 0) + it.qty; });
      });
      return need;
    },

    // Total bulk-sell value of an order's crops (to show "多赚 +N").
    _bulkValue(order) {
      return order.items.reduce((s, it) => {
        const def = Farm.crops.get(it.cropId);
        return s + (def ? (def.sell_price || 0) * it.qty : 0);
      }, 0);
    },

    // ============ Render the board ============
    open() {
      this.ensure();
      const lang = Farm.state.data.language;
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const coin = '<span class="coin-icon"></span>';
      const pts = '<span class="points-icon"></span>';
      const list = Farm.state.data.orders || [];

      const cards = list.map(o => {
        const canFill = this._canFill(o);
        const rows = o.items.map(it => {
          const def = Farm.crops.get(it.cropId);
          const have = Farm.state.warehouseCount(it.cropId);
          const ok = have >= it.qty;
          return `
            <div class="order-item ${ok ? 'ok' : 'short'}">
              <span class="order-item-icon">${(Farm.cropArt && Farm.cropArt.icon) ? Farm.cropArt.icon(it.cropId, 20) : (def.icon || '🌱')}</span>
              <span class="order-item-name">${def[nameKey]}</span>
              <span class="order-item-qty">${Math.min(have, it.qty)}/${it.qty}${ok ? ' ✓' : ''}</span>
            </div>`;
        }).join('');

        const bonus = Math.max(0, o.coins - this._bulkValue(o));
        const rewardHtml = `
          <div class="order-reward">
            <span class="order-reward-coins">+${o.coins}${coin}</span>
            <span class="order-reward-xp">+${o.xp} XP</span>
            ${o.points ? `<span class="order-reward-pts">+${o.points}${pts}</span>` : ''}
            ${bonus > 0 ? `<span class="order-reward-bonus">${lang === 'en' ? 'vs. selling +' : '比直接卖多 +'}${bonus}${coin}</span>` : ''}
          </div>`;

        const deliverBtn = canFill
          ? `<button class="btn order-deliver" data-order="${o.id}">🚚 ${lang === 'en' ? 'Deliver' : '交付'}</button>`
          : `<button class="btn secondary order-deliver-disabled" disabled>${lang === 'en' ? 'Grow more' : '还差一点'}</button>`;

        return `
          <div class="order-card ${canFill ? 'ready' : ''}">
            <div class="order-items">${rows}</div>
            ${rewardHtml}
            <div class="order-actions">
              ${deliverBtn}
              <button class="order-swap" data-swap="${o.id}" title="${lang === 'en' ? 'Swap for a new order' : '换一单'}">🔄</button>
            </div>
          </div>`;
      }).join('');

      const epLeft = this._epRemainingToday();
      const subtitle = list.length === 0
        ? `<p class="modal-subtitle">${lang === 'en' ? 'Grow some crops first, then Eastern Market will start ordering.' : '先种点菜，东方超市就会开始下单啦。'}</p>`
        : `<p class="modal-subtitle">${lang === 'en'
            ? 'Deliver crops from your barn — orders pay more than bulk selling.'
            : '从谷仓交付东超要的菜——比直接卖更划算。'}</p>`;

      const html = `
        <h2 class="modal-title">${lang === 'en' ? 'Eastern Market Orders' : '小东订单'}</h2>
        ${subtitle}
        <div class="order-list">${cards}</div>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      // wire delivery + swap
      document.querySelectorAll('#modalContent .order-deliver').forEach(btn => {
        btn.onclick = () => this.fulfill(btn.getAttribute('data-order'));
      });
      document.querySelectorAll('#modalContent .order-swap').forEach(btn => {
        btn.onclick = () => this.swap(btn.getAttribute('data-swap'));
      });
    },

    // ============ Deliver an order ============
    fulfill(orderId) {
      const lang = Farm.state.data.language;
      const d = Farm.state.data;
      const idx = (d.orders || []).findIndex(o => o.id === orderId);
      if (idx < 0) return;
      const order = d.orders[idx];
      if (!this._canFill(order)) {
        Farm.ui.toast(lang === 'en' ? 'Not enough crops yet' : '谷仓里的菜还不够', 2000);
        if (Farm.audio) Farm.audio.play('error');
        return;
      }

      // consume crops from the warehouse
      order.items.forEach(it => Farm.state.removeFromWarehouse(it.cropId, it.qty));

      // rewards: coins + xp always; EP clamped to the daily cap
      Farm.state.addCoins(order.coins);
      const levelInfo = Farm.state.addXp(order.xp);
      let epAwarded = 0;
      if (order.points > 0) {
        epAwarded = Math.min(order.points, this._epRemainingToday());
        if (epAwarded > 0) {
          Farm.state.addEastPoints(epAwarded, {
            source: 'order_fill',
            description: '完成小东订单 / Filled Xiaodong order ' + order.id,
          });
          this._epState().earned += epAwarded;
        }
      }
      d.totalOrdersFilled = (d.totalOrdersFilled || 0) + 1;

      // replace the delivered slot with a fresh order
      const fresh = this._makeOrder();
      if (fresh) d.orders[idx] = fresh; else d.orders.splice(idx, 1);
      Farm.state.save();

      // juice
      if (Farm.ui.flyCoins) {
        Farm.ui.flyCoins(window.innerWidth / 2, window.innerHeight * 0.45, 8);
        setTimeout(() => Farm.ui.refreshHUD(), 280);
      } else {
        Farm.ui.refreshHUD();
      }
      if (Farm.audio) Farm.audio.play('coin');
      if (Farm.ui.showConfetti) Farm.ui.showConfetti(16, 1300);

      const coin = '<span class="coin-icon"></span>';
      const pts = '<span class="points-icon"></span>';
      let msg = (lang === 'en' ? '🚚 Order delivered! +' : '🚚 订单完成！+') + order.coins + coin + ' +' + order.xp + ' XP';
      if (epAwarded > 0) msg += ' +' + epAwarded + pts;
      Farm.ui.toast(msg, 3200);

      // keep dependent UI fresh
      if (Farm.warehouse && Farm.warehouse.refreshBadge) Farm.warehouse.refreshBadge();
      this.refreshBadge();
      if (Farm.achievements) Farm.achievements.checkAll();
      if (Farm.tasks && Farm.tasks.onEvent) Farm.tasks.onEvent('order', { coins: order.coins });

      // level-up parity with the harvest path (farm.js): grant the standard
      // per-level coins+EP and show the celebratory modal + unlock new plots.
      if (levelInfo && levelInfo.leveledUp) {
        const li = levelInfo;
        const epAward = 5 * (li.newLevel - li.oldLevel);
        const coinAward = 50 * (li.newLevel - li.oldLevel);
        setTimeout(() => {
          Farm.state.addCoins(coinAward);
          Farm.state.addEastPoints(epAward, { source: 'level_up', description: '升级奖励 / Level up ' + li.oldLevel + ' → ' + li.newLevel });
          Farm.ui.refreshHUD();
          if (Farm.farm && Farm.farm.renderGrid) Farm.farm.renderGrid();
          if (Farm.ui.showLevelUpModal) Farm.ui.showLevelUpModal(li.oldLevel, li.newLevel, { epAwarded: epAward });
        }, 600);
      }

      // re-render the board so the new order shows
      this.open();
    },

    // Swap one order for a fresh one (free — no exploit, rewards still require
    // growing + delivering). Lets players steer the board toward what they grow.
    swap(orderId) {
      const d = Farm.state.data;
      const idx = (d.orders || []).findIndex(o => o.id === orderId);
      if (idx < 0) return;
      const fresh = this._makeOrder();
      if (fresh) { d.orders[idx] = fresh; Farm.state.save(); }
      if (Farm.audio) Farm.audio.play('tap');
      this.refreshBadge();
      this.open();
    },

    // ============ 小东 badge (fillable-order count) ============
    refreshBadge() {
      const el = document.getElementById('storekeeperBadge');
      if (!el) return;
      this.ensure();
      const n = this.fillableCount();
      if (n > 0) { el.textContent = n; el.classList.add('show'); }
      else { el.textContent = ''; el.classList.remove('show'); }
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.orders = orders;
})();
