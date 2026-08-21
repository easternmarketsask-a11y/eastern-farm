// Live heading check: farmer facing must match isometric screen direction.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const T = (name, cond) => { if (!cond) failures.push(name); };

  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const startBtn = document.getElementById('splashStart');
  if (startBtn) startBtn.click();
  if (Farm.state && Farm.state.data) {
    Farm.state.data.tutorialV1Done = true;
    Farm.state.data.lifeStory = Object.assign({ seen: true }, Farm.state.data.lifeStory || {});
  }
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  try { if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal(); } catch (e) {}

  T('iso ready', !!(Farm.isoView && Farm.isoView._on));
  T('heading exported', typeof Farm.farmer.heading === 'function');
  T('backSheet exported', typeof Farm.farmer.backSheet === 'function');

  const cases = [
    { n: 'SE +gx', dx: 1, dy: 0, face: 'r', away: false },
    { n: 'SW +gy', dx: 0, dy: 1, face: 'l', away: false },
    { n: 'NW -gx', dx: -1, dy: 0, face: 'l', away: true },
    { n: 'NE -gy', dx: 0, dy: -1, face: 'r', away: true },
  ];
  for (const c of cases) {
    const h = Farm.farmer.heading(c.dx, c.dy);
    T(c.n + ' face', h.face === c.face);
    T(c.n + ' away', h.away === c.away);
  }

  const iso = Farm.isoView;
  const A = Farm.farmer._actor();
  for (let i = 0; i < 40 && A.gx == null; i++) { Farm.farmer.tick(iso); await sleep(80); }
  T('actor spawned', A.gx != null);

  if (A.gx != null && iso) {
    const realTick = Farm.farmer.tick;
    Farm.farmer.tick = function () {};
    A.job = null; A.queue.length = 0; A.pause = 99;
    if (Farm.farmer.backSheet) Farm.farmer.backSheet(A.look);
    const sw = Farm.farmer.heading(0, 1);
    A.anim = 'walk'; A.frameT = 0.4; A.face = sw.face; A.away = sw.away;
    iso.render();
    T('SW walk face is left (not sideways)', A.face === 'l' && A.away === false);
    const nw = Farm.farmer.heading(-1, 0);
    A.face = nw.face; A.away = nw.away; A.anim = 'walk';
    iso.render();
    T('NW walk is away', A.away === true && A.face === 'l');
    Farm.farmer.tick = realTick;
  }

  return { failures: failures, ran: ['heading-visual'] };
})()
