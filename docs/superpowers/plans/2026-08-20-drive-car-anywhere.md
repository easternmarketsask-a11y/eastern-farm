# 开车去任意地方 · A 期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 农场里点哪儿人就去哪儿；点车能上车，上车后点哪儿车就开到哪儿，贵的车开得快。

**Architecture:** 新增一个零依赖的网格寻路模块 `Farm.pathfind`（BFS，4 邻接）。`farmer.js`
现有的直线 `moveToward` 保留为「走一段」的原语，上面套一层路径点数组；新增 `goto` 任务类型和
`A.driving`（只在内存的驾驶态）。`mapview-iso.js` 负责三件事：点空地派 `goto`、车面板加
上/下车按钮、驾驶中用 actor 的实时位置画车（照抄现有 `_moving` 的写法）。存档只多写车的新
`gx/gy`，不新增字段。

**Tech Stack:** vanilla JS、无构建、IIFE + `window.Farm.*` 命名空间、localStorage 存档。
测试是无头 Chrome（`scripts/verify/cdp.mjs`）在页面里跑断言，不引入任何 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-08-20-drive-car-anywhere-design.md`

## Global Constraints

- **无构建、零 npm 依赖**：新文件必须是 IIFE，挂到 `Farm.*`，用 `<script defer>` 引入。
- **`A.driving` 绝不落盘**。存档里只有车的 `gx/gy`，没有「谁在车上」。刷新即下车。
- **车速四档写死一张表**：农用 4.4 / 家用 6.0 / 越野 7.5 / 豪华 9.0 格·秒⁻¹；走路 `WALK_SPEED = 2.2` 不变。
- **建造模式 (`iso._build`) 与拜访模式 (`Farm.state._visitLock`) 下，点空地和上车一律无效。**
- **寻路只走 4 邻接**，不走对角——对角会擦过建筑/水塘的角，看起来像穿墙。
- **不碰**：存档结构、云同步（`firebase-game-sync.js`）、登录、积分、Firestore 规则。
- 改完任何 JS 必须 `node --check`（`deploy.sh` 闸门 A 会拦，但本地先跑省一轮）。
- 测试断言一律返回 `{ failures: [...] }` 形状，与现有闸门 D–H 的 `cdp.mjs` 契约一致。

---

### Task 1: 寻路模块 `Farm.pathfind`

**Files:**
- Create: `src/js/pathfind.js`
- Modify: `src/index.html:767`（在 `farmer.js` **之前**插入 `<script defer src="js/pathfind.js"></script>`）
- Test: `scripts/verify/car-drive-tests.js`（新建，本任务只写第一组断言）

**Interfaces:**
- Produces: `Farm.pathfind.find(sx, sy, gx, gy, isFree, maxCells) → Array<{gx,gy}>|null`
  - 返回的路径**包含起点**，`path[0]` 恒等于起点格。
  - `isFree(x, y) → boolean` 由调用方提供（人和车判据不同）。
  - 目标不可达时返回**通往最接近目标的可达格**的路径，不返回 null。
  - 起点自身不可走时返回 `null`。
  - `maxCells` 默认 4000（搜索格数上限，防病态输入卡住主线程）。

- [ ] **Step 1: 写失败的测试**

新建 `scripts/verify/car-drive-tests.js`：

```js
// 开车去任意地方 · A 期回归测试。由 cdp.mjs 在页面里执行，返回 {failures:[]}。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const T = (name, cond) => { if (!cond) failures.push(name); };

  for (let i = 0; i < 60; i++) { if (window.Farm && Farm.pathfind) break; await sleep(150); }
  if (!window.Farm || !Farm.pathfind) return { failures: ['Farm.pathfind 不存在'] };

  // ---- 第 1 组：纯寻路（合成网格，不依赖存档）----
  // 10x10 全空；(3,0)..(3,8) 是一堵墙，只有 (3,9) 是缺口。
  const wall = (x, y) => !(x === 3 && y >= 0 && y <= 8);
  const open = (x, y) => x >= 0 && y >= 0 && x < 10 && y < 10;
  const freeWall = (x, y) => open(x, y) && wall(x, y);

  const p1 = Farm.pathfind.find(0, 0, 2, 0, freeWall);
  T('P1 直线可达', !!p1 && p1.length === 3 && p1[0].gx === 0 && p1[2].gx === 2 && p1[2].gy === 0);

  const p2 = Farm.pathfind.find(0, 0, 5, 0, freeWall);
  T('P2 绕墙能到', !!p2 && p2[p2.length - 1].gx === 5 && p2[p2.length - 1].gy === 0);
  T('P2 路径不穿墙', !!p2 && p2.every((s) => freeWall(s.gx, s.gy)));
  T('P2 每步只走一格且不走对角', !!p2 && p2.every((s, i) =>
    i === 0 || (Math.abs(s.gx - p2[i - 1].gx) + Math.abs(s.gy - p2[i - 1].gy)) === 1));

  // 完全封死的目标 → 返回最接近的可达格，而不是 null / 不是原地不动
  const island = (x, y) => open(x, y) && !(x === 8 || y === 8);
  const p3 = Farm.pathfind.find(0, 0, 9, 9, island);
  T('P3 不可达时给最近可达点', !!p3 && p3.length > 1 && island(p3[p3.length - 1].gx, p3[p3.length - 1].gy));

  // 起点自己就不可走 → null
  T('P4 起点不可走返回 null', Farm.pathfind.find(3, 0, 0, 0, freeWall) === null);

  // 起点即终点 → 长度 1 的路径
  const p5 = Farm.pathfind.find(2, 2, 2, 2, open);
  T('P5 原地返回单点路径', !!p5 && p5.length === 1 && p5[0].gx === 2 && p5[0].gy === 2);

  return { failures };
})()
```

- [ ] **Step 2: 跑测试，确认它失败**

```bash
cd /d/easternmarket.ca/eastern-farm
python -m http.server 8000 --bind 127.0.0.1 &
node scripts/verify/cdp.mjs "http://127.0.0.1:8000/src/" "scripts/verify/car-drive-tests.js" 4000
```

Expected: `evalResult.failures` 为 `["Farm.pathfind 不存在"]`。

- [ ] **Step 3: 写实现**

新建 `src/js/pathfind.js`：

```js
/**
 * pathfind.js — 等距网格上的 BFS 寻路。
 *
 * 人物移动原本是 moveToward() 直线插值：近距离没事，一旦允许「点任意地方」，
 * 人会从水塘和房子里直接穿过去。这个模块只回答「怎么绕过去」，不关心谁在走 ——
 * 可走判据由调用方用 isFree(x,y) 传进来（人是 1 格，车要整个车身放得下）。
 *
 * 🔒 只走 4 邻接：对角会擦过建筑/水塘的角，看起来就是穿墙。
 */
