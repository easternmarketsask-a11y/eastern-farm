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

      /* 🔒 待激活账号（邮箱注册、还没到店激活）的口径是「**待领取**」，
         不是「你的超市积分」—— 他还不是会员，那些分还没进任何账户。
         把没兑现的说成已有的，是这条设计里最容易失信的一处。
         封顶数由后端下发（pendingCap），不在前端写死。 */
      const pm = (Farm.fbAuth && Farm.fbAuth.memberDoc) || {};
      const pending = !!pm._pending;
      const pendPts = Number(pm.pendingPoints || 0);
      const pendCap = Number(pm.pendingCap || 0);
      const pendFull = pendCap > 0 && pendPts >= pendCap;

      const balanceHTML = pending ? `
        <div class="ep-overview">
          <div class="ep-overview-balance">
            <div class="ep-overview-label">${lang === 'en' ? 'Held for you' : '待领取'}</div>
            <div class="ep-overview-value"><span class="points-icon"></span> ${pendPts.toLocaleString()}${pendCap ? ` / ${pendCap.toLocaleString()}` : ''}</div>
            <div class="ep-overview-note">
              ${pendFull
                ? (lang === 'en'
                    ? "That's the most we hold — come collect them"
                    : '已经攒满了，到店就能领')
                : (lang === 'en'
                    ? 'Give us your phone in store and these land on your member card'
                    : '到店报一下手机号，这些就到你的会员卡上')}
            </div>
            <div class="ep-overview-sync-note">
              ${lang === 'en'
                ? '133-412 Willowgrove Square · Mon–Sat 10am–6:30pm'
                : '133-412 Willowgrove Square · 周一至周六 10am–6:30pm'}
            </div>
          </div>
        </div>
      ` : `
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
                ? '⏱️ Shown instantly; synced to your account once daily.'
                : '⏱️ 实时显示，每日凌晨同步至会员账户'}
            </div>
          </div>
          <div class="ep-cap-row">
            <div>${lang === 'en' ? 'Daily limit: 500 points (resets each day)' : '每日上限 500 积分（每天重置）'}</div>
          </div>
        </div>
      `;

      const exchangeHTML = `
        <h3 class="rewards-section">${lang === 'en' ? '🔄 Exchange (10 : 1)' : '🔄 兑换 (10 : 1)'}</h3>
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

      // ⚠️ 这份「如何赚积分」列表是玩家可见的规则承诺，涉及真实会员积分——
      // 任何时候调整积分数值/概率（crops.js harvest、tasks.js、orders.js、
      // ep-shop.json 转盘），必须同步更新这里，别让页面说一套代码发一套。
      // （2026-07-02 对齐：签到已改纯农场币、金疙瘩 0.5%×20~100、首收 +5，
      // 补上订单/大转盘两个真实存在但此前没写的来源。）
      const earnList = lang === 'en' ? [
        { icon: '📋', text: 'Daily tasks: some give +1~2 (3 tasks/day)' },
        { icon: '📦', text: 'Deliver Eastern Market\'s orders: occasional +1~2 (daily cap)' },
        { icon: '🌽', text: '3% lucky bonus on harvest +5' },
        { icon: '🎰', text: '0.5% Golden Nugget chance +20~100' },
        { icon: '🌅', text: 'First harvest of the day +5' },
        { icon: '☄️', text: 'Weekend (Sat/Sun) point rewards 2× (except Golden Nugget)' },
        { icon: '🎡', text: 'Daily wheel spin can win +3~100' },
        { icon: '🏆', text: 'Achievement unlock +5~+30' },
        { icon: '🎊', text: 'Festival-crop harvest bonus +2~4' },
        { icon: '🔄', text: 'Convert farm coins 10:1' },
      ] : [
        { icon: '📋', text: '每日任务：部分带 +1~2（每日 3 个）' },
        { icon: '📦', text: '给东超交订单：不定期 +1~2（每日有上限）' },
        { icon: '🌽', text: '收获时 3% 幸运积分 +5' },
        { icon: '🎰', text: '0.5% 金疙瘩大奖 +20~100' },
        { icon: '🌅', text: '今日首次收获 +5' },
        { icon: '☄️', text: '周末（六/日）积分奖励 ×2（金疙瘩除外）' },
        { icon: '🎡', text: '每日大转盘有机会中 +3~100' },
        { icon: '🏆', text: '解锁成就 +5~+30' },
        { icon: '🎊', text: '节日限定作物收获额外 +2~4' },
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
          🛍️ ${lang === 'en' ? 'Open Shop' : '打开商店'}
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
        if (Farm.shop) Farm.shop.open('consumable');
        else if (Farm.epShop) Farm.epShop.open();
      };
    },

    // 农场币信息面板（点左上农场币卡片打开）：余额 + 兑换入口 + 获取规则。
    openCoinInfo() {
      const lang = Farm.state.data.language;
      const EN = lang === 'en';
      const coins = (Farm.state.data.coins || 0).toLocaleString();
      const coin = '<span class="coin-icon"></span>';
      const pts = '<span class="points-icon"></span>';

      const earn = EN ? [
        { icon: '🏪', t: 'Fill Eastern Market orders (main source)' },
        { icon: '🌅', t: "First delivery each day: +20% bonus" },
        { icon: '📅', t: 'Daily 7-day sign-in: 20–400 coins' },
        { icon: '📋', t: 'Finish daily tasks' },
        { icon: '🏘', t: 'Visit 3 neighbors a day: +40' },
        { icon: '❤️', t: 'Like / water neighbors: +5 / +10' },
        { icon: '⭐', t: 'Level up: +50 per level' },
        { icon: '🎰', t: 'Daily lottery wheel' },
        { icon: '📨', t: 'Invite a friend: +200 each' },
      ] : [
        { icon: '🏪', t: '按订单交货给东超（最主要来源）' },
        { icon: '🌅', t: '每天第一次交货 +20% 加成' },
        { icon: '📅', t: '七日签到：每天 20–400 农场币' },
        { icon: '📋', t: '完成每日任务' },
        { icon: '🏘', t: '每天走访 3 户邻居 +40' },
        { icon: '❤️', t: '给邻居点赞 / 帮浇水：+5 / +10' },
        { icon: '⭐', t: '升级：每级 +50' },
        { icon: '🎰', t: '每日大转盘' },
        { icon: '📨', t: '邀请好友：两人各得 +200' },
      ];

      const html = `
        <h2 class="modal-title">${coin} ${EN ? 'Farm Coins' : '农场币'}</h2>
        <div class="ep-overview coininfo-overview">
          <div class="ep-overview-balance">
            <div class="ep-overview-label">${EN ? 'Your farm coins' : '当前农场币余额'}</div>
            <div class="ep-overview-value">${coin} ${coins}</div>
            <div class="ep-overview-note">
              ${EN
                ? "The farm's currency — earn by selling crops, spend on seeds, shop & expansion."
                : '农场里的通用货币，交货赚取，用来买种子、逛商城、扩建农场。'}
            </div>
          </div>
          <div class="ep-cap-row">
            <div>🔄 ${EN
              ? `<b>10 coins → 1</b> ${pts} point · daily cap 500`
              : `<b>10 农场币 → 1</b> ${pts} 超市积分 · 每日上限 500`}</div>
          </div>
        </div>
        <h3 class="rewards-section">${EN ? '💡 How to earn coins' : '💡 如何赚农场币'}</h3>
        <ul class="earn-list">
          ${earn.map(e => `<li><span class="earn-icon">${e.icon}</span> ${e.t}</li>`).join('')}
        </ul>
        <div class="btn-row" style="margin-top:14px;gap:8px;">
          <button class="btn" id="coinInfoExchange" style="flex:1.2;">🔄 ${EN ? 'Exchange for points' : '兑换超市积分'}</button>
          <button class="btn secondary" id="coinInfoShop" style="flex:1;">🛍️ ${EN ? 'Shop' : '商城'}</button>
          <button class="btn secondary" onclick="Farm.ui.hideModal()" style="flex:0.7;">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      const exBtn = document.getElementById('coinInfoExchange');
      if (exBtn) exBtn.onclick = () => this.open();          // 兑换面板里有币↔积分双向兑换
      const shopBtn = document.getElementById('coinInfoShop');
      if (shopBtn) shopBtn.onclick = () => { if (Farm.shop) Farm.shop.open(); else if (Farm.epShop) Farm.epShop.open(); };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.rewards = rewards;
})();
