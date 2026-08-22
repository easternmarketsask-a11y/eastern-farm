// 订单板 UI 契约（2026-08-22）。源码级，零依赖。
// 这几条坏了都不报错，只是功能被悄悄掏空。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const o = strip(fs.readFileSync(join(root, 'src/js/orders.js'), 'utf8'));
const st = strip(fs.readFileSync(join(root, 'src/js/state.js'), 'utf8'));

// ① 接单 / 放弃 / 上限
assert.match(o, /accept\(orderId\)/, '要有接单');
assert.match(o, /abandon\(orderId\)/, '要有放弃（无惩罚腾位置）');
assert.match(o, /SD\.ACCEPT_CAP/, '接单上限用 store-demand 的常量，别再写一份');
assert.match(o, /o\.accepted = false;/, '放弃要真的把 accepted 置回 false');

// 🔒 没接的单不能交付，否则接单上限形同虚设
assert.match(o, /if \(!order\.accepted\)[\s\S]{0,200}?return;/,
  'fulfill 必须挡住未接的单');

// ② 三段都要渲染
assert.match(o, /staples\.map/, '要渲染每日基础补货');
assert.match(o, /forecast \|\| \[\]\)\.map/, '要渲染备货预告');
assert.match(o, /board\.map/, '要渲染订单卡');

