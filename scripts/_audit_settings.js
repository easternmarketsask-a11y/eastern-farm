(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(window.Farm && Farm.ui); i++) await sleep(100);
  if (window.__splashDismiss) window.__splashDismiss();
  await sleep(300);
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  const d = Farm.state.data;
  d.tutorialV1Done = true; d.spotlightDone = true; d.farmerLook = 2;
  d.completedAchievements = (Farm.achievements && Farm.achievements.catalog || []).map((a) => a.id);
  Farm.state.save();
  const hb = document.getElementById('hamburgerButton');
  if (hb) hb.click();
  await sleep(400);
  const btn = document.querySelector('[data-nav="settings"]');
  if (btn) btn.click();
  await sleep(500);
})();