(function () {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function find(sx, sy, gx, gy, isFree, maxCells) {
    sx = Math.round(sx); sy = Math.round(sy);
    gx = Math.round(gx); gy = Math.round(gy);
    if (typeof isFree !== 'function' || !isFree(sx, sy)) return null;

    const k = (x, y) => x + ',' + y;
    const startK = k(sx, sy);
    const prev = {}, seen = {};
    const q = [[sx, sy]];
    let head = 0, scanned = 0;
    const cap = maxCells || 4000;

    seen[startK] = 1;
    // 目标不可达时退而求其次：记住 BFS 走过的、离目标最近的一格。
    let best = [sx, sy];
    let bestD = Math.abs(sx - gx) + Math.abs(sy - gy);

    while (head < q.length && scanned < cap) {
      const cur = q[head++]; scanned++;
      const cx = cur[0], cy = cur[1];
      if (cx === gx && cy === gy) { best = cur; bestD = -1; break; }
      const d = Math.abs(cx - gx) + Math.abs(cy - gy);
      if (d < bestD) { bestD = d; best = cur; }
      for (let i = 0; i < 4; i++) {
        const nx = cx + DIRS[i][0], ny = cy + DIRS[i][1], nk = k(nx, ny);
        if (seen[nk] || !isFree(nx, ny)) continue;
        seen[nk] = 1; prev[nk] = k(cx, cy); q.push([nx, ny]);
      }
    }

    const path = [];
    let ck = k(best[0], best[1]);
    while (ck) {
      const parts = ck.split(',');
      path.push({ gx: +parts[0], gy: +parts[1] });
      if (ck === startK) break;
      ck = prev[ck];
    }
    path.reverse();
    return path;
  }

  window.Farm = window.Farm || {};
  Farm.pathfind = { find: find };
})();
```

在 `src/index.html` 的 `<script defer src="js/farmer.js"></script>` **前一行**插入：

```html
<script defer src="js/pathfind.js"></script>
```

- [ ] **Step 4: 跑测试，确认全过**

```bash
node --check src/js/pathfind.js
node scripts/verify/cdp.mjs "http://127.0.0.1:8000/src/" "scripts/verify/car-drive-tests.js" 4000
```

Expected: `failures: []`。

- [ ] **Step 5: 提交**

```bash
git add src/js/pathfind.js src/index.html scripts/verify/car-drive-tests.js
git commit -m "寻路模块：等距网格 BFS，只走 4 邻接不擦角"
```

---

### Task 2: 点空地，人绕过去

**Files:**
- Modify: `src/js/farmer.js`（`moveToward` 参数化速度；新增 `goto` job、`A.path`；导出 `goTo`）
- Modify: `src/js/mapview-iso.js:982`（`_tapCell` 的 `idx == null` 分支）
- Test: `scripts/verify/car-drive-tests.js`（追加第 2 组断言）

**Interfaces:**
- Consumes: `Farm.pathfind.find(...)`（Task 1）
- Produces:
  - `Farm.farmer.goTo(gx, gy) → boolean`（派一次移动；建造/拜访中返回 false）
  - `Farm.farmer.walkableFor(iso, w, h) → (x,y)=>boolean`（生成可走判据；`w=h=1` 即人）
  - `A.path: Array<{gx,gy}>|null`、`A.pathI: number` 内部状态

- [ ] **Step 1: 写失败的测试**

在 `car-drive-tests.js` 的 `return { failures }` **之前**追加：

```js
  // ---- 第 2 组：点空地走过去 ----
  const sp = document.getElementById('splash'); if (sp) sp.remove();
  Farm.state.data.tutorialV1Done = true;
  for (let i = 0; i < 60; i++) { if (Farm.isoView && Farm.isoView.active && Farm.isoView.active()) break; await sleep(150); }
  const iso = Farm.isoView;
  T('G0 goTo 已导出', typeof Farm.farmer.goTo === 'function');

  const actor = Farm.farmer._actor();
  // 找一个「人现在不在、但走得到」的空地
  const ob = iso._ownedBounds();
  const free = Farm.farmer.walkableFor(iso, 1, 1);
  let dest = null;
  for (let y = ob.y2; y >= ob.y1 && !dest; y--) {
    for (let x = ob.x2; x >= ob.x1; x--) {
      if (free(x, y) && (Math.abs(x - actor.gx) + Math.abs(y - actor.gy)) > 3) { dest = { gx: x, gy: y }; break; }
    }
  }
  T('G1 找得到一个远处空地', !!dest);
  if (dest) {
    const from = { gx: actor.gx, gy: actor.gy };
    T('G2 goTo 返回 true', Farm.farmer.goTo(dest.gx, dest.gy) === true);
    T('G3 路径已算出且不穿障碍', !!actor.path && actor.path.length > 1
      && actor.path.every((s) => free(s.gx, s.gy)));
    await sleep(1200);
    T('G4 人真的动了', Math.abs(actor.gx - from.gx) + Math.abs(actor.gy - from.gy) > 0.3);
  }

  // 建造模式下不许走
  iso._build = true;
  T('G5 建造模式点空地无效', Farm.farmer.goTo(ob.x1, ob.y1) === false);
  iso._build = false;
  // 拜访模式下不许走
  Farm.state._visitLock = true;
  T('G6 拜访模式点空地无效', Farm.farmer.goTo(ob.x1, ob.y1) === false);
  Farm.state._visitLock = false;
