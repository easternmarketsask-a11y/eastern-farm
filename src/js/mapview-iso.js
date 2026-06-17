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
  const COLS = 28, ROWS = 20;
  // Playable farm area made substantially larger and chunkier for satisfying operation.
  // Each plot must feel meaty on phone (target ~70-80px diamonds) so tapping, harvesting,
  // dragging in build is comfortable. Vast open space preserved via large COLS/ROWS,
  // but framing now prioritizes the working plot area at good scale (Hay Day balance).
  const PLOT_OX = 4, PLOT_OY = 2, PLOT_COLS = 12;
  const TW = 112, TH = 56;          // larger base tiles for chunky, readable, tappable plots
  const ZMIN = 0.65, ZMAX = 1.8;
  const REQUIRED_LV = { 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 4, 10: 5, 11: 5 };
  const GRASS_A = '#a3d977', GRASS_B = '#7cb342', GRASS_C = '#5a9c2e'; // brighter, more inviting Hay Day green
  const SOIL_TOP = '#c9a06e', SOIL_FURROW = '#8b5a3c', SOIL_HIGHLIGHT = '#e8d4a8'; // warm, rich, not dark/black tilled soil
  const GRASS_EDGE = 'rgba(60,90,40,0.18)';
  const ASSET_DIR = 'assets/images/map/';
  const ASSET_SRC = {
    barn: 'p_barn.png', house: 'p_house.png', greenhouse: 'p_greenhouse.png', coop: 'p_coop.png', well: 'p_well.png', stall: 'p_stall.png', tree: 'p_tree.png',
    deco_bush: 'deco_bush.png', deco_lantern: 'deco_lantern.png', deco_fence: 'deco_fence.png', deco_wheel: 'deco_wheel.png', deco_bridge: 'deco_bridge.png',
    // 3D VOLUME UPGRADE: New refined p_hayday_* ground tiles with proper painted cube projection (top + sides + skirt) generated from p_grass/p_barn refs for authentic Hay Day 3D pop when drawn with cy offset. 
    p_hayday_grass: 'p_hayday_grass.png',
    p_hayday_grass_b: 'p_hayday_grass_b.png',
    p_hayday_soil: 'p_hayday_soil.png',
    p_hayday_path: 'p_hayday_path.png',
    p_hayday_water: 'p_hayday_water.png',
    plot_bed: 'plot_bed.png',
  };
  // Painted iso ground cube tiles. `cy` = fraction of the image height where the
  // diamond-top CENTER sits (so it lands on the cell center; tuned by screenshot).
  // Fresh high-quality assets generated with Grok + p_barn/p_grass references for authentic Hay Day painted cube look (3D depth, top diamond + sides, lighting). 
  const ISO_TILES = {
    grass: { img: 'p_hayday_grass', cy: 0.38 }, soil: { img: 'p_hayday_soil', cy: 0.36 },
    path: { img: 'p_hayday_path', cy: 0.30 }, water: { img: 'p_hayday_water', cy: 0.36 },
  };
  // Grass variety (Hay Day ground feel)
  const GRASS_VARIANTS = [
    { img: 'p_hayday_grass', cy: 0.38 },
    { img: 'p_hayday_grass_b', cy: 0.39 },
  ];
  function grassVariant(gx, gy) {
    const h = ((gx * 73856093) ^ (gy * 19349663)) & 0xffff, r = h % 100;
    return r < 18 ? GRASS_VARIANTS[1] : GRASS_VARIANTS[0];
  }

  // Stable seeded "random" for ground textures. Math.random() every frame
  // caused the grass to sparkle/flicker (very glaring). Using gx,gy,salt
  // makes every blade/dot position fixed per cell → calm, tile-like, no strobe.
  function seeded(gx, gy, salt) {
    gx = gx | 0; gy = gy | 0; salt = salt | 0;
    let h = (gx * 374761393) ^ (gy * 668265263) ^ (salt * 2147483647);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // High-quality pure plant 4-stage sprites (fresh Grok generation with p_barn/p_grass references for consistent Hay Day painted style across ground and objects, no soil baked in at all). Ground p_hayday tiles provide the base.
  const ISO_CROPS = {
    eggplant: 'crop_eggplant', cilantro: 'crop_cilantro', jiucai: 'crop_jiucai',
    niu_jiao_jiao: 'crop_niu_jiao_jiao', suan_tai: 'crop_suan_tai', tomato: 'crop_tomato', cucumber: 'crop_cucumber',
    shanghai_miao: 'crop_shanghai_miao',
  };
  const BUILDINGS = {
    barn: { img: 'barn', w: 2, h: 2, sc: 2.4, zh: '谷仓·仓库', en: 'Barn', tap: 'warehouse' },
    house: { img: 'house', w: 2, h: 2, sc: 2.6, zh: '小屋·种子店', en: 'Cottage', tap: 'shop' },
    greenhouse: { img: 'greenhouse', w: 2, h: 2, sc: 2.4, zh: '温室', en: 'Greenhouse' },
    coop: { img: 'coop', w: 2, h: 2, sc: 2.3, zh: '鸡舍', en: 'Coop' },
    stall: { img: 'stall', w: 2, h: 2, sc: 2.8, zh: '超市摊位', en: 'Stall' },
    well: { img: 'well', w: 1, h: 1, sc: 2.4, zh: '水井', en: 'Well' },
    tree: { img: 'tree', w: 1, h: 1, sc: 2.2, zh: '树', en: 'Tree' },
    bush: { img: 'deco_bush', w: 1, h: 1, sc: 1.7, zh: '花丛', en: 'Flowers' },
    lantern: { img: 'deco_lantern', w: 1, h: 1, sc: 2.6, zh: '灯笼', en: 'Lantern' },
    fence: { img: 'deco_fence', w: 1, h: 1, sc: 1.9, zh: '篱笆', en: 'Fence' },
    wheel: { img: 'deco_wheel', w: 2, h: 2, sc: 2.2, zh: '水车', en: 'Water Wheel' },
    bridge: { img: 'deco_bridge', w: 2, h: 1, sc: 1.6, zh: '小桥', en: 'Bridge' },
  };
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
    _tw() { return TW * this._zoom; },
    _th() { return TH * this._zoom; },
    _lang() { return (Farm.state && Farm.state.data && Farm.state.data.language === 'en') ? 'en' : 'zh'; },

    init() {
      if (!this.active() || this._on) return;
      this._on = true;
      document.body.classList.add('mapmode');
      const farmEl = document.getElementById('farm');
      if (farmEl) { farmEl.style.padding = '0'; farmEl.style.overflow = 'hidden'; }
      ['farmGrid', 'farmDecorations'].forEach((idd) => { const e = document.getElementById(idd); if (e) e.style.display = 'none'; });
      const sc = document.querySelector('.farm-scene'); if (sc) sc.style.display = 'none';

      if (!Array.isArray(Farm.state.data.map)) {   // share the default layout with the top-down view
        Farm.state.data.map = [{ type: 'barn', gx: 5, gy: 1 }, { type: 'house', gx: 6, gy: 4 }];
        Farm.state.save();
      }

      const cv = document.createElement('canvas');
      cv.id = 'isoCanvas';
      cv.style.cssText = 'position:fixed;z-index:5;touch-action:none;display:block;background:#9fd0ff;';
      document.body.appendChild(cv);
      this._cv = cv; this._ctx = cv.getContext('2d');
      // Sky color as default background (we draw full layered sky + land every frame).
      cv.style.background = '#9fd0ff';

      Object.keys(ASSET_SRC).forEach((k) => { const im = new Image(); im.onload = () => { this._img[k] = im; if (this._on) this.render(); }; im.src = ASSET_DIR + ASSET_SRC[k]; });
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

    _buildLayout() {
      this._cellToPlot = {};
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) this._cellToPlot[(PLOT_OX + (i % PLOT_COLS)) + ',' + (PLOT_OY + Math.floor(i / PLOT_COLS))] = i;
    },

    _farmRect() {
      const f = document.getElementById('farm');
      if (f) { const r = f.getBoundingClientRect(); if (r.width > 10 && r.height > 10) return r; }
      const t = document.getElementById('topbar');
      const th = t ? t.getBoundingClientRect().height : 56;

      // In build mode (especially on phones) give as much vertical space as possible
      // for dragging buildings/decorations around. Hide the game bottombar and use
      // only a tiny bottom margin so the finger has room to move objects without
      // fighting UI chrome.
      if (this._build) {
        return { left: 0, top: th, width: window.innerWidth, height: Math.max(200, window.innerHeight - th - 28) };
      }

      const b = document.getElementById('bottombar');
      const bh = b ? b.getBoundingClientRect().height : 64;
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
    // Frame the PLOTS for the big Hay Day-scale farm (20x15 world, 8-col plots). Autoframe prioritizes showing generous open space around the action area so it feels like a living, expandable farm rather than a tight grid. Extra headroom for the new 3D ground tiles' visual volume.
    _autoFrame() {
      const plots = Farm.state.data.plots || [];
      const n = Math.max(1, plots.length);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (let i = 0; i < n; i++) {
        const gx = PLOT_OX + (i % PLOT_COLS), gy = PLOT_OY + Math.floor(i / PLOT_COLS);
        if (gx < minx) minx = gx; if (gy < miny) miny = gy; if (gx > maxx) maxx = gx; if (gy > maxy) maxy = gy;
      }
      const span = (maxx - minx) + (maxy - miny);

      // Highest standard framing for operation: make the actual plot block feel substantial
      // and comfortable to work with (Hay Day standard). Target ~70-80px diamonds on phone.
      // Generous but not excessive open space around the working area.
      const screenW = span * TW / 2;
      const screenH = span * TH / 2 + TH * 2.2;   // reduced headroom — plots are the hero, not drowned in empty
      const fitW = this._cssW() / (screenW * 0.95);
      const fitH = this._cssH() / (screenH * 0.90);
      // Bias toward larger plots for great tap/drag UX, while still revealing nice peripheral grass.
      this._zoom = Math.max(ZMIN, Math.min(fitW, fitH, 0.82));

      const ccx = (minx + maxx) / 2, ccy = (miny + maxy) / 2, u = ccx - ccy, v = ccx + ccy;
      this._camX = u * this._tw() / 2;
      // Center the plot area nicely with a bit of breathing room at top for sky/hills.
      this._camY = this._oy + v * this._th() / 2 - this._cssH() / 2 - this._th() * 0.35;
      this._clampCam();
    },

    // ---- iso transforms ----
    _cell(gx, gy) {
      const tw = this._tw(), th = this._th();
      return { x: this._ox + (gx - gy) * tw / 2 - this._camX, y: this._oy + (gx + gy) * th / 2 - this._camY };
    },
    _screenToCell(sx, sy) {
      const tw = this._tw(), th = this._th();
      const dx = sx + this._camX - this._ox, dy = sy + this._camY - this._oy;
      const fu = dx / (tw / 2), fv = dy / (th / 2);
      return { gx: Math.floor((fv + fu) / 2), gy: Math.floor((fv - fu) / 2) };
    },
    _clampCam() {
      // keep the map roughly on screen: bound camX/camY by the cell extent
      const tw = this._tw(), th = this._th();
      const minU = (0 - (ROWS - 1)), maxU = ((COLS - 1) - 0);
      this._camX = Math.max(minU * tw / 2 - this._cssW() * 0.4, Math.min(maxU * tw / 2 + this._cssW() * 0.4, this._camX));
      const maxV = (COLS - 1) + (ROWS - 1);
      this._camY = Math.max(-this._cssH() * 0.3, Math.min(this._oy + maxV * th / 2 - this._cssH() * 0.5, this._camY));
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
        if (this._sel >= 0) { const ch = this._delChip((Farm.state.data.map)[this._sel]); if (Math.hypot(p.x - ch.x, p.y - ch.y) <= ch.r) { Farm.state.data.map.splice(this._sel, 1); this._sel = -1; Farm.state.save(); this.render(); return; } }
        const c = this._screenToCell(p.x, p.y);
        const bidx = this._buildingAt(c.gx, c.gy);
        if (bidx >= 0) { const o = Farm.state.data.map[bidx]; this._sel = bidx; this._moving = { kind: 'building', idx: bidx, gx: o.gx, gy: o.gy, valid: true, sx: p.x, sy: p.y, moved: false }; this._layoutUI(); this.render(); return; }
        const didx = this._decoAt(c.gx, c.gy);
        if (didx >= 0) { const d = Farm.state.data.decorations[didx]; this._sel = -1; this._moving = { kind: 'deco', idx: didx, gx: d.gx, gy: d.gy, valid: true, sx: p.x, sy: p.y, moved: false }; this._layoutUI(); this.render(); return; }
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
        // Auto-pan the camera when finger approaches screen edge.
        // This gives "infinite" workspace on a tiny phone screen so you can
        // drag buildings far without running out of room or hitting UI.
        const EDGE = 48;
        const pan = 9;
        let panned = false;
        if (p.x < EDGE) { this._camX -= pan; panned = true; }
        if (p.x > this._cssW() - EDGE) { this._camX += pan; panned = true; }
        if (p.y < EDGE) { this._camY -= pan; panned = true; }
        if (p.y > this._cssH() - EDGE) { this._camY += pan; panned = true; }
        if (panned) this._clampCam();

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
        this._layoutUI();   // restore full palette after drop
        this.render(); this._drag = null; return;
      }
      const wasTap = this._drag && !this._drag.moved && !this._pinch; this._drag = null;
      if (!wasTap || !p) return;
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
      if (bidx >= 0) { const o = Farm.state.data.map[bidx], b = BUILDINGS[o.type]; if (b.tap === 'warehouse' && Farm.warehouse && Farm.warehouse.open) Farm.warehouse.open(); else if (b.tap === 'shop' && Farm.shop && Farm.shop.open) Farm.shop.open(); else if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? b.en : b.zh); return; }
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
      for (let i = 0; i < plots.length; i++) list.push({ i, gx: PLOT_OX + (i % PLOT_COLS), gy: PLOT_OY + Math.floor(i / PLOT_COLS) });
      list.sort((a, b) => (b.gx + b.gy) - (a.gx + a.gy));   // frontmost first
      for (const o of list) {
        const c = this._cell(o.gx, o.gy), pl = plots[o.i];
        const planted = pl && pl.unlocked && pl.crop;
        // More generous hit area now that plots/crops are chunkier — much better mobile tap UX.
        const halfW = tw * (planted ? 0.62 : 0.72);
        const bot = c.y + th * 0.85;
        const top = planted ? c.y - th * 3.1 : c.y - th * 0.75;
        if (px >= c.x - halfW && px <= c.x + halfW && py >= top && py <= bot) return o;
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
      for (let i = 0; i < plots.length; i++) s[(PLOT_OX + (i % PLOT_COLS)) + ',' + (PLOT_OY + Math.floor(i / PLOT_COLS))] = 1;
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
    _footprintFree(gx, gy, type, exceptIdx) {
      const b = BUILDINGS[type];
      if (gx < 0 || gy < 0 || gx + b.w > COLS || gy + b.h > ROWS) return false;
      const plotCells = this._plotCellSet(), occ = {}, map = (Farm.state.data.map) || [], t = this._terrain();
      for (let i = 0; i < map.length; i++) { if (i === exceptIdx) continue; const o = map[i], ob = BUILDINGS[o.type]; if (!ob) continue; for (let y = 0; y < ob.h; y++) for (let x = 0; x < ob.w; x++) occ[(o.gx + x) + ',' + (o.gy + y)] = 1; }
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const k = (gx + x) + ',' + (gy + y); if (plotCells[k] || occ[k] || t[k] === 'water') return false; }
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
        if (im && im.width) { const s = Math.min(b.w * tw * 1.06 / im.width, b.sc * th * 2.6 / im.height); w = im.width * s; h = im.height * s; }
        else { w = b.w * tw * 1.06; h = b.sc * th * 2.0; }
        if (px >= cc.x - w / 2 && px <= cc.x + w / 2 && py >= by - h && py <= by) return i;
      }
      return -1;
    },
    _decoAt(gx, gy) { const d = (Farm.state.data.decorations) || []; for (let i = 0; i < d.length; i++) if (d[i].gx === gx && d[i].gy === gy) return i; return -1; },
    _decoCellFree(gx, gy, exceptIdx) {
      if (!this._inBounds(gx, gy)) return false;
      if (this._plotCellSet()[gx + ',' + gy] || this._terrain()[gx + ',' + gy] === 'water' || this._buildingAt(gx, gy) >= 0) return false;
      const d = (Farm.state.data.decorations) || []; for (let i = 0; i < d.length; i++) if (i !== exceptIdx && d[i].gx === gx && d[i].gy === gy) return false;
      return true;
    },
    _delChip(o) { const b = BUILDINGS[o.type], c = this._cell(o.gx + b.w - 1, o.gy), th = this._th(); return { x: c.x + this._tw() / 2 * 0.5, y: c.y - th * 0.2, r: Math.max(12, th * 0.5) }; },
    _addBuilding(type) {
      const b = BUILDINGS[type], ctr = this._screenToCell(this._cssW() / 2, this._cssH() / 2);
      const tries = [[ctr.gx - (b.w >> 1), ctr.gy - (b.h >> 1)]];
      for (let gy = 0; gy + b.h <= ROWS; gy++) for (let gx = 0; gx + b.w <= COLS; gx++) tries.push([gx, gy]);
      for (const [gx, gy] of tries) if (this._footprintFree(gx, gy, type, -1)) {
        (Farm.state.data.map = Farm.state.data.map || []).push({ type, gx, gy }); this._sel = Farm.state.data.map.length - 1;
        Farm.state.save(); this.render();
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? ('Placed ' + b.en + ' — drag to move') : ('已放置' + b.zh + '，拖动可移动'));
        return;
      }
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? 'No room' : '没有空位了');
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
      // Compact on mobile so dragging has breathing room. Still usable.
      tray.style.cssText = 'position:fixed;left:0;right:0;z-index:20;display:none;flex-direction:column;gap:4px;padding:5px 6px;background:rgba(255,255,255,.96);box-shadow:0 -3px 12px rgba(0,0,0,.12);';
      const tabs = document.createElement('div'); tabs.style.cssText = 'display:flex;gap:6px;justify-content:center;';
      [['build', en ? '🏠 Build' : '🏠 建筑'], ['terrain', en ? '🖌 Terrain' : '🖌 地形']].forEach(([m, label]) => { const t = document.createElement('button'); t.dataset.mode = m; t.textContent = label; t.style.cssText = 'border:none;border-radius:13px;padding:6px 16px;cursor:pointer;font:600 13px/1 "Fredoka",system-ui,sans-serif;'; t.onclick = () => this.setEditMode(m); tabs.appendChild(t); });
      this._modeTabs = tabs; tray.appendChild(tabs);
      const rowCss = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:flex-end;';
      const pb = document.createElement('div'); pb.style.cssText = rowCss;
      PALETTE.forEach((type) => { const b = BUILDINGS[type]; const item = document.createElement('button'); item.style.cssText = 'border:1px solid #e0e0e0;border-radius:12px;background:#fff;padding:5px 6px 4px;min-width:58px;cursor:pointer;font:500 11px/1.2 "Fredoka",system-ui,sans-serif;color:#444;'; item.innerHTML = '<div style="font-size:10px;color:#888;margin-top:2px">＋ ' + (en ? b.en : b.zh) + '</div>'; const ic = document.createElement('div'); ic.style.cssText = 'width:36px;height:30px;margin:0 auto;background-size:contain;background-repeat:no-repeat;background-position:center;'; ic.style.backgroundImage = "url('" + ASSET_DIR + ASSET_SRC[b.img] + "')"; item.insertBefore(ic, item.firstChild); item.onclick = () => this._addBuilding(type); pb.appendChild(item); });
      this._palBuild = pb; tray.appendChild(pb);
      const pt = document.createElement('div'); pt.style.cssText = rowCss;
      BRUSHES.forEach((br) => { const item = document.createElement('button'); item.dataset.brush = br.key; item.style.cssText = 'border:1px solid #e0e0e0;border-radius:12px;background:#fff;padding:5px 6px 4px;min-width:58px;cursor:pointer;font:500 11px/1.2 "Fredoka",system-ui,sans-serif;color:#444;'; item.innerHTML = '<div style="width:32px;height:24px;margin:0 auto;border-radius:6px;background:' + br.color + '"></div><div style="font-size:10px;color:#888;margin-top:2px">' + (en ? br.en : br.zh) + '</div>'; item.onclick = () => this.setBrush(br.key); pt.appendChild(item); });
      this._palTerrain = pt; tray.appendChild(pt);
      document.body.appendChild(tray); this._palette = tray;

      const hint = document.createElement('div'); hint.id = 'isoBuildHint';
      hint.style.cssText = 'position:fixed;left:0;right:0;z-index:19;text-align:center;display:none;pointer-events:none;font:500 13px/1.4 "Fredoka",system-ui,sans-serif;color:#fff;';
      hint.innerHTML = '<span style="background:rgba(0,0,0,.45);padding:6px 14px;border-radius:16px"></span>';
      document.body.appendChild(hint); this._hint = hint;
      this._refreshModeUI(); this._layoutUI();
    },
    _layoutUI() {
      const r = this._farmRect(), fromBottom = Math.max(0, window.innerHeight - (r.top + r.height)), en = this._lang() === 'en';
      const isMoving = !!this._moving;

      if (this._palette) {
        if (!this._build) {
          this._palette.style.display = 'none';
        } else if (isMoving) {
          // While actively dragging an object, collapse the palette to give
          // maximum finger room on small phone screens.
          this._palette.style.display = 'flex';
          this._palette.style.bottom = fromBottom + 'px';
          this._palette.style.opacity = '0.15';   // almost invisible but still there if needed
          this._palette.style.pointerEvents = 'none';
        } else {
          this._palette.style.display = 'flex';
          this._palette.style.left = r.left + 'px';
          this._palette.style.right = Math.max(0, window.innerWidth - (r.left + r.width)) + 'px';
          this._palette.style.bottom = fromBottom + 'px';
          this._palette.style.opacity = '1';
          this._palette.style.pointerEvents = 'auto';
        }
      }

      if (this._buildBtn) {
        const ph = (this._build && this._palette && !isMoving) ? (this._palette.getBoundingClientRect().height || 74) : 0;
        this._buildBtn.style.right = (Math.max(0, window.innerWidth - (r.left + r.width)) + 14) + 'px';
        this._buildBtn.style.bottom = (fromBottom + (this._build ? ph + 10 : 14)) + 'px';
        this._buildBtn.textContent = this._build ? (en ? '✓ Done' : '✓ 完成') : (en ? '🔨 Build' : '🔨 建造');
        this._buildBtn.style.background = this._build ? '#FF9800' : '#4CAF50';
      }
      if (this._hint) { this._hint.style.display = this._build ? 'block' : 'none'; this._hint.style.left = r.left + 'px'; this._hint.style.right = Math.max(0, window.innerWidth - (r.left + r.width)) + 'px'; this._hint.style.top = (r.top + 8) + 'px'; }
    },
    _refreshModeUI() {
      const terr = this._editMode === 'terrain', en = this._lang() === 'en';
      if (this._palBuild) this._palBuild.style.display = terr ? 'none' : 'flex';
      if (this._palTerrain) this._palTerrain.style.display = terr ? 'flex' : 'none';
      if (this._modeTabs) Array.from(this._modeTabs.children).forEach((t) => { const on = t.dataset.mode === this._editMode; t.style.background = on ? '#FF9800' : '#eee'; t.style.color = on ? '#fff' : '#777'; });
      if (this._palTerrain) Array.from(this._palTerrain.children).forEach((it) => { it.style.outline = (it.dataset.brush === this._brush) ? '3px solid #FF9800' : 'none'; });
      if (this._hint) { const s = this._hint.querySelector('span'); if (s) s.textContent = terr ? (en ? 'Tap / drag to paint terrain' : '点按或拖动涂刷地形（草地=擦除）') : (en ? 'Drag buildings & decorations · tap ✕ to remove' : '拖动摆放建筑/装饰 · 点 ✕ 移除建筑'); }
      this._layoutUI();
    },
    setEditMode(m) { this._editMode = m; this._sel = -1; this._moving = null; this._refreshModeUI(); this.render(); },
    setBrush(b) { this._brush = b; this._refreshModeUI(); },
    toggleBuild() {
      this._build = !this._build;
      if (this._build && Farm.state.data && !Farm.state.data.mapBuildSeen) { Farm.state.data.mapBuildSeen = true; Farm.state.save(); if (this._buildPulse) { this._buildPulse.cancel(); this._buildPulse = null; } }
      if (!this._build) { this._sel = -1; this._moving = null; this._painting = false; this._editMode = 'build'; Farm.state.save(); }

      // Give the user maximum screen real-estate for dragging on phones.
      // Hide the normal bottom navigation bar while building.
      const bb = document.getElementById('bottombar');
      if (bb) bb.style.display = this._build ? 'none' : '';

      // When leaving build, make sure size recalcs to normal bars.
      if (!this._build) {
        this._resize();
      } else {
        // Enter build → immediately give more space
        this._resize();
      }

      this._refreshModeUI(); this._layoutUI(); this.render();
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
    // Clean procedural tilled-soil bed (replaces the muddy p_soil cube tile, which
    // tiled with dark seams). A flat inset diamond + furrows + a soft raised rim →
    // neat, distinct Hay-Day plots that tessellate seamlessly.
    // Empty-plot soil bed: a painted soil cube EXTRACTED from a crop sprite, so it
    // matches the crops' own baked soil exactly → every plot (empty or planted) is a
    // consistent raised tilled bed. Bottom-anchored like the crops so heights line up.
    _tilledDiamond(cx, cy) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      // Always draw a rich, attractive Hay Day-style tilled bed – never black or flat ugly.
      // Base warm soil
      this._diamond(cx, cy, tw, th);
      ctx.fillStyle = '#c9a06e'; // warm inviting brown
      ctx.fill();

      // Furrows for tilled look (horizontal lines, slightly darker)
      ctx.fillStyle = 'rgba(139, 90, 60, 0.55)';
      for (let i = -3; i <= 3; i++) {
        const y = cy + i * th * 0.14;
        ctx.fillRect(cx - tw * 0.38, y - 1, tw * 0.76, 2);
      }

      // Lighter top rim / highlight for 3D pop and to avoid "black" flat look
      ctx.fillStyle = 'rgba(232, 212, 168, 0.45)';
      ctx.fillRect(cx - tw * 0.38, cy - th * 0.42, tw * 0.76, th * 0.12);

      // Small texture dots for soil realism (not solid)
      ctx.fillStyle = 'rgba(100, 60, 30, 0.35)';
      for (let i = 0; i < 18; i++) {
        const rx = cx - tw * 0.35 + seeded(cx / tw | 0, cy / th | 0, i + 800) * tw * 0.7;
        const ry = cy - th * 0.35 + seeded(cx / tw | 0, cy / th | 0, i + 900) * th * 0.7;
        ctx.fillRect(rx, ry, 1.8, 1.8);
      }

      // If the plot_bed image loads, layer it on top for extra 3D painted detail (non-destructive)
      const im = this._img.plot_bed;
      if (im && im.width) {
        const w = tw * 1.04, s = w / im.width, hh = im.height * s;
        ctx.drawImage(im, cx - w / 2, cy + th * 0.55 - hh, w, hh);
      }
    },
    // Draw a painted cube ground tile (p_hayday_* for premium Hay Day 3D volume) + always-bright base + top texture.
    // Clipped image draw + diamond fill guarantees ZERO black boards/gaps between plots — continuous painted land.
    // Textures layered on top give the final chunky pop and life. Fallbacks are rich so never ugly/black.
    _tileImg(key, c, gx, gy) {
      const t = (key === 'grass' && gx != null) ? grassVariant(gx, gy) : ISO_TILES[key];
      const im = t && this._img[t.img], tw = this._tw(), th = this._th();
      // Always draw bright base diamond first to kill black.
      // Slightly oversized (1.02x) so adjacent tiles overlap 1px and wipe any
      // sub-pixel seams or gaps — continuous solid land like Hay Day, never
      // stepped black boards.
      this._diamond(c.x, c.y, tw * 1.02, th * 1.02);
      let baseColor = GRASS_A;
      if (key === 'soil') baseColor = '#c9a06e';
      else if (key === 'path') baseColor = '#d4a574';
      else if (key === 'water') baseColor = '#5aa0c8';
      this._ctx.fillStyle = baseColor;
      this._ctx.fill();

      if (im && im.width) {
        const w = tw * 1.15;
        const sc = w / im.width;
        if (key === 'grass' || key === 'soil') {
          // FLAT TOP FACE ONLY for grass/soil.
          // Hay Day style: the land is a continuous painted carpet (bright,
          // unified, no dark skirts or "boards" between rows). We take only the
          // upper portion of the p_hayday cube image (the flat top diamond)
          // and stamp it on the solid base slab + texture. 3D volume comes from
          // crops, buildings, animals and subtle highlights. No more terraced black.
          const topFrac = 0.52;
          const srcH = im.height * topFrac;
          const dstH = im.height * sc * topFrac;
          const dx = c.x - w / 2;
          const dy = c.y - dstH * 0.55;  // tuned for chunkier tiles + flat ground
          this._ctx.save();
          this._diamond(c.x, c.y, tw, th);
          this._ctx.clip();
          this._ctx.drawImage(im, 0, 0, im.width, srcH, dx, dy, w, dstH);
          this._ctx.restore();
        } else {
          // path/water keep more of their volume if desired
          const dh = im.height * sc;
          this._ctx.save();
          this._diamond(c.x, c.y, tw, th);
          this._ctx.clip();
          this._ctx.drawImage(im, c.x - w / 2, c.y - dh * t.cy, w, dh);
          this._ctx.restore();
        }
      }

      // Re-apply rich texture ON TOP of the (clipped) painted image so grass
      // blades / soil furrows / path dots / water highlights read clearly.
      // Base bright color + clipped painted 3D image + top texture =
      // continuous vibrant land (no black boards/gaps), Hay Day chunky 3D pop.
      if (key === 'grass') {
        this._ctx.fillStyle = GRASS_B;
        // Gentle wind using slow time + seeded base (stable positions).
        // Very subtle so it feels alive without the old harsh flicker.
        const wind = Math.sin(Date.now() / 1400 + gx * 0.7) * 1.2;
        for (let i = 0; i < 18; i++) {
          const rx = c.x - tw * 0.45 + seeded(gx, gy, i) * tw * 0.9 + wind * (i % 3 - 1) * 0.3;
          const ry = c.y - th * 0.45 + seeded(gx, gy, i + 100) * th * 0.9;
          this._ctx.fillRect(rx, ry, 1.5, 2.8);
        }
        this._ctx.fillStyle = GRASS_C;
        for (let i = 0; i < 7; i++) {
          const rx = c.x - tw * 0.4 + seeded(gx, gy, i + 200) * tw * 0.8 + wind * (i % 2) * 0.4;
          const ry = c.y - th * 0.4 + seeded(gx, gy, i + 300) * th * 0.8;
          this._ctx.fillRect(rx, ry, 2, 3.5);
        }
      } else if (key === 'soil') {
        this._ctx.fillStyle = 'rgba(139,90,60,0.55)';
        for (let i = 0; i < 6; i++) {
          const y = c.y - th * 0.35 + i * th * 0.15;
          this._ctx.fillRect(c.x - tw * 0.4, y, tw * 0.8, 2.5);
        }
        this._ctx.fillStyle = 'rgba(100,60,30,0.4)';
        for (let i = 0; i < 12; i++) {
          const rx = c.x - tw * 0.38 + seeded(gx, gy, i + 400) * tw * 0.76;
          const ry = c.y - th * 0.38 + seeded(gx, gy, i + 500) * th * 0.76;
          this._ctx.fillRect(rx, ry, 2, 2);
        }
      } else if (key === 'path') {
        this._ctx.fillStyle = 'rgba(139,90,60,0.5)';
        for (let i = 0; i < 10; i++) {
          const rx = c.x - tw * 0.4 + seeded(gx, gy, i + 600) * tw * 0.8;
          const ry = c.y - th * 0.4 + seeded(gx, gy, i + 700) * th * 0.8;
          this._ctx.fillRect(rx, ry, 2.5, 2.5);
        }
      } else if (key === 'water') {
        this._ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (let i = 0; i < 5; i++) {
          const y = c.y - th * 0.25 + i * th * 0.2;
          this._ctx.fillRect(c.x - tw * 0.35, y, tw * 0.7, 2);
        }
      }
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
    render() {
      if (!this._on) return;
      const ctx = this._ctx, tw = this._tw(), th = this._th(), W = this._cssW(), H = this._cssH();
      const terrain = Farm.state.data.mapTerrain || {};
      ctx.clearRect(0, 0, W, H);

      // === BEAUTIFUL HAY DAY-STYLE BACKGROUND LAYERS ===
      // Sky gradient + distant soft hills. This is what makes the view feel alive
      // and "worth opening" instead of a flat green rectangle.
      const skyH = Math.min(H * 0.42, 260);
      const skyGrad = ctx.createLinearGradient(0, 0, 0, skyH);
      skyGrad.addColorStop(0, '#a1d4ff');
      skyGrad.addColorStop(0.45, '#c5e0f5');
      skyGrad.addColorStop(0.75, '#d4e8d0');
      skyGrad.addColorStop(1, '#a3d977');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, skyH);

      // Distant rolling hills (soft, behind everything)
      ctx.fillStyle = '#6ea83a';
      ctx.beginPath();
      ctx.moveTo(0, skyH - 8);
      ctx.quadraticCurveTo(W * 0.18, skyH - 52, W * 0.42, skyH - 18);
      ctx.quadraticCurveTo(W * 0.68, skyH - 58, W, skyH - 12);
      ctx.lineTo(W, skyH + 25);
      ctx.lineTo(0, skyH + 25);
      ctx.closePath();
      ctx.fill();

      // Farther softer hill layer for depth
      ctx.fillStyle = 'rgba(85, 125, 55, 0.55)';
      ctx.beginPath();
      ctx.moveTo(0, skyH + 2);
      ctx.quadraticCurveTo(W * 0.28, skyH + 28, W * 0.55, skyH + 8);
      ctx.quadraticCurveTo(W * 0.82, skyH + 35, W, skyH + 18);
      ctx.lineTo(W, skyH + 55);
      ctx.lineTo(0, skyH + 55);
      ctx.closePath();
      ctx.fill();

      // Base lush green fill for the close ground (kept for compatibility with existing slabs)
      ctx.fillStyle = '#a3d977';
      ctx.fillRect(0, skyH - 5, W, H - skyH + 5);

      // Solid land mass slab for the ENTIRE world grid.
      // This paints one continuous vibrant green field under everything so there
      // are ZERO black steps, trenches, voids or "boards" between iso rows — exactly
      // the continuous painted farm look in Hay Day. Tile images + texture add
      // the nice painted variation and detail on top of the solid slab.
      const c0 = this._cell(0, 0);
      const c1 = this._cell(COLS-1, 0);
      const c2 = this._cell(COLS-1, ROWS-1);
      const c3 = this._cell(0, ROWS-1);
      ctx.fillStyle = '#a3d977';
      ctx.beginPath();
      ctx.moveTo(c0.x, c0.y - th * 0.65);
      ctx.lineTo(c1.x + tw * 0.6, c1.y);
      ctx.lineTo(c2.x, c2.y + th * 0.6);
      ctx.lineTo(c3.x - tw * 0.6, c3.y);
      ctx.closePath();
      ctx.fill();

      // Very soft shadow under the whole farm land — makes it sit in the world
      // instead of floating on flat color (big part of "not monotonous").
      ctx.fillStyle = 'rgba(35, 65, 25, 0.16)';
      ctx.beginPath();
      ctx.moveTo(c0.x + 6, c0.y - th * 0.65 + 10);
      ctx.lineTo(c1.x + tw * 0.6 + 6, c1.y + 6);
      ctx.lineTo(c2.x + 4, c2.y + th * 0.6 + 8);
      ctx.lineTo(c3.x - tw * 0.6 + 2, c3.y + 6);
      ctx.closePath();
      ctx.fill();

      // Soil slab for the cultivated plot rectangle (makes the active farm field
      // a single solid tilled carpet like a real planted area in Hay Day, instead
      // of individual stepped tiles with gaps). Grass slab is under everything.
      const p0 = this._cell(PLOT_OX, PLOT_OY);
      const p1 = this._cell(PLOT_OX + PLOT_COLS - 1, PLOT_OY);
      // Estimate plot rows from current unlocked plots (fall back to ~8 rows for big field)
      const plotCount = (Farm.state.data.plots || []).length || 80;
      const plotRows = Math.max(6, Math.ceil(plotCount / PLOT_COLS));
      const p2 = this._cell(PLOT_OX + PLOT_COLS - 1, PLOT_OY + plotRows - 1);
      const p3 = this._cell(PLOT_OX, PLOT_OY + plotRows - 1);
      ctx.fillStyle = '#c9a06e';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y - th * 0.5);
      ctx.lineTo(p1.x + tw * 0.5, p1.y);
      ctx.lineTo(p2.x, p2.y + th * 0.5);
      ctx.lineTo(p3.x - tw * 0.5, p3.y);
      ctx.closePath();
      ctx.fill();

      // === AMBIENT BACKGROUND DETAILS (wild trees, bushes) ===
      // These live in the huge open peripheral space. Seeded positions = stable,
      // drawn at reduced scale + alpha so they feel "far away" and give the farm
      // a real sense of place instead of floating on a green void.
      // Uses existing assets, zero extra memory.
      const ambientProps = [
        {type: 'tree', count: 7, scale: 0.62, alpha: 0.42, yBias: -1},
        {type: 'bush', count: 6, scale: 0.78, alpha: 0.32, yBias: 0},
      ];
      ambientProps.forEach((prop) => {
        const key = (prop.type === 'bush') ? 'deco_bush' : prop.type;
        const im = this._img[key];
        if (!im) return;
        for (let i = 0; i < prop.count; i++) {
          // Seeded around the outer edges of the big world (not on the central farm)
          const seed = i + (prop.type === 'tree' ? 0 : 100);
          const gx = ((seed * 11) % (COLS - 2)) + 1;
          const gy = Math.min(ROWS-2, Math.max(1, Math.floor((seed * 7) % 5) + prop.yBias));
          // Bias some to top and sides for nice framing
          const cc = this._cell(gx, gy);
          const sc = prop.scale * (0.85 + (seed % 3) * 0.1);
          const w = tw * 1.6 * sc;
          const h = w * (im.height / im.width);
          ctx.save();
          ctx.globalAlpha = prop.alpha;
          ctx.drawImage(im, cc.x - w/2, cc.y - h * 0.7, w, h);
          ctx.restore();
        }
      });

      // painted iso cube tiles, back-to-front (front rows cover the row behind's
      // earth skirt → the Hay Day "farm island"). Plot cells use the soil tile.
      const plotCells = this._plotCellSet();
      for (let s = 0; s <= (COLS - 1) + (ROWS - 1); s++) {
        for (let gx = 0; gx < COLS; gx++) {
          const gy = s - gx; if (gy < 0 || gy >= ROWS) continue;
          const c = this._cell(gx, gy);
          if (c.x + tw < 0 || c.x - tw > W || c.y + th * 4 < 0 || c.y - th * 2 > H) continue;
          const k = gx + ',' + gy;
          let key = 'grass', emptyPlot = false;
          if (plotCells[k]) {
            const pl = Farm.state.data.plots[this._cellToPlot[k]];
            // For empty unlocked plots, use the soil tile directly for nice tilled farmland look (p_hayday_soil 3D cube or rich textured fallback - never black).
            // Planted plots use grass base + crop sprite on top.
            if (pl && pl.unlocked && !pl.crop) {
              key = 'soil';
            } else {
              key = 'grass';
            }
          }
          if (terrain[k] === 'water') key = 'water'; else if (terrain[k] === 'path') key = 'path';
          this._tileImg(key, c, gx, gy);
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
        const gx = PLOT_OX + (i % PLOT_COLS), gy = PLOT_OY + Math.floor(i / PLOT_COLS);
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

      this._drawParticles(tw); this._drawFestival();
    },
    _drawPlot(plot, gx, gy, idx) {
      const ctx = this._ctx, tw = this._tw(), th = this._th(), c = this._cell(gx, gy);
      if (!plot.unlocked) {   // ground drew grass; overlay a grey lock plate
        this._diamond(c.x, c.y, tw * 0.92, th * 0.92); ctx.fillStyle = 'rgba(70,78,66,0.62)'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = (th * 0.55) + 'px sans-serif'; ctx.fillText('🔒', c.x, c.y - th * 0.1);
        ctx.font = 'bold ' + (th * 0.42) + 'px "Fredoka",sans-serif'; ctx.fillText('Lv' + (REQUIRED_LV[idx] || 2), c.x, c.y + th * 0.38);
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
      if (mature) { const t = Date.now() / 1000, ph = Math.sin(t * 2 + gx + gy); ctx.beginPath(); ctx.arc(c.x, c.y - th * 0.1, tw * (0.34 + ph * 0.02), 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,214,79,' + (0.3 + ph * 0.08) + ')'; ctx.fill(); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const fr = p >= 1 ? 3 : p >= 0.6 ? 2 : p >= 0.25 ? 1 : 0;
      if (ISO_CROPS[plot.crop]) {   // pure plant. With chunkier tiles + flat painted ground, sit slightly lower so stems feel planted in the tilled top. Generous hit area above.
        const im = this._lazyImg(ISO_CROPS[plot.crop] + '_' + fr);
        if (!this._blit(im, c.x, c.y + th * 0.18, tw * 0.95, th * 2.05)) { const def = Farm.crops.get(plot.crop); ctx.font = (th * 1.1) + 'px sans-serif'; ctx.fillText((def && def.icon) || '🌿', c.x, by); }
      } else if (mature) {
        const im = this._cropSprite(plot.crop);
        if (!this._blit(im, c.x, by, tw * 0.72, th * 1.7)) { const def = Farm.crops.get(plot.crop); ctx.font = (th * 1.1) + 'px sans-serif'; ctx.fillText((def && def.icon) || '🥬', c.x, by); }
      } else { ctx.font = (th * (p >= 0.4 ? 0.9 : 0.7)) + 'px sans-serif'; ctx.fillText(p >= 0.4 ? '🌿' : '🌱', c.x, by); }
      if (!mature) {   // progress bar
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
      ctx.globalAlpha = moving ? 0.82 : 1;
      if (!this._blit(this._img[b.img], cc.x, by, b.w * tw * 1.06, b.sc * th * 2.6)) { ctx.fillStyle = '#c0392b'; ctx.fillRect(cc.x - tw * 0.4, by - th, tw * 0.8, th); }
      ctx.globalAlpha = 1;
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
      for (let i = 0; i < plots.length; i++) occ[(PLOT_OX + (i % PLOT_COLS)) + ',' + (PLOT_OY + Math.floor(i / PLOT_COLS))] = 1;
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
      const out = [];
      decos.forEach((d, i) => { if (!hp(d)) return; const it = this._shopItem(d.itemId); if (!it || !it.decoration_emoji) return; out.push({ emoji: it.decoration_emoji, itemId: d.itemId, gx: d.gx, gy: d.gy, pet: it.category === 'pet', seed: i }); });
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
        const gx = PLOT_OX + (i % PLOT_COLS), gy = PLOT_OY + Math.floor(i / PLOT_COLS);
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
      let lift;
      if (reacting) lift = Math.abs(Math.sin(t * 9)) * th * 0.22;            // excited hop
      else if (nuzzling) lift = -Math.abs(Math.sin(t * 6 + d.seed)) * th * 0.05;  // dip down to peck
      else if (moving) lift = Math.abs(Math.sin(t * 7 + d.seed)) * th * 0.12;     // walk bounce
      else lift = Math.abs(Math.sin(t * 1.4 + d.seed)) * th * 0.06;          // gentle idle
      const w = tw * 0.9, sc = Math.min(w / im.width, (th * 2.4) / im.height), dw = im.width * sc, dh = im.height * sc;
      const by = c.y + th * 0.5 - lift;
      if (face < 0) { ctx.save(); ctx.translate(c.x, 0); ctx.scale(-1, 1); ctx.drawImage(im, -dw / 2, by - dh, dw, dh); ctx.restore(); }
      else ctx.drawImage(im, c.x - dw / 2, by - dh, dw, dh);
      // emote above the head: ❤️ when petted, ✨ while nuzzling a crop
      let emote = reacting ? '❤️' : (nuzzling && Math.sin(t * 3 + d.seed) > 0.6 ? '✨' : '');
      if (emote) { ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = (th * 0.7) + 'px sans-serif'; ctx.fillText(emote, c.x, by - dh - th * 0.1); }
    },
    _drawParticles(tw) {
      const season = (Farm.seasons && Farm.seasons.current) || monthSeason(), set = SEASON_PARTICLES[season];
      if (!set) return;
      const ctx = this._ctx, W = this._cssW(), H = this._cssH(), t = Date.now() / 1000;

      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      // Layered particles for depth (Hay Day feel)
      // Far layer (sky bugs / high) — smaller, slower, fainter
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < 9; i++) {
        const sp = 9 + (i % 3) * 2;
        const x = ((i * 67.3) % (W * 1.1)) - 20;
        const sway = Math.sin(t * 0.4 + i) * 8;
        const y = ((t * sp + i * 27) % (H * 0.6)) + 10;
        ctx.font = (tw * 0.22 + (i % 2) * 1) + 'px sans-serif';
        ctx.fillText(set[i % set.length], x + sway, y);
      }

      // Near layer (ground level butterflies / petals) — larger, more noticeable
      ctx.globalAlpha = 0.75;
      for (let i = 0; i < 12; i++) {
        const sp = 14 + (i % 4) * 3;
        const x = (i * 41.2) % W;
        const sway = Math.sin(t * 1.1 + i * 1.3) * (10 + (i % 2) * 4);
        const y = ((t * sp + i * 19) % (H * 0.85)) + H * 0.12;
        ctx.font = (tw * 0.38 + (i % 3) * 2) + 'px sans-serif';
        ctx.fillText(set[(i + 2) % set.length], x + sway, y);
      }

      ctx.restore();
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
