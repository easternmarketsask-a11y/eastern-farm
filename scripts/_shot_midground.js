(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !(window.Farm && Farm.isoView && Farm.crops); i++) await sleep(100);
  if (window.__splashDismiss) window.__splashDismiss();
  await sleep(200);
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const d = Farm.state.data;
  d.tutorialV1Done = true;
  d.spotlightDone = true;
  d.lifeStory = { seen: { ch1: 1, ch2: 1, ch3: 1, ch4: 1, ch5: 1, ch6: 1 }, claimed: {} };
  d.coins = 120;
  d.level = 1;
  d.landLevel = 0;
  d.landOrigin = 'front';
  const now = Date.now();
  const ids = ['xiao_cong', 'da_bai_cai', 'tomato', 'eggplant'];
  d.plots = (d.plots || []).map((p, i) => {
    const id = ids[i];
    const def = id && Farm.crops.get(id);
    const grow = (def && def.grow_minutes) || 30;
    return Object.assign({}, p, {
      unlocked: i < 4,
      crop: i < 4 ? id : null,
      plantedAt: i < 4 ? now - grow * 60000 : 0,
      harvestsLeft: 0,
      watered: true,
    });
  });
  Farm.state.save();
  if (Farm.isoView._buildLayout) Farm.isoView._buildLayout();
  Farm.isoView._bgKey = null;
  if (Farm.isoView._autoFrame) Farm.isoView._autoFrame();
  if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
  if (Farm.isoView.render) Farm.isoView.render();
  await sleep(700);
  document.querySelectorAll('button').forEach((el) => {
    if ((el.textContent || '').indexOf('稍后') >= 0) el.click();
  });
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const toast = document.getElementById('toast');
  if (toast) { toast.classList.add('hidden'); toast.innerHTML = ''; }
  await sleep(900);
})();
