// 开车去任意地方 · A 期回归测试。由 cdp.mjs 在页面里执行，返回 {failures:[]}。
// 覆盖：寻路(P) / 点空地走过去(G) / 上车开车车速(C) / 停车落盘(D)。
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

    T('C2 上车成功', Farm.farmer.board(carIdx) === true);
    T('C3 驾驶态记住了这辆车', Farm.farmer.drivingIdx() === carIdx);
    await sleep(300);

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

  return { failures };
})()