// ③ 免费换单必须没了（它是无限收购的另一种形态）
assert.ok(!/swap\s*\(/.test(o), '免费换单要撤掉');
assert.ok(!/换一单/.test(o), '「换一单」按钮要撤掉');

// ④ 交完不立刻补位（立刻补位＝无限供应）
assert.ok(!/sd\.board\[idx\] = fresh/.test(o), '交完不许原地补一张新单');
assert.match(o, /sd\.board = sd\.board\.filter\(\(o\) => o\.id !== orderId\)/,
  '交完把这张从板上拿掉，下一张按 nextPostAt 自然到来');

// ⑤ 生成逻辑一律问 store-demand，别抄回来
assert.match(o, /SD\.makeOrder\(/, '订单由 store-demand 生成');
assert.match(o, /SD\.makeStaples\(/, '补货由 store-demand 生成');
assert.match(o, /SD\.makeForecast\(/, '预告由 store-demand 生成');
assert.ok(!/Math\.floor\(Math\.random\(\) \* pool/.test(o), 'orders.js 不许自己抄一套抽样');

// ⑥ 单一数据源：旧的 d.orders 数组要退役
assert.ok(!/^\s*orders:\s*\[\],/m.test(st), 'STARTER_STATE 里的旧 orders[] 要退役');

// ⑦ 离线不追发：补单是「补到上限」，不是「按错过的周期数补」
assert.match(o, /while \(sd\.board\.length < SD\.BOARD_CAP/,
  '补单要以板位上限为界，不能按错过的周期数补发');

// ⑧ 日期只有一处算，且走 state 的 getDateString（萨省 UTC-6）
assert.match(o, /Farm\.state\.getDateString\(/, '日期要走 Farm.state.getDateString');
const dateCalls = (o.match(/new Date\(/g) || []).length;
assert.ok(dateCalls <= 2, '算日期的地方要收在 _nextDays 一处，实际 new Date( 出现 ' + dateCalls + ' 次');

/* ===== 版式要像「货单」，不像设置面板（Chris 2026-08-22）===== */
assert.match(o, /slip-head/, '每张单要有抬头');
assert.match(o, /slip-no/, '要有单号');
assert.match(o, /slip-to/, '要写收货方');
assert.match(o, /slip-dots/, '明细要有引导点（账目单的做法，名字和数量连成一行）');
assert.match(o, /slip-total/, '要有结算行');
const css = fs.readFileSync(join(root, 'src/css/style.css'), 'utf8');
assert.match(css, /\.order-slip\s*\{/, '货单样式要在');
assert.match(css, /\.slip-dots\s*\{[\s\S]*?repeating-linear-gradient/, '引导点用重复渐变画');
assert.match(css, /\.slip-total-coins[\s\S]*?tabular-nums/, '金额要等宽数字（账目感）');

/* 单据上的按钮：窄、靠右、不吃全局 .btn 的全宽大药丸（Chris 2026-08-22 反馈） */
assert.ok(!/class="btn (order-accept|order-deliver)/.test(o),
  '单据动作不许复用全局 .btn（48px 全宽药丸，压在货单上就是设置面板）');
assert.match(o, /slip-btn/, '单据动作用窄按钮 slip-btn');
// 🔒「还差一点 / 接单位已满」是状态不是动作，画成大按钮正是「肥大」的来源
assert.match(o, /slip-note[\s\S]{0,120}?还差一点/, '「还差一点」要是一行小字，不是按钮');
assert.ok(!/order-deliver-disabled/.test(o), '不要再渲染一个禁用的大按钮');
// 仍要守住可点下限
assert.match(css, /\.slip-btn\{[\s\S]*?min-height:44px/, '窄按钮仍要 ≥44px 可点');

/* 🔒 渲染出来的 class 和接线用的选择器必须对得上。
   改按钮样式时最容易漏掉接线 —— 而 E2E 里的放弃是直接调 abandon()，
   DOM 上点不动它也发现不了（这次就是靠肉眼看出来的）。 */
for (const cls of ['order-accept', 'order-deliver', 'slip-drop', 'staple-fill']) {
  // 用纯字符串比对，不用正则 —— 这里的反斜杠转义在生成脚本里被吃掉过好几次
  const rendered = o.indexOf(cls + '"') >= 0 || o.indexOf(cls + ' ') >= 0;
  const wired = o.indexOf("querySelectorAll('#modalContent ." + cls + "')") >= 0;
  assert.ok(rendered, '没渲染出 .' + cls);
  assert.ok(wired, '.' + cls + ' 渲染了却没接线（点了不会有反应）');
}

console.log('ok orders-ui');

// ===== 实体告示牌（2026-08-22 Chris:「订单板是否有实体架在地上，可放在货仓旁」）=====
const iso = strip(fs.readFileSync(join(root, 'src/js/mapview-iso.js'), 'utf8'));
assert.match(iso, /board:\s*\{[^}]*tap: 'orders'/, '要有 board 建筑，点它开订单板');
assert.match(iso, /_drawOrderBoard\(/, '告示牌要画出来（程序化，不加贴图）');
assert.match(iso, /_ensureOrderBoard\(\)/, '要有「保证场上一定有一块」的补位函数');
assert.match(iso, /this\._ensureOrderBoard\(\);/, '补位函数必须真的被调用');
// 🔒 不可拆：它是唯一的卖菜出口，拆了玩家就锁死自己
assert.match(iso, /noDelete: true/, '告示牌要标不可删除');
// ⚠️ 断言只能匹配**代码**：上面 strip() 已经把注释剥掉了，拿 `// delete chip`
// 这种注释当锚点必然假红（这个坑今天踩了四次）。
assert.match(iso, /this\._sel === idx && idx != null && !moving && !b\.noDelete/,
  '不可删除的建筑不画删除按钮');
assert.match(iso, /if \(b && b\.noDelete\) return;/, '删除路径要再挡一层');
// 🔒 不进调色盘 = 没有购买入口（免费自动摆）
const pal = (iso.match(/const PALETTE = \[[^\]]*\]/) || [''])[0];
assert.ok(pal && !/'board'/.test(pal), '告示牌不该出现在建造调色盘里（它是免费自动摆的）');

console.log('ok orders-ui + board');

// ===== 老存档的一次性开业清仓单 =====
assert.match(o, /clearedLegacy/, '老存档要有一次性清仓单');
assert.match(o, /sd\.clearedLegacy = true;/, '发过就置位，只发一次');
assert.match(o, /kind: 'clearance'/, '清仓单要有自己的类型');
// 不占接单位，否则老玩家一进来就少一个位置
assert.match(o, /o\.kind !== 'clearance'/, '清仓单不该占接单位');
console.log('ok clearance');
