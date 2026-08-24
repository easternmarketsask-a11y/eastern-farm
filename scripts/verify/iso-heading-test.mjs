/**
 * 等距 2:1 朝向契约。
 * _cell: x∝(gx-gy)  y∝(gx+gy)
 *   +gx = 屏幕右下 (SE，朝镜头偏右)   +gy = 屏幕左下 (SW，朝镜头偏左)
 *   -gx = 屏幕左上 (NW，背对镜头)     -gy = 屏幕右上 (NE，背对镜头)
 * 人/车贴图都是 3/4 朝右下；左右靠水平翻转，背对镜头必须换背面行/车尾图。
 * 旧逻辑用世界轴 |dx| vs |dy| 且 +gy → face 'r'，人会侧着走、车会侧着开。
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const farmerSrc = readFileSync(join(root, 'src/js/farmer.js'), 'utf8');
const isoSrc = readFileSync(join(root, 'src/js/mapview-iso.js'), 'utf8');

function heading(dx, dy) {
  const sx = dx - dy;
  const sy = dx + dy;
  if (sx === 0 && sy === 0) return { face: 'r', away: false };
  return { face: sx >= 0 ? 'r' : 'l', away: sy < 0 };
}

assert.deepEqual(heading(1, 0), { face: 'r', away: false }, '+gx SE 朝右、面对镜头');
assert.deepEqual(heading(0, 1), { face: 'l', away: false }, '+gy SW 朝左、面对镜头（旧逻辑错成朝右）');
assert.deepEqual(heading(-1, 0), { face: 'l', away: true }, '-gx NW 朝左、背对镜头');
assert.deepEqual(heading(0, -1), { face: 'r', away: true }, '-gy NE 朝右、背对镜头');
assert.deepEqual(heading(1, -1), { face: 'r', away: false }, '屏幕正右');
assert.deepEqual(heading(-1, 1), { face: 'l', away: false }, '屏幕正左');
assert.deepEqual(heading(1, 1), { face: 'r', away: false }, '屏幕正下（面对镜头）');
assert.deepEqual(heading(-1, -1), { face: 'r', away: true }, '屏幕正上（背对镜头）');
assert.equal(heading(0, 1).face, 'l');
assert.equal(heading(0, 1).away, false);

const m = farmerSrc.match(/function heading\(dx, dy\) \{[\s\S]*?\n  \}/);
assert.ok(m, 'farmer.js 必须导出纯函数 heading(dx, dy)');
const extracted = m[0];
assert.ok(extracted.includes('dx - dy'), 'heading 必须用屏幕 x = dx-dy');
assert.ok(extracted.includes('dx + dy'), 'heading 必须用屏幕 y = dx+dy');
assert.ok(!/Math\.abs\(dx\)\s*>=\s*Math\.abs\(dy\)/.test(farmerSrc),
  'moveToward 不得再用世界轴 |dx| vs |dy| 判朝向');

assert.match(farmerSrc, /const h = heading\(dx, dy\)/);
assert.match(farmerSrc, /(?:A|actor)\.face = h\.face/);
assert.match(farmerSrc, /(?:A|actor)\.away = h\.away/);
assert.match(farmerSrc, /backSheet|p_farmer_.*_back/);
assert.match(farmerSrc, /Farm\.farmer\.heading\s*=\s*heading|heading:\s*heading/);

assert.ok(!/ctx\.rotate\(/.test(farmerSrc),
  '走路不得 rotate，那会看起来像侧着歪着走');
assert.match(farmerSrc, /const squash = walking/);
assert.match(farmerSrc, /ctx\.scale\(1, squash\)/);
assert.ok(!/Math\.abs\(Math\.sin\(A\.frameT \* 16\)\)/.test(farmerSrc),
  '走路不得再原地蹦（abs-sin hop）');
assert.match(farmerSrc, /anim === 'walk' && (backRows|rows) > 1|usingBack[\s\S]{0,200}walk/,
  '背面表必须分行：站立 idle / 走路 walk');
assert.match(farmerSrc, /blitSheet\([^)]*'r',\s*true\)/,
  '摊前客人必须背对镜头（面向菜摊）');

assert.match(isoSrc, /_blit\(im, cx, by, maxW, maxH, flipX\)|_blit\(im, cx, by, maxW, maxH, flip/);
assert.match(isoSrc, /p_car_\d+_rear|stem \+ '_rear'|_carRear/);
assert.ok(isoSrc.includes('carPos') && /face|away|flip/.test(isoSrc),
  '开车时必须按 heading 翻转/换车尾图');

for (let i = 1; i <= 9; i++) {
  const p = join(root, 'src/assets/images/farmers/p_farmer_' + i + '_back.webp');
  assert.equal(existsSync(p), true, 'missing back sheet p_farmer_' + i + '_back.webp');
  assert.ok(statSync(p).size > 18000, 'back sheet p_farmer_' + i + ' should be idle+walk 6×2');
}
for (let i = 1; i <= 16; i++) {
  assert.equal(existsSync(join(root, 'src/assets/images/map/p_car_' + i + '_rear.webp')), true,
    'missing rear car p_car_' + i + '_rear.webp');
}

console.log('ok iso-heading');
