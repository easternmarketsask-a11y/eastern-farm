/**
 * crop-art.js — Inline SVG sprite generator for crops.
 *
 * API:
 *   Farm.cropArt.svg(cropId, stage, sizePx, opts)
 *     cropId   string  — id from crops.json (e.g. 'qingcai', 'tomato', 'kumquat')
 *     stage    0|1|2   — 0 = seed, 1 = sprout, 2 = mature (bespoke per crop)
 *     sizePx   number  — render size in pixels (square). Default 64.
 *     opts     { bare?: boolean }  — bare:true hides the soil ellipse
 *
 *   Returns a <svg> string. ViewBox is 100×100 for all sprites so they tile
 *   consistently. Color is read from the crop's `color` field in crops.json
 *   so Chris can re-theme without touching this file.
 *
 *   Stage 0 + 1 sprites are generic (sprout shape that hints at the crop's
 *   final color). Stage 2 is hand-authored per crop in `matureArt`.
 *   Unknown cropId for stage 2 falls back to a generic sprout silhouette.
 */
(function() {
  function clamp(n) { return Math.max(0, Math.min(255, n)); }
  function darken(hex, amt) {
    const r = clamp(parseInt(hex.slice(1, 3), 16) - Math.round(255 * amt));
    const g = clamp(parseInt(hex.slice(3, 5), 16) - Math.round(255 * amt));
    const b = clamp(parseInt(hex.slice(5, 7), 16) - Math.round(255 * amt));
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  function lighten(hex, amt) {
    const r = clamp(parseInt(hex.slice(1, 3), 16) + Math.round(255 * amt));
    const g = clamp(parseInt(hex.slice(3, 5), 16) + Math.round(255 * amt));
    const b = clamp(parseInt(hex.slice(5, 7), 16) + Math.round(255 * amt));
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  }

  const SOIL = '<ellipse cx="50" cy="92" rx="40" ry="6" fill="#5d3a23" opacity="0.45"/>';

  function genericSeed(color) {
    const c = color || '#7cb342';
    const light = lighten(c, 0.12);
    return `
      <path d="M 50 90 Q 47 78 42 73" stroke="${c}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <ellipse cx="40" cy="71" rx="6" ry="3.5" fill="${c}" transform="rotate(-35 40 71)"/>
      <path d="M 50 90 Q 53 80 58 76" stroke="${c}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <ellipse cx="60" cy="73" rx="6" ry="3.5" fill="${light}" transform="rotate(35 60 73)"/>
      <ellipse cx="50" cy="90" rx="3" ry="1.5" fill="#3d2614" opacity="0.6"/>
    `;
  }

  function genericSprout(color) {
    const c = color || '#6ab04c';
    const dark = darken(c, 0.18);
    const light = lighten(c, 0.1);
    return `
      <path d="M 50 90 L 50 55" stroke="${dark}" stroke-width="2" fill="none"/>
      <ellipse cx="36" cy="60" rx="10" ry="5" fill="${c}" transform="rotate(-25 36 60)"/>
      <ellipse cx="64" cy="62" rx="10" ry="5" fill="${light}" transform="rotate(25 64 62)"/>
      <ellipse cx="40" cy="46" rx="9" ry="4.5" fill="${c}" transform="rotate(-15 40 46)"/>
      <ellipse cx="60" cy="44" rx="9" ry="4.5" fill="${light}" transform="rotate(15 60 44)"/>
      <path d="M 50 55 L 50 75" stroke="${dark}" stroke-width="0.8" fill="none" opacity="0.6"/>
    `;
  }

  const matureArt = {
    qingcai(c) {
      const leaf = c || '#7cb342';
      const dark = darken(leaf, 0.22);
      const hi = lighten(leaf, 0.15);
      return `
        <path d="M 34 88 Q 36 75 42 60 Q 50 56 58 60 Q 64 75 66 88 Z" fill="#fff8e7" stroke="#d8c8a0" stroke-width="1.2"/>
        <path d="M 44 84 L 44 60" stroke="#cfbb8b" stroke-width="0.7" fill="none"/>
        <path d="M 56 84 L 56 60" stroke="#cfbb8b" stroke-width="0.7" fill="none"/>
        <path d="M 50 60 Q 28 56 24 38 Q 30 20 50 26 Q 70 20 76 38 Q 72 56 50 60 Z" fill="${leaf}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M 50 28 L 50 56" stroke="${dark}" stroke-width="1" fill="none" opacity="0.6"/>
        <path d="M 36 32 Q 42 42 46 52" stroke="${dark}" stroke-width="0.7" fill="none" opacity="0.5"/>
        <path d="M 64 32 Q 58 42 54 52" stroke="${dark}" stroke-width="0.7" fill="none" opacity="0.5"/>
        <ellipse cx="40" cy="34" rx="7" ry="3.5" fill="${hi}" opacity="0.55"/>
      `;
    },
    tomato(c) {
      const red = c || '#e94d3f';
      const dark = darken(red, 0.18);
      return `
        <circle cx="50" cy="58" r="28" fill="${red}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M 50 32 Q 48 58 50 82" stroke="${dark}" stroke-width="0.7" fill="none" opacity="0.4"/>
        <path d="M 32 40 Q 28 58 32 78" stroke="${dark}" stroke-width="0.7" fill="none" opacity="0.4"/>
        <path d="M 68 40 Q 72 58 68 78" stroke="${dark}" stroke-width="0.7" fill="none" opacity="0.4"/>
        <ellipse cx="40" cy="48" rx="9" ry="5" fill="#fff" opacity="0.35"/>
        <path d="M 50 32 L 50 22" stroke="#558b2f" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M 42 28 L 50 32 L 58 28 L 56 22 L 50 26 L 44 22 Z" fill="#6ab04c" stroke="#3a7d2c" stroke-width="0.8"/>
        <path d="M 44 62 Q 50 66 56 62" stroke="${dark}" stroke-width="1.2" fill="none" opacity="0.55" stroke-linecap="round"/>
      `;
    },
    cucumber(c) {
      const green = c || '#5c8e3d';
      const dark = darken(green, 0.2);
      const hi = lighten(green, 0.15);
      return `
        <g transform="rotate(-22 50 58)">
          <rect x="28" y="44" width="44" height="28" rx="14" fill="${green}" stroke="${dark}" stroke-width="1.5"/>
          <circle cx="38" cy="52" r="1.4" fill="${dark}" opacity="0.55"/>
          <circle cx="48" cy="50" r="1.4" fill="${dark}" opacity="0.55"/>
          <circle cx="58" cy="54" r="1.4" fill="${dark}" opacity="0.55"/>
          <circle cx="42" cy="62" r="1.4" fill="${dark}" opacity="0.55"/>
          <circle cx="54" cy="64" r="1.4" fill="${dark}" opacity="0.55"/>
          <circle cx="64" cy="60" r="1.4" fill="${dark}" opacity="0.55"/>
          <path d="M 32 50 Q 50 56 70 52" stroke="${darken(green, 0.08)}" stroke-width="1" fill="none" opacity="0.5"/>
          <path d="M 32 64 Q 50 70 70 66" stroke="${darken(green, 0.08)}" stroke-width="1" fill="none" opacity="0.5"/>
          <ellipse cx="38" cy="50" rx="8" ry="2.5" fill="${hi}" opacity="0.55"/>
          <ellipse cx="28" cy="58" rx="3" ry="4" fill="#7d3" opacity="0.7"/>
        </g>
        <ellipse cx="30" cy="34" rx="9" ry="5" fill="#6ab04c" transform="rotate(-35 30 34)"/>
        <path d="M 35 36 Q 32 30 28 28" stroke="#3a7d2c" stroke-width="1" fill="none"/>
      `;
    },
    chili(c) {
      const red = c || '#d62828';
      const dark = darken(red, 0.22);
      return `
        <path d="M 32 28 Q 48 22 62 38 Q 76 60 64 80 Q 54 90 44 80 Q 32 60 32 28 Z" fill="${red}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M 40 32 Q 52 44 58 60" stroke="#fff" stroke-width="2.5" fill="none" opacity="0.35" stroke-linecap="round"/>
        <path d="M 32 28 L 26 18" stroke="#558b2f" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M 24 22 Q 32 18 40 26 Q 36 32 30 30 Q 26 28 24 22 Z" fill="#7cb342" stroke="#558b2f" stroke-width="1"/>
        <path d="M 50 30 Q 48 25 44 22" stroke="#3a7d2c" stroke-width="0.8" fill="none"/>
      `;
    },
    eggplant(c) {
      const purple = c || '#7d3c98';
      const dark = darken(purple, 0.2);
      return `
        <g transform="rotate(-12 50 58)">
          <ellipse cx="52" cy="58" rx="20" ry="32" fill="${purple}" stroke="${dark}" stroke-width="1.5"/>
          <path d="M 38 42 Q 38 60 44 76" stroke="#fff" stroke-width="3" fill="none" opacity="0.28" stroke-linecap="round"/>
        </g>
        <g transform="translate(42 28) rotate(-12)">
          <path d="M 0 0 Q -6 4 -12 2 Q -10 9 -2 11 Z" fill="#6ab04c" stroke="#3a7d2c" stroke-width="0.8"/>
          <path d="M 0 0 Q 6 4 12 2 Q 10 9 2 11 Z" fill="#6ab04c" stroke="#3a7d2c" stroke-width="0.8"/>
          <path d="M -1 0 Q -3 8 -1 16 L 1 16 Q 3 8 1 0 Z" fill="#558b2f" stroke="#3a7d2c" stroke-width="0.8"/>
          <path d="M 0 0 L 3 -10" stroke="#558b2f" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        </g>
      `;
    },
    jiucai(c) {
      const green = c || '#558b2f';
      const dark = darken(green, 0.2);
      const light = lighten(green, 0.18);
      return `
        <path d="M 36 88 L 30 28 L 34 26 Z" fill="${green}" stroke="${dark}" stroke-width="0.8"/>
        <path d="M 42 88 L 40 20 L 44 20 Z" fill="${light}" stroke="${dark}" stroke-width="0.8"/>
        <path d="M 48 88 L 47 14 L 51 14 Z" fill="${green}" stroke="${dark}" stroke-width="0.8"/>
        <path d="M 54 88 L 56 22 L 60 22 Z" fill="${light}" stroke="${dark}" stroke-width="0.8"/>
        <path d="M 60 88 L 64 28 L 68 28 Z" fill="${green}" stroke="${dark}" stroke-width="0.8"/>
        <path d="M 66 88 L 70 36 L 74 36 Z" fill="${light}" stroke="${dark}" stroke-width="0.8"/>
        <ellipse cx="50" cy="85" rx="20" ry="3" fill="#a86c44" stroke="#6d4528" stroke-width="0.8"/>
        <path d="M 32 85 L 32 86 M 68 85 L 68 86" stroke="#6d4528" stroke-width="0.6"/>
      `;
    },
    garlic(c) {
      const cream = c || '#f4e8c1';
      const dark = darken(cream, 0.18);
      return `
        <ellipse cx="50" cy="68" rx="22" ry="20" fill="${cream}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M 50 50 Q 40 65 38 86" stroke="${dark}" stroke-width="0.7" fill="none" opacity="0.7"/>
        <path d="M 50 50 Q 60 65 62 86" stroke="${dark}" stroke-width="0.7" fill="none" opacity="0.7"/>
        <path d="M 50 50 L 50 88" stroke="${dark}" stroke-width="0.7" fill="none" opacity="0.7"/>
        <ellipse cx="42" cy="60" rx="5" ry="9" fill="#fff" opacity="0.4"/>
        <path d="M 50 50 Q 46 38 42 26" stroke="#7cb342" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 50 50 Q 50 36 50 20" stroke="#6ab04c" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M 50 50 Q 54 38 58 26" stroke="#7cb342" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 46 88 L 44 94 M 50 88 L 50 95 M 54 88 L 56 94" stroke="${dark}" stroke-width="0.8" stroke-linecap="round"/>
      `;
    },
    cilantro(c) {
      const green = c || '#81c784';
      const dark = darken(green, 0.22);
      const light = lighten(green, 0.12);
      return `
        <path d="M 50 88 Q 42 72 36 52" stroke="${dark}" stroke-width="1.2" fill="none"/>
        <path d="M 50 88 Q 50 65 50 38" stroke="${dark}" stroke-width="1.2" fill="none"/>
        <path d="M 50 88 Q 58 72 64 52" stroke="${dark}" stroke-width="1.2" fill="none"/>
        <g fill="${green}" stroke="${dark}" stroke-width="0.5">
          <circle cx="32" cy="48" r="3"/><circle cx="36" cy="44" r="3"/><circle cx="40" cy="48" r="3"/><circle cx="36" cy="52" r="3"/>
        </g>
        <g fill="${light}" stroke="${dark}" stroke-width="0.5">
          <circle cx="46" cy="34" r="3"/><circle cx="50" cy="30" r="3.5"/><circle cx="54" cy="34" r="3"/><circle cx="50" cy="40" r="3"/>
        </g>
        <g fill="${green}" stroke="${dark}" stroke-width="0.5">
          <circle cx="60" cy="48" r="3"/><circle cx="64" cy="44" r="3"/><circle cx="68" cy="48" r="3"/><circle cx="64" cy="52" r="3"/>
        </g>
      `;
    },

    // ============ New crops (sales-data catalog, 2026-05-24) ============
    // shanghai_miao reuses the qingcai shape (same vegetable family,
    // miao is just the younger form)
    shanghai_miao(c) { return matureArt.qingcai(c); },

    xiao_cong(c) {
      const green = c || '#7cb342';
      const dark = darken(green, 0.22);
      const light = lighten(green, 0.18);
      const white = '#fff8e7';
      return `
        <ellipse cx="50" cy="88" rx="14" ry="3" fill="#a86c44" stroke="#6d4528" stroke-width="0.6"/>
        <rect x="44" y="62" width="3" height="26" rx="1.5" fill="${white}" stroke="#d8c8a0" stroke-width="0.6"/>
        <rect x="49" y="60" width="3" height="28" rx="1.5" fill="${white}" stroke="#d8c8a0" stroke-width="0.6"/>
        <rect x="54" y="62" width="3" height="26" rx="1.5" fill="${white}" stroke="#d8c8a0" stroke-width="0.6"/>
        <path d="M 45 62 L 38 16" stroke="${dark}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M 45 62 L 42 14" stroke="${green}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 50.5 60 L 48 10" stroke="${dark}" stroke-width="2.3" fill="none" stroke-linecap="round"/>
        <path d="M 50.5 60 L 52 12" stroke="${light}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 55 62 L 60 14" stroke="${dark}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M 55 62 L 62 18" stroke="${green}" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
    },

    you_mai_cai(c) {
      const green = c || '#9ccc65';
      const dark = darken(green, 0.22);
      const light = lighten(green, 0.15);
      return `
        <ellipse cx="50" cy="86" rx="14" ry="3" fill="${darken(green, 0.3)}"/>
        <path d="M 36 86 Q 30 60 36 30 Q 40 28 42 30 Q 42 60 44 86 Z" fill="${green}" stroke="${dark}" stroke-width="1"/>
        <path d="M 46 86 Q 42 50 46 18 Q 50 16 52 18 Q 50 50 50 86 Z" fill="${light}" stroke="${dark}" stroke-width="1"/>
        <path d="M 54 86 Q 56 56 60 26 Q 64 24 66 26 Q 62 56 60 86 Z" fill="${green}" stroke="${dark}" stroke-width="1"/>
        <path d="M 40 80 L 40 32" stroke="${dark}" stroke-width="0.6" opacity="0.5"/>
        <path d="M 50 80 L 50 22" stroke="${dark}" stroke-width="0.6" opacity="0.5"/>
        <path d="M 60 80 L 60 30" stroke="${dark}" stroke-width="0.6" opacity="0.5"/>
      `;
    },

    cai_xin(c) {
      const green = c || '#7cb342';
      const dark = darken(green, 0.22);
      const yellow = '#fff176';
      return `
        <ellipse cx="50" cy="86" rx="14" ry="3" fill="${darken(green, 0.3)}"/>
        <path d="M 38 86 Q 34 64 36 40" stroke="${dark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M 50 86 Q 50 60 50 32" stroke="${dark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M 62 86 Q 66 64 64 40" stroke="${dark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <ellipse cx="32" cy="50" rx="9" ry="6" fill="${green}" stroke="${dark}" stroke-width="0.8" transform="rotate(-30 32 50)"/>
        <ellipse cx="68" cy="50" rx="9" ry="6" fill="${green}" stroke="${dark}" stroke-width="0.8" transform="rotate(30 68 50)"/>
        <ellipse cx="42" cy="36" rx="7" ry="5" fill="${lighten(green, 0.1)}" stroke="${dark}" stroke-width="0.8" transform="rotate(-20 42 36)"/>
        <ellipse cx="58" cy="36" rx="7" ry="5" fill="${lighten(green, 0.1)}" stroke="${dark}" stroke-width="0.8" transform="rotate(20 58 36)"/>
        <g fill="${yellow}" stroke="#e6b800" stroke-width="0.4">
          <circle cx="50" cy="28" r="2.5"/>
          <circle cx="45" cy="24" r="2"/>
          <circle cx="55" cy="24" r="2"/>
          <circle cx="48" cy="20" r="1.8"/>
          <circle cx="52" cy="20" r="1.8"/>
        </g>
      `;
    },

    ji_mao_cai(c) {
      const green = c || '#aed581';
      const dark = darken(green, 0.22);
      const white = '#fff8e7';
      return `
        <path d="M 38 88 Q 40 78 44 68 Q 50 66 56 68 Q 60 78 62 88 Z" fill="${white}" stroke="#d8c8a0" stroke-width="1"/>
        <path d="M 50 68 Q 32 65 30 50 Q 36 36 50 40 Q 64 36 70 50 Q 68 65 50 68 Z" fill="${green}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M 50 40 L 50 66" stroke="${dark}" stroke-width="0.6" opacity="0.6"/>
        <path d="M 38 43 Q 42 50 46 60" stroke="${dark}" stroke-width="0.5" opacity="0.5" fill="none"/>
        <path d="M 62 43 Q 58 50 54 60" stroke="${dark}" stroke-width="0.5" opacity="0.5" fill="none"/>
        <ellipse cx="40" cy="45" rx="5" ry="2.5" fill="${lighten(green, 0.18)}" opacity="0.55"/>
      `;
    },

    tong_hao(c) {
      const green = c || '#8bc34a';
      const dark = darken(green, 0.22);
      const light = lighten(green, 0.15);
      return `
        <ellipse cx="50" cy="86" rx="14" ry="3" fill="${darken(green, 0.3)}"/>
        <path d="M 40 86 Q 34 60 30 32" stroke="${dark}" stroke-width="1.5" fill="none"/>
        <path d="M 50 86 Q 50 56 50 22" stroke="${dark}" stroke-width="1.5" fill="none"/>
        <path d="M 60 86 Q 66 60 70 32" stroke="${dark}" stroke-width="1.5" fill="none"/>
        <g fill="${green}" stroke="${dark}" stroke-width="0.4">
          <ellipse cx="30" cy="32" rx="3" ry="1.5" transform="rotate(-30 30 32)"/>
          <ellipse cx="34" cy="36" rx="3" ry="1.5" transform="rotate(20 34 36)"/>
          <ellipse cx="26" cy="38" rx="3" ry="1.5" transform="rotate(-60 26 38)"/>
          <ellipse cx="30" cy="44" rx="3" ry="1.5" transform="rotate(0 30 44)"/>
          <ellipse cx="36" cy="50" rx="3" ry="1.5" transform="rotate(45 36 50)"/>
          <ellipse cx="28" cy="52" rx="3" ry="1.5" transform="rotate(-30 28 52)"/>
        </g>
        <g fill="${light}" stroke="${dark}" stroke-width="0.4">
          <ellipse cx="50" cy="22" rx="3.5" ry="1.6"/>
          <ellipse cx="46" cy="28" rx="3" ry="1.5" transform="rotate(-30 46 28)"/>
          <ellipse cx="54" cy="28" rx="3" ry="1.5" transform="rotate(30 54 28)"/>
          <ellipse cx="50" cy="36" rx="3" ry="1.5"/>
          <ellipse cx="44" cy="42" rx="3" ry="1.5" transform="rotate(-30 44 42)"/>
          <ellipse cx="56" cy="42" rx="3" ry="1.5" transform="rotate(30 56 42)"/>
          <ellipse cx="50" cy="50" rx="3" ry="1.5"/>
        </g>
        <g fill="${green}" stroke="${dark}" stroke-width="0.4">
          <ellipse cx="70" cy="32" rx="3" ry="1.5" transform="rotate(30 70 32)"/>
          <ellipse cx="66" cy="36" rx="3" ry="1.5" transform="rotate(-20 66 36)"/>
          <ellipse cx="74" cy="38" rx="3" ry="1.5" transform="rotate(60 74 38)"/>
          <ellipse cx="70" cy="44" rx="3" ry="1.5"/>
          <ellipse cx="64" cy="50" rx="3" ry="1.5" transform="rotate(-45 64 50)"/>
          <ellipse cx="72" cy="52" rx="3" ry="1.5" transform="rotate(30 72 52)"/>
        </g>
      `;
    },

    bo_cai(c) {
      const green = c || '#558b2f';
      const dark = darken(green, 0.22);
      const light = lighten(green, 0.15);
      return `
        <ellipse cx="50" cy="86" rx="14" ry="3" fill="${darken(green, 0.3)}"/>
        <path d="M 26 80 Q 22 60 30 42 Q 36 38 42 42 Q 44 60 42 84 Z" fill="${green}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M 42 84 Q 38 56 44 26 Q 50 22 56 26 Q 62 56 58 84 Z" fill="${light}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M 58 84 Q 56 60 58 42 Q 64 38 70 42 Q 78 60 74 80 Z" fill="${green}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M 34 78 Q 32 60 36 44" stroke="${dark}" stroke-width="0.5" opacity="0.6" fill="none"/>
        <path d="M 50 80 Q 50 50 50 28" stroke="${dark}" stroke-width="0.5" opacity="0.6" fill="none"/>
        <path d="M 66 78 Q 68 60 64 44" stroke="${dark}" stroke-width="0.5" opacity="0.6" fill="none"/>
      `;
    },

    wa_wa_cai(c) {
      const cream = c || '#dcedc8';
      const dark = darken(cream, 0.25);
      const green = '#9ccc65';
      const darkGreen = '#558b2f';
      return `
        <ellipse cx="50" cy="86" rx="14" ry="3" fill="#a86c44"/>
        <path d="M 36 86 L 36 50 Q 36 38 50 36 Q 64 38 64 50 L 64 86 Z" fill="${cream}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M 40 86 L 40 48" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
        <path d="M 50 86 L 50 38" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
        <path d="M 60 86 L 60 48" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
        <path d="M 36 50 Q 30 40 32 26 Q 42 22 44 38 Q 42 46 36 50 Z" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
        <path d="M 50 36 Q 44 26 46 14 Q 56 12 58 26 Q 56 32 50 36 Z" fill="${darkGreen}" stroke="${darkGreen}" stroke-width="0.8"/>
        <path d="M 64 50 Q 70 40 68 26 Q 58 22 56 38 Q 58 46 64 50 Z" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
      `;
    },

    xi_lan_hua(c) {
      const green = c || '#558b2f';
      const dark = darken(green, 0.25);
      const light = lighten(green, 0.1);
      return `
        <ellipse cx="50" cy="86" rx="14" ry="3" fill="#a86c44"/>
        <rect x="46" y="58" width="8" height="28" rx="3" fill="#dcedc8" stroke="${dark}" stroke-width="0.8"/>
        <path d="M 38 56 Q 32 38 50 28 Q 68 38 62 56 Q 50 64 38 56 Z" fill="${green}" stroke="${dark}" stroke-width="1.5"/>
        <g fill="${light}" stroke="${dark}" stroke-width="0.4">
          <circle cx="38" cy="44" r="4"/>
          <circle cx="46" cy="38" r="4.5"/>
          <circle cx="54" cy="36" r="4.5"/>
          <circle cx="62" cy="44" r="4"/>
          <circle cx="42" cy="50" r="4"/>
          <circle cx="50" cy="46" r="4"/>
          <circle cx="58" cy="50" r="4"/>
        </g>
        <g fill="${green}" opacity="0.6">
          <circle cx="40" cy="42" r="1.5"/>
          <circle cx="48" cy="38" r="1.5"/>
          <circle cx="56" cy="38" r="1.5"/>
          <circle cx="60" cy="46" r="1.5"/>
          <circle cx="52" cy="48" r="1.5"/>
        </g>
      `;
    },

    // niu_jiao_jiao (horn pepper) uses the chili shape, slightly milder color
    niu_jiao_jiao(c) { return matureArt.chili(c); },

    da_bai_cai(c) {
      const cream = c || '#f0f4c3';
      const dark = darken(cream, 0.28);
      const green = '#aed581';
      const darkGreen = '#558b2f';
      return `
        <ellipse cx="50" cy="86" rx="16" ry="3" fill="#a86c44"/>
        <path d="M 32 86 L 32 38 Q 32 24 50 22 Q 68 24 68 38 L 68 86 Z" fill="${cream}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M 38 86 L 38 32" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
        <path d="M 46 86 L 46 26" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
        <path d="M 54 86 L 54 26" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
        <path d="M 62 86 L 62 32" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
        <path d="M 32 38 Q 24 30 24 14 Q 36 10 40 26 Q 38 34 32 38 Z" fill="${green}" stroke="${darkGreen}" stroke-width="1"/>
        <path d="M 42 26 Q 40 18 44 6 Q 56 6 56 18 Q 56 26 50 26 Z" fill="${darkGreen}" stroke="${darkGreen}" stroke-width="1"/>
        <path d="M 68 38 Q 76 30 76 14 Q 64 10 60 26 Q 62 34 68 38 Z" fill="${green}" stroke="${darkGreen}" stroke-width="1"/>
      `;
    },

    suan_tai(c) {
      const green = c || '#7cb342';
      const dark = darken(green, 0.22);
      const light = lighten(green, 0.15);
      return `
        <ellipse cx="50" cy="88" rx="14" ry="3" fill="#a86c44"/>
        <path d="M 35 88 Q 30 60 32 30 Q 30 22 34 16" stroke="${green}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M 35 88 Q 30 60 32 30 Q 30 22 34 16" stroke="${dark}" stroke-width="0.6" fill="none" stroke-linecap="round" opacity="0.5"/>
        <circle cx="34" cy="14" r="2.5" fill="${light}" stroke="${dark}" stroke-width="0.5"/>
        <path d="M 45 88 Q 42 56 46 22 Q 48 12 52 8" stroke="${light}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <circle cx="52" cy="6" r="2.5" fill="#fff8e7" stroke="${dark}" stroke-width="0.5"/>
        <path d="M 55 88 Q 56 60 58 32 Q 60 20 64 14" stroke="${green}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <circle cx="64" cy="12" r="2.5" fill="${light}" stroke="${dark}" stroke-width="0.5"/>
        <path d="M 65 88 Q 68 64 70 40 Q 72 30 76 26" stroke="${dark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <circle cx="76" cy="24" r="2.5" fill="${light}" stroke="${dark}" stroke-width="0.5"/>
      `;
    },

    bai_luo_bo(c) {
      const white = c || '#f5f5f5';
      const dark = '#8b7355';
      const green = '#7cb342';
      const darkGreen = '#3a7d2c';
      return `
        <path d="M 30 86 Q 26 60 32 46 Q 42 38 50 38 Q 58 38 68 46 Q 74 60 70 86 Q 60 92 50 92 Q 40 92 30 86 Z" fill="${white}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M 38 86 Q 36 60 40 46" stroke="${dark}" stroke-width="0.6" opacity="0.45" fill="none"/>
        <path d="M 62 86 Q 64 60 60 46" stroke="${dark}" stroke-width="0.6" opacity="0.45" fill="none"/>
        <ellipse cx="40" cy="55" rx="4" ry="14" fill="#fff" opacity="0.55"/>
        <path d="M 50 92 L 50 96" stroke="${dark}" stroke-width="1" stroke-linecap="round"/>
        <path d="M 42 38 L 36 14" stroke="${darkGreen}" stroke-width="2" stroke-linecap="round"/>
        <path d="M 50 38 L 50 8" stroke="${darkGreen}" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M 58 38 L 64 14" stroke="${darkGreen}" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="36" cy="14" rx="7" ry="4" fill="${green}" stroke="${darkGreen}" stroke-width="0.8" transform="rotate(-25 36 14)"/>
        <ellipse cx="50" cy="8" rx="9" ry="5" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
        <ellipse cx="64" cy="14" rx="7" ry="4" fill="${green}" stroke="${darkGreen}" stroke-width="0.8" transform="rotate(25 64 14)"/>
      `;
    },

    hu_luo_bo(c) {
      const orange = c || '#ff7043';
      const dark = darken(orange, 0.25);
      const green = '#7cb342';
      const darkGreen = '#3a7d2c';
      return `
        <path d="M 40 38 Q 36 50 38 70 Q 44 92 50 94 Q 56 92 62 70 Q 64 50 60 38 Z" fill="${orange}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M 44 42 L 44 84" stroke="${dark}" stroke-width="0.6" opacity="0.5"/>
        <path d="M 50 42 L 50 92" stroke="${dark}" stroke-width="0.6" opacity="0.5"/>
        <path d="M 56 42 L 56 84" stroke="${dark}" stroke-width="0.6" opacity="0.5"/>
        <ellipse cx="44" cy="55" rx="3" ry="14" fill="#fff" opacity="0.4"/>
        <path d="M 42 38 L 36 14" stroke="${darkGreen}" stroke-width="2" stroke-linecap="round"/>
        <path d="M 50 38 L 50 8" stroke="${darkGreen}" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M 58 38 L 64 14" stroke="${darkGreen}" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="36" cy="14" rx="6" ry="9" fill="${green}" stroke="${darkGreen}" stroke-width="0.8" transform="rotate(-20 36 14)"/>
        <ellipse cx="50" cy="8" rx="7" ry="11" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
        <ellipse cx="64" cy="14" rx="6" ry="9" fill="${green}" stroke="${darkGreen}" stroke-width="0.8" transform="rotate(20 64 14)"/>
      `;
    },

    wo_sun(c) {
      const green = c || '#aed581';
      const dark = darken(green, 0.25);
      const light = lighten(green, 0.15);
      const stem = '#e6ee9c';
      const darkStem = darken(stem, 0.25);
      return `
        <ellipse cx="50" cy="88" rx="14" ry="3" fill="#a86c44"/>
        <path d="M 40 86 Q 36 60 44 38 L 56 38 Q 64 60 60 86 Z" fill="${stem}" stroke="${darkStem}" stroke-width="1.2"/>
        <path d="M 45 84 L 45 40" stroke="${darkStem}" stroke-width="0.5" opacity="0.6"/>
        <path d="M 55 84 L 55 40" stroke="${darkStem}" stroke-width="0.5" opacity="0.6"/>
        <path d="M 28 36 Q 32 20 44 22 Q 46 30 40 38 Q 32 38 28 36 Z" fill="${green}" stroke="${dark}" stroke-width="1"/>
        <path d="M 72 36 Q 68 20 56 22 Q 54 30 60 38 Q 68 38 72 36 Z" fill="${green}" stroke="${dark}" stroke-width="1"/>
        <path d="M 50 22 Q 42 8 38 14 Q 38 26 46 28 Q 50 26 50 22 Z" fill="${light}" stroke="${dark}" stroke-width="1"/>
        <path d="M 50 22 Q 58 8 62 14 Q 62 26 54 28 Q 50 26 50 22 Z" fill="${light}" stroke="${dark}" stroke-width="1"/>
        <path d="M 50 12 L 50 38" stroke="${dark}" stroke-width="0.6" opacity="0.5"/>
      `;
    },

    pa_pa_gan(c) {
      const orange = c || '#ffa726';
      const dark = darken(orange, 0.2);
      const green = '#558b2f';
      return `
        <circle cx="50" cy="58" r="28" fill="${orange}" stroke="${dark}" stroke-width="1.5"/>
        <ellipse cx="50" cy="58" rx="22" ry="6" fill="none" stroke="${dark}" stroke-width="0.6" opacity="0.35"/>
        <ellipse cx="42" cy="48" rx="9" ry="5" fill="#fff" opacity="0.4"/>
        <g fill="${dark}" opacity="0.3">
          <circle cx="35" cy="50" r="0.7"/><circle cx="45" cy="46" r="0.7"/>
          <circle cx="58" cy="48" r="0.7"/><circle cx="64" cy="56" r="0.7"/>
          <circle cx="60" cy="68" r="0.7"/><circle cx="42" cy="72" r="0.7"/>
          <circle cx="32" cy="62" r="0.7"/><circle cx="50" cy="78" r="0.7"/>
        </g>
        <path d="M 50 30 L 50 22" stroke="#6d4528" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="42" cy="26" rx="6" ry="3.5" fill="${green}" stroke="#3a7d2c" stroke-width="0.6" transform="rotate(-30 42 26)"/>
        <ellipse cx="58" cy="26" rx="6" ry="3.5" fill="${green}" stroke="#3a7d2c" stroke-width="0.6" transform="rotate(30 58 26)"/>
      `;
    },

    wo_gan(c) { return matureArt.pa_pa_gan(c || '#ff9800'); },
    sha_tang_ju(c) {
      // Small mandarins, render two side by side
      const orange = c || '#ffb74d';
      const dark = darken(orange, 0.2);
      return `
        <ellipse cx="50" cy="84" rx="20" ry="4" fill="#a86c44" opacity="0.4"/>
        <circle cx="36" cy="62" r="16" fill="${orange}" stroke="${dark}" stroke-width="1.2"/>
        <ellipse cx="32" cy="56" rx="5" ry="3" fill="#fff" opacity="0.4"/>
        <path d="M 36 46 L 36 40" stroke="#6d4528" stroke-width="1.5" stroke-linecap="round"/>
        <ellipse cx="32" cy="42" rx="4" ry="2.5" fill="#558b2f" transform="rotate(-30 32 42)"/>
        <circle cx="64" cy="58" r="14" fill="${orange}" stroke="${dark}" stroke-width="1.2"/>
        <ellipse cx="61" cy="53" rx="4" ry="2.5" fill="#fff" opacity="0.4"/>
        <path d="M 64 44 L 64 40" stroke="#6d4528" stroke-width="1.5" stroke-linecap="round"/>
        <ellipse cx="68" cy="42" rx="4" ry="2.5" fill="#558b2f" transform="rotate(30 68 42)"/>
        <circle cx="52" cy="76" r="12" fill="${orange}" stroke="${dark}" stroke-width="1.2"/>
        <ellipse cx="49" cy="72" rx="3" ry="2" fill="#fff" opacity="0.4"/>
      `;
    },

    tw_cauliflower(c) {
      const cream = c || '#f5f5dc';
      const dark = darken(cream, 0.3);
      const green = '#9ccc65';
      const darkGreen = '#558b2f';
      return `
        <ellipse cx="50" cy="86" rx="14" ry="3" fill="#a86c44"/>
        <path d="M 30 86 Q 26 60 30 50 Q 26 36 50 28 Q 74 36 70 50 Q 74 60 70 86 Z" fill="${cream}" stroke="${dark}" stroke-width="1.5"/>
        <g fill="${lighten(cream, 0.05)}" stroke="${dark}" stroke-width="0.4" opacity="0.85">
          <circle cx="36" cy="48" r="5"/>
          <circle cx="44" cy="40" r="5.5"/>
          <circle cx="54" cy="38" r="5.5"/>
          <circle cx="62" cy="46" r="5"/>
          <circle cx="40" cy="56" r="5"/>
          <circle cx="50" cy="50" r="5.5"/>
          <circle cx="60" cy="56" r="5"/>
          <circle cx="46" cy="64" r="4.5"/>
          <circle cx="55" cy="66" r="4.5"/>
        </g>
        <path d="M 28 56 Q 22 60 22 70 Q 32 76 34 66 Z" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
        <path d="M 72 56 Q 78 60 78 70 Q 68 76 66 66 Z" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
        <path d="M 30 76 Q 26 80 28 86 L 34 86 Q 36 80 34 76 Z" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
        <path d="M 70 76 Q 74 80 72 86 L 66 86 Q 64 80 66 76 Z" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
      `;
    },

    dong_gua(c) {
      const green = c || '#a5d6a7';
      const dark = darken(green, 0.3);
      const light = lighten(green, 0.15);
      return `
        <ellipse cx="50" cy="60" rx="34" ry="28" fill="${green}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M 18 60 Q 50 56 82 60" stroke="${dark}" stroke-width="0.6" opacity="0.5" fill="none"/>
        <path d="M 20 50 Q 50 44 80 50" stroke="${dark}" stroke-width="0.6" opacity="0.4" fill="none"/>
        <path d="M 20 70 Q 50 76 80 70" stroke="${dark}" stroke-width="0.6" opacity="0.4" fill="none"/>
        <ellipse cx="35" cy="48" rx="14" ry="7" fill="${light}" opacity="0.6"/>
        <ellipse cx="35" cy="46" rx="10" ry="4" fill="#fff" opacity="0.4"/>
        <g fill="#fff" opacity="0.5">
          <circle cx="32" cy="52" r="0.6"/><circle cx="40" cy="48" r="0.6"/><circle cx="50" cy="46" r="0.6"/>
          <circle cx="60" cy="50" r="0.6"/><circle cx="68" cy="56" r="0.6"/><circle cx="60" cy="68" r="0.6"/>
          <circle cx="45" cy="70" r="0.6"/><circle cx="32" cy="64" r="0.6"/>
        </g>
        <path d="M 50 32 L 50 22" stroke="#6d4528" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="48" cy="22" rx="6" ry="3" fill="#6ab04c" transform="rotate(-30 48 22)"/>
      `;
    },

    jing_cong(c) {
      const green = c || '#9ccc65';
      const dark = darken(green, 0.22);
      const white = '#fff8e7';
      return `
        <ellipse cx="50" cy="88" rx="12" ry="3" fill="#a86c44"/>
        <path d="M 44 88 L 42 50 Q 42 40 50 40 Q 58 40 58 50 L 56 88 Z" fill="${white}" stroke="#c9b890" stroke-width="1"/>
        <path d="M 47 86 L 47 44" stroke="#c9b890" stroke-width="0.5" opacity="0.7"/>
        <path d="M 50 86 L 50 42" stroke="#c9b890" stroke-width="0.5" opacity="0.7"/>
        <path d="M 53 86 L 53 44" stroke="#c9b890" stroke-width="0.5" opacity="0.7"/>
        <path d="M 42 50 Q 38 30 42 12" stroke="${dark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M 42 50 Q 38 30 42 12" stroke="${green}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 50 40 Q 50 20 52 6" stroke="${dark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M 50 40 Q 50 20 52 6" stroke="${lighten(green, 0.15)}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 58 50 Q 62 30 58 14" stroke="${dark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M 58 50 Q 62 30 58 14" stroke="${green}" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
    },

    lian_ou(c) {
      const cream = c || '#fff8e7';
      const dark = '#a89070';
      const stroke = '#7a6649';
      return `
        <ellipse cx="50" cy="86" rx="16" ry="3" fill="#a86c44" opacity="0.5"/>
        <g transform="rotate(-15 50 58)">
          <ellipse cx="28" cy="58" rx="10" ry="13" fill="${cream}" stroke="${stroke}" stroke-width="1.2"/>
          <ellipse cx="50" cy="58" rx="12" ry="15" fill="${cream}" stroke="${stroke}" stroke-width="1.2"/>
          <ellipse cx="72" cy="58" rx="10" ry="13" fill="${cream}" stroke="${stroke}" stroke-width="1.2"/>
          <g fill="${dark}" opacity="0.85">
            <circle cx="28" cy="56" r="1.8"/>
            <circle cx="25" cy="60" r="1.4"/>
            <circle cx="31" cy="60" r="1.4"/>
            <circle cx="26" cy="55" r="1.2"/>
            <circle cx="30" cy="55" r="1.2"/>
            <circle cx="28" cy="62" r="1.2"/>
          </g>
          <g fill="${dark}" opacity="0.85">
            <circle cx="50" cy="55" r="2"/>
            <circle cx="46" cy="60" r="1.6"/>
            <circle cx="54" cy="60" r="1.6"/>
            <circle cx="47" cy="54" r="1.4"/>
            <circle cx="53" cy="54" r="1.4"/>
            <circle cx="50" cy="63" r="1.4"/>
            <circle cx="44" cy="56" r="1.2"/>
            <circle cx="56" cy="56" r="1.2"/>
          </g>
          <g fill="${dark}" opacity="0.85">
            <circle cx="72" cy="56" r="1.8"/>
            <circle cx="69" cy="60" r="1.4"/>
            <circle cx="75" cy="60" r="1.4"/>
            <circle cx="70" cy="55" r="1.2"/>
            <circle cx="74" cy="55" r="1.2"/>
            <circle cx="72" cy="62" r="1.2"/>
          </g>
          <ellipse cx="38" cy="58" rx="2" ry="3.5" fill="${stroke}" opacity="0.6"/>
          <ellipse cx="62" cy="58" rx="2" ry="3.5" fill="${stroke}" opacity="0.6"/>
        </g>
      `;
    },

    ye_zi(c) {
      const brown = c || '#8d6e63';
      const dark = darken(brown, 0.22);
      const cream = '#fff8e7';
      const green = '#558b2f';
      return `
        <circle cx="50" cy="62" r="28" fill="${brown}" stroke="${dark}" stroke-width="1.5"/>
        <ellipse cx="44" cy="54" rx="10" ry="6" fill="${cream}" opacity="0.5"/>
        <g fill="${dark}" opacity="0.7">
          <circle cx="42" cy="48" r="2"/>
          <circle cx="52" cy="45" r="2"/>
          <circle cx="47" cy="56" r="2"/>
        </g>
        <g fill="${cream}" opacity="0.85">
          <circle cx="42" cy="48" r="0.7"/>
          <circle cx="52" cy="45" r="0.7"/>
          <circle cx="47" cy="56" r="0.7"/>
        </g>
        <path d="M 50 34 L 50 22" stroke="#6d4528" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M 50 22 Q 30 14 22 18 Q 32 26 50 22" fill="${green}" stroke="#3a7d2c" stroke-width="0.8"/>
        <path d="M 50 22 Q 70 14 78 18 Q 68 26 50 22" fill="${green}" stroke="#3a7d2c" stroke-width="0.8"/>
        <path d="M 50 22 Q 46 8 38 6 Q 42 16 50 22" fill="#7cb342" stroke="#3a7d2c" stroke-width="0.8"/>
        <path d="M 50 22 Q 54 8 62 6 Q 58 16 50 22" fill="#7cb342" stroke="#3a7d2c" stroke-width="0.8"/>
      `;
    },

    xiang_yin_putao(c) {
      const green = c || '#9ccc65';
      const dark = darken(green, 0.25);
      const light = lighten(green, 0.15);
      const stem = '#6d4528';
      return `
        <path d="M 50 18 L 50 32" stroke="${stem}" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="42" cy="20" rx="7" ry="3" fill="#558b2f" stroke="#3a7d2c" stroke-width="0.6" transform="rotate(-30 42 20)"/>
        <ellipse cx="58" cy="20" rx="7" ry="3" fill="#558b2f" stroke="#3a7d2c" stroke-width="0.6" transform="rotate(30 58 20)"/>
        <g stroke="${dark}" stroke-width="0.6">
          <circle cx="42" cy="38" r="7" fill="${green}"/>
          <circle cx="50" cy="38" r="7" fill="${light}"/>
          <circle cx="58" cy="38" r="7" fill="${green}"/>
          <circle cx="38" cy="50" r="7" fill="${light}"/>
          <circle cx="46" cy="50" r="7" fill="${green}"/>
          <circle cx="54" cy="50" r="7" fill="${green}"/>
          <circle cx="62" cy="50" r="7" fill="${light}"/>
          <circle cx="42" cy="62" r="7" fill="${green}"/>
          <circle cx="50" cy="62" r="7" fill="${light}"/>
          <circle cx="58" cy="62" r="7" fill="${green}"/>
          <circle cx="46" cy="74" r="7" fill="${light}"/>
          <circle cx="54" cy="74" r="7" fill="${green}"/>
          <circle cx="50" cy="84" r="6" fill="${green}"/>
        </g>
        <g fill="#fff" opacity="0.5">
          <circle cx="40" cy="36" r="1.5"/><circle cx="48" cy="36" r="1.5"/><circle cx="56" cy="36" r="1.5"/>
          <circle cx="44" cy="48" r="1.5"/><circle cx="52" cy="48" r="1.5"/><circle cx="60" cy="48" r="1.5"/>
        </g>
      `;
    },

    mang_guo(c) {
      const yellow = c || '#ffca28';
      const dark = darken(yellow, 0.25);
      const orange = '#ff9800';
      return `
        <g transform="rotate(-15 50 58)">
          <path d="M 30 60 Q 26 38 50 32 Q 76 38 72 64 Q 64 84 50 86 Q 34 82 30 60 Z" fill="${yellow}" stroke="${dark}" stroke-width="1.5"/>
          <ellipse cx="42" cy="44" rx="14" ry="8" fill="#fff" opacity="0.35"/>
          <path d="M 60 50 Q 64 64 56 78" stroke="${orange}" stroke-width="3" fill="none" opacity="0.5" stroke-linecap="round"/>
        </g>
        <path d="M 50 30 L 50 22" stroke="#6d4528" stroke-width="1.5" stroke-linecap="round"/>
        <ellipse cx="48" cy="22" rx="5" ry="2.5" fill="#558b2f" transform="rotate(-30 48 22)"/>
      `;
    },

    huo_long_guo(c) {
      const pink = c || '#e91e63';
      const dark = darken(pink, 0.22);
      const green = '#7cb342';
      const darkGreen = '#3a7d2c';
      return `
        <ellipse cx="50" cy="60" rx="22" ry="28" fill="${pink}" stroke="${dark}" stroke-width="1.5"/>
        <g fill="${green}" stroke="${darkGreen}" stroke-width="0.8">
          <path d="M 30 50 Q 22 46 18 52 Q 26 56 32 54 Z"/>
          <path d="M 28 60 Q 18 60 16 68 Q 26 70 32 64 Z"/>
          <path d="M 32 72 Q 24 76 24 82 Q 32 82 36 76 Z"/>
          <path d="M 70 50 Q 78 46 82 52 Q 74 56 68 54 Z"/>
          <path d="M 72 60 Q 82 60 84 68 Q 74 70 68 64 Z"/>
          <path d="M 68 72 Q 76 76 76 82 Q 68 82 64 76 Z"/>
          <path d="M 50 34 Q 42 28 38 22 Q 48 24 52 30 Z"/>
          <path d="M 50 34 Q 58 28 62 22 Q 52 24 48 30 Z"/>
          <path d="M 50 30 Q 50 18 50 14" stroke-width="1.5"/>
        </g>
        <ellipse cx="42" cy="50" rx="8" ry="14" fill="#fff" opacity="0.28"/>
        <g fill="${darkGreen}" opacity="0.7">
          <circle cx="30" cy="50" r="1"/><circle cx="28" cy="60" r="1"/><circle cx="32" cy="72" r="1"/>
          <circle cx="70" cy="50" r="1"/><circle cx="72" cy="60" r="1"/><circle cx="68" cy="72" r="1"/>
        </g>
      `;
    },

    pi_pa(c) {
      const yellow = c || '#ffd54f';
      const dark = darken(yellow, 0.25);
      const green = '#558b2f';
      const darkGreen = '#3a7d2c';
      return `
        <ellipse cx="50" cy="88" rx="14" ry="2.5" fill="#a86c44" opacity="0.5"/>
        <path d="M 50 70 L 50 32" stroke="#6d4528" stroke-width="1.5"/>
        <path d="M 50 60 L 32 44" stroke="#6d4528" stroke-width="1"/>
        <path d="M 50 60 L 68 44" stroke="#6d4528" stroke-width="1"/>
        <path d="M 50 50 L 38 32" stroke="#6d4528" stroke-width="1"/>
        <path d="M 50 50 L 62 32" stroke="#6d4528" stroke-width="1"/>
        <ellipse cx="36" cy="22" rx="9" ry="5" fill="${green}" stroke="${darkGreen}" stroke-width="0.8" transform="rotate(-25 36 22)"/>
        <ellipse cx="64" cy="22" rx="9" ry="5" fill="${green}" stroke="${darkGreen}" stroke-width="0.8" transform="rotate(25 64 22)"/>
        <ellipse cx="50" cy="14" rx="10" ry="6" fill="${green}" stroke="${darkGreen}" stroke-width="0.8"/>
        <circle cx="32" cy="46" r="6" fill="${yellow}" stroke="${dark}" stroke-width="0.8"/>
        <circle cx="38" cy="34" r="5.5" fill="${yellow}" stroke="${dark}" stroke-width="0.8"/>
        <circle cx="50" cy="72" r="6.5" fill="${yellow}" stroke="${dark}" stroke-width="0.8"/>
        <circle cx="68" cy="46" r="6" fill="${yellow}" stroke="${dark}" stroke-width="0.8"/>
        <circle cx="62" cy="34" r="5.5" fill="${yellow}" stroke="${dark}" stroke-width="0.8"/>
        <g fill="#fff" opacity="0.4">
          <circle cx="30" cy="44" r="1.2"/><circle cx="36" cy="32" r="1.2"/><circle cx="48" cy="70" r="1.5"/>
          <circle cx="66" cy="44" r="1.2"/><circle cx="60" cy="32" r="1.2"/>
        </g>
      `;
    },

    sheng_jiang(c) {
      const tan = c || '#d4a574';
      const dark = '#8b6543';
      return `
        <ellipse cx="50" cy="88" rx="20" ry="3" fill="#a86c44" opacity="0.5"/>
        <path d="M 22 72 Q 18 60 22 52 Q 30 46 36 50 Q 42 44 50 50 Q 58 44 64 50 Q 72 46 78 54 Q 80 64 74 72 Q 64 78 56 74 Q 50 80 42 76 Q 32 80 26 76 Q 20 76 22 72 Z" fill="${tan}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M 30 60 Q 38 58 36 64" stroke="${dark}" stroke-width="0.6" fill="none" opacity="0.55"/>
        <path d="M 46 56 Q 52 56 50 62" stroke="${dark}" stroke-width="0.6" fill="none" opacity="0.55"/>
        <path d="M 60 58 Q 68 60 66 66" stroke="${dark}" stroke-width="0.6" fill="none" opacity="0.55"/>
        <ellipse cx="32" cy="56" rx="4" ry="2" fill="#fff" opacity="0.35"/>
        <ellipse cx="56" cy="56" rx="5" ry="2" fill="#fff" opacity="0.35"/>
      `;
    },

    shan_yao(c) {
      const tan = c || '#d7ccc8';
      const dark = '#a89070';
      return `
        <g transform="rotate(8 50 60)">
          <path d="M 38 24 Q 36 50 40 78 Q 46 90 50 92 Q 54 90 60 78 Q 64 50 62 24 Q 56 18 50 18 Q 44 18 38 24 Z" fill="${tan}" stroke="${dark}" stroke-width="1.2"/>
          <path d="M 42 28 L 42 84" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
          <path d="M 50 26 L 50 92" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
          <path d="M 58 28 L 58 84" stroke="${dark}" stroke-width="0.5" opacity="0.5"/>
          <ellipse cx="44" cy="42" rx="3" ry="14" fill="#fff" opacity="0.4"/>
          <g fill="${dark}" opacity="0.6">
            <circle cx="45" cy="36" r="0.8"/><circle cx="52" cy="44" r="0.8"/>
            <circle cx="48" cy="58" r="0.8"/><circle cx="54" cy="68" r="0.8"/>
          </g>
        </g>
      `;
    },

    chun_sun(c) {
      const cream = c || '#dcedc8';
      const dark = '#7a8a4a';
      const green = '#558b2f';
      return `
        <ellipse cx="50" cy="88" rx="16" ry="3" fill="#a86c44" opacity="0.5"/>
        <path d="M 34 88 Q 32 70 38 50 Q 42 30 50 14 Q 58 30 62 50 Q 68 70 66 88 Z" fill="${cream}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M 36 80 Q 42 82 50 80 Q 58 82 64 80" stroke="${dark}" stroke-width="1" fill="none" opacity="0.6"/>
        <path d="M 36 66 Q 42 68 50 66 Q 58 68 64 66" stroke="${dark}" stroke-width="1" fill="none" opacity="0.6"/>
        <path d="M 38 52 Q 44 54 50 52 Q 56 54 62 52" stroke="${dark}" stroke-width="1" fill="none" opacity="0.6"/>
        <path d="M 40 38 Q 44 40 50 38 Q 56 40 60 38" stroke="${dark}" stroke-width="1" fill="none" opacity="0.6"/>
        <path d="M 43 26 Q 47 28 50 26 Q 53 28 57 26" stroke="${dark}" stroke-width="1" fill="none" opacity="0.6"/>
        <ellipse cx="42" cy="55" rx="3" ry="20" fill="#fff" opacity="0.3"/>
        <path d="M 48 14 Q 45 8 42 6 Q 44 12 47 14 Z" fill="${green}" stroke="#3a7d2c" stroke-width="0.6"/>
        <path d="M 52 14 Q 55 8 58 6 Q 56 12 53 14 Z" fill="${green}" stroke="#3a7d2c" stroke-width="0.6"/>
      `;
    },
    narcissus(c) {
      const yellow = c || '#fff59d';
      return `
        <ellipse cx="50" cy="84" rx="22" ry="4" fill="#9a7647"/>
        <path d="M 30 84 L 34 92 L 66 92 L 70 84 Z" fill="#8b6a3f" stroke="#6d4528" stroke-width="0.8"/>
        <path d="M 40 84 Q 35 60 32 32" stroke="#6ab04c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M 50 84 Q 50 55 50 24" stroke="#558b2f" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M 60 84 Q 65 60 68 32" stroke="#6ab04c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <g transform="translate(32 32)">
          <circle r="6" fill="#fff" stroke="#d8c8a0" stroke-width="0.7"/>
          <circle r="2.5" fill="${yellow}" stroke="#e6b800" stroke-width="0.5"/>
        </g>
        <g transform="translate(50 24)">
          <circle r="7" fill="#fff" stroke="#d8c8a0" stroke-width="0.7"/>
          <circle r="3" fill="${yellow}" stroke="#e6b800" stroke-width="0.5"/>
        </g>
        <g transform="translate(68 32)">
          <circle r="6" fill="#fff" stroke="#d8c8a0" stroke-width="0.7"/>
          <circle r="2.5" fill="${yellow}" stroke="#e6b800" stroke-width="0.5"/>
        </g>
      `;
    },
    kumquat(c) {
      const orange = c || '#ffa726';
      const dark = darken(orange, 0.18);
      return `
        <path d="M 50 88 Q 48 70 36 50" stroke="#6d4528" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 50 88 Q 52 70 64 50" stroke="#6d4528" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 50 68 Q 50 50 50 30" stroke="#6d4528" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        <ellipse cx="28" cy="46" rx="5" ry="3" fill="#3a7d2c" transform="rotate(-30 28 46)"/>
        <ellipse cx="72" cy="46" rx="5" ry="3" fill="#3a7d2c" transform="rotate(30 72 46)"/>
        <ellipse cx="42" cy="28" rx="5" ry="3" fill="#558b2f" transform="rotate(-25 42 28)"/>
        <ellipse cx="58" cy="28" rx="5" ry="3" fill="#558b2f" transform="rotate(25 58 28)"/>
        <circle cx="36" cy="55" r="7" fill="${orange}" stroke="${dark}" stroke-width="1"/>
        <circle cx="34" cy="53" r="2" fill="#fff" opacity="0.45"/>
        <circle cx="64" cy="55" r="7" fill="${orange}" stroke="${dark}" stroke-width="1"/>
        <circle cx="62" cy="53" r="2" fill="#fff" opacity="0.45"/>
        <circle cx="50" cy="42" r="8" fill="${orange}" stroke="${dark}" stroke-width="1"/>
        <circle cx="48" cy="40" r="2.5" fill="#fff" opacity="0.45"/>
        <circle cx="44" cy="70" r="5" fill="${orange}" stroke="${dark}" stroke-width="1"/>
        <circle cx="56" cy="70" r="5" fill="${orange}" stroke="${dark}" stroke-width="1"/>
      `;
    },
    taro(c) {
      const purple = c || '#b39ddb';
      const dark = darken(purple, 0.25);
      return `
        <path d="M 50 88 Q 28 80 26 60 Q 28 44 40 40 Q 50 36 60 40 Q 72 44 74 62 Q 72 82 50 88 Z" fill="${purple}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M 30 54 Q 50 58 70 54" stroke="${dark}" stroke-width="0.8" fill="none" opacity="0.55"/>
        <path d="M 28 64 Q 50 68 72 64" stroke="${dark}" stroke-width="0.8" fill="none" opacity="0.55"/>
        <path d="M 30 74 Q 50 78 70 74" stroke="${dark}" stroke-width="0.8" fill="none" opacity="0.55"/>
        <ellipse cx="38" cy="55" rx="5" ry="8" fill="#fff" opacity="0.3"/>
        <path d="M 42 40 L 38 22 M 50 38 L 50 14 M 58 40 L 62 22" stroke="#3a7d2c" stroke-width="2" stroke-linecap="round" fill="none"/>
        <ellipse cx="38" cy="22" rx="7" ry="10" fill="#6ab04c" stroke="#3a7d2c" stroke-width="0.8" transform="rotate(-15 38 22)"/>
        <ellipse cx="50" cy="14" rx="7" ry="11" fill="#558b2f" stroke="#3a7d2c" stroke-width="0.8"/>
        <ellipse cx="62" cy="22" rx="7" ry="10" fill="#6ab04c" stroke="#3a7d2c" stroke-width="0.8" transform="rotate(15 62 22)"/>
      `;
    },
    pomelo(c) {
      const yellow = c || '#dce775';
      const dark = darken(yellow, 0.18);
      return `
        <path d="M 50 22 Q 80 28 82 60 Q 80 86 50 90 Q 20 86 18 60 Q 20 28 50 22 Z" fill="${yellow}" stroke="${dark}" stroke-width="1.5"/>
        <g fill="${dark}" opacity="0.35">
          <circle cx="35" cy="45" r="0.9"/><circle cx="42" cy="40" r="0.9"/><circle cx="55" cy="35" r="0.9"/>
          <circle cx="65" cy="42" r="0.9"/><circle cx="68" cy="55" r="0.9"/><circle cx="62" cy="68" r="0.9"/>
          <circle cx="45" cy="72" r="0.9"/><circle cx="32" cy="60" r="0.9"/><circle cx="52" cy="52" r="0.9"/>
          <circle cx="38" cy="55" r="0.9"/><circle cx="55" cy="60" r="0.9"/><circle cx="40" cy="78" r="0.9"/>
          <circle cx="60" cy="78" r="0.9"/><circle cx="28" cy="70" r="0.9"/>
        </g>
        <ellipse cx="36" cy="40" rx="10" ry="14" fill="#fff" opacity="0.32"/>
        <ellipse cx="42" cy="22" rx="6" ry="4" fill="#558b2f" transform="rotate(-30 42 22)"/>
        <ellipse cx="58" cy="22" rx="6" ry="4" fill="#558b2f" transform="rotate(30 58 22)"/>
        <path d="M 50 24 L 50 14" stroke="#6d4528" stroke-width="2" stroke-linecap="round"/>
      `;
    },
    osmanthus(c) {
      const yellow = c || '#fff59d';
      return `
        <path d="M 50 90 Q 50 65 36 45 Q 30 38 26 28" stroke="#6d4528" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M 50 60 Q 60 50 72 36" stroke="#6d4528" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        <path d="M 50 76 Q 38 78 30 80" stroke="#6d4528" stroke-width="1.2" fill="none" stroke-linecap="round"/>
        <ellipse cx="38" cy="56" rx="6" ry="3" fill="#3a7d2c" stroke="#2a5c34" stroke-width="0.5" transform="rotate(-50 38 56)"/>
        <ellipse cx="60" cy="56" rx="6" ry="3" fill="#3a7d2c" stroke="#2a5c34" stroke-width="0.5" transform="rotate(50 60 56)"/>
        <ellipse cx="40" cy="38" rx="6" ry="3" fill="#558b2f" stroke="#3a7d2c" stroke-width="0.5" transform="rotate(-40 40 38)"/>
        <ellipse cx="62" cy="44" rx="6" ry="3" fill="#558b2f" stroke="#3a7d2c" stroke-width="0.5" transform="rotate(50 62 44)"/>
        <g fill="${yellow}" stroke="#e6b800" stroke-width="0.4">
          <g transform="translate(26 28)">
            <circle cx="-2" cy="-1" r="1.8"/><circle cx="2" cy="-1" r="1.8"/>
            <circle cx="-2" cy="2" r="1.8"/><circle cx="2" cy="2" r="1.8"/>
            <circle cx="0" cy="0" r="1.1" fill="#ffa726" stroke="none"/>
          </g>
          <g transform="translate(72 36)">
            <circle cx="-2" cy="-1" r="1.8"/><circle cx="2" cy="-1" r="1.8"/>
            <circle cx="-2" cy="2" r="1.8"/><circle cx="2" cy="2" r="1.8"/>
            <circle cx="0" cy="0" r="1.1" fill="#ffa726" stroke="none"/>
          </g>
          <g transform="translate(30 80)">
            <circle cx="-2" cy="-1" r="1.6"/><circle cx="2" cy="-1" r="1.6"/>
            <circle cx="-2" cy="2" r="1.6"/><circle cx="2" cy="2" r="1.6"/>
          </g>
          <g transform="translate(50 50)">
            <circle cx="-2" cy="-1" r="1.5"/><circle cx="2" cy="-1" r="1.5"/>
            <circle cx="-2" cy="2" r="1.5"/><circle cx="2" cy="2" r="1.5"/>
          </g>
        </g>
      `;
    },
  };

  const cropArt = {
    svg(cropId, stage, sizePx, opts) {
      opts = opts || {};
      const def = (window.Farm && Farm.crops && Farm.crops.get) ? Farm.crops.get(cropId) : null;
      const color = (def && def.color) || '#7cb342';
      const size = sizePx || 64;
      const soil = opts.bare ? '' : SOIL;

      let inner;
      if (stage <= 0) inner = genericSeed(color);
      else if (stage === 1) inner = genericSprout(color);
      else if (matureArt[cropId]) inner = matureArt[cropId](color);
      else inner = genericSprout(color);

      return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size +
        '" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">' +
        soil + inner + '</svg>';
    },

    // Compact icon for shop/collection lists (mature stage, no soil, tighter viewBox feel)
    icon(cropId, sizePx) {
      return this.svg(cropId, 2, sizePx || 40, { bare: true });
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.cropArt = cropArt;
})();
