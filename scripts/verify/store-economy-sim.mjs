// 经济标定（2026-08-22）。用**真实 crops.json** 跑 7 天，验证订单制没有把玩家收入砍掉。
//
// 🔒 产品承诺：照着预告备货的玩家，新模式（只能按订单卖）的收入不得低于
//    旧模式（无限收购）。不成立的话玩家体感就是「被砍了一刀」——本次最大的风险。
// 🔒 随手乱种的玩家会少赚（**这正是设计意图**，否则「按订单供货」就没有意义），
//    但绝不能被打死：仍要有明显为正的收入。
//
// ⚠️ 两条建模教训（都真的踩过，写这儿免得以后又踩）：
//  ① **产量的瓶颈是登录次数，不是生长时间。** 最快的菜 5 分钟一茬（理论一天 168 茬），
//     一天上线 3 次的人最多收 3 次。需求量按理论茬数定会大到跟无限收购没区别；
//     订单量按理论茬数定又会大到玩家根本交不出（订单是全有或全无）。
//  ⚠️ 本模拟**不覆盖 ACCEPT_CAP（接单上限）**：这里的瓶颈是店家一天贴几张单，
//     把上限调到 99 结果一模一样。接单上限管的是「取舍」这件事，属于行为，
//     由闸门 L 的浏览器 E2E 负责，别以为跑了模拟就保住了它。
//
//  ② **必须按多天算。** 卖不掉的菜不是废了，是留在谷仓等明天的单 —— 这套经济的
//     本质就是「囤货 + 履约」。只测一天会系统性低估新模式：早先那版单日模型把
//     大农场算成 0.22×，其实只是当天没出货而已。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function loadModule(rel) {
  const ctx = { Math, Date, JSON, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(join(root, rel), 'utf8'), ctx);
  return ctx.Farm;
}
const SD = loadModule('src/js/store-demand.js').storeDemand;

const RAW = JSON.parse(fs.readFileSync(join(root, 'data/crops.json'), 'utf8')).crops;
const ALL = Array.isArray(RAW) ? RAW : Object.keys(RAW).map((k) => RAW[k]);
const byId = {};
ALL.forEach((c) => { byId[c.id] = c; });

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WAKING_MIN = 14 * 60;
const DAYS = 7;

function cyclesPerDay(def, sessions) {
  const byTime = Math.floor(WAKING_MIN / Math.max(5, def.grow_minutes || 60));
  return Math.max(0, Math.min(byTime, sessions));
}

function ctxFor(level, plots, sessions, grown, rand) {
  return {
    now: 1700000000000, level, plots, sessions, sessionsPerDay: sessions, crops: ALL,
    grown, saleCropIds: [], dayStrings: ['d1', 'd2', 'd3', 'd4', 'd5'],
    isInSeason: () => false, sellPriceOf: (d) => d.sell_price, rand,
  };
}

function demandOfDay(ctx, sessions, rand) {
  const staples = SD.makeStaples({ ...ctx, rand });
  const waves = Math.min(5, sessions * SD.ACCEPT_CAP);
  const orders = [];
  for (let i = 0; i < waves; i++) {
    const o = SD.makeOrder({ ...ctx, rand });
    if (o) orders.push(o);
  }
  return { staples, orders };
}