```

- [ ] **Step 2: 跑测试，确认新断言失败**

```bash
node scripts/verify/cdp.mjs "http://127.0.0.1:8000/src/" "scripts/verify/car-drive-tests.js" 9000
```

Expected: `failures` 含 `G0 goTo 已导出`。

- [ ] **Step 3: 写实现**

**3a. `src/js/farmer.js` — `moveToward` 参数化速度**

把

```js
  function moveToward(dt, tx, ty) {
    const dx = tx - A.gx, dy = ty - A.gy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.08) { A.gx = tx; A.gy = ty; return true; }
    const step = WALK_SPEED * dt;
```

改成

```js
  function moveToward(dt, tx, ty, speed) {
    const dx = tx - A.gx, dy = ty - A.gy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.08) { A.gx = tx; A.gy = ty; return true; }
    const step = (speed || WALK_SPEED) * dt;
```

（函数体其余不动；现有 3 处 `moveToward(dt, ...)` 调用不传第 4 个参数，行为不变。）

**3b. `src/js/farmer.js` — 可走判据 + `goTo`**（放在 `cellWalkable` 之后）

```js
  /* 可走判据工厂。人是 1×1；车占 w×h，必须整个车身都放得下 —— 只查锚点那一格
     的话，3×2 的豪华 SUV 会从两格宽的缝里挤过去。 */
  function walkableFor(iso, w, h) {
    const cw = Math.max(1, w | 0), ch = Math.max(1, h | 0);
    if (cw === 1 && ch === 1) return (x, y) => cellWalkable(iso, x, y);
    return (x, y) => {
      for (let dy = 0; dy < ch; dy++) {
        for (let dx = 0; dx < cw; dx++) if (!cellWalkable(iso, x + dx, y + dy)) return false;
      }
      return true;
    };
  }

  function goTo(gx, gy) {
    const iso = Farm.isoView;
    if (!iso || !iso._on) return false;
    if (iso._build) return false;                       // 建造模式不抢点击
    if (Farm.state && Farm.state._visitLock) return false;  // 别人的农场不是你的地
    if (A.gx == null) spawnAt(iso);
    const size = carSize();
    const free = walkableFor(iso, size.w, size.h);
    const path = Farm.pathfind.find(A.gx, A.gy, gx, gy, free);
    if (!path || path.length < 1) return false;
    A.queue = [];
    A.job = { kind: 'goto', gx: gx, gy: gy };
    A.path = path;
    A.pathI = 1;                                        // path[0] 是起点，从下一格开始走
    A.anim = 'walk';
    A.pause = 0;
    return true;
  }
