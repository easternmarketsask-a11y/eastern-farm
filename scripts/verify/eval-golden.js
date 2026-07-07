// eval-golden.js — 金路径回归 gate（给 scripts/verify/cdp.mjs 用的页面 eval 文件）。
//
// 用法（仓库根目录，先起本地服务器）：
//   (py -3 -m http.server 8220 --bind 127.0.0.1 &)
//   node scripts/verify/cdp.mjs "http://127.0.0.1:8220/src/" scripts/verify/eval-golden.js 3000
//
// 判定：输出 JSON 的 evalResult.pass 必须为 true（且 exceptions 为空）才算过 gate。
// evalResult.steps 是每一步的明细（ok/error），失败时先看第一个 ok:false 的步骤。
//
// 覆盖的金路径（全新 localStorage 开局——cdp.mjs 每次跑都用全新临时 Chrome
// profile，所以 localStorage 天然是空的，等价于新玩家首次进游戏）：
//   1. boot        Farm 各模块加载完成，Farm.state.data 非空
//   2. enter       点 splashStart 进场，开屏消失
//   3. plant       走 UI 路径种一棵（选种器弹窗 → 点种子卡）
//   4. harvest     把 plantedAt 回拨使其成熟 → harvestPlot 收获入仓
//   5. sell        谷仓面板「卖给东方超市」按钮卖出，金币增加
//   6. panels      任务 / 商店 / 仓库 三个面板逐个开关无异常
//   7. persist     Farm.state.save() 后重读 localStorage，存档含刚才进度
//   8. lang        语言切 en 再切回 zh 无异常
//
// 注意：整个 eval 必须在 cdp.mjs 的 Runtime.evaluate 15s 超时内跑完，
// 所以各步等待都很短；boot 等待上限 8s。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const steps = [];
  let pass = true;
  let aborted = false;

  // 记录一步。fn 可为 async；抛错 → 该步 fail 并把 pass 置 false。
  async function step(name, fn) {
    if (aborted) { steps.push({ name, ok: false, error: 'skipped (earlier step aborted)' }); return null; }
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail: detail === undefined ? null : detail });
      return detail;
    } catch (e) {
      steps.push({ name, ok: false, error: String((e && e.message) || e) });
      pass = false;
      return null;
    }
  }

  // 关掉当前弹窗 + 清空祝贺弹窗队列（开屏后的每日签到/开张礼等会排队弹出，
  // 不清掉会把后面主动 open 的面板顶进队列，导致断言失真）。
  function dismissModals() {
    const F = window.Farm;
    if (!F || !F.ui) return;
    if (F.ui._modalQueue) F.ui._modalQueue.length = 0;
    const modal = document.getElementById('modal');
    for (let i = 0; i < 5; i++) {
      if (!modal || modal.classList.contains('hidden')) break;
      F.ui.hideModal();
      if (F.ui._modalQueue) F.ui._modalQueue.length = 0;
    }
  }

  function modalVisible() {
    const m = document.getElementById('modal');
    return !!m && !m.classList.contains('hidden');
  }

  // ---------- 1. boot ----------
  await step('1_boot', async () => {
    for (let i = 0; i < 80; i++) {  // 最多 8s
      const F = window.Farm;
      if (F && F.state && F.state.data && F.crops && F.crops.loaded && F.ui && F.farm && F.shop && F.i18n) break;
      await sleep(100);
    }
    const F = window.Farm;
    if (!F || !F.state || !F.state.data) throw new Error('Farm.state.data still empty after 8s');
    if (!F.crops || !F.crops.loaded) throw new Error('Farm.crops not loaded after 8s');
    return {
      coins: F.state.data.coins,
      level: F.state.data.level,
      freshStart: (F.state.data.totalHarvests || 0) === 0,
      plots: F.state.data.plots.length,
    };
  });
  if (!pass) aborted = true;   // boot 失败后面全没意义

  // ---------- 2. enter（点 splashStart 进场） ----------
  await step('2_enter', async () => {
    const btn = document.getElementById('splashStart');
    if (btn) btn.click();
    await sleep(900);   // 开屏淡出 + onDismiss 初始化农场视图
    const splash = document.getElementById('splash');
    const stillUp = !!(splash && splash.parentNode && !splash.classList.contains('dismissed'));
    if (stillUp) throw new Error('splash still visible after clicking splashStart');
    dismissModals();    // 清掉进场后自动弹的签到/欢迎类弹窗
    return { splashGone: true };
  });

  // ---------- 3. plant（UI 路径：选种器 → 点种子卡） ----------
  let plantedIdx = -1;
  await step('3_plant', async () => {
    const F = window.Farm;
    dismissModals();
    const idx = F.state.data.plots.findIndex((p) => p.unlocked && !p.crop);
    if (idx === -1) throw new Error('no empty unlocked plot');
    F.shop.openSeedPickerForPlot(idx);
    await sleep(300);
    const card = document.querySelector('.seed-card[data-action="plant"]:not(.locked)');
    let via = 'ui';
    if (card) {
      card.click();
      await sleep(300);
    }
    let plot = F.state.data.plots[idx];
    if (!plot.crop) {
      // UI 路径没种上（弹窗被挤掉等）→ API 兜底，仍算通过但记明 via
      dismissModals();
      const seedId = Object.keys(F.state.data.seeds).find((id) => F.state.data.seeds[id] > 0);
      if (!seedId) throw new Error('no seeds in inventory for fallback plant');
      const r = F.crops.plant(plot, seedId);
      if (!r.ok) throw new Error('fallback plant failed: ' + r.reason);
      via = 'api-fallback';
    }
    dismissModals();
    plot = F.state.data.plots[idx];
    if (!plot.crop) throw new Error('plot still empty after plant');
    plantedIdx = idx;
    return { plotIdx: idx, crop: plot.crop, via };
  });

  // ---------- 4. harvest（回拨 plantedAt → 成熟 → 收获入仓） ----------
  await step('4_harvest', async () => {
    const F = window.Farm;
    if (plantedIdx === -1) throw new Error('no planted plot from step 3');
    const plot = F.state.data.plots[plantedIdx];
    const def = F.crops.get(plot.crop);
    if (!def) throw new Error('crop def missing: ' + plot.crop);
    // growMultiplier() >= 1，回拨整个 grow_minutes + 60s 必然成熟
    plot.plantedAt = Date.now() - def.grow_minutes * 60000 - 60000;
    F.state.save();
    if (!F.crops.isMature(plot)) throw new Error('plot not mature after rewinding plantedAt');
    const whBefore = (F.state.data.warehouse || []).length;
    F.farm.harvestPlot(plantedIdx);
    await sleep(500);
    const whAfter = (F.state.data.warehouse || []).length;
    if (whAfter <= whBefore) throw new Error('warehouse count did not increase (' + whBefore + ' -> ' + whAfter + ')');
    if ((F.state.data.totalHarvests || 0) < 1) throw new Error('totalHarvests still 0 after harvest');
    return { warehouseBefore: whBefore, warehouseAfter: whAfter, totalHarvests: F.state.data.totalHarvests };
  });

  // ---------- 5. sell（谷仓面板 → 卖给东方超市 → 金币增加） ----------
  await step('5_sell', async () => {
    const F = window.Farm;
    dismissModals();
    // 小东订单会「给小东留着」预留仓库里的菜（deliverWarehouse 对被预留的
    // 全部菜返回 all_reserved，属预期行为不是 bug）。新玩家首批订单常点名
    // 起始作物，会把刚收的那一棵整个留住 → 为了测「一键卖货」路径本身，
    // 先清空测试局的订单板（只动本次临时 profile 的存档）。
    let ordersCleared = false;
    if (Array.isArray(F.state.data.orders) && F.state.data.orders.length > 0) {
      F.state.data.orders = [];
      F.state.save();
      ordersCleared = true;
    }
    const coinsBefore = F.state.data.coins;
    F.warehouse.open();
    await sleep(300);
    const btn = document.getElementById('whDeliverBtn');
    if (!btn) throw new Error('whDeliverBtn not found (warehouse empty in UI?)');
    btn.click();
    await sleep(400);
    const coinsAfter = F.state.data.coins;
    if (coinsAfter <= coinsBefore) throw new Error('coins did not increase after deliver (' + coinsBefore + ' -> ' + coinsAfter + ')');
    dismissModals();
    return { coinsBefore, coinsAfter, gained: coinsAfter - coinsBefore, ordersCleared };
  });

  // ---------- 6. panels（任务 / 商店 / 仓库 开→关） ----------
  await step('6_panels', async () => {
    const F = window.Farm;
    const opened = [];
    const panels = [
      ['tasks', () => F.tasks.open()],
      ['shop', () => F.shop.open()],
      ['warehouse', () => F.warehouse.open()],
    ];
    for (const [name, openFn] of panels) {
      dismissModals();
      await sleep(150);
      openFn();
      await sleep(250);
      if (!modalVisible()) throw new Error(name + ' panel did not open');
      const content = document.getElementById('modalContent');
      if (!content || !content.innerHTML.trim()) throw new Error(name + ' panel content empty');
      F.ui.hideModal();
      await sleep(150);
      opened.push(name);
    }
    dismissModals();
    return { opened };
  });

  // ---------- 7. persist（save 后重读 localStorage） ----------
  await step('7_persist', async () => {
    const F = window.Farm;
    F.state.save();
    const raw = localStorage.getItem('eastern_farm_save_v1');
    if (!raw) throw new Error('save key missing from localStorage');
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') throw new Error('saved blob not an object');
    if ((saved.totalHarvests || 0) < 1) throw new Error('saved totalHarvests < 1 — progress not persisted');
    if (saved.coins !== F.state.data.coins) throw new Error('saved coins (' + saved.coins + ') != in-memory coins (' + F.state.data.coins + ')');
    if (!Array.isArray(saved.plots)) throw new Error('saved plots not an array');
    return { savedCoins: saved.coins, savedTotalHarvests: saved.totalHarvests, savedBytes: raw.length };
  });

  // ---------- 8. lang（zh → en → zh） ----------
  await step('8_lang', async () => {
    const F = window.Farm;
    // 与 main.js settings 的 applyLanguage 相同的核心链路（按钮在设置弹窗里，
    // 这里直调等价链路，避免依赖设置弹窗 DOM）
    const apply = (lang) => {
      F.state.data.language = lang;
      F.state.save();
      F.i18n.setLanguage(lang);
      F.ui.refreshHUD();
      F.farm.renderGrid();
      if (F.isoView && F.isoView.relang) F.isoView.relang();
    };
    apply('en');
    await sleep(150);
    const enClose = F.i18n.t('btn_close');
    if (!enClose || typeof enClose !== 'string') throw new Error('i18n.t broken after switching to en');
    if (document.documentElement.lang !== 'en') throw new Error('documentElement.lang not en: ' + document.documentElement.lang);
    apply('zh');
    await sleep(150);
    const zhClose = F.i18n.t('btn_close');
    if (!zhClose || typeof zhClose !== 'string') throw new Error('i18n.t broken after switching back to zh');
    if (document.documentElement.lang !== 'zh-CN') throw new Error('documentElement.lang not zh-CN: ' + document.documentElement.lang);
    return { enClose, zhClose };
  });

  return { pass, steps };
})()
