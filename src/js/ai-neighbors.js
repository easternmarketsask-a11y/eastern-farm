/**
 * ai-neighbors.js — 本地确定性 AI 邻居引擎（spec 2026-06-09 方向①）。
 *
 * 人少阶段撑场子，但要"够真"：每个 AI 有固定身份/性格/作息，农场随真实时间
 * 播种→生长→成熟（有真实可偷的熟菜，T4 用），等级随天数缓慢上涨（排行榜是活的）。
 * 全部是 f(seed, now) 的纯函数 + 本地状态，不连服务器、离线可算。
 *
 *   Farm.aiNeighbors.load()                  读名册
 *   Farm.aiNeighbors.get(id)                 名册条目
 *   Farm.aiNeighbors.levelAt(id, now)        随天数上涨的等级
 *   Farm.aiNeighbors.farmStateAt(id, now)    12 块地 [{cropId,stage,mature}]
 *   Farm.aiNeighbors.farmDisplay(id, now)    {plots,decos}（喂 neighbors.viewFarm）
 *   Farm.aiNeighbors.isActiveNow(id, now)    当前是否在作息活跃时段
 *   Farm.aiNeighbors.displayCard(id, now)    混排进今日/排行榜的条目
 *   Farm.aiNeighbors.metricValue(id, m, now) 排行榜某指标的值
 *   Farm.aiNeighbors.dailyPick(n, dateStr)   今日确定性挑 n 个 AI 补位
 *   Farm.aiNeighbors.interact(id, kind, emoji) 本地点赞/帮忙/贴纸（不写云端）
 */
