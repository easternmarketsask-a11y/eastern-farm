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
      try {
        const resp = await _callStockWise('/api/rewardup/me/earn', {
          points: amount,
          source: source || 'unknown',
          eventId,
          description: description || '',
        });
        _applyServerResponseToLocal(resp);
        return { synced: true, eventId, new_balance: resp.new_balance };
      } catch (e) {
        // 429 = daily cap, 422 = validation → don't queue (would just fail again)
        if (e.code === 429 || e.code === 422 || e.code === 404) {
          console.warn('[fb-points] earn rejected:', e.code, e.detail);
          return { synced: false, eventId, rejected: true, reason: e.detail || String(e) };
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
      try {
        const resp = await _callStockWise('/api/rewardup/me/spend', {
          points: amount,
          source: source || 'unknown',
          eventId,
          description: description || '',
        });
        _applyServerResponseToLocal(resp);
        return { synced: true, eventId, new_balance: resp.new_balance };
      } catch (e) {
        if (e.code === 422 || e.code === 404) {
          console.warn('[fb-points] spend rejected:', e.code, e.detail);
          return { synced: false, eventId, rejected: true, reason: e.detail || String(e) };
        }
        console.warn('[fb-points] spend failed, queuing:', e.code || e.message);
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'spend', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: e.code || e.message };
      }
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
            ? '🎁 ' + amount + ' EP backfilled to your member account'
            : '🎁 ' + amount + ' 积分已回填到您的会员账户', 4000);
        }, 800);
      }
      // If failed, backfillDone stays false; retried on next login or queue flush.
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbPoints = points;
})();
