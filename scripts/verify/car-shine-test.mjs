/**
 * 车辆保养是奖励型：擦亮跑得更快，不擦只是目录速度，永远开得了。
 * 目录速度函数不得吃 shine，否则闸门 I 的 4.4 / 9.0 会漂。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const farmer = readFileSync(join(root, 'src/js/farmer.js'), 'utf8');
const iso = readFileSync(join(root, 'src/js/mapview-iso.js'), 'utf8');

assert.match(farmer, /SHINE_BONUS/);
assert.match(farmer, /function polish\(/);
assert.match(farmer, /function shineOf\(/);

const cat = farmer.match(/function catalogSpeed\(\) \{[\s\S]*?\n  \}/);
assert.ok(cat, 'catalogSpeed 抽得出');
assert.ok(!/shine/i.test(cat[0]), '目录速度不得吃 shine（否则 C7/C8 假红或漂档）');

const mv = farmer.match(/function moveSpeed\(\) \{[\s\S]*?\n  \}/);
assert.ok(mv, 'moveSpeed 抽得出');
assert.match(mv[0], /SHINE_BONUS/, '开车真速度才吃擦亮加成');

assert.ok(!/\.fuel\b|outOfGas|needFuel|brokenCar/.test(farmer),
  '不得出现油箱/坏车字段');
assert.ok(!/if \(shineOf\(o\) <= 0\) return false/.test(farmer),
  'shine 为 0 不得拦住开车');
assert.match(farmer, /POLISH_COST/);
assert.match(iso, /_carCareAt/);
assert.match(iso, /_drawCarGlint/);
assert.match(iso, /data-car-shine/);

console.log('ok car-shine');
