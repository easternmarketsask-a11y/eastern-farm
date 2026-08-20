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
console.log('ok', 'abc→', a);
