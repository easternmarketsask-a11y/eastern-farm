// Minimal headless-Chrome CDP driver for verifying the game without npm deps.
// Node 24 has global WebSocket + fetch. Usage:
//   node scripts/verify/cdp.mjs <url> [evalFile.js] [waitMs]
// Prints JSON: { ok, consoleErrors, exceptions, evalResult }
// evalFile.js (optional) is an expression/IIFE evaluated in the page AFTER load;
// it may be async (awaitPromise is on). Return a JSON-serializable value.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// Per-process port avoids attaching to a stale Chrome from a prior run (flake).
const PORT = 9222 + (process.pid % 600);
const url = process.argv[2] || 'http://127.0.0.1:8000/src/';
const evalFile = process.argv[3] || '';
const waitMs = parseInt(process.argv[4] || '2500', 10);
const CDP_TIMEOUT = parseInt(process.env.EF_CDP_TIMEOUT || '15000', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

async function waitForChrome() {
  for (let i = 0; i < 50; i++) {
    try { return await getJSON('/json/version'); } catch { await sleep(150); }
  }
  throw new Error('Chrome devtools endpoint never came up');
}

// Promise-based CDP client over a single (flattened) browser websocket.
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      // 默认 15s 够所有部署闸门用。走真实登录/下单那种「点一下等一次云端」的
      // 长流程时用 EF_CDP_TIMEOUT 放宽 —— 别为此调高默认值，闸门跑得快才有人跑。
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, CDP_TIMEOUT);
    });
  }
  on(fn) { this.listeners.push(fn); }
}

let chromeProc, userDataDir;
const out = { ok: false, consoleErrors: [], exceptions: [], evalResult: null };

try {
  userDataDir = mkdtempSync(join(tmpdir(), 'cdp-'));
  chromeProc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    // 音频测试必须：合成的 pointerdown 不算「真实用户激活」，没有这个 flag
    // AudioContext 永远停在 suspended，测不到任何实际出声（2026-08-21）。
    '--autoplay-policy=no-user-gesture-required',
    '--disable-extensions', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const version = await waitForChrome();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      out.consoleErrors.push({ type: msg.params.type, text: (msg.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ') });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      out.exceptions.push(d.exception?.description || d.text || 'exception');
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      out.consoleErrors.push({ type: 'log', text: msg.params.entry.text });
    }
  });

  /* 给所有请求注入额外的头（EF_EXTRA_HEADERS，JSON 对象）。
     用途：测**后台管理页面**。后台靠 cookie 会话登录，而浏览器没法给顶层导航
     加请求头 —— 用这个就能拿 X-Admin-Token 进去，不必经手任何人的真实密码。
     ⚠️ 只在本地验证时用；这些头会跟着**每一个**请求发出去，别拿它打第三方站。 */
  if (process.env.EF_EXTRA_HEADERS) {
    const extra = JSON.parse(process.env.EF_EXTRA_HEADERS);
    const targetOrigin = new URL(url).origin;
    /* 🔒 **只给目标站点加头。**
       第一版用 Network.setExtraHTTPHeaders 给**所有**请求加，结果 Google 字体
       那种跨域请求被自定义头变成了预检请求、被对方拒掉 —— 一次跑出 53 条
       CORS 报错，全是工具自己造的假警报。一个会制造假报错的验证工具，
       下次会骗到写它的人。 */
    await cdp.send('Fetch.enable', {}, sessionId);
    cdp.on(async (msg) => {
      if (msg.method !== 'Fetch.requestPaused' || msg.sessionId !== sessionId) return;
      const { requestId, request } = msg.params;
      let same = false;
      try { same = new URL(request.url).origin === targetOrigin; } catch (_) {}
      const headers = Object.entries(
        same ? Object.assign({}, request.headers, extra) : request.headers,
      ).map(([name, value]) => ({ name, value: String(value) }));
      try {
        await cdp.send('Fetch.continueRequest', { requestId, headers }, sessionId);
      } catch (_) { /* 请求可能已被取消 */ }
    });
  }

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  /* 📱 手机视口（EF_MOBILE=1）。默认桌面 —— 但**客人 100% 在手机上**，
     而这个游戏是等距画布 + 底部 dock，窄屏下的布局跟桌面完全是两回事。
     桌面下看着好好的引导，在 390px 上可能整个在屏幕外。
     默认值＝iPhone 竖屏（390×844，DPR 3）。 */
  if (process.env.EF_MOBILE === '1') {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: parseInt(process.env.EF_W || '390', 10),
      height: parseInt(process.env.EF_H || '844', 10),
      deviceScaleFactor: 3,
      mobile: true,
    }, sessionId);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  }

  /* 🔒 验证跑动绝不许写进真实埋点计数器（2026-08-17 加）
     ------------------------------------------------------------------
     起因：拿这些脚本对**生产站**跑验证时，每跑一次就往 Chris 后台漏斗里加
     一次「来到 / 进入 / 访客」；而无头浏览器每次都是全新配置，按人去重那一列
     每跑一次还多算一台设备。当天 UTC 计数一度 3/2/4 全是测试流量。
     后台数字是 Chris 拿来做经营判断的 —— 往里灌假数据比不测更糟。

     必须用 addScriptToEvaluateOnNewDocument（**页面任何脚本之前**执行）：
     open_attempt 是在 <head> 内联段里发的，等到 Runtime.evaluate 那会儿
     早就发出去了，拦不住。
     假装成功返回 200，免得被测代码走进 .catch() 分支 —— 那会让验证测的是
     另一条路径。 */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function () {
      var orig = window.fetch;
      window.fetch = function (u) {
        try {
          if (String(u).indexOf('game-track') !== -1) {
            return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      window.__efTrackingBlocked = true;
    })();`,
  }, sessionId);

  await cdp.send('Page.navigate', { url }, sessionId);
  await sleep(waitMs); // let fetch()-based async init settle

  if (evalFile) {
    const expr = readFileSync(evalFile, 'utf8');
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    }, sessionId);
    if (r.exceptionDetails) {
      out.exceptions.push(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    } else {
      out.evalResult = r.result.value;
    }
  }

  out.ok = out.consoleErrors.length === 0 && out.exceptions.length === 0;
  ws.close();
} catch (e) {
  out.exceptions.push('HARNESS: ' + (e?.stack || e?.message || String(e)));
} finally {
  try { chromeProc?.kill(); } catch {}
  try { if (userDataDir) rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);
