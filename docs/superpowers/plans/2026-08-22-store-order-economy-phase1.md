# 东方超市订单制 一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消谷仓无限收购，卖菜改成只能按东方超市的订单供货（三层需求 + 接单上限 + 备货预告），并把 NPC「小东」改名「东超」。

**Architecture:** 新增**纯逻辑模块** `src/js/store-demand.js`（不碰 DOM、不读全局状态，全部靠入参）负责「今天该有哪些需求 / 订单值多少钱」；`orders.js` 退化成 UI 与胶水，只负责渲染、接单、交付。纯逻辑独立出来是为了能在 node 里跑**经济模拟**——「新模式日收入不得低于旧模式」这条不变量，不模拟就只能靠感觉。

**Tech Stack:** vanilla JS（无构建、无 npm 依赖）、`window.Farm.*` IIFE 模块、localStorage 存档；测试用 node 内置 `node:assert` + `node:vm`（纯逻辑）与 `scripts/verify/cdp.mjs`（浏览器内 E2E）。

**Spec:** `docs/superpowers/specs/2026-08-22-store-order-economy-design.md`

## Global Constraints

- **零 npm 依赖**：仓库没有 `node_modules`，测试只能用 node 内置模块。禁止 `import 'ws'` 之类（`scripts/verify/` 里已有 6 个这样的死测试，别再添）。
- **模块注册三处缺一不可**：`src/index.html` 加 `<script defer src="js/store-demand.js">`、`service-worker.js` 的 `PRECACHE` 加同一路径（漏了 `precache-check.mjs` 直接红）、消费方一律 `Farm.storeDemand &&` 守卫。
- **新嵌套 state 字段必须在 `state.js` 的 `init()` 里显式 deep-fill**；`Object.assign` 只补顶层。⚠️ `state.js:362-364` 已注明：老存档缺失的对象是**按引用**拷自 `STARTER_STATE`，直接改会污染模块常量并跨重置泄漏——新字段必须深拷。
- **日期一律 `Farm.state.getDateString()`**（与签到/每日任务同源）。禁止自己 `new Date()` 算日界（萨省 UTC-6，自己算必错一天）。
- **时刻一律绝对时间戳**（同 `stall.js`），离线自然到点。
- **超市积分 source 必须是 `'task_completion'`**：`'order_fill'` 不在 StockWise 的 `ALLOWED_GAME_SOURCES` 里，服务端 422 会回滚但玩家已看到飘字（`orders.js:262` 已有此注释，照抄勿改）。EP 日上限 `ORDER_EP_DAILY_CAP = 4` 不变。
- **cozy 铁律**：订单过期不扣钱、不掉声望、不影响后续出单节奏。无失败态。
- **改完必跑** `node --check`（deploy.sh 闸门 A 硬闸）。

---

### Task 1: `store-demand.js` 纯逻辑核心 + node 测试台

**Files:**
- Create: `src/js/store-demand.js`
- Create: `scripts/verify/store-demand-test.mjs`
- Modify: `src/index.html`（`<script defer src="js/orders.js">` 那一行**之前**插入 store-demand）
- Modify: `service-worker.js`（`PRECACHE` 数组加 `'js/store-demand.js'`）

**Interfaces:**
- Produces（后续任务全部依赖这些名字与签名）：
  - `Farm.storeDemand.STAPLE_RATIO` → `number`（0.6，可调）
  - `Farm.storeDemand.ACCEPT_CAP` → `number`（3）
  - `Farm.storeDemand.BOARD_CAP` → `number`（5）
  - `Farm.storeDemand.makeStaples(ctx)` → `[{cropId, need, filled:0}]`
  - `Farm.storeDemand.makeOrder(ctx)` → `{id, kind:'regular'|'big', items:[{cropId,qty}], coins, xp, points, postedAt, expiresAt, accepted:false}`
  - `Farm.storeDemand.makeForecast(ctx)` → `[{date, cropIds, reason}]`
  - `Farm.storeDemand.nextPostDelay(rand)` → `number`（毫秒，40–150 分钟）
  - `ctx` 形状：`{ now, level, plots, crops, grown, saleCropIds, isInSeason, sellPriceOf, rand }`
    —— `crops` 是作物定义数组，`rand()` 返回 `[0,1)`，**全部外部注入，模块内不读任何全局**。

