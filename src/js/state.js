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
    seeds: { shanghai_miao: 3, xiao_cong: 2, cilantro: 2 },  // 3 starter crops for Lv 1 variety
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
      firstDeliveryDone: false, // first warehouse→market delivery of day (+20%)
      likesSentToday: [],       // recipient UIDs liked today (cap 5)
    },
    activeEffects: {            // toggleable consumable effects
      accelerationCharges: 0,   // # of 加速券 in inventory (consumed on use)
      freshnessCharges: 0,      // # of 保鲜券 in inventory
    },

    // ============ 7-day sign-in calendar (login-calendar.js) ============
    // Replaces the old flat daily-login coin/EP reward with an escalating
    // 7-day cycle. dayIndex = 0 means "not yet signed today" (next sign-in
    // claims day 1). A gap of ≥1 missed day resets the cycle to day 1.
    loginCalendar: {
      cycleStartDate: '',   // YYYY-MM-DD when the current 7-day cycle began
      lastSignDate: '',     // YYYY-MM-DD of the last successful sign-in
      dayIndex: 0,          // 0-7; how many days of THIS cycle have been claimed
    },

    // ============ Warehouse (V2 — 2026-05-24) ============
    // Harvested crops go HERE instead of converting to coins. Player must
    // explicitly deliver to Eastern Market to earn coins (mirrors the
    // real-life supplier→supermarket flow). No spoilage — Eastern Market
    // only buys quality produce, so we can't have wilted veg in the model.
    // Capacity-limited (forces selling). First delivery of the day gets
    // +20% bonus as a soft "play often" incentive.
    warehouse: [],              // Array of { cropId, addedAt } items
    warehouseCapacity: 20,      // Soft cap; harvest blocked when full
    totalDeliveries: 0,         // Lifetime count of warehouse→Eastern Market deliveries

    // ============ Neighbor system (Phase 1 — 2026-05-24) ============
    nickname: null,             // user-set in settings (else derived "{firstChar}邻居")
    visibleToNeighbors: true,   // privacy toggle (settings)
    lastLikesSeen: 0,           // count of likes the user has already acknowledged
    lastLikesSeenAt: 0,         // epoch ms, used for daily caps
    likesAckedToday: 0,         // EP bonus claimed today from likes-received (cap 5)

    // ============ Display preferences (settings) ============
    decorationsHidden: false,   // hide pets/balloons/static decor from farm view

    // ============ Friends + gifts (Phase 3 — 2026-05-25) ============
    friends: [],                // array of friend UIDs (members the user added)
    lastGiftSentDate: '',       // YYYY-MM-DD; daily cap = 1 gift sent per day
    pendingGifts: [],           // [{fromUid, fromName, kind, payload, sentAt, id}] inbox

    // ============ Member sync (v1.2) ============
    // unsyncedEp accumulates EP earned while NOT logged into a member account.
    // On first successful login, up to BACKFILL_CAP gets one-shot credited to
    // the real member balance; remainder discarded (per anti-abuse policy).
    unsyncedEp: 0,
    backfillDone: false,

    // ============ First-time experience (2026-05-29) ============
    // Gates the one-time welcome overlay (3-step "tap soil → plant → sell
    // to Eastern Market"). Set true on first dismissal so returning players
    // never see it again, even if they reset their farm. The cropsEverGrown
    // === 0 check stays as a secondary guard.
    tutorialV1Done: false,
    // First-plant / first-harvest celebration flags. Persist across sessions
    // so the bonus + confetti only fires once per save.
    firstPlantCelebrated: false,
    firstHarvestCelebrated: false,
  };

  function getDateString(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  // ============ Level progression (open-ended) ============
  // Early-game XP curve rebalanced (2026-05-24): old curve was 50/150/350/...
  // which required ~25 bok choy harvests to reach Lv 2 (2+ hours of grind for
  // a single new crop unlock). New curve targets ~5 harvests per level for
  // Lv 1-5, then ramps up. Goal: player sees 5+ crops unlock in first 30 min.
  const XP_TABLE_FIXED = [0, 10, 30, 80, 180, 350, 600, 1000, 1600, 2500, 4000];
  function xpForLevel(level) {
    if (level <= 0) return 0;
    if (level <= XP_TABLE_FIXED.length) return XP_TABLE_FIXED[level - 1];
    const k = level - XP_TABLE_FIXED.length;
    // Each level past 11 needs ~3,500 base, growing quadratically with `k`.
    return Math.round(9000 + 3500 * k * (1 + k * 0.15));
  }

  // Levels that grant a new plot. Through Lv 5 every level gives +2 (matches
  // the original 4→12 ramp). After Lv 5 plots come less often, but never
  // stop, so there's always a long-term carrot.
  const PLOT_UNLOCK_AT = {
    2: 2, 3: 2, 4: 2, 5: 2,                          // 12 plots total by Lv 5 (unchanged)
    7: 1, 10: 1, 15: 1, 20: 1,                       // → 16 plots by Lv 20
    30: 1, 50: 1, 75: 1, 100: 1,                     // → 20 plots by Lv 100
    150: 1, 200: 1, 300: 1, 500: 1,                  // → 24 plots by Lv 500
  };

  // Title tiers — purely cosmetic. Rewritten 2026-05-25: previous
  // titles (新手/小工/学徒/农夫) sounded like a hierarchy of menial
  // labor. Farming is aspirational, not entry-level grunt work.
  // Every tier is now a positive, evocative pastoral name.
  const LEVEL_TITLES = [
    { min: 1,   zh: '嫩芽',       en: 'Sprouting Soul' },
    { min: 3,   zh: '田园新友',   en: 'Garden Friend' },
    { min: 5,   zh: '园丁',       en: 'Gardener' },
    { min: 10,  zh: '农艺人',     en: 'Farm Artisan' },
    { min: 15,  zh: '收获家',     en: 'Harvest Bringer' },
    { min: 20,  zh: '田园诗人',   en: 'Pastoral Poet' },
    { min: 25,  zh: '庄园主',     en: 'Estate Owner' },
    { min: 30,  zh: '农艺大师',   en: 'Master Gardener' },
    { min: 40,  zh: '大地之友',   en: 'Friend of the Earth' },
    { min: 50,  zh: '丰收使者',   en: 'Harvest Envoy' },
    { min: 75,  zh: '田园智者',   en: 'Pastoral Sage' },
    { min: 100, zh: '自然之灵',   en: 'Spirit of Nature' },
    { min: 150, zh: '田园传奇',   en: 'Pastoral Legend' },
    { min: 200, zh: '萨城田园之光', en: 'Light of Saskatoon Farms' },
  ];
  function levelTitle(level) {
    let title = LEVEL_TITLES[0];
    for (const t of LEVEL_TITLES) {
      if (level >= t.min) title = t;
      else break;
    }
    return title;
  }

  // Next title milestone above the current level. Returns null if already at top.
  function nextTitleAt(level) {
    for (const t of LEVEL_TITLES) {
      if (t.min > level) return t;
    }
    return null;
  }

  // Next level at which the player gains a new plot. Returns null if no more.
  // Sorted numerically (PLOT_UNLOCK_AT keys are stringified when iterated).
  const _PLOT_UNLOCK_LEVELS_SORTED = Object.keys(PLOT_UNLOCK_AT).map(Number).sort(function (a, b) { return a - b; });
  function nextPlotUnlockAt(level) {
    for (const lv of _PLOT_UNLOCK_LEVELS_SORTED) {
      if (lv > level) return lv;
    }
    return null;
  }

  const state = {
    data: null,

    init() {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Guard: parsed could be null if saved is the literal string "null"
          // or non-object (corrupted save). Without this check, Object.assign
          // would silently produce a state object missing nested defaults.
          if (!parsed || typeof parsed !== 'object') throw new Error('save not an object');
          // Object.assign auto-fills any new STARTER fields missing from old saves.
          this.data = Object.assign({}, STARTER_STATE, parsed);
          // Deep-fill nested objects added in later versions
          this.data.dailyClaims = Object.assign({}, STARTER_STATE.dailyClaims, this.data.dailyClaims || {});
          this.data.activeEffects = Object.assign({}, STARTER_STATE.activeEffects, this.data.activeEffects || {});
          this.data.loginCalendar = Object.assign({}, STARTER_STATE.loginCalendar, this.data.loginCalendar || {});
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
              firstDeliveryDone: false,
              likesSentToday: [],
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
      // Phase-1 neighbor sync: piggyback on save() so any stat change
      // eventually reaches Firestore. Debounced to 60s in fbGameSync.
      if (window.Farm && Farm.fbGameSync && Farm.fbGameSync.pushStatsDebounced) {
        Farm.fbGameSync.pushStatsDebounced();
      }
    },

    reset() {
      this.data = JSON.parse(JSON.stringify(STARTER_STATE));
      this.data.sessionStats.date = getDateString();
      this.save();
    },

    // Drop plot crops and seeds for IDs no longer in the catalog. Apply
    // alias renames (e.g. qingcai → shanghai_miao). Called by main.js once
    // crops.js has finished loading the JSON catalog.
    migrateCrops(validIdArray) {
      if (!validIdArray || !validIdArray.length) return null;
      const valid = new Set(validIdArray);
      const aliasMap = { qingcai: 'shanghai_miao' };
      let cleanedPlots = 0;
      let renamedPlots = 0;
      for (const p of this.data.plots) {
        if (!p.crop) continue;
        if (aliasMap[p.crop] && valid.has(aliasMap[p.crop])) {
          p.crop = aliasMap[p.crop];
          renamedPlots++;
          continue;
        }
        if (!valid.has(p.crop)) {
          p.crop = null;
          p.plantedAt = 0;
          p.harvestsLeft = 0;
          cleanedPlots++;
        }
      }
      let cleanedSeeds = 0;
      const newSeeds = {};
      for (const cropId of Object.keys(this.data.seeds)) {
        const count = this.data.seeds[cropId] || 0;
        if (count <= 0) continue;
        const id = aliasMap[cropId] || cropId;
        if (valid.has(id)) {
          newSeeds[id] = (newSeeds[id] || 0) + count;
        } else {
          cleanedSeeds++;
        }
      }
      this.data.seeds = newSeeds;
      // If the player ends up with no seeds at all (e.g. only had tomato),
      // gift the standard 3 starter crops so the game stays playable
      if (Object.keys(this.data.seeds).length === 0) {
        this.data.seeds = { shanghai_miao: 3, xiao_cong: 2, cilantro: 2 };
      }
      if (cleanedPlots || renamedPlots || cleanedSeeds) {
        console.log('[migration] plots cleared:', cleanedPlots, 'renamed:', renamedPlots, 'seed types removed:', cleanedSeeds);
        this.save();
      }
      return { cleanedPlots, renamedPlots, cleanedSeeds };
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
    // Spend EP. When logged in, state.eastPoints mirrors the real
    // members/{uid}.totalPoints (synced on login + each earn/spend), so
    // checking local balance is the same as checking server balance. The
    // Firestore decrement is fired async; failures get queued and retried.
    spendEastPoints(n, opts) {
      opts = opts || {};
      if (this.data.eastPoints < n) return false;
      this.data.eastPoints -= n;
      this.save();
      // Mirror to member account if logged in (optimistic + queue on failure)
      if (window.Farm && Farm.fbAuth && Farm.fbAuth.isLoggedIn() && Farm.fbPoints) {
        Farm.fbPoints.syncEpSpend(n, opts.source || 'unknown', opts.description || '');
      }
      // Reflect new balance in topbar immediately (callers no longer need to)
      if (window.Farm && Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
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
      const result = this.addEastPoints(epAmount, {
        source: 'coin_exchange',
        description: 'Exchange ' + coinAmt + ' farm coins → ' + epAmount + ' EP',
      });
      this.save();
      return { ok: true, coinsSpent: coinAmt, epGained: epAmount, ...result };
    },
    exchangeEpToCoins(epAmt) {
      epAmt = Math.floor(epAmt);
      if (epAmt <= 0) return { ok: false, reason: 'too_small' };
      // Route through spendEastPoints so the spend syncs to the member
      // account when logged in (Firestore decrement + audit row).
      if (!this.spendEastPoints(epAmt, { source: 'coin_exchange', description: 'EP → coins exchange' })) {
        return { ok: false, reason: 'insufficient_ep' };
      }
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

    // ============ Warehouse helpers ============
    // Push a harvested crop into the warehouse. Returns { ok, full } —
    // caller should check `full` to surface the "warehouse full" toast
    // BEFORE calling Farm.crops.harvest() (which would otherwise lose
    // the mature crop with nowhere to put it).
    addToWarehouse(cropId) {
      this.data.warehouse = this.data.warehouse || [];
      if (this.data.warehouse.length >= (this.data.warehouseCapacity || 20)) {
        return { ok: false, full: true };
      }
      this.data.warehouse.push({ cropId, addedAt: Date.now() });
      this.save();
      return { ok: true, count: this.data.warehouse.length };
    },

    // Quick capacity check without mutating — used to block harvest
    // when warehouse is full.
    isWarehouseFull() {
      const wh = this.data.warehouse || [];
      return wh.length >= (this.data.warehouseCapacity || 20);
    },

    // Aggregate the warehouse into { cropId: count } so the UI can
    // render a compact list instead of N rows for N items.
    getWarehouseSummary() {
      const wh = this.data.warehouse || [];
      const counts = {};
      wh.forEach(it => { counts[it.cropId] = (counts[it.cropId] || 0) + 1; });
      return counts;
    },

    // Compute total coin value of warehouse contents BEFORE any
    // daily bonus. The +20% first-delivery bonus is applied at the
    // deliverWarehouse() call site, not here, so this fn stays pure.
    getWarehouseValue() {
      const wh = this.data.warehouse || [];
      let total = 0;
      wh.forEach(it => {
        const def = Farm.crops && Farm.crops.get(it.cropId);
        if (def) total += def.sell_price;
      });
      return total;
    },

    // Warehouse expansion: tiered pricing in coins. Returns the next-tier
    // info { nextCapacity, cost, atMax } so the warehouse modal can show
    // an "expand" button when warehouse is full / nearly full.
    warehouseExpansionTier() {
      const cur = this.data.warehouseCapacity || 20;
      const tiers = [
        { atCapacity: 20, nextCapacity: 25, cost: 50 },
        { atCapacity: 25, nextCapacity: 30, cost: 100 },
        { atCapacity: 30, nextCapacity: 40, cost: 200 },
        { atCapacity: 40, nextCapacity: 50, cost: 400 },
        { atCapacity: 50, nextCapacity: 60, cost: 800 },
      ];
      const t = tiers.find(x => x.atCapacity === cur);
      if (!t) return { nextCapacity: cur, cost: 0, atMax: true };
      return { nextCapacity: t.nextCapacity, cost: t.cost, atMax: false };
    },

    // Buy a warehouse expansion. Deducts coins, bumps capacity.
    expandWarehouse() {
      const tier = this.warehouseExpansionTier();
      if (tier.atMax) return { ok: false, reason: 'at_max' };
      if (this.data.coins < tier.cost) return { ok: false, reason: 'insufficient_coins' };
      this.data.coins -= tier.cost;
      this.data.warehouseCapacity = tier.nextCapacity;
      this.save();
      return { ok: true, newCapacity: tier.nextCapacity, cost: tier.cost };
    },

    // Sell all warehouse contents to Eastern Market, credit coins
    // (with daily-first-delivery bonus if applicable), and clear the
    // warehouse. Returns { totalCoins, bonusCoins, itemCount, firstOfDay }.
    deliverWarehouse() {
      const wh = this.data.warehouse || [];
      if (wh.length === 0) return { ok: false, reason: 'empty' };
      const baseValue = this.getWarehouseValue();
      const isFirstOfDay = !this.data.dailyClaims.firstDeliveryDone;
      const bonus = isFirstOfDay ? Math.round(baseValue * 0.2) : 0;
      const total = baseValue + bonus;
      const itemCount = wh.length;
      this.data.coins += total;
      this.data.sessionStats.coinsEarned += total;
      this.data.warehouse = [];
      this.data.totalDeliveries = (this.data.totalDeliveries || 0) + 1;
      if (isFirstOfDay) this.data.dailyClaims.firstDeliveryDone = true;
      this.save();
      return { ok: true, totalCoins: total, bonusCoins: bonus, baseCoins: baseValue, itemCount, firstOfDay: isFirstOfDay };
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
      let newLevel = this.data.level;
      // Loop in case a single XP gain spans multiple levels (e.g. a big
      // achievement reward dropping while we're 90% into the current level)
      while (this.data.xp >= xpForLevel(newLevel + 1) && newLevel < 9999) {
        newLevel++;
      }
      if (newLevel > this.data.level) {
        const oldLevel = this.data.level;
        for (let lv = oldLevel + 1; lv <= newLevel; lv++) {
          this.unlockPlotsForLevel(lv);
        }
        this.data.level = newLevel;
        this.save();
        return { leveledUp: true, oldLevel, newLevel };
      }
      return { leveledUp: false };
    },

    // Unlock the plots granted at this specific level. If the existing
    // plots[] array already has locked slots, unlock the next one(s);
    // otherwise append new unlocked plots.
    unlockPlotsForLevel(level) {
      const count = PLOT_UNLOCK_AT[level] || 0;
      for (let i = 0; i < count; i++) {
        const lockedIdx = this.data.plots.findIndex(p => !p.unlocked);
        if (lockedIdx !== -1) {
          this.data.plots[lockedIdx].unlocked = true;
        } else {
          const newId = this.data.plots.length;
          this.data.plots.push({
            id: newId,
            crop: null,
            plantedAt: 0,
            harvestsLeft: 0,
            unlocked: true,
          });
        }
      }
    },

    // Expose helpers for UI / external modules
    xpForLevel,
    levelTitle,
    nextTitleAt,
    nextPlotUnlockAt,
    LEVEL_TITLES,
    PLOT_UNLOCK_AT,

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

    // Sign in to today's slot of the 7-day calendar. Handles the
    // today/yesterday/gap bookkeeping and persists. Does NOT grant the
    // reward itself (that's login-calendar.js's job, via addCoins/addSeed/
    // addEastPoints) — this just advances the cycle pointer.
    //
    // Returns { dayIndex, reset } where dayIndex is 1-7 (the day just
    // claimed) and reset is true if a missed day started a fresh cycle.
    signTodayCalendar() {
      const today = getDateString();
      const cal = this.data.loginCalendar;
      if (cal.lastSignDate === today) {
        // Already signed today — return current state, no-op.
        return { dayIndex: cal.dayIndex, reset: false };
      }
      const yesterday = getDateString(new Date(Date.now() - 86400000));
      let reset = false;
      if (cal.lastSignDate === yesterday && cal.dayIndex >= 1 && cal.dayIndex < 7) {
        cal.dayIndex += 1;
      } else if (cal.lastSignDate === yesterday && cal.dayIndex >= 7) {
        // Completed a full cycle yesterday — start a fresh one today.
        cal.dayIndex = 1;
        cal.cycleStartDate = today;
      } else {
        // First sign-in ever, or a gap of ≥1 missed day.
        reset = (cal.lastSignDate !== '' && cal.lastSignDate !== yesterday);
        cal.dayIndex = 1;
        cal.cycleStartDate = today;
      }
      cal.lastSignDate = today;
      this.save();
      return { dayIndex: cal.dayIndex, reset };
    },

    getDateString,
  };

  window.Farm = window.Farm || {};
  window.Farm.state = state;
})();
