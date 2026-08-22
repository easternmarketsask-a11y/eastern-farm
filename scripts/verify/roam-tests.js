// 「走到看得见的地方」回归测试（2026-08-22）。由 cdp.mjs 在页面里执行，返回 {failures:[]}。
//
// 这一关要钉死的三件事，每一件坏了都不会抛异常、冒烟测试也看不见：
//   ① 疏林疏得不够 → 放开了范围但一步也走不出去（四邻接寻路 = 方格站点渗流，
//      空地率低于约 0.593 就没有贯穿通路）。这是最容易「改了等于没改」的失败态。
//   ② 树的判据在渲染和寻路两边漂移 → 人从树干里穿过去，或撞上看不见的树。
//   ③ 玩家走到的是**硬矩形边界**（隐形空气墙）而不是那圈密林。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const dbg = {};
  const T = (name, cond) => { if (!cond) failures.push(name); };

  for (let i = 0; i < 250 && !(window.Farm && Farm.isoView && Farm.farmer && Farm.state); i++) await sleep(100);
  /* 🔒 必须走**真实入口**进农场（同 car-drive-tests 的教训）：直接
     __splashDismiss() 会跳过 isoView.init()，`_on` 永远是 false，而 goTo()
     第一行就是 `if (!iso._on) return false` —— 于是 W8 那条端到端会假红，
     而且看起来像是寻路坏了。 */
  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const sb = document.getElementById('splashStart'); if (sb) sb.click();
  Farm.state.data.tutorialV1Done = true;
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  T('W-init 农场视图已就绪', Farm.isoView._on === true);

  const iso = Farm.isoView, d = Farm.state.data;
  d.tutorialV1Done = true; d.spotlightDone = true;
  if (iso._buildLayout) iso._buildLayout();
  await sleep(200);

  // 从人当前所在格泛洪，量「实际能走到哪」——不看常量，看寻路真的走得通的格子。
  const flood = (free, home) => {
    const A = Farm.farmer._actor();
    let sx = A.gx, sy = A.gy;
    if (sx == null || !free(sx, sy)) {           // 出生点被占：从地界中心就近找一格站住
      outer:
      for (let r = 0; r <= 12; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = Math.round((A.gx == null ? home.x : A.gx) + dx),
                  y = Math.round((A.gy == null ? home.y : A.gy) + dy);
            if (free(x, y)) { sx = x; sy = y; break outer; }
          }
        }
      }
    }
    if (sx == null || !free(sx, sy)) return null;
    const seen = new Set([sx + ',' + sy]);
    const q = [[Math.round(sx), Math.round(sy)]];
    const cells = [];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let head = 0;
    while (head < q.length && cells.length < 20000) {
      const [cx, cy] = q[head++];
      cells.push([cx, cy]);
      for (const [ddx, ddy] of DIRS) {
        const nx = cx + ddx, ny = cy + ddy, k = nx + ',' + ny;
        if (seen.has(k) || !free(nx, ny)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return { cells, seen, start: [sx, sy] };
  };

  /* 三种地界都要过：老存档的 BACK、新号的 FRONT、以及**买满地之后**
     —— 地界越大，外面留给野地的余量越小，最容易出现「走两步就到硬边界」。 */
  const SCENARIOS = [
    { id: 'back-L0', origin: 'back', lv: 0 },
    { id: 'front-L0', origin: 'front', lv: 0 },
    { id: 'front-max', origin: 'front', lv: 4 },
  ];
  for (const sc of SCENARIOS) {
  d.landOrigin = sc.origin; d.landLevel = sc.lv;
  if (iso._buildLayout) iso._buildLayout();
  const A0 = Farm.farmer._actor();
  A0.path = null; A0.gx = null; A0.gy = null;   // 换地界后重新找立足点
  const ob = iso._ownedBounds();
  const owned = (x, y) => x >= ob.x1 && x <= ob.x2 && y >= ob.y1 && y <= ob.y2;
  const P = (n) => sc.id + ' ' + n;
  const home = { x: Math.round((ob.x1 + ob.x2) / 2), y: Math.round((ob.y1 + ob.y2) / 2) };
  const free1 = Farm.farmer.walkableFor(iso, 1, 1);
  const R = flood(free1, home);
  T(P('W0 人有立足之地'), !!R);
  if (!R) continue;

  const outside = R.cells.filter(([x, y]) => !owned(x, y));
  const offGrid = R.cells.filter(([x, y]) => x < 0 || y < 0 || x >= 28 || y >= 26);
  dbg[sc.id + '.reachable'] = R.cells.length;
  dbg[sc.id + '.outsideOwned'] = outside.length;
  dbg[sc.id + '.offGrid'] = offGrid.length;
  dbg[sc.id + '.ownedRect'] = [ob.x1, ob.y1, ob.x2, ob.y2];

  // ① 真的走得出去。150 格 ≈ 地界外一整圈还多，低于这个数就是林子还堵着。
  T(P('W1 能走到已买地界之外(>=150 格)'), outside.length >= 150);
  // ② 连农场网格都能走出去（Chris 要的是「看得见的地面」，不是「网格内」）。
  T(P('W2 能走出 28x26 农场网格'), offGrid.length >= 20);

  // ③ 树是真障碍：随机抽有树的格子，寻路必须拒绝。
  let treeCells = 0, treeWalkable = 0;
  for (let y = -3; y <= 33; y++) {
    for (let x = -5; x <= 33; x++) {
      if (!iso._wildTreeAt(x, y)) continue;
      treeCells++;
      if (free1(x, y)) treeWalkable++;
    }
  }
  dbg[sc.id + '.treeCells'] = treeCells; dbg[sc.id + '.treeWalkable'] = treeWalkable;
  T(P('W3 有树的格子一律不可走'), treeCells > 50 && treeWalkable === 0);

  // ④ 树的判据与镜头无关（渲染和寻路共用它，一旦掺进相机项就会两边漂移）。
  const sample = [];
  for (let y = -2; y <= 32; y += 3) for (let x = -4; x <= 32; x += 3) sample.push([x, y, iso._wildTreeAt(x, y)]);
  const z0 = iso._zoom, cx0 = iso._camX, cy0 = iso._camY;
  iso._zoom = z0 * 1.9; iso._camX = cx0 + 640; iso._camY = cy0 - 380;
  const drift = sample.filter(([x, y, was]) => iso._wildTreeAt(x, y) !== was).length;
  iso._zoom = z0; iso._camX = cx0; iso._camY = cy0;
  dbg[sc.id + '.treeDrift'] = drift;
  T(P('W4 树的判据不随镜头变化'), drift === 0);

  // ⑤ 玩家撞到的应该是**看得见的密林**，不是硬矩形边界（隐形空气墙）。
  const atHardEdge = R.cells.filter(([x, y]) => iso._walkEdgeDist(x, y) <= 0);
  dbg[sc.id + '.atHardEdge'] = atHardEdge.length;
  T(P('W5 走不到硬边界(该被密林先拦住)'), atHardEdge.length === 0);

  // ⑥ 不回归：已买地界里原本能走的地方，现在照样能走。
  let ownedBlocked = 0;
  for (let y = ob.y1; y <= ob.y2; y++) {
    for (let x = ob.x1; x <= ob.x2; x++) {
      if (iso._plotCellSet()[x + ',' + y]) continue;
      if (iso._buildingAt(x, y) >= 0) continue;
      if (iso._terrain()[x + ',' + y] === 'water') continue;
      if (!free1(x, y)) ownedBlocked++;
    }
  }
  dbg[sc.id + '.ownedBlocked'] = ownedBlocked;
  T(P('W6 已买地界内不因新规矩变得不可走'), ownedBlocked === 0);

  // ⑦ 车也要出得去（车占 w×h，整个车身都得放得下）。
  const carSpec = iso._carWh ? iso._carWh({ lv: 1 }) : { w: 2, h: 2 };
  const freeCar = Farm.farmer.walkableFor(iso, carSpec.w, carSpec.h);
  const RC = flood(freeCar, home);
  const carOutside = RC ? RC.cells.filter(([x, y]) => !owned(x, y)).length : 0;
  dbg[sc.id + '.carReachable'] = RC ? RC.cells.length : 0;
  dbg[sc.id + '.carOutsideOwned'] = carOutside;
  T(P('W7 车也能开出已买地界(>=80 格)'), carOutside >= 80);
  }

  /* W8 端到端：点一下地界外的空地，人**真的**走过去。
     前面几条量的是判据，这条量的是整条链路（点击 → travelTo → 寻路 → 迈腿）。
     ⚠️ 无头浏览器里 rAF 被节流、dt 被 clamp 到 0.12s，走路 2.2 格/秒 ⇒ 每 tick
     最多推进 0.264 格，所以等待次数必须按路径长度给足，不能写死。 */
  d.landOrigin = 'front'; d.landLevel = 0;
  if (iso._buildLayout) iso._buildLayout();
  const ob8 = iso._ownedBounds();
  const A8 = Farm.farmer._actor();
  A8.path = null; A8.job = null; A8.queue = [];
  A8.gx = Math.round((ob8.x1 + ob8.x2) / 2); A8.gy = Math.round((ob8.y1 + ob8.y2) / 2);
  const free8 = Farm.farmer.walkableFor(iso, 1, 1);
  if (!free8(A8.gx, A8.gy)) {
    outer8:
    for (let r = 1; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (free8(A8.gx + dx, A8.gy + dy)) { A8.gx += dx; A8.gy += dy; break outer8; }
    }
  }
  // 目标：地界外、离地界至少 3 格的一块空地
  let dest = null;
  for (let r = 3; r <= 9 && !dest; r++) {
    for (let dy = -r; dy <= r && !dest; dy++) {
      const x = ob8.x2 + r, y = A8.gy + dy;
      if (free8(x, y) && (x < ob8.x1 || x > ob8.x2)) dest = { gx: x, gy: y };
    }
  }
  dbg.w8 = { from: { gx: A8.gx, gy: A8.gy }, dest: dest, ownedRect: [ob8.x1, ob8.y1, ob8.x2, ob8.y2] };
  T('W8a 地界外找得到落脚点', !!dest);
  if (dest) {
    const ret = Farm.farmer.goTo(dest.gx, dest.gy);
    dbg.w8.goToRet = ret;
    dbg.w8.guards = { on: !!iso._on, build: !!iso._build, visitLock: !!(Farm.state && Farm.state._visitLock),
                      driving: A8.driving, startFree: free8(A8.gx, A8.gy), destFree: free8(dest.gx, dest.gy) };
    const pathLen = (A8.path || []).length;
    dbg.w8.pathLen = pathLen;
    T('W8b 寻路寻得出一条到地界外的路', pathLen > 1);
    for (let i = 0; i < pathLen * 12 + 80 && (A8.path || A8.job); i++) await sleep(50);
    dbg.w8.arrived = { gx: Math.round(A8.gx), gy: Math.round(A8.gy) };
    dbg.w8.outsideNow = A8.gx < ob8.x1 || A8.gx > ob8.x2 || A8.gy < ob8.y1 || A8.gy > ob8.y2;
    T('W8c 人真的走到了地界外', !!dbg.w8.outsideNow);
  }

  return { failures, dbg };
})()