(function () {
  // 名义生长周期：固定 14h（> 最长作物 12h），让每块地都能在周期内成熟，
  // 余下时间为"熟菜停留窗口"。长作物→大多在长、短作物→大多已熟，自然形成混合。
  const NOMINAL_CYCLE = 14 * 60 * 60 * 1000;
  const DAY_MS = 86400000;

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  const ai = {
    // 总开关：关闭后所有"假邻居"从今日/排行榜/顺菜/被偷小报中消失，
    // 社交面板只显示真会员（没有就显示邀请态）。数据/代码保留，可逆。
    // 2026-07-02 改「按需补位」重新点亮：不再全员上阵，maxFill 限定每天
    // 最多出场几个 AI（今日邻居补位/排行榜混排/离线掠夺选角共用同一份
    // todaysCast 小名单）——保证走访/偷菜/小报永远有内容，又不至于满村假人。
    // 真会员徽章（✨）仍然只给真人，AI 与真人的区分不变。
    enabled: true,
    // 每天最多出场的 AI 数（真会员足够时自然一个都不上）
    maxFill: 2,
    roster: [],
    byId: {},
    levelEpoch: '2026-04-01',
    loaded: false,

    /* ⛔ AI 假人已于 2026-08-14 全面退役(Chris:「删除所有虚假的称呼——
       王阿姨、李大爷、大厨老周…一律用玩家真实用户名, 没有就没有」)。
       退役方式 = 掐源头: loaded 永远 false + 名册永远为空 → 四处消费端
       (邻居补位/排行榜混排/离线小偷帮手/小报/远景农场)的守卫自动短路,
       全游戏只剩真实玩家。模块和数据文件保留(彻底删除牵动 social-steal
       的关系结算路径, 风险高收益低), 但任何入口都取不到假人。 */
    RETIRED: true,

    async load() {
      if (this.RETIRED) { this.roster = []; this.loaded = false; return; }
      try {
        const res = await fetch('../data/ai-neighbors.json');
        const data = await res.json();
        this.roster = data.neighbors || [];
        this.levelEpoch = data._level_epoch || this.levelEpoch;
        this.byId = {};
        this.roster.forEach(n => { this.byId[n.id] = n; });
        this.loaded = true;
      } catch (e) {
        console.error('ai-neighbors load failed', e);
        this.roster = [];
        this.loaded = true;
      }
    },

    get(id) { return this.byId[id] || null; },
    // enabled=false ⇒ 对外"没有 AI 邻居"：所有枚举入口返回空，
    // 今日/排行榜/顺菜/被偷结算自然全部回落到真会员/空态。
    ids() { return this.enabled ? this.roster.map(n => n.id) : []; },

    name(id) {
      const n = this.get(id);
      if (!n) return id;
      return (Farm.state.data.language === 'en') ? n.name_en : n.name_zh;
    },
    // 头像：用与真会员邻居完全相同的人物 emoji 池（neighbors.avatarFor），
    // 确定性分配，让 AI 与真人在卡片上视觉一致、看不出差别。
    // （名册里的 avatar 字段不再用于显示。）
    avatar(id) {
      const pool = ['👩', '👨', '👵', '👴', '👧', '👦', '🧑', '👩‍🌾', '👨‍🌾',
                    '🧓', '🧑‍🎓', '👩‍🏫', '👨‍🍳', '🌺', '🌟', '🌅'];
      return pool[hashStr(id + ':avatar') % pool.length];
    },

    // 随真实天数缓慢上涨的等级（确定性、有上限）。
    levelAt(id, now) {
      const n = this.get(id);
      if (!n) return 1;
      const epochMs = Date.parse(this.levelEpoch + 'T00:00:00');
      const days = Math.max(0, (now - epochMs) / DAY_MS);
      const lv = (n.baseLevel || 1) + Math.floor(days / (n.growthRate || 8));
      return Math.min(60, lv);
    },

    // 当前是否在作息活跃时段（用于"谁来偷你/在线"）。
    isActiveNow(id, now) {
      const n = this.get(id);
      if (!n || !n.activeHours) return false;
      const h = new Date(now).getHours();
      const [a, b] = n.activeHours;
      return (a <= b) ? (h >= a && h < b) : (h >= a || h < b);
    },
    personality(id) { const n = this.get(id); return n ? (n.personality || 'balanced') : 'balanced'; },

    // 12 块地的确定性状态：每块独立周期、独立相位错峰；作物从玩家可见目录里
    // 按 (id,plot,cycleIndex) 确定性挑选——同一时刻恒定、不同时刻演化、有真实熟菜。
    farmStateAt(id, now) {
      const empty = () => ({ cropId: null, stage: -1, mature: false });
      if (!this.get(id) || !Farm.crops || !Farm.crops.loaded) {
        return Array.from({ length: 12 }, empty);
      }
      const level = this.levelAt(id, now);
      const avail = Farm.crops.all().filter(c => c.unlock_level <= Math.min(level + 2, 10));
      if (avail.length === 0) return Array.from({ length: 12 }, empty);

      const occupied = 6 + (hashStr(id + ':occ') % 5); // 6..10 块在用
      const plots = [];
      for (let i = 0; i < 12; i++) {
        if (i >= occupied) { plots.push(empty()); continue; }
        const phase = hashStr(id + ':' + i + ':phase') % NOMINAL_CYCLE;
        const delta = now - phase;
        const cycleIndex = Math.floor(delta / NOMINAL_CYCLE);
        const tInCycle = ((delta % NOMINAL_CYCLE) + NOMINAL_CYCLE) % NOMINAL_CYCLE;
        const crop = avail[hashStr(id + ':' + i + ':' + cycleIndex) % avail.length];
        const growMs = (crop.grow_minutes || 30) * 60000;
        if (tInCycle < growMs) {
          const frac = tInCycle / growMs;
          plots.push({ cropId: crop.id, stage: frac >= 0.4 ? 1 : 0, mature: false });
        } else {
          plots.push({ cropId: crop.id, stage: 2, mature: true });
        }
      }
      return plots;
    },

    // {plots:[{cropId,stage}], decos:[]}（与 neighbors.generateFarmDisplay 兼容）
    farmDisplay(id, now) {
      const plots = this.farmStateAt(id, now).map(p => ({ cropId: p.cropId, stage: p.stage }));
      const pool = ['🏮', '🌻', '🪵', '🎋', '🐤'];
      const decoN = hashStr(id + ':deco') % 3;
      const decos = [];
      for (let i = 0; i < decoN; i++) decos.push(pool[hashStr(id + ':deco' + i) % pool.length]);
      return { plots, decos };
    },

    _estHarvests(id, now) { return this.levelAt(id, now) * 9 + (hashStr(id + ':h') % 50); },

    // 混排进今日/排行榜的条目（形状对齐 neighbors.js 真会员条目）。
    displayCard(id, now) {
      now = now || Date.now();
      const harvests = this._estHarvests(id, now);
      return {
        isReal: false,
        isAI: true,
        uid: id,
        id: id,                       // 稳定访问 id（与真会员的 'real_'+uid 区分）
        name: this.name(id),
        emoji: this.avatar(id),
        level: this.levelAt(id, now),
        totalHarvests: harvests,
        totalDeliveries: Math.floor(harvests / 3),
        likesReceived: hashStr(id + ':likes') % 40,
      };
    },

    metricValue(id, metric, now) {
      now = now || Date.now();
      switch (metric) {
        case 'level': return this.levelAt(id, now);
        case 'deliveries': return Math.floor(this._estHarvests(id, now) / 3);
        case 'weekly': {
          const wid = Farm.state.getWeekId ? Farm.state.getWeekId() : '';
          return hashStr(id + ':w' + wid) % 30;
        }
        case 'harvests':
        default: return this._estHarvests(id, now);
      }
    },

    // 今日确定性挑 n 个 AI（按日期 hash 洗牌），用于真会员不足时补位。
    // n 被 maxFill 封顶：即使真会员为零，也只补 maxFill 个，不满村假人。
    dailyPick(n, dateStr) {
      if (this.RETIRED) return [];
      n = Math.min(n, this.maxFill);
      if (n <= 0) return [];
      const ids = this.ids().slice();   // enabled=false ⇒ [] ⇒ 不补位
      if (n >= ids.length) return ids;
      // 基于日期的确定性洗牌（Fisher–Yates，种子来自 dateStr）
      let h = hashStr('aipick:' + (dateStr || ''));
      const rng = () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      return ids.slice(0, n);
    },

    // 今日出场的 AI 小名单（今日邻居补位 / 排行榜混排 / 离线掠夺选角共用，
    // 保证玩家看到的、来家里串门的是同一批"村里人"，世界感一致）。
    todaysCast() {
      const dateStr = (Farm.state && Farm.state.getDateString) ? Farm.state.getDateString() : '';
      return this.dailyPick(this.maxFill, dateStr);
    },

    // 与某 AI 的本地关系记录（T5 用于"会回应你"）。
    _rel(id) {
      const ar = (Farm.state.data.aiRelationships = Farm.state.data.aiRelationships || {});
      return (ar[id] = ar[id] || {});
    },

    // 本地点赞/帮忙/贴纸：复用与真会员同一套 dailyClaims 计数与封顶，
    // 奖励同为农场币，但绝不写 Firestore（AI 不是真会员）。返回形状对齐 fbGameSync。
    interact(id, kind, emoji) {
      const lang = Farm.state.data.language || 'zh';
      const claims = Farm.state.data.dailyClaims;
      if (kind === 'like') {
        const given = claims.likesSentToday || [];
        if (given.length >= 5) return { ok: false, reason: 'cap_reached', message: lang === 'en' ? 'Daily like limit reached' : '今日点赞次数已用完' };
        if (given.includes(id)) return { ok: false, reason: 'already_liked', message: lang === 'en' ? 'Already liked today.' : '今天给 TA 点过赞了。' };
        claims.likesSentToday = given.concat([id]);
        this._rel(id).likedByMe = true;
        Farm.state.addCoins(5);
        Farm.state.save();
        return { ok: true, remaining: 5 - claims.likesSentToday.length, coinsEarned: 5, mutual: false };
      }
      if (kind === 'help') {
        const done = claims.helpSentToday || [];
        if (done.length >= 5) return { ok: false, reason: 'cap_reached', message: lang === 'en' ? 'Daily help limit reached' : '今日帮忙次数已用完' };
        if (done.includes(id)) return { ok: false, reason: 'already', message: lang === 'en' ? 'Already helped today.' : '今天已经帮过 TA 了。' };
        claims.helpSentToday = done.concat([id]);
        this._rel(id).helpedByMe = true;
        Farm.state.addCoins(10);
        Farm.state.save();
        return { ok: true, remaining: 5 - claims.helpSentToday.length, coinsEarned: 10 };
      }
      // sticker
      const sent = claims.stickersSentToday || [];
      if (sent.length >= 10) return { ok: false, reason: 'cap_reached', message: lang === 'en' ? 'Daily sticker limit reached' : '今日贴纸次数已用完' };
      claims.stickersSentToday = sent.concat([{ to: id, emoji: emoji || '👍' }]);
      Farm.state.addCoins(2);
      Farm.state.save();
      return { ok: true, remaining: 10 - claims.stickersSentToday.length, coinsEarned: 2 };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.aiNeighbors = ai;
})();
