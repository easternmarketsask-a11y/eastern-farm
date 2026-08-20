(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(window.Farm && Farm.warehouse); i++) await sleep(100);
  if (window.__splashDismiss) window.__splashDismiss();
  await sleep(300);
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const d = Farm.state.data;
  d.tutorialV1Done = true; d.spotlightDone = true;
  d.completedAchievements = (Farm.achievements && Farm.achievements.catalog || []).map((a) => a.id);
  d.inventory = d.inventory || {};
  d.inventory.shanghai_miao = 12;
  d.inventory.tomato = 8;
  d.inventory.eggplant = 4;
  Farm.state.save();
  Farm.warehouse.open();
  await sleep(400);
})();