// 备货型的地块分配：先按订单量种够（订单给溢价），再种基础补货，余下压在补货作物上。
// ⚠️ 别改回「按需求量比例平摊」：订单量小、补货量大，比例分会把一堆地投到只要
// 几棵的订单作物上，多出来的压在仓里 —— 那是模型里的玩家不会分配，不是设计问题。
function allocate(plots, sessions, demand, fallback) {
  const harvest = {};
  let free = plots;
  const plant = (cropId, n) => {
    if (n <= 0 || free <= 0) return;
    const take = Math.min(n, free);
    free -= take;
    harvest[cropId] = (harvest[cropId] || 0) + take * cyclesPerDay(byId[cropId], sessions);
  };
  const plotsFor = (cropId, qty) =>
    Math.ceil(qty / Math.max(1, cyclesPerDay(byId[cropId], sessions)));

  const orderNeed = {};
  demand.orders.forEach((o) => o.items.forEach((it) => {
    orderNeed[it.cropId] = (orderNeed[it.cropId] || 0) + it.qty;
  }));
  Object.keys(orderNeed).forEach((id) => plant(id, plotsFor(id, orderNeed[id])));
  demand.staples.forEach((s) => plant(s.cropId, plotsFor(s.cropId, s.need)));
  let guard = 0;
  while (free > 0 && demand.staples.length && guard < 400) {
    plant(demand.staples[guard % demand.staples.length].cropId, 1);
    guard++;
  }
  if (!Object.keys(harvest).length) {
    for (let i = 0; i < plots; i++) {
      const def = fallback[i % fallback.length];
      harvest[def.id] = (harvest[def.id] || 0) + cyclesPerDay(def, sessions);
    }
  }
  return harvest;
}

const priceOf = (id) => byId[id].sell_price || 0;
const totalValue = (bag) => Object.keys(bag).reduce((s, id) => s + priceOf(id) * bag[id], 0);

// 新模式的一天：补货(1.0×) → 订单(溢价) → 菜摊(1.45×)；卖不掉的留在谷仓等明天
function sellDay(stock, demand, sessions, tally) {
  let income = 0;
  for (const s of demand.staples) {
    const take = Math.min(stock[s.cropId] || 0, s.need);
    if (take > 0) {
      const v = take * priceOf(s.cropId);
      income += v; stock[s.cropId] -= take;
      if (tally) tally.staple += v;
    }
  }
  for (const o of demand.orders) {
    if (!o.items.every((it) => (stock[it.cropId] || 0) >= it.qty)) continue;
    o.items.forEach((it) => { stock[it.cropId] -= it.qty; });
    income += o.coins;
    if (tally) tally.order += o.coins;
  }
  let stall = sessions * 3;
  for (const id of Object.keys(stock)) {
    if (stall <= 0) break;
    const take = Math.min(stock[id], stall);
    if (take > 0) {
      const v = Math.round(take * priceOf(id) * 1.45);
      income += v; stock[id] -= take; stall -= take;
      if (tally) tally.stall += v;
    }
  }
  return income;
}

const rows = [];
let worstSmart = Infinity, bestSmart = 0, worstNaive = Infinity;
let minOrderShare = Infinity, maxStapleShare = 0;

for (const level of [3, 8, 14]) {
  const unlocked = ALL.filter((c) => (c.unlock_level || 1) <= level);
  const grown = unlocked.map((c) => c.id);
  const fav = unlocked.slice().sort((a, b) => (b.sell_price || 0) - (a.sell_price || 0))[0];

  for (const plots of [4, 8, 16, 25]) {
    for (const sessions of [1, 3, 6]) {
      const randD = mulberry32(level * 1000 + plots * 10 + sessions);
      const ctx = ctxFor(level, plots, sessions, grown, randD);

      let oldS = 0, newS = 0, oldN = 0, newN = 0;
      const stockS = {}, stockN = {};
      const tally = { staple: 0, order: 0, stall: 0 };

      for (let day = 0; day < DAYS; day++) {
        // 店里看得见供货商手上有什么：谷仓里存量最多的那样菜
        const topOf = (bag) => Object.keys(bag).sort((a, b) => bag[b] - bag[a]).slice(0, 1);
        const demand = demandOfDay({ ...ctx, stockTop: topOf(stockS) }, sessions, randD);
        const demandN = demandOfDay({ ...ctx, stockTop: topOf(stockN) }, sessions, mulberry32(day + 99));

        const hS = allocate(plots, sessions, demand, unlocked.slice(0, 3));
        oldS += totalValue(hS);
        Object.keys(hS).forEach((id) => { stockS[id] = (stockS[id] || 0) + hS[id]; });
        newS += sellDay(stockS, demand, sessions, tally);

        const hN = {};
        for (let i = 0; i < plots; i++) hN[fav.id] = (hN[fav.id] || 0) + cyclesPerDay(fav, sessions);
        oldN += totalValue(hN);
        Object.keys(hN).forEach((id) => { stockN[id] = (stockN[id] || 0) + hN[id]; });
        newN += sellDay(stockN, demandN, sessions, null);
      }

      const rS = oldS ? newS / oldS : 1, rN = oldN ? newN / oldN : 1;
      worstSmart = Math.min(worstSmart, rS);
      bestSmart = Math.max(bestSmart, rS);
      worstNaive = Math.min(worstNaive, rN);
      const chanTotal = tally.staple + tally.order + tally.stall;
      const orderShare = chanTotal ? tally.order / chanTotal : 0;
      minOrderShare = Math.min(minOrderShare, orderShare);
      maxStapleShare = Math.max(maxStapleShare, chanTotal ? tally.staple / chanTotal : 0);
      rows.push({ level, plots, sessions, oldS, newS, rS, oldN, newN, rN, orderShare });
    }
  }
}

