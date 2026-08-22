/* smoke-flows.js — deploy.sh 冒烟闸门用的页内脚本（由 scripts/verify/cdp.mjs 注入）。
   2026-08-15 加：闸门原来只看「开屏能不能起来」，一次取景改动把建造模式改成
   进去就抛 ReferenceError，冒烟照样绿灯上线了。现在把玩家最常点的入口各走一遍，
   任何一步抛异常都返回 failures（deploy.sh 见到非空即中止）。
   规则：只调用已存在的公开入口，缺模块视为跳过（不是失败）；每步之间关掉弹窗。 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !window.__splashDismiss; i++) await sleep(150);
  const failures = [], ran = [];
  const F = window.Farm || {};
  if (!F.state || !F.ui) return { failures: ['boot: Farm.state/ui missing'], ran };
  const step = async (name, fn) => {
    try { await fn(); ran.push(name); } catch (e) { failures.push(name + ': ' + (e && e.message || e)); }
    try { F.ui.hideModal && F.ui.hideModal(); } catch (_) {}
    await sleep(120);
  };
  window.__splashDismiss && window.__splashDismiss();
  await sleep(1200);
  await step('tutorial-close', () => { const b = document.getElementById('tutorialStartBtn'); if (b) b.click(); });
  await step('spotlight-skip', () => { if (F.spotlight && F.spotlight._active) F.spotlight.skip(); });
  await step('shop', () => F.shop && F.shop.open());
  await step('tasks', () => F.tasks && F.tasks.open());
  await step('orders', () => F.orders && F.orders.open());
  await step('daily', () => F.daily && F.daily.open());
  await step('rewards', () => F.rewards && F.rewards.open());
  await step('ep-shop', () => F.epShop && F.epShop.open());
  await step('kitchen', () => F.kitchen && F.kitchen.open());
  await step('story', () => F.lifeStory && F.lifeStory.open('chapter'));
  await step('diary', () => F.lifeStory && F.lifeStory.open('diary'));
  await step('warehouse', () => F.warehouse && F.warehouse.open());
  await step('guide', () => F.guide && F.guide.open());
  await step('settings', () => F.openSettings && F.openSettings());
  await step('stall', () => F.stall && F.stall.open());
  await step('seed-picker', () => F.shop && F.shop.openSeedPickerForPlot(0));
  await step('menu', () => { const b = document.getElementById('hamburgerButton'); if (b) b.click(); });
  await step('collection', () => { const b = document.querySelector('.action-btn[data-action=menu]'); if (b) { b.click(); const c = document.querySelector('[data-nav=collection]'); if (c) c.click(); } });
  await step('build-mode', async () => { if (F.isoView && F.isoView.toggleBuild) { F.isoView.toggleBuild(); await sleep(300); F.isoView.toggleBuild(); } });
  await step('build-duration', () => {
    if (!F.isoView || !F.isoView.buildDurationMs) return;
    if (F.isoView.buildDurationMs('barn', 2, 2) !== 75000) throw new Error('barn build ms');
    if (F.isoView.buildDurationMs('car', 2, 2) !== 0) throw new Error('car has no wait');
    if (F.isoView.isUnderConstruction({})) throw new Error('old save must be complete');
  });
  await step('autoframe', () => { if (F.isoView && F.isoView._autoFrame) { F.isoView._autoFrame(); F.isoView.render(); } });
  await step('relang-en', () => { F.state.data.language = 'en'; F.i18n.setLanguage('en'); F.ui.refreshHUD(); F.isoView && F.isoView.relang && F.isoView.relang(); });
  await step('relang-zh', () => { F.state.data.language = 'zh'; F.i18n.setLanguage('zh'); F.ui.refreshHUD(); F.isoView && F.isoView.relang && F.isoView.relang(); });
  await step('tick', () => F.farm && F.farm.tick());
  return { failures, ran };
})()
