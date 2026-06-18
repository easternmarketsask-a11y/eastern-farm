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
    { day: 4, coins: 90, fert: 1 },
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
    if (r.fert) parts.push('+' + r.fert + (lang === 'en' ? ' fertilizer 🌟' : ' 化肥 🌟'));
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
    // Sign-in gives farm coins (+ seeds), never 超市积分 — keeps points scarce
    // and avoids an un-whitelisted server source. Don't re-add an ep branch here.
    if (r.coins) Farm.state.addCoins(r.coins);
    if (r.seeds) {
      randomSeedIds(r.seeds).forEach(id => Farm.state.addSeed(id, 1));
    }
    if (r.fert) {
      const eff = Farm.state.data.activeEffects || (Farm.state.data.activeEffects = {});
      eff.fertilizerCharges = (eff.fertilizerCharges || 0) + r.fert;
      Farm.state.save();
    }
    Farm.ui.refreshHUD();
  }

  const loginCalendar = {
    _justClaimed: null,  // { dayIndex } set right after a successful sign-in this session

    _autoOpened: false,   // 会话级防重：本次启动最多自动弹一次

    // Auto-open AT MOST ONCE PER CALENDAR DAY — not once per session.
    // 关键：玩家一天会开好几次游戏。旧逻辑只用会话级 _autoOpened 去重，
    // 没签就关掉的玩家每次重开都会被再弹一次 → 感觉「签到反复出现」。
    // 现在用持久化的 autoShownDate：当天弹过一次(签没签都算)就不再自动弹，
    // 想签仍可从「今日」面板进入。当天已签也不弹。
    // 独立 localStorage 键,不在游戏存档 blob 里 → 云端恢复/每日重置/存档替换
    // 都动不到它。这是"今天弹过没"的最终防线:无论存档状态怎么被覆盖,只要这个键
    // 是今天,就不再自动弹。(签到反复弹被报了三次,这次彻底解耦。)
    _shownKey: 'eastern_farm_signin_shown_v1',
    _shownToday() {
      try { return localStorage.getItem(this._shownKey) === Farm.state.getDateString(); }
      catch (_) { return false; }
    },
    _markShownToday() {
      try { localStorage.setItem(this._shownKey, Farm.state.getDateString()); } catch (_) {}
    },

    maybeAutoOpen() {
      // DISABLED (Chris 2026-06-17): the sign-in card no longer auto-pops. Players
      // open it from the「今日」panel sign-in card (去签到/查看). Kept as a no-op so
      // any remaining caller is harmless. Use Farm.loginCalendar.open() to show it.
      return;
      // eslint-disable-next-line no-unreachable
      if (this._autoOpened) return;
      // 全新玩家先看新手教程，签到日历让到下次启动——免得两个开屏弹窗
      // 在 600/700ms 互相覆盖。tutorialV1Done 未完成时本次不自动弹。
      if (!Farm.state.data.tutorialV1Done) return;
      // ⚠️ 反复弹出的真正根因（2026-06-15 定位）：localStorage 没持久化的设备
      // （微信内置浏览器 / iOS 存储回收 / 隐私模式）每次打开都是「空存档」加载——
      // 真正已登录的会员，其「今天已签」状态只在异步「云端恢复」回来后才有。
      // 若在云恢复完成前就判断，就会把卡片弹出来 → 每次打开都弹。
      // 所以：有 Firebase 且 auth 尚未 settle 时先不弹，等 auth+云恢复结束再判断
      // （firebase-auth 在 onAuthStateChanged 末尾回调；main.js 有 5s 兜底）。
      // 访客 / 无 Firebase 不等待。
      if (window.Farm && Farm.fb && Farm.fb.auth && Farm.fbAuth && !Farm.fbAuth.authSettled) return;
      const cal = Farm.state.data.loginCalendar;
      const today = Farm.state.getDateString();
      if (cal.lastSignDate === today) return;   // 当天已签
      if (cal.autoShownDate === today) return;   // 当天已自动弹过一次(存档内)
      if (this._shownToday()) return;            // 当天已自动弹过一次(独立键,防存档被覆盖)
      this._autoOpened = true;
      cal.autoShownDate = today;
      this._markShownToday();
      Farm.state.save();
      setTimeout(() => this.open(), 600);
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
            : `<button class="btn secondary" onclick="Farm.ui.hideModal()">${lang === 'en' ? 'Later' : '稍后'}</button>
               <button class="btn primary" id="lcClaimBtn">🎁 ${lang === 'en' ? 'Sign in' : '签到领取'}</button>`}
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

      // Persist the sign-in to the cloud IMMEDIATELY — NOT via state.save()'s
      // 60s-debounced push. On devices that don't keep localStorage (in-app
      // browser / iOS storage eviction / private mode), a refresh before the
      // debounce fires would lose the claim in BOTH local and cloud, so the
      // calendar reverts to the old cloud state and re-pops the same day forever
      // ("永远第4日"). An immediate push saves it server-side right away, and the
      // next load's cloud restore shows "signed today".
      if (Farm.fbGameSync && Farm.fbGameSync.push) { try { Farm.fbGameSync.push(); } catch (_) {} }

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
        // 签完直接收起（toast 已说明奖励）——不再回弹日历让用户多关一次
        // （Chris 2026-06-11：当天签过就不要再弹出）。
        Farm.ui.hideModal();
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
