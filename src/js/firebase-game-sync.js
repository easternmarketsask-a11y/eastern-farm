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
    // earns +1 EP. Receiver gets an atomic counter increment + their
    // UID is added to the sender's `likedBy` array (so we can detect
    // mutual likes if they reciprocate later).
    async sendLike(toUid) {
      const lang = Farm.state.data.language || 'zh';
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
      // Mutual-like check: is recipient ALREADY in my likedBy list?
      // (Meaning: did they like ME at some point before now?) If yes,
      // this is a return-like — both get a bonus.
      let isMutual = false;
      try {
        const myUid = Farm.fbAuth && Farm.fbAuth.uid();
        if (myUid) {
          const me = await Farm.fb.db.collection('members').doc(myUid).get();
          const mine = (me.exists && me.data().gameStats) || {};
          if (Array.isArray(mine.likedBy) && mine.likedBy.includes(toUid)) {
            isMutual = true;
          }
        }
      } catch (_) {}

      // Recipient atomic updates: counter + likedBy arrayUnion
      if (Farm.fb && Farm.fb.available) {
        try {
          const myUid = Farm.fbAuth && Farm.fbAuth.uid();
          const payload = {
            gameStats: {
              likesReceived: Farm.fb.increment(1),
              likedBy: firebase.firestore.FieldValue.arrayUnion(myUid),
            },
          };
          await Farm.fb.db.collection('members').doc(toUid).set(payload, { merge: true });
        } catch (e) {
          console.warn('[gameSync] like update failed', e);
        }
      }
      // Sender bookkeeping
      claims.likesSentToday = givenToday.concat([toUid]);
      Farm.state.save();
      // Social rewards are farm coins (per owner): 超市积分 stays scarce.
      const baseBonus = 5;
      const mutualBonus = isMutual ? 15 : 0;
      Farm.state.addCoins(baseBonus + mutualBonus);
      return {
        ok: true,
        remaining: DAILY_LIKE_CAP - claims.likesSentToday.length,
        mutual: isMutual,
        coinsEarned: baseBonus + mutualBonus,
      };
    },

    // Check if receiver has new likes since last check. Returns
    // { newLikes, capped, epAwarded }. Called at boot when auth lands.
    // Awards up to DAILY_LIKE_CAP EP per day for received likes.
    async reconcileReceivedLikes() {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return null;
      const uid = Farm.fbAuth.uid();
      if (!uid) return null;
      try {
        const snap = await Farm.fb.db.collection('members').doc(uid).get();
        if (!snap.exists) return null;
        const stats = (snap.data().gameStats) || {};
        const cur = stats.likesReceived || 0;
        const last = Farm.state.data.lastLikesSeen || 0;
        const newLikes = Math.max(0, cur - last);
        if (newLikes === 0) {
          Farm.state.data.lastLikesSeen = cur;
          Farm.state.save();
          return { newLikes: 0, capped: 0, epAwarded: 0 };
        }
        // Daily cap on EP from received-likes (mirrors send cap)
        const today = Farm.state.getDateString();
        const lastAt = Farm.state.data.lastLikesSeenAt || 0;
        const lastDay = lastAt ? new Date(lastAt).toDateString() : '';
        const todayDay = new Date().toDateString();
        if (lastDay !== todayDay) {
          Farm.state.data.likesAckedToday = 0;
        }
        const headroom = Math.max(0, DAILY_LIKE_CAP - (Farm.state.data.likesAckedToday || 0));
        const epAward = Math.min(newLikes, headroom);
        const capped = newLikes - epAward;
        Farm.state.data.lastLikesSeen = cur;
        Farm.state.data.lastLikesSeenAt = Date.now();
        Farm.state.data.likesAckedToday = (Farm.state.data.likesAckedToday || 0) + epAward;
        Farm.state.save();
        const coinAward = epAward * 10;  // 10 farm coins per received like
        if (coinAward > 0) {
          Farm.state.addCoins(coinAward);
        }
        return { newLikes, capped, coinsAwarded: coinAward };
      } catch (e) {
        console.warn('[gameSync] reconcileReceivedLikes failed', e);
        return null;
      }
    },

    // Daily quota indicator helper
    likesRemaining() {
      const given = (Farm.state.data.dailyClaims.likesSentToday || []).length;
      return Math.max(0, DAILY_LIKE_CAP - given);
    },

    // Leaderboard by metric: 'level' | 'harvests' | 'deliveries'
    async fetchLeaderboard(metric, topN) {
      metric = metric || 'level';
      topN = topN || 10;
      if (!Farm.fb || !Farm.fb.available) return [];
      const fieldMap = {
        level: 'gameStats.level',
        harvests: 'gameStats.totalHarvests',
        deliveries: 'gameStats.totalDeliveries',
      };
      const field = fieldMap[metric] || fieldMap.level;
      try {
        const q = await Farm.fb.db.collection('members')
          .orderBy(field, 'desc')
          .limit(topN)
          .get();
        const list = [];
        q.forEach(d => {
          const data = d.data();
          const stats = data.gameStats || {};
          if (stats.visibleToNeighbors === false) return;
          if (!stats.level) return;
          const value = metric === 'level' ? (stats.level || 0)
                      : metric === 'harvests' ? (stats.totalHarvests || 0)
                      : (stats.totalDeliveries || 0);
          list.push({ uid: d.id, doc: data, level: stats.level || 1, value });
        });
        return list;
      } catch (e) {
        console.warn('[gameSync] fetchLeaderboard failed', e);
        return [];
      }
    },

    // Find self's rank by counting members with a higher metric value.
    // Returns { rank, total } or null if not logged in / not synced yet.
    // Note: this is an APPROXIMATION since we only count up to 100
    // members above us (Firestore can't do a true server-side rank).
    async fetchSelfRank(metric) {
      metric = metric || 'level';
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return null;
      const uid = Farm.fbAuth.uid();
      if (!uid) return null;
      const fieldMap = {
        level: 'gameStats.level',
        harvests: 'gameStats.totalHarvests',
        deliveries: 'gameStats.totalDeliveries',
      };
      const field = fieldMap[metric] || fieldMap.level;
      try {
        const myDoc = await Farm.fb.db.collection('members').doc(uid).get();
        const myStats = (myDoc.exists && myDoc.data().gameStats) || {};
        const myValue = metric === 'level' ? (myStats.level || 1)
                      : metric === 'harvests' ? (myStats.totalHarvests || 0)
                      : (myStats.totalDeliveries || 0);
        // Count members with HIGHER value (those ranked above me)
        const q = await Farm.fb.db.collection('members')
          .where(field, '>', myValue)
          .limit(100)
          .get();
        let above = 0;
        q.forEach(d => {
          const s = d.data().gameStats || {};
          if (s.visibleToNeighbors === false) return;
          above++;
        });
        return { rank: above + 1, myValue, capped: above >= 100 };
      } catch (e) {
        console.warn('[gameSync] fetchSelfRank failed', e);
        return null;
      }
    },

    // ============ Friends (Phase 3) ============
    // Phone-based friend lookup. Returns { found, member } where member
    // is { uid, doc } if exists + visible, else null. Doesn't add the
    // friend — caller handles that to keep this fn pure.
    async findMemberByPhone(phoneE164) {
      if (!Farm.fb || !Farm.fb.available) return { found: false };
      try {
        const snap = await Farm.fb.db.collection('members')
          .where('phone', '==', phoneE164).limit(1).get();
        if (snap.empty) return { found: false, reason: 'not_member' };
        const doc = snap.docs[0];
        const data = doc.data();
        const stats = data.gameStats || {};
        // Block adding members who opted out of visibility
        if (stats.visibleToNeighbors === false) {
          return { found: false, reason: 'hidden' };
        }
        // Block adding members who haven't started the game yet
        if (!stats.level) return { found: false, reason: 'not_playing' };
        // Block adding yourself
        const myUid = Farm.fbAuth && Farm.fbAuth.uid();
        if (doc.id === myUid) return { found: false, reason: 'self' };
        return { found: true, member: { uid: doc.id, doc: data } };
      } catch (e) {
        console.warn('[gameSync] findMemberByPhone failed', e);
        return { found: false, reason: 'error' };
      }
    },

    // Add a UID to local friends array + sync to Firestore. One-sided
    // follow (no mutual request needed — these are real-life friends).
    async addFriend(uid) {
      const list = Farm.state.data.friends || [];
      if (list.includes(uid)) return { ok: false, reason: 'already_friend' };
      list.push(uid);
      Farm.state.data.friends = list;
      Farm.state.save();
      // Also write to server (in case the user wants to access from another device)
      try {
        const myUid = Farm.fbAuth && Farm.fbAuth.uid();
        if (myUid) {
          await Farm.fb.db.collection('members').doc(myUid).set(
            { gameStats: { friends: firebase.firestore.FieldValue.arrayUnion(uid) } },
            { merge: true }
          );
        }
      } catch (_) {}
      return { ok: true, count: list.length };
    },

    async removeFriend(uid) {
      const list = (Farm.state.data.friends || []).filter(x => x !== uid);
      Farm.state.data.friends = list;
      Farm.state.save();
      try {
        const myUid = Farm.fbAuth && Farm.fbAuth.uid();
        if (myUid) {
          await Farm.fb.db.collection('members').doc(myUid).set(
            { gameStats: { friends: firebase.firestore.FieldValue.arrayRemove(uid) } },
            { merge: true }
          );
        }
      } catch (_) {}
      return { ok: true, count: list.length };
    },

    // Fetch full docs for all friend UIDs. Limited to 30 to avoid
    // hammering Firestore — players unlikely to have 30+ real friends.
    async fetchFriendDocs() {
      const uids = Farm.state.data.friends || [];
      if (uids.length === 0 || !Farm.fb || !Farm.fb.available) return [];
      const out = [];
      for (const uid of uids.slice(0, 30)) {
        try {
          const snap = await Farm.fb.db.collection('members').doc(uid).get();
          if (snap.exists) out.push({ uid, doc: snap.data() });
        } catch (_) {}
      }
      return out;
    },

    // ============ Gifts (Phase 3) ============
    // Send a gift to a friend. kind: 'seed' | 'ep'. Daily cap = 1
    // gift sent per day. Recipient gets it in their pendingGifts
    // inbox on the server, reconciled on their next session.
    async sendGift(toUid, kind, options) {
      options = options || {};
      const lang = Farm.state.data.language || 'zh';
      const today = Farm.state.getDateString();
      const lastSent = Farm.state.data.lastGiftSentDate || '';
      if (lastSent === today) {
        return { ok: false, reason: 'daily_cap', message: lang === 'en'
          ? 'You already sent a gift today. Try again tomorrow!'
          : '今天的免费礼物已送，明天再来吧！' };
      }
      const myUid = Farm.fbAuth && Farm.fbAuth.uid();
      if (!myUid) return { ok: false, reason: 'not_logged_in' };
      const fromName = (Farm.fbAuth.memberDoc &&
        (Farm.fbAuth.memberDoc.gameStats && Farm.fbAuth.memberDoc.gameStats.nickname
          || Farm.fbAuth.memberDoc.name)) || '匿名邻居';
      const giftId = myUid + '_' + Date.now();
      // Build payload by kind
      let payload;
      if (kind === 'seed') {
        // Pick a random Lv 1-3 seed (everyone has those unlocked)
        const easy = (Farm.crops && Farm.crops.all() || [])
          .filter(c => c.unlock_level <= 3);
        if (easy.length === 0) return { ok: false, reason: 'no_seeds' };
        const c = easy[Math.floor(Math.random() * easy.length)];
        payload = { cropId: c.id };
      } else if (kind === 'coins') {
        payload = { amount: 50 };
      } else {
        return { ok: false, reason: 'unknown_kind' };
      }
      // Atomic write to recipient's pendingGifts array
      try {
        const gift = {
          id: giftId, fromUid: myUid, fromName, kind, payload,
          sentAt: Date.now(),
        };
        await Farm.fb.db.collection('members').doc(toUid).set(
          { gameStats: { pendingGifts: firebase.firestore.FieldValue.arrayUnion(gift) } },
          { merge: true }
        );
      } catch (e) {
        console.warn('[gameSync] sendGift write failed', e);
        return { ok: false, reason: 'write_failed' };
      }
      // Mark sent locally
      Farm.state.data.lastGiftSentDate = today;
      Farm.state.save();
      return { ok: true, kind, payload };
    },

    // Reconcile inbox: claim any pendingGifts on the server, apply to
    // local state, clear the server-side queue. Called at boot after
    // auth lands. Returns array of claimed gifts for UI feedback.
    async reconcileGifts() {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return [];
      const uid = Farm.fbAuth.uid();
      if (!uid) return [];
      try {
        const snap = await Farm.fb.db.collection('members').doc(uid).get();
        if (!snap.exists) return [];
        const stats = (snap.data().gameStats) || {};
        const gifts = stats.pendingGifts || [];
        if (gifts.length === 0) return [];
        // Apply each gift to local state
        for (const g of gifts) {
          if (g.kind === 'seed' && g.payload && g.payload.cropId) {
            Farm.state.addSeed(g.payload.cropId, 1);
          } else if ((g.kind === 'coins' || g.kind === 'ep') && g.payload && g.payload.amount) {
            // 'ep' kept for any legacy pending gifts; both credited as coins now.
            Farm.state.addCoins(g.payload.amount);
          }
        }
        // Clear server-side queue
        await Farm.fb.db.collection('members').doc(uid).set(
          { gameStats: { pendingGifts: [] } },
          { merge: true }
        );
        return gifts;
      } catch (e) {
        console.warn('[gameSync] reconcileGifts failed', e);
        return [];
      }
    },

    // Check if user can send a gift today (1 per day cap)
    canSendGiftToday() {
      const today = Farm.state.getDateString();
      return Farm.state.data.lastGiftSentDate !== today;
    },

    // Online indicator helper — returns label/color tier from lastSeenAt
    onlineStatus(doc) {
      const stats = (doc && doc.gameStats) || {};
      const last = stats.lastSeenAt;
      if (!last) return null;
      // Firestore Timestamp has .toMillis(); fallback to Date()
      const ms = typeof last.toMillis === 'function' ? last.toMillis() : new Date(last).getTime();
      const diff = Date.now() - ms;
      if (diff < 5 * 60 * 1000) return { tier: 'online', label: '在线', labelEn: 'Online' };
      if (diff < 30 * 60 * 1000) return { tier: 'recent', label: '刚刚', labelEn: 'Recent' };
      if (diff < 24 * 60 * 60 * 1000) return { tier: 'today', label: '今天活跃', labelEn: 'Today' };
      return null;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbGameSync = gameSync;
})();
