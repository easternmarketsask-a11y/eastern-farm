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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 15000);
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

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
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
