/**
 * firebase-auth.js — Member login + auth state for the game.
 *
 * Registration is NOT supported in the game. Members must register at
 * the Eastern Market store (in-person via phone number) and on the main
 * easternmarket.ca site first. The game only signs them in.
 *
 * Same Firebase Auth project as the main store, so credentials work in
 * both places. Each origin has its own browser-side persistence — so
 * users do log in once per origin (game + main store separately), but
 * after that, both sites remember them.
 *
 * Topbar shows "登录 / Sign in" when not logged in, member name + tier
 * badge when logged in. Tap toggles login modal or logout confirmation.
 */
(function() {
  const auth = {
    currentUser: null,         // Firebase user object (or null)
    memberDoc: null,           // Member doc from members/{uid}
    listeners: [],             // subscribers to auth-state changes

    init() {
      if (!Farm.fb || !Farm.fb.available) {
        this._renderTopbar();
        return;
      }
      Farm.fb.auth.onAuthStateChanged(async (user) => {
        if (user) {
          this.currentUser = user;
          await this._loadMemberDoc(user.uid);
          this._notify();
          this._renderTopbar();
          // First-login backfill (delegates to Farm.fbPoints if loaded)
          if (Farm.fbPoints && Farm.fbPoints.firstLoginBackfill) {
            Farm.fbPoints.firstLoginBackfill(user);
          }
          // Flush any queued unsynced events
          if (Farm.fbQueue && Farm.fbQueue.flush) Farm.fbQueue.flush();
        } else {
          this.currentUser = null;
          this.memberDoc = null;
          // On signout: drop any cached server balance from state.eastPoints
          // so the next viewer doesn't see (or spend!) the previous user's EP.
          // Local-earned guest EP (unsyncedEp) is still safe.
          if (Farm.state && Farm.state.data) {
            Farm.state.data.eastPoints = Farm.state.data.unsyncedEp || 0;
            Farm.state.save();
            if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
          }
          this._notify();
          this._renderTopbar();
        }
      });
    },

    isLoggedIn() {
      return !!this.currentUser;
    },

    uid() {
      return this.currentUser ? this.currentUser.uid : null;
    },

    onChange(cb) {
      this.listeners.push(cb);
    },

    _notify() {
      this.listeners.forEach(cb => { try { cb(this.currentUser, this.memberDoc); } catch (e) {} });
    },

    async _loadMemberDoc(uid) {
      try {
        // Try direct doc first (matches main store pattern)
        const direct = await Farm.fb.db.collection('members').doc(uid).get();
        if (direct.exists) {
          this.memberDoc = { id: direct.id, ...direct.data() };
        } else {
          // Fallback: query by firebase_uid field (for legacy ru_ docs)
          const q = await Farm.fb.db.collection('members')
            .where('firebase_uid', '==', uid).limit(1).get();
          if (!q.empty) {
            const d = q.docs[0];
            this.memberDoc = { id: d.id, ...d.data() };
          } else {
            this.memberDoc = null;
          }
        }
      } catch (e) {
        console.warn('member doc load failed', e);
        this.memberDoc = null;
      }
      this._syncLocalBalance();
    },

    // Mirror the real member-account balance into state.eastPoints so the
    // game's display + spend logic sees the unified number. Game EP and
    // store EP are the same currency (1:1) — they MUST stay in lockstep.
    _syncLocalBalance() {
      if (!this.memberDoc || this.memberDoc.totalPoints == null) return;
      if (!Farm.state || !Farm.state.data) return;
      const newBalance = this.memberDoc.totalPoints || 0;
      if (Farm.state.data.eastPoints !== newBalance) {
        Farm.state.data.eastPoints = newBalance;
        Farm.state.save();
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      }
    },

    // ============ UI: topbar button ============
    _renderTopbar() {
      const slot = document.getElementById('memberButton');
      if (!slot) return;
      const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
      if (!Farm.fb || !Farm.fb.available) {
        slot.innerHTML = '';
        slot.style.display = 'none';
        return;
      }
      slot.style.display = '';
      if (this.currentUser) {
        const name = (this.memberDoc && (this.memberDoc.name || this.memberDoc.username))
          || this.currentUser.displayName
          || (this.currentUser.email ? this.currentUser.email.split('@')[0] : '')
          || (lang === 'en' ? 'Member' : '会员');
        const tier = this.memberDoc && this.memberDoc.tier ? this.memberDoc.tier : 'bronze';
        const tierEmoji = tier === 'gold' ? '🥇' : tier === 'silver' ? '🥈' : '🥉';
        const tierTitle = lang === 'en' ? 'Member: ' + name : '会员: ' + name;
        slot.innerHTML = `<button class="member-btn member-btn--in" id="memberBtnInner" title="${tierTitle}">${tierEmoji}<span class="member-name">${name}</span></button>`;
        document.getElementById('memberBtnInner').onclick = () => this.openMenu();
      } else {
        const title = lang === 'en' ? 'Sign in' : '登录';
        slot.innerHTML = `<button class="member-btn" id="memberBtnInner" title="${title}">👤</button>`;
        document.getElementById('memberBtnInner').onclick = () => this.openLoginModal();
      }
    },

    // ============ Login modal ============
    openLoginModal() {
      if (!Farm.fb || !Farm.fb.available) {
        Farm.ui.toast(Farm.state.data.language === 'en'
          ? 'Login unavailable — offline'
          : '当前无法登录 — 离线');
        return;
      }
      const lang = Farm.state.data.language;
      const html = `
        <h2 class="modal-title">👤 ${lang === 'en' ? 'Member Sign In' : '会员登录'}</h2>
        <p style="text-align:center;color:var(--warm-text-soft);font-size:12px;margin-bottom:16px;">
          ${lang === 'en'
            ? 'Sign in with your Eastern Market member account.'
            : '使用您的东方超市会员账户登录'}
        </p>
        <div style="margin-bottom:10px;">
          <label style="font-size:12px;color:var(--warm-text-soft);">${lang === 'en' ? 'Email' : '邮箱'}</label>
          <input type="email" id="memberEmail" class="member-input" autocomplete="email" />
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:12px;color:var(--warm-text-soft);">${lang === 'en' ? 'Password' : '密码'}</label>
          <input type="password" id="memberPassword" class="member-input" autocomplete="current-password" />
        </div>
        <div id="memberLoginError" style="color:var(--barn-red);font-size:11px;min-height:14px;margin-bottom:10px;"></div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
          <button class="btn" id="memberLoginBtn">${lang === 'en' ? 'Sign in' : '登录'}</button>
        </div>
        <p style="text-align:center;font-size:11px;color:var(--warm-text-soft);margin-top:16px;line-height:1.5;">
          ${lang === 'en'
            ? 'Not a member yet? Register in-store at 133-412 Willowgrove Square, Saskatoon.'
            : '还不是会员？到 133-412 Willowgrove Square 店内办理。'}
        </p>
      `;
      Farm.ui.showModal(html);
      setTimeout(() => {
        const emailEl = document.getElementById('memberEmail');
        if (emailEl) emailEl.focus();
      }, 100);
      document.getElementById('memberLoginBtn').onclick = () => this._tryLogin();
      // Enter key submits
      ['memberEmail', 'memberPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this._tryLogin();
        });
      });
    },

    async _tryLogin() {
      const lang = Farm.state.data.language;
      const email = document.getElementById('memberEmail').value.trim();
      const password = document.getElementById('memberPassword').value;
      const errEl = document.getElementById('memberLoginError');
      const btn = document.getElementById('memberLoginBtn');
      if (!email || !password) {
        errEl.textContent = lang === 'en' ? 'Email and password required.' : '请输入邮箱和密码。';
        return;
      }
      btn.disabled = true;
      btn.textContent = lang === 'en' ? 'Signing in…' : '登录中…';
      try {
        await Farm.fb.auth.signInWithEmailAndPassword(email, password);
        Farm.ui.hideModal();
        if (Farm.audio) Farm.audio.play('achievement');
        Farm.ui.toast(lang === 'en' ? '✅ Signed in' : '✅ 登录成功', 2200);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = lang === 'en' ? 'Sign in' : '登录';
        errEl.textContent = this._friendlyError(e, lang);
      }
    },

    _friendlyError(e, lang) {
      const c = e.code || '';
      if (c === 'auth/unauthorized-domain') {
        return lang === 'en'
          ? 'Login not yet enabled for this site. (Admin: add farm.easternmarket.ca to Firebase authorized domains.)'
          : '此站点尚未启用登录功能。（管理员：到 Firebase 添加 farm.easternmarket.ca 授权域）';
      }
      if (c === 'auth/user-not-found' || c === 'auth/invalid-credential' || c === 'auth/wrong-password') {
        return lang === 'en' ? 'Email or password incorrect.' : '邮箱或密码不正确。';
      }
      if (c === 'auth/too-many-requests') {
        return lang === 'en' ? 'Too many attempts. Try later.' : '尝试次数过多，稍后再试。';
      }
      if (c === 'auth/network-request-failed') {
        return lang === 'en' ? 'Network error. Check your connection.' : '网络错误，检查连接。';
      }
      return e.message || (lang === 'en' ? 'Sign-in failed.' : '登录失败。');
    },

    // ============ Logout / menu ============
    openMenu() {
      const lang = Farm.state.data.language;
      const m = this.memberDoc || {};
      const name = m.name || this.currentUser.displayName || this.currentUser.email;
      const tier = m.tier || 'bronze';
      const tierLabel = { gold: '🥇 ' + (lang === 'en' ? 'Gold' : '金卡'),
                          silver: '🥈 ' + (lang === 'en' ? 'Silver' : '银卡'),
                          bronze: '🥉 ' + (lang === 'en' ? 'Bronze' : '铜卡') }[tier];
      const totalPoints = m.totalPoints || 0;
      const lifetimePoints = m.lifetimePoints || 0;
      const html = `
        <h2 class="modal-title">👤 ${name}</h2>
        <div style="text-align:center;margin:12px 0;">
          <div style="font-size:14px;">${tierLabel}</div>
          <div style="font-size:24px;font-weight:700;color:var(--purple-points);margin-top:6px;">🎫 ${totalPoints.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--warm-text-soft);">
            ${lang === 'en' ? 'Lifetime: ' : '累积: '}${lifetimePoints.toLocaleString()}
          </div>
          <div style="font-size:11px;color:var(--warm-text-soft);margin-top:4px;">
            ${lang === 'en' ? 'Synced with Eastern Market account' : '已与东方超市会员账户同步'}
          </div>
        </div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
          <button class="btn" id="memberLogoutBtn" style="background:#999;">${lang === 'en' ? 'Sign out' : '退出登录'}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      document.getElementById('memberLogoutBtn').onclick = async () => {
        await Farm.fb.auth.signOut();
        Farm.ui.hideModal();
        Farm.ui.toast(lang === 'en' ? 'Signed out' : '已退出登录', 1800);
      };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbAuth = auth;
})();
