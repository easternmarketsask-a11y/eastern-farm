/**
 * mapview-iso.js — isometric (2.5D, Hay Day-style) farm view (Farm.isoView)
 *
 * PREVIEW behind ?iso=1. Renders the EXISTING state (plots/buildings) on an
 * isometric diamond grid and runs the EXISTING plant/harvest/care flow on tap.
 * Does NOT touch the live top-down default (mapView). Once approved, the build/
 * terrain/decoration editor gets ported and this becomes the default.
 *
 * Ground = flat grass diamonds (guaranteed tessellation). Crops/buildings are
 * upright sprites placed on cells, depth-sorted back-to-front (gx+gy).
 */
(function () {
  const COLS = 16, ROWS = 16;      // big world — room to expand the farm across the hills
  // Start zone origin. (The 2026-06-18 "forward move" to (6,6) was cancelled — Chris
  // preferred adapting via the new full-scene background instead. _undoForwardOnce()
  // shifts any save that got forwarded back to here.)
  const PLOT_OX = 1, PLOT_OY = 2, PLOT_COLS = 3;
  const TW = 46, TH = 23;          // diamond width/height at zoom 1 (2:1 iso) — halved 2026-06-18 (Chris: shrink whole farm 50% so it's a small cluster in the meadow centre; bg is canvas-based so the farm gets relatively smaller)
  // ZMIN === BG_ZOOM_REF (0.70): at the most-zoomed-out point the painted backdrop's
  // FULL HEIGHT exactly fills the viewport (Chris 2026-06-18: "高度一旦达到背景图全高则不可
  // 再缩小"). You can't zoom out past that, so no base band ever shows top/bottom. Because
  // the image is WIDER than the screen, at min zoom you can pan left/right within it
  // (_clampCam keeps the bg covering). ZMAX zooms in.
  const ZMIN = 0.70, ZMAX = 2.4;
  const REQUIRED_LV = { 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 4, 10: 5, 11: 5 };
  // Pay-to-expand land. Each level's TOTAL owned rectangle (cells x1,y1..x2,y2) grows
  // outward; cost is to unlock UP TO that level. L0 = starting land (free, ⊇ the old
  // 9×11 so existing farms are never taken away). Farthest level also costs a few 超市积分.
  // Pay-to-expand land, anchored at (0,0) growing outward. L0 = starting owned area.
  const LAND_LEVELS = [
    { x1: 0, y1: 0, x2: 8, y2: 10, coins: 0, points: 0 },        // L0 start (owned)
    { x1: 0, y1: 0, x2: 12, y2: 10, coins: 800, points: 0 },     // L1 → right strip
    { x1: 0, y1: 0, x2: 12, y2: 13, coins: 1500, points: 0 },    // L2 → bottom
    { x1: 0, y1: 0, x2: 15, y2: 15, coins: 3000, points: 30 },   // L3 → far corner (coins + points)
  ];
  const GRASS_A = '#8bbf5a', GRASS_B = '#83b653', GRASS_EDGE = 'rgba(60,90,40,0.18)';
  const SOIL_TOP = '#9c6b3f', SOIL_FURROW = 'rgba(80,50,26,0.5)';
  const ASSET_DIR = 'assets/images/map/';
  const ASSET_SRC = {
    barn: 'p_barn.png', house: 'p_house.png', greenhouse: 'p_greenhouse.png', coop: 'p_coop.png', well: 'p_well.png', stall: 'p_stall.png', tree: 'p_tree.png',
    deco_bush: 'deco_bush.png', deco_lantern: 'deco_lantern.png', deco_fence: 'deco_fence.png', deco_wheel: 'deco_wheel.png', deco_bridge: 'deco_bridge.png',
    crop0: 'crop_qingcai_0.png', crop1: 'crop_qingcai_1.png', crop2: 'crop_qingcai_2.png', crop3: 'crop_qingcai_3.png',
    tile_grass: 'p_grass.png', tile_grass_b: 'p_grass_b.png', tile_grass_c: 'p_grass_c.png',
    tile_soil: 'p_soil.png', tile_path: 'p_path.png', tile_water: 'p_water.png',
    plot_bed: 'plot_bed.png',
    hd_soil: 'hd_soil.png',   // painted tilled-soil bed (grass no longer tiled — the bg image is the ground)
    hd_bg: 'hd_bg.png',   // painted landscape backdrop (hills + forest + grass)
  };
  // Painted iso ground cube tiles. `cy` = fraction of the image height where the
  // diamond-top CENTER sits (so it lands on the cell center; tuned by screenshot).
  const ISO_TILES = {
    grass: { img: 'tile_grass', cy: 0.42 }, soil: { img: 'tile_soil', cy: 0.40 },
    path: { img: 'tile_path', cy: 0.34 }, water: { img: 'tile_water', cy: 0.40 },
  };
  // Grass variety (Hay Day ground feel): mostly plain, with sparse flowers/mossy
  // tiles. Each variant keeps its OWN cy anchor (the taller tufts push the flat
  // top down) so they tessellate flush with the plain tile. Picked deterministically
  // per cell so the pattern is stable across frames and reloads.
  const GRASS_VARIANTS = [
    { img: 'tile_grass', cy: 0.42 },     // plain (most cells)
    { img: 'tile_grass_b', cy: 0.47 },   // little yellow flowers
    { img: 'tile_grass_c', cy: 0.50 },   // mossy + bare dirt patch
  ];
  function grassVariant(gx, gy) {
    const h = ((gx * 73856093) ^ (gy * 19349663)) & 0xffff, r = h % 100;
    return r < 15 ? GRASS_VARIANTS[1] : (r < 25 ? GRASS_VARIANTS[2] : GRASS_VARIANTS[0]);
  }
  // Painted iso 4-stage crop sprites (each frame includes its own soil cube), keyed
  // by crop id. shanghai_miao keeps its pixel sprite (no cube) — handled separately.
  const ISO_CROPS = {
    eggplant: 'crop_eggplant', cilantro: 'crop_cilantro', jiucai: 'crop_chives',
    niu_jiao_jiao: 'crop_chili', suan_tai: 'crop_garlic', tomato: 'crop_tomato', cucumber: 'crop_cucumber',
    // 上海青: the refreshed crop_qingcai sprites now include their OWN soil cube, so
    // it must go through the ISO_CROPS path (ground stays grass) — otherwise the
    // ground also draws a soil tile and the two cubes stack → bok choy floats.
    shanghai_miao: 'crop_qingcai',
  };
  // cost = 农场币 to place (coins; East Points stay scarce for real rewards). charm =
  // 农场魅力 gained (derived ≈ cost/8) — a vanity progression to drive the build impulse.
  const BUILDINGS = {
    barn: { img: 'barn', w: 2, h: 2, sc: 2.4, zh: '谷仓·仓库', en: 'Barn', tap: 'warehouse', cost: 350 },
    house: { img: 'house', w: 2, h: 2, sc: 2.6, zh: '小屋·种子店', en: 'Cottage', tap: 'shop', cost: 400 },
    greenhouse: { img: 'greenhouse', w: 2, h: 2, sc: 2.4, zh: '温室', en: 'Greenhouse', cost: 600 },
    coop: { img: 'coop', w: 2, h: 2, sc: 2.3, zh: '鸡舍', en: 'Coop', cost: 450 },
    stall: { img: 'stall', w: 2, h: 2, sc: 2.8, zh: '超市摊位', en: 'Stall', cost: 320 },
    well: { img: 'well', w: 1, h: 1, sc: 2.4, zh: '水井', en: 'Well', cost: 180 },
    tree: { img: 'tree', w: 1, h: 1, sc: 2.2, zh: '树', en: 'Tree', cost: 90 },
    bush: { img: 'deco_bush', w: 1, h: 1, sc: 1.7, zh: '花丛', en: 'Flowers', cost: 40 },
    lantern: { img: 'deco_lantern', w: 1, h: 1, sc: 2.6, zh: '灯笼', en: 'Lantern', cost: 70 },
    fence: { img: 'deco_fence', w: 1, h: 1, sc: 1.9, zh: '篱笆', en: 'Fence', cost: 40 },
    wheel: { img: 'deco_wheel', w: 2, h: 2, sc: 2.2, zh: '水车', en: 'Water Wheel', cost: 480 },
    bridge: { img: 'deco_bridge', w: 2, h: 1, sc: 1.6, zh: '小桥', en: 'Bridge', cost: 140 },
  };
  const BLD = 0.7;   // global building-sprite scale (Chris 2026-06-18: buildings were too big) — shrinks all building sprites uniformly so the starter farm fits the central meadow
  const charmOf = (b) => Math.max(1, Math.round((b.cost || 0) / 8));
  const COOP_INTERVAL = 5 * 60 * 1000, COOP_REWARD = 30;   // 鸡舍每 5 分钟产一窝蛋，收一次 +30 农场币
  const BED_W = 0.88;   // soil-bed width as a fraction of the cell → <1 leaves a grass gap so plots are distinct/tappable
  // World-locked backdrop placement (mapview-iso _drawBackdrop). The landscape image's
  // focal point (BG_FX, BG_FY in image fractions = the central flat meadow) is pinned to
  // world cell (BG_ANCHOR_GX, BG_ANCHOR_GY) ≈ the farm start-area centre, and it scales
  // with farm zoom (see BG_ZOOM_REF). Tune these to position the farm on the meadow; they
  // keep the bg locked to the farm at every pan/zoom.
  const BG_FX = 0.5, BG_FY = 0.66, BG_ANCHOR_GX = 2, BG_ANCHOR_GY = 3.5;
  const BG_ZOOM_REF = 0.70;   // zoom at which the bg exactly covers the canvas; >this = covers w/ margin, <this (zoomed out) = shrinks w/ farm, base shows around (no float)
  // ===== TUNABLE: farm position + size (independent of the background) — Chris 2026-06-18 =====
  // FARM_SCALE multiplies ONLY the farm (grid/plots/crops/buildings); the background is
  // unaffected, so this resizes the farm relative to the meadow. FARM_DX/FARM_DY shift the
  // whole farm on screen (pixels at default zoom): +DX → right, +DY → down. Tune these to
  // place the farm exactly on the meadow. (1.0 / 0 / 0 = current look.)
  const FARM_SCALE = 1.0;     // 0.6 (small) … 1.0 (current) … 1.5 (big)
  const FARM_DX = 0;          // −150 (left) … 0 … +150 (right), pixels
  const FARM_DY = 0;          // −150 (up)   … 0 … +150 (down), pixels
  const PALETTE = ['barn', 'house', 'greenhouse', 'coop', 'stall', 'well', 'tree', 'bush', 'lantern', 'fence', 'wheel', 'bridge'];
  // EP-shop pets → painted iso animal sprites (replaces the emoji pet).
  const ANIMALS = { pet_chick: 'animal_chicken', pet_cat: 'animal_cat', pet_rabbit: 'animal_rabbit', decoration_dog: 'animal_dog', guard_dog: 'animal_dog' };
  const BRUSHES = [
    { key: 'path', zh: '小路', en: 'Path', color: '#a8743a' },
    { key: 'water', zh: '水塘', en: 'Water', color: '#5aa0c8' },
    { key: 'grass', zh: '草地·擦除', en: 'Grass', color: '#8bbf5a' },
  ];
  const SEASON_PARTICLES = {
    spring: ['🌸', '🌸', '🌷'], summer: ['🦋', '🦋', '🐝'],
    autumn: ['🍂', '🍁', '🍂'], winter: ['❄️', '❄️', '🌨'],
  };
  function monthSeason() {
    const m = new Date().getMonth() + 1;
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    if (m >= 9 && m <= 11) return 'autumn';
    return 'winter';
  }

  const iso = {
    _on: false, _cv: null, _ctx: null, _dpr: 1,
    _camX: 0, _camY: 0, _zoom: 1, _ox: 0, _oy: 0,
    _w: 0, _h: 0, _img: {}, _cropImg: {},
    _pointers: {}, _drag: null, _pinch: null,
    _tick: null, _raf: null, _lastFrame: 0,
    _cellToPlotN: -1,
    _build: false, _editMode: 'build', _brush: 'path', _painting: false,
    _sel: -1, _moving: null,
    _pets: {},          // seed -> {fx,fy,tx,ty,pause,face,hx,hy} live walk state (not persisted)
    _lastWalkT: 0,
    _buildBtn: null, _palette: null, _hint: null, _modeTabs: null, _palBuild: null, _palTerrain: null,

    // DEFAULT farm view (Hay Day isometric). Chosen via Farm.state.farmStyle()
    // (saved preference + URL override); players switch in the guide (ⓘ).
    active() { return (Farm.state && Farm.state.farmStyle) ? Farm.state.farmStyle() === 'iso' : true; },
    _tw() { return TW * this._zoom * FARM_SCALE; },   // farm tile size (FARM_SCALE = farm-only zoom; bg uses base TW*zoom)
    _th() { return TH * this._zoom * FARM_SCALE; },
    _lang() { return (Farm.state && Farm.state.data && Farm.state.data.language === 'en') ? 'en' : 'zh'; },

    init() {
      if (!this.active() || this._on) return;
      this._on = true;
      document.body.classList.add('mapmode');
      const farmEl = document.getElementById('farm');
      if (farmEl) { farmEl.style.padding = '0'; farmEl.style.overflow = 'hidden'; }
      ['farmGrid', 'farmDecorations'].forEach((idd) => { const e = document.getElementById(idd); if (e) e.style.display = 'none'; });
      const sc = document.querySelector('.farm-scene'); if (sc) sc.style.display = 'none';

      if (!Array.isArray(Farm.state.data.map)) {   // tidy starter layout: house + barn flank the plot block on the right
        Farm.state.data.map = [{ type: 'house', gx: 5, gy: 2 }, { type: 'barn', gx: 5, gy: 4 }];
        Farm.state.save();
      }

      const cv = document.createElement('canvas');
      cv.id = 'isoCanvas';
      cv.style.cssText = 'position:fixed;z-index:5;touch-action:none;display:block;background:#86b030;';
      document.body.appendChild(cv);
      this._cv = cv; this._ctx = cv.getContext('2d');

      Object.keys(ASSET_SRC).forEach((k) => { const im = new Image(); im.onload = () => { this._img[k] = im; this._bgKey = null; if (this._on) this.render(); }; im.src = ASSET_DIR + ASSET_SRC[k]; });   // _bgKey=null → re-render cached backdrop once the landscape/tiles finish loading
      this._undoForwardOnce();
      this._buildLayout();
      this._resize();
      window.addEventListener('resize', () => { this._resize(); this._clampCam(); this.render(); });
      cv.addEventListener('pointerdown', (e) => this._down(e));
      cv.addEventListener('pointermove', (e) => this._move(e));
      cv.addEventListener('pointerup', (e) => this._up(e));
      cv.addEventListener('pointercancel', (e) => this._up(e));
      cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });

      this._buildUI();
      this._autoFrame();

      requestAnimationFrame(() => { this._syncSize(); this.render(); });
      this._tick = setInterval(() => { if (document.hidden) return; this._syncSize(); this.render(); }, 1000);
      this._startLoop();
      this.render();
    },

    // One-time UNDO of the cancelled "forward move": any save that got shifted
    // +5,+4 by the (now-removed) forward migration is shifted back -5,-4 so it
    // returns to the original start zone. Runs BEFORE _buildLayout. Bounds-checked
    // (skip if it would go off-world); idempotent via farmFwdUndoneV1. Saves that
    // were never forwarded (no farmFwdV1) are left untouched.
    _undoForwardOnce() {
      const d = Farm.state.data;
      if (!d || d.farmFwdUndoneV1) return;
      if (!d.farmFwdV1) { d.farmFwdUndoneV1 = true; return; }   // never forwarded → nothing to undo
      const dx = -5, dy = -4;   // inverse of the cancelled forward shift (origin 1,2 → 6,6)
      const objs = [];
      (d.plots || []).forEach(p => { if (Number.isInteger(p.gx) && Number.isInteger(p.gy)) objs.push(p); });
      (d.map || []).forEach(o => objs.push(o));
      (d.decorations || []).forEach(o => { if (Number.isInteger(o.gx) && Number.isInteger(o.gy)) objs.push(o); });
      const terr = d.mapTerrain || {};
      const terrKeys = Object.keys(terr);
      let ok = true;
      for (const o of objs) { if (o.gx + dx < 0 || o.gy + dy < 0 || o.gx + dx > COLS - 1 || o.gy + dy > ROWS - 1) { ok = false; break; } }
      if (ok) for (const k of terrKeys) { const a = k.split(','); const gx = +a[0] + dx, gy = +a[1] + dy; if (gx < 0 || gy < 0 || gx > COLS - 1 || gy > ROWS - 1) { ok = false; break; } }
      if (ok) {
        objs.forEach(o => { o.gx += dx; o.gy += dy; });
        if (terrKeys.length) { const nt = {}; terrKeys.forEach(k => { const a = k.split(','); nt[(+a[0] + dx) + ',' + (+a[1] + dy)] = terr[k]; }); d.mapTerrain = nt; }
      }
      d.farmFwdUndoneV1 = true;
      if (Farm.state.save) Farm.state.save();
    },

    _buildLayout() {
      this._cellToPlot = {};
      const plots = Farm.state.data.plots || [];
      let migrated = false;
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        // plots now carry their own cell coords (so new plots can sit anywhere on owned
        // land); migrate legacy index-derived plots once.
        if (!Number.isInteger(p.gx) || !Number.isInteger(p.gy)) { p.gx = PLOT_OX + (i % PLOT_COLS); p.gy = PLOT_OY + Math.floor(i / PLOT_COLS); migrated = true; }
        this._cellToPlot[p.gx + ',' + p.gy] = i;
      }
      if (migrated && Farm.state.save) Farm.state.save();
    },
    _plotGX(i) { const p = (Farm.state.data.plots || [])[i]; return p ? (Number.isInteger(p.gx) ? p.gx : PLOT_OX + (i % PLOT_COLS)) : 0; },
    _plotGY(i) { const p = (Farm.state.data.plots || [])[i]; return p ? (Number.isInteger(p.gy) ? p.gy : PLOT_OY + Math.floor(i / PLOT_COLS)) : 0; },

    _farmRect() {
      const f = document.getElementById('farm');
      if (f) { const r = f.getBoundingClientRect(); if (r.width > 10 && r.height > 10) return r; }
      const t = document.getElementById('topbar'), b = document.getElementById('bottombar');
      const th = t ? t.getBoundingClientRect().height : 56, bh = b ? b.getBoundingClientRect().height : 64;
      return { left: 0, top: th, width: window.innerWidth, height: Math.max(120, window.innerHeight - th - bh) };
    },
    _cssW() { return this._w; }, _cssH() { return this._h; },
    _resize() {
      const r = this._farmRect();
      this._w = r.width; this._h = r.height;
      this._ox = r.width / 2; this._oy = this._th() * 1.5;
      this._cv.style.left = r.left + 'px'; this._cv.style.top = r.top + 'px';
      this._cv.style.width = r.width + 'px'; this._cv.style.height = r.height + 'px';
      this._dpr = Math.min(2, window.devicePixelRatio || 1);
      this._cv.width = r.width * this._dpr; this._cv.height = r.height * this._dpr;
      this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    },
    _syncSize() { const r = this._farmRect(); if (Math.abs(r.width - this._w) > 1 || Math.abs(r.height - this._h) > 1) { this._resize(); this._clampCam(); } },
    // Frame the PLOTS (where ~all taps go), not the whole 9×11 grid. The old code
    // sized zoom off (COLS+ROWS) — but the on-screen iso width of content is only
    // its (Δgx+Δgy) diagonal, far less than COLS+ROWS, so it over-shrank to ZMIN
    // and plots became too small/cramped to tap on phones. Framing the compact plot
    // block with its REAL screen extent more than doubles tile size (50→110px on a
    // phone). Buildings sit just off the initial view; a short pan reveals them.
    _autoFrame() {
      // Frame the WHOLE farm — plots + buildings (with footprint) + decorations — so
      // nothing is cut off at the screen edges (Chris 2026-06-18: buildings were being
      // clipped because only the plot block was framed).
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      const acc = (gx, gy) => { if (gx < minx) minx = gx; if (gy < miny) miny = gy; if (gx > maxx) maxx = gx; if (gy > maxy) maxy = gy; };
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) acc(this._plotGX(i), this._plotGY(i));
      const map = Farm.state.data.map || [];
      for (const o of map) { const b = BUILDINGS[o.type]; const w = b ? b.w : 1, h = b ? b.h : 1; acc(o.gx, o.gy); acc(o.gx + w - 1, o.gy + h - 1); }
      const decos = Farm.state.data.decorations || [];
      for (const d of decos) { if (Number.isInteger(d.gx) && Number.isInteger(d.gy)) acc(d.gx, d.gy); }
      if (minx === Infinity) { minx = miny = 0; maxx = maxy = 1; }

      const span = (maxx - minx) + (maxy - miny);   // iso screen diagonal (du === dv === Δgx+Δgy)
      const screenW = (span * TW / 2 + TW) * FARM_SCALE;            // +1 tile side padding (× farm scale)
      const screenH = (span * TH / 2 + TH * 4.5) * FARM_SCALE;      // generous headroom for tall building roofs
      // Cap initial zoom at 0.85 (tap-friendly tiles); floor at ZMIN. Fit so the whole
      // farm is visible with a little margin.
      this._zoom = Math.min(0.85, Math.max(ZMIN, Math.min(this._cssW() / (screenW * 1.1), this._cssH() / (screenH * 1.05))));
      const ccx = (minx + maxx) / 2, ccy = (miny + maxy) / 2, u = ccx - ccy, v = ccx + ccy;
      this._camX = u * this._tw() / 2;
      this._camY = this._oy + v * this._th() / 2 - this._cssH() / 2 - this._cssH() * 0.14;   // farm centred, slightly low on the meadow
      this._clampCam();
    },

    // ---- iso transforms ----
    // Rolling-terrain height (Chris 2026-06-18 #3 "农田顺着山坡起伏"). Returns a
    // UNITLESS vertical offset in tile-height units; _cell multiplies by th so it
    // scales with zoom. Long wavelength + modest amplitude → adjacent beds differ
    // only ~6px (stay near-coplanar, no staircase) while the whole field visibly
    // rolls (~30px peak-to-trough), so the farmland drapes over the hills instead
    // of sitting as a flat slab. Mean ≈ 0 so camera framing/clamping is unaffected.
    _hUnit(gx, gy) {
      const a = Math.sin((gx + gy) * 0.30 + 0.5) * 0.42;
      const b = Math.cos((gx - gy) * 0.26 - 0.4) * 0.22;
      return a + b;
    },
    _cell(gx, gy) {
      const tw = this._tw(), th = this._th();
      return { x: this._ox + (gx - gy) * tw / 2 - this._camX + FARM_DX, y: this._oy + (gx + gy) * th / 2 - this._camY + this._hUnit(gx, gy) * th + FARM_DY };
    },
    // Background anchor transform — BASE tiles, NO farm scale/offset/height, so the
    // backdrop stays put when the farm is scaled or panned via FARM_SCALE/FARM_DX/FARM_DY.
    _cellBg(gx, gy) {
      const btw = TW * this._zoom, bth = TH * this._zoom;
      return { x: this._ox + (gx - gy) * btw / 2 - this._camX, y: this._oy + (gx + gy) * bth / 2 - this._camY };
    },
    // Inverse of _cell. The flat algebraic inverse is only a first guess because
    // _cell now adds a per-cell height; refine by scanning a small window around
    // that guess and returning the FRONTMOST cell whose displaced diamond contains
    // the point (matches draw order, so taps land on what you see).
    _screenToCell(sx, sy) {
      const tw = this._tw(), th = this._th();
      const dx = sx + this._camX - this._ox, dy = sy + this._camY - this._oy;
      const fu = dx / (tw / 2), fv = dy / (th / 2);
      const g0 = Math.round((fv + fu) / 2), h0 = Math.round((fv - fu) / 2);
      let best = null, bestSum = -Infinity;
      for (let gy = h0 - 3; gy <= h0 + 3; gy++) {
        for (let gx = g0 - 3; gx <= g0 + 3; gx++) {
          const c = this._cell(gx, gy);
          const d = Math.abs(sx - c.x) / (tw / 2) + Math.abs(sy - c.y) / (th / 2);
          if (d <= 1.0 && (gx + gy) > bestSum) { bestSum = gx + gy; best = { gx, gy }; }
        }
      }
      if (best) return best;
      return { gx: Math.floor((fv + fu) / 2), gy: Math.floor((fv - fu) / 2) };
    },
    _clampCam() {
      // Bound the camera so the painted backdrop ALWAYS covers the viewport — never a base
      // band (Chris 2026-06-18 spec). The bg is world-anchored to cell BG_ANCHOR; we solve
      // the cover constraints (bg edges past the viewport edges) for camX/camY. Vertically
      // it's pinned tight (at min zoom the bg height == viewport height → no vertical pan);
      // horizontally the wider image leaves room to pan left/right.
      const tw = this._tw(), th = this._th(), W = this._cssW(), H = this._cssH();
      const bg = this._img.hd_bg;
      if (bg && bg.width) {
        const scale = Math.max(W / bg.width, H / bg.height) * (this._zoom / BG_ZOOM_REF);
        const dw = bg.width * scale, dh = bg.height * scale;
        // a.x = AX - camX, a.y = AY - camY (camera-independent parts of _cellBg(BG_ANCHOR) —
        // BASE tiles, no farm scale/offset, so the clamp matches the drawn backdrop)
        const btw = TW * this._zoom, bth = TH * this._zoom;
        const AX = this._ox + (BG_ANCHOR_GX - BG_ANCHOR_GY) * btw / 2;
        const AY = this._oy + (BG_ANCHOR_GX + BG_ANCHOR_GY) * bth / 2;
        const cxLo = AX - BG_FX * dw, cxHi = AX - W + (1 - BG_FX) * dw;   // dw>=W → cxLo<=cxHi
        const cyLo = AY - BG_FY * dh, cyHi = AY - H + (1 - BG_FY) * dh;   // dh>=H → cyLo<=cyHi
        this._camX = Math.max(cxLo, Math.min(cxHi, this._camX));
        this._camY = Math.max(cyLo, Math.min(cyHi, this._camY));
        return;
      }
      // Fallback before the bg image loads: keep the grid roughly on-screen.
      const minU = (0 - (ROWS - 1)), maxU = ((COLS - 1) - 0), maxV = (COLS - 1) + (ROWS - 1);
      this._camX = Math.max(minU * tw / 2 - W * 0.6, Math.min(maxU * tw / 2 + W * 0.6, this._camX));
      this._camY = Math.max(this._oy - H * 1.05, Math.min(this._oy + maxV * th / 2 - H * 0.2, this._camY));
    },
    _zoomAt(px, py, nz) {
      const z = Math.max(ZMIN, Math.min(ZMAX, nz));
      if (z === this._zoom) return;
      const u = (px + this._camX - this._ox) / (TW * this._zoom / 2), v = (py + this._camY - this._oy) / (TH * this._zoom / 2);
      this._zoom = z;
      this._camX = this._ox + u * (TW * z / 2) - px;
      this._camY = this._oy + v * (TH * z / 2) - py;
      this._clampCam(); this.render();
    },

    // ---- input ----
    _local(e) { const r = this._cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
    _down(e) {
      const p = this._local(e); this._pointers[e.pointerId] = p;
      const ids = Object.keys(this._pointers);
      if (ids.length === 2) { const [a, b] = ids.map(k => this._pointers[k]); this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._zoom }; this._drag = null; this._moving = null; this._painting = false; return; }
      if (this._build && this._editMode === 'terrain') { const c = this._screenToCell(p.x, p.y); this._painting = true; this._paintCell(c.gx, c.gy); return; }
      if (this._build) {
        if (this._sel >= 0) { const ch = this._delChip((Farm.state.data.map)[this._sel]); if (Math.hypot(p.x - ch.x, p.y - ch.y) <= ch.r) { const o = Farm.state.data.map[this._sel], b = BUILDINGS[o.type], refund = b ? Math.round((b.cost || 0) / 2) : 0; Farm.state.data.map.splice(this._sel, 1); this._sel = -1; if (refund > 0) { Farm.state.addCoins(refund); if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD(); if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? ('Removed — refunded ' + refund + ' coins') : ('已移除 — 退回 ' + refund + ' 农场币')); } this._refreshPaletteAfford(); Farm.state.save(); this.render(); return; } }
        // Grab by the VISIBLE sprite (generous), not the tiny footprint cell — on a
        // phone you tap the building/decoration you see, which sits above its cell.
        const bidx = this._buildingAtPoint(p.x, p.y);
        if (bidx >= 0) { const o = Farm.state.data.map[bidx]; this._sel = bidx; this._moving = { kind: 'building', idx: bidx, gx: o.gx, gy: o.gy, valid: true, sx: p.x, sy: p.y, moved: false }; this.render(); return; }
        const didx = this._decoAtPoint(p.x, p.y);
        if (didx >= 0) { const d = Farm.state.data.decorations[didx]; this._sel = -1; this._moving = { kind: 'deco', idx: didx, gx: d.gx, gy: d.gy, valid: true, sx: p.x, sy: p.y, moved: false }; this.render(); return; }
      }
      this._drag = { x: p.x, y: p.y, camX: this._camX, camY: this._camY, moved: false };
    },
    _move(e) {
      if (!(e.pointerId in this._pointers)) return;
      this._pointers[e.pointerId] = this._local(e);
      const ids = Object.keys(this._pointers);
      if (this._pinch && ids.length >= 2) {
        const [a, b] = ids.map(k => this._pointers[k]);
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this._zoomAt(mid.x, mid.y, this._pinch.zoom * (dist / this._pinch.dist)); return;
      }
      const p = this._pointers[e.pointerId];
      if (this._painting) { const c = this._screenToCell(p.x, p.y); this._paintCell(c.gx, c.gy); return; }
      if (this._moving) {
        if (Math.abs(p.x - this._moving.sx) + Math.abs(p.y - this._moving.sy) > 4) this._moving.moved = true;
        const c = this._screenToCell(p.x, p.y);
        if (this._moving.kind === 'deco') { this._moving.gx = c.gx; this._moving.gy = c.gy; this._moving.valid = this._decoCellFree(c.gx, c.gy, this._moving.idx); }
        else { const o = Farm.state.data.map[this._moving.idx], b = BUILDINGS[o.type]; const gx = c.gx - (b.w >> 1), gy = c.gy - (b.h >> 1); this._moving.gx = gx; this._moving.gy = gy; this._moving.valid = this._footprintFree(gx, gy, o.type, this._moving.idx); }
        this.render(); return;
      }
      if (this._drag) {
        const dx = p.x - this._drag.x, dy = p.y - this._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
        this._camX = this._drag.camX - dx; this._camY = this._drag.camY - dy; this._clampCam(); this.render();
      }
    },
    _up(e) {
      const p = this._pointers[e.pointerId]; delete this._pointers[e.pointerId];
      if (Object.keys(this._pointers).length < 2) this._pinch = null;
      if (this._painting) { this._painting = false; Farm.state.save(); this._drag = null; this.render(); return; }
      if (this._moving) {
        const m = this._moving; this._moving = null;
        if (m.moved && m.valid) {
          if (m.kind === 'deco') { const d = Farm.state.data.decorations[m.idx]; if (d) { d.gx = m.gx; d.gy = m.gy; Farm.state.save(); } }
          else { const o = Farm.state.data.map[m.idx]; if (o) { o.gx = m.gx; o.gy = m.gy; Farm.state.save(); } }
        }
        this.render(); this._drag = null; return;
      }
      const wasTap = this._drag && !this._drag.moved && !this._pinch; this._drag = null;
      if (!wasTap || !p) return;
      // tap the land-unlock badge → expand the farm
      if (this._landBadge && Math.hypot(p.x - this._landBadge.x, p.y - this._landBadge.y) <= this._landBadge.r) { this._tryUnlockLand(); return; }
      const c = this._screenToCell(p.x, p.y);
      if (this._build) { this._sel = this._buildingAt(c.gx, c.gy); this.render(); return; }
      const ps = this._petAt(p.x, p.y);   // tap a roaming pet → ❤️ + sound + hop
      if (ps != null) { this._pettedReact(ps, p.x, p.y); return; }
      // Depth-aware plot pick: crops are ~3 tiles TALL, so players tap the visible
      // plant (high up), not its base cell — a plain cell hit-test would land on the
      // cell BEHIND the plant. Test each plot's on-screen sprite box front-to-back
      // (frontmost = drawn last = what you actually see) so tapping a tall tomato/
      // chili harvests the right plot. Also gives empty/locked plots a forgiving box.
      const hit = this._plotAtPoint(p.x, p.y);
      if (hit) { this._tapCell(hit.gx, hit.gy); return; }
      const bidx = this._buildingAtPoint(p.x, p.y);
      if (bidx >= 0) { const o = Farm.state.data.map[bidx], b = BUILDINGS[o.type]; if (o.type === 'coop') { this._collectCoop(o, p); } else if (b.tap === 'warehouse' && Farm.warehouse && Farm.warehouse.open) Farm.warehouse.open(); else if (b.tap === 'shop' && Farm.shop && Farm.shop.open) Farm.shop.open(); else if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? b.en : b.zh); return; }
      this._tapCell(c.gx, c.gy);
    },
    // Frontmost plot whose on-screen sprite box contains (px,py). Planted plots get
    // a tall box (the plant rises ~3 tiles above the base); empty/locked plots get a
    // ~1-tile box around the diamond. Front-to-back so overlapping crops pick the one
    // drawn on top.
    _plotAtPoint(px, py) {
      const plots = Farm.state.data.plots || [];
      const tw = this._tw(), th = this._th();
      const list = [];
      for (let i = 0; i < plots.length; i++) list.push({ i, gx: this._plotGX(i), gy: this._plotGY(i) });
      list.sort((a, b) => (b.gx + b.gy) - (a.gx + a.gy));   // frontmost first
      for (const o of list) {
        const c = this._cell(o.gx, o.gy), pl = plots[o.i];
        const planted = pl && pl.unlocked && pl.crop;
        if (planted) {
          // Planted: the plant rises ~3 tiles ABOVE the cell, so use a tall box to catch
          // a tap on the visible plant (height tracks growth stage so a seedling's box is
          // short and doesn't swallow neighbours).
          const p = Farm.crops.getProgress ? Farm.crops.getProgress(pl) : 1;
          const fr = p >= 1 ? 3 : p >= 0.6 ? 2 : p >= 0.25 ? 1 : 0;
          const top = c.y - th * (0.7 + fr * 0.6), halfW = tw * 0.5, bot = c.y + th * 0.65;
          if (px >= c.x - halfW && px <= c.x + halfW && py >= top && py <= bot) return o;
        } else {
          // Empty / locked: PRECISE diamond hit-test on the bed (cells tessellate with no
          // overlap) → tapping a plot to plant selects exactly that plot, not a neighbour
          // (Chris 2026-06-18: planting taps were landing on the wrong plot). cy shifted
          // down slightly to match the painted bed's visual centre.
          const d = Math.abs(px - c.x) / (tw / 2) + Math.abs(py - (c.y + th * 0.12)) / (th / 2);
          if (d <= 1.0) return o;
        }
      }
      return null;
    },
    _wheel(e) { e.preventDefault(); const p = this._local(e); this._zoomAt(p.x, p.y, this._zoom * (e.deltaY < 0 ? 1.12 : 0.89)); },
    _tapCell(gx, gy) {
      const idx = this._cellToPlot[gx + ',' + gy]; if (idx == null) return;
      const plot = Farm.state.data.plots[idx];
      if (!plot || !plot.unlocked) {
        const lvl = REQUIRED_LV[idx] || 2;
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(Farm.i18n ? Farm.i18n.t('plot_locked_hint_template', { n: lvl }) : ('Lv ' + lvl + ' 解锁'));
        return;
      }
      if (!plot.crop) { Farm.shop.openSeedPickerForPlot(idx); return; }
      if (Farm.crops.isMature(plot)) { Farm.farm.harvestPlot(idx, this._fakeEvt(gx, gy)); setTimeout(() => this.render(), 50); return; }
      Farm.farm.openPlotCare(idx, plot, Farm.crops.get(plot.crop));
    },
    _fakeEvt(gx, gy) {
      const c = this._cell(gx, gy), r = this._cv.getBoundingClientRect(), th = this._th();
      const rect = { left: r.left + c.x - 10, top: r.top + c.y - th, width: 20, height: th };
      return { target: { getBoundingClientRect: () => rect } };
    },

    // ===== editor (build / terrain / decoration), iso-aware =====
    _terrain() { return (Farm.state.data.mapTerrain = Farm.state.data.mapTerrain || {}); },
    _plotCellSet() {
      const plots = Farm.state.data.plots || [];
      if (this._pcs && this._pcsN === plots.length) return this._pcs;   // cache; rebuild only when a plot unlocks
      const s = {};
      for (let i = 0; i < plots.length; i++) s[this._plotGX(i) + ',' + this._plotGY(i)] = 1;
      this._pcs = s; this._pcsN = plots.length;
      return s;
    },
    _shopItem(itemId) {   // index EP-shop items once instead of .find scanning every frame
      if (!this._itemIndex && Farm.epShop && Farm.epShop.items && Farm.epShop.items.length) {
        this._itemIndex = {}; Farm.epShop.items.forEach((it) => { this._itemIndex[it.id] = it; });
      }
      return this._itemIndex ? this._itemIndex[itemId] : null;
    },
    _inBounds(gx, gy) { return gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS; },
    _landLevel() { return Math.max(0, Math.min(LAND_LEVELS.length - 1, (Farm.state.data && Farm.state.data.landLevel) | 0)); },
    _ownedBounds() { return LAND_LEVELS[this._landLevel()]; },
    _ownedCell(gx, gy) { const o = this._ownedBounds(); return gx >= o.x1 && gx <= o.x2 && gy >= o.y1 && gy <= o.y2; },
    _nextLand() { const lv = this._landLevel(); return lv + 1 < LAND_LEVELS.length ? LAND_LEVELS[lv + 1] : null; },
    _footprintFree(gx, gy, type, exceptIdx) {
      const b = BUILDINGS[type];
      if (gx < 0 || gy < 0 || gx + b.w > COLS || gy + b.h > ROWS) return false;
      const plotCells = this._plotCellSet(), occ = {}, map = (Farm.state.data.map) || [], t = this._terrain();
      for (let i = 0; i < map.length; i++) { if (i === exceptIdx) continue; const o = map[i], ob = BUILDINGS[o.type]; if (!ob) continue; for (let y = 0; y < ob.h; y++) for (let x = 0; x < ob.w; x++) occ[(o.gx + x) + ',' + (o.gy + y)] = 1; }
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const k = (gx + x) + ',' + (gy + y); if (!this._ownedCell(gx + x, gy + y) || plotCells[k] || occ[k] || t[k] === 'water') return false; }
      return true;
    },
    _buildingAt(gx, gy) {
      const map = (Farm.state.data.map) || []; let best = -1, bg = -1;
      for (let i = 0; i < map.length; i++) { const o = map[i], b = BUILDINGS[o.type]; if (!b) continue; if (gx >= o.gx && gx < o.gx + b.w && gy >= o.gy && gy < o.gy + b.h && o.gy >= bg) { best = i; bg = o.gy; } }
      return best;
    },
    // Frontmost building whose ACTUAL drawn sprite box contains (px,py). Buildings
    // are very tall (roofs rise far above the footprint), so a cell hit-test misses
    // roof taps. Mirrors _drawBuilding's anchor + _blit's fit math for an exact box.
    _buildingAtPoint(px, py) {
      const map = (Farm.state.data.map) || [], tw = this._tw(), th = this._th();
      const list = [];
      for (let i = 0; i < map.length; i++) { const b = BUILDINGS[map[i].type]; if (b) list.push({ o: map[i], i, b }); }
      list.sort((a, c) => (c.o.gx + c.b.w + c.o.gy + c.b.h) - (a.o.gx + a.b.w + a.o.gy + a.b.h));   // frontmost first
      for (const { o, i, b } of list) {
        const cc = this._cell(o.gx + (b.w - 1) / 2, o.gy + (b.h - 1) / 2);
        const front = this._cell(o.gx + (b.w - 1), o.gy + (b.h - 1));
        const by = front.y + th / 2 + th * 0.18;
        const im = this._img[b.img]; let w, h;
        if (im && im.width) { const s = Math.min(b.w * tw * 0.92 * BLD / im.width, b.sc * th * 2.2 * BLD / im.height); w = im.width * s; h = im.height * s; }
        else { w = b.w * tw * 1.06 * BLD; h = b.sc * th * 2.0 * BLD; }
        if (px >= cc.x - w / 2 && px <= cc.x + w / 2 && py >= by - h && py <= by) return i;
      }
      return -1;
    },
    _decoAt(gx, gy) { const d = (Farm.state.data.decorations) || []; for (let i = 0; i < d.length; i++) if (d[i].gx === gx && d[i].gy === gy) return i; return -1; },
    // Nearest decoration to a tap, by on-screen distance (generous radius) — small
    // deco/pet sprites are hard to hit dead-center on a phone in build mode.
    _decoAtPoint(px, py) {
      const d = (Farm.state.data.decorations) || [], tw = this._tw(), th = this._th();
      let best = -1, bd = Infinity; const reach = tw * 0.85;
      for (let i = 0; i < d.length; i++) {
        if (!Number.isInteger(d[i].gx) || !Number.isInteger(d[i].gy)) continue;
        const c = this._cell(d[i].gx, d[i].gy), dist = Math.hypot(px - c.x, py - (c.y - th * 0.5));
        if (dist < bd) { bd = dist; best = i; }
      }
      return bd <= reach ? best : -1;
    },
    _decoCellFree(gx, gy, exceptIdx) {
      if (!this._inBounds(gx, gy)) return false;
      if (this._plotCellSet()[gx + ',' + gy] || this._terrain()[gx + ',' + gy] === 'water' || this._buildingAt(gx, gy) >= 0) return false;
      const d = (Farm.state.data.decorations) || []; for (let i = 0; i < d.length; i++) if (i !== exceptIdx && d[i].gx === gx && d[i].gy === gy) return false;
      return true;
    },
    _delChip(o) { const b = BUILDINGS[o.type], c = this._cell(o.gx + b.w - 1, o.gy), th = this._th(); return { x: c.x + this._tw() / 2 * 0.5, y: c.y - th * 0.2, r: Math.max(12, th * 0.5) }; },
    _addBuilding(type) {
      const b = BUILDINGS[type], en = this._lang() === 'en', cost = b.cost || 0;
      // must be able to afford it (农场币) — show the shortfall, nudge to earn more.
      if (cost > 0 && Farm.state.data.coins < cost) {
        const need = cost - Farm.state.data.coins;
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Need ' + need + ' more coins — sell crops to earn!') : ('还差 ' + need + ' 农场币，去卖菜赚钱吧！'));
        return;
      }
      const ctr = this._screenToCell(this._cssW() / 2, this._cssH() / 2);
      const tries = [[ctr.gx - (b.w >> 1), ctr.gy - (b.h >> 1)]];
      for (let gy = 0; gy + b.h <= ROWS; gy++) for (let gx = 0; gx + b.w <= COLS; gx++) tries.push([gx, gy]);
      for (const [gx, gy] of tries) if (this._footprintFree(gx, gy, type, -1)) {
        if (cost > 0 && !Farm.state.spendCoins(cost)) { if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Not enough coins' : '农场币不足'); return; }
        (Farm.state.data.map = Farm.state.data.map || []).push({ type, gx, gy }); this._sel = Farm.state.data.map.length - 1;
        Farm.state.save(); this.render();
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        this._refreshPaletteAfford();
        const charm = charmOf(b), c = this._cell(gx + (b.w - 1) / 2, gy + (b.h - 1) / 2), r = this._cv.getBoundingClientRect();
        if (Farm.ui && Farm.ui.floatText) Farm.ui.floatText('✨+' + charm + ' 魅力', r.left + c.x - 20, r.top + c.y - this._th() * 2, '#e8a020');
        if (Farm.audio) Farm.audio.play('coin');
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Placed ' + b.en + ' (-' + cost + ' coins) — drag to move') : ('已建' + b.zh + '（-' + cost + ' 农场币）拖动可移动'));
        return;
      }
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'No room' : '没有空位了');
    },
    _PLOT_COST: 200,
    _cellFreeForPlot(gx, gy) {
      if (!this._ownedCell(gx, gy)) return false;
      if (this._cellToPlot[gx + ',' + gy] != null) return false;            // already a plot
      if (this._terrain()[gx + ',' + gy] === 'water') return false;
      if (this._buildingAt(gx, gy) >= 0) return false;                       // under a building
      return true;
    },
    _addPlot() {   // buy a new garden plot (菜地) on owned land → farmable anywhere you've expanded
      const en = this._lang() === 'en', cost = this._PLOT_COST;
      if (Farm.state.data.coins < cost) { if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Need ' + (cost - Farm.state.data.coins) + ' more coins') : ('还差 ' + (cost - Farm.state.data.coins) + ' 农场币')); return; }
      const ob = this._ownedBounds(), ctr = this._screenToCell(this._cssW() / 2, this._cssH() / 2);
      const tries = [[ctr.gx, ctr.gy]];
      for (let gy = ob.y1; gy <= ob.y2; gy++) for (let gx = ob.x1; gx <= ob.x2; gx++) tries.push([gx, gy]);
      for (const [gx, gy] of tries) if (this._cellFreeForPlot(gx, gy)) {
        if (!Farm.state.spendCoins(cost)) return;
        const plots = (Farm.state.data.plots = Farm.state.data.plots || []);
        const id = plots.reduce((m, p) => Math.max(m, p.id || 0), -1) + 1;
        plots.push({ id, crop: null, plantedAt: 0, harvestsLeft: 0, unlocked: true, gx, gy });
        this._buildLayout(); this._pcs = null;   // refresh cell→plot map + plotCellSet cache
        Farm.state.save(); this.render();
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        this._refreshPaletteAfford();
        const c = this._cell(gx, gy), r = this._cv.getBoundingClientRect();
        if (Farm.ui && Farm.ui.floatText) Farm.ui.floatText('🌱 -' + cost, r.left + c.x - 16, r.top + c.y - this._th(), '#3a8c50');
        if (Farm.audio) Farm.audio.play('coin');
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'New plot ready — tap to plant!' : '新菜地开好啦 — 点它种菜！');
        return;
      }
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'No room on your land — expand first' : '地里没空位了，先扩地吧');
    },
    _coopReady(o) { return Date.now() - (o && o.eggAt || 0) >= COOP_INTERVAL; },
    _collectCoop(o, p) {
      const en = this._lang() === 'en';
      if (this._coopReady(o)) {
        o.eggAt = Date.now(); Farm.state.addCoins(COOP_REWARD); Farm.state.save();
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        if (Farm.audio) Farm.audio.play('coin');
        if (p && Farm.ui && Farm.ui.floatText) { const r = this._cv.getBoundingClientRect(); Farm.ui.floatText('🥚 +' + COOP_REWARD, r.left + p.x - 16, r.top + p.y - 20, '#e8a020'); }
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Collected eggs! +' + COOP_REWARD + ' coins') : ('收鸡蛋啦！+' + COOP_REWARD + ' 农场币'));
        this.render();
      } else {
        const left = Math.ceil((COOP_INTERVAL - (Date.now() - (o.eggAt || 0))) / 60000);
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Eggs ready in ~' + left + ' min') : ('鸡蛋还需约 ' + left + ' 分钟'));
      }
    },
    _refreshPaletteAfford() {
      if (!this._palBuild) return;
      const coins = (Farm.state.data && Farm.state.data.coins) || 0;
      this._palBuild.querySelectorAll('button[data-type]').forEach((btn) => {
        const b = BUILDINGS[btn.dataset.type], cost = b ? (b.cost || 0) : (btn.dataset.type === '__plot' ? this._PLOT_COST : 0);
        if (!b && btn.dataset.type !== '__plot') return;
        const afford = coins >= cost;
        btn.style.opacity = afford ? '1' : '0.55';
        const cs = btn.querySelector('.palCost'); if (cs) cs.style.color = afford ? '#3a8c50' : '#e8522a';
      });
      if (this._refreshModeUI) this._refreshModeUI();   // refresh the charm count in the hint
    },
    _farmCharm() {
      let s = 0; (Farm.state.data.map || []).forEach((o) => { const b = BUILDINGS[o.type]; if (b) s += charmOf(b); }); return s;
    },
    _paintCell(gx, gy) {
      if (!this._inBounds(gx, gy)) return;
      const t = this._terrain(), k = gx + ',' + gy;
      if (this._brush === 'grass') { if (t[k] != null) { delete t[k]; this.render(); } }
      else if (t[k] !== this._brush) { t[k] = this._brush; this.render(); }
    },

    // ---- build-mode DOM UI (mirrors the top-down view) ----
    _buildUI() {
      const en = this._lang() === 'en';
      const btn = document.createElement('button');
      btn.id = 'isoBuildBtn';
      btn.style.cssText = 'position:fixed;right:14px;z-index:20;border:none;border-radius:24px;padding:11px 16px;font:600 15px/1 "Fredoka",system-ui,sans-serif;color:#fff;background:#4CAF50;box-shadow:0 3px 10px rgba(0,0,0,.22);cursor:pointer;';
      btn.onclick = () => this.toggleBuild();
      document.body.appendChild(btn); this._buildBtn = btn;
      if (!(Farm.state.data && Farm.state.data.mapBuildSeen) && btn.animate) this._buildPulse = btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }], { duration: 1300, iterations: Infinity, easing: 'ease-in-out' });

      const tray = document.createElement('div'); tray.id = 'isoPalette';
      tray.style.cssText = 'position:fixed;left:0;right:0;z-index:20;display:none;flex-direction:column;gap:8px;padding:9px 10px;background:rgba(255,255,255,.94);box-shadow:0 -3px 12px rgba(0,0,0,.12);';
      const tabs = document.createElement('div'); tabs.style.cssText = 'display:flex;gap:6px;justify-content:center;';
      [['build', en ? '🏠 Build' : '🏠 建筑'], ['terrain', en ? '🖌 Terrain' : '🖌 地形']].forEach(([m, label]) => { const t = document.createElement('button'); t.dataset.mode = m; t.textContent = label; t.style.cssText = 'border:none;border-radius:13px;padding:6px 16px;cursor:pointer;font:600 13px/1 "Fredoka",system-ui,sans-serif;'; t.onclick = () => this.setEditMode(m); tabs.appendChild(t); });
      this._modeTabs = tabs; tray.appendChild(tabs);
      // single horizontal SCROLLING row (no wrap) → compact, takes minimal height
      const rowCss = 'display:flex;flex-wrap:nowrap;gap:8px;align-items:flex-end;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;padding-bottom:2px;scrollbar-width:none;';
      const pb = document.createElement('div'); pb.style.cssText = rowCss;
      // 菜地 (new farmable plot) — first item so it's front-and-centre
      const pit = document.createElement('button'); pit.dataset.type = '__plot';
      pit.style.cssText = 'border:1px solid #cdebc9;border-radius:14px;background:#f3fbef;padding:8px 10px 6px;min-width:64px;flex:0 0 auto;cursor:pointer;font:500 12px/1.3 "Fredoka",system-ui,sans-serif;color:#444;';
      pit.innerHTML = '<div style="font-size:11px;color:#3a8c50;margin-top:4px;font-weight:600">🌱 ' + (en ? 'Plot' : '菜地') + '</div><div class="palCost" style="font-size:12px;font-weight:600;color:#3a8c50;margin-top:1px"><span class="coin-icon"></span> ' + this._PLOT_COST + '</div>';
      const pic = document.createElement('div'); pic.style.cssText = 'width:44px;height:38px;margin:0 auto;background-size:contain;background-repeat:no-repeat;background-position:center;'; pic.style.backgroundImage = "url('" + ASSET_DIR + "hd_soil.png')"; pit.insertBefore(pic, pit.firstChild);
      pit.onclick = () => this._addPlot(); pb.appendChild(pit);
      PALETTE.forEach((type) => { const b = BUILDINGS[type]; const item = document.createElement('button'); item.dataset.type = type; item.style.cssText = 'border:1px solid #e0e0e0;border-radius:14px;background:#fff;padding:8px 10px 6px;min-width:64px;flex:0 0 auto;cursor:pointer;font:500 12px/1.3 "Fredoka",system-ui,sans-serif;color:#444;'; item.innerHTML = '<div style="font-size:11px;color:#888;margin-top:4px">' + (en ? b.en : b.zh) + '</div><div class="palCost" style="font-size:12px;font-weight:600;color:#3a8c50;margin-top:1px"><span class="coin-icon"></span> ' + (b.cost || 0) + '</div>'; const ic = document.createElement('div'); ic.style.cssText = 'width:44px;height:38px;margin:0 auto;background-size:contain;background-repeat:no-repeat;background-position:center;'; ic.style.backgroundImage = "url('" + ASSET_DIR + ASSET_SRC[b.img] + "')"; item.insertBefore(ic, item.firstChild); item.onclick = () => this._addBuilding(type); pb.appendChild(item); });
      this._palBuild = pb; tray.appendChild(pb);
      const pt = document.createElement('div'); pt.style.cssText = rowCss;
      BRUSHES.forEach((br) => { const item = document.createElement('button'); item.dataset.brush = br.key; item.style.cssText = 'border:1px solid #e0e0e0;border-radius:14px;background:#fff;padding:8px 10px 6px;min-width:64px;flex:0 0 auto;cursor:pointer;font:500 12px/1.3 "Fredoka",system-ui,sans-serif;color:#444;'; item.innerHTML = '<div style="width:40px;height:30px;margin:0 auto;border-radius:8px;background:' + br.color + '"></div><div style="font-size:11px;color:#888;margin-top:4px">' + (en ? br.en : br.zh) + '</div>'; item.onclick = () => this.setBrush(br.key); pt.appendChild(item); });
      this._palTerrain = pt; tray.appendChild(pt);
      document.body.appendChild(tray); this._palette = tray;

      const hint = document.createElement('div'); hint.id = 'isoBuildHint';
      hint.style.cssText = 'position:fixed;left:0;right:0;z-index:19;text-align:center;display:none;pointer-events:none;font:500 13px/1.4 "Fredoka",system-ui,sans-serif;color:#fff;';
      hint.innerHTML = '<span style="background:rgba(0,0,0,.45);padding:6px 14px;border-radius:16px"></span>';
      document.body.appendChild(hint); this._hint = hint;

      // Always-visible on-screen zoom buttons (＋ / −) — one-tap zoom, easy on phones
      // (in addition to pinch / wheel). Big tap targets.
      const zwrap = document.createElement('div'); zwrap.id = 'isoZoom';
      zwrap.style.cssText = 'position:fixed;z-index:20;display:flex;flex-direction:column;gap:10px;';
      const mkZ = (label, f) => { const z = document.createElement('button'); z.textContent = label; z.style.cssText = 'width:32px;height:32px;border:none;border-radius:50%;background:rgba(255,255,255,.88);color:#3a8c50;font:600 17px/1 system-ui,sans-serif;box-shadow:0 1px 5px rgba(0,0,0,.18);cursor:pointer;touch-action:manipulation;'; z.onclick = (e) => { e.preventDefault(); this._zoomBy(f); }; return z; };
      zwrap.appendChild(mkZ('＋', 1.3)); zwrap.appendChild(mkZ('－', 0.77));
      document.body.appendChild(zwrap); this._zoomUI = zwrap;

      this._refreshModeUI(); this._layoutUI();
    },
    _zoomBy(f) { this._zoomAt(this._cssW() / 2, this._cssH() / 2, this._zoom * f); },
    _layoutUI() {
      const r = this._farmRect(), fromBottom = Math.max(0, window.innerHeight - (r.top + r.height)), en = this._lang() === 'en';
      if (this._zoomUI) {
        // top-right corner of the farm; clamp below the topbar (it stays
        // visible even in fullscreen build mode) so it never overlaps the coins.
        const tb = document.getElementById('topbar');
        const tbBottom = tb ? tb.getBoundingClientRect().bottom : 0;
        this._zoomUI.style.left = (r.left + r.width - 42) + 'px';
        this._zoomUI.style.top = Math.max(r.top + 10, tbBottom + 8) + 'px';
      }
      if (this._palette) { this._palette.style.display = this._build ? 'flex' : 'none'; this._palette.style.left = r.left + 'px'; this._palette.style.right = Math.max(0, window.innerWidth - (r.left + r.width)) + 'px'; this._palette.style.bottom = fromBottom + 'px'; }
      if (this._buildBtn) { const ph = (this._build && this._palette) ? (this._palette.getBoundingClientRect().height || 74) : 0; this._buildBtn.style.right = (Math.max(0, window.innerWidth - (r.left + r.width)) + 14) + 'px'; this._buildBtn.style.bottom = (fromBottom + (this._build ? ph + 10 : 14)) + 'px'; this._buildBtn.textContent = this._build ? (en ? '✓ Done' : '✓ 完成') : (en ? '🔨 Build' : '🔨 建造'); this._buildBtn.style.background = this._build ? '#FF9800' : '#4CAF50'; }
      if (this._hint) { this._hint.style.display = this._build ? 'block' : 'none'; this._hint.style.left = r.left + 'px'; this._hint.style.right = Math.max(0, window.innerWidth - (r.left + r.width)) + 'px'; this._hint.style.top = (r.top + 8) + 'px'; }
    },
    _refreshModeUI() {
      const terr = this._editMode === 'terrain', en = this._lang() === 'en';
      if (this._palBuild) this._palBuild.style.display = terr ? 'none' : 'flex';
      if (this._palTerrain) this._palTerrain.style.display = terr ? 'flex' : 'none';
      if (this._modeTabs) Array.from(this._modeTabs.children).forEach((t) => { const on = t.dataset.mode === this._editMode; t.style.background = on ? '#FF9800' : '#eee'; t.style.color = on ? '#fff' : '#777'; });
      if (this._palTerrain) Array.from(this._palTerrain.children).forEach((it) => { it.style.outline = (it.dataset.brush === this._brush) ? '3px solid #FF9800' : 'none'; });
      if (this._hint) { const s = this._hint.querySelector('span'); if (s) s.textContent = terr ? (en ? 'Tap / drag to paint terrain' : '点按或拖动涂刷地形（草地=擦除）') : (en ? ('✨ Charm ' + this._farmCharm() + ' · drag to place · ✕ remove (50% back)') : ('✨ 农场魅力 ' + this._farmCharm() + ' · 拖动摆放 · ✕ 移除(退一半)')); }
      this._layoutUI();
    },
    setEditMode(m) { this._editMode = m; this._sel = -1; this._moving = null; this._refreshModeUI(); this.render(); },
    setBrush(b) { this._brush = b; this._refreshModeUI(); },
    toggleBuild() {
      this._build = !this._build;
      if (this._build && Farm.state.data && !Farm.state.data.mapBuildSeen) { Farm.state.data.mapBuildSeen = true; Farm.state.save(); if (this._buildPulse) { this._buildPulse.cancel(); this._buildPulse = null; } }
      if (this._build) {
        // Build mode goes FULLSCREEN: hide the bottom bars (Lv/XP, nav, install banner)
        // for max room; keep the top bar so the coin balance stays visible. Then zoom
        // out to show the whole farm + empty-land margin to drag into.
        this._savedView = { zoom: this._zoom, camX: this._camX, camY: this._camY };
        this._setChromeHidden(true); this._resize();
        this._buildFrame(); this._refreshPaletteAfford();
      } else {
        this._sel = -1; this._moving = null; this._painting = false; this._editMode = 'build'; Farm.state.save();
        this._setChromeHidden(false); this._resize();
        if (this._savedView) { this._zoom = this._savedView.zoom; this._camX = this._savedView.camX; this._camY = this._savedView.camY; this._savedView = null; this._clampCam(); }
      }
      this._refreshModeUI(); this._layoutUI(); this.render();
    },
    _setChromeHidden(hide) {
      ['statusbar', 'bottombar', 'pwaInstallBanner', 'harvestStatusBar', 'storekeeper'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.display = hide ? 'none' : ''; });
      document.body.classList.toggle('iso-build-fullscreen', hide);
    },
    // Frame the whole farm (plots + buildings) with a generous empty margin → room to
    // move things around on a phone. Lower zoom than the tight play view.
    _buildFrame() {
      const plots = Farm.state.data.plots || []; let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      const add = (gx, gy) => { minx = Math.min(minx, gx); miny = Math.min(miny, gy); maxx = Math.max(maxx, gx); maxy = Math.max(maxy, gy); };
      for (let i = 0; i < plots.length; i++) add(this._plotGX(i), this._plotGY(i));
      (Farm.state.data.map || []).forEach((o) => { const b = BUILDINGS[o.type]; if (b) { add(o.gx, o.gy); add(o.gx + b.w - 1, o.gy + b.h - 1); } });
      if (minx === Infinity) { minx = 0; miny = 0; maxx = COLS - 1; maxy = ROWS - 1; }
      minx -= 2; miny -= 2; maxx += 2; maxy += 2;   // empty-land margin to drop things into
      const span = (maxx - minx) + (maxy - miny);
      const screenW = span * TW / 2, screenH = span * TH / 2 + TH * 3;
      // reserve ~38% of height for the palette tray so content frames into the top area
      this._zoom = Math.max(ZMIN, Math.min(this._cssW() / (screenW * 1.08), (this._cssH() * 0.62) / (screenH * 1.0)));
      const ccx = (minx + maxx) / 2, ccy = (miny + maxy) / 2, u = ccx - ccy, v = ccx + ccy;
      this._camX = u * this._tw() / 2;
      this._camY = this._oy + v * this._th() / 2 - this._cssH() * 0.34;   // push content up, above the palette
      this._clampCam();
    },

    // ---- render ----
    _blit(im, cx, by, maxW, maxH) { if (!im) return false; const s = Math.min(maxW / im.width, maxH / im.height), w = im.width * s, h = im.height * s; this._ctx.drawImage(im, cx - w / 2, by - h, w, h); return true; },
    _cropSprite(id) {
      const c = this._cropImg[id]; if (c instanceof Image) return c; if (c === true || c === false) return null;
      const url = (Farm.cropArt && Farm.cropArt.spriteUrl) ? Farm.cropArt.spriteUrl(id) : null;
      if (!url) { this._cropImg[id] = true; return null; }
      this._cropImg[id] = false; const im = new Image(); im.onload = () => { this._cropImg[id] = im; if (this._on) this.render(); }; im.onerror = () => { this._cropImg[id] = true; }; im.src = url; return null;
    },
    // Lazy-load any map asset by file stem (e.g. 'crop_eggplant_2', 'animal_cat').
    _lazyImg(name) {
      const k = 'L_' + name, c = this._img[k];
      if (c instanceof Image) return c;
      if (c === 'loading' || c === 'failed') return null;   // 'failed' is sticky → no per-frame retry storm on a 404
      this._img[k] = 'loading';
      const im = new Image(); im.onload = () => { this._img[k] = im; if (this._on) this.render(); }; im.onerror = () => { this._img[k] = 'failed'; }; im.src = ASSET_DIR + name + '.png';
      return null;
    },
    _diamond(x, y, tw, th) { const c = this._ctx; c.beginPath(); c.moveTo(x, y - th / 2); c.lineTo(x + tw / 2, y); c.lineTo(x, y + th / 2); c.lineTo(x - tw / 2, y); c.closePath(); },
    // soft contact shadow under an object → grounds it (Hay-Day depth)
    _shadow(cx, cy, w, alpha) {
      const ctx = this._ctx; ctx.save(); ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.5, w * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(38,46,26,' + (alpha || 0.16) + ')'; ctx.fill(); ctx.restore();
    },
    // ---- world-anchored landscape backdrop (cx,cy are camera-adjusted, so it pans) ----
    _drawHills(cx, cy, span) {
      const ctx = this._ctx;
      // 3 layered soft humps, far→near (lighter/bluer = farther for haze depth)
      const layers = [
        { dy: -span * 0.06, h: span * 0.30, col: '#bcd9a8' },
        { dy: span * 0.02, h: span * 0.34, col: '#a6cf86' },
        { dy: span * 0.10, h: span * 0.40, col: '#8ec46a' },
      ];
      layers.forEach((L) => {
        ctx.fillStyle = L.col; ctx.beginPath();
        const left = cx - span * 1.1, right = cx + span * 1.1, base = cy + L.dy + L.h;
        ctx.moveTo(left, base);
        // a few rolling bumps via quadratic curves
        const bumps = 5, step = (right - left) / bumps;
        for (let i = 0; i < bumps; i++) {
          const x0 = left + i * step, peakY = cy + L.dy - (i % 2 ? L.h * 0.12 : 0);
          ctx.quadraticCurveTo(x0 + step * 0.5, peakY, x0 + step, base - (i % 2 ? 0 : L.h * 0.08));
        }
        ctx.lineTo(right, base + span); ctx.lineTo(left, base + span); ctx.closePath(); ctx.fill();
      });
    },
    _tree(x, y, s) {
      const ctx = this._ctx;
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - s * 0.09, y - s * 0.5, s * 0.18, s * 0.5);   // trunk
      const blob = (dx, dy, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + dx, y - s * 0.7 + dy, r, 0, Math.PI * 2); ctx.fill(); };
      blob(-s * 0.28, s * 0.1, s * 0.34, '#4f8f44');
      blob(s * 0.28, s * 0.1, s * 0.34, '#4f8f44');
      blob(0, -s * 0.15, s * 0.42, '#5fa050');
      blob(-s * 0.1, -s * 0.05, s * 0.3, '#6cb45a');   // highlight
    },
    _tuft(x, y, s) {
      const ctx = this._ctx; ctx.fillStyle = '#74b252';
      for (let i = 0; i < 4; i++) { const dx = (i - 1.5) * s * 0.4; ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.lineTo(x + dx + s * 0.13, y - s); ctx.lineTo(x + dx - s * 0.13, y); ctx.closePath(); ctx.fill(); }
    },
    _flower(x, y, s) {
      this._tuft(x, y, s * 0.8); const ctx = this._ctx;
      const cols = ['#f6c945', '#ef7a7a', '#e88ad0', '#ffffff'], col = cols[Math.abs(Math.round(x * 0.7 + y)) % 4];
      ctx.fillStyle = col; for (let a = 0; a < 5; a++) { const an = a / 5 * 6.283; ctx.beginPath(); ctx.arc(x + Math.cos(an) * s * 0.2, y - s * 0.95 + Math.sin(an) * s * 0.2, s * 0.15, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(x, y - s * 0.95, s * 0.13, 0, 6.283); ctx.fill();
    },
    // scattered grass tufts + flowers around the farm (NOT on the plot block), world-anchored
    _drawMeadowDetail(cx, cy) {
      const tw = this._tw(), th = this._th();
      const P = [[-3.6, 2.5], [-3.1, 4.6], [-4.1, 0.8], [-2.2, 6.3], [-1.4, 7.4], [3.5, 1.8], [4.2, 3.6], [4.6, 0.4], [3.0, 6.0], [1.2, 7.3], [2.6, 7.6], [-3.0, 7.0]];
      P.forEach((o, i) => { const x = cx + o[0] * tw, y = cy + o[1] * th; if (i % 3 === 0) this._flower(x, y, tw * 0.22); else this._tuft(x, y, tw * 0.24); });
    },
    _drawTreeRow(cx, y, span) {
      // a row of trees along the horizon behind the farm (world-anchored → pans),
      // with a gentle up/down sway so it reads as a treeline, not a fence.
      const n = 11, tw = this._tw();
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = cx - span / 2 + span * t;
        const dy = Math.sin(t * 7.1) * this._th() * 0.5;        // stable wobble
        this._tree(x, y + dy, tw * (1.25 + (i % 3) * 0.3));
      }
    },
    // Clean procedural tilled-soil bed (replaces the muddy p_soil cube tile, which
    // tiled with dark seams). A flat inset diamond + furrows + a soft raised rim →
    // neat, distinct Hay-Day plots that tessellate seamlessly.
    // Empty-plot soil bed: a painted soil cube EXTRACTED from a crop sprite, so it
    // matches the crops' own baked soil exactly → every plot (empty or planted) is a
    // consistent raised tilled bed. Bottom-anchored like the crops so heights line up.
    _tilledDiamond(cx, cy) {
      const im = this._img.plot_bed, ctx = this._ctx, tw = this._tw(), th = this._th();
      if (im && im.width) { const w = tw * 1.04, s = w / im.width, hh = im.height * s; ctx.drawImage(im, cx - w / 2, cy + th * 0.6 - hh, w, hh); return; }
      this._diamond(cx, cy, tw, th); ctx.fillStyle = '#a9743f'; ctx.fill();
    },
    // Draw a painted cube ground tile centered on cell c (diamond width = TW,
    // ~2% overlap to hide seams), or a flat-diamond fallback while it loads.
    _tileImg(key, c) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      // grass & soil = flat 1:1 diamond images, squished to the 2:1 cell and centered
      // → they tessellate edge-to-edge into a clean continuous field (no cube skirts /
      // black "boards" / quilt). overlap a hair to hide anti-aliased seams.
      if (key === 'grass') return;   // grass = the smooth solid base fill (drawn in render); no per-tile quilt
      if (key === 'soil') {
        // Chris's painted tilled-soil bed (raised cube). Drawn per plot → distinct
        // raised beds on the green field, Hay-Day style. cy = top-face center fraction.
        const im = this._img.hd_soil;
        // BED_W < 1 leaves a small grass gap between adjacent beds so each plot
        // reads as a DISTINCT, separately-tappable patch (Chris 2026-06-18: beds
        // looked merged/stacked). Was tw*1.18 (overlapping → one brown mass).
        if (im) { const w = tw * BED_W, sc = w / im.width, dh = im.height * sc; ctx.drawImage(im, c.x - w / 2, c.y - dh * 0.42, w, dh); return; }
        this._diamond(c.x, c.y, tw * BED_W, th * BED_W); ctx.fillStyle = SOIL_TOP; ctx.fill(); return;
      }
      // path / water = FLAT diamonds matching the flat ground (no raised cube → no
      // clash with the green field). Subtle detail keeps them readable.
      if (key === 'water' || key === 'path') {
        const w = tw * 1.04, h = th * 1.04;
        this._diamond(c.x, c.y, w, h);
        if (key === 'water') {
          const g = ctx.createLinearGradient(c.x, c.y - h / 2, c.x, c.y + h / 2); g.addColorStop(0, '#86c8e8'); g.addColorStop(1, '#4f9fc9');
          ctx.fillStyle = g; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = Math.max(1, th * 0.05);
          ctx.beginPath(); ctx.moveTo(c.x - w * 0.16, c.y - th * 0.05); ctx.quadraticCurveTo(c.x, c.y - th * 0.12, c.x + w * 0.16, c.y - th * 0.05); ctx.stroke();
        } else {
          ctx.fillStyle = '#c08e54'; ctx.fill();
          ctx.fillStyle = 'rgba(110,78,42,0.45)';
          for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * w * 0.22, c.y + Math.sin(a) * h * 0.22, Math.max(1.2, th * 0.06), 0, 6.283); ctx.fill(); }
        }
        return;
      }
      this._diamond(c.x, c.y, tw, th);
      ctx.fillStyle = GRASS_A; ctx.fill();
    },
    _startLoop() {
      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        if (!this._on || document.hidden) return;
        const modal = document.getElementById('modal'); if (modal && !modal.classList.contains('hidden')) return;
        const now = Date.now(); if (now - this._lastFrame < 33) return; this._lastFrame = now; this.render();  // ~30fps for smooth pet walking
      };
      this._raf = requestAnimationFrame(loop);
    },
    // Render the static landscape backdrop into `this._ctx` (which _blitBackdrop
    // temporarily points at the offscreen cache canvas).
    _drawBackdrop(W, H) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      // Base gradient: sky → soft green. Fills any pixel the photo doesn't, and is
      // the fallback before the image loads.
      const base = ctx.createLinearGradient(0, 0, 0, H);
      base.addColorStop(0, '#eaf4ef'); base.addColorStop(0.55, '#d2e8c6'); base.addColorStop(1, '#b5cf86');
      ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);

      const bg = this._img.hd_bg;
      if (bg && bg.width) {
        // WORLD-LOCKED backdrop (Chris 2026-06-18: "先把背景图定好坐标-对应农场坐标和
        // 尺寸"). Anchored to a fixed WORLD cell via _cell() (which carries pan + zoom),
        // so it pans AND zooms 1:1 with the farm — the farm always sits on the same patch
        // of meadow, and it never "floats to the sky" on zoom-out (scale tracks _zoom with
        // NO floor). Base size = cover-the-canvas at the reference zoom, so at normal zoom
        // the photo fully covers (no flat base band at the edges); clamped to the canvas
        // while it's ≥ canvas, centred (base shows around) only when zoomed far out.
        // PURE world-anchor — NO clamp. The image's meadow focal (BG_FX,BG_FY) is pinned
        // to world cell (BG_ANCHOR) which moves with pan+zoom, so the farm ALWAYS sits on
        // the meadow (a clamp here was decoupling them → farm floated off the meadow). At
        // the default framed zoom dh≈1.2×H with the meadow at the farm (~64% screen), so it
        // fully covers; zooming out lets it shrink with the farm → reveals the panorama.
        const a = this._cellBg(BG_ANCHOR_GX, BG_ANCHOR_GY);
        const scale = Math.max(W / bg.width, H / bg.height) * (this._zoom / BG_ZOOM_REF);
        const dw = bg.width * scale, dh = bg.height * scale;
        ctx.drawImage(bg, a.x - BG_FX * dw, a.y - BG_FY * dh, dw, dh);
      } else {   // fallback: procedural hills (image not yet loaded)
        const pc = this._cell(3, 3);
        this._drawHills(pc.x, pc.y - th * 3, 20 * tw * 0.62);
        this._drawTreeRow(pc.x, pc.y - th * 1.5, 20 * tw * 0.59);
      }
    },
    _blitBackdrop(ctx, W, H) {
      const key = Math.round(this._camX) + ',' + Math.round(this._camY) + ',' + this._zoom.toFixed(3) + ',' + W + ',' + H;
      if (this._bgKey !== key || !this._bgCache) {
        if (!this._bgCache) this._bgCache = document.createElement('canvas');
        const cv = this._bgCache, dpr = this._dpr, pw = Math.round(W * dpr), ph = Math.round(H * dpr);
        if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
        const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
        const real = this._ctx; this._ctx = g; this._drawBackdrop(W, H); this._ctx = real;
        this._bgKey = key;
      }
      ctx.drawImage(this._bgCache, 0, 0, W, H);
    },
    render() {
      if (!this._on) return;
      const ctx = this._ctx, tw = this._tw(), th = this._th(), W = this._cssW(), H = this._cssH();
      const terrain = Farm.state.data.mapTerrain || {};
      ctx.clearRect(0, 0, W, H);
      // Landscape backdrop (sky/hills/trees/meadow/tufts) — only changes when the
      // camera pans/zooms, so it's rendered once into an offscreen canvas and reused
      // on the ~30fps animation frames (pets/bubbles). Saves CPU/battery on phones.
      this._blitBackdrop(ctx, W, H);

      // Soil beds (plots) + terrain tiles, back-to-front. Grass cells draw nothing
      // (the base shows through). Plot cells use the raised soil bed.
      const plotCells = this._plotCellSet();
      for (let s = 0; s <= (COLS - 1) + (ROWS - 1); s++) {
        for (let gx = 0; gx < COLS; gx++) {
          const gy = s - gx; if (gy < 0 || gy >= ROWS) continue;
          const c = this._cell(gx, gy);
          if (c.x + tw < 0 || c.x - tw > W || c.y + th * 4 < 0 || c.y - th * 2 > H) continue;
          const k = gx + ',' + gy;
          let key = 'grass';
          if (plotCells[k]) {
            const pl = Farm.state.data.plots[this._cellToPlot[k]];
            // every UNLOCKED plot (empty or planted) gets the soil bed → a uniform
            // tilled field; pure-plant crops sit on top. Locked plots stay grass.
            if (pl && pl.unlocked) key = 'soil';
          }
          if (terrain[k] === 'water') key = 'water'; else if (terrain[k] === 'path') key = 'path';
          if (key !== 'grass') this._tileImg(key, c);
        }
      }

      // build-mode grid overlay
      if (this._build) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
        for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) { const c = this._cell(gx, gy); this._diamond(c.x, c.y, tw, th); ctx.stroke(); }
      }

      // depth-sorted objects: plots + buildings
      const draws = [];
      const plots = Farm.state.data.plots || [];
      if (this._cellToPlotN !== plots.length) { this._buildLayout(); this._cellToPlotN = plots.length; }
      for (let i = 0; i < plots.length; i++) {
        const gx = this._plotGX(i), gy = this._plotGY(i);
        draws.push({ d: gx + gy, fn: () => this._drawPlot(plots[i], gx, gy, i) });
      }
      const map = (Farm.state.data.map) || [];
      for (let i = 0; i < map.length; i++) {
        const o = map[i], b = BUILDINGS[o.type]; if (!b) continue;
        const mv = this._moving && this._moving.kind === 'building' && this._moving.idx === i;
        const gx = mv ? this._moving.gx : o.gx, gy = mv ? this._moving.gy : o.gy;
        draws.push({ d: (gx + gy) + (b.w - 1) + (b.h - 1) + 0.5, fn: () => this._drawBuilding({ type: o.type, gx, gy }, b, mv, i) });
      }
      const nowW = Date.now();
      const wdt = this._lastWalkT ? Math.min(0.25, (nowW - this._lastWalkT) / 1000) : 0;
      this._lastWalkT = nowW;
      this._decoPlacements().forEach((d) => {
        const mv = this._moving && this._moving.kind === 'deco' && this._moving.idx === d.seed;
        if (d.itemId && ANIMALS[d.itemId] && !mv) {           // walking pet
          const p = this._updatePet(d.seed, d.gx, d.gy, wdt);
          draws.push({ d: p.fx + p.fy + 0.25, fn: () => this._drawAnimal(d, p.fx, p.fy, p.face) });
        } else {                                              // static deco (or pet being dragged)
          const gx = mv ? this._moving.gx : d.gx, gy = mv ? this._moving.gy : d.gy;
          draws.push({ d: gx + gy + 0.2, fn: () => this._drawDeco({ emoji: d.emoji, itemId: d.itemId, gx, gy, pet: d.pet, seed: d.seed }, mv) });
        }
      });
      draws.sort((a, c) => a.d - c.d); draws.forEach(x => x.fn());

      this._drawLockedLand();
      this._drawParticles(tw); this._drawFestival();
    },
    _rectPath(x1, y1, x2, y2) {   // cell-rect → screen parallelogram path
      const ctx = this._ctx, a = this._cell(x1, y1), b = this._cell(x2 + 1, y1), c = this._cell(x2 + 1, y2 + 1), d = this._cell(x1, y2 + 1);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    },
    // Dim the WILD (locked) land beyond the owned area + show a pulsing unlock badge on
    // the next region, so players see "tap to claim more farmland".
    _drawLockedLand() {
      const next = this._nextLand(); this._landBadge = null;
      if (!next) return;
      const ctx = this._ctx, ob = this._ownedBounds(), th = this._th();
      // No overlay / outline on the land at all — the farm sits naturally on the painted
      // meadow (Chris 2026-06-18: dark overlay AND dashed border both removed). Players
      // still see where to expand via the unlock badge below.
      // badge at the centre of the NEXT region's new band (beyond the owned edge)
      const cx2 = (ob.x2 + next.x2) / 2 + 0.5, cy2 = (next.y1 + next.y2) / 2;
      const c = this._cell(cx2, cy2), t = Date.now() / 1000, pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
      const r = Math.max(26, th * 1.5);
      ctx.save();
      ctx.beginPath(); ctx.arc(c.x, c.y, r * (1 + pulse * 0.05), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
      ctx.strokeStyle = '#e8a020'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#5a4326'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = (r * 0.62) + 'px sans-serif'; ctx.fillText('🔒', c.x, c.y - r * 0.34);
      ctx.fillStyle = '#3a8c50'; ctx.font = 'bold ' + (r * 0.34) + 'px "Fredoka",system-ui,sans-serif';
      ctx.fillText('+' + next.coins, c.x, c.y + r * 0.18);
      if (next.points) { ctx.fillStyle = '#E8522A'; ctx.font = 'bold ' + (r * 0.3) + 'px "Fredoka",system-ui,sans-serif'; ctx.fillText('+' + next.points + '★', c.x, c.y + r * 0.55); }
      ctx.restore();
      this._landBadge = { x: c.x, y: c.y, r: r };
    },
    _tryUnlockLand() {
      const next = this._nextLand(); if (!next) return;
      const en = this._lang() === 'en', haveC = Farm.state.data.coins, haveP = (Farm.state.data.totalPoints || 0);
      if (haveC < next.coins || (next.points && haveP < next.points)) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Not enough to expand yet — keep farming!' : '钱/积分还不够，再攒攒！');
        return;
      }
      const go = () => {
        if (!Farm.state.spendCoins(next.coins)) return;
        if (next.points) { if (!Farm.state.spendEastPoints(next.points, { source: 'land_expand', description: 'Farm land expansion' })) { Farm.state.addCoins(next.coins); return; } }
        Farm.state.data.landLevel = this._landLevel() + 1; Farm.state.save();
        this._bgKey = null; if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        if (Farm.audio) Farm.audio.play('levelUp'); if (Farm.ui && Farm.ui.showConfetti) Farm.ui.showConfetti(30, 1800);
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'New land unlocked! 🎉' : '新土地解锁啦！🎉');
        this.render();
      };
      const cost = next.coins + ' <span class="coin-icon"></span>' + (next.points ? (' + ' + next.points + ' <span class="points-icon"></span>') : '');
      const html = '<div style="text-align:center;padding:4px;">' +
        '<div style="font-size:40px;margin-bottom:4px;">🌄</div><h2 class="modal-title">' + (en ? 'Expand your farm?' : '扩大农场？') + '</h2>' +
        '<div style="color:#666;margin:8px 0 14px;font-size:14px;line-height:1.5;">' + (en ? 'Claim this wild land — build and decorate on it.' : '把这片野地变成你的农场，可建造和装饰。') + '</div>' +
        '<div style="font-weight:600;font-size:16px;margin-bottom:16px;">' + (en ? 'Cost: ' : '花费：') + cost + '</div>' +
        '<div class="btn-row"><button class="btn secondary" id="landNo">' + (en ? 'Later' : '稍后') + '</button><button class="btn primary" id="landYes">🌱 ' + (en ? 'Unlock' : '解锁') + '</button></div></div>';
      Farm.ui.showModal(html);
      const y = document.getElementById('landYes'), n = document.getElementById('landNo');
      if (y) y.onclick = () => { Farm.ui.hideModal(); go(); };
      if (n) n.onclick = () => Farm.ui.hideModal();
    },
    _drawPlot(plot, gx, gy, idx) {
      const ctx = this._ctx, tw = this._tw(), th = this._th(), c = this._cell(gx, gy);
      if (!plot.unlocked) {   // locked → a DIMMED tilled bed (consistent with the field) + lock badge
        const im = this._img.hd_soil;
        if (im) { const w = tw * BED_W, sc = w / im.width, dh = im.height * sc; ctx.save(); ctx.globalAlpha = 0.5; ctx.drawImage(im, c.x - w / 2, c.y - dh * 0.42, w, dh); ctx.restore(); }
        else { this._diamond(c.x, c.y, tw * 0.88, th * 0.88); ctx.fillStyle = 'rgba(120,90,60,0.5)'; ctx.fill(); }
        this._diamond(c.x, c.y, tw * 0.96, th * 0.96); ctx.fillStyle = 'rgba(55,65,50,0.3)'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = (th * 0.5) + 'px sans-serif'; ctx.fillText('🔒', c.x, c.y - th * 0.08);
        ctx.font = 'bold ' + (th * 0.4) + 'px "Fredoka",sans-serif'; ctx.fillText('Lv' + (REQUIRED_LV[idx] || 2), c.x, c.y + th * 0.4);
        return;
      }
      // ground already drew the clean tilled bed for this cell; add a small, soft
      // pulsing "+" hint that you can plant here (subtle — the bed itself reads).
      if (!plot.crop) {
        const t = Date.now() / 1000, pulse = 0.5 + 0.5 * Math.sin(t * 2 + gx + gy);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,248,232,' + (0.34 + pulse * 0.22) + ')';
        ctx.font = 'bold ' + (th * 0.42) + 'px "Fredoka",sans-serif';
        ctx.fillText('+', c.x, c.y); return;
      }
      const p = Farm.crops.getProgress ? Farm.crops.getProgress(plot) : 1, mature = Farm.crops.isMature(plot);
      const by = c.y + th * 0.2;   // sprite stands on the diamond
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const fr = p >= 1 ? 3 : p >= 0.6 ? 2 : p >= 0.25 ? 1 : 0;
      // soft contact shadow so the plant sits IN the bed (not floating)
      this._shadow(c.x, c.y + th * 0.42, tw * (0.4 + fr * 0.12));
      let plantTopY = c.y - th * 1.3;   // fallback bubble anchor
      if (ISO_CROPS[plot.crop]) {   // pure-plant 4-stage sprite — FIXED scale (260px base) → seedling small
        const im = this._lazyImg(ISO_CROPS[plot.crop] + '_' + fr);
        if (im) { const s = (th * 2.2) / 260, w = im.width * s, h = im.height * s; const topY = (c.y + th * 0.34) - h; ctx.drawImage(im, c.x - w / 2, topY, w, h); plantTopY = topY; }
        else { const def = Farm.crops.get(plot.crop); ctx.font = (th * 1.1) + 'px sans-serif'; ctx.fillText((def && def.icon) || '🌿', c.x, by); }
      } else if (mature) {
        const im = this._cropSprite(plot.crop);
        if (!this._blit(im, c.x, by, tw * 0.72, th * 1.7)) { const def = Farm.crops.get(plot.crop); ctx.font = (th * 1.1) + 'px sans-serif'; ctx.fillText((def && def.icon) || '🥬', c.x, by); }
      } else { ctx.font = (th * (p >= 0.4 ? 0.9 : 0.7)) + 'px sans-serif'; ctx.fillText(p >= 0.4 ? '🌿' : '🌱', c.x, by); }
      if (mature) {
        // clear "ready to harvest" bubble: a white pill with the crop icon, gently
        // bobbing above the plant — much clearer than the old faint yellow glow.
        const def = Farm.crops.get(plot.crop), t = Date.now() / 1000, bob = Math.sin(t * 2.5 + gx + gy) * th * 0.12;
        const r = th * 0.5, bx = c.x, byy = plantTopY - th * 0.5 + bob;
        ctx.beginPath(); ctx.arc(bx, byy, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
        ctx.strokeStyle = 'rgba(120,160,70,0.9)'; ctx.lineWidth = Math.max(1.5, th * 0.06); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = (r * 1.25) + 'px sans-serif';
        ctx.fillText((def && def.icon) || '✅', bx, byy + r * 0.05);
        ctx.textBaseline = 'alphabetic';
      } else {   // progress bar
        const bw = tw * 0.5, bx = c.x - bw / 2, ybar = c.y + th * 0.34, bh = Math.max(3, th * 0.1);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(bx, ybar, bw, bh);
        ctx.fillStyle = '#7bc043'; ctx.fillRect(bx, ybar, bw * Math.max(0.04, p), bh);
      }
    },
    _drawBuilding(o, b, moving, idx) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      if (moving || (this._build && this._sel === idx && idx != null)) {   // footprint highlight diamonds
        const ok = moving ? this._moving.valid : true;
        ctx.fillStyle = moving ? (ok ? 'rgba(76,175,80,0.34)' : 'rgba(220,60,60,0.36)') : 'rgba(255,152,0,0.22)';
        for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const cc2 = this._cell(o.gx + x, o.gy + y); this._diamond(cc2.x, cc2.y, tw, th); ctx.fill(); }
      }
      const cc = this._cell(o.gx + (b.w - 1) / 2, o.gy + (b.h - 1) / 2);
      const front = this._cell(o.gx + (b.w - 1), o.gy + (b.h - 1));
      const by = front.y + th / 2 + th * 0.18;
      if (!moving) this._shadow(cc.x, by - th * 0.35, b.w * tw * 0.7, 0.18);   // contact shadow grounds the building
      ctx.globalAlpha = moving ? 0.82 : 1;
      if (!this._blit(this._img[b.img], cc.x, by, b.w * tw * 0.92 * BLD, b.sc * th * 2.2 * BLD)) { ctx.fillStyle = '#c0392b'; ctx.fillRect(cc.x - tw * 0.4, by - th, tw * 0.8, th); }
      ctx.globalAlpha = 1;
      // coop ready-to-collect egg bubble (read the real map entry for eggAt)
      // coop ready-to-collect indicator: a SMALL egg bubble nestled just above the
      // coop roof (was a big white orb floating high above → looked like a stray ball,
      // Chris 2026-06-18). Smaller + closer + gentle bob so it clearly belongs to the coop.
      if (o.type === 'coop' && !this._build) { const real = Farm.state.data.map[idx]; if (real && this._coopReady(real)) { const t = Date.now() / 1000, bob = Math.sin(t * 2.5) * th * 0.05, r = th * 0.3, byy = by - b.sc * th * 1.05 * BLD + bob; ctx.beginPath(); ctx.arc(cc.x, byy, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fill(); ctx.strokeStyle = 'rgba(230,160,32,0.95)'; ctx.lineWidth = Math.max(1.2, th * 0.05); ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = (r * 1.3) + 'px sans-serif'; ctx.fillText('🥚', cc.x, byy + r * 0.05); ctx.textBaseline = 'alphabetic'; } }
      if (this._build && this._sel === idx && idx != null && !moving) {   // delete chip
        const ch = this._delChip(o);
        ctx.beginPath(); ctx.arc(ch.x, ch.y, ch.r, 0, Math.PI * 2); ctx.fillStyle = '#e8522a'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + (ch.r * 1.1) + 'px sans-serif'; ctx.fillText('✕', ch.x, ch.y + 0.5);
      }
    },
    // Owned EP-shop decorations (shared state with the top-down view). Auto-place
    // any without a cell, then render upright; pets wander a little.
    _decoCells() {
      const occ = {}, plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) occ[this._plotGX(i) + ',' + this._plotGY(i)] = 1;
      (Farm.state.data.map || []).forEach((o) => { const b = BUILDINGS[o.type]; if (!b) return; for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) occ[(o.gx + x) + ',' + (o.gy + y)] = 1; });
      const t = Farm.state.data.mapTerrain || {}; Object.keys(t).forEach((k) => { if (t[k] === 'water') occ[k] = 1; });
      return occ;
    },
    _decoPlacements() {
      const decos = (Farm.state.data && Farm.state.data.decorations) || [];
      if (!decos.length || !Farm.epShop || !Farm.epShop.items || !Farm.epShop.items.length) return [];
      const hp = (d) => Number.isInteger(d.gx) && Number.isInteger(d.gy) && d.gx >= 0 && d.gy >= 0 && d.gx < COLS && d.gy < ROWS;
      if (decos.some((d) => !hp(d))) {
        const occ = this._decoCells(), taken = {};
        decos.forEach((d) => { if (hp(d) && !occ[d.gx + ',' + d.gy]) taken[d.gx + ',' + d.gy] = 1; });
        // Prefer the front-center "yard": rows front→back, columns center→out, so
        // pets/decorations land in the open middle, not the awkward island corners.
        const colOrder = []; const c0 = Math.floor(COLS / 2);
        for (let dd = 0; colOrder.length < COLS; dd++) { if (c0 - dd >= 0) colOrder.push(c0 - dd); if (dd > 0 && c0 + dd < COLS) colOrder.push(c0 + dd); }
        const free = []; for (let gy = ROWS - 1; gy >= 0; gy--) for (const gx of colOrder) { const k = gx + ',' + gy; if (!occ[k] && !taken[k]) free.push(k); }
        let fi = 0, ch = false;
        decos.forEach((d) => { const it = this._shopItem(d.itemId); if (!it || !it.decoration_emoji) return; if (hp(d) && !occ[d.gx + ',' + d.gy]) return; while (fi < free.length && taken[free[fi]]) fi++; if (fi < free.length) { const k = free[fi++].split(','); d.gx = +k[0]; d.gy = +k[1]; taken[k[0] + ',' + k[1]] = 1; ch = true; } });
        if (ch) Farm.state.save();
      }
      const out = [], petsOn = !!(Farm.state.data && Farm.state.data.petsEnabled);   // walking pets default OFF
      decos.forEach((d, i) => { if (!hp(d)) return; const it = this._shopItem(d.itemId); if (!it || !it.decoration_emoji) return; const isPet = it.category === 'pet'; if (isPet && !petsOn) return; out.push({ emoji: it.decoration_emoji, itemId: d.itemId, gx: d.gx, gy: d.gy, pet: isPet, seed: i }); });
      return out;
    },
    _drawDeco(d, moving) {
      const ctx = this._ctx, tw = this._tw(), th = this._th(), c = this._cell(d.gx, d.gy);
      if (moving) { this._diamond(c.x, c.y, tw, th); ctx.fillStyle = this._moving && this._moving.valid ? 'rgba(76,175,80,0.34)' : 'rgba(220,60,60,0.36)'; ctx.fill(); }
      // painted iso animal sprite for pets — a clean base-less animal that sits on
      // the cell with a gentle idle bob + slight drift (a living pet, not a sliding card).
      const anim = d.itemId && ANIMALS[d.itemId];
      if (anim) {
        const im = this._lazyImg(anim);
        if (im) {
          let cx = c.x, lift = 0;
          if (!moving) { const t = Date.now() / 1000; cx += Math.sin(t * 0.6 + d.seed) * tw * 0.06; lift = Math.abs(Math.sin(t * 1.3 + d.seed)) * th * 0.12; }
          ctx.globalAlpha = moving ? 0.85 : 1;
          this._blit(im, cx, c.y + th * 0.5 - lift, tw * 0.9, th * 2.4);
          ctx.globalAlpha = 1; return;
        }
      }
      // non-animal decorations (static objects) + emoji fallback
      let cx = c.x, by = c.y + th * 0.25;
      if (d.pet && !moving) { const t = Date.now() / 1000; cx += Math.sin(t * 0.6 + d.seed) * tw * 0.06; by -= Math.abs(Math.sin(t * 1.3 + d.seed)) * th * 0.12; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = moving ? 0.85 : 1; ctx.font = (th * 1.4) + 'px sans-serif';
      ctx.fillText(d.emoji, cx, by); ctx.globalAlpha = 1;
    },
    // A pet may stand on grass/path — not on water, buildings, plots.
    _walkablePet(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return false;
      return !this._decoCells()[gx + ',' + gy];   // _decoCells = plots + buildings + water
    },
    // Advance one pet's wander (toward a random walkable spot near its home),
    // dt seconds. Returns live {fx,fy,face}. Frozen while in build mode.
    _updatePet(seed, hgx, hgy, dt) {
      let p = this._pets[seed];
      if (!p) p = this._pets[seed] = { fx: hgx, fy: hgy, tx: hgx, ty: hgy, pause: 0.4 + (seed % 5) * 0.25, face: 1, hx: hgx, hy: hgy };
      if (Math.abs(hgx - p.hx) > 0.5 || Math.abs(hgy - p.hy) > 0.5) { p.fx = p.tx = hgx; p.fy = p.ty = hgy; }  // home dragged → teleport
      p.hx = hgx; p.hy = hgy;
      if (dt <= 0 || this._build) return p;     // freeze while editing
      if (p.pause > 0) { p.pause -= dt; return p; }
      const dx = p.tx - p.fx, dy = p.ty - p.fy, dist = Math.hypot(dx, dy);
      if (dist < 0.06) {
        // arrived: if standing next to a crop, this pause is a nuzzle/peck.
        p.nuzzle = this._nearCrop(Math.round(p.fx), Math.round(p.fy));
        p.pause = (p.nuzzle ? 1.1 : 0.6) + Math.random() * 1.6;
        // ~45% of the time stroll over to a crop, else wander near home.
        let set = false;
        if (Math.random() < 0.45) { const cc = this._cropAdjacentWalkable(); if (cc.length) { const c = cc[(Math.random() * cc.length) | 0]; p.tx = c[0]; p.ty = c[1]; set = true; } }
        if (!set) for (let t = 0; t < 10; t++) {
          const ngx = Math.max(0, Math.min(COLS - 1, Math.round(hgx + (Math.random() * 5 - 2.5))));
          const ngy = Math.max(0, Math.min(ROWS - 1, Math.round(hgy + (Math.random() * 5 - 2.5))));
          if (this._walkablePet(ngx, ngy)) { p.tx = ngx; p.ty = ngy; break; }
        }
      } else {
        p.nuzzle = false;
        const step = Math.min(dist, 0.62 * dt);
        p.fx += dx / dist * step; p.fy += dy / dist * step;
        const sdir = dx - dy;                     // screen-x movement → face that way
        if (Math.abs(sdir) > 0.02) p.face = sdir > 0 ? 1 : -1;
      }
      return p;
    },
    // Is cell (gx,gy) next to (or on) a planted plot? → pet nuzzles there.
    _nearCrop(gx, gy) {
      const plots = Farm.state.data.plots || [];
      const N = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of N) { const idx = this._cellToPlot[(gx + dx) + ',' + (gy + dy)]; if (idx != null && plots[idx] && plots[idx].crop) return true; }
      return false;
    },
    // Walkable cells adjacent to a planted plot (so a pet can stroll over to nibble).
    _cropAdjacentWalkable() {
      const plots = Farm.state.data.plots || [], out = [], seen = {};
      for (let i = 0; i < plots.length; i++) {
        if (!plots[i] || !plots[i].crop) continue;
        const gx = this._plotGX(i), gy = this._plotGY(i);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = gx + dx, ny = gy + dy, k = nx + ',' + ny; if (!seen[k] && this._walkablePet(nx, ny)) { seen[k] = 1; out.push([nx, ny]); } }
      }
      return out;
    },
    // Pet under a screen tap (animals float between cells), or null.
    _petAt(sx, sy) {
      const th = this._th(), tw = this._tw(); let best = null, bd = tw * 0.6;
      for (const seed in this._pets) {
        const p = this._pets[seed], c = this._cell(p.fx, p.fy);
        const d = Math.hypot(sx - c.x, sy - (c.y - th * 0.45));
        if (d < bd) { bd = d; best = +seed; }
      }
      return best;
    },
    _pettedReact(seed, sx, sy) {
      const p = this._pets[seed]; if (!p) return;
      p.pause = Math.max(p.pause, 0.9); p.react = Date.now() + 750;   // pause + excited window
      const r = this._cv.getBoundingClientRect();
      if (Farm.ui && Farm.ui.floatText) Farm.ui.floatText('❤️', r.left + sx - 10, r.top + sy - 24, '#e8522a');
      if (Farm.audio) Farm.audio.play('tap');
      this.render();
    },
    _drawAnimal(d, fx, fy, face) {
      const ctx = this._ctx, tw = this._tw(), th = this._th(), c = this._cell(fx, fy), p = this._pets[d.seed];
      const im = this._lazyImg(ANIMALS[d.itemId]);
      if (!im) { ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = (th * 1.4) + 'px sans-serif'; ctx.fillText(d.emoji, c.x, c.y + th * 0.3); return; }
      const t = Date.now() / 1000, now = Date.now();
      const reacting = p && p.react && now < p.react;
      const nuzzling = p && p.pause > 0 && p.nuzzle && !reacting;
      const moving = p && p.pause <= 0;
      // Natural motion: a gentle SMOOTH bob + side-to-side waddle + slight body tilt
      // while walking (no more abs-sin "hopping"); soft breathing when idle.
      let lift = 0, sway = 0, tilt = 0;
      if (reacting) lift = Math.abs(Math.sin(t * 8)) * th * 0.16;                       // happy hop on tap (intentional)
      else if (nuzzling) lift = -Math.abs(Math.sin(t * 5 + d.seed)) * th * 0.04;        // dip to peck
      else if (moving) {
        const ph = t * 5.0 + d.seed;
        lift = (Math.sin(ph) * 0.5 + 0.5) * th * 0.045;   // small smooth body bob
        sway = Math.sin(ph * 0.5) * tw * 0.028;           // waddle left/right
        tilt = Math.sin(ph * 0.5) * 0.045;                // ~2.5° gait tilt
      } else lift = (Math.sin(t * 1.3 + d.seed) * 0.5 + 0.5) * th * 0.025;              // idle breathing
      const w = tw * 0.9, sc = Math.min(w / im.width, (th * 2.4) / im.height), dw = im.width * sc, dh = im.height * sc;
      const bx = c.x + sway, by = c.y + th * 0.5 - lift;
      this._shadow(c.x, c.y + th * 0.5, dw * 0.62, 0.15);   // static ground shadow (motion reads against it)
      ctx.save(); ctx.translate(bx, by); if (tilt) ctx.rotate(tilt * (face < 0 ? -1 : 1)); ctx.scale(face < 0 ? -1 : 1, 1);
      ctx.drawImage(im, -dw / 2, -dh, dw, dh); ctx.restore();
      // emote above the head: ❤️ when petted, ✨ while nuzzling a crop
      let emote = reacting ? '❤️' : (nuzzling && Math.sin(t * 3 + d.seed) > 0.6 ? '✨' : '');
      if (emote) { ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = (th * 0.7) + 'px sans-serif'; ctx.fillText(emote, bx, by - dh - th * 0.1); }
    },
    _cloud(x, y, w, alpha) {
      const ctx = this._ctx; ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#ffffff';
      const r = w * 0.22;
      [[0, 0, r], [w * 0.22, r * 0.2, r * 0.85], [-w * 0.22, r * 0.15, r * 0.8], [w * 0.08, -r * 0.35, r * 0.7]].forEach((b) => { ctx.beginPath(); ctx.ellipse(x + b[0], y + b[1], b[2], b[2] * 0.72, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.restore();
    },
    // Calm ambiance instead of a constant emoji "rain": slow drifting clouds always,
    // plus a FEW wandering butterflies (spring/summer) or gentle leaves/snow (autumn/
    // winter). Subtle and natural — adds life without being annoying.
    _drawParticles(tw) {
      const ctx = this._ctx, W = this._cssW(), H = this._cssH(), t = Date.now() / 1000, th = this._th();
      // drifting clouds (sky)
      for (let i = 0; i < 3; i++) { const cw = W * (0.26 + 0.07 * i), x = ((t * (5 + i * 3) + i * W * 0.55) % (W + cw * 1.4)) - cw * 0.7, y = H * (0.06 + 0.06 * i); this._cloud(x, y, cw, 0.5 - i * 0.1); }
      const season = (Farm.seasons && Farm.seasons.current) || monthSeason();
      if (season === 'autumn' || season === 'winter') {
        const glyph = season === 'winter' ? '❄️' : '🍂', n = season === 'winter' ? 9 : 6;
        ctx.save(); ctx.globalAlpha = 0.8; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < n; i++) { const sp = 9 + (i % 4) * 4, x = (i * 97.3) % W, sway = Math.sin(t * 0.5 + i) * 20, y = ((t * sp + i * 70) % (H + 40)) - 20; ctx.font = (th * 0.46) + 'px sans-serif'; ctx.fillText(glyph, x + sway, y); }
        ctx.restore();
      } else {
        // spring/summer: 3 butterflies fluttering on gentle wandering paths near the farm
        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < 3; i++) {
          const x = W * (0.22 + 0.27 * i) + Math.sin(t * 0.45 + i * 2) * W * 0.16 + Math.sin(t * 1.6 + i) * 16;
          const y = H * 0.5 + Math.cos(t * 0.62 + i * 2) * H * 0.14 + Math.sin(t * 3.0 + i) * 7;
          const flutter = 0.78 + Math.abs(Math.sin(t * 6 + i)) * 0.32;
          ctx.globalAlpha = 0.92; ctx.font = (th * 0.5 * flutter) + 'px sans-serif'; ctx.fillText('🦋', x, y);
        }
        ctx.restore();
      }
    },
    _drawFestival() {
      const id = Farm.events && Farm.events.getActiveFestivalId && Farm.events.getActiveFestivalId(); if (!id) return;
      const ctx = this._ctx, W = this._cssW(), t = Date.now() / 1000;
      if (id === 'spring_festival') {
        const n = Math.max(3, Math.floor(W / 64)); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '26px sans-serif';
        for (let i = 0; i < n; i++) ctx.fillText('🏮', (i + 0.5) * (W / n), 1 + Math.sin(t * 1.2 + i) * 4);
      } else if (id === 'mid_autumn') {
        const x = W - 48, y = 48; ctx.save(); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(x, y, 45, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,245,200,0.55)'; ctx.fill(); ctx.restore();
        ctx.font = '50px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🌕', x, y);
      }
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.isoView = iso;
})();
