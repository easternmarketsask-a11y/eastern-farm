(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(window.Farm && Farm.fbAuth); i++) await sleep(100);
  if (window.__splashDismiss) window.__splashDismiss();
  await sleep(400);
  if (Farm.fbAuth && Farm.fbAuth.openLoginModal) Farm.fbAuth.openLoginModal();
  await sleep(500);
})();
