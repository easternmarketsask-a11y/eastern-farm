/**
 * login-calendar.js — 7-day sign-in calendar (Farm.loginCalendar)
 *
 * Replaces the old flat "+10 coins +1 EP × streak-multiplier" daily-login
 * reward (formerly in main.js checkDailyLogin) with an escalating 7-day
 * cycle, climaxing in a big day-7 reward + full-screen celebration (reuses
 * the level-up confetti via Farm.ui.showConfetti).
 *
 *   Farm.loginCalendar.maybeAutoOpen() → opens once on launch if unsigned today
 *   Farm.loginCalendar.open()          → render the 7-cell calendar modal
 *
 * Reward amounts are tuned to the existing economy: seed costs run 4-22
 * coins, the lottery's common prizes are ~100 coins / 3 EP (jackpot 100 EP),
 * and the OLD login reward topped out at 30 coins + 3 EP (day 14, ×3). This
 * calendar's day 1-6 sit in that same low range, with day 7 as the one
 * "jackpot-tier" spike (mirrors the lottery jackpot's 100 EP) plus a rare
 * seed bundle — a clear, motivating finish line without inflating the economy.
 */
(function() {
  // Reward table, index 0 = Day 1 ... index 6 = Day 7.
  // Sign-in rewards are FARM COINS only (per owner): daily-engagement rewards
  // give coins; 超市积分 stays scarce and is earned via tasks/harvest/etc.
  // (grantReward still supports ep/seeds, just unused for coins-only days.)
  const REWARDS = [
    { day: 1, coins: 20 },
    { day: 2, coins: 40 },
    { day: 3, coins: 60, seeds: 2 },
    { day: 4, coins: 90 },
    { day: 5, coins: 120, seeds: 2 },
    { day: 6, coins: 150 },
    { day: 7, coins: 400, seeds: 3, big: true },
  ];

  function rewardLine(r, lang) {
    const parts = [];
    // Use the project's standard currency icons (same as HUD / toasts /
    // float text), NOT raw 🪙/🎫 emoji which render inconsistently.
    if (r.coins) parts.push('+' + r.coins + '<span class="coin-icon"></span>');
    if (r.ep) parts.push('+' + r.ep + '<span class="points-icon"></span>');
    if (r.seeds) parts.push('+' + r.seeds + (lang === 'en' ? ' seeds 🌱' : ' 种子 🌱'));
    return parts.join(' ');
  }

  // Pick `n` random crop IDs the player has unlocked (mirrors daily.js's
  // approach to "today's special seed" candidate pool).
  function randomSeedIds(n) {
    const playerLevel = Farm.state.data.level;
    const candidates = Farm.crops.all().filter(c => c.unlock_level <= playerLevel);
    if (candidates.length === 0) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(candidates[Math.floor(Math.random() * candidates.length)].id);
    }
    return out;
  }

  function grantReward(r) {
    if (r.coins) Farm.state.addCoins(r.coins);
    if (r.ep) {
      Farm.state.addEastPoints(r.ep, {
        source: 'login_calendar',
        description: '7天签到 第 ' + r.day + ' 天奖励',
      });
    }
    if (r.seeds) {
      randomSeedIds(r.seeds).forEach(id => Farm.state.addSeed(id, 1));
    }
    Farm.ui.refreshHUD();
  }

  const loginCalendar = {
    _justClaimed: null,  // { dayIndex } set right after a successful sign-in this session

    // Auto-open once per launch if the player hasn't signed in today yet.
    maybeAutoOpen() {
      const cal = Farm.state.data.loginCalendar;
      const today = Farm.state.getDateString();
      if (cal.lastSignDate !== today) {
        setTimeout(() => this.open(), 600);
      }
    },

    open() {
      const lang = Farm.state.data.language;
      const cal = Farm.state.data.loginCalendar;
      const today = Farm.state.getDateString();
      const alreadySignedToday = cal.lastSignDate === today;
      const dayIndex = cal.dayIndex || 0;  // days claimed so far in this cycle

      const cells = REWARDS.map((r, idx) => {
        const dayNum = idx + 1;
        const signed = dayNum <= dayIndex;
        const isClaimable = !alreadySignedToday && dayNum === dayIndex + 1;
        const finalCls = signed ? 'lc-cell signed' : (isClaimable ? 'lc-cell claimable pulse' : 'lc-cell future');
        return `
          <div class="${finalCls}" data-day="${dayNum}">
            <div class="lc-cell-day">${lang === 'en' ? 'Day ' + dayNum : '第' + dayNum + '天'}</div>
            <div class="lc-cell-icon">${signed ? '✅' : (r.big ? '🎁' : '🌱')}</div>
            <div class="lc-cell-reward">${rewardLine(r, lang)}</div>
          </div>`;
      }).join('');

      const nextDay = alreadySignedToday ? null : (dayIndex + 1);
      const statusText = alreadySignedToday
        ? (lang === 'en' ? "You've signed in today — come back tomorrow!" : '今天已签到，明天再来吧！')
        : (lang === 'en' ? `Day ${nextDay} ready to claim` : `第 ${nextDay} 天奖励可领取`);

      const html = `
        <h2 class="modal-title">📅 ${lang === 'en' ? '7-Day Sign-in' : '七日签到'}</h2>
        <div class="lc-grid">${cells}</div>
        <div class="lc-status">${statusText}</div>
        <div class="btn-row">
          ${alreadySignedToday
            ? `<button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>`
            : `<button class="btn primary" id="lcClaimBtn">🎁 ${lang === 'en' ? 'Sign in' : '签到领取'}</button>`}
        </div>
      `;
      Farm.ui.showModal(html);

      const claimBtn = document.getElementById('lcClaimBtn');
      if (claimBtn) {
        claimBtn.onclick = () => this._claim();
      }
    },

    _claim() {
      const lang = Farm.state.data.language;
      const result = Farm.state.signTodayCalendar();
      // Already claimed today (e.g. a rapid double-tap before the modal
      // re-rendered) — bail so the reward isn't granted twice.
      if (!result.claimed) return;
      const dayIndex = result.dayIndex;  // 1-7
      const reward = REWARDS[dayIndex - 1];
      this._justClaimed = { dayIndex };

      grantReward(reward);

      if (Farm.audio) Farm.audio.play('coin');

      if (reward.big) {
        // Day-7 climax: reuse the level-up celebration confetti, dialed up.
        setTimeout(() => {
          this._showCelebration(reward, lang);
        }, 200);
      } else {
        const msg = lang === 'en'
          ? `📅 Day ${dayIndex} sign-in: ${rewardLine(reward, lang)}`
          : `📅 第 ${dayIndex} 天签到：${rewardLine(reward, lang)}`;
        Farm.ui.toast(msg, 3200);
        if (result.reset) {
          Farm.ui.toast(lang === 'en' ? 'A fresh week begins!' : '新的一轮开始啦', 2600);
        }
        // Re-render to show the signed state.
        setTimeout(() => this.open(), 350);
      }
    },

    _showCelebration(reward, lang) {
      const html = `
        <div class="lc-celebrate">
          <div class="lc-celebrate-emoji">🎉🎁🎉</div>
          <h2 class="modal-title">${lang === 'en' ? 'Day 7 — Big Reward!' : '第七天 · 超级大奖！'}</h2>
          <div class="lc-celebrate-reward">${rewardLine(reward, lang)}</div>
          <div class="lc-celebrate-sub">${lang === 'en' ? 'A new 7-day cycle starts tomorrow' : '明天开启新一轮 7 天签到'}</div>
          <div class="btn-row">
            <button class="btn primary" id="lcCelebrateOk">${Farm.i18n.t('btn_confirm')}</button>
          </div>
        </div>
      `;
      Farm.ui.showModal(html);
      const okBtn = document.getElementById('lcCelebrateOk');
      if (okBtn) okBtn.onclick = () => Farm.ui.hideModal();
      if (Farm.audio) Farm.audio.play('levelUp');
      // Bigger than the level-up shower (36/2600) — this is the climax.
      Farm.ui.showConfetti(60, 3200);
      if (navigator.vibrate) { try { navigator.vibrate([20, 60, 20, 60, 20]); } catch (_) {} }
    },
  };

  window.Farm = window.Farm || {};
  Farm.loginCalendar = loginCalendar;
})();
