/**
 * social-steal.js — 邻里偷菜：调参中心 + 主动偷规则 + 被偷结算（spec 2026-06-09 ①）。
 *
 * 调性红线（硬约束）：只动"已熟未收"的菜、仓库永不被碰、离开<2h 零损失、
 * 单次离开最多被顺 RAID_MAX_PLOTS、主动偷到的 >> 被偷走的（净占便宜）、
 * 话术"顺/尝鲜/串门"不用"偷/抢"。
 *
 *   Farm.socialConfig            全部调参常量集中处（T1 浇水比例也并此）
 *   Farm.steal.canStealFrom(id)  今日是否还能从该对象顺
 *   Farm.steal.stealOne(id,crop) 顺一棵入仓（遵守仓库满+每日/单户上限）
 *   Farm.steal.settleRaid(...)   被偷结算（T5 实现）
 */
(function () {
  // 集中调参（上线后看反应再调；T7 净占便宜校准只动这里）。
  const socialConfig = {
    RAID_MIN_AWAY: 2 * 60 * 60 * 1000, // 离开 < 2h 一律零损失
    RAID_MAX_PLOTS: 2,                 // 单次离开最多被顺的地块数
    STEAL_MAX_PER_DAY: 6,              // 你每天最多主动顺的总块数（远大于被偷 → 净占便宜）
    STEAL_PER_TARGET: 2,              // 每个对象每天最多顺几块
    WATER_SPEEDUP: 0.2,               // 浇水：剩余生长时间 -20%（tending.js 共用）
    FERT_YIELD_MULT: 2,               // 施肥：产量 ×2
    DOG_PROTECT: 1,                   // 看家狗在岗：被偷上限 -1（T6）
  };

  const steal = {
    _grace: {},  // 讨回来宽限：{targetId: 额外可顺块数}（会话内，T5 的"去讨回来"授予）

    grantGrace(targetId, n) {
      this._grace[targetId] = (this._grace[targetId] || 0) + (n || 1);
    },

    perTargetCap(targetId) {
      return socialConfig.STEAL_PER_TARGET + (this._grace[targetId] || 0);
    },

    // 今日是否还能从该对象顺一棵。
    canStealFrom(targetId) {
      const c = Farm.state.data.dailyClaims;
      if ((c.stolenToday || 0) >= socialConfig.STEAL_MAX_PER_DAY) {
        return { ok: false, reason: 'daily_cap' };
      }
      const perT = (c.stolenFromTargets || {})[targetId] || 0;
      if (perT >= this.perTargetCap(targetId)) {
        return { ok: false, reason: 'target_cap' };
      }
      return { ok: true };
    },

    // 顺一棵入自己仓库。遵守仓库满判定（满则不顺成）+ 每日/单户上限。
    stealOne(targetId, cropId) {
      const can = this.canStealFrom(targetId);
      if (!can.ok) return can;
      const wh = Farm.state.addToWarehouse(cropId);
      if (!wh.ok) return { ok: false, reason: 'warehouse_full' };
      const c = Farm.state.data.dailyClaims;
      c.stolenToday = (c.stolenToday || 0) + 1;
      c.stolenFromTargets = c.stolenFromTargets || {};
      c.stolenFromTargets[targetId] = (c.stolenFromTargets[targetId] || 0) + 1;
      // 记 AI 关系：你顺过 TA → TA 下次更可能来顺你（T5 反应）
      if (Farm.aiNeighbors && Farm.aiNeighbors.get(targetId)) {
        Farm.aiNeighbors._rel(targetId).stolenByMe = true;
      }
      Farm.state.save();
      return {
        ok: true,
        stolen: cropId,
        remainingToday: socialConfig.STEAL_MAX_PER_DAY - c.stolenToday,
        remainingTarget: this.perTargetCap(targetId) - c.stolenFromTargets[targetId],
      };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.socialConfig = socialConfig;
  window.Farm.steal = steal;
})();
