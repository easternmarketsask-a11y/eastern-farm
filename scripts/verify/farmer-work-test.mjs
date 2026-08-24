/**
 * 收割/种植落点与动作契约。
 * 人必须站在垄的朝镜头前缘（手够得到土/菜），不能站在邻格空草地上演戏。
 * 收割/种植不得先播一帧站桩再突然跪下/举菜。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(root, 'src/js/farmer.js'), 'utf8');

assert.ok(/function approachPos\(/.test(src), '寻路用 approachPos（邻格），干活用 plotPos（垄上）');
assert.ok(/function plotPos\(iso, plotIdx/.test(src), 'plotPos 仍是干活落点');

const plotFn = src.match(/function plotPos\(iso, plotIdx[\s\S]*?\n  \}/);
assert.ok(plotFn, '能抽出 plotPos');
assert.ok(!/y \+ 0\.12/.test(plotFn[0]), 'plotPos 不得再把人推到邻格 +0.12（离土一整格）');
assert.ok(!/dirs = \[\[0, 1\]/.test(plotFn[0]), 'plotPos 不得选邻格当干活站位');
assert.ok(/gx \+ 0\.\d+/.test(plotFn[0]) && /gy \+ 0\.\d+/.test(plotFn[0]),
  '干活站在本块地的前缘偏移上');

const offG = plotFn[0].match(/gy \+ (0\.\d+)/g) || [];
offG.forEach((s) => {
  const n = parseFloat(s.replace('gy + ', ''));
  assert.ok(n > 0.15 && n < 0.62, '前缘偏移应在垄上 (0.15–0.62)，现在是 ' + n);
});

assert.match(src, /A\.path = Farm\.pathfind\.find\(A\.gx, A\.gy, (ap|approach)\.gx/);
assert.match(src, /arrived = moveToward\(dt, p\.gx, p\.gy/);

assert.match(src, /WORK_HOLD|workHold|workSecs/);
assert.match(src, /anim === 'harvest'[\s\S]{0,400}dip|anim === 'plant'[\s\S]{0,400}dip/);

const fi = src.match(/function frameIndex\(\) \{[\s\S]*?\n  \}/);
assert.ok(fi, 'frameIndex');
assert.ok(/harvest/.test(fi[0]) && /plant/.test(fi[0]), '收割种植走自己的帧');
assert.ok(!/Math\.min\(n - 1, Math\.floor\(A\.frameT \* FPS\)\)/.test(fi[0])
  || /1 \+ /.test(fi[0]) || /WORK_/.test(fi[0]),
  '收割种植不得从第 0 列站桩帧播起');

assert.match(src, /function doingFarmWork\(/);
assert.match(src, /iso\._build && !doingFarmWork\(\)/,
  '建造模式只在没农活时站住，有收/浇/种不能把 tick 掐掉');
assert.match(src, /iso\._build && !keepQueue/,
  '建造仍不许点空地乱走；农活内部续走 keepQueue 要放行');
assert.ok(!/if \(iso\._build \|\| \(Farm\.state && Farm\.state\._visitLock && !A\.visitHold\)\)/.test(src),
  '不得再把建造和拜访捆成一条直接 return（那会停掉农活）');

console.log('ok farmer-work');