- [ ] **Step 1: 写失败的测试**

创建 `scripts/verify/store-demand-test.mjs`：

```js
// store-demand.js 纯逻辑契约。零依赖：node 内置 assert + vm。
// 为什么要能在 node 里跑：经济标定（新模式日收入 ≥ 旧模式）只能靠模拟，
// 而模拟不可能在浏览器里做。所以需求生成必须是**不碰 DOM、不读全局**的纯函数。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// 在 vm 里把模块跑起来。ctx.window = ctx 让 `window.Farm = window.Farm || {}`
// 之后的裸 `Farm` 也能解析到同一个对象（游戏模块统一是这个写法）。
function loadModule(rel) {
  const ctx = { Math, Date, JSON, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(join(root, rel), 'utf8'), ctx);
  return ctx.Farm;
}
const Farm = loadModule('src/js/store-demand.js');
const SD = Farm.storeDemand;

// 固定序列的假随机：让每次断言都可复现（真随机会让测试随机红）
function seq(values) { let i = 0; return () => values[i++ % values.length]; }

const CROPS = [
  { id: 'qingcai',  sell_price: 6,  unlock_level: 1, grow_minutes: 30 },
  { id: 'tomato',   sell_price: 12, unlock_level: 1, grow_minutes: 90 },
  { id: 'liu_lian', sell_price: 40, unlock_level: 9, grow_minutes: 480 },
];
const baseCtx = {
  now: 1_700_000_000_000, level: 5, plots: 6, crops: CROPS,
  grown: ['qingcai', 'tomato'], saleCropIds: [],
  isInSeason: () => false,
  sellPriceOf: (def) => def.sell_price,
  rand: seq([0.5]),
};

// —— 每日基础补货 ——
const staples = SD.makeStaples(baseCtx);
assert.ok(staples.length >= 2 && staples.length <= 3, '每天 2–3 样基础补货');
assert.ok(staples.every(s => s.need > 0), '每样都有正的限量');
assert.ok(staples.every(s => s.filled === 0), '新开一天从 0 开始');
assert.ok(staples.every(s => CROPS.some(c => c.id === s.cropId)), '只要认识的作物');

// 🔒 这是「不是无限收购」的核心断言：限量必须**有上界**，且随地块数变化
const few = SD.makeStaples({ ...baseCtx, plots: 2 });
const many = SD.makeStaples({ ...baseCtx, plots: 20 });
assert.ok(many.reduce((s, x) => s + x.need, 0) > few.reduce((s, x) => s + x.need, 0),
  '地多的人配额更高（否则大农场一天就卖完了）');

// —— 不定期订单 ——
const ord = SD.makeOrder(baseCtx);
assert.ok(ord.items.length >= 1 && ord.items.length <= 3, '每单 1–3 种菜');
assert.equal(ord.accepted, false, '新单默认未接');
assert.ok(ord.expiresAt > ord.postedAt, '有过期时刻');
const lifeH = (ord.expiresAt - ord.postedAt) / 3600000;
assert.ok(lifeH >= 3 && lifeH <= 8, `有效期 3–8 小时，实际 ${lifeH}`);
const bulk = ord.items.reduce((s, it) =>
  s + CROPS.find(c => c.id === it.cropId).sell_price * it.qty, 0);
assert.ok(ord.coins >= bulk * 1.5, `订单价至少 1.5 倍散卖（${ord.coins} vs ${bulk}）`);
assert.ok(ord.coins <= bulk * 2.2 * 1.35, '溢价有上界，别印钞');

// —— 出单间隔 ——
for (const r of [0, 0.5, 0.999]) {
  const m = SD.nextPostDelay(() => r) / 60000;
  assert.ok(m >= 40 && m <= 150, `出单间隔 40–150 分钟，实际 ${m}`);
}

// —— 预告 ——
const fc = SD.makeForecast(baseCtx);
assert.ok(fc.length >= 3 && fc.length <= 7, '预告未来 3–7 天');
assert.ok(fc.every(f => f.date && Array.isArray(f.cropIds) && f.cropIds.length), '每天都有具体的菜');

// —— 真店特价权重（二期接真数据，一期先把钩子测住）——
const biased = [];
for (let i = 0; i < 200; i++) {
  biased.push(SD.makeOrder({ ...baseCtx, saleCropIds: ['tomato'], rand: Math.random }));
}
const tomatoShare = biased.filter(o => o.items.some(it => it.cropId === 'tomato')).length / 200;
const plain = [];
for (let i = 0; i < 200; i++) plain.push(SD.makeOrder({ ...baseCtx, rand: Math.random }));
const plainShare = plain.filter(o => o.items.some(it => it.cropId === 'tomato')).length / 200;
assert.ok(tomatoShare > plainShare, `真特价的菜出单更勤（${tomatoShare} vs ${plainShare}）`);

// —— 纯函数：不碰全局 ——
assert.equal(typeof Farm.state, 'undefined', 'store-demand 不许依赖 Farm.state');

console.log('ok store-demand');
```

