/**
 * 反馈自动回信契约：Bella 那种仓满卡关能匹配上，提交窗会展信，
 * 登录后会拉未读来信。文案不含「啦/吧/哦」。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const js = readFileSync(join(root, 'src/js/feedback.js'), 'utf8');
const main = readFileSync(join(root, 'src/js/main.js'), 'utf8');
const auth = readFileSync(join(root, 'src/js/firebase-auth.js'), 'utf8');
const html = readFileSync(join(root, 'src/index.html'), 'utf8');
const sw = readFileSync(join(root, 'service-worker.js'), 'utf8');
const smoke = readFileSync(join(root, 'scripts/verify/smoke-flows.js'), 'utf8');
const py = readFileSync(join(root, '../stockwise_final/farm_feedback_replies.py'), 'utf8');

assert.match(html, /js\/feedback\.js/, 'index 加载 feedback.js');
assert.match(sw, /\/src\/js\/feedback\.js/, 'SW 预缓存 feedback.js');
assert.match(main, /Farm\.feedback\.maybeShowMail/, '开机拉未读来信');
assert.match(auth, /Farm\.feedback\.maybeShowMail/, '登录后拉未读来信');
assert.match(smoke, /feedback/, '冒烟走意见反馈入口');
assert.match(js, /gameStats:\s*\{\s*farmMail/, '已读写在 members.gameStats.farmMail');
assert.match(js, /showReply/, '提交后展信');
assert.match(js, /去看订单/, '仓满来信有去看订单');
assert.match(js, /warehouseFull/, '提交带上当时仓满信号');
assert.doesNotMatch(js, /LETTERS[\s\S]{0,800}啦/, '回信不用「啦」');
assert.doesNotMatch(js, /LETTERS[\s\S]{0,1200}吧/, '回信不用「吧」');

const farm = {};
const ctx = {
  window: { Farm: farm },
  Farm: farm,
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] || null; },
    setItem(k, v) { this._d[k] = String(v); },
  },
  document: { querySelector() { return null; } },
  console,
  setTimeout,
  Date,
  Set,
  JSON,
  Math,
  String,
  Array,
  Object,
  parseInt,
  Number,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) }),
};
ctx.window.Farm = farm;
vm.runInNewContext(js, ctx);
assert.equal(typeof farm.feedback.matchTopic, 'function', 'matchTopic 导出');
assert.equal(
  farm.feedback.matchTopic('现在我的仓库满了 但是卖不了菜 订单也完成不了 因为地不让收（仓库满了）', false),
  'warehouse_full',
  'Bella 原文应判仓满'
);
assert.equal(farm.feedback.matchTopic('希望多种点水果', false), 'ack');
assert.equal(farm.feedback.matchTopic('交不了订单', true), 'warehouse_full');
assert.equal(farm.feedback.matchTopic('登录之后进度没了', true), 'ack');

assert.match(py, /告示牌/, '服务端仓满回信提到告示牌');
assert.match(py, /不扣钱/, '服务端提到放弃不扣钱');
assert.match(py, /def match_topic/, '服务端有匹配函数');

console.log('ok feedback-reply');
