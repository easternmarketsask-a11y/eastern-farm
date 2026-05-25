/**
 * firebase-game-sync.js — Sync game stats to Firestore + query other
 * members for the neighbor / leaderboard system.
 *
 * Architecture:
 *   members/{uid}.gameStats = {
 *     level: number,
 *     totalHarvests: number,
 *     totalDeliveries: number,
 *     nickname: string | null,   // user-set; null → derive "{firstChar}邻居"
 *     visibleToNeighbors: bool,  // default true (set via settings)
 *     likesReceived: number,     // atomic counter, only ever incremented
 *     lastSeenAt: serverTimestamp,
 *   }
 *
 * Sync trigger: pushStatsDebounced() called by state.save(). Pushes at
 * most once every 60s OR when triggered by an explicit event (level up,
 * delivery completion). When offline / not logged in: no-op silently.
 */
(function () {
  const SYNC_MIN_INTERVAL_MS = 60 * 1000;
  const PRIVACY_DEFAULT_VISIBLE = true;
  const DAILY_LIKE_CAP = 5;
  let _lastSyncAt = 0;
  let _pendingTimer = null;

  const gameSync = {
    // Compute the gameStats payload from local state. Pure function.
    _buildPayload() {
      const s = Farm.state.data;
      return {
        level: s.level || 1,
        totalHarvests: s.totalHarvests || 0,
        totalDeliveries: s.totalDeliveries || 0,
        nickname: s.nickname || null,
        visibleToNeighbors: s.visibleToNeighbors == null
          ? PRIVACY_DEFAULT_VISIBLE
          : !!s.visibleToNeighbors,
        lastSeenAt: Farm.fb && Farm.fb.serverTimestamp
          ? Farm.fb.serverTimestamp()
          : new Date(),
      };
    },

    // Immediate push — used at boot or on explicit triggers.
    async push() {
      if (!Farm.fb || !Farm.fb.available) return { ok: false, reason: 'offline' };
      if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return { ok: false, reason: 'not_logged_in' };
      const uid = Farm.fbAuth.uid();
      if (!uid) return { ok: false, reason: 'no_uid' };
      try {
        const payload = this._buildPayload();
        // Merge so we never overwrite likesReceived (counter only) or other
        // server-managed fields.
        await Farm.fb.db.collection('members').doc(uid).set(
          { gameStats: payload },
          { merge: true }
        );
        _lastSyncAt = Date.now();
        return { ok: true };
      } catch (e) {
        console.warn('[gameSync] push failed', e);
        return { ok: false, reason: e.message };
      }
    },

    // Debounced — called frequently from state.save(). Skips if recently
    // synced. Schedules a delayed push if within the cooldown window.
    pushStatsDebounced() {
      const now = Date.now();
      const since = now - _lastSyncAt;
      if (since >= SYNC_MIN_INTERVAL_MS) {
        this.push();
        return;
      }
      // Schedule a flush at the end of the cooldown if not already pending
      if (_pendingTimer) return;
      _pendingTimer = setTimeout(() => {
        _pendingTimer = null;
        this.push();
      }, SYNC_MIN_INTERVAL_MS - since);
    },

    // Compute the public display name for a member doc.
    displayName(doc) {
      if (!doc) return '匿名邻居';
      const stats = doc.gameStats || {};
      if (stats.nickname) return stats.nickname;
      // Derive from real name first character, fallback to "邻居"
      const realName = doc.name || doc.firstName || '';
      const firstChar = (realName + '').trim().charAt(0);
      return firstChar ? firstChar + '邻居' : '萨城邻居';
    },

    // Query a pool of visible members. We pick 3 of these deterministically
    // per day for the neighbor panel.
    async fetchVisiblePool(limit = 30) {
      if (!Farm.fb || !Farm.fb.available) return [];
      try {
        const meUid = Farm.fbAuth && Farm.fbAuth.uid();
        // Note: Firestore can't query for "field exists" + "field is true"
        // in one query without composite index, so we filter visibility
        // client-side. Order by lastSeenAt to surface recently-active players.
        const q = await Farm.fb.db.collection('members')
          .orderBy('gameStats.lastSeenAt', 'desc')
          .limit(limit)
          .get();
        const pool = [];
        q.forEach(d => {
          const data = d.data();
          const stats = data.gameStats || {};
          // Exclude self + opted-out + members who never played
          if (d.id === meUid) return;
          if (stats.visibleToNeighbors === false) return;
          if (!stats.level) return;
          pool.push({ uid: d.id, doc: data });
        });
        return pool;
      } catch (e) {
        console.warn('[gameSync] fetchVisiblePool failed', e);
        return [];
      }
    },

    // Pick today's 3 neighbors deterministically from the pool.
    pickDailyThree(pool) {
      if (pool.length === 0) return [];
      const today = Farm.state.getDateString();
      // Hash the date → seed RNG → shuffle pool → take first 3
      let h = 2166136261;
      for (let i = 0; i < today.length; i++) {
        h ^= today.charCodeAt(i);
        h = (h * 16777619) >>> 0;
      }
      const rng = () => {
        h |= 0; h = h + 0x6D2B79F5 | 0;
        let t = h;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
      const picked = [];
      const indices = new Set();
      // If pool is smaller than 3, return all.
      const n = Math.min(3, pool.length);
      while (indices.size < n) {
        indices.add(Math.floor(rng() * pool.length));
      }
      indices.forEach(idx => picked.push(pool[idx]));
      return picked;
    },

    // Send a like. Caps at DAILY_LIKE_CAP per sender per day. Sender
    // earns +1 EP via Farm.state.addEastPoints. Receiver gets an atomic
    // counter increment (no EP credit — that would require StockWise
    // sync per recipient which is overkill for V1).
    async sendLike(toUid) {
      const lang = Farm.state.data.language || 'zh';
      // Sender daily cap
      const claims = Farm.state.data.dailyClaims;
      const givenToday = claims.likesSentToday || [];
      if (givenToday.length >= DAILY_LIKE_CAP) {
        return { ok: false, reason: 'cap_reached', message: lang === 'en'
          ? 'Daily 5-like cap reached, come back tomorrow!'
          : '今天 5 个赞都送完啦，明天再来吧！' };
      }
      if (givenToday.includes(toUid)) {
        return { ok: false, reason: 'already_liked', message: lang === 'en'
          ? 'You already liked this neighbor today.'
          : '今天给这位邻居点过赞了。' };
      }
      // Atomic counter increment on receiver
      if (Farm.fb && Farm.fb.available && Farm.fb.increment) {
        try {
          await Farm.fb.db.collection('members').doc(toUid).set(
            { gameStats: { likesReceived: Farm.fb.increment(1) } },
            { merge: true }
          );
        } catch (e) {
          console.warn('[gameSync] like increment failed', e);
          // We still grant the sender's EP — the offline like is "spent"
        }
      }
      // Sender gets +1 EP + log locally
      claims.likesSentToday = givenToday.concat([toUid]);
      Farm.state.save();
      Farm.state.addEastPoints(1, {
        source: 'neighbor_like_sent',
        description: 'Liked a neighbor',
      });
      return { ok: true, remaining: DAILY_LIKE_CAP - claims.likesSentToday.length };
    },

    // Daily quota indicator helper
    likesRemaining() {
      const given = (Farm.state.data.dailyClaims.likesSentToday || []).length;
      return Math.max(0, DAILY_LIKE_CAP - given);
    },

    // Weekly leaderboard (V1: by level only, top 10)
    async fetchLeaderboard(topN = 10) {
      if (!Farm.fb || !Farm.fb.available) return [];
      try {
        const q = await Farm.fb.db.collection('members')
          .orderBy('gameStats.level', 'desc')
          .limit(topN)
          .get();
        const list = [];
        q.forEach(d => {
          const data = d.data();
          const stats = data.gameStats || {};
          if (stats.visibleToNeighbors === false) return;
          if (!stats.level) return;
          list.push({ uid: d.id, doc: data, level: stats.level });
        });
        return list;
      } catch (e) {
        console.warn('[gameSync] fetchLeaderboard failed', e);
        return [];
      }
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbGameSync = gameSync;
})();
