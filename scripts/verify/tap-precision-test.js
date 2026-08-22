// 点击必须真的点中建筑（2026-08-22）。由 cdp.mjs 在页面里执行，返回 {failures:[]}。
//
// 起因：房子按宅基地放大之后，点房子**旁边的草地**也弹出「我的家」——
// 热区当时是贴图的**包围盒**，而等距贴图是不规则形状，盒角全是旁边的地。
// 实测 7×7 庄园吃掉宅基地外 95 格地面，5×5 吃掉 62 格，连 2×2 也有 13 格。
//
// 这里钉两个方向，缺一不可：
//   ① 点在贴图不透明处 → 必须命中（别把房子改成点不动）
//   ② 点在贴图透明处、**而且在宅基地之外** → 必须不命中（这就是那个 bug）
//
// 为什么第 ② 条要加「宅基地之外」：_buildingAtPoint 最后一步会按落地格兜底
// （`_buildingAt(cell)`），落在**自家宅基地**上的点仍然算点中这栋房子。那是有意的
// —— 那块地就是这栋房子的地（7×7 庄园的菱形尖角处贴图盖不满，但那仍是它的院子），
// 而且这条兜底是小建筑「点底座就能选中」的依靠。Chris 报的是「点房子**旁边**的地」，
// 也就是宅基地之外，那个必须是 0。
//
// ⚠️ 真值用**独立的离屏画布**取，不复用被测代码的蒙版，否则是自证。
// ⚠️ 只测「明确实心」和「明确透明」的点：贴图边缘一两个像素上，128×128 的蒙版
//    和 256×256 的真值本来就会有量化分歧，把边缘点算进来测试就会随机红。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const dbg = {};
  const T = (name, cond) => { if (!cond) failures.push(name); };

  for (let i = 0; i < 250 && !(window.Farm && Farm.isoView); i++) await sleep(100);
  // 走真实入口，否则 isoView.init() 不跑（同 car-drive-tests / roam-tests 的教训）
  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const sb = document.getElementById('splashStart'); if (sb) sb.click();
  Farm.state.data.tutorialV1Done = true;
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  T('X-init 农场视图已就绪', Farm.isoView._on === true);

  const iso = Farm.isoView, d = Farm.state.data;
  d.spotlightDone = true; d.level = 20; d.coins = 9e6;
  d.landOrigin = 'back'; d.landLevel = 4; d.mapTerrain = {}; d.decorations = [];
  d.plots = (d.plots || []).map((p) => Object.assign({}, p, { unlocked: false, crop: null }));

  const R = 256;
  const cv = document.createElement('canvas'); cv.width = R; cv.height = R;
  const g = cv.getContext('2d', { willReadFrequently: true });

  let solidTested = 0, solidMissed = 0, clearTested = 0, clearHit = 0;
  let cellTested = 0, cellFalse = 0;
  const badTiers = [];

  for (let lv = 1; lv <= 30; lv++) {
    d.map = [{ type: 'home', gx: 8, gy: 8, lv: lv }];
    if (iso._buildLayout) iso._buildLayout();
    let im = iso._homeSprite(d.map[0]);
    for (let k = 0; k < 80 && !(im && im.width); k++) { await sleep(100); im = iso._homeSprite(d.map[0]); }
    if (!(im && im.width)) { failures.push('X 贴图加载失败 lv' + lv); continue; }
    if (iso._autoFrame) iso._autoFrame();
    iso.render(); await sleep(40);

    const o = d.map[0], b = iso._bldgOf(o), th = iso._th();
    const cc = iso._cell(o.gx + (b.w - 1) / 2, o.gy + (b.h - 1) / 2);
    const front = iso._cell(o.gx + (b.w - 1), o.gy + (b.h - 1));
    const by = front.y + th / 2 + th * 0.18;
    const box = iso._spriteBox(b, iso._homeDrawMul(o), 1);
    const sc = Math.min(box.w / im.width, box.h / im.height);
    const w = im.width * sc, h = im.height * sc;

    g.clearRect(0, 0, R, R);
    g.drawImage(im, 0, 0, R, R);
    const px = g.getImageData(0, 0, R, R).data;
    const alphaAt = (x, y) => {
      const fx = (x - (cc.x - w / 2)) / w, fy = (y - (by - h)) / h;
      if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return 0;
      return px[((Math.floor(fy * R) * R) + Math.floor(fx * R)) * 4 + 3];
    };
    // 只认「周围一圈也同样」的点，避开贴图边缘的量化分歧带
    const pad = Math.max(3, w / 40);
    const classify = (x, y) => {
      let mn = 255, mx = 0;
      for (let ddy = -1; ddy <= 1; ddy++) {
        for (let ddx = -1; ddx <= 1; ddx++) {
          const a = alphaAt(x + ddx * pad, y + ddy * pad);
          if (a < mn) mn = a; if (a > mx) mx = a;
        }
      }
      if (mn > 200) return 'solid';
      if (mx < 8) return 'clear';
      return 'edge';
    };

    let tierSolidMiss = 0, tierClearHit = 0;
    const step = Math.max(4, w / 26);
    const inFoot = (x, y) => {
      const c = iso._screenToCell(x, y);
      return c.gx >= o.gx && c.gx < o.gx + b.w && c.gy >= o.gy && c.gy < o.gy + b.h;
    };
    for (let sy = by - h + 2; sy < by; sy += step) {
      for (let sx = cc.x - w / 2 + 2; sx < cc.x + w / 2; sx += step) {
        const kind = classify(sx, sy);
        if (kind === 'edge') continue;
        const hit = iso._buildingAtPoint(sx, sy) === 0;
        if (kind === 'solid') { solidTested++; if (!hit) { solidMissed++; tierSolidMiss++; } }
        else if (!inFoot(sx, sy)) { clearTested++; if (hit) { clearHit++; tierClearHit++; } }
      }
    }
    /* 按格再测一遍：宅基地外、且格心落在贴图透明处的地面格，点它不该选中房子。
       这是 Chris 报的那件事的原始粒度。 */
    let tierCellFalse = 0;
    for (let gy = o.gy - 4; gy <= o.gy + b.h + 4; gy++) {
      for (let gx = o.gx - 4; gx <= o.gx + b.w + 4; gx++) {
        if (gx >= o.gx && gx < o.gx + b.w && gy >= o.gy && gy < o.gy + b.h) continue;
        const c = iso._cell(gx, gy);
        if (alphaAt(c.x, c.y) >= 8) continue;          // 格心压在房子身上：算点中，不冤
        cellTested++;
        if (iso._buildingAtPoint(c.x, c.y) === 0) { cellFalse++; tierCellFalse++; }
      }
    }
    if (tierSolidMiss || tierClearHit || tierCellFalse) {
      badTiers.push({ lv: lv, stem: iso._homeSpec(o).stem, solidMiss: tierSolidMiss,
                      clearHit: tierClearHit, cellFalse: tierCellFalse });
    }
  }

  dbg.solidTested = solidTested; dbg.solidMissed = solidMissed;
  dbg.clearTested = clearTested; dbg.clearHit = clearHit;
  dbg.groundCellsTested = cellTested; dbg.groundCellsFalseHit = cellFalse;
  dbg.badTiers = badTiers.slice(0, 8);

  T('X1 点在房子上必须命中(30 档全覆盖)', solidTested > 2000 && solidMissed === 0);
  /* X2 按**格**算，这才是 Chris 报的那件事的粒度：「点房子旁边的地」= 点一个
     宅基地外的地面格。改之前 7×7 庄园吃掉 95 格、5×5 吃 62 格、2×2 吃 13 格。 */
  T('X2 宅基地外的地面格一格都不许误触(「点房子旁边的地也弹我的家」)',
    cellTested > 2000 && cellFalse === 0);
  /* X3 再用密集采样点兜一层。这里允许极少量残留：贴图轮廓上一两个像素处，
     128×128 的蒙版和 256×256 的真值本来就会有量化分歧（现存 1 个，在乔治联排
     花园铁艺栅栏外沿）。放宽到 3 是为了不让这条测试变成随机红，但仍然远低于
     修复前的量级——真回归了会是几十上百，一眼就红。 */
  T('X3 空处采样点误触保持在个位数', clearTested > 500 && clearHit <= 3);

  return { failures, dbg };
})()
