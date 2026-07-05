/**
 * firebase-points.js — Sync game EP changes through the StockWise proxy.
 *
 * Architecture (V2, daily-sync model):
 *
 *   Game ── POST {STOCKWISE}/api/rewardup/me/earn ──► StockWise
 *           POST {STOCKWISE}/api/rewardup/me/spend
 *                       ↓
 *                Firestore writes:
 *                  members/{memberDocId}.totalPoints (cache, recomputed)
 *                  members/{memberDocId}.pendingGameDelta (queued)
 *                  points_transactions/ audit row
 *                       ↓
 *                Returns { new_balance, pendingGameDelta, ... }
 *           Game UI updates from response.new_balance immediately.
 *
 *   Once per day (Cloud Scheduler):
 *       StockWise /admin/daily-rewardup-push pushes pendingGameDelta to
 *       RewardUp (the true loyalty system), zeros the pending queue.
 *
 * The game never writes Firestore directly. All authentication is via
 * Firebase ID token in the Authorization header; the server validates it.
 *
 * Failure modes:
 *   - Network/server error → queue via Farm.fbQueue, retry on online+login
 *   - 429 daily-cap exceeded → toast user, don't queue (would just re-fail)
 *   - 422 insufficient balance (spend) → toast user
 *
 * First-login backfill: when a guest with accumulated state.unsyncedEp
 * logs in, credits min(unsyncedEp, BACKFILL_CAP) to their member account
 * one-shot. Survives via state.backfillDone flag.
 */
