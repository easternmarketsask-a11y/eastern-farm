// 点地选种要看见订单需求。由 cdp.mjs 执行。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const T = (n, c) => { if (!c) failures.push(n); };
  for (let i = 0; i < 80 && !window.__splashDismiss; i++) await sleep(150);
  window.__splashDismiss && window.__splashDismiss();
  await sleep(800);
  const b = document.getElementById('tutorialStartBtn'); if (b) b.click();
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  Farm.state.data.tutorialV1Done = true;
  Farm.state.data.seeds = Farm.state.data.seeds || {};
  Farm.state.data.seeds.shanghai_miao = 5;
  Farm.state.data.seeds.xiao_cong = 5;
  Farm.state.data.seeds.cilantro = 5;
  if (Farm.orders && Farm.orders.ensure) Farm.orders.ensure();
  const need = Farm.orders.needByCrop();
  T('needByCrop 返回对象', !!need && typeof need === 'object');
  const ids = Object.keys(need);
  T('今天至少有一样需求', ids.length > 0);
  if (ids[0]) {
    Farm.state.data.seeds[ids[0]] = Math.max(1, Farm.state.data.seeds[ids[0] || 0] || 0);
  }
  Farm.shop.openSeedPickerForPlot(0);
  await sleep(200);
  const html = (document.getElementById('modalContent') || document.body).innerHTML;
  T('选种器打开了', html.indexOf('seed-card') >= 0);
  T('需求行或东超要标在卡上', html.indexOf('seed-need') >= 0 || html.indexOf('seed-need-tag') >= 0);
  T('有需求时成组', ids.some((id) => (need[id].staple + need[id].order) > 0) ? html.indexOf('东超现在要的') >= 0 || html.indexOf('Eastern Market wants') >= 0 : true);
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  return { failures, ids: ids.slice(0, 6), hint: ids[0] ? Farm.orders.needHint(need[ids[0]], 'zh') : '' };
})()
