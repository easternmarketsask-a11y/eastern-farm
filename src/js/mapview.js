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
  const GRASS_A = '#849b55', GRASS_B = '#7c9350';
  const ASSET_DIR = 'assets/images/map/';
  const ASSET_SRC = {
    soil: 'soil.png',
    barn: 'barn.png',
    house: 'house.png',
    crop0: 'crop_qingcai_0.png',
    crop1: 'crop_qingcai_1.png',
    crop2: 'crop_qingcai_2.png',
    crop3: 'crop_qingcai_3.png',
  };

  // Placeable building catalog. footprint w/h in cells; img = asset key; the
  // sprite may render taller than the footprint (anchored to its base row).
  const BUILDINGS = {
    barn: { img: 'barn', w: 2, h: 2, maxHCells: 2.2, zh: '谷仓', en: 'Barn' },
    house: { img: 'house', w: 2, h: 2, maxHCells: 2.7, zh: '小屋', en: 'Cottage' },
  };
  const PALETTE = ['barn', 'house'];
  const DEFAULT_MAP = [
    { type: 'barn', gx: 5, gy: 1 },
    { type: 'house', gx: 6, gy: 4 },
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
    _sel: -1,               // selected building index in state.map, or -1
    _moving: null,          // {idx, gx, gy, valid} live drag preview
    _buildBtn: null, _palette: null, _hint: null,

    active() { return /[?&]map=1/.test(location.search); },
    _ts() { return TILE * this._zoom; },
    _lang() { return (Farm.state && Farm.state.data && Farm.state.data.language === 'en') ? 'en' : 'zh'; },
    _map() { return (Farm.state.data.map = Farm.state.data.map || []); },

    init() {
      if (!this.active() || this._on) return;
      this._on = true;
      const farm = document.getElementById('farm');
      if (farm) farm.style.display = 'none';

      // Seed a default layout the first time the buildable map is opened.
      if (!Array.isArray(Farm.state.data.map)) {
        Farm.state.data.map = DEFAULT_MAP.map(b => ({ type: b.type, gx: b.gx, gy: b.gy }));
        Farm.state.save();
      }

      const cv = document.createElement('canvas');
      cv.id = 'mapCanvas';
      cv.style.cssText = 'position:fixed;left:0;right:0;z-index:5;touch-action:none;display:block;background:#849b55;';
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

      this._tick = setInterval(() => this.render(), 1000);
      this.render();
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

      const tray = document.createElement('div');
      tray.id = 'mapPalette';
      tray.style.cssText = 'position:fixed;left:0;right:0;z-index:20;display:none;gap:10px;' +
        'justify-content:center;align-items:flex-end;padding:10px 12px;' +
        'background:rgba(255,255,255,.94);box-shadow:0 -3px 12px rgba(0,0,0,.12);';
      PALETTE.forEach((type) => {
        const b = BUILDINGS[type];
        const item = document.createElement('button');
        item.style.cssText = 'border:1px solid #e0e0e0;border-radius:14px;background:#fff;' +
          'padding:8px 10px 6px;min-width:74px;cursor:pointer;font:500 12px/1.3 "Fredoka",system-ui,sans-serif;color:#444;';
        item.innerHTML = '<div style="font-size:11px;color:#888;margin-top:4px">＋ ' +
          (en ? b.en : b.zh) + '</div>';
        const ic = document.createElement('div');
        ic.style.cssText = 'width:46px;height:40px;margin:0 auto;background-size:contain;' +
          'background-repeat:no-repeat;background-position:center bottom;';
        ic.style.backgroundImage = "url('" + ASSET_DIR + ASSET_SRC[b.img] + "')";
        item.insertBefore(ic, item.firstChild);
        item.onclick = () => this._addBuilding(type);
        tray.appendChild(item);
      });
      document.body.appendChild(tray);
      this._palette = tray;

      const hint = document.createElement('div');
      hint.id = 'mapBuildHint';
      hint.style.cssText = 'position:fixed;left:0;right:0;z-index:19;text-align:center;display:none;' +
        'pointer-events:none;font:500 13px/1.4 "Fredoka",system-ui,sans-serif;color:#fff;';
      hint.innerHTML = '<span style="background:rgba(0,0,0,.45);padding:6px 14px;border-radius:16px">' +
        (en ? 'Drag to move · tap ✕ to remove · pick below to add' : '拖动摆放 · 点 ✕ 移除 · 下方选建筑添加') + '</span>';
      document.body.appendChild(hint);
      this._hint = hint;
      this._layoutUI();
    },
    _layoutUI() {
      const bottom = document.getElementById('bottombar');
      const bh = bottom ? bottom.getBoundingClientRect().height : 64;
      if (this._buildBtn) {
        this._buildBtn.style.bottom = (bh + (this._build ? 78 : 14)) + 'px';
        const en = this._lang() === 'en';
        this._buildBtn.textContent = this._build ? (en ? '✓ Done' : '✓ 完成') : (en ? '🔨 Build' : '🔨 建造');
        this._buildBtn.style.background = this._build ? '#FF9800' : '#4CAF50';
      }
      if (this._palette) {
        this._palette.style.display = this._build ? 'flex' : 'none';
        this._palette.style.bottom = bh + 'px';
      }
      if (this._hint) {
        this._hint.style.display = this._build ? 'block' : 'none';
        const top = document.getElementById('topbar');
        const t = top ? top.getBoundingClientRect().height : 56;
        this._hint.style.top = (t + 10) + 'px';
      }
    },
    toggleBuild() {
      this._build = !this._build;
      if (!this._build) { this._sel = -1; this._moving = null; Farm.state.save(); }
      this._layoutUI();
      this.render();
    },

    // ---- sizing / coords ----
    _cssW() { return window.innerWidth; },
    _cssH() {
      const top = document.getElementById('topbar');
      const bottom = document.getElementById('bottombar');
      const t = top ? top.getBoundingClientRect().height : 56;
      const b = bottom ? bottom.getBoundingClientRect().height : 64;
      return Math.max(120, window.innerHeight - t - b);
    },
    _resize() {
      const top = document.getElementById('topbar');
      const t = top ? top.getBoundingClientRect().height : 56;
      this._cv.style.top = t + 'px';
      this._cv.style.height = this._cssH() + 'px';
      this._dpr = Math.min(2, window.devicePixelRatio || 1);
      this._cv.width = this._cssW() * this._dpr;
      this._cv.height = this._cssH() * this._dpr;
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
      for (let yy = 0; yy < b.h; yy++) {
        for (let xx = 0; xx < b.w; xx++) {
          const key = (gx + xx) + ',' + (gy + yy);
          if (plotCells[key] || occ[key]) return false;
        }
      }
      return true;
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
        this._drag = null; this._moving = null;
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
          this._moving = { idx, gx: o.gx, gy: o.gy, valid: true, startX: p.x, startY: p.y, moved: false };
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
      if (this._moving) {
        if (Math.abs(p.x - this._moving.startX) + Math.abs(p.y - this._moving.startY) > 4) this._moving.moved = true;
        const o = this._map()[this._moving.idx], b = BUILDINGS[o.type];
        const cell = this._screenToCell(p.x, p.y);
        const gx = cell.gx - (b.w >> 1), gy = cell.gy - (b.h >> 1);
        this._moving.gx = gx; this._moving.gy = gy;
        this._moving.valid = this._footprintFree(gx, gy, o.type, this._moving.idx);
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

      if (this._moving) {
        const m = this._moving; this._moving = null;
        if (m.moved && m.valid) {
          const o = this._map()[m.idx];
          o.gx = m.gx; o.gy = m.gy; Farm.state.save();
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
      this._tapCell(cell.gx, cell.gy);
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
      if (!plot.crop) { Farm.shop.openSeedPickerForPlot(idx); return; }
      if (Farm.crops.isMature(plot)) { Farm.farm.harvestPlot(idx); setTimeout(() => this.render(), 50); return; }
      Farm.farm.openPlotCare(idx, plot, Farm.crops.get(plot.crop));
    },

    // ---- render ----
    _blit(key, cx, by, maxW, maxH) {
      const im = this._img[key];
      if (!im) return false;
      const s = Math.min(maxW / im.width, maxH / im.height);
      const w = im.width * s, h = im.height * s;
      this._ctx.drawImage(im, cx - w / 2, by - h, w, h);
      return true;
    },
    render() {
      if (!this._on) return;
      const ctx = this._ctx, ts = this._ts();
      const W = this._cssW(), H = this._cssH();
      ctx.clearRect(0, 0, W, H);

      // ground
      for (let gy = 0; gy < GROUND_ROWS; gy++) {
        for (let gx = 0; gx < GROUND_COLS; gx++) {
          const x = gx * ts - this._camX, y = gy * ts - this._camY;
          if (x > W || y > H || x + ts < 0 || y + ts < 0) continue;
          ctx.fillStyle = ((gx + gy) % 2 === 0) ? GRASS_A : GRASS_B;
          ctx.fillRect(x, y, ts, ts);
        }
      }
      if (this._build) this._drawGrid(ts, W, H);

      // depth-sorted drawables: plots (flat) + buildings (tall). Baseline = the
      // screen y of the bottom row, so nearer (lower) sprites draw on top.
      const draws = [];
      const plots = Farm.state.data.plots || [];
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
      draws.sort((a, c) => a.base - c.base);
      draws.forEach(d => d.fn());
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

      // Crop sprite: pick 1 of 4 growth frames by progress; grows taller.
      const p = Farm.crops.getProgress ? Farm.crops.getProgress(plot) : 1;
      const frame = p >= 1 ? 3 : p >= 0.6 ? 2 : p >= 0.25 ? 1 : 0;
      const mature = Farm.crops.isMature(plot);
      if (mature) {   // ready glow halo behind the sprite
        ctx.beginPath(); ctx.arc(cx, cy, ts * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,214,79,0.30)'; ctx.fill();
      }
      const maxH = ts * (0.5 + frame * 0.27);   // 0.50 → 1.31 tiles tall
      if (!this._blit('crop' + frame, cx, y + ts * 0.96, ts * 0.9, maxH)) {
        ctx.font = (ts * 0.42) + 'px sans-serif';
        ctx.fillText(mature ? '🥬' : '🌿', cx, cy);
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
