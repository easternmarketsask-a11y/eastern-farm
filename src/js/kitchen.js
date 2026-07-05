/**
 * kitchen.js — 小东厨房（加工链 MVP，2026-07-02）。
 *
 * 农场游戏品类标配的「需求端深度」：仓库里的菜不再只有散卖/交订单两个出口，
 * 还能按真实中餐菜谱加工成菜品，计时出锅后卖给东方超市，价值 ≈ 原料散卖
 * 价 ×2~2.5 + XP。给长线作物一个专属出口，也把 crops.json 里躺了很久的
 * recipe 文化叙事变成真玩法。
 *
 * 菜谱真相源 data/recipes.json（Chris 可直接调），加载失败回落为空列表
 * （厨房入口显示"今天不开火"，不炸）。
 * 存档：state.data.kitchen = { slots: [slot, slot], extraSlotBought }
 *   slot = null | { recipeId, startedAt }
 * 懒创建（不动 STARTER/init 的迁移面），与 orderEp/stealGrace 同模式。
 * 出锅收益走 addCoins + addXp；tasks 收 'cook' 事件（earn_coins 计入真实到账）。
 */
(function () {
  const EXTRA_SLOT_COST = 2000;   // 第二口灶（农场币，毕业玩家的金币出口之一）

  const kitchen = {
    recipes: [],
    loaded: false,
    _timer: null,

    async load() {
      try {
        const res = await fetch('../data/recipes.json');
        const data = await res.json();
        this.recipes = (data && Array.isArray(data.recipes)) ? data.recipes : [];
      } catch (e) {
        console.warn('[kitchen] recipes.json load failed — kitchen closed today', e);
        this.recipes = [];
      }
      this.loaded = true;
    },

    get(id) { return this.recipes.find(r => r.id === id) || null; },

    _k() {
      const d = Farm.state.data;
      if (!d.kitchen) d.kitchen = { slots: [null, null], extraSlotBought: false };
      if (!Array.isArray(d.kitchen.slots)) d.kitchen.slots = [null, null];
      return d.kitchen;
    },

    slotCount() { return this._k().extraSlotBought ? 2 : 1; },

    _remainMs(slot) {
      const r = this.get(slot.recipeId);
      if (!r) return 0;
      return Math.max(0, slot.startedAt + r.cook_minutes * 60000 - Date.now());
    },

    // 出锅就绪的菜品数（导航红点等外部查询用）
    readyCount() {
      const k = this._k();
      let n = 0;
      for (let i = 0; i < this.slotCount(); i++) {
        const s = k.slots[i];
        if (s && this._remainMs(s) <= 0) n++;
      }
      return n;
    },

    open() {
      const lang = Farm.state.data.language;
      const k = this._k();
      const coin = '<span class="coin-icon"></span>';
      const level = Farm.state.data.level || 1;

      // ---- 灶台行 ----
      const slotsHtml = [];
      for (let i = 0; i < 2; i++) {
        if (i >= this.slotCount()) {
          slotsHtml.push(`
            <button class="btn secondary" id="ktUnlockSlot" style="flex:1;min-height:74px;border-style:dashed;">
              🔒 ${lang === 'en' ? 'Second stove' : '第二口灶'}<br>
              <span style="font-size:12px;">${coin}${EXTRA_SLOT_COST}</span>
            </button>`);
          continue;
        }
        const s = k.slots[i];
        if (!s) {
          slotsHtml.push(`
            <div style="flex:1;min-height:74px;border:2px dashed var(--border-soft);border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--warm-text-soft);font-size:13px;">
              🔥 ${lang === 'en' ? 'Stove free' : '灶台空着'}
            </div>`);
          continue;
        }
        const r = this.get(s.recipeId);
        if (!r) { k.slots[i] = null; continue; }
        const remain = this._remainMs(s);
        if (remain <= 0) {
          slotsHtml.push(`
            <button class="btn primary" data-kt-collect="${i}" style="flex:1;min-height:74px;">
              ${r.icon} ${lang === 'en' ? r.name_en : r.name_zh}<br>
              <span style="font-size:13px;">✨ ${lang === 'en' ? 'Ready! Serve it' : '出锅啦！点我上菜'}</span>
            </button>`);
        } else {
          const pct = 100 - Math.round(remain / (r.cook_minutes * 60000) * 100);
          slotsHtml.push(`
            <div style="flex:1;min-height:74px;border:2px solid var(--border-soft);border-radius:12px;padding:8px;text-align:center;">
              <div style="font-size:14px;">${r.icon} ${lang === 'en' ? r.name_en : r.name_zh}</div>
              <div style="font-size:12px;color:var(--warm-text-soft);margin:3px 0;" data-kt-remain="${i}">⏱ ${Farm.crops.formatTimeRemaining(remain)}</div>
              <div style="height:4px;background:var(--border-soft);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:var(--sun-gold, #e8b93c);" data-kt-bar="${i}"></div>
              </div>
            </div>`);
        }
      }

      // ---- 菜谱列表 ----
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const freeSlot = (() => {
        for (let i = 0; i < this.slotCount(); i++) if (!k.slots[i]) return true;
        return false;
      })();
      const cards = this.recipes.map(r => {
        const locked = (r.unlock_level || 1) > level;
        const ing = Object.keys(r.ingredients).map(cid => {
          const def = Farm.crops.get(cid);
          const have = Farm.state.warehouseCount(cid);
          const need = r.ingredients[cid];
          const okc = have >= need;
          return `<span style="color:${okc ? 'var(--leaf-dark)' : 'var(--barn-red)'};font-weight:600;">${def ? def.icon : '❓'}${def ? def[nameKey] : cid}×${need}<span style="font-size:11px;">(${lang === 'en' ? 'have ' : '有'}${have})</span></span>`;
        }).join(' ');
        const canCook = !locked && freeSlot
          && Object.keys(r.ingredients).every(cid => Farm.state.warehouseCount(cid) >= r.ingredients[cid]);
        const btn = locked
          ? `<span style="color:#999;font-size:13px;">Lv ${r.unlock_level}</span>`
          : `<button class="btn ${canCook ? 'primary' : 'secondary'}" data-kt-cook="${r.id}" ${canCook ? '' : 'disabled style="opacity:0.45;"'}>${lang === 'en' ? 'Cook' : '开做'}</button>`;
        return `
          <div class="task-card" style="${locked ? 'opacity:0.55;' : ''}">
            <div style="font-size:26px;">${r.icon}</div>
            <div class="task-info">
              <div class="task-title">${lang === 'en' ? r.name_en : r.name_zh}
                <span style="font-size:11px;color:var(--warm-text-soft);">⏱${Farm.crops.formatTimeRemaining(r.cook_minutes * 60000)}</span>
              </div>
              <div style="font-size:12px;line-height:1.5;">${ing}</div>
              <div style="font-size:11px;color:var(--warm-text-soft);margin-top:2px;">${lang === 'en' ? (r.tip_en || '') : (r.tip_zh || '')}</div>
            </div>
            <div class="task-reward" style="text-align:right;">
              +${r.sell_price}${coin}<br><span style="font-size:11px;">+${r.xp} XP</span><br>${btn}
            </div>
          </div>`;
      }).join('');

      const html = `
        <h2 class="modal-title">🍳 ${lang === 'en' ? "Little East's Kitchen" : '小东厨房'}</h2>
        <p class="modal-subtitle">${lang === 'en'
          ? 'Turn warehouse crops into real Chinese dishes — Eastern Market pays extra for cooked food!'
          : '用仓库里的菜做真·中餐，卖给东方超市比散卖赚更多！'}</p>
        <div style="display:flex;gap:8px;margin-bottom:12px;">${slotsHtml.join('')}</div>
        ${this.recipes.length === 0
          ? `<p style="text-align:center;color:var(--warm-text-soft);padding:18px;">${lang === 'en' ? 'Kitchen is closed today (recipes failed to load).' : '今天不开火（菜谱没加载出来）。'}</p>`
          : `<div class="task-list">${cards}</div>`}
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      // 事件绑定
      document.querySelectorAll('[data-kt-cook]').forEach(btn => {
        if (btn.disabled) return;
        btn.onclick = () => this.cook(btn.getAttribute('data-kt-cook'));
      });
      document.querySelectorAll('[data-kt-collect]').forEach(btn => {
        btn.onclick = () => this.collect(parseInt(btn.getAttribute('data-kt-collect'), 10));
      });
      const unlockBtn = document.getElementById('ktUnlockSlot');
      if (unlockBtn) unlockBtn.onclick = () => this._buySlot();

      // 倒计时活刷新：modal 打开期间每秒更新剩余时间；kitchen 内容不在 DOM
      // 里了（modal 被关/换内容）就自动停表。
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this._timer = setInterval(() => {
        const anyEl = document.querySelector('[data-kt-remain], [data-kt-collect]');
        if (!anyEl || !document.body.contains(anyEl)) {
          clearInterval(this._timer); this._timer = null; return;
        }
        let needRerender = false;
        for (let i = 0; i < this.slotCount(); i++) {
          const s = this._k().slots[i];
          if (!s) continue;
          const remain = this._remainMs(s);
          const el = document.querySelector(`[data-kt-remain="${i}"]`);
          if (remain <= 0 && el) { needRerender = true; break; }
          if (el) el.textContent = '⏱ ' + Farm.crops.formatTimeRemaining(remain);
          const bar = document.querySelector(`[data-kt-bar="${i}"]`);
          if (bar) {
            const r = this.get(s.recipeId);
            if (r) bar.style.width = (100 - Math.round(remain / (r.cook_minutes * 60000) * 100)) + '%';
          }
        }
        if (needRerender) this.open();   // 有菜出锅 → 整体重画成「出锅啦」按钮
      }, 1000);
    },

    cook(recipeId) {
      const lang = Farm.state.data.language;
      const r = this.get(recipeId);
      if (!r) return;
      if ((r.unlock_level || 1) > (Farm.state.data.level || 1)) return;
      const k = this._k();
      let slotIdx = -1;
      for (let i = 0; i < this.slotCount(); i++) if (!k.slots[i]) { slotIdx = i; break; }
      if (slotIdx < 0) {
        Farm.ui.toast(lang === 'en' ? '🔥 Both stoves are busy' : '🔥 灶台都占着呢', 2200);
        return;
      }
      // 校验 + 扣原料（先校验后扣，中途不足直接失败不动仓库）
      const need = r.ingredients;
      const short = Object.keys(need).find(cid => Farm.state.warehouseCount(cid) < need[cid]);
      if (short) {
        Farm.ui.toast(lang === 'en' ? 'Not enough ingredients in the warehouse' : '仓库里的原料还不够', 2200);
        if (Farm.audio) Farm.audio.play('error');
        return;
      }
      Object.keys(need).forEach(cid => Farm.state.removeFromWarehouse(cid, need[cid]));
      k.slots[slotIdx] = { recipeId: r.id, startedAt: Date.now() };
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('buy');
      const mins = r.cook_minutes;
      Farm.ui.toast('🍳 ' + (lang === 'en' ? r.name_en : r.name_zh) + (lang === 'en'
        ? ` is cooking — ready in ${mins} min`
        : ` 下锅了 · ${mins} 分钟后出锅`), 2800);
      if (Farm.warehouse && Farm.warehouse.refreshBadge) Farm.warehouse.refreshBadge();
      this.open();
    },

    collect(slotIdx) {
      const lang = Farm.state.data.language;
      const k = this._k();
      const s = k.slots[slotIdx];
      if (!s) return;
      if (this._remainMs(s) > 0) return;
      const r = this.get(s.recipeId);
      k.slots[slotIdx] = null;
      if (!r) { Farm.state.save(); this.open(); return; }

      Farm.state.addCoins(r.sell_price);
      const levelInfo = Farm.state.addXp(r.xp);
      const d = Farm.state.data;
      d.totalDishesCooked = (d.totalDishesCooked || 0) + 1;
      Farm.state.save();
      // 上菜后 readyCount 变了 → 立即刷新 dock 菜单钮/汉堡红点（UX 第 4 批）
      if (Farm.ui.refreshDockDots) Farm.ui.refreshDockDots();

      // juice：上菜 = 金币飞行 + toast
      Farm.ui.hideModal();
      if (Farm.ui.flyCoins) {
        Farm.ui.flyCoins(window.innerWidth / 2, window.innerHeight * 0.45, 8);
        setTimeout(() => Farm.ui.refreshHUD(), 280);
      } else {
        Farm.ui.refreshHUD();
      }
      if (Farm.audio) Farm.audio.play('coin');
      const coin = '<span class="coin-icon"></span>';
      Farm.ui.toast('🍽 ' + (lang === 'en' ? r.name_en : r.name_zh)
        + (lang === 'en' ? ' served to Eastern Market! +' : ' 端给东方超市！+')
        + r.sell_price + coin + ' +' + r.xp + ' XP', 3400);

      // 任务：cook 事件（earn_coins 计真实到账金币）
      if (Farm.tasks && Farm.tasks.onEvent) Farm.tasks.onEvent('cook', { recipeId: r.id, coins: r.sell_price });
      if (Farm.achievements) Farm.achievements.checkAll();

      // level-up parity with the harvest/order paths
      if (levelInfo && levelInfo.leveledUp) {
        const li = levelInfo;
        const epAward = 5 * (li.newLevel - li.oldLevel);
        const coinAward = 50 * (li.newLevel - li.oldLevel);
        setTimeout(() => {
          Farm.state.addCoins(coinAward);
          Farm.state.addEastPoints(epAward, { source: 'level_up', description: 'Level ' + li.oldLevel + ' → ' + li.newLevel });
          Farm.ui.refreshHUD();
          if (Farm.farm && Farm.farm.renderGrid) Farm.farm.renderGrid();
          if (Farm.ui.showLevelUpModal) Farm.ui.showLevelUpModal(li.oldLevel, li.newLevel, { epAwarded: epAward });
        }, 600);
      } else {
        // 没升级就回厨房（升级弹窗优先）
        setTimeout(() => this.open(), 700);
      }
    },

    _buySlot() {
      const lang = Farm.state.data.language;
      const k = this._k();
      if (k.extraSlotBought) return;
      if (!Farm.state.spendCoins(EXTRA_SLOT_COST)) {
        Farm.ui.toast(Farm.i18n.t('toast_not_enough_coins'));
        if (Farm.audio) Farm.audio.play('error');
        return;
      }
      k.extraSlotBought = true;
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('achievement');
      Farm.ui.toast(lang === 'en' ? '🔥 Second stove unlocked!' : '🔥 第二口灶开火了！', 2600);
      this.open();
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.kitchen = kitchen;
})();
