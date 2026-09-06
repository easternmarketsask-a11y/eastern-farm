// 待激活账号积分/存档的源码级守卫（登录审查 🟠 J/K/L，2026-09-06）。
// 浏览器那条 pending-points-test.js 测行为；这里钉几条「删掉一行测试还可能绿」的口径：
//  · 409 在 fb-points 与队列两处都要算终局拒绝 —— 少一处，409 的 spend 会每 60 秒重试到两周
//  · 10 币 = 1 分只许有一个出处（COINS_PER_EP），退币和兑换算的必须是同一个数
//  · 待激活账号的 push 必须在「member_doc_unresolved」那道守卫**之前**分流
//  · 待激活账号的存档绝不进公开的 farm_players
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(join(root, 'src/js', f), 'utf8');
const st = read('state.js'), pts = read('firebase-points.js'), q = read('firebase-queue.js'), gs = read('firebase-game-sync.js');

// ① 409 是终局拒绝：fb-points 的 spend 分支 + 队列的 terminal 判定
const spendFn = st.slice(0) && pts.slice(pts.indexOf('async syncEpSpend('), pts.indexOf('claimStorePurchaseRewards('));
assert.match(spendFn, /e\.code === 409/, 'syncEpSpend 没把 409 当拒绝（会进队列每 60 秒重试）');
assert.match(q, /const terminal = r && r\.rejected && \([^)]*r\.code === 409[^)]*\)/, '队列 terminal 判定漏了 409');

// ② 10 币 = 1 分只有一个出处
assert.match(st, /^\s*COINS_PER_EP: 10,\s*$/m, 'state.js 要有 COINS_PER_EP');
const exch = st.slice(st.indexOf('exchangeCoinsToEp(coinAmt) {'), st.indexOf('// ============ Shop'))
  .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');   // 只看代码，不看注释
assert.ok(!/\*\s*10\b|\/\s*10\b/.test(exch), '兑换函数里不许再写死 10，用 this.COINS_PER_EP');
assert.match(q, /Farm\.state\.COINS_PER_EP/, '队列退币要用 state.COINS_PER_EP');

// ③ 待激活分流要在「member_doc_unresolved」守卫之前
const push = gs.slice(gs.indexOf('async push() {'), gs.indexOf('_buildGameSave() {'));
const iPend = push.indexOf('memberDoc._pending) return this._pushPendingSave()');
const iGuard = push.indexOf("reason: 'member_doc_unresolved'");
assert.ok(iPend > 0 && iGuard > 0 && iPend < iGuard, '待激活分流必须在 member_doc_unresolved 守卫之前，否则永远到不了');

// ④ 待激活存档只进 farm_saves，不碰 members / farm_players
const pendPush = gs.slice(gs.indexOf('async _pushPendingSave() {'), gs.indexOf('async _readPendingSave() {'));
assert.match(pendPush, /collection\('farm_saves'\)/, '_pushPendingSave 要写 farm_saves');
assert.ok(!/collection\('members'\)|collection\('farm_players'\)/.test(pendPush), '_pushPendingSave 不许碰 members / farm_players');

// ⑤ 恢复也从 farm_saves 读（待激活 + 刚激活兜底两处）
const restore = gs.slice(gs.indexOf('async restoreFromCloud() {'), gs.indexOf('_offerSaveChoice(cloudState, save, m) {'));
assert.equal((restore.match(/_readPendingSave\(\)/g) || []).length, 2, 'restoreFromCloud 要在待激活与刚激活兜底两处读 farm_saves');

// ⑥ spendEastPoints：待激活门 + 服务端拒绝退回
const spend = st.slice(st.indexOf('spendEastPoints(n, opts) {'), st.indexOf('exchangeCoinsToEp('));
assert.match(spend, /memberDoc\._pending\)/, 'spendEastPoints 缺待激活门');
assert.match(spend, /r\.code === 409 \|\| r\.code === 422/, 'spendEastPoints 被拒后没退回');

console.log('ok pending-points-source');
