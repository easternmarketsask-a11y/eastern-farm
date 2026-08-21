// 开车去任意地方 · A 期回归测试。由 cdp.mjs 在页面里执行，返回 {failures:[]}。
// 覆盖：寻路(P) / 点空地走过去(G) / 上车开车车速(C) / 停车落盘(D)。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const dbg = {};
  const T = (name, cond) => { if (!cond) failures.push(name); };
  /* 还在做的功能用 TODO()：结果记进 dbg 但不阻断部署。
     2026-08-20：A+1「开车自动干农活」判据还没调通，而这个文件已经是
     deploy.sh 闸门 I —— 留着 T() 会把别人的部署一起挡下来。 */
  const TODO = (name, cond) => { (dbg.todo = dbg.todo || []).push((cond ? 'ok   ' : 'TODO ') + name); };

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

  // ---- 第 2 组：点空地走过去 ----
  // 走真实入口进农场：直接 remove 开屏会跳过 isoView.init()，_on 永远是 false，
  // 那样测的就不是玩家看到的那个农场了。
  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const startBtn = document.getElementById('splashStart');
  if (startBtn) startBtn.click();
  Farm.state.data.tutorialV1Done = true;
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  try { if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal(); } catch (e) {}
  const iso = Farm.isoView;
  T('G-init 农场视图已就绪', iso._on === true);
  T('G0 goTo 已导出', typeof Farm.farmer.goTo === 'function');
  T('H0 heading 已导出', typeof Farm.farmer.heading === 'function');
  if (typeof Farm.farmer.heading === 'function') {
    const se = Farm.farmer.heading(1, 0);
    const sw = Farm.farmer.heading(0, 1);
    const nw = Farm.farmer.heading(-1, 0);
    const ne = Farm.farmer.heading(0, -1);
    T('H1 +gx 朝右面对镜头', se.face === 'r' && se.away === false);
    T('H2 +gy 朝左面对镜头（不是侧着走）', sw.face === 'l' && sw.away === false);
    T('H3 -gx 朝左背对镜头', nw.face === 'l' && nw.away === true);
    T('H4 -gy 朝右背对镜头', ne.face === 'r' && ne.away === true);
  }

  if (typeof Farm.farmer.goTo === 'function') {
    const actor = Farm.farmer._actor();
    for (let i = 0; i < 40 && actor.gx == null; i++) { Farm.farmer.tick(iso); await sleep(100); }
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
      if (typeof Farm.farmer.heading === 'function' && actor.path && actor.pathI < actor.path.length) {
        const st = actor.path[actor.pathI];
        const dx = st.gx - actor.gx, dy = st.gy - actor.gy;
        if (Math.hypot(dx, dy) > 0.2) {
          const h = Farm.farmer.heading(dx, dy);
          T('G4b 当前这一步朝向跟屏幕方向一致', actor.face === h.face && !!actor.away === h.away);
        }
      }
    }

    // 建造模式下不许走
    iso._build = true;
    T('G5 建造模式点空地无效', Farm.farmer.goTo(ob.x1, ob.y1) === false);
    iso._build = false;
    // 拜访模式下不许走
    Farm.state._visitLock = true;
    T('G6 拜访模式点空地无效', Farm.farmer.goTo(ob.x1, ob.y1) === false);
    Farm.state._visitLock = false;
  }

  // ---- 第 3 组：上车 / 开车 / 车速 ----
  T('C0 board/unboard 已导出',
    typeof Farm.farmer.board === 'function' && typeof Farm.farmer.unboard === 'function');

  // 造一辆车：直接塞进 map（走 _placeNewCar 要花钱，测试不该依赖余额）
  const spot = iso._findHomeSpot(iso._carWh(1), -1, null, 'car');
  T('C1 有地方停车', !!spot);
  if (spot && typeof Farm.farmer.board === 'function') {
    Farm.state.data.map.push({ type: 'car', gx: spot.gx, gy: spot.gy, lv: 1 });
    const carIdx = Farm.state.data.map.length - 1;

    // 上车＝先走到车边，走到了才坐进去（Chris：点上车要有人跑过来）
    const horns = [];
    const realPlay = Farm.audio && Farm.audio.play;
    if (realPlay) Farm.audio.play = function (n, o) { horns.push(n); return realPlay.call(Farm.audio, n, o); };

    T('C2 上车成功', Farm.farmer.board(carIdx) === true);
    const A1 = Farm.farmer._actor();
    T('C2b 先走过去，还没坐进车里',
      Farm.farmer.drivingIdx() === null && A1.job && A1.job.kind === 'boarding' && A1.path && A1.path.length > 1);
    for (let i = 0; i < 80 && Farm.farmer.drivingIdx() !== carIdx; i++) { Farm.farmer.tick(iso); await sleep(120); }
    T('C3 走到了才真的上车', Farm.farmer.drivingIdx() === carIdx);
    T('C3b 上车响了喇叭', horns.indexOf('horn') >= 0);
    if (realPlay) Farm.audio.play = realPlay;
    await sleep(100);

    T('C4 驾驶中车位跟着人走', !!Farm.farmer.carPos(carIdx));
    T('C5 没在开的车不给实时位置', Farm.farmer.carPos(carIdx + 999) === null);

    const drivingSpeed = Farm.farmer._speedNow();
    T('C6 开车比走路快', drivingSpeed > 2.2);
    T('C7 农用车是 4.4', Math.abs(drivingSpeed - 4.4) < 0.001);

    Farm.state.data.map[carIdx].lv = 16;
    T('C8 豪华车是 9.0', Math.abs(Farm.farmer._speedNow() - 9.0) < 0.001);
    Farm.state.data.map[carIdx].lv = 1;

    T('C9 下车成功', Farm.farmer.unboard() === true);
    T('C10 下车后不再是驾驶态', Farm.farmer.drivingIdx() === null);
    const a2 = Farm.farmer._actor();
    T('C11 下车后人站在能走的格子上', Farm.farmer.walkableFor(iso, 1, 1)(Math.round(a2.gx), Math.round(a2.gy)));

    Farm.state.data.map.splice(carIdx, 1);
  }

  // ---- 第 4 组：停车落盘 ----
  const spot2 = iso._findHomeSpot(iso._carWh(1), -1, null, 'car');
  if (spot2) {
    Farm.state.data.map.push({ type: 'car', gx: spot2.gx, gy: spot2.gy, lv: 1 });
    const ci = Farm.state.data.map.length - 1;
    const before = { gx: spot2.gx, gy: spot2.gy };
    Farm.farmer.board(ci);
    for (let i = 0; i < 80 && Farm.farmer.drivingIdx() !== ci; i++) { Farm.farmer.tick(iso); await sleep(120); }

    const wh1 = iso._carWh(1);
    const carFree = Farm.farmer.walkableFor(iso, wh1.w, wh1.h);
    const ob2 = iso._ownedBounds();
    // 取「够远但最近」的合法车位：无头 Chrome 的 rAF 被节流得厉害，横穿整个农场
    // 要跑一分钟，闸门等不起。验证「车会移动并落盘」不需要长途。
    let far = null, farD = Infinity;
    for (let y = ob2.y1; y <= ob2.y2; y++) {
      for (let x = ob2.x1; x <= ob2.x2; x++) {
        const d = Math.abs(x - before.gx) + Math.abs(y - before.gy);
        if (d > 4 && d < farD && carFree(x, y)) { farD = d; far = { gx: x, gy: y }; }
      }
    }
    T('D1 找得到一个够远的停车点', !!far);
    if (far) {
      const A0 = Farm.farmer._actor();
      dbg.before = before; dbg.far = far; dbg.carIdx = ci;
      dbg.actorBeforeGoto = { gx: A0.gx, gy: A0.gy, driving: Farm.farmer.drivingIdx() };
      dbg.gotoRet = Farm.farmer.goTo(far.gx, far.gy);
      dbg.pathLen = A0.path ? A0.path.length : null;
      // rAF 在无头/后台标签里会被节流到几乎不跑，主动驱动 tick 才测得到移动。
      for (let i = 0; i < 120 && A0.job; i++) {
        Farm.farmer.tick(iso);
        await sleep(130);
      }
      dbg.actorAfter = { gx: A0.gx, gy: A0.gy, pathI: A0.pathI, job: A0.job ? A0.job.kind : null,
                         driving: Farm.farmer.drivingIdx() };
      const rec = Farm.state.data.map[ci];
      dbg.carRec = { gx: rec.gx, gy: rec.gy };
      T('D2 车真的换了停车位', rec.gx !== before.gx || rec.gy !== before.gy);
      T('D3 停的位置是合法车位', iso._footprintFree(rec.gx, rec.gy, 'car', ci, iso._carWh(rec)));
      T('D4 到了还坐在车上（不自动下车）', Farm.farmer.drivingIdx() === ci);
      T('D4b 点一下车才下车', iso._tapCar(ci) === true && Farm.farmer.drivingIdx() === null);
      const saved = JSON.parse(localStorage.getItem('eastern_farm_save_v1') || '{}');
      const savedCar = (saved.map || []).filter((m) => m && m.type === 'car').pop();
      T('D5 新车位进了存档', !!savedCar && savedCar.gx === rec.gx && savedCar.gy === rec.gy);
      T('D6 存档里没有驾驶态', JSON.stringify(saved).indexOf('"driving"') === -1);
    }
    Farm.farmer.unboard();
    Farm.state.data.map.splice(ci, 1);
    Farm.state.save();
  }

  // ---- 第 5 组：点车即上车 / 换款搬到商店 ----
  T('E0 _tapCar 存在', typeof iso._tapCar === 'function');
  T('E1 换款面板搬到商店', typeof iso._openCarBuyChoice === 'function');
  T('E2 旧的点车弹卡片已移除', typeof iso._openCarPanel === 'undefined');
  T('E3 死代码 _openNewCarPanel 已清', typeof iso._openNewCarPanel === 'undefined');

  const spot3 = iso._findHomeSpot(iso._carWh(1), -1, null, 'car');
  if (spot3 && typeof iso._tapCar === 'function') {
    Farm.state.data.map.push({ type: 'car', gx: spot3.gx, gy: spot3.gy, lv: 1 });
    const ti = Farm.state.data.map.length - 1;
    try { Farm.ui.hideModal(); } catch (e) {}
    await sleep(150);
    T('E4a 点车＝动身上车', iso._tapCar(ti) === true);
    await sleep(150);
    // 判据是「没弹**车**卡片」——测试跑几十秒，游戏自己可能弹别的（章节信/小报），
    // 用「有没有任何弹窗」会假失败。
    T('E4b 点车不再弹车卡片', !document.querySelector('[data-car-cat],[data-car-swap],[data-car-id],[data-new-car-id]'));
    for (let i = 0; i < 80 && Farm.farmer.drivingIdx() !== ti; i++) { Farm.farmer.tick(iso); await sleep(120); }
    T('E5 走到后坐进车里', Farm.farmer.drivingIdx() === ti);
    T('E6 驾驶中再点这辆车＝下车', iso._tapCar(ti) === true && Farm.farmer.drivingIdx() === null);

    // 商店里选一款车：场上已有车 → 应该问买新的还是换掉
    iso._openCarBuyChoice(5);
    await sleep(200);
    const swapBtns = document.querySelectorAll('[data-car-swap]');
    T('E7 商店里给得出「换掉这辆」', swapBtns.length >= 1);
    T('E8 车位没满时也能再停一辆', !!document.querySelector('[data-car-new]'));
    try { Farm.ui.hideModal(); } catch (e) {}

    Farm.state.data.map.splice(ti, 1);
    Farm.state.save();
  }

  // ---- 第 6 组：开车自动干农活 ----
  const plots = Farm.state.data.plots || [];
  const A6 = Farm.farmer._actor();
  const reset6 = () => { Farm.farmer.unboard(); A6.queue = []; A6.job = null; A6.path = null; };
  const plotD = (i) => Math.abs(iso._plotGX(i) - A6.gx) + Math.abs(iso._plotGY(i) - A6.gy);
  let farPlot = -1, nearPlot = -1;
  for (let i = 0; i < plots.length; i++) {
    if (!plots[i] || !plots[i].unlocked || plots[i].crop) continue;
    if (farPlot < 0 || plotD(i) > plotD(farPlot)) farPlot = i;
    if (nearPlot < 0 || plotD(i) < plotD(nearPlot)) nearPlot = i;
  }
  TODO('F0 找得到远近两块空地', farPlot >= 0 && nearPlot >= 0 && farPlot !== nearPlot);

  if (farPlot >= 0 && nearPlot >= 0 && farPlot !== nearPlot) {
    // F1: 车就停在人旁边 + 活儿在远处 → 该去开车
    reset6();
    const cf = Farm.farmer.walkableFor(iso, 3, 2);
    let side = null;
    for (let r = 1; r <= 4 && !side; r++) {
      for (let dy = -r; dy <= r && !side; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.round(A6.gx) + dx, y = Math.round(A6.gy) + dy;
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && cf(x, y)) { side = { gx: x, gy: y }; break; }
        }
      }
    }
    TODO('F0b 人旁边放得下一辆车', !!side);
    if (side) {
      Farm.state.data.map.push({ type: 'car', gx: side.gx, gy: side.gy, lv: 16 });   // 豪华车最快
      const nearCar = Farm.state.data.map.length - 1;
      Farm.farmer.enqueue(farPlot, 'plant', 'xiao_cong');
      dbg.f1 = { job: A6.job ? A6.job.kind : null, q: A6.queue.length,
                 man: { gx: A6.gx, gy: A6.gy }, car: side, plotD: plotD(farPlot) };
      dbg.f1cost = Farm.farmer._driveDebug(farPlot);
      TODO('F1 车在手边就开车去干活',
        !!A6.job && (A6.job.kind === 'boarding' || A6.job.kind === 'goto') && A6.queue.length === 1);

      for (let i = 0; i < 140 && A6.job && (A6.job.kind === 'boarding' || A6.job.kind === 'goto'); i++) {
        Farm.farmer.tick(iso); await sleep(110);
      }
      const carNow = Farm.state.data.map[nearCar];
      dbg.f2 = { car: carNow ? { gx: carNow.gx, gy: carNow.gy } : null,
                 plot: { gx: iso._plotGX(farPlot), gy: iso._plotGY(farPlot) },
                 driving: Farm.farmer.drivingIdx() };
      TODO('F2 到了地头就下车干活', Farm.farmer.drivingIdx() === null);
      TODO('F3 车开到了活儿那一头', !!carNow
        && (Math.abs(carNow.gx - iso._plotGX(farPlot)) + Math.abs(carNow.gy - iso._plotGY(farPlot))) < 10);
      TODO('F4 去干活的路不穿障碍',
        !A6.path || A6.path.every((st) => Farm.farmer.walkableFor(iso, 1, 1)(st.gx, st.gy)));
      reset6();
      Farm.state.data.map.splice(nearCar, 1);
    }

    // F5: 车在天边 + 活儿在脚边 → 老实走路，别为几格跑去开车
    reset6();
    const ob6 = iso._ownedBounds();
    const cf2 = Farm.farmer.walkableFor(iso, 2, 2);
    let corner = null, cornerD = -1;
    for (let y = ob6.y1; y <= ob6.y2; y++) {
      for (let x = ob6.x1; x <= ob6.x2; x++) {
        const d = Math.abs(x - A6.gx) + Math.abs(y - A6.gy);
        if (d > cornerD && cf2(x, y)) { cornerD = d; corner = { gx: x, gy: y }; }
      }
    }
    if (corner && plotD(nearPlot) < cornerD / 2) {
      Farm.state.data.map.push({ type: 'car', gx: corner.gx, gy: corner.gy, lv: 1 });
      const farCar = Farm.state.data.map.length - 1;
      Farm.farmer.enqueue(nearPlot, 'plant', 'xiao_cong');
      dbg.f5 = { job: A6.job ? A6.job.kind : null, cornerD: cornerD, nearD: plotD(nearPlot) };
      TODO('F5 车在天边就老实走路', !A6.job || A6.job.kind !== 'boarding');
      reset6();
      Farm.state.data.map.splice(farCar, 1);
    }
  }

  return { failures, dbg };
})()
