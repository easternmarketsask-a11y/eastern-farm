#!/usr/bin/env node
/**
 * sw-update-test.mjs — 回归测试：部署后玩家刷新，能不能真的拿到新代码？
 *
 * 起因（2026-08-15 Chris：「刷新了页面宠物还是巨大」）：
 * GitHub Pages 对所有静态文件发 `Cache-Control: max-age=600`。SW 安装时用
 * `cache.add(url)` —— 它**走浏览器 HTTP 缓存**。于是新版 SW 会把「上一版的文件」
 * 装进「新版本号的缓存」，然后缓存优先地一直发下去。刷新救不了，因为陈旧的
 * 东西就在缓存里面。
 *
 * 这个测试用一台会发 max-age=600 的本地服务器把那个场景**真的复现**出来：
 *   1. 起服务器 → 打开页面 → SW 装好，标记是 v1
 *   2. 改文件成 v2 + bump CACHE_VERSION（模拟一次部署）
 *   3. 刷新 → 等自愈 → 断言页面跑的是 **v2**
 *
 * 用法: node scripts/verify/sw-update-test.mjs [--keep]
 * 退出码 0 = 刷新后拿到新代码；1 = 卡在旧代码（就是玩家遇到的那个 bug）。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8199 + (process.pid % 300);
const KEEP = process.argv.includes('--keep');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------- 1. 复制一份仓库到临时目录（测试会改文件，不碰真仓库） ----------
const root = mkdtempSync(join(tmpdir(), 'ef-swtest-'));
for (const p of ['src', 'data', 'service-worker.js', 'index.html', 'fix.html']) {
  if (existsSync(p)) cpSync(p, join(root, p), { recursive: true });
}
const MARKER_FILE = join(root, 'src/js/analytics.js');   // 在预缓存清单里的普通模块
const setMarker = (v) => {
  const base = readFileSync(MARKER_FILE, 'utf8').replace(/\n\/\* __SWTEST__ \*\/[\s\S]*$/, '');
  writeFileSync(MARKER_FILE, base + `\n/* __SWTEST__ */window.__SWTEST_MARKER='${v}';\n`);
};
const setSwVersion = (v) => {
  const p = join(root, 'service-worker.js');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${v}';`));
};
const setPageBuild = (v) => {
  const p = join(root, 'src/index.html');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/(<meta name="ef-build" content=")[^"]*(">)/, `$1${v}$2`));
};

setMarker('v1'); setSwVersion('swtest-v1'); setPageBuild('swtest-v1');

// ---------- 2. 静态服务器：像 GitHub Pages 一样发 max-age=600 ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split('?')[0]);
  let file = normalize(join(root, clean));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); } catch { }
  let body;
  try { body = readFileSync(file); } catch { res.writeHead(404).end('nope'); return; }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'max-age=600',      // ← 关键：复现 GitHub Pages 的行为
  });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
log(`▶ 测试服务器 http://127.0.0.1:${PORT}  (Cache-Control: max-age=600)`);

// ---------- 3. 起 headless Chrome ----------
const profile = mkdtempSync(join(tmpdir(), 'ef-swtest-prof-'));
const CDP_PORT = PORT + 1;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

let ws, msgId = 0; const pending = new Map();
const call = (method, params) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalIn = async (expr) => {
  try {
    const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  } catch { return undefined; }       // 页面正在自愈刷新时会短暂失联，属预期
};

async function cleanup(code) {
  try { ws && ws.close(); } catch { }
  try { chrome.kill(); } catch { }
  try { server.close(); } catch { }
  if (!KEEP) { try { rmSync(root, { recursive: true, force: true }); } catch { } try { rmSync(profile, { recursive: true, force: true }); } catch { } }
  process.exit(code);
}

for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch { await sleep(200); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});
await call('Page.enable'); await call('Runtime.enable');

// ---------- 4. 第一次访问：SW 装好，页面跑 v1 ----------
await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/src/index.html` });
let ready = false;
for (let i = 0; i < 80; i++) {
  await sleep(500);
  const st = await evalIn(`(async()=>{const r=await navigator.serviceWorker.getRegistration();
    const ks=await caches.keys(); return JSON.stringify({act:!!(r&&r.active),ctl:!!navigator.serviceWorker.controller,ks:ks.length,mk:window.__SWTEST_MARKER||''});})()`);
  if (st) { const o = JSON.parse(st); if (o.act && o.ctl && o.ks > 0 && o.mk === 'v1') { ready = true; break; } }
}
if (!ready) { log('✗ 第一次访问就没能装好 SW / 跑起 v1 —— 测试环境有问题，不是被测代码的锅'); await cleanup(1); }
log('  ✓ 首访：SW 已接管，页面跑 v1');

// ---------- 5. 模拟一次部署：文件改成 v2 + bump 版本号 ----------
setMarker('v2'); setSwVersion('swtest-v2'); setPageBuild('swtest-v2');
log('▶ 模拟部署：marker v1→v2，CACHE_VERSION swtest-v1→swtest-v2');

// ---------- 6. 玩家刷新，等自愈 ----------
await call('Page.reload', {}).catch(() => { });
let got = '', swSeen = '';
for (let i = 0; i < 60; i++) {          // 最多等 ~45 秒
  await sleep(750);
  const st = await evalIn(`(async()=>{const ks=await caches.keys();
    return JSON.stringify({mk:window.__SWTEST_MARKER||'',ks:ks.join(','),build:(document.querySelector('meta[name="ef-build"]')||{}).content||''});})()`);
  if (st) { const o = JSON.parse(st); got = o.mk; swSeen = o.ks; if (o.mk === 'v2') break; }
}
log(`  刷新后：marker=${got || '(空)'}  caches=[${swSeen}]`);

if (got === 'v2') { log('✅ 通过：部署后刷新拿到了新代码'); await cleanup(0); }
log('✗ 失败：刷新后页面仍在跑旧代码（marker=' + (got || '空') + '）——这正是玩家遇到的 bug');
await cleanup(1);
