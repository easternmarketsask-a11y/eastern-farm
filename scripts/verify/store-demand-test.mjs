// store-demand.js 纯逻辑契约（2026-08-22）。零依赖：node 内置 assert + vm。
//
// 为什么需求生成必须是「不碰 DOM、不读全局」的纯函数：
// 「新模式日收入不得低于旧模式」这条产品承诺只能靠模拟验证，
// 而模拟不可能在浏览器里做。逻辑一旦缠上 Farm.state / document 就没法标定了。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// 在 vm 里把游戏模块跑起来。ctx.window = ctx 是关键：模块统一写
// `window.Farm = window.Farm || {}` 然后用裸 `Farm`，只有让 window 指向
// 上下文自身，两种写法才落到同一个对象上。
function loadModule(rel) {
  const ctx = { Math, Date, JSON, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(join(root, rel), 'utf8'), ctx);
  return ctx.Farm;
}
const Farm = loadModule('src/js/store-demand.js');
const SD = Farm.storeDemand;

// 固定序列的假随机：真随机会让断言随机红
function seq(values) { let i = 0; return () => values[i++ % values.length]; }

const CROPS = [
  { id: 'qingcai',  sell_price: 6,  unlock_level: 1, grow_minutes: 30 },
  { id: 'tomato',   sell_price: 12, unlock_level: 1, grow_minutes: 90 },
  { id: 'jiucai',   sell_price: 9,  unlock_level: 1, grow_minutes: 60 },
  { id: 'liu_lian', sell_price: 40, unlock_level: 9, grow_minutes: 480 },
];
const DAYS = ['2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];
const baseCtx = {
  now: 1700000000000, level: 5, plots: 6, crops: CROPS,
  grown: ['qingcai', 'tomato', 'jiucai'], saleCropIds: [],
  dayStrings: DAYS,
  isInSeason: () => false,
  sellPriceOf: (def) => def.sell_price,
  rand: seq([0.5]),
};

// ---------- ① 每日基础补货 ----------
const staples = SD.makeStaples(baseCtx);
assert.ok(staples.length >= 2 && staples.length <= 3, '每天 2–3 样基础补货，实际 ' + staples.length);
assert.ok(staples.every(s => s.need > 0), '每样都有正的限量');
assert.ok(staples.every(s => s.filled === 0), '新开一天从 0 开始');
assert.ok(staples.every(s => CROPS.some(c => c.id === s.cropId)), '只要认识的作物');
assert.ok(new Set(staples.map(s => s.cropId)).size === staples.length, '不许同一样菜出现两次');

// 🔒 「不是无限收购」的核心断言：限量有上界，且随地块产能走
const few = SD.makeStaples({ ...baseCtx, plots: 2, rand: seq([0.5]) });
const many = SD.makeStaples({ ...baseCtx, plots: 20, rand: seq([0.5]) });
const sum = (a) => a.reduce((s, x) => s + x.need, 0);
assert.ok(sum(many) > sum(few), `地多的人配额更高（${sum(many)} vs ${sum(few)}）`);
assert.ok(sum(many) < 10000, '配额必须有限，不能是变相的无限收购');

// ---------- ② 不定期订单 ----------
const ord = SD.makeOrder(baseCtx);
assert.ok(ord.items.length >= 1 && ord.items.length <= 3, '每单 1–3 种菜，实际 ' + ord.items.length);
assert.equal(ord.accepted, false, '新单默认未接');
assert.equal(ord.kind, 'regular', '默认是普通不定期单');
assert.ok(typeof ord.id === 'string' && ord.id.length > 0, '有 id');
assert.ok(ord.expiresAt > ord.postedAt, '有过期时刻');
const lifeH = (ord.expiresAt - ord.postedAt) / 3600000;
assert.ok(lifeH >= 3 && lifeH <= 8, `有效期 3–8 小时，实际 ${lifeH}`);

const bulkOf = (o) => o.items.reduce((s, it) =>
  s + CROPS.find(c => c.id === it.cropId).sell_price * it.qty, 0);
assert.ok(ord.coins >= bulkOf(ord) * 1.5, `订单价至少 1.5 倍散卖（${ord.coins} vs ${bulkOf(ord)}）`);
assert.ok(ord.coins <= bulkOf(ord) * 2.2 * 1.4, '溢价有上界，别印钞');
assert.ok(ord.xp > 0, '给经验');

// ---------- ③ 大单 ----------
const big = SD.makeOrder({ ...baseCtx, level: 12, rand: seq([0.5]), forceKind: 'big' });
assert.equal(big.kind, 'big', 'forceKind 能造出大单');
assert.ok(big.items.length >= 3, '大单 3 种以上，实际 ' + big.items.length);
assert.ok(big.coins >= bulkOf(big) * 2.5, `大单溢价 ≥2.5（${big.coins} vs ${bulkOf(big)}）`);

// ---------- 出单间隔 ----------
for (const r of [0, 0.5, 0.999]) {
  const m = SD.nextPostDelay(() => r) / 60000;
  assert.ok(m >= 40 && m <= 150, `出单间隔 40–150 分钟，实际 ${m}`);
}

// ---------- 预告 ----------
const fc = SD.makeForecast(baseCtx);
assert.ok(fc.length >= 3 && fc.length <= 7, '预告未来 3–7 天，实际 ' + fc.length);
assert.ok(fc.every(f => typeof f.date === 'string' && f.date), '每条都有日期串');
assert.ok(fc.every(f => Array.isArray(f.cropIds) && f.cropIds.length), '每天都有具体的菜');
assert.deepEqual(fc.map(f => f.date), DAYS.slice(0, fc.length), '日期直接用注入的 dayStrings，顺序一致');
// 🔒 日期必须是注入的，模块内不许**运行时** new Date()（萨省 UTC-6，自己算必错一天）。
// 注释里出现这个字样是允许的（正是那条禁令本身），所以先把注释剥掉再查。
const sdSrc = fs.readFileSync(join(root, 'src/js/store-demand.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释
  .replace(/(^|[^:])\/\/.*$/gm, '$1');    // 行注释（别切到 http:// 那种）
assert.ok(!/new Date\(/.test(sdSrc), 'store-demand.js 的代码里不许出现 new Date()');

// ---------- 真店特价加权（一期只留钩子，二期接真数据）----------
const share = (saleIds) => {
  let hit = 0;
  for (let i = 0; i < 400; i++) {
    const o = SD.makeOrder({ ...baseCtx, saleCropIds: saleIds, rand: Math.random });
    if (o.items.some(it => it.cropId === 'tomato')) hit++;
  }
  return hit / 400;
};
const withSale = share(['tomato']);
const noSale = share([]);
assert.ok(withSale > noSale + 0.05,
  `真特价的菜出单明显更勤（${withSale.toFixed(2)} vs ${noSale.toFixed(2)}）`);

// ---------- 纯函数：不许依赖全局 ----------
assert.equal(typeof Farm.state, 'undefined', 'store-demand 不许依赖 Farm.state');
assert.equal(typeof Farm.crops, 'undefined', 'store-demand 不许依赖 Farm.crops');

// ---------- 常量对外可见（UI 与测试共用同一份，别各写一份）----------
assert.equal(typeof SD.ACCEPT_CAP, 'number');
assert.equal(typeof SD.BOARD_CAP, 'number');
assert.equal(typeof SD.STAPLE_RATIO, 'number');
assert.ok(SD.ACCEPT_CAP < SD.BOARD_CAP, '接单上限必须小于板位，否则「取舍」不存在');

console.log('ok store-demand');
