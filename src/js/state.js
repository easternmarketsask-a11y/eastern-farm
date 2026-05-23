/**
 * state.js — Game state + localStorage persistence.
 *
 * Save key: eastern_farm_save_v1
 * Always version the save format. Migrate old versions explicitly.
 */
(function() {
  const SAVE_KEY = 'eastern_farm_save_v1';
  const STARTER_STATE = {
    version: 1,
    coins: 100,
    eastPoints: 0,
    level: 1,
    xp: 0,
    plots: [
      // 12 plots; first 4 unlocked initially. unlock_level driven by index.
      ...[0,1,2,3].map(i => ({ id: i, crop: null, plantedAt: 0, harvestsLeft: 0, unlocked: true })),
      ...[4,5,6,7,8,9,10,11].map(i => ({ id: i, crop: null, plantedAt: 0, harvestsLeft: 0, unlocked: false })),
    ],
    seeds: { qingcai: 3 },  // starter seeds
    cropsEverGrown: [],     // for "try new crop" achievements
    lastLogin: 0,
    loginStreak: 0,
    language: 'zh',
    sessionStats: {
      // Resets daily; used for task tracking
      date: '',  // YYYY-MM-DD
      planted: {},     // {cropId: count}
      harvested: {},   // {cropId: count}
      coinsEarned: 0,
      seedsBought: 0,
      coinsSpent: 0,
    },
    weekStats: {
      weekStart: '',
      harvested: 0,
      variety: [],
      coinsSpent: 0,
    },
    dailyTasks: [],  // [{id, type, target, progress, claimed}, ...]
    weeklyTask: null,
    completedAchievements: [],
    redeemedCoupons: [],   // list of code strings already used by this player
    // Lifetime counters (achievements consume these — never reset by daily rollover)
    totalHarvests: 0,
    totalTasksClaimed: 0,
    totalCouponsRedeemed: 0,
    maxStreak: 0,
    festivalHarvests: { spring_festival: 0, mid_autumn: 0 },
    // Audio preference
    audioMuted: false,

    // ============ Eastern Points cap + exchange (v2 currency design) ============
    // Daily EP credit cap (anti-abuse). 1000 EP/day = $1/day per user.
    epDailyCap: 1000,
    epEarnedToday: 0,
    epEarnedDate: '',           // YYYY-MM-DD; reset counter when date rolls
    pendingEp: 0,               // EP earned but blocked by cap, credited next day

    // ============ EP shop + daily features ============
    decorations: [],            // [{itemId, x, y}] cosmetic placements
    extraPlots: 0,              // additional plots unlocked beyond the base 12 (max 4)
    ownedShopItems: {},         // {itemId: count} consumables remaining (acceleration tickets etc.)
    theme: 'default',           // 'default' | 'spring' | 'summer' | 'autumn' | 'winter' | 'festival'
    dailyClaims: {              // resets when date changes
      date: '',
      lotterySpunFree: false,   // free daily spin used?
      neighborsVisited: [],     // neighbor IDs visited today
      newsRead: false,
      firstHarvestDone: false,  // first harvest of day bonus claimed?
    },
    activeEffects: {            // toggleable consumable effects
      accelerationCharges: 0,   // # of 加速券 in inventory (consumed on use)
      freshnessCharges: 0,      // # of 保鲜券 in inventory
    },

    // ============ Member sync (v1.2) ============
    // unsyncedEp accumulates EP earned while NOT logged into a member account.
    // On first successful login, up to BACKFILL_CAP gets one-shot credited to
    // the real member balance; remainder discarded (per anti-abuse policy).
    unsyncedEp: 0,
    backfillDone: false,
  };

  function getDateString(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  const state = {
    data: null,

    init() {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Object.assign auto-fills any new STARTER fields missing from old saves.
          this.data = Object.assign({}, STARTER_STATE, parsed);
          // Deep-fill nested objects added in later versions
          this.data.dailyClaims = Object.assign({}, STARTER_STATE.dailyClaims, this.data.dailyClaims || {});
          this.data.activeEffects = Object.assign({}, STARTER_STATE.activeEffects, this.data.activeEffects || {});
          this.data.ownedShopItems = this.data.ownedShopItems || {};
          this.data.decorations = this.data.decorations || [];
          // Reset session stats daily
          const today = getDateString();
          if (this.data.sessionStats.date !== today) {
            this.data.sessionStats = {
              date: today,
              planted: {}, harvested: {},
              coinsEarned: 0, seedsBought: 0, coinsSpent: 0,
            };
          }
          // Roll daily EP cap counter + drain queued EP first thing on a new day
          if (this.data.epEarnedDate !== today) {
            this.data.epEarnedDate = today;
            this.data.epEarnedToday = 0;
            // Drain pending queue into today's balance, respecting the cap
            if (this.data.pendingEp > 0) {
              const drainAmount = Math.min(this.data.pendingEp, this.data.epDailyCap);
              this.data.eastPoints += drainAmount;
              this.data.pendingEp -= drainAmount;
              this.data.epEarnedToday += drainAmount;
            }
          }
          // Reset daily claims
          if (this.data.dailyClaims.date !== today) {
            this.data.dailyClaims = {
              date: today,
              lotterySpunFree: false,
              neighborsVisited: [],
              newsRead: false,
              firstHarvestDone: false,
            };
          }
        } catch (e) {
          console.error('Save corrupted, starting fresh', e);
          this.data = JSON.parse(JSON.stringify(STARTER_STATE));
          this.data.sessionStats.date = getDateString();
          this.data.epEarnedDate = getDateString();
          this.data.dailyClaims.date = getDateString();
        }
      } else {
        this.data = JSON.parse(JSON.stringify(STARTER_STATE));
        this.data.sessionStats.date = getDateString();
        this.data.epEarnedDate = getDateString();
        this.data.dailyClaims.date = getDateString();
      }
    },

    save() {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.error('Save failed', e);
      }
    },

    reset() {
      this.data = JSON.parse(JSON.stringify(STARTER_STATE));
      this.data.sessionStats.date = getDateString();
      this.save();
    },

    // ============ Mutators (all auto-save) ============
    addCoins(n) {
      this.data.coins += n;
      if (n > 0) this.data.sessionStats.coinsEarned += n;
      this.save();
    },
    spendCoins(n) {
      if (this.data.coins < n) return false;
      this.data.coins -= n;
      this.data.sessionStats.coinsSpent += n;
      this.save();
      return true;
    },
    // Add EP respecting daily cap. Overflow above the cap goes into pendingEp
    // queue, which gets drained next day in init(). Returns { credited, queued }.
    //
    // When the player is logged into a member account, credited EP is also
    // pushed to Firestore (members/{uid}.totalPoints + points_transactions/)
    // via Farm.fbPoints.syncEpEarn(). When NOT logged in, credited EP stays
    // local in `eastPoints` AND mirrors into `unsyncedEp` so the first-login
    // backfill knows how much to credit.
    //
    // `opts.source` and `opts.description` are passed through for audit.
    addEastPoints(n, opts) {
      opts = opts || {};
      if (n <= 0) { this.save(); return { credited: 0, queued: 0 }; }
      // Make sure the daily counter is for today
      const today = getDateString();
      if (this.data.epEarnedDate !== today) {
        this.data.epEarnedDate = today;
        this.data.epEarnedToday = 0;
      }
      const headroom = Math.max(0, (this.data.epDailyCap || 1000) - (this.data.epEarnedToday || 0));
      const credited = Math.min(n, headroom);
      const queued = n - credited;
      if (credited > 0) {
        this.data.eastPoints += credited;
        this.data.epEarnedToday += credited;
        // Track unsynced-while-guest so first login can backfill
        if (!(window.Farm && Farm.fbAuth && Farm.fbAuth.isLoggedIn())) {
          this.data.unsyncedEp = (this.data.unsyncedEp || 0) + credited;
        }
      }
      if (queued > 0) {
        this.data.pendingEp = (this.data.pendingEp || 0) + queued;
      }
      this.save();
      // Fire member-account sync (no-op if logged out — Farm.fbPoints handles that)
      if (credited > 0 && window.Farm && Farm.fbPoints) {
        Farm.fbPoints.syncEpEarn(credited, opts.source || 'unknown', opts.description || '');
      }
      return { credited, queued };
    },
    spendEastPoints(n) {
      if (this.data.eastPoints < n) return false;
      this.data.eastPoints -= n;
      this.save();
      return true;
    },

    // Bidirectional 10:1 exchange.
    // exchangeCoinsToEp(coinAmt): 10 coins → 1 EP; respects daily cap (overflow queues)
    // exchangeEpToCoins(epAmt):    1 EP → 10 coins; no cap (player spending their own)
    exchangeCoinsToEp(coinAmt) {
      coinAmt = Math.floor(coinAmt / 10) * 10;  // round to multiple of 10
      if (coinAmt <= 0) return { ok: false, reason: 'too_small' };
      if (this.data.coins < coinAmt) return { ok: false, reason: 'insufficient_coins' };
      this.data.coins -= coinAmt;
      const epAmount = coinAmt / 10;
      const result = this.addEastPoints(epAmount);
      this.save();
      return { ok: true, coinsSpent: coinAmt, epGained: epAmount, ...result };
    },
    exchangeEpToCoins(epAmt) {
      epAmt = Math.floor(epAmt);
      if (epAmt <= 0) return { ok: false, reason: 'too_small' };
      if (this.data.eastPoints < epAmt) return { ok: false, reason: 'insufficient_ep' };
      this.data.eastPoints -= epAmt;
      const coinAmount = epAmt * 10;
      this.data.coins += coinAmount;
      this.save();
      return { ok: true, epSpent: epAmt, coinsGained: coinAmount };
    },

    // ============ Shop / decorations / consumables ============
    addShopItem(itemId, qty) {
      qty = qty || 1;
      this.data.ownedShopItems[itemId] = (this.data.ownedShopItems[itemId] || 0) + qty;
      this.save();
    },
    consumeShopItem(itemId) {
      const have = this.data.ownedShopItems[itemId] || 0;
      if (have <= 0) return false;
      this.data.ownedShopItems[itemId] = have - 1;
      this.save();
      return true;
    },
    addDecoration(itemId) {
      this.data.decorations.push({ itemId, placedAt: Date.now() });
      this.save();
    },
    addExtraPlot() {
      if (this.data.extraPlots >= 4) return false;
      this.data.extraPlots += 1;
      // Append a new unlocked plot to the plots array
      const newId = 12 + this.data.extraPlots - 1;
      this.data.plots.push({ id: newId, crop: null, plantedAt: 0, harvestsLeft: 0, unlocked: true });
      this.save();
      return true;
    },
    setTheme(themeId) {
      this.data.theme = themeId;
      this.save();
    },

    // ============ Daily claim helpers ============
    claimDailyNews() {
      if (this.data.dailyClaims.newsRead) return false;
      this.data.dailyClaims.newsRead = true;
      this.save();
      return true;
    },
    claimNeighborVisit(neighborId) {
      const list = this.data.dailyClaims.neighborsVisited;
      if (list.includes(neighborId)) return false;
      list.push(neighborId);
      this.save();
      return true;
    },
    consumeFreeSpin() {
      if (this.data.dailyClaims.lotterySpunFree) return false;
      this.data.dailyClaims.lotterySpunFree = true;
      this.save();
      return true;
    },
    markFirstHarvest() {
      if (this.data.dailyClaims.firstHarvestDone) return false;
      this.data.dailyClaims.firstHarvestDone = true;
      this.save();
      return true;
    },
    addXp(n) {
      this.data.xp += n;
      this.save();
      return this.checkLevelUp();
    },
    checkLevelUp() {
      const thresholds = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 6500, 9000];
      const newLevel = thresholds.findIndex((t, i) => this.data.xp < (thresholds[i+1] ?? Infinity) && this.data.xp >= t) + 1;
      if (newLevel > this.data.level) {
        const oldLevel = this.data.level;
        this.data.level = newLevel;
        // Unlock new plots
        this.unlockPlotsForLevel(newLevel);
        this.save();
        return { leveledUp: true, oldLevel, newLevel };
      }
      return { leveledUp: false };
    },
    unlockPlotsForLevel(level) {
      // Levels 2,3,4,5 each unlock 2 plots
      const plotsToUnlock = {
        2: [4, 5],
        3: [6, 7],
        4: [8, 9],
        5: [10, 11],
      };
      const newPlots = plotsToUnlock[level];
      if (newPlots) {
        newPlots.forEach(pid => {
          if (this.data.plots[pid]) this.data.plots[pid].unlocked = true;
        });
      }
    },

    addSeed(cropId, n) {
      this.data.seeds[cropId] = (this.data.seeds[cropId] || 0) + n;
      if (n > 0 && this.data.sessionStats) {
        this.data.sessionStats.seedsBought = (this.data.sessionStats.seedsBought || 0) + n;
      }
      this.save();
    },
    useSeed(cropId) {
      if ((this.data.seeds[cropId] || 0) <= 0) return false;
      this.data.seeds[cropId]--;
      this.save();
      return true;
    },

    recordPlant(cropId) {
      const s = this.data.sessionStats;
      s.planted[cropId] = (s.planted[cropId] || 0) + 1;
      if (!this.data.cropsEverGrown.includes(cropId)) {
        this.data.cropsEverGrown.push(cropId);
      }
      this.save();
    },
    recordHarvest(cropId, festivalId) {
      const s = this.data.sessionStats;
      s.harvested[cropId] = (s.harvested[cropId] || 0) + 1;
      this.data.totalHarvests = (this.data.totalHarvests || 0) + 1;
      if (festivalId) {
        this.data.festivalHarvests = this.data.festivalHarvests || {};
        this.data.festivalHarvests[festivalId] = (this.data.festivalHarvests[festivalId] || 0) + 1;
      }
      this.save();
    },
    recordTaskClaim() {
      this.data.totalTasksClaimed = (this.data.totalTasksClaimed || 0) + 1;
      this.save();
    },
    recordCouponRedeem() {
      this.data.totalCouponsRedeemed = (this.data.totalCouponsRedeemed || 0) + 1;
      this.save();
    },
    recordStreak(streak) {
      if (streak > (this.data.maxStreak || 0)) {
        this.data.maxStreak = streak;
        this.save();
      }
    },

    getDateString,
  };

  window.Farm = window.Farm || {};
  window.Farm.state = state;
})();
