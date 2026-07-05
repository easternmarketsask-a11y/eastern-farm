/**
 * promo.js — Limited-time launch promo (2026-06): sign in + reach Level 3 this
 * week → 3000 farm coins, once per account.
 *
 * Goal: nudge Eastern Market members to actually start PLAYING (not just open
 * once). Lv3 (~30 XP ≈ 5-6 harvests) proves real engagement; the time box
 * creates urgency. Reward is farm coins = zero real cost.
 *
 * Self-contained + easy to retire: after PROMO.endTs the banner hides and
 * check() no-ops. To run another promo, bump the PROMO object.
 *
 * Claim is guarded both locally (state.promoClaims) and per-account (mirrored
 * into gameStats.promoClaims via firebase-game-sync push), so resetting the
 * local save doesn't re-grant it.
 */
(function () {
  const PROMO = {
    id: 'lv3_week_202606',
    targetLevel: 3,
    rewardCoins: 3000,
    // Local time. Ends Sunday 2026-06-14 23:59:59 ("本周内").
    endTs: new Date(2026, 5, 14, 23, 59, 59).getTime(),
    endLabel: '6/14',
  };

  const promo = {
    PROMO,

    isActive() { return Date.now() <= PROMO.endTs; },

    _claimed() {
      const s = (Farm.state && Farm.state.data) || {};
      if (s.promoClaims && s.promoClaims[PROMO.id]) return true;
      const md = Farm.fbAuth && Farm.fbAuth.memberDoc;
      const gs = (md && md.gameStats) || {};
      return !!(gs.promoClaims && gs.promoClaims[PROMO.id]);
    },

    eligible() {
      if (!this.isActive()) return false;
      // Must be a signed-in member — the whole point is to convert members
      // into players, and the reward needs an account to attach to.
      if (!(Farm.fbAuth && Farm.fbAuth.isLoggedIn())) return false;
      if (((Farm.state.data && Farm.state.data.level) || 1) < PROMO.targetLevel) return false;
      if (this._claimed()) return false;
      return true;
    },

    // Grant once. Safe to call repeatedly (boot, login, every level-up).
    check() {
      if (!this.eligible()) return false;
      Farm.state.data.promoClaims = Farm.state.data.promoClaims || {};
      Farm.state.data.promoClaims[PROMO.id] = true;
      Farm.state.addCoins(PROMO.rewardCoins);
      Farm.state.save();
      // Sync the claim flag to the account so other devices / a local reset
      // can't re-claim (push mirrors promoClaims into gameStats).
      if (Farm.fbGameSync && Farm.fbGameSync.push) Farm.fbGameSync.push();
      this._celebrate();
      return true;
    },

    _celebrate() {
      // 撞窗保护改由 showModal 的 queue:true 承担（UX 第 3 批 #7）：
      // 升级弹窗开着时本红包自动排队，关掉后依次弹出——不再自旋重试。
      const lang = (Farm.state.data && Farm.state.data.language) || 'zh';
      const html = `
        <div style="text-align:center;padding:8px 4px;">
          <div class="promo-gift-pop" style="font-size:56px;margin-bottom:6px;">🎁</div>
          <h2 class="modal-title">${lang === 'en' ? 'Level 3 reached!' : '恭喜升到 3 级！'}</h2>
          <p style="font-size:15px;color:var(--warm-text);margin:10px 0;">
            ${lang === 'en' ? 'Launch reward unlocked:' : '开业活动大红包到账：'}
          </p>
          <div class="promo-coin-amount" style="font-size:34px;font-weight:800;color:#b8860b;margin:8px 0;">
            <span class="coin-icon"></span> +<span id="promoCoinCount">0</span>
          </div>
          <p style="font-size:12px;color:var(--warm-text-soft);line-height:1.6;margin-top:10px;">
            ${lang === 'en'
              ? 'Spend it on seeds, decorations, a bigger silo — happy farming!'
              : '拿去买种子、装饰、扩仓库吧，开心种菜！'}
          </p>
          <button class="btn" style="width:100%;margin-top:14px;" onclick="Farm.ui.hideModal()">${lang === 'en' ? 'Awesome!' : '太好了！'}</button>
        </div>`;
      if (Farm.ui && Farm.ui.showModal) {
        Farm.ui.showModal(html, {
          queue: true,
          queueKey: 'promo_lv3',
          onShow: () => {
            // Dynamic payoff: golden coin rain + the number counting up + coin chimes.
            if (Farm.ui.coinBurst) Farm.ui.coinBurst(3);
            else if (Farm.ui.showConfetti) Farm.ui.showConfetti(40, 3000);
            if (Farm.audio) {
              Farm.audio.play('achievement');
              for (let c = 0; c < 4; c++) setTimeout(() => Farm.audio.play('coin'), 220 + c * 160);
            }
            this._countUp('promoCoinCount', PROMO.rewardCoins, 1100);
          },
        });
      }
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
    },

    // Animate a number from 0 → target (ease-out) into element #id.
    _countUp(id, target, dur) {
      const el = document.getElementById(id);
      if (!el) return;
      const start = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(target * eased).toLocaleString();
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = target.toLocaleString();
      };
      requestAnimationFrame(tick);
    },

    // Banner for the "今日" panel: shows the offer + progress, hides once
    // claimed or after the window closes.
    bannerHtml() {
      if (!this.isActive() || this._claimed()) return '';
      const lang = (Farm.state.data && Farm.state.data.language) || 'zh';
      const lv = (Farm.state.data && Farm.state.data.level) || 1;
      const loggedIn = Farm.fbAuth && Farm.fbAuth.isLoggedIn();
      const tip = !loggedIn
        ? (lang === 'en' ? 'Sign in + reach Lv3' : '先登录 + 升到 Lv3')
        : (lang === 'en' ? `Your level: Lv ${lv} / ${PROMO.targetLevel}` : `你的等级：Lv ${lv} / ${PROMO.targetLevel}`);
      return `
        <div class="daily-card" style="background:linear-gradient(135deg,#fff3d6,#ffe0a8);border:1.5px solid #f0c674;">
          <div class="daily-card-title">🎁 ${lang === 'en' ? 'Launch reward · ends ' + PROMO.endLabel : '开业奖励 · 截至 ' + PROMO.endLabel}</div>
          <div class="daily-card-body" style="line-height:1.6;">
            ${lang === 'en'
              ? `Reach <strong>Level ${PROMO.targetLevel}</strong> this week → <strong style="color:#b8860b;"><span class="coin-icon"></span> ${PROMO.rewardCoins.toLocaleString()}</strong>`
              : `本周内升到 <strong>${PROMO.targetLevel} 级</strong> → <strong style="color:#b8860b;"><span class="coin-icon"></span> ${PROMO.rewardCoins.toLocaleString()}</strong> 农场币`}
            <div style="font-size:12px;color:#8a5a12;margin-top:4px;">${tip}</div>
          </div>
        </div>`;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.promo = promo;
})();
