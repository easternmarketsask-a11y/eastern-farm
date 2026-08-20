(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && !(window.Farm && Farm.isoView && Farm.crops); i++) await sleep(100);
  if (window.__splashDismiss) window.__splashDismiss();
  await sleep(300);
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const d = Farm.state.data;
  d.tutorialV1Done = true; d.spotlightDone = true;
  d.farmerLook = 2;
  d.lifeStory = { seen: { ch1:1, ch2:1, ch3:1, ch4:1, ch5:1, ch6:1 }, claimed: {} };
  d.completedAchievements = (Farm.achievements && Farm.achievements.catalog || []).map((a) => a.id);
  d.coins = 400;
  d.level = 1; d.landLevel = 0; d.landOrigin = 'front';
  if (Farm.isoView._stampDefaultWorld) Farm.isoView._stampDefaultWorld();
  if (Farm.isoView._buildLayout) Farm.isoView._buildLayout();
  const now = Date.now();
  const ids = ['shanghai_miao','tomato','eggplant','jiucai'];
  d.plots = (d.plots || []).map((p, i) => {
    const cid = ids[i % ids.length];
    const def = Farm.crops.get(cid);
    const grow = (def && def.grow_minutes) || 30;
    if (i < 4) {
      return Object.assign({}, p, {
        unlocked: true, crop: cid,
        plantedAt: now - grow * 60000 - 120000,
        harvestsLeft: 0, watered: true
      });
    }
    return p;
  });
  Farm.state.save();
  Farm.isoView._pcs = null; Farm.isoView._pcsN = -1;
  Farm.isoView._bgKey = null;
  if (Farm.isoView._autoFrame) Farm.isoView._autoFrame();
  if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
  if (Farm.isoView.render) Farm.isoView.render();
  await sleep(800);
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const toast = document.getElementById('toast');
  if (toast) { toast.classList.add('hidden'); toast.innerHTML = ''; }
  const a = Farm.farmer && Farm.farmer._actor && Farm.farmer._actor();
  window.__farmerReport = {
    hasFarmer: !!Farm.farmer,
    look: d.farmerLook,
    actor: a ? { gx: a.gx, gy: a.gy, anim: a.anim, q: a.queue.length } : null,
  };
  await sleep(400);
})();
