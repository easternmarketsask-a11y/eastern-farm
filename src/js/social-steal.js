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

    // ===== 被偷结算（回家时一次性，非确定性；结果存 raidLog，不重算）=====
    // 按角色给 AI 打分挑 n 个：小贼偏馋嘴/活跃/你偷过的；帮手偏热心/你帮过赞过的。
    _pickActors(role, n, now) {
      if (n <= 0 || !Farm.aiNeighbors) return [];
      const rel = Farm.state.data.aiRelationships || {};
      const scored = Farm.aiNeighbors.ids().map(id => {
        const pers = Farm.aiNeighbors.personality(id);
        const active = Farm.aiNeighbors.isActiveNow(id, now);
        const r = rel[id] || {};
        let score = Math.random();
        if (role === 'thief') {
          if (pers === 'greedy') score += 1.2;
          if (pers === 'kind') score -= 0.8;
          if (r.stolenByMe) score += 0.8;   // 你偷过 TA → TA 更可能来顺你
          if (active) score += 0.4;
        } else {
          if (pers === 'kind') score += 1.2;
          if (pers === 'greedy') score -= 0.6;
          if (r.helpedByMe || r.likedByMe) score += 1.0; // 你帮过/赞过 → 回礼
          if (active) score += 0.3;
        }
        return { id, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, n).map(x => x.id);
    },

    _helpCount(awayMs) {
      const hrs = awayMs / 3600000;
      if (hrs >= 8) return 2;
      if (hrs >= 3) return 1;
      return Math.random() < 0.6 ? 1 : 0;  // 保证好消息常有，平衡情绪
    },

    settleRaid(awayMs) {
      const cfg = socialConfig;
      const result = { stolen: [], helped: [], awayMs: awayMs };
      if (!awayMs || awayMs < cfg.RAID_MIN_AWAY) return result; // 离开<2h 零损失
      const now = Date.now();
      const plots = Farm.state.data.plots;

      // 候选 = 已熟、未收、未受保护的地块
      const matureIdx = [];
      plots.forEach((p, i) => { if (p.unlocked && p.crop && Farm.crops.isMature(p)) matureIdx.push(i); });
      let maxSteal = cfg.RAID_MAX_PLOTS;
      if (Farm.defenses && Farm.defenses.raidReduction) {
        maxSteal = Math.max(0, maxSteal - Farm.defenses.raidReduction());
      }
      const hrs = awayMs / 3600000;
      const nSteal = Math.min(maxSteal, matureIdx.length, hrs >= 6 ? maxSteal : 1);
      const thieves = this._pickActors('thief', Math.max(1, nSteal), now);

      for (let k = 0; k < nSteal; k++) {
        const idx = matureIdx[k];
        const p = plots[idx];
        const cropId = p.crop;
        const thief = thieves[k % thieves.length];
        // 看家狗抓贼（T6 提供 catchThief）：拦下并反转为好消息（赔礼入仓，地块保留）
        if (Farm.defenses && Farm.defenses.catchThief && Farm.defenses.catchThief()) {
          Farm.state.addToWarehouse(cropId);
          result.helped.push({ aiId: thief, kind: 'caught', cropId: cropId });
          continue;
        }
        // 顺走：清空该地块（等同被邻居替你收了）。仓库不碰。
        p.crop = null; p.plantedAt = 0; p.harvestsLeft = 0; p.watered = false; p.fertilized = false;
        if (Farm.aiNeighbors) Farm.aiNeighbors._rel(thief).stoleFromMe = true;
        result.stolen.push({ aiId: thief, cropId: cropId, count: 1 });
      }

      // 互助好消息（真生效：帮浇水加速 / 送农场币）
      const helpers = this._pickActors('helper', this._helpCount(awayMs), now);
      helpers.forEach(aiId => {
        const growing = plots.find(p => p.unlocked && p.crop && !Farm.crops.isMature(p) && !p.watered);
        if (growing && Math.random() < 0.6 && Farm.tending) {
          Farm.tending.applyWaterSpeedup(growing);
          result.helped.push({ aiId: aiId, kind: 'water', cropId: growing.crop });
        } else {
          Farm.state.addCoins(20);
          result.helped.push({ aiId: aiId, kind: 'coins', amount: 20 });
        }
        if (Farm.aiNeighbors) Farm.aiNeighbors._rel(aiId).owesMeGift = false;
      });

      Farm.state.data.raidLog = { at: now, stolen: result.stolen, helped: result.helped };
      Farm.state.save();
      return result;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.socialConfig = socialConfig;
  window.Farm.steal = steal;
})();
