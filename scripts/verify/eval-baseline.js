(async () => {
  // Wait for async module loads (crops/i18n/etc fetch JSON)
  for (let i = 0; i < 40 && !(window.Farm && Farm.crops && Farm.crops.loaded); i++) {
    await new Promise(r => setTimeout(r, 150));
  }
  const F = window.Farm || {};
  return {
    hasFarm: !!window.Farm,
    modules: Object.keys(F).sort(),
    cropsLoaded: !!(F.crops && F.crops.loaded),
    cropCount: F.crops ? F.crops.all().length : -1,
    hasState: !!(F.state && F.state.data),
    plots: F.state && F.state.data ? F.state.data.plots.length : -1,
    level: F.state && F.state.data ? F.state.data.level : -1,
    coins: F.state && F.state.data ? F.state.data.coins : -1,
    activeEffects: F.state && F.state.data ? (F.state.data.activeEffects || null) : null,
    samplePlot: F.state && F.state.data ? F.state.data.plots[0] : null,
    saveVersion: F.state && F.state.data ? (F.state.data.version ?? F.state.data.save_version ?? 'none') : 'n/a',
  };
})()
