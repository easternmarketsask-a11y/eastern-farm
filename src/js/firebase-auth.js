/**
 * firebase-auth.js — Member login for the game.
 *
 * Same Firebase project as the main store (eastern-market-members), so:
 * - The phone number you registered at the store IS your login.
 * - Email-and-password login still works for legacy members.
 * - Points balance + tier badge sync automatically across game + main site.
 *
 * Phone login flow (mirrors easternmarket.ca/login):
 *   1. User enters phone (auto-formatted "(306) 123-4567")
 *   2. Visible reCAPTCHA ("I'm not a robot") — iOS Safari requirement
 *   3. Tap "发送验证码" → membership lookup + SMS sent in parallel
 *      (signInWithPhoneNumber MUST be sync in the click handler — any
 *      `await` before it kills the iOS gesture and the reCAPTCHA
 *      iframe hangs silently)
 *   4. Non-member → friendly "register at store" panel, NO SMS sent
 *   5. Member → 6 boxes for OTP code (auto-focus next, auto-submit on 6th)
 *   6. Verify → Firebase Auth user created/linked → members.firebase_uid
 *      updated if missing → welcome toast
 *
 * UX optimizations:
 *   - Phone tab default; email tab hidden behind "其他登录方式" link
 *   - "+1" prefix shown so users don't add country code by mistake
 *   - Last phone remembered in localStorage, prefilled on next open
 *   - 6 separate digit boxes (mobile UX standard) instead of one input
 *   - Auto-submit when 6 digits typed/pasted
 *   - Splash screen has direct "登录" button (no need to enter game first)
 *   - Welcome toast on success with tier badge
 */
