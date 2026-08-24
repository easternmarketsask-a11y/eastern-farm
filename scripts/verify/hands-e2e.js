// 帮手 CDP 回归。由 cdp.mjs 执行。必须走 #splashStart（__splashDismiss 会跳过 isoView.init）。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const T = (n, c) => { if (!c) failures.push(n); };
  const dbg = {};

  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const sb = document.getElementById('splashStart'); if (sb) sb.click();
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  Farm.state.data.tutorialV1Done = true;
  Farm.state.data.spotlightDone = true;
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();

  const iso = Farm.isoView, d = Farm.state.data, A = Farm.farmer._actor();
  (d.plots || []).forEach((p) => { if (p) p.unlocked = true; });
  d.coins = 5000;
  d.hands = [];
  d.handsUnlockSeen = '1';
  d.warehouseCapacity = 99;
  Farm.hands.actors = [];
  Farm.hands.board = [];
  Farm.hands._lastWageDay = '';

  T('unlocked at 12 plots', Farm.hands.isUnlocked() === true);
  T('maxAllowed is 2', Farm.hands.maxAllowed() === 2);

  const ok1 = Farm.hands.hire(7);
  T('hire first', ok1 === true && d.hands.length === 1 && d.hands[0].look === 7);
  T('hire cost 180', d.coins === 4820);
  const snap = localStorage.getItem('eastern_farm_save_v1');
  T('hire snapshot has row', !!(snap && snap.indexOf('"look":7') >= 0));

  d.coins = 180;
  d.hands = [];
  Farm.hands.actors = [];
  const ok180 = Farm.hands.hire(7);
  T('hire with exactly 180', ok180 === true && d.hands.length === 1 && d.coins === 0);

  d.coins = 5000;
  const ok2 = Farm.hands.hire(9);
  T('hire second costs 280', ok2 === true && d.hands.length === 2 && d.hands[1].look === 9);
  T('second wage 280', d.coins === 4720);
  T('third hire refused', Farm.hands.hire(1) === false && d.hands.length === 2);

  const cid = (Farm.crops.all().filter((c) => (c.unlock_level || 1) <= 1)[0] || { id: 'shanghai_miao' }).id;
  const grow = ((Farm.crops.get(cid) && Farm.crops.get(cid).grow_minutes) || 5) * 60000;
  for (let i = 0; i < 6 && i < d.plots.length; i++) {
    Object.assign(d.plots[i], {
      unlocked: true, crop: cid, plantedAt: Date.now() - grow - 60000, harvestsLeft: 3,
    });
  }
  A.job = null; A.queue = []; A.path = null; A.driving = null; A.pause = 0;
  Farm.hands.board = [];
  Farm.hands.syncFromSave();
  if (A.gx == null) Farm.farmer.spawnAt(iso, A);
  Farm.hands.actors.forEach((h, i) => { if (h && h.gx == null) Farm.farmer.spawnAt(iso, h); h.gx += i * 0.7; });

  const gx0 = Farm.hands.actors[0] && Farm.hands.actors[0].gx;
  const gy0 = Farm.hands.actors[0] && Farm.hands.actors[0].gy;
  const ft0 = Farm.hands.actors[0] && Farm.hands.actors[0].frameT;
  Farm.farmer.enqueueHarvestAll(0);

  const playerHeld = new Set();
  const handHeld = new Set();
  let handWalked = false;
  for (let i = 0; i < 90; i++) {
    Farm.farmer.tick(iso);
    if (A.job && A.job.plotIdx != null) playerHeld.add(A.job.plotIdx);
    if (A.anim === 'walk' || A.anim === 'harvest') handWalked = handWalked || false;
    for (let k = 0; k < Farm.hands.actors.length; k++) {
      const h = Farm.hands.actors[k];
      if (!h) continue;
      if (h.job && h.job.plotIdx != null) handHeld.add(h.job.plotIdx);
      if (h.anim === 'walk' || h.anim === 'harvest') handWalked = true;
    }
    await sleep(80);
  }
  const overlap = [...playerHeld].some((p) => handHeld.has(p));
  T('player and hand held different plots', playerHeld.size >= 1 && handHeld.size >= 1 && !overlap);
  T('hand walked or harvested', handWalked);
  const h0 = Farm.hands.actors[0];
  T('dt is not 0', !!(h0 && (h0.gx !== gx0 || h0.gy !== gy0 || h0.frameT !== ft0)));
  dbg.held = { player: [...playerHeld], hand: [...handHeld], overlap: overlap };

  d.hands[0].paidThroughDate = '2000-01-01';
  d.coins = 0;
  Farm.hands.board = [];
  A.job = null; A.queue = [];
  Farm.hands.actors[0].job = null;
  Farm.farmer.enqueueHarvestAll(0);
  for (let i = 0; i < 8; i++) Farm.farmer.tick(iso);
  T('unpaid hand does not claim', Farm.hands.actors[0].job == null || Farm.hands.actors[0].job.kind === 'idlewalk');
  T('player still works when hand unpaid', !!(A.job || (Farm.hands.board && Farm.hands.board.length) || A.anim === 'harvest' || A.anim === 'walk'));

  d.coins = 50;
  const prevPay = d.hands[0].paidThroughDate;
  T('pay fails without coins', Farm.hands.pay(0) === false && d.hands[0].paidThroughDate === prevPay);
  d.coins = 500;
  T('pay succeeds', Farm.hands.pay(0) === true && d.hands[0].paidThroughDate === Farm.state.getDateString());

  T('dismiss slot 1', Farm.hands.dismiss(1) === true && d.hands.length === 1);
  T('dismiss slot 0', Farm.hands.dismiss(0) === true && d.hands.length === 0);

  d.coins = 5000;
  Farm.hands.hire(7);
  T('hired again', d.hands.length === 1);
  Farm.state._visitLock = true;
  Farm.hands.onEnterVisit();
  T('hire no-op on visit', Farm.hands.hire(9) === false);
  T('no draws on visit', Farm.hands.depthDraws(iso).length === 0);
  Farm.state._visitLock = false;
  Farm.hands.onExitVisit();
  T('visit restore keeps row', d.hands.length === 1);

  Farm.hands.actors = [];
  Farm.hands.syncFromSave();
  T('cold boot spawns', Farm.hands.actors.length === 1 && Farm.hands.actors[0].gx != null && d.hands.length === 1);

  return { failures, dbg };
})()
