/**
 * 人/车走到已买地界外时画面不能花。
 * 钉死：四边草甸围裙、地面循环钳在可走世界、树不用 ctx.filter、镜头不跟进虚空。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const iso = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/js/mapview-iso.js'), 'utf8');

assert.match(iso, /_walkViewRange\(/);
assert.match(iso, /ob\.x1 - 4 && gx <= ob\.x2 \+ 4 && gy >= ob\.y1 - 4 && gy <= ob\.y2 \+ 4/);
assert.ok(!/_tree[\s\S]{0,900}ctx\.filter\s*=/.test(iso),
  '野树不得再用 ctx.filter（林墙处会把整屏染花）');
assert.match(iso, /_blitBackdrop\(/);
assert.match(iso, /finally \{ this\._ctx = real; \}|finally \{\s*this\._ctx = real/);
assert.match(iso, /!this\._inWalkWorld\(Math\.round\(lgx\)/);
assert.match(iso, /c0x = Math\.round\(\(ob\.x1 \+ ob\.x2\) \/ 2/);
assert.ok(!/ctx\.ellipse\(c\.x, c\.y, tw \* 0\.78, th \* 0\.68/.test(iso),
  '地界外不得再铺半透明椭圆（重叠 = 花屏）');

console.log('ok edge-view');
