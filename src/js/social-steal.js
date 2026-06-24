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
    // ===== 真会员互偷（spec 2026-06-11）=====
    STEAL_UNLOCK_LEVEL: 7,            // 自己达到 Lv7 才解锁"顺菜"功能（Chris 2026-06-11）
    LOST_DAILY_MAX: 3,                // 每天最多被真人偷走的棵数（超出的事件作废）
    NEWBIE_PROTECT_LEVEL: 3,          // victim level < 3 不可被偷
    DOG_CATCH_CHANCE: 0.2,            // 对方有狗时小偷被抓概率
    DOG_CAUGHT_FINE: 20,              // 被抓赔礼农场币（小偷付出/受害者收到）
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

    // ===== 真会员互偷：小偷端（spec 2026-06-11）=====
    // 从真会员农场顺一棵：本地限额（与 AI 共用同一套每日/单户计数）→
    // 看家狗判定（限额收紧 + 概率被抓赔礼）→ 入仓 → 事件写对方文档。
    // victim: { uid, name, level, hasGuardDog }；plotInfo: { plotIdx, cropId, plantedAt }
    async stealFromReal(victim, plotInfo) {
      const lang = Farm.state.data.language || 'zh';
      // 自己未到解锁等级 → 不能顺菜（UI 已隐藏可偷态，这里是兜底）
      if ((Farm.state.data.level || 1) < socialConfig.STEAL_UNLOCK_LEVEL) {
        return { ok: false, reason: 'locked',
          message: lang === 'en'
            ? `🔒 Reach Lv${socialConfig.STEAL_UNLOCK_LEVEL} to unlock grabbing crops`
            : `🔒 农场到 Lv${socialConfig.STEAL_UNLOCK_LEVEL} 才解锁顺菜哦` };
      }
      if ((victim.level || 1) < socialConfig.NEWBIE_PROTECT_LEVEL) {
        return { ok: false, reason: 'newbie_protected' };
      }
      // 对方有狗 → 该户上限收紧 1 棵（在 canStealFrom 的统一限额之上再卡）
      const c = Farm.state.data.dailyClaims;
      const fromThis = (c.stolenFromTargets || {})[victim.uid] || 0;
      if (victim.hasGuardDog && fromThis >= Math.max(1, this.perTargetCap(victim.uid) - socialConfig.DOG_PROTECT)) {
        return { ok: false, reason: 'dog_cap',
          message: lang === 'en'
            ? '🐕 Their guard dog is watching — that\'s all you can grab here today.'
            : '🐕 TA 家的狗盯得紧，今天这里就只能顺这么多啦' };
      }
      const can = this.canStealFrom(victim.uid);
      if (!can.ok) return can;

      // 看家狗抓贼：偷不到，赔礼 20 币写给对方（小报好消息）
      if (victim.hasGuardDog && Math.random() < socialConfig.DOG_CATCH_CHANCE) {
        const fine = socialConfig.DOG_CAUGHT_FINE;
        if (Farm.state.data.coins >= fine) Farm.state.spendCoins(fine);
        // 计数照记：被抓也消耗当日对该户的尝试次数，防无限白嫖重试
        c.stolenFromTargets = c.stolenFromTargets || {};
        c.stolenFromTargets[victim.uid] = fromThis + 1;
        Farm.state.save();
        if (Farm.fbGameSync && Farm.fbGameSync.sendStealEvent) {
          Farm.fbGameSync.sendStealEvent(victim.uid, {
            kind: 'caught', plotIdx: plotInfo.plotIdx, cropId: plotInfo.cropId,
            plantedAt: plotInfo.plantedAt, coins: fine,
          });
        }
        return { ok: false, reason: 'caught', fine,
          message: lang === 'en'
            ? '🐕 Caught by the guard dog! Paid ' + fine + ' coins to apologize…'
            : '🐕 被看家狗逮个正着！赔了 ' + fine + ' 农场币道歉…' };
      }

      const r = this.stealOne(victim.uid, plotInfo.cropId);
      if (!r.ok) return r;
      if (Farm.fbGameSync && Farm.fbGameSync.sendStealEvent) {
        Farm.fbGameSync.sendStealEvent(victim.uid, {
          kind: 'steal', plotIdx: plotInfo.plotIdx, cropId: plotInfo.cropId,
          plantedAt: plotInfo.plantedAt,
        });
      }
      return r;
    },

    // ===== 真会员互偷：受害者结算（上线时调用一次）=====
    // 拉取 stealEvents → 逐条验证 (plotIdx,cropId,plantedAt) 三元组仍匹配且
    // 已熟未收 → 清地块（受 LOST_DAILY_MAX 封顶 + 新手保护兜底）。
    // 'caught' 事件 = 好消息：狗抓住了贼，+赔礼币。
    // 返回 home-report 形状 { stolen:[], helped:[] }，事件自带 name。
    async settleRealEvents(prefetchedEvts) {
      if (!Farm.fbGameSync || !Farm.fbGameSync.fetchAndClearStealEvents) {
        return { stolen: [], helped: [] };
      }
      // 调用方可传入已拉取的事件（fetchAndClearInbox 一读多用）；
      // 不传则自己拉（向后兼容/独立调用）。
      const evts = Array.isArray(prefetchedEvts)
        ? prefetchedEvts
        : await Farm.fbGameSync.fetchAndClearStealEvents();
      const out = { stolen: [], helped: [] };
      if (!evts.length) return out;

      const myLevel = Farm.state.data.level || 1;
      const c = Farm.state.data.dailyClaims;
      let lostToday = c.lostToRealToday || 0;
      const plots = Farm.state.data.plots;

      evts.sort((a, b) => (a.at || 0) - (b.at || 0));
      for (const e of evts) {
        const name = e.thiefName || '邻居';
        if (e.kind === 'caught') {
          // 狗替你抓住了贼：收下赔礼
          Farm.state.addCoins(e.coins || socialConfig.DOG_CAUGHT_FINE);
          out.helped.push({ kind: 'caught', name, cropId: e.cropId, realUid: e.thiefUid });
          continue;
        }
        // 新手保护兜底（偷端已禁，老客户端/作弊兜底）
        if (myLevel < socialConfig.NEWBIE_PROTECT_LEVEL) continue;
        if (lostToday >= socialConfig.LOST_DAILY_MAX) continue;   // 被偷封顶，超出作废
        const p = plots[e.plotIdx];
        // 同茬验证：同一块地、同一种菜，且当前 plantedAt ≤ 事件快照值。
        // 浇水/加速会把 plantedAt 改小（crops.speedUp），精确相等会把
        // "被偷后又打理过"的合法事件错误作废；而重放旧事件时快照值
        // 必然小于新一茬的 plantedAt，方向性比较照样挡得住。
        if (!p || !p.unlocked || p.crop !== e.cropId) continue;
        if ((p.plantedAt || 0) > (e.plantedAt || 0)) continue;   // 新茬 → 旧事件作废
        if (!Farm.crops.isMature(p)) continue;   // 调性红线：只动已熟未收
        // 小偷只顺走"这一茬"——等同替你收了一次：
        //   多季作物(harvestsLeft>1) → 减一茬 + 重置生长，剩余收成保留;
        //   单季/最后一茬 → 清空地块。仓库永不被碰。施肥标记本就只作用本茬。
        const def = Farm.crops.get(p.crop);
        if (p.harvestsLeft > 1 && def) {
          p.harvestsLeft -= 1;
          // Use the canonical regrow math (divides by THIS player's growMultiplier).
          // The old inline formula omitted that division, so a victim with a
          // greenhouse/well had stolen multi-harvest crops regrow INSTANTLY mature.
          Farm.crops.startRegrowCycle(p, def);
          p.fertilized = false;
        } else {
          p.crop = null; p.plantedAt = 0; p.harvestsLeft = 0; p.watered = false; p.fertilized = false;
        }
        lostToday += 1;
        out.stolen.push({ kind: 'steal', name, cropId: e.cropId, count: 1, realUid: e.thiefUid });
      }
      c.lostToRealToday = lostToday;
      Farm.state.save();
      return out;
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
      let nSteal = Math.min(maxSteal, matureIdx.length, hrs >= 6 ? maxSteal : 1);
      const thieves = this._pickActors('thief', Math.max(1, nSteal), now);
      // 没有可用的"邻居"(如 AI 关闭且无真会员) ⇒ 不发生偷菜，绝不用 undefined 顶替小贼
      if (thieves.length === 0) nSteal = 0;

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

  // ===== 防御：看家狗（T6）=====
  // 拥有 guard_dog 装饰 = 看家狗在岗（复用现有 pet 装饰渲染，农场里会溜达一只狗）。
  // 单一数据源：是否在岗读 decorations，不另存 defenses 字段。
  const defenses = {
    hasDog() {
      const decos = Farm.state.data.decorations || [];
      return decos.some(d => d.itemId === 'guard_dog');
    },
    // settleRaid 调：在岗狗使被偷上限 -DOG_PROTECT。
    raidReduction() {
      return this.hasDog() ? socialConfig.DOG_PROTECT : 0;
    },
    // settleRaid 调：在岗狗有概率抓住小贼（拦下 + 反转为赔礼好消息）。
    catchThief() {
      if (!this.hasDog()) return false;
      return Math.random() < 0.35;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.socialConfig = socialConfig;
  window.Farm.steal = steal;
  window.Farm.defenses = defenses;
})();
