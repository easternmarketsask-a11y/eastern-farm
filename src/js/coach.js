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
  // id → { zh, en }。措辞口语、友好、不说教（呼应 Chris 的语气偏好）。
  const TIPS = {
    // —— 核心循环 ——
    first_plant:    { zh: '🌱 种下啦！耐心等一会儿，熟了的地会发光，点一下就能收。',
                      en: '🌱 Planted! Give it time — ripe plots glow, just tap to harvest.' },
    first_mature:   { zh: '🌟 有菜熟啦！点一下亮闪闪的地块就能收进谷仓。',
                      en: '🌟 A crop is ripe! Tap the glowing plot to harvest it.' },
    first_warehouse:{ zh: '📦 收的菜先进谷仓，攒一攒一次卖给东方超市更划算。',
                      en: '📦 Harvests go to the barn — sell a batch to Eastern Market for more.' },
    first_sell:     { zh: '🏪 卖菜赚农场币！每天第一笔还有 +20% 加成哦。',
                      en: '🏪 Selling earns coins — your first sale each day gets +20%!' },
    warehouse_full: { zh: '📦 谷仓满了～卖给东方超市清空，或点谷仓扩建。',
                      en: '📦 Barn is full — sell to Eastern Market, or expand it.' },
    // —— 货币 / 兑换 ——
    first_coins_exchange: { zh: '🪙 农场币攒到一些啦！点左上角金币卡，可换成超市积分。',
                            en: '🪙 Got some coins! Tap the coin card to swap them for store points.' },
    // —— 打理 ——
    first_water:    { zh: '💧 点生长中的地可以浇水，缩短 20% 成熟时间，免费的～',
                      en: '💧 Tap a growing plot to water it — 20% faster, free!' },
    // —— 社区 ——
    first_neighbor: { zh: '🏘 去社区给邻居点赞、串门，还能赚农场币，热闹起来吧！',
                      en: '🏘 Visit neighbors to like & drop by — earns coins too!' },
    // —— 解锁（配合等级门槛）——
    steal_unlocked: { zh: '🧺 解锁顺菜啦！去邻居家点熟了的菜，顺一棵回自己谷仓～',
                      en: '🧺 Grabbing unlocked! Tap a ripe crop at a neighbor’s to take one home.' },
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
