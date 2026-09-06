/**
 * 黄昏侧光 + 空气光柱 + 菜随风。不换贴图，人不许 rotate 走路。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const iso = readFileSync(join(root, 'src/js/mapview-iso.js'), 'utf8');
const farmer = readFileSync(join(root, 'src/js/farmer.js'), 'utf8');

assert.match(iso, /_drawLit\(/);
assert.match(iso, /source-atop/);
assert.match(iso, /_drawSunRays\(/);
assert.match(iso, /this\._drawSunRays\(W, H\)/);
assert.match(iso, /_drawIsoPlant[\s\S]{0,2500}ctx\.rotate\(wind\)/);
assert.ok(!/_tree[\s\S]{0,900}ctx\.filter\s*=/.test(iso), '树仍不得 ctx.filter');
assert.match(farmer, /iso\._drawLit/);
assert.ok(!/ctx\.rotate\(/.test(farmer), '走路不得 rotate');
assert.match(farmer, /anim === 'idle'[\s\S]{0,200}0\.018/);

console.log('ok visual-light');
