(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 50 && !(window.Farm && Farm.crops && Farm.crops.loaded); i++) await sleep(150);
  const F = window.Farm;
  const need = ['tending','aiNeighbors','steal','socialConfig','defenses','homeReport'];
  const missing = need.filter(m => !F[m]);
  return {
    booted: !!F,
    newModulesLoaded: missing.length === 0,
    missing,
    aiLoaded: !!(F.aiNeighbors && F.aiNeighbors.loaded),
    aiCount: F.aiNeighbors ? F.aiNeighbors.roster.length : -1,
  };
})()