```

**3c. `src/js/farmer.js` — 驾驶态占位**（本任务先只加字段与空实现，Task 3 填内容）

在 `emptyActor()` 的返回对象里加 `path: null, pathI: 0, driving: null,`。
在文件里加：

```js
  // 驾驶中车占几格；没在开车时按 1×1（就是人自己）。Task 3 接上真实车款。
  function carSize() {
    if (A.driving == null) return { w: 1, h: 1 };
    const iso = Farm.isoView;
    const o = (Farm.state.data.map || [])[A.driving];
    if (!iso || !o || !iso._carWh) return { w: 1, h: 1 };
    return iso._carWh(o);
  }
  // 驾驶中的速度；没在开车就是走路速度。Task 3 接上四档车速。
  function moveSpeed() { return WALK_SPEED; }
```

**3d. `src/js/farmer.js` — `tick()` 里处理 `goto`**

在处理 `harvest/water/plant` 的那段 **之前** 插入：

```js
    if (A.job && A.job.kind === 'goto') {
      A.anim = 'walk';
      const path = A.path;
      if (!path || A.pathI >= path.length) {
        A.job = null; A.path = null; A.anim = 'idle';
        A.pause = IDLE_PAUSE[0] + Math.random() * (IDLE_PAUSE[1] - IDLE_PAUSE[0]);
        if (Farm.farmer._onArrive) Farm.farmer._onArrive();
        return;
      }
      const step = path[A.pathI];
      if (moveToward(dt, step.gx, step.gy, moveSpeed())) A.pathI++;
      return;
    }
```

**3e. 导出**：在 `Farm.farmer = { ... }` 里加 `goTo: goTo, walkableFor: walkableFor, _onArrive: null,`。

**3f. `src/js/mapview-iso.js` — 点空地派 goto**

把 `_tapCell` 第一行

```js
      const idx = this._cellToPlot[gx + ',' + gy]; if (idx == null) { this._stickyEnd(); return; }
```

改成

```js
      // 空地（不是菜地）→ 派人走过去 / 开过去。2026-08-20 之前这里是直接 return，
      // 点空地毫无反应，所以「点哪儿去哪儿」不跟任何现有操作抢点击。
      const idx = this._cellToPlot[gx + ',' + gy];
      if (idx == null) {
        this._stickyEnd();
        if (Farm.farmer && Farm.farmer.goTo) Farm.farmer.goTo(gx, gy);
        return;
      }
