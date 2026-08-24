// 「怎么玩」内容红线。源码级，零依赖，跑一秒。
//
// 为什么要有这个：guide.js 是**没人会主动去读的文件**。2026-08-22 订单制上线、
// 大宗收购删掉之后，「怎么玩」里头两条还在教「把谷仓的菜卖给东方超市」——
// 教的是一个已经不存在的按钮，而且**不抛异常、不报错**，冒烟测试也照样绿。
// 是 Chris 让优化时才发现的，那时已经错了两天。
//
// 这个文件把「玩法改了但说明没跟上」变成 CI 红灯。
// ⚠️ 以后删/改任何玩法，先在这里加一条断言，再去改 guide.js。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(join(root, 'src/js/guide.js'), 'utf8');

// 只看**渲染出去的文案**，不看注释 —— 注释里写「不许再出现卖谷仓」是对的，
// 拿它当命中会假红。（这个坑在 orders-ui-test 里踩过四次。）
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const s = strip(src);

/* ① 卖菜只有订单制（2026-08-22 起）。大宗收购的 state.deliverWarehouse /
      warehouse.deliver() 都已删除，说明里再教这条就是教一个不存在的按钮。 */
for (const dead of ['卖给东方超市', '卖给东超', '大宗', '直接卖谷仓', 'Bulk-sell', 'bulk sell']) {
  assert.ok(!s.includes(dead),
    `「怎么玩」里还在教已经删掉的大宗收购：「${dead}」—— 卖菜只剩订单制`);
}
assert.ok(s.includes('东超告示牌') && s.includes('Eastern Market board'),
  '交货入口是东超告示牌，中英文都要写出来，否则新玩家找不到地方卖菜');

/* ② 顺菜要按半价留钱（2026-08-22 Chris 定）。只写「顺一棵」是漏了关键一半。 */
assert.ok(s.includes('按半价留下菜钱'), '顺菜必须写明「按半价留下菜钱」');
assert.ok(/half the price/i.test(s), '顺菜的英文也要写明留一半钱');

/* ③ 超市积分有服务端每日上限，说明里不能让人以为无限。 */
assert.ok(s.includes('每天有上限'), '超市积分必须写「每天有上限」');
assert.ok(/daily cap/i.test(s), '积分上限的英文也要有');

/* ④ 车 2026-08-20 起能开，不是只能买来摆着。 */
assert.ok(s.includes('点车上车'), '车能开，别只写「能买」');

/* ⑤ 分章结构：改版前 12 条平铺，找不到自己要的那条。 */
// ⚠️ 别用跨行正则数章 —— 这个仓库是 CRLF，`,\n` 匹配不到 `,\r\n`（刚踩过）。
const chapters = (s.match(/items: \[/g) || []).length;
assert.ok(chapters >= 4, `「怎么玩」要分章，现在只解析出 ${chapters} 章`);

/* ⑥ 图标是简笔画 SVG，不是 emoji（与 promo/sketch-cards 同一套线条语言）。 */
assert.ok(s.includes('viewBox="0 0 32 32"'), '图标要用 SVG 简笔画');
assert.ok(!/icon: '[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s),
  '图标不要用回 emoji');

/* ⑦ 每条都要中英双语齐全 —— 缺一边在英文界面下会渲染出 undefined。 */
const zhTitles = (s.match(/zh: \{ title:/g) || []).length;
const enTitles = (s.match(/en: \{ title:/g) || []).length;
assert.equal(zhTitles, enTitles, `中英条目数对不上：中 ${zhTitles} / 英 ${enTitles}`);
assert.ok(zhTitles >= 10, `条目太少（${zhTitles}），「怎么玩」该覆盖全部主要玩法`);

console.log(`ok guide-content — ${chapters} 章 / ${zhTitles} 条，红线全过`);
