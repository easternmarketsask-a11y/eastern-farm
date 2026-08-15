/**
 * stall.js — 菜摊：路人溢价买菜（2026-08-14）
 *
 * 起因（Chris）：「种子店那个摊位看起来就是菜摊，干脆就作为菜摊用，
 * 可以卖菜给路人。种子店不需要实体。」
 *
 * 玩法：菜摊隔一阵来一位路人，想买 1-3 棵指定的菜，出价比市价高
 * 35%-60%。仓库里有货就能成交 —— 大宗卖超市（谷仓）、零售卖路人（菜摊），
 * 两条卖菜路互补，路人还是一个「过会儿再回来看看」的回访钩子。
 *
 * 成本安全：只发农场币（零真实成本），不发超市积分。
 * 溢价上限 1.6×、每单 ≤3 棵、间隔 ≥25 分钟 —— 收益是零花不是印钞。
 *
 * 存档：state.data.stall = { customer, nextAt, sold }（懒初始化，
 * 老存档无此键照常工作）。所有时刻用绝对时间戳，离线也会自然到点。
 */
(function () {
  /* 🔒 不用假人设(2026-08-14 Chris:「删除所有虚假的称呼, 一律用玩家真实
     用户名, 没有就没有」)。顾客优先从 farm_players 取**真实玩家**(名字+
     头像 emoji 按 uid 确定); 取不到(游客/离线/还没别的玩家)就是匿名「路人」
     —— 路人是身份, 不是假名。 */
  const AVATARS = ['🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐥', '🦉'];
  const ANON = { zh: '路人', en: 'A passerby', face: '🚶' };
  /* 常客好感(2026-08-15, 人生故事第三支柱): 好感记在**真实玩家**身上 ——
     同一位玩家买满 3/10/25 次升级, 出价越来越高、回头越来越勤,
     升级送小礼物 + 写进日记。匿名路人没有身份, 不累好感。 */
  const TIERS = [
    { at: 3,  bonus: 0.05, zh: '熟客',   en: 'Regular' },
    { at: 10, bonus: 0.10, zh: '老主顾', en: 'Loyal customer' },
    { at: 25, bonus: 0.15, zh: '挚友',   en: 'Best friend' },
  ];
  const tierOf = (n) => { let t = null; for (const x of TIERS) if (n >= x.at) t = x; return t; };
  // 等待时长: 40-90 分钟随机(2026-08-15 Chris:「等一段时间没有卖就应该离开」
  // —— 旧的 3 小时太不真实, 而且看不见 TA 走)。到点离开会轻声告知。
  const WAIT_MIN = 40, WAIT_MAX = 90;
  const GAP_MIN = 25, GAP_MAX = 45;    // 成交后下一位的间隔（分钟）
  const FIRST_DELAY_MS = 4 * 60e3;     // 新农场开张 4 分钟后来第一位

  const stall = {
    _pool: null,
    _poolAt: 0,
    /* 真实玩家池: 与邻居列表同一数据源(fetchVisiblePool), 1 小时缓存。
       拿不到(未登录/离线)返回 null → 顾客走匿名路人。 */
    async _loadPool() {
      const now = Date.now();
      if (this._pool && now - this._poolAt < 3600e3) return this._pool;
      try {
        if (!(Farm.fbGameSync && Farm.fbGameSync.fetchVisiblePool)) return this._pool;
        const raw = await Farm.fbGameSync.fetchVisiblePool(30);
        const me = Farm.fbAuth && Farm.fbAuth.memberDocId ? Farm.fbAuth.memberDocId() : null;
        this._pool = (raw || [])
          .filter((m) => m && m.uid && m.uid !== me)
          .map((m) => {
            let h = 0; for (let i = 0; i < m.uid.length; i++) h = (h * 31 + m.uid.charCodeAt(i)) >>> 0;
            return { uid: m.uid, name: Farm.fbGameSync.displayName(m.doc), face: AVATARS[h % AVATARS.length] };
          })
          .filter((m) => m.name);
        this._poolAt = now;
      } catch (e) { /* 保持旧池/空池 */ }
      return this._pool;
    },

    _st() {
      const d = Farm.state.data;
      if (!d.stall) d.stall = { nextAt: Date.now() + FIRST_DELAY_MS, sold: 0 };
      return d.stall;
    },

    // 当前路人（顺带推进状态机：过期离开 / 到点来新客）。
    customer() {
      if (!this._pool && !this._poolReq) { this._poolReq = true; this._loadPool(); }   // 预热真实玩家池
      const st = this._st(), now = Date.now();
      if (st.customer && now > st.customer.expireAt) {
        const gone = st.customer;
        st.customer = null;
        st.nextAt = now + 60e3;        // 空档 1 分钟，别立刻刷脸
        Farm.state.save();
        // 在线时轻声告知(拜访别人家时不打扰); 语气温和, 不责怪
        if (!Farm.state._visitLock && Farm.ui && Farm.ui.toast) {
          const en2 = Farm.state.data.language === 'en';
          Farm.ui.toast(en2
            ? ('🧺 ' + gone.en + ' waited a while and moved on.')
            : ('🧺 ' + gone.zh + ' 等了一会儿，先走了。'), 3000);
        }
      }
      if (!st.customer && now >= (st.nextAt || 0)) this._spawn();
      return st.customer || null;
    },

    _spawn() {
      const lvl = (Farm.state.data.level || 1);
      const pool = (Farm.crops.available ? Farm.crops.available(lvl, null) : Farm.crops.all())
        .filter((c) => c && c.sell_price > 0);
      if (!pool.length) return;
      const def = pool[Math.floor(Math.random() * pool.length)];
      const qty = 1 + Math.floor(Math.random() * Math.min(3, 1 + Math.floor(lvl / 3)));
      const mult = 1.35 + Math.random() * 0.25;
      const unit = Farm.crops.sellPriceOf ? Farm.crops.sellPriceOf(def) : def.sell_price;
      // 真实玩家优先, 没有就匿名路人(绝不造假名)。
      // 常客按好感加权回头: 买得多的人更常来 —— 关系是双向的。
      const ppl = this._pool;
      let who = null;
      if (ppl && ppl.length) {
        const regs = this._st().regulars || {};
        const weights = ppl.map((m) => 1 + Math.min(((regs[m.uid] || {}).n || 0), 10) * 0.35);
        let sum = 0; for (const w of weights) sum += w;
        let roll = Math.random() * sum;
        for (let i = 0; i < ppl.length; i++) { roll -= weights[i]; if (roll <= 0) { who = ppl[i]; break; } }
        if (!who) who = ppl[ppl.length - 1];
      }
      // 常客等级加价(封顶 1.75×): 熟人愿意多给一点
      let mult2 = mult;
      let visits = 0;
      if (who) {
        visits = ((this._st().regulars || {})[who.uid] || {}).n || 0;
        const tier = tierOf(visits);
        if (tier) mult2 = Math.min(1.75, mult + tier.bonus);
      }
      const now = Date.now();
      this._st().customer = {
        crop: def.id, qty,
        price: Math.ceil(unit * qty * mult2),
        pct: Math.round((mult2 - 1) * 100),
        zh: who ? who.name : ANON.zh, en: who ? who.name : ANON.en,
        face: who ? who.face : ANON.face,
        real: !!who, uid: who ? who.uid : null, visits,
        bornAt: now, expireAt: now + (WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN)) * 60e3,
      };
      Farm.state.save();
      this._loadPool();   // 顺手为下一位预热真实玩家池(异步, 不阻塞)
    },

    stockOf(cropId) {
      return (Farm.state.data.warehouse || []).filter((w) => w && w.cropId === cropId).length;
    },

    sell() {
      const st = this._st(), c = st.customer;
      const en = (Farm.state.data.language === 'en');
      if (!c) return;
      if (this.stockOf(c.crop) < c.qty) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Not enough in the barn' : '仓库里的货不够');
        return;
      }
      // 从仓库取走 qty 棵该作物
      const wh = Farm.state.data.warehouse;
      let left = c.qty;
      for (let i = wh.length - 1; i >= 0 && left > 0; i--) {
        if (wh[i] && wh[i].cropId === c.crop) { wh.splice(i, 1); left--; }
      }
      Farm.state.addCoins(c.price);
      if (Farm.state.addXp) Farm.state.addXp(2 + c.qty);
      st.sold = (st.sold || 0) + 1;
      // 常客好感: 真实玩家 +1 次; 跨级 → 小礼物(种子×2) + 日记 + 庆祝
      if (c.real && c.uid) {
        if (!st.regulars) st.regulars = {};
        const r = st.regulars[c.uid] || { n: 0, name: c.zh, face: c.face };
        r.n += 1; r.name = c.zh; r.face = c.face; r.lastAt = Date.now();
        st.regulars[c.uid] = r;
        const tier = TIERS.find((x) => x.at === r.n);   // 恰好跨级
        if (tier) {
          // 礼物: 已解锁作物里随机一种的种子 ×2(零真实成本)
          try {
            const pool2 = (Farm.crops.available ? Farm.crops.available(Farm.state.data.level || 1, null) : [])
              .filter((cd) => cd && cd.seed_cost > 0);
            if (pool2.length && Farm.state.addSeed) {
              const g = pool2[Math.floor(Math.random() * pool2.length)];
              Farm.state.addSeed(g.id, 2);
              if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en
                ? (c.face + ' ' + c.en + ' is now a ' + tier.en + '! Gift: ' + (g.icon || '') + ' seeds ×2')
                : (c.face + ' ' + c.zh + ' 成了你的' + tier.zh + '！回礼：' + (g.name_zh || '') + '种子×2'), 4200);
            }
          } catch (e) {}
          if (Farm.lifeStory && Farm.lifeStory.record) {
            Farm.lifeStory.record('regular_' + c.uid + '_' + tier.at,
              c.face + ' ' + c.zh + ' 成了菜摊的' + tier.zh + '（第 ' + r.n + ' 次光顾）。',
              c.face + ' ' + c.en + ' became a ' + tier.en.toLowerCase() + ' (visit #' + r.n + ').');
          }
          if (Farm.ui && Farm.ui.confettiBurst) Farm.ui.confettiBurst();
          if (Farm.audio) Farm.audio.play('achievement');
        }
      }
      st.customer = null;
      st.nextAt = Date.now() + (GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)) * 60e3;
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('coin');
      if (Farm.ui) {
        if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        if (Farm.ui.toast) Farm.ui.toast((en
          ? (c.face + ' ' + c.en + ' bought ' + c.qty + ' — +' + c.price + ' coins!')
          : (c.face + ' ' + c.zh + (c.real ? ' ' : '') + '买走了 ' + c.qty + ' 棵 · +' + c.price + ' 农场币！')), 3200);
      }
      if (Farm.isoView && Farm.isoView.render) Farm.isoView.render();
    },

    open() {
      if (!(Farm.ui && Farm.ui.showModal)) return;
      const en = (Farm.state.data.language === 'en');
      const c = this.customer();
      let body;
      if (!c) {
        const st = this._st();
        const mins = Math.max(1, Math.ceil(((st.nextAt || 0) - Date.now()) / 60e3));
        // 常客簿: 好感前三名(全是真实玩家)
        const regs = Object.values(st.regulars || {}).sort((a, b2) => (b2.n || 0) - (a.n || 0)).slice(0, 3);
        const regHtml = regs.length
          ? '<div style="margin-top:14px;text-align:left;">'
            + '<div style="font-size:12px;color:var(--warm-text-soft);margin-bottom:6px;">📒 ' + (en ? 'Regulars' : '常客簿') + '</div>'
            + regs.map((r) => {
                const t2 = tierOf(r.n);
                return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fffdf4;'
                  + 'border:1px solid var(--border-soft);border-radius:10px;margin-bottom:5px;font-size:13px;">'
                  + '<span>' + (r.face || '🙂') + '</span><span style="flex:1;font-weight:600;">' + r.name + '</span>'
                  + '<span style="color:var(--warm-text-soft);font-size:12px;">'
                  + (t2 ? ((en ? t2.en : t2.zh) + ' · ') : '') + '×' + r.n + '</span></div>';
              }).join('')
            + '</div>'
          : '';
        body = '<div style="text-align:center;padding:16px 4px 4px;">'
          + '<div style="font-size:44px;">🥬</div>'
          + '<div style="font-size:13.5px;color:var(--warm-text-soft);margin-top:8px;line-height:1.6;">'
          + (en ? ('No customer right now — someone should stroll by in ~' + mins + ' min.')
                : ('这会儿没有客人，大约 ' + mins + ' 分钟后会有路人逛过来。'))
          + '</div></div>' + regHtml;
      } else {
        const def = Farm.crops.get(c.crop) || {};
        const cropName = en ? (def.name_en || c.crop) : (def.name_zh || c.crop);
        const stock = this.stockOf(c.crop);
        const enough = stock >= c.qty;
        const rr2 = (c.real && c.uid && (this._st().regulars || {})[c.uid]) || null;
        const tierNow = rr2 ? tierOf(rr2.n) : null;
        const badge = rr2
          ? '<div style="font-size:11.5px;color:var(--leaf-dark);margin-top:3px;">'
            + (tierNow ? ('💚 ' + (en ? tierNow.en : tierNow.zh) + ' · ') : '')
            + (en ? ('visit #' + (rr2.n + 1)) : ('第 ' + (rr2.n + 1) + ' 次光顾')) + '</div>'
          : '';
        body = '<div style="text-align:center;">'
          + '<div style="font-size:46px;line-height:1;">' + c.face + '</div>'
          + '<div style="font-family:var(--font-display);font-size:18px;margin-top:6px;">' + (en ? c.en : c.zh) + '</div>'
          + badge
          + '<div style="margin:12px 0;padding:12px;border:1.5px dashed var(--border-soft);border-radius:12px;font-size:14px;line-height:1.7;">'
          + (en ? ('Wants <b>' + c.qty + ' × ' + (def.icon || '🥬') + ' ' + cropName + '</b><br>offering <b>' + c.price + '</b> <span class="coin-icon"></span> <span style="color:var(--leaf-dark);font-weight:600;">(+' + c.pct + '% vs market)</span>')
                : ('想买 <b>' + c.qty + ' 棵 ' + (def.icon || '🥬') + ' ' + cropName + '</b><br>出价 <b>' + c.price + '</b> <span class="coin-icon"></span> <span style="color:var(--leaf-dark);font-weight:600;">（比市价高 ' + c.pct + '%）</span>'))
          + '</div>'
          + '<div style="font-size:12px;color:var(--warm-text-soft);margin-bottom:10px;">'
          + (en ? ('In barn: ' + stock) : ('仓库现有：' + stock + ' 棵'))
          + ' · ' + (function () { const m2 = Math.max(1, Math.ceil((c.expireAt - Date.now()) / 60e3));
              return en ? ('waits ~' + m2 + ' min') : ('还会等约 ' + m2 + ' 分钟'); })()
          + '</div>'
          + (enough
            ? '<button class="btn" id="stallSellBtn" style="width:100%;">' + (en ? 'Sell' : '卖给TA') + ' · +' + c.price + ' <span class="coin-icon"></span></button>'
            : '<button class="btn secondary" disabled style="width:100%;">' + (en ? 'Not enough stock — grow some!' : '货不够 · 先去种点吧') + '</button>')
          + '</div>';
      }
      body += '<div style="font-size:11.5px;color:var(--warm-text-soft);text-align:center;margin-top:10px;">'
        + (en ? 'Passersby pay above market price. Bulk sales still go via the barn.'
              : '路人出价比超市高；大宗卖菜还是走谷仓。') + '</div>'
        + '<div class="btn-row" style="margin-top:12px;"><button class="btn secondary" onclick="Farm.ui.hideModal()" style="width:100%;">'
        + (en ? 'Close' : '关闭') + '</button></div>';
      Farm.ui.showModal('<h2 class="modal-title">' + (en ? 'Veggie Stand' : '菜摊') + '</h2>' + body);
      const btn = document.getElementById('stallSellBtn');
      if (btn) btn.onclick = () => { Farm.ui.hideModal(); this.sell(); };
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.stall = stall;
})();
