/**
 * coach.js — 渐进式规则引导（just-in-time 首次提示）。2026-06-11
 *
 * 设计原则（参考一流休闲游戏 onboarding）：不开局甩规则，在玩家"正好
 * 需要"的那一刻，用店主东超的一句话教一条；每条一生只弹一次，存档记录
 * (state.coachSeen[id])，永不重复打扰。
 *
 *   Farm.coach.fire(id)          条件已满足时由各模块调用（首次才生效）
 *   Farm.coach.tip(id, force?)   直接展示某条提示（force 跳过 seen 判断）
 *   Farm.coach.seen(id)          是否已展示过
 *
 * 展示方式：店主气泡 + 轻 toast 兜底（气泡不存在时）。规则文案集中在
 * 下方 TIPS 表，中英双语，便于 Chris 调措辞。
 */
(function () {
  // 文案：完整清楚，不口号化。2026-08-18 改软被否（「这一版改不如不改」）。
  const TIPS = {
    first_plant:    { zh: '已种下。成熟后地块会发光，点一下即可收获。',
                      en: 'Planted. Ripe plots glow — tap to harvest.' },
    first_mature:   { zh: '作物已成熟。点发光的地块收入谷仓。',
                      en: 'A crop is ripe. Tap the glowing plot to harvest.' },
    /* 2026-08-22：东方超市不再无限收购，卖菜只能按订单供货。
       文案跟着改，但保持完整句、不切碎、不卖萌（CLAUDE.md 文案原则）。 */
    first_warehouse:{ zh: '收获先进谷仓。东超要什么，你就交什么。',
                      en: 'Harvests go to the barn. Fill Eastern Market orders to sell them.' },
    first_sell:     { zh: '交订单可得农场币，每天第一单额外 +20%。',
                      en: 'Filling orders earns coins. First order each day: +20%.' },
    warehouse_full: { zh: '谷仓已满。请先出售，或扩建谷仓。',
                      en: 'Barn is full. Sell first, or expand it.' },
    first_coins_exchange: { zh: '点左上角金币，可将农场币兑换为超市积分。',
                            en: 'Tap the coin card to exchange coins for store points.' },
    first_water:    { zh: '点生长中的地块浇水，成熟时间缩短 20%。',
                      en: 'Tap a growing plot to water it — 20% faster.' },
    first_neighbor: { zh: '右下「邻居」能看见今天谁在种菜。走进去可以浇水，熟了的菜可以顺一棵。',
                      en: 'Tap Neighbors (bottom-right) to see who is farming today. Walk in to water, or take a ripe crop.' },
    steal_unlocked: { zh: '可以去邻居家点成熟的菜，顺走一棵放进谷仓。',
                      en: 'You can tap a ripe crop at a neighbor’s farm and take one to your barn.' },
  };

  const coach = {
    seen(id) {
      const m = (Farm.state && Farm.state.data && Farm.state.data.coachSeen) || {};
      return !!m[id];
    },

    // 直接展示一条提示。force=true 跳过 seen 判断（如解锁庆祝）。
    tip(id, force) {
      const t = TIPS[id];
      if (!t) return false;
      if (!force && this.seen(id)) return false;
      const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
      const text = lang === 'en' ? t.en : t.zh;
      this._mark(id);
      // 店主气泡优先（更柔和、有角色感），并加一下抖动吸引注意；
      // 气泡不存在（弹窗占屏等）时回落到 toast。
      const bubble = document.getElementById('storekeeperBubble');
      if (bubble && Farm.ui && Farm.ui.setStorekeeperLine) {
        Farm.ui.setStorekeeperLine(text);
        const wrap = document.getElementById('storekeeper');
        if (wrap) {
          wrap.classList.remove('coach-nudge');
          void wrap.offsetWidth;
          wrap.classList.add('coach-nudge');
        }
      } else if (Farm.ui && Farm.ui.toast) {
        Farm.ui.toast(text, 4200);
      }
      return true;
    },

    // 条件满足时调用：首次才展示。稍延迟，避开同时触发的庆祝/弹窗。
    fire(id, delayMs) {
      if (this.seen(id)) return;
      // 新手聚光灯进行时别抢话——它正手把手教同样的几步。不标记 seen，
      // 等之后第二次种/收/卖时 coach 再补讲（first_plant 是一次性除外）。
      if (Farm.spotlight && Farm.spotlight._active) return;
      setTimeout(() => this.tip(id), delayMs == null ? 700 : delayMs);
    },

    _mark(id) {
      if (!Farm.state || !Farm.state.data) return;
      const m = (Farm.state.data.coachSeen = Farm.state.data.coachSeen || {});
      if (m[id]) return;
      m[id] = Date.now();
      Farm.state.save();
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.coach = coach;
})();
