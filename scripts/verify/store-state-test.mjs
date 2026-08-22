// storeDemand 存档契约（2026-08-22）。源码级断言，零依赖。
// 这几条全是这个项目真踩过的坑，不是凑数：
//  · 新增嵌套字段不深拷 → 改 this.data.x 会污染 STARTER_STATE，跨重置泄漏
//  · 日期自己 new Date() 算 → 萨省 UTC-6，日界必错一天
//  · 老存档只有半个字段 → 之后每处 .board.forEach 都炸
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const st = fs.readFileSync(join(root, 'src/js/state.js'), 'utf8');

// ① STARTER_STATE 要有完整的 storeDemand
assert.match(st, /storeDemand:\s*\{/, 'STARTER_STATE 要有 storeDemand');
for (const key of ['day', 'staples', 'board', 'forecast', 'nextPostAt', 'lastSyncAt', 'source', 'clearedLegacy']) {
  assert.ok(new RegExp('storeDemand:[\\s\\S]{0,900}?\\b' + key + '\\s*:').test(st),
    'storeDemand 缺字段 ' + key);
}

// ② 老存档合并时必须整份深拷 STARTER（否则新字段按引用共享，跨重置泄漏）
assert.match(st, /Object\.assign\(JSON\.parse\(JSON\.stringify\(STARTER_STATE\)\), parsed\)/,
  '合并老存档必须先深拷 STARTER_STATE');

// ③ 半个 storeDemand 的存档要能被补全（同 sessionStats 那套守卫）。
// ⚠️ 定义和**调用**都要查：只查定义的话，把调用删掉测试照样绿 —— 一个定义了
// 却没人调的守卫正是典型的摆设（变异体验证过）。
assert.match(st, /function _fillStoreDemand\(/, '要有 storeDemand 嵌套守卫函数');
assert.match(st, /^\s*_fillStoreDemand\(this\.data\);\s*$/m,
  '嵌套守卫必须在读档路径上被真正调用');

// ④ 日期一律走 getDateString。
// ⚠️ 别用「storeDemand 附近 ±N 字符里有没有 new Date()」这种模糊窗口断言 ——
// _fillStoreDemand 正好挨着 getDateString 的定义，而后者内部本来就要 new Date()，
// 必然假红。只查真正该管的两块：STARTER 里那段字面量、和 _fillStoreDemand 的函数体。
const sdLiteral = (st.match(/storeDemand:\s*\{[\s\S]*?clearedLegacy[^,]*,/) || [''])[0];
assert.ok(sdLiteral, '找得到 STARTER_STATE.storeDemand 字面量');
assert.ok(!/new Date\(/.test(sdLiteral), 'storeDemand 默认值里不许 new Date()');
const fillFn = (st.match(/function _fillStoreDemand\(data\)[\s\S]*?sd\[k\] = want;[\s\S]{0,40}/) || [''])[0];
assert.ok(fillFn, '找得到 _fillStoreDemand');
assert.ok(!/new Date\(/.test(fillFn), '_fillStoreDemand 里不许 new Date()');

// ⑤ getDateString 必须是导出的（orders.js 要用 Farm.state.getDateString）
assert.match(st, /^\s*getDateString,\s*$/m, 'getDateString 要挂到 Farm.state 上');

console.log('ok store-state');
