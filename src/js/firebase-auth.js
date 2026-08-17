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
  // 会员激活流程要问后端「这个手机号该走哪条路」。与 analytics.js 同一个后端。
  const STOCKWISE_BASE = 'https://stockwise-app-873982544406.us-central1.run.app';

  const auth = {
    currentUser: null,
    memberDoc: null,
    listeners: [],
    _confirmation: null,     // Firebase ConfirmationResult during OTP flow
    _recaptcha: null,        // RecaptchaVerifier instance
    // 登录弹窗当前视图。2026-08-12 起改为「一律邮箱登录」，手机号只做一次性激活：
    // login(邮箱+密码) / phone(输手机号) / sent(信已发出) / otp(短信验证) / bind(绑邮箱设密码)
    _view: 'login',
    _sentDomain: '',         // sent 视图上只显示域名，绝不回显打码邮箱地址

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
        // Auth (and, for members, the cloud restore above) has now settled.
        // Release the deferred sign-in auto-open so it decides on the REAL state
        // — fixes the card popping every load on flaky-storage signed-in devices.
        this.authSettled = true;
        // (Sign-in calendar no longer auto-opens; reachable from the「今日」panel.)
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
          const isEn = lang === 'en';
          const zh = startBtn.querySelector('.splash-start-zh');
          const en = startBtn.querySelector('.splash-start-en');
          if (zh) zh.textContent = isEn ? 'Enter farm' : '进入农场';
          if (en) en.textContent = isEn ? '' : 'Enter ›';
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
    // StockWise「游戏管理 → 标记为店主」写在 members.role 上。设置里的
    // 「我是店主，不参与排名」只给这类账号看，不能人人自封。
    isStoreOwner() {
      const r = (this.memberDoc && this.memberDoc.role) || '';
      return r === 'admin' || r === 'owner';
    },
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
        // Topbar shows only the FIRST name so the pill stays short and never
        // crowds the weather chip. Full name remains in the tooltip + menu.
        const shortName = safeName.split(/\s+/)[0] || safeName;
        slot.innerHTML = `<button class="member-btn member-btn--in" id="memberBtnInner" title="${lang === 'en' ? 'Member: ' : '会员: '}${safeName}">🌱<span class="member-name">${shortName}</span></button>`;
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
      this._view = 'login';
      this._confirmation = null;
      this._renderLoginModal();
    },

    /* ===== 会员登录：一律邮箱 + 密码（2026-08-12 切换）=====
       spec: stockwise_final/docs/superpowers/specs/2026-08-12-email-only-member-login-design.md

       🔒 手机号不再是登录方式，只用于**一次性激活**：验证短信不免费（每天前 10 条外
       每条计费），而日常登录不该每次都掏钱。手机号仍是会员身份的关联字段。

       五个视图（_view）：
         login  邮箱 + 密码           ← 默认，日常路径
         phone  输入手机号 →【继续】   ← 激活/找回入口，调后端 start 判断走哪条
         sent   已发送到 ****@域名     ← 有登记邮箱的人
         otp    【发送短信验证码】     ← 没登记邮箱的人；🔒 短信必须由**这一次点击**触发
         bind   填邮箱 + 设密码        ← 短信验证通过后

       🔴 为什么 otp 要单独一屏、不能在点「继续」时就把短信发了：
       signInWithPhoneNumber 必须在用户点击那一瞬**同步**调用，前面有任何 await
       都会吃掉 iOS 手势 → reCAPTCHA 静默挂死。而「继续」那一步要 await 后端。
       所以拆成两次点击：既保住 iOS 可靠，又保住「非会员永不产生短信」。 */
    _renderLoginModal() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      const remembered = localStorage.getItem(REMEMBER_KEY) || '';
      const view = this._view || 'login';

      const T = {
        login: [en ? 'Member sign in' : '会员登录', en ? 'Sign in with your email' : '用您的邮箱登录'],
        phone: [en ? 'First time here?' : '第一次登录',
                en ? 'Enter the phone number you gave us in store' : '请输入您在店里登记的手机号'],
        sent:  [en ? 'Check your email' : '请查收邮件', ''],
        otp:   [en ? 'Verify your phone' : '验证手机号',
                en ? `We'll text ${this._formatPhone((this._currentPhoneE164 || '').replace('+1', ''))}`
                   : `将发送到 ${this._formatPhone((this._currentPhoneE164 || '').replace('+1', ''))}`],
        bind:  [en ? 'Set up your login' : '设置登录方式',
                en ? 'Use this email and password from now on' : '以后用这个邮箱和密码登录'],
      }[view] || ['', ''];

      const body = {
        login: () => this._renderEmailTab(lang),
        phone: () => this._renderPhoneView(lang, remembered),
        sent:  () => this._renderSentView(lang),
        otp:   () => this._renderOtpView(lang),
        bind:  () => this._renderBindView(lang),
      }[view]();

      const html = `
        <h2 class="modal-title auth-title">${T[0]}</h2>
        ${T[1] ? `<p class="auth-sub">${T[1]}</p>` : ''}
        <div id="authError" class="auth-error"></div>
        ${body}
        <p class="auth-footnote">${en
          ? 'Not a member yet? Sign up free at 133-412 Willowgrove Square.'
          : '还不是会员？到店免费办理 · 133-412 Willowgrove Square'}</p>
      `;
      Farm.ui.showModal(html);
      this._wireLoginModal();
    },

    _go(view) {
      this._view = view;
      this._renderLoginModal();
    },

    /** 手机号 → 后端判断走哪条路。本步骤**不发短信**。 */
    async _startFlow() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      this._showError('');
      const el = document.getElementById('authPhone');
      const digits = this._phoneDigits(el && el.value);
      if (digits.length !== 10) {
        this._showError(en
          ? 'Please enter your 10-digit Canadian number (area code + number).'
          : '请输入店里登记的 10 位手机号（区号+号码，例如 3061234567）。');
        return;
      }
      const btn = document.getElementById('authNextBtn');
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Checking…' : '查询中…'; }
      this._currentPhoneE164 = '+1' + digits;
      localStorage.setItem(REMEMBER_KEY, this._formatPhone(digits));

      let data = null;
      try {
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: digits }),
        });
        data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.detail) || 'HTTP ' + r.status);
      } catch (e) {
        // 🔒 请求失败绝不能显示成「你不是会员」——那是把一个错误的事实告诉顾客
        this._showError(en ? 'Could not reach the server. Please try again.' : '连接不上服务器，请重试。');
        if (btn) { btn.disabled = false; btn.textContent = en ? 'Continue' : '继续'; }
        return;
      }

      if (data.status === 'not_member') {
        this._showError(en
          ? 'This phone is not registered at our store.\nPlease visit 133-412 Willowgrove Square to sign up (free).\nMon–Sat 10am–6:30pm · (306) 244-5522'
          : '此手机号未在店内登记。\n请光临本店免费办理：\n📍 133-412 Willowgrove Square\n🕐 周一至周六 10am–6:30pm\n☎️ (306) 244-5522');
        if (btn) { btn.disabled = false; btn.textContent = en ? 'Continue' : '继续'; }
        return;
      }
      if (data.status === 'email_sent') {
        this._sentDomain = data.domain || '';
        this._go('sent');
        return;
      }
      this._go('otp');
    },

    /** 激活入口：只收手机号。这一屏**没有** reCAPTCHA，因为还不确定要不要发短信。 */
    _renderPhoneView(lang, remembered) {
      const en = lang === 'en';
      return `
        <div class="auth-field">
          <div class="auth-phone-input">
            <span class="auth-phone-prefix">+1</span>
            <input type="tel" id="authPhone" class="auth-input auth-input-phone"
                   inputmode="numeric" autocomplete="tel-national" maxlength="14"
                   value="${remembered}" placeholder="(306) 123-4567"/>
          </div>
          <p class="auth-hint">${en
            ? '10 digits with area code. Don’t type +1 — it’s already there.'
            : '请填区号+号码共 10 位。左边已有 +1，不用再输入 1。'}</p>
        </div>
        <button class="btn auth-primary" id="authNextBtn">${en ? 'Continue' : '继续'}</button>
        <button class="auth-ghost" data-auth-go="login">${en ? 'Back to sign in' : '返回登录'}</button>
      `;
    },

    /** 有登记邮箱 → 信已经发出去了。🔒 只显示域名，绝不回显打码地址（手机号可枚举）。 */
    _renderSentView(lang) {
      const en = lang === 'en';
      const dom = this._sentDomain ? `****@${this._sentDomain}` : (en ? 'your email' : '您的邮箱');
      return `
        <p class="auth-sent-line">${en
          ? `We sent a link to <b>${dom}</b>. Open it to set your password, then come back and sign in.`
          : `已把设置密码的链接发到 <b>${dom}</b>。打开邮件设好密码，再回来登录。`}</p>
        <p class="auth-hint">${en
          ? 'No email after a minute? Check your spam folder.'
          : '一分钟还没收到？请看一下垃圾邮件。'}</p>
        <button class="btn auth-primary" data-auth-go="login">${en ? 'Go to sign in' : '去登录'}</button>
        <!-- 🔒 这个入口必须显眼，不能藏进小字：它接住「店里录错邮箱」和「邮箱废弃了」
             两种真实情况，藏起来的结果是顾客直接打电话到店里问。 -->
        <button class="auth-ghost auth-ghost--strong" data-auth-go="otp">${en
          ? "Didn't get it? Use a different email" : '收不到？改用其他邮箱'}</button>
      `;
    },

    /** 没登记邮箱 → 🔒 短信必须由这一屏的点击直接触发（iOS 手势，见 _renderLoginModal 注释）。 */
    _renderOtpView(lang) {
      const en = lang === 'en';
      if (this._confirmation || this._smsPending) return this._renderPhoneStep2(lang);
      return `
        <div class="auth-recaptcha-wrap"><div id="authRecaptcha"></div></div>
        <button class="btn auth-primary" id="authSendBtn">${en ? 'Text me a code' : '发送短信验证码'}</button>
        <button class="auth-ghost" data-auth-go="phone">${en ? 'Change number' : '换个号码'}</button>
      `;
    },

    /** 短信验证通过 → 设置以后要用的邮箱和密码。 */
    _renderBindView(lang) {
      const en = lang === 'en';
      return `
        <div class="auth-field">
          <label class="auth-label" for="bindEmail">${en ? 'Email' : '邮箱'}</label>
          <input type="email" id="bindEmail" class="auth-input" autocomplete="email"
                 placeholder="you@example.com"/>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="bindPw">${en ? 'Password' : '设置密码'}</label>
          <input type="password" id="bindPw" class="auth-input" autocomplete="new-password"
                 placeholder="${en ? 'At least 6 characters' : '至少 6 位'}"/>
        </div>
        <button class="btn auth-primary" id="authBindBtn">${en ? 'Finish' : '完成'}</button>
      `;
    },

    /* 🔒 验证码用**一个**输入框，不要再改回 6 个格子（2026-08-12，Chris「这个输入框太长了」）
       -------------------------------------------------------------------------------
       6 格子看着现代，代价却全落在最不该出问题的地方：
       · 390px 屏上 6 格 + 5 道间隙挤在 310px 里，格子被压窄、数字被裁；
         而第一格为了吃 iOS 自动填充设了 maxlength=6，整串码塞进去就是「一个很长的框」。
       · iOS 的 one-time-code 自动填充本来就是**按单字段**设计的，塞进 6 格要靠
         「把多位数分发到各格」的补丁，历史上已经因此丢过 5 位数字（见旧 _wireOtpBoxes 注释）。
       · 还要自己实现聚焦跳转、退格回跳、方向键、粘贴分发 —— 全是可以不存在的 bug 面。
       单字段 + letter-spacing 是 Apple / Stripe 在手机上的做法：自动填充零补丁、
       永不溢出、代码少一大截，对长辈也更直白（只有一个地方可以打字）。
       字号必须 ≥16px，否则 iOS Safari 一聚焦就整页放大。 */
    _renderPhoneStep2(lang) {
      return `
        <div class="auth-field">
          <input type="tel" id="authCode" class="auth-code-input"
                 inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                 placeholder="------" aria-label="${lang === 'en' ? 'Verification code' : '验证码'}"/>
          <div class="auth-hint auth-code-hint">
            <span id="authSmsStatus" class="auth-sms-status"></span>
            <span id="authResendArea"></span>
          </div>
        </div>
        <button class="btn auth-primary" id="authVerifyBtn" disabled>${lang === 'en' ? 'Sign in' : '登录'}</button>
        <button class="auth-ghost" id="authBackBtn">${lang === 'en' ? 'Use a different number' : '换个号码'}</button>
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
        <button class="btn auth-primary" id="authEmailBtn">${lang === 'en' ? 'Sign in' : '登录'}</button>
        <!-- 激活/找回入口。手机号不再是登录方式，只走这条一次性的路。 -->
        <button class="auth-ghost auth-ghost--strong" data-auth-go="phone">${lang === 'en'
          ? 'First time? Activate with your phone' : '第一次登录？用手机号激活'}</button>
        <button class="auth-ghost" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
      `;
    },

    _wireLoginModal() {
      const view = this._view || 'login';

      // 视图跳转：任何带 data-auth-go 的按钮
      document.querySelectorAll('[data-auth-go]').forEach(btn => {
        btn.onclick = () => this._go(btn.dataset.authGo);
      });

      if (view === 'login') {
        const emailEl = document.getElementById('authEmail');
        if (emailEl) setTimeout(() => emailEl.focus(), 100);
        const btn = document.getElementById('authEmailBtn');
        if (btn) btn.onclick = () => this._emailLogin();
        ['authEmail', 'authPassword'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.onkeydown = (e) => { if (e.key === 'Enter') this._emailLogin(); };
        });

      } else if (view === 'phone') {
        const phoneEl = document.getElementById('authPhone');
        if (phoneEl) {
          setTimeout(() => phoneEl.focus(), 100);
          phoneEl.oninput = (e) => { e.target.value = this._formatPhone(e.target.value); };
          phoneEl.onkeydown = (e) => { if (e.key === 'Enter') this._startFlow(); };
        }
        const next = document.getElementById('authNextBtn');
        if (next) next.onclick = () => this._startFlow();

      } else if (view === 'otp') {
        if (this._confirmation || this._smsPending) {
          // 已经发过短信 → 这是验证码输入屏
          this._wireCodeInput();
          const back = document.getElementById('authBackBtn');
          if (back) back.onclick = () => { this._confirmation = null; this._smsPending = null; this._go('phone'); };
          document.getElementById('authVerifyBtn').onclick = () => this._verifyOtp();
          this._renderSmsStatus();
          this._startResendCountdown(60);
        } else {
          // 还没发 → 先把 reCAPTCHA 画出来（必须 'normal' 可见款，invisible 在 iOS 上会挂）
          try {
            if (this._recaptcha) { try { this._recaptcha.clear(); } catch (e) {} }
            this._recaptcha = new firebase.auth.RecaptchaVerifier('authRecaptcha', { size: 'normal' });
            this._recaptcha.render().catch(e => console.warn('reCAPTCHA render failed', e));
          } catch (e) {
            console.warn('reCAPTCHA init failed', e);
          }
          const sendBtn = document.getElementById('authSendBtn');
          // 🔒 这一次点击直接调 signInWithPhoneNumber，中间不许有 await（iOS 手势）
          if (sendBtn) sendBtn.onclick = () => this._sendCode();
        }

      } else if (view === 'bind') {
        const el = document.getElementById('bindEmail');
        if (el) setTimeout(() => el.focus(), 100);
        const btn = document.getElementById('authBindBtn');
        if (btn) btn.onclick = () => this._bindEmail();
        ['bindEmail', 'bindPw'].forEach(id => {
          const x = document.getElementById(id);
          if (x) x.onkeydown = (e) => { if (e.key === 'Enter') this._bindEmail(); };
        });
      }
    },

    /** 短信验证通过后：把邮箱+密码挂到**当前这个手机号账号**上，再让后端记进会员档案。
     *
     * 🔴 必须用 linkWithCredential 而不是新建账号 —— 新建 = 一人两 uid，
     * 而农场存档按 farm_players/{uid} 存，换 uid 等于农场当场清零且不可逆。
     */
    async _bindEmail() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      this._showError('');
      const email = (document.getElementById('bindEmail') || {}).value || '';
      const pw = (document.getElementById('bindPw') || {}).value || '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        this._showError(en ? 'Please enter a valid email.' : '请输入正确的邮箱地址。');
        return;
      }
      if (pw.length < 6) {
        this._showError(en ? 'Password must be at least 6 characters.' : '密码至少 6 位。');
        return;
      }
      const btn = document.getElementById('authBindBtn');
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Saving…' : '保存中…'; }

      const user = Farm.fb.auth.currentUser;
      if (!user) {
        this._showError(en ? 'Session expired. Please start again.' : '会话已过期，请重新开始。');
        this._go('phone');
        return;
      }
      try {
        const cred = firebase.auth.EmailAuthProvider.credential(email.trim(), pw);
        await user.linkWithCredential(cred);
      } catch (e) {
        const code = (e && e.code) || '';
        this._showError(
          code === 'auth/email-already-in-use'
            ? (en ? 'That email is already used by another account. Please use a different one.'
                  : '这个邮箱已被其他账号使用，请换一个。')
            : (en ? 'Could not save. Please try again.' : '保存失败，请重试。')
        );
        if (btn) { btn.disabled = false; btn.textContent = en ? 'Finish' : '完成'; }
        return;
      }
      // Auth 层已经绑好了，再让后端写进会员档案（顺序不能反：反了 link 失败会把档案改脏）
      try {
        const token = await user.getIdToken();
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/bind-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ email: email.trim() }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => null);
          throw new Error((d && d.detail) || 'HTTP ' + r.status);
        }
      } catch (e) {
        // 这里失败不该把人挡在门外：他的 Auth 账号已经能用了。
        // 关联会在下次登录时由 _loadMemberDoc 按邮箱自动补上（幂等自愈）。
        console.warn('[auth] bind-email 回写失败，留待登录时自愈:', e);
      }
      try { user.sendEmailVerification().catch(() => {}); } catch (_) {}
      this._onLoginSuccess(lang);
    },

    // 单个验证码输入框：只留数字、满 6 位自动提交。自动填充/粘贴不用任何补丁。
    _wireCodeInput() {
      const el = document.getElementById('authCode');
      if (!el) return;
      el.oninput = () => {
        const v = (el.value || '').replace(/\D/g, '').slice(0, 6);
        if (el.value !== v) el.value = v;
        this._updateOtpVerifyBtn();
        if (v.length === 6) {
          el.blur();                       // 收起键盘，让人看得见按钮状态
          setTimeout(() => this._verifyOtp(), 80);
        }
      };
      el.onkeydown = (e) => { if (e.key === 'Enter') this._verifyOtp(); };
      setTimeout(() => el.focus(), 120);
    },

    // 短信在路上时给一句实话，而不是让人对着一个不动的框猜（Chris：等了很久才出现）
    _renderSmsStatus() {
      const el = document.getElementById('authSmsStatus');
      if (!el) return;
      const lang = Farm.state.data.language;
      if (this._confirmation) { el.textContent = ''; return; }
      el.innerHTML = `<span class="auth-dot"></span>${lang === 'en'
        ? 'Sending… you can start typing the code now'
        : '正在连接…收到短信可以直接输入'}`;
      const p = this._smsPending;
      if (!p) return;
      p.then(() => {
        const now = document.getElementById('authSmsStatus');
        if (now) now.textContent = '';
      }).catch(() => {});
    },

    _collectOtp() {
      const el = document.getElementById('authCode');
      return (el && el.value ? el.value : '').replace(/\D/g, '');
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
            // 回到「发送短信验证码」那一屏：清掉旧回执，重新走一次可见 reCAPTCHA
            this._confirmation = null;
            this._smsPending = null;
            this._go('otp');
          };
          return;
        }
        area.textContent = lang === 'en' ? `Resend in ${remaining}s` : `${remaining} 秒后可重新发送`;
        remaining--;
        setTimeout(tick, 1000);
      };
      tick();
    },

    // 从输入里抽出加拿大 10 位：全角数字、粘贴的 +1 / 1-xxx、空格横杠都能认。
    _phoneDigits(v) {
      let s = String(v || '').replace(/[０-９]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
      let d = s.replace(/\D/g, '');
      if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
      return d.slice(0, 10);
    },
    _formatPhone(v) {
      const d = this._phoneDigits(v);
      if (d.length <= 3) return d;
      if (d.length <= 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
      return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6, 10);
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
      const digits = this._phoneDigits(phoneRaw);
      if (digits.length !== 10) {
        this._showError(lang === 'en'
          ? 'Please enter your 10-digit Canadian number (area code + number).'
          : '请输入店里登记的 10 位手机号（区号+号码，例如 3061234567）。');
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

      // SMS 发送 + 会员查询，同步启动（signInWithPhoneNumber 之前绝不能有 await，
      // 否则 iOS 的用户手势被吃掉、reCAPTCHA iframe 会静默挂死）
      const smsP = Farm.fb.auth.signInWithPhoneNumber(e164, this._recaptcha);
      /* 会员身份已经在上一屏由 /api/public/member-auth/start 确认过了，
         这里不再查一次 —— 少一个 Firestore 往返，也少一处「查询失败被当成
         『你不是会员』」的机会（那正是旧实现的毛病）。 */

      /* 🔒 立刻切到输入验证码那一屏，不要等 smsP（2026-08-12，Chris「等了很久才出现输入框」）
         短信是 Firebase **服务器端**发的，客户端这个 promise 只是「回执」。
         弱网下回执可能十几秒才回来，而短信早就到手机上了 —— 于是人手里握着验证码，
         屏幕上却没有地方填。回执改为后台等：先给框，拿到了再填 _confirmation；
         用户提前输完也没关系，_verifyOtp 会等它。 */
      this._currentPhoneE164 = e164;
      this._confirmation = null;
      this._smsPending = smsP;
      localStorage.setItem(REMEMBER_KEY, phoneRaw);
      this._view = 'otp';
      this._renderLoginModal();

      smsP.then(result => {
        this._confirmation = result;
        const s = document.getElementById('authSmsStatus');
        if (s) s.textContent = '';
      }).catch(e => {
        if (this._view !== 'otp') return;
        this._smsPending = null;
        this._renderLoginModal();      // 回到「发送短信验证码」那一屏
        this._handleSmsError(e, lang, document.getElementById('authSendBtn'));
      });

      // 兜底：真的一直没回执，给一句可行动的话，而不是让人干等
      setTimeout(() => {
        if (this._confirmation || this._view !== 'otp') return;
        const s = document.getElementById('authSmsStatus');
        if (s) {
          s.innerHTML = '';
          s.textContent = lang === 'en'
            ? 'Still connecting — if you got the code, enter it; it will go through.'
            : '网络较慢，仍在连接。收到验证码就先填，能提交。';
        }
      }, 20000);

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
      } else if (e && /SMS_REGION|region.*not.*allow/i.test(String(e.message || '') + String(e.code || ''))) {
        /* 2026-08-12 起项目开了短信区域白名单，只放行加拿大号码（防「短信泵」诈骗：
           攻击者拿登录页向境外高费率号码狂发验证码，跟当地运营商分成，钱由我们付）。
           Firebase 甩回来的是 SMS_REGION_NOT_ALLOWED 这种内部串，顾客看不懂 ——
           必须翻译成人话，并给出一条能走的路，否则就是「点了没反应」的另一种形态。 */
        msg = lang === 'en'
          ? 'We can only text Canadian numbers. If your number changed, please update it in store: 133-412 Willowgrove Square.'
          : '目前只能向加拿大号码发送验证码。\n如果您换了号码，请到店更新：133-412 Willowgrove Square。';
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
      const btn = document.getElementById('authVerifyBtn');
      if (btn) { btn.disabled = true; btn.textContent = lang === 'en' ? 'Signing in…' : '登录中…'; }
      /* 用户可能比回执快（弱网下常见）——等一下那份回执再验，
         而不是甩一句「会话已过期」把人赶回去重发。 */
      if (!this._confirmation && this._smsPending) {
        try { this._confirmation = await this._smsPending; } catch (e) { /* 下面统一处理 */ }
      }
      if (!this._confirmation) {
        // 报错时把「正在连接…」收掉，否则一红一绿两句话自相矛盾
        const st = document.getElementById('authSmsStatus');
        if (st) st.textContent = '';
        this._showError(lang === 'en' ? 'Could not reach the server. Tap “Use a different number” and try again.' : '连接不上服务器，请点「换个号码」重新发送。');
        if (btn) { btn.disabled = false; btn.textContent = lang === 'en' ? 'Sign in' : '登录'; }
        return;
      }
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
        // 短信只是**激活**的第一半：接着让他设好以后要用的邮箱和密码，
        // 否则下次又得再发一条短信 —— 而这套改造的全部意义就是不再每次发短信。
        this._go('bind');
        return;
      } catch (e) {
        console.warn('OTP verify failed', e);
        this._showError(lang === 'en' ? 'Incorrect verification code.' : '验证码不正确。');
        if (btn) { btn.disabled = false; btn.textContent = lang === 'en' ? 'Sign in' : '登录'; }
        // 码错了就把框清空并重新聚焦，别让人自己去删 6 个数字
        const codeEl = document.getElementById('authCode');
        if (codeEl) { codeEl.value = ''; codeEl.focus(); }
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
        <h2 class="modal-title">${safeName}</h2>
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
        <h2 class="modal-title">${lang === 'en' ? 'Account' : '账户'}</h2>
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
