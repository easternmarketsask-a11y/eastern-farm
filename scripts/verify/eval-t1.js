(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40 && !(window.Farm && Farm.crops && Farm.crops.loaded && Farm.state && Farm.state.data); i++) await sleep(150);
  const F = window.Farm;
  const out = { steps: [] };
  const ok = (name, cond, extra) => out.steps.push({ name, pass: !!cond, ...extra });

  const plots = F.state.data.plots;
  F.state.addSeed('shanghai_miao', 20); // ensure enough seeds for the 4 test plants

  // --- 1. plant + water math (剩余 -20%) ---
  const p0 = plots[0];
  const planted0 = F.crops.plant(p0, 'shanghai_miao');
  ok('plant p0', planted0.ok, { reason: planted0.reason });
  F.farm.renderGrid();
  const R0 = F.crops.timeRemaining(p0);
  const canW0 = F.tending.canWater(p0);
  const w = F.tending.applyWaterSpeedup(p0);
  const R1 = F.crops.timeRemaining(p0);
  const ratio = R0 > 0 ? R1 / R0 : -1;
  ok('canWater before', canW0);
  ok('water ok', w.ok, { shavedMs: w.shavedMs });
  ok('remaining ~0.8x', ratio > 0.78 && ratio < 0.82, { R0, R1, ratio: +ratio.toFixed(4) });
  ok('watered flag set', p0.watered === true);

  // --- 2. cannot re-water same cycle ---
  const w2 = F.tending.applyWaterSpeedup(p0);
  ok('no double water', w2.ok === false);
  ok('canWater after = false', F.tending.canWater(p0) === false);

  // --- 3. waterPlot() full path (DOM) on a 2nd plot ---
  const p1 = plots[1];
  F.crops.plant(p1, 'shanghai_miao');
  F.farm.renderGrid();
  const before1 = F.crops.timeRemaining(p1);
  let threw = false;
  let wp;
  try { wp = F.tending.waterPlot(1); } catch (e) { threw = true; out.waterPlotErr = String(e); }
  const after1 = F.crops.timeRemaining(p1);
  ok('waterPlot no throw', !threw);
  ok('waterPlot returns true', wp === true);
  ok('waterPlot reduced time', after1 < before1 && p1.watered === true, { before1, after1 });

  // --- 4. mature crop cannot be watered ---
  const p2 = plots[2];
  F.crops.plant(p2, 'shanghai_miao');
  const def2 = F.crops.get('shanghai_miao');
  p2.plantedAt = Date.now() - (def2.grow_minutes * 60000 + 10000); // force mature
  p2.watered = false;
  ok('mature isMature', F.crops.isMature(p2) === true);
  ok('mature canWater false', F.tending.canWater(p2) === false);
  ok('mature waterPlot false', F.tending.waterPlot(2) === false);

  // --- 5. openPlotCare builds modal (no throw) for growing crops ---
  const p3 = plots[3];
  F.crops.plant(p3, 'shanghai_miao');
  F.farm.renderGrid();
  let careThrew = false;
  try { F.farm.openPlotCare(3, p3, F.crops.get('shanghai_miao')); } catch (e) { careThrew = true; out.careErr = String(e); }
  const modalHtml = (document.getElementById('modalContent') || {}).innerHTML || '';
  ok('openPlotCare no throw', !careThrew);
  ok('care shows water btn (unwatered)', modalHtml.includes('careWater'));
  // watered plot → shows "已浇" note instead of button
  F.farm.openPlotCare(0, p0, F.crops.get('shanghai_miao'));
  const modalHtml2 = (document.getElementById('modalContent') || {}).innerHTML || '';
  ok('care shows watered note', !modalHtml2.includes('careWater') && modalHtml2.includes('💧'));

  out.allPass = out.steps.every(s => s.pass);
  return out;
})()
