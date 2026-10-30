/**
 * 今晚吃什么 · 食材画。同一套填色，不靠 emoji。
 * 每张 viewBox 0 0 80 80，调用方用 CSS 决定大小。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DinnerArt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function wrap(inner) {
    return '<svg viewBox="0 0 80 80" aria-hidden="true">' + inner + '</svg>';
  }

  const icons = {
    tomato: wrap(
      '<ellipse cx="40" cy="46" rx="22" ry="20" fill="#d24b3c"/>' +
      '<ellipse cx="33" cy="40" rx="8" ry="6" fill="#e36a58" opacity=".85"/>' +
      '<path d="M34 28c2-8 8-12 14-10 1 4-2 8-6 10" fill="#3f7a3a"/>' +
      '<path d="M40 30c6-2 12 1 14 6-5 1-10-1-14-6z" fill="#2f6a32"/>'
    ),
    egg: wrap(
      '<ellipse cx="40" cy="44" rx="18" ry="24" fill="#fbf6ea" stroke="#c4a574" stroke-width="2"/>' +
      '<ellipse cx="40" cy="48" rx="8" ry="8" fill="#e2a322"/>' +
      '<ellipse cx="37" cy="45" rx="3" ry="2" fill="#f6d98a"/>'
    ),
    scallion: wrap(
      '<path d="M34 74V36c0-8 2-16 6-24 4 8 6 16 6 24v38" fill="#f3efe4" stroke="#c4a574" stroke-width="1.5"/>' +
      '<path d="M28 40c2-14 6-24 12-32 2 10 2 20 0 32" fill="#3e8f4e"/>' +
      '<path d="M46 38c4-12 8-22 14-28-2 12-4 22-8 30" fill="#2f7a40"/>' +
      '<path d="M22 42c-2-10 0-20 4-28 2 10 2 18 0 28" fill="#4ea35a"/>'
    ),
    sesame_oil: wrap(
      '<rect x="32" y="10" width="16" height="8" rx="2" fill="#c6a15a"/>' +
      '<path d="M30 22h20l4 10v30a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8V32z" fill="#8c2f28"/>' +
      '<rect x="28" y="36" width="24" height="14" rx="2" fill="#f3e6c4"/>' +
      '<path d="M34 44h12" stroke="#8c2f28" stroke-width="2"/>'
    ),
    cucumber: wrap(
      '<path d="M16 48c2-16 14-28 28-28 10 0 20 8 22 20 2 14-8 28-24 28C26 68 16 60 16 48z" fill="#3f9a45"/>' +
      '<path d="M24 36c6-6 16-8 26-4" stroke="#8fd18a" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<circle cx="30" cy="48" r="2" fill="#2d7334"/>' +
      '<circle cx="42" cy="44" r="2" fill="#2d7334"/>' +
      '<circle cx="48" cy="54" r="2" fill="#2d7334"/>'
    ),
    tofu: wrap(
      '<path d="M18 28l22-10 22 10v28L40 66 18 56z" fill="#f7f1e4" stroke="#c4a574" stroke-width="1.5"/>' +
      '<path d="M18 28l22 10 22-10" fill="none" stroke="#e4d3b4" stroke-width="2"/>' +
      '<path d="M40 38v28" stroke="#e4d3b4" stroke-width="2"/>' +
      '<path d="M26 34l8 16M54 34l-8 16" stroke="#efe4cf" stroke-width="2"/>'
    ),
    cilantro: wrap(
      '<path d="M40 70V40" stroke="#2f7a40" stroke-width="3"/>' +
      '<circle cx="28" cy="34" r="10" fill="#3e9a4c"/>' +
      '<circle cx="40" cy="24" r="11" fill="#2f8a42"/>' +
      '<circle cx="54" cy="36" r="9" fill="#4aaa58"/>' +
      '<circle cx="34" cy="44" r="7" fill="#348a44"/>'
    ),
    potato: wrap(
      '<ellipse cx="40" cy="42" rx="24" ry="18" fill="#d2a15c" transform="rotate(-12 40 42)"/>' +
      '<ellipse cx="32" cy="38" rx="3" ry="2" fill="#a67c3d"/>' +
      '<ellipse cx="46" cy="46" rx="2.5" ry="2" fill="#a67c3d"/>' +
      '<ellipse cx="50" cy="34" rx="2" ry="1.6" fill="#a67c3d"/>'
    ),
    garlic: wrap(
      '<path d="M40 16c2 8 2 14 0 20" stroke="#6b8f4a" stroke-width="3" fill="none"/>' +
      '<path d="M40 36c-14 2-22 12-20 24 8 8 32 8 40 0 2-12-6-22-20-24z" fill="#f4efe6" stroke="#c4a574" stroke-width="1.5"/>' +
      '<path d="M40 38v24M30 42c2 8 4 16 4 20M50 42c-2 8-4 16-4 20" stroke="#e3d8c8" stroke-width="2" fill="none"/>'
    ),
    bokchoy: wrap(
      '<path d="M24 70c4-20 8-32 16-44 8 12 12 24 16 44" fill="#f6f3ea"/>' +
      '<path d="M18 36c8-16 16-20 22-18 2 10-2 20-8 28" fill="#3d9a48"/>' +
      '<path d="M62 34c-6-16-16-18-22-14 2 12 2 22 8 30" fill="#2f7a3c"/>' +
      '<path d="M40 20c8-8 18-6 20 2-8 2-16 2-20-2z" fill="#4eae58"/>'
    ),
    pepper: wrap(
      '<path d="M28 30c-8 8-10 22-4 34 8 8 24 8 32-2 6-12 2-28-8-34-6 6-14 8-20 2z" fill="#3d8c40"/>' +
      '<path d="M40 30c2-10 6-16 8-20" stroke="#2f6a32" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M36 28c6-2 10 4 8 8" fill="#4ea858"/>'
    ),
    vinegar: wrap(
      '<rect x="34" y="8" width="12" height="10" rx="2" fill="#6b3a2a"/>' +
      '<path d="M28 22h24l2 8v28a10 10 0 0 1-10 10H36a10 10 0 0 1-10-10V30z" fill="#4a2c24"/>' +
      '<rect x="30" y="34" width="20" height="16" rx="2" fill="#f0e2c4"/>' +
      '<circle cx="40" cy="42" r="4" fill="#6b3a2a"/>'
    ),
    eggplant: wrap(
      '<path d="M30 26c8-4 16-2 18 4 6 2 10 6 8 12" fill="#3f7a3a"/>' +
      '<path d="M36 30c-10 6-16 20-12 34 6 10 22 12 32 4 10-10 12-28 4-40-6-4-16-4-24 2z" fill="#6b4588"/>' +
      '<ellipse cx="34" cy="46" rx="6" ry="10" fill="#8660a4" opacity=".7"/>'
    ),
    chive: wrap(
      '<path d="M24 72c2-28 4-44 2-58" stroke="#3a8f46" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<path d="M40 74c0-26 2-46 6-60" stroke="#2f7a3c" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<path d="M54 70c2-24 6-40 12-54" stroke="#4ea358" stroke-width="5" fill="none" stroke-linecap="round"/>'
    ),
    vermicelli: wrap(
      '<ellipse cx="40" cy="44" rx="22" ry="16" fill="#e7d7b4"/>' +
      '<path d="M22 44c6-8 12-8 18 0s12 8 18 0" stroke="#c4a574" stroke-width="2" fill="none"/>' +
      '<path d="M24 50c8-6 14-6 20 0s10 6 16 0" stroke="#b8956a" stroke-width="2" fill="none"/>' +
      '<path d="M26 38c8 6 14 6 18 0s8-6 14 0" stroke="#f3e6cc" stroke-width="2" fill="none"/>'
    ),
  };

  function heat(on) {
    const fill = on ? '#e39a3c' : 'none';
    const stroke = on ? '#e39a3c' : '#8a7360';
    return '<svg viewBox="0 0 24 32" aria-hidden="true">' +
      '<path d="M12 2c2 6-4 8-4 14a8 8 0 0 0 16 0c0-6-4-8-2-14-2 4-6 4-10 0z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>' +
      '</svg>';
  }

  function wok() {
    return '<svg viewBox="0 0 220 120" aria-hidden="true">' +
      '<ellipse cx="110" cy="78" rx="92" ry="28" fill="#1a1816"/>' +
      '<ellipse cx="110" cy="72" rx="86" ry="24" fill="#2c2824"/>' +
      '<ellipse cx="110" cy="68" rx="70" ry="16" fill="#3a342c"/>' +
      '<path d="M70 64c12-10 28-14 40-14s28 4 40 14" fill="none" stroke="#6a5c48" stroke-width="3" opacity=".7"/>' +
      '<rect x="8" y="70" width="28" height="8" rx="3" fill="#4a4036"/>' +
      '<rect x="184" y="70" width="28" height="8" rx="3" fill="#4a4036"/>' +
      '</svg>';
  }

  return {
    ids: Object.keys(icons),
    icon: function (id) { return icons[id] || ''; },
    heat: heat,
    wok: wok,
  };
});
