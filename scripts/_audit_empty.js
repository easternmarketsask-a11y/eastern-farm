(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(window.Farm && Farm.isoView && Farm.state); i++) await sleep(100);
  if (window.__splashDismiss) window.__splashDismiss();
  await sleep(300);
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const d = Farm.state.data;
  d.tutorialV1Done = true; d.spotlightDone = true;
  d.completedAchievements = (Farm.achievements && Farm.achievements.catalog || []).map((a) => a.id);
  d.level = 8; d.landLevel = 1; d.landOrigin = 'back';
  d.plots = (d.plots || []).map((p, i) => {
    const gx = 1 + (i % 3), gy = 2 + Math.floor(i / 3);
    return Object.assign({}, p, {
      gx: gx, gy: gy, unlocked: i < 12, crop: null, plantedAt: 0, harvestsLeft: 0, watered: false
    });
  });
  d.map = [
    { type: 'house', gx: 0, gy: 5 },
    { type: 'barn', gx: 5, gy: 4 },
    { type: 'greenhouse', gx: 6, gy: 8 },
    { type: 'well', gx: 3, gy: 7 },
    { type: 'lantern', gx: 2, gy: 6 },
    { type: 'lantern', gx: 1, gy: 8 },
    { type: 'lantern', gx: 5, gy: 11 },
    { type: 'fence', gx: 7, gy: 9 },
    { type: 'fence', gx: 8, gy: 9 },
    { type: 'fence', gx: 8, gy: 10 },
    { type: 'fence', gx: 9, gy: 10 },
    { type: 'car', gx: 4, gy: 10, lv: 1 },
    { type: 'wheel', gx: 0, gy: 9 },
  ];
  d.mapTerrain = { '2,8': 'water', '3,8': 'water', '2,9': 'water', '3,9': 'water', '4,9': 'water' };
  Farm.state.save();
  if (Farm.isoView._buildLayout) Farm.isoView._buildLayout();
  Farm.isoView._pcs = null; Farm.isoView._pcsN = -1;
  Farm.isoView._bgKey = null;
  if (Farm.isoView._autoFrame) Farm.isoView._autoFrame();
  if (Farm.isoView.render) Farm.isoView.render();
  await sleep(800);
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const toast = document.getElementById('toast');
  if (toast) { toast.classList.add('hidden'); toast.innerHTML = ''; }
})();
