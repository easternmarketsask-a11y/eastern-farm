/**
 * 弹窗操作手感契约。长辈在手机上：叉关得掉、点空白不冲登录、输入不整页放大。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ui = readFileSync(join(root, 'src/js/ui.js'), 'utf8');
const css = readFileSync(join(root, 'src/css/style.css'), 'utf8');
const auth = readFileSync(join(root, 'src/js/firebase-auth.js'), 'utf8');
const main = readFileSync(join(root, 'src/js/main.js'), 'utf8');

assert.match(ui, /class="modal-body"/, '正文必须包进 .modal-body，✕ 才能钉在外壳');
assert.match(ui, /_closeOnBackdrop = opts\.closeOnBackdrop !== false/, 'showModal 认 closeOnBackdrop');
assert.match(ui, /visualViewport/, '键盘顶起走 visualViewport --kb');
assert.match(ui, /scrollIntoView/, '焦点输入滚进视口');

assert.match(css, /\.modal-body\s*\{/, '.modal-body 滚动');
assert.match(css, /\.modal\.closing\s*\{[^}]*pointer-events:\s*none/, '关窗动画期间不吞点击');
assert.match(css, /overflow:\s*hidden/, '外壳不滚');
assert.match(css, /\.fbk-text\s*\{[\s\S]*?font-size:\s*16px/, '反馈框 ≥16px（防 iOS 整页放大）');
assert.match(css, /\.settings-input\s*\{[\s\S]*?font-size:\s*16px/, '设置昵称框 ≥16px');
assert.match(css, /\.exchange-input-group input\s*\{[\s\S]*?font-size:\s*16px/, '兑换数字框 ≥16px');

assert.match(auth, /closeOnBackdrop:\s*false/, '登录弹窗误点空白不关');
assert.doesNotMatch(main, /confirm\(Farm\.i18n\.t\('settings_reset_confirm'\)\)/, '重置不用系统 confirm');
assert.match(main, /id="resetKeep"/, '重置先问「再想想」');

console.log('ok modal-ux');
