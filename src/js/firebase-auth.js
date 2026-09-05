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
  /* 登录框记住的标识（手机号**或**用户名）。
     🔒 必须与 REMEMBER_KEY 分开：那个键只装手机号，专供「用手机号激活」那一屏
     预填。混着存的话，设过用户名的人再去激活，手机号框里会冒出一个用户名。
     🔒 这是**本机**的便利，不是「认识你」——绝不存姓名、绝不显示姓名。
     陌生设备上不得出现任何顾客姓名是隐私红线（spec 3.2）。 */
  const CARD_LINK_ASKED_KEY = 'ef_card_link_asked_v1';
const IDENT_KEY = 'eastern_farm_last_ident';
  // 会员激活流程要问后端「这个手机号该走哪条路」。与 analytics.js 同一个后端。
  const STOCKWISE_BASE = 'https://stockwise-app-873982544406.us-central1.run.app';
  /* 后端调用一律带超时。没有超时的 fetch 卡住时不报错、不进 catch，
     只是永远停在那儿 —— 本项目在「SMTP 没超时导致线程永久挂起」上刚栽过
     （2026-08-19）。8 秒：Cloud Run 冷启动最慢也就这个量级。 */
  const WHOAMI_TIMEOUT_MS = 8000;
  const PHONE_LOOKUP_TIMEOUT_MS = 8000;

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
        // trackOnce：main.js 里还有一条 8 秒兜底（离线时 SDK 永远不到），
        // 两条路只能算一个人一次。历史上它们同时开火，访客被记了两遍。
        if (_firstResolve && !user && Farm.trackOnce) Farm.trackOnce('open_guest');
        if (user) {
          this.currentUser = user;
          await this._loadMemberDoc(user.uid);
          this._maybeOfferCardLink();
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
          // 会员档到手才知道有没有真邮箱 —— 常驻提醒条在这里定去留
          this.refreshEmailNudge();
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
          if (Farm.feedback && Farm.feedback.maybeShowMail) {
            setTimeout(() => Farm.feedback.maybeShowMail(), 3200);
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
          this.refreshEmailNudge();   // 退出登录后把提醒条收掉
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
        const nickname = (stats.nickname && String(stats.nickname).trim())
          || realName
          || (lang === 'en' ? 'Member' : '会员');
        const safeName = String(nickname).replace(/[<>"&]/g, '');
        // Game level title (e.g. "Lv 5 学徒") — real because it's based
        // on actual XP earned in-game.
        const gameLv = (Farm.state && Farm.state.data && Farm.state.data.level) || 1;
        const titleObj = Farm.state && Farm.state.levelTitle ? Farm.state.levelTitle(gameLv) : null;
        const titleStr = titleObj ? (lang === 'en' ? titleObj.en : titleObj.zh) : '';
        loginBtn.innerHTML = `
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
            /* 🔒 补关联走后端，别改回客户端 update。
               这里原来是 d.ref.update({firebase_uid}).catch(() => {})，而 959 个
               会员档**根本没有 firebase_uid 这个键** —— firestore 自链接规则第一条
               判的是 `== null`，键不存在时那条 update 被拒，空 catch 又把失败吞了。
               结果 50 个真会员一直关联不上（详见 /link-phone 端点的说明）。
               只在确实没关联时才调，所以不是每次启动都打后端。 */
            if (!d.data().firebase_uid) {
              this._linkPhoneViaBackend().catch(() => {});
            }
            this._syncLocalBalance();
            return;
          }
        }
        // 3. Last resort (legacy orphan keyed by uid, or genuinely nothing).
        const direct = await Farm.fb.db.collection('members').doc(uid).get();
        if (direct.exists) {
          this.memberDoc = { id: direct.id, ...direct.data() };
          this._syncLocalBalance();
          return;
        }
        /* 4. 「手机号直接进」的玩家（2026-08-19）——上面三条全查不到。
           他们用的是**匿名登录**的 uid，只记在 members.linked_uids 里，
           而 members 的读规则收紧过（allow list limit≤1 + 条件），前端
           查不了 array-contains。所以问后端。
           🔒 后端只回 memberId/name/points/verified，字段闭合。 */
        this.memberDoc = await this._whoAmI();
      } catch (e) {
        console.warn('member doc load failed', e);
        this.memberDoc = null;
      }
      this._syncLocalBalance();
    },

    /* 登录了、但系统认不出他是谁 —— 请他输一下手机号就能连上（2026-08-20）。

       ## 这不是假想的情况

       实测生产库：有一位真实顾客（650 积分）用邮箱+密码能正常登进来，
       但 `members.firebase_uid` 是空的、账号上也没有手机号 —— 于是
       `_loadMemberDoc` 的四条查找链（firebase_uid / token 手机号 / uid /
       whoami）**全部落空**，她被当成游客，650 分一分看不见。

       🔒 不能就这么显示成「0 分的游客」—— 那是把一个**错误的事实**告诉顾客
          （失败态铁律：请求失败不能显示成「没有内容」）。

       修法是复用已有的「手机号直接进」：输号 → 确认名字 → 关联。安全性与那条
       路完全相同，不新开口子。

       ⚠️ 只对**真账号**弹（有邮箱/密码凭据的）。匿名访客本来就没有会员卡，
          对他们弹这个是骚扰。
       ⚠️ 一台设备只弹一次（记 localStorage）；他关掉就不再纠缠，
          「我的」菜单里仍有入口。 */
    _maybeOfferCardLink() {
      try {
        const u = this.currentUser;
        if (!u || u.isAnonymous || this.memberDoc) return;
        if (!this._hasLoginCredential()) return;      // 匿名/未设密码的不算
        if (localStorage.getItem(CARD_LINK_ASKED_KEY)) return;
        localStorage.setItem(CARD_LINK_ASKED_KEY, '1');
      } catch (_) { return; }

      const en = Farm.state.data.language === 'en';
      setTimeout(() => {
        // 🔒 别盖在开屏/新手引导/别的弹窗上（isBusy 统一判定，2026-08-15 定）
        if (Farm.ui && Farm.ui.isBusy && Farm.ui.isBusy()) return;
        Farm.ui.showModal(`
          <h2 class="modal-title">${en ? 'Link your member card' : '连上你的会员卡'}</h2>
          <p style="text-align:center;font-size:15px;line-height:1.7;margin:14px 0;">
            ${en
              ? "You're signed in, but this account isn't linked to a member card yet — so your points aren't showing."
              : '你已经登录了，但这个账号还没连上会员卡，所以积分还看不到。'}
          </p>
          <p style="text-align:center;font-size:14px;line-height:1.7;color:var(--warm-text-soft);">
            ${en ? 'Enter the phone number you gave us in store and it links right away.'
                 : '输一下你在店里登记的手机号，马上就能连上。'}
          </p>
          <button class="btn auth-primary" id="cardLinkGo" style="margin-top:14px;">
            ${en ? 'Enter my phone number' : '输入手机号'}
          </button>
          <button class="auth-ghost" onclick="Farm.ui.hideModal()">
            ${en ? 'Later' : '以后再说'}
          </button>
        `);
        const b = document.getElementById('cardLinkGo');
        if (b) b.onclick = () => { this._view = 'phone'; this._renderLoginModal(); };
      }, 1200);
    },

    /** 问后端「我关联的是哪个会员」。查不到回 null（游客，正常情况）。 */
    async _whoAmI() {
      const u = this.currentUser;
      if (!u) return null;
      try {
        const idToken = await u.getIdToken();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), WHOAMI_TIMEOUT_MS);
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/whoami', {
          headers: { Authorization: 'Bearer ' + idToken },
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) return null;
        const d = await r.json().catch(() => null);
        if (!d) return null;

        /* 「邮箱注册、待到店激活」的玩家（2026-08-20）：还不是会员，但已经是
           一个有名有姓、有云存档、在攒积分的账号 —— 不能当游客处理。
           🔒 积分口径是「**待领取**」，不是「你的积分」。没兑现的不许说成已有的，
              所以这里带上 `_pending`，显示层据它换措辞。 */
        if (!d.linked && d.pending) {
          return {
            id: null,
            name: d.name || '',
            totalPoints: 0,                       // 会员积分是 0，他还不是会员
            pendingPoints: Number(d.pendingPoints || 0),
            pendingCap: Number(d.pendingCap || 0),
            activationCode: d.activationCode || '',
            hasEmail: true,                       // 注册这条路必然验过邮箱
            _pending: true,
            _fromWhoami: true,
            _verified: false,
          };
        }
        if (!d.linked) return null;
        // 拼成 memberDoc 的形状，后面的代码（memberDocId / _syncLocalBalance /
        // 「欢迎回来，XXX」）就都不用改
        /* ⚠️ hasEmail 必须带过来 —— whoami **不回邮箱地址**（隐私），所以
           `hasRealEmail()` 只能靠这个布尔判断。漏了它，走这条路进来的人
           每次都会被再问一遍「留个邮箱」，哪怕他上周刚留过。 */
        return { id: d.memberId, name: d.name || '', totalPoints: d.points || 0,
                 hasEmail: typeof d.hasEmail === 'boolean' ? d.hasEmail : undefined,
                 _fromWhoami: true, _verified: !!d.verified };
      } catch (e) {
        // 🔒 读不到 ≠ 不是会员。返回 null 只是这次没拿到，下次启动会再试；
        // 绝不能因此把人当成游客去写一个孤儿存档。
        console.warn('[auth] whoami 失败（下次启动会再试）:', e);
        return null;
      }
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

       ── 2026-08-17 改：日常登录改成「手机号 / 用户名 + 密码」 ──
       spec: stockwise_final/docs/superpowers/specs/2026-08-17-phone-username-password-login-design.md

       🔒 邮箱不再是登录的**前提**。实测 77 个 Auth 账号里 67 个「有手机号、无邮箱」——
       他们在设邮箱那一屏就走掉了，于是每次登录都得再发一条短信（Chris 真金白银）。
       Chris 定调：「人家不要这个方便的时候难道我们就不要这个客人吗」。
       邮箱改成登录**之后**慢慢补（常驻提醒条 + 3000 农场币），不挡在门口。

       视图（_view）：
         login      手机号/用户名 + 密码   ← 默认，日常路径（邮箱也认，含 @ 即直登）
         phone      输入手机号 →【继续】    ← 激活入口，调后端 start 判断走哪条
         confirm    「是你吗？」+ 姓名      ← 🆕 手机号直接进的确认屏
         sent       已发送到 ****@域名      ← 有登记邮箱的人（老路，仍保留）
         otp        【发送短信验证码】      ← 🔒 短信必须由**这一次点击**触发
         setpw      设密码 + 选填用户名     ← 短信验证通过后（一辈子一次）
         forgot     忘记密码                ← 留过邮箱自助；没留的到店
         email      后补邮箱 · 第 1 步      ← 输邮箱，发验证码
         emailcode  后补邮箱 · 第 2 步      ← 输验证码，验过才写会员档

       🔴 为什么 otp 要单独一屏、不能在点「继续」时就把短信发了：
       signInWithPhoneNumber 必须在用户点击那一瞬**同步**调用，前面有任何 await
       都会吃掉 iOS 手势 → reCAPTCHA 静默挂死。而「继续」那一步要 await 后端。
       所以拆成两次点击：既保住 iOS 可靠，又保住「非会员永不产生短信」。 */
    _renderLoginModal() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      // 手机号屏用 REMEMBER_KEY（只装号码）；登录/忘记密码屏用 IDENT_KEY（号码或用户名）
      const remembered = localStorage.getItem(REMEMBER_KEY) || '';
      const rememberedIdent = localStorage.getItem(IDENT_KEY) || remembered;
      const view = this._view || 'login';

      const T = {
        /* 🔒 副标题一律短（Chris 8/17：「所有提示语都要要尽量简洁！」）。
           说明性的长句一律收进 ⓘ，默认不显示。 */
        login: [en ? 'Member sign in' : '会员登录', ''],
        phone: [en ? 'First time here?' : '第一次登录',
                en ? 'The number you gave us in store' : '您在店里登记的手机号'],
        confirm: ['', ''],          // 这一屏自己画标题（姓名要大字居中）
        sent:  [en ? 'Check your email' : '请查收邮件', ''],
        otp:   [en ? 'Verify your phone' : '验证手机号',
                en ? `We'll text ${this._formatPhone((this._currentPhoneE164 || '').replace('+1', ''))}`
                   : `将发送到 ${this._formatPhone((this._currentPhoneE164 || '').replace('+1', ''))}`],
        /* 「一辈子一次」要说出来 —— 这一屏是整个方案的收益点：设完以后再不发短信。 */
        setpw: [en ? 'Set your password' : '设置密码',
                en ? 'Just once — after this you sign in straight away' : '只需这一次，以后直接登录'],
        forgot: [en ? 'Forgot password' : '忘记密码', ''],
        email:  [en ? 'Add your email' : '添加邮箱', ''],
        emailcode: [en ? 'Enter the code' : '输入验证码', ''],
        /* 非会员注册（2026-08-20）。标题说的是「这一步在问什么」，
           不写「第 2 步 / 共 3 步」—— 进度条会让人觉得还早着呢，
           而这条路本来就短。 */
        notmember: [en ? 'Not a member yet?' : '还不是会员？', ''],
        regemail: [en ? 'Leave your email' : '留个邮箱',
                   en ? "You'll use it to sign in" : '以后用它登录'],
        regcode: [en ? 'Check your email' : '查收验证码', ''],
      }[view] || ['', ''];

      const body = {
        login: () => this._renderIdentView(lang, rememberedIdent),
        phone: () => this._renderPhoneView(lang, remembered),
        confirm: () => this._renderConfirmView(lang),
        sent:  () => this._renderSentView(lang),
        otp:   () => this._renderOtpView(lang),
        setpw: () => this._renderSetPwView(lang),
        forgot: () => this._renderForgotView(lang, rememberedIdent),
        email:  () => this._renderEmailAddView(lang),
        emailcode: () => this._renderEmailCodeView(lang),
        notmember: () => this._renderNotMemberView(lang),
        regemail: () => this._renderRegEmailView(lang),
        regcode: () => this._renderRegCodeView(lang),
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
      // 误点空白不能关：短信发出去之后一关就要重发，长辈很容易点到旁边。
      Farm.ui.showModal(html, { closeOnBackdrop: false, closeOnEsc: false });
      this._wireLoginModal();
    },

    _go(view) {
      /* 漏斗第 2 段：从分岔屏点进注册屏 = 「看到了 → 愿意试」，第一道坎。
         打在 _go 里而不是按钮上：那两个按钮走的是通用 data-auth-go 跳转，
         没有各自的 onclick 可挂。 */
      if (view === 'regemail' && this._view === 'notmember' && Farm.track) {
        Farm.track('signup_open');
      }
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

      /* 🆕 手机号直接进（2026-08-19 Chris 定）：输对号码 + 确认姓名就能玩，
         **不发短信、不设密码**。
         spec: stockwise_final/docs/superpowers/specs/2026-08-19-phone-first-login-verify-on-spend-design.md

         为什么改：980 个会员里 908 个从来没成功登录过。门一直锁着（今天修了
         三个 bug），但就算门都能开，「先验证再进门」本身也是一道劝退墙 ——
         实测 77 个 Auth 账号里 67 个卡在验证那一屏走掉了。

         身份用**匿名登录**：不需要任何新的 IAM 权限，后端把这台设备记进
         members.linked_uids（绝不写 firebase_uid —— 那是「已验证本人」的语义）。 */
      const okNew = await this._phoneFirstLookup(digits, btn, en);
      if (okNew !== 'fallthrough') return;

      let data = null;
      try {
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: digits }),
        });
        data = await r.json().catch(() => null);
        if (!r.ok) {
          /* 🔴 服务器答了话就**照实转述**，别一律说「连不上服务器」（2026-08-19 修）
             ------------------------------------------------------------------
             原来 !r.ok 直接扔进下面那个 catch，于是 429（太频繁）和 503（发信
             失败）统统显示成「连接不上服务器，请重试。」——
             ① 那是假话：服务器好好的，是它拒绝了这次请求；
             ② 更糟的是那句「请重试」，客人一retry 就撞进 60 秒限流，
                日志实测就是 503 → 429 → 429 → 429 然后放弃。
             客人 2026-08-19 报的就是这个（当时后端因为服务账号缺
             firebaseauth.admin 权限，发信全挂 503）。 */
          const detail = (data && typeof data.detail === 'string') ? data.detail.trim() : '';
          if (r.status === 429) {
            this._showError(en ? 'Too many tries. Please wait a minute and try again.'
                               : '刚试过了，请等一分钟再试。');
          } else if (detail) {
            this._showError(detail);
          } else {
            this._showError(en ? 'Something went wrong on our side. Please try again shortly.'
                               : '我们这边出了点问题，请稍后再试。');
          }
          if (btn) { btn.disabled = false; btn.textContent = en ? 'Continue' : '继续'; }
          return;
        }
      } catch (e) {
        /* 只有 fetch 本身失败（真的连不上/断网）才说连不上。
           🔒 请求失败绝不能显示成「你不是会员」——那是把一个错误的事实告诉顾客 */
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

    /* ═══ 手机号直接进（2026-08-19）═════════════════════════════════════
       输号 → 查名字 → 「是你吗？」→ 确认 → 进游戏。全程不发短信。

       返回 'fallthrough' 表示这条路走不通（后端不支持/网络问题），
       让调用方退回老流程（/start → 邮件或短信）——**绝不能因为新路
       失败就把人挡在门外**，那正是我们要修的病。 */
    async _phoneFirstLookup(digits, btn, en) {
      const resetBtn = () => {
        if (btn) { btn.disabled = false; btn.textContent = en ? 'Continue' : '继续'; }
      };
      // 需要一个 Auth 身份才能调后端。没登录就匿名登录一个 ——
      // 匿名 uid 只用来标识「这台设备」，不含任何个人信息。
      try {
        if (!Farm.fb.auth.currentUser) await Farm.fb.auth.signInAnonymously();
      } catch (e) {
        console.warn('[auth] 匿名登录失败，退回老流程:', e);
        return 'fallthrough';
      }

      let data = null;
      try {
        const idToken = await Farm.fb.auth.currentUser.getIdToken();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), PHONE_LOOKUP_TIMEOUT_MS);
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/lookup-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
          body: JSON.stringify({ phone: digits }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (r.status === 404) return 'fallthrough';      // 后端还没上这条路
        if (r.status === 429) {
          this._showError(en ? 'Too many tries. Please wait a moment.' : '刚试过了，稍等一下再试。');
          resetBtn();
          return 'handled';
        }
        if (!r.ok) return 'fallthrough';
        data = await r.json().catch(() => null);
      } catch (e) {
        return 'fallthrough';
      }
      if (!data) return 'fallthrough';

      if (!data.found) {
        /* 以前这里是个句号：「未在店内登记，请到店办理」，说完就没了。
           现在给一条能走下去的路 —— 留个邮箱先玩，攒的积分记成「待领取」，
           到店报手机号就到账（2026-08-20）。
           ⚠️ 仍然不说「这个号不存在」：对真会员那是假话（可能只是换了号）。 */
        resetBtn();
        // 漏斗第 1 段：有多少人撞到「这个号没登记」并看到了那条出路。
        // 没有这个数就不知道后面每一段漏了多少人。
        if (Farm.track) Farm.track('signup_fork_seen');
        this._go('notmember');
        return 'handled';
      }

      this._confirmName = String(data.name || '').trim();
      this._confirmDigits = digits;
      this._go('confirm');
      return 'handled';
    },

    /* ═══ 非会员注册（2026-08-20 Chris 定）═════════════════════════════
       spec: stockwise_final/docs/superpowers/specs/
             2026-08-20-guest-signup-activate-in-store-design.md

       留个邮箱先玩 → 攒的积分记「待领取」→ 到店报手机号就到账、同时成为会员。

       🔒 注册**不建会员档**（后端写 pending_members）。members 是收银台扫的
          身份表，往里灌从没来过店的人 = 收银员查人时要从陌生名字里翻。 */
    _renderNotMemberView(lang) {
      const en = lang === 'en';
      return `
        <div class="auth-notmember">
          <p class="auth-notmember-lead">${en
            ? 'That number is not registered at our store yet. You can still play — leave an email and start now.'
            : '这个号码还没在店里登记。不影响你现在就玩 —— 留个邮箱就能开始。'}</p>
          <p class="auth-notmember-sub">${en
            ? 'Points you earn are held for you. Give us your phone next time you shop and they land on your member card.'
            : '你挣的超市积分会先替你存着。下次来店里报一下手机号，就到你的会员卡上。'}</p>
        </div>
        <button class="btn auth-primary" data-auth-go="regemail">${en ? 'Sign up with email' : '用邮箱注册'}</button>
        <button class="auth-ghost" data-auth-go="phone">${en ? 'Re-enter my number' : '重新输手机号'}</button>
        <p class="auth-notmember-store">${en
          ? 'Prefer in person? Sign up free at 133-412 Willowgrove Square · Mon–Sat 10am–6:30pm'
          : '也可以到店免费办理 · 133-412 Willowgrove Square · 周一至周六 10am–6:30pm'}</p>
      `;
    },

    _renderRegEmailView(lang) {
      const en = lang === 'en';
      return `
        <div class="auth-field">
          <label class="auth-label" for="regEmail">${en ? 'Email' : '邮箱'}</label>
          <input type="email" id="regEmail" class="auth-input" autocomplete="email"
                 placeholder="you@example.com"/>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="regName">
            ${en ? 'What should we call you?' : '怎么称呼你'}
            ${this._info('regNameInfo', en
              ? 'This is the name on your farmhouse that neighbours see. Not your legal name.'
              : '这个名字挂在你的小屋上给邻居看，不是身份证上的名字。')}
          </label>
          <input type="text" id="regName" class="auth-input" maxlength="20"
                 placeholder="${en ? 'e.g. Nicole' : '例如：小美'}"/>
        </div>
        <button class="btn auth-primary" id="authRegStartBtn">${en ? 'Send code' : '发送验证码'}</button>
        <button class="auth-ghost" data-auth-go="notmember">${Farm.i18n.t('btn_back') || (en ? 'Back' : '返回')}</button>
      `;
    },

    _renderRegCodeView(lang) {
      const en = lang === 'en';
      const to = this._regSentTo
        ? `<p class="auth-sent-line">${en ? 'Sent to' : '已发送到'} <b>${this._regSentTo}</b></p>` : '';
      return `
        ${to}
        <div class="auth-field">
          <input type="tel" id="regCode" class="auth-code-input"
                 inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                 placeholder="------" aria-label="${en ? 'Verification code' : '验证码'}"/>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="regPw">${en ? 'Set a password' : '设置密码'}</label>
          <input type="password" id="regPw" class="auth-input" autocomplete="new-password"
                 placeholder="${en ? 'At least 6 characters' : '至少 6 位'}"/>
        </div>
        <button class="btn auth-primary" id="authRegConfirmBtn">${en ? 'Start playing' : '开始玩'}</button>
        <button class="auth-ghost" data-auth-go="regemail">${en ? 'Use a different email' : '换个邮箱'}</button>
      `;
    },

    /** 注册第 1 步：查占用 → 发验证码。 */
    async _registerStart() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      this._showError('');
      const email = ((document.getElementById('regEmail') || {}).value || '').trim();
      const name = ((document.getElementById('regName') || {}).value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        this._showError(en ? 'Please enter a valid email.' : '请输入正确的邮箱地址。');
        return;
      }
      const btn = document.getElementById('authRegStartBtn');
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = en ? 'Send code' : '发送验证码'; } };
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Sending…' : '发送中…'; }

      // 需要一个身份才能调后端。没登录就匿名登录一个 —— 与「手机号直接进」同一套；
      // 注册成功后同一个 uid 就带上邮箱+密码凭据（已实测 uid 不变，存档不分家）。
      try {
        if (!Farm.fb.auth.currentUser) await Farm.fb.auth.signInAnonymously();
      } catch (e) {
        this._showError(en ? 'Could not reach the server. Please try again.' : '连接不上服务器，请重试。');
        reset();
        return;
      }
      try {
        const idToken = await Farm.fb.auth.currentUser.getIdToken();
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/register/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
          body: JSON.stringify({ email, displayName: name }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || 'HTTP ' + r.status);
        this._regSentTo = (d && d.sentTo) || email;
        this._regName = name;
        if (Farm.track) Farm.track('signup_code_sent');   // 漏斗第 3 段
        this._go('regcode');
      } catch (e) {
        // 后端把「这个邮箱已经是会员了」这类都写在 detail 里 —— 直接用它，
        // 换成笼统的「失败」顾客就不知道该怎么办了。
        this._showError(String((e && e.message) || '')
          || (en ? 'Could not send. Please try again.' : '发送失败，请重试。'));
        reset();
      }
    },

    /** 注册第 2 步：验码 + 设密码 → 建待激活档 → 进游戏。 */
    async _registerConfirm() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      this._showError('');
      const code = ((document.getElementById('regCode') || {}).value || '').trim();
      const pw = (document.getElementById('regPw') || {}).value || '';
      if (code.length !== 6) {
        this._showError(en ? 'Enter the 6-digit code.' : '请输入 6 位验证码。');
        return;
      }
      if (pw.length < 6) {
        this._showError(en ? 'Password must be at least 6 characters.' : '密码至少 6 位。');
        return;
      }
      const btn = document.getElementById('authRegConfirmBtn');
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = en ? 'Start playing' : '开始玩'; } };
      if (btn) { btn.disabled = true; btn.textContent = en ? 'One moment…' : '请稍候…'; }

      const user = Farm.fb.auth.currentUser;
      if (!user) {
        this._showError(en ? 'Session expired. Please start again.' : '会话已过期，请重新开始。');
        this._go('regemail');
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/register/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
          body: JSON.stringify({ code, password: pw, displayName: this._regName || '' }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || 'HTTP ' + r.status);
        // 密码是后端 admin SDK 写到这个 uid 上的，客户端的 user 对象还是旧的 ——
        // reload 一次让 providerData 说实话（与 _setCredentials 同一个理由）。
        try { await user.reload(); } catch (_) {}
        if (Farm.track) Farm.track('signup_done');        // 漏斗第 4 段
        try { localStorage.setItem(IDENT_KEY, (d && d.loginEmail) || ''); } catch (_) {}
      } catch (e) {
        this._showError(String((e && e.message) || '')
          || (en ? 'Could not save. Please try again.' : '保存失败，请重试。'));
        reset();
        return;
      }
      this._onLoginSuccess(lang);
    },

    /* 「是你吗？」——这一屏的全部作用是接住**打错一位数**。
       名字在这儿是给本人确认的，不是要藏起来的（Chris 2026-08-19：
       别假设人人想偷看别人的信息；真正会发生的是手滑）。 */
    _renderConfirmView(lang) {
      const en = lang === 'en';
      const safe = String(this._confirmName || '').replace(/[<>"&]/g, '');
      const who = safe || (en ? 'this member' : '这位会员');
      return `
        <div style="text-align:center;padding:6px 2px 2px;">
          <div style="font-size:15px;color:var(--warm-text-soft);margin-bottom:6px;">
            ${en ? 'Is this you?' : '是你吗？'}
          </div>
          <div style="font-size:30px;font-weight:800;color:var(--leaf-dark,#2a5c34);
                      line-height:1.2;margin-bottom:4px;word-break:break-word;">${who}</div>
          <div style="font-size:13px;color:var(--warm-text-soft);">
            ${this._formatPhone(this._confirmDigits || '')}
          </div>
        </div>
        <button class="btn auth-primary" id="authConfirmYes" style="margin-top:16px;">
          ${en ? 'Yes, that’s me' : '是我，进入农场'}
        </button>
        <button class="auth-ghost" data-auth-go="phone">
          ${en ? 'No — re-enter my number' : '不是，我输错了'}
        </button>
      `;
    },

    /** 确认之后：把这台设备关联到会员档，然后进游戏。 */
    async _confirmClaim() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      this._showError('');
      const btn = document.getElementById('authConfirmYes');
      const reset = () => {
        if (btn) { btn.disabled = false; btn.textContent = en ? 'Yes, that’s me' : '是我，进入农场'; }
      };
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Signing in…' : '进入中…'; }
      try {
        if (!Farm.fb.auth.currentUser) await Farm.fb.auth.signInAnonymously();
        const idToken = await Farm.fb.auth.currentUser.getIdToken();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), PHONE_LOOKUP_TIMEOUT_MS);
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/claim-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
          body: JSON.stringify({ phone: this._confirmDigits }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || ('HTTP ' + r.status));
      } catch (e) {
        // 🔒 失败就说失败，别把人静默留在原地
        this._showError(en ? 'Could not finish sign-in. Please try again.' : '进入失败，请重试。');
        reset();
        return;
      }
      // 会员档现在能从后端查到了（linked_uids），刷新一次再决定下一步
      try { await this._loadMemberDoc(Farm.fb.auth.currentUser.uid); } catch (_) {}
      this._trackLoginOnce();

      /* 🆕 没登记过邮箱 → 立即补一个（Chris 2026-08-20 定的完整流程）：
             关联手机号 → 验邮箱 → 设密码 → 之后邮箱或手机号都能登
         为什么必须现在补而不是「以后提醒」：邮箱是他在**网站**那边的登录凭据，
         也是订单通知和自助改密码的唯一通道。没有它，他只能在这台设备上玩。

         ⚠️ 这一屏历史上很凶：77 个账号里 67 个卡在设邮箱那儿走掉了。
            但当年那一屏是**坏的**（发信被权限卡死、链接是过期页），
            人不是不想填、是填了也没用。现在三样都修好了，而且有 3000 农场币
            的即时回报。上线后看 email_set 埋点 —— 如果新账号还是不动，
            那就是墙，要再谈。 */
      if (!this.hasRealEmail()) {
        this._go('email');
        return;
      }
      this._onLoginSuccess(lang);
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

    /* 🔒 说明一律默认隐藏，收进 ⓘ（Chris 8/17：「所有说明都应该默认隐藏，
       旁边可放一个『？』，点问号时出现」）。
       屏上只留「做什么」，「为什么/怎么办」点开才看 —— 长辈看的是一屏干净的表单，
       想知道的人一点就有。可访问性走 aria-expanded / aria-controls，不是纯视觉开关。 */
    _info(id, text) {
      return `<button type="button" class="auth-info-btn" data-auth-info="${id}"
                aria-expanded="false" aria-controls="${id}"
                aria-label="${Farm.state.data.language === 'en' ? 'More info' : '说明'}">ⓘ</button>
        <p class="auth-info-body" id="${id}" hidden>${text}</p>`;
    },

    /** 日常登录：手机号 / 用户名 + 密码。含 @ 的当邮箱直登（老用户仍然有效）。 */
    _renderIdentView(lang, remembered) {
      const en = lang === 'en';
      return `
        <div class="auth-field">
          <label class="auth-label" for="authIdent">
            ${en ? 'Phone or username' : '手机号或用户名'}
            ${this._info('identInfo', en
              ? 'Your phone is the one you gave us in store. If you signed up with an email, type that instead.'
              : '手机号就是您在店里登记的那个。用邮箱注册过的话，这里填邮箱。')}
          </label>
          <input type="text" id="authIdent" class="auth-input" autocomplete="username"
                 value="${String(remembered).replace(/"/g, '&quot;')}"
                 placeholder="${en ? '(306) 123-4567' : '(306) 123-4567'}"/>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="authPassword">${en ? 'Password' : '密码'}</label>
          <input type="password" id="authPassword" class="auth-input" autocomplete="current-password"/>
        </div>
        <button class="btn auth-primary" id="authIdentBtn">${en ? 'Sign in' : '登录'}</button>
        <button class="auth-ghost auth-ghost--strong" data-auth-go="phone">${en
          ? 'First time? Activate with your phone' : '第一次登录？用手机号激活'}</button>
        <button class="auth-ghost" data-auth-go="forgot">${en ? 'Forgot password' : '忘记密码'}</button>
        <button class="auth-ghost" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
      `;
    },

    /** 短信验证通过 → 设密码（+ 选填用户名）。一辈子一次，之后永不再发短信。 */
    _renderSetPwView(lang) {
      const en = lang === 'en';
      return `
        <div class="auth-field">
          <label class="auth-label" for="setPw">${en ? 'Password' : '设置密码'}</label>
          <input type="password" id="setPw" class="auth-input" autocomplete="new-password"
                 placeholder="${en ? 'At least 6 characters' : '至少 6 位'}"/>
        </div>
        <div class="auth-field">
          <label class="auth-label" for="setUser">
            ${en ? 'Username (optional)' : '用户名（选填）'}
            ${this._info('userInfo', en
              ? 'Sign in with this instead of your phone number, if you prefer.'
              : '设了以后可以用它代替手机号登录。')}
          </label>
          <input type="text" id="setUser" class="auth-input" autocomplete="username"
                 placeholder="${en ? 'Leave blank if you like' : '不填也可以'}"/>
        </div>
        <button class="btn auth-primary" id="authSetPwBtn">${en ? 'Done' : '完成'}</button>
      `;
    },

    /** 忘记密码：留过邮箱的自助；没留的到店改。 */
    _renderForgotView(lang, remembered) {
      const en = lang === 'en';
      return `
        <div class="auth-field">
          <label class="auth-label" for="forgotIdent">${en ? 'Phone or username' : '手机号或用户名'}</label>
          <input type="text" id="forgotIdent" class="auth-input" autocomplete="username"
                 value="${String(remembered).replace(/"/g, '&quot;')}"/>
        </div>
        <button class="btn auth-primary" id="authForgotBtn">${en ? 'Send reset email' : '发送重置邮件'}</button>
        <!-- 🔒 「到店」是欢迎，不是麻烦事（Chris 8/17：「我本来就希望他们天天来店里」）。
             禁止写成「不用跑一趟店里」这类把到店当成本的话。 -->
        <p class="auth-hint">${en
          ? 'No email on file? Our staff can reset it for you in store.'
          : '没留过邮箱？到店里请店员帮您重设。'}</p>
        <button class="auth-ghost" data-auth-go="login">${en ? 'Back' : '返回'}</button>
      `;
    },

    /** 后补邮箱 第 1 步：输邮箱 → 发验证码。 */
    _renderEmailAddView(lang) {
      const en = lang === 'en';
      return `
        <div class="auth-field">
          <label class="auth-label" for="addEmail">
            ${en ? 'Email' : '邮箱'}
            ${this._info('emailInfo', en
              ? 'Used for order updates and for resetting your password yourself.'
              : '用来收订单通知，以及自己重设密码。')}
          </label>
          <input type="email" id="addEmail" class="auth-input" autocomplete="email"
                 placeholder="you@example.com"/>
        </div>
        <button class="btn auth-primary" id="authEmailStartBtn">${en ? 'Send code' : '发送验证码'}</button>
        <button class="auth-ghost" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
      `;
    },

    /** 后补邮箱 第 2 步：输验证码（单输入框，理由见下面 _renderPhoneStep2 的注释）。 */
    _renderEmailCodeView(lang) {
      const en = lang === 'en';
      const to = this._emailSentTo ? `<p class="auth-sent-line">${en ? 'Sent to' : '已发送到'} <b>${this._emailSentTo}</b></p>` : '';
      return `
        ${to}
        <div class="auth-field">
          <input type="tel" id="emailCode" class="auth-code-input"
                 inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                 placeholder="------" aria-label="${en ? 'Verification code' : '验证码'}"/>
        </div>
        <button class="btn auth-primary" id="authEmailConfirmBtn">${en ? 'Confirm' : '确认'}</button>
        <button class="auth-ghost" data-auth-go="email">${en ? 'Use a different email' : '换个邮箱'}</button>
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

    _wireLoginModal() {
      const view = this._view || 'login';

      // 视图跳转：任何带 data-auth-go 的按钮
      document.querySelectorAll('[data-auth-go]').forEach(btn => {
        btn.onclick = () => this._go(btn.dataset.authGo);
      });

      // ⓘ 折叠说明（默认收起）。放在视图分支之外 —— 哪一屏都可能有。
      document.querySelectorAll('[data-auth-info]').forEach(btn => {
        btn.onclick = () => {
          const body = document.getElementById(btn.dataset.authInfo);
          if (!body) return;
          const open = !body.hidden;
          body.hidden = open;
          btn.setAttribute('aria-expanded', String(!open));
        };
      });

      if (view === 'regemail') {
        const b = document.getElementById('authRegStartBtn');
        if (b) b.onclick = () => this._registerStart();
        ['regEmail', 'regName'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.onkeydown = (e) => { if (e.key === 'Enter') this._registerStart(); };
        });
        const first = document.getElementById('regEmail');
        if (first) setTimeout(() => first.focus(), 100);
      }

      if (view === 'regcode') {
        const b = document.getElementById('authRegConfirmBtn');
        if (b) b.onclick = () => this._registerConfirm();
        ['regCode', 'regPw'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.onkeydown = (e) => { if (e.key === 'Enter') this._registerConfirm(); };
        });
        const first = document.getElementById('regCode');
        if (first) setTimeout(() => first.focus(), 100);
      }

      if (view === 'login') {
        const identEl = document.getElementById('authIdent');
        // 已填过手机号（本机记住的）就把光标放到密码上，少一步
        const first = (identEl && identEl.value) ? document.getElementById('authPassword') : identEl;
        if (first) setTimeout(() => first.focus(), 100);
        const btn = document.getElementById('authIdentBtn');
        if (btn) btn.onclick = () => this._identLogin();
        ['authIdent', 'authPassword'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.onkeydown = (e) => { if (e.key === 'Enter') this._identLogin(); };
        });

      } else if (view === 'confirm') {
        const yes = document.getElementById('authConfirmYes');
        if (yes) yes.onclick = () => this._confirmClaim();

      } else if (view === 'setpw') {
        const el = document.getElementById('setPw');
        if (el) setTimeout(() => el.focus(), 100);
        const btn = document.getElementById('authSetPwBtn');
        if (btn) btn.onclick = () => this._setCredentials();
        ['setPw', 'setUser'].forEach(id => {
          const x = document.getElementById(id);
          if (x) x.onkeydown = (e) => { if (e.key === 'Enter') this._setCredentials(); };
        });

      } else if (view === 'forgot') {
        const btn = document.getElementById('authForgotBtn');
        if (btn) btn.onclick = () => this._forgotPassword();
        const el = document.getElementById('forgotIdent');
        if (el) el.onkeydown = (e) => { if (e.key === 'Enter') this._forgotPassword(); };

      } else if (view === 'email') {
        const el = document.getElementById('addEmail');
        if (el) setTimeout(() => el.focus(), 100);
        const btn = document.getElementById('authEmailStartBtn');
        if (btn) btn.onclick = () => this._emailVerifyStart();
        if (el) el.onkeydown = (e) => { if (e.key === 'Enter') this._emailVerifyStart(); };

      } else if (view === 'emailcode') {
        const el = document.getElementById('emailCode');
        if (el) {
          setTimeout(() => el.focus(), 100);
          el.oninput = (e) => { e.target.value = (e.target.value || '').replace(/\D/g, '').slice(0, 6); };
          el.onkeydown = (e) => { if (e.key === 'Enter') this._emailVerifyConfirm(); };
        }
        const btn = document.getElementById('authEmailConfirmBtn');
        if (btn) btn.onclick = () => this._emailVerifyConfirm();

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

      }
    },

    /* 日常登录：手机号 / 用户名 / 邮箱 + 密码。

       手机号和用户名都不是 Firebase 认识的东西，而且**一个 Firebase 账号只能有
       一个登录邮箱** —— 走新流程的人挂的是验证过的真邮箱，走老短信流程的人挂的
       是手机号推导的假邮箱，两种都在线上跑。所以先问后端「该用哪个邮箱登」
       （POST /login，2026-08-20），再拿它走标准的邮箱+密码登录。

       🔒 后端**先拿密码核一次，核过了才回映射** —— 知道密码的就是本人，对本人
       不存在泄露。所以这里可以放心把三种输入都交给它。
       🔒 后端对「没这个人」和「密码不对」回的是同一句话，所以前端也**不能**
          分别提示，否则又成了会员枚举器。
       （旧的 /resolve-login 还在，但它只算得出假邮箱 —— 真邮箱账号输手机号
         必然登不上，那正是这次要修的。） */
    async _identLogin() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      this._showError('');
      const ident = ((document.getElementById('authIdent') || {}).value || '').trim();
      const pw = (document.getElementById('authPassword') || {}).value || '';
      if (!ident) {
        this._showError(en ? 'Please enter your phone or username.' : '请输入手机号或用户名。');
        return;
      }
      if (!pw) {
        this._showError(en ? 'Please enter your password.' : '请输入密码。');
        return;
      }
      const btn = document.getElementById('authIdentBtn');
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = en ? 'Sign in' : '登录'; } };
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Signing in…' : '登录中…'; }

      /* 三种输入都交给后端换算。邮箱也要走 —— 老短信流程的人账号挂的是假邮箱，
         他输自己的真邮箱直接登是登不上的，得靠后端换。 */
      let loginId = ident;
      let denied = false;
      try {
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: ident, password: pw }),
        });
        if (r.status === 401) {
          denied = true;                       // 账号或密码不对（后端不区分）
        } else if (r.status === 404 && ident.indexOf('@') !== -1) {
          // 后端还没上这条路，而输的是邮箱 —— 直接拿它试，别把人挡在门外
          loginId = ident;
        } else {
          const d = await r.json().catch(() => null);
          if (!r.ok || !d || !d.loginId) throw new Error((d && d.detail) || 'HTTP ' + r.status);
          loginId = d.loginId;
        }
      } catch (e) {
        // 🔒 请求失败绝不能显示成「账号密码不对」——那是把一个错误的事实告诉顾客
        this._showError(en ? 'Could not reach the server. Please try again.' : '连接不上服务器，请重试。');
        reset();
        return;
      }
      if (denied) {
        this._showError(en ? 'That account and password don’t match.'
                           : '账号或密码不对。');
        reset();
        return;
      }

      try {
        await Farm.fb.auth.signInWithEmailAndPassword(loginId, pw);
      } catch (e) {
        const c = (e && e.code) || '';
        /* 🔒 「不是你的错」的失败不许显示成「密码不对」——那是把一个错误的事实
           告诉顾客，他会一遍遍试自己明明记得的密码。只有真的凭据不匹配才那么说。 */
        let msg;
        if (c === 'auth/unauthorized-domain') {
          msg = en ? 'Login is not enabled for this site yet.' : '此站点尚未启用登录。';
        } else if (c === 'auth/too-many-requests') {
          msg = en ? 'Too many attempts. Please try again later.' : '尝试次数过多，请稍后再试。';
        } else if (c === 'auth/network-request-failed') {
          msg = en ? 'Network problem. Please try again.' : '网络不通，请重试。';
        } else {
          /* 统一口径：不区分「没这个号」和「密码错」，否则就是会员枚举器。

             ⓘ 这里原来还有一句「用邮箱注册过的话请填邮箱」—— 那是在绕开
             「真邮箱账号输手机号登不上」这个缺陷。POST /login（2026-08-20）
             把缺陷本身修掉了：后端先核密码再回该用哪个邮箱，所以两条路都能登，
             那句绕路的提示可以撤了。 */
          msg = en ? 'That account and password don’t match.' : '账号或密码不对。';
        }
        this._showError(msg);
        reset();
        return;
      }
      // 本机记住输入过的标识（只在这台设备上，绝不存/显示姓名 —— 陌生设备隐私红线）
      try { localStorage.setItem(IDENT_KEY, ident); } catch (_) {}
      this._onLoginSuccess(lang);
    },

    /* 首次激活（短信验证通过后）：设密码 + 选填用户名。一辈子一次。
       🔴 由后端 admin SDK 写到**当前这个 uid** 上，不新建账号 —— 新建 = 一人两 uid，
       而农场存档按 farm_players/{uid} 存，换 uid 等于农场当场清零且不可逆。 */
    async _setCredentials() {
      const lang = Farm.state.data.language;
      const en = lang === 'en';
      this._showError('');
      const pw = (document.getElementById('setPw') || {}).value || '';
      const username = ((document.getElementById('setUser') || {}).value || '').trim();
      if (pw.length < 6) {
        this._showError(en ? 'Password must be at least 6 characters.' : '密码至少 6 位。');
        return;
      }
      const btn = document.getElementById('authSetPwBtn');
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = en ? 'Done' : '完成'; } };
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Saving…' : '保存中…'; }

      const user = Farm.fb.auth.currentUser;
      if (!user) {
        this._showError(en ? 'Session expired. Please start again.' : '会话已过期，请重新开始。');
        this._go('phone');
        return;
      }
      try {
        const token = await user.getIdToken();
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/set-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ password: pw, username: username || null }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || 'HTTP ' + r.status);
      } catch (e) {
        // 后端把「用户名被占」「密码太短」这类都写在 detail 里，直接用它 ——
        // 换成笼统的「保存失败」顾客就不知道该改什么了
        this._showError(String((e && e.message) || '')
          || (en ? 'Could not save. Please try again.' : '保存失败，请重试。'));
        reset();
        return;
      }
      /* 密码是后端用 admin SDK 写到这个 uid 上的，客户端手上的 user 对象
         **还是旧的** —— providerData 里没有 'password'，`_hasLoginCredential()`
         会继续说「这人还没设过密码」，于是可能把刚设完的人再推回设密码屏。
         reload() 一次让它说实话。失败不拦路：密码在服务端已经写成了。
         （农场不用重新登录 —— 身份就是这个 uid，没变。网站那边不一样，
           它靠 auth 状态判「登没登」，所以那边设完要真登一次。）*/
      try { await user.reload(); } catch (_) {}

      // 下次登录默认填这个（本机）。设了用户名就填用户名，否则填手机号。
      try {
        localStorage.setItem(IDENT_KEY,
          username || this._formatPhone((this._currentPhoneE164 || '').replace('+1', '')));
      } catch (_) {}
      this._onLoginSuccess(lang);
    },

    /** 忘记密码：留过邮箱的自助收信；没留的到店改。对外那句话三种情况完全一样。 */
    async _forgotPassword() {
      const en = Farm.state.data.language === 'en';
      this._showError('');
      const ident = ((document.getElementById('forgotIdent') || {}).value || '').trim();
      if (!ident) {
        this._showError(en ? 'Please enter your phone or username.' : '请输入手机号或用户名。');
        return;
      }
      const btn = document.getElementById('authForgotBtn');
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Sending…' : '发送中…'; }
      try {
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: ident }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || 'HTTP ' + r.status);
        Farm.ui.toast(en
          ? 'If we have your email, the reset link is on its way.'
          : '留过邮箱的话，重置信已经发出。', 4000);
        this._go('login');
      } catch (e) {
        this._showError(en ? 'Could not send. Please try again.' : '发送失败，请重试。');
        if (btn) { btn.disabled = false; btn.textContent = en ? 'Send reset email' : '发送重置邮件'; }
      }
    },

    /** 后补邮箱 第 1 步：查占用 + 发验证码。 */
    async _emailVerifyStart() {
      const en = Farm.state.data.language === 'en';
      this._showError('');
      const email = ((document.getElementById('addEmail') || {}).value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        this._showError(en ? 'Please enter a valid email.' : '请输入正确的邮箱地址。');
        return;
      }
      const btn = document.getElementById('authEmailStartBtn');
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = en ? 'Send code' : '发送验证码'; } };
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Sending…' : '发送中…'; }
      const user = Farm.fb.auth.currentUser;
      if (!user) { this._showError(en ? 'Please sign in first.' : '请先登录。'); reset(); return; }
      try {
        const token = await user.getIdToken();
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/email-verify/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ email }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || 'HTTP ' + r.status);
        this._emailSentTo = (d && d.sentTo) || '';
        this._pendingEmail = email;
        this._go('emailcode');
      } catch (e) {
        this._showError(String((e && e.message) || '')
          || (en ? 'Could not send. Please try again.' : '发送失败，请重试。'));
        reset();
      }
    },

    /** 后补邮箱 第 2 步：验码通过才写进会员档。 */
    async _emailVerifyConfirm() {
      const en = Farm.state.data.language === 'en';
      this._showError('');
      const code = ((document.getElementById('emailCode') || {}).value || '').trim();
      if (code.length !== 6) {
        this._showError(en ? 'Enter the 6-digit code.' : '请输入 6 位验证码。');
        return;
      }
      const btn = document.getElementById('authEmailConfirmBtn');
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = en ? 'Confirm' : '确认'; } };
      if (btn) { btn.disabled = true; btn.textContent = en ? 'Checking…' : '验证中…'; }
      const user = Farm.fb.auth.currentUser;
      if (!user) { this._showError(en ? 'Please sign in first.' : '请先登录。'); reset(); return; }
      try {
        const token = await user.getIdToken();
        const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/email-verify/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ code }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || 'HTTP ' + r.status);
      } catch (e) {
        this._showError(String((e && e.message) || '')
          || (en ? 'Could not verify. Please try again.' : '验证失败，请重试。'));
        reset();
        return;
      }
      // 漏斗「补上邮箱」。3000 农场币要「登录 + 留邮箱」才发，而没邮箱的会员靠常驻
      // 提醒条慢慢补 —— 补没补上只有这个数看得见（login 与它的差就是登录了却仍
      // 拿不到礼包的人）。
      if (Farm.track) Farm.track('email_set');
      // 本地会员档里的邮箱也跟上，提醒条才会立刻消失（不用等下次拉取）。
      // ⚠️ hasEmail 也要一起翻 —— hasRealEmail() 现在优先看它（whoami 只回布尔），
      //    只改 email 的话提醒条会赖着不走。
      if (this.memberDoc) {
        this.memberDoc.email = this._pendingEmail || this.memberDoc.email;
        this.memberDoc.hasEmail = true;
      }
      this.refreshEmailNudge();
      // 邮箱是发 3000 农场币的条件，补上后立刻再试一次（事务幂等，重复调安全）
      try {
        if (Farm.fbPoints && Farm.fbPoints.firstLoginGameSignupBonus) {
          Farm.fbPoints.firstLoginGameSignupBonus(user);
        }
      } catch (_) {}

      /* 🆕 验完邮箱接着设密码（Chris 2026-08-20 定的完整流程的最后一段）。
         没有这一段，他在**网站**那边仍然登不进去 —— 邮箱只是记在会员档上，
         Auth 账号还没有密码这套凭据。设完之后邮箱和手机号两条路都能登，
         农场和网站是同一个账号（已实测 uid 不变，存档不会分家）。
         🔒 只有还没设过密码的人才走这一步；已经有凭据的（老会员补邮箱）
            直接进游戏，别平白多问一次。 */
      if (!this._hasLoginCredential()) {
        Farm.ui.toast(en ? 'Email verified 🎉' : '邮箱已验证 🎉', 2200);
        this._go('setpw');
        return;
      }
      Farm.ui.hideModal();
      Farm.ui.toast(en ? 'Email saved 🎉' : '邮箱已保存 🎉', 3000);
    },

    /** 这个账号有没有「邮箱/用户名 + 密码」那套登录凭据。
        匿名进来、还没设过密码的人返回 false —— 他们只能在这台设备上玩。 */
    _hasLoginCredential() {
      const u = this.currentUser;
      if (!u) return false;
      // 匿名账号的 providerData 是空的；设过密码之后会出现 'password'
      const ps = (u.providerData || []).map((x) => x && x.providerId);
      return ps.indexOf('password') !== -1;
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
      /* 🔴 号码取自 this._currentPhoneE164，**不许再读 #authPhone**（2026-08-19 修）
         --------------------------------------------------------------------
         原来这里读 `#authPhone` 输入框，而那个框只存在于**上一屏**（输手机号）。
         2026-08-12 把流程拆成两屏之后（拆的理由见 _renderLoginModal 顶部：iOS
         手势不能被 await 吃掉），验证码这一屏就没有它了 → `digits.length` 恒为 0
         → 永远走进下面那句错误提示并 return。

         **后果：短信验证码从来发不出去。** 屏幕上一边写着「将发送到 (639)
         476-8553」，一边红字说「请输入 10 位手机号」—— 号码明明已经在手上。
         客人 Alicia 2026-08-19 报的就是这个，她只能关掉窗口以游客身份进游戏。
         而这条路是 909 个从没登录过的会员**唯一**的入口。

         ⚠️ 这里是同步取值，不能改成 await —— 下面 signInWithPhoneNumber 之前
         有任何 await 都会吃掉 iOS 的用户手势，reCAPTCHA 会静默挂死。 */
      const raw = this._phoneDigits(this._currentPhoneE164 || '');
      // _currentPhoneE164 形如 +13064768553 → 去掉国家码 1，只留 10 位
      const digits = (raw.length === 11 && raw[0] === '1') ? raw.slice(1) : raw;
      if (digits.length !== 10) {
        // 走到这里说明上一屏的号码丢了（正常流程不会）。不要叫人往一个
        // **这屏上根本不存在**的输入框里打字 —— 把他送回能输入的那一屏。
        this._showError(lang === 'en'
          ? 'Please enter your phone number again.'
          : '请重新输入手机号。');
        this._go('phone');
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
      /* 🔴 这里原来是 `localStorage.setItem(REMEMBER_KEY, phoneRaw)`，而 phoneRaw
         这个变量**全仓不存在** —— 抛 ReferenceError 的位置正好在
         signInWithPhoneNumber() 之后、切屏之前，后果一条比一条难看：
           · 短信已经真发出去了（Firebase 服务端发的，也已经计费）
           · 不切到 otp 屏 → 人手里握着验证码，屏幕上没有地方填
           · 按钮的复位代码在下面 .catch 里 → 永久停在「发送中…」
           · _showError 一次都没调 → 一个字不报错
         号码本来就在上一屏（_go('phone') 那条路，见 :626）用同一个键存过了，
         这一行是多余的，删掉即可。 */
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

        /* 🔒 把 Auth 账号关联到会员档 —— **必须走后端**，别改回客户端直写。

           2026-08-17 查出来的事故：这里原来是客户端自己
               db.collection('members').where('phone','==',e164).update({firebase_uid})
           而 977 个会员里 959 个的文档**根本没有 firebase_uid 这个键**（RewardUp
           迁移过来时就没有）。firestore 的自链接规则第一条写的是
               resource.data.firebase_uid == null
           「键不存在」与「键存在且为 null」在规则引擎里不是一回事 —— 那条 update
           被拒，而下面那个 catch 把失败**静默吞掉**了。

           后果：50 个真会员短信登录成功、手机号与会员档一一对应，却从来没关联上，
           在游戏里看不到自己的积分（最高 5,429 分），下次登录还得再花一条短信。
           登录成功、没有报错、玩得下去 —— 所以两年没人发现。

           后端 /link-phone 用 admin SDK 写，绕过规则，行为确定。 */
        try {
          await this._linkPhoneViaBackend();
        } catch (e) {
          // 关联失败不该把人挡在门外（Auth 账号已经能用了），但**要留痕** ——
          // 上一版的空 catch 正是这个 bug 藏两年的原因。下次启动
          // _loadMemberDoc 会再试一次（幂等），所以能自愈。
          console.warn('[auth] link-phone 失败，下次登录会自愈:', e);
        }

        /* 漏斗：短信验证成功就算「登录」。
           原来只在下面 bind-email 走完时才发 track('login')，于是短信验过就走的人
           在后台完全不存在 —— 8/15 促销明明有 2 个人登录成功，漏斗显示 0，
           Chris 因此以为「客人都登录不上」。 */
        this._trackLoginOnce();

        /* 短信只是**激活**的第一半：接着设密码，否则下次又得再发一条短信 ——
           而这套改造的全部意义就是不再每次发短信。
           🔒 这一屏**不要邮箱**（2026-08-17 改）。原来这里要邮箱+密码，实测 77 个
           账号里 67 个就是在这儿走掉的，于是每次登录都掏一条短信钱。邮箱改成登录
           之后靠常驻提醒条慢慢补 —— Chris：「人家不要这个方便的时候难道我们就
           不要这个客人吗」。 */
        this._go('setpw');
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

    /* 旧的 _emailLogin(邮箱+密码专用) 已于 2026-08-17 删除 —— 它读的 #authEmail
       随着登录屏改成「手机号/用户名」一起没了，留着就是个会抛 TypeError 的死函数。
       邮箱登录并没有取消：_identLogin 见到含 @ 的输入就直接当邮箱走，老会员照常。 */

    /* 让别处（「还差一步·留邮箱领 3000 币」弹窗、常驻提醒条）能直接打开补邮箱屏。
       内部用 _go('email')，但别的模块不该依赖内部方法名。 */
    openEmailSetup() {
      if (!this.currentUser) { this.openLoginModal(); return; }
      this._go('email');
    },

    /* ============ 没留邮箱的常驻提醒条（Chris 8/17 选的方案）============
       Chris 明确否掉了「每次登录弹窗提醒」：那是打断，玩家会学会闭着眼点掉。
       改成一条不挡路的常驻条 —— 想理它随时点，不想理就一直在那儿。

       🔒 判据是 members.email 有没有真邮箱。假邮箱（手机号登录用的
       {…}@phone.easternmarket.ca）不算 —— 那是我们自己造的登录 id，不是
       能收信的地址，算成有邮箱就等于永远不提醒、订单通知也永远发不出去。 */
    hasRealEmail() {
      const m = this.memberDoc || {};
      /* 🔒 先看 hasEmail（2026-08-20 线上实测抓到）。
         走「手机号直接进」的人，memberDoc 来自 `/whoami` —— 而 whoami 出于
         隐私**只回 hasEmail 布尔，不回邮箱地址**。只看 m.email 的话，这批人
         全被判成「没留过邮箱」，于是每次进来都被再问一遍「留个邮箱」，
         哪怕他上周刚留过。实测就是这样：测试会员明明有邮箱，还是被送进补邮箱屏。
         后端 `_has_real_email()` 与下面这行是同一口径（都排除假邮箱域），
         改一边要一起改。 */
      if (typeof m.hasEmail === 'boolean') return m.hasEmail;
      const mail = String(m.email || '').trim().toLowerCase();
      return !!mail && !mail.endsWith('@phone.easternmarket.ca');
    },

    refreshEmailNudge() {
      const host = document.getElementById('emailNudge');
      if (!host) return;
      const show = !!this.currentUser && !this.hasRealEmail();
      if (!show) { host.hidden = true; host.innerHTML = ''; return; }
      const en = Farm.state.data.language === 'en';
      host.hidden = false;
      // 🔒 一句话说完（Chris：「所有提示语都要要尽量简洁！」）。
      // 好处（订单通知 / 自助改密码）收进补邮箱那一屏的 ⓘ，这里不铺开。
      host.innerHTML = `
        <span class="email-nudge-text">${en
          ? 'Add your email — 3,000 farm coins' : '留个邮箱，送 3000 农场币'}</span>
        <button type="button" class="email-nudge-btn" id="emailNudgeBtn">${en ? 'Add' : '去添加'}</button>`;
      const btn = document.getElementById('emailNudgeBtn');
      if (btn) btn.onclick = () => this.openEmailSetup();
    },

    /* 把当前 Auth 账号关联到同手机号的会员档（后端 admin SDK 写，绕过
       firestore 规则）。幂等 —— 已关联就直接回成功，可以放心重复调。
       要求 ID token 里有 phone_number，也就是必须是短信验证过的账号。 */
    async _linkPhoneViaBackend() {
      const u = this.currentUser;
      if (!u) return;
      const idToken = await u.getIdToken();
      const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/link-phone', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken },
      });
      if (!r.ok) throw new Error('link-phone HTTP ' + r.status);
      return r.json().catch(() => null);
    },

    /* 漏斗「登录」只数一次。
       短信流程在验证码通过那一刻就发（那才是真正登录成功的时刻），走完
       bind-email 后 _onLoginSuccess 会再走一次这里 —— 没有这个闸就一个人数两次。
       邮箱登录只经过 _onLoginSuccess，不受影响。 */
    _trackLoginOnce() {
      if (this._loginTracked) return;
      this._loginTracked = true;
      if (Farm.track) Farm.track('login');
    },

    _onLoginSuccess(lang) {
      Farm.ui.hideModal();
      this._trackLoginOnce();   // 漏斗:真实登录转化(仅主动登录成功时,非每次恢复)
      if (Farm.audio) Farm.audio.play('achievement');
      setTimeout(() => {
        const name = (this.memberDoc && (this.memberDoc.name || this.memberDoc.username))
          || (this.currentUser && this.currentUser.displayName)
          || (lang === 'en' ? 'Member' : '会员');
        const safeName = String(name).replace(/[<>"&]/g, '');
        /* 刚注册的人说「欢迎回来」是假话 —— 他第一次来。
           待激活账号（_pending）走另一句。 */
        const fresh = !!(this.memberDoc && this.memberDoc._pending);
        const msg = lang === 'en'
          ? (fresh ? `🌱 Welcome to Eastern Farm, ${safeName} 🎉`
                   : `🌱 Welcome back, ${safeName} 🎉`)
          : (fresh ? `🌱 欢迎来到东方农场，${safeName} 🎉`
                   : `🌱 欢迎回来，${safeName} 🎉`);
        Farm.ui.toast(msg, 3000);
      }, 400);
    },

    // ============ Logout / menu ============
    openMenu() {
      const lang = Farm.state.data.language;
      const m = this.memberDoc || {};
      const name = m.name || this.currentUser.displayName || (lang === 'en' ? 'Member' : '会员');
      const pending = !!m._pending;
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
          ${pending ? `
          <!-- 🔒 待激活账号：口径是「待领取」，不是「你的积分」。
               他还不是会员，说「已与会员账户同步」就是假话。 -->
          <div style="font-size:24px;font-weight:700;color:var(--purple-points);margin-top:6px;"><span class="points-icon"></span> ${(m.pendingPoints || 0).toLocaleString()}</div>
          <div style="font-size:11px;color:var(--warm-text-soft);">
            ${lang === 'en' ? 'Held for you' : '待领取'}
          </div>
          <div style="font-size:11px;color:var(--leaf-dark);margin-top:4px;font-weight:600;">
            ${lang === 'en'
              ? 'Give us your phone in store — these land on your member card'
              : '到店报一下手机号，就到你的会员卡上'}
          </div>
          <!-- 激活码：顾客到柜台要报的就是这 6 位数。字要大 —— 他多半是举着
               手机给收银员看，或者念出来。24 小时有效，过期点一下重出。 -->
          ${m.activationCode ? `
          <div style="margin-top:14px;padding:12px;border-radius:12px;
                      background:var(--cream-2,#fdf8ef);border:1px dashed rgba(122,90,60,.28);">
            <div style="font-size:11px;color:var(--warm-text-soft);">
              ${lang === 'en' ? 'Show this code at the till' : '到收银台报这个码'}
            </div>
            <div style="font-size:30px;font-weight:700;letter-spacing:6px;
                        color:var(--leaf-dark,#2a5c34);margin-top:4px;font-variant-numeric:tabular-nums;">
              ${String(m.activationCode).replace(/[^0-9]/g, '')}
            </div>
            <button class="auth-ghost" id="pendNewCode" style="margin-top:6px;">
              ${lang === 'en' ? 'Code expired? Get a new one' : '过期了？换一个'}
            </button>
          </div>` : ''}` : `
          <div style="font-size:24px;font-weight:700;color:var(--purple-points);margin-top:6px;"><span class="points-icon"></span> ${totalPoints.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--warm-text-soft);">
            ${lang === 'en' ? 'Lifetime: ' : '累积: '}${lifetimePoints.toLocaleString()}
          </div>
          <div style="font-size:11px;color:var(--warm-text-soft);margin-top:4px;">
            ${lang === 'en' ? 'Synced with Eastern Market account' : '已与东方超市会员账户同步'}
          </div>`}
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

      // 激活码过期了换一个（码 24 小时有效，隔几天才来店里的人一定会遇到）
      const newCodeBtn = document.getElementById('pendNewCode');
      if (newCodeBtn) newCodeBtn.onclick = async () => {
        const en = lang === 'en';
        newCodeBtn.disabled = true;
        newCodeBtn.textContent = en ? 'Getting…' : '换取中…';
        try {
          const idToken = await this.currentUser.getIdToken();
          const r = await fetch(STOCKWISE_BASE + '/api/public/member-auth/pending/new-code', {
            method: 'POST', headers: { Authorization: 'Bearer ' + idToken },
          });
          const d = await r.json().catch(() => null);
          if (!r.ok || !d || !d.activationCode) throw new Error((d && d.detail) || 'HTTP ' + r.status);
          if (this.memberDoc) this.memberDoc.activationCode = d.activationCode;
          Farm.ui.hideModal();
          this.openMenu();                       // 重画，显示新码
        } catch (e) {
          // 🔒 拿不到新码要说清楚，不能静默 —— 他正站在收银台前
          Farm.ui.toast(String((e && e.message) || '')
            || (en ? 'Could not get a new code. Please try again.' : '换不出新码，请重试。'), 3000);
          newCodeBtn.disabled = false;
          newCodeBtn.textContent = en ? 'Code expired? Get a new one' : '过期了？换一个';
        }
      };
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