for (const r of rows) {
  console.log('Lv' + String(r.level).padStart(2) + ' 地' + String(r.plots).padStart(2) +
    ' 登' + r.sessions + '次   备货 ' + String(r.oldS).padStart(7) + '->' + String(r.newS).padStart(7) +
    ' (' + r.rS.toFixed(2) + 'x)    随手 ' + String(r.oldN).padStart(7) + '->' +
    String(r.newN).padStart(7) + ' (' + r.rN.toFixed(2) + 'x)');
}
console.log('');
console.log(DAYS + ' 天合计：备货型最差 ' + worstSmart.toFixed(2) + 'x 最好 ' +
  bestSmart.toFixed(2) + 'x   随手型最差 ' + worstNaive.toFixed(2) + 'x');
console.log('收入构成：订单占比最低 ' + (minOrderShare * 100).toFixed(0) + '%，' +
  '基础补货占比最高 ' + (maxStapleShare * 100).toFixed(0) + '%');

assert.ok(worstSmart >= 1.0,
  '会备货的玩家收入不得低于旧无限收购（最差 ' + worstSmart.toFixed(2) + 'x）');
assert.ok(bestSmart <= 2.4,
  '备货型收益要有上限，防通胀（最好 ' + bestSmart.toFixed(2) + 'x）');
/* 随手型是**双向**的：
   下界 0.5 —— 不能把人打到弃坑；
   🔒 上界 0.9 —— **不看订单板也照样赚原来那么多，就说明这次改动是假的**。
   这一条是变异体逼出来的：把 STAPLE_RATIO 从 0.6 调到 5.0（地板大到能吃下
   全部产量 = 换了名字的无限收购），备货型的数字和收入构成**一点没变**
   （产量瓶颈是地块不是配额），只有随手型从 0.69x 跳到 1.01x。
   也就是说，能识破「地板变相无限收购」的只有这条上界。 */
assert.ok(worstNaive >= 0.5,
  '随手乱种的玩家仍要有像样的收入（最差 ' + worstNaive.toFixed(2) + 'x）');
assert.ok(worstNaive <= 0.9,
  '不看订单板就该少赚，否则「按订单供货」是假的（最差 ' + worstNaive.toFixed(2) + 'x）');

/* 🔒 光看收入高低分不出「订单制」和「无限收购」——把基础补货的配额调到 5 倍，
   一切照样卖得掉、收入也照样漂亮，但那就是换了个名字的无限收购。
   所以必须钉住**收入的来源**：订单得是主角，地板只能是地板。
   （这两条是变异体测出来的：STAPLE_RATIO 从 0.6 改成 5.0 时上面三条全绿。）*/
assert.ok(minOrderShare >= 0.25,
  '订单必须是主要收入来源，不能退化成「靠地板卖光」（最低 ' + (minOrderShare * 100).toFixed(0) + '%）');
assert.ok(maxStapleShare <= 0.72,
  '每日基础补货只能是地板，不能变相当无限收购（最高 ' + (maxStapleShare * 100).toFixed(0) + '%）');

console.log('ok store-economy-sim');