- [ ] **Step 2: 跑，确认它失败**

Run: `node scripts/verify/store-demand-test.mjs`
Expected: FAIL —— `ENOENT ... src/js/store-demand.js`

- [ ] **Step 3: 写最小实现**

创建 `src/js/store-demand.js`。骨架与关键约束（数值按注释，别自由发挥）：

```js
/**
 * store-demand.js — 东方超市的需求（纯逻辑，2026-08-22）
 *
 * 🔒 这个模块**不碰 DOM、不读任何全局状态**：所有输入走 ctx 参数。
 * 这样它才能在 node 里被经济模拟直接调用 —— 而「新模式日收入不得低于旧模式」
 * 这条不变量，不模拟就只能靠感觉（见 spec 第五节）。
 *
 * 三层需求：① 每日基础补货(地板,限量) ② 不定期订单(主收入) ③ 大单(少见,高回报)
 */
(function () {
  const STAPLE_RATIO = 0.6;      // 基础补货配额 = 产能 × 此系数。由经济模拟标定，别拍脑袋改
  const ACCEPT_CAP = 3;          // 同时能接几单 —— 「不能想卖什么就卖什么」的另一半
  const BOARD_CAP = 5;           // 板上最多挂几单
  const LIFE_MIN_H = 3, LIFE_MAX_H = 8;      // 有效期
  const GAP_MIN_M = 40, GAP_MAX_M = 150;     // 两波之间
  const PREMIUM_MIN = 1.5, PREMIUM_MAX = 2.2;
  const SALE_WEIGHT = 3;         // 真店特价 / 应季的作物，出单权重 ×3
  const FORECAST_DAYS = 5;       // 3–7 之间

  function pick(pool, n, rand) { /* Fisher-Yates 取前 n 个，用 ctx.rand */ }
  function weightedPool(ctx) {
    // 已解锁 ∩ (种过的优先，种过的少于 2 种就用全部已解锁 —— 抄 orders.js._candidatePool 的口径)
    // saleCropIds / isInSeason 命中的作物重复放入 SALE_WEIGHT 次实现加权
  }

  const storeDemand = {
    STAPLE_RATIO, ACCEPT_CAP, BOARD_CAP,

    // ① 每日基础补货：2–3 样，各自限量。限量 = 地块产能 × STAPLE_RATIO
    makeStaples(ctx) { /* need = Math.max(4, Math.round(ctx.plots * dailyCycles(def) * STAPLE_RATIO)) */ },

    // ② / ③ 一张订单。kind==='big' 时 3–5 种、溢价 ≥2.5、可带 EP
    makeOrder(ctx) { /* coins = bulk × premium × variety；expiresAt = now + 3–8h */ },

    // 预告：未来 FORECAST_DAYS 天各要什么
    makeForecast(ctx) { /* date 用 ctx 传入的日期串生成，不在模块里 new Date() */ },

    nextPostDelay(rand) {
      return Math.round((GAP_MIN_M + rand() * (GAP_MAX_M - GAP_MIN_M)) * 60000);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.storeDemand = storeDemand;
})();
```

⚠️ `makeForecast` 里**不许 `new Date()`**：日期串由 ctx 传入（`ctx.dayStrings`），
否则 node 与浏览器、UTC 与萨省会给出不同结果。若测试需要，先把 `dayStrings` 加进 ctx 并同步更新 Step 1 的断言。

- [ ] **Step 4: 跑，确认通过**

