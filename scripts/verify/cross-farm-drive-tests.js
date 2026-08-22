(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [], dbg = {};
  const T = (n, c) => { if (!c) failures.push(n); };
  for (let i = 0; i < 250 && !(window.Farm && Farm.farmer); i++) await sleep(100);
  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const sb = document.getElementById('splashStart'); if (sb) sb.click();
  Farm.state.data.tutorialV1Done = true;
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const iso = Farm.isoView, d = Farm.state.data, A = Farm.farmer._actor();
  d.spotlightDone = true; d.level = 12; d.coins = 99999; d.landLevel = 4; d.warehouseCapacity = 9999;

  const cid = Farm.crops.all().filter((c) => (c.unlock_level || 1) <= 12)[0].id;
  const grow = (Farm.crops.get(cid).grow_minutes || 30) * 60000;
  const mkPlots = () => (d.plots || []).slice(0, 6).map((p, i) => Object.assign({}, p, {
    unlocked: true, crop: cid, plantedAt: Date.now() - grow - 60000,
    harvestsLeft: 0, watered: true,
    gx: 3 + (i % 3), gy: i < 3 ? 6 : 20,     // 北 y=6 / 南 y=20，隔 14 格
  }));

  /* 只测**决策**，不模拟整场收割：
     手动 tick 会和游戏自己的 rAF 循环抢，跑出来的结果每次都不一样（试过）。
     这里把人放在北边、下一件活指向南边，推一帧，看它是不是决定去开车。 */
  const setup = (carAt) => {
    d.plots = mkPlots();
    d.map = (d.map || []).filter((o) => o && o.type !== 'car');
    if (carAt) d.map.push({ type: 'car', gx: carAt[0], gy: carAt[1], lv: 1 });
    if (iso._buildLayout) iso._buildLayout();
    A.gx = 3; A.gy = 6; A.driving = null; A.job = null; A.queue = []; A.path = null; A.pause = 0;
  };

  // ① 下一块地在南边（远）+ 场上有车 → 应该去开车
  setup([7, 6]);
  A.queue = [{ plotIdx: 3, kind: 'harvest', cropId: null }];   // 南边那块
  Farm.farmer.tick(iso);   // tick 收的是 iso，不是 dt
  const wentDriving = (A.job && A.job.kind === 'boarding') || A.driving != null;
  dbg.far = { job: A.job && A.job.kind, driving: A.driving, queue: A.queue.length };
  T('D1 下一块地在另一片区域时，会去开车', wentDriving);
  // 活不能弄丢 —— 上车只是路上的一段，队列里那件事还得在
  T('D2 去开车时那件活留在队列里没丢', A.queue.length === 1 || (A.job && A.job.kind === 'boarding'));

  // ② 下一块地就在隔壁（近）→ 不该上下车（连片菜地逐块上车太吵）
  setup([7, 6]);
  A.queue = [{ plotIdx: 1, kind: 'harvest', cropId: null }];   // 同一片，隔一格
  Farm.farmer.tick(iso);   // tick 收的是 iso，不是 dt
  dbg.near = { job: A.job && A.job.kind, driving: A.driving };
  T('D3 隔壁那块地不去开车（连片菜地不该逐块上下车）',
    !(A.job && A.job.kind === 'boarding') && A.driving == null);

  /* ④ 车就停在脚边、下一块地只有 3 格远 → 仍然不该上车。
     这一条专门盯 REDRIVE_DIST 这个门槛：上一条（隔壁那块）其实是被 pickCarFor
     的「目的地比车还远才开车」挡下来的，把门槛调成 1 也照样绿 —— 门槛没被测到。
     这里把车放在人身边，pickCarFor 会同意，唯一能挡住的就只剩门槛本身。 */
  setup([4, 7]);                                   // 车紧挨着人
  d.plots[1].gx = 5; d.plots[1].gy = 6;            // 目标 2 格远，低于 REDRIVE_DIST
  if (iso._buildLayout) iso._buildLayout();
  A.gx = 3; A.gy = 6; A.driving = null; A.job = null; A.queue = []; A.path = null; A.pause = 0;
  A.queue = [{ plotIdx: 1, kind: 'harvest', cropId: null }];
  Farm.farmer.tick(iso);   // tick 收的是 iso，不是 dt
  dbg.shortHop = { job: A.job && A.job.kind, driving: A.driving };
  T('D5 车就在脚边、但只隔 2 格时也不上车（近距离上下车比走过去还慢）',
    !(A.job && A.job.kind === 'boarding') && A.driving == null);

  /* ⑤ 中等距离（5 格）也要开车。
     门槛原来定 6，Chris 的南北两片地没触发 —— 「两片地」不一定隔很远，
     隔四五格在等距画面上已经是走半天的一段路了。 */
  setup([7, 6]);
  d.plots[1].gx = 3; d.plots[1].gy = 10;
  if (iso._buildLayout) iso._buildLayout();
  A.gx = 3; A.gy = 6; A.driving = null; A.job = null; A.queue = []; A.path = null; A.pause = 0;
  /* ⚠️ 距离要**量出来**，不能照着地块坐标心算：干活的落脚点是 approachPos（本块地
     朝镜头的前缘，带 +0.14/+0.38 的偏移），比地块本身又远了一截。
     心算成 5 格、实际 6 格，这条用例就卡在门槛上，把门槛改回 6 也照样绿 —— 白测。 */
  const apMid = Farm.farmer._approachPos ? Farm.farmer._approachPos(iso, 1) : null;
  const midDist = apMid ? Math.max(Math.abs(apMid.gx - A.gx), Math.abs(apMid.gy - A.gy)) : -1;
  A.queue = [{ plotIdx: 1, kind: 'harvest', cropId: null }];
  Farm.farmer.tick(iso);   // tick 收的是 iso，不是 dt
  dbg.midHop = { job: A.job && A.job.kind, driving: A.driving, dist: midDist };
  T('D6 中等距离（量出来 4–5 格，就是「另一片地」的量级）也会去开车',
    midDist >= 4 && midDist <= 5 && ((A.job && A.job.kind === 'boarding') || A.driving != null));

  // ③ 场上没车 → 照旧走过去，不能卡住
  setup(null);
  A.queue = [{ plotIdx: 3, kind: 'harvest', cropId: null }];
  Farm.farmer.tick(iso);   // tick 收的是 iso，不是 dt
  dbg.nocar = { job: A.job && A.job.kind, hasPath: !!A.path };
  T('D4 没有车时照旧走过去，不卡住', !!A.job && A.job.kind === 'harvest' && !!A.path);

  return { failures, dbg };
})()