```

- [ ] **Step 4: 跑测试，确认全过**

```bash
node --check src/js/farmer.js && node --check src/js/mapview-iso.js
node scripts/verify/cdp.mjs "http://127.0.0.1:8000/src/" "scripts/verify/car-drive-tests.js" 9000
```

Expected: `failures: []`。

- [ ] **Step 5: 提交**

```bash
git add src/js/farmer.js src/js/mapview-iso.js scripts/verify/car-drive-tests.js
git commit -m "点农场任意空地，人绕开障碍走过去"
```

---

### Task 3: 上车、开车、四档车速

**Files:**
- Modify: `src/js/farmer.js`（`carSize` / `moveSpeed` 接真车款；`board` / `unboard`）
- Modify: `src/js/mapview-iso.js`（`_openCarPanel` 加按钮；渲染循环用实时车位）
- Test: `scripts/verify/car-drive-tests.js`（追加第 3 组断言）

**Interfaces:**
- Consumes: `Farm.farmer.goTo`、`Farm.farmer.walkableFor`（Task 2），`iso._carWh(o)`、
  `iso._carSpec(o)`（`mapview-iso.js` 现有，返回含 `cat` 的车款规格）
- Produces:
  - `Farm.farmer.board(mapIdx) → boolean`（上车）
  - `Farm.farmer.unboard() → boolean`（下车，人落在车旁第一个可走格）
  - `Farm.farmer.drivingIdx() → number|null`
  - `Farm.farmer.carPos(mapIdx) → {gx,gy}|null`（渲染用；只对正在开的那辆返回实时位置）
  - `CAR_SPEED = { utility: 4.4, family: 6.0, offroad: 7.5, luxury: 9.0 }`

- [ ] **Step 1: 写失败的测试**

追加：

```js
  // ---- 第 3 组：上车 / 开车 / 车速 ----
  T('C0 board/unboard 已导出',
    typeof Farm.farmer.board === 'function' && typeof Farm.farmer.unboard === 'function');

  // 造一辆车：直接塞进 map（走 _placeNewCar 要花钱，测试不该依赖余额）
  const spot = iso._findHomeSpot(iso._carWh(1), -1, null, 'car');
  T('C1 有地方停车', !!spot);
  if (spot && typeof Farm.farmer.board === 'function') {
    Farm.state.data.map.push({ type: 'car', gx: spot.gx, gy: spot.gy, lv: 1 });
    const carIdx = Farm.state.data.map.length - 1;

    T('C2 上车成功', Farm.farmer.board(carIdx) === true);
    T('C3 驾驶态记住了这辆车', Farm.farmer.drivingIdx() === carIdx);
    await sleep(1500);   // 人先走到车边才算真正坐进去

    T('C4 驾驶中车位跟着人走', !!Farm.farmer.carPos(carIdx));
    T('C5 没在开的车不给实时位置', Farm.farmer.carPos(carIdx + 999) === null);

    // 车速：旧皮卡(utility) 必须明显快于走路
    const drivingSpeed = Farm.farmer._speedNow();
    T('C6 开车比走路快', drivingSpeed > 2.2);
    T('C7 农用车是 4.4', Math.abs(drivingSpeed - 4.4) < 0.001);

    // 换成豪华车 → 9.0
    Farm.state.data.map[carIdx].lv = 16;
    T('C8 豪华车是 9.0', Math.abs(Farm.farmer._speedNow() - 9.0) < 0.001);

    T('C9 下车成功', Farm.farmer.unboard() === true);
    T('C10 下车后不再是驾驶态', Farm.farmer.drivingIdx() === null);
    const a2 = Farm.farmer._actor();
    T('C11 下车后人站在能走的格子上', Farm.farmer.walkableFor(iso, 1, 1)(Math.round(a2.gx), Math.round(a2.gy)));

    Farm.state.data.map.splice(carIdx, 1);
  }
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node scripts/verify/cdp.mjs "http://127.0.0.1:8000/src/" "scripts/verify/car-drive-tests.js" 12000`
Expected: `failures` 含 `C0 board/unboard 已导出`。

- [ ] **Step 3: 写实现**

**3a. `src/js/farmer.js` — 车速表 + 真实现**（替换 Task 2 里 `carSize` / `moveSpeed` 的占位）

```js
  /* 🔒 车款价差 = 速度差（Chris 2026-08-20 定）。除此之外车没有别的属性。
     四档写死一张表：调数值不用动逻辑。 */
  const CAR_SPEED = { utility: 4.4, family: 6.0, offroad: 7.5, luxury: 9.0 };

  function drivingCar() {
    if (A.driving == null) return null;
    const o = (Farm.state.data && Farm.state.data.map || [])[A.driving];
    return (o && o.type === 'car') ? o : null;
  }
  function carSize() {
    const o = drivingCar(), iso = Farm.isoView;
    if (!o || !iso || !iso._carWh) return { w: 1, h: 1 };
    return iso._carWh(o);
  }
  function moveSpeed() {
    const o = drivingCar(), iso = Farm.isoView;
    if (!o || !iso || !iso._carSpec) return WALK_SPEED;
    return CAR_SPEED[iso._carSpec(o).cat] || WALK_SPEED;
  }
```

**3b. `src/js/farmer.js` — 上下车**

```js
  function board(mapIdx) {
    const iso = Farm.isoView;
    if (!iso || !iso._on || iso._build) return false;
    if (Farm.state && Farm.state._visitLock) return false;
    const o = (Farm.state.data.map || [])[mapIdx];
    if (!o || o.type !== 'car') return false;
    if (A.gx == null) spawnAt(iso);
    A.queue = [];                     // 点了上车就立刻去；手上的农活不留半截
    A.job = null; A.path = null;
    A.driving = mapIdx;
    // 人此刻站在车外：把 actor 挪到车的锚点，视觉上就是坐进去（≤1 格的位移）
    A.gx = o.gx; A.gy = o.gy;
    A.anim = 'idle';
    if (iso.render) iso.render();
    return true;
  }

  function unboard() {
    const iso = Farm.isoView;
    const o = drivingCar();
    A.driving = null;
    A.job = null; A.path = null; A.anim = 'idle';
    if (!iso || !o) return true;
    // 人落在车旁第一个能站的格子；四周都站不了就退回车的锚点（不至于卡死）
    const free = walkableFor(iso, 1, 1);
    const wh = iso._carWh(o);
    const ring = [];
    for (let x = o.gx - 1; x <= o.gx + wh.w; x++) { ring.push([x, o.gy - 1]); ring.push([x, o.gy + wh.h]); }
    for (let y = o.gy; y < o.gy + wh.h; y++) { ring.push([o.gx - 1, y]); ring.push([o.gx + wh.w, y]); }
    for (let i = 0; i < ring.length; i++) {
      if (free(ring[i][0], ring[i][1])) { A.gx = ring[i][0]; A.gy = ring[i][1]; break; }
    }
    if (iso.render) iso.render();
    return true;
  }

  function drivingIdx() { return A.driving; }
  function carPos(mapIdx) {
    if (A.driving == null || A.driving !== mapIdx) return null;
    return { gx: A.gx, gy: A.gy };
  }
