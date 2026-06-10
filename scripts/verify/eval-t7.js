(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 50 && !(window.Farm && Farm.steal && Farm.tending && Farm.homeReport && Farm.aiNeighbors && Farm.aiNeighbors.loaded && Farm.crops && Farm.crops.loaded && Farm.epShop && Farm.epShop.loaded); i++) await sleep(150);
  const F = window.Farm;
  const out = { steps: [] };
  const ok = (name, cond, extra) => out.steps.push({ name, pass: !!cond, ...extra });
  const H = 3600000;
  const def = F.crops.get('shanghai_miao');
  const g = def.grow_minutes * 60000;

  // ============ 净占便宜模拟：典型一天(主动偷满 vs 2次离开被偷) ============
  const c = F.state.data.dailyClaims; c.stolenToday = 0; c.stolenFromTargets = {}; F.steal._grace = {};
  F.state.data.warehouse = []; F.state.data.decorations = [];
  // 主动偷满每日上限(3家×2)
  let gained = 0;
  ['wang_ayi','zhang_dashu','li_nainai'].forEach(t => { for (let k=0;k<2;k++){ if(F.steal.stealOne(t,'shanghai_miao').ok) gained++; } });
  // 2 次离开各 2 熟菜被偷
  let lost = 0;
  for (let a=0;a<2;a++){
    const plots=F.state.data.plots;
    plots.forEach(p=>{p.crop=null;p.plantedAt=0;p.harvestsLeft=0;p.watered=false;p.fertilized=false;});
    F.state.addSeed('shanghai_miao',10);
    for(let i=0;i<2;i++){const p=plots[i];F.crops.plant(p,'shanghai_miao');p.plantedAt=Date.now()-g-10000;}
    lost += F.steal.settleRaid(7*H).stolen.length;
  }
  ok('净占便宜: 主动偷到 > 被偷走', gained > lost, { gained, lost });
  ok('主动偷满 6', gained === 6, { gained });
  ok('2次被偷 <= 4', lost <= 4, { lost });

  // ============ 全流程整合(一条龙不抛错) ============
  // 种 → 浇 → 施 → 收(翻倍)
  const plots=F.state.data.plots;
  plots.forEach(p=>{p.crop=null;p.plantedAt=0;p.harvestsLeft=0;p.watered=false;p.fertilized=false;});
  F.state.data.warehouse=[]; F.state.addSeed('shanghai_miao',10);
  F.state.data.activeEffects.fertilizerCharges = 2; F.state.addCoins(5000);
  const p0=plots[0]; F.crops.plant(p0,'shanghai_miao'); F.farm.renderGrid();
  ok('flow: water', F.tending.waterPlot(0) === true && p0.watered === true);
  // re-plant for fertilize-on-growing (water already used this cycle)
  ok('flow: fertilize', F.tending.fertilizePlot(0) === true && p0.fertilized === true);
  p0.plantedAt = Date.now()-g-10000;
  const whB=F.state.data.warehouse.length;
  const hr=F.crops.harvest(p0);
  ok('flow: fertilized harvest doubles', hr.ok && hr.bumper === true && F.state.data.warehouse.length===whB+2);
  // 逛 AI 偷
  const c2=F.state.data.dailyClaims; c2.stolenToday=0; c2.stolenFromTargets={};
  let ai=null; for(const id of F.aiNeighbors.ids()){ if(F.aiNeighbors.farmStateAt(id,Date.now()).some(p=>p.mature)){ai=id;break;} }
  let flowThrew=false;
  try { F.neighbors.viewFarm(F.aiNeighbors.displayCard(ai,Date.now())); const cell=document.querySelector('.neighbor-plot.stealable'); if(cell) cell.onclick(); } catch(e){flowThrew=true;out.flowErr=String(e);}
  ok('flow: visit+steal no throw', !flowThrew);
  // 买狗
  const buy=F.epShop.buy('guard_dog');
  ok('flow: buy guard dog', buy.ok && F.defenses.hasDog());
  // 被偷+小报
  plots.forEach(p=>{p.crop=null;p.plantedAt=0;p.harvestsLeft=0;});
  F.state.addSeed('shanghai_miao',10);
  for(let i=0;i<2;i++){const p=plots[i];F.crops.plant(p,'shanghai_miao');p.plantedAt=Date.now()-g-10000;}
  F.state.data.lastActiveAt=Date.now()-7*H;
  let bootThrew=false;
  try { F.homeReport.settleOnBoot(); F.homeReport.show(F.state.data.raidLog||{stolen:[],helped:[]}); } catch(e){bootThrew=true;out.bootErr=String(e);}
  ok('flow: settle+report no throw', !bootThrew);

  // ============ 红线运行时复核 ============
  // 仓库安全：被偷从不动仓库(仅清地块) —— 用一次有狗无狗对比已在T5/T6验证，这里确认 settleRaid 不减 warehouse
  F.state.data.warehouse=[{cropId:'shanghai_miao',addedAt:1},{cropId:'shanghai_miao',addedAt:2}];
  plots.forEach(p=>{p.crop=null;p.plantedAt=0;p.harvestsLeft=0;});
  F.state.addSeed('shanghai_miao',5);
  for(let i=0;i<2;i++){const p=plots[i];F.crops.plant(p,'shanghai_miao');p.plantedAt=Date.now()-g-10000;}
  F.state.data.decorations=[]; // no dog
  const whSafe=F.state.data.warehouse.length;
  F.steal.settleRaid(7*H);
  ok('红线: 仓库永不被减', F.state.data.warehouse.length >= whSafe, { whSafe, after: F.state.data.warehouse.length });
  // <2h 零损失
  plots.forEach(p=>{p.crop=null;p.plantedAt=0;p.harvestsLeft=0;});
  for(let i=0;i<2;i++){const p=plots[i];F.crops.plant(p,'shanghai_miao');p.plantedAt=Date.now()-g-10000;}
  ok('红线: <2h 零损失', F.steal.settleRaid(1.5*H).stolen.length === 0);

  out.allPass = out.steps.every(s => s.pass);
  return out;
})()
