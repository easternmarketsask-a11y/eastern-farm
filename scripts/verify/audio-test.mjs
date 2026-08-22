/**
 * 音效契约：仍是零资产 WebAudio，但每种必须是有层次的合成，不能再是单音蜂鸣。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/js/audio.js'), 'utf8');

const names = ['plant', 'harvest', 'coin', 'buy', 'levelUp', 'achievement', 'error', 'tap', 'horn', 'water', 'build', 'buildDone'];
names.forEach((n) => {
  assert.ok(new RegExp("case '" + n + "'").test(src), 'missing sound ' + n);
});

assert.ok(/_noise\s*\(/.test(src) && /createBuffer/.test(src), '必须有噪声层（土/叶/水/点击）');
assert.ok(/bandpass|highpass|lowpass/.test(src), '噪声必须过滤波器，不能是生白噪');

const plant = src.match(/case 'plant':[\s\S]*?break;/);
assert.ok(plant && /_noise/.test(plant[0]), '种植要有土壤扑声，不能只是下滑音');

const harvest = src.match(/case 'harvest':[\s\S]*?break;/);
assert.ok(harvest && /_noise/.test(harvest[0]), '收获要有叶片窸窣，不能只是 C→G 两音');
assert.ok(harvest && /_tone/.test(harvest[0]), '收获仍保留清亮收尾（连击升调）');

const tap = src.match(/case 'tap':[\s\S]*?break;/);
assert.ok(tap && /_noise/.test(tap[0]), '点击要是短木贴/噪声，不是 700Hz 正弦');
assert.ok(tap && !/700/.test(tap[0]), '旧 700Hz 蜂鸣不得再出现');

const err = src.match(/case 'error':[\s\S]*?break;/);
assert.ok(err && !/sawtooth/.test(err[0]), '错误音不得再用刺耳锯齿波');

const water = src.match(/case 'water':[\s\S]*?break;/);
assert.ok(water && /_noise/.test(water[0]), '浇水必须是水声噪声层');

const horn = src.match(/case 'horn':[\s\S]*?break;/);
assert.ok(horn && horn[0].includes('0.24') || /forEach/.test(horn[0]), '喇叭仍是短促两响');

assert.ok(/startAmbient/.test(src) && /_chirp/.test(src), '环境层：风 + 鸟');
assert.ok(/startEngine/.test(src) && /stopEngine/.test(src), '开车要有引擎循环');
assert.ok(/startEngine[\s\S]{0,900}lowpass/.test(src), '引擎必须低通，不能是蜂鸣');
assert.ok(/tending[\s\S]{0,80}water|play\('water'\)/.test(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/js/tending.js'), 'utf8'
)) || /play\('water'\)/.test(src), '浇水路径要播 water');

const tend = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/js/tending.js'), 'utf8');
assert.ok(/play\('water'\)/.test(tend), 'tending.waterPlot 播 water，不得再播 coin');
assert.ok(!/play\('coin'\)/.test(tend.match(/waterPlot[\s\S]*?return true;/)[0]),
  '浇水成功不得再响金币');

console.log('ok audio');