```

**3c. `src/js/farmer.js` — 驾驶中人不画**

`depthDraw()` 开头加一行：

```js
    if (A.driving != null) return null;   // 人在车里，车自己会被画出来
```

**3d. `src/js/farmer.js` — 农活自动下车**

`enqueue()` 里，在 `if (Farm.state && Farm.state._visitLock) return false;` 之后加：

```js
    if (A.driving != null) unboard();   // 派农活就自动下车，不把人困在车上
```

**3e. 导出**：`Farm.farmer` 对象里加

```js
    board: board, unboard: unboard, drivingIdx: drivingIdx, carPos: carPos,
    _speedNow: moveSpeed,
```

**3f. `src/js/mapview-iso.js` — 渲染用实时车位**

把渲染循环里

```js
        const mv = this._moving && this._moving.kind === 'building' && this._moving.idx === i;
        const gx = mv ? this._moving.gx : o.gx, gy = mv ? this._moving.gy : o.gy;
```

改成

```js
        const mv = this._moving && this._moving.kind === 'building' && this._moving.idx === i;
        // 正在被开的那辆车按 actor 的实时位置画（跟 _moving 同一个套路）
        const dv = (Farm.farmer && Farm.farmer.carPos) ? Farm.farmer.carPos(i) : null;
        const gx = mv ? this._moving.gx : (dv ? dv.gx : o.gx);
        const gy = mv ? this._moving.gy : (dv ? dv.gy : o.gy);
```

**3g. `src/js/mapview-iso.js` — `_openCarPanel` 加上/下车按钮**

在 `_openCarPanel(idx, cat)` 生成的 HTML 里，标题下方插入一行按钮；驾驶中显示「下车」：

```js
      const driving = (Farm.farmer && Farm.farmer.drivingIdx && Farm.farmer.drivingIdx() === idx);
      const rideBtn = (this._build || (Farm.state && Farm.state._visitLock)) ? '' :
        '<button class="btn" id="carRideBtn" style="width:100%;margin:0 0 10px;">'
        + (driving ? (en ? '🚶 Get out' : '🚶 下车') : (en ? '🚗 Get in' : '🚗 上车')) + '</button>';
```

把 `rideBtn` 拼进面板 HTML，并在绑定处加：

```js
      const rb = document.getElementById('carRideBtn');
      if (rb) rb.onclick = () => {
        if (Farm.audio) Farm.audio.play('tap');
        if (driving) Farm.farmer.unboard();
        else Farm.farmer.board(idx);
        Farm.ui.hideModal();
      };
