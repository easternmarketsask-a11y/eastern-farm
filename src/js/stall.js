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
  const WAIT_MS = 3 * 3600e3;          // 路人最多等 3 小时
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
            return { name: Farm.fbGameSync.displayName(m.doc), face: AVATARS[h % AVATARS.length] };
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
        st.customer = null;
        st.nextAt = now + 60e3;        // 空档 1 分钟，别立刻刷脸
        Farm.state.save();
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
      // 真实玩家优先, 没有就匿名路人(绝不造假名)
      const ppl = this._pool;
      const who = (ppl && ppl.length)
        ? ppl[Math.floor(Math.random() * ppl.length)]
        : null;
      const now = Date.now();
      this._st().customer = {
        crop: def.id, qty,
        price: Math.ceil(unit * qty * mult),
        pct: Math.round((mult - 1) * 100),
        zh: who ? who.name : ANON.zh, en: who ? who.name : ANON.en,
        face: who ? who.face : ANON.face,
        real: !!who,
        bornAt: now, expireAt: now + WAIT_MS,
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
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Not enough in the silo' : '仓库里的货不够');
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
        body = '<div style="text-align:center;padding:16px 4px;">'
          + '<div style="font-size:44px;">🥬</div>'
          + '<div style="font-size:13.5px;color:var(--warm-text-soft);margin-top:8px;line-height:1.6;">'
          + (en ? ('No customer right now — someone should stroll by in ~' + mins + ' min.')
                : ('这会儿没有客人，大约 ' + mins + ' 分钟后会有路人逛过来。'))
          + '</div></div>';
      } else {
        const def = Farm.crops.get(c.crop) || {};
        const cropName = en ? (def.name_en || c.crop) : (def.name_zh || c.crop);
        const stock = this.stockOf(c.crop);
        const enough = stock >= c.qty;
        body = '<div style="text-align:center;">'
          + '<div style="font-size:46px;line-height:1;">' + c.face + '</div>'
          + '<div style="font-family:var(--font-display);font-size:18px;margin-top:6px;">' + (en ? c.en : c.zh) + '</div>'
          + '<div style="margin:12px 0;padding:12px;border:1.5px dashed var(--border-soft);border-radius:12px;font-size:14px;line-height:1.7;">'
          + (en ? ('Wants <b>' + c.qty + ' × ' + (def.icon || '🥬') + ' ' + cropName + '</b><br>offering <b>' + c.price + '</b> <span class="coin-icon"></span> <span style="color:var(--leaf-dark);font-weight:600;">(+' + c.pct + '% vs market)</span>')
                : ('想买 <b>' + c.qty + ' 棵 ' + (def.icon || '🥬') + ' ' + cropName + '</b><br>出价 <b>' + c.price + '</b> <span class="coin-icon"></span> <span style="color:var(--leaf-dark);font-weight:600;">（比市价高 ' + c.pct + '%）</span>'))
          + '</div>'
          + '<div style="font-size:12px;color:var(--warm-text-soft);margin-bottom:10px;">'
          + (en ? ('In silo: ' + stock) : ('仓库现有：' + stock + ' 棵')) + '</div>'
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
