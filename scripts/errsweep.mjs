#!/usr/bin/env node
/**
 * errsweep.mjs — dev-only runtime error sweep.
 * Drives the game over CDP, captures console.error/warn + uncaught exceptions
 * while exercising core flows, and prints whatever surfaced. No deps.
 */
const PORT = process.env.CDP_PORT || '9222';
const URL = process.argv[2] || 'http://localhost:8123/src/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const errors = [];
const warns = [];

(async () => {
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    // events
    if (m.method === 'Runtime.consoleAPICalled') {
      const { type, args } = m.params;
      const text = args.map(a => a.value ?? a.description ?? a.unserializableValue ?? (a.preview ? JSON.stringify(a.preview.properties) : '')).join(' ');
      if (type === 'error') errors.push('[console.error] ' + text);
      else if (type === 'warning') warns.push('[console.warn] ' + text);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('[exception] ' + (d.exception?.description || d.text) + (d.url ? ' @ ' + d.url + ':' + d.lineNumber : ''));
    }
  });
  const call = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, m => res(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expression, awaitPromise = false) => call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }).then(r => r && r.result && r.result.value);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable').catch(() => {});
  await call('Page.navigate', { url: URL });
  await sleep(2000);
  // clear SW so we exercise current source
  await ev(`(async()=>{try{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)));const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()));}catch(e){}})()`, true);
  await call('Page.reload', { ignoreCache: true });
  await sleep(4000);

  const step = async (label, expr) => {
    const before = errors.length;
    const r = await ev(`(function(){try{${expr}; return 'ok';}catch(e){return 'THREW: '+e.message;}})()`);
    await sleep(700);
    // 步骤本身抛异常也算错（2026-08-15：_buildFrame 的 ReferenceError 曾只显示在
    // 这一行的「THREW」里，汇总仍是 errors: 0，被当成通过并部署了）
    if (typeof r === 'string' && r.indexOf('THREW') === 0) errors.push('[step ' + label + '] ' + r);
    const newErrs = errors.length - before;
    console.log(`• ${label}: ${r}${newErrs ? '  (+' + newErrs + ' console errors)' : ''}`);
  };

  // ---- exercise core flows ----
  await step('dismiss splash', `var b=document.getElementById('splashStart'); if(b)b.click();`);
  await step('plant seed in plot 0', `Farm.shop.openSeedPickerForPlot(0); Farm.ui.hideModal(); Farm.crops.plant(Farm.state.data.plots[0],'shanghai_miao');`);
  await step('force-mature + harvest plot 0', `var p=Farm.state.data.plots[0]; p.plantedAt=Date.now()-99*60000; Farm.farm.harvestPlot(0);`);
  await step('add to warehouse + open', `for(var i=0;i<5;i++)Farm.state.addToWarehouse('shanghai_miao'); Farm.warehouse.open();`);
  await step('sell warehouse', `Farm.warehouse.sellAll ? Farm.warehouse.sellAll() : (Farm.warehouse._sell && Farm.warehouse._sell());`);
  await step('open shop', `Farm.shop.open();`);
  await step('open tasks', `Farm.tasks.open();`);
  await step('open today', `Farm.daily.open();`);
  await step('open rewards', `Farm.rewards.open();`);
  await step('open orders', `Farm.orders.open();`);
  await step('open ep-shop', `Farm.epShop.open();`);
  await step('open collection (guide)', `Farm.guide && Farm.guide.openCollection ? Farm.guide.openCollection() : (Farm.collection && Farm.collection.open && Farm.collection.open());`);
  await step('iso build mode toggle', `Farm.isoView && Farm.isoView.toggleBuild && Farm.isoView.toggleBuild();`);
  await step('iso place building (well)', `Farm.isoView && Farm.isoView._addBuilding && Farm.isoView._addBuilding('well');`);
  await step('iso relang to en', `Farm.i18n.setLanguage('en'); Farm.isoView && Farm.isoView.relang && Farm.isoView.relang();`);
  await step('tick', `Farm.farm.tick();`);
  await step('refreshHUD', `Farm.ui.refreshHUD();`);
  await step('save', `Farm.state.save();`);

  await sleep(800);
  console.log('\n===== SUMMARY =====');
  console.log('errors:', errors.length, ' warnings:', warns.length);
  if (errors.length) console.log('\n--- ERRORS ---\n' + errors.join('\n'));
  if (warns.length) console.log('\n--- WARNINGS (first 20) ---\n' + warns.slice(0, 20).join('\n'));

  await call('Target.closeTarget', { targetId: tab.id }).catch(() => {});
  ws.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('sweep failed:', e.message); process.exit(1); });