Run: `node scripts/verify/store-demand-test.mjs`
Expected: `ok store-demand`

- [ ] **Step 5: 注册模块并验证预缓存闸门**

在 `src/index.html` 的 `<script defer src="js/orders.js"></script>` **之前**加一行
`<script defer src="js/store-demand.js"></script>`；在 `service-worker.js` 的 `PRECACHE` 里加 `'js/store-demand.js'`。

Run: `node scripts/verify/precache-check.mjs`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/js/store-demand.js scripts/verify/store-demand-test.mjs src/index.html service-worker.js
git commit -m "东超需求纯逻辑模块 + node 测试台（可在 node 里跑经济模拟）"
```

---

### Task 2: 经济模拟 —— 标定 `STAPLE_RATIO` 与溢价

**Files:**
- Create: `scripts/verify/store-economy-sim.mjs`
- Modify: `src/js/store-demand.js`（按模拟结论调常数）

**Interfaces:**
- Consumes: Task 1 的 `Farm.storeDemand.*` 与 `loadModule` 手法
- Produces: 标定后的 `STAPLE_RATIO` / `PREMIUM_MIN` / `PREMIUM_MAX` 常数值

- [ ] **Step 1: 写失败的测试**

创建 `scripts/verify/store-economy-sim.mjs`。核心不变量：

```js
// 经济标定：新模式（只能按订单卖）的日收入，不得低于旧模式（无限收购）。
// 🔒 这条不变量不成立的话，玩家的体感就是「被砍了一刀」—— 这是这次改动最大的风险。
import assert from 'node:assert/strict';
/* loadModule 同 store-demand-test.mjs（复制过来，两个测试各自独立，别互相 import） */

// 旧模式：产多少卖多少 × 基础价
function oldDailyIncome(harvest, crops) {
  return harvest.reduce((s, h) => s + crops.find(c => c.id === h.cropId).sell_price * h.qty, 0);
}
// 新模式：先填基础补货(限量)，再填当天到达且被接下的订单，剩下的走菜摊(每 25 分钟 ≤3 棵)
function newDailyIncome(harvest, crops, SD, sessions) { /* 见下 */ }

for (const plots of [4, 8, 16, 25]) {
  for (const sessions of [1, 3, 6]) {
    const harvest = simulateHarvest(plots, sessions);
    const oldI = oldDailyIncome(harvest, CROPS);
    const newI = newDailyIncome(harvest, CROPS, SD, sessions);
    assert.ok(newI >= oldI * 0.98,
      `地块${plots}/每日${sessions}次: 新 ${newI} < 旧 ${oldI}（少于 98% 不可接受）`);
    assert.ok(newI <= oldI * 1.8,
      `地块${plots}/每日${sessions}次: 新 ${newI} 比旧 ${oldI} 高太多，通胀`);
  }
}
console.log('ok store-economy-sim');
```

- [ ] **Step 2: 跑，确认它失败**

Run: `node scripts/verify/store-economy-sim.mjs`
Expected: FAIL（初始常数几乎必然不达标——这正是要标定的原因）

- [ ] **Step 3: 调常数直到通过**

只允许改 `store-demand.js` 里的 `STAPLE_RATIO` / `PREMIUM_MIN` / `PREMIUM_MAX` /
每日出单波数。**不许改断言的阈值来迁就实现**——阈值就是产品承诺。

- [ ] **Step 4: 跑，确认通过**

Run: `node scripts/verify/store-demand-test.mjs && node scripts/verify/store-economy-sim.mjs`
Expected: 两个都 ok

- [ ] **Step 5: 提交**

```bash
git add src/js/store-demand.js scripts/verify/store-economy-sim.mjs
git commit -m "经济标定：新订单制日收入不低于旧无限收购（模拟进闸门）"
```

---

### Task 3: state 接线（存档字段 / 离线不追发 / 防 save-scum）

**Files:**
- Modify: `src/js/state.js`（`STARTER_STATE` 加 `storeDemand`；`init()` 加 deep-fill）
- Create: `scripts/verify/store-state-test.mjs`

**Interfaces:**
- Produces: `Farm.state.data.storeDemand` = `{ day, staples[], board[], forecast[], nextPostAt, lastSyncAt, source, clearedLegacy }`

- [ ] **Step 1: 写失败的测试**

`scripts/verify/store-state-test.mjs` —— 源码级断言（这几条都是踩过的坑）：

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
const st = fs.readFileSync('src/js/state.js', 'utf8');

assert.match(st, /storeDemand:\s*\{/, 'STARTER_STATE 要有 storeDemand');
// 🔒 老存档缺失的对象是按引用拷自 STARTER_STATE（state.js:362 注释），必须深拷
assert.match(st, /storeDemand[\s\S]{0,400}?JSON\.parse\(JSON\.stringify|deepFill|_fillStoreDemand/,
  'storeDemand 必须显式 deep-fill，不能按引用拷 STARTER_STATE');
assert.ok(!/new Date\(\)[\s\S]{0,120}storeDemand/.test(st),
  '日期要走 getDateString()，不许在 storeDemand 附近自己 new Date()');
console.log('ok store-state');
```

