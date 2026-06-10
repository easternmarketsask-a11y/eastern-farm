(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 50 && !(window.Farm && Farm.steal && Farm.socialConfig && Farm.aiNeighbors && Farm.aiNeighbors.loaded && Farm.neighbors && Farm.crops && Farm.crops.loaded); i++) await sleep(150);
  const F = window.Farm;
  const out = { steps: [] };
  const ok = (name, cond, extra) => out.steps.push({ name, pass: !!cond, ...extra });
  const cfg = F.socialConfig;
  const reset = () => { const c = F.state.data.dailyClaims; c.stolenToday = 0; c.stolenFromTargets = {}; F.state.data.warehouse = []; F.steal._grace = {}; };

  // --- 1. config ---
  ok('config present', cfg.RAID_MAX_PLOTS === 2 && cfg.STEAL_MAX_PER_DAY === 6 && cfg.STEAL_PER_TARGET === 2);
  ok('net-positive (steal>>raid)', cfg.STEAL_MAX_PER_DAY > cfg.RAID_MAX_PLOTS);

  // --- 2. steal + per-target cap ---
  reset();
  const wh0 = F.state.data.warehouse.length;
  const r1 = F.steal.stealOne('wang_ayi', 'shanghai_miao');
  ok('steal1 ok +1 silo', r1.ok && F.state.data.warehouse.length === wh0 + 1, { r1 });
  ok('stolenToday=1', F.state.data.dailyClaims.stolenToday === 1);
  F.steal.stealOne('wang_ayi', 'shanghai_miao');
  ok('target count=2', (F.state.data.dailyClaims.stolenFromTargets.wang_ayi) === 2);
  const rTarget = F.steal.canStealFrom('wang_ayi');
  ok('per-target cap blocks 3rd', rTarget.ok === false && rTarget.reason === 'target_cap', { rTarget });
  ok('relationship stolenByMe', F.state.data.aiRelationships.wang_ayi && F.state.data.aiRelationships.wang_ayi.stolenByMe === true);

  // --- 3. daily cap (already 2; add from 4 others = 6) ---
  ['zhang_dashu', 'li_nainai', 'chen_yeye', 'xiao_hong'].forEach(t => F.steal.stealOne(t, 'shanghai_miao'));
  ok('stolenToday=6', F.state.data.dailyClaims.stolenToday === 6);
  const rDaily = F.steal.canStealFrom('amy_chen');
  ok('daily cap blocks 7th', rDaily.ok === false && rDaily.reason === 'daily_cap', { rDaily });

  // --- 4. revenge grace bumps per-target cap ---
  reset();
  F.steal.stealOne('wang_ayi', 'shanghai_miao');
  F.steal.stealOne('wang_ayi', 'shanghai_miao');
  ok('capped before grace', F.steal.canStealFrom('wang_ayi').ok === false);
  F.steal.grantGrace('wang_ayi', 1);
  ok('grace allows 1 more', F.steal.canStealFrom('wang_ayi').ok === true);

  // --- 5. warehouse full protection ---
  reset();
  F.state.data.warehouseCapacity = 3;
  F.state.data.warehouse = [{ cropId: 'shanghai_miao', addedAt: 1 }, { cropId: 'shanghai_miao', addedAt: 2 }, { cropId: 'shanghai_miao', addedAt: 3 }];
  const rFull = F.steal.stealOne('zhou_ayi', 'shanghai_miao');
  ok('warehouse full blocks steal', rFull.ok === false && rFull.reason === 'warehouse_full', { rFull });
  F.state.data.warehouseCapacity = 20;

  // --- 6. viewFarm UI: tap a ripe crop actually banks it ---
  reset();
  // find an AI with a mature plot now
  const now = Date.now();
  let targetAi = null;
  for (const aid of F.aiNeighbors.ids()) {
    if (F.aiNeighbors.farmStateAt(aid, now).some(p => p.mature)) { targetAi = aid; break; }
  }
  ok('found AI with ripe crop', !!targetAi, { targetAi });
  if (targetAi) {
    F.neighbors.viewFarm(F.aiNeighbors.displayCard(targetAi, now));
    const cells = document.querySelectorAll('.neighbor-plot.stealable');
    ok('viewFarm shows stealable cells', cells.length > 0, { cells: cells.length });
    const whB = F.state.data.warehouse.length;
    if (cells.length) {
      cells[0].onclick();
      ok('UI steal banked +1', F.state.data.warehouse.length === whB + 1, { whB, after: F.state.data.warehouse.length });
      ok('UI cell marked stolen', cells[0].classList.contains('stolen'));
    }
  }

  // --- 7. watering still 0.8x after socialConfig refactor (regression) ---
  reset();
  F.state.addSeed('shanghai_miao', 5);
  const p = F.state.data.plots.find(x => x.unlocked && !x.crop);
  F.crops.plant(p, 'shanghai_miao');
  const R0 = F.crops.timeRemaining(p);
  F.tending.applyWaterSpeedup(p);
  const R1 = F.crops.timeRemaining(p);
  ok('water still ~0.8x', R0 > 0 && Math.abs(R1 / R0 - 0.8) < 0.02, { R0, R1 });

  // --- 8. cross-day reset of steal counters ---
  const crafted = JSON.parse(JSON.stringify(F.state.data));
  crafted.dailyClaims.date = '2000-01-01';
  crafted.dailyClaims.stolenToday = 5;
  crafted.dailyClaims.stolenFromTargets = { wang_ayi: 2 };
  localStorage.setItem('eastern_farm_save_v1', JSON.stringify(crafted));
  F.state.init();
  ok('cross-day resets stolenToday', F.state.data.dailyClaims.stolenToday === 0, { sc: F.state.data.dailyClaims.stolenToday });
  ok('cross-day resets targets', Object.keys(F.state.data.dailyClaims.stolenFromTargets || {}).length === 0);

  out.allPass = out.steps.every(s => s.pass);
  return out;
})()
