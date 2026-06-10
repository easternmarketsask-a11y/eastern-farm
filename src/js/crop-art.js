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
    // eggplant (Asian long eggplant) — emoji-style. Deep purple slender
    // body, slight curve, glossy reflective surface, green 5-leaf calyx
    // + short stem at top.
    eggplant(c) {
      return `
        <defs>
          <filter id="ds_eggplant" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="body_eggplant" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#3a0d4a"/>
            <stop offset="35%" stop-color="#6a1b8a"/>
            <stop offset="60%" stop-color="#9c40c4"/>
            <stop offset="100%" stop-color="#4a1660"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="16" ry="2.5" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_eggplant)" transform="rotate(-10 50 58)">
          <!-- Long slender eggplant body -->
          <path d="M 50 88
                   Q 38 86 36 70
                   Q 34 50 40 38
                   Q 48 28 52 28
                   Q 56 28 60 38
                   Q 64 50 62 70
                   Q 60 86 50 88
                   Z"
                fill="url(#body_eggplant)" stroke="#1f0428" stroke-width="0.7"/>

          <!-- Green 5-petal calyx at top -->
          <g transform="translate(50 28)">
            <path d="M -2 0 Q -8 -2 -10 -8 Q -3 -8 0 -4 Z" fill="#7cb342" stroke="#3a6e1a" stroke-width="0.5"/>
            <path d="M 2 0 Q 8 -2 10 -8 Q 3 -8 0 -4 Z" fill="#7cb342" stroke="#3a6e1a" stroke-width="0.5"/>
            <path d="M -3 -2 Q -6 -8 -4 -12 Q 0 -10 -1 -4 Z" fill="#8bc34a" stroke="#3a6e1a" stroke-width="0.5"/>
            <path d="M 3 -2 Q 6 -8 4 -12 Q 0 -10 1 -4 Z" fill="#8bc34a" stroke="#3a6e1a" stroke-width="0.5"/>
            <path d="M 0 -2 L 0 -14" stroke="#558b2f" stroke-width="2.3" stroke-linecap="round"/>
          </g>
        </g>

        <!-- Bold left-side glossy highlight stripe (eggplant's iconic shine) -->
        <ellipse cx="40" cy="58" rx="3" ry="20" fill="#fff" opacity="0.42" transform="rotate(-15 40 58)"/>
        <ellipse cx="40" cy="48" rx="2" ry="4" fill="#fff" opacity="0.7"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="88" rx="9" ry="1.3" fill="#000" opacity="0.28"/>
      `;
    },
    // jiucai (Chinese chives) — emoji-style. Bundle of 7 FLAT BLADE leaves
    // (key distinction vs xiao_cong's tubular leaves). Tied at base, fanning
    // slightly upward, deep saturated green.
    jiucai(c) {
      return `
        <defs>
          <filter id="ds_jiucai" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="bladeA_jiucai" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#1f4d10"/>
            <stop offset="50%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#aed581"/>
          </linearGradient>
          <linearGradient id="bladeB_jiucai" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#2e6b1d"/>
            <stop offset="50%" stop-color="#6db835"/>
            <stop offset="100%" stop-color="#c5e1a5"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="18" ry="2.5" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_jiucai)">
          <!-- 7 flat blade leaves fanning from a tight base -->
          <!-- Outer-left blade (longest, leans left) -->
          <path d="M 46 86 Q 36 60 28 18 L 32 16 Q 38 56 50 86 Z"
                fill="url(#bladeA_jiucai)" stroke="#1a3b0c" stroke-width="0.4"/>
          <!-- Outer-right blade (longest, leans right) -->
          <path d="M 54 86 Q 64 60 72 18 L 68 16 Q 62 56 50 86 Z"
                fill="url(#bladeA_jiucai)" stroke="#1a3b0c" stroke-width="0.4"/>
          <!-- Mid-left blade -->
          <path d="M 47 86 Q 42 55 38 12 L 42 10 Q 44 55 50 86 Z"
                fill="url(#bladeB_jiucai)" stroke="#1a3b0c" stroke-width="0.4"/>
          <!-- Mid-right blade -->
          <path d="M 53 86 Q 58 55 62 12 L 58 10 Q 56 55 50 86 Z"
                fill="url(#bladeB_jiucai)" stroke="#1a3b0c" stroke-width="0.4"/>
          <!-- Inner-left blade -->
          <path d="M 48 86 Q 46 52 44 8 L 47 6 Q 49 52 50 86 Z"
                fill="url(#bladeA_jiucai)" stroke="#1a3b0c" stroke-width="0.4"/>
          <!-- Inner-right blade -->
          <path d="M 52 86 Q 54 52 56 8 L 53 6 Q 51 52 50 86 Z"
                fill="url(#bladeA_jiucai)" stroke="#1a3b0c" stroke-width="0.4"/>
          <!-- Center tallest blade -->
          <path d="M 49 86 Q 49 50 49 4 L 51 4 Q 51 50 51 86 Z"
                fill="url(#bladeB_jiucai)" stroke="#1a3b0c" stroke-width="0.4"/>

          <!-- Subtle vein highlights on top-leaning blades -->
          <path d="M 50 86 Q 49 50 49 8" stroke="#aed581" stroke-width="0.4" fill="none" opacity="0.55"/>
        </g>

        <!-- Glossy highlight stripes on a couple of front blades -->
        <ellipse cx="44" cy="40" rx="0.7" ry="20" fill="#fff" opacity="0.4" transform="rotate(-3 44 40)"/>
        <ellipse cx="50" cy="30" rx="0.7" ry="22" fill="#fff" opacity="0.4"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="87" rx="9" ry="1.4" fill="#000" opacity="0.28"/>
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
    // ============ HAY DAY-STYLE UPGRADED ART (2026-05-24) ============
    // Each upgraded crop carries its own <defs> with crop-scoped IDs (e.g.
    // ds_cilantro, leaf_cilantro). SVG ID scope is technically document-wide,
    // so per-crop suffixes prevent collisions when multiple crops render on
    // the same page (collection view, farm grid with mixed crops).
    cilantro(c) {
      return `
        <defs>
          <filter id="ds_cilantro" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="leaf_cilantro" cx="40%" cy="25%" r="70%">
            <stop offset="0%" stop-color="#d4e88f"/>
            <stop offset="55%" stop-color="#7cb342"/>
            <stop offset="100%" stop-color="#3a7d2c"/>
          </radialGradient>
          <linearGradient id="stem_cilantro" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#2e6b1d"/>
            <stop offset="100%" stop-color="#7cb342"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.18"/>
        <g filter="url(#ds_cilantro)">
          <!-- 4 thin stems fanning out from a single base -->
          <path d="M 50 88 Q 44 72 36 52" stroke="url(#stem_cilantro)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
          <path d="M 50 88 Q 48 70 46 46" stroke="url(#stem_cilantro)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
          <path d="M 50 88 Q 52 70 54 46" stroke="url(#stem_cilantro)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
          <path d="M 50 88 Q 56 72 64 52" stroke="url(#stem_cilantro)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
          <!-- left fan-leaf cluster -->
          <g transform="translate(36 50)">
            <path d="M 0 4 Q -7 0 -8 -8 Q -3 -10 -1 -4 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
            <path d="M 0 4 Q 5 0 6 -8 Q 1 -10 -1 -3 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
            <path d="M 0 4 Q -2 -4 1 -12 Q 5 -9 4 -2 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
          </g>
          <!-- center fan-leaf cluster (largest, tallest) -->
          <g transform="translate(50 42)">
            <path d="M 0 4 Q -8 1 -10 -8 Q -4 -11 -2 -4 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
            <path d="M 0 4 Q 8 1 10 -8 Q 4 -11 2 -4 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
            <path d="M 0 4 Q -2 -5 -1 -14 Q 4 -12 3 -3 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
            <path d="M 0 4 Q 2 -5 3 -14 Q 7 -10 5 -2 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
          </g>
          <!-- right fan-leaf cluster -->
          <g transform="translate(64 50)">
            <path d="M 0 4 Q -5 0 -6 -8 Q -1 -10 1 -3 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
            <path d="M 0 4 Q 7 0 8 -8 Q 3 -10 1 -4 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
            <path d="M 0 4 Q 3 -4 6 -10 Q 8 -7 5 -1 Z" fill="url(#leaf_cilantro)" stroke="#3a7d2c" stroke-width="0.45"/>
          </g>
        </g>
        <!-- highlight specular dots on top of each cluster -->
        <ellipse cx="49" cy="33" rx="2.2" ry="2.8" fill="#fff" opacity="0.55"/>
        <ellipse cx="36" cy="42" rx="1.4" ry="1.8" fill="#fff" opacity="0.45"/>
        <ellipse cx="64" cy="42" rx="1.4" ry="1.8" fill="#fff" opacity="0.45"/>
        <!-- soil base shadow -->
        <ellipse cx="50" cy="88" rx="6" ry="1.5" fill="#000" opacity="0.22"/>
      `;
    },

    // ============ New crops (sales-data catalog, 2026-05-24) ============
    shanghai_miao(c) {
      return `
        <defs>
          <filter id="ds_shanghai_miao" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="leaf_shanghai_miao" cx="40%" cy="20%" r="80%">
            <stop offset="0%" stop-color="#d4e88f"/>
            <stop offset="45%" stop-color="#8bc34a"/>
            <stop offset="100%" stop-color="#3a6e1a"/>
          </radialGradient>
          <linearGradient id="stem_shanghai_miao" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#c9b890"/>
            <stop offset="40%" stop-color="#fff8e7"/>
            <stop offset="100%" stop-color="#a89466"/>
          </linearGradient>
          <linearGradient id="shine_shanghai_miao" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="24" ry="3.5" fill="#000" opacity="0.18"/>
        <g filter="url(#ds_shanghai_miao)">
          <!-- back leaves (darker, recede) -->
          <path d="M 50 76 Q 24 64 22 40 Q 30 22 50 28 Q 70 22 78 40 Q 76 64 50 76 Z"
                fill="url(#leaf_shanghai_miao)" stroke="#2e5613" stroke-width="0.6"/>
          <!-- white stem cluster at base -->
          <path d="M 36 88 Q 38 78 44 68 Q 50 64 56 68 Q 62 78 64 88 Z"
                fill="url(#stem_shanghai_miao)" stroke="#a8956b" stroke-width="0.5"/>
          <!-- inner stem ribs -->
          <path d="M 42 86 Q 43 76 45 68" stroke="#a8956b" stroke-width="0.4" fill="none" opacity="0.6"/>
          <path d="M 50 86 L 50 65" stroke="#a8956b" stroke-width="0.4" fill="none" opacity="0.6"/>
          <path d="M 58 86 Q 57 76 55 68" stroke="#a8956b" stroke-width="0.4" fill="none" opacity="0.6"/>
          <!-- front center leaves (brighter, on top) -->
          <path d="M 50 70 Q 36 58 38 38 Q 46 30 50 34 Q 54 30 62 38 Q 64 58 50 70 Z"
                fill="url(#leaf_shanghai_miao)" stroke="#2e5613" stroke-width="0.55"/>
          <!-- subtle leaf veins on front leaf -->
          <path d="M 50 34 Q 50 50 50 68" stroke="#2e5613" stroke-width="0.5" fill="none" opacity="0.55"/>
          <path d="M 40 42 Q 44 50 47 62" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>
          <path d="M 60 42 Q 56 50 53 62" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>
        </g>
        <!-- top-left highlight (Hay Day signature gleam) -->
        <ellipse cx="42" cy="40" rx="9" ry="5.5" fill="url(#shine_shanghai_miao)"/>
        <!-- specular hot spot -->
        <ellipse cx="40" cy="36" rx="2.2" ry="2.6" fill="#fff" opacity="0.65"/>
        <!-- stem base shadow -->
        <ellipse cx="50" cy="87" rx="13" ry="1.4" fill="#000" opacity="0.2"/>
      `;
    },

    xiao_cong(c) {
      return `
        <defs>
          <filter id="ds_xiao_cong" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dx="0.6" dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="stem_xiao_cong" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#d4c099"/>
            <stop offset="35%" stop-color="#fff5dc"/>
            <stop offset="65%" stop-color="#fffaef"/>
            <stop offset="100%" stop-color="#c4ab78"/>
          </linearGradient>
          <linearGradient id="blade1_xiao_cong" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#2e6b1d"/>
            <stop offset="40%" stop-color="#6db835"/>
            <stop offset="80%" stop-color="#a4d062"/>
            <stop offset="100%" stop-color="#d4e88f"/>
          </linearGradient>
          <linearGradient id="blade2_xiao_cong" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#3a7d2c"/>
            <stop offset="50%" stop-color="#8bc34a"/>
            <stop offset="100%" stop-color="#c8e08c"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="18" ry="3" fill="#000" opacity="0.18"/>
        <g filter="url(#ds_xiao_cong)">
          <!-- back blade -->
          <path d="M 50 60 Q 60 50 60 14 Q 58 12 56 16 Q 54 30 50 60 Z" fill="url(#blade2_xiao_cong)"/>
          <!-- white stems cluster -->
          <path d="M 42 88 Q 41 70 43 56 Q 45 53 47 53 Q 49 53 49 56 Q 50 70 49 88 Z" fill="url(#stem_xiao_cong)"/>
          <path d="M 51 88 Q 50 70 51 54 Q 53 51 55 51 Q 57 51 57 54 Q 58 70 57 88 Z" fill="url(#stem_xiao_cong)"/>
          <!-- left blade -->
          <path d="M 43 56 Q 35 40 32 12 Q 30 10 28 14 Q 32 30 43 56 Z" fill="url(#blade1_xiao_cong)"/>
          <!-- center-tallest blade -->
          <path d="M 48 56 Q 47 30 45 8 Q 43 6 41 10 Q 44 32 48 56 Z" fill="url(#blade1_xiao_cong)"/>
          <!-- mid-right blade -->
          <path d="M 54 54 Q 56 32 58 8 Q 60 6 62 10 Q 60 32 54 54 Z" fill="url(#blade1_xiao_cong)"/>
          <!-- right blade -->
          <path d="M 57 54 Q 65 38 68 12 Q 70 10 72 14 Q 68 32 57 54 Z" fill="url(#blade2_xiao_cong)"/>
          <!-- vein highlights on tallest blades -->
          <path d="M 45 8 Q 46 30 47 55" stroke="#d4e88f" stroke-width="0.4" fill="none" opacity="0.8"/>
          <path d="M 58 8 Q 57 30 55 53" stroke="#d4e88f" stroke-width="0.4" fill="none" opacity="0.8"/>
        </g>
        <!-- stem rim highlight -->
        <path d="M 45 88 Q 44 70 46 56" stroke="#ffffff" stroke-width="0.5" fill="none" opacity="0.55"/>
        <path d="M 53 88 Q 52 70 54 54" stroke="#ffffff" stroke-width="0.5" fill="none" opacity="0.55"/>
        <!-- soil base shadow -->
        <ellipse cx="50" cy="87" rx="11" ry="1.4" fill="#000" opacity="0.22"/>
      `;
    },

    you_mai_cai(c) {
      return `
        <defs>
          <filter id="ds_you_mai_cai" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="leafA_you_mai_cai" x1="0%" y1="100%" x2="20%" y2="0%">
            <stop offset="0%" stop-color="#3a6e1a"/>
            <stop offset="50%" stop-color="#7cb342"/>
            <stop offset="100%" stop-color="#c8e08c"/>
          </linearGradient>
          <linearGradient id="leafB_you_mai_cai" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#4a7d1e"/>
            <stop offset="50%" stop-color="#9ccc65"/>
            <stop offset="100%" stop-color="#dce88f"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.18"/>
        <g filter="url(#ds_you_mai_cai)">
          <!-- back-left long leaf -->
          <path d="M 50 86 Q 28 82 24 50 Q 26 26 32 18 Q 38 22 38 44 Q 42 70 50 86 Z"
                fill="url(#leafA_you_mai_cai)" stroke="#2e5613" stroke-width="0.55"/>
          <!-- back-right long leaf -->
          <path d="M 50 86 Q 72 82 76 50 Q 74 26 68 18 Q 62 22 62 44 Q 58 70 50 86 Z"
                fill="url(#leafA_you_mai_cai)" stroke="#2e5613" stroke-width="0.55"/>
          <!-- center tallest leaf (brightest) -->
          <path d="M 50 86 Q 42 60 44 24 Q 50 10 56 24 Q 58 60 50 86 Z"
                fill="url(#leafB_you_mai_cai)" stroke="#2e5613" stroke-width="0.55"/>
          <!-- center leaf vein -->
          <path d="M 50 86 Q 49 60 50 18" stroke="#2e5613" stroke-width="0.45" fill="none" opacity="0.6"/>
          <!-- side vein hints -->
          <path d="M 32 76 Q 30 55 33 30" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.55"/>
          <path d="M 68 76 Q 70 55 67 30" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.55"/>
        </g>
        <!-- highlight gleam on center leaf upper-left -->
        <ellipse cx="46" cy="34" rx="3" ry="9" fill="#fff" opacity="0.4" transform="rotate(-12 46 34)"/>
        <!-- spec hot spot on tallest -->
        <ellipse cx="48" cy="22" rx="1.8" ry="3" fill="#fff" opacity="0.7"/>
        <ellipse cx="50" cy="87" rx="10" ry="1.4" fill="#000" opacity="0.22"/>
      `;
    },

    // cai_xin (choy sum / yu choy): based on Wikipedia + flavor365 reference.
    // Real-world appearance: sold as a tied bundle of 4-6 stems. Slender
    // pale-green erect stems, leaves alternate along upper 2/3 of each
    // stem, EVERY stem ends in a yellow 4-petal flower cluster. Compact
    // bouquet shape, not a tall sparse tree.
    cai_xin(c) {
      return `
        <defs>
          <filter id="ds_cai_xin" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.7"/>
            <feOffset dy="1" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="stem_cai_xin" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#5d8b2f"/>
            <stop offset="50%" stop-color="#8bc34a"/>
            <stop offset="100%" stop-color="#c5e1a5"/>
          </linearGradient>
          <radialGradient id="leaf_cai_xin" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
          <radialGradient id="flower_cai_xin" cx="40%" cy="30%" r="65%">
            <stop offset="0%" stop-color="#fffde7"/>
            <stop offset="55%" stop-color="#fff176"/>
            <stop offset="100%" stop-color="#f57f17"/>
          </radialGradient>
        </defs>

        <!-- ground shadow only -->
        <ellipse cx="50" cy="92" rx="12" ry="2" fill="#000" opacity="0.2"/>

        <!-- Stems (4 in a tight bundle, painted first so leaves & flowers sit on top) -->
        <g stroke-linecap="round" fill="none">
          <path d="M 46 88 Q 44 60 41 22" stroke="#4a7d1e" stroke-width="2.6"/>
          <path d="M 49 88 Q 49 52 49 16" stroke="#4a7d1e" stroke-width="2.8"/>
          <path d="M 52 88 Q 53 52 53 16" stroke="#4a7d1e" stroke-width="2.8"/>
          <path d="M 55 88 Q 57 60 60 22" stroke="#4a7d1e" stroke-width="2.6"/>
          <!-- highlight stripe on stems (pale green inner) -->
          <path d="M 46 88 Q 44 60 41 22" stroke="url(#stem_cai_xin)" stroke-width="1.6"/>
          <path d="M 49 88 Q 49 52 49 16" stroke="url(#stem_cai_xin)" stroke-width="1.8"/>
          <path d="M 52 88 Q 53 52 53 16" stroke="url(#stem_cai_xin)" stroke-width="1.8"/>
          <path d="M 55 88 Q 57 60 60 22" stroke="url(#stem_cai_xin)" stroke-width="1.6"/>
        </g>

        <!-- Leaves (small drop shadow lifts them off stems) -->
        <g filter="url(#ds_cai_xin)">
          <!-- Upper-left leaf -->
          <path d="M 41 30 Q 30 27 27 33 Q 31 38 39 35 Q 42 33 41 30 Z"
                fill="url(#leaf_cai_xin)" stroke="#2e5613" stroke-width="0.4"/>
          <!-- Upper-right leaf -->
          <path d="M 59 30 Q 70 27 73 33 Q 69 38 61 35 Q 58 33 59 30 Z"
                fill="url(#leaf_cai_xin)" stroke="#2e5613" stroke-width="0.4"/>
          <!-- Mid leaves on outer stems -->
          <path d="M 43 48 Q 32 44 28 50 Q 33 56 42 52 Q 45 50 43 48 Z"
                fill="url(#leaf_cai_xin)" stroke="#2e5613" stroke-width="0.4"/>
          <path d="M 57 48 Q 68 44 72 50 Q 67 56 58 52 Q 55 50 57 48 Z"
                fill="url(#leaf_cai_xin)" stroke="#2e5613" stroke-width="0.4"/>
          <!-- Center pair (smaller, behind front stems) -->
          <path d="M 49 40 Q 41 36 39 42 Q 43 47 50 43 Z"
                fill="url(#leaf_cai_xin)" stroke="#2e5613" stroke-width="0.35"/>
          <path d="M 51 40 Q 59 36 61 42 Q 57 47 50 43 Z"
                fill="url(#leaf_cai_xin)" stroke="#2e5613" stroke-width="0.35"/>
          <!-- Lower leaves (larger, hang lower) -->
          <path d="M 44 64 Q 30 60 25 67 Q 32 74 43 69 Q 47 66 44 64 Z"
                fill="url(#leaf_cai_xin)" stroke="#2e5613" stroke-width="0.4"/>
          <path d="M 56 64 Q 70 60 75 67 Q 68 74 57 69 Q 53 66 56 64 Z"
                fill="url(#leaf_cai_xin)" stroke="#2e5613" stroke-width="0.4"/>
        </g>

        <!-- Yellow 4-petal flower puff at top of EACH stem -->
        <g filter="url(#ds_cai_xin)">
          <!-- Outer-left stem flower -->
          <g transform="translate(41 20)">
            <circle cx="-1.5" cy="-1" r="1.4" fill="url(#flower_cai_xin)"/>
            <circle cx="1.5" cy="-1" r="1.4" fill="url(#flower_cai_xin)"/>
            <circle cx="-1.5" cy="1.8" r="1.4" fill="url(#flower_cai_xin)"/>
            <circle cx="1.5" cy="1.8" r="1.4" fill="url(#flower_cai_xin)"/>
            <circle cx="0" cy="0.5" r="0.8" fill="#f9a825"/>
          </g>
          <!-- Center-left stem flower (taller) -->
          <g transform="translate(49 13)">
            <circle cx="-1.8" cy="-1.3" r="1.7" fill="url(#flower_cai_xin)"/>
            <circle cx="1.8" cy="-1.3" r="1.7" fill="url(#flower_cai_xin)"/>
            <circle cx="-1.8" cy="2.2" r="1.7" fill="url(#flower_cai_xin)"/>
            <circle cx="1.8" cy="2.2" r="1.7" fill="url(#flower_cai_xin)"/>
            <circle cx="0" cy="0.5" r="0.9" fill="#f9a825"/>
          </g>
          <!-- Center-right stem flower (taller) -->
          <g transform="translate(53 13)">
            <circle cx="-1.8" cy="-1.3" r="1.7" fill="url(#flower_cai_xin)"/>
            <circle cx="1.8" cy="-1.3" r="1.7" fill="url(#flower_cai_xin)"/>
            <circle cx="-1.8" cy="2.2" r="1.7" fill="url(#flower_cai_xin)"/>
            <circle cx="1.8" cy="2.2" r="1.7" fill="url(#flower_cai_xin)"/>
            <circle cx="0" cy="0.5" r="0.9" fill="#f9a825"/>
          </g>
          <!-- Outer-right stem flower -->
          <g transform="translate(60 20)">
            <circle cx="-1.5" cy="-1" r="1.4" fill="url(#flower_cai_xin)"/>
            <circle cx="1.5" cy="-1" r="1.4" fill="url(#flower_cai_xin)"/>
            <circle cx="-1.5" cy="1.8" r="1.4" fill="url(#flower_cai_xin)"/>
            <circle cx="1.5" cy="1.8" r="1.4" fill="url(#flower_cai_xin)"/>
            <circle cx="0" cy="0.5" r="0.8" fill="#f9a825"/>
          </g>
        </g>

        <!-- Leaf hot spots (over filter group) -->
        <ellipse cx="33" cy="50" rx="1.5" ry="0.9" fill="#fff" opacity="0.5"/>
        <ellipse cx="33" cy="32" rx="1.3" ry="0.8" fill="#fff" opacity="0.5"/>
        <ellipse cx="33" cy="68" rx="1.5" ry="0.9" fill="#fff" opacity="0.5"/>
        <!-- Flower hot spots -->
        <ellipse cx="48" cy="11" rx="1" ry="0.7" fill="#fff" opacity="0.8"/>
        <ellipse cx="52" cy="11" rx="1" ry="0.7" fill="#fff" opacity="0.8"/>

        <!-- Base shadow at soil line -->
        <ellipse cx="50" cy="87" rx="6" ry="1" fill="#000" opacity="0.28"/>
      `;
    },

    ji_mao_cai(c) {
      return `
        <defs>
          <filter id="ds_ji_mao_cai" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="leaf_ji_mao_cai" cx="40%" cy="25%" r="70%">
            <stop offset="0%" stop-color="#e8f5d4"/>
            <stop offset="50%" stop-color="#aed581"/>
            <stop offset="100%" stop-color="#5d8b2f"/>
          </radialGradient>
          <linearGradient id="stem_ji_mao_cai" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#d4c099"/>
            <stop offset="40%" stop-color="#fff8e7"/>
            <stop offset="100%" stop-color="#b9a570"/>
          </linearGradient>
          <linearGradient id="shine_ji_mao_cai" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="18" ry="2.5" fill="#000" opacity="0.18"/>
        <g filter="url(#ds_ji_mao_cai)">
          <!-- small white stem cluster -->
          <path d="M 42 88 Q 43 78 46 72 Q 50 70 54 72 Q 57 78 58 88 Z"
                fill="url(#stem_ji_mao_cai)" stroke="#a89466" stroke-width="0.5"/>
          <!-- back small leaves -->
          <path d="M 50 76 Q 30 66 30 52 Q 36 44 50 48 Q 64 44 70 52 Q 70 66 50 76 Z"
                fill="url(#leaf_ji_mao_cai)" stroke="#2e5613" stroke-width="0.5"/>
          <!-- front center small leaves (rounder, mini) -->
          <path d="M 50 74 Q 40 64 42 52 Q 50 46 58 52 Q 60 64 50 74 Z"
                fill="url(#leaf_ji_mao_cai)" stroke="#2e5613" stroke-width="0.5"/>
          <!-- tiny center veins -->
          <path d="M 50 48 L 50 72" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.55"/>
          <path d="M 42 52 Q 46 60 48 70" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>
          <path d="M 58 52 Q 54 60 52 70" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>
        </g>
        <!-- highlight gleam upper-left -->
        <ellipse cx="42" cy="54" rx="7" ry="4" fill="url(#shine_ji_mao_cai)"/>
        <ellipse cx="40" cy="50" rx="1.8" ry="2.2" fill="#fff" opacity="0.7"/>
        <ellipse cx="50" cy="87" rx="9" ry="1.2" fill="#000" opacity="0.22"/>
      `;
    },

    // tong_hao (Crown Daisy / Chrysanthemum Greens) — EMOJI-STYLE rewrite.
    // 3 fern fronds with bold lobed silhouettes (single SVG paths cut with
    // multiple Q-curves to give that characteristic serrated chrysanthemum
    // leaf shape). Iconic, not fussy.
    tong_hao(c) {
      return `
        <defs>
          <filter id="ds_tong_hao" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="frondA_tong_hao" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#3a6e1a"/>
            <stop offset="50%" stop-color="#7cb342"/>
            <stop offset="100%" stop-color="#c5e1a5"/>
          </linearGradient>
          <linearGradient id="frondB_tong_hao" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#4a7d1e"/>
            <stop offset="50%" stop-color="#8bc34a"/>
            <stop offset="100%" stop-color="#dcedc8"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="20" ry="3" fill="#000" opacity="0.2"/>

        <g filter="url(#ds_tong_hao)">
          <!-- LEFT frond (back layer) — lobed leaf silhouette via Q curves -->
          <path d="M 50 86
                   Q 30 76 22 56
                   Q 18 50 24 48
                   Q 26 52 32 50
                   Q 30 42 36 42
                   Q 38 48 42 46
                   Q 38 36 44 36
                   Q 44 42 48 42
                   Q 46 32 50 32
                   Z"
                fill="url(#frondA_tong_hao)" stroke="#2e5613" stroke-width="0.6"/>

          <!-- CENTER frond (tallest, front) -->
          <path d="M 50 86
                   Q 40 60 42 32
                   Q 38 28 44 22
                   Q 46 28 50 26
                   Q 52 22 54 18
                   Q 50 14 50 8
                   Q 50 14 56 18
                   Q 56 22 58 28
                   Q 60 22 58 30
                   Q 60 34 56 36
                   Q 62 40 58 42
                   Q 58 50 62 56
                   Q 56 62 50 86
                   Z"
                fill="url(#frondB_tong_hao)" stroke="#2e5613" stroke-width="0.6"/>

          <!-- RIGHT frond (back layer mirror) -->
          <path d="M 50 86
                   Q 70 76 78 56
                   Q 82 50 76 48
                   Q 74 52 68 50
                   Q 70 42 64 42
                   Q 62 48 58 46
                   Q 62 36 56 36
                   Q 56 42 52 42
                   Q 54 32 50 32
                   Z"
                fill="url(#frondA_tong_hao)" stroke="#2e5613" stroke-width="0.6"/>

          <!-- center frond mid-vein -->
          <path d="M 50 86 Q 49 50 50 20"
                stroke="#2e5613" stroke-width="0.6" fill="none" opacity="0.6"/>
        </g>

        <!-- highlight gleam on top-left of center frond -->
        <ellipse cx="44" cy="36" rx="3" ry="8" fill="#fff" opacity="0.4" transform="rotate(-15 44 36)"/>
        <ellipse cx="48" cy="22" rx="1.4" ry="2.5" fill="#fff" opacity="0.65"/>

        <!-- base shadow -->
        <ellipse cx="50" cy="87" rx="9" ry="1.3" fill="#000" opacity="0.25"/>
      `;
    },

    // bo_cai (Chinese spinach 红根菠菜): rosette of 5 oval-lance leaves
    // radiating from a central crown. Smooth glossy leaves. Distinctive
    // RED LOWER STEM near the root (the "red-root" Chinese variety).
    bo_cai(c) {
      return `
        <defs>
          <filter id="ds_bo_cai" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.9"/>
            <feOffset dy="1.4" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.32"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="leafA_bo_cai" cx="35%" cy="25%" r="85%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
          <radialGradient id="leafB_bo_cai" cx="50%" cy="25%" r="80%">
            <stop offset="0%" stop-color="#c5e1a5"/>
            <stop offset="55%" stop-color="#6ab041"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
          <linearGradient id="redroot_bo_cai" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#7a1f1f"/>
            <stop offset="60%" stop-color="#c1402c"/>
            <stop offset="100%" stop-color="#9ccc65"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="18" ry="3" fill="#000" opacity="0.2"/>

        <!-- Back layer leaves -->
        <g filter="url(#ds_bo_cai)">
          <!-- left back leaf -->
          <path d="M 50 80 Q 26 70 22 44 Q 28 26 38 28 Q 44 48 50 80 Z"
                fill="url(#leafA_bo_cai)" stroke="#2e5613" stroke-width="0.5"/>
          <!-- right back leaf -->
          <path d="M 50 80 Q 74 70 78 44 Q 72 26 62 28 Q 56 48 50 80 Z"
                fill="url(#leafA_bo_cai)" stroke="#2e5613" stroke-width="0.5"/>
          <!-- center back tall leaf -->
          <path d="M 50 80 Q 44 50 46 16 Q 50 10 54 16 Q 56 50 50 80 Z"
                fill="url(#leafB_bo_cai)" stroke="#2e5613" stroke-width="0.5"/>
          <!-- front-left leaf (lower, brighter) -->
          <path d="M 50 82 Q 36 74 30 56 Q 32 42 42 44 Q 48 58 50 82 Z"
                fill="url(#leafB_bo_cai)" stroke="#2e5613" stroke-width="0.5"/>
          <!-- front-right leaf -->
          <path d="M 50 82 Q 64 74 70 56 Q 68 42 58 44 Q 52 58 50 82 Z"
                fill="url(#leafB_bo_cai)" stroke="#2e5613" stroke-width="0.5"/>

          <!-- Veins on visible front-leaves -->
          <path d="M 50 80 Q 48 50 50 18" stroke="#2e5613" stroke-width="0.5" fill="none" opacity="0.55"/>
          <path d="M 50 82 Q 42 66 36 52" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>
          <path d="M 50 82 Q 58 66 64 52" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>
          <path d="M 28 60 Q 30 46 36 32" stroke="#2e5613" stroke-width="0.35" fill="none" opacity="0.4"/>
          <path d="M 72 60 Q 70 46 64 32" stroke="#2e5613" stroke-width="0.35" fill="none" opacity="0.4"/>
        </g>

        <!-- The signature RED ROOT at the base -->
        <path d="M 47 90 Q 46 86 47 80 L 53 80 Q 54 86 53 90 Z"
              fill="url(#redroot_bo_cai)" stroke="#5a1212" stroke-width="0.5"/>

        <!-- glossy highlight blobs on front leaves -->
        <ellipse cx="42" cy="58" rx="3" ry="6" fill="#fff" opacity="0.35" transform="rotate(-20 42 58)"/>
        <ellipse cx="48" cy="28" rx="2" ry="6" fill="#fff" opacity="0.4" transform="rotate(-8 48 28)"/>
        <!-- spec hot spot near top of tallest -->
        <ellipse cx="48" cy="22" rx="1.5" ry="2" fill="#fff" opacity="0.7"/>

        <!-- soil base shadow -->
        <ellipse cx="50" cy="88" rx="9" ry="1.3" fill="#000" opacity="0.25"/>
      `;
    },

    // wa_wa_cai (baby napa cabbage) — EMOJI-STYLE rewrite.
    // Single compact oblong body, smooth transition from pale cream base
    // to pale-green leafy crown. Vertical white veins. No spiky leaf-tips
    // (the old version's "cone hats" problem).
    wa_wa_cai(c) {
      return `
        <defs>
          <filter id="ds_wa_wa_cai" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <!-- Body gradient: pale cream base → pale green top (single smooth blend) -->
          <linearGradient id="body_wa_wa_cai" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#e8d99a"/>
            <stop offset="35%" stop-color="#fff8e1"/>
            <stop offset="65%" stop-color="#dcedc8"/>
            <stop offset="100%" stop-color="#7cb342"/>
          </linearGradient>
          <!-- Side shading (left-right) for roundness -->
          <linearGradient id="shade_wa_wa_cai" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000" stop-opacity="0.18"/>
            <stop offset="40%" stop-color="#000" stop-opacity="0"/>
            <stop offset="60%" stop-color="#000" stop-opacity="0"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0.18"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="15" ry="2.5" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_wa_wa_cai)">
          <!-- Single iconic oblong body — taller than wide, soft-rounded top, narrower base -->
          <path d="M 35 88
                   Q 30 70 32 44
                   Q 36 16 50 12
                   Q 64 16 68 44
                   Q 70 70 65 88
                   Z"
                fill="url(#body_wa_wa_cai)" stroke="#4a7d1e" stroke-width="0.7"/>

          <!-- Side shading overlay (gives 3D roundness) -->
          <path d="M 35 88
                   Q 30 70 32 44
                   Q 36 16 50 12
                   Q 64 16 68 44
                   Q 70 70 65 88
                   Z"
                fill="url(#shade_wa_wa_cai)"/>

          <!-- Vertical white veins (subtle, only on the lower cream portion) -->
          <path d="M 41 86 Q 39 60 42 38" stroke="#fff" stroke-width="0.7" fill="none" opacity="0.55"/>
          <path d="M 50 87 L 50 36" stroke="#fff" stroke-width="0.9" fill="none" opacity="0.65"/>
          <path d="M 59 86 Q 61 60 58 38" stroke="#fff" stroke-width="0.7" fill="none" opacity="0.55"/>

          <!-- Top leafy crown definition: soft scallop edge -->
          <path d="M 36 28 Q 42 22 50 24 Q 58 22 64 28"
                stroke="#558b2f" stroke-width="0.7" fill="none" opacity="0.7"/>
          <path d="M 38 18 Q 44 13 50 16 Q 56 13 62 18"
                stroke="#558b2f" stroke-width="0.6" fill="none" opacity="0.55"/>
        </g>

        <!-- Top glossy highlight on left side -->
        <ellipse cx="42" cy="34" rx="3" ry="9" fill="#fff" opacity="0.4" transform="rotate(-8 42 34)"/>
        <!-- Hot spec -->
        <ellipse cx="44" cy="22" rx="1.5" ry="2.5" fill="#fff" opacity="0.65"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="88" rx="11" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // xi_lan_hua (broccoli): thick pale-green stem + dome of densely packed
    // dark green florets. Florets render as overlapping bumpy clusters of
    // small circles for that "bouquet" head appearance.
    xi_lan_hua(c) {
      return `
        <defs>
          <filter id="ds_xi_lan_hua" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="stem_xi_lan_hua" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#bcd486"/>
            <stop offset="60%" stop-color="#dcedc8"/>
            <stop offset="100%" stop-color="#aed581"/>
          </linearGradient>
          <radialGradient id="floretA_xi_lan_hua" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#9ccc65"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
          <radialGradient id="floretB_xi_lan_hua" cx="60%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#6ab041"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="20" ry="3" fill="#000" opacity="0.2"/>

        <g filter="url(#ds_xi_lan_hua)">
          <!-- Thick stem -->
          <path d="M 42 88 Q 40 70 44 56 L 56 56 Q 60 70 58 88 Z"
                fill="url(#stem_xi_lan_hua)" stroke="#7a9a4d" stroke-width="0.7"/>
          <!-- Stem vertical line texture -->
          <path d="M 47 86 L 47 60" stroke="#9ab26b" stroke-width="0.4" opacity="0.7"/>
          <path d="M 53 86 L 53 60" stroke="#9ab26b" stroke-width="0.4" opacity="0.7"/>

          <!-- Big background dome shadow (back layer of florets) -->
          <path d="M 26 50 Q 22 30 50 22 Q 78 30 74 50 Q 60 62 50 62 Q 40 62 26 50 Z"
                fill="url(#floretA_xi_lan_hua)" stroke="#2e5613" stroke-width="0.8"/>

          <!-- Mid-back florets (slightly smaller) -->
          <circle cx="30" cy="46" r="6" fill="url(#floretA_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>
          <circle cx="40" cy="36" r="6.5" fill="url(#floretB_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>
          <circle cx="50" cy="30" r="7" fill="url(#floretA_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>
          <circle cx="60" cy="36" r="6.5" fill="url(#floretB_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>
          <circle cx="70" cy="46" r="6" fill="url(#floretA_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>

          <!-- Front florets (larger, on top) -->
          <circle cx="34" cy="52" r="6" fill="url(#floretB_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>
          <circle cx="44" cy="46" r="6.5" fill="url(#floretA_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>
          <circle cx="56" cy="46" r="6.5" fill="url(#floretB_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>
          <circle cx="66" cy="52" r="6" fill="url(#floretA_xi_lan_hua)" stroke="#2e5613" stroke-width="0.4"/>

          <!-- Tiny bud texture dots on top of florets -->
          <g fill="#2e5613" opacity="0.5">
            <circle cx="30" cy="44" r="0.7"/><circle cx="33" cy="48" r="0.7"/>
            <circle cx="40" cy="34" r="0.7"/><circle cx="44" cy="38" r="0.7"/>
            <circle cx="50" cy="28" r="0.7"/><circle cx="48" cy="32" r="0.7"/><circle cx="52" cy="32" r="0.7"/>
            <circle cx="60" cy="34" r="0.7"/><circle cx="64" cy="38" r="0.7"/>
            <circle cx="70" cy="44" r="0.7"/><circle cx="67" cy="48" r="0.7"/>
            <circle cx="34" cy="50" r="0.7"/><circle cx="38" cy="54" r="0.7"/>
            <circle cx="44" cy="44" r="0.7"/><circle cx="56" cy="44" r="0.7"/>
            <circle cx="62" cy="54" r="0.7"/><circle cx="66" cy="50" r="0.7"/>
          </g>
        </g>

        <!-- Highlight gleams on upper-left of florets -->
        <ellipse cx="42" cy="32" rx="2.5" ry="3.5" fill="#fff" opacity="0.45"/>
        <ellipse cx="36" cy="44" rx="1.6" ry="2.2" fill="#fff" opacity="0.5"/>
        <ellipse cx="48" cy="26" rx="1.4" ry="1.8" fill="#fff" opacity="0.65"/>
        <!-- Stem highlight stripe -->
        <ellipse cx="46" cy="72" rx="1.2" ry="10" fill="#fff" opacity="0.4"/>

        <!-- soil shadow -->
        <ellipse cx="50" cy="88" rx="11" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // niu_jiao_jiao (horn pepper) — emoji-style. Long curved cayenne-type
    // pepper, sizable + thin-skinned. Bold red gradient + glossy highlight
    // + small green calyx + stem at top.
    niu_jiao_jiao(c) {
      // Asymmetric horn-shaped green pepper. Stem at top, body curves
      // outward (convex outer arc) and sweeps to a pointed tip in the
      // lower-right. Inspired by real 牛角椒 produce — long, slender,
      // curved like an actual horn, not a symmetric teardrop.
      return `
        <defs>
          <filter id="ds_niu_jiao_jiao" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="body_niu_jiao_jiao" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stop-color="#9bcd5a"/>
            <stop offset="50%" stop-color="#6ea838"/>
            <stop offset="100%" stop-color="#4a7522"/>
          </linearGradient>
        </defs>
        <!-- Shadow under the tip (offset to the lower-right) -->
        <ellipse cx="54" cy="92" rx="14" ry="2.3" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_niu_jiao_jiao)">
          <!-- Horn-shaped body: FULL rounded shoulders just below the calyx,
               then a continuous taper down a gentle bend to a SHARP point at
               the bottom — the silhouette of a real ox-horn pepper, not a
               uniform banana/pod. Outer (left) edge convex, inner (right)
               edge concave; the two edges meet in a cusp at the tip. -->
          <path d="M 45 17
                   C 38 17 33 24 32 34
                   C 31 51 38 74 58 90
                   C 56 69 55 48 57 34
                   C 57 24 52 17 46 17
                   C 46 15 45 15 45 17
                   Z"
                fill="url(#body_niu_jiao_jiao)" stroke="#2f5212" stroke-width="0.6"/>

          <!-- Glossy highlight following the convex (left) edge + the bend -->
          <path d="M 38 26 C 32 42 35 64 51 84" stroke="#d8f0a8" stroke-width="3" fill="none" opacity="0.5" stroke-linecap="round"/>
          <path d="M 38 26 C 32 42 35 64 51 84" stroke="#f4fadd" stroke-width="1.2" fill="none" opacity="0.85" stroke-linecap="round"/>

          <!-- Subtle center ridge tracing the bend -->
          <path d="M 46 22 C 41 46 47 70 56 86" stroke="#2f5212" stroke-width="0.5" fill="none" opacity="0.3"/>

          <!-- Darker green calyx (small leaves hugging the shoulder) -->
          <path d="M 40 16 Q 42 10 47 8 Q 50 12 48 16 Z" fill="#3d6c1a" stroke="#26450c" stroke-width="0.5"/>
          <path d="M 47 10 Q 51 8 55 10 Q 53 16 47 14 Z" fill="#4a7e22" stroke="#26450c" stroke-width="0.5"/>
          <path d="M 51 16 Q 55 14 57 18 Q 53 19 49 17 Z" fill="#3d6c1a" stroke="#26450c" stroke-width="0.5"/>

          <!-- Short stem nub -->
          <path d="M 47 10 L 46 3" stroke="#2f5212" stroke-width="2.2" stroke-linecap="round"/>
        </g>

        <!-- Tiny specular hot spot on the outer (left) shoulder bulge -->
        <ellipse cx="35" cy="38" rx="2" ry="3" fill="#fff" opacity="0.7"/>
      `;
    },

    // da_bai_cai (full-size napa cabbage) — emoji-style. Bigger version of
    // wa_wa_cai (~50% larger body) with the same single iconic shape.
    // Distinguished by size and slightly more pronounced top-leaf curl.
    da_bai_cai(c) {
      return `
        <defs>
          <filter id="ds_da_bai_cai" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="body_da_bai_cai" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#dac98a"/>
            <stop offset="35%" stop-color="#fff8dc"/>
            <stop offset="70%" stop-color="#dcedc8"/>
            <stop offset="100%" stop-color="#7cb342"/>
          </linearGradient>
          <linearGradient id="shade_da_bai_cai" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000" stop-opacity="0.18"/>
            <stop offset="40%" stop-color="#000" stop-opacity="0"/>
            <stop offset="60%" stop-color="#000" stop-opacity="0"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0.18"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.25"/>

        <g filter="url(#ds_da_bai_cai)">
          <!-- Big oblong body (wider + taller than wa_wa_cai) -->
          <path d="M 26 88
                   Q 20 64 24 40
                   Q 28 12 50 8
                   Q 72 12 76 40
                   Q 80 64 74 88
                   Z"
                fill="url(#body_da_bai_cai)" stroke="#4a7d1e" stroke-width="0.8"/>

          <!-- Side shading overlay -->
          <path d="M 26 88
                   Q 20 64 24 40
                   Q 28 12 50 8
                   Q 72 12 76 40
                   Q 80 64 74 88
                   Z"
                fill="url(#shade_da_bai_cai)"/>

          <!-- Stronger vertical white veins (more numerous than wa_wa_cai) -->
          <path d="M 33 86 Q 30 60 33 36" stroke="#fff" stroke-width="0.8" fill="none" opacity="0.55"/>
          <path d="M 42 87 Q 40 58 41 30" stroke="#fff" stroke-width="0.9" fill="none" opacity="0.65"/>
          <path d="M 50 88 L 50 26" stroke="#fff" stroke-width="1" fill="none" opacity="0.75"/>
          <path d="M 58 87 Q 60 58 59 30" stroke="#fff" stroke-width="0.9" fill="none" opacity="0.65"/>
          <path d="M 67 86 Q 70 60 67 36" stroke="#fff" stroke-width="0.8" fill="none" opacity="0.55"/>

          <!-- Top leaf curl bumps (4 scalloped definitions) -->
          <path d="M 30 28 Q 36 22 42 26" stroke="#558b2f" stroke-width="0.8" fill="none" opacity="0.75"/>
          <path d="M 42 26 Q 46 18 50 22" stroke="#558b2f" stroke-width="0.8" fill="none" opacity="0.75"/>
          <path d="M 50 22 Q 54 18 58 26" stroke="#558b2f" stroke-width="0.8" fill="none" opacity="0.75"/>
          <path d="M 58 26 Q 64 22 70 28" stroke="#558b2f" stroke-width="0.8" fill="none" opacity="0.75"/>
          <path d="M 36 16 Q 42 12 48 16" stroke="#558b2f" stroke-width="0.7" fill="none" opacity="0.55"/>
          <path d="M 52 16 Q 58 12 64 16" stroke="#558b2f" stroke-width="0.7" fill="none" opacity="0.55"/>
        </g>

        <!-- Glossy highlight on upper-left -->
        <ellipse cx="36" cy="40" rx="4" ry="14" fill="#fff" opacity="0.4" transform="rotate(-6 36 40)"/>
        <ellipse cx="38" cy="22" rx="2" ry="3" fill="#fff" opacity="0.6"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="88" rx="15" ry="1.4" fill="#000" opacity="0.28"/>
      `;
    },

    // suan_tai (garlic scapes) — emoji-style. Long slender stems with the
    // characteristic CURL/COIL at the top (the iconic feature of scapes).
    // Each stem ends in a small flower bud (umbel). Bright spring green.
    suan_tai(c) {
      return `
        <defs>
          <filter id="ds_suan_tai" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1"/>
            <feOffset dy="1.4" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="stem_suan_tai" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#5a8a2e"/>
            <stop offset="50%" stop-color="#9ccc65"/>
            <stop offset="100%" stop-color="#c5e1a5"/>
          </linearGradient>
          <radialGradient id="bud_suan_tai" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#dcedc8"/>
            <stop offset="60%" stop-color="#aed581"/>
            <stop offset="100%" stop-color="#558b2f"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="14" ry="2.5" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_suan_tai)">
          <!-- Stem 1 (left): rises straight, then curls into a loop at top -->
          <path d="M 42 88
                   Q 38 60 36 36
                   Q 34 22 40 18
                   Q 48 14 48 22
                   Q 48 28 42 28"
                stroke="url(#stem_suan_tai)" stroke-width="2.2" fill="none" stroke-linecap="round"/>

          <!-- Stem 2 (center, tallest): rises higher, then curls -->
          <path d="M 50 88
                   Q 50 50 52 24
                   Q 54 10 62 12
                   Q 68 16 66 24
                   Q 64 32 56 30"
                stroke="url(#stem_suan_tai)" stroke-width="2.4" fill="none" stroke-linecap="round"/>

          <!-- Stem 3 (right): mid-height, curls -->
          <path d="M 58 88
                   Q 62 60 64 40
                   Q 66 28 72 26
                   Q 78 26 76 34
                   Q 74 42 68 40"
                stroke="url(#stem_suan_tai)" stroke-width="2.2" fill="none" stroke-linecap="round"/>

          <!-- Flower buds at the end of each curl -->
          <ellipse cx="42" cy="28" rx="3" ry="4" fill="url(#bud_suan_tai)" stroke="#3a6e1a" stroke-width="0.4"/>
          <ellipse cx="56" cy="30" rx="3.2" ry="4.5" fill="url(#bud_suan_tai)" stroke="#3a6e1a" stroke-width="0.4"/>
          <ellipse cx="68" cy="40" rx="3" ry="4" fill="url(#bud_suan_tai)" stroke="#3a6e1a" stroke-width="0.4"/>

          <!-- Pointy tips on buds -->
          <path d="M 42 24 L 41 21 M 56 25 L 55 22 M 68 36 L 67 33"
                stroke="#3a6e1a" stroke-width="0.8" stroke-linecap="round"/>
        </g>

        <!-- Highlight stripes on stems -->
        <path d="M 41 80 Q 36 56 35 38" stroke="#fff" stroke-width="0.5" fill="none" opacity="0.55"/>
        <path d="M 49 80 Q 49 50 51 26" stroke="#fff" stroke-width="0.55" fill="none" opacity="0.6"/>
        <path d="M 57 80 Q 61 60 63 42" stroke="#fff" stroke-width="0.5" fill="none" opacity="0.55"/>
        <!-- Bud highlight specs -->
        <ellipse cx="41" cy="26" rx="1" ry="1.4" fill="#fff" opacity="0.6"/>
        <ellipse cx="55" cy="28" rx="1.1" ry="1.5" fill="#fff" opacity="0.6"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="88" rx="9" ry="1.3" fill="#000" opacity="0.25"/>
      `;
    },

    // bai_luo_bo (daikon radish) — emoji-style. Long cylindrical white root
    // with ROUNDED tip (not pointed like a carrot). Pale green hint at the
    // top shoulder. Big leafy green crown with serrated leaf edges.
    bai_luo_bo(c) {
      return `
        <defs>
          <filter id="ds_bai_luo_bo" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="root_bai_luo_bo" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#bfb89a"/>
            <stop offset="30%" stop-color="#f5f5f0"/>
            <stop offset="60%" stop-color="#fffffe"/>
            <stop offset="100%" stop-color="#aaa280"/>
          </linearGradient>
          <linearGradient id="shoulder_bai_luo_bo" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#9ccc65"/>
            <stop offset="100%" stop-color="#f5f5f0" stop-opacity="0"/>
          </linearGradient>
          <radialGradient id="leaf_bai_luo_bo" cx="40%" cy="80%" r="80%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="94" rx="14" ry="2" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_bai_luo_bo)">
          <!-- Daikon root: long cylindrical, rounded tip -->
          <path d="M 40 38
                   Q 36 50 38 70
                   Q 42 90 50 92
                   Q 58 90 62 70
                   Q 64 50 60 38
                   Z"
                fill="url(#root_bai_luo_bo)" stroke="#8b7c5a" stroke-width="0.7"/>

          <!-- Pale green shoulder shading -->
          <path d="M 40 38 Q 50 36 60 38 L 60 50 Q 50 48 40 50 Z"
                fill="url(#shoulder_bai_luo_bo)" opacity="0.85"/>

          <!-- Horizontal root ring marks -->
          <path d="M 40 50 Q 50 52 60 50" stroke="#8b7c5a" stroke-width="0.4" fill="none" opacity="0.4"/>
          <path d="M 39 64 Q 50 66 61 64" stroke="#8b7c5a" stroke-width="0.4" fill="none" opacity="0.4"/>
          <path d="M 40 78 Q 50 80 60 78" stroke="#8b7c5a" stroke-width="0.4" fill="none" opacity="0.35"/>

          <!-- Leafy green crown (4 jagged leaves) -->
          <path d="M 50 36 Q 42 26 30 18 Q 26 14 34 12 Q 38 18 42 22 Q 38 16 44 14 Q 46 22 50 30 Z"
                fill="url(#leaf_bai_luo_bo)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 50 36 Q 50 22 46 10 Q 50 6 54 10 Q 56 22 52 34 Z"
                fill="url(#leaf_bai_luo_bo)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 50 36 Q 58 26 70 18 Q 74 14 66 12 Q 62 18 58 22 Q 62 16 56 14 Q 54 22 50 30 Z"
                fill="url(#leaf_bai_luo_bo)" stroke="#2e5613" stroke-width="0.5"/>

          <!-- Center leaf vein -->
          <path d="M 50 34 Q 50 22 50 10" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.6"/>
        </g>

        <!-- Long highlight stripe on left side of root -->
        <ellipse cx="44" cy="60" rx="2" ry="18" fill="#fff" opacity="0.45" transform="rotate(-4 44 60)"/>
        <!-- Hot spec on root -->
        <ellipse cx="44" cy="48" rx="2" ry="2.5" fill="#fff" opacity="0.6"/>
        <!-- Leaf hot spot -->
        <ellipse cx="44" cy="18" rx="1.5" ry="2.5" fill="#fff" opacity="0.55"/>

        <!-- Base shadow under root -->
        <ellipse cx="50" cy="90" rx="9" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // hu_luo_bo (carrot) — emoji-style. Classic orange tapered cone with
    // POINTED tip (distinct from daikon's rounded tip). Feathery green tops
    // (carrot leaves have fern-like fronds, similar to dill).
    hu_luo_bo(c) {
      return `
        <defs>
          <filter id="ds_hu_luo_bo" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="root_hu_luo_bo" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#a83608"/>
            <stop offset="30%" stop-color="#ed5c1d"/>
            <stop offset="60%" stop-color="#ff7e3f"/>
            <stop offset="100%" stop-color="#c54514"/>
          </linearGradient>
          <radialGradient id="leaf_hu_luo_bo" cx="50%" cy="80%" r="70%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="94" rx="11" ry="1.8" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_hu_luo_bo)">
          <!-- Tapered carrot root: wide at top, pointed at bottom -->
          <path d="M 40 36
                   Q 38 50 42 70
                   Q 46 88 50 94
                   Q 54 88 58 70
                   Q 62 50 60 36
                   Z"
                fill="url(#root_hu_luo_bo)" stroke="#5c2008" stroke-width="0.7"/>

          <!-- Horizontal carrot ring marks -->
          <path d="M 42 48 Q 50 50 58 48" stroke="#5c2008" stroke-width="0.4" fill="none" opacity="0.5"/>
          <path d="M 43 58 Q 50 60 57 58" stroke="#5c2008" stroke-width="0.4" fill="none" opacity="0.45"/>
          <path d="M 44 68 Q 50 70 56 68" stroke="#5c2008" stroke-width="0.4" fill="none" opacity="0.4"/>
          <path d="M 45 78 Q 50 80 55 78" stroke="#5c2008" stroke-width="0.4" fill="none" opacity="0.35"/>

          <!-- Feathery carrot tops (3 frond-like leaf clusters) -->
          <path d="M 50 36 Q 40 26 32 14 L 36 12 Q 42 22 46 32 Z"
                fill="url(#leaf_hu_luo_bo)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 50 36 Q 46 22 48 8 L 52 8 Q 54 22 50 36 Z"
                fill="url(#leaf_hu_luo_bo)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 50 36 Q 60 26 68 14 L 64 12 Q 58 22 54 32 Z"
                fill="url(#leaf_hu_luo_bo)" stroke="#2e5613" stroke-width="0.5"/>

          <!-- Small additional feathery sub-leaflets -->
          <ellipse cx="34" cy="18" rx="3" ry="2" fill="#558b2f" stroke="#2e5613" stroke-width="0.4" transform="rotate(-40 34 18)"/>
          <ellipse cx="66" cy="18" rx="3" ry="2" fill="#558b2f" stroke="#2e5613" stroke-width="0.4" transform="rotate(40 66 18)"/>
          <ellipse cx="42" cy="22" rx="2.5" ry="1.6" fill="#7cb342" stroke="#3a6e1a" stroke-width="0.4" transform="rotate(-25 42 22)"/>
          <ellipse cx="58" cy="22" rx="2.5" ry="1.6" fill="#7cb342" stroke="#3a6e1a" stroke-width="0.4" transform="rotate(25 58 22)"/>

          <!-- Center leaf vein -->
          <path d="M 50 36 L 50 8" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.6"/>
        </g>

        <!-- Glossy highlight stripe on the left side of root -->
        <ellipse cx="44" cy="58" rx="2" ry="18" fill="#fff" opacity="0.45" transform="rotate(-4 44 58)"/>
        <!-- Hot spec -->
        <ellipse cx="44" cy="46" rx="1.5" ry="2.5" fill="#fff" opacity="0.65"/>
        <!-- Top leaf hot spot -->
        <ellipse cx="48" cy="14" rx="1.5" ry="2" fill="#fff" opacity="0.6"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="90" rx="7" ry="1.2" fill="#000" opacity="0.25"/>
      `;
    },

    // wo_sun (celtuce) — emoji-style. THICK pale yellow-green stem (the
    // prized eating part) with vertical grooves + small green leaf cluster
    // on top. The store's #1 vegetable.
    wo_sun(c) {
      return `
        <defs>
          <filter id="ds_wo_sun" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="stem_wo_sun" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#a3b85a"/>
            <stop offset="30%" stop-color="#e6ee9c"/>
            <stop offset="60%" stop-color="#fff59d"/>
            <stop offset="100%" stop-color="#8b9c4a"/>
          </linearGradient>
          <radialGradient id="leaf_wo_sun" cx="40%" cy="70%" r="80%">
            <stop offset="0%" stop-color="#c5e1a5"/>
            <stop offset="55%" stop-color="#7cb342"/>
            <stop offset="100%" stop-color="#3a6e1a"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="14" ry="2.5" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_wo_sun)">
          <!-- Thick stem (main body) -->
          <path d="M 38 88
                   Q 34 70 36 50
                   Q 38 36 42 32
                   L 58 32
                   Q 62 36 64 50
                   Q 66 70 62 88
                   Z"
                fill="url(#stem_wo_sun)" stroke="#6b7a32" stroke-width="0.7"/>
          <!-- Vertical grooves on stem -->
          <path d="M 41 86 Q 39 68 41 42" stroke="#6b7a32" stroke-width="0.5" fill="none" opacity="0.65"/>
          <path d="M 47 87 Q 45 65 47 38" stroke="#6b7a32" stroke-width="0.5" fill="none" opacity="0.65"/>
          <path d="M 53 87 Q 55 65 53 38" stroke="#6b7a32" stroke-width="0.5" fill="none" opacity="0.65"/>
          <path d="M 59 86 Q 61 68 59 42" stroke="#6b7a32" stroke-width="0.5" fill="none" opacity="0.65"/>

          <!-- Small leaf cluster on top -->
          <path d="M 42 32 Q 30 22 26 12 Q 36 8 44 22 Z" fill="url(#leaf_wo_sun)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 50 30 Q 46 16 48 6 Q 54 8 52 22 Z" fill="url(#leaf_wo_sun)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 58 32 Q 70 22 74 12 Q 64 8 56 22 Z" fill="url(#leaf_wo_sun)" stroke="#2e5613" stroke-width="0.5"/>
        </g>

        <!-- Highlight on left side of stem -->
        <ellipse cx="42" cy="56" rx="2.5" ry="20" fill="#fff" opacity="0.4" transform="rotate(-3 42 56)"/>
        <ellipse cx="44" cy="44" rx="2" ry="2.8" fill="#fff" opacity="0.65"/>
        <!-- Leaf hot spot -->
        <ellipse cx="48" cy="14" rx="1.5" ry="2" fill="#fff" opacity="0.55"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="88" rx="11" ry="1.4" fill="#000" opacity="0.28"/>
      `;
    },

    // pa_pa_gan (Papa Tangerine) — emoji-style. Large bright orange citrus
    // with characteristic dimpled skin texture + green leaves + stem.
    pa_pa_gan(c) {
      return `
        <defs>
          <filter id="ds_pa_pa_gan" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="body_pa_pa_gan" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#ffd180"/>
            <stop offset="55%" stop-color="#ffa726"/>
            <stop offset="100%" stop-color="#bf5500"/>
          </radialGradient>
          <radialGradient id="leaf_pa_pa_gan" cx="40%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#9ccc65"/>
            <stop offset="100%" stop-color="#2e6b1d"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="24" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_pa_pa_gan)">
          <circle cx="50" cy="58" r="28" fill="url(#body_pa_pa_gan)" stroke="#8b3a00" stroke-width="0.8"/>
          <!-- dimpled skin texture -->
          <g fill="#bf5500" opacity="0.3">
            <circle cx="35" cy="50" r="0.7"/><circle cx="45" cy="46" r="0.7"/><circle cx="58" cy="48" r="0.7"/>
            <circle cx="64" cy="56" r="0.7"/><circle cx="60" cy="68" r="0.7"/><circle cx="42" cy="72" r="0.7"/>
            <circle cx="32" cy="62" r="0.7"/><circle cx="50" cy="78" r="0.7"/><circle cx="38" cy="60" r="0.7"/>
          </g>
          <!-- stem nub + leaves -->
          <path d="M 50 30 L 50 22" stroke="#6d4528" stroke-width="2.2" stroke-linecap="round"/>
          <ellipse cx="42" cy="26" rx="6.5" ry="3.5" fill="url(#leaf_pa_pa_gan)" stroke="#2e5613" stroke-width="0.5" transform="rotate(-30 42 26)"/>
          <ellipse cx="58" cy="26" rx="6.5" ry="3.5" fill="url(#leaf_pa_pa_gan)" stroke="#2e5613" stroke-width="0.5" transform="rotate(30 58 26)"/>
        </g>
        <ellipse cx="40" cy="46" rx="8" ry="5" fill="#fff" opacity="0.55"/>
        <ellipse cx="38" cy="42" rx="3" ry="2.5" fill="#fff" opacity="0.85"/>
        <ellipse cx="50" cy="88" rx="16" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // wo_gan (Wokan Mandarin) — smaller, deeper orange version of pa_pa_gan
    wo_gan(c) {
      return `
        <defs>
          <filter id="ds_wo_gan" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="body_wo_gan" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#ffb74d"/>
            <stop offset="55%" stop-color="#ef6c00"/>
            <stop offset="100%" stop-color="#8b3a00"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="20" ry="2.5" fill="#000" opacity="0.22"/>
        <g filter="url(#ds_wo_gan)">
          <circle cx="50" cy="60" r="24" fill="url(#body_wo_gan)" stroke="#6b2a00" stroke-width="0.8"/>
          <path d="M 50 36 L 50 28" stroke="#6d4528" stroke-width="2" stroke-linecap="round"/>
          <ellipse cx="44" cy="32" rx="5" ry="3" fill="#558b2f" stroke="#2e5613" stroke-width="0.5" transform="rotate(-30 44 32)"/>
          <ellipse cx="56" cy="32" rx="5" ry="3" fill="#558b2f" stroke="#2e5613" stroke-width="0.5" transform="rotate(30 56 32)"/>
        </g>
        <ellipse cx="42" cy="50" rx="6" ry="4" fill="#fff" opacity="0.55"/>
        <ellipse cx="41" cy="46" rx="2.5" ry="2" fill="#fff" opacity="0.85"/>
        <ellipse cx="50" cy="88" rx="13" ry="1.3" fill="#000" opacity="0.22"/>
      `;
    },

    // sha_tang_ju (Sugar Mandarin) — small mandarins stacked in pyramid
    sha_tang_ju(c) {
      return `
        <defs>
          <filter id="ds_sha_tang_ju" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="body_sha_tang_ju" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#ffd180"/>
            <stop offset="55%" stop-color="#ff9800"/>
            <stop offset="100%" stop-color="#a04500"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="24" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_sha_tang_ju)">
          <!-- back-left mandarin -->
          <circle cx="34" cy="70" r="15" fill="url(#body_sha_tang_ju)" stroke="#8b3a00" stroke-width="0.7"/>
          <path d="M 34 56 L 34 50" stroke="#6d4528" stroke-width="1.4" stroke-linecap="round"/>
          <ellipse cx="31" cy="52" rx="3" ry="1.8" fill="#558b2f" transform="rotate(-30 31 52)"/>
          <!-- back-right mandarin -->
          <circle cx="66" cy="68" r="14" fill="url(#body_sha_tang_ju)" stroke="#8b3a00" stroke-width="0.7"/>
          <path d="M 66 55 L 66 50" stroke="#6d4528" stroke-width="1.4" stroke-linecap="round"/>
          <ellipse cx="69" cy="52" rx="3" ry="1.8" fill="#558b2f" transform="rotate(30 69 52)"/>
          <!-- front mandarin (largest, on top) -->
          <circle cx="50" cy="50" r="17" fill="url(#body_sha_tang_ju)" stroke="#8b3a00" stroke-width="0.7"/>
          <path d="M 50 34 L 50 26" stroke="#6d4528" stroke-width="1.6" stroke-linecap="round"/>
          <ellipse cx="44" cy="30" rx="4" ry="2.5" fill="#558b2f" stroke="#2e5613" stroke-width="0.4" transform="rotate(-30 44 30)"/>
          <ellipse cx="56" cy="30" rx="4" ry="2.5" fill="#558b2f" stroke="#2e5613" stroke-width="0.4" transform="rotate(30 56 30)"/>
        </g>
        <!-- highlights on each -->
        <ellipse cx="28" cy="64" rx="3" ry="2" fill="#fff" opacity="0.55"/>
        <ellipse cx="60" cy="62" rx="3" ry="2" fill="#fff" opacity="0.55"/>
        <ellipse cx="42" cy="42" rx="4" ry="3" fill="#fff" opacity="0.65"/>
        <ellipse cx="40" cy="38" rx="2" ry="1.6" fill="#fff" opacity="0.85"/>
        <ellipse cx="50" cy="88" rx="18" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // tw_cauliflower (Taiwan cauliflower) — emoji-style. White/cream
    // dome of loosely-packed florets (LOOSER than tight broccoli) with
    // green leaves wrapping the base.
    tw_cauliflower(c) {
      return `
        <defs>
          <filter id="ds_tw_cauliflower" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="floretA_tw_cauli" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#fffefa"/>
            <stop offset="55%" stop-color="#f0eed8"/>
            <stop offset="100%" stop-color="#c9c39c"/>
          </radialGradient>
          <radialGradient id="floretB_tw_cauli" cx="60%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#fffefa"/>
            <stop offset="60%" stop-color="#f5f3df"/>
            <stop offset="100%" stop-color="#beba98"/>
          </radialGradient>
          <radialGradient id="leaf_tw_cauli" cx="40%" cy="70%" r="80%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_tw_cauliflower)">
          <!-- Wrapping leaves at the base -->
          <path d="M 22 70 Q 18 50 26 42 Q 36 44 34 62 Q 32 74 22 70 Z"
                fill="url(#leaf_tw_cauli)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 78 70 Q 82 50 74 42 Q 64 44 66 62 Q 68 74 78 70 Z"
                fill="url(#leaf_tw_cauli)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 28 86 Q 24 80 28 70 Q 38 70 36 80 Q 34 88 28 86 Z"
                fill="url(#leaf_tw_cauli)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 72 86 Q 76 80 72 70 Q 62 70 64 80 Q 66 88 72 86 Z"
                fill="url(#leaf_tw_cauli)" stroke="#2e5613" stroke-width="0.5"/>

          <!-- Big dome of loose cauliflower florets -->
          <path d="M 28 56 Q 24 30 50 22 Q 76 30 72 56 Q 60 70 50 70 Q 40 70 28 56 Z"
                fill="url(#floretA_tw_cauli)" stroke="#a8a37c" stroke-width="0.6"/>

          <!-- Looser, bigger florets on top -->
          <circle cx="34" cy="48" r="8" fill="url(#floretA_tw_cauli)" stroke="#a8a37c" stroke-width="0.5"/>
          <circle cx="44" cy="36" r="9" fill="url(#floretB_tw_cauli)" stroke="#a8a37c" stroke-width="0.5"/>
          <circle cx="56" cy="34" r="9" fill="url(#floretA_tw_cauli)" stroke="#a8a37c" stroke-width="0.5"/>
          <circle cx="66" cy="48" r="8" fill="url(#floretB_tw_cauli)" stroke="#a8a37c" stroke-width="0.5"/>
          <circle cx="40" cy="58" r="7" fill="url(#floretB_tw_cauli)" stroke="#a8a37c" stroke-width="0.5"/>
          <circle cx="50" cy="52" r="8" fill="url(#floretA_tw_cauli)" stroke="#a8a37c" stroke-width="0.5"/>
          <circle cx="60" cy="58" r="7" fill="url(#floretB_tw_cauli)" stroke="#a8a37c" stroke-width="0.5"/>
        </g>

        <!-- Glossy highlights on top of florets -->
        <ellipse cx="40" cy="32" rx="2.5" ry="3.5" fill="#fff" opacity="0.7"/>
        <ellipse cx="48" cy="26" rx="2" ry="2.5" fill="#fff" opacity="0.7"/>
        <ellipse cx="32" cy="44" rx="2" ry="2.8" fill="#fff" opacity="0.6"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="88" rx="13" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // dong_gua (winter melon) — emoji-style. Big OVAL/OBLONG body
    // (wider than tall), pale green with characteristic WHITE WAX dust
    // spots, dark green stem nub on top.
    dong_gua(c) {
      return `
        <defs>
          <filter id="ds_dong_gua" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/>
            <feOffset dy="2" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="body_dong_gua" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stop-color="#dcedc8"/>
            <stop offset="50%" stop-color="#a5d6a7"/>
            <stop offset="100%" stop-color="#4a8a4f"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="94" rx="30" ry="3" fill="#000" opacity="0.25"/>

        <g filter="url(#ds_dong_gua)">
          <!-- Big oval winter melon body -->
          <ellipse cx="50" cy="60" rx="34" ry="28" fill="url(#body_dong_gua)" stroke="#2e5613" stroke-width="0.8"/>

          <!-- Longitudinal stripe shading (subtle) -->
          <path d="M 30 36 Q 30 60 36 84" stroke="#4a8a4f" stroke-width="0.6" fill="none" opacity="0.5"/>
          <path d="M 50 32 L 50 88" stroke="#4a8a4f" stroke-width="0.6" fill="none" opacity="0.5"/>
          <path d="M 70 36 Q 70 60 64 84" stroke="#4a8a4f" stroke-width="0.6" fill="none" opacity="0.5"/>

          <!-- WHITE WAX DUST spots (the winter-melon signature) -->
          <g fill="#fff" opacity="0.7">
            <ellipse cx="30" cy="52" rx="1.2" ry="0.8"/>
            <ellipse cx="38" cy="48" rx="1.5" ry="1"/>
            <ellipse cx="46" cy="46" rx="1" ry="0.7"/>
            <ellipse cx="58" cy="52" rx="1.3" ry="0.9"/>
            <ellipse cx="66" cy="48" rx="1.2" ry="0.8"/>
            <ellipse cx="34" cy="66" rx="1" ry="0.7"/>
            <ellipse cx="42" cy="72" rx="1.2" ry="0.8"/>
            <ellipse cx="54" cy="76" rx="1.4" ry="0.9"/>
            <ellipse cx="62" cy="70" rx="1.1" ry="0.7"/>
            <ellipse cx="72" cy="60" rx="1.2" ry="0.8"/>
          </g>

          <!-- Small dark green stem nub on top -->
          <path d="M 50 34 L 50 22" stroke="#3a6e1a" stroke-width="2.3" stroke-linecap="round"/>
          <ellipse cx="48" cy="24" rx="6" ry="3" fill="#7cb342" stroke="#3a6e1a" stroke-width="0.5" transform="rotate(-30 48 24)"/>
          <ellipse cx="52" cy="24" rx="6" ry="3" fill="#7cb342" stroke="#3a6e1a" stroke-width="0.5" transform="rotate(30 52 24)"/>
        </g>

        <!-- BIG glossy highlight (top-left blob) — this is what makes it look fresh/dewy -->
        <ellipse cx="34" cy="44" rx="10" ry="8" fill="#fff" opacity="0.45"/>
        <ellipse cx="32" cy="40" rx="5" ry="3" fill="#fff" opacity="0.75"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="90" rx="22" ry="1.5" fill="#000" opacity="0.3"/>
      `;
    },

    // jing_cong (Peking Leek) — emoji-style. Much THICKER and TALLER than
    // xiao_cong. Big white cylindrical bulb base + 3 fan-spread green
    // leaves at top.
    jing_cong(c) {
      return `
        <defs>
          <filter id="ds_jing_cong" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="bulb_jing_cong" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#c9b890"/>
            <stop offset="35%" stop-color="#fff8e1"/>
            <stop offset="65%" stop-color="#fff8e1"/>
            <stop offset="100%" stop-color="#b9a570"/>
          </linearGradient>
          <linearGradient id="leaf_jing_cong" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#2e6b1d"/>
            <stop offset="50%" stop-color="#7cb342"/>
            <stop offset="100%" stop-color="#c5e1a5"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="14" ry="2.5" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_jing_cong)">
          <!-- Thick white-cream bulb base (much larger than xiao_cong's stems) -->
          <path d="M 38 88
                   Q 35 70 36 50
                   Q 40 44 50 44
                   Q 60 44 64 50
                   Q 65 70 62 88
                   Z"
                fill="url(#bulb_jing_cong)" stroke="#a89466" stroke-width="0.8"/>

          <!-- Vertical fiber lines on bulb -->
          <path d="M 41 86 Q 40 70 42 50" stroke="#a89466" stroke-width="0.5" fill="none" opacity="0.7"/>
          <path d="M 47 87 Q 46 70 47 48" stroke="#a89466" stroke-width="0.6" fill="none" opacity="0.7"/>
          <path d="M 53 87 Q 54 70 53 48" stroke="#a89466" stroke-width="0.6" fill="none" opacity="0.7"/>
          <path d="M 59 86 Q 60 70 58 50" stroke="#a89466" stroke-width="0.5" fill="none" opacity="0.7"/>

          <!-- 3 thick green leaves spreading from top of bulb -->
          <path d="M 36 50 Q 28 36 22 14
                   Q 26 12 30 16
                   Q 32 30 40 48 Z"
                fill="url(#leaf_jing_cong)" stroke="#1a3b0c" stroke-width="0.5"/>
          <path d="M 50 44 Q 48 28 48 6
                   Q 52 6 52 8
                   Q 52 28 50 44 Z"
                fill="url(#leaf_jing_cong)" stroke="#1a3b0c" stroke-width="0.5"/>
          <path d="M 64 50 Q 72 36 78 14
                   Q 74 12 70 16
                   Q 68 30 60 48 Z"
                fill="url(#leaf_jing_cong)" stroke="#1a3b0c" stroke-width="0.5"/>
        </g>

        <!-- Glossy highlight on bulb left side -->
        <ellipse cx="42" cy="64" rx="2.5" ry="14" fill="#fff" opacity="0.45" transform="rotate(-3 42 64)"/>
        <ellipse cx="44" cy="50" rx="2" ry="3" fill="#fff" opacity="0.65"/>
        <!-- Leaf hot spots -->
        <ellipse cx="48" cy="14" rx="1.2" ry="2" fill="#fff" opacity="0.55"/>
        <ellipse cx="26" cy="22" rx="1.2" ry="2" fill="#fff" opacity="0.45"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="88" rx="11" ry="1.4" fill="#000" opacity="0.28"/>
      `;
    },

    // lian_ou (lotus root) — emoji-style. 3 chained tubular segments lying
    // horizontally. RIGHT END is sliced open showing the iconic 9-hole
    // cross-section pattern (the "snowflake lace"). Cream colored body.
    lian_ou(c) {
      return `
        <defs>
          <filter id="ds_lian_ou" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="body_lian_ou" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#c5b18a"/>
            <stop offset="30%" stop-color="#fff8e1"/>
            <stop offset="65%" stop-color="#fff8e1"/>
            <stop offset="100%" stop-color="#b8a374"/>
          </linearGradient>
          <radialGradient id="crosssect_lian_ou" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#fffceb"/>
            <stop offset="100%" stop-color="#d8c597"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="90" rx="32" ry="3" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_lian_ou)" transform="rotate(-6 50 60)">
          <!-- Three connected tubular segments (horizontal lying) -->
          <path d="M 14 60
                   Q 12 48 18 44
                   Q 28 42 32 46
                   Q 34 50 38 46
                   Q 48 42 52 46
                   Q 54 50 58 46
                   Q 68 42 72 46
                   Q 74 50 78 50
                   Q 86 54 84 64
                   Q 84 74 76 76
                   Q 70 78 62 74
                   Q 56 70 50 74
                   Q 44 78 38 74
                   Q 32 70 26 74
                   Q 18 78 14 70
                   Z"
                fill="url(#body_lian_ou)" stroke="#8a7553" stroke-width="0.7"/>

          <!-- Indentation lines between segments -->
          <path d="M 34 48 Q 36 60 32 72" stroke="#8a7553" stroke-width="0.5" fill="none" opacity="0.65"/>
          <path d="M 54 48 Q 56 60 52 72" stroke="#8a7553" stroke-width="0.5" fill="none" opacity="0.65"/>

          <!-- Cross-section "snowflake" hole pattern on RIGHT END -->
          <ellipse cx="80" cy="60" rx="6" ry="10" fill="url(#crosssect_lian_ou)" stroke="#8a7553" stroke-width="0.6"/>
          <g fill="#7a6649">
            <!-- Center large hole -->
            <ellipse cx="80" cy="60" rx="1.6" ry="2" opacity="0.9"/>
            <!-- 8 surrounding holes -->
            <ellipse cx="80" cy="55" rx="1.1" ry="1.5" opacity="0.85"/>
            <ellipse cx="80" cy="65" rx="1.1" ry="1.5" opacity="0.85"/>
            <ellipse cx="76" cy="57" rx="1" ry="1.3" opacity="0.85"/>
            <ellipse cx="76" cy="63" rx="1" ry="1.3" opacity="0.85"/>
            <ellipse cx="83" cy="56" rx="1" ry="1.3" opacity="0.85"/>
            <ellipse cx="83" cy="64" rx="1" ry="1.3" opacity="0.85"/>
            <ellipse cx="77" cy="60" rx="1" ry="1.3" opacity="0.85"/>
            <ellipse cx="83" cy="60" rx="1" ry="1.3" opacity="0.85"/>
          </g>
        </g>

        <!-- Glossy top highlight along the length -->
        <path d="M 18 52 Q 50 50 76 52" stroke="#fff" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"/>
        <ellipse cx="40" cy="52" rx="3" ry="1.5" fill="#fff" opacity="0.65"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="86" rx="24" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // ye_zi (Young Coconut) — emoji-style. Green outer husk (not the brown
    // mature variant) with WHITE-FLAT-CIRCLE on top (the drinking hole cut)
    // and the iconic 3-eye "face" on the front.
    ye_zi(c) {
      return `
        <defs>
          <filter id="ds_ye_zi" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="body_ye_zi" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#c5e1a5"/>
            <stop offset="50%" stop-color="#7cb342"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
          <radialGradient id="top_ye_zi" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="80%" stop-color="#f5f0d8"/>
            <stop offset="100%" stop-color="#c9b890"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="24" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_ye_zi)">
          <!-- Main green coconut body -->
          <circle cx="50" cy="62" r="28" fill="url(#body_ye_zi)" stroke="#1f4d10" stroke-width="0.8"/>

          <!-- 3-eye coconut "face" (front side dark holes) -->
          <g fill="#1f4d10" opacity="0.8">
            <circle cx="42" cy="56" r="2.2"/>
            <circle cx="56" cy="54" r="2.2"/>
            <circle cx="48" cy="68" r="2.2"/>
          </g>
          <g fill="#fff" opacity="0.6">
            <circle cx="41.5" cy="55.5" r="0.7"/>
            <circle cx="55.5" cy="53.5" r="0.7"/>
            <circle cx="47.5" cy="67.5" r="0.7"/>
          </g>

          <!-- White drinking-hole cut on TOP -->
          <ellipse cx="50" cy="36" rx="13" ry="4" fill="url(#top_ye_zi)" stroke="#7a6649" stroke-width="0.6"/>
          <ellipse cx="50" cy="35" rx="6" ry="1.6" fill="#5a4a26"/>
          <ellipse cx="50" cy="34" rx="3" ry="0.8" fill="#3a2810"/>
        </g>
        <!-- Big shiny highlight on coconut left -->
        <ellipse cx="38" cy="50" rx="6" ry="10" fill="#fff" opacity="0.4"/>
        <ellipse cx="36" cy="44" rx="2.5" ry="3" fill="#fff" opacity="0.75"/>
        <ellipse cx="50" cy="88" rx="20" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // xiang_yin_putao (Shine Muscat Grape) — emoji-style. Cluster of
    // round PALE GREEN grapes (Shine Muscat is the green variety) tightly
    // packed in classic triangular bunch shape, each with own highlight.
    xiang_yin_putao(c) {
      return `
        <defs>
          <filter id="ds_xiang_yin_putao" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="grape_xiang_yin_putao" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#dce88f"/>
            <stop offset="55%" stop-color="#9ccc65"/>
            <stop offset="100%" stop-color="#4a7d1e"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_xiang_yin_putao)">
          <!-- Stem + leaves -->
          <path d="M 50 18 L 50 30" stroke="#6d4528" stroke-width="2" stroke-linecap="round"/>
          <ellipse cx="42" cy="20" rx="7" ry="3.5" fill="#558b2f" stroke="#2e5613" stroke-width="0.5" transform="rotate(-30 42 20)"/>
          <ellipse cx="58" cy="20" rx="7" ry="3.5" fill="#558b2f" stroke="#2e5613" stroke-width="0.5" transform="rotate(30 58 20)"/>
          <!-- Grape cluster, triangular arrangement -->
          <g stroke="#2e5613" stroke-width="0.5">
            <circle cx="42" cy="36" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="50" cy="34" r="7.5" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="58" cy="36" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="38" cy="48" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="46" cy="48" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="54" cy="48" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="62" cy="48" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="42" cy="60" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="50" cy="60" r="7.5" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="58" cy="60" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="46" cy="72" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="54" cy="72" r="7" fill="url(#grape_xiang_yin_putao)"/>
            <circle cx="50" cy="84" r="6.5" fill="url(#grape_xiang_yin_putao)"/>
          </g>
        </g>
        <!-- Individual grape highlights -->
        <g fill="#fff" opacity="0.7">
          <circle cx="40" cy="33" r="1.5"/><circle cx="48" cy="31" r="1.6"/><circle cx="56" cy="33" r="1.5"/>
          <circle cx="36" cy="45" r="1.5"/><circle cx="44" cy="45" r="1.5"/><circle cx="52" cy="45" r="1.5"/><circle cx="60" cy="45" r="1.5"/>
          <circle cx="40" cy="57" r="1.5"/><circle cx="48" cy="57" r="1.6"/><circle cx="56" cy="57" r="1.5"/>
          <circle cx="44" cy="69" r="1.4"/><circle cx="52" cy="69" r="1.4"/>
          <circle cx="48" cy="81" r="1.3"/>
        </g>
      `;
    },

    // mang_guo (Mango) — emoji-style. Oval/kidney-bean shape with
    // signature YELLOW→ORANGE→RED gradient (riper toward one end).
    mang_guo(c) {
      return `
        <defs>
          <filter id="ds_mang_guo" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="body_mang_guo" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fff176"/>
            <stop offset="30%" stop-color="#ffca28"/>
            <stop offset="65%" stop-color="#ff9800"/>
            <stop offset="100%" stop-color="#ff5722"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_mang_guo)" transform="rotate(-15 50 58)">
          <!-- Mango body, asymmetric oval -->
          <path d="M 50 28
                   Q 28 32 24 56
                   Q 26 80 44 86
                   Q 62 88 74 76
                   Q 80 56 76 40
                   Q 68 30 50 28 Z"
                fill="url(#body_mang_guo)" stroke="#b34d00" stroke-width="0.8"/>
          <!-- Stem nub at top-left -->
          <path d="M 50 28 L 47 18" stroke="#6d4528" stroke-width="1.6" stroke-linecap="round"/>
          <ellipse cx="46" cy="20" rx="4" ry="2" fill="#558b2f" stroke="#2e5613" stroke-width="0.4" transform="rotate(-20 46 20)"/>
        </g>
        <!-- Big glossy highlight (mango's iconic shine) -->
        <ellipse cx="38" cy="46" rx="9" ry="6" fill="#fff" opacity="0.5" transform="rotate(-20 38 46)"/>
        <ellipse cx="34" cy="42" rx="3.5" ry="2.5" fill="#fff" opacity="0.85"/>
        <ellipse cx="50" cy="88" rx="16" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // huo_long_guo (Dragon Fruit) — emoji-style. Magenta-pink oval body
    // with iconic GREEN-TIPPED PINK SCALES (leaf-like protrusions) curving
    // outward from the body — these scales are THE defining feature.
    huo_long_guo(c) {
      return `
        <defs>
          <filter id="ds_huo_long_guo" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="body_huo_long_guo" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#f8bbd0"/>
            <stop offset="50%" stop-color="#e91e63"/>
            <stop offset="100%" stop-color="#8a0a3c"/>
          </radialGradient>
          <linearGradient id="scale_huo_long_guo" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#e91e63"/>
            <stop offset="45%" stop-color="#f06292"/>
            <stop offset="75%" stop-color="#aed581"/>
            <stop offset="100%" stop-color="#558b2f"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_huo_long_guo)">
          <!-- Main oval body -->
          <ellipse cx="50" cy="60" rx="22" ry="28" fill="url(#body_huo_long_guo)" stroke="#5a0826" stroke-width="0.8"/>

          <!-- SCALES (the iconic dragon-fruit feature: green-tipped pink protrusions) -->
          <!-- Top scales -->
          <path d="M 42 36 Q 38 28 36 18 Q 44 22 46 34 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>
          <path d="M 50 32 Q 48 22 50 12 Q 52 22 50 32 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>
          <path d="M 58 36 Q 62 28 64 18 Q 56 22 54 34 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>

          <!-- Left side scales -->
          <path d="M 30 50 Q 22 48 14 50 Q 22 54 32 54 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>
          <path d="M 28 64 Q 18 64 12 68 Q 20 72 30 68 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>

          <!-- Right side scales -->
          <path d="M 70 50 Q 78 48 86 50 Q 78 54 68 54 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>
          <path d="M 72 64 Q 82 64 88 68 Q 80 72 70 68 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>

          <!-- Bottom scales -->
          <path d="M 40 80 Q 36 86 32 90 Q 42 88 44 82 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>
          <path d="M 60 80 Q 64 86 68 90 Q 58 88 56 82 Z" fill="url(#scale_huo_long_guo)" stroke="#5a0826" stroke-width="0.5"/>
        </g>
        <!-- Body highlight -->
        <ellipse cx="40" cy="48" rx="6" ry="12" fill="#fff" opacity="0.4"/>
        <ellipse cx="38" cy="44" rx="2.5" ry="4" fill="#fff" opacity="0.75"/>
        <ellipse cx="50" cy="88" rx="16" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // pi_pa (Loquat) — emoji-style. Cluster of 5 small golden-yellow round
    // fruits on a stem, with green oval leaves at the top.
    pi_pa(c) {
      return `
        <defs>
          <filter id="ds_pi_pa" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="fruit_pi_pa" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#fff9c4"/>
            <stop offset="55%" stop-color="#ffd54f"/>
            <stop offset="100%" stop-color="#bf8700"/>
          </radialGradient>
          <radialGradient id="leaf_pi_pa" cx="40%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_pi_pa)">
          <!-- Twig connecting all fruits -->
          <path d="M 50 26 Q 50 50 50 78" stroke="#6d4528" stroke-width="1.6" fill="none" stroke-linecap="round"/>
          <path d="M 50 56 Q 38 48 32 46" stroke="#6d4528" stroke-width="1.2" fill="none" stroke-linecap="round"/>
          <path d="M 50 56 Q 62 48 68 46" stroke="#6d4528" stroke-width="1.2" fill="none" stroke-linecap="round"/>

          <!-- Two big oval leaves on top -->
          <path d="M 50 24 Q 36 18 30 12 L 34 8 Q 42 14 48 24 Z" fill="url(#leaf_pi_pa)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 50 24 Q 64 18 70 12 L 66 8 Q 58 14 52 24 Z" fill="url(#leaf_pi_pa)" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 50 26 L 50 14" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>

          <!-- 5 loquat fruits cluster (golden) -->
          <circle cx="32" cy="48" r="7" fill="url(#fruit_pi_pa)" stroke="#8b6500" stroke-width="0.6"/>
          <circle cx="68" cy="48" r="7" fill="url(#fruit_pi_pa)" stroke="#8b6500" stroke-width="0.6"/>
          <circle cx="40" cy="64" r="7" fill="url(#fruit_pi_pa)" stroke="#8b6500" stroke-width="0.6"/>
          <circle cx="60" cy="64" r="7" fill="url(#fruit_pi_pa)" stroke="#8b6500" stroke-width="0.6"/>
          <circle cx="50" cy="78" r="7.5" fill="url(#fruit_pi_pa)" stroke="#8b6500" stroke-width="0.6"/>

          <!-- Tiny "navel" mark at bottom of each fruit -->
          <g fill="#6b5000" opacity="0.55">
            <circle cx="32" cy="53" r="0.6"/><circle cx="68" cy="53" r="0.6"/>
            <circle cx="40" cy="69" r="0.6"/><circle cx="60" cy="69" r="0.6"/>
            <circle cx="50" cy="84" r="0.6"/>
          </g>
        </g>
        <!-- Highlights -->
        <g fill="#fff" opacity="0.65">
          <ellipse cx="30" cy="45" r="1.5"/><ellipse cx="66" cy="45" r="1.5"/>
          <ellipse cx="38" cy="61" r="1.5"/><ellipse cx="58" cy="61" r="1.5"/>
          <ellipse cx="47" cy="74" r="1.8"/>
        </g>
        <ellipse cx="50" cy="88" rx="16" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // sheng_jiang (ginger) — emoji-style. Knobby root with 4 finger-like
    // lobes. Tan/light brown skin with darker ridges.
    sheng_jiang(c) {
      return `
        <defs>
          <filter id="ds_sheng_jiang" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="body_sheng_jiang" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#f2d9b4"/>
            <stop offset="50%" stop-color="#d4a574"/>
            <stop offset="100%" stop-color="#8b6543"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="90" rx="28" ry="3" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_sheng_jiang)">
          <!-- Knobby ginger body with finger-like protrusions -->
          <path d="M 18 64
                   Q 14 50 22 44
                   Q 30 42 32 50
                   Q 36 44 42 46
                   Q 46 50 48 56
                   Q 52 46 60 44
                   Q 68 46 66 56
                   Q 74 50 82 56
                   Q 86 66 78 72
                   Q 70 76 64 70
                   Q 60 78 52 76
                   Q 46 72 44 64
                   Q 38 76 30 74
                   Q 22 72 20 68
                   Z"
                fill="url(#body_sheng_jiang)" stroke="#5c4226" stroke-width="0.7"/>

          <!-- Knobby ridge details -->
          <path d="M 26 58 Q 32 56 34 60" stroke="#8b6543" stroke-width="0.5" fill="none" opacity="0.7"/>
          <path d="M 44 58 Q 50 56 52 62" stroke="#8b6543" stroke-width="0.5" fill="none" opacity="0.7"/>
          <path d="M 62 58 Q 70 56 72 60" stroke="#8b6543" stroke-width="0.5" fill="none" opacity="0.7"/>

          <!-- Vertical fiber lines -->
          <path d="M 28 50 Q 30 60 28 70" stroke="#8b6543" stroke-width="0.4" fill="none" opacity="0.55"/>
          <path d="M 50 48 Q 52 60 50 72" stroke="#8b6543" stroke-width="0.4" fill="none" opacity="0.55"/>
          <path d="M 72 50 Q 74 60 72 70" stroke="#8b6543" stroke-width="0.4" fill="none" opacity="0.55"/>
        </g>

        <!-- Highlights on tops of fingers -->
        <ellipse cx="26" cy="50" rx="3" ry="1.8" fill="#fff" opacity="0.5"/>
        <ellipse cx="44" cy="52" rx="3" ry="1.8" fill="#fff" opacity="0.5"/>
        <ellipse cx="62" cy="50" rx="3" ry="1.8" fill="#fff" opacity="0.5"/>
        <ellipse cx="78" cy="58" rx="3" ry="1.8" fill="#fff" opacity="0.5"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="86" rx="22" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },

    // shan_yao (Chinese Yam) — emoji-style. Long brown cylindrical stick
    // root, slight knobby texture, slight bend, fibrous roots at bottom.
    shan_yao(c) {
      return `
        <defs>
          <filter id="ds_shan_yao" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="body_shan_yao" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#6d4d28"/>
            <stop offset="35%" stop-color="#a67c4b"/>
            <stop offset="65%" stop-color="#d2a877"/>
            <stop offset="100%" stop-color="#7d5a30"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="94" rx="13" ry="2" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_shan_yao)" transform="rotate(6 50 50)">
          <!-- Long cylindrical yam root, gently curved -->
          <path d="M 42 8
                   Q 40 30 41 50
                   Q 42 70 44 88
                   Q 50 92 56 88
                   Q 58 70 59 50
                   Q 60 30 58 8
                   Q 50 4 42 8
                   Z"
                fill="url(#body_shan_yao)" stroke="#3d2614" stroke-width="0.7"/>

          <!-- Horizontal texture lines (skin marks) -->
          <path d="M 42 22 Q 50 24 58 22" stroke="#3d2614" stroke-width="0.4" fill="none" opacity="0.5"/>
          <path d="M 42 38 Q 50 40 58 38" stroke="#3d2614" stroke-width="0.4" fill="none" opacity="0.45"/>
          <path d="M 42 54 Q 50 56 58 54" stroke="#3d2614" stroke-width="0.4" fill="none" opacity="0.45"/>
          <path d="M 42 70 Q 50 72 58 70" stroke="#3d2614" stroke-width="0.4" fill="none" opacity="0.45"/>
          <path d="M 43 82 Q 50 84 57 82" stroke="#3d2614" stroke-width="0.4" fill="none" opacity="0.4"/>

          <!-- Tiny root hairs at bottom -->
          <path d="M 46 90 L 44 96 M 50 90 L 50 96 M 54 90 L 56 96" stroke="#3d2614" stroke-width="0.6" stroke-linecap="round" opacity="0.7"/>

          <!-- Knobby spots (dark patches indicating skin texture) -->
          <g fill="#3d2614" opacity="0.55">
            <circle cx="44" cy="30" r="0.9"/>
            <circle cx="52" cy="48" r="1"/>
            <circle cx="46" cy="62" r="0.9"/>
            <circle cx="54" cy="78" r="0.9"/>
            <circle cx="48" cy="20" r="0.7"/>
          </g>
        </g>

        <!-- Glossy highlight stripe on left -->
        <ellipse cx="45" cy="50" rx="2" ry="32" fill="#fff" opacity="0.35" transform="rotate(4 45 50)"/>
        <ellipse cx="46" cy="32" rx="1.5" ry="3" fill="#fff" opacity="0.55"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="92" rx="8" ry="1.3" fill="#000" opacity="0.25"/>
      `;
    },

    // chun_sun (spring bamboo shoot) — emoji-style. Triangular cone shape,
    // BROAD base tapering to POINTED top, multiple horizontal husk-layer
    // rings (tan/brown gradient). Tiny leaf sprouting from very top.
    chun_sun(c) {
      return `
        <defs>
          <filter id="ds_chun_sun" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="husk_chun_sun" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#8b7a3f"/>
            <stop offset="35%" stop-color="#d8c473"/>
            <stop offset="65%" stop-color="#f0e2a8"/>
            <stop offset="100%" stop-color="#a89455"/>
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="18" ry="2.5" fill="#000" opacity="0.22"/>

        <g filter="url(#ds_chun_sun)">
          <!-- Big triangular cone, broad base + pointed top -->
          <path d="M 30 88
                   Q 28 70 34 48
                   Q 40 26 50 12
                   Q 60 26 66 48
                   Q 72 70 70 88
                   Z"
                fill="url(#husk_chun_sun)" stroke="#5d4f24" stroke-width="0.8"/>

          <!-- Horizontal husk-layer rings (the iconic bamboo-shoot texture) -->
          <path d="M 32 78 Q 50 80 68 78" stroke="#5d4f24" stroke-width="0.9" fill="none" opacity="0.75"/>
          <path d="M 34 66 Q 50 68 66 66" stroke="#5d4f24" stroke-width="0.8" fill="none" opacity="0.75"/>
          <path d="M 36 54 Q 50 56 64 54" stroke="#5d4f24" stroke-width="0.7" fill="none" opacity="0.7"/>
          <path d="M 39 42 Q 50 44 61 42" stroke="#5d4f24" stroke-width="0.7" fill="none" opacity="0.7"/>
          <path d="M 42 30 Q 50 32 58 30" stroke="#5d4f24" stroke-width="0.6" fill="none" opacity="0.65"/>
          <path d="M 46 20 Q 50 22 54 20" stroke="#5d4f24" stroke-width="0.5" fill="none" opacity="0.6"/>

          <!-- Small green leaf sprouting at the very tip -->
          <path d="M 50 14 Q 46 6 42 4 Q 48 8 50 12 Z" fill="#7cb342" stroke="#3a6e1a" stroke-width="0.5"/>
          <path d="M 50 14 Q 54 6 58 4 Q 52 8 50 12 Z" fill="#7cb342" stroke="#3a6e1a" stroke-width="0.5"/>
        </g>

        <!-- Glossy highlight stripe on left side -->
        <path d="M 38 80 Q 38 50 46 22" stroke="#fff" stroke-width="2" fill="none" opacity="0.4" stroke-linecap="round"/>
        <ellipse cx="40" cy="48" rx="2" ry="3" fill="#fff" opacity="0.6"/>

        <!-- Base shadow -->
        <ellipse cx="50" cy="88" rx="13" ry="1.4" fill="#000" opacity="0.28"/>
      `;
    },
    // narcissus — emoji-style. 3 white 6-petal flowers with bright yellow
    // trumpet centers, rising from green leaf bunch.
    narcissus(c) {
      return `
        <defs>
          <filter id="ds_narcissus" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="trumpet_narcissus" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#fffde7"/>
            <stop offset="55%" stop-color="#ffd54f"/>
            <stop offset="100%" stop-color="#bf8700"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_narcissus)">
          <!-- 3 green leaves rising up -->
          <path d="M 38 88 Q 32 60 28 28 L 32 26 Q 36 56 42 86 Z" fill="#558b2f" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 50 88 Q 50 56 50 18 L 53 18 Q 53 56 52 86 Z" fill="#7cb342" stroke="#2e5613" stroke-width="0.5"/>
          <path d="M 62 88 Q 68 60 72 28 L 68 26 Q 64 56 58 86 Z" fill="#558b2f" stroke="#2e5613" stroke-width="0.5"/>

          <!-- 3 flowers with 6 petals each -->
          <!-- Left flower -->
          <g transform="translate(32 36)">
            <g fill="#ffffff" stroke="#cfb992" stroke-width="0.6">
              <ellipse cx="0" cy="-7" rx="3" ry="5"/>
              <ellipse cx="6" cy="-3" rx="3" ry="5" transform="rotate(60)"/>
              <ellipse cx="6" cy="3" rx="3" ry="5" transform="rotate(120)"/>
              <ellipse cx="0" cy="7" rx="3" ry="5"/>
              <ellipse cx="-6" cy="3" rx="3" ry="5" transform="rotate(60)"/>
              <ellipse cx="-6" cy="-3" rx="3" ry="5" transform="rotate(120)"/>
            </g>
            <circle r="3" fill="url(#trumpet_narcissus)" stroke="#e6b800" stroke-width="0.5"/>
            <circle r="1.2" fill="#bf8700"/>
          </g>
          <!-- Center flower (largest) -->
          <g transform="translate(50 22)">
            <g fill="#ffffff" stroke="#cfb992" stroke-width="0.6">
              <ellipse cx="0" cy="-8" rx="3.5" ry="6"/>
              <ellipse cx="7" cy="-4" rx="3.5" ry="6" transform="rotate(60)"/>
              <ellipse cx="7" cy="4" rx="3.5" ry="6" transform="rotate(120)"/>
              <ellipse cx="0" cy="8" rx="3.5" ry="6"/>
              <ellipse cx="-7" cy="4" rx="3.5" ry="6" transform="rotate(60)"/>
              <ellipse cx="-7" cy="-4" rx="3.5" ry="6" transform="rotate(120)"/>
            </g>
            <circle r="3.8" fill="url(#trumpet_narcissus)" stroke="#e6b800" stroke-width="0.5"/>
            <circle r="1.5" fill="#bf8700"/>
          </g>
          <!-- Right flower -->
          <g transform="translate(68 36)">
            <g fill="#ffffff" stroke="#cfb992" stroke-width="0.6">
              <ellipse cx="0" cy="-7" rx="3" ry="5"/>
              <ellipse cx="6" cy="-3" rx="3" ry="5" transform="rotate(60)"/>
              <ellipse cx="6" cy="3" rx="3" ry="5" transform="rotate(120)"/>
              <ellipse cx="0" cy="7" rx="3" ry="5"/>
              <ellipse cx="-6" cy="3" rx="3" ry="5" transform="rotate(60)"/>
              <ellipse cx="-6" cy="-3" rx="3" ry="5" transform="rotate(120)"/>
            </g>
            <circle r="3" fill="url(#trumpet_narcissus)" stroke="#e6b800" stroke-width="0.5"/>
            <circle r="1.2" fill="#bf8700"/>
          </g>
        </g>
        <!-- Trumpet hot spots -->
        <ellipse cx="49" cy="20" rx="1.2" ry="1.5" fill="#fff" opacity="0.8"/>
        <ellipse cx="31" cy="34" rx="0.8" ry="1" fill="#fff" opacity="0.7"/>
        <ellipse cx="67" cy="34" rx="0.8" ry="1" fill="#fff" opacity="0.7"/>
        <ellipse cx="50" cy="88" rx="14" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },
    // kumquat — emoji-style. Mini orange-tree shape: dome of green foliage
    // dotted with multiple small orange kumquats.
    kumquat(c) {
      return `
        <defs>
          <filter id="ds_kumquat" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="foliage_kumquat" cx="40%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
          <radialGradient id="fruit_kumquat" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#ffd180"/>
            <stop offset="55%" stop-color="#ff9800"/>
            <stop offset="100%" stop-color="#a04500"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="24" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_kumquat)">
          <!-- Brown pot -->
          <path d="M 32 86 L 36 76 L 64 76 L 68 86 Z" fill="#8b5a2b" stroke="#5d3a1a" stroke-width="0.7"/>
          <rect x="30" y="74" width="40" height="4" rx="2" fill="#a0673b" stroke="#5d3a1a" stroke-width="0.6"/>

          <!-- Brown trunk -->
          <path d="M 48 76 L 48 56 L 52 56 L 52 76 Z" fill="#6d4528" stroke="#3d2614" stroke-width="0.5"/>

          <!-- Green foliage dome -->
          <ellipse cx="50" cy="42" rx="28" ry="22" fill="url(#foliage_kumquat)" stroke="#1f4d10" stroke-width="0.7"/>
          <!-- foliage texture clusters -->
          <circle cx="32" cy="42" r="9" fill="#558b2f" opacity="0.7"/>
          <circle cx="50" cy="32" r="10" fill="#7cb342" opacity="0.65"/>
          <circle cx="68" cy="42" r="9" fill="#558b2f" opacity="0.7"/>
          <circle cx="42" cy="50" r="8" fill="#6ab041" opacity="0.6"/>
          <circle cx="58" cy="50" r="8" fill="#6ab041" opacity="0.6"/>

          <!-- 6 little kumquats dotted across foliage -->
          <circle cx="36" cy="36" r="3.5" fill="url(#fruit_kumquat)" stroke="#8b3a00" stroke-width="0.5"/>
          <circle cx="50" cy="28" r="4" fill="url(#fruit_kumquat)" stroke="#8b3a00" stroke-width="0.5"/>
          <circle cx="62" cy="36" r="3.5" fill="url(#fruit_kumquat)" stroke="#8b3a00" stroke-width="0.5"/>
          <circle cx="40" cy="50" r="3.5" fill="url(#fruit_kumquat)" stroke="#8b3a00" stroke-width="0.5"/>
          <circle cx="58" cy="50" r="3.5" fill="url(#fruit_kumquat)" stroke="#8b3a00" stroke-width="0.5"/>
          <circle cx="50" cy="48" r="3" fill="url(#fruit_kumquat)" stroke="#8b3a00" stroke-width="0.5"/>
        </g>
        <!-- kumquat highlights -->
        <g fill="#fff" opacity="0.7">
          <circle cx="35" cy="35" r="0.8"/><circle cx="49" cy="27" r="1"/><circle cx="61" cy="35" r="0.8"/>
          <circle cx="39" cy="49" r="0.8"/><circle cx="57" cy="49" r="0.8"/>
        </g>
        <ellipse cx="50" cy="86" rx="14" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },
    // taro — emoji-style. Purple-brown rounded oval root with horizontal
    // RING TEXTURE (the iconic taro skin pattern) and 3 heart-shaped leaves
    // sprouting from the top.
    taro(c) {
      return `
        <defs>
          <filter id="ds_taro" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="body_taro" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#d1c4e9"/>
            <stop offset="55%" stop-color="#8d6e8b"/>
            <stop offset="100%" stop-color="#4a2c4a"/>
          </radialGradient>
          <radialGradient id="leaf_taro" cx="40%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_taro)">
          <!-- Taro body, oval -->
          <ellipse cx="50" cy="64" rx="24" ry="22" fill="url(#body_taro)" stroke="#2a1530" stroke-width="0.8"/>

          <!-- Horizontal ring lines (iconic taro skin texture) -->
          <path d="M 28 56 Q 50 58 72 56" stroke="#2a1530" stroke-width="0.7" fill="none" opacity="0.75"/>
          <path d="M 26 66 Q 50 68 74 66" stroke="#2a1530" stroke-width="0.7" fill="none" opacity="0.75"/>
          <path d="M 28 76 Q 50 78 72 76" stroke="#2a1530" stroke-width="0.7" fill="none" opacity="0.65"/>

          <!-- 3 heart-shaped leaves sprouting on top -->
          <path d="M 50 44 Q 32 36 30 18 Q 38 8 50 14 Q 62 8 70 18 Q 68 36 50 44 Z"
                fill="url(#leaf_taro)" stroke="#1f4d10" stroke-width="0.6"/>
          <!-- Heart shape with cleft -->
          <path d="M 50 14 Q 46 18 50 22 Q 54 18 50 14 Z" fill="#3a6e1a" opacity="0.5"/>
          <!-- Leaf vein -->
          <path d="M 50 44 Q 50 30 50 16" stroke="#2e5613" stroke-width="0.6" fill="none" opacity="0.65"/>
          <path d="M 50 30 Q 38 26 32 20" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>
          <path d="M 50 30 Q 62 26 68 20" stroke="#2e5613" stroke-width="0.4" fill="none" opacity="0.5"/>
        </g>
        <!-- Highlights -->
        <ellipse cx="40" cy="56" rx="5" ry="8" fill="#fff" opacity="0.35"/>
        <ellipse cx="38" cy="52" rx="2" ry="3" fill="#fff" opacity="0.7"/>
        <ellipse cx="42" cy="22" rx="2" ry="3" fill="#fff" opacity="0.55"/>
        <ellipse cx="50" cy="88" rx="14" ry="1.4" fill="#000" opacity="0.25"/>
      `;
    },
    // pomelo — emoji-style. Large pear-shaped fruit (slightly elongated
    // top, rounded bottom) in pale yellow-green with skin texture dots.
    pomelo(c) {
      return `
        <defs>
          <filter id="ds_pomelo" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/>
            <feOffset dy="1.8" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="body_pomelo" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#f5fbb8"/>
            <stop offset="55%" stop-color="#dce775"/>
            <stop offset="100%" stop-color="#7a9b1e"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="28" ry="3.5" fill="#000" opacity="0.28"/>
        <g filter="url(#ds_pomelo)">
          <!-- Large pear-shaped pomelo body (rounded bottom, slightly tapered top) -->
          <path d="M 50 22
                   Q 80 28 84 56
                   Q 82 84 50 88
                   Q 18 84 16 56
                   Q 20 28 50 22 Z"
                fill="url(#body_pomelo)" stroke="#5a7515" stroke-width="0.8"/>

          <!-- Skin texture dots (pomelo's signature pitted surface) -->
          <g fill="#5a7515" opacity="0.4">
            <circle cx="32" cy="44" r="0.9"/><circle cx="42" cy="38" r="0.9"/><circle cx="55" cy="34" r="0.9"/>
            <circle cx="65" cy="40" r="0.9"/><circle cx="70" cy="54" r="0.9"/><circle cx="64" cy="68" r="0.9"/>
            <circle cx="48" cy="74" r="0.9"/><circle cx="34" cy="64" r="0.9"/><circle cx="54" cy="54" r="0.9"/>
            <circle cx="40" cy="56" r="0.9"/><circle cx="58" cy="62" r="0.9"/><circle cx="42" cy="78" r="0.9"/>
            <circle cx="60" cy="78" r="0.9"/><circle cx="28" cy="72" r="0.9"/><circle cx="48" cy="46" r="0.9"/>
          </g>

          <!-- Green leaves + stem on top -->
          <path d="M 50 24 L 50 12" stroke="#6d4528" stroke-width="2.2" stroke-linecap="round"/>
          <ellipse cx="42" cy="18" rx="6" ry="3.5" fill="#558b2f" stroke="#2e5613" stroke-width="0.5" transform="rotate(-30 42 18)"/>
          <ellipse cx="58" cy="18" rx="6" ry="3.5" fill="#558b2f" stroke="#2e5613" stroke-width="0.5" transform="rotate(30 58 18)"/>
        </g>
        <!-- Glossy highlight (top-left) -->
        <ellipse cx="34" cy="40" rx="8" ry="12" fill="#fff" opacity="0.4"/>
        <ellipse cx="32" cy="34" rx="3" ry="4" fill="#fff" opacity="0.75"/>
        <ellipse cx="50" cy="88" rx="22" ry="1.4" fill="#000" opacity="0.28"/>
      `;
    },
    // osmanthus (桂花) — emoji-style. Green branch with paired oval leaves
    // and clusters of TINY golden-yellow 4-petal flowers in the leaf axils.
    osmanthus(c) {
      return `
        <defs>
          <filter id="ds_osmanthus" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
            <feOffset dy="1.6" result="off"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="leaf_osmanthus" cx="40%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#aed581"/>
            <stop offset="55%" stop-color="#558b2f"/>
            <stop offset="100%" stop-color="#2e5613"/>
          </radialGradient>
          <radialGradient id="flower_osmanthus" cx="40%" cy="30%" r="80%">
            <stop offset="0%" stop-color="#fffde7"/>
            <stop offset="55%" stop-color="#ffd54f"/>
            <stop offset="100%" stop-color="#f57f17"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.25"/>
        <g filter="url(#ds_osmanthus)">
          <!-- Central branch (curved, going up) -->
          <path d="M 50 88 Q 48 60 50 30 Q 52 18 56 10" stroke="#6d4528" stroke-width="2" fill="none" stroke-linecap="round"/>
          <!-- Side branches -->
          <path d="M 50 60 Q 38 56 28 50" stroke="#6d4528" stroke-width="1.4" fill="none" stroke-linecap="round"/>
          <path d="M 50 40 Q 62 36 72 32" stroke="#6d4528" stroke-width="1.4" fill="none" stroke-linecap="round"/>

          <!-- Pairs of oval leaves attached to branch -->
          <!-- Top pair -->
          <ellipse cx="42" cy="22" rx="7" ry="3.5" fill="url(#leaf_osmanthus)" stroke="#1f4d10" stroke-width="0.5" transform="rotate(-30 42 22)"/>
          <ellipse cx="58" cy="22" rx="7" ry="3.5" fill="url(#leaf_osmanthus)" stroke="#1f4d10" stroke-width="0.5" transform="rotate(30 58 22)"/>
          <!-- Mid-left pair -->
          <ellipse cx="32" cy="44" rx="7" ry="3.5" fill="url(#leaf_osmanthus)" stroke="#1f4d10" stroke-width="0.5" transform="rotate(-50 32 44)"/>
          <ellipse cx="40" cy="50" rx="6" ry="3" fill="url(#leaf_osmanthus)" stroke="#1f4d10" stroke-width="0.5" transform="rotate(15 40 50)"/>
          <!-- Mid-right pair -->
          <ellipse cx="68" cy="38" rx="7" ry="3.5" fill="url(#leaf_osmanthus)" stroke="#1f4d10" stroke-width="0.5" transform="rotate(50 68 38)"/>
          <ellipse cx="60" cy="44" rx="6" ry="3" fill="url(#leaf_osmanthus)" stroke="#1f4d10" stroke-width="0.5" transform="rotate(-15 60 44)"/>
          <!-- Lower pair -->
          <ellipse cx="38" cy="68" rx="7" ry="3.5" fill="url(#leaf_osmanthus)" stroke="#1f4d10" stroke-width="0.5" transform="rotate(-45 38 68)"/>
          <ellipse cx="62" cy="68" rx="7" ry="3.5" fill="url(#leaf_osmanthus)" stroke="#1f4d10" stroke-width="0.5" transform="rotate(45 62 68)"/>

          <!-- TINY 4-petal golden flowers in dense clusters (5 clusters) -->
          <g fill="url(#flower_osmanthus)" stroke="#bf8700" stroke-width="0.3">
            <!-- Top branch cluster -->
            <g transform="translate(50 18)">
              <circle cx="-1.5" cy="-1" r="1"/><circle cx="1.5" cy="-1" r="1"/>
              <circle cx="-1.5" cy="1.5" r="1"/><circle cx="1.5" cy="1.5" r="1"/>
              <circle cx="-3" cy="0" r="0.9"/><circle cx="3" cy="0" r="0.9"/>
              <circle cx="0" cy="-2.5" r="0.8"/>
            </g>
            <!-- Mid-left cluster -->
            <g transform="translate(36 56)">
              <circle cx="-1.4" cy="-0.8" r="0.9"/><circle cx="1.4" cy="-0.8" r="0.9"/>
              <circle cx="-1.4" cy="1.2" r="0.9"/><circle cx="1.4" cy="1.2" r="0.9"/>
              <circle cx="0" cy="-2" r="0.8"/>
            </g>
            <!-- Mid-right cluster -->
            <g transform="translate(64 50)">
              <circle cx="-1.4" cy="-0.8" r="0.9"/><circle cx="1.4" cy="-0.8" r="0.9"/>
              <circle cx="-1.4" cy="1.2" r="0.9"/><circle cx="1.4" cy="1.2" r="0.9"/>
              <circle cx="0" cy="-2" r="0.8"/>
            </g>
            <!-- Lower-left cluster -->
            <g transform="translate(46 74)">
              <circle cx="-1.4" cy="-0.8" r="0.9"/><circle cx="1.4" cy="-0.8" r="0.9"/>
              <circle cx="-1.4" cy="1.2" r="0.9"/><circle cx="1.4" cy="1.2" r="0.9"/>
            </g>
            <!-- Lower-right cluster -->
            <g transform="translate(54 76)">
              <circle cx="-1.4" cy="-0.8" r="0.9"/><circle cx="1.4" cy="-0.8" r="0.9"/>
              <circle cx="-1.4" cy="1.2" r="0.9"/><circle cx="1.4" cy="1.2" r="0.9"/>
            </g>
          </g>
        </g>
        <ellipse cx="50" cy="88" rx="14" ry="1.4" fill="#000" opacity="0.25"/>
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