(function () {
  const REMEMBER_KEY = 'eastern_farm_last_phone';

  const auth = {
    currentUser: null,
    memberDoc: null,
    listeners: [],
    _confirmation: null,     // Firebase ConfirmationResult during OTP flow
    _recaptcha: null,        // RecaptchaVerifier instance
    _activeTab: 'phone',     // 'phone' | 'email'
    _phoneStep: 1,           // 1 = enter phone, 2 = enter OTP

    init() {
      if (!Farm.fb || !Farm.fb.available) {
        this._renderTopbar();
        return;
      }
      Farm.fb.auth.onAuthStateChanged(async (user) => {
        // Funnel: count a guest open only when auth has actually RESOLVED with no
        // user (a fixed boot timer miscounts slow auth restores as guests).
        const _firstResolve = !this._authResolvedOnce;
        this._authResolvedOnce = true;
        if (_firstResolve && !user && Farm.track) Farm.track('open_guest');
        if (user) {
          this.currentUser = user;
          await this._loadMemberDoc(user.uid);
          this._notify();
          this._renderTopbar();
          this._renderSplash();
          // Cloud restore BEFORE push: if the cloud save is more advanced than
          // local (new device, cleared storage, iOS private-mode loss), pull it
          // back so the player sees their real farm — then push reconciles. The
          // decision rule inside restoreFromCloud never clobbers active local play.
          if (this.memberDoc && Farm.fbGameSync && Farm.fbGameSync.restoreFromCloud) {
            try {
              const r = await Farm.fbGameSync.restoreFromCloud();
              if (r && r.restored) {
                this._syncLocalBalance();   // re-apply real store points over the restored blob
                if (Farm.farm && Farm.farm.renderGrid) Farm.farm.renderGrid();
                if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
                if (Farm.harvestStatus && Farm.harvestStatus.render) Farm.harvestStatus.render();
                if (Farm.seasons && Farm.seasons.apply) Farm.seasons.apply();
                this._renderSplash();
                const lang = (Farm.state.data.language) === 'en' ? 'en' : 'zh';
                if (Farm.ui && Farm.ui.toast) {
                  Farm.ui.toast(lang === 'en'
                    ? '☁️ Farm restored from your account'
                    : '☁️ 已从你的账号恢复农场进度', 3000);
                }
              }
            } catch (e) { console.warn('[auth] cloud restore failed', e); }
          }
          // Now that the REAL member doc has resolved, push gameStats to the
          // correct doc (members + farm_players). The push guard skipped any
          // earlier attempts while memberDoc was still unresolved.
          if (this.memberDoc && Farm.fbGameSync && Farm.fbGameSync.push) {
            Farm.fbGameSync.push();
          }
          // Limited-time promo: catch members who are ALREADY Lv3+ when they
          // sign in during the window (level-up hook covers reaching it live).
          if (Farm.promo && Farm.promo.check) {
            setTimeout(() => Farm.promo.check(), 1800);
          }
          if (Farm.fbPoints && Farm.fbPoints.firstLoginBackfill) {
            Farm.fbPoints.firstLoginBackfill(user);
          }
          // Limited-time welcome gift for store members (one-shot, member-doc-scoped)
          if (Farm.fbPoints && Farm.fbPoints.firstLoginGameSignupBonus) {
            Farm.fbPoints.firstLoginGameSignupBonus(user);
          }
          if (Farm.fbQueue && Farm.fbQueue.flush) Farm.fbQueue.flush();
          // 真会员互偷结算（spec 2026-06-11）：拉云端 stealEvents → 验证清地 →
          // 并入回家小报。错开其它开屏弹窗/同步。
          if (Farm.homeReport && Farm.homeReport.settleRealOnLogin) {
            setTimeout(() => Farm.homeReport.settleRealOnLogin(), 2200);
          }
          // 邀请奖励：?ref= 进来的新邻居，登录后双向发奖（幂等，一次性）
          if (Farm.fbGameSync && Farm.fbGameSync.applyReferral) {
            setTimeout(() => Farm.fbGameSync.applyReferral(), 3000);
          }
          // Neighbor likes received — reconcile + notify
          if (Farm.fbGameSync && Farm.fbGameSync.reconcileReceivedLikes) {
            setTimeout(async () => {
              const r = await Farm.fbGameSync.reconcileReceivedLikes();
              if (r && r.newLikes > 0) {
                const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
                const msg = r.coinsAwarded > 0
                  ? (lang === 'en'
                    ? `❤️ ${r.newLikes} new likes received! +${r.coinsAwarded} <span class="coin-icon"></span>`
                    : `❤️ 收到 ${r.newLikes} 个赞！+${r.coinsAwarded} <span class="coin-icon"></span>`)
                  : (lang === 'en'
                    ? `❤️ ${r.newLikes} new likes received! (daily limit reached)`
                    : `❤️ 收到 ${r.newLikes} 个赞！（今日上限已满）`);
                Farm.ui.toast(msg, 4000);
              }
            }, 1500);
          }
          // Friend gifts received — claim from server + notify
          if (Farm.fbGameSync && Farm.fbGameSync.reconcileGifts) {
            setTimeout(async () => {
              const gifts = await Farm.fbGameSync.reconcileGifts();
              if (!gifts || gifts.length === 0) return;
              const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
              // Show 1 toast per gift, staggered
              gifts.forEach((g, i) => {
                setTimeout(() => {
                  const safeFrom = String(g.fromName || '').replace(/[<>"&]/g, '') || (lang === 'en' ? 'A friend' : '一位朋友');
                  // Help + sticker get their own phrasing (not "sent you …").
                  if (g.kind === 'help') {
                    const amt = (g.payload && g.payload.amount) || 0;
                    Farm.ui.toast('💧 ' + safeFrom + (lang === 'en'
                      ? ' watered your crops! +' + amt + ' <span class="coin-icon"></span>'
                      : ' 帮你浇了水！+' + amt + ' <span class="coin-icon"></span>'), 3800);
                    if (Farm.audio) Farm.audio.play('coin');
                    if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
                    return;
                  }
                  if (g.kind === 'sticker') {
                    const emoji = (g.payload && g.payload.emoji) || '👍';
                    Farm.ui.toast(emoji + ' ' + safeFrom + (lang === 'en' ? ' said hi to your farm!' : ' 来你农场打了个招呼！'), 3600);
                    return;
                  }
                  let what;
                  if (g.kind === 'seed' && g.payload && g.payload.cropId) {
                    const def = Farm.crops.get(g.payload.cropId);
                    what = def ? ((lang === 'en' ? def.name_en : def.name_zh) + ' ' + (lang === 'en' ? 'seed' : '种子')) : (lang === 'en' ? 'a seed' : '一棵种子');
                  } else if ((g.kind === 'coins' || g.kind === 'ep') && g.payload && g.payload.amount) {
                    what = '+' + g.payload.amount + ' <span class="coin-icon"></span>';
                  } else {
                    what = lang === 'en' ? 'a gift' : '一份礼物';
                  }
                  Farm.ui.toast('🎁 ' + safeFrom + (lang === 'en' ? ' sent you ' : ' 送你 ') + what, 3800);
                  if (Farm.audio) Farm.audio.play('coin');
                  if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
                }, 2500 + i * 1400);
              });
            }, 2000);
          }
        } else {
          this.currentUser = null;
          this.memberDoc = null;
          if (Farm.state && Farm.state.data) {
            Farm.state.data.eastPoints = Farm.state.data.unsyncedEp || 0;
            Farm.state.save();
            if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
          }
          this._notify();
          this._renderTopbar();
          this._renderSplash();
        }
      });
    },

    // Update the splash login button: if already signed in, replace
    // the "登录" CTA with a friendly welcome chip showing nickname.
    // Uses the game's own level title (新手/学徒/...) rather than the
    // fake store tier (every member is "bronze" by default — tiering
    // isn't really implemented in the store side).
    _renderSplash() {
      const loginBtn = document.getElementById('splashLogin');
      if (!loginBtn) return;
      const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
      if (this.currentUser) {
        const stats = (this.memberDoc && this.memberDoc.gameStats) || {};
        const realName = (this.memberDoc && (this.memberDoc.name || this.memberDoc.username)) || '';
        const nickname = stats.nickname || (realName ? (realName.charAt(0) + '邻居') : (lang === 'en' ? 'Member' : '会员'));
        const safeName = String(nickname).replace(/[<>"&]/g, '');
        // Game level title (e.g. "Lv 5 学徒") — real because it's based
        // on actual XP earned in-game.
        const gameLv = (Farm.state && Farm.state.data && Farm.state.data.level) || 1;
        const titleObj = Farm.state && Farm.state.levelTitle ? Farm.state.levelTitle(gameLv) : null;
        const titleStr = titleObj ? (lang === 'en' ? titleObj.en : titleObj.zh) : '';
        loginBtn.innerHTML = `
          <span class="icon">🌱</span>
          <span>${lang === 'en' ? 'Welcome, ' : '欢迎回来，'}${safeName}${titleStr ? ' · Lv ' + gameLv + ' ' + titleStr : ''}</span>
        `;
        loginBtn.classList.add('splash-login--logged-in');
        loginBtn.onclick = () => {
          const startBtn = document.getElementById('splashStart');
          if (startBtn) startBtn.click();
        };
        // Already a member — drop the "sign in for 3000 coins" pitch and the
        // perks list, and relabel the ghost link to a plain "enter".
        const reward = document.getElementById('splashReward');
        if (reward) reward.style.display = 'none';
        const perks = document.getElementById('splashPerks');
        if (perks) perks.style.display = 'none';
        const startBtn = document.getElementById('splashStart');
        if (startBtn) {
          const zh = startBtn.querySelector('.splash-start-zh');
          const en = startBtn.querySelector('.splash-start-en');
          if (zh) zh.textContent = '进入农场';
          if (en) en.textContent = 'Enter ›';
        }
      } else {
        loginBtn.classList.remove('splash-login--logged-in');
        // Restore the guest conversion pitch (in case we're re-rendering after a
        // logout — the logged-in branch hid these / relabeled the ghost link).
        const reward = document.getElementById('splashReward');
        if (reward) reward.style.display = '';
        const perks = document.getElementById('splashPerks');
        if (perks) perks.style.display = '';
        const startBtn = document.getElementById('splashStart');
        if (startBtn) {
          const en = (Farm.state && Farm.state.data && Farm.state.data.language) === 'en';
          const zh = startBtn.querySelector('.splash-start-zh');
          const enEl = startBtn.querySelector('.splash-start-en');
          if (zh) zh.textContent = en ? 'Just look around' : '先随便逛逛';
          if (enEl) enEl.textContent = en ? '' : 'Just look around ›';
        }
      }
    },

    isLoggedIn() { return !!this.currentUser; },
    uid() { return this.currentUser ? this.currentUser.uid : null; },
    // Real member doc id (store-keyed; firebase_uid is a FIELD on it). ALL game
    // data (gameStats, push tokens, social) must be written here — NOT to
    // doc(uid), which would create an orphan doc with no name/phone. Falls back
    // to uid only when no member doc resolved (shouldn't happen once logged in).
    memberDocId() { return (this.memberDoc && this.memberDoc.id) || this.uid(); },
    onChange(cb) { this.listeners.push(cb); },
    _notify() { this.listeners.forEach(cb => { try { cb(this.currentUser, this.memberDoc); } catch (e) {} }); },

    async _loadMemberDoc(uid) {
      try {
        // 1. Fast path: the REAL member doc linked by firebase_uid.
        const q = await Farm.fb.db.collection('members').where('firebase_uid', '==', uid).limit(1).get();
        if (!q.empty) {
          const d = q.docs[0];
          this.memberDoc = { id: d.id, ...d.data() };
          this._syncLocalBalance();
          return;
        }
        // 2. Phone bridge: on a FIRST login the firebase_uid link may not be
        //    written yet (it races with onAuthStateChanged). Resolve the real
        //    member doc by the auth token's phone number so memberDocId() points
        //    at the store doc — NOT doc(uid), which would spawn an orphan
        //    ("匿名") gameStats doc. Best-effort backfill firebase_uid so the
        //    fast path works next time.
        const phone = (this.currentUser && this.currentUser.phoneNumber) || null;
        if (phone) {
          const pq = await Farm.fb.db.collection('members').where('phone', '==', phone).limit(1).get();
          if (!pq.empty) {
            const d = pq.docs[0];
            this.memberDoc = { id: d.id, ...d.data() };
            if (d.data().firebase_uid == null) {
              d.ref.update({ firebase_uid: uid, updatedAt: Farm.fb.serverTimestamp() }).catch(() => {});
            }
            this._syncLocalBalance();
            return;
          }
        }
        // 3. Last resort (legacy orphan keyed by uid, or genuinely nothing).
        const direct = await Farm.fb.db.collection('members').doc(uid).get();
        this.memberDoc = direct.exists ? { id: direct.id, ...direct.data() } : null;
      } catch (e) {
        console.warn('member doc load failed', e);
        this.memberDoc = null;
      }
      this._syncLocalBalance();
    },

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

    // ============ Topbar pill ============
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
          || (lang === 'en' ? 'Member' : '会员');
        // Removed gold/silver/bronze tier emoji — Eastern Market doesn't
        // actually implement membership tiers (every member doc has tier=
        // 'bronze' as a placeholder default). Use the game's own level
        // emoji which IS real (computed from XP earned).
        const safeName = String(name).replace(/[<>"&]/g, '');
        slot.innerHTML = `<button class="member-btn member-btn--in" id="memberBtnInner" title="${lang === 'en' ? 'Member: ' : '会员: '}${safeName}">🌱<span class="member-name">${safeName}</span></button>`;
        document.getElementById('memberBtnInner').onclick = () => this.openMenu();
      } else {
        const title = lang === 'en' ? 'Account' : '账户';
        slot.innerHTML = `<button class="member-btn" id="memberBtnInner" title="${title}">👤</button>`;
        document.getElementById('memberBtnInner').onclick = () => this.openGuestMenu();
      }
    },

    // ============ Login modal ============
    openLoginModal() {
      if (!Farm.fb || !Farm.fb.available) {
        Farm.ui.toast(Farm.state.data.language === 'en' ? 'Login unavailable — offline' : '当前无法登录 — 离线');
        return;
      }
      this._phoneStep = 1;
      this._activeTab = 'phone';
      this._confirmation = null;
      this._renderLoginModal();
    },

    _renderLoginModal() {
      const lang = Farm.state.data.language;
      const remembered = localStorage.getItem(REMEMBER_KEY) || '';

      const phoneTab = this._activeTab === 'phone';
      const tabBar = `
        <div class="auth-tab-bar">
          <button class="auth-tab ${phoneTab ? 'active' : ''}" data-auth-tab="phone">
            📱 ${lang === 'en' ? 'Phone' : '手机号'}
          </button>
          <button class="auth-tab ${!phoneTab ? 'active' : ''}" data-auth-tab="email">
            ✉️ ${lang === 'en' ? 'Email' : '邮箱'}
          </button>
        </div>
      `;

      const body = phoneTab
        ? (this._phoneStep === 1 ? this._renderPhoneStep1(lang, remembered) : this._renderPhoneStep2(lang))
        : this._renderEmailTab(lang);

      const html = `
        <h2 class="modal-title">👤 ${lang === 'en' ? 'Member Sign In' : '会员登录'}</h2>
        ${tabBar}
        <div id="authError" class="auth-error"></div>
        ${body}
        <p class="auth-footnote">${lang === 'en'
          ? 'Not a member? Sign up free at 133-412 Willowgrove Square, Saskatoon.'
          : '还不是会员？到 133-412 Willowgrove Square 店内免费办理。'}</p>
      `;
      Farm.ui.showModal(html);
      this._wireLoginModal();
    },

    _renderPhoneStep1(lang, remembered) {
      return `
        <div class="auth-field">
          <label class="auth-label">${lang === 'en' ? 'Phone number' : '手机号码'}</label>
          <div class="auth-phone-input">
            <span class="auth-phone-prefix">+1</span>
            <input type="tel" id="authPhone" class="auth-input auth-input-phone"
                   inputmode="numeric" autocomplete="tel-national" maxlength="14"
                   value="${remembered}" placeholder="(306) 123-4567"/>
          </div>
          <div class="auth-hint">${lang === 'en' ? 'Use the phone you registered at the store' : '请使用您在店内留过的手机号'}</div>
        </div>
        <div class="auth-recaptcha-wrap">
          <div id="authRecaptcha"></div>
        </div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
          <button class="btn" id="authSendBtn">${lang === 'en' ? 'Send Code' : '发送验证码'}</button>
        </div>
      `;
    },

    _renderPhoneStep2(lang) {
      return `
        <div class="auth-field">
          <label class="auth-label">${lang === 'en' ? 'Verification code' : '验证码'}</label>
          <div class="auth-otp-grid" id="authOtpGrid">
            ${[0, 1, 2, 3, 4, 5].map(i =>
              // Only the FIRST box gets one-time-code autocomplete; iOS only
              // looks at the focused field, and we now distribute multi-digit
              // input across all 6 (see _wireOtpBoxes). Other boxes get
              // autocomplete=off to suppress weird keyboard suggestions.
              i === 0
                ? `<input type="tel" inputmode="numeric" maxlength="6" class="auth-otp-box" data-otp-idx="0" autocomplete="one-time-code"/>`
                : `<input type="tel" inputmode="numeric" maxlength="1" class="auth-otp-box" data-otp-idx="${i}" autocomplete="off"/>`
            ).join('')}
          </div>
          <div class="auth-hint">
            <span id="authResendArea"></span>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn secondary" id="authBackBtn">${lang === 'en' ? 'Back' : '返回'}</button>
          <button class="btn" id="authVerifyBtn" disabled>${lang === 'en' ? 'Verify' : '验证登录'}</button>
        </div>
      `;
    },

    _renderEmailTab(lang) {
      return `
        <div class="auth-field">
          <label class="auth-label">${lang === 'en' ? 'Email' : '邮箱'}</label>
          <input type="email" id="authEmail" class="auth-input" autocomplete="email"/>
        </div>
        <div class="auth-field">
          <label class="auth-label">${lang === 'en' ? 'Password' : '密码'}</label>
          <input type="password" id="authPassword" class="auth-input" autocomplete="current-password"/>
        </div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
          <button class="btn" id="authEmailBtn">${lang === 'en' ? 'Sign in' : '登录'}</button>
        </div>
      `;
    },

    _wireLoginModal() {
      // Tab switching
      document.querySelectorAll('.auth-tab[data-auth-tab]').forEach(btn => {
        btn.onclick = () => {
          this._activeTab = btn.dataset.authTab;
          this._phoneStep = 1;
          this._renderLoginModal();
        };
      });

      if (this._activeTab === 'phone' && this._phoneStep === 1) {
        // Pre-render visible reCAPTCHA. Must use 'normal' size (visible
        // checkbox) — invisible reCAPTCHA hangs on iOS Safari.
        try {
          if (this._recaptcha) { try { this._recaptcha.clear(); } catch (e) {} }
          this._recaptcha = new firebase.auth.RecaptchaVerifier('authRecaptcha', { size: 'normal' });
          this._recaptcha.render().catch(e => console.warn('reCAPTCHA render failed', e));
        } catch (e) {
          console.warn('reCAPTCHA init failed', e);
        }

        // Auto-focus + format-as-you-type
        const phoneEl = document.getElementById('authPhone');
        if (phoneEl) {
          setTimeout(() => phoneEl.focus(), 100);
          phoneEl.oninput = (e) => {
            const formatted = this._formatPhone(e.target.value);
            e.target.value = formatted;
          };
          phoneEl.onkeydown = (e) => { if (e.key === 'Enter') this._sendCode(); };
        }
        const sendBtn = document.getElementById('authSendBtn');
        if (sendBtn) sendBtn.onclick = () => this._sendCode();

      } else if (this._activeTab === 'phone' && this._phoneStep === 2) {
        this._wireOtpBoxes();
        document.getElementById('authBackBtn').onclick = () => {
          this._phoneStep = 1;
          this._renderLoginModal();
        };
        document.getElementById('authVerifyBtn').onclick = () => this._verifyOtp();
        this._startResendCountdown(60);

      } else if (this._activeTab === 'email') {
        const emailEl = document.getElementById('authEmail');
        if (emailEl) setTimeout(() => emailEl.focus(), 100);
        const btn = document.getElementById('authEmailBtn');
        if (btn) btn.onclick = () => this._emailLogin();
        ['authEmail', 'authPassword'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.onkeydown = (e) => { if (e.key === 'Enter') this._emailLogin(); };
        });
      }
    },

    _wireOtpBoxes() {
      const boxes = document.querySelectorAll('.auth-otp-box');
      // Distribute a multi-digit string across boxes — handles iOS Safari
      // SMS auto-fill (whole 6-digit code drops into the focused box) AND
      // user paste. Previously we sliced to 1 digit and threw away the
      // other 5 — Chris's "OTP input bug" root cause.
      const distribute = (digits) => {
        for (let i = 0; i < boxes.length; i++) {
          boxes[i].value = digits[i] || '';
        }
        if (digits.length >= boxes.length) {
          boxes[boxes.length - 1].focus();
          this._updateOtpVerifyBtn();
          setTimeout(() => this._verifyOtp(), 100);
        } else if (digits.length > 0) {
          boxes[digits.length].focus();
          this._updateOtpVerifyBtn();
        } else {
          this._updateOtpVerifyBtn();
        }
      };
      boxes.forEach((box, idx) => {
        box.oninput = (e) => {
          const v = (e.target.value || '').replace(/\D/g, '');
          // Multi-digit value (autofill / paste / suggestion bar)
          if (v.length > 1) {
            distribute(v);
            return;
          }
          // Single-digit normal input
          e.target.value = v;
          if (v && idx < boxes.length - 1) {
            boxes[idx + 1].focus();
          }
          this._updateOtpVerifyBtn();
          if (this._collectOtp().length === 6) {
            setTimeout(() => this._verifyOtp(), 100);
          }
        };
        box.onkeydown = (e) => {
          if (e.key === 'Backspace' && !box.value && idx > 0) {
            boxes[idx - 1].focus();
          } else if (e.key === 'ArrowLeft' && idx > 0) {
            boxes[idx - 1].focus();
          } else if (e.key === 'ArrowRight' && idx < boxes.length - 1) {
            boxes[idx + 1].focus();
          }
        };
        // Paste handler — covers desktop Ctrl/Cmd+V, mobile long-press paste
        box.onpaste = (e) => {
          e.preventDefault();
          const raw = (e.clipboardData || window.clipboardData).getData('text');
          distribute(raw.replace(/\D/g, ''));
        };
      });
      setTimeout(() => boxes[0] && boxes[0].focus(), 100);
    },

    _collectOtp() {
      return Array.from(document.querySelectorAll('.auth-otp-box')).map(b => b.value).join('');
    },

    _updateOtpVerifyBtn() {
      const btn = document.getElementById('authVerifyBtn');
      if (btn) btn.disabled = this._collectOtp().length !== 6;
    },

    _startResendCountdown(secs) {
      const area = document.getElementById('authResendArea');
      if (!area) return;
      const lang = Farm.state.data.language;
      let remaining = secs;
      const tick = () => {
        if (remaining <= 0) {
          area.innerHTML = `<button class="auth-resend-link" id="authResendBtn">${lang === 'en' ? 'Resend code' : '重新发送验证码'}</button>`;
          const btn = document.getElementById('authResendBtn');
          if (btn) btn.onclick = () => {
            this._phoneStep = 1;
            this._renderLoginModal();
          };
          return;
        }
        area.textContent = lang === 'en' ? `Resend in ${remaining}s` : `${remaining} 秒后可重新发送`;
        remaining--;
        setTimeout(tick, 1000);
      };
      tick();
    },

    _formatPhone(v) {
      const d = v.replace(/\D/g, '').slice(0, 10);
      if (d.length <= 3) return d;
      if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
      return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
    },

    _showError(msg) {
      const el = document.getElementById('authError');
      if (el) {
        el.textContent = msg;
        el.style.display = msg ? 'block' : 'none';
      }
    },

    // ============ Phone login: Step 1 — send SMS ============
    _sendCode() {
      // CRITICAL: this function must NOT contain `await` before
      // signInWithPhoneNumber is called. iOS Safari consumes the user
      // gesture if we await first, then Firebase's reCAPTCHA iframe
      // hangs silently forever. We run the membership check IN PARALLEL.
      const lang = Farm.state.data.language;
      this._showError('');
      const phoneEl = document.getElementById('authPhone');
      const phoneRaw = (phoneEl && phoneEl.value) || '';
      const digits = phoneRaw.replace(/\D/g, '');
      if (digits.length !== 10) {
        this._showError(lang === 'en' ? 'Please enter a 10-digit phone number.' : '请输入 10 位手机号码。');
        return;
      }
      if (!this._recaptcha) {
        this._showError(lang === 'en' ? 'reCAPTCHA not ready — refresh.' : '验证未就绪，刷新页面重试。');
        return;
      }
      const e164 = '+1' + digits;
      const sendBtn = document.getElementById('authSendBtn');
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = lang === 'en' ? 'Sending…' : '发送中…';
      }

      // Race: SMS send + membership lookup. Started SYNCHRONOUSLY.
      const smsP = Promise.race([
        Farm.fb.auth.signInWithPhoneNumber(e164, this._recaptcha),
        new Promise((_, rej) => setTimeout(() => rej(new Error('RECAPTCHA_TIMEOUT')), 20000)),
      ]);
      const memberP = Farm.fb.db.collection('members')
        .where('phone', '==', e164).limit(1).get().catch(() => null);

      memberP.then(snap => {
        if (!snap || snap.empty) {
          // Non-member: clean up orphan auth user (1 SMS is unfortunately spent
          // due to iOS sync constraint — unavoidable trade-off)
          if (Farm.fb.auth.currentUser) {
            Farm.fb.auth.currentUser.delete().catch(() => {});
          }
          smsP.catch(() => {});
          this._showError(lang === 'en'
            ? 'This phone is not registered at our store.\nPlease visit 133-412 Willowgrove Square to sign up (free).\nMon–Sat 10am–6:30pm · (306) 244-5522'
            : '此手机号未在店内登记。\n请光临本店免费办理：\n📍 133-412 Willowgrove Square\n🕐 周一至周六 10am–6:30pm\n☎️ (306) 244-5522');
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = lang === 'en' ? 'Send Code' : '发送验证码';
          }
          return;
        }
        // Member found → wait for SMS to actually send
        smsP.then(result => {
          this._confirmation = result;
          // Remember phone for next time AND retain for verify step
          // (the authPhone input is gone by step 2)
          this._currentPhoneE164 = e164;
          localStorage.setItem(REMEMBER_KEY, phoneRaw);
          this._phoneStep = 2;
          this._renderLoginModal();
        }).catch(e => {
          this._handleSmsError(e, lang, sendBtn);
        });
      });
    },

    _handleSmsError(e, lang, sendBtn) {
      console.warn('SMS send error', e);
      let msg;
      if (e && e.message === 'RECAPTCHA_TIMEOUT') {
        msg = lang === 'en' ? 'Verification timed out. Tick "I\'m not a robot" first.' : '验证超时，请先勾选"我不是机器人"再点发送';
        try { this._recaptcha.clear(); } catch (_) {}
        this._recaptcha = null;
        try {
          this._recaptcha = new firebase.auth.RecaptchaVerifier('authRecaptcha', { size: 'normal' });
          this._recaptcha.render().catch(() => {});
        } catch (_) {}
      } else if (e && e.code === 'auth/too-many-requests') {
        msg = lang === 'en' ? 'Too many attempts. Try again later.' : '尝试次数过多，请稍后再试。';
      } else if (e && (e.code === 'auth/captcha-check-failed' || e.code === 'auth/invalid-app-credential')) {
        msg = lang === 'en' ? 'Bot check failed. Refresh and try again.' : '机器人验证失败，请刷新页面后重试。';
      } else {
        msg = lang === 'en' ? 'Failed to send code. Please try again.' : '发送失败，请稍后再试。';
      }
      this._showError(msg);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = lang === 'en' ? 'Send Code' : '发送验证码';
      }
    },

    // ============ Phone login: Step 2 — verify OTP ============
    async _verifyOtp() {
      const lang = Farm.state.data.language;
      this._showError('');
      const code = this._collectOtp();
      if (code.length !== 6) {
        this._showError(lang === 'en' ? 'Please enter the 6-digit code.' : '请输入 6 位验证码。');
        return;
      }
      if (!this._confirmation) {
        this._showError(lang === 'en' ? 'Session expired. Resend code.' : '会话已过期，请重新发送验证码。');
        return;
      }
      const btn = document.getElementById('authVerifyBtn');
      if (btn) { btn.disabled = true; btn.textContent = lang === 'en' ? 'Verifying…' : '验证中…'; }
      try {
        const credential = await this._confirmation.confirm(code);
        const user = credential.user;
        // Link firebase_uid to members doc if not already set. Use the
        // phone we stored in step 1 — authPhone input no longer exists
        // by step 2 so reading it back from the DOM would return ''.
        const e164 = this._currentPhoneE164 || '';
        try {
          if (!e164) throw new Error('no phone');
          const snap = await Farm.fb.db.collection('members').where('phone', '==', e164).limit(1).get();
          if (!snap.empty) {
            const docRef = snap.docs[0].ref;
            const md = snap.docs[0].data();
            if (md.firebase_uid !== user.uid) {
              await docRef.update({
                firebase_uid: user.uid,
                updatedAt: Farm.fb.serverTimestamp(),
              });
            }
          }
        } catch (e) { /* non-fatal */ }
        this._onLoginSuccess(lang);
      } catch (e) {
        console.warn('OTP verify failed', e);
        this._showError(lang === 'en' ? 'Incorrect verification code.' : '验证码不正确。');
        if (btn) { btn.disabled = false; btn.textContent = lang === 'en' ? 'Verify' : '验证登录'; }
      }
    },

    // ============ Email login (legacy) ============
    async _emailLogin() {
      const lang = Farm.state.data.language;
      this._showError('');
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      if (!email || !password) {
        this._showError(lang === 'en' ? 'Email and password required.' : '请输入邮箱和密码。');
        return;
      }
      const btn = document.getElementById('authEmailBtn');
      if (btn) { btn.disabled = true; btn.textContent = lang === 'en' ? 'Signing in…' : '登录中…'; }
      try {
        await Farm.fb.auth.signInWithEmailAndPassword(email, password);
        this._onLoginSuccess(lang);
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = lang === 'en' ? 'Sign in' : '登录'; }
        const c = e.code || '';
        let msg;
        if (c === 'auth/unauthorized-domain') {
          msg = lang === 'en' ? 'Login not enabled for this site.' : '此站点尚未启用登录。';
        } else if (c === 'auth/user-not-found' || c === 'auth/invalid-credential' || c === 'auth/wrong-password') {
          msg = lang === 'en' ? 'Email or password incorrect.' : '邮箱或密码不正确。';
        } else {
          msg = lang === 'en' ? 'Sign-in failed.' : '登录失败。';
        }
        this._showError(msg);
      }
    },

    _onLoginSuccess(lang) {
      Farm.ui.hideModal();
      if (Farm.track) Farm.track('login');   // 漏斗:真实登录转化(仅主动登录成功时,非每次恢复)
      if (Farm.audio) Farm.audio.play('achievement');
      setTimeout(() => {
        const name = (this.memberDoc && (this.memberDoc.name || this.memberDoc.username))
          || (this.currentUser && this.currentUser.displayName)
          || (lang === 'en' ? 'Member' : '会员');
        const safeName = String(name).replace(/[<>"&]/g, '');
        const msg = lang === 'en'
          ? `🌱 Welcome back, ${safeName} 🎉`
          : `🌱 欢迎回来，${safeName} 🎉`;
        Farm.ui.toast(msg, 3000);
      }, 400);
    },

    // ============ Logout / menu ============
    openMenu() {
      const lang = Farm.state.data.language;
      const m = this.memberDoc || {};
      const name = m.name || this.currentUser.displayName || (lang === 'en' ? 'Member' : '会员');
      const totalPoints = m.totalPoints || 0;
      const lifetimePoints = m.lifetimePoints || 0;
      // Game-side level + title — replaces the fake store tier
      const gameLv = (Farm.state && Farm.state.data && Farm.state.data.level) || 1;
      const titleObj = Farm.state && Farm.state.levelTitle ? Farm.state.levelTitle(gameLv) : null;
      const titleStr = titleObj ? (lang === 'en' ? titleObj.en : titleObj.zh) : '';
      const safeName = String(name).replace(/[<>"&]/g, '');
      const html = `
        <h2 class="modal-title">👤 ${safeName}</h2>
        <div style="text-align:center;margin:12px 0;">
          <div style="font-size:14px;color:var(--leaf-dark);font-weight:600;">🌱 ${lang === 'en' ? 'Lv ' : 'Lv '}${gameLv}${titleStr ? ' · ' + titleStr : ''}</div>
          <div style="font-size:24px;font-weight:700;color:var(--purple-points);margin-top:6px;"><span class="points-icon"></span> ${totalPoints.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--warm-text-soft);">
            ${lang === 'en' ? 'Lifetime: ' : '累积: '}${lifetimePoints.toLocaleString()}
          </div>
          <div style="font-size:11px;color:var(--warm-text-soft);margin-top:4px;">
            ${lang === 'en' ? 'Synced with Eastern Market account' : '已与东方超市会员账户同步'}
          </div>
        </div>
        <button class="btn" id="memberShareBtn" style="width:100%;margin-bottom:8px;">📸 ${lang === 'en' ? 'Share my farm' : '晒我的农场'}</button>
        <button class="btn secondary" id="memberSettingsBtn" style="width:100%;margin-bottom:8px;">⚙️ ${Farm.i18n.t('settings_title')}</button>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
          <button class="btn secondary" id="memberLogoutBtn">${lang === 'en' ? 'Sign out' : '退出登录'}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      const shareBtn = document.getElementById('memberShareBtn');
      if (shareBtn) shareBtn.onclick = () => { if (Farm.share) Farm.share.open(); };
      const settingsBtn = document.getElementById('memberSettingsBtn');
      if (settingsBtn) settingsBtn.onclick = () => {
        Farm.ui.hideModal();
        if (Farm.openSettings) Farm.openSettings();
      };
      document.getElementById('memberLogoutBtn').onclick = async () => {
        await Farm.fb.auth.signOut();
        Farm.ui.hideModal();
        Farm.ui.toast(lang === 'en' ? 'Signed out' : '已退出登录', 1800);
      };
    },

    // Logged-out tap on the 👤 button: a tiny menu offering Sign in (primary)
    // + Settings. Settings used to live in the bottom nav; it now hangs off
    // the account button so logged-out players can still reach language/sound.
    openGuestMenu() {
      const lang = Farm.state.data.language;
      const html = `
        <h2 class="modal-title">👤 ${lang === 'en' ? 'Account' : '账户'}</h2>
        <p class="modal-subtitle">${lang === 'en'
          ? 'Sign in with your Eastern Market membership to save progress & earn points.'
          : '用东方超市会员登录，存档同步、还能赚超市积分。'}</p>
        <button class="btn" id="guestSignInBtn" style="width:100%;margin-bottom:8px;">📱 ${lang === 'en' ? 'Sign in' : '会员登录'}</button>
        <button class="btn secondary" id="guestSettingsBtn" style="width:100%;margin-bottom:8px;">⚙️ ${Farm.i18n.t('settings_title')}</button>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      const signInBtn = document.getElementById('guestSignInBtn');
      if (signInBtn) signInBtn.onclick = () => { Farm.ui.hideModal(); this.openLoginModal(); };
      const setBtn = document.getElementById('guestSettingsBtn');
      if (setBtn) setBtn.onclick = () => { Farm.ui.hideModal(); if (Farm.openSettings) Farm.openSettings(); };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbAuth = auth;
})();
