/**
 * store-demand.js — 东方超市的需求（纯逻辑，2026-08-22）
 *
 * 起因（Chris）：「如果东方超市不再无限收购，怎样使玩家仍然有生产动力。
 * 改变销售模式，只能根据东方超市的订单供货，不再是自己想卖什么就能卖。」
 *
 * 三层需求：
 *   ① 每日基础补货 —— 每天 2–3 样、**各自限量**、1.0×。收入地板，防止卡死。
 *      有量的上限，所以它不是「无限收购」换个皮：卖完就没了。
 *   ② 不定期订单   —— 随机时刻到达，1–3 种菜，1.5–2.2×。主收入。
 *   ③ 大单         —— 少见，3–5 种、≥2.5×，可带超市积分。值得专门备货。
 *
 * 🔒 **这个模块不碰 DOM、不读任何全局状态**：所有输入走 ctx 参数，随机数也注入。
 * 理由不是洁癖 —— 「新模式日收入不得低于旧模式」这条产品承诺只能靠模拟验证
 * （见 store-economy-sim.mjs），而模拟不可能在浏览器里跑。逻辑一旦缠上
 * Farm.state / document 就再也标定不了了。
 *
 * ctx = {
 *   now, level, plots, crops[], grown[], saleCropIds[], dayStrings[],
 *   isInSeason(def), sellPriceOf(def), rand()  // rand() ∈ [0,1)
 * }
 */
