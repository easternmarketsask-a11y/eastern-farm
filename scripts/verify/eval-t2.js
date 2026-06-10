(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40 && !(window.Farm && Farm.crops && Farm.crops.loaded && Farm.state && Farm.state.data && Farm.epShop && Farm.epShop.loaded); i++) await sleep(150);
  const F = window.Farm;
  const out = { steps: [] };
  const ok = (name, cond, extra) => out.steps.push({ name, pass: !!cond, ...extra });

  F.state.addCoins(5000);
  F.state.addSeed('shanghai_miao', 30);
  const plots = F.state.data.plots;
  const def = F.crops.get('shanghai_miao');

  // --- 1. buy fertilizer_pro with 农场币 ---
  const item = F.epShop.items.find(i => i.id === 'fertilizer_pro');
  ok('fertilizer_pro exists', !!item);
  ok('fertilizer_pro stock_key = fertilizerCharges', item && item.stock_key === 'fertilizerCharges');
  ok('fertilizer_pro priced in coins', F.epShop.priceOf(item).currency === 'coins', { price: F.epShop.priceOf(item) });
  const coinsBefore = F.state.data.coins;
  const fcBefore = F.state.data.activeEffects.fertilizerCharges || 0;
  const buyRes = F.epShop.buy('fertilizer_pro');
  ok('buy ok', buyRes.ok, { reason: buyRes.reason });
  ok('fertilizerCharges +1', (F.state.data.activeEffects.fertilizerCharges || 0) === fcBefore + 1);
  ok('coins -120', F.state.data.coins === coinsBefore - 120, { coinsBefore, after: F.state.data.coins });

  // give a few more for testing
  F.state.data.activeEffects.fertilizerCharges = 3;

  // --- 2. fertilize a plot ---
  const p0 = plots[0];
  F.crops.plant(p0, 'shanghai_miao');
  F.farm.renderGrid();
  ok('canFertilize before', F.tending.canFertilize(p0) === true);
  const fc2 = F.state.data.activeEffects.fertilizerCharges;
  const fRes = F.tending.fertilizePlot(0);
  ok('fertilizePlot true', fRes === true);
  ok('plot.fertilized set', p0.fertilized === true);
  ok('charge consumed', F.state.data.activeEffects.fertilizerCharges === fc2 - 1);
  ok('cannot re-fertilize', F.tending.canFertilize(p0) === false);

  // --- 3. harvest fertilized → warehouse +2, bumper true, flag reset ---
  p0.plantedAt = Date.now() - (def.grow_minutes * 60000 + 10000); // mature
  const whBefore = F.state.data.warehouse.length;
  const hRes = F.crops.harvest(p0);
  const whAfter = F.state.data.warehouse.length;
  ok('harvest ok', hRes.ok, { reason: hRes.reason });
  ok('fertilized harvest = +2 to warehouse', whAfter - whBefore === 2, { whBefore, whAfter });
  ok('result.bumper true', hRes.bumper === true);
  ok('fertilized flag cleared after harvest', p0.fertilized === false);

  // --- 4. non-fertilized harvest → +1 ---
  const p1 = plots[1];
  F.crops.plant(p1, 'shanghai_miao');
  p1.plantedAt = Date.now() - (def.grow_minutes * 60000 + 10000);
  const wh1Before = F.state.data.warehouse.length;
  const h1 = F.crops.harvest(p1);
  ok('plain harvest = +1', F.state.data.warehouse.length - wh1Before === 1, { got: F.state.data.warehouse.length - wh1Before });
  ok('plain harvest bumper false', h1.bumper === false);

  // --- 5. no charges → cannot fertilize ---
  F.state.data.activeEffects.fertilizerCharges = 0;
  const p2 = plots[2];
  F.crops.plant(p2, 'shanghai_miao');
  ok('canFertilize false w/o charges', F.tending.canFertilize(p2) === false);
  ok('fertilizePlot false w/o charges', F.tending.fertilizePlot(2) === false);

  // --- 6. openPlotCare shows fert button when charges & unfertilized ---
  F.state.data.activeEffects.fertilizerCharges = 2;
  const p3 = plots[3];
  F.crops.plant(p3, 'shanghai_miao');
  F.farm.renderGrid();
  let careThrew = false;
  try { F.farm.openPlotCare(3, p3, def); } catch (e) { careThrew = true; out.careErr = String(e); }
  const html = (document.getElementById('modalContent') || {}).innerHTML || '';
  ok('openPlotCare no throw', !careThrew);
  ok('care shows fert btn', html.includes('careFert'));

  // --- 7. migration: old bumperCharges → fertilizerCharges ---
  const oldSave = JSON.parse(JSON.stringify(F.state.data));
  oldSave.activeEffects = { accelerationCharges: 0, freshnessCharges: 0, bumperCharges: 3 }; // legacy shape (no fertilizerCharges)
  localStorage.setItem('eastern_farm_save_v1', JSON.stringify(oldSave));
  F.state.init();
  ok('migration: bumper→fert', (F.state.data.activeEffects.fertilizerCharges || 0) === 3, { ae: F.state.data.activeEffects });
  ok('migration: bumper zeroed', (F.state.data.activeEffects.bumperCharges || 0) === 0);

  out.allPass = out.steps.every(s => s.pass);
  return out;
})()
