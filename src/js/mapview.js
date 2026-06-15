/**
 * mapview.js — Phase-1 POC: top-down tile-map farm view (Farm.mapView)
 *
 * Activated ONLY by ?map=1 so the live vertical farm is untouched. Proves a
 * Canvas2D tile world (pan + pinch/wheel zoom) that renders the EXISTING 12
 * plots and runs the EXISTING plant/harvest/care flow on tap. Art is placeholder
 * (canvas shapes + emoji) — real top-down pixel sprites drop in by swapping the
 * draw* helpers. State is 100% reused (Farm.state.data.plots); map is only a VIEW.
 */
(function () {
  const TILE = 60;            // base tile size (CSS px) at zoom = 1
  const GROUND_COLS = 9;
  const GROUND_ROWS = 11;
  const PLOT_OX = 1, PLOT_OY = 2, PLOT_COLS = 3;
  const BARN = { gx: 5, gy: 1 };
  const HOUSE = { gx: 6, gy: 4 };   // shop/cottage (decorative in POC)
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

  const mapView = {
    _on: false,
    _cv: null, _ctx: null, _dpr: 1,
    _camX: 0, _camY: 0, _zoom: 1,
    _cellToPlot: {},
    _tick: null,
    _pointers: {},          // pointerId -> {x,y} (canvas-local)
    _drag: null,            // single-pointer pan/tap state
    _pinch: null,           // {dist, zoom} when 2 pointers down
    _img: {},               // key -> HTMLImageElement (ready ones only)

    _loadAssets() {
      Object.keys(ASSET_SRC).forEach((key) => {
        const im = new Image();
        im.onload = () => { this._img[key] = im; if (this._on) this.render(); };
        im.src = ASSET_DIR + ASSET_SRC[key];
      });
    },
    // Draw img scaled to fit (maxW,maxH) preserving aspect, anchored at
    // bottom-center (cx, by). Returns false if not loaded yet.
    _blit(key, cx, by, maxW, maxH) {
      const im = this._img[key];
      if (!im) return false;
      const s = Math.min(maxW / im.width, maxH / im.height);
      const w = im.width * s, h = im.height * s;
      this._ctx.drawImage(im, cx - w / 2, by - h, w, h);
      return true;
    },

    active() { return /[?&]map=1/.test(location.search); },
    _ts() { return TILE * this._zoom; },

    init() {
      if (!this.active() || this._on) return;
      this._on = true;
      const farm = document.getElementById('farm');
      if (farm) farm.style.display = 'none';

      const cv = document.createElement('canvas');
      cv.id = 'mapCanvas';
      cv.style.cssText = 'position:fixed;left:0;right:0;z-index:5;touch-action:none;display:block;background:#9cd36a;';
      document.body.appendChild(cv);
      this._cv = cv;
      this._ctx = cv.getContext('2d');

      this._loadAssets();
      this._buildLayout();
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

    _buildLayout() {
      this._cellToPlot = {};
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) {
        const gx = PLOT_OX + (i % PLOT_COLS);
        const gy = PLOT_OY + Math.floor(i / PLOT_COLS);
        this._cellToPlot[gx + ',' + gy] = i;
      }
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

    // ---- input (pan + tap + pinch + wheel) ----
    _local(e) { const r = this._cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
    _down(e) {
      const p = this._local(e);
      this._pointers[e.pointerId] = p;
      const ids = Object.keys(this._pointers);
      if (ids.length === 2) {
        const [a, b] = ids.map(k => this._pointers[k]);
        this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._zoom };
        this._drag = null;
      } else {
        this._drag = { x: p.x, y: p.y, camX: this._camX, camY: this._camY, moved: false };
      }
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
      if (this._drag) {
        const p = this._pointers[e.pointerId];
        const dx = p.x - this._drag.x, dy = p.y - this._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
        this._camX = this._drag.camX - dx;
        this._camY = this._drag.camY - dy;
        this._clampCam();
        this.render();
      }
    },
    _up(e) {
      const wasTap = this._drag && !this._drag.moved && !this._pinch;
      const p = this._pointers[e.pointerId];
      delete this._pointers[e.pointerId];
      if (Object.keys(this._pointers).length < 2) this._pinch = null;
      if (wasTap && p) {
        const cell = this._screenToCell(p.x, p.y);
        this._tapCell(cell.gx, cell.gy);
      }
      this._drag = null;
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

    // ---- render (placeholder art, scales with zoom) ----
    render() {
      if (!this._on) return;
      const ctx = this._ctx, ts = this._ts();
      const W = this._cssW(), H = this._cssH();
      ctx.clearRect(0, 0, W, H);
      for (let gy = 0; gy < GROUND_ROWS; gy++) {
        for (let gx = 0; gx < GROUND_COLS; gx++) {
          const x = gx * ts - this._camX, y = gy * ts - this._camY;
          if (x > W || y > H || x + ts < 0 || y + ts < 0) continue;
          ctx.fillStyle = ((gx + gy) % 2 === 0) ? GRASS_A : GRASS_B;
          ctx.fillRect(x, y, ts, ts);
        }
      }
      this._drawBarn(ts);
      this._drawHouse(ts);
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) {
        const gx = PLOT_OX + (i % PLOT_COLS), gy = PLOT_OY + Math.floor(i / PLOT_COLS);
        this._drawPlot(plots[i], gx, gy, i, ts);
      }
    },
    _drawBarn(ts) {
      const x = BARN.gx * ts - this._camX, y = BARN.gy * ts - this._camY;
      const cx = x + ts, by = y + ts * 1.7;   // span ~2 cells, anchored low
      if (this._blit('barn', cx, by, ts * 2.1, ts * 1.9)) return;
      const ctx = this._ctx;            // fallback while image loads
      ctx.fillStyle = '#c0392b'; ctx.fillRect(x, y + ts * 0.6, ts * 1.6, ts * 0.9);
    },
    _drawHouse(ts) {
      const x = HOUSE.gx * ts - this._camX, y = HOUSE.gy * ts - this._camY;
      this._blit('house', x + ts, y + ts * 1.8, ts * 2.2, ts * 2.4);
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
