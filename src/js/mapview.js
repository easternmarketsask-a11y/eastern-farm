/**
 * mapview.js — top-down tile-map farm view (Farm.mapView)
 *
 * Activated ONLY by ?map=1 so the live vertical farm is untouched.
 *
 * Phase 1 (done): Canvas2D tile world (pan + pinch/wheel zoom) that renders the
 *   EXISTING 12 plots and runs the EXISTING plant/harvest/care flow on tap, with
 *   real pixel-art tiles (soil/crop/barn/house).
 * Phase 2 (this): build mode — drag to place / move / remove buildings. Layout
 *   persists to Farm.state.data.map and rides the cloud save blob automatically.
 *
 * State is reused: plots come from Farm.state.data.plots; building layout lives
 * in Farm.state.data.map. The map is only a VIEW + a placement editor.
 */
(function () {
  const TILE = 60;            // base tile size (CSS px) at zoom = 1
  const GROUND_COLS = 9;
  const GROUND_ROWS = 11;
  const PLOT_OX = 1, PLOT_OY = 2, PLOT_COLS = 3;
  const ZMIN = 0.6, ZMAX = 1.8;
  // Mirror of farm.js plot-unlock levels (by plot index).
  const REQUIRED_LV = { 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 4, 10: 5, 11: 5 };

  // Grass tones sampled from the pixel-art reference (IMG_1656).
  const GRASS_A = '#849b55', GRASS_B = '#819853';   // near-identical: subtle variation, not a checkerboard
  const ASSET_DIR = 'assets/images/map/';
  const ASSET_SRC = {
    soil: 'soil.png',
    barn: 'barn.png',
    house: 'house.png',
    greenhouse: 'greenhouse.png',
    coop: 'coop.png',
    tree: 'tree.png',
    tgrass: 'terrain/grass.png',
    tpath: 'terrain/path.png',
    twater: 'terrain/water.png',
    crop0: 'crop_qingcai_0.png',
    crop1: 'crop_qingcai_1.png',
    crop2: 'crop_qingcai_2.png',
    crop3: 'crop_qingcai_3.png',
  };

  // Placeable building catalog. footprint w/h in cells; img = asset key; the
  // sprite may render taller than the footprint (anchored to its base row).
  // `tap` = action when tapped outside build mode (barn=仓库, house=种子店).
  const BUILDINGS = {
    barn: { img: 'barn', w: 2, h: 2, maxHCells: 2.2, zh: '谷仓·仓库', en: 'Barn', tap: 'warehouse' },
    house: { img: 'house', w: 2, h: 2, maxHCells: 2.7, zh: '小屋·种子店', en: 'Cottage', tap: 'shop' },
    greenhouse: { img: 'greenhouse', w: 2, h: 2, maxHCells: 2.0, zh: '温室', en: 'Greenhouse' },
    coop: { img: 'coop', w: 2, h: 2, maxHCells: 2.0, zh: '鸡舍', en: 'Coop' },
    tree: { img: 'tree', w: 1, h: 1, maxHCells: 1.9, zh: '树', en: 'Tree' },
  };
  const PALETTE = ['barn', 'house', 'greenhouse', 'coop', 'tree'];
  const DEFAULT_MAP = [
    { type: 'barn', gx: 5, gy: 1 },
    { type: 'house', gx: 6, gy: 4 },
  ];

  // Paintable terrain lives in Farm.state.data.mapTerrain = {"gx,gy": "path"|"water"}
  // (grass = absent). Seeded once with a dirt "lane" + a small pond, then editable
  // in build mode's 地形 brush. Water cells block building placement.
  function defaultTerrain() {
    const t = {};
    for (let gx = 0; gx < GROUND_COLS; gx++) t[gx + ',6'] = 'path';
    for (let gy = 8; gy <= 9; gy++) for (let gx = 7; gx <= 8; gx++) t[gx + ',' + gy] = 'water';
    return t;
  }
  // Season ambiance particles (mirror of seasons.js PARTICLES; the classic
  // overlay renders into #farm which is hidden in map mode, so we draw our own).
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

  // Terrain brushes for the 地形 sub-mode.
  const BRUSHES = [
    { key: 'path', zh: '小路', en: 'Path', tile: 'tpath' },
    { key: 'water', zh: '水塘', en: 'Water', tile: 'twater' },
    { key: 'grass', zh: '草地·擦除', en: 'Grass·Erase', tile: 'tgrass' },
  ];

  const mapView = {
    _on: false,
    _cv: null, _ctx: null, _dpr: 1,
    _camX: 0, _camY: 0, _zoom: 1,
    _cellToPlot: {},
    _tick: null,
    _img: {},               // key -> HTMLImageElement (ready ones only)
    _pointers: {},          // pointerId -> {x,y} (canvas-local)
    _drag: null,            // single-pointer pan/tap state
    _pinch: null,           // {dist, zoom} when 2 pointers down
    _build: false,          // build (edit) mode on?
    _editMode: 'build',     // 'build' (place/move buildings) | 'terrain' (paint)
    _brush: 'path',         // active terrain brush in 地形 mode
    _painting: false,       // mid drag-paint
    _sel: -1,               // selected building index in state.map, or -1
    _moving: null,          // {idx, gx, gy, valid} live drag preview
    _buildBtn: null, _palette: null, _hint: null, _modeTabs: null,
    _cropImg: {},           // cropId -> Image (per-crop mature sprite), or true(none)/false(loading)
    _w: 0, _h: 0,           // canvas CSS size (= the #farm box we overlay)

    // Top-down pixel map — one of the player-selectable styles (not default).
    active() { return (Farm.state && Farm.state.farmStyle) ? Farm.state.farmStyle() === 'topdown' : false; },
    _ts() { return TILE * this._zoom; },
    _lang() { return (Farm.state && Farm.state.data && Farm.state.data.language === 'en') ? 'en' : 'zh'; },
    _map() { return (Farm.state.data.map = Farm.state.data.map || []); },
    _terrain() { return (Farm.state.data.mapTerrain = Farm.state.data.mapTerrain || {}); },
    _terrainAt(gx, gy) { return this._terrain()[gx + ',' + gy] || 'grass'; },

    init() {
      if (!this.active() || this._on) return;
      this._on = true;
      // body.mapmode hides the vertical farm's CONTENTS (grid/scene/decorations/
      // storekeeper/warehouse btn) but keeps #farm as a flex spacer so the topbar,
      // Lv/XP statusbar and bottom nav stay in place. The canvas overlays the
      // #farm box (see _resize), so all the surrounding chrome remains usable.
      document.body.classList.add('mapmode');
      // Belt-and-suspenders (the stylesheet can be a cache-tick behind on the
      // update that first ships map mode): collapse the farm box's in-flow
      // content directly so nothing renders/scrolls under the canvas even before
      // the CSS lands. The storekeeper is intentionally left visible (onboarding).
      const farmEl = document.getElementById('farm');
      if (farmEl) { farmEl.style.padding = '0'; farmEl.style.overflow = 'hidden'; }
      ['farmGrid', 'farmDecorations'].forEach((idd) => {
        const e = document.getElementById(idd); if (e) e.style.display = 'none';
      });
      const sc = document.querySelector('.farm-scene'); if (sc) sc.style.display = 'none';

      // Seed a default layout + terrain the first time the buildable map opens.
      let seeded = false;
      if (!Array.isArray(Farm.state.data.map)) {
        Farm.state.data.map = DEFAULT_MAP.map(b => ({ type: b.type, gx: b.gx, gy: b.gy }));
        seeded = true;
      }
      if (!Farm.state.data.mapTerrain || typeof Farm.state.data.mapTerrain !== 'object') {
        Farm.state.data.mapTerrain = defaultTerrain();
        seeded = true;
      }
      if (seeded) Farm.state.save();

      const cv = document.createElement('canvas');
      cv.id = 'mapCanvas';
      cv.style.cssText = 'position:fixed;z-index:5;touch-action:none;display:block;background:#849b55;';
      document.body.appendChild(cv);
      this._cv = cv;
      this._ctx = cv.getContext('2d');

      this._loadAssets();
      this._buildLayout();
      this._buildUI();
      this._resize();
      window.addEventListener('resize', () => { this._resize(); this._clampCam(); this.render(); });

      cv.addEventListener('pointerdown', (e) => this._down(e));
      cv.addEventListener('pointermove', (e) => this._move(e));
      cv.addEventListener('pointerup', (e) => this._up(e));
      cv.addEventListener('pointercancel', (e) => this._up(e));
      cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });

      const c = this._tileTopLeft(PLOT_OX + 1, PLOT_OY + 2);
      this._camX = c.x - this._cssW() / 2 + this._ts() / 2;
      this._camY = c.y - this._cssH() / 2 + this._ts() / 2;
      this._clampCam();

      // Re-sync once layout settles (fonts / PWA banner / safe-area can shift the
      // #farm box a few px after first paint), then keep the canvas glued to it.
      requestAnimationFrame(() => { this._syncSize(); this.render(); });
      this._tick = setInterval(() => { this._syncSize(); this.render(); }, 1000);
      this._startLoop();
      this.render();
    },

    // ~15fps animation loop for living ambiance (drifting season particles +
    // wandering pets). Pauses when the tab is hidden or a modal is open; rAF
    // itself parks while the tab is backgrounded, so it's battery-friendly.
    _startLoop() {
      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        if (!this._on || !this._animActive()) return;
        const now = Date.now();
        if (now - (this._lastFrame || 0) < 66) return;
        this._lastFrame = now;
        this.render();
      };
      this._raf = requestAnimationFrame(loop);
    },
    _animActive() {
      if (document.hidden) return false;
      const modal = document.getElementById('modal');
      if (modal && !modal.classList.contains('hidden')) return false;
      return true;
    },

    // Re-fit the canvas to the #farm box if it changed (cheap; only reallocates
    // the backing store when dimensions actually differ).
    _syncSize() {
      const r = this._farmRect();
      if (Math.abs(r.width - this._w) > 1 || Math.abs(r.height - this._h) > 1) {
        this._resize(); this._clampCam();
      }
    },

    _loadAssets() {
      Object.keys(ASSET_SRC).forEach((key) => {
        const im = new Image();
        im.onload = () => { this._img[key] = im; if (this._on) this.render(); };
        im.src = ASSET_DIR + ASSET_SRC[key];
      });
    },

    _buildLayout() {
      this._cellToPlot = {};
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) {
        const gx = PLOT_OX + (i % PLOT_COLS);
        const gy = PLOT_OY + Math.floor(i / PLOT_COLS);
        this._cellToPlot[gx + ',' + gy] = i;
      }
    },

    // ---- build-mode UI (DOM chrome over the canvas) ----
    _buildUI() {
      const en = this._lang() === 'en';
      const btn = document.createElement('button');
      btn.id = 'mapBuildBtn';
      btn.style.cssText = 'position:fixed;right:14px;z-index:20;border:none;border-radius:24px;' +
        'padding:11px 16px;font:600 15px/1 "Fredoka",system-ui,sans-serif;color:#fff;' +
        'background:#4CAF50;box-shadow:0 3px 10px rgba(0,0,0,.22);cursor:pointer;';
      btn.onclick = () => this.toggleBuild();
      document.body.appendChild(btn);
      this._buildBtn = btn;
      // First-timers: gently pulse the 建造 button so build/decorate is discoverable
      // (the plot-tap spotlight is disabled on the map). Stops after first open.
      if (!(Farm.state.data && Farm.state.data.mapBuildSeen) && btn.animate) {
        this._buildPulse = btn.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }],
          { duration: 1300, iterations: Infinity, easing: 'ease-in-out' });
      }

      const tray = document.createElement('div');
      tray.id = 'mapPalette';
      tray.style.cssText = 'position:fixed;left:0;right:0;z-index:20;display:none;flex-direction:column;gap:8px;' +
        'padding:9px 10px;background:rgba(255,255,255,.94);box-shadow:0 -3px 12px rgba(0,0,0,.12);';

      // mode tabs: 建筑 (place buildings) / 地形 (paint terrain)
      const tabs = document.createElement('div');
      tabs.style.cssText = 'display:flex;gap:6px;justify-content:center;';
      [['build', en ? '🏠 Build' : '🏠 建筑'], ['terrain', en ? '🖌 Terrain' : '🖌 地形']].forEach(([m, label]) => {
        const t = document.createElement('button');
        t.dataset.mode = m; t.textContent = label;
        t.style.cssText = 'border:none;border-radius:13px;padding:6px 16px;cursor:pointer;font:600 13px/1 "Fredoka",system-ui,sans-serif;';
        t.onclick = () => this.setEditMode(m);
        tabs.appendChild(t);
      });
      this._modeTabs = tabs; tray.appendChild(tabs);

      const rowCss = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:flex-end;';
      const mkItem = (label, bgUrl) => {
        const item = document.createElement('button');
        item.style.cssText = 'border:1px solid #e0e0e0;border-radius:14px;background:#fff;' +
          'padding:8px 10px 6px;min-width:74px;cursor:pointer;font:500 12px/1.3 "Fredoka",system-ui,sans-serif;color:#444;';
        item.innerHTML = '<div style="font-size:11px;color:#888;margin-top:4px">' + label + '</div>';
        const ic = document.createElement('div');
        ic.style.cssText = 'width:46px;height:40px;margin:0 auto;background-size:contain;background-repeat:no-repeat;background-position:center;';
        ic.style.backgroundImage = "url('" + bgUrl + "')";
        item.insertBefore(ic, item.firstChild);
        return item;
      };

      const pb = document.createElement('div'); pb.style.cssText = rowCss;
      PALETTE.forEach((type) => {
        const b = BUILDINGS[type];
        const item = mkItem('＋ ' + (en ? b.en : b.zh), ASSET_DIR + ASSET_SRC[b.img]);
        item.onclick = () => this._addBuilding(type);
        pb.appendChild(item);
      });
      this._palBuild = pb; tray.appendChild(pb);

      const pt = document.createElement('div'); pt.style.cssText = rowCss;
      BRUSHES.forEach((br) => {
        const item = mkItem(en ? br.en : br.zh, ASSET_DIR + ASSET_SRC[br.tile]);
        item.dataset.brush = br.key;
        item.onclick = () => this.setBrush(br.key);
        pt.appendChild(item);
      });
      this._palTerrain = pt; tray.appendChild(pt);

      document.body.appendChild(tray);
      this._palette = tray;

      const hint = document.createElement('div');
      hint.id = 'mapBuildHint';
      hint.style.cssText = 'position:fixed;left:0;right:0;z-index:19;text-align:center;display:none;' +
        'pointer-events:none;font:500 13px/1.4 "Fredoka",system-ui,sans-serif;color:#fff;';
      hint.innerHTML = '<span style="background:rgba(0,0,0,.45);padding:6px 14px;border-radius:16px"></span>';
      document.body.appendChild(hint);
      this._hint = hint;
      this._refreshModeUI();
      this._layoutUI();
    },
    setEditMode(m) { this._editMode = m; this._sel = -1; this._moving = null; this._refreshModeUI(); this.render(); },
    setBrush(b) { this._brush = b; this._refreshModeUI(); },
    _refreshModeUI() {
      const terr = this._editMode === 'terrain', en = this._lang() === 'en';
      if (this._palBuild) this._palBuild.style.display = terr ? 'none' : 'flex';
      if (this._palTerrain) this._palTerrain.style.display = terr ? 'flex' : 'none';
      if (this._modeTabs) Array.from(this._modeTabs.children).forEach((t) => {
        const on = t.dataset.mode === this._editMode;
        t.style.background = on ? '#FF9800' : '#eee'; t.style.color = on ? '#fff' : '#777';
      });
      if (this._palTerrain) Array.from(this._palTerrain.children).forEach((it) => {
        it.style.outline = (it.dataset.brush === this._brush) ? '3px solid #FF9800' : 'none';
      });
      if (this._hint) {
        const s = this._hint.querySelector('span');
        if (s) s.textContent = terr
          ? (en ? 'Tap / drag to paint terrain' : '点按或拖动涂刷地形（草地=擦除）')
          : (en ? 'Drag buildings & decorations · tap ✕ to remove · pick below' : '拖动摆放建筑/装饰 · 点 ✕ 移除建筑 · 下方添加');
      }
      this._layoutUI();
    },
    _layoutUI() {
      const r = this._farmRect();
      const fromBottom = Math.max(0, window.innerHeight - (r.top + r.height));
      const en = this._lang() === 'en';
      if (this._palette) {
        this._palette.style.display = this._build ? 'flex' : 'none';
        this._palette.style.left = r.left + 'px';
        this._palette.style.right = Math.max(0, window.innerWidth - (r.left + r.width)) + 'px';
        this._palette.style.bottom = fromBottom + 'px';
      }
      if (this._buildBtn) {
        const paletteH = (this._build && this._palette) ? (this._palette.getBoundingClientRect().height || 74) : 0;
        this._buildBtn.style.right = (Math.max(0, window.innerWidth - (r.left + r.width)) + 14) + 'px';
        this._buildBtn.style.bottom = (fromBottom + (this._build ? paletteH + 10 : 14)) + 'px';
        this._buildBtn.textContent = this._build ? (en ? '✓ Done' : '✓ 完成') : (en ? '🔨 Build' : '🔨 建造');
        this._buildBtn.style.background = this._build ? '#FF9800' : '#4CAF50';
      }
      if (this._hint) {
        this._hint.style.display = this._build ? 'block' : 'none';
        this._hint.style.left = r.left + 'px';
        this._hint.style.right = Math.max(0, window.innerWidth - (r.left + r.width)) + 'px';
        this._hint.style.top = (r.top + 8) + 'px';
      }
    },
    toggleBuild() {
      this._build = !this._build;
      // 建造模式让位给底部建材托盘：隐藏 dock（与 iso 视图 _setChromeHidden 同惯例，
      // UX 第 4 批 2026-07-05——托盘 z-index 20 本就盖住 dock，藏掉避免半露）。
      const dockEl = document.getElementById('bottombar');
      if (dockEl) dockEl.style.display = this._build ? 'none' : '';
      if (this._build && Farm.state.data && !Farm.state.data.mapBuildSeen) {
        Farm.state.data.mapBuildSeen = true; Farm.state.save();
        if (this._buildPulse) { this._buildPulse.cancel(); this._buildPulse = null; }
      }
      if (!this._build) { this._sel = -1; this._moving = null; this._painting = false; this._editMode = 'build'; Farm.state.save(); }
      this._refreshModeUI();
      this._layoutUI();
      this.render();
    },
    _paintCell(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= GROUND_COLS || gy >= GROUND_ROWS) return;
      const t = this._terrain(), key = gx + ',' + gy;
      if (this._brush === 'grass') { if (t[key] != null) { delete t[key]; this.render(); } }
      else if (t[key] !== this._brush) { t[key] = this._brush; this.render(); }
    },

    // ---- sizing / coords ----
    // The canvas overlays the #farm element's box exactly (cached in _resize).
    _farmRect() {
      const f = document.getElementById('farm');
      if (f) { const r = f.getBoundingClientRect(); if (r.width > 10 && r.height > 10) return r; }
      const top = document.getElementById('topbar'), bottom = document.getElementById('bottombar');
      const t = top ? top.getBoundingClientRect().height : 56;
      const b = bottom ? bottom.getBoundingClientRect().height : 64;
      return { left: 0, top: t, width: window.innerWidth, height: Math.max(120, window.innerHeight - t - b) };
    },
    _cssW() { return this._w; },
    _cssH() { return this._h; },
    _resize() {
      const r = this._farmRect();
      this._w = r.width; this._h = r.height;
      this._cv.style.left = r.left + 'px';
      this._cv.style.top = r.top + 'px';
      this._cv.style.width = r.width + 'px';
      this._cv.style.height = r.height + 'px';
      this._dpr = Math.min(2, window.devicePixelRatio || 1);
      this._cv.width = r.width * this._dpr;
      this._cv.height = r.height * this._dpr;
      this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      this._layoutUI();
    },
    _tileTopLeft(gx, gy) { const ts = this._ts(); return { x: gx * ts, y: gy * ts }; },
    _screenToCell(sx, sy) {
      const ts = this._ts();
      return { gx: Math.floor((sx + this._camX) / ts), gy: Math.floor((sy + this._camY) / ts) };
    },
    _clampCam() {
      const ts = this._ts();
      const maxX = GROUND_COLS * ts - this._cssW();
      const maxY = GROUND_ROWS * ts - this._cssH();
      this._camX = Math.max(Math.min(this._camX, Math.max(0, maxX)), Math.min(0, maxX));
      this._camY = Math.max(Math.min(this._camY, Math.max(0, maxY)), Math.min(0, maxY));
    },
    // Zoom keeping the world point under (px,py) fixed on screen.
    _zoomAt(px, py, newZoom) {
      const z = Math.max(ZMIN, Math.min(ZMAX, newZoom));
      if (z === this._zoom) return;
      const ts0 = this._ts();
      const wx = (px + this._camX) / ts0, wy = (py + this._camY) / ts0;
      this._zoom = z;
      const ts1 = this._ts();
      this._camX = wx * ts1 - px;
      this._camY = wy * ts1 - py;
      this._clampCam();
      this.render();
    },

    // ---- footprint / placement helpers ----
    _plotCellSet() {
      const set = {};
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) {
        set[(PLOT_OX + (i % PLOT_COLS)) + ',' + (PLOT_OY + Math.floor(i / PLOT_COLS))] = true;
      }
      return set;
    },
    _footprintFree(gx, gy, type, exceptIdx) {
      const b = BUILDINGS[type];
      if (gx < 0 || gy < 0 || gx + b.w > GROUND_COLS || gy + b.h > GROUND_ROWS) return false;
      const plotCells = this._plotCellSet();
      const occ = {};
      const map = this._map();
      for (let i = 0; i < map.length; i++) {
        if (i === exceptIdx) continue;
        const o = map[i], ob = BUILDINGS[o.type];
        if (!ob) continue;
        for (let yy = 0; yy < ob.h; yy++)
          for (let xx = 0; xx < ob.w; xx++) occ[(o.gx + xx) + ',' + (o.gy + yy)] = true;
      }
      const terrain = this._terrain();
      for (let yy = 0; yy < b.h; yy++) {
        for (let xx = 0; xx < b.w; xx++) {
          const key = (gx + xx) + ',' + (gy + yy);
          if (plotCells[key] || occ[key] || terrain[key] === 'water') return false;   // not on plots/buildings/water
        }
      }
      return true;
    },
    // Cells blocked for decoration placement: plots, building footprints, water.
    _occupied() {
      const occ = this._plotCellSet();
      this._map().forEach((o) => {
        const b = BUILDINGS[o.type]; if (!b) return;
        for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) occ[(o.gx + xx) + ',' + (o.gy + yy)] = true;
      });
      const t = this._terrain();
      Object.keys(t).forEach((k) => { if (t[k] === 'water') occ[k] = true; });
      return occ;
    },
    _decoHasPos(d) { return Number.isInteger(d.gx) && Number.isInteger(d.gy) && d.gx >= 0 && d.gy >= 0 && d.gx < GROUND_COLS && d.gy < GROUND_ROWS; },
    _decoAt(gx, gy) {
      const decos = (Farm.state.data.decorations) || [];
      for (let i = 0; i < decos.length; i++) if (decos[i].gx === gx && decos[i].gy === gy) return i;
      return -1;
    },
    _decoCellFree(gx, gy, exceptIdx) {
      if (gx < 0 || gy < 0 || gx >= GROUND_COLS || gy >= GROUND_ROWS) return false;
      if (this._occupied()[gx + ',' + gy]) return false;
      const decos = (Farm.state.data.decorations) || [];
      for (let i = 0; i < decos.length; i++) if (i !== exceptIdx && decos[i].gx === gx && decos[i].gy === gy) return false;
      return true;
    },
    // Assign stable cells to decorations lacking a valid (free) one, bottom-first.
    _ensureDecoPositions() {
      const decos = (Farm.state.data && Farm.state.data.decorations) || [];
      if (!decos.length || !Farm.epShop || !Farm.epShop.items || !Farm.epShop.items.length) return;
      const occ = this._occupied(), taken = {};
      decos.forEach((d) => { if (this._decoHasPos(d) && !occ[d.gx + ',' + d.gy]) taken[d.gx + ',' + d.gy] = 1; });
      const free = [];
      for (let gy = GROUND_ROWS - 1; gy >= 0; gy--) for (let gx = 0; gx < GROUND_COLS; gx++) { const k = gx + ',' + gy; if (!occ[k] && !taken[k]) free.push(k); }
      let fi = 0, changed = false;
      decos.forEach((d) => {
        const item = Farm.epShop.items.find((it) => it.id === d.itemId);
        if (!item || !item.decoration_emoji) return;
        if (this._decoHasPos(d) && !occ[d.gx + ',' + d.gy]) return;   // already valid
        while (fi < free.length && taken[free[fi]]) fi++;
        if (fi < free.length) { const k = free[fi++]; const c = k.split(','); d.gx = +c[0]; d.gy = +c[1]; taken[k] = 1; changed = true; }
      });
      if (changed) Farm.state.save();
    },
    // Topmost (frontmost) building whose footprint contains (gx,gy); else -1.
    _buildingAt(gx, gy) {
      const map = this._map();
      let best = -1, bestGy = -1;
      for (let i = 0; i < map.length; i++) {
        const o = map[i], b = BUILDINGS[o.type];
        if (!b) continue;
        if (gx >= o.gx && gx < o.gx + b.w && gy >= o.gy && gy < o.gy + b.h) {
          if (o.gy >= bestGy) { best = i; bestGy = o.gy; }
        }
      }
      return best;
    },
    // Screen-space rect of the ✕ delete chip for a selected building.
    _delChipRect(o) {
      const b = BUILDINGS[o.type], ts = this._ts(), r = Math.max(11, ts * 0.18);
      const cx = (o.gx + b.w) * ts - this._camX, cy = o.gy * ts - this._camY;
      return { x: cx, y: cy, r };
    },
    _addBuilding(type) {
      const b = BUILDINGS[type];
      // Prefer a free cell near the current view center, else scan the grid.
      const center = this._screenToCell(this._cssW() / 2, this._cssH() / 2);
      const tries = [[center.gx - 1, center.gy - 1]];
      for (let gy = 0; gy + b.h <= GROUND_ROWS; gy++)
        for (let gx = 0; gx + b.w <= GROUND_COLS; gx++) tries.push([gx, gy]);
      for (const [gx, gy] of tries) {
        if (this._footprintFree(gx, gy, type, -1)) {
          this._map().push({ type, gx, gy });
          this._sel = this._map().length - 1;
          Farm.state.save();
          this.render();
          if (Farm.ui && Farm.ui.toast) {
            Farm.ui.toast(this._lang() === 'en' ? ('Placed ' + b.en + ' — drag to move') : ('已放置' + b.zh + '，拖动可移动'));
          }
          return;
        }
      }
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? 'No room' : '没有空位了');
    },

    // ---- input (pan + tap + pinch + wheel + build drag) ----
    _local(e) { const r = this._cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
    _down(e) {
      const p = this._local(e);
      this._pointers[e.pointerId] = p;
      const ids = Object.keys(this._pointers);
      if (ids.length === 2) {
        const [a, b] = ids.map(k => this._pointers[k]);
        this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._zoom };
        this._drag = null; this._moving = null; this._painting = false;
        return;
      }
      if (this._build && this._editMode === 'terrain') {
        const cell = this._screenToCell(p.x, p.y);
        this._painting = true;
        this._paintCell(cell.gx, cell.gy);
        return;
      }
      if (this._build) {
        // 1) delete chip of the selected building?
        if (this._sel >= 0) {
          const c = this._delChipRect(this._map()[this._sel]);
          if (Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 4) {
            this._map().splice(this._sel, 1);
            this._sel = -1; Farm.state.save(); this.render();
            return;
          }
        }
        // 2) grab a building to move?
        const cell = this._screenToCell(p.x, p.y);
        const idx = this._buildingAt(cell.gx, cell.gy);
        if (idx >= 0) {
          const o = this._map()[idx];
          this._sel = idx;
          this._moving = { kind: 'building', idx, gx: o.gx, gy: o.gy, valid: true, startX: p.x, startY: p.y, moved: false };
          this.render();
          return;
        }
        // 2b) grab a decoration to move?
        const didx = this._decoAt(cell.gx, cell.gy);
        if (didx >= 0) {
          const d = Farm.state.data.decorations[didx];
          this._sel = -1;
          this._moving = { kind: 'deco', idx: didx, gx: d.gx, gy: d.gy, valid: true, startX: p.x, startY: p.y, moved: false };
          this.render();
          return;
        }
        // 3) empty → pan (and a tap will deselect on up)
      }
      this._drag = { x: p.x, y: p.y, camX: this._camX, camY: this._camY, moved: false };
    },
    _move(e) {
      if (!(e.pointerId in this._pointers)) return;
      this._pointers[e.pointerId] = this._local(e);
      const ids = Object.keys(this._pointers);
      if (this._pinch && ids.length >= 2) {
        const [a, b] = ids.map(k => this._pointers[k]);
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this._zoomAt(mid.x, mid.y, this._pinch.zoom * (dist / this._pinch.dist));
        return;
      }
      const p = this._pointers[e.pointerId];
      if (this._painting) {
        const cell = this._screenToCell(p.x, p.y);
        this._paintCell(cell.gx, cell.gy);
        return;
      }
      if (this._moving) {
        if (Math.abs(p.x - this._moving.startX) + Math.abs(p.y - this._moving.startY) > 4) this._moving.moved = true;
        const cell = this._screenToCell(p.x, p.y);
        if (this._moving.kind === 'deco') {
          this._moving.gx = cell.gx; this._moving.gy = cell.gy;
          this._moving.valid = this._decoCellFree(cell.gx, cell.gy, this._moving.idx);
        } else {
          const o = this._map()[this._moving.idx], b = BUILDINGS[o.type];
          const gx = cell.gx - (b.w >> 1), gy = cell.gy - (b.h >> 1);
          this._moving.gx = gx; this._moving.gy = gy;
          this._moving.valid = this._footprintFree(gx, gy, o.type, this._moving.idx);
        }
        this.render();
        return;
      }
      if (this._drag) {
        const dx = p.x - this._drag.x, dy = p.y - this._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
        this._camX = this._drag.camX - dx;
        this._camY = this._drag.camY - dy;
        this._clampCam();
        this.render();
      }
    },
    _up(e) {
      const p = this._pointers[e.pointerId];
      delete this._pointers[e.pointerId];
      if (Object.keys(this._pointers).length < 2) this._pinch = null;

      if (this._painting) { this._painting = false; Farm.state.save(); this._drag = null; this.render(); return; }
      if (this._moving) {
        const m = this._moving; this._moving = null;
        if (m.moved && m.valid) {
          if (m.kind === 'deco') {
            const d = Farm.state.data.decorations[m.idx];
            if (d) { d.gx = m.gx; d.gy = m.gy; Farm.state.save(); }
          } else {
            const o = this._map()[m.idx];
            if (o) { o.gx = m.gx; o.gy = m.gy; Farm.state.save(); }
          }
        }
        this.render();
        this._drag = null;
        return;
      }
      const wasTap = this._drag && !this._drag.moved && !this._pinch;
      this._drag = null;
      if (!wasTap || !p) return;
      if (this._build) {
        // tap empty space deselects; tap a building selects it
        const cell = this._screenToCell(p.x, p.y);
        const idx = this._buildingAt(cell.gx, cell.gy);
        this._sel = idx;
        this.render();
        return;
      }
      const cell = this._screenToCell(p.x, p.y);
      const bidx = this._buildingAt(cell.gx, cell.gy);
      if (bidx >= 0) { this._buildingAction(bidx); return; }
      this._tapCell(cell.gx, cell.gy);
    },
    _buildingAction(idx) {
      const o = this._map()[idx], b = o && BUILDINGS[o.type];
      if (!b) return;
      if (b.tap === 'warehouse' && Farm.warehouse && Farm.warehouse.open) Farm.warehouse.open();
      else if (b.tap === 'shop' && Farm.shop && Farm.shop.open) Farm.shop.open();
      else if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? b.en : b.zh);
    },
    _wheel(e) {
      e.preventDefault();
      const p = this._local(e);
      this._zoomAt(p.x, p.y, this._zoom * (e.deltaY < 0 ? 1.12 : 0.89));
    },
    _tapCell(gx, gy) {
      const idx = this._cellToPlot[gx + ',' + gy];
      if (idx == null) return;
      const plot = Farm.state.data.plots[idx];
      if (!plot || !plot.unlocked) {
        const lvl = REQUIRED_LV[idx] || 2;
        if (Farm.ui && Farm.ui.toast) {
          Farm.ui.toast(Farm.i18n ? Farm.i18n.t('plot_locked_hint_template', { n: lvl }) : ('Lv ' + lvl + ' 解锁'));
        }
        return;
      }
      if (!plot.crop) {
        // 粘性连续种植（UX 第 2 批 #2）：激活时直接连种同款，不弹选种器
        if (Farm.shop.stickyPlant && Farm.shop.stickyPlant(idx)) { this.render(); return; }
        Farm.shop.openSeedPickerForPlot(idx);
        return;
      }
      if (Farm.shop.stickyEnd) Farm.shop.stickyEnd();   // tap 非空地 → 退出粘性
      if (Farm.crops.isMature(plot)) {
        Farm.farm.harvestPlot(idx, this._fakeEvtForCell(gx, gy));   // gives harvest juice the plot's on-screen position
        setTimeout(() => this.render(), 50);
        return;
      }
      Farm.farm.openPlotCare(idx, plot, Farm.crops.get(plot.crop));
    },
    // A synthetic event whose target rect is the cell's page-space rect, so the
    // farm's harvest feedback (float text / leaf burst) lands on the map plot.
    _fakeEvtForCell(gx, gy) {
      const ts = this._ts(), r = this._cv.getBoundingClientRect();
      const rect = { left: r.left + gx * ts - this._camX, top: r.top + gy * ts - this._camY, width: ts, height: ts };
      return { target: { getBoundingClientRect: () => rect } };
    },

    // ---- render ----
    _blitImage(im, cx, by, maxW, maxH) {
      if (!im) return false;
      const s = Math.min(maxW / im.width, maxH / im.height);
      const w = im.width * s, h = im.height * s;
      this._ctx.drawImage(im, cx - w / 2, by - h, w, h);
      return true;
    },
    _blit(key, cx, by, maxW, maxH) { return this._blitImage(this._img[key], cx, by, maxW, maxH); },
    // Lazy-load a crop's mature illustration (shared app art, assets/crops/{id}.png).
    // Returns the Image once ready, else null (and triggers a re-render on load).
    _cropSprite(id) {
      const c = this._cropImg[id];
      if (c instanceof Image) return c;
      if (c === true || c === false) return null;   // none / loading
      const url = (Farm.cropArt && Farm.cropArt.spriteUrl) ? Farm.cropArt.spriteUrl(id) : null;
      if (!url) { this._cropImg[id] = true; return null; }
      this._cropImg[id] = false;
      const im = new Image();
      im.onload = () => { this._cropImg[id] = im; if (this._on) this.render(); };
      im.onerror = () => { this._cropImg[id] = true; };
      im.src = url;
      return null;
    },
    render() {
      if (!this._on) return;
      const ctx = this._ctx, ts = this._ts();
      const W = this._cssW(), H = this._cssH();
      ctx.clearRect(0, 0, W, H);

      // ground: checker grass tone + a seamless grass-texture overlay; painted
      // path/water cells get their own tile + a darker rim on exposed edges.
      const gt = this._img.tgrass, pt = this._img.tpath, wt = this._img.twater;
      const terrain = Farm.state.data.mapTerrain || {};
      for (let gy = 0; gy < GROUND_ROWS; gy++) {
        for (let gx = 0; gx < GROUND_COLS; gx++) {
          const x = gx * ts - this._camX, y = gy * ts - this._camY;
          if (x > W || y > H || x + ts < 0 || y + ts < 0) continue;
          ctx.fillStyle = ((gx + gy) % 2 === 0) ? GRASS_A : GRASS_B;
          ctx.fillRect(x, y, ts, ts);
          if (gt) ctx.drawImage(gt, x, y, ts, ts);            // texture flecks
          const kind = terrain[gx + ',' + gy];
          if (kind === 'path' && pt) ctx.drawImage(pt, x, y, ts, ts);
          else if (kind === 'water' && wt) {
            ctx.drawImage(wt, x, y, ts, ts);
            const t = Date.now() / 1000;                 // subtle drifting shimmer
            const gy2 = y + (((t * 9 + gx * 17 + gy * 23) % ts));
            ctx.fillStyle = 'rgba(190,225,245,0.22)';
            ctx.fillRect(x + ts * 0.12, gy2, ts * 0.42, Math.max(1, ts * 0.03));
          }
          if (kind === 'path' || kind === 'water') this._terrainEdges(kind, gx, gy, x, y, ts, terrain);
        }
      }
      if (this._build) this._drawGrid(ts, W, H);

      // depth-sorted drawables: plots (flat) + buildings (tall). Baseline = the
      // screen y of the bottom row, so nearer (lower) sprites draw on top.
      const draws = [];
      const plots = Farm.state.data.plots || [];
      // Rebuild the cell→plot tap map when a level-up appends a new plot.
      if (this._cellToPlotN !== plots.length) { this._buildLayout(); this._cellToPlotN = plots.length; }
      for (let i = 0; i < plots.length; i++) {
        const gx = PLOT_OX + (i % PLOT_COLS), gy = PLOT_OY + Math.floor(i / PLOT_COLS);
        draws.push({ base: (gy + 1) * ts, fn: () => this._drawPlot(plots[i], gx, gy, i, ts) });
      }
      const map = this._map();
      for (let i = 0; i < map.length; i++) {
        const o = map[i], b = BUILDINGS[o.type];
        if (!b) continue;
        const gy = (this._moving && this._moving.idx === i) ? this._moving.gy : o.gy;
        draws.push({ base: (gy + b.h) * ts, fn: () => this._drawBuilding(i, ts) });
      }
      // Owned EP-shop decorations (auto-placed on free cells — brings the paid
      // cosmetics onto the map). Depth-sorted like everything else.
      this._decoPlacements().forEach((d) => {
        const mv = this._moving && this._moving.kind === 'deco' && this._moving.idx === d.decoIdx;
        const gx = mv ? this._moving.gx : d.gx, gy = mv ? this._moving.gy : d.gy;
        draws.push({ base: (gy + 1) * ts, fn: () => this._drawDeco({ emoji: d.emoji, gx, gy, pet: d.pet, seed: d.seed }, ts, mv) });
      });
      draws.sort((a, c) => a.base - c.base);
      draws.forEach(d => d.fn());

      this._drawParticles(ts);   // season ambiance on top
      this._drawFestival(ts);    // festival overlay (lanterns / moon)
    },
    // Festival overlay in screen space: 春节 → swaying lantern string along the
    // top; 中秋 → a glowing moon top-right. Driven by Farm.events.
    _drawFestival(ts) {
      const id = Farm.events && Farm.events.getActiveFestivalId && Farm.events.getActiveFestivalId();
      if (!id) return;
      const ctx = this._ctx, W = this._cssW(), t = Date.now() / 1000;
      if (id === 'spring_festival') {
        const n = Math.max(3, Math.floor(W / 64));
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.font = '26px sans-serif';
        for (let i = 0; i < n; i++) {
          const x = (i + 0.5) * (W / n);
          ctx.fillText('🏮', x, 1 + Math.sin(t * 1.2 + i) * 4);
        }
      } else if (id === 'mid_autumn') {
        const x = W - 48, y = 48, r = 30;
        ctx.save();
        ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,245,200,0.55)'; ctx.fill();
        ctx.restore();
        ctx.font = '50px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🌕', x, y);
      }
    },
    // Owned decorations with their stored cell (auto-assigned once, then drag-
    // movable in build mode). Returns [{emoji,gx,gy,pet,seed,decoIdx}].
    _decoPlacements() {
      const decos = (Farm.state.data && Farm.state.data.decorations) || [];
      if (!decos.length || !Farm.epShop || !Farm.epShop.items || !Farm.epShop.items.length) return [];
      if (decos.some((d) => !this._decoHasPos(d))) this._ensureDecoPositions();
      const out = [];
      const petsOn = !!(Farm.state.data && Farm.state.data.petsEnabled);   // walking pets default OFF
      decos.forEach((d, i) => {
        if (!this._decoHasPos(d)) return;
        const item = Farm.epShop.items.find((it) => it.id === d.itemId);
        if (!item || !item.decoration_emoji) return;
        if (item.category === 'pet' && !petsOn) return;
        out.push({ emoji: item.decoration_emoji, gx: d.gx, gy: d.gy, pet: item.category === 'pet', seed: i, decoIdx: i });
      });
      return out;
    },
    _drawDeco(d, ts, moving) {
      const ctx = this._ctx;
      if (moving) {   // drop-cell validity highlight
        const x = d.gx * ts - this._camX, y = d.gy * ts - this._camY;
        ctx.fillStyle = this._moving && this._moving.valid ? 'rgba(76,175,80,0.30)' : 'rgba(220,60,60,0.32)';
        ctx.fillRect(x, y, ts, ts);
      }
      let cx = (d.gx + 0.5) * ts - this._camX, by = (d.gy + 0.92) * ts - this._camY;
      if (d.pet && !moving) {   // pets wander in a small ellipse near their spot
        const t = Date.now() / 1000;
        cx += Math.sin(t * 0.5 + d.seed) * ts * 0.55;
        by += Math.cos(t * 0.4 + d.seed * 1.3) * ts * 0.22;
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = moving ? 0.85 : 1;
      ctx.font = (ts * 0.6) + 'px sans-serif';
      ctx.fillText(d.emoji, cx, by);
      ctx.globalAlpha = 1;
    },
    // Screen-space season ambiance: a few emoji drifting down + swaying.
    _drawParticles(ts) {
      const season = (Farm.seasons && Farm.seasons.current) || monthSeason();
      const set = SEASON_PARTICLES[season];
      if (!set || !set.length) return;
      const ctx = this._ctx, W = this._cssW(), H = this._cssH(), t = Date.now() / 1000;
      const N = 18;
      ctx.save(); ctx.globalAlpha = 0.8;
      for (let i = 0; i < N; i++) {
        const sp = 16 + (i % 5) * 7;                 // fall speed (px/s)
        const x = (i * 53.7) % W;
        const sway = Math.sin(t * 0.8 + i) * 13;
        const y = ((t * sp + i * 41) % (H + 40)) - 20;
        ctx.font = (ts * 0.26 + (i % 3) * 3) + 'px sans-serif';
        ctx.fillText(set[i % set.length], x + sway, y);
      }
      ctx.restore();
    },
    // Darker rim on terrain-cell sides that border a different terrain — reads
    // as a shoreline (water) / worn path edge. Works for any painted shape.
    _terrainEdges(kind, gx, gy, x, y, ts, terrain) {
      const ctx = this._ctx;
      ctx.fillStyle = kind === 'water' ? 'rgba(40,86,116,0.5)' : 'rgba(108,72,32,0.4)';
      const w = Math.max(2, ts * 0.12);
      if (terrain[gx + ',' + (gy - 1)] !== kind) ctx.fillRect(x, y, ts, w);
      if (terrain[gx + ',' + (gy + 1)] !== kind) ctx.fillRect(x, y + ts - w, ts, w);
      if (terrain[(gx - 1) + ',' + gy] !== kind) ctx.fillRect(x, y, w, ts);
      if (terrain[(gx + 1) + ',' + gy] !== kind) ctx.fillRect(x + ts - w, y, w, ts);
    },
    _drawGrid(ts, W, H) {
      const ctx = this._ctx;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
      for (let gx = 0; gx <= GROUND_COLS; gx++) {
        const x = gx * ts - this._camX; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let gy = 0; gy <= GROUND_ROWS; gy++) {
        const y = gy * ts - this._camY; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
    },
    _drawBuilding(idx, ts) {
      const ctx = this._ctx;
      const o = this._map()[idx], b = BUILDINGS[o.type];
      const moving = this._moving && this._moving.idx === idx;
      const gx = moving ? this._moving.gx : o.gx, gy = moving ? this._moving.gy : o.gy;
      const cx = (gx + b.w / 2) * ts - this._camX;
      const by = (gy + b.h) * ts - this._camY;

      if (moving) {   // footprint highlight: green if valid, red if blocked
        ctx.fillStyle = this._moving.valid ? 'rgba(76,175,80,0.30)' : 'rgba(220,60,60,0.32)';
        ctx.fillRect(gx * ts - this._camX, gy * ts - this._camY, b.w * ts, b.h * ts);
      } else if (this._build && this._sel === idx) {
        ctx.strokeStyle = '#FF9800'; ctx.lineWidth = 3;
        ctx.strokeRect(gx * ts - this._camX + 2, gy * ts - this._camY + 2, b.w * ts - 4, b.h * ts - 4);
      }

      ctx.globalAlpha = moving ? 0.82 : 1;
      const ok = this._blit(b.img, cx, by, b.w * ts, b.maxHCells * ts);
      ctx.globalAlpha = 1;
      if (!ok) { ctx.fillStyle = '#c0392b'; ctx.fillRect(cx - b.w * ts / 2, by - ts, b.w * ts, ts); }

      // delete chip on the selected (not-moving) building
      if (this._build && this._sel === idx && !moving) {
        const c = this._delChipRect(o);
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fillStyle = '#e8522a'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + (c.r * 1.15) + 'px sans-serif'; ctx.fillText('✕', c.x, c.y + 0.5);
      }
    },
    _drawPlot(plot, gx, gy, idx, ts) {
      const ctx = this._ctx;
      const x = gx * ts - this._camX, y = gy * ts - this._camY;
      const cx = x + ts / 2, cy = y + ts / 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      // Locked plot: dim grayed soil + lock + required level.
      if (!plot.unlocked) {
        const pad = ts * 0.07, r = ts * 0.16;
        this._roundRect(x + pad, y + pad, ts - pad * 2, ts - pad * 2, r);
        ctx.fillStyle = 'rgba(90,96,84,0.78)'; ctx.fill();
        ctx.font = (ts * 0.3) + 'px sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText('🔒', cx, cy - ts * 0.08);
        ctx.font = 'bold ' + (ts * 0.18) + 'px sans-serif';
        ctx.fillText('Lv' + (REQUIRED_LV[idx] || 2), cx, cy + ts * 0.24);
        return;
      }

      // Soil tile (image, or brown fallback).
      const pad = ts * 0.06;
      if (!this._blit('soil', cx, y + ts - pad, ts - pad * 2, ts - pad * 2)) {
        this._roundRect(x + pad, y + pad, ts - pad * 2, ts - pad * 2, ts * 0.16);
        ctx.fillStyle = '#a86b35'; ctx.fill();
      }

      if (!plot.crop) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = 'bold ' + (ts * 0.34) + 'px sans-serif';
        ctx.fillText('+', cx, cy);
        return;
      }

      // Crop visuals:
      //  - 上海青 (shanghai_miao): dedicated pixel 4-stage sprite (extra polish).
      //  - every other crop: generic sprout while growing → the crop's own mature
      //    illustration (assets/crops/{id}.png) so nothing is misrepresented.
      const p = Farm.crops.getProgress ? Farm.crops.getProgress(plot) : 1;
      const mature = Farm.crops.isMature(plot);
      if (mature) {   // ready glow halo behind the sprite — gently pulses ("tap me")
        const t = Date.now() / 1000, ph = Math.sin(t * 2 + gx + gy);
        ctx.beginPath(); ctx.arc(cx, cy, ts * (0.40 + ph * 0.03), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,214,79,' + (0.30 + ph * 0.08) + ')'; ctx.fill();
      }

      if (plot.crop === 'shanghai_miao') {
        const frame = p >= 1 ? 3 : p >= 0.6 ? 2 : p >= 0.25 ? 1 : 0;
        const maxH = ts * (0.5 + frame * 0.27);
        if (!this._blit('crop' + frame, cx, y + ts * 0.96, ts * 0.9, maxH)) {
          ctx.font = (ts * 0.42) + 'px sans-serif'; ctx.fillText(mature ? '🥬' : '🌿', cx, cy);
        }
      } else if (mature) {
        const im = this._cropSprite(plot.crop);
        if (!this._blitImage(im, cx, y + ts * 0.92, ts * 0.78, ts * 0.85)) {
          const def = Farm.crops.get(plot.crop);
          ctx.font = (ts * 0.5) + 'px sans-serif';
          ctx.fillText((def && def.icon) || '🥬', cx, cy);
        }
      } else {   // generic sprout, grows a touch with progress
        ctx.font = (ts * (p >= 0.4 ? 0.4 : 0.3)) + 'px sans-serif';
        ctx.fillText(p >= 0.4 ? '🌿' : '🌱', cx, cy);
      }

      // Growth progress bar (drawn last so it's never hidden by the sprite),
      // so maturity is readable on the map without tapping each plot.
      if (!mature) {
        const bw = ts * 0.62, bx = cx - bw / 2, byb = y + ts * 0.9, bh = Math.max(3, ts * 0.055);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(bx, byb, bw, bh);
        ctx.fillStyle = '#7bc043'; ctx.fillRect(bx, byb, bw * Math.max(0.04, p), bh);
      }
    },
    _roundRect(x, y, w, h, r) {
      const ctx = this._ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.mapView = mapView;
})();
