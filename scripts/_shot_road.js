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
  d.lifeStory = { seen: { ch1:1, ch2:1, ch3:1, ch4:1, ch5:1, ch6:1 }, claimed: {} };
  d.completedAchievements = (Farm.achievements && Farm.achievements.catalog || []).map((a) => a.id);
  d.coins = 5000;
  const now = Date.now();
  const ids = ['shanghai_miao','tomato','eggplant','jiucai'];
  d.level = 8; d.landLevel = 1; d.landOrigin = 'back';
  d.plots = (d.plots || []).map((p, i) => {
    const gx = 1 + (i % 3), gy = 2 + Math.floor(i / 3);
    const cid = ids[i % ids.length];
    const def = Farm.crops.get(cid);
    const grow = (def && def.grow_minutes) || 30;
    return Object.assign({}, p, {
      gx: gx, gy: gy,
      unlocked: i < 8, crop: i < 4 ? cid : null,
      plantedAt: i < 4 ? now - grow * 60000 - 120000 : 0,
      harvestsLeft: 0, watered: true
    });
  });
  d.map = [{ type: 'house', gx: 1, gy: 7 }, { type: 'barn', gx: 5, gy: 4 }];
  d.mapTerrain = { '5,7': 'water', '6,7': 'water', '5,8': 'water', '6,8': 'water', '7,8': 'water' };
  Farm.state.save();
  if (Farm.isoView._buildLayout) Farm.isoView._buildLayout();
  Farm.isoView._pcs = null; Farm.isoView._pcsN = -1;
  Farm.isoView._bgKey = null;
  Farm.isoView._roadSetKey = null;
  if (Farm.isoView._autoFrame) Farm.isoView._autoFrame();

  // 在路心刷水，复现「水塘叠在土路上」
  const road = Farm.isoView._roadSet();
  const roadKeys = Object.keys(road).filter((k) => {
    const a = k.split(','), gx = +a[0], gy = +a[1];
    return gx >= 0 && gy >= 0 && gx < 20 && gy < 16;
  });
  roadKeys.slice(0, 6).forEach((k) => { d.mapTerrain[k] = 'water'; });
  Farm.state.save();
  Farm.isoView._bgKey = null;
  if (Farm.isoView.render) Farm.isoView.render();

  const sample = roadKeys[2] || roadKeys[0] || '0,0';
  const [sx, sy] = sample.split(',').map(Number);
  window.__roadReport = {
    roadCells: roadKeys.length,
    painted: roadKeys.slice(0, 6),
    onRoad: Farm.isoView._onRoad(sx, sy),
    footprintOnRoad: Farm.isoView._footprintFree(sx, sy, 'well', -1),
    waterOnRoadDrawn: roadKeys.slice(0, 6).every((k) => {
      const a = k.split(',');
      return Farm.isoView._onRoad(+a[0], +a[1]);
    })
  };

  if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
  await sleep(300);
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const toast = document.getElementById('toast');
  if (toast) { toast.classList.add('hidden'); toast.innerHTML = ''; }
  await sleep(600);
})();
