(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40 && !(window.Farm && Farm.crops && Farm.crops.loaded); i++) await sleep(150);
  return {
    hasFarm: !!window.Farm,
    hasSteal: !!(window.Farm && Farm.steal),
    hasConfig: !!(window.Farm && Farm.socialConfig),
    hasAI: !!(window.Farm && Farm.aiNeighbors && Farm.aiNeighbors.loaded),
    cfg: (window.Farm && Farm.socialConfig) || null,
  };
})()
