(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 50 && !(window.Farm && Farm.defenses && Farm.steal && Farm.epShop && Farm.epShop.loaded && Farm.crops && Farm.crops.loaded && Farm.farm); i++) await sleep(150);
  const F = window.Farm;
  const out = { steps: [] };
  const ok = (name, cond, extra) => out.steps.push({ name, pass: !!cond, ...extra });
  const H = 3600000;
  const setup = (m) => {
    const plots = F.state.data.plots;
    plots.forEach(p => { p.crop = null; p.plantedAt = 0; p.harvestsLeft = 0; p.watered = false; p.fertilized = false; });
    F.state.addSeed('shanghai_miao', 40);
    const def = F.crops.get('shanghai_miao'); const g = def.grow_minutes * 60000;
    for (let i = 0; i < m; i++) { const p = plots[i]; F.crops.plant(p, 'shanghai_miao'); p.plantedAt = Date.now() - g - 10000; }
    F.state.data.warehouse = [];
  };

  // 1. no dog
  F.state.data.decorations = [];
  ok('no dog hasDog false', F.defenses.hasDog() === false);
  ok('no dog reduction 0', F.defenses.raidReduction() === 0);
  let anyCatch = false; for (let i = 0; i < 30; i++) if (F.defenses.catchThief()) anyCatch = true;
  ok('no dog never catches', anyCatch === false);

  // 2. buy guard dog with coins
  F.state.addCoins(2000);
  const coinsB = F.state.data.coins;
  const buy = F.epShop.buy('guard_dog');
  ok('buy guard_dog ok', buy.ok, { reason: buy.reason });
  ok('coins -800', F.state.data.coins === coinsB - 800);
  ok('hasDog true after buy', F.defenses.hasDog() === true);
  ok('reduction = DOG_PROTECT', F.defenses.raidReduction() === F.socialConfig.DOG_PROTECT);

  // 3. with dog, away 7h, 2 mature → stolen <=1 every time
  let maxStolen = 0;
  for (let t = 0; t < 12; t++) { setup(2); const r = F.steal.settleRaid(7 * H); maxStolen = Math.max(maxStolen, r.stolen.length); }
  ok('dog caps stolen <=1', maxStolen <= 1, { maxStolen });

  // 4. catchThief sometimes true with dog
  let catches = 0; for (let i = 0; i < 300; i++) if (F.defenses.catchThief()) catches++;
  ok('dog catches sometimes', catches > 0 && catches < 300, { catches });

  // 5. guard dog renders as wandering pet
  F.farm.renderDecorations();
  const pets = document.querySelectorAll('#farmDecorations .farm-deco-pet');
  let hasDogPet = false; pets.forEach(el => { if (el.textContent.includes('🐕')) hasDogPet = true; });
  ok('guard dog renders as pet', pets.length > 0 && hasDogPet, { pets: pets.length });

  // 6. forced catch → reverted to good event, plot kept, warehouse +1
  const orig = F.defenses.catchThief;
  F.defenses.catchThief = () => true;
  setup(2);
  const matureBefore = F.state.data.plots.filter(p => p.crop && F.crops.isMature(p)).length;
  const whB = F.state.data.warehouse.length;
  const r6 = F.steal.settleRaid(7 * H);
  ok('forced catch: nothing stolen', r6.stolen.length === 0, { stolen: r6.stolen.length });
  ok('forced catch: caught good event', r6.helped.some(h => h.kind === 'caught'));
  ok('forced catch: plots kept', F.state.data.plots.filter(p => p.crop && F.crops.isMature(p)).length === matureBefore);
  ok('forced catch: payback to silo', F.state.data.warehouse.length > whB, { whB, after: F.state.data.warehouse.length });
  F.defenses.catchThief = orig;

  out.allPass = out.steps.every(s => s.pass);
  return out;
})()
