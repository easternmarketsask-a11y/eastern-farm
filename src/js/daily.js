/**
 * daily.js — "今日" panel: daily special seed, news, lottery wheel.
 *
 * All daily features use a deterministic hash of the date string so every
 * player sees the same "today" content. Claims persist in
 * state.dailyClaims (resets at midnight via state.init()).
 *
 *   Farm.daily.getSpecialSeedId() → cropId of today's 50%-off seed
 *   Farm.daily.getTodaysNews()    → news object from data/news.json
 *   Farm.daily.open()             → render the aggregator modal
 *   Farm.daily.openWheel()        → render the lottery wheel modal
 */
(function() {
  const SPECIAL_SEED_DISCOUNT = 0.5;  // 50% off

  // FNV-1a-ish hash for deterministic daily picks
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  const daily = {
    news: [],
    loaded: false,

    async load() {
      try {
        const res = await fetch('../data/news.json');
        const data = await res.json();
        this.news = data.items || [];
        this.loaded = true;
      } catch (e) {
        console.error('news load failed', e);
        this.news = [];
        this.loaded = true;
      }
    },

    todayStr() { return Farm.state.getDateString(); },

    // Deterministic: pick a crop that the player has unlocked
    getSpecialSeedId() {
      const playerLevel = Farm.state.data.level;
      const candidates = Farm.crops.all().filter(c => c.unlock_level <= playerLevel);
      if (candidates.length === 0) return null;
      const idx = hashStr(this.todayStr() + ':seed') % candidates.length;
      return candidates[idx].id;
    },

    isSpecialSeed(cropId) {
      return this.getSpecialSeedId() === cropId;
    },

    discountedSeedCost(cropId) {
      const def = Farm.crops.get(cropId);
      if (!def) return 0;
      if (this.isSpecialSeed(cropId)) {
        return Math.max(1, Math.floor(def.seed_cost * SPECIAL_SEED_DISCOUNT));
      }
      return def.seed_cost;
    },

    getTodaysNews() {
      if (this.news.length === 0) return null;
      const idx = hashStr(this.todayStr() + ':news') % this.news.length;
      return this.news[idx];
    },

    // ============ "今日" panel ============
    open() {
      const lang = Farm.state.data.language;
      const news = this.getTodaysNews();
      const specialId = this.getSpecialSeedId();
      const specialCrop = specialId ? Farm.crops.get(specialId) : null;
      const specialPrice = specialCrop ? this.discountedSeedCost(specialId) : 0;
      const claims = Farm.state.data.dailyClaims;
      const visited = (claims.neighborsVisited || []).length;
      const visitedComplete = visited >= 3;
      const freeSpin = !claims.lotterySpunFree;
      const titleKey = lang === 'en' ? 'title_en' : 'title_zh';
      const bodyKey  = lang === 'en' ? 'body_en'  : 'body_zh';
      const nameKey  = lang === 'en' ? 'name_en'  : 'name_zh';

      const newsHTML = news ? `
        <div class="daily-card daily-news">
          <div class="daily-card-title">${news[titleKey]}</div>
          <div class="daily-card-body">${news[bodyKey]}</div>
          ${claims.newsRead ? '' : `<button class="daily-claim" id="dailyReadNews">📰 ${lang === 'en' ? 'Mark read +10<span class="coin-icon"></span>' : '已读 +10<span class="coin-icon"></span>'}</button>`}
        </div>` : '';

      const specialHTML = specialCrop ? `
        <div class="daily-card daily-special">
          <div class="daily-card-title">🛒 ${lang === 'en' ? "Today's Special Seed" : '今日特价种子'}</div>
          <div class="daily-card-body" style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:38px;line-height:1;display:flex;align-items:center;">${(Farm.cropArt && Farm.cropArt.icon) ? Farm.cropArt.icon(specialId, 46) : (specialCrop.icon || '🌱')}</div>
            <div style="flex:1;">
              <div style="font-weight:700;">${specialCrop[nameKey]}</div>
              <div style="font-size:12px;color:var(--warm-text-soft);">
                <s><span class="coin-icon"></span> ${specialCrop.seed_cost}</s>
                <strong style="color:var(--barn-red);font-size:14px;margin-left:6px;"><span class="coin-icon"></span> ${specialPrice}</strong>
                <span style="background:var(--barn-red);color:white;font-size:10px;padding:1px 5px;border-radius:6px;margin-left:6px;">-50%</span>
              </div>
            </div>
            <button class="daily-claim" id="dailyBuySpecial">${lang === 'en' ? 'Buy' : '买'}</button>
          </div>
        </div>` : '';

      // 小东订单板入口：显示当前可交付的订单数，引导去交付（核心循环）。
      const fillable = (Farm.orders && Farm.orders.fillableCount) ? Farm.orders.fillableCount() : 0;
      const ordersHTML = `
        <div class="daily-card daily-orders">
          <div class="daily-card-title">📋 ${lang === 'en' ? 'Eastern Market Orders' : '小东订单'}</div>
          <div class="daily-card-body">
            ${fillable > 0
              ? (lang === 'en' ? `<strong>${fillable}</strong> order(s) ready to deliver — pays more than bulk selling!` : `有 <strong>${fillable}</strong> 单现在就能交付——比直接卖更划算！`)
              : (lang === 'en' ? 'Grow crops to fill Eastern Market orders for bonus coins.' : '种菜交付小东订单，赚更多农场币。')}
          </div>
          <button class="daily-claim" id="dailyOpenOrders">${fillable > 0 ? '🚚 ' + (lang === 'en' ? 'Deliver' : '去交付') : '📋 ' + (lang === 'en' ? 'View orders' : '看订单')}</button>
        </div>`;

      const lotteryHTML = `
        <div class="daily-card daily-lottery">
          <div class="daily-card-title">🎰 ${lang === 'en' ? 'Daily Lottery' : '每日大转盘'}</div>
          <div class="daily-card-body">
            ${freeSpin
              ? (lang === 'en' ? 'Free spin available!' : '今日免费转一次！')
              : (lang === 'en' ? 'Free spin used. 20 <span class="points-icon"></span> per extra spin.' : '免费机会已用，再转 20 <span class="points-icon"></span>/次')}
          </div>
          <button class="daily-claim" id="dailyOpenWheel">${freeSpin ? '🎁 ' + (lang === 'en' ? 'Free Spin' : '免费转一次') : '<span class="points-icon"></span> ' + (lang === 'en' ? 'Pay & Spin' : '付费转一次')}</button>
        </div>`;

      const neighborHTML = `
        <div class="daily-card daily-neighbor">
          <div class="daily-card-title">🏘 ${lang === 'en' ? 'Visit Neighbors' : '邻居走访'}</div>
          <div class="daily-card-body">
            ${lang === 'en' ? `Visit 3 neighbors today (${visited}/3) → +40 <span class="coin-icon"></span>` : `今日走访 3 户邻居 (${visited}/3) → +40 <span class="coin-icon"></span>`}
          </div>
          <button class="daily-claim" id="dailyOpenNeighbors">
            ${visitedComplete ? '✅ ' + (lang === 'en' ? 'Done' : '已完成') : '🚪 ' + (lang === 'en' ? 'Visit' : '去走访')}
          </button>
        </div>`;

      const cal = Farm.state.data.loginCalendar || { lastSignDate: '', dayIndex: 0 };
      const signedToday = cal.lastSignDate === this.todayStr();
      const signinHTML = `
        <div class="daily-card daily-signin">
          <div class="daily-card-title">📅 ${lang === 'en' ? '7-Day Sign-in' : '七日签到'}</div>
          <div class="daily-card-body">
            ${signedToday
              ? (lang === 'en' ? `Signed in (day ${cal.dayIndex}/7) — see you tomorrow!` : `今日已签到（第 ${cal.dayIndex}/7 天），明天再来！`)
              : (lang === 'en' ? 'Sign in today to keep your streak and claim a reward.' : '今天签到领奖，别让连签断掉。')}
          </div>
          <button class="daily-claim" id="dailyOpenSignin">
            ${signedToday ? '✅ ' + (lang === 'en' ? 'View' : '查看') : '🎁 ' + (lang === 'en' ? 'Sign in' : '去签到')}
          </button>
        </div>`;

      // 「怎么玩」卡：新手排第一，老玩家（卖过货）沉到最底 —— 玩了三个月的人
      // 每天打开「今日」第一眼不该是「第一次玩？」（2026-08-15）。菜单里也有入口。
      const isNewbie = (Farm.state.data.totalDeliveries || 0) < 3;
      const guideHTML = `
          <div class="daily-card daily-guide">
            <div class="daily-card-title">📖 ${lang === 'en' ? 'How to Play' : '怎么玩'}</div>
            <div class="daily-card-body">${isNewbie
              ? (lang === 'en' ? 'New here? See everything you can do on the farm.' : '第一次玩？一页看懂农场能做的事。')
              : (lang === 'en' ? 'A one-page refresher of everything on the farm.' : '农场里能做的事，一页回顾。')}</div>
            <button class="daily-claim" id="dailyOpenGuide">📖 ${lang === 'en' ? 'View guide' : '看玩法'}</button>
          </div>`;
      const html = `
        <h2 class="modal-title">${lang === 'en' ? 'Today' : '今日'}</h2>
        <div class="daily-list">
          ${(Farm.promo && Farm.promo.bannerHtml) ? Farm.promo.bannerHtml() : ''}
          ${isNewbie ? guideHTML : ''}
          ${signinHTML}
          ${ordersHTML}
          ${newsHTML}
          ${specialHTML}
          ${lotteryHTML}
          ${neighborHTML}
          ${isNewbie ? '' : guideHTML}
        </div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      // 没有可走访的邻居（AI 已关、真会员为空）→ 撤掉走访卡，
      // 别挂一个永远 0/3 完不成的任务在那。
      if (Farm.neighbors && Farm.neighbors._fetchToday) {
        Farm.neighbors._fetchToday().then((list) => {
          if (!list || list.length === 0) {
            const card = document.querySelector('.daily-card.daily-neighbor');
            if (card) card.remove();
          }
        }).catch(() => {});
      }

      const $ = (id) => document.getElementById(id);
      const readBtn = $('dailyReadNews');
      if (readBtn) readBtn.onclick = () => {
        if (Farm.state.claimDailyNews()) {
          Farm.state.addCoins(10);
          Farm.ui.refreshHUD();
          Farm.ui.toast(lang === 'en' ? '📰 +10 coins' : '📰 +10 农场币', 1800);
          if (Farm.audio) Farm.audio.play('coin');
          setTimeout(() => this.open(), 600);
        }
      };
      const buySpecialBtn = $('dailyBuySpecial');
      if (buySpecialBtn) buySpecialBtn.onclick = () => {
        if (!Farm.state.spendCoins(specialPrice)) {
          Farm.ui.toast(Farm.i18n.t('toast_not_enough_coins'));
          if (Farm.audio) Farm.audio.play('error');
          return;
        }
        Farm.state.addSeed(specialId, 1);
        Farm.state.data.dailyClaims.specialSeedBought = true;   // 今日红点：买过就不再计
        Farm.state.save();
        Farm.ui.refreshHUD();
        Farm.ui.toast('🌱 +1 ' + specialCrop[nameKey]);
        if (Farm.audio) Farm.audio.play('buy');
        setTimeout(() => this.open(), 400);
      };
      const guideBtn = $('dailyOpenGuide');
      if (guideBtn) guideBtn.onclick = () => {
        if (Farm.guide) Farm.guide.open();
      };
      const signinBtn = $('dailyOpenSignin');
      if (signinBtn) signinBtn.onclick = () => {
        if (Farm.loginCalendar) Farm.loginCalendar.open();
      };
      const ordersBtn = $('dailyOpenOrders');
      if (ordersBtn) ordersBtn.onclick = () => {
        if (Farm.orders) Farm.orders.open();
      };
      const wheelBtn = $('dailyOpenWheel');
      if (wheelBtn) wheelBtn.onclick = () => this.openWheel();
      const neighborBtn = $('dailyOpenNeighbors');
      if (neighborBtn) neighborBtn.onclick = () => {
        if (Farm.neighbors) Farm.neighbors.open();
      };
    },

    // ============ Lottery wheel ============
    openWheel() {
      const lang = Farm.state.data.language;
      const free = !Farm.state.data.dailyClaims.lotterySpunFree;
      const cost = free ? 0 : 20;
      const html = `
        <h2 class="modal-title">${lang === 'en' ? 'Daily Wheel' : '每日大转盘'}</h2>
        <div class="lottery-wheel-container">
          <div class="lottery-wheel" id="lotteryWheel">
            ${this.renderWheelSegments()}
          </div>
          <div class="lottery-pointer">▼</div>
        </div>
        <div id="lotteryResult" class="lottery-result"></div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
          <button class="btn" id="spinBtn">
            ${cost > 0 ? '<span class="points-icon"></span> ' + cost + ' · ' : ''}${lang === 'en' ? 'Spin!' : '开转！'}
          </button>
        </div>
      `;
      Farm.ui.showModal(html);

      const spinBtn = document.getElementById('spinBtn');
      const wheel = document.getElementById('lotteryWheel');
      const resultEl = document.getElementById('lotteryResult');
      spinBtn.onclick = () => {
        const cost2 = Farm.state.data.dailyClaims.lotterySpunFree ? 20 : 0;
        if (cost2 > 0) {
          if (!Farm.state.spendEastPoints(cost2, {
            source: 'lottery_wheel_spend',
            description: 'Paid lottery wheel spin',
          })) {
            Farm.ui.toast(Farm.i18n.t('toast_not_enough_points'));
            if (Farm.audio) Farm.audio.play('error');
            return;
          }
        } else {
          Farm.state.consumeFreeSpin();
        }
        Farm.ui.refreshHUD();

        const result = Farm.epShop.spinLottery({ source: 'daily' });
        const prize = result.prize;
        const segments = Farm.epShop.lotteryPrizes;
        const idx = segments.findIndex(p => p.id === prize.id);
        const segAngle = 360 / segments.length;
        const targetAngle = 360 * 5 + (360 - idx * segAngle - segAngle / 2);
        wheel.style.transition = 'transform 3.2s cubic-bezier(0.15, 0.85, 0.25, 1)';
        wheel.style.transform = 'rotate(' + targetAngle + 'deg)';
        spinBtn.disabled = true;
        resultEl.textContent = '';

        setTimeout(() => {
          const label = lang === 'en' ? prize.label_en : prize.label_zh;
          resultEl.innerHTML = '🎉 ' + label;
          resultEl.classList.add('show');
          spinBtn.disabled = false;
          // Re-render button with possibly-different label
          const freeNow = !Farm.state.data.dailyClaims.lotterySpunFree;
          spinBtn.innerHTML = (freeNow ? '' : '<span class="points-icon"></span> 20 · ') + (lang === 'en' ? 'Spin again' : '再来一次');
        }, 3300);
      };
    },

    renderWheelSegments() {
      const segments = Farm.epShop.lotteryPrizes;
      const n = segments.length;
      const angle = 360 / n;
      // Build SVG conic wheel with segments + labels
      const slices = segments.map((p, i) => {
        const startAngle = i * angle;
        const colors = ['#ffd6a5', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#fdffb6', '#ffadad', '#ffb4a2'];
        const fill = colors[i % colors.length];
        const x1 = 50 + 50 * Math.cos((startAngle - 90) * Math.PI / 180);
        const y1 = 50 + 50 * Math.sin((startAngle - 90) * Math.PI / 180);
        const x2 = 50 + 50 * Math.cos((startAngle + angle - 90) * Math.PI / 180);
        const y2 = 50 + 50 * Math.sin((startAngle + angle - 90) * Math.PI / 180);
        const lg = angle > 180 ? 1 : 0;
        // Label position (radius 30 from center)
        const lx = 50 + 30 * Math.cos((startAngle + angle/2 - 90) * Math.PI / 180);
        const ly = 50 + 30 * Math.sin((startAngle + angle/2 - 90) * Math.PI / 180);
        return `
          <path d="M 50 50 L ${x1.toFixed(2)} ${y1.toFixed(2)} A 50 50 0 ${lg} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z"
                fill="${fill}" stroke="#fff" stroke-width="0.5"/>
          <text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" text-anchor="middle" dominant-baseline="central"
                font-size="8" font-weight="700" fill="#3a2e26">${p.icon}</text>
        `;
      }).join('');
      return `<svg viewBox="0 0 100 100" width="240" height="240" xmlns="http://www.w3.org/2000/svg">${slices}</svg>`;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.daily = daily;
})();