```

- [ ] **Step 4: 跑测试，确认全过**

```bash
node --check src/js/farmer.js && node --check src/js/mapview-iso.js
node scripts/verify/cdp.mjs "http://127.0.0.1:8000/src/" "scripts/verify/car-drive-tests.js" 12000
```

Expected: `failures: []`。

- [ ] **Step 5: 提交**

```bash
git add src/js/farmer.js src/js/mapview-iso.js scripts/verify/car-drive-tests.js
git commit -m "上车开车：四档车速，驾驶中人不画、车跟着走"
```

---

### Task 4: 停车落盘 + 驾驶态不落盘

**Files:**
- Modify: `src/js/farmer.js`（到达回调 `_onArrive` 里回写车位并存档）
- Modify: `src/js/state.js`（**只在必要时**：确认 `map` 落盘路径无需改动；若发现存档会写入 `driving` 字段则删掉）
- Test: `scripts/verify/car-drive-tests.js`（追加第 4 组断言）

**Interfaces:**
- Consumes: `Farm.farmer.board/unboard/drivingIdx`（Task 3）、`iso._footprintFree(gx,gy,'car',idx,wh)`
- Produces: 到达后 `Farm.state.data.map[idx].gx/gy` 已更新且 `Farm.state.save()` 已调用

- [ ] **Step 1: 写失败的测试**

追加：

```js
  // ---- 第 4 组：停车落盘 ----
  const spot2 = iso._findHomeSpot(iso._carWh(1), -1, null, 'car');
  if (spot2) {
    Farm.state.data.map.push({ type: 'car', gx: spot2.gx, gy: spot2.gy, lv: 1 });
    const ci = Farm.state.data.map.length - 1;
    const before = { gx: spot2.gx, gy: spot2.gy };
    Farm.farmer.board(ci);
    await sleep(300);

    // 开到一个够远、车身放得下的地方
    const carFree = Farm.farmer.walkableFor(iso, iso._carWh(1).w, iso._carWh(1).h);
    const ob2 = iso._ownedBounds();
    let far = null;
    for (let y = ob2.y2; y >= ob2.y1 && !far; y--) {
      for (let x = ob2.x2; x >= ob2.x1; x--) {
        if (carFree(x, y) && (Math.abs(x - before.gx) + Math.abs(y - before.gy)) > 4) { far = { gx: x, gy: y }; break; }
      }
    }
    T('D1 找得到一个够远的停车点', !!far);
    if (far) {
      Farm.farmer.goTo(far.gx, far.gy);
      for (let i = 0; i < 60 && Farm.farmer.drivingIdx() !== null; i++) await sleep(200);
      const rec = Farm.state.data.map[ci];
      T('D2 车真的换了停车位', rec.gx !== before.gx || rec.gy !== before.gy);
      T('D3 停的位置是合法车位', iso._footprintFree(rec.gx, rec.gy, 'car', ci, iso._carWh(rec)));
      T('D4 到了自动下车', Farm.farmer.drivingIdx() === null);
      const saved = JSON.parse(localStorage.getItem('eastern_farm_save_v1') || '{}');
      const savedCar = (saved.map || []).filter((m) => m && m.type === 'car').pop();
      T('D5 新车位进了存档', !!savedCar && savedCar.gx === rec.gx && savedCar.gy === rec.gy);
      T('D6 存档里没有驾驶态', JSON.stringify(saved).indexOf('"driving"') === -1);
    }
    Farm.state.data.map.splice(ci, 1);
    Farm.state.save();
  }
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node scripts/verify/cdp.mjs "http://127.0.0.1:8000/src/" "scripts/verify/car-drive-tests.js" 25000`
Expected: `failures` 含 `D2 车真的换了停车位`。

- [ ] **Step 3: 写实现**

`src/js/farmer.js` — 把 Task 2 里 `goto` 分支的 `Farm.farmer._onArrive()` 占位换成真正的落车逻辑。新增：

```js
  /* 到站：车停在合法车位并写进存档，然后人下车。
     🔒 停车点必须过 _footprintFree —— 走的判据只保证「车身格子能通行」，
     而停车还不能压路面/装饰，也不能和别的建筑重叠。开到的那格停不下时，
     从近到远找最近的合法车位，人再走完最后几步。 */
  function arriveGoto() {
    const iso = Farm.isoView;
    if (A.driving == null || !iso) return;
    const idx = A.driving;
    const o = (Farm.state.data.map || [])[idx];
    if (!o || o.type !== 'car') { A.driving = null; return; }
    const wh = iso._carWh(o);
    const ax = Math.round(A.gx), ay = Math.round(A.gy);
    let px = null, py = null;
    if (iso._footprintFree(ax, ay, 'car', idx, wh)) { px = ax; py = ay; }
    else {
      for (let r = 1; r <= 6 && px == null; r++) {
        for (let dy = -r; dy <= r && px == null; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (iso._footprintFree(ax + dx, ay + dy, 'car', idx, wh)) { px = ax + dx; py = ay + dy; break; }
          }
        }
      }
    }
    if (px == null) { px = o.gx; py = o.gy; }   // 实在没地方停 → 停回原位，不丢车
    o.gx = px; o.gy = py;
    A.gx = px; A.gy = py;
    unboard();
    if (Farm.state && Farm.state.save) Farm.state.save();
  }
```

把 `goto` 分支里的

```js
        if (Farm.farmer._onArrive) Farm.farmer._onArrive();
```

改成

```js
        if (A.driving != null) arriveGoto();
