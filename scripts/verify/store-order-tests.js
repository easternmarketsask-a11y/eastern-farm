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
    /* ⚠️ 探测点必须覆盖**整块牌面**，不能只探底下那截。
       早先只探到 1.0th，而牌子画到 2.5th 高 —— 于是「只有柱子能点中」这个 bug
       从测试里溜了过去（k=1.4 当时就返回 'none'，是我没追）。 */
    const probes = [0.3, 0.8, 1.3, 1.8, 2.2].map((k) => {
      const h = iso._buildingAtPoint(cc.x, by - th * k);
      return { k: k, type: h >= 0 ? (d.map[h] || {}).type : 'none' };
    });
    dbg.boardProbes = probes;
    const boardHits = probes.filter((p2) => p2.type === 'board').length;
    dbg.boardHits = boardHits;
    T('E23 整块牌面都点得中（不是只有柱子）', boardHits >= 4);
    // 不可拆：删除按钮不该出现
    T('E24 告示牌标了不可删除', !!(iso._bldgOf(b) && iso._bldgOf(b).noDelete));

    /* E26 端到端：**真的用手指点一下它，订单板要弹出来**
       （Chris 2026-08-22：「点击订单板可以查看订单」）。
       前面几条只证明命中判定认得它 —— 那不等于点了有反应，本仓反复出现的
       失败态正是「按钮在、点了没反应、也不报错」。这里派发真实指针事件走完整链路。 */
    if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
    await sleep(120);
    const cv = document.getElementById('isoCanvas');
    const rect = cv.getBoundingClientRect();
    const px = rect.left + cc.x, py = rect.top + (by - th * 0.6);
    const ev = (type) => cv.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, bubbles: true, cancelable: true, clientX: px, clientY: py,
      pointerType: 'touch', isPrimary: true,
    }));
    ev('pointerdown'); await sleep(60); ev('pointerup');
    await sleep(400);
    /* ⚠️ 只查 textContent 是**摆设**：hideModal 只是给 #modal 加 hidden，
       DOM 里的文字还在，前面几步 open() 留下的「东超订单」会一直匹配到 ——
       实测把点击派发整条删掉，这条断言照样绿。必须同时确认弹窗**真的可见**。 */
    const modalEl = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    const visible = !!(modalEl && !modalEl.classList.contains('hidden'));
    const hasOrders = !!(content && /东超订单|Eastern Market Orders/.test(content.textContent || ''));
    dbg.tapOpened = visible && hasOrders;
    dbg.tapVisible = visible;
    T('E26 点一下告示牌，订单板真的弹出来', visible && hasOrders);
    if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
  }

  // ---------- 老存档：牌子被甩远了要搬回谷仓边 ----------
  {
    const iso = Farm.isoView;
    const barn2 = (d.map || []).filter((o) => o && o.type === 'barn')[0];
    const bd2 = (d.map || []).filter((o) => o && o.type === 'board')[0];
    const ob2 = iso._ownedBounds();
    if (barn2 && bd2) {
      bd2.gx = ob2.x1; bd2.gy = ob2.y2;          // 模拟旧兜底甩到农场最前沿
      d.boardNearBarn = false;                    // 还没搬过家
      iso._ensureOrderBoard();
      const now2 = (d.map || []).filter((o) => o && o.type === 'board')[0];
      const dist = Math.max(Math.abs(now2.gx - barn2.gx), Math.abs(now2.gy - barn2.gy));
      dbg.relocDist = dist;
      T('E27 老存档里被甩远的牌子会搬回谷仓边', dist <= 4);
      // 玩家自己挪走之后不该再被拽回来（每次进场都拽＝跟玩家打架）
      now2.gx = ob2.x1 + 1; now2.gy = ob2.y2 - 1;
      iso._ensureOrderBoard();
      const after2 = (d.map || []).filter((o) => o && o.type === 'board')[0];
      T('E28 玩家自己挪走之后不再被拽回', after2.gx === ob2.x1 + 1 && after2.gy === ob2.y2 - 1);
    }
  }

  // ---------- 改名 ----------
  const bodyTxt = document.body.innerText || '';
  T('E25 界面上找不到「小东」', bodyTxt.indexOf('小东') < 0);

  return { failures, dbg };
})()
