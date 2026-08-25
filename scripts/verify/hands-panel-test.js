// 帮手面板展示：人物卡片，不默认摊开两张九宫格；出生不和农户叠在同一格。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const T = (n, c) => { if (!c) failures.push(n); };
  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const sb = document.getElementById('splashStart'); if (sb) sb.click();
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  Farm.state.data.tutorialV1Done = true;
  Farm.state.data.spotlightDone = true;
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  (Farm.state.data.plots || []).forEach((p) => { if (p) p.unlocked = true; });
  Farm.state.data.coins = 5000;
  Farm.state.data.hands = [];
  Farm.state.data.handsUnlockSeen = '1';
  Farm.hands.actors = [];
  Farm.hands.board = [];
  T('hire two', Farm.hands.hire(7) && Farm.hands.hire(9) && Farm.state.data.hands.length === 2);
  Farm.hands.openPanel();
  T('person cards', document.querySelectorAll('.hands-person').length === 2);
  T('look grid stays closed with two hired', document.querySelectorAll('.farmer-look-grid').length === 0);
  T('two portraits', document.querySelectorAll('[data-hands-face]').length === 2);
  document.querySelector('[data-hands-face="0"]').click();
  T('tap portrait opens look grid', document.querySelectorAll('.farmer-look-grid').length === 1);
  const A = Farm.farmer._actor();
  const h0 = Farm.hands.actors[0], h1 = Farm.hands.actors[1];
  T('hand 0 spawned', !!(h0 && h0.gx != null));
  T('hand 0 not on player cell', !!(h0 && A && (Math.round(h0.gx) !== Math.round(A.gx) || Math.round(h0.gy) !== Math.round(A.gy))));
  T('two hands not stacked', !!(h0 && h1 && (Math.round(h0.gx) !== Math.round(h1.gx) || Math.round(h0.gy) !== Math.round(h1.gy))));
  Farm.state.data.hands[0].paidThroughDate = '2000-01-01';
  Farm.farmer.tick(Farm.isoView);
  T('unpaid hand is dimmed', Farm.hands.actors[0]._handDim === true);
  return { failures };
})()
