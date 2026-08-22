/* 建造过程端到端：放下去不能用、跳过扣币、老建筑不重盖。由 cdp.mjs 注入。 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const T = (name, cond) => { if (!cond) failures.push(name); };

  for (let i = 0; i < 80 && !(window.Farm && Farm.state && Farm.isoView); i++) await sleep(150);
  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const sb = document.getElementById('splashStart'); if (sb) sb.click();
  Farm.state.data.tutorialV1Done = true;
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  T('init iso on', !!(Farm.isoView && Farm.isoView._on));

  const iso = Farm.isoView;
  T('barn wait 75s', iso.buildDurationMs('barn', 2, 2) === 75000);
  T('car no wait', iso.buildDurationMs('car', 2, 2) === 0);
  T('old save complete', iso.isUnderConstruction({}) === false);

  const barn = (Farm.state.data.map || []).find((m) => m && m.type === 'barn');
  T('starter barn not constructing', barn && !iso.isUnderConstruction(barn));

  Farm.state.data.coins = 50000;
  if (!iso._build) iso.toggleBuild();
  await sleep(250);
  const before = (Farm.state.data.map || []).length;
  const palBtn = document.querySelector('#isoPalette button[data-type="tree"]');
  T('palette has tree button', !!palBtn);
  if (palBtn) palBtn.click();
  T('palette click starts ghost', !!(iso._placing && iso._placing.type === 'tree'));
  T('palette click does not auto-place', (Farm.state.data.map || []).length === before);
  if (iso._placing) iso._cancelPlace();

  iso._addBuilding('fence');
  T('ghost follows pick', !!(iso._placing && iso._placing.type === 'fence'));
  T('not dropped until tap', (Farm.state.data.map || []).length === before);
  iso._placeDown = false;
  const fakeUp = { pointerId: 99 };
  iso._pointers[fakeUp.pointerId] = { x: 10, y: 10 };
  iso._up(fakeUp);
  T('palette click-through does not drop', (Farm.state.data.map || []).length === before && !!(iso._placing));
  const pl = iso._placing;
  if (pl) {
    outer:
    for (let gy = 0; gy < 20; gy++) for (let gx = 0; gx < 20; gx++) {
      if (iso._placeValid(gx, gy, 'fence', pl.bldg)) { pl.gx = gx; pl.gy = gy; pl.valid = true; break outer; }
    }
  }
  iso._commitPlace();
  const after = Farm.state.data.map || [];
  T('fence placed', after.length === before + 1);
  const fence = after[after.length - 1];
  T('fence under construction', iso.isUnderConstruction(fence));
  T('fence has buildUntil', !!(fence.buildUntil && fence.buildMs === 8000));
  T('skip coins 5 at start', iso.buildSkipCoins(fence.buildCost, fence.buildMs, fence.buildMs) === 5);
  T('skip points 1', iso.buildSkipPoints(fence.buildMs) === 1);

  const coins0 = Farm.state.data.coins;
  iso._payBuildSkip('map', after.length - 1, 'coins');
  T('skip spent coins', Farm.state.data.coins === coins0 - 5);
  T('fence finished', !iso.isUnderConstruction(after[after.length - 1]));
  T('buildUntil cleared', after[after.length - 1].buildUntil == null);

  iso._addBuilding('barn');
  const pl2 = iso._placing;
  if (pl2) {
    outer2:
    for (let gy = 0; gy < 20; gy++) for (let gx = 0; gx < 20; gx++) {
      if (iso._placeValid(gx, gy, 'barn', pl2.bldg)) { pl2.gx = gx; pl2.gy = gy; pl2.valid = true; break outer2; }
    }
    iso._commitPlace();
  }
  const barn2 = (Farm.state.data.map || []).filter((m) => m && m.type === 'barn').pop();
  T('new barn constructing', iso.isUnderConstruction(barn2));
  const idx = (Farm.state.data.map || []).indexOf(barn2);
  try { iso.render(); } catch (e) { failures.push('render while building: ' + e.message); }
  iso._openBuildSkip('map', idx);
  const modal = document.getElementById('modal');
  T('skip panel opened', modal && !modal.classList.contains('hidden'));
  T('coin skip button', !!document.getElementById('buildSkipCoins'));
  T('points skip button', !!document.getElementById('buildSkipPoints'));
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();

  const pts0 = Farm.state.data.eastPoints || 0;
  iso._payBuildSkip('map', idx, 'points');
  T('ep skip blocked without login', iso.isUnderConstruction(barn2));
  T('ep not spent', (Farm.state.data.eastPoints || 0) === pts0);

  barn2.buildUntil = Date.now() + 500;
  iso._openBuildSkip('map', idx);
  T('no skip under 2s', !document.getElementById('buildSkipCoins'));
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();

  return { failures };
})()
