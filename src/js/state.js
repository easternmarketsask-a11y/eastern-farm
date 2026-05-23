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
          // Future: migrate by version here.
          this.data = Object.assign({}, STARTER_STATE, parsed);
          // Ensure sessionStats today is fresh
          const today = getDateString();
          if (this.data.sessionStats.date !== today) {
            this.data.sessionStats = {
              date: today,
              planted: {}, harvested: {},
              coinsEarned: 0, seedsBought: 0, coinsSpent: 0,
            };
          }
        } catch (e) {
          console.error('Save corrupted, starting fresh', e);
          this.data = JSON.parse(JSON.stringify(STARTER_STATE));
          this.data.sessionStats.date = getDateString();
        }
      } else {
        this.data = JSON.parse(JSON.stringify(STARTER_STATE));
        this.data.sessionStats.date = getDateString();
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
    addEastPoints(n) {
      this.data.eastPoints += n;
      this.save();
    },
    spendEastPoints(n) {
      if (this.data.eastPoints < n) return false;
      this.data.eastPoints -= n;
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