(function () {
  /* 🔒 下面这几个数是 store-economy-sim.mjs 标定出来的，不是拍脑袋。
     改任何一个都必须重跑模拟 —— 它们直接决定新经济是紧还是松。 */
  const STAPLE_RATIO = 0.6;                 // 基础补货配额 = 日产能 × 此系数
  const ACCEPT_CAP = 3;                     // 同时能接几单（「不能想卖什么就卖什么」的另一半）
  const BOARD_CAP = 5;                      // 板上最多挂几单
  const LIFE_MIN_H = 3, LIFE_MAX_H = 8;     // 订单有效期
  const GAP_MIN_M = 40, GAP_MAX_M = 150;    // 两波出单之间
  const PREMIUM_MIN = 1.5, PREMIUM_MAX = 2.2;
  const BIG_PREMIUM = 2.6;                  // 大单（必须 ≥2.5，测试钉住）
  const SALE_WEIGHT = 4;                    // 真店特价/应季的作物，出单权重
  const FORECAST_DAYS = 5;                  // 预告未来几天（3–7）
  const STAPLE_MIN = 4;                     // 配额下限，免得新号地少时是 0

  const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));

  /* 一天实际能收几茬 = min(生长时间允许的茬数, 玩家上线次数)。
     🔒 **必须带上线次数**：最快的菜 5 分钟一茬，理论一天 168 茬，但一天上线
     3 次的人最多收 3 次。只按生长时间算，配额会虚高到实际产量的好几倍，
     于是产出几乎全被 1.0× 的基础补货吃掉、拿不到订单溢价 —— 经济模拟里
     高等级大农场因此只有旧模式的 0.75×（扩地反而受罚）。 */
  function dailyCycles(def, sessions) {
    const mins = Math.max(5, def.grow_minutes || 60);
    const byTime = Math.max(1, Math.floor((14 * 60) / mins));
    const s = Math.max(1, sessions || 3);
    return Math.max(1, Math.min(byTime, s));
  }

  // 候选池：已解锁 ∩（种过的优先）。种过的不足 2 种就用全部已解锁，
  // 免得新号一张单都出不来。口径抄 orders.js._candidatePool，保持一致。
  function basePool(ctx) {
    const lvl = ctx.level || 1;
    const unlocked = (ctx.crops || []).filter((c) => (c.unlock_level || 1) <= lvl);
    if (!unlocked.length) return [];
    const grown = ctx.grown || [];
    const grownUnlocked = unlocked.filter((c) => grown.indexOf(c.id) >= 0);
    return grownUnlocked.length >= 2 ? grownUnlocked : unlocked;
  }

  // 加权池：真店在特价、或当季的作物多放几份，抽中概率就高
  function weightedPool(ctx) {
    const pool = basePool(ctx);
    const sale = ctx.saleCropIds || [];
    const out = [];
    for (let i = 0; i < pool.length; i++) {
      const def = pool[i];
      const boosted = sale.indexOf(def.id) >= 0 || (ctx.isInSeason && ctx.isInSeason(def));
      const times = boosted ? SALE_WEIGHT : 1;
      for (let k = 0; k < times; k++) out.push(def);
    }
    return out;
  }

  /* 从加权池里取 n 个**不重复**的作物：加权、无放回。
     ⚠️ 别改回「随机抽中重复就重抽」的写法 —— 那种在 rand() 退化（测试里
     常给常数）或池子里只有两三样时会空转到 guard 上限，最后只返回 1 样。
     无放回每轮必定产出一个，n 轮结束，与 rand 的质量无关。 */
  function pickDistinct(weighted, n, rand) {
    const bag = weighted.slice();
    const out = [];
    while (out.length < n && bag.length) {
      const i = Math.min(bag.length - 1, Math.floor(clamp01(rand()) * bag.length));
      const def = bag[i];
      out.push(def);
      for (let k = bag.length - 1; k >= 0; k--) if (bag[k].id === def.id) bag.splice(k, 1);
    }
    return out;
  }

  const storeDemand = {
    STAPLE_RATIO, ACCEPT_CAP, BOARD_CAP, PREMIUM_MIN, PREMIUM_MAX, FORECAST_DAYS,

    /* ① 每日基础补货。
       🔒 **必有一样是玩家谷仓里最多的那种菜**（ctx.stockTop）。
       这是整套设计的防卡死地板：店里天天要的东西，总得有一样是你手上有的 ——
       真实的店问供货商「你手上有什么」本来也是这个顺序。
       没有这一条的话，只种一样冷门贵菜、又不看订单板的玩家会被打到旧收入的
       **17%**（经济模拟实测）—— 那不是「教他看订单」，那是把人赶走。
       稀缺性仍在：配额有上限、只给 1.0× 原价、拿不到订单溢价。 */
    makeStaples(ctx) {
      const weighted = weightedPool(ctx);
      const count = 2 + (clamp01(ctx.rand()) < 0.5 ? 1 : 0);   // 2 或 3 样
      const picks = pickDistinct(weighted, count, ctx.rand);
      const top = (ctx.stockTop || []).filter((id) => (ctx.crops || []).some((c) => c.id === id))[0];
      if (top && !picks.some((d) => d.id === top)) {
        picks[picks.length - 1] = (ctx.crops || []).filter((c) => c.id === top)[0];
      }
      const plots = Math.max(1, ctx.plots || 1);
      return picks.map((def) => ({
        cropId: def.id,
        need: Math.max(STAPLE_MIN, Math.round(plots * dailyCycles(def, ctx.sessionsPerDay || ctx.sessions) * STAPLE_RATIO)),
        filled: 0,
      }));
    },

    // ② / ③ 一张订单。forceKind:'big' 可强制大单（测试与节庆用）
    makeOrder(ctx) {
      const weighted = weightedPool(ctx);
      if (!weighted.length) return null;
      const level = ctx.level || 1;
      const isBig = ctx.forceKind === 'big';

      let lineCount;
      if (isBig) {
        lineCount = 3 + Math.floor(clamp01(ctx.rand()) * 3);          // 3–5
      } else {
        const r = clamp01(ctx.rand());
        lineCount = r < 0.45 ? 1 : (r < 0.8 ? 2 : 3);                 // 1–3
      }
      const chosen = pickDistinct(weighted, lineCount, ctx.rand);
      if (!chosen.length) return null;

      /* 单量按**玩家真实的日产能**定：plots × 这作物一天能收几茬。
         🔒 两个都不能少：
           · 少了 plots → 大农场产得出卖不掉，扩地反而受罚（模拟 0.86×）
           · 少了「一天能收几茬」→ 25 块地但一天只上线一次的人，产能只有 25，
             却收到要 42 棵的单；订单是全有或全无，于是几乎单单都交不出去
             （模拟 0.22×）。这是最隐蔽的一个坑。
         0.22 这个系数：一张单大约吃掉当天该作物产能的两成，几张单加起来
         正好和基础补货一起把产量吃干净，又不至于多到交不出。 */
      const plots = Math.max(1, ctx.plots || 6);
      const sess = ctx.sessionsPerDay || ctx.sessions;
      const qtyBonus = Math.min(3, Math.floor(level / 6));
      const items = chosen.map((def) => {
        const capacity = plots * dailyCycles(def, sess);
        const cap = Math.max(2, Math.min(20, Math.round(capacity * 0.22))) + qtyBonus + (isBig ? 3 : 0);
        return { cropId: def.id, qty: 1 + Math.floor(clamp01(ctx.rand()) * cap) };
      });

      const bulk = items.reduce((s, it) => {
        const def = (ctx.crops || []).filter((c) => c.id === it.cropId)[0];
        return s + (def ? (def.sell_price || 0) * it.qty : 0);
      }, 0);

      const spread = PREMIUM_MIN + clamp01(ctx.rand()) * (PREMIUM_MAX - PREMIUM_MIN);
      const premium = isBig ? BIG_PREMIUM : spread;
      const variety = 1 + (items.length - 1) * 0.08;
      const coins = Math.max(5, Math.round(bulk * premium * variety));

      const totalQty = items.reduce((s, it) => s + it.qty, 0);
      const xp = Math.max(4, totalQty * 3 + (items.length - 1) * 4);

      // 超市积分保持稀缺（真金）。大单更可能带，但日上限仍由调用方的 _epState 卡死。
      let points = 0;
      const pr = clamp01(ctx.rand());
      if (isBig) points = pr < 0.6 ? 2 : 1;
      else if (items.length >= 3 && pr < 0.4) points = 2;
      else if (pr < 0.22) points = 1;

      const lifeH = LIFE_MIN_H + clamp01(ctx.rand()) * (LIFE_MAX_H - LIFE_MIN_H);
      const now = ctx.now || 0;
      return {
        id: 'od_' + now.toString(36) + '_' + Math.floor(clamp01(ctx.rand()) * 1e6).toString(36),
        kind: isBig ? 'big' : 'regular',
        items, coins, xp, points,
        postedAt: now,
        expiresAt: now + Math.round(lifeH * 3600000),
        accepted: false,
      };
    },

    /* 备货预告：提前告诉玩家未来几天要什么。
       🔒 这是整套设计的灵魂 —— 没有预告，随机订单就是「种了没人要」的惩罚；
       有了预告，它变成备货游戏，而「备货」正是「按订单供货」的实质。
       🔒 日期串由 ctx.dayStrings 注入，模块内绝不 new Date()：萨省 UTC-6，
       自己算日界必错一天（项目铁律），而且 node 与浏览器会给出不同结果。 */
    makeForecast(ctx) {
      const days = (ctx.dayStrings || []).slice(0, FORECAST_DAYS);
      const weighted = weightedPool(ctx);
      const sale = ctx.saleCropIds || [];
      return days.map((date) => {
        const picks = pickDistinct(weighted, 2, ctx.rand);
        const ids = picks.map((d) => d.id);
        const why = ids.some((id) => sale.indexOf(id) >= 0) ? 'sale' : 'season';
        return { date: date, cropIds: ids, reason: why };
      });
    },

    nextPostDelay(rand) {
      return Math.round((GAP_MIN_M + clamp01(rand()) * (GAP_MAX_M - GAP_MIN_M)) * 60000);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.storeDemand = storeDemand;
})();
