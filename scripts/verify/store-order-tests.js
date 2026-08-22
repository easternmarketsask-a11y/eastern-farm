// 东超订单制 E2E（2026-08-22）。由 cdp.mjs 在真实页面里执行，返回 {failures:[]}。
//
// 静态断言只能证明「代码长这样」，证明不了「玩起来是这样」。这里跑真实流程：
// 交补货 / 接单 / 未接不能交 / 接满挡住 / 放弃腾位 / 离线不追发 / 刷新不重 roll /
// 计数接管 / 老存档清仓单 / 告示牌立着且点得开。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const dbg = {};
  const T = (name, cond) => { if (!cond) failures.push(name); };

  for (let i = 0; i < 250 && !(window.Farm && Farm.state && Farm.orders && Farm.storeDemand); i++) await sleep(100);
  /* 🔒 走真实入口进农场：直接 __splashDismiss() 会跳过 isoView.init()，
     _on 永远 false（car-drive-tests / roam-tests 都栽过）。 */
  for (let i = 0; i < 60; i++) { if (document.getElementById('splashStart')) break; await sleep(150); }
  const sb = document.getElementById('splashStart'); if (sb) sb.click();
  Farm.state.data.tutorialV1Done = true;
  for (let i = 0; i < 80; i++) { if (Farm.isoView && Farm.isoView._on) break; await sleep(150); }
  if (Farm.spotlight && Farm.spotlight.skip) Farm.spotlight.skip();
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  T('E-init 农场视图已就绪', Farm.isoView._on === true);

  const d = Farm.state.data;
  const SD = Farm.storeDemand;
  d.spotlightDone = true; d.level = 8; d.coins = 1000;
  // ⚠️ 谷仓有容量上限，addToWarehouse 装不下就丢弃 —— 不撑大仓，
  //    后面「造库存再交单」全都会因为货不够而假红。
  d.warehouseCapacity = 9999;

  // ---------- 谷仓再也卖不了菜 ----------
  T('E1 state.deliverWarehouse 已不存在', typeof Farm.state.deliverWarehouse !== 'function');
  T('E2 warehouse.deliver 已不存在', !Farm.warehouse || typeof Farm.warehouse.deliver !== 'function');

  // ---------- 造一批库存，跑三层需求 ----------
  const pool = Farm.crops.all().filter((c) => (c.unlock_level || 1) <= 8);
  const stock = (cropId, n) => { for (let i = 0; i < n; i++) Farm.state.addToWarehouse(cropId, 1); };
  d.warehouse = [];
  d.storeDemand = { day: '', staples: [], board: [], forecast: [], nextPostAt: 0, lastSyncAt: 0, source: 'local', clearedLegacy: true };
  pool.slice(0, 6).forEach((c) => stock(c.id, 30));
  Farm.orders.ensure();
  const sd = d.storeDemand;
  dbg.staples = sd.staples.length; dbg.board = sd.board.length; dbg.forecast = sd.forecast.length;
  T('E3 每日基础补货有 2–3 样', sd.staples.length >= 2 && sd.staples.length <= 3);
  T('E4 板上有订单', sd.board.length > 0 && sd.board.length <= SD.BOARD_CAP);
  T('E5 有备货预告', sd.forecast.length >= 3);

  // ---------- 交基础补货：计数与金币都要动 ----------
  const s0 = sd.staples.filter((s) => Farm.state.warehouseCount(s.cropId) > 0)[0];
  const coins0 = d.coins, del0 = d.totalDeliveries || 0;
  if (s0) Farm.orders.fillStaple(s0.cropId);
  dbg.stapleFilled = s0 ? sd.staples.filter((s) => s.cropId === s0.cropId)[0].filled : -1;
  T('E6 交补货能拿到钱', d.coins > coins0);
  T('E7 交补货算一次交付（totalDeliveries 接管）', (d.totalDeliveries || 0) === del0 + 1);
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();

  // ---------- 没接的单不能交 ----------
  const o1 = sd.board[0];
  o1.items.forEach((it) => stock(it.cropId, it.qty + 5));
  o1.accepted = false;
  const coinsBefore = d.coins;
  Farm.orders.fulfill(o1.id);
  T('E8 没接的单交不了', d.coins === coinsBefore && sd.board.some((o) => o.id === o1.id));
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();

  // ---------- 接单上限 ----------
  sd.board.forEach((o) => { o.accepted = false; });
  let taken = 0;
  for (const o of sd.board.slice()) { Farm.orders.accept(o.id); if (o.accepted) taken++; }
  dbg.taken = taken; dbg.cap = SD.ACCEPT_CAP;
  T('E9 接单上限生效', taken === Math.min(SD.ACCEPT_CAP, sd.board.length));
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();

  // ---------- 放弃能腾位，且无惩罚 ----------
  const acc = sd.board.filter((o) => o.accepted)[0];
  const coinsBeforeDrop = d.coins, lvBefore = d.level;
  if (acc) Farm.orders.abandon(acc.id);
  T('E10 放弃后位置腾出来了', Farm.orders.acceptedCount() === taken - 1);
  T('E11 放弃没有惩罚', d.coins === coinsBeforeDrop && d.level === lvBefore);
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();

  // ---------- 交一张已接的单 ----------
  const o2 = sd.board.filter((o) => o.accepted)[0];
  if (o2) {
    o2.items.forEach((it) => stock(it.cropId, it.qty + 2));
    const c2 = d.coins, dl2 = d.totalDeliveries || 0, of2 = d.totalOrdersFilled || 0;
    Farm.orders.fulfill(o2.id);
    T('E12 交单到账', d.coins > c2);
    T('E13 交单算一次交付', (d.totalDeliveries || 0) === dl2 + 1);
    T('E14 交单计入订单数', (d.totalOrdersFilled || 0) === of2 + 1);
    T('E15 交完这张从板上拿掉（不立刻补位）', !sd.board.some((o) => o.id === o2.id));
  } else { failures.push('E12-15 没有已接的单可交'); }
  if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();

  // ---------- 离线三天：不追发 ----------
  sd.nextPostAt = Date.now() - 3 * 86400000;
  sd.board.forEach((o) => { o.expiresAt = Date.now() - 1000; });   // 全过期
  const coinsBeforeOffline = d.coins, lvBeforeOffline = d.level;
  Farm.orders.ensure();
  dbg.boardAfterOffline = sd.board.length;
  T('E16 离线回来板面不超上限（不按错过的周期补发）', sd.board.length <= SD.BOARD_CAP);
  T('E17 过期不惩罚', d.coins === coinsBeforeOffline && d.level === lvBeforeOffline);

  // ---------- 刷新不重 roll ----------
  const ids1 = sd.board.map((o) => o.id).join(',');
  Farm.orders.ensure(); Farm.orders.ensure();
  T('E18 反复 ensure 不重新摇订单', sd.board.map((o) => o.id).join(',') === ids1);

  // ---------- 老存档：一次性清仓单 ----------
  d.warehouse = [];
  pool.slice(0, 3).forEach((c) => stock(c.id, 8));
  d.storeDemand = { day: '', staples: [], board: [], forecast: [], nextPostAt: 0, lastSyncAt: 0, source: 'local', clearedLegacy: false };
  Farm.orders.ensure();
  const clr = Farm.state.data.storeDemand.board.filter((o) => o.kind === 'clearance');
  dbg.clearance = clr.length;
  T('E19 老存档拿得到开业清仓单', clr.length === 1);
  T('E20 清仓单只发一次', (Farm.orders.ensure(), Farm.state.data.storeDemand.board.filter((o) => o.kind === 'clearance').length === 1));
  T('E21 清仓单不占接单位', Farm.orders.acceptedCount() < SD.ACCEPT_CAP);

  // ---------- 实体告示牌 ----------
  const boards = (d.map || []).filter((o) => o && o.type === 'board');
  dbg.boards = boards.length;
  T('E22 场上立着一块东超告示牌', boards.length === 1);
  if (boards.length) {
    const b = boards[0], iso = Farm.isoView;
    const bb = iso._bldgOf(b), th = iso._th();
    const cc = iso._cell(b.gx + (bb.w - 1) / 2, b.gy + (bb.h - 1) / 2);
    const front = iso._cell(b.gx + (bb.w - 1), b.gy + (bb.h - 1));
    const by = front.y + th / 2 + th * 0.18;
    const probes = [0.3, 0.6, 1.0, 1.4].map((k) => {
      const h = iso._buildingAtPoint(cc.x, by - th * k);
      return { k: k, type: h >= 0 ? (d.map[h] || {}).type : 'none' };
    });
    dbg.boardProbes = probes;
    T('E23 告示牌点得中', probes.some((p2) => p2.type === 'board'));
    // 不可拆：删除按钮不该出现
    T('E24 告示牌标了不可删除', !!(iso._bldgOf(b) && iso._bldgOf(b).noDelete));
  }

  // ---------- 改名 ----------
  const bodyTxt = document.body.innerText || '';
  T('E25 界面上找不到「小东」', bodyTxt.indexOf('小东') < 0);

  return { failures, dbg };
})()