- [ ] **Step 2: 跑，确认失败**

Run: `node scripts/verify/store-state-test.mjs`
Expected: FAIL（`storeDemand` 尚不存在）

- [ ] **Step 3: 实现**

在 `state.js` 的 `STARTER_STATE` 里（紧挨现有 `orders: []` 一段）加：

```js
    // ============ 东超需求（store-demand.js — 2026-08-22）============
    // 取代「谷仓无限收购」。三层：每日基础补货 / 不定期订单 / 大单。
    storeDemand: {
      day: '',            // getDateString()，换天时重铺 staples 与 forecast
      staples: [],        // [{cropId, need, filled}]
      board: [],          // [{id, kind, items, coins, xp, points, postedAt, expiresAt, accepted}]
      forecast: [],       // [{date, cropIds, reason}]
      nextPostAt: 0,      // 绝对时间戳；到点补一张新单
      lastSyncAt: 0, source: 'local',
      clearedLegacy: false,   // 老存档的一次性开业清仓单是否已发（Task 6）
    },
```

在 `init()` 的 deep-fill 段加一行显式深拷（照抄邻近字段的写法），并加换天重铺逻辑：
`if (d.storeDemand.day !== getDateString()) { 重铺 staples/forecast; day = getDateString(); }`

🔒 **离线不追发**：到点补单时用 `while (board.length < BOARD_CAP && now >= nextPostAt)`
的写法会一次砸出几十张；正确做法是**先把过期的清掉，再把 `nextPostAt` 重置为
`now + nextPostDelay()`，一次只补到 `BOARD_CAP` 为止**。

🔒 **防 save-scum**：生成后立刻 `Farm.state.save()` 再渲染。

- [ ] **Step 4: 跑，确认通过**

Run: `node scripts/verify/store-state-test.mjs && node --check src/js/state.js`
Expected: ok + 无语法错误

- [ ] **Step 5: 提交**

```bash
git add src/js/state.js scripts/verify/store-state-test.mjs
git commit -m "存档接线：storeDemand 字段 + 换天重铺 + 离线不追发 + 生成即落档"
```

---

### Task 4: 关掉大宗收购 + `totalDeliveries` 接管

**Files:**
- Modify: `src/js/state.js`（删 `deliverWarehouse`；把 `totalDeliveries++` 移到订单交付）
- Modify: `src/js/warehouse.js`（删卖货按钮与 `deliver()`；改仓满弹窗文案）
- Modify: `src/js/orders.js`（`fulfill()` 里自增 `totalDeliveries` + 首次上报 `sell_first`）
- Modify: `src/js/coach.js`（`first_sell` 文案去掉「每日首单 +20%」）
- Create: `scripts/verify/no-bulk-sell-test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: 订单交付后 `Farm.state.data.totalDeliveries` 自增 1

- [ ] **Step 1: 写失败的测试**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
const state = fs.readFileSync('src/js/state.js', 'utf8');
const wh = fs.readFileSync('src/js/warehouse.js', 'utf8');
const ord = fs.readFileSync('src/js/orders.js', 'utf8');

// 无限收购必须真的没了（留着按钮就等于没改）
assert.ok(!/deliverWarehouse/.test(state), 'state.deliverWarehouse 要删干净');
assert.ok(!/deliverWarehouse/.test(wh), 'warehouse 不许再调 deliverWarehouse');
assert.ok(!/卖给东方超市/.test(wh), '「卖给东方超市」按钮要撤掉');

// 🔒 totalDeliveries 必须被订单接管。它冻结的话，人生故事的交付章节、
// 排行榜交付数、daily 的新手判定、sell_first 漏斗会**全部静默失效**。
assert.match(ord, /totalDeliveries/, '订单交付要接管 totalDeliveries');
assert.match(ord, /sell_first/, '首次交付要上报 sell_first 漏斗事件');
console.log('ok no-bulk-sell');
```

