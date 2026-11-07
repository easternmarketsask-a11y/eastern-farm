// Browser regressions for the real table page. No backend writes or dependencies.
// node scripts/verify/table-premium-test.mjs [http://127.0.0.1:8037]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

let origin = process.argv[2];
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
let server;
if (!origin) {
  server = createServer((request, response) => {
    try {
      const route = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const path = resolve(root, '.' + (route.endsWith('/') ? route + 'index.html' : route));
      if (!path.startsWith(root + '\\') && !path.startsWith(root + '/')) { response.writeHead(403).end(); return; }
      const suffix = path.slice(path.lastIndexOf('.'));
      response.writeHead(200, { 'Content-Type': mime[suffix] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(readFileSync(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
}
const port = 9850 + process.pid % 500;
const profile = mkdtempSync(join(tmpdir(), 'table-premium-'));
const meal = JSON.parse(readFileSync(new URL('../../data/table-set.json', import.meta.url)));
const shotDir = resolve('.impeccable/review/table');
const pause = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(process.env.EF_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
let ws, sequence = 0;
const pending = new Map(), exceptions = [], checks = [], sessions = [], heldFonts = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
async function evaluate(session, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function wait(session, expression, ms = 6500) {
  const end = Date.now() + ms;
  do { if (await evaluate(session, expression)) return; await pause(50); } while (Date.now() < end);
  throw new Error('Timed out: ' + expression);
}
async function open({ width = 390, height = 844, mode = 'live', reduce = false, holdFont = false } = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true });
  sessions.push(session);
  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  if (holdFont) {
    heldFonts.set(session, 0);
    await send('Network.enable', {}, session);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, session);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*fonts.googleapis.com*', requestStage: 'Request' }] }, session);
  }
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, session);
  await send('Emulation.setTouchEmulationEnabled', { enabled: width < 600 }, session);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] }, session);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__tableRequests = []; window.__tableMode = ${JSON.stringify(mode)};
    const realFetch = window.fetch;
    window.fetch = function(u, options) {
      const url = String(u);
      if (url.includes('game-track')) return Promise.resolve(new Response('{"ok":true}'));
      if (url.includes('tonight-table') || url.includes('table-set.json')) {
        window.__tableRequests.push(url);
        const live = url.includes('tonight-table');
        if (window.__tableMode === 'timeout' && live) return new Promise(() => {});
        if (window.__tableMode === 'error' || (window.__tableMode === 'fallback' && live)) return Promise.reject(new Error('offline test'));
        return Promise.resolve(new Response(${JSON.stringify(JSON.stringify(meal))}, {status:200}));
      }
      return realFetch.apply(this, arguments);
    };
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new Error('share unavailable')) });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {writeText: () => Promise.reject(new Error('clipboard blocked'))} });
  ` }, session);
  await send('Page.navigate', { url: origin + '/src/dinner.html' }, session);
  await wait(session, holdFont ? "document.readyState !== 'loading'" : "document.readyState === 'complete'");
  return session;
}
async function click(session, selector) {
  await evaluate(session, `document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function placeRound(session, keyboard = false, touch = false) {
  for (let i = 0; i < 5; i++) {
    await wait(session, "document.querySelector('#placeCurrent') && !document.querySelector('#placeCurrent').disabled");
    if (keyboard) {
      await evaluate(session, "document.querySelector('#pass .plate').focus()");
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' }, session);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
    } else if (touch) {
      const p = await evaluate(session, "(() => {const r=document.querySelector('#placeCurrent').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      await send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[p] }, session);
      await send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] }, session);
    } else await click(session, '#placeCurrent');
    await wait(session, `document.querySelectorAll('.seat.has-plate').length === ${i + 1}`);
    await pause(440);
  }
  await wait(session, "document.querySelector('#world').classList.contains('is-ready')");
  assert.equal(await evaluate(session, "document.querySelectorAll('#menu li').length"), 5, 'completed meal exposes five recipe names');
  assert.equal(await evaluate(session, "document.querySelector('.seat.soup .plate').dataset.role"), 'soup', 'soup stays in its centre bowl');
}
async function shot(session, name) {
  await evaluate(session, 'window.scrollTo(0, 0)');
  const { contentSize } = await send('Page.getLayoutMetrics', {}, session);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: 1 } }, session);
  mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, name + '.png'), Buffer.from(r.data, 'base64'));
}
try {
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await pause(150); }
  }
  assert.ok(version, 'Chrome starts');
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    if (m.method === 'Fetch.requestPaused' && heldFonts.has(m.sessionId)) heldFonts.set(m.sessionId, heldFonts.get(m.sessionId) + 1);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });

  const fontBlocked = await open({ holdFont: true, mode: 'fallback' });
  await wait(fontBlocked, "document.querySelector('#pass .plate') && !document.querySelector('#placeCurrent').disabled", 2500);
  assert.ok(heldFonts.get(fontBlocked) > 0, 'the external font CSS remains paused during the boot assertion');
  assert.equal(await evaluate(fontBlocked, "document.querySelectorAll('.seat.has-plate').length"), 0, 'the table boots with system fonts without committing a dish');
  await click(fontBlocked, '#placeCurrent');
  await wait(fontBlocked, "document.querySelectorAll('.seat.has-plate').length === 1");
  checks.push('held Google Fonts CSS cannot block fallback menu or placement');

  const tap = await open();
  await wait(tap, "document.querySelector('#pass .plate')");
  assert.equal(await evaluate(tap, "!!document.querySelector('#placeCurrent')"), true, 'a visible tap action must place the current dish');
  await shot(tap, 'mobile-390-start');
  await click(tap, '#placeCurrent'); await click(tap, '#placeCurrent');
  await pause(500);
  assert.equal(await evaluate(tap, "document.querySelectorAll('.seat.has-plate').length"), 1, 'rapid repeated action cannot place the next dish');
  for (let i = 0; i < 4; i++) { await click(tap, '#placeCurrent'); await pause(460); }
  await wait(tap, "document.querySelector('#world').classList.contains('is-ready')");
  await shot(tap, 'mobile-390-complete');
  const requests = await evaluate(tap, 'window.__tableRequests.length');
  await click(tap, '#send');
  await wait(tap, "!document.querySelector('#shareFallback').hidden");
  assert.match(await evaluate(tap, "document.querySelector('#shareText').value"), /清蒸红蟹/, 'share and clipboard failure leaves selectable menu text');
  await click(tap, '#restart');
  assert.equal(await evaluate(tap, 'window.__tableRequests.length'), requests, 'restart reuses loaded menu');
  assert.equal(await evaluate(tap, "document.querySelectorAll('.seat.has-plate').length"), 0, 'restart clears exactly this round');
  checks.push('tap, double click guard, completion, share failure, cached restart');

  await placeRound(tap, true);
  await evaluate(tap, "document.querySelector('#surface').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, tap);
  assert.notEqual(await evaluate(tap, "document.querySelector('#surface').style.getPropertyValue('--table-angle')"), '0deg', 'keyboard rotates completed table');
  checks.push('full keyboard round and rotation');
  await evaluate(tap, "Object.defineProperty(navigator,'share',{configurable:true,value:()=>Promise.reject(new DOMException('cancelled','AbortError'))});document.querySelector('#shareFallback').hidden=true");
  await click(tap, '#send');
  await wait(tap, "document.querySelector('#note').textContent.includes('Sharing cancelled')");
  assert.ok(await evaluate(tap, "document.querySelector('#shareFallback').hidden"), 'share cancellation does not offer a spurious failure fallback');
  await evaluate(tap, "Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})");
  await click(tap, '#send'); await wait(tap, "!document.querySelector('#shareFallback').hidden");
  checks.push('share cancellation and unsupported clipboard');

  const drag = await open({ width: 1440, height: 1000 });
  await wait(drag, "document.querySelector('#pass .plate')");
  const coords = await evaluate(drag, `(() => { const p = document.querySelector('#pass .disc').getBoundingClientRect(), s = document.querySelector('[data-seat="0"]').getBoundingClientRect(); return {x:p.x+p.width/2,y:p.y+p.height/2,tx:s.x+s.width/2,ty:s.y+s.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 }, drag);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.tx, y: coords.ty, button: 'left', buttons: 1 }, drag);
  await evaluate(drag, "document.dispatchEvent(new PointerEvent('pointercancel', {pointerId:1,bubbles:true}))");
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.tx, y: coords.ty, button: 'left', clickCount: 1 }, drag);
  await pause(460);
  assert.equal(await evaluate(drag, "document.querySelectorAll('.seat.has-plate').length"), 0, 'cancelled drag cannot commit even above a valid seat');
  assert.equal(await evaluate(drag, "document.querySelectorAll('.is-lifted').length"), 0, 'cancelled drag removes lifted state');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 }, drag);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.tx, y: coords.ty, button: 'left', buttons: 1 }, drag);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.tx, y: coords.ty, button: 'left', clickCount: 1 }, drag);
  await pause(460);
  assert.equal(await evaluate(drag, "document.querySelectorAll('.seat.has-plate').length"), 1, 'drag still places after cancellation');
  await shot(drag, 'desktop-1440-playing');
  for (let index = 1; index < 5; index++) {
    const p = await evaluate(drag, `(() => {const a=document.querySelector('#pass .disc').getBoundingClientRect(), b=document.querySelector('[data-seat="${index}"]').getBoundingClientRect();return {x:a.x+a.width/2,y:a.y+a.height/2,tx:b.x+b.width/2,ty:b.y+b.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type:'mousePressed', x:p.x, y:p.y, button:'left', clickCount:1 }, drag);
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:p.tx, y:p.ty, button:'left', buttons:1 }, drag);
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:p.tx, y:p.ty, button:'left', clickCount:1 }, drag);
    await pause(450);
    assert.equal(await evaluate(drag, "document.querySelectorAll('.seat.has-plate').length"), index + 1, 'full drag round keeps slot and count constraints');
  }
  await wait(drag, "document.querySelector('#world').classList.contains('is-ready')");
  await pause(900);
  await shot(drag, 'desktop-1440-complete');
  const turn = await evaluate(drag, "(() => {const r=document.querySelector('#surface').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2+40};})()");
  await send('Input.dispatchMouseEvent', { type:'mousePressed', x:turn.x, y:turn.y, button:'left', clickCount:1 }, drag);
  await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:turn.x+80, y:turn.y, button:'left', buttons:1 }, drag);
  await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:turn.x+80, y:turn.y, button:'left', clickCount:1 }, drag);
  assert.ok(await evaluate(drag, "document.querySelector('#surface').classList.contains('is-spinning')"), 'completed table retains flick inertia');
  await evaluate(drag, "window.dispatchEvent(new Event('blur'))");
  assert.ok(await evaluate(drag, "!document.querySelector('#surface').classList.contains('is-spinning')"), 'losing focus stops inertia');
  checks.push('cancelled/resumed drag, full drag round, flick inertia and blur cleanup');

  for (const width of [360, 768]) {
    const s = await open({ width, height: width === 360 ? 740 : 1024, mode: 'fallback', reduce: true });
    await wait(s, "document.querySelector('#pass .plate')");
    assert.ok(await evaluate(s, "document.documentElement.scrollWidth <= innerWidth"), `no horizontal overflow at ${width}px`);
    const fit = await evaluate(s, "({bottom:document.querySelector('#placeCurrent').getBoundingClientRect().bottom,height:innerHeight,table:document.querySelector('#table').getBoundingClientRect().width,heading:document.querySelector('.introduction').getBoundingClientRect().height})");
    assert.ok(fit.bottom <= fit.height, `first-screen primary action at ${width}px: ${JSON.stringify(fit)}`);
    assert.ok(await evaluate(s, "!document.querySelector('#retry').hidden"), 'fallback menu offers live retry');
    await evaluate(s, "document.querySelector('#pass img').dispatchEvent(new Event('error'))");
    assert.ok(await evaluate(s, "document.querySelector('#pass .image-fallback').textContent.includes('清蒸红蟹')"), 'failed image retains dish name');
    await shot(s, `mobile-${width}-fallback`);
    await placeRound(s, false, width === 360);
    assert.equal(await evaluate(s, "document.querySelector('.is-spinning')"), null, 'reduced motion never starts inertia');
  }
  checks.push('360/768 layout, fallback/retry, missing image, reduced motion full round');

  const unavailable = await open({ mode: 'error' });
  await wait(unavailable, "document.querySelector('#retry') && !document.querySelector('#retry').hidden");
  assert.equal(await evaluate(unavailable, "document.querySelector('#placeCurrent').disabled"), true, 'missing data disables placement');
  await evaluate(unavailable, "window.__tableMode = 'live'"); await click(unavailable, '#retry');
  await wait(unavailable, "document.querySelector('#pass .plate')");
  const timeout = await open({ mode: 'timeout' });
  await wait(timeout, "document.querySelector('#pass .plate')", 6500);
  assert.ok(await evaluate(timeout, "!document.querySelector('#retry').hidden"), 'hung live fetch times out into usable retryable fallback');
  checks.push('complete failure recovery and timeout fallback');
  assert.deepEqual(exceptions, [], 'normal and failure paths have no uncaught exceptions');
  console.log(JSON.stringify({ ok: true, checks, screenshots: shotDir }, null, 2));
} catch (error) {
  const debug = [];
  for (const session of sessions) {
    try { debug.push(await evaluate(session, "({active: document.activeElement.tagName + '.' + document.activeElement.className, plate:document.querySelector('#pass .plate')?.getAttribute('aria-label'), placed:document.querySelectorAll('.seat.has-plate').length})")); } catch {}
  }
  console.error(JSON.stringify({ ok: false, checks, error: error.stack, exceptions, debug }, null, 2)); process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {} chrome.kill();
  server?.close();
  // profile is a verified task-specific child of the OS temp directory.
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
