import assert from 'node:assert/strict';

function lookFromUid(uid) {
  if (!uid) return 1;
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return (h % 9) + 1;
}
function clampLook(n) {
  const x = n | 0;
  return (x >= 1 && x <= 9) ? x : 2;
}
assert.equal(lookFromUid(null), 1);
assert.equal(lookFromUid(''), 1);
assert.equal(lookFromUid('abc'), lookFromUid('abc'));
const a = lookFromUid('abc');
assert.ok(a >= 1 && a <= 9);
assert.equal(clampLook(0), 2);
assert.equal(clampLook(9), 9);
assert.equal(clampLook(99), 2);
assert.equal(clampLook(2), 2);
assert.equal(lookFromUid('abc'), 1);

const SHEET_COLS = 6, SHEET_ROWS = 5;
function previewStyle(look, anim) {
  const ANIMS = { idle: 0, walk: 1, water: 2, harvest: 3, plant: 4 };
  const id = clampLook(look);
  const row = ANIMS[anim] || 0;
  const yPct = SHEET_ROWS <= 1 ? 0 : (row / (SHEET_ROWS - 1)) * 100;
  return 'background-image:url(assets/images/farmers/p_farmer_' + id + '.webp);'
    + 'background-size:' + (SHEET_COLS * 100) + '% ' + (SHEET_ROWS * 100) + '%;'
    + 'background-position:0 ' + yPct + '%;'
    + 'background-repeat:no-repeat;';
}
const css = previewStyle(2);
assert.ok(css.includes('600%'));
assert.ok(css.includes('500%'));
assert.ok(!css.includes('400%'));
assert.ok(css.includes('p_farmer_2.webp'));
assert.equal(previewStyle(0).includes('p_farmer_2.webp'), true);
assert.ok(previewStyle(2, 'plant').includes('100%'));
console.log('ok', 'abc→', a, 'sheet 6x5');