(function() {
  const STOCKWISE_BASE = 'https://stockwise-app-873982544406.us-central1.run.app';
  const BACKFILL_CAP = 100;

  // Limited-time "Welcome to the game" bonus for store members on their
  // FIRST login to the farm. Awarded as 3,000 farm coins (equivalent to
  // 300 EP via the 10:1 exchange, ≈ $0.30 real cost). Member-doc-scoped
  // flag (gameSignupBonusGivenAt) prevents re-claim across devices and
  // localStorage wipes.
  const GAME_SIGNUP_BONUS_COINS = 3000;
  const GAME_SIGNUP_BONUS_END = '2026-08-31';

  // Circuit breaker: once an earn/spend call hits a state where retrying soon is
  // pointless — daily cap (429), or auth/endpoint trouble (401/403/404) — pause the
  // network sync so every subsequent harvest doesn't fire another failing request
  // (which the browser logs as a red console error). Events stay queued locally and
  // flush once the pause expires; the server's eventId dedupe prevents double-credit.
  let _syncPausedUntil = 0, _backoffMs = 0;
  function _nextMidnight() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }
  function _notePointsOutcome(code, ok) {
    if (ok) { _syncPausedUntil = 0; _backoffMs = 0; return; }     // healthy → reset backoff
    if (code === 422) return;                                     // per-event bad data: don't pause the whole channel
    // EVERY other failure — 429 rate-limit ("earn_too_fast", the game fires several EP
    // earns per harvest + rapid play), 429 daily cap, 401/403/404, 5xx, network — uses
    // ONE exponential backoff: 1min → 2 → 4 → … capped at 2h. A transient rate-limit burst
    // recovers in ~1min; a persistently-broken endpoint produces only ~7 failed requests
    // total per session instead of 100+ red console errors. Events stay queued (eventId
    // dedupe), so nothing is double-credited or lost — just delayed.
    _backoffMs = _backoffMs ? Math.min(2 * 3600 * 1000, _backoffMs * 2) : 60 * 1000;
    _syncPausedUntil = Date.now() + _backoffMs;
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  async function _callStockWise(path, body) {
    if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) {
      const err = new Error('not_logged_in');
      err.code = 'not_logged_in';
      throw err;
    }
    const idToken = await Farm.fbAuth.currentUser.getIdToken();
    const res = await fetch(STOCKWISE_BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken,
      },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && data.detail) || ('HTTP ' + res.status));
      err.code = res.status;
      err.detail = data && data.detail;
      throw err;
    }
    return data || {};
  }

  function _applyServerResponseToLocal(resp) {
    // Pull authoritative balance from server response into local state cache.
    if (resp == null) return;
    if (typeof resp.new_balance === 'number') {
      Farm.state.data.eastPoints = resp.new_balance;
      Farm.state.save();
      if (Farm.fbAuth && Farm.fbAuth.memberDoc) {
        Farm.fbAuth.memberDoc.totalPoints = resp.new_balance;
        Farm.fbAuth._renderTopbar && Farm.fbAuth._renderTopbar();
      }
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
    }
  }

  const points = {
    /**
     * Sync a game-side EP earn event through StockWise. Returns
     *   { synced, eventId, queued, new_balance? }.
     * If the user isn't logged in or the request fails, the event is
     * queued for retry (Farm.fbQueue) and `synced: false` is returned.
     */
    async syncEpEarn(amount, source, description, eventId) {
      eventId = eventId || uuid();
      if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) {
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'earn', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: 'not_logged_in' };
      }
      // Breaker: skip the network call (keep it queued) while paused after a cap/auth failure.
      if (Date.now() < _syncPausedUntil) {
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'earn', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: 'sync_paused' };
      }
      try {
        const resp = await _callStockWise('/api/rewardup/me/earn', {
          points: amount,
          source: source || 'unknown',
          eventId,
          description: description || '',
        });
        _applyServerResponseToLocal(resp);
        _notePointsOutcome(0, true);
        return { synced: true, eventId, new_balance: resp.new_balance };
      } catch (e) {
        _notePointsOutcome(e.code, false);
        // 429 = daily cap, 422 = validation, 401/403/404 = auth/endpoint → don't queue (would just fail again)
        if (e.code === 429 || e.code === 422 || e.code === 404 || e.code === 401 || e.code === 403) {
          console.warn('[fb-points] earn rejected:', e.code, e.detail);
          return { synced: false, eventId, rejected: true, code: e.code, reason: e.detail || String(e) };
        }
        // Network / 5xx → queue for retry
        console.warn('[fb-points] earn failed, queuing:', e.code || e.message);
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'earn', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: e.code || e.message };
      }
    },

    /**
     * Sync a game-side EP spend event through StockWise. Same shape as
     * syncEpEarn. Server enforces "balance must not go negative".
     */
    async syncEpSpend(amount, source, description, eventId) {
      eventId = eventId || uuid();
      if (amount <= 0) return { synced: true, eventId, noop: true };
      if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) {
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'spend', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: 'not_logged_in' };
      }
      if (Date.now() < _syncPausedUntil) {
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'spend', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: 'sync_paused' };
      }
      try {
        const resp = await _callStockWise('/api/rewardup/me/spend', {
          points: amount,
          source: source || 'unknown',
          eventId,
          description: description || '',
        });
        _applyServerResponseToLocal(resp);
        _notePointsOutcome(0, true);
        return { synced: true, eventId, new_balance: resp.new_balance };
      } catch (e) {
        _notePointsOutcome(e.code, false);
        if (e.code === 422 || e.code === 404 || e.code === 401 || e.code === 403) {
          console.warn('[fb-points] spend rejected:', e.code, e.detail);
          return { synced: false, eventId, rejected: true, code: e.code, reason: e.detail || String(e) };
        }
        console.warn('[fb-points] spend failed, queuing:', e.code || e.message);
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'spend', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: e.code || e.message };
      }
    },

    /**
     * 反向闭环 B：领取「到店消费 → 农场奖励」。
     * 复用带 Firebase token 的 _callStockWise（别自己拼 token），加 timeout。
     * 直接返回服务端原样分支对象（幂等在服务端）：
     *   { ok, coins, newRewards:[{orderId,total,coins,date}], totalCoinsAllTime }  // 有单/无单
     *   { unlinked:true, message, coins:0, newRewards:[] }                          // 未关联店内消费
     *   { ok:true, disabled:true, coins:0, newRewards:[] }                          // 功能关闭
     * 抛错：not_logged_in / timeout / HTTP xxx —— 由调用方 catch 后给重试入口。
     * 注意：unlinked/disabled 是 HTTP 200（ok 分支），会正常返回不抛错。
     */
    async claimStorePurchaseRewards(opts) {
      opts = opts || {};
      const timeoutMs = opts.timeoutMs || 15000;
      const call = _callStockWise('/api/members/me/farm-purchase-rewards', {});
      const data = await Promise.race([
        call,
        new Promise((_, rej) => setTimeout(() => {
          const e = new Error('timeout'); e.code = 'timeout'; rej(e);
        }, timeoutMs)),
      ]);
      return data || {};
    },

    /**
     * On first successful login, credit any guest-mode-accumulated EP to
     * the member account (capped at BACKFILL_CAP to limit abuse).
     */
    async firstLoginBackfill(user) {
      const data = Farm.state.data;
      if (data.backfillDone) return;
      const local = data.unsyncedEp || 0;
      if (local <= 0) {
        data.backfillDone = true;
        Farm.state.save();
        return;
      }
      const amount = Math.min(local, BACKFILL_CAP);
      const result = await this.syncEpEarn(
        amount,
        'first_login_backfill',
        '首次登录：旧本地积分回填',
        'backfill_' + user.uid
      );
      if (result.synced) {
        data.unsyncedEp = Math.max(0, local - amount);
        data.backfillDone = true;
        Farm.state.save();
        // Re-sync local state from authoritative server balance
        if (Farm.fbAuth && Farm.fbAuth._syncLocalBalance) Farm.fbAuth._syncLocalBalance();
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        const lang = data.language;
        setTimeout(() => {
          Farm.ui.toast(lang === 'en'
            ? '🎁 ' + amount + ' points backfilled to your member account'
            : '🎁 ' + amount + ' 超市积分已回填到您的会员账户', 4000);
        }, 800);
      }
      // If failed, backfillDone stays false; retried on next login or queue flush.
    },

    /**
     * Limited-time first-login bonus for confirmed store members: grants
     * GAME_SIGNUP_BONUS_COINS to the in-game wallet. Idempotent via a
     * Firestore transaction on members/{uid}.gameSignupBonusGivenAt, so
     * clearing localStorage or switching devices can't re-claim it.
     *
     * Silent no-op when:
     *   - Firebase unavailable
     *   - Past the promo end date
     *   - Member doc missing (phone authed but not a real store member)
     *   - Already claimed on a previous login
     */
    async firstLoginGameSignupBonus(user) {
      if (!Farm.fb || !Farm.fb.available || !Farm.fb.db) return;
      if (!user || !user.uid) return;

      // Promo window check (Saskatoon local date)
      const today = Farm.state.getDateString();
      if (today > GAME_SIGNUP_BONUS_END) return;

      const memberRef = Farm.fb.db.collection('members').doc(user.uid);
      let granted = false;
      try {
        granted = await Farm.fb.db.runTransaction(async (tx) => {
          const snap = await tx.get(memberRef);
          if (!snap.exists) return false;
          const data = snap.data();
          if (data.gameSignupBonusGivenAt) return false;
          tx.update(memberRef, {
            gameSignupBonusGivenAt: firebase.firestore.FieldValue.serverTimestamp(),
            gameSignupBonusCoins: GAME_SIGNUP_BONUS_COINS,
          });
          return true;
        });
      } catch (e) {
        console.warn('[fb-points] signup bonus transaction failed:', e.message || e);
        return;
      }
      if (!granted) return;

      // Credit locally + refresh HUD
      Farm.state.addCoins(GAME_SIGNUP_BONUS_COINS);
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();

      // Short delay so any login modal closes first
      setTimeout(() => this._showSignupBonusModal(GAME_SIGNUP_BONUS_COINS), 400);
    },

    _showSignupBonusModal(amount) {
      const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
      const isEn = lang === 'en';
      const ep = Math.floor(amount / 10);
      const html = `
        <div style="text-align:center;padding:6px 4px;">
          <div style="font-size:54px;line-height:1;margin-bottom:6px;">🎁</div>
          <h2 class="modal-title" style="margin-bottom:4px;">
            ${isEn ? 'Welcome Gift' : '会员开张礼'}
          </h2>
          <p class="modal-subtitle" style="margin-top:0;">
            ${isEn ? 'Limited time · Members only' : '限时活动 · 会员专享'}
          </p>
          <div style="margin:18px 0;padding:20px 16px;background:linear-gradient(135deg,#fff8e7,#fef3d6);border-radius:16px;border:1px solid rgba(58,140,80,0.15);">
            <div style="font-size:42px;font-weight:800;color:#3a8c50;line-height:1;letter-spacing:-1px;">
              +${amount.toLocaleString()}
            </div>
            <div style="font-size:13px;color:#6b5840;margin-top:6px;font-weight:600;">
              ${isEn ? 'farm coins' : '农场币'}
            </div>
            <div style="font-size:11px;color:#9b8870;margin-top:10px;">
              ${isEn ? 'Equivalent to ' + ep + ' Store Points' : '等同 ' + ep + ' 超市积分'}
            </div>
          </div>
          <p style="font-size:13px;color:#6b5840;margin:12px 0 4px;">
            ${isEn ? 'Plant, harvest, grow your stash 🌱' : '种菜攒积分，越玩越有钱 🌱'}
          </p>
          <p style="font-size:11px;color:#9b8870;margin:0 0 18px;">
            ${isEn ? 'Promotion ends ' + GAME_SIGNUP_BONUS_END : '活动至 ' + GAME_SIGNUP_BONUS_END + ' 截止'}
          </p>
          <button class="btn" id="signupGiftOk" style="width:100%;padding:14px;font-size:15px;">
            ${isEn ? 'Start farming →' : '收下，开始种菜 →'}
          </button>
        </div>
      `;
      // queue:true——开张礼由登录后 400ms 延时自动触发，若玩家正读着别的
      // 弹窗（登录成功页/教程等）先排队，不顶掉（UX 第 3 批 #7）。
      Farm.ui.showModal(html, {
        queue: true,
        queueKey: 'signup_gift',
        onShow: () => {
          const btn = document.getElementById('signupGiftOk');
          if (btn) btn.onclick = () => {
            Farm.ui.hideModal();
            if (Farm.audio) Farm.audio.play('coin');
          };
          if (Farm.ui && Farm.ui.showConfetti) Farm.ui.showConfetti(40, 2800);
          if (Farm.audio) Farm.audio.play('achievement');
          if (navigator.vibrate) { try { navigator.vibrate([20, 50, 20]); } catch (_) {} }
        },
      });
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbPoints = points;
})();
