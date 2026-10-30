/**
 * 今晚吃什么 · 纯规则。浏览器和 node 测试共用。
 * 不碰 DOM、不碰网络。服务器核销要复用同一套判断，见 dinner/dinnerClaim.ts。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DinnerRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EPOCH = '2026-01-01';
  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function reginaDate(now) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Regina',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(now instanceof Date ? now : new Date(now));
  }

  function reginaWeekday(now) {
    const name = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Regina',
      weekday: 'short',
    }).format(now instanceof Date ? now : new Date(now));
    return WEEKDAYS[name];
  }

  function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return dt.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    const ua = Date.parse(a + 'T00:00:00Z');
    const ub = Date.parse(b + 'T00:00:00Z');
    return Math.round((ub - ua) / 86400000);
  }

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  /** 今天若是周六，就是今天；否则是接下来的那个周六。日期都是萨省日历日。 */
  function comingSaturday(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = dt.getUTCDay();
    const add = day === 6 ? 0 : (6 - day);
    dt.setUTCDate(dt.getUTCDate() + add);
    return dt.toISOString().slice(0, 10);
  }

  function pickDish(menu, now) {
    const today = reginaDate(now);
    const closed = reginaWeekday(now) === 0;
    const playDate = closed ? addDays(today, 1) : today;
    const dishes = menu.dishes || [];
    if (!dishes.length) throw new Error('menu has no dishes');
    const index = mod(daysBetween(EPOCH, playDate), dishes.length);
    const dish = dishes[index];
    if (!dish.in.includes(dish.coupon)) throw new Error('coupon ingredient missing: ' + dish.id);
    return { today, playDate, closed, dish, index };
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 同一道菜、同一个 seed，顺序永远一样。服务器用它核对客户端没有换牌。 */
  function orderOf(dish, seed) {
    const arr = dish.in.concat(dish.out);
    const rand = mulberry32(seed >>> 0);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function judge(dish, picks) {
    const shouldTake = new Set(dish.in);
    const total = dish.in.length + dish.out.length;
    const list = Array.isArray(picks) ? picks : [];
    let correct = 0;
    for (let i = 0; i < total; i++) {
      const p = list[i];
      if (!p) continue;
      if (shouldTake.has(p.id) === !!p.take) correct++;
    }
    let stars = 0;
    if (correct === total) stars = 3;
    else if (correct >= total - 2) stars = 2;
    else if (correct >= Math.ceil(total / 2)) stars = 1;
    return {
      correct,
      total,
      stars,
      dollar: stars >= 2,
      raffle: stars === 3,
      couponId: dish.coupon,
    };
  }

  /**
   * 发券政策。纯函数，方便在没有 Firestore 时先测清楚。
   * input: { stars, today, lastDollarYmd, issuedToday, dailyCap, pending, hasAccount }
   * pending: null | { fromDate }
   */
  function evaluateClaim(input) {
    const cap = input.dailyCap;
    const weeklyOk = !input.lastDollarYmd || daysBetween(input.lastDollarYmd, input.today) >= 7;
    const raffle = input.stars === 3;
    if (!input.hasAccount) {
      return { action: input.stars >= 2 ? 'need_login' : 'none', raffle: input.stars >= 2 && raffle };
    }
    if (input.pending && input.pending.fromDate < input.today && weeklyOk) {
      if (input.issuedToday < cap) return { action: 'issue', source: 'pending', raffle };
      return { action: 'keep_pending', raffle };
    }
    if (input.stars < 2) return { action: 'none', raffle: false };
    if (!weeklyOk) return { action: 'weekly_used', raffle };
    if (input.issuedToday >= cap) return { action: 'defer', raffle };
    return { action: 'issue', source: 'today', raffle };
  }

  return {
    EPOCH,
    reginaDate,
    reginaWeekday,
    addDays,
    daysBetween,
    comingSaturday,
    pickDish,
    orderOf,
    judge,
    evaluateClaim,
  };
});
