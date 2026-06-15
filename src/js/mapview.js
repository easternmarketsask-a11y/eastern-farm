/**
 * mapview.js — Phase-1 POC: top-down tile-map farm view (Farm.mapView)
 *
 * Goal of this POC: PROVE the "buildable map" engine works and plugs into the
 * EXISTING mechanics — without committing to art yet. Activated ONLY by ?map=1
 * so the live vertical farm is untouched.
 *
 * What it proves:
 *   - A Canvas2D tile world with a draggable camera (pan).
 *   - The existing 12 plots drawn as tiles on the map.
 *   - Tap a tile → runs the EXISTING plant / harvest / care flow
 *     (Farm.shop.openSeedPickerForPlot / Farm.farm.harvestPlot / openPlotCare).
 *   - A building (barn) drawn on the ground (depth-sorted by row).
 *
 * Art is placeholder (canvas shapes + emoji). Real top-down pixel sprites drop
 * in later by swapping the draw* helpers for image blits. State is 100% reused
 * (Farm.state.data.plots) — the map is only a VIEW.
 */
(function () {
  const TILE = 60;            // square tile size in CSS px
  const GROUND_COLS = 9;      // field bigger than screen → pannable
  const GROUND_ROWS = 11;
  // Plot block origin (top-left cell of the 3×4 plot area on the map).
  const PLOT_OX = 1, PLOT_OY = 2, PLOT_COLS = 3;
  const BARN = { gx: 5, gy: 1 };

  const mapView = {
    _on: false,
    _cv: null, _ctx: null, _dpr: 1,
    _camX: 0, _camY: 0,
    _drag: null,           // {x,y,camX,camY,moved}
    _cellToPlot: {},       // "gx,gy" -> plot index
    _tick: null,

    active() { return /[?&]map=1/.test(location.search); },

    init() {
      if (!this.active() || this._on) return;
      this._on = true;
      const farm = document.getElementById('farm');
      if (farm) farm.style.display = 'none';   // hide the vertical farm view

      const cv = document.createElement('canvas');
      cv.id = 'mapCanvas';
      cv.style.cssText = 'position:fixed;left:0;right:0;z-index:5;touch-action:none;display:block;background:#9cd36a;';
      document.body.appendChild(cv);
      this._cv = cv;
      this._ctx = cv.getContext('2d');

      this._buildLayout();
      this._resize();
      window.addEventListener('resize', () => { this._resize(); this.render(); });

      // Pointer pan + tap (works for mouse + touch via Pointer Events).
      cv.addEventListener('pointerdown', (e) => this._down(e));
      cv.addEventListener('pointermove', (e) => this._move(e));
      cv.addEventListener('pointerup', (e) => this._up(e));
      cv.addEventListener('pointercancel', () => { this._drag = null; });

      // Centre camera on the plot block.
      const c = this._tileTopLeft(PLOT_OX + 1, PLOT_OY + 2);
      this._camX = c.x - this._cssW() / 2 + TILE / 2;
      this._camY = c.y - this._cssH() / 2 + TILE / 2;
      this._clampCam();

      this._tick = setInterval(() => this.render(), 1000);  // reflect crop growth
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
    _tileTopLeft(gx, gy) { return { x: gx * TILE, y: gy * TILE }; },
    _screenToCell(sx, sy) {
      return { gx: Math.floor((sx + this._camX) / TILE), gy: Math.floor((sy + this._camY) / TILE) };
    },
    _clampCam() {
      const maxX = GROUND_COLS * TILE - this._cssW();
      const maxY = GROUND_ROWS * TILE - this._cssH();
      this._camX = Math.max(Math.min(this._camX, Math.max(0, maxX)), Math.min(0, maxX));
      this._camY = Math.max(Math.min(this._camY, Math.max(0, maxY)), Math.min(0, maxY));
    },

    // ---- input ----
    _down(e) { this._drag = { x: e.clientX, y: e.clientY, camX: this._camX, camY: this._camY, moved: false }; },
    _move(e) {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
      this._camX = this._drag.camX - dx;
      this._camY = this._drag.camY - dy;
      this._clampCam();
      this.render();
    },
    _up(e) {
      const d = this._drag; this._drag = null;
      if (!d || d.moved) return;   // was a pan, not a tap
      const rect = this._cv.getBoundingClientRect();
      const cell = this._screenToCell(e.clientX - rect.left, e.clientY - rect.top);
      this._tapCell(cell.gx, cell.gy);
    },
    _tapCell(gx, gy) {
      const idx = this._cellToPlot[gx + ',' + gy];
      if (idx == null) return;
      const plot = Farm.state.data.plots[idx];
      if (!plot || !plot.unlocked) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(Farm.i18n ? Farm.i18n.t('plot_locked_hint_template', { n: (plot && plot.unlockLevel) || '?' }) : '未解锁');
        return;
      }
      if (!plot.crop) { Farm.shop.openSeedPickerForPlot(idx); return; }
      if (Farm.crops.isMature(plot)) { Farm.farm.harvestPlot(idx); setTimeout(() => this.render(), 50); return; }
      const def = Farm.crops.get(plot.crop);
      Farm.farm.openPlotCare(idx, plot, def);
    },

    // ---- render (placeholder art) ----
    render() {
      if (!this._on) return;
      const ctx = this._ctx;
      const W = this._cssW(), H = this._cssH();
      ctx.clearRect(0, 0, W, H);
      // ground (checkered grass)
      for (let gy = 0; gy < GROUND_ROWS; gy++) {
        for (let gx = 0; gx < GROUND_COLS; gx++) {
          const p = this._tileTopLeft(gx, gy);
          const x = p.x - this._camX, y = p.y - this._camY;
          if (x > W || y > H || x + TILE < 0 || y + TILE < 0) continue;
          ctx.fillStyle = ((gx + gy) % 2 === 0) ? '#9cd36a' : '#94cc63';
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
      // barn (placeholder building)
      this._drawBarn();
      // plots
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) {
        const gx = PLOT_OX + (i % PLOT_COLS), gy = PLOT_OY + Math.floor(i / PLOT_COLS);
        this._drawPlot(plots[i], gx, gy);
      }
    },
    _drawBarn() {
      const ctx = this._ctx;
      const p = this._tileTopLeft(BARN.gx, BARN.gy);
      const x = p.x - this._camX, y = p.y - this._camY;
      const w = TILE * 1.6, h = TILE * 1.4;
      // body
      ctx.fillStyle = '#c0392b'; ctx.fillRect(x, y + h * 0.4, w, h * 0.6);
      // roof
      ctx.fillStyle = '#7a2218';
      ctx.beginPath(); ctx.moveTo(x - 4, y + h * 0.42); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w + 4, y + h * 0.42); ctx.closePath(); ctx.fill();
      // door
      ctx.fillStyle = '#f3e3b3'; ctx.fillRect(x + w * 0.38, y + h * 0.62, w * 0.24, h * 0.38);
    },
    _drawPlot(plot, gx, gy) {
      const ctx = this._ctx;
      const p = this._tileTopLeft(gx, gy);
      const x = p.x - this._camX, y = p.y - this._camY;
      const pad = 5, r = 10;
      const tx = x + pad, ty = y + pad, tw = TILE - pad * 2, th = TILE - pad * 2;
      // soil bed
      this._roundRect(tx, ty, tw, th, r);
      ctx.fillStyle = plot.unlocked ? '#a86b35' : '#8a8f80';
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = plot.unlocked ? '#6f3d24' : '#6f7466'; ctx.stroke();
      const cx = x + TILE / 2, cy = y + TILE / 2;
      if (!plot.unlocked) {
        ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🔒', cx, cy - 4);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
        ctx.fillText('Lv' + (plot.unlockLevel || ''), cx, cy + 14);
        return;
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (!plot.crop) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 22px sans-serif';
        ctx.fillText('+', cx, cy);
        return;
      }
      const mature = Farm.crops.isMature(plot);
      const stage = Farm.crops.getStage ? Farm.crops.getStage(plot) : (mature ? 2 : 1);
      if (mature) {
        // golden ready glow
        ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,214,79,0.35)'; ctx.fill();
        ctx.font = '30px sans-serif'; ctx.fillText('🥬', cx, cy);
      } else {
        ctx.font = (stage >= 1 ? '24px' : '18px') + ' sans-serif';
        ctx.fillText(stage >= 1 ? '🌿' : '🌱', cx, cy);
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
