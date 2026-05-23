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
