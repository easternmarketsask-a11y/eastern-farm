#!/usr/bin/env node
/**
 * shot.mjs — headless screenshot helper for the farm game (dev-only tool).
 *
 * Drives an already-running Chrome (started with --remote-debugging-port=9222)
 * over the DevTools Protocol using Node's built-in global WebSocket (Node 22+).
 * No npm deps, in keeping with this project's no-build rule. Not shipped.
 *
 * Usage:
 *   node scripts/shot.mjs <url> <outPng> [waitMs] [evalJsFile] [width] [height]
 *
 * evalJsFile: optional path to a .js snippet run in the page BEFORE the wait
 *             (e.g. dismiss splash, seed localStorage). Runs in page context.
 */
import fs from 'node:fs';

const [url, outPng, waitMs = '3500', evalJsFile, width = '390', height = '844'] = process.argv.slice(2);
if (!url || !outPng) {
  console.error('usage: node scripts/shot.mjs <url> <outPng> [waitMs] [evalJsFile] [w] [h]');
  process.exit(2);
}
const PORT = process.env.CDP_PORT || '9222';

async function cdpList() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).catch(() => null)
    || await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).catch(() => null);
  if (!r) throw new Error('cannot reach Chrome CDP on port ' + PORT);
  return r.json();
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id === id) { ws.removeEventListener('message', onMsg); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const tab = await cdpList();
  const wsUrl = tab.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const call = (method, params) => rpc(ws, ++id, method, params);

  await call('Page.enable');
  await call('Runtime.enable');
  // Bypass the app's service worker so we always test the CURRENT source on
  // disk, not a stale pre-cached app shell (this game pre-caches all JS).
  await call('Network.enable').catch(() => {});
  await call('Network.setBypassServiceWorker', { bypass: true }).catch(() => {});
  await call('Emulation.setDeviceMetricsOverride', {
    width: +width, height: +height, deviceScaleFactor: 2, mobile: true,
  });
  await call('Page.navigate', { url });
  await sleep(+waitMs);

  if (evalJsFile && fs.existsSync(evalJsFile)) {
    const expr = fs.readFileSync(evalJsFile, 'utf8');
    await call('Runtime.evaluate', { expression: expr, awaitPromise: true }).catch(e => console.error('eval err:', e.message));
    await sleep(1200);
  }

  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(outPng, Buffer.from(data, 'base64'));

  // collect console errors for a health signal
  const { result } = await call('Runtime.evaluate', { expression: 'JSON.stringify((window.__farmErrors||[]).slice(0,20))', returnByValue: true }).catch(() => ({ result: {} }));
  if (result && result.value && result.value !== '[]') console.error('PAGE ERRORS:', result.value);

  await call('Target.closeTarget', { targetId: tab.id }).catch(() => {});
  ws.close();
  console.log('wrote', outPng);
  process.exit(0);
})().catch(e => { console.error('shot failed:', e.message); process.exit(1); });
