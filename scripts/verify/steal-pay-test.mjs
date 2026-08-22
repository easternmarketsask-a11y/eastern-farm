// 顺菜要留下菜钱（Chris 2026-08-22：「到邻居家顺走菜要按 5 折价格留下钱」）。
// 这几条坏了都不报错，只会变成「白拿」或「刷币」。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const st = strip(fs.readFileSync(join(root, 'src/js/social-steal.js'), 'utf8'));
const iso = strip(fs.readFileSync(join(root, 'src/js/mapview-iso.js'), 'utf8'));

// ① 5 折，且只有一处算法（两边各算一套必然对不上）
assert.match(st, /STEAL_PAY_RATIO:\s*0\.5/, '菜钱是 5 折');
assert.match(st, /payFor\(cropId\)/, '要有唯一的算钱函数 payFor');
assert.match(st, /unit \* socialConfig\.STEAL_PAY_RATIO/, 'payFor 要用那个比例算');

// ② 顺的人真的被扣钱，且付不起就顺不走
assert.match(st, /Farm\.state\.spendCoins\(pay\)/, '顺成功要真的扣钱');
assert.match(st, /reason: 'no_coins'/, '钱不够要顺不走');
// 仓满时不能白扣钱
assert.ok(/if \(!wh\.ok\) return \{ ok: false, reason: 'warehouse_full' \};[\s\S]{0,200}?spendCoins\(pay\)/.test(st),
  '要先确认入仓成功再扣钱，仓满不能白付');

// ③ 被顺的人收得到钱
assert.match(st, /coins: r\.paid/, '菜钱要写进事件带给对方');
assert.match(st, /Farm\.state\.addCoins\(got\)/, '被顺的人要收下菜钱');

// 🔒 e.coins 是跨用户写入的，不可信 —— 必须夹到本地算出的应付额，否则伪造事件能刷币
assert.match(st, /Math\.min\(Number\.isFinite\(sent\) \? sent : 0, due\)/,
  '收到的菜钱必须夹上限（跨用户字段不可信，防伪造事件刷币）');
assert.match(st, /const due = this\.payFor\(e\.cropId\)/, '上限要用同一个 payFor 算');

// ④ 玩家要知道自己付了钱
assert.match(iso, /留下 ' \+ paid \+ ' 农场币菜钱/, '顺成功的提示要说出留了多少钱');

// ⑤ 调性红线：口径仍是「顺 / 菜钱」，不许出现「偷 / 抢」
const raw = fs.readFileSync(join(root, 'src/js/social-steal.js'), 'utf8');
const zhStrings = raw.match(/'[^']*[一-龥][^']*'/g) || [];
const bad = zhStrings.filter((x) => /偷了|去偷|抢走|抢了/.test(x));
assert.deepEqual(bad, [], '玩家可见文案不许出现「偷/抢」：' + bad.join(', '));

console.log('ok steal-pay');
