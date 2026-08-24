/**
 * farmer.js — 油画农户：九款形象、任务队列、走到并做完才生效。
 * 哈希契约：scripts/verify/farmer-look-test.mjs 必须与 lookFromUid/clampLook 逐字相同。
 */
(function () {
  const LOOKS = [
    { id: 1, zh: '男农户', en: 'Farmer (man)', child: false, shirt: '#e07030', pants: '#3d4a6a' },
    { id: 2, zh: '女农户', en: 'Farmer (woman)', child: false, shirt: '#3a8c50', pants: '#5a4638' },
    { id: 3, zh: '青年男', en: 'Young man', child: false, shirt: '#4a7ab5', pants: '#3d4a6a' },
    { id: 4, zh: '青年女', en: 'Young woman', child: false, shirt: '#c45a7a', pants: '#5a4638' },
    { id: 5, zh: '男孩', en: 'Boy', child: true, shirt: '#e8a020', pants: '#3d4a6a' },
    { id: 6, zh: '女孩', en: 'Girl', child: true, shirt: '#d48ac8', pants: '#6a4a6a' },
    { id: 7, zh: '爷爷', en: 'Grandfather', child: false, shirt: '#8b6a4a', pants: '#4a4038' },
    { id: 8, zh: '奶奶', en: 'Grandmother', child: false, shirt: '#d8c4a0', pants: '#6a5a48' },
    { id: 9, zh: '店员', en: 'Shop apron', child: false, shirt: '#2f7343', pants: '#3d4a6a' },
  ];
  const SHEET_COLS = 6, SHEET_ROWS = 5;
  const ANIMS = { idle: 0, walk: 1, water: 2, harvest: 3, plant: 4 };
  const FPS = 8;
  const WORK_HOLD = 1.05;     // harvest/plant/water 播完才生效；跳过站桩首尾帧
  const WALK_SPEED = 2.2;     // cells / second
  const IDLE_PAUSE = [2, 4];
  const DIR = 'assets/images/farmers/';

  function lookFromUid(uid) {
    if (!uid) return 1;
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    return (h % 9) + 1;
  }
  function clampLook(n) {
    const x = n | 0;
    return (x >= 1 && x <= 9) ? x : 2;
  }
  function lookOf(obj) {
    if (!obj) return 1;
    if (obj.farmerLook != null) {
      const x = obj.farmerLook | 0;
      if (x >= 1 && x <= 9) return x;
    }
    return lookFromUid(obj.uid);
  }
  function specOf(id) {
    return LOOKS[clampLook(id) - 1];
  }
  // 设置九宫格 / 东超头像共用。表是 6 列 × 5 行；写成 400% 会从格子底下漏出下一行的头。
  function previewStyle(look, anim) {
    const id = clampLook(look);
    const row = ANIMS[anim] || 0;
    const yPct = SHEET_ROWS <= 1 ? 0 : (row / (SHEET_ROWS - 1)) * 100;
    return 'background-image:url(' + DIR + 'p_farmer_' + id + '.webp);'
      + 'background-size:' + (SHEET_COLS * 100) + '% ' + (SHEET_ROWS * 100) + '%;'
      + 'background-position:0 ' + yPct + '%;'
      + 'background-repeat:no-repeat;';
  }

  const _img = {};
  const _back = {};
  function sheet(id) {
    const k = clampLook(id);
    const c = _img[k];
    if (c instanceof Image) return c;
    if (c === 'loading' || c === 'failed') return null;
    _img[k] = 'loading';
    const im = new Image();
    im.onload = () => { _img[k] = im; };
    im.onerror = () => { _img[k] = 'failed'; };
    im.src = DIR + 'p_farmer_' + k + '.webp';
    return null;
  }
  function backSheet(id) {
    const k = clampLook(id);
    const c = _back[k];
    if (c instanceof Image) return c;
    if (c === 'loading' || c === 'failed') return null;
    _back[k] = 'loading';
    const im = new Image();
    im.onload = () => { _back[k] = im; };
    im.onerror = () => { _back[k] = 'failed'; };
    im.src = DIR + 'p_farmer_' + k + '_back.webp';
    return null;
  }

  function emptyActor(look) {
    return {
      look: clampLook(look), gx: null, gy: null, face: 'r', away: false,
      anim: 'idle', frameT: 0, pause: 0,
      queue: [], job: null, visitHold: null,
      path: null, pathI: 0, driving: null, pendingGoto: null,
      driveT: 0, driveAccel: 0, driveBrake: 0, driveTurnT: 9,
      driveDust: [], driveDustAcc: 0, driveDx: 0, driveDy: 0,
      walkAccel: 0, walkDust: [], walkPlant: 0,
      boardHop: 0, alightHop: 0, _driveWasGoing: false,
    };
  }

  // 等距 2:1：屏幕右 = gx-gy 增大，朝镜头 = gx+gy 增大。
  // 贴图是 3/4 朝右下，左右靠翻转；背对镜头必须换背面行（见 blitSheet）。
  function heading(dx, dy) {
    const sx = dx - dy;
    const sy = dx + dy;
    if (sx === 0 && sy === 0) return { face: 'r', away: false };
    return { face: sx >= 0 ? 'r' : 'l', away: sy < 0 };
  }

  let A = emptyActor(2);
  let _lastT = 0;
  const PLAYER_OPTS = {
    canDrive: true,
    canPolish: true,
    canIdleWander: true,
    claimBoard: true,
  };

  function pendingList() {
    if (Farm.hands && Array.isArray(Farm.hands.board)) {
      if (A.queue && A.queue.length) {
        for (let i = 0; i < A.queue.length; i++) Farm.hands.board.push(A.queue[i]);
        A.queue.length = 0;
      }
      return Farm.hands.board;
    }
    return A.queue;
  }
  function actorCanWork(actor, opts) {
    if (!opts || !opts.claimBoard) return false;
    if (Farm.state && Farm.state._visitLock) return false;
    return true;
  }
  function jobHeld(actor, job) {
    return !!(actor && actor.job
      && actor.job.plotIdx === job.plotIdx && actor.job.kind === job.kind);
  }
  function plotBusy(job) {
    if (jobHeld(A, job)) return true;
    const acts = (Farm.hands && Farm.hands.actors) || [];
    for (let i = 0; i < acts.length; i++) if (jobHeld(acts[i], job)) return true;
    return false;
  }
  function jobStartable(iso, job) {
    if (!job) return false;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const plot = plots[job.plotIdx];
    if (!plot) return false;
    if (job.kind === 'plant') {
      if (plot.crop || !job.cropId) return false;
    } else if (!plot.crop) return false;
    if (job.kind === 'harvest' && !(Farm.crops && Farm.crops.isMature && Farm.crops.isMature(plot))) return false;
    if (job.kind === 'water' && Farm.tending && Farm.tending.canWater && !Farm.tending.canWater(plot)) return false;
    return true;
  }
  function claim(iso, actor, opts) {
    if (!actor || actor.job) return;
    if (!actorCanWork(actor, opts)) return;
    const board = pendingList();
    for (let i = 0; i < board.length; i++) {
      const job = board[i];
      if (plotBusy(job)) continue;
      if (!jobStartable(iso, job)) {
        board.splice(i, 1);
        i--;
        continue;
      }
      board.splice(i, 1);
      if (startJob(iso, actor, job, opts)) return;
      board.splice(i, 0, job);
    }
  }
  function filterBoard(keepFn) {
    const q = pendingList();
    for (let i = q.length - 1; i >= 0; i--) {
      if (!keepFn(q[i])) q.splice(i, 1);
    }
  }
  function clearPending() {
    const q = pendingList();
    q.length = 0;
    if (q !== A.queue) A.queue.length = 0;
  }

  function currentLook() {
    if (Farm.state && Farm.state.data) return clampLook(Farm.state.data.farmerLook);
    return 2;
  }

  function applyLook(id) {
    const n = clampLook(id);
    if (Farm.state && Farm.state.data) {
      Farm.state.data.farmerLook = n;
      if (Farm.state.save && !Farm.state._visitLock) Farm.state.save();
    }
    A.look = n;
    sheet(n);
    if (Farm.isoView && Farm.isoView.render) Farm.isoView.render();
  }

  function enqueue(plotIdx, kind, cropId) {
    if (!kind || (kind !== 'harvest' && kind !== 'water' && kind !== 'plant')) return false;
    if (Farm.state && Farm.state._visitLock) return false;
    const iso = Farm.isoView;
    if (!iso || plotIdx == null) return false;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const plot = plots[plotIdx];
    if (!plot || !plot.unlocked) return false;
    if (kind === 'plant') {
      if (plot.crop || !cropId) return false;
    } else if (!plot.crop) return false;
    if (kind === 'harvest' && !(Farm.crops && Farm.crops.isMature && Farm.crops.isMature(plot))) return false;
    if (kind === 'water' && Farm.tending && Farm.tending.canWater && !Farm.tending.canWater(plot)) return false;
    const cap = plots.filter((p) => p && p.unlocked).length || 12;
    const q = pendingList();
    if (q.length >= cap) return false;
    if (A.job && A.job.plotIdx === plotIdx && A.job.kind === kind) return false;
    const acts = (Farm.hands && Farm.hands.actors) || [];
    for (let i = 0; i < acts.length; i++) {
      const j = acts[i] && acts[i].job;
      if (j && j.plotIdx === plotIdx && j.kind === kind) return false;
    }
    for (let i = 0; i < q.length; i++) {
      if (q[i].plotIdx === plotIdx && q[i].kind === kind) return false;
    }
    q.push({ plotIdx: plotIdx, kind: kind, cropId: cropId || null });
    A.pause = 0;
    // 这一批活刚开工（队列从空变非空、手上没别的事）→ 算一次开车去值不值。
    // 只判这一次：开车只负责去干活的第一段路，菜地连片挨着，逐块上下车太吵。
    if (q.length === 1 && !A.job) {
      const wp = approachPos(iso, plotIdx);
      const carIdx = pickCarFor(iso, wp.gx, wp.gy);
      if (carIdx != null) {
        if (A.driving === carIdx) goTo(wp.gx, wp.gy, true);
        else board(carIdx, true);
      }
    }
    return true;
  }

  function enqueueHarvestAll(startIdx) {
    const iso = Farm.isoView;
    if (!iso || (Farm.state && Farm.state._visitLock)) return false;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const ripe = [];
    for (let i = 0; i < plots.length; i++) {
      if (plots[i] && plots[i].unlocked && plots[i].crop && Farm.crops && Farm.crops.isMature && Farm.crops.isMature(plots[i])) ripe.push(i);
    }
    if (!ripe.length) return false;
    const dist = (a, b) => {
      const dx = iso._plotGX(a) - iso._plotGX(b);
      const dy = iso._plotGY(a) - iso._plotGY(b);
      return dx * dx + dy * dy;
    };
    const left = ripe.slice();
    const order = [];
    let cur = (startIdx != null && left.indexOf(startIdx) >= 0) ? startIdx : left[0];
    while (left.length) {
      const at = left.indexOf(cur);
      if (at >= 0) left.splice(at, 1);
      order.push(cur);
      if (!left.length) break;
      let best = left[0], bd = Infinity;
      for (let k = 0; k < left.length; k++) {
        const d = dist(cur, left[k]);
        if (d < bd) { bd = d; best = left[k]; }
      }
      cur = best;
    }
    let n = 0;
    for (let i = 0; i < order.length; i++) {
      if (enqueue(order[i], 'harvest')) n++;
    }
    return n > 0;
  }

  /* exceptIdx：把 map 里的某一条当作「不存在」。开车时必须排除车自己 ——
     车本身就是一个 building，不排除的话它脚下那格永远不可走，寻路起点直接失败。 */
  /* 能不能站这一格。
     🔒 2026-08-22（Chris:「走动的范围是所有能见到的地方」）：判据从
     「在网格内 **且** 是我买下的地」放宽成「在可走世界里」—— 看得见的草甸
     都能走，不再被围在已买的矩形里。买地照旧只管**能在哪盖房、在哪开田**。
     野树现在是真障碍（`_wildTreeAt` 与渲染共用同一份判据），所以人不会
     从树干里穿过去；外圈的密林就是走不过去的那道墙。 */
  function cellWalkable(iso, gx, gy, exceptIdx) {
    const x = Math.round(gx), y = Math.round(gy);
    if (!iso._inWalkWorld(x, y)) return false;
    if (iso._wildTreeAt(x, y)) return false;
    if (iso._plotCellSet()[x + ',' + y]) return false;
    const b = iso._buildingAt(x, y);
    if (b >= 0 && !(exceptIdx != null && b === exceptIdx)) return false;
    const t = iso._terrain()[x + ',' + y];
    if (t === 'water') return false;
    return true;
  }

  /* 可走判据工厂。人是 1x1；车占 w×h，必须整个车身都放得下 —— 只查锚点那一格
     的话，3×2 的豪华 SUV 会从两格宽的缝里挤过去。 */
  function walkableFor(iso, w, h, exceptIdx) {
    const cw = Math.max(1, w | 0), ch = Math.max(1, h | 0);
    if (cw === 1 && ch === 1) return (x, y) => cellWalkable(iso, x, y, exceptIdx);
    return (x, y) => {
      for (let dy = 0; dy < ch; dy++) {
        for (let dx = 0; dx < cw; dx++) if (!cellWalkable(iso, x + dx, y + dy, exceptIdx)) return false;
      }
      return true;
    };
  }

  /* 🔒 车款价差 = 基础速度差（Chris 2026-08-20 定）。四档写死一张表。
     擦亮是奖励型加成：shine 0–1 最多再快 22%，地板就是目录速度。
     永远不会没油、不会坏、不会开不了（Chris 2026-08-21 否决惩罚型）。 */
  const CAR_SPEED = { utility: 4.4, family: 6.0, offroad: 7.5, luxury: 9.0 };
  const SHINE_BONUS = 0.22;
  const SHINE_DECAY = 0.007;
  const POLISH_COST = 50;

  function shineOf(o) {
    const s = o && o.shine;
    if (typeof s !== 'number' || !(s > 0)) return 0;
    return s > 1 ? 1 : s;
  }
  function cruiseSpeed(o) {
    const iso = Farm.isoView;
    if (!o || !iso || !iso._carSpec) return WALK_SPEED;
    return (CAR_SPEED[iso._carSpec(o).cat] || WALK_SPEED) * (1 + SHINE_BONUS * shineOf(o));
  }

  function drivingCar() {
    if (A.driving == null) return null;
    const o = ((Farm.state.data && Farm.state.data.map) || [])[A.driving];
    return (o && o.type === 'car') ? o : null;
  }
  // 驾驶中车占几格；没在开车时按 1x1（就是人自己）。
  function carSize() {
    const o = drivingCar(), iso = Farm.isoView;
    if (!o || !iso || !iso._carWh) return { w: 1, h: 1 };
    return iso._carWh(o);
  }
  // 驾驶中的速度；没在开车就是走路速度。
  function catalogSpeed() {
    const o = drivingCar(), iso = Farm.isoView;
    if (!o || !iso || !iso._carSpec) return WALK_SPEED;
    return CAR_SPEED[iso._carSpec(o).cat] || WALK_SPEED;
  }
  function moveSpeed() {
    let s = catalogSpeed();
    if (A.driving == null) return s;
    s *= 1 + SHINE_BONUS * shineOf(drivingCar());
    s *= 0.38 + 0.62 * Math.min(1, A.driveAccel || 0);
    s *= 1 - 0.58 * Math.min(1, A.driveBrake || 0);
    // 转弯那一下收一点油：90° 格子路本来会瞬间甩头，减速让车身跟上
    s *= 1 - 0.26 * Math.max(0, 1 - (A.driveTurnT == null ? 9 : A.driveTurnT) / 0.30);
    return s;
  }

  function remainingPath() {
    if (!A.path || A.pathI >= A.path.length) return 0;
    let d = Math.hypot(A.path[A.pathI].gx - A.gx, A.path[A.pathI].gy - A.gy);
    for (let i = A.pathI; i < A.path.length - 1; i++) {
      d += Math.hypot(A.path[i + 1].gx - A.path[i].gx, A.path[i + 1].gy - A.path[i].gy);
    }
    return d;
  }

  function pushDriveDust(side) {
    A.driveDust = A.driveDust || [];
    if (A.driveDust.length >= 36) return;
    const dx = A.driveDx || 0, dy = A.driveDy || 0;
    const px = -dy, py = dx;
    A.driveDust.push({
      gx: A.gx - dx * 0.34,
      gy: A.gy - dy * 0.34,
      t: 0,
      life: 0.44 + Math.random() * 0.34,
      ox: side * 0.24 + (Math.random() - 0.5) * 0.16,
      oy: (Math.random() - 0.06) * 0.22,
      vx: -dx * (1.05 + Math.random() * 0.45) + px * side * 0.18 + (Math.random() - 0.5) * 0.38,
      vy: -dy * (1.05 + Math.random() * 0.45) + py * side * 0.18 + (Math.random() - 0.5) * 0.30,
      r: 0.10 + Math.random() * 0.16,
      dark: Math.random() < 0.52,
      kind: Math.random() < 0.20 ? 'grass' : 'dust',
    });
  }

  function spawnDriveDust(dt) {
    A.driveDust = A.driveDust || [];
    A.driveDustAcc = (A.driveDustAcc || 0) + dt;
    const accel = A.driveAccel || 0, brake = A.driveBrake || 0;
    const gap = Math.max(0.022, 0.050 - 0.024 * accel - 0.010 * brake);
    while (A.driveDustAcc >= gap && A.driveDust.length < 36) {
      A.driveDustAcc -= gap;
      pushDriveDust(1);
      pushDriveDust(-1);
      if ((A.driveTurnT == null ? 9 : A.driveTurnT) < 0.22) {
        pushDriveDust(Math.random() < 0.5 ? 1 : -1);
      }
    }
  }

  function burstDriveDust(n) {
    for (let i = 0; i < n; i++) pushDriveDust(i % 2 ? 1 : -1);
  }

  function tickDrive(dt) {
    A.driveT = (A.driveT || 0) + dt;
    A.driveTurnT = (A.driveTurnT == null ? 9 : A.driveTurnT) + dt;
    const going = !!(A.job && A.job.kind === 'goto' && A.path);
    if (A._driveWasGoing && !going) burstDriveDust(10);
    A._driveWasGoing = going;
    if (going) {
      A.driveAccel = Math.min(1, (A.driveAccel || 0) + dt / 0.46);
      const left = remainingPath();
      A.driveBrake = left < 1.55 ? Math.min(1, (1.55 - left) / 1.55) : 0;
      spawnDriveDust(dt);
      // 转速跟着这辆车的速度走：皮卡低沉，豪华车高亢
      if (Farm.audio && Farm.audio.startEngine) {
        const sp = moveSpeed();
        Farm.audio.startEngine((sp - WALK_SPEED) / (9.0 - WALK_SPEED));
      }
      const car = drivingCar();
      if (car && shineOf(car) > 0) car.shine = Math.max(0, shineOf(car) - dt * SHINE_DECAY);
    } else {
      A.driveAccel = Math.max(0, (A.driveAccel || 0) - dt / 0.26);
      A.driveBrake = 0;
      if (Farm.audio && Farm.audio.stopEngine) Farm.audio.stopEngine();
    }
    const dust = A.driveDust || [];
    for (let i = dust.length - 1; i >= 0; i--) {
      dust[i].t += dt;
      dust[i].ox += (dust[i].vx || 0) * dt;
      dust[i].oy += (dust[i].vy || 0) * dt;
      if (dust[i].t >= dust[i].life) dust.splice(i, 1);
    }
  }

  function tickWalkDust(actor, dt) {
    actor.walkDust = actor.walkDust || [];
    if (actor.anim === 'walk' && actor.driving == null) {
      const phase = actor.frameT * Math.PI * (FPS / 3);
      const plant = Math.abs(Math.sin(phase));
      const prev = actor.walkPlant || 0;
      actor.walkPlant = plant;
      if (prev < 0.86 && plant >= 0.86 && actor.walkDust.length < 14) {
        const dx = actor.driveDx || 0, dy = actor.driveDy || 0;
        const side = (actor.walkDust.length % 2) ? 1 : -1;
        actor.walkDust.push({
          gx: actor.gx - dx * 0.06,
          gy: actor.gy - dy * 0.06,
          t: 0,
          life: 0.26 + Math.random() * 0.16,
          ox: side * 0.14 + (Math.random() - 0.5) * 0.06,
          oy: 0.05 + Math.random() * 0.07,
          vx: -dx * 0.32 + (Math.random() - 0.5) * 0.22,
          vy: -dy * 0.32 + (Math.random() - 0.5) * 0.16,
          r: 0.045 + Math.random() * 0.06,
          dark: Math.random() < 0.30,
          kind: Math.random() < 0.55 ? 'grass' : 'dust',
        });
        if (Farm.audio && Farm.audio.play) Farm.audio.play('step');
      }
    }
    const dust = actor.walkDust;
    for (let i = dust.length - 1; i >= 0; i--) {
      dust[i].t += dt;
      dust[i].ox += (dust[i].vx || 0) * dt;
      dust[i].oy += (dust[i].vy || 0) * dt;
      if (dust[i].t >= dust[i].life) dust.splice(i, 1);
    }
  }

  function driveFx() {
    if (A.driving == null) return null;
    const going = !!(A.job && A.job.kind === 'goto' && A.path);
    return {
      idx: A.driving,
      moving: going,
      t: A.driveT || 0,
      accel: A.driveAccel || 0,
      brake: A.driveBrake || 0,
      turnT: A.driveTurnT == null ? 9 : A.driveTurnT,
      face: A.face,
      away: !!A.away,
      dx: A.driveDx || 0,
      dy: A.driveDy || 0,
      dust: A.driveDust || [],
    };
  }

  // 车旁第一个能站人的格子（上车的落脚点、下车的去处，同一套判据）
  function carSideSpot(iso, o) {
    const free = walkableFor(iso, 1, 1);
    const wh = iso._carWh(o);
    const ring = [];
    for (let x = o.gx - 1; x <= o.gx + wh.w; x++) { ring.push([x, o.gy - 1]); ring.push([x, o.gy + wh.h]); }
    for (let y = o.gy; y < o.gy + wh.h; y++) { ring.push([o.gx - 1, y]); ring.push([o.gx + wh.w, y]); }
    for (let i = 0; i < ring.length; i++) if (free(ring[i][0], ring[i][1])) return { gx: ring[i][0], gy: ring[i][1] };
    return null;
  }

  /* 真正坐进去的那一刻：人藏进车里、响两下喇叭。
     🔒 别把它并回 board() —— board 只是「动身去车那边」，中间人还在走路。 */
  function mountNow(mapIdx) {
    const iso = Farm.isoView;
    const o = ((Farm.state.data && Farm.state.data.map) || [])[mapIdx];
    if (!o || o.type !== 'car') { A.job = null; A.path = null; A.anim = 'idle'; return false; }
    A.driving = mapIdx;
    A.gx = o.gx; A.gy = o.gy;
    A.boardHop = 0.32;
    A.job = null; A.path = null; A.anim = 'idle';
    if (Farm.audio && Farm.audio.play) Farm.audio.play('horn');
    // 上车是为了去某处 → 不用玩家再点一次，直接开过去
    if (A.pendingGoto && iso) {
      const g = A.pendingGoto; A.pendingGoto = null;
      if (goTo(g.gx, g.gy, true)) { if (iso.render) iso.render(); return true; }
    }
    // 上车是为了去干活 → 直接开到第一块地
    const pending = pendingList();
    if (pending.length && iso) {
      const wp = approachPos(iso, pending[0].plotIdx);
      if (goTo(wp.gx, wp.gy, true)) { if (iso.render) iso.render(); return true; }
    }
    /* 这句只在第一次上车时说一次。有了常驻的「下车」按钮之后，它的信息价值就低了，
       每次上车都弹一条横幅纯属噪音。老存档没有这个字段＝没看过，照样会看到一次。 */
    if (Farm.ui && Farm.ui.toast && !Farm.state.data.driveHintSeen) {
      const en = Farm.state.data.language === 'en';
      Farm.ui.toast(en ? 'Tap anywhere on the farm to drive there.' : '点农场上任意一处，车就开过去。');
      Farm.state.data.driveHintSeen = true;
      if (Farm.state.save && !Farm.state._visitLock) Farm.state.save();
    }
    if (iso && iso.render) iso.render();
    return true;
  }

  /* 上车＝先走到车边（Chris 2026-08-20：「点上车要有人跑过来」）。
     返回 true 只代表「动身了」，人还得走完这段路才真的坐进去。 */
  /* 🔒 开不开车的判据（Chris 2026-08-21 定）：
       **只要目的地比车还远，就去开车** —— 不分是去干活还是随便走走。
     早先算的是「开车省不省时间」（含 1.3 倍门槛），触发得太少；
     而且开车本身是有乐趣的（有引擎声、扬尘、悬挂弹跳），玩家想看车动。
     ⚠️ 唯一的下限：目的地不足 MIN_DRIVE_DIST 格就直接走 —— 两步路的距离，
     跑去上车、下车的动画比走过去还久。要更容易开车就把这个数调小。 */
  const MIN_DRIVE_DIST = 3;
  /* 一批活干到一半、下一块地隔了这么远，就值得回去开车（Chris 2026-08-22）。
     比 MIN_DRIVE_DIST 大是**故意的**：连片菜地之间才隔一两格，门槛太低会变成
     每干完一块就上下车一次，吵得没法看。
     ⚠️ 6 格太保守 —— Chris 的南北两片地实测没触发（「种地的时候他还是从北走到南」）。
     降到 4：仍然是连片菜地间距（1–2 格）的两倍以上，不会逐块上下车；
     而且 pickCarFor 还压着一道「目的地必须比车还远」，不会为了几步路专门跑去开车。 */
  const REDRIVE_DIST = 4;

  /* 人脚下那一格永远算可走 —— 车身完全可能盖在人身上（车停过来、人走过去都会），
     那时寻路的起点不可走，find() 直接返回 null，「走多久 / 开不开车」全成了
     无穷大，自动开车静默失效。你已经站在那儿了，从那儿出发当然是可以的。
     ⚠️ goTo / board / startJob 都依赖它，别再连着别的块一起删掉（2026-08-21 犯过）。 */
  function freeFromHere(free, actor) {
    actor = actor || A;
    const hx = Math.round(actor.gx), hy = Math.round(actor.gy);
    return (x, y) => ((x === hx && y === hy) || free(x, y));
  }

  // 走得到吗、几步。走不到返回 Infinity（那条路不算数）
  function walkSteps(iso, fx, fy, tx, ty, free) {
    const path = Farm.pathfind.find(fx, fy, tx, ty, freeFromHere(free));
    if (!path) return Infinity;
    if (path.length < 2) return 0;
    const last = path[path.length - 1];
    if (last.gx !== Math.round(tx) || last.gy !== Math.round(ty)) return Infinity;
    return path.length - 1;
  }

  /* 车能不能开到目的地附近。车停不到地头是常态（落脚点紧贴菜地，车身放不下），
     所以只要求「开得过去」，剩下几步走过去。 */
  function carCanReach(iso, o, carIdx, tx, ty) {
    const wh = iso._carWh(o);
    const path = Farm.pathfind.find(o.gx, o.gy, tx, ty, walkableFor(iso, wh.w, wh.h, carIdx));
    if (!path) return false;
    const end = path[path.length - 1];
    return (Math.abs(end.gx - Math.round(tx)) + Math.abs(end.gy - Math.round(ty))) <= 4;
  }

  // 选车：走得到、且「人→车」比「人→目的地」近的，取最近的那辆
  function pickCarFor(iso, tx, ty) {
    if (A.driving != null) return A.driving;            // 已经在车上
    const map = (Farm.state.data && Farm.state.data.map) || [];
    const walkFree = walkableFor(iso, 1, 1);
    const toTarget = walkSteps(iso, A.gx, A.gy, tx, ty, walkFree);
    if (!isFinite(toTarget) || toTarget < MIN_DRIVE_DIST) return null;
    let best = null, bestToCar = Infinity;
    for (let i = 0; i < map.length; i++) {
      const o = map[i];
      if (!o || o.type !== 'car') continue;
      const side = carSideSpot(iso, o);
      if (!side) continue;
      const toCar = walkSteps(iso, A.gx, A.gy, side.gx, side.gy, walkFree);
      if (!isFinite(toCar)) continue;
      if (toCar >= toTarget) continue;                  // 车比目的地还远 → 不值当
      if (!carCanReach(iso, o, i, tx, ty)) continue;
      if (toCar < bestToCar) { bestToCar = toCar; best = i; }
    }
    return best;
  }

  /* 判据摊开给测试和调参看。这个判据一偏，「自动开车」就会静默地
     永不触发或到处乱触发，而它不报任何错。 */
  function driveDebug(plotIdx) {
    const iso = Farm.isoView;
    const tp = (plotIdx && plotIdx.gx != null) ? plotIdx : plotPos(iso, plotIdx);
    const tx = tp.gx, ty = tp.gy;
    const map = (Farm.state.data && Farm.state.data.map) || [];
    const walkFree = walkableFor(iso, 1, 1);
    const out = { man: { gx: A.gx, gy: A.gy }, target: { gx: tx, gy: ty },
                  toTarget: walkSteps(iso, A.gx, A.gy, tx, ty, walkFree),
                  minDist: MIN_DRIVE_DIST, cars: [] };
    for (let i = 0; i < map.length; i++) {
      const o = map[i];
      if (!o || o.type !== 'car') continue;
      const side = carSideSpot(iso, o);
      out.cars.push({ idx: i, at: { gx: o.gx, gy: o.gy }, side: side,
        toCar: side ? walkSteps(iso, A.gx, A.gy, side.gx, side.gy, walkFree) : Infinity,
        reach: carCanReach(iso, o, i, tx, ty) });
    }
    out.pick = pickCarFor(iso, tx, ty);
    return out;
  }

  /* 去某处 —— 该开车就开车，否则走路。点空地、派农活都走它。 */
  function travelTo(gx, gy, keepQueue) {
    const iso = Farm.isoView;
    if (!iso || !iso._on) return false;
    if (iso._build && !keepQueue) return false;   // 建造不抢点击；农活内部续走/续开仍放行
    if (Farm.state && Farm.state._visitLock) return false;
    if (A.gx == null) spawnAt(iso);
    if (A.driving != null) return goTo(gx, gy, keepQueue);   // 已经在车上，直接开
    const carIdx = pickCarFor(iso, gx, gy);
    if (carIdx == null) return goTo(gx, gy, keepQueue);      // 走过去
    A.pendingGoto = { gx: gx, gy: gy };                      // 上车后接着开过去
    if (board(carIdx, true)) return true;
    A.pendingGoto = null;
    return goTo(gx, gy, keepQueue);
  }

  function board(mapIdx, keepQueue) {
    const iso = Farm.isoView;
    if (!iso || !iso._on) return false;
    if (iso._build && !keepQueue) return false;
    if (Farm.state && Farm.state._visitLock) return false;
    const o = (Farm.state.data.map || [])[mapIdx];
    if (!o || o.type !== 'car') return false;
    if (A.gx == null) spawnAt(iso);
    const spot = carSideSpot(iso, o);
    if (!spot) return false;          // 车四周站不了人，上不去
    if (!keepQueue) clearPending();    // 手动点上车＝立刻去，手上的农活不留半截；
                                      // 自动开车去干活时要留着队列，那正是要去做的事
    A.job = null; A.path = null;
    if (Math.round(A.gx) === spot.gx && Math.round(A.gy) === spot.gy) return mountNow(mapIdx);
    const path = Farm.pathfind.find(A.gx, A.gy, spot.gx, spot.gy, freeFromHere(walkableFor(iso, 1, 1)));
    if (!path || path.length < 1) return false;
    A.job = { kind: 'boarding', car: mapIdx };
    A.path = path;
    A.pathI = 1;
    A.anim = 'walk';
    A.pause = 0;
    return true;
  }

  function finishPolish(o) {
    const en = Farm.state.data.language === 'en';
    if ((Farm.state.data.coins || 0) < POLISH_COST) {
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Not enough farm coins' : '农场币不够', 2200);
      if (Farm.audio) Farm.audio.play('error');
      return;
    }
    Farm.state.data.coins -= POLISH_COST;
    o.shine = 1;
    if (Farm.state.save) Farm.state.save();
    if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
    if (Farm.audio) Farm.audio.play('achievement');
    if (Farm.ui && Farm.ui.toast) {
      Farm.ui.toast(en ? 'Gleaming — it will run faster for a while.' : '擦得锃亮，这一阵子开起来更快。', 2800);
    }
    if (Farm.ui && Farm.ui.burst && Farm.isoView) {
      const c = Farm.isoView._cell(o.gx, o.gy);
      const r = Farm.isoView._cv && Farm.isoView._cv.getBoundingClientRect();
      if (r) Farm.ui.burst(r.left + c.x, r.top + c.y - 20, ['✨', '✨', '⭐'], 8);
    }
  }

  function polish(mapIdx) {
    const iso = Farm.isoView;
    const en = Farm.state.data.language === 'en';
    if (!iso || !iso._on || iso._build) return false;
    if (Farm.state && Farm.state._visitLock) return false;
    if (A.driving != null) return false;
    const o = (Farm.state.data.map || [])[mapIdx];
    if (!o || o.type !== 'car') return false;
    if (shineOf(o) >= 0.85) {
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Already gleaming' : '已经很亮了', 1800);
      return false;
    }
    if ((Farm.state.data.coins || 0) < POLISH_COST) {
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Not enough farm coins · 50' : '擦亮要 50 农场币', 2200);
      if (Farm.audio) Farm.audio.play('error');
      return false;
    }
    if (A.gx == null) spawnAt(iso);
    const spot = carSideSpot(iso, o);
    if (!spot) return false;
    clearPending();
    A.job = null; A.path = null;
    if (Math.round(A.gx) === spot.gx && Math.round(A.gy) === spot.gy) {
      A.job = { kind: 'polish', car: mapIdx };
      A.anim = 'harvest';
      A.frameT = 0;
      A.away = false;
      return true;
    }
    const path = Farm.pathfind.find(A.gx, A.gy, spot.gx, spot.gy, freeFromHere(walkableFor(iso, 1, 1)));
    if (!path || path.length < 1) return false;
    A.job = { kind: 'polish', car: mapIdx };
    A.path = path;
    A.pathI = 1;
    A.anim = 'walk';
    A.pause = 0;
    return true;
  }

  function unboard() {
    const iso = Farm.isoView;
    const o = drivingCar();
    if (Farm.audio && Farm.audio.stopEngine) Farm.audio.stopEngine();
    A.driveDust = [];
    A.driveAccel = 0;
    A.driveBrake = 0;
    A.driving = null;
    A.alightHop = 0.28;
    A.job = null; A.path = null; A.anim = 'idle';
    if (!iso || !o) return true;
    // 人落在车旁第一个能站的格子；四周都站不了就退回车的锚点（不至于卡死）
    const spot = carSideSpot(iso, o);
    A.gx = spot ? spot.gx : o.gx;
    A.gy = spot ? spot.gy : o.gy;
    if (Farm.state && Farm.state.save) Farm.state.save();
    if (iso.render) iso.render();
    return true;
  }

  /* 到站：车停在合法车位并写进存档，然后人下车。
     🔒 停车点必须过 _footprintFree —— 走的判据只保证「车身格子能通行」，
     而停车还不能压路面/装饰，也不能和别的建筑重叠。开到的那格停不下时，
     从近到远找最近的合法车位，人再走完最后几步。 */
  function arriveGoto() {
    const iso = Farm.isoView;
    if (A.driving == null || !iso) return;
    const idx = A.driving;
    const o = ((Farm.state.data && Farm.state.data.map) || [])[idx];
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
    /* 🔒 到了不自动下车（Chris 2026-08-20：「不要自动下车，点一下车才下车」）。
       开一段就被踢下车、想接着开还得走回车边，很烦。
       唯一例外是「开车本来就是为了去干活」—— 不下车干不成活。 */
    A.job = null; A.path = null; A.anim = 'idle';
    if (pendingList().length) unboard();
    if (Farm.state && Farm.state.save) Farm.state.save();
  }

  function drivingIdx() { return A.driving; }
  function carPos(mapIdx) {
    if (A.driving == null || A.driving !== mapIdx) return null;
    return { gx: A.gx, gy: A.gy, face: A.face, away: !!A.away };
  }

  function goTo(gx, gy, keepQueue) {
    const iso = Farm.isoView;
    if (!iso || !iso._on) return false;
    if (iso._build && !keepQueue) return false;             // 建造模式不抢点击；派农活的续走仍放行
    if (Farm.state && Farm.state._visitLock) return false;  // 别人的农场不是你的地
    if (A.gx == null) spawnAt(iso);
    const size = carSize();
    const free = walkableFor(iso, size.w, size.h, A.driving);
    const path = Farm.pathfind.find(A.gx, A.gy, gx, gy, freeFromHere(free));
    if (!path || path.length < 1) return false;
    if (!keepQueue) clearPending();
    A.job = { kind: 'goto', gx: gx, gy: gy };
    A.path = path;
    A.pathI = 1;                                            // path[0] 是起点，从下一格开始走
    A.anim = 'walk';
    A.pause = 0;
    return true;
  }

  function spawnAt(iso, actor) {
    actor = actor || A;
    const map = (Farm.state.data && Farm.state.data.map) || [];
    const home = map.find((m) => m && m.type === 'home');
    const tryPut = (gx, gy) => {
      if (cellWalkable(iso, gx, gy)) { actor.gx = gx; actor.gy = gy; return true; }
      return false;
    };
    if (home) {
      if (tryPut(home.gx + (home.w || 2), home.gy + (home.h || 2))) return;
      if (tryPut(home.gx, home.gy + 2)) return;
    }
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    for (let i = 0; i < plots.length; i++) {
      if (!plots[i] || !plots[i].unlocked) continue;
      const gx = iso._plotGX(i), gy = iso._plotGY(i);
      if (tryPut(gx + 1, gy)) return;
      if (tryPut(gx, gy + 1)) return;
    }
    const ob = iso._ownedBounds ? iso._ownedBounds() : { x1: 3, y1: 10, x2: 10, y2: 16 };
    const cx = (ob.x1 + ob.x2) / 2, cy = (ob.y1 + ob.y2) / 2;
    if (tryPut(cx, cy + 2)) return;
    actor.gx = cx; actor.gy = cy;
  }

  function pickIdleTarget(iso, actor) {
    actor = actor || A;
    const ob = iso._ownedBounds();
    const near = [];
    const x0 = Math.round(actor.gx), y0 = Math.round(actor.gy);
    for (let gy = ob.y1; gy <= ob.y2; gy++) {
      for (let gx = ob.x1; gx <= ob.x2; gx++) {
        if (Math.abs(gx - x0) + Math.abs(gy - y0) < 2) continue;
        if (Math.abs(gx - x0) + Math.abs(gy - y0) > 6) continue;
        if (cellWalkable(iso, gx, gy)) near.push({ gx: gx, gy: gy });
      }
    }
    if (!near.length) return null;
    return near[(Math.random() * near.length) | 0];
  }

  function approachPos(iso, plotIdx) {
    const gx = iso._plotGX(plotIdx), gy = iso._plotGY(plotIdx);
    const dirs = [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1]];
    for (let i = 0; i < dirs.length; i++) {
      const x = gx + dirs[i][0], y = gy + dirs[i][1];
      if (cellWalkable(iso, x, y)) return { gx: x, gy: y };
    }
    return { gx: gx + 0.2, gy: gy + 0.9 };
  }

  // 干活站在本块地朝镜头的前缘：手落在土/菜上。寻路只走到 approachPos。
  function plotPos(iso, plotIdx, kind) {
    const gx = iso._plotGX(plotIdx), gy = iso._plotGY(plotIdx);
    if (kind === 'plant') return { gx: gx + 0.12, gy: gy + 0.34 };
    if (kind === 'water') return { gx: gx + 0.32, gy: gy + 0.22 };
    return { gx: gx + 0.14, gy: gy + 0.38 };
  }

  function enqueueWaterAll(startIdx) {
    const iso = Farm.isoView;
    if (!iso || (Farm.state && Farm.state._visitLock)) return false;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const wet = [];
    for (let i = 0; i < plots.length; i++) {
      if (plots[i] && Farm.tending && Farm.tending.canWater && Farm.tending.canWater(plots[i])) wet.push(i);
    }
    if (!wet.length) return false;
    const dist = (a, b) => {
      const dx = iso._plotGX(a) - iso._plotGX(b);
      const dy = iso._plotGY(a) - iso._plotGY(b);
      return dx * dx + dy * dy;
    };
    const left = wet.slice();
    const order = [];
    let cur = (startIdx != null && left.indexOf(startIdx) >= 0) ? startIdx : left[0];
    while (left.length) {
      const at = left.indexOf(cur);
      if (at >= 0) left.splice(at, 1);
      order.push(cur);
      if (!left.length) break;
      let best = left[0], bd = Infinity;
      for (let k = 0; k < left.length; k++) {
        const d = dist(cur, left[k]);
        if (d < bd) { bd = d; best = left[k]; }
      }
      cur = best;
    }
    let n = 0;
    for (let i = 0; i < order.length; i++) {
      if (enqueue(order[i], 'water')) n++;
    }
    return n > 0;
  }

  function enqueuePlantAll(cropId, startIdx) {
    const iso = Farm.isoView;
    if (!iso || !cropId || (Farm.state && Farm.state._visitLock)) return false;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const empty = [];
    for (let i = 0; i < plots.length; i++) {
      if (plots[i] && plots[i].unlocked && !plots[i].crop) empty.push(i);
    }
    if (!empty.length) return false;
    const dist = (a, b) => {
      const dx = iso._plotGX(a) - iso._plotGX(b);
      const dy = iso._plotGY(a) - iso._plotGY(b);
      return dx * dx + dy * dy;
    };
    const left = empty.slice();
    const order = [];
    let cur = (startIdx != null && left.indexOf(startIdx) >= 0) ? startIdx : left[0];
    while (left.length) {
      const at = left.indexOf(cur);
      if (at >= 0) left.splice(at, 1);
      order.push(cur);
      if (!left.length) break;
      let best = left[0], bd = Infinity;
      for (let k = 0; k < left.length; k++) {
        const d = dist(cur, left[k]);
        if (d < bd) { bd = d; best = left[k]; }
      }
      cur = best;
    }
    let n = 0;
    for (let i = 0; i < order.length; i++) {
      if (enqueue(order[i], 'plant', cropId)) n++;
    }
    return n > 0;
  }

  function finishJob(iso, actor) {
    actor = actor || A;
    const job = actor.job;
    actor.job = null;
    actor.anim = 'idle';
    actor.frameT = 0;
    if (!job) return;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const plot = plots[job.plotIdx];
    if (job.kind === 'harvest') {
      if (Farm.farm && Farm.farm.harvestPlot) {
        const ev = iso._fakeEvt ? iso._fakeEvt(iso._plotGX(job.plotIdx), iso._plotGY(job.plotIdx)) : null;
        Farm.farm.harvestPlot(job.plotIdx, ev);
      }
      if (Farm.state && Farm.state.isWarehouseFull && Farm.state.isWarehouseFull()) {
        filterBoard((j) => j.kind !== 'harvest');
      }
    } else if (job.kind === 'water') {
      if (Farm.tending && Farm.tending.waterPlot) Farm.tending.waterPlot(job.plotIdx);
    } else if (job.kind === 'plant' && job.cropId && Farm.shop && Farm.shop._plantOne) {
      if ((Farm.state.data.seeds[job.cropId] || 0) <= 0) {
        if (!(Farm.shop._buyOneForPlanting && Farm.shop._buyOneForPlanting(job.cropId))) {
          filterBoard((j) => !(j.kind === 'plant' && j.cropId === job.cropId));
          if (Farm.ui && Farm.ui.toast) Farm.ui.toast(Farm.i18n ? Farm.i18n.t('toast_not_enough_coins') : '农场币不足');
          return;
        }
      }
      const r = Farm.shop._plantOne(job.plotIdx, job.cropId);
      if (r && r.ok) {
        if (Farm.farm && Farm.farm.renderGrid) Farm.farm.renderGrid();
        if (Farm.harvestStatus) Farm.harvestStatus.render();
        if (Farm.audio) Farm.audio.play('plant');
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      }
    }
  }

  function startJob(iso, actor, job, opts) {
    actor = actor || A;
    opts = opts || PLAYER_OPTS;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const plot = plots[job.plotIdx];
    if (!plot) return false;
    if (job.kind === 'plant') {
      if (plot.crop || !job.cropId) return false;
    } else if (!plot.crop) return false;
    if (job.kind === 'harvest' && !(Farm.crops && Farm.crops.isMature && Farm.crops.isMature(plot))) return false;
    if (job.kind === 'water' && Farm.tending && Farm.tending.canWater && !Farm.tending.canWater(plot)) return false;
    const ap = approachPos(iso, job.plotIdx);

    /* 跨区作业要开车过去（Chris 2026-08-22：「南北两个区域的菜地，收完北边
       要去收南边居然不会开车，太笨」）。
       原来只有 enqueue 里「这批活刚开工」时算过一次开车，之后每块地都靠腿走 ——
       菜地连成一片时没毛病，可农场一旦分成两片，中间那段长路就只会走过去。
       这里在**下一块地明显远**的时候再判一次：连片的近地照旧不上下车（逐块上下车太吵）。
       帮手 walk-only：!opts.canDrive 整段 REDRIVE / pickCarFor 跳过。 */
    if (opts.canDrive && actor.driving == null
        && Math.max(Math.abs(ap.gx - actor.gx), Math.abs(ap.gy - actor.gy)) >= REDRIVE_DIST) {
      const carIdx = pickCarFor(iso, ap.gx, ap.gy);
      if (carIdx != null) {
        const q = pendingList();
        q.unshift(job);
        if (board(carIdx, true)) return true;
        q.shift();
      }
    }

    actor.job = job;
    actor.anim = 'walk';
    actor.frameT = 0;
    actor.path = Farm.pathfind.find(actor.gx, actor.gy, ap.gx, ap.gy, freeFromHere(walkableFor(iso, 1, 1), actor));
    actor.pathI = 1;
    return true;
  }

  function moveToward(actor, dt, tx, ty, speed) {
    if (typeof actor === 'number') { speed = ty; ty = tx; tx = dt; dt = actor; actor = A; }
    const dx = tx - actor.gx, dy = ty - actor.gy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.08) { actor.gx = tx; actor.gy = ty; return true; }
    const h = heading(dx, dy);
    const prevFace = actor.face, prevAway = actor.away;
    actor.face = h.face;
    actor.away = h.away;
    actor.driveDx = dx / dist;
    actor.driveDy = dy / dist;
    if (actor.driving != null && (actor.face !== prevFace || actor.away !== prevAway)) actor.driveTurnT = 0;
    if (actor.driving != null && Farm.state && Farm.state.data && Farm.state.data.map) {
      const car = Farm.state.data.map[actor.driving];
      if (car && car.type === 'car') { car.face = actor.face; car.away = !!actor.away; }
    }
    let spd = speed || WALK_SPEED;
    if (actor.driving == null) {
      actor.walkAccel = Math.min(1, (actor.walkAccel || 0) + dt / 0.22);
      spd *= 0.70 + 0.30 * actor.walkAccel;
    }
    const step = spd * dt;
    if (step >= dist) { actor.gx = tx; actor.gy = ty; return true; }
    actor.gx += dx / dist * step;
    actor.gy += dy / dist * step;
    return false;
  }

  /* 已经派出去的农活：队列里有，或手上正在收/浇/种/走去上车。
     玩家点空地的 goto、闲逛、擦车不算。
     零参包装 () => doingFarmWork(A) 给建造闸门和旧测试用。 */
  function doingFarmWork(actor, opts) {
    if (arguments.length === 0) {
      actor = A;
      opts = PLAYER_OPTS;
    }
    actor = actor || A;
    const k = actor.job && actor.job.kind;
    if (k === 'harvest' || k === 'water' || k === 'plant' || k === 'boarding') return true;
    if (actor.queue && actor.queue.length) return true;
    if (opts && opts.claimBoard && actorCanWork(actor, opts)) {
      const q = pendingList();
      if (q && q.length) return true;
    }
    return false;
  }

  function tick(iso) {
    if (!iso || !iso._on) return;
    const now = Date.now();
    const dt = _lastT ? Math.min(0.12, (now - _lastT) / 1000) : 0.033;
    _lastT = now;
    tickActor(iso, A, PLAYER_OPTS, dt);
    if (Farm.hands && Farm.hands.tick) Farm.hands.tick(iso, dt);
  }

  function tickActor(iso, actor, opts, dt) {
    if (!iso || !actor) return;
    opts = opts || PLAYER_OPTS;
    if (typeof dt !== 'number' || !(dt >= 0)) dt = 0.033;
    if (!opts.canDrive) actor.driving = null;
    if (actor === A && !(Farm.state && Farm.state._visitLock)) actor.look = currentLook();
    sheet(actor.look);
    if (actor.away) backSheet(actor.look);
    if (actor.gx == null) spawnAt(iso, actor);

    if (actor === A && Farm.state && Farm.state._visitLock && !A.visitHold) {
      actor.anim = actor.anim === 'walk' ? 'idle' : (actor.anim || 'idle');
      actor.frameT += dt;
      return;
    }
    /* 建造模式：点空地/上车仍无效，但已经派出去的农活要做完
       （Chris 2026-08-24：「建造时如果在做农活，农活不要停」）。
       闲逛和玩家点的 goto 照旧站住。未付工钱的帮手 freeze idle-walk。 */
    if (iso._build && !doingFarmWork(actor, opts)) {
      if (actor.job && actor.job.kind === 'idlewalk') { actor.job = null; actor.path = null; }
      actor.anim = actor.anim === 'walk' ? 'idle' : (actor.anim || 'idle');
      actor.frameT += dt;
      return;
    }
    if (actor === A && Farm.state && Farm.state._visitLock) {
      actor.anim = 'idle';
      actor.frameT += dt;
      if (actor.pause > 0) actor.pause -= dt;
      else {
        const t = pickIdleTarget(iso, actor);
        if (t) { actor.job = { kind: 'idlewalk', gx: t.gx, gy: t.gy }; actor.anim = 'walk'; }
        actor.pause = IDLE_PAUSE[0] + Math.random() * (IDLE_PAUSE[1] - IDLE_PAUSE[0]);
      }
      if (actor.job && actor.job.kind === 'idlewalk') {
        actor.anim = 'walk';
        if (moveToward(actor, dt, actor.job.gx, actor.job.gy)) { actor.job = null; actor.anim = 'idle'; }
      }
      tickWalkDust(actor, dt);
      return;
    }

    actor.frameT += dt;
    if (actor.boardHop > 0) actor.boardHop = Math.max(0, actor.boardHop - dt);
    if (actor.alightHop > 0) actor.alightHop = Math.max(0, actor.alightHop - dt);
    if (actor.anim !== 'walk' || actor.driving != null) {
      actor.walkAccel = Math.max(0, (actor.walkAccel || 0) - dt / 0.16);
    }
    if (opts.canDrive && actor.driving != null) tickDrive(dt);
    else tickWalkDust(actor, dt);

    // 车停着等指令，不自己乱逛 —— 闲逛逻辑是给人写的，驾驶中它会把整辆车挪走。
    if (opts.canDrive && actor.driving != null && !actor.job) { actor.anim = 'idle'; return; }

    if (actor.job && actor.job.kind === 'idlewalk' && pendingList().length && actorCanWork(actor, opts)) {
      actor.job = null; actor.path = null;   // 手上有农活就别闲逛
    }
    claim(iso, actor, opts);

    if (opts.canDrive && actor.job && actor.job.kind === 'boarding') {
      actor.anim = 'walk';
      const path = actor.path;
      if (!path || actor.pathI >= path.length) { mountNow(actor.job.car); return; }
      const step = path[actor.pathI];
      if (moveToward(actor, dt, step.gx, step.gy, WALK_SPEED)) actor.pathI++;
      return;
    }

    if (opts.canPolish && actor.job && actor.job.kind === 'polish') {
      const o = ((Farm.state.data && Farm.state.data.map) || [])[actor.job.car];
      if (!o || o.type !== 'car') { actor.job = null; actor.path = null; actor.anim = 'idle'; return; }
      if (actor.anim === 'harvest') {
        if (actor.frameT >= WORK_HOLD) {
          finishPolish(o);
          actor.job = null; actor.path = null; actor.anim = 'idle';
        }
        return;
      }
      const path = actor.path;
      if (!path || actor.pathI >= path.length) {
        actor.path = null;
        actor.anim = 'harvest';
        actor.frameT = 0;
        actor.away = false;
        const h = heading(o.gx - actor.gx, o.gy - actor.gy);
        actor.face = h.face;
        return;
      }
      actor.anim = 'walk';
      const step = path[actor.pathI];
      if (moveToward(actor, dt, step.gx, step.gy, WALK_SPEED)) actor.pathI++;
      return;
    }

    if (actor.job && actor.job.kind === 'goto') {
      if (!opts.canDrive && actor.driving != null) { actor.job = null; actor.path = null; actor.anim = 'idle'; return; }
      actor.anim = 'walk';
      const path = actor.path;
      if (!path || actor.pathI >= path.length) {
        actor.job = null; actor.path = null; actor.anim = 'idle';
        actor.pause = IDLE_PAUSE[0] + Math.random() * (IDLE_PAUSE[1] - IDLE_PAUSE[0]);
        if (opts.canDrive && actor.driving != null) arriveGoto();
        return;
      }
      const step = path[actor.pathI];
      if (moveToward(actor, dt, step.gx, step.gy, (opts.canDrive && actor.driving != null) ? moveSpeed() : WALK_SPEED)) actor.pathI++;
      return;
    }

    if (actor.job && (actor.job.kind === 'harvest' || actor.job.kind === 'water' || actor.job.kind === 'plant')) {
      const p = plotPos(iso, actor.job.plotIdx, actor.job.kind);
      if (actor.anim === 'walk') {
        // 先沿寻路的整格路线走，最后一小段再对齐到地头的精确落点。
        // 原来这里是直线插值：地块近时看不出来，开车把距离拉长后会明显穿墙穿水塘。
        let arrived = false;
        if (actor.path && actor.pathI < actor.path.length) {
          const st = actor.path[actor.pathI];
          if (moveToward(actor, dt, st.gx, st.gy)) actor.pathI++;
        } else {
          arrived = moveToward(actor, dt, p.gx, p.gy);
        }
        if (arrived) {
          actor.path = null;
          const pgx = iso._plotGX(actor.job.plotIdx);
          const pgy = iso._plotGY ? iso._plotGY(actor.job.plotIdx) : p.gy;
          const fh = heading(pgx - actor.gx, pgy - actor.gy);
          actor.face = fh.face;
          actor.away = false;
          actor.anim = actor.job.kind;
          actor.frameT = 0;
        }
      } else if (actor.anim === 'harvest' || actor.anim === 'water' || actor.anim === 'plant') {
        if (actor.frameT >= WORK_HOLD) finishJob(iso, actor);
      }
      return;
    }

    if (actor.job && actor.job.kind === 'idlewalk') {
      actor.anim = 'walk';
      if (moveToward(actor, dt, actor.job.gx, actor.job.gy)) {
        actor.job = null;
        actor.anim = 'idle';
        actor.pause = IDLE_PAUSE[0] + Math.random() * (IDLE_PAUSE[1] - IDLE_PAUSE[0]);
      }
      return;
    }

    if (iso._build) { actor.anim = 'idle'; return; }   // 建造里农活做完就站住，不闲逛
    if (!opts.canIdleWander) { actor.anim = 'idle'; return; }
    if (actor.pause > 0) {
      actor.anim = 'idle';
      actor.pause -= dt;
      return;
    }
    const t = pickIdleTarget(iso, actor);
    if (t) actor.job = { kind: 'idlewalk', gx: t.gx, gy: t.gy };
    else actor.pause = 2;
  }

  function frameIndex(actor) {
    actor = actor || A;
    const n = SHEET_COLS;
    if (actor.anim === 'harvest' || actor.anim === 'water' || actor.anim === 'plant') {
      const t = Math.min(0.999, actor.frameT / WORK_HOLD);
      return 1 + Math.min(3, Math.floor(t * 4));
    }
    return Math.floor(actor.frameT * FPS) % n;
  }

  function blitSheet(ctx, iso, look, anim, fi, x, y, face, away, actor) {
    actor = actor || A;
    const wantBack = !!away && (anim === 'walk' || anim === 'idle');
    const back = wantBack ? backSheet(look) : null;
    const im = (back && back.width) ? back : sheet(look);
    const th = iso._th();
    const spec = specOf(look);
    const h = th * (spec.child ? 1.45 : 2.05);
    if (im && im.width) {
      const usingBack = !!(back && back.width && im === back);
      const cw = im.width / SHEET_COLS;
      // 格子是 128×160，不是正方形。用高宽比判背面是 1 行旧表还是 idle+walk 两行。
      const backRows = usingBack ? (im.height / cw > 1.6 ? 2 : 1) : SHEET_ROWS;
      const ch = im.height / backRows;
      const row = usingBack ? (anim === 'walk' && backRows > 1 ? 1 : 0) : (ANIMS[anim] || 0);
      const w = h * (cw / ch);
      ctx.save();
      // 步伐：两步一循环，落地质心下沉、步间抬起，左右换重心。
      // 不许 rotate —— 等距贴图一转就侧着迈。
      const walking = anim === 'walk';
      const phase = actor.frameT * Math.PI * (FPS / 3);
      const plant = walking ? Math.pow(Math.abs(Math.sin(phase)), 1.35) : 0;
      const bob = walking
        ? (1 - plant) * th * 0.040
        : (anim === 'idle' ? Math.sin(actor.frameT * 2.15) * th * 0.010 : 0);
      const sway = walking ? Math.sin(phase) * w * 0.030 : 0;
      const squash = walking ? 1 - plant * 0.048 : 1;
      let dip = 0;
      if (anim === 'harvest' || anim === 'plant') {
        const t = Math.min(1, actor.frameT / WORK_HOLD);
        const squat = t < 0.22 ? t / 0.22 : (t > 0.82 ? 1 - (t - 0.82) / 0.18 * 0.45 : 1);
        dip = th * (anim === 'plant' ? 0.05 : 0.08) * squat;
      }
      if (iso._shadow) {
        iso._shadow(
          x + (face === 'l' ? -1 : 1) * w * 0.08,
          y + th * 0.04,
          w * (0.52 + plant * 0.10),
          0.16 + plant * 0.05
        );
      }
      ctx.translate(x, y - bob + dip);
      if (face === 'l') ctx.scale(-1, 1);
      ctx.translate(sway, 0);
      if (squash !== 1) ctx.scale(1, squash);
      ctx.drawImage(im, fi * cw, row * ch, cw, ch, -w / 2, -h, w, h);
      ctx.restore();
      return true;
    }
    return false;
  }

  function hopLift(actor, th) {
    actor = actor || A;
    if (arguments.length === 1) { th = actor; actor = A; }
    if (actor.boardHop > 0) return Math.sin((1 - actor.boardHop / 0.32) * Math.PI) * th * 0.72;
    if (actor.alightHop > 0) return Math.sin((1 - actor.alightHop / 0.28) * Math.PI) * th * 0.55;
    return 0;
  }

  function drawActor(iso, look, anim, fi, gx, gy, face, away, actor) {
    actor = actor || A;
    const c = iso._cell(gx, gy);
    const th = iso._th();
    const yOff = (anim === 'harvest' || anim === 'plant') ? 0.10 : 0.18;
    const x = c.x, y = c.y + th * yOff - hopLift(actor, th);
    if (actor.walkDust && actor.walkDust.length && iso._drawCarDust) {
      iso._drawCarDust(actor.walkDust, iso._tw(), th);
    }
    if (blitSheet(iso._ctx, iso, look, anim, fi, x, y, face, away, actor)) return;
    const spec = specOf(look);
    if (iso._drawVillager) {
      iso._drawVillager(x, y, th, {
        scale: spec.child ? 0.78 : 1.05,
        shirt: spec.shirt,
        pants: spec.pants,
      });
    }
  }

  function depthDrawActor(iso, actor) {
    if (!actor || actor.gx == null) return null;
    if (actor.driving != null && !(actor.boardHop > 0)) return null;
    const fi = frameIndex(actor);
    const gx = actor.gx, gy = actor.gy, look = actor.look, anim = actor.anim, face = actor.face, away = !!actor.away;
    const hopD = (actor.boardHop > 0 || actor.alightHop > 0) ? 0.9 : 0;
    return {
      d: gx + gy + hopD + ((anim === 'harvest' || anim === 'plant' || anim === 'water') ? 0.62 : 0.35),
      fn: () => drawActor(iso, look, anim, fi, gx, gy, face, away, actor),
    };
  }

  function depthDraw(iso) {
    return depthDrawActor(iso, A);
  }

  function drawGuest(iso, customer, x, y) {
    if (!customer) return false;
    const look = lookOf({ farmerLook: customer.look, uid: customer.uid });
    const th = iso._th();
    const fi = Math.floor(Date.now() / 1000 * FPS) % SHEET_COLS;
    // 人站在摊南侧路上，面向北面的菜摊 = 背对镜头。
    if (blitSheet(iso._ctx, iso, look, 'idle', fi, x, y, 'r', true)) return true;
    const spec = specOf(look);
    iso._drawVillager(x, y, th, { scale: spec.child ? 0.78 : 1.05, shirt: spec.shirt, pants: spec.pants });
    return true;
  }

  function onEnterVisit(info) {
    A.visitHold = {
      look: A.look, gx: A.gx, gy: A.gy, face: A.face, away: !!A.away,
      queue: A.queue.slice(), job: A.job, pause: A.pause, anim: A.anim,
    };
    A.queue = [];
    A.job = null;
    A.gx = null;
    A.gy = null;
    A.look = lookOf({
      farmerLook: info && (info.farmerLook != null ? info.farmerLook : (info._neighbor && info._neighbor._doc && info._neighbor._doc.gameStats && info._neighbor._doc.gameStats.farmerLook)),
      uid: info && info.uid,
    });
    A.anim = 'idle';
    A.pause = 1;
  }

  function onExitVisit() {
    const h = A.visitHold;
    A.visitHold = null;
    if (!h) { A = emptyActor(currentLook()); return; }
    A.look = h.look;
    A.gx = h.gx; A.gy = h.gy; A.face = h.face; A.away = !!h.away;
    A.queue = h.queue || [];
    A.job = h.job;
    A.pause = h.pause || 1;
    A.anim = h.anim || 'idle';
  }

  Farm.farmer = {
    LOOKS: LOOKS,
    lookFromUid: lookFromUid,
    clampLook: clampLook,
    lookOf: lookOf,
    specOf: specOf,
    applyLook: applyLook,
    enqueue: enqueue,
    goTo: goTo,
    travelTo: travelTo,
    walkableFor: walkableFor,
    board: board,
    unboard: unboard,
    polish: polish,
    drivingIdx: drivingIdx,
    carPos: carPos,
    heading: heading,
    driveFx: driveFx,
    _speedNow: catalogSpeed,
    _driveDebug: driveDebug,
    _approachPos: approachPos,   // 测试要量「干活落脚点」的真实距离，不能照地块坐标心算
    enqueueHarvestAll: enqueueHarvestAll,
    enqueueWaterAll: enqueueWaterAll,
    enqueuePlantAll: enqueuePlantAll,
    emptyActor: emptyActor,
    tickActor: tickActor,
    startJob: startJob,
    spawnAt: spawnAt,
    doingFarmWork: doingFarmWork,
    depthDrawActor: depthDrawActor,
    tick: tick,
    depthDraw: depthDraw,
    drawGuest: drawGuest,
    onEnterVisit: onEnterVisit,
    onExitVisit: onExitVisit,
    sheet: sheet,
    backSheet: backSheet,
    SHEET_COLS: SHEET_COLS,
    SHEET_ROWS: SHEET_ROWS,
    previewStyle: previewStyle,
    _actor: function () { return A; },
  };
})();
