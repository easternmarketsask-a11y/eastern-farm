// 「取消无限收购」的源码契约（2026-08-22）。
//
// 这几条坏了都不抛异常、冒烟也看不见，只会静默地把功能掏空：
//  · 卖货入口留着 → 改了等于没改
//  · totalDeliveries 没人加 → 人生故事的交付章节、排行榜交付数、daily 的新手
//    判定、漏斗 sell_first 全部永久冻结
//  · 新手引导第三步还指着谷仓「卖给东方超市」→ 全新玩家卡死在引导里（这一步
//    靠 totalDeliveries 变大才推进，2026-07-07 已经因为类似原因出过 P0）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
/* 源码断言前**先剥注释**。
   这个坑已经踩了三次：墓碑注释（「deliverWarehouse 已删除，别加回来」）本身
   含有被禁的字样，不剥注释就会把有价值的注释判成违规。注释要留，检查要准。 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (p) => stripComments(fs.readFileSync(join(root, p), 'utf8'));
const readRaw = (p) => fs.readFileSync(join(root, p), 'utf8');
const state = read('src/js/state.js');
const wh = read('src/js/warehouse.js');
const ord = read('src/js/orders.js');
const spot = read('src/js/spotlight.js');
const coach = read('src/js/coach.js');

// ① 大宗收购必须真的没了
assert.ok(!/deliverWarehouse/.test(state), 'state.deliverWarehouse 要删干净');
assert.ok(!/deliverWarehouse/.test(wh), 'warehouse 不许再调 deliverWarehouse');
assert.ok(!/卖给东方超市/.test(wh), '谷仓里「卖给东方超市」的入口要撤掉');

// ② totalDeliveries 必须被订单交付接管，并且是**真的自增**而不是只提了一嘴
assert.match(ord, /totalDeliveries\s*=\s*\(\s*d\.totalDeliveries\s*\|\|\s*0\s*\)\s*\+\s*1/,
  '订单交付要给 totalDeliveries 自增');
assert.match(ord, /sell_first/, '首次交付要上报 sell_first 漏斗事件');

// ③ 新手引导第三步要改指东超的订单，别再指着已经卖不了菜的谷仓
assert.ok(!/卖给东方超市/.test(spot), '引导文案不能再说「卖给东方超市」（那个入口没了）');
assert.match(spot, /东超|订单/, '引导第三步要指向东超的订单');

// ④ coach 文案里的「每日首单 +20%」是大宗卖货的规则，随它一起走
assert.ok(!/每日首单\s*\+20%/.test(coach), 'coach 里的旧首卖加成文案要更新');

// ⑤ 每日首次交付的加成不该凭空消失（它是每天回来的钩子），只是改挂在订单上。
// ⚠️ 要查**赋值**不能只查提到：只查 /firstDeliveryDone/ 的话，把置位那行删掉、
// 只留 if 判断，测试照样绿（变异体验证过）——那样加成会每次交单都发。
assert.match(ord, /dailyClaims\.firstDeliveryDone\s*=\s*true/,
  '每日首单加成发完要置位，否则每交一单都白送 20%');
assert.match(ord, /firstBonus\s*=\s*Math\.round\(order\.coins\s*\*\s*0\.2\)/,
  '每日首单加成要真的算出来（回访钩子不能丢）');

console.log('ok no-bulk-sell');
