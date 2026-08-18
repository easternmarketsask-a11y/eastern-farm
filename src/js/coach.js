/**
 * coach.js — 渐进式规则引导（just-in-time 首次提示）。2026-06-11
 *
 * 设计原则（参考一流休闲游戏 onboarding）：不开局甩规则，在玩家"正好
 * 需要"的那一刻，用店主小东的一句话教一条；每条一生只弹一次，存档记录
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
  // 文案：看了舒服，但不废话（CLAUDE.md 文案原则）。
  const TIPS = {
    first_plant:    { zh: '种好了。熟了会发光，点一下就收。',
                      en: 'Planted. It’ll glow when ripe — tap to harvest.' },
    first_mature:   { zh: '熟了。点发光的地，收进谷仓。',
                      en: 'Ripe. Tap the glowing plot to harvest.' },
    first_warehouse:{ zh: '菜在谷仓里。一次多卖给超市更划算。',
                      en: 'It’s in the barn. Sell a batch to Eastern Market.' },
    first_sell:     { zh: '卖掉就有农场币。每天第一单 +20%。',
                      en: 'Selling earns coins. First sale each day: +20%.' },
    warehouse_full: { zh: '谷仓满了。先卖掉，或扩建。',
                      en: 'Barn is full. Sell, or expand it.' },
    first_coins_exchange: { zh: '点左上角金币，能换成超市积分。',
                            en: 'Tap the coin card to exchange for store points.' },
    first_water:    { zh: '点还在长的地浇水，熟得快两成。',
                      en: 'Tap a growing plot to water — 20% faster.' },
    first_neighbor: { zh: '去社区串个门、点个赞，也有农场币。',
                      en: 'Visit and like neighbors — you earn coins too.' },
    steal_unlocked: { zh: '可以顺菜了。去邻居家点熟了的，带一棵回来。',
                      en: 'You can grab now. Tap a ripe crop at a neighbor’s.' },
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