- [ ] **Step 2: 跑，确认失败**

Run: `node scripts/verify/no-bulk-sell-test.mjs`
Expected: FAIL（`deliverWarehouse` 还在）

- [ ] **Step 3: 实现**

1. `state.js`：删除 `deliverWarehouse`（约 `:1150-1200`，含 `totalDeliveries++` 那行）。
2. `warehouse.js`：删 `deliver()`、卖货按钮、`wh-total-label` 那块合计区；
   仓满弹窗的「卖掉」选项改成「看看东超要什么」，`onclick = () => Farm.orders.open()`。
3. `orders.js` 的 `fulfill()`，在 `d.totalOrdersFilled` 自增旁边加：

```js
      /* 🔒 totalDeliveries 从大宗卖货搬到这里（2026-08-22 关掉无限收购）。
         它原来只在 state.deliverWarehouse 自增，直接删掉那条路会让它永久冻结，
         连带 life-story 的 deliver_first/25/100、排行榜交付数、daily 的
         isNewbie(<3)、漏斗 sell_first 全部静默失效。 */
      d.totalDeliveries = (d.totalDeliveries || 0) + 1;
      if (Farm.track && d.totalDeliveries === 1) Farm.track('sell_first');
```

4. `coach.js`：`first_sell` 文案改为「把菜按东超的订单交上去就能拿农场币。」

- [ ] **Step 4: 跑，确认通过**

Run: `node scripts/verify/no-bulk-sell-test.mjs && for f in src/js/*.js; do node --check $f || exit 1; done`
Expected: ok + 全部语法通过

- [ ] **Step 5: 提交**

```bash
git add src/js/state.js src/js/warehouse.js src/js/orders.js src/js/coach.js scripts/verify/no-bulk-sell-test.mjs
git commit -m "关掉谷仓无限收购；totalDeliveries 改由订单交付接管"
```

---

### Task 5: 订单板 UI 重做（基础补货 + 接单上限 + 预告）

**Files:**
- Modify: `src/js/orders.js`（`render()` / `open()` / 新增 `accept()` `abandon()`）
- Modify: `src/css/style.css`（补货条、预告条、已接单标记）

**Interfaces:**
- Consumes: `Farm.storeDemand.{makeStaples,makeOrder,makeForecast,nextPostDelay,ACCEPT_CAP,BOARD_CAP}`、`Farm.state.data.storeDemand`
- Produces: `Farm.orders.accept(id)`、`Farm.orders.abandon(id)`、`Farm.orders.acceptedCount()`

