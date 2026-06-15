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
  const COLS = 9, ROWS = 11;
  const PLOT_OX = 1, PLOT_OY = 2, PLOT_COLS = 3;
  const TW = 92, TH = 46;          // diamond width/height at zoom 1 (2:1 iso)
  const ZMIN = 0.55, ZMAX = 1.7;
  const REQUIRED_LV = { 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 4, 10: 5, 11: 5 };
  const GRASS_A = '#8bbf5a', GRASS_B = '#83b653', GRASS_EDGE = 'rgba(60,90,40,0.18)';
  const SOIL_TOP = '#9c6b3f', SOIL_FURROW = 'rgba(80,50,26,0.5)';
  const ASSET_DIR = 'assets/images/map/';
  const ASSET_SRC = {
    barn: 'barn.png', house: 'house.png', greenhouse: 'greenhouse.png', coop: 'coop.png', tree: 'tree.png',
    crop0: 'crop_qingcai_0.png', crop1: 'crop_qingcai_1.png', crop2: 'crop_qingcai_2.png', crop3: 'crop_qingcai_3.png',
  };
  const BUILDINGS = {
    barn: { img: 'barn', w: 2, h: 2, sc: 2.2, tap: 'warehouse' },
    house: { img: 'house', w: 2, h: 2, sc: 2.5, tap: 'shop' },
    greenhouse: { img: 'greenhouse', w: 2, h: 2, sc: 2.1 },
    coop: { img: 'coop', w: 2, h: 2, sc: 2.0 },
    tree: { img: 'tree', w: 1, h: 1, sc: 1.7 },
  };
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

    active() { return /[?&]iso=1/.test(location.search); },
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
      cv.style.cssText = 'position:fixed;z-index:5;touch-action:none;display:block;background:#86b030;';
      document.body.appendChild(cv);
      this._cv = cv; this._ctx = cv.getContext('2d');

      Object.keys(ASSET_SRC).forEach((k) => { const im = new Image(); im.onload = () => { this._img[k] = im; if (this._on) this.render(); }; im.src = ASSET_DIR + ASSET_SRC[k]; });
      this._buildLayout();
      this._resize();
      window.addEventListener('resize', () => { this._resize(); this._clampCam(); this.render(); });
      cv.addEventListener('pointerdown', (e) => this._down(e));
      cv.addEventListener('pointermove', (e) => this._move(e));
      cv.addEventListener('pointerup', (e) => this._up(e));
      cv.addEventListener('pointercancel', (e) => this._up(e));
      cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });

      this._autoFrame();

      requestAnimationFrame(() => { this._syncSize(); this.render(); });
      this._tick = setInterval(() => { this._syncSize(); this.render(); }, 1000);
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
    // Fit the whole COLS×ROWS iso map within the canvas, centered, on load.
    _autoFrame() {
      const spanX = (COLS + ROWS) * TW / 2, spanY = (COLS + ROWS) * TH / 2 + TH * 4;
      this._zoom = Math.min(ZMAX, Math.max(ZMIN, Math.min(this._cssW() / (spanX * 1.06), this._cssH() / (spanY * 1.0))));
      const ccx = (COLS - 1) / 2, ccy = (ROWS - 1) / 2, u = ccx - ccy, v = ccx + ccy;
      this._camX = u * this._tw() / 2;
      this._camY = this._oy + v * this._th() / 2 - this._cssH() / 2;
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
      if (ids.length === 2) { const [a, b] = ids.map(k => this._pointers[k]); this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._zoom }; this._drag = null; return; }
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
      if (this._drag) {
        const p = this._pointers[e.pointerId], dx = p.x - this._drag.x, dy = p.y - this._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
        this._camX = this._drag.camX - dx; this._camY = this._drag.camY - dy; this._clampCam(); this.render();
      }
    },
    _up(e) {
      const p = this._pointers[e.pointerId]; delete this._pointers[e.pointerId];
      if (Object.keys(this._pointers).length < 2) this._pinch = null;
      const wasTap = this._drag && !this._drag.moved && !this._pinch; this._drag = null;
      if (!wasTap || !p) return;
      const c = this._screenToCell(p.x, p.y); this._tapCell(c.gx, c.gy);
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

    // ---- render ----
    _blit(im, cx, by, maxW, maxH) { if (!im) return false; const s = Math.min(maxW / im.width, maxH / im.height), w = im.width * s, h = im.height * s; this._ctx.drawImage(im, cx - w / 2, by - h, w, h); return true; },
    _cropSprite(id) {
      const c = this._cropImg[id]; if (c instanceof Image) return c; if (c === true || c === false) return null;
      const url = (Farm.cropArt && Farm.cropArt.spriteUrl) ? Farm.cropArt.spriteUrl(id) : null;
      if (!url) { this._cropImg[id] = true; return null; }
      this._cropImg[id] = false; const im = new Image(); im.onload = () => { this._cropImg[id] = im; if (this._on) this.render(); }; im.onerror = () => { this._cropImg[id] = true; }; im.src = url; return null;
    },
    _diamond(x, y, tw, th) { const c = this._ctx; c.beginPath(); c.moveTo(x, y - th / 2); c.lineTo(x + tw / 2, y); c.lineTo(x, y + th / 2); c.lineTo(x - tw / 2, y); c.closePath(); },
    _startLoop() {
      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        if (!this._on || document.hidden) return;
        const modal = document.getElementById('modal'); if (modal && !modal.classList.contains('hidden')) return;
        const now = Date.now(); if (now - this._lastFrame < 66) return; this._lastFrame = now; this.render();
      };
      this._raf = requestAnimationFrame(loop);
    },
    render() {
      if (!this._on) return;
      const ctx = this._ctx, tw = this._tw(), th = this._th(), W = this._cssW(), H = this._cssH();
      ctx.clearRect(0, 0, W, H);

      // ground diamonds (back-to-front) with a raised-island earth skirt on the
      // front (east/south) boundary edges — the signature Hay Day "farm island".
      const sk = th * 1.5;
      for (let s = 0; s <= (COLS - 1) + (ROWS - 1); s++) {
        for (let gx = 0; gx < COLS; gx++) {
          const gy = s - gx; if (gy < 0 || gy >= ROWS) continue;
          const c = this._cell(gx, gy);
          if (c.x + tw < 0 || c.x - tw > W || c.y + th + sk < 0 || c.y - th > H) continue;
          if (gx + 1 >= COLS) {   // east face (screen lower-right)
            ctx.beginPath(); ctx.moveTo(c.x + tw / 2, c.y); ctx.lineTo(c.x, c.y + th / 2);
            ctx.lineTo(c.x, c.y + th / 2 + sk); ctx.lineTo(c.x + tw / 2, c.y + sk); ctx.closePath();
            ctx.fillStyle = '#9a6532'; ctx.fill();
          }
          if (gy + 1 >= ROWS) {   // south face (screen lower-left, darker)
            ctx.beginPath(); ctx.moveTo(c.x, c.y + th / 2); ctx.lineTo(c.x - tw / 2, c.y);
            ctx.lineTo(c.x - tw / 2, c.y + sk); ctx.lineTo(c.x, c.y + th / 2 + sk); ctx.closePath();
            ctx.fillStyle = '#7d4f25'; ctx.fill();
          }
          this._diamond(c.x, c.y, tw, th);
          ctx.fillStyle = ((gx + gy) % 2 === 0) ? GRASS_A : GRASS_B; ctx.fill();
          ctx.strokeStyle = GRASS_EDGE; ctx.lineWidth = 1; ctx.stroke();
        }
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
        draws.push({ d: (o.gx + o.gy) + (b.w - 1) + (b.h - 1) + 0.5, fn: () => this._drawBuilding(o, b) });
      }
      draws.sort((a, c) => a.d - c.d); draws.forEach(x => x.fn());

      this._drawParticles(tw); this._drawFestival();
    },
    _drawPlot(plot, gx, gy, idx) {
      const ctx = this._ctx, tw = this._tw(), th = this._th(), c = this._cell(gx, gy);
      if (!plot.unlocked) {
        this._diamond(c.x, c.y, tw * 0.94, th * 0.94); ctx.fillStyle = 'rgba(92,98,86,0.82)'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = (th * 0.55) + 'px sans-serif'; ctx.fillText('🔒', c.x, c.y - th * 0.1);
        ctx.font = 'bold ' + (th * 0.42) + 'px "Fredoka",sans-serif'; ctx.fillText('Lv' + (REQUIRED_LV[idx] || 2), c.x, c.y + th * 0.38);
        return;
      }
      // tilled soil diamond + furrows
      this._diamond(c.x, c.y, tw * 0.94, th * 0.94); ctx.fillStyle = SOIL_TOP; ctx.fill();
      ctx.strokeStyle = SOIL_FURROW; ctx.lineWidth = Math.max(1, th * 0.06);
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(c.x - tw * 0.35 + k * tw * 0.16, c.y + k * th * 0.16 + th * 0.0);
        ctx.lineTo(c.x + tw * 0.12 + k * tw * 0.16, c.y + k * th * 0.16 + th * 0.24);
        ctx.stroke();
      }
      if (!plot.crop) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + (th * 0.6) + 'px sans-serif'; ctx.fillText('+', c.x, c.y); return;
      }
      const p = Farm.crops.getProgress ? Farm.crops.getProgress(plot) : 1, mature = Farm.crops.isMature(plot);
      const by = c.y + th * 0.2;   // sprite stands on the diamond
      if (mature) { const t = Date.now() / 1000, ph = Math.sin(t * 2 + gx + gy); ctx.beginPath(); ctx.arc(c.x, c.y - th * 0.1, tw * (0.34 + ph * 0.02), 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,214,79,' + (0.3 + ph * 0.08) + ')'; ctx.fill(); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      if (plot.crop === 'shanghai_miao') {
        const fr = p >= 1 ? 3 : p >= 0.6 ? 2 : p >= 0.25 ? 1 : 0;
        if (!this._blit(this._img['crop' + fr], c.x, by, tw * 0.8, th * (1.6 + fr * 0.9))) { ctx.font = (th) + 'px sans-serif'; ctx.fillText(mature ? '🥬' : '🌿', c.x, by); }
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
    _drawBuilding(o, b) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      const cc = this._cell(o.gx + (b.w - 1) / 2, o.gy + (b.h - 1) / 2);
      const front = this._cell(o.gx + (b.w - 1), o.gy + (b.h - 1));
      const by = front.y + th / 2 + th * 0.1;        // base sits on the front diamond
      if (!this._blit(this._img[b.img], cc.x, by, b.w * tw * 0.6, b.sc * th * 2.0)) { ctx.fillStyle = '#c0392b'; ctx.fillRect(cc.x - tw * 0.4, by - th, tw * 0.8, th); }
    },
    _drawParticles(tw) {
      const season = (Farm.seasons && Farm.seasons.current) || monthSeason(), set = SEASON_PARTICLES[season];
      if (!set) return;
      const ctx = this._ctx, W = this._cssW(), H = this._cssH(), t = Date.now() / 1000;
      ctx.save(); ctx.globalAlpha = 0.8; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < 16; i++) {
        const sp = 16 + (i % 5) * 7, x = (i * 53.7) % W, sway = Math.sin(t * 0.8 + i) * 13, y = ((t * sp + i * 41) % (H + 40)) - 20;
        ctx.font = (this._th() * 0.5 + (i % 3) * 3) + 'px sans-serif'; ctx.fillText(set[i % set.length], x + sway, y);
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
