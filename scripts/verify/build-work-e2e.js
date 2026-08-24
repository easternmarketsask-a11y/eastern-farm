// 建造时农活不能停。由 cdp.mjs 执行。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const T = (n, c) => { if (!c) failures.push(n); };
  for (let i = 0; i < 80 && !window.__splashDismiss; i++) await sleep(150);
  window.__splashDismiss && window.__splashDismiss();
  await sleep(800);
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  Farm.state.data.tutorialV1Done = true;
  const iso = Farm.isoView, A = Farm.farmer._actor();
  for (let i = 0; i < 40 && A.gx == null; i++) { Farm.farmer.tick(iso); await sleep(50); }

  T('G5 建造模式点空地仍无效', (iso._build = true, Farm.farmer.goTo(3, 3) === false));
  iso._build = false;

  const plots = Farm.state.data.plots || [];
  let idx = -1;
  for (let i = 0; i < plots.length; i++) {
    if (plots[i] && plots[i].unlocked) { idx = i; break; }
  }
  T('有地可种', idx >= 0);
  const pending = () => (A.queue ? A.queue.length : 0) + ((Farm.hands && Farm.hands.board) ? Farm.hands.board.length : 0);
  if (idx >= 0) {
    plots[idx].crop = null;
    Farm.state.data.seeds = Farm.state.data.seeds || {};
    Farm.state.data.seeds.shanghai_miao = 8;
    A.queue = []; A.job = null; A.path = null; A.driving = null; A.pause = 0;
    if (Farm.hands) Farm.hands.board = [];
    const ok = Farm.farmer.enqueue(idx, 'plant', 'shanghai_miao');
    T('派了种植', ok === true && (pending() + (A.job ? 1 : 0)) >= 1);
    iso._build = true;
    const beforeQ = pending();
    const beforeKind = A.job && A.job.kind;
    const gx0 = A.gx, gy0 = A.gy;
    for (let i = 0; i < 12; i++) Farm.farmer.tick(iso);
    T('建造中农活还在', !!(A.job && (A.job.kind === 'plant' || A.job.kind === 'walk' || A.job.kind === 'boarding' || A.job.kind === 'goto')) || pending() > 0 || (A.anim === 'plant'));
    const moved = Math.hypot((A.gx - gx0) || 0, (A.gy - gy0) || 0) > 0.05;
    const progressed = A.anim === 'plant' || A.anim === 'walk' || moved || (A.job && A.job.kind === 'plant');
    T('建造中人还在干活或往地里走', progressed || beforeKind === 'plant' || beforeQ > 0);
    iso._build = false;
  }
  return { failures, job: A.job && A.job.kind, anim: A.anim, q: pending() };
})()
