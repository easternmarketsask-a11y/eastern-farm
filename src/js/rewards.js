/**
 * rewards.js — Eastern Point overview + exchange + how-to-earn page.
 *
 * V1.1 redesign (per owner): the game no longer shows in-game coupon tiers
 * or redemption values. Eastern Points are equivalent to real Eastern
 * Market member points; redemption value is governed by the store, not
 * the game. This page only shows:
 *   1. Current EP balance + today's cap status + queued EP
 *   2. Bidirectional exchange (10 farm coins ⇄ 1 EP)
 *   3. List of how to earn EP
 *   4. Link to EP shop
 *
 * The legacy coupon catalog (data/coupons.json) is kept as a V0 fallback
 * for future cashier-validated promotions but is no longer rendered.
 */
(function() {
  const rewards = {
    couponData: null,

    async load() {
      // Keep loader for backward-compat; data is no longer rendered in V1.1
      try {
        const res = await fetch('../data/coupons.json');
        this.couponData = await res.json();
      } catch (e) {
        this.couponData = null;
      }
    },

    open() {
      const lang = Farm.state.data.language;
      const s = Farm.state.data;
      const ep = s.eastPoints;
      const coins = s.coins;

      const balanceHTML = `
        <div class="ep-overview">
          <div class="ep-overview-balance">
            <div class="ep-overview-label">${lang === 'en' ? 'Your Store Points' : '您的超市积分'}</div>
            <div class="ep-overview-value"><span class="points-icon"></span> ${ep.toLocaleString()}</div>
            <div class="ep-overview-note">
              ${lang === 'en'
                ? 'Equivalent to your Eastern Market member points'
                : '等同于东方超市会员积分'}
            </div>
            <div class="ep-overview-sync-note">
              ${lang === 'en'
                ? '⏱ Shown instantly; synced to your account once daily.'
                : '⏱ 实时显示，每日凌晨同步至会员账户'}
            </div>
          </div>
          <div class="ep-cap-row">
            <div>${lang === 'en' ? 'Daily limit: 500 points (resets each day)' : '每日上限 500 积分（每天重置）'}</div>
          </div>
        </div>
      `;

      const exchangeHTML = `
        <h3 class="rewards-section">${lang === 'en' ? '🔄 Exchange (10 ⇄ 1)' : '🔄 兑换 (10 ⇄ 1)'}</h3>
        <div class="exchange-row">
          <div class="exchange-side">
            <label><span class="coin-icon"></span> ${lang === 'en' ? 'Coins → Points' : '农场币 → 超市积分'}</label>
            <div class="exchange-input-group">
              <input type="number" id="exCoinAmt" min="10" step="10" value="100" placeholder="10x" />
              <span class="exchange-arrow">→ <span id="exCoinPreview">10</span> <span class="points-icon"></span></span>
            </div>
            <div class="exchange-balance">${lang === 'en' ? 'Have' : '有'} <span class="coin-icon"></span> ${coins.toLocaleString()}</div>
            <button class="btn exchange-btn" id="exCoinBtn">${lang === 'en' ? 'Exchange' : '兑换'}</button>
          </div>
          <div class="exchange-side">
            <label><span class="points-icon"></span> ${lang === 'en' ? 'Points → Coins' : '超市积分 → 农场币'}</label>
            <div class="exchange-input-group">
              <input type="number" id="exEpAmt" min="1" step="1" value="10" />
              <span class="exchange-arrow">→ <span id="exEpPreview">100</span> <span class="coin-icon"></span></span>
            </div>
            <div class="exchange-balance">${lang === 'en' ? 'Have' : '有'} <span class="points-icon"></span> ${ep.toLocaleString()}</div>
            <button class="btn exchange-btn" id="exEpBtn">${lang === 'en' ? 'Exchange' : '兑换'}</button>
          </div>
        </div>
      `;

      const earnList = lang === 'en' ? [
        { icon: '📅', text: '7-day sign-in: points on day 2/4/6, big bonus on day 7' },
        { icon: '📋', text: 'Complete daily tasks +1 each (3/day)' },
        { icon: '🌽', text: '3% random bonus on harvest +5' },
        { icon: '🎰', text: '1% Golden Nugget chance +50~500' },
        { icon: '🌅', text: 'First harvest of the day +10' },
        { icon: '☄️', text: 'Saturday/Sunday Meteor Shower 2× all points' },
        { icon: '🏆', text: 'Achievement unlock +5~+30' },
        { icon: '🎊', text: 'Festival tasks +5~+10' },
        { icon: '🔄', text: 'Convert farm coins 10:1' },
      ] : [
        { icon: '📅', text: '七日签到：第 2/4/6 天给积分，第 7 天大奖' },
        { icon: '📋', text: '完成每日任务 +1/个（每日 3 个）' },
        { icon: '🌽', text: '收获时 3% 概率 +5' },
        { icon: '🎰', text: '1% 金疙瘩大奖 +50~500' },
        { icon: '🌅', text: '今日首次收获 +10' },
        { icon: '☄️', text: '周末（六/日）流星雨 ×2 全部积分' },
        { icon: '🏆', text: '解锁成就 +5~+30' },
        { icon: '🎊', text: '节日任务 +5~+10' },
        { icon: '🔄', text: '农场币 10:1 兑换' },
      ];

      const earnHTML = `
        <h3 class="rewards-section">${lang === 'en' ? '💡 How to earn points' : '💡 如何获取超市积分'}</h3>
        <ul class="earn-list">
          ${earnList.map(e => `<li><span class="earn-icon">${e.icon}</span> ${e.text}</li>`).join('')}
        </ul>
      `;

      const shopHTML = `
        <button class="btn ep-shop-link" id="openEpShopBtn">
          🛍️ ${lang === 'en' ? 'Open Shop' : '打开商城'}
        </button>
        <div style="font-size:11px;color:var(--warm-text-soft);text-align:center;margin-top:8px;line-height:1.5;">
          ${lang === 'en'
            ? 'Redemption rules match Eastern Market in-store policy.'
            : '兑换规则与东方超市店内会员系统一致'}
        </div>
      `;

      const html = `
        <h2 class="modal-title"><span class="points-icon"></span> ${lang === 'en' ? 'Store Points' : '超市积分'}</h2>
        ${balanceHTML}
        ${exchangeHTML}
        ${shopHTML}
        ${earnHTML}
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      // Live preview wiring
      const exCoinAmt = document.getElementById('exCoinAmt');
      const exCoinPreview = document.getElementById('exCoinPreview');
      const exEpAmt = document.getElementById('exEpAmt');
      const exEpPreview = document.getElementById('exEpPreview');
      exCoinAmt.oninput = () => {
        const n = Math.max(0, parseInt(exCoinAmt.value, 10) || 0);
        exCoinPreview.textContent = Math.floor(n / 10);
      };
      exEpAmt.oninput = () => {
        const n = Math.max(0, parseInt(exEpAmt.value, 10) || 0);
        exEpPreview.textContent = n * 10;
      };

      document.getElementById('exCoinBtn').onclick = () => {
        const n = Math.max(0, parseInt(exCoinAmt.value, 10) || 0);
        const r = Farm.state.exchangeCoinsToEp(n);
        if (!r.ok) {
          Farm.ui.toast(r.reason === 'insufficient_coins'
            ? Farm.i18n.t('toast_not_enough_coins')
            : (lang === 'en' ? 'Enter at least 10 coins' : '至少 10 农场币'));
          if (Farm.audio) Farm.audio.play('error');
          return;
        }
        Farm.ui.refreshHUD();
        if (Farm.audio) Farm.audio.play('coin');
        let msg = `🔄 +${r.epGained} <span class="points-icon"></span>`;
        if (r.queued > 0) {
          msg += lang === 'en'
            ? ` (${r.queued} queued for tomorrow)`
            : ` (${r.queued} 排队明日入账)`;
        }
        Farm.ui.toast(msg, 2800);
        setTimeout(() => this.open(), 600);
      };
      document.getElementById('exEpBtn').onclick = () => {
        const n = Math.max(0, parseInt(exEpAmt.value, 10) || 0);
        const r = Farm.state.exchangeEpToCoins(n);
        if (!r.ok) {
          Farm.ui.toast(lang === 'en' ? 'Not enough EP' : '积分不够');
          if (Farm.audio) Farm.audio.play('error');
          return;
        }
        Farm.ui.refreshHUD();
        if (Farm.audio) Farm.audio.play('coin');
        Farm.ui.toast(`🔄 +${r.coinsGained} <span class="coin-icon"></span>`, 2200);
        setTimeout(() => this.open(), 600);
      };
      document.getElementById('openEpShopBtn').onclick = () => {
        if (Farm.epShop) Farm.epShop.open();
      };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.rewards = rewards;
})();
