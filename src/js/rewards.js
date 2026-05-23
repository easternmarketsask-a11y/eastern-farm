/**
 * rewards.js — East Point → real Eastern Market coupon redemption.
 *
 * V1 model: pre-generated codes in data/coupons.json. Player redeems by
 * spending East Points; we mark the code as used in localStorage to
 * prevent re-redemption. Cashier validates by code lookup.
 *
 * V2: backend API for live validation.
 */
(function() {
  const rewards = {
    couponData: null,

    async load() {
      try {
        const res = await fetch('../data/coupons.json');
        this.couponData = await res.json();
      } catch (e) {
        console.error('coupons load failed', e);
        this.couponData = { tiers: {}, codes: [] };
      }
    },

    open() {
      const lang = Farm.state.data.language;
      const data = this.couponData || { tiers: {}, codes: [] };
      const tiers = data.tiers || {};
      const playerPoints = Farm.state.data.eastPoints;

      const tierEntries = Object.entries(tiers);

      const html = `
        <h2 class="modal-title">🎁 ${Farm.i18n.t('rewards_title')}</h2>
        <p class="modal-subtitle">${Farm.i18n.t('rewards_subtitle')}</p>

        <div style="text-align:center;margin-bottom:16px;padding:12px;background:linear-gradient(135deg,#f4e8ff,#e8d5ff);border-radius:var(--radius-md);">
          <div style="font-size:12px;color:var(--warm-text-soft);">${Farm.i18n.t('currency_east_points')}</div>
          <div style="font-size:24px;font-weight:700;color:var(--purple-points);">🎫 ${playerPoints}</div>
        </div>

        ${tierEntries.map(([tierId, tier]) => {
          const label = tier[lang === 'en' ? 'value_label_en' : 'value_label_zh'];
          const canAfford = playerPoints >= tier.cost_points;
          const available = data.codes.filter(c => !c.used && c.tier === tierId && !Farm.state.data.redeemedCoupons.includes(c.code)).length;
          const outOfStock = available === 0;
          return `
            <div class="reward-tier">
              <div class="reward-info">
                <div class="reward-value">${label}</div>
                <div class="reward-cost">🎫 ${tier.cost_points} ${lang === 'en' ? 'points' : '点'}</div>
                ${outOfStock ? `<div style="font-size:10px;color:#999;margin-top:2px;">${lang === 'en' ? 'Sold out' : '已售罄'}</div>` : ''}
              </div>
              <button class="btn-exchange" data-tier="${tierId}" ${(!canAfford || outOfStock) ? 'disabled' : ''}>
                ${Farm.i18n.t('btn_exchange')}
              </button>
            </div>
          `;
        }).join('')}

        <div style="margin-top:16px;padding:10px;background:#fff8e1;border-radius:var(--radius-md);font-size:11px;color:var(--warm-text-soft);line-height:1.5;">
          ${lang === 'en'
            ? '💡 How it works: Exchange points → get a coupon code → screenshot and show at Eastern Market checkout.'
            : '💡 玩法说明：兑换后会拿到优惠码，截图保存，在东方超市结账时给收银员看即可。'}
        </div>

        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      document.querySelectorAll('.btn-exchange[data-tier]').forEach(btn => {
        if (btn.disabled) return;
        btn.onclick = () => {
          this.confirmExchange(btn.dataset.tier);
        };
      });
    },

    confirmExchange(tierId) {
      const lang = Farm.state.data.language;
      const tier = this.couponData.tiers[tierId];
      const label = tier[lang === 'en' ? 'value_label_en' : 'value_label_zh'];

      const html = `
        <h2 class="modal-title">${lang === 'en' ? 'Confirm Exchange' : '确认兑换'}</h2>
        <p style="text-align:center;margin:16px 0;font-size:14px;">
          ${Farm.i18n.t('rewards_confirm_zh', { points: tier.cost_points, value: label })}
        </p>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.rewards.open()">${Farm.i18n.t('btn_cancel')}</button>
          <button class="btn" id="confirmRedeemBtn">${Farm.i18n.t('btn_confirm')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      document.getElementById('confirmRedeemBtn').onclick = () => this.doExchange(tierId);
    },

    doExchange(tierId) {
      const tier = this.couponData.tiers[tierId];
      if (!tier) return;

      if (!Farm.state.spendEastPoints(tier.cost_points)) {
        Farm.ui.toast(Farm.i18n.t('toast_not_enough_points'));
        return;
      }

      // Find an unused code of this tier that this player hasn't already taken
      const redeemed = Farm.state.data.redeemedCoupons;
      const available = this.couponData.codes.filter(c =>
        c.tier === tierId && !c.used && !redeemed.includes(c.code)
      );
      if (available.length === 0) {
        // Edge case: out of stock right after they spent points. Refund.
        Farm.state.addEastPoints(tier.cost_points);
        Farm.ui.toast('Sorry, sold out!');
        this.open();
        return;
      }

      const picked = available[Math.floor(Math.random() * available.length)];
      // Mark used (this is client-side; cashier should also confirm)
      picked.used = true;
      Farm.state.data.redeemedCoupons.push(picked.code);
      Farm.state.recordCouponRedeem();
      Farm.state.save();
      Farm.ui.refreshHUD();
      if (Farm.audio) Farm.audio.play('coin');
      if (Farm.achievements) Farm.achievements.checkAll();

      this.showCouponCode(picked, tier);
    },

    showCouponCode(coupon, tier) {
      const lang = Farm.state.data.language;
      const label = tier[lang === 'en' ? 'value_label_en' : 'value_label_zh'];
      const expiry = new Date(Date.now() + tier.expires_days * 86400000);
      const expiryStr = expiry.toISOString().slice(0, 10);

      const html = `
        <h2 class="modal-title">🎉 ${Farm.i18n.t('rewards_code_title')}</h2>
        <div class="coupon-display">
          <div class="coupon-value">${label}</div>
          <div class="coupon-code">${coupon.code}</div>
          <div class="coupon-instruction">${Farm.i18n.t('rewards_code_instruction')}</div>
          <div style="font-size:11px;color:var(--warm-text-soft);margin-top:6px;">
            ${Farm.i18n.t('rewards_code_valid_until', { date: expiryStr })}
          </div>
          <div style="font-size:11px;color:var(--barn-red);margin-top:8px;font-weight:600;">
            📸 ${Farm.i18n.t('rewards_save_screenshot')}
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.rewards = rewards;
})();
