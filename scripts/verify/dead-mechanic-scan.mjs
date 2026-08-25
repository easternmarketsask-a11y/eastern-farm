// 全站扫描：玩家看得见的文案里，不许出现已经删掉的玩法。
//
// 为什么单独一个文件：闸门 O（guide-content-test）只盯 guide.js，
// 而 2026-08-25 查下来，同一种烂法散在**九个文件**里 ——
// 订单制上线三天，这些地方还在教「点谷仓卖给东方超市」：
//   toast（farm.js / harvest-status.js）、收获胶囊、厨房副标题、
//   奖励页的金币来源、菜摊说明、教练提示、
//   新手引导第三步标题（i18n.json，**每个新玩家第一眼看到**）、
//   人生故事第一章的目标、每日任务标题、今日面板的新闻。
// 都不抛异常、不报错，只是玩家照着做找不到那个按钮。
//
// ⚠️ 删掉任何玩法之后，往 DEAD 里加一条，比翻九个文件可靠。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// ⚠️ **自动遍历，不要改回手工清单**（2026-08-25）。
// 第一版是手写的 20 个文件名，当场就漏了 ep-shop.json / share.js / login-nudge.js
// —— 手工清单会跟文案一样烂掉，正是这个测试要防的东西。
const SKIP = new Set(['worldcup.js', 'wc2026.json', 'coupons.json']);  // 已退役内容
function collect(dir, ext) {
  return fs.readdirSync(join(root, dir))
    .filter((f) => f.endsWith(ext) && !SKIP.has(f))
    .map((f) => `${dir}/${f}`);
}
const FILES = [...collect('src/js', '.js'), ...collect('data', '.json')];

// 已经删掉的玩法 → 说明为什么不许再出现。
// 只匹配**渲染出去的字**：.js 先剥注释，.json 跳过 _comment。
const DEAD = [
  ['卖货',        '大宗收购 2026-08-22 已删，卖菜只剩按订单交货'],
  ['散卖',        '同上：没有「散卖」这个基准了'],
  ['大宗卖',      '同上'],
  ['卖给东方超市', '同上：交货入口是东超告示牌，不是谷仓'],
  ['卖给东超',    '同上'],
  ['一键卖光',    '同上'],
  ['请先出售',    '同上：谷仓满了要去交一单，不是「出售」'],
  ['可售予',      '同上'],
  ['小东',        'NPC 2026-08-22 已改名东超'],
  ['东超厨房',    '2026-08-24 Chris 改名农场厨房'],
  ['东方积分',    '这个东西全仓叫「超市积分」，别再造第三个名字'],
  ['东超积分',    '同上（2026-08-25 Chris 定：那就还是超市积分）'],
  // ⚠️ 英文侧也要查。2026-08-25 中文都改完了，英文还留着四条
  //    （rewards「Sell harvested crops」、i18n「Barn is full — sell first」、
  //     storekeeper「Don't sit on the barn」、news「Tap it to sell」）——
  //    只查中文的扫描器等于放过一半。
  ['Sell harvested',    'EN: 大宗收购已删，改成 Fill ... orders'],
  ['sell to Eastern',   'EN: 同上（交货入口是 Eastern Market board）'],
  ['Sell to Eastern',   'EN: 同上'],
  ['sell & free',       'EN: 同上'],
  ['sell first',        'EN: 同上（谷仓满了是 fill an order）'],
  ['Sell first',        'EN: 同上'],
  ['Bulk sale',         'EN: 同上'],
  ['Bulk-sell',         'EN: 同上'],
  ['bulk sell',         'EN: 同上'],
  ["Eastern Market's Kitchen", 'EN: 2026-08-24 已改名 Farm Kitchen'],
  // 2026-08-25 Chris：「一律农场币」。此前全仓 农场币 149 处 / 金币 31 处混着用，
  // 最刺眼的是 farmer.js 隔壁两行：一行 toast「农场币不够」，一行走 i18n 键出来
  // 是「金币不够」—— 同一个东西两个名字。
  ['金币', '2026-08-25 Chris 定：一律农场币'],
];

const stripJs = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function playerText(rel) {
  const raw = fs.readFileSync(join(root, rel), 'utf8');
  if (!rel.endsWith('.json')) return stripJs(raw);
  // JSON：_comment 是写给开发看的，不算玩家文案
  const out = [];
  (function walk(o, k) {
    if (typeof o === 'string') { if (!String(k).startsWith('_')) out.push(o); return; }
    if (Array.isArray(o)) return o.forEach((v) => walk(v, k));
    if (o && typeof o === 'object') {
      for (const [kk, v] of Object.entries(o)) if (!kk.startsWith('_')) walk(v, kk);
    }
  })(JSON.parse(raw), '');
  return out.join('\n');
}

const hits = [];
for (const rel of FILES) {
  let text;
  try { text = playerText(rel); }
  catch (e) { throw new Error(`${rel} 读不了或不是合法 JSON：${e.message}`); }
  for (const [word, why] of DEAD) {
    if (text.includes(word)) hits.push(`${rel}  「${word}」 —— ${why}`);
  }
}

assert.equal(hits.length, 0,
  '玩家看得见的文案里还有已经删掉的玩法：\n  ' + hits.join('\n  '));

/* 反向：交货这条链上的关键词必须在，否则说明被人整段删了 */
const guide = playerText('src/js/guide.js');
assert.ok(guide.includes('东超告示牌'), 'guide 里必须写明交货入口是东超告示牌');
const i18n = playerText('data/i18n.json');
assert.ok(i18n.includes('东超告示牌'), '新手引导里必须写明交货入口');

console.log(`ok dead-mechanic-scan — ${FILES.length} 个文件 × ${DEAD.length} 条废玩法，全清`);
