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
  const SHEET_COLS = 6, SHEET_ROWS = 4;
  const ANIMS = { idle: 0, walk: 1, water: 2, harvest: 3 };
  const FPS = 8;
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

  const _img = {};
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

  function emptyActor(look) {
    return {
      look: clampLook(look), gx: null, gy: null, face: 'r',
      anim: 'idle', frameT: 0, pause: 0,
      queue: [], job: null, visitHold: null,
    };
  }

  let A = emptyActor(2);
  let _lastT = 0;

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

  function enqueue(plotIdx, kind) {
    if (!kind || (kind !== 'harvest' && kind !== 'water')) return false;
    if (Farm.state && Farm.state._visitLock) return false;
    const iso = Farm.isoView;
    if (!iso || plotIdx == null) return false;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const plot = plots[plotIdx];
    if (!plot || !plot.unlocked || !plot.crop) return false;
    if (kind === 'harvest' && !(Farm.crops && Farm.crops.isMature && Farm.crops.isMature(plot))) return false;
    if (kind === 'water' && Farm.tending && Farm.tending.canWater && !Farm.tending.canWater(plot)) return false;
    const cap = plots.filter((p) => p && p.unlocked).length || 12;
    if (A.queue.length >= cap) return false;
    if (A.job && A.job.plotIdx === plotIdx && A.job.kind === kind) return false;
    for (let i = 0; i < A.queue.length; i++) {
      if (A.queue[i].plotIdx === plotIdx && A.queue[i].kind === kind) return false;
    }
    A.queue.push({ plotIdx: plotIdx, kind: kind });
    A.pause = 0;
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

  function cellWalkable(iso, gx, gy) {
    const x = Math.round(gx), y = Math.round(gy);
    if (!iso._inBounds(x, y) || !iso._ownedCell(x, y)) return false;
    if (iso._plotCellSet()[x + ',' + y]) return false;
    if (iso._buildingAt(x, y) >= 0) return false;
    const t = iso._terrain()[x + ',' + y];
    if (t === 'water') return false;
    return true;
  }

  function spawnAt(iso) {
    const map = (Farm.state.data && Farm.state.data.map) || [];
    const home = map.find((m) => m && m.type === 'home');
    const tryPut = (gx, gy) => {
      if (cellWalkable(iso, gx, gy)) { A.gx = gx; A.gy = gy; return true; }
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
    A.gx = cx; A.gy = cy;
  }

  function pickIdleTarget(iso) {
    const ob = iso._ownedBounds();
    const near = [];
    const x0 = Math.round(A.gx), y0 = Math.round(A.gy);
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

  function plotPos(iso, plotIdx) {
    const gx = iso._plotGX(plotIdx), gy = iso._plotGY(plotIdx);
    const dirs = [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1]];
    for (let i = 0; i < dirs.length; i++) {
      const x = gx + dirs[i][0], y = gy + dirs[i][1];
      if (cellWalkable(iso, x, y)) return { gx: x, gy: y + 0.12 };
    }
    return { gx: gx + 0.2, gy: gy + 0.9 };
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

  function finishJob(iso) {
    const job = A.job;
    A.job = null;
    A.anim = 'idle';
    A.frameT = 0;
    if (!job) return;
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const plot = plots[job.plotIdx];
    if (job.kind === 'harvest') {
      if (Farm.farm && Farm.farm.harvestPlot) {
        const ev = iso._fakeEvt ? iso._fakeEvt(iso._plotGX(job.plotIdx), iso._plotGY(job.plotIdx)) : null;
        Farm.farm.harvestPlot(job.plotIdx, ev);
      }
      if (Farm.state && Farm.state.isWarehouseFull && Farm.state.isWarehouseFull()) {
        A.queue = A.queue.filter((j) => j.kind !== 'harvest');
      }
    } else if (job.kind === 'water') {
      if (Farm.tending && Farm.tending.waterPlot) Farm.tending.waterPlot(job.plotIdx);
    }
  }

  function startJob(iso, job) {
    const plots = (Farm.state.data && Farm.state.data.plots) || [];
    const plot = plots[job.plotIdx];
    if (!plot || !plot.crop) return false;
    if (job.kind === 'harvest' && !(Farm.crops && Farm.crops.isMature && Farm.crops.isMature(plot))) return false;
    if (job.kind === 'water' && Farm.tending && Farm.tending.canWater && !Farm.tending.canWater(plot)) return false;
    A.job = job;
    A.anim = 'walk';
    A.frameT = 0;
    return true;
  }

  function moveToward(dt, tx, ty) {
    const dx = tx - A.gx, dy = ty - A.gy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.08) { A.gx = tx; A.gy = ty; return true; }
    const step = WALK_SPEED * dt;
    if (step >= dist) { A.gx = tx; A.gy = ty; return true; }
    A.gx += dx / dist * step;
    A.gy += dy / dist * step;
    if (Math.abs(dx) >= Math.abs(dy)) A.face = dx >= 0 ? 'r' : 'l';
    else A.face = dy >= 0 ? 'r' : 'l';
    return false;
  }

  function tick(iso) {
    if (!iso || !iso._on) return;
    const now = Date.now();
    const dt = _lastT ? Math.min(0.12, (now - _lastT) / 1000) : 0.033;
    _lastT = now;
    if (!(Farm.state && Farm.state._visitLock)) A.look = currentLook();
    sheet(A.look);
    if (A.gx == null) spawnAt(iso);

    if (iso._build || (Farm.state && Farm.state._visitLock && !A.visitHold)) {
      A.anim = A.anim === 'walk' ? 'idle' : (A.anim || 'idle');
      A.frameT += dt;
      return;
    }
    if (Farm.state && Farm.state._visitLock) {
      A.anim = 'idle';
      A.frameT += dt;
      if (A.pause > 0) A.pause -= dt;
      else {
        const t = pickIdleTarget(iso);
        if (t) { A.job = { kind: 'idlewalk', gx: t.gx, gy: t.gy }; A.anim = 'walk'; }
        A.pause = IDLE_PAUSE[0] + Math.random() * (IDLE_PAUSE[1] - IDLE_PAUSE[0]);
      }
      if (A.job && A.job.kind === 'idlewalk') {
        if (moveToward(dt, A.job.gx, A.job.gy)) { A.job = null; A.anim = 'idle'; }
      }
      return;
    }

    A.frameT += dt;

    if (!A.job && A.queue.length) {
      while (A.queue.length && !startJob(iso, A.queue.shift())) { /* skip stale */ }
    }

    if (A.job && (A.job.kind === 'harvest' || A.job.kind === 'water')) {
      const p = plotPos(iso, A.job.plotIdx);
      if (A.anim === 'walk') {
        if (moveToward(dt, p.gx, p.gy)) {
          const pgx = iso._plotGX(A.job.plotIdx);
          A.face = pgx >= A.gx ? 'r' : 'l';
          A.anim = A.job.kind;
          A.frameT = 0;
        }
      } else if (A.anim === 'harvest' || A.anim === 'water') {
        if (A.frameT >= SHEET_COLS / FPS) finishJob(iso);
      }
      return;
    }

    if (A.job && A.job.kind === 'idlewalk') {
      A.anim = 'walk';
      if (moveToward(dt, A.job.gx, A.job.gy)) {
        A.job = null;
        A.anim = 'idle';
        A.pause = IDLE_PAUSE[0] + Math.random() * (IDLE_PAUSE[1] - IDLE_PAUSE[0]);
      }
      return;
    }

    if (A.pause > 0) {
      A.anim = 'idle';
      A.pause -= dt;
      return;
    }
    const t = pickIdleTarget(iso);
    if (t) A.job = { kind: 'idlewalk', gx: t.gx, gy: t.gy };
    else A.pause = 2;
  }

  function frameIndex() {
    const n = SHEET_COLS;
    if (A.anim === 'harvest' || A.anim === 'water') {
      return Math.min(n - 1, Math.floor(A.frameT * FPS));
    }
    return Math.floor(A.frameT * FPS) % n;
  }

  function blitSheet(ctx, iso, look, anim, fi, x, y, face) {
    const im = sheet(look);
    const th = iso._th();
    const spec = specOf(look);
    const h = th * (spec.child ? 1.45 : 2.05);
    if (im && im.width) {
      const cw = im.width / SHEET_COLS, ch = im.height / SHEET_ROWS;
      const row = ANIMS[anim] || 0;
      const w = h * (cw / ch);
      ctx.save();
      const bob = (anim === 'walk') ? Math.abs(Math.sin(A.frameT * 16)) * th * 0.06 : 0;
      if (iso._shadow) iso._shadow(x + (face === 'l' ? -1 : 1) * w * 0.08, y + th * 0.04, w * 0.55, 0.16);
      ctx.translate(x, y - bob);
      if (face === 'l') ctx.scale(-1, 1);
      ctx.drawImage(im, fi * cw, row * ch, cw, ch, -w / 2, -h, w, h);
      ctx.restore();
      return true;
    }
    return false;
  }

  function drawActor(iso, look, anim, fi, gx, gy, face) {
    const c = iso._cell(gx, gy);
    const th = iso._th();
    const x = c.x, y = c.y + th * 0.18;
    if (blitSheet(iso._ctx, iso, look, anim, fi, x, y, face)) return;
    const spec = specOf(look);
    if (iso._drawVillager) {
      iso._drawVillager(x, y, th, {
        scale: spec.child ? 0.78 : 1.05,
        shirt: spec.shirt,
        pants: spec.pants,
      });
    }
  }

  function depthDraw(iso) {
    if (A.gx == null) return null;
    const fi = frameIndex();
    const gx = A.gx, gy = A.gy, look = A.look, anim = A.anim, face = A.face;
    return {
      d: gx + gy + 0.35,
      fn: () => drawActor(iso, look, anim, fi, gx, gy, face),
    };
  }

  function drawGuest(iso, customer, x, y) {
    if (!customer) return false;
    const look = lookOf({ farmerLook: customer.look, uid: customer.uid });
    const th = iso._th();
    const fi = Math.floor(Date.now() / 1000 * FPS) % SHEET_COLS;
    if (blitSheet(iso._ctx, iso, look, 'idle', fi, x, y, 'r')) return true;
    const spec = specOf(look);
    iso._drawVillager(x, y, th, { scale: spec.child ? 0.78 : 1.05, shirt: spec.shirt, pants: spec.pants });
    return true;
  }

  function onEnterVisit(info) {
    A.visitHold = {
      look: A.look, gx: A.gx, gy: A.gy, face: A.face,
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
    A.gx = h.gx; A.gy = h.gy; A.face = h.face;
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
    enqueueHarvestAll: enqueueHarvestAll,
    enqueueWaterAll: enqueueWaterAll,
    tick: tick,
    depthDraw: depthDraw,
    drawGuest: drawGuest,
    onEnterVisit: onEnterVisit,
    onExitVisit: onExitVisit,
    sheet: sheet,
    _actor: function () { return A; },
  };
})();
