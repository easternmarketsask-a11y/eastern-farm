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
    weeklyHarvests: 0,          // harvests in the current week (weekly leaderboard)
    weekId: '',                 // Monday-date id the weeklyHarvests count belongs to
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
    map: null,                  // buildable map layout [{type, gx, gy}] (?map=1; null until first use)
    mapTerrain: null,           // paintable terrain overrides {"gx,gy": "path"|"water"} (null until first use)
    mapBuildSeen: false,        // has the player opened build mode once? (gates the 建造-button hint pulse)
    farmStyle: 'iso',           // chosen farm view: 'iso' (Hay Day) | 'topdown' (pixel) | 'classic' (vertical)
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
      stolenToday: 0,           // 主动顺菜总块数今日 (cap socialConfig.STEAL_MAX_PER_DAY)
      stolenFromTargets: {},    // {targetId: count} 今日对每个对象顺了几块
      lostToRealToday: 0,       // 今日被真人偷走的棵数 (cap socialConfig.LOST_DAILY_MAX)
      visitFootprints: [],      // 今日已留过足迹的 host uids（每天每家一次）
    },
    activeEffects: {            // toggleable consumable effects
      accelerationCharges: 0,   // # of 加速券 in inventory (consumed on use)
      freshnessCharges: 0,      // # of 保鲜券 in inventory
      bumperCharges: 0,         // vestigial — migrated to fertilizerCharges (T2 打理)
      fertilizerCharges: 0,     // # of 化肥 in inventory; applied per-plot (plot.fertilized) → ×2 yield
    },

    // ============ 7-day sign-in calendar (login-calendar.js) ============
    // Replaces the old flat daily-login coin/EP reward with an escalating
    // 7-day cycle. dayIndex = 0 means "not yet signed today" (next sign-in
    // claims day 1). A gap of ≥1 missed day resets the cycle to day 1.
    loginCalendar: {
      cycleStartDate: '',   // YYYY-MM-DD when the current 7-day cycle began
      lastSignDate: '',     // YYYY-MM-DD of the last successful sign-in
      dayIndex: 0,          // 0-7; how many days of THIS cycle have been claimed
      autoShownDate: '',    // YYYY-MM-DD it last auto-popped (signed OR dismissed)
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

    // ============ 小东订单板 (orders.js — 2026-06-18) ============
    // Hay Day-style order board: 小东 (Eastern Market) requests specific
    // crops; player delivers them FROM the warehouse for a coin premium
    // (~1.5× bulk-sell) + XP, and occasionally a little 超市积分. This gives
    // crop VARIETY a purpose beyond bulk selling and pulls the player back.
    orders: [],                 // Array of { id, items:[{cropId,qty}], coins, xp, points, createdAt }
    totalOrdersFilled: 0,       // Lifetime count of fulfilled orders
    orderEp: { date: '', earned: 0 },  // self-resetting daily cap on 超市积分 from orders

    // ============ Neighbor system (Phase 1 — 2026-05-24) ============
    nickname: null,             // user-set in settings (else derived "{firstChar}邻居")
    visibleToNeighbors: true,   // privacy toggle (settings)
    excludeFromRanking: false,  // store-owner flag: hide from others' rankings/neighbors (owner can still browse)
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
    // Coach (just-in-time rule hints): which one-line tips have already fired.
    // Each rule shows ONCE ever, keyed by id (see coach.js). 2026-06-11.
    coachSeen: {},
    // Spotlight onboarding (hand-held first plant→harvest→sell). Once done or
    // skipped, never shows again. See spotlight.js. 2026-06-13.
    spotlightDone: false,
    // Guest→login conversion nudge: shown ONCE to a not-logged-in player at an
    // engaged moment (first sale). See login-nudge.js. 2026-06-14.
    guestLoginPromptShown: false,

    // 上次种下的种子 id（选种器把它置顶 + 「上次」标，UX 第 2 批 2026-07-05）。
    // 顶层新字段：init() 的 Object.assign(STARTER 深拷贝, saved) 会自动给旧存档补 null。
    lastSeedId: null,

    // ============ Promotions (2026-06) ============
    // Claimed limited-time promos, keyed by promo id (e.g. lv3_week_202606).
    // Mirrored into gameStats.promoClaims so a local reset can't re-claim.
    promoClaims: {},

    // ============ AI 邻居关系（社交①, 2026-06-09） ============
    // {aiId: {likedByMe, helpedByMe, stolenByMe, owesMeGift}} 本地记录，用于
    // AI「会回应你」（你帮过的回礼、你偷过的来顺你）。T5 据此生成回家小报事件。
    aiRelationships: {},

    // 上次活跃时间戳（算"离开多久"→ 被偷结算）。0 = 从未设置(首次加载视为现在,不误判)。
    lastActiveAt: 0,
    // 最近一次离开期间的偷/帮事件（喂回家小报）。
    raidLog: null,
    // 每次成功 save() 写入的本机时间戳。云端存档恢复时用它 + totalHarvests
    // 比较本地与云端谁更新，决定是否从云端拉回（见 firebase-game-sync）。
    lastSavedAt: 0,
  };

  function getDateString(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  // Week identifier = the local Monday's date string (YYYY-MM-DD). Used by the
  // weekly leaderboard so a "week" is a clear Mon–Sun bucket.
  function getWeekId(d) {
    d = d || new Date();
    const dow = (d.getDay() + 6) % 7;   // 0=Mon … 6=Sun
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
    return getDateString(monday);
  }

  // ============ Level progression (open-ended) ============
  // Early-game XP curve rebalanced (2026-05-24): old curve was 50/150/350/...
  // which required ~25 bok choy harvests to reach Lv 2 (2+ hours of grind for
  // a single new crop unlock). New curve targets ~5 harvests per level for
  // Lv 1-5, then ramps up. Goal: player sees 5+ crops unlock in first 30 min.
  // 2026-07-02 悬崖修复：旧公式 Lv11 累计 4,000 → Lv12 跳 13,025（单级 9,025
  // = 前 11 级总和的 2.26 倍），而作物解锁止步 Lv9——活跃玩家 10-20 天撞墙。
  // 固定表平滑延到 Lv16（单级 2,000→4,000 递增），配合新加的 Lv10/12/14 作物
  // 和 Lv12 地块，把毕业点往后推一倍。已有玩家 XP 超过新阈值时 checkLevelUp
  // 的 while 循环会一次性连升（正向惊喜，不动存档）。
  const XP_TABLE_FIXED = [0, 10, 30, 80, 180, 350, 600, 1000, 1600, 2500, 4000,
                          6000, 8500, 11500, 15000, 19000];
  function xpForLevel(level) {
    if (level <= 0) return 0;
    if (level <= XP_TABLE_FIXED.length) return XP_TABLE_FIXED[level - 1];
    const k = level - XP_TABLE_FIXED.length;
    // Each level past 16 needs ~4,500 base, growing gently with `k`.
    return Math.round(19000 + 4500 * k * (1 + k * 0.1));
  }

  // Levels that grant a new plot. Through Lv 5 every level gives +2 (matches
  // the original 4→12 ramp). After Lv 5 plots come less often, but never
  // stop, so there's always a long-term carrot.
  const PLOT_UNLOCK_AT = {
    2: 2, 3: 2, 4: 2, 5: 2,                          // 12 plots total by Lv 5 (unchanged)
    7: 1, 10: 1, 12: 1, 15: 1, 20: 1,                // → 17 plots by Lv 20（Lv12 插一块，填 10-15 空窗）
    30: 1, 50: 1, 75: 1, 100: 1,                     // → 21 plots by Lv 100
    150: 1, 200: 1, 300: 1, 500: 1,                  // → 25 plots by Lv 500
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
      // localStorage.getItem itself can THROW (iOS 存储已满 / 被 ITP 清 / 分区隔离 / 私密浏览),
      // 不只是返回 null。此前这行没 try —— 一抛错 init 就中断在 this.data 赋值之前，
      // this.data 永远是 null → 之后每个模块都在 null 上崩（reading 'language'/'map'…），
      // 开屏消失后游戏是死的 = Chris 的「总是卡着」。所以必须 guard 这个「读」，
      // 读失败就当作没存档 → 走全新内存态（本次可正常玩，只是不落地保存），绝不冻死。
      let saved = null;
      try { saved = localStorage.getItem(SAVE_KEY); }
      catch (e) { console.warn('[state] localStorage read blocked — in-memory session', e); }
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Guard: parsed could be null if saved is the literal string "null"
          // or non-object (corrupted save). Without this check, Object.assign
          // would silently produce a state object missing nested defaults.
          if (!parsed || typeof parsed !== 'object') throw new Error('save not an object');
          // Object.assign auto-fills any new STARTER fields missing from old saves.
          // DEEP-CLONE the defaults first: otherwise a field present in STARTER but
          // absent from an old save (e.g. orders/warehouse/festivalHarvests/orderEp)
          // is copied BY REFERENCE — mutating this.data.orders would then mutate the
          // module's STARTER_STATE.orders and leak across resets/reloads.
          this.data = Object.assign(JSON.parse(JSON.stringify(STARTER_STATE)), parsed);
          // Harden core collections against a corrupted-but-parseable save: a null /
          // non-array `plots` or null / non-object `seeds` would otherwise crash
          // migrateCrops() during boot and wedge the player on the splash screen.
          if (!Array.isArray(this.data.plots)) this.data.plots = JSON.parse(JSON.stringify(STARTER_STATE.plots));
          if (!this.data.seeds || typeof this.data.seeds !== 'object') this.data.seeds = JSON.parse(JSON.stringify(STARTER_STATE.seeds));
          // Deep-fill nested objects added in later versions
          this.data.dailyClaims = Object.assign({}, STARTER_STATE.dailyClaims, this.data.dailyClaims || {});
          this.data.activeEffects = Object.assign({}, STARTER_STATE.activeEffects, this.data.activeEffects || {});
          // T2 打理迁移：旧「全局高级化肥」(bumperCharges, 收获自动×2) → 新「逐块化肥」
          // 库存 (fertilizerCharges, 选地块施用)。幂等：迁移后 bumperCharges 清零。
          if ((this.data.activeEffects.bumperCharges || 0) > 0) {
            this.data.activeEffects.fertilizerCharges =
              (this.data.activeEffects.fertilizerCharges || 0) + this.data.activeEffects.bumperCharges;
            this.data.activeEffects.bumperCharges = 0;
          }
          this.data.loginCalendar = Object.assign({}, STARTER_STATE.loginCalendar, this.data.loginCalendar || {});
          this.data.ownedShopItems = this.data.ownedShopItems || {};
          this.data.decorations = this.data.decorations || [];
          // Fresh top-level object so per-ai relationship writes never leak into STARTER_STATE.
          this.data.aiRelationships = Object.assign({}, STARTER_STATE.aiRelationships, this.data.aiRelationships || {});
          // Reset session stats daily
          const today = getDateString();
          if (this.data.sessionStats.date !== today) {
            this.data.sessionStats = {
              date: today,
              planted: {}, harvested: {},
              coinsEarned: 0, seedsBought: 0, coinsSpent: 0,
            };
          }
          // NOTE: the old client-side daily-EP cap + pendingEp drain was removed.
          // The server (StockWise /api/rewardup/me/earn) is the single authority
          // for the daily cap, rate-limit, dedupe and balance — see addEastPoints.
          // (epDailyCap/epEarnedToday/pendingEp fields are now vestigial.)
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
              helpSentToday: [],       // uids helped today (dedup, cap)
              stickersSentToday: [],   // sticker sends today (count vs cap)
              stolenToday: 0,          // 主动顺菜总块数今日
              stolenFromTargets: {},   // {targetId: count} 今日对每个对象顺了几块
              lostToRealToday: 0,      // 今日被真人偷走的棵数
              visitFootprints: [],     // 今日已留足迹的 host uids
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
        // Persist the fresh state immediately so SAVE_KEY always exists after a
        // load. The boot-time persistence probe (main.js) relies on this: if the
        // key is gone on a later reload, the browser isn't persisting storage.
        this.save();   // guarded internally; a blocked browser just warns, never throws here
      }
      // 兜底不变量：无论上面存储/迁移出了什么岔子，绝不能让游戏带着 null 状态往下走
      // （null this.data 会让每个模块崩 → 开屏后死机）。任何漏网情形一律回落全新内存态。
      if (!this.data || typeof this.data !== 'object') {
        this.data = JSON.parse(JSON.stringify(STARTER_STATE));
        this.data.sessionStats.date = getDateString();
        this.data.dailyClaims.date = getDateString();
      }
    },

    save() {
      // Warn ONLY when setItem genuinely throws (iOS Private Browsing quota=0,
      // storage blocked/full). A read-back mismatch is NOT used as a trigger —
      // a concurrent save (heartbeat/toast re-entry) can momentarily differ and
      // would false-warn a healthy browser. Cross-session non-persistence is
      // detected separately by the boot probe in main.js.
      try {
        this.data.lastSavedAt = Date.now();   // stamp before serialize (cloud restore compares this)
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.error('Save failed', e);
        if (!this._saveWarned) {
          this._saveWarned = true;
          const lang = (this.data && this.data.language) === 'en' ? 'en' : 'zh';
          if (window.Farm && Farm.ui && Farm.ui.toast) {
            // 现在游戏本次仍可正常玩(内存态)，只是这次的进度可能存不下来。文案据实说明,
            // 不再一口咬定「无痕模式」(Chris 常不在无痕却总看到，反感)；给真正有用的 iOS
            // 建议:登录可云端同步 + 加到主屏幕从图标打开(绕开 Safari 7 天清储)。
            Farm.ui.toast(lang === 'en'
              ? '本次可正常游玩 · 但这台设备暂时存不下进度（存储已满或 iOS Safari 限制）。建议：登录后可云端同步；或点分享→「添加到主屏幕」，以后从图标打开更稳。'
              : '本次可正常游玩 · 但这台设备暂时存不下进度（存储已满或 iOS Safari 限制）。建议：登录后可云端同步；或点分享→「添加到主屏幕」，以后从图标打开更稳。', 8000);
          }
        }
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

    // Resolve the active farm view. URL param overrides (for shared links/testing),
    // else the player's saved preference, else 'iso' (Hay Day default).
    farmStyle() {
      const s = location.search;
      if (/[?&]classic=1/.test(s)) return 'classic';
      if (/[?&](topdown=1|map=1)/.test(s)) return 'topdown';
      if (/[?&]iso=1/.test(s)) return 'iso';
      const p = this.data && this.data.farmStyle;
      return (p === 'topdown' || p === 'classic') ? p : 'iso';
    },

    // Replace local state with a cloud-restored snapshot (see firebase-game-sync
    // restoreFromCloud). Caller already decided the cloud copy wins. We:
    //  - fill any newer STARTER fields missing from the (possibly older) blob,
    //  - PRESERVE store-owned balances (eastPoints/unsyncedEp) — those belong to
    //    the member's real RewardUp account, never to an old game blob,
    //  - roll over daily/session buckets if the blob is from a previous day,
    //  - drop crops no longer in the catalog (migrateCrops),
    //  - persist locally.
    applyCloudSave(cloudState) {
      if (!cloudState || typeof cloudState !== 'object') return false;
      const keepEastPoints = this.data.eastPoints;
      const keepUnsyncedEp = this.data.unsyncedEp;
      const localMap = (this.data && Array.isArray(this.data.map)) ? this.data.map : null;
      const localTerrain = (this.data && this.data.mapTerrain && typeof this.data.mapTerrain === 'object') ? this.data.mapTerrain : null;
      const localStyle = (this.data && this.data.farmStyle) || null;        // chosen view (device pref)
      const localBuildSeen = !!(this.data && this.data.mapBuildSeen);
      const localCal = (this.data && this.data.loginCalendar) || {};
      // Deep-clone the STARTER base (not a shallow {}-spread) so any nested field
      // missing from an older cloud blob doesn't end up ALIASING STARTER_STATE —
      // the same guard init() applies. Otherwise a later reset() leaks stale data.
      const merged = Object.assign(JSON.parse(JSON.stringify(STARTER_STATE)), cloudState);
      merged.dailyClaims = Object.assign({}, STARTER_STATE.dailyClaims, cloudState.dailyClaims || {});
      merged.activeEffects = Object.assign({}, STARTER_STATE.activeEffects, cloudState.activeEffects || {});
      // 签到日历:别让旧云端存档把"今天已签/已弹"回退(否则签到卡反复弹 + 签到进度丢失)。
      // 取 lastSignDate 更近的那份做基底,autoShownDate 取两者较大,弹窗已读绝不回退。
      const cloudCal = cloudState.loginCalendar || {};
      const newerCal = ((localCal.lastSignDate || '') >= (cloudCal.lastSignDate || '')) ? localCal : cloudCal;
      merged.loginCalendar = Object.assign({}, STARTER_STATE.loginCalendar, newerCal);
      merged.loginCalendar.autoShownDate =
        [(localCal.autoShownDate || ''), (cloudCal.autoShownDate || '')].sort().pop();
      merged.aiRelationships = Object.assign({}, STARTER_STATE.aiRelationships, cloudState.aiRelationships || {});
      if (keepEastPoints != null) merged.eastPoints = keepEastPoints;   // server owns this
      if (keepUnsyncedEp != null) merged.unsyncedEp = keepUnsyncedEp;
      // Map layout: use the cloud copy if it has one; otherwise keep the local
      // (already-seeded) layout so an older cloud blob doesn't wipe the buildings.
      if (!Array.isArray(cloudState.map) && localMap) merged.map = localMap;
      if ((!cloudState.mapTerrain || typeof cloudState.mapTerrain !== 'object') && localTerrain) merged.mapTerrain = localTerrain;
      // View preference + build-hint flag: cloud wins if it has them; else keep
      // local so an older cloud blob doesn't bounce the player out of their chosen
      // style or re-trigger the one-time build-button hint.
      if (cloudState.farmStyle == null && localStyle) merged.farmStyle = localStyle;
      if (cloudState.mapBuildSeen == null && localBuildSeen) merged.mapBuildSeen = true;
      this.data = merged;
      // Daily/session rollover if the restored blob predates today.
      const today = getDateString();
      if (!this.data.sessionStats || this.data.sessionStats.date !== today) {
        this.data.sessionStats = { date: today, planted: {}, harvested: {}, coinsEarned: 0, seedsBought: 0, coinsSpent: 0 };
      }
      if (!this.data.dailyClaims || this.data.dailyClaims.date !== today) {
        this.data.dailyClaims = {
          date: today, lotterySpunFree: false, neighborsVisited: [], newsRead: false,
          firstHarvestDone: false, firstDeliveryDone: false, likesSentToday: [], helpSentToday: [],
          stickersSentToday: [], stolenToday: 0, stolenFromTargets: {}, lostToRealToday: 0, visitFootprints: [],
        };
      }
      // Drop crops/seeds no longer in the catalog (mirrors main.js boot migrate).
      if (window.Farm && Farm.crops && Farm.crops.all) {
        const ids = Farm.crops.all().map(c => c.id).concat(Object.keys(Farm.crops.festivalCrops || {}));
        this.migrateCrops(ids);
      }
      this.save();
      return true;
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
      // Also migrate the lifetime discovery list, so a renamed crop
      // (qingcai → shanghai_miao) still counts toward the 蔬菜图鉴 collection
      // and crops_set achievements (e.g. 八仙过海). Without this, an old save's
      // 'qingcai' lingers as an orphan and the player would have to re-grow the
      // renamed crop to get credit. Rename via the same aliasMap + dedupe.
      let renamedHistory = 0;
      if (Array.isArray(this.data.cropsEverGrown)) {
        const seen = new Set();
        this.data.cropsEverGrown = this.data.cropsEverGrown.reduce((acc, id) => {
          const mapped = aliasMap[id] || id;
          if (mapped !== id) renamedHistory++;
          if (!seen.has(mapped)) { seen.add(mapped); acc.push(mapped); }
          return acc;
        }, []);
      }
      // If the player ends up with no seeds at all (e.g. only had tomato),
      // gift the standard 3 starter crops so the game stays playable
      if (Object.keys(this.data.seeds).length === 0) {
        this.data.seeds = { shanghai_miao: 3, xiao_cong: 2, cilantro: 2 };
      }
      if (cleanedPlots || renamedPlots || cleanedSeeds || renamedHistory) {
        console.log('[migration] plots cleared:', cleanedPlots, 'renamed:', renamedPlots, 'seed types removed:', cleanedSeeds, 'history renamed:', renamedHistory);
        this.save();
      }
      return { cleanedPlots, renamedPlots, cleanedSeeds, renamedHistory };
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
    // Add supermarket points. The DAILY CAP (and rate-limit, dedupe, one-shot
    // rules) all live SERVER-SIDE (StockWise /api/rewardup/me/earn, cap = 500/day)
    // — the client no longer caps. We credit optimistically for instant UI;
    // the server response then overwrites `eastPoints` with the authoritative
    // (capped) balance via Farm.fbPoints._applyServerResponseToLocal. If the
    // server REJECTS the earn (cap/rate-limit/one-shot), we roll the optimistic
    // credit back so local matches server.
    //
    // Logged out: no server, so credit locally + mirror into `unsyncedEp` for
    // the one-shot first-login backfill.
    //
    // Returns { credited, sync } where `sync` is the server promise (or null)
    // so callers like exchangeCoinsToEp can react to a server rejection.
    addEastPoints(n, opts) {
      opts = opts || {};
      if (n <= 0) { this.save(); return { credited: 0, sync: null }; }
      const loggedIn = !!(window.Farm && Farm.fbAuth && Farm.fbAuth.isLoggedIn && Farm.fbAuth.isLoggedIn());

      this.data.eastPoints += n;                    // optimistic
      if (!loggedIn) {
        this.data.unsyncedEp = (this.data.unsyncedEp || 0) + n;
      }
      this.save();

      let sync = null;
      if (loggedIn && Farm.fbPoints) {
        sync = Farm.fbPoints.syncEpEarn(n, opts.source || 'unknown', opts.description || '');
        if (sync && sync.then) {
          sync.then((r) => {
            // success → server response already set eastPoints to the
            // authoritative capped balance.
            // 429 (daily cap / rate-limit) → server genuinely didn't credit,
            //   so undo the optimistic add (this is the jumpiness fix).
            // 422 (source not whitelisted) → server also rejected the earn, so
            //   undo the optimistic add too; otherwise local EP drifts above
            //   the server's true capped balance (phantom EP exploit).
            if (r && r.rejected && (r.code === 429 || r.code === 422)) {
              this.data.eastPoints = Math.max(0, this.data.eastPoints - n);
              this.save();
              if (window.Farm && Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
            }
          });
        }
      }
      return { credited: n, sync };
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
        description: 'Exchange ' + coinAmt + ' farm coins → ' + epAmount + ' points',
      });
      // If the server rejects the points earn (e.g. daily cap reached), refund
      // the coins so the player isn't charged for points they didn't get.
      if (result.sync && result.sync.then) {
        result.sync.then((res) => {
          if (res && res.rejected && res.code === 429) {
            this.data.coins += coinAmt;
            this.save();
            if (window.Farm && Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
            const lang = this.data.language;
            if (window.Farm && Farm.ui) {
              Farm.ui.toast(lang === 'en'
                ? 'Daily points cap reached — coins refunded'
                : '今日积分已达上限，农场币已退回', 3500);
            }
          }
        });
      }
      this.save();
      return { ok: true, coinsSpent: coinAmt, epGained: epAmount, credited: result.credited };
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

    // How many of a specific crop are currently in the warehouse.
    // Used by the order board to show have/need and gate fulfillment.
    warehouseCount(cropId) {
      const wh = this.data.warehouse || [];
      let n = 0;
      for (let i = 0; i < wh.length; i++) if (wh[i].cropId === cropId) n++;
      return n;
    },

    // Remove up to `n` of `cropId` from the warehouse (oldest first).
    // Returns how many were actually removed. Used when delivering an order.
    removeFromWarehouse(cropId, n) {
      const wh = this.data.warehouse || [];
      let removed = 0;
      for (let i = 0; i < wh.length && removed < n; ) {
        if (wh[i].cropId === cropId) { wh.splice(i, 1); removed++; }
        else i++;
      }
      this.save();
      return removed;
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
        // 应季作物 +15%（crops.sellPriceOf），与仓库面板展示价保持一致
        if (def) total += (Farm.crops.sellPriceOf ? Farm.crops.sellPriceOf(def) : def.sell_price);
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
      // 「给小东留着」：订单板当前需要的数量自动保留，不随一键卖货流走——
      // 否则玩家为 1.5× 订单攒的菜会被 1× 价卖掉，攒单和卖仓互相打架。
      const reserve = (Farm.orders && Farm.orders.reservedNeeds) ? Farm.orders.reservedNeeds() : {};
      const keep = [];
      const sell = [];
      const kept = Object.create(null);
      wh.forEach(it => {
        if ((kept[it.cropId] || 0) < (reserve[it.cropId] || 0)) {
          kept[it.cropId] = (kept[it.cropId] || 0) + 1;
          keep.push(it);
        } else {
          sell.push(it);
        }
      });
      if (sell.length === 0) return { ok: false, reason: 'all_reserved', reservedCount: keep.length };
      let baseValue = 0;
      sell.forEach(it => {
        const def = Farm.crops && Farm.crops.get(it.cropId);
        if (def) baseValue += (Farm.crops.sellPriceOf ? Farm.crops.sellPriceOf(def) : def.sell_price);
      });
      const isFirstOfDay = !this.data.dailyClaims.firstDeliveryDone;
      const bonus = isFirstOfDay ? Math.round(baseValue * 0.2) : 0;
      const total = baseValue + bonus;
      this.data.coins += total;
      this.data.sessionStats.coinsEarned += total;
      this.data.warehouse = keep;
      this.data.totalDeliveries = (this.data.totalDeliveries || 0) + 1;
      if (isFirstOfDay) this.data.dailyClaims.firstDeliveryDone = true;
      this.save();
      return { ok: true, totalCoins: total, bonusCoins: bonus, baseCoins: baseValue,
               itemCount: sell.length, reservedCount: keep.length, firstOfDay: isFirstOfDay };
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
      // Weekly leaderboard counter — reset when the week rolls over.
      const wid = getWeekId();
      if (this.data.weekId !== wid) { this.data.weekId = wid; this.data.weeklyHarvests = 0; }
      this.data.weeklyHarvests = (this.data.weeklyHarvests || 0) + 1;
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

    // 今天签到会发生什么（signTodayCalendar 与日历预览 UI 共用的唯一真相源，
    // 别在两处各写一份镜像逻辑——2026-07-02 抽取）。
    //   signed   已签过
    //   continue 昨天签了且周期中段 → 连签 +1
    //   repair   恰好错过一天、周期中段、本自然周补签卡未用 → 视同连签 +1
    //   newcycle 昨天刚满 7 天 → 开新周期第 1 天
    //   reset    断签 ≥2 天或首签 → 第 1 天重开
    _calendarPlan() {
      const today = getDateString();
      const cal = this.data.loginCalendar;
      if (cal.lastSignDate === today) return { kind: 'signed' };
      const yesterday = getDateString(new Date(Date.now() - 86400000));
      const dayBefore = getDateString(new Date(Date.now() - 2 * 86400000));
      if (cal.lastSignDate === yesterday && cal.dayIndex >= 1 && cal.dayIndex < 7) return { kind: 'continue' };
      if (cal.lastSignDate === yesterday && cal.dayIndex >= 7) return { kind: 'newcycle' };
      // 补签卡（cozy 缓冲）：错过恰好一天且本周没用过 → 帮你把昨天补上。
      // 断更久（≥2 天空档）不适用——那已经不是「忘了一天」而是离开了。
      if (cal.lastSignDate === dayBefore && cal.dayIndex >= 1 && cal.dayIndex < 7
          && cal.repairWeekId !== getWeekId()) return { kind: 'repair' };
      return { kind: 'reset', hadHistory: cal.lastSignDate !== '' };
    },

    // Sign in to today's slot of the 7-day calendar. Handles the
    // today/yesterday/gap bookkeeping and persists. Does NOT grant the
    // reward itself (that's login-calendar.js's job, via addCoins/addSeed/
    // addEastPoints) — this just advances the cycle pointer.
    //
    // Returns { dayIndex, reset, repaired } where dayIndex is 1-7 (the day
    // just claimed), reset is true if a missed gap started a fresh cycle,
    // repaired is true if the weekly repair card bridged a 1-day miss.
    signTodayCalendar() {
      const today = getDateString();
      const cal = this.data.loginCalendar;
      const plan = this._calendarPlan();
      if (plan.kind === 'signed') {
        // Already signed today — no-op. claimed:false lets the caller skip
        // re-granting the reward (guards rapid double-tap double-pay).
        return { dayIndex: cal.dayIndex, reset: false, repaired: false, claimed: false };
      }
      let reset = false;
      let repaired = false;
      if (plan.kind === 'continue') {
        cal.dayIndex += 1;
      } else if (plan.kind === 'repair') {
        cal.dayIndex += 1;
        cal.repairWeekId = getWeekId();   // 每自然周一张，用掉记周号
        repaired = true;
      } else {
        reset = plan.kind === 'reset' && plan.hadHistory;
        cal.dayIndex = 1;
        cal.cycleStartDate = today;
      }
      cal.lastSignDate = today;
      this.save();
      return { dayIndex: cal.dayIndex, reset, repaired, claimed: true };
    },

    getDateString,
    getWeekId,
  };

  window.Farm = window.Farm || {};
  window.Farm.state = state;
})();
