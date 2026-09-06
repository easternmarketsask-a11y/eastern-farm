/**
 * state.js — Game state + localStorage persistence.
 *
 * Save key: eastern_farm_save_v1
 * Always version the save format. Migrate old versions explicitly.
 */
(function() {
  const SAVE_KEY = 'eastern_farm_save_v1';
  // 会话接管 token（audit P0 2026-07-07 多标签页覆盖）：每个标签页 boot 时写一个
  // 随机 token；save() 前校验 token 仍是自己——不是则说明另一个标签页已接管，
  // 本页永久停止落盘（否则旧标签页 60s 心跳会把过期状态反写覆盖新标签页进度）。
  const SESSION_KEY = 'ef_session_token';
  const STARTER_STATE = {
    // 存档格式版本。breaking 结构改动时 +1 并在 migrateSave() 加分支（见下）。
    // v2 (2026-07-07)：引入版本迁移钩子 + 顶层标量类型消毒；结构与 v1 相同。
    version: 2,
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
    // Audio preference. audioMuted = hard off (backward compatible); audioVolume
    // = soft tier (1 normal / 0.4 low); ambientOff = disable background bed only.
    // New fields default via Object.assign(STARTER, parsed) — old saves unaffected.
    audioMuted: false,
    audioVolume: 1,
    ambientOff: false,

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
    farmerLook: 2,              // 油画农户 1–9；缺省女农户。非法值按 2 收。
    hands: [],                  // [{ look, hiredAt, paidThroughDate }] 帮手；永不弃档
    handsUnlockSeen: '',        // '' = never; sticky '1' after the once-ever prompt
    extraPlots: 0,              // additional plots unlocked beyond the base 12 (max 4)
    homeUpkeepOn: '',           // Sask date last paid; empty = not yet
    homeNeglected: false,       // unpaid upkeep today → house charm halved
    clearedCells: {},           // {"gx,gy":1} 开垦出的地界外格子（老矩形地界不动）
    ownedShopItems: {},         // {itemId: count} consumables remaining (acceleration tickets etc.)
    theme: 'default',           // 'default' | 'spring' | 'summer' | 'autumn' | 'winter' | 'festival'
    dailyClaims: {              // resets when date changes
      date: '',
      lotterySpunFree: false,   // free daily spin used?
      neighborsVisited: [],     // neighbor IDs visited today
      neighborQuestPaid: false, // 今日走访奖励已发
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

    // ============ 东超订单板 (orders.js — 2026-06-18) ============
    // Hay Day-style order board: 东超 (Eastern Market) requests specific
    // crops; player delivers them FROM the warehouse for a coin premium
    // (~1.5× bulk-sell) + XP, and occasionally a little 超市积分. This gives
    // crop VARIETY a purpose beyond bulk selling and pulls the player back.
    // 🗑 orders[] 已于 2026-08-22 退役：订单板搬进 storeDemand.board（见下）。
    //    单一数据源 —— 别再恢复这个数组，否则两处存同一种东西。
    totalOrdersFilled: 0,       // Lifetime count of fulfilled orders
    orderEp: { date: '', earned: 0 },  // self-resetting daily cap on 超市积分 from orders

    /* ============ 东超需求（store-demand.js — 2026-08-22）============
       取代「谷仓无限收购」：卖菜只能按东方超市的订单供货。
       三层 —— 每日基础补货(地板·限量·1.0×) / 不定期订单(主收入) / 大单(少见·高回报)。
       🔒 时刻一律绝对时间戳，离线自然到点；日期一律 getDateString()（萨省 UTC-6）。 */
    storeDemand: {
      day: '',              // 上次重铺 staples/forecast 的日子（getDateString）
      staples: [],          // [{cropId, need, filled}] 每日基础补货
      board: [],            // [{id, kind, items, coins, xp, points, postedAt, expiresAt, accepted}]
      forecast: [],         // [{date, cropIds, reason}] 备货预告
      nextPostAt: 0,        // 下一张单什么时候贴（绝对时间戳）
      lastSyncAt: 0,        // 上次拉真店特价的时刻（二期）
      source: 'local',      // 'live' = 真店数据，'local' = 纯游戏内
      clearedLegacy: false, // 老存档的一次性开业清仓单是否已发
    },

    // ============ Neighbor system (Phase 1 — 2026-05-24) ============
    nickname: null,             // 玩家自起；空则对外显示会员真名
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

  // 见 STARTER_STATE.storeDemand。老存档缺子字段时补齐，不覆盖已有值。
  function _fillStoreDemand(data) {
    const def = STARTER_STATE.storeDemand;
    if (!data.storeDemand || typeof data.storeDemand !== 'object') {
      data.storeDemand = JSON.parse(JSON.stringify(def));
      return;
    }
    const sd = data.storeDemand;
    for (const k of Object.keys(def)) {
      const want = def[k];
      if (Array.isArray(want)) { if (!Array.isArray(sd[k])) sd[k] = []; }
      else if (typeof sd[k] !== typeof want) sd[k] = want;
    }
  }

  function sanitizeHands(data) {
    if (!data || typeof data !== 'object') return data;
    if (!Array.isArray(data.hands)) data.hands = [];
    data.hands = data.hands.map(function (h) {
      if (!h || typeof h !== 'object') return null;
      const look = Farm.farmer && Farm.farmer.clampLook
        ? Farm.farmer.clampLook(h.look)
        : ((h.look >= 1 && h.look <= 9) ? (h.look | 0) : 7);
      return {
        look: look,
        hiredAt: (typeof h.hiredAt === 'number' && isFinite(h.hiredAt)) ? h.hiredAt : Date.now(),
        paidThroughDate: (typeof h.paidThroughDate === 'string') ? h.paidThroughDate : '',
      };
    }).filter(Boolean);
    // Extra rows beyond MAX_HANDS stay in the blob unpaid and unspawned.
    // Do not delete. 永不弃档.
    if (data.handsUnlockSeen) data.handsUnlockSeen = '1';
    else data.handsUnlockSeen = '';
    return data;
  }

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
    // Each level past 16 needs ~4,000 base, growing gently with `k`.
    // 2026-07-07 (B5 内容悬崖)：二次项 0.1k → 0.05k，软化 Lv17+ 超线性外推，
    // 配合新加的 Lv15-20 作物/菜谱/地块，让休闲盘 Lv15→20 每级空窗 ≤4 天
    // （scripts/verify/sim-level-pace.mjs 验收）。只降不升——checkLevelUp 只增
    // 不减，老玩家至多在下次 checkAll 一次性连升几级（正向惊喜，不动存档结构）。
    return Math.round(19000 + 4000 * k * (1 + k * 0.05));
  }

  // Levels that grant a new plot. Through Lv 5 every level gives +2 (matches
  // the original 4→12 ramp). After Lv 5 plots come less often, but never
  // stop, so there's always a long-term carrot.
  const PLOT_UNLOCK_AT = {
    2: 2, 3: 2, 4: 2, 5: 2,                          // 12 plots total by Lv 5 (unchanged)
    7: 1, 10: 1, 12: 1, 15: 1, 17: 1, 20: 1,         // → 18 plots by Lv 20（Lv17 插一块，填 15-20 空窗，B5 内容悬崖）
    30: 1, 50: 1, 75: 1, 100: 1,                     // → 22 plots by Lv 100
    150: 1, 200: 1, 300: 1, 500: 1,                  // → 26 plots by Lv 500
  };

  // ============ 扩地（购买地块）单一定价源（B5 三套地块定价统一）============
  // 历史遗留：iso 建造菜地 200 币无上限、ep-shop 3000 币限 4 块——两套矛盾。
  // 现在两个「农场币」购买入口（iso 建造面板 + 商城 extra_plot_coins）都读同一
  // 递增价格 extraPlotCoinCost() + 同一计数器 extraPlots + 同一上限 EXTRA_PLOT_CAP。
  // 「等级解锁数 + 8」= 靠等级解锁的基础地块（随 PLOT_UNLOCK_AT 增长）再 + 8 块可买。
  // EP 版 extra_plot（100 EP）沿用同计数器同帽，但价格是 EP 侧红线不动。
  // 存档字段 extraPlots/plots[] 已存在，无需迁移。
  const EXTRA_PLOT_CAP = 8;
  const EXTRA_PLOT_COSTS = [200, 600, 1500, 3000, 4500, 6000, 8000, 10000];

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

  // ============ 存档格式迁移链（audit P2 2026-07-07）============
  // save.version 现在真的被读取了：v1 / 缺失 → 视为 1。breaking 结构改动的做法：
  //   1) STARTER_STATE.version += 1
  //   2) 在这里加 `if (from < N) { ...就地改 parsed... }` 分支（必须幂等）
  // 只能就地修改 parsed（在 Object.assign 合并 STARTER 之前调用）。
  // v1 → v2：无结构变化（v2 只引入本钩子 + 标量消毒），无需动作。
  // 注：bumperCharges→fertilizerCharges、crop alias 等「补字段级」迁移仍留在
  // init() 内的幂等补丁块，不必搬进来。
  function migrateSave(parsed, from) {
    // if (from < 3) { ... 未来的 v2→v3 迁移写这里 ... }
    return parsed;
  }

  const state = {
    data: null,
    // ---- 会话/落盘安全旗标（audit P0 2026-07-07）----
    _sessionToken: null,   // 本标签页的会话 token（boot 时写入 SESSION_KEY）
    _takenOver: false,     // 另一个标签页已接管 → 本页永久禁止落盘
    _saveBlocked: false,   // 本会话 localStorage 读取曾抛错 → 禁止一切落盘（防覆盖真存档）

    init() {
      // localStorage.getItem itself can THROW (iOS 存储已满 / 被 ITP 清 / 分区隔离 / 私密浏览),
      // 不只是返回 null。此前这行没 try —— 一抛错 init 就中断在 this.data 赋值之前，
      // this.data 永远是 null → 之后每个模块都在 null 上崩（reading 'language'/'map'…），
      // 开屏消失后游戏是死的 = Chris 的「总是卡着」。所以必须 guard 这个「读」，
      // 读失败就当作没存档 → 走全新内存态（本次可正常玩，只是不落地保存），绝不冻死。
      let saved = null;
      try { saved = localStorage.getItem(SAVE_KEY); }
      catch (e) {
        this._storageErr = e;   // 记下异常本身，_warnStorageOnce 要用它上报病因
        // ⚠️ 存档神圣（audit P0 (b)）：「读不到」≠「不存在」。读取一旦抛错，本会话
        // 永久禁止一切 save()（含心跳/mutator/flush）——否则下面的「无存档」分支会
        // 用初始状态覆盖真存档，正是「20 分钟进度静默清零」的根因之一。
        this._saveBlocked = true;
        console.warn('[state] localStorage read blocked — in-memory session, saving DISABLED', e);
      }
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Guard: parsed could be null if saved is the literal string "null"
          // or non-object (corrupted save). Without this check, Object.assign
          // would silently produce a state object missing nested defaults.
          if (!parsed || typeof parsed !== 'object') throw new Error('save not an object');
          // ---- 存档版本钩子（audit P2）----
          const parsedVer = (typeof parsed.version === 'number' && isFinite(parsed.version)) ? parsed.version : 1;
          if (parsedVer > STARTER_STATE.version) {
            // 旧代码读到未来版本存档（PWA 缓存回退时真会发生）：先备份原始串，
            // 再 best-effort 加载——未来字段被丢弃回写时至少有备份可救。
            try { localStorage.setItem(SAVE_KEY + '_backup', saved); } catch (e2) {}
            console.warn('[state] save version ' + parsedVer + ' > code version ' + STARTER_STATE.version + ' — raw save backed up');
          }
          migrateSave(parsed, parsedVer);
          // Object.assign auto-fills any new STARTER fields missing from old saves.
          // DEEP-CLONE the defaults first: otherwise a field present in STARTER but
          // absent from an old save (e.g. orders/warehouse/festivalHarvests/orderEp)
          // is copied BY REFERENCE — mutating this.data.orders would then mutate the
          // module's STARTER_STATE.orders and leak across resets/reloads.
          this.data = Object.assign(JSON.parse(JSON.stringify(STARTER_STATE)), parsed);
          this.data.version = STARTER_STATE.version;   // 迁移完成 → 落到当前版本号
          // ---- 顶层标量类型消毒（audit P2）----
          // corrupted-but-parseable 存档里 coins:"abc" 会被直接接受：HUD 显示 abc、
          // addCoins 变字符串拼接 "abc10" 并回写持久化；level:"x" 让升级永久 NaN。
          // 按 STARTER 的类型校验：数字键 Number()+isFinite，坏值回落默认；
          // 字符串键非 string 回落默认。嵌套对象/数组由下面的既有守卫负责。
          for (const k of Object.keys(STARTER_STATE)) {
            if (k === 'handsUnlockSeen') continue;
            const defVal = STARTER_STATE[k];
            const v = this.data[k];
            if (typeof defVal === 'number') {
              const n = Number(v);
              this.data[k] = isFinite(n) ? n : defVal;
            } else if (typeof defVal === 'string' && typeof v !== 'string') {
              this.data[k] = defVal;
            }
          }
          // Harden core collections against a corrupted-but-parseable save: a null /
          // non-array `plots` or null / non-object `seeds` would otherwise crash
          // migrateCrops() during boot and wedge the player on the splash screen.
          // 空数组同样兜底（audit P2）：plots:[] 会漏过 isArray 守卫 → 零地块进场，
          // 游戏不崩但完全不可玩且会被 save() 持久化成死局。
          if (!Array.isArray(this.data.plots) || this.data.plots.length === 0) this.data.plots = JSON.parse(JSON.stringify(STARTER_STATE.plots));
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
          const fl = this.data.farmerLook | 0;
          this.data.farmerLook = (fl >= 1 && fl <= 9) ? fl : 2;
          sanitizeHands(this.data);
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
              neighborQuestPaid: false,
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
          /* storeDemand 嵌套守卫：Object.assign 只补顶层，
             半个对象（比如只有 day、没有 board）会让后面每一处 .board.forEach 炸掉。
             缺什么补什么，已有的值一律保留。 */
          _fillStoreDemand(this.data);
        } catch (e) {
          console.error('Save corrupted, starting fresh', e);
          // 存档神圣：确认损坏、要放弃之前，先把原始串备份一份（能救就救）。
          try { localStorage.setItem(SAVE_KEY + '_backup', saved); } catch (e2) {}
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
        //
        // ⚠️ 写 starter 前的最后防线（audit P0 (b)）：二次 getItem 确认 key 确实
        // 不存在、且本会话读取从未抛错。「无存档」的判定必须证明存档真不存在，
        // 而不是「刚才没读到」——瞬时读失败时把真存档当无存档覆盖写，就是
        // 「进度静默清零」。确认不了就整会话内存态运行，绝不落盘。
        let confirmNull = null, confirmThrew = false;
        try { confirmNull = localStorage.getItem(SAVE_KEY); } catch (e) { confirmThrew = true; }
        /* 🔒 空串必须当作「没有存档」，不能当作「存档还在」（2026-08-13 修）。
           原来写的是 `confirmNull !== null`，于是值是 `''` 时：
             上面 `if (saved)` 判它「没存档」→ 走到这个分支
             这里 `'' !== null` 又成立   → 判它「存档还在，别覆盖」
           两句话自相矛盾，结果是**存储完全正常的设备被永久禁止落盘**，
           每次刷新都从头开始，还弹一句删不掉的提示。已在浏览器复现。
           本条守卫的本意是「读不到 ≠ 不存在，别拿初始状态覆盖真存档」——
           而空串里没有任何进度可保护，覆盖它零损失。 */
        const confirmHasRealSave = typeof confirmNull === 'string' && confirmNull !== '';
        if (this._saveBlocked || confirmThrew || confirmHasRealSave) {
          this._saveBlocked = true;
          // 这条路径**没有异常**也会走到：saved 是空串 '' 时 `if (saved)` 判它「没存档」，
          // 而这里 `'' !== null` 又成立 → 存储明明好好的，落盘却被永久关掉。
          // 单独标一个病因名，别和真的抛错混在一起（两者的修法完全不同）。
          if (!this._storageErr && !confirmThrew) this._storagePhantom = true;
          console.warn('[state] save key unreadable or reappeared — in-memory session, will NOT write starter over it');
        } else {
          this.save();   // guarded internally; a blocked browser just warns, never throws here
        }
      }
      // 兜底不变量：无论上面存储/迁移出了什么岔子，绝不能让游戏带着 null 状态往下走
      // （null this.data 会让每个模块崩 → 开屏后死机）。任何漏网情形一律回落全新内存态。
      if (!this.data || typeof this.data !== 'object') {
        this.data = JSON.parse(JSON.stringify(STARTER_STATE));
        this.data.sessionStats.date = getDateString();
        this.data.dailyClaims.date = getDateString();
      }
      // 会话接管：声明本标签页为当前唯一写入者（audit P0 (a)）。
      this._claimSession();
    },

    // ============ 会话接管制（多标签页防互相覆盖，audit P0 2026-07-07）============
    // 复现过的事故：两个标签页同时开游戏 → 旧标签页 60s 心跳 save() 把过期状态
    // 整体反写 localStorage，新标签页刚攒的进度静默清零。机制：后开的标签页写入
    // 新 token 接管；先开的标签页经 storage 事件（即时）或 save() 前校验（兜底）
    // 发现被接管 → 永久停止落盘 + 全屏提示「点此刷新接管」。
    _claimSession() {
      try {
        this._sessionToken = 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(SESSION_KEY, this._sessionToken);
      } catch (e) {
        // 存储不可写：本会话本就落不了盘（save() 自身会警告），接管机制无意义。
        this._sessionToken = null;
      }
      if (!this._sessionWatcher) {
        this._sessionWatcher = (e) => {
          if (e && e.key === SESSION_KEY && e.newValue && this._sessionToken && e.newValue !== this._sessionToken) {
            this._markTakenOver();
          }
        };
        try { window.addEventListener('storage', this._sessionWatcher); } catch (e) {}
      }
    },

    _markTakenOver() {
      if (this._takenOver) return;
      this._takenOver = true;
      console.warn('[state] session taken over by another tab/window — saving disabled here');
      this._showTakeoverOverlay();
    },

    _showTakeoverOverlay() {
      try {
        if (document.getElementById('efTakeover')) return;
        const en = (this.data && this.data.language) === 'en';
        const el = document.createElement('div');
        el.id = 'efTakeover';
        el.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(30,22,12,0.78);' +
          'display:flex;align-items:center;justify-content:center;padding:24px;';
        el.innerHTML =
          '<div style="max-width:320px;background:#fffdf7;border-radius:20px;padding:26px 22px;text-align:center;' +
            'font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,0.35);">' +
            '<div style="font-size:44px;line-height:1;">🪟</div>' +
            '<div style="font-size:16px;font-weight:700;margin-top:10px;color:#4a3f2e;">' +
              (en ? 'Game opened in another window' : '游戏已在其他窗口打开') + '</div>' +
            '<div style="font-size:13px;color:#9a8f7d;margin-top:8px;line-height:1.6;">' +
              (en ? 'To protect your save, this window stopped saving progress.'
                  : '为保护你的存档，这个窗口已停止保存进度。') + '</div>' +
            '<button id="efTakeoverReload" style="margin-top:16px;width:100%;padding:13px;border:none;cursor:pointer;' +
              'border-radius:14px;background:linear-gradient(180deg,#4aa563,#3a8c50);color:#fff;font-size:14.5px;' +
              'font-weight:700;font-family:inherit;box-shadow:0 3px 0 #2a6038;">' +
              (en ? 'Reload & keep playing here' : '点此刷新，在这里继续玩') + '</button>' +
          '</div>';
        document.body.appendChild(el);
        const btn = document.getElementById('efTakeoverReload');
        if (btn) btn.onclick = () => location.reload();
      } catch (e) { /* DOM 不可用（极早期）——save() 的早退保护仍然生效 */ }
    },

    /* 腾空间：只删**可再生**的数据，按「丢了最不心疼」的顺序来。
       🔒 绝不碰 SAVE_KEY 和 SESSION_KEY —— 前者是玩家进度，后者是多标签页
       防覆盖的凭据（删了会让另一个标签页误判接管，反而毁存档）。
       返回是否真的腾出了空间（没腾出就别白重试一次）。 */
    _reclaimStorage() {
      let freed = 0;
      // ① 积分同步队列 —— 实测就是它撑满的；服务端有 eventId 去重，重发安全
      try {
        if (window.Farm && Farm.fbQueue && Farm.fbQueue.reclaim) freed += Farm.fbQueue.reclaim();
      } catch (e) {}
      // ② 纯缓存性质的键，删了下次自动重新生成/重新拉
      const regenerable = [
        'eastern_farm_weather_v2',   // 天气缓存
        'ef_wc_live_snap_v1',        // 世界杯实时快照（赛事已于 2026-07 退场）
        'wc2026_prefs_v1',           // 世界杯偏好
      ];
      for (const k of regenerable) {
        try {
          const raw = localStorage.getItem(k);
          if (raw !== null) { freed += (k.length + raw.length) * 2; localStorage.removeItem(k); }
        } catch (e) {}
      }
      /* ③ 世界杯抽奖遗留键：`wc_lotto_rv_<uid>_<matchId>` / `wc_lotto_cr_...`
         **一场比赛一个键、从来不清理**（worldcup.js），是典型的「键数量无界」
         写法。赛事 2026-07-31 已收尾兑奖截止，这些键对现在的游戏毫无用处。
         按前缀扫掉。⚠️ 必须先收集再删 —— 边遍历 localStorage 边 removeItem
         会让索引错位、漏掉一半。 */
      try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.indexOf('wc_lotto_rv_') === 0 || k.indexOf('wc_lotto_cr_') === 0)) doomed.push(k);
        }
        for (const k of doomed) {
          const raw = localStorage.getItem(k);
          if (raw !== null) { freed += (k.length + raw.length) * 2; localStorage.removeItem(k); }
        }
      } catch (e) {}
      // ③ 最后手段：存档的**备份**副本。主存档写得进去比留着备份重要 ——
      //    备份的意义是「主存档坏了能救」，而现在的处境是主存档根本写不进去。
      if (freed === 0) {
        try {
          const raw = localStorage.getItem(SAVE_KEY + '_backup');
          if (raw !== null) { freed += raw.length * 2; localStorage.removeItem(SAVE_KEY + '_backup'); }
        } catch (e) {}
      }
      if (freed > 0) console.warn('[state] 腾出约 ' + Math.round(freed / 1024) + ' KB');
      return freed > 0;
    },

    // 「这台设备存不下进度」一次性提示（读取抛错 / setItem 抛错共用）。
    _warnStorageOnce() {
      if (this._saveWarned) return;
      this._saveWarned = true;
      /* 🔍 上报病因（2026-08-13 加）——在此之前，「客人存不下进度」这件事
         **一个数都没有**，只能靠 Chris 打电话说他看见了那句提示。而这三种
         情况的修法完全不同，猜错就白修一轮：
           quota    → 真的满了 → 该给缓存/存档减负
           security → Cookie 被拦 / 无痕 / App 内置浏览器隔离 → 减负没用
           phantom  → 存储是好的，是我们自己的判定把落盘关掉了（空串路径）
         无 PII，只累加计数器。埋点永远不许影响游戏，整段包在 try 里。 */
      try {
        const err = this._storageErr;
        const name = err && err.name ? String(err.name) : '';
        let ev = 'storage_err_other';
        if (this._storagePhantom) ev = 'storage_err_phantom';
        else if (/quota|full/i.test(name + ' ' + (err && err.message || ''))) ev = 'storage_err_quota';
        else if (/security/i.test(name)) ev = 'storage_err_security';
        if (window.__efTrack) window.__efTrack(ev);
      } catch (e) { /* 埋点失败绝不影响游戏 */ }
      // 延后一拍再弹：让 Firebase 登录先解析出 memberDoc，好决定给哪版文案。
      // 已登录会员的进度实时同步在云端（members.gameStats，换设备也不丢）→ 本地存不下
      // 不等于丢进度，给「安心版」，别把会员吓着（Chris 手机 iOS Safari 存储受限，
      // 但他是登录会员，Lv7 存在云端）。游客只有本地存档 → 保留「提醒版」。
      setTimeout(function () {
        if (!(window.Farm && Farm.ui && Farm.ui.toast)) return;
        var isMember = !!(window.Farm && Farm.fbAuth && Farm.fbAuth.memberDoc);
        // 文案要短（Chris 阻塞项 #5）：一屏小字念不完的提示等于没提示。
        // 自愈（_reclaimStorage）成功时根本走不到这里，所以这句只对
        // 「真的写不进去」的设备说话；点一下即可关掉（ui.toast 全局支持）。
        var en = (Farm.state && Farm.state.data && Farm.state.data.language) === 'en';
        if (isMember) {
          Farm.ui.toast(en ? 'Progress is safe in the cloud (this device cannot save locally)'
                           : '进度已存云端 ✓ 本机暂时存不了，不影响玩', 6000);
        } else {
          // 游客只有本地存档 → 引导登录（登录=进度上云）
          Farm.ui.toast(en ? 'Sign in to save your progress to the cloud'
                           : '登录一下，进度就能存到云端 🌱', 6000);
        }
      }, 3500);
    },

    save() {
      // ---- 落盘安全闸（audit P0 2026-07-07）----
      // 0) 🔒 拜访模式(2026-08-14 共享世界): Farm.state.data 此刻指向**邻居家的
      //    伪状态**(isoView.enterVisitFarm 换的), 落盘会把别人的农场写进我的存档。
      //    拜访期间一切写入冻结, 退出拜访(exitVisitFarm)恢复真身后才解冻。
      if (this._visitLock) return;
      // 1) 会话已被其他标签页接管 → 本页任何落盘都是用过期状态覆盖新进度，拒绝。
      if (this._takenOver) return;
      // 2) 本会话读取存档曾抛错（内存态会话）→ 禁止一切落盘，防覆盖真存档。
      if (this._saveBlocked) { this._warnStorageOnce(); return; }
      // 3) 落盘前校验会话 token（storage 事件可能没送达：页面被冻结后恢复等），
      //    token 被别的标签页换掉 = 已被接管。token 读不到（抛错/为空）不视为
      //    接管——那是存储不可用，由下面 setItem 的 catch 诚实处理。
      if (this._sessionToken) {
        let cur = null, readOk = true;
        try { cur = localStorage.getItem(SESSION_KEY); } catch (e) { readOk = false; }
        if (readOk && cur && cur !== this._sessionToken) { this._markTakenOver(); return; }
      }
      // Warn ONLY when setItem genuinely throws (iOS Private Browsing quota=0,
      // storage blocked/full). A read-back mismatch is NOT used as a trigger —
      // a concurrent save (heartbeat/toast re-entry) can momentarily differ and
      // would false-warn a healthy browser. Cross-session non-persistence is
      // detected separately by the boot probe in main.js.
      try {
        this.data.lastSavedAt = Date.now();   // stamp before serialize (cloud restore compares this)
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      } catch (e) {
        /* 🔒 存储满了要**自愈**，不是弹一句话就算完（2026-08-13）。
           改之前是「抛错 → 弹一句删不掉的提示 → 进度从此不再保存」，
           而 Chris 手机实测的真相是：localStorage 那个 5MB 桶被
           `eastern_farm_sync_queue_v1` 撑满了，存档自己才 4KB ——
           完全有空间可腾，我们却选择了放弃。
           所以：先清掉**可再生**的东西，再重试一次。成功了就当无事发生
           （连提示都不该弹，玩家根本不需要知道）。 */
        if (this._reclaimStorage()) {
          try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
            console.warn('[state] 存储已满 → 清理可再生数据后重试成功');
            if (window.__efTrack) { try { window.__efTrack('storage_recovered'); } catch (_) {} }
            return;   // 自愈成功：不标 _saveBlocked、不弹提示
          } catch (e2) { e = e2; }
        }
        console.error('Save failed', e);
        if (!this._storageErr) this._storageErr = e;   // 写失败的异常同样要上报病因
        this._warnStorageOnce();
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

    // 农场视图只剩 iso 一套（2026-08-11 三渲染器收编）。
    //
    // 历史：曾并存 iso（Hay Day 等距，默认）/ topdown（俯视像素，mapview.js）/
    // classic（经典竖排，退回 DOM 网格），玩家能在 ⓘ 指南里切。问题是所有手感修复
    // ——命中盒、聚光灯引导、相机惯性、按压高亮、首屏构图——都只做在 iso 上，
    // 另两套是「能进去但明显更差」的体验，还得永远跟着一起维护。
    // 收编前查过云存档：**6/6 全是 iso，没有任何玩家选过另外两套**，所以零迁移代价。
    //
    // 🔒 存档神圣：`farmStyle` 字段**保留不删**（老存档带 'topdown'/'classic' 照样能读），
    // 这里只做值收敛 —— 一律解析成 'iso'。要恢复多视图，改回这个函数 + 从 git 历史
    // 50a5424 取回 mapview.js 与 guide.js 的画风切换器即可。
    farmStyle() {
      return 'iso';
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
      // 坏/空 plots 的云端 blob 与 init() 同一守卫（audit P2）：否则零地块死局被本地持久化。
      if (!Array.isArray(merged.plots) || merged.plots.length === 0) merged.plots = JSON.parse(JSON.stringify(STARTER_STATE.plots));
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
      sanitizeHands(this.data);
      if (!(Farm.state && Farm.state._visitLock) && Farm.hands && Farm.hands.syncFromSave) {
        Farm.hands.syncFromSave();
      }
      // Daily/session rollover if the restored blob predates today.
      const today = getDateString();
      if (!this.data.sessionStats || this.data.sessionStats.date !== today) {
        this.data.sessionStats = { date: today, planted: {}, harvested: {}, coinsEarned: 0, seedsBought: 0, coinsSpent: 0 };
      }
      if (!this.data.dailyClaims || this.data.dailyClaims.date !== today) {
        this.data.dailyClaims = {
          date: today, lotterySpunFree: false, neighborsVisited: [], neighborQuestPaid: false, newsRead: false,
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
              /* 🔒 回滚了就得说一声（2026-08-15 审阅第 1/2 条的共同尾巴）
                 之前是「飘字显示 +N，后台悄悄扣回去」—— 玩家看到的是一个不存在的到账。
                 每次登录只提示一次，避免连续收获时刷屏。 */
              if (!this._epRejectNoticed && window.Farm && Farm.ui && Farm.ui.toast) {
                this._epRejectNoticed = true;
                const en2 = this.data.language === 'en';
                Farm.ui.toast(r.code === 429
                  ? (en2 ? '⏳ Daily store-point limit reached — that bonus was not credited'
                         : '⏳ 今日超市积分已达上限，这笔没能入账')
                  : (en2 ? '⚠️ That point bonus could not be credited'
                         : '⚠️ 这笔超市积分没能入账'), 3600);
              }
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
      /* 🔒 待激活账号（邮箱注册、还没到店激活）的分是「待领取」，不是余额 ——
         到店激活入账之前没有可花的钱（spec 2026-08-20）。以前本地照扣、服务端
         404 不认、下一笔挣分的响应又把数刷回来 = 花多少长回多少
         （登录审查 🟠 J，2026-09-06）。 */
      if (window.Farm && Farm.fbAuth && Farm.fbAuth.memberDoc && Farm.fbAuth.memberDoc._pending) {
        if (Farm.ui && Farm.ui.toast) {
          Farm.ui.toast(this.data.language === 'en'
            ? 'These points are waiting for you. Activate your membership at the store to use them.'
            : '这些是待领取积分，到店激活成会员后就能用。', 3600);
        }
        return false;
      }
      if (this.data.eastPoints < n) return false;
      this.data.eastPoints -= n;
      this.save();
      // Mirror to member account if logged in (optimistic + queue on failure)
      if (window.Farm && Farm.fbAuth && Farm.fbAuth.isLoggedIn() && Farm.fbPoints) {
        const sync = Farm.fbPoints.syncEpSpend(n, opts.source || 'unknown', opts.description || '');
        if (sync && sync.then) {
          sync.then((r) => {
            /* 服务端明确拒绝（409 待激活 / 422 余额不够）= 那边一分没扣。
               本地不加回去，屏上就是一笔不存在的扣款，下次同步又跳回来。
               网络/5xx 已进队列重试，不算拒绝。 */
            if (r && r.rejected && (r.code === 409 || r.code === 422)) {
              this.data.eastPoints += n;
              this.save();
              if (window.Farm && Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
              if (window.Farm && Farm.ui && Farm.ui.toast) {
                Farm.ui.toast(this.data.language === 'en'
                  ? 'That points spend did not go through. The points are back in your balance.'
                  : '这笔积分没有扣成，已经退回。', 3600);
              }
            }
          });
        }
      }
      // Reflect new balance in topbar immediately (callers no longer need to)
      if (window.Farm && Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      return true;
    },

    // Bidirectional 10:1 exchange.
    // exchangeCoinsToEp(coinAmt): 10 coins → 1 EP; respects daily cap (overflow queues)
    // exchangeEpToCoins(epAmt):    1 EP → 10 coins; no cap (player spending their own)
    // 10 农场币 = 1 超市积分。唯一出处：兑换、退币（含 firebase-queue 的排队补发）都用它。
    COINS_PER_EP: 10,
    exchangeCoinsToEp(coinAmt) {
      coinAmt = Math.floor(coinAmt / this.COINS_PER_EP) * this.COINS_PER_EP;  // round to multiple of 10
      if (coinAmt <= 0) return { ok: false, reason: 'too_small' };
      if (this.data.coins < coinAmt) return { ok: false, reason: 'insufficient_coins' };
      this.data.coins -= coinAmt;
      const epAmount = coinAmt / this.COINS_PER_EP;
      const result = this.addEastPoints(epAmount, {
        source: 'coin_exchange',
        description: 'Exchange ' + coinAmt + ' farm coins → ' + epAmount + ' points',
      });
      // If the server rejects the points earn (e.g. daily cap reached), refund
      // the coins so the player isn't charged for points they didn't get.
      if (result.sync && result.sync.then) {
        result.sync.then((res) => {
          /* 待激活账号有**总额**封顶：服务端可能只记一部分（甚至 0），
             而且是 **200 成功**返回，不走下面那条 429 分支。
             不按实际记上的分退币的话，币扣了分没给 —— 就是偷东西
             （spec 不变量 5，2026-08-20）。 */
          if (res && res.synced && typeof res.credited === 'number' && res.credited < epAmount) {
            const refund = (epAmount - res.credited) * this.COINS_PER_EP;
            if (refund > 0) {
              this.data.coins += refund;
              this.save();
              if (window.Farm && Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
              const lg = this.data.language;
              if (window.Farm && Farm.ui) {
                Farm.ui.toast(res.credited === 0
                  ? (lg === 'en' ? 'Points are already full — coins returned'
                                 : '待领取积分已攒满，农场币已退回')
                  : (lg === 'en' ? `Only ${res.credited} points fit — the rest of your coins are back`
                                 : `只换进了 ${res.credited} 分，其余农场币已退回`), 3500);
              }
            }
            return;
          }
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
      const coinAmount = epAmt * this.COINS_PER_EP;
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
    // Shared extra-plot economy (B5). Both coin purchase entries call these.
    EXTRA_PLOT_CAP,
    extraPlotCoinCost() {
      const n = (this.data && this.data.extraPlots) || 0;
      return EXTRA_PLOT_COSTS[Math.min(n, EXTRA_PLOT_COSTS.length - 1)];
    },
    extraPlotCapReached() {
      return ((this.data && this.data.extraPlots) || 0) >= EXTRA_PLOT_CAP;
    },
    // Append one bought plot. `opts.gx/gy` place it on a specific owned cell
    // (iso build menu); omitted → iso auto-places via _buildLayout. Does NOT
    // charge coins/EP — the caller spends first, then calls this.
    addExtraPlot(opts) {
      opts = opts || {};
      if (this.data.extraPlots >= EXTRA_PLOT_CAP) return false;
      this.data.extraPlots += 1;
      // Unique id = max existing id + 1 (plots[] can already exceed 12 from
      // level unlocks, so the old `12 + extraPlots - 1` could collide).
      const newId = this.data.plots.reduce((m, p) => Math.max(m, p.id || 0), -1) + 1;
      const plot = { id: newId, crop: null, plantedAt: 0, harvestsLeft: 0, unlocked: true };
      if (Number.isInteger(opts.gx) && Number.isInteger(opts.gy)) { plot.gx = opts.gx; plot.gy = opts.gy; }
      this.data.plots.push(plot);
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

    /* 🗑 deliverWarehouse() 已于 2026-08-22 删除：东方超市不再无限收购，
       卖菜只能按订单供货（store-demand.js + orders.js）。
       原来挂在它身上的两样东西已各自搬家：
         · totalDeliveries 自增 → orders.fulfill()
         · 每日首单 +20% (dailyClaims.firstDeliveryDone) → orders.fulfill()
       别再加回一个「一键卖光」的函数。 */

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
