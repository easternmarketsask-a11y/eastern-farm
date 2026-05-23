/**
 * firebase-points.js — Sync game EP earnings to the real Eastern Market
 * member account (Firestore: members/{uid}.totalPoints + points_transactions/).
 *
 * Each earn event is idempotent via eventId (UUID). The Firestore transaction:
 *   1. Verifies the eventId hasn't been credited before (dedupe).
 *   2. Atomically increments members/{uid}.{totalPoints, lifetimePoints}.
 *   3. Appends a points_transactions doc with source='game:farm' + subSource.
 *
 * Failures (offline, rule rejected, network) queue via Farm.fbQueue for retry.
 *
 * First-login backfill: when a guest with accumulated state.unsyncedEp logs
 * in, we credit min(unsyncedEp, 100) to their account as a one-time welcome.
 */
(function() {
  const BACKFILL_CAP = 100;

  // RFC4122 v4 (browser may have crypto.randomUUID; polyfill otherwise)
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  const points = {
    // Public entry: sync one earn event. Returns { synced, eventId, queued }.
    async syncEpEarn(amount, source, description, eventId) {
      eventId = eventId || uuid();
      if (!Farm.fb || !Farm.fb.available) {
        // No Firebase → queue for later
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: 'no_firebase' };
      }
      if (!Farm.fbAuth.isLoggedIn()) {
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: 'not_logged_in' };
      }
      const uid = Farm.fbAuth.uid();
      try {
        await this._writeEarnTransaction(uid, amount, source, description, eventId);
        return { synced: true, eventId };
      } catch (e) {
        console.warn('[fb-points] sync failed; queuing', e);
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: e.code || e.message };
      }
    },

    // Sync an in-game spend (EP shop purchase, EP→coins exchange). Decrements
    // members/{uid}.totalPoints and creates a points_transactions doc with
    // type='redeem' so the main store's PointsHistory shows it as "spent".
    // lifetimePoints is NOT decremented (it's a "lifetime earned" counter).
    async syncEpSpend(amount, source, description, eventId) {
      eventId = eventId || uuid();
      if (amount <= 0) return { synced: true, eventId, noop: true };
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth.isLoggedIn()) {
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'spend', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: 'not_logged_in' };
      }
      const uid = Farm.fbAuth.uid();
      try {
        await this._writeSpendTransaction(uid, amount, source, description, eventId);
        return { synced: true, eventId };
      } catch (e) {
        console.warn('[fb-points] spend sync failed; queuing', e);
        if (Farm.fbQueue) Farm.fbQueue.enqueue({ kind: 'spend', amount, source, description, eventId });
        return { synced: false, eventId, queued: true, reason: e.code || e.message };
      }
    },

    async _writeSpendTransaction(uid, amount, source, description, eventId) {
      const db = Farm.fb.db;
      const memberRef = db.collection('members').doc(uid);
      const txCol = db.collection('points_transactions');

      // Idempotency: dedupe by eventId
      const dupCheck = await txCol
        .where('memberId', '==', uid)
        .where('eventId', '==', eventId)
        .limit(1)
        .get();
      if (!dupCheck.empty) return;

      await db.runTransaction(async (t) => {
        const memberSnap = await t.get(memberRef);
        if (!memberSnap.exists) throw new Error('member_doc_missing');
        const data = memberSnap.data();
        const current = data.totalPoints || 0;
        if (current < amount) throw new Error('insufficient_server_balance');
        t.update(memberRef, {
          totalPoints: current - amount,
          updatedAt: Farm.fb.serverTimestamp(),
        });
        const newTxRef = txCol.doc();
        t.set(newTxRef, {
          memberId: uid,
          type: 'redeem',
          points: amount,
          source: 'game:farm',
          subSource: source || 'unknown',
          description: description || '游戏内消费',
          eventId,
          createdAt: Farm.fb.serverTimestamp(),
        });
      });

      // Update cached member doc + refresh topbar
      if (Farm.fbAuth.memberDoc) {
        Farm.fbAuth.memberDoc.totalPoints = Math.max(0, (Farm.fbAuth.memberDoc.totalPoints || 0) - amount);
        Farm.fbAuth._renderTopbar();
      }
    },

    async _writeEarnTransaction(uid, amount, source, description, eventId) {
      const db = Farm.fb.db;
      const memberRef = db.collection('members').doc(uid);
      const txCol = db.collection('points_transactions');

      // Dedupe: if a tx with this eventId already exists, do nothing
      const dupCheck = await txCol
        .where('memberId', '==', uid)
        .where('eventId', '==', eventId)
        .limit(1)
        .get();
      if (!dupCheck.empty) return;

      // Single Firestore transaction: update member + write tx
      await db.runTransaction(async (t) => {
        const memberSnap = await t.get(memberRef);
        if (!memberSnap.exists) {
          throw new Error('member_doc_missing');
        }
        const data = memberSnap.data();
        t.update(memberRef, {
          totalPoints: (data.totalPoints || 0) + amount,
          lifetimePoints: (data.lifetimePoints || 0) + amount,
          updatedAt: Farm.fb.serverTimestamp(),
        });
        const newTxRef = txCol.doc();
        t.set(newTxRef, {
          memberId: uid,
          type: 'earn',
          points: amount,
          source: 'game:farm',
          subSource: source || 'unknown',
          description: description || '',
          eventId,
          createdAt: Farm.fb.serverTimestamp(),
        });
      });

      // Update cached member doc with new total
      if (Farm.fbAuth.memberDoc) {
        Farm.fbAuth.memberDoc.totalPoints = (Farm.fbAuth.memberDoc.totalPoints || 0) + amount;
        Farm.fbAuth.memberDoc.lifetimePoints = (Farm.fbAuth.memberDoc.lifetimePoints || 0) + amount;
        Farm.fbAuth._renderTopbar();
      }
    },

    // Called by firebase-auth.js after a successful login. If the player has
    // unsynced local EP from playing as a guest, credit up to BACKFILL_CAP
    // to their member account (one-time per account).
    async firstLoginBackfill(user) {
      const data = Farm.state.data;
      if (data.backfillDone) return;             // already backfilled before
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
        // After backfill, memberDoc.totalPoints was bumped — re-sync local
        // state.eastPoints so HUD reflects the post-backfill total.
        if (Farm.fbAuth && Farm.fbAuth._syncLocalBalance) Farm.fbAuth._syncLocalBalance();
        Farm.ui.refreshHUD();
        const lang = data.language;
        setTimeout(() => {
          Farm.ui.toast(lang === 'en'
            ? `🎁 ${amount} EP backfilled to your member account`
            : `🎁 ${amount} 积分已回填到您的会员账户`, 4000);
        }, 800);
      }
      // If sync failed (queued), backfillDone stays false and will retry on
      // next login or queue flush.
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbPoints = points;
})();
