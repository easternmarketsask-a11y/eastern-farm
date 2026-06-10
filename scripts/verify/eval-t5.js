(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 50 && !(window.Farm && Farm.steal && Farm.homeReport && Farm.aiNeighbors && Farm.aiNeighbors.loaded && Farm.crops && Farm.crops.loaded); i++) await sleep(150);
  const F = window.Farm;
  const out = { steps: [] };
  const ok = (name, cond, extra) => out.steps.push({ name, pass: !!cond, ...extra });
  const H = 3600000;

  const setup = (matureCount, growingCount) => {
    const plots = F.state.data.plots;
    plots.forEach(p => { p.crop = null; p.plantedAt = 0; p.harvestsLeft = 0; p.watered = false; p.fertilized = false; });
    F.state.addSeed('shanghai_miao', 40);
    const def = F.crops.get('shanghai_miao');
    const growMs = def.grow_minutes * 60000;
    let placed = 0;
    for (let i = 0; i < matureCount; i++) { const p = plots[placed++]; F.crops.plant(p, 'shanghai_miao'); p.plantedAt = Date.now() - growMs - 10000; }
    for (let i = 0; i < growingCount; i++) { const p = plots[placed++]; F.crops.plant(p, 'shanghai_miao'); }
    F.state.data.warehouse = [];
  };
  const countMature = () => F.state.data.plots.filter(p => p.crop && F.crops.isMature(p)).length;
  const countCrops = () => F.state.data.plots.filter(p => p.crop).length;

  // --- 1. away < 2h → zero loss ---
  setup(2, 2);
  const r1 = F.steal.settleRaid(1 * H);
  ok('away<2h zero stolen', r1.stolen.length === 0, { r1stolen: r1.stolen.length });
  ok('away<2h crops intact', countCrops() === 4);

  // --- 2. away 7h → steals up to cap, only mature, warehouse safe ---
  setup(2, 2);
  const whBefore = F.state.data.warehouse.length;
  const matureBefore = countMature();
  const r2 = F.steal.settleRaid(7 * H);
  ok('stolen between 1 and 2 (cap)', r2.stolen.length >= 1 && r2.stolen.length <= 2, { n: r2.stolen.length });
  ok('mature plots reduced by stolen', countMature() === matureBefore - r2.stolen.length, { matureBefore, now: countMature(), stolen: r2.stolen.length });
  // growing plots (2) must remain
  ok('growing crops untouched', F.state.data.plots.filter(p => p.crop && !F.crops.isMature(p)).length === 2);
  ok('warehouse untouched by steal', F.state.data.warehouse.length === whBefore);
  ok('raidLog written', !!F.state.data.raidLog && Array.isArray(F.state.data.raidLog.stolen));
  ok('stolen entries valid', r2.stolen.every(s => Farm.aiNeighbors.get(s.aiId) && s.cropId === 'shanghai_miao'));

  // --- 3. away 3h → at most 1 stolen ---
  setup(2, 2);
  const r3 = F.steal.settleRaid(3 * H);
  ok('away 3h steals <=1', r3.stolen.length <= 1, { n: r3.stolen.length });

  // --- 4. help events present + valid (away 8h → 2 helpers) ---
  setup(0, 3); // all growing so water-help possible; coins fallback otherwise
  const coins0 = F.state.data.coins;
  const r4 = F.steal.settleRaid(8 * H);
  ok('helpers appear', r4.helped.length >= 1, { n: r4.helped.length });
  ok('help entries valid', r4.helped.every(h => Farm.aiNeighbors.get(h.aiId) && (h.kind === 'water' || h.kind === 'coins' || h.kind === 'caught')));
  // a coins help should have raised coins; a water help should have watered a plot
  const wateredSome = F.state.data.plots.some(p => p.crop && p.watered);
  ok('help took real effect', F.state.data.coins > coins0 || wateredSome, { coins0, now: F.state.data.coins, wateredSome });

  // --- 5. settleOnBoot: first run (lastActiveAt 0) → no raid, sets stamp ---
  F.state.data.lastActiveAt = 0;
  setup(2, 0);
  F.homeReport.settleOnBoot();
  ok('first-run no pending', F.homeReport.hasPending() === false);
  ok('first-run stamps lastActiveAt', Math.abs(Date.now() - F.state.data.lastActiveAt) < 5000);
  ok('first-run crops intact (no false raid)', countCrops() === 2);

  // --- 6. settleOnBoot: returning after 7h → settles + pending ---
  setup(2, 1);
  F.state.data.lastActiveAt = Date.now() - 7 * H;
  F.homeReport.settleOnBoot();
  ok('returning updates stamp', Math.abs(Date.now() - F.state.data.lastActiveAt) < 5000);
  ok('returning has pending report', F.homeReport.hasPending() === true);

  // --- 7. home report renders + revenge wiring ---
  const events = { stolen: [{ aiId: 'wang_ayi', cropId: 'shanghai_miao', count: 1 }], helped: [{ aiId: 'li_nainai', kind: 'coins', amount: 20 }] };
  let threw = false;
  try { F.homeReport.show(events); } catch (e) { threw = true; out.showErr = String(e); }
  const html = (document.getElementById('modalContent') || {}).innerHTML || '';
  ok('report show no throw', !threw);
  ok('report shows stolen row', html.includes('report-bad') && html.includes('report-revenge-btn'));
  ok('report shows good row', html.includes('report-good'));
  // click revenge → grants grace + opens that farm
  const rb = document.querySelector('[data-revenge-btn]');
  let revThrew = false;
  try { if (rb) rb.onclick(); } catch (e) { revThrew = true; out.revErr = String(e); }
  ok('revenge click no throw', !revThrew);
  ok('revenge granted grace', (F.steal._grace.wang_ayi || 0) >= 1);

  out.allPass = out.steps.every(s => s.pass);
  return out;
})()