- [ ] **Step 1: 写失败的测试**（源码契约，E2E 在 Task 8）

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
const o = fs.readFileSync('src/js/orders.js', 'utf8');
assert.match(o, /accept\s*\(/, '要有接单');
assert.match(o, /abandon\s*\(/, '要有放弃（无惩罚腾位置）');
assert.match(o, /ACCEPT_CAP/, '接单上限要用 storeDemand 的常量，别再写一份');
// 🔒 没接的单不许交付，否则接单上限形同虚设
assert.match(o, /accepted[\s\S]{0,200}?(return|toast)/, 'fulfill 要挡住未接的单');
assert.match(o, /staples/, '要渲染每日基础补货');
assert.match(o, /forecast/, '要渲染备货预告');
console.log('ok orders-ui');
```

- [ ] **Step 2: 跑，确认失败** — Run: `node scripts/verify/orders-ui-test.mjs` → FAIL

- [ ] **Step 3: 实现**

`orders.js` 改造要点：
- `ensure()` 改为：清过期 → 换天重铺 staples/forecast → 到点补单（**不追发**，见 Task 3）。
- `render()` 三段：① 基础补货进度条（`filled/need`，可交付按钮）② 订单卡（未接显示「接单」，已接显示「交付/放弃」，接满时第 4 张的接单键禁用并提示「最多同时接 3 单」）③ 顶部预告条。
- `fulfill(id)` 开头加：`if (!order.accepted) { toast('先接下这单'); return; }`
- 删掉「🔄 换一单」（免费换单 = 无限收购的另一种形态）。
- `refreshBadge()` 改为「可交付的**已接**订单数 + 有新单到达」两种红点。

- [ ] **Step 4: 跑，确认通过** — Run: `node scripts/verify/orders-ui-test.mjs && node --check src/js/orders.js`

- [ ] **Step 5: 提交**

```bash
git add src/js/orders.js src/css/style.css scripts/verify/orders-ui-test.mjs
git commit -m "订单板重做：基础补货 + 接单上限 + 备货预告，去掉免费换单"
```

---

### Task 6: 老存档的一次性「开业清仓单」

**Files:**
- Modify: `src/js/orders.js`（`ensure()` 里判 `clearedLegacy`）

**Interfaces:**
- Consumes: `Farm.state.data.storeDemand.clearedLegacy`

- [ ] **Step 1: 写失败的测试**

```js
assert.match(o, /clearedLegacy/, '老存档要有一次性清仓单');
assert.match(o, /clearedLegacy\s*=\s*true/, '发过就置位，只发一次');
```

- [ ] **Step 2: 跑，确认失败**

- [ ] **Step 3: 实现**：`clearedLegacy !== true` 且仓库非空时，插一张 kind:'clearance' 的单，
按**旧的大宗价**把当前库存全额收掉（玩家可以不交），交付或关闭后置 `clearedLegacy = true`。

- [ ] **Step 4: 跑，确认通过**

- [ ] **Step 5: 提交** — `git commit -m "老存档一次性开业清仓单，避免存量库存卖不掉"`

---

### Task 7: 「小东」→「东超」（58 处 / 20 文件）

**Files:** `src/css/style.css`、`src/index.html`、`src/js/{coach,daily,farm,farmer,guide,kitchen,life-story,main,orders,rewards,spotlight,state,storekeeper,tasks,warehouse}.js`、`data/{achievements,chapters,recipes,tasks}.json`

- [ ] **Step 1: 写失败的测试**

```js
import fs from 'node:fs'; import path from 'node:path';
const files = [...walk('src'), ...walk('data')];
const hits = files.filter(f => fs.readFileSync(f,'utf8').includes('小东'));
assert.deepEqual(hits, [], '不该再有「小东」：' + hits.join(', '));
```

- [ ] **Step 2: 跑，确认失败**（应报出 20 个文件）

- [ ] **Step 3: 全量替换**

```bash
grep -rl "小东" src/ data/ | while read f; do
  python -c "import sys,io;p=sys.argv[1];s=io.open(p,encoding='utf-8').read();io.open(p,'w',encoding='utf-8',newline='').write(s.replace('小东','东超'))" "$f"
done
```

- [ ] **Step 4: 人工顺一遍把「东超」当人称呼的文案**

`grep -rn "东超" src/ data/ | grep -E "他|她|说道|问你"` —— 改名后叙述主体从一个人变成店，
「他说」这类要改成「东超发来消息」之类。JSON 文件改完必须 `node -e "JSON.parse(...)"` 验证没坏。

- [ ] **Step 5: 跑，确认通过 + 语法**

Run: `node scripts/verify/rename-test.mjs && for f in src/js/*.js; do node --check $f || exit 1; done && for f in data/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || exit 1; done`

- [ ] **Step 6: 提交** — `git commit -m "NPC 小东改名东超（58 处），并顺掉把它当人称呼的文案"`

---

### Task 8: 浏览器内 E2E + 部署闸门 L

**Files:**
- Create: `scripts/verify/store-order-tests.js`（cdp 在页面里跑）
- Modify: `deploy.sh`（闸门 L）

- [ ] **Step 1: 写失败的测试**

`store-order-tests.js` 覆盖 spec 第九节的全部验收项。⚠️ **必须走真实入口进农场**
（点 `#splashStart` 等 `iso._on === true`）——直接 `__splashDismiss()` 会跳过
`isoView.init()`，这个坑在 `car-drive-tests.js` / `roam-tests.js` 里已经各踩过一次。

断言清单：谷仓无卖货入口 / 三层需求都能交付到账 / 接单上限与放弃 / 未接不能交付 /
基础补货不占位 / 过期不扣钱不掉级 / **`nextPostAt` 手动调到 3 天前后板面张数正常（不追发）** /
反复重载订单 id 不变（防 save-scum）/ 订单交付后 `totalDeliveries` 自增 /
老存档能拿到清仓单 / 全局搜不到「小东」。

- [ ] **Step 2: 跑，确认失败**

Run: `python -m http.server 8123 --bind 127.0.0.1 &` 然后
`node scripts/verify/cdp.mjs "http://127.0.0.1:8123/src/" scripts/verify/store-order-tests.js 12000`

- [ ] **Step 3: 修到全绿**

- [ ] **Step 4: 加闸门 L**

在 `deploy.sh` 闸门 K 之后照抄 K 的结构（独立端口 8158、`ROAM_PID` 同款 trap、
node 解析 `evalResult.failures`），外加两个纯 node 测试：

```bash
  for t in store-demand-test.mjs store-economy-sim.mjs store-state-test.mjs no-bulk-sell-test.mjs orders-ui-test.mjs rename-test.mjs; do
    if ! node "scripts/verify/$t"; then echo "—— 部署中止：$t"; exit 1; fi
  done
```

- [ ] **Step 5: 变异体验证闸门不是摆设**

把 `ACCEPT_CAP` 改成 999 跑闸门 L，必须红；还原。
把 `STAPLE_RATIO` 改成 5.0（等于变相无限收购）跑经济模拟，必须红（通胀上界）；还原。

- [ ] **Step 6: 提交并部署**

```bash
git add -A && git commit -m "东超订单制 E2E + 部署闸门 L"
bash deploy.sh "东方超市订单制：取消无限收购，改为按订单供货"
```

---

## Self-Review

**1. Spec 覆盖**（逐节对照）

| Spec 节 | 落在哪个 Task |
|---|---|
| 一① 每日基础补货 | T1 `makeStaples` + T5 渲染 |
| 一② 不定期订单（节奏/有效期/板位/接单位） | T1 `makeOrder`/`nextPostDelay` + T5 |
| 一③ 大单 + EP 上限 | T1 `kind:'big'`（EP 仍走现有 `_epState` 上限） |
| 二 备货预告板 | T1 `makeForecast` + T5 |
| 三 真店挂钩 | **二期**，一期只在 T1 留 `saleCropIds` 钩子并测了加权 |
| 四 防卡死三道阀 | 菜摊/厨房不动；地板见 T1；T2 模拟验证有正收入路径 |
| 五 经济标定 | T2 |
| 6.1 `totalDeliveries` | T4 |
| 6.2 大宗入口与残留 | T4 |
| 6.3 改名 | T7 |
| 七 状态与存档 | T3 |
| 七之二 存量库存 | T6 |
| 九 验收 | T8（E2E）+ 各 Task 的单测 |

**2. 占位符扫描**：Task 1 Step 3 的骨架里有 `/* ... */` 注释形式的实现提示（`pick`/`weightedPool`/三个 make 函数体）。这是**有意的**——具体数值要由 Task 2 的模拟标定，先写死反而会被改掉；但函数签名、常量名与全部约束条件都已给全，且 Task 1 的测试逐条钉住了行为。其余步骤无占位符。

**3. 类型/命名一致性**：`STAPLE_RATIO`/`ACCEPT_CAP`/`BOARD_CAP`/`makeStaples`/`makeOrder`/`makeForecast`/`nextPostDelay` 在 T1 定义，T2/T3/T5/T8 引用一致；state 字段 `storeDemand.{day,staples,board,forecast,nextPostAt,lastSyncAt,source,clearedLegacy}` 在 T3 定义，T5/T6/T8 引用一致；`accepted` 布尔在 T1 产出、T5 消费。

**4. 发现并补的缺口**：`makeForecast` 原本会在模块内 `new Date()`（违反「日期走 getDateString」铁律且让 node 测试与浏览器结果不一致）→ 已在 T1 Step 3 加 `ctx.dayStrings` 注入的约束。
