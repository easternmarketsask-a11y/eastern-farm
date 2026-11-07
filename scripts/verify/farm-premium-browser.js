// Run through cdp.mjs/audit-cdp.mjs in a fresh, isolated browser. Tracking is
// blocked before navigation by the driver. Only this disposable local save is
// changed; advancing plantedAt avoids waiting minutes for crop growth.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const failures = [], checks = [], details = {};
  const check = (name, ok) => { checks.push(name); if (!ok) failures.push(name); };
  const until = async (fn, ms = 25000) => {
    const end = Date.now() + ms;
    while (!fn() && Date.now() < end) await sleep(100);
    return !!fn();
  };
  check('tracking blocked before game boot', window.__efTrackingBlocked === true);
  await until(() => window.Farm && Farm.shop && window.__splashReady, 15000);
  document.getElementById('splashStart')?.click();
  await until(() => Farm.isoView?._on, 10000);
  await sleep(600);
  document.getElementById('tutorialStartBtn')?.click();
  await sleep(600);
  if (Farm.spotlight?._active) Farm.spotlight.skip();
  Farm.ui.hideModal(); await sleep(220);
  check('entered through real farm splash', Farm.isoView._on === true);
  check('shared return navigation', document.querySelector('.game-home-link')?.getAttribute('href') === '/');

  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const controls = [...document.querySelectorAll('#topbar button, #bottombar button, #isoZoom button, #isoLeftUI button, #isoBuildBtn, #isoCommunityBtn, .game-home-link')].filter(visible);
  details.controls = controls.map(b => ({ id: b.id || b.dataset.action || 'home', w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }));
  check('all common targets >=44px', details.controls.every(b => b.w >= 44 && b.h >= 44));
  check('no page overflow', document.documentElement.scrollWidth <= innerWidth);

  // Keyboard focus is protected while a panel is open, including menu->panel.
  const opener = document.getElementById('hamburgerButton');
  opener.focus(); opener.click();
  const content = document.getElementById('modalContent');
  check('menu dialog labelled', content.getAttribute('role') === 'dialog' && !!content.getAttribute('aria-labelledby'));
  const close = content.querySelector('.modal-close-x');
  check('initial panel focus', document.activeElement === close);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  check('back-tab stays in panel', document.activeElement.dataset.nav === 'settings');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  check('tab wraps to close', document.activeElement === close);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(220);
  check('escape restores opener', document.activeElement === opener);

  // Menu surfaces must remain reachable, including the help route.
  for (const action of ['shop', 'tasks', 'warehouse']) {
    document.querySelector('#bottombar [data-action="' + action + '"]').click();
    check(action + ' opens a panel', !document.getElementById('modal').classList.contains('hidden'));
    Farm.ui.hideModal(); await sleep(200);
  }
  opener.click(); content.querySelector('[data-nav="guide"]').click();
  check('help remains available', !!content.querySelector('.modal-body'));
  Farm.ui.hideModal(); await sleep(220);

  const data = Farm.state.data;
  Farm.harvestStatus.render();
  const action = document.getElementById('harvestStatusCenter');
  check('empty farm has plant action', action.tagName === 'BUTTON' && !action.disabled);
  action.click();
  const seed = document.querySelector('.seed-card-select');
  check('single seed action is native keyboard button', seed?.tagName === 'BUTTON' && !!seed.getAttribute('aria-label'));
  const chosen = seed?.closest('.seed-card').dataset.cropId;
  details.crop = chosen;
  const seedBefore = data.seeds[chosen];
  seed?.click();
  const planted = await until(() => data.plots.some(p => p.crop === chosen));
  check('farmer finished planting', planted);
  if (!planted) return { failures, checks, details };
  const plotIdx = data.plots.findIndex(p => p.crop === chosen), plot = data.plots[plotIdx];
  check('one seed used by existing game flow', data.seeds[chosen] === seedBefore - 1);
  plot.plantedAt = Date.now() - 120 * 60000;
  Farm.state.save(); Farm.harvestStatus.render(); Farm.isoView.render();
  check('mature harvest action visible', Farm.crops.isMature(plot) && !action.disabled);
  action.click(); Farm.harvestStatus.render();
  check('running harvest feedback', action.disabled && action.getAttribute('aria-busy') === 'true');
  const harvested = await until(() => Farm.state.warehouseCount(chosen) > 0);
  check('farmer harvested into barn', harvested);
  await until(() => !Farm.farmer.doingFarmWork(), 10000);
  Farm.ui.hideModal(); await sleep(220); Farm.harvestStatus.render();
  check('next action offers delivery', /交货|Deliver/.test(document.getElementById('harvestStatusText').textContent));
  action.click();
  const delivery = document.querySelector('.staple-fill[data-staple="' + chosen + '"]');
  check('harvest can fill an existing order', !!delivery);
  const beforeCoins = data.coins, beforeDeliveries = data.totalDeliveries || 0;
  delivery?.click();
  check('delivery runs existing payment and counter', data.coins > beforeCoins && data.totalDeliveries === beforeDeliveries + 1);
  Farm.ui.hideModal(); await sleep(220);

  // Pointerdown + cancellation must never open a plot panel or move a saved object.
  const rc = Farm.isoView.plotScreenRect(plotIdx), cv = document.getElementById('isoCanvas');
  const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
  check('real scene hit target is canvas', document.elementFromPoint(cx, cy) === cv);
  cv.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 17, clientX: cx, clientY: cy, bubbles: true }));
  cv.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 17, clientX: cx, clientY: cy, bubbles: true }));
  check('cancelled tap does not activate plot', document.getElementById('modal').classList.contains('hidden') && !Farm.isoView._pressCell);
  const zoomBefore = Farm.isoView._zoom;
  document.querySelector('#isoZoom button').click();
  check('zoom button works', Farm.isoView._zoom > zoomBefore);
  document.querySelectorAll('#isoZoom button')[1].click();
  document.getElementById('isoBuildBtn').click();
  check('build palette opens', Farm.isoView._build && getComputedStyle(document.getElementById('isoPalette')).display !== 'none');
  document.getElementById('isoBuildBtn').click();
  check('build mode returns safely', !Farm.isoView._build);
  Farm.setLanguage('en');
  check('English HUD and map tools', document.documentElement.lang === 'en' && document.getElementById('isoLangBtn').textContent === 'EN');
  Farm.setLanguage('zh');
  Farm.state.save();
  const saved = JSON.parse(localStorage.getItem('eastern_farm_save_v1'));
  check('save retains delivered progress', saved.totalDeliveries === data.totalDeliveries && saved.coins === data.coins);
  check('save has no presentation-owned schema', !('premiumHud' in saved));
  // The inherited install reminder must clear the new dock and scene-tool
  // band. Use its actual markup/styles even if Chrome did not offer install.
  const banner = document.getElementById('pwaInstallBanner') || document.createElement('div');
  if (!banner.isConnected) {
    banner.id = 'pwaInstallBanner'; banner.className = 'pwa-install-banner';
    banner.innerHTML = '<span class="pwa-install-text">把东方农场加到主屏幕 · Add Eastern Farm to your home screen</span><button class="pwa-install-action">添加 Add</button><button class="pwa-install-close" aria-label="关闭 Close">✕</button>';
    document.body.appendChild(banner);
  }
  const br = banner.getBoundingClientRect();
  const overlap = r => br.left < r.right && br.right > r.left && br.top < r.bottom && br.bottom > r.top;
  const tools = [...document.querySelectorAll('#topbar,#harvestStatusCenter,#bottombar,#isoBuildBtn,#isoCommunityBtn,#isoDriveOutBtn,#storekeeper')].filter(visible);
  check('install reminder clears guidance, scene tools and dock', tools.every(t => !overlap(t.getBoundingClientRect())));
  check('install reminder controls >=44px', [...banner.querySelectorAll('button')].every(b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44));
  check('scene tools remain real hit targets beside reminder', tools.filter(t => t.tagName === 'BUTTON').every(t => { const r=t.getBoundingClientRect(); const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit===t||t.contains(hit); }));
  details.saved = { coins: saved.coins, totalDeliveries: saved.totalDeliveries, level: saved.level, plots: saved.plots.length };
  details.viewport = [innerWidth, innerHeight];
  details.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  Farm.isoView._autoFrame(); Farm.isoView.render();
  await sleep(5200);
  return { failures, checks, details };
})()