```

并从 `Farm.farmer` 导出里删掉 `_onArrive: null,`。

- [ ] **Step 4: 跑测试，确认全过**

```bash
node --check src/js/farmer.js
node scripts/verify/cdp.mjs "http://127.0.0.1:8000/src/" "scripts/verify/car-drive-tests.js" 25000
```

Expected: `failures: []`。

- [ ] **Step 5: 提交**

```bash
git add src/js/farmer.js scripts/verify/car-drive-tests.js
git commit -m "开到哪停到哪：车位过合法性校验后写进存档，驾驶态不落盘"
```

---

### Task 5: 接进发布闸门并上线

**Files:**
- Modify: `deploy.sh`（在闸门 H 之后加闸门 I，照抄闸门 F/G 的写法）

- [ ] **Step 1: 加闸门**

在 `deploy.sh` 闸门 H 之后插入：

```bash
  # 闸门 I: 开车去任意地方(约 25 秒)
  # 2026-08-20 加：寻路一坏，人就从水塘和房子里穿过去；停车落盘一坏，
  # 开完车刷新就弹回原位。两者都不抛异常 —— 闸门 B 的冒烟看不见。
  echo "▶ 闸门 I: 开车/寻路回归测试(约 25 秒)…"
  $PYCMD -m http.server 8153 --bind 127.0.0.1 >/dev/null 2>&1 &
  CAR_PID=$!
  trap 'kill $CAR_PID 2>/dev/null || true' EXIT
  sleep 1
  CAR_OUT="$(mktemp)"
  EF_MOBILE=1 EF_CDP_TIMEOUT=60000 node scripts/verify/cdp.mjs "http://127.0.0.1:8153/src/" "scripts/verify/car-drive-tests.js" 200 >"$CAR_OUT" 2>/dev/null || true
  kill $CAR_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const r = o.evalResult;
    if (!r) { console.error("✗ 开车测试没跑出结果"); process.exit(1); }
    if (r.failures && r.failures.length) {
      console.error("✗ 开车/寻路是坏的:");
      r.failures.forEach(f => console.error("  - " + f));
      process.exit(1);
    }
    console.log("  ✓ 寻路 + 上下车 + 停车落盘全过");
  ' "$CAR_OUT"; then
    echo "—— 部署中止：人会穿墙，或者车停的位置存不进档。"
    exit 1
  fi
```

- [ ] **Step 2: 本地全量验证**

```bash
node --check src/js/pathfind.js && node --check src/js/farmer.js && node --check src/js/mapview-iso.js
bash -n deploy.sh
```

Expected: 全部无输出（通过）。

- [ ] **Step 3: 部署**

```bash
bash deploy.sh "农场：点哪儿去哪儿，有车就开车去（贵的车更快）"
```

Expected: 闸门 A–I 全过，推送到 main 成功。

- [ ] **Step 4: 线上实测**

等 1–2 分钟 Pages 构建完，用手机视口无头浏览器打生产站 `https://farm.easternmarket.ca/`，
确认：商店买得到车、点空地人会走、点车有「🚗 上车」、开车到别处车停在新位置。
**拿到实测输出再报完成。**

- [ ] **Step 5: 更新文档**

在 `docs/superpowers/specs/2026-08-20-drive-car-anywhere-design.md` 的 A 期标题后标注
「✅ 已上线 YYYY-MM-DD」，并把 `CLAUDE.md`（农场那份）的功能清单补一行。提交。

---

## Self-Review

**Spec 覆盖检查：**

| Spec 要求 | 对应任务 |
|---|---|
| 点空地人绕过去 | Task 2 |
| 点车 →「🚗 上车」 | Task 3 (3g) |
| 驾驶中点任意处，车开过去 | Task 2 (goto) + Task 3 (carSize/moveSpeed) |
| 到了人下车站在车旁 | Task 4 (`arriveGoto` → `unboard`) |
| 驾驶中再点车 →「🚶 下车」 | Task 3 (3g) |
| 驾驶中点菜地自动下车 | Task 3 (3d, `enqueue` 里) |
| 四档车速 | Task 3 (3a) + 测试 C6–C8 |
| 驾驶态不落盘、刷新自动下车 | Task 3（`A.driving` 只在 actor 上）+ 测试 D6 |
| 车真的换停车位并存档 | Task 4 + 测试 D2/D3/D5 |
| 上车即清空农活队列 | Task 3 (`board` 里 `A.queue = []`) |
| 建造 / 拜访模式禁用 | Task 2 (`goTo`) + Task 3 (`board`) + 测试 G5/G6 |
| 只在已解锁的地里走 | `cellWalkable` 已含 `_ownedCell`，Task 2 复用 |
| 寻路 4 邻接不擦角 | Task 1 + 测试 P2 |
| 大车放不下就停最近合法位 | Task 4 (`arriveGoto` 的环形搜索) |

**未覆盖**：无。

**占位符扫描**：无 TBD / TODO / 「类似 Task N」。每个代码步骤都有完整代码块。

**类型一致性**：`walkableFor(iso, w, h)`、`carPos(mapIdx)`、`drivingIdx()`、`_speedNow()`
在 Task 2/3/4 与测试中拼写一致；`Farm.pathfind.find` 的 6 个参数与 Task 1 定义一致；
Task 2 引入的 `_onArrive` 占位在 Task 4 明确删除（不留悬挂导出）。
