/**
 * login-nudge.js — Guest → login conversion prompt (Farm.loginNudge)
 *
 * Goal: turn engaged GUESTS into logged-in members (so they're saved, sync, and
 * show up in the backend). The splash already leads with login, but anyone who
 * tapped "先随便逛逛" plays as a guest and is invisible/unsaved. This catches
 * them at the first genuinely rewarding moment — their first sale — and offers
 * the reward + the real benefit (cloud save, never lose your farm).
 *
 * Discipline (Chris dislikes nag popups): fires ONCE ever (guestLoginPromptShown),
 * only for not-logged-in players, only when Firebase login is actually available,
 * and is freely dismissible ("以后再说").
 *
 *   Farm.loginNudge.maybe()  → show once if guest + not shown before
 */
(function () {
  // Keep in sync with firebase-points.js GAME_SIGNUP_BONUS_END / _COINS.
  const BONUS_END = '2026-08-31';
  const BONUS_COINS = 3000;
  const L = () => (Farm.state.data.language === 'en' ? 'en' : 'zh');

  const loginNudge = {
    maybe() {
      const d = Farm.state.data;
      if (!d || d.guestLoginPromptShown) return;
      // Already a member → nothing to convert.
      if (Farm.fbAuth && Farm.fbAuth.isLoggedIn && Farm.fbAuth.isLoggedIn()) return;
      // No Firebase (offline / CDN blocked) → login impossible, don't tease.
      if (!Farm.fb || !Farm.fb.available) return;
      d.guestLoginPromptShown = true;
      Farm.state.save();
      if (Farm.track) Farm.track('login_nudge_shown');
      // Land after the sell toast / spotlight celebration settles.
      setTimeout(() => this._show(), 2600);
    },

    _show() {
      const en = L() === 'en';
      const bonusActive = Farm.state.getDateString() <= BONUS_END;
      const reward = bonusActive
        ? (en ? `a <b>${BONUS_COINS.toLocaleString()}-coin</b> welcome gift` : `<b>${BONUS_COINS.toLocaleString()} 农场币</b>开局礼包`)
        : (en ? 'member rewards' : '会员奖励');
      const html = `
        <div class="ln-modal">
          <div class="ln-emoji">🎁</div>
          <h2 class="modal-title" style="margin-bottom:4px;">${en ? 'Sign in & keep your farm' : '登录，把农场存下来'}</h2>
          <p class="ln-body">${en
            ? `You made your first sale! Sign in with your Eastern Market membership for ${reward} — and your farm saves to the cloud, so you never lose it (even on a new phone).`
            : `你卖出第一笔啦！用东方超市会员登录，立得${reward}，进度还会云端保存——换手机也不丢。`}</p>
          <div class="btn-row ln-actions">
            <button class="btn" id="lnSignIn">📱 ${bonusActive
              ? (en ? `Sign in · claim ${BONUS_COINS.toLocaleString()}` : `登录 · 领 ${BONUS_COINS.toLocaleString()} 币`)
              : (en ? 'Sign in' : '会员登录')}</button>
            <button class="btn secondary" id="lnLater">${en ? 'Maybe later' : '以后再说'}</button>
          </div>
        </div>`;
      Farm.ui.showModal(html);
      const si = document.getElementById('lnSignIn');
      if (si) si.onclick = () => {
        if (Farm.track) Farm.track('login_nudge_accept');
        Farm.ui.hideModal();
        if (Farm.fbAuth && Farm.fbAuth.openLoginModal) Farm.fbAuth.openLoginModal();
      };
      const later = document.getElementById('lnLater');
      if (later) later.onclick = () => Farm.ui.hideModal();
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.loginNudge = loginNudge;
})();
