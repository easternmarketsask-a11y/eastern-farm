/**
 * life-story.js — 农场人生章节（2026-08-14）
 *
 * Chris 定向：给游戏一条「人生故事」主线，且**打造升级住房和生活劳作环境
 * 是重要目标**。章节把等级变成人生阶段（初来乍到 → 安家落户 → 把院子拾掇
 * 起来 → 好日子有模样 → 梦想庄园 → 传奇），每章一封小东的信 + 几个可勾选
 * 的章节目标（以建家/升家/装饰/魅力为骨架），完成可领农场币。
 *
 * 数据全在 data/chapters.json（Chris 可直接改文案/目标/奖励）。
 * 成本安全：奖励只发农场币，零真实成本。
 * 存档：state.data.lifeStory = { seen: {chId:true}, claimed: {goalId:true} }。
 * 信件触发：轻量轮询（20 秒 + 面板打开时），不碰升级核心路径 ——
 * 信「晚几秒送到」反而像真的有邮差。
 */
(function () {
  let CHAPTERS = null;

  const CHECKERS = {
    harvests: (s) => s.totalHarvests || 0,
    deliveries: (s) => s.totalDeliveries || 0,
    home_built: (s) => (s.map || []).some((m) => m && m.type === 'home') ? 1 : 0,
    home_level: (s) => { const h = (s.map || []).find((m) => m && m.type === 'home'); return h ? (h.lv || 1) : 0; },
    deco_count: (s) => (s.decorations || []).length,
    charm: () => (Farm.isoView && Farm.isoView._farmCharm) ? Farm.isoView._farmCharm() : 0,
    stall_sold: (s) => (s.stall && s.stall.sold) || 0,
    land_level: (s) => s.landLevel || 0,
    pet_count: (s) => {
      const items = (Farm.epShop && Farm.epShop.items) || [];
      const petIds = new Set(items.filter((i) => i.category === 'pet').map((i) => i.id));
      return (s.decorations || []).filter((d) => d && petIds.has(d.itemId)).length;
    },
    prestige: (s) => {
      const P = new Set(['deco_tractor', 'pet_horse', 'pet_peacock']);
      return (s.decorations || []).some((d) => d && P.has(d.itemId)) ? 1 : 0;
    },
    level: (s) => s.level || 1,
  };

  /* ============ 农场日记(2026-08-14, 人生故事第二支柱) ============
     带日期的人生大事记:「第一次收获菠菜」「家升成了梦想庄园」「菜摊第 50 位
     客人」…… 玩三个月的人翻开日记看到的是**自己的历史**。
     零侵入实现: 不碰任何玩法代码 —— 20 秒对账一次, 规则未标记且条件已满足
     就补记一条(幂等, 重放安全)。时间戳是「被发现的那一刻」, 误差 <20 秒。
     条目存 kind+参数, 文案在展示时按当前语言渲染(切语言不坏旧日记)。 */
  const DIARY_RULES = [
    { k: 'harv_first', when: (s2) => (s2.totalHarvests || 0) >= 1,
      zh: () => '第一次收获！院子里真的长出了菜。', en: () => 'First harvest! The garden really grows.' },
    { k: 'deliver_first', when: (s2) => (s2.totalDeliveries || 0) >= 1,
      zh: () => '第一次把菜卖给了东方超市。', en: () => 'First delivery to Eastern Market.' },
    { k: 'home_built', when: (s2) => (s2.map || []).some((m) => m && m.type === 'home'),
      zh: () => '我们在这片地上，有了自己的家。', en: () => 'We built a home of our own on this land.' },
    { k: 'stall_first', when: (s2) => ((s2.stall || {}).sold || 0) >= 1,
      zh: () => '菜摊开张，第一位路人买走了菜。', en: () => 'The veggie stand opened — first customer served.' },
    { k: 'pond_view', when: (s2) => Object.values(s2.mapTerrain || {}).indexOf('water') >= 0,
      zh: () => '院子前有了一汪水塘。', en: () => 'A little pond now sits by the yard.' },
  ];
  // 累计里程碑(同一指标多档)
  const DIARY_TIERS = [
    { k: 'harv', vals: [100, 500, 1000], get: (s2) => s2.totalHarvests || 0,
      zh: (n) => '累计收获满 ' + n + ' 棵。地没白种。', en: (n) => n + ' lifetime harvests. The land delivers.' },
    { k: 'sold', vals: [10, 50, 200], get: (s2) => (s2.stall || {}).sold || 0,
      zh: (n) => '菜摊接待了第 ' + n + ' 位客人。', en: (n) => 'Customer #' + n + ' at the veggie stand.' },
    { k: 'deliver', vals: [25, 100], get: (s2) => s2.totalDeliveries || 0,
      zh: (n) => '第 ' + n + ' 次给东方超市送货。', en: (n) => 'Delivery #' + n + ' to Eastern Market.' },
    { k: 'homelv', vals: [2, 3, 4, 5], get: (s2) => { const h = (s2.map || []).find((m) => m && m.type === 'home'); return h ? (h.lv || 1) : 0; },
      zh: (n) => ['', '', '家升级了：花园小屋。', '家升级了：暖灯之家，窗里有光。', '家升级了：彩旗农舍。', '家满级：梦想庄园。灯串亮起来的那晚很好看。'][n],
      en: (n) => ['', '', 'Home upgraded: Garden Home.', 'Home upgraded: Lantern Home — light in the window.', 'Home upgraded: Festive House.', 'Home maxed: Dream Estate. The string lights were beautiful that night.'][n] },
    { k: 'land', vals: [1, 2, 3, 4], get: (s2) => s2.landLevel || 0,
      zh: (n) => '农场扩建到第 ' + n + ' 阶，地界又宽了。', en: (n) => 'Land expanded to level ' + n + '.' },
  ];

  const story = {
    _st() {
      const d = Farm.state.data;
      if (!d.lifeStory) d.lifeStory = { seen: {}, claimed: {} };
      return d.lifeStory;
    },

    _diary() {
      const d = Farm.state.data;
      if (!Array.isArray(d.diary)) d.diary = [];
      if (!d.diaryMarks) d.diaryMarks = {};
      return d;
    },
    _diaryAdd(kind, zh, en) {
      const d = this._diary();
      d.diary.push({ t: Date.now(), k: kind, zh, en });
      if (d.diary.length > 120) d.diary.splice(0, d.diary.length - 120);   // 封顶防存档膨胀
    },
    /* 对账: 未标记且已满足的规则补记(幂等)。返回是否有新条目。 */
    diaryReconcile() {
      if (Farm.state._visitLock) return false;
      const d = this._diary(), s2 = Farm.state.data, m = d.diaryMarks;
      let added = 0;
      for (const r of DIARY_RULES) {
        if (m[r.k]) continue;
        try { if (r.when(s2)) { m[r.k] = 1; this._diaryAdd(r.k, r.zh(), r.en()); added++; } } catch (e) {}
      }
      for (const tr of DIARY_TIERS) {
        let cur = 0;
        try { cur = tr.get(s2); } catch (e) {}
        for (const v of tr.vals) {
          const key = tr.k + '_' + v;
          if (m[key] || cur < v) continue;
          m[key] = 1; this._diaryAdd(key, tr.zh(v), tr.en(v)); added++;
        }
      }
      // 每种菜的第一次(cropsEverGrown 已有记录, 直接对账)
      for (const cid of (s2.cropsEverGrown || [])) {
        const key = 'crop_' + cid;
        if (m[key]) continue;
        const def = Farm.crops.get ? Farm.crops.get(cid) : null;
        if (!def) continue;
        m[key] = 1;
        this._diaryAdd(key,
          '第一次种出了' + (def.name_zh || cid) + ' ' + (def.icon || ''),
          'First ' + (def.name_en || cid) + ' ever grown ' + (def.icon || ''));
        added++;
      }
      if (added) Farm.state.save();
      return added > 0;
    },

    async _load() {
      if (CHAPTERS) return CHAPTERS;
      try {
        const r = await fetch('../data/chapters.json');
        CHAPTERS = (await r.json()).chapters || [];
      } catch (e) { CHAPTERS = []; }
      return CHAPTERS;
    },

    _chapterFor(level) {
      if (!CHAPTERS || !CHAPTERS.length) return null;
      let cur = CHAPTERS[0];
      for (const c of CHAPTERS) if (level >= c.from_lv) cur = c;
      return cur;
    },

    _progress(goal) {
      const fn = CHECKERS[goal.type];
      if (!fn) return 0;
      try { return fn(Farm.state.data); } catch (e) { return 0; }
    },

    /* 新章节的信：到点了且没看过 → 弹（无别的弹窗时才弹，绝不抢戏）。 */
    async maybeDeliverLetter() {
      if (Farm.state._visitLock) return;                      // 别人家里不收信
      const modal = document.getElementById('modal');
      if (modal && !modal.classList.contains('hidden')) return;
      if (document.getElementById('splash')) return;          // 开屏期不弹
      await this._load();
      const ch = this._chapterFor(Farm.state.data.level || 1);
      if (!ch || this._st().seen[ch.id]) return;
      this._st().seen[ch.id] = true;
      Farm.state.save();
      this._showLetter(ch);
    },

    _showLetter(ch) {
      if (!(Farm.ui && Farm.ui.showModal)) return;
      const en = Farm.state.data.language === 'en';
      const body = (en ? ch.letter_en : ch.letter_zh)
        .split('\n').map((l) => l.trim()).join('<br>');
      Farm.ui.showModal(
        '<div class="ls-letter">'
        + '<div class="ls-letter-stamp">📬</div>'
        + '<div class="ls-letter-eyebrow">' + (en ? 'A new chapter begins' : '新的一章开始了') + '</div>'
        + '<h2 class="ls-letter-title">' + (en ? ch.name_en : ch.name_zh) + '</h2>'
        + '<div class="ls-letter-body">' + body + '</div>'
        + '<button class="btn" style="width:100%;margin-top:14px;" '
        + 'onclick="Farm.ui.hideModal();Farm.lifeStory.open();">'
        + (en ? 'See my chapter goals' : '看看这一章的目标') + '</button>'
        + '<button class="btn secondary" style="width:100%;margin-top:8px;" onclick="Farm.ui.hideModal()">'
        + (en ? 'Later' : '稍后再看') + '</button>'
        + '</div>'
      );
      if (Farm.audio) Farm.audio.play('achievement');
    },

    async open(tab) {
      this._tab = tab || this._tab || 'chapter';
      if (this._tab === 'diary') return this.openDiary();
      await this._load();
      if (!(Farm.ui && Farm.ui.showModal) || !CHAPTERS.length) return;
      const en = Farm.state.data.language === 'en';
      const lvl = Farm.state.data.level || 1;
      const cur = this._chapterFor(lvl);
      const st = this._st();
      const idx = CHAPTERS.indexOf(cur);

      const goalRow = (g) => {
        const have = this._progress(g);
        const done = have >= g.target;
        const claimed = !!st.claimed[g.id];
        const pct = Math.min(100, Math.round(have / g.target * 100));
        let right;
        if (claimed) right = '<span class="ls-claimed">✓</span>';
        else if (done) right = '<button class="btn ls-claim" data-claim="' + g.id + '">'
          + (en ? 'Claim' : '领取') + ' +' + g.reward + ' <span class="coin-icon"></span></button>';
        else right = '<span class="ls-count">' + Math.min(have, g.target) + '/' + g.target + '</span>';
        return '<div class="ls-goal ' + (claimed ? 'is-claimed' : done ? 'is-done' : '') + '">'
          + '<div class="ls-goal-main"><div class="ls-goal-name">' + (en ? g.en : g.zh) + '</div>'
          + '<div class="ls-goal-bar"><div class="ls-goal-fill" style="width:' + pct + '%"></div></div></div>'
          + right + '</div>';
      };

      // 章节时间线: 已过的章节打勾, 当前高亮, 未来的上锁
      const timeline = CHAPTERS.map((c, i) => {
        const cls = i < idx ? 'past' : i === idx ? 'now' : 'future';
        return '<div class="ls-tl ' + cls + '">'
          + '<span class="ls-tl-dot">' + (i < idx ? '✓' : (i === idx ? '📖' : '🔒')) + '</span>'
          + '<span class="ls-tl-name">' + (en ? c.name_en : c.name_zh) + '</span></div>';
      }).join('');

      Farm.ui.showModal(
        '<h2 class="modal-title">' + (en ? 'My Farm Story' : '我的农场人生') + '</h2>'
        + this._tabsHtml(en, 'chapter')
        + '<div class="ls-chapter-head">'
        + '<div class="ls-ch-eyebrow">' + (en ? ('Chapter ' + (idx + 1)) : ('第' + '一二三四五六七八九'[idx] + '章')) + '</div>'
        + '<div class="ls-ch-name">' + (en ? cur.name_en : cur.name_zh) + '</div>'
        + '<button class="ls-reread" data-reread="1">📬 ' + (en ? 'Re-read the letter' : '重读来信') + '</button>'
        + '</div>'
        + '<div class="ls-goals">' + cur.goals.map(goalRow).join('') + '</div>'
        + '<div class="ls-tl-wrap">' + timeline + '</div>'
        + '<div class="btn-row" style="margin-top:12px;"><button class="btn secondary" style="width:100%;" onclick="Farm.ui.hideModal()">'
        + (en ? 'Close' : '关闭') + '</button></div>'
      );
      if (Farm.audio) Farm.audio.play('tap');

      document.querySelectorAll('[data-claim]').forEach((btn) => {
        btn.onclick = () => {
          const gid = btn.getAttribute('data-claim');
          const g = cur.goals.find((x) => x.id === gid);
          if (!g || st.claimed[gid] || this._progress(g) < g.target) return;
          st.claimed[gid] = true;
          Farm.state.addCoins(g.reward);
          Farm.state.save();
          if (Farm.audio) Farm.audio.play('coin');
          if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
          this.open();   // 原地刷新
        };
      });
      const rr = document.querySelector('[data-reread]');
      if (rr) rr.onclick = () => this._showLetter(cur);
      this._wireTabs();
    },

    _tabsHtml(en, active) {
      return '<div class="ls-tabs">'
        + '<button class="ls-tab ' + (active === 'chapter' ? 'active' : '') + '" data-ls-tab="chapter">📖 ' + (en ? 'Chapters' : '章节') + '</button>'
        + '<button class="ls-tab ' + (active === 'diary' ? 'active' : '') + '" data-ls-tab="diary">📔 ' + (en ? 'Diary' : '日记') + '</button>'
        + '</div>';
    },
    _wireTabs() {
      document.querySelectorAll('[data-ls-tab]').forEach((b) => {
        b.onclick = () => { this._tab = b.getAttribute('data-ls-tab'); this.open(this._tab); };
      });
    },

    /* 日记页: 倒序时间流, 小薇体日期眉, 一天一组。 */
    openDiary() {
      this.diaryReconcile();
      const en = Farm.state.data.language === 'en';
      const list = (this._diary().diary || []).slice().reverse();
      let body;
      if (!list.length) {
        body = '<div class="ls-diary-empty">🌱<br>' + (en
          ? 'Your story starts with the first harvest.'
          : '故事，从第一次收获开始写起。') + '</div>';
      } else {
        let lastDay = '';
        body = '<div class="ls-diary">' + list.map((e2) => {
          const dt = new Date(e2.t);
          const day = en
            ? dt.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
            : (dt.getFullYear() + ' 年 ' + (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日');
          const head = day !== lastDay ? '<div class="ls-diary-day">' + day + '</div>' : '';
          lastDay = day;
          return head + '<div class="ls-diary-entry">' + (en ? e2.en : e2.zh) + '</div>';
        }).join('') + '</div>';
      }
      Farm.ui.showModal(
        '<h2 class="modal-title">' + (en ? 'Farm Diary' : '农场日记') + '</h2>'
        + this._tabsHtml(en, 'diary')
        + body
        + '<div class="btn-row" style="margin-top:12px;"><button class="btn secondary" style="width:100%;" onclick="Farm.ui.hideModal()">'
        + (en ? 'Close' : '关闭') + '</button></div>'
      );
      if (Farm.audio) Farm.audio.play('tap');
      this._wireTabs();
    },

    install() {
      // 轻量轮询送信: 20 秒一查, 有新章节且画面空闲才弹。绝不碰升级核心路径。
      setInterval(() => {
        this.maybeDeliverLetter().catch(() => {});
        try { this.diaryReconcile(); } catch (e) {}
      }, 20e3);
      setTimeout(() => {
        this.maybeDeliverLetter().catch(() => {});
        try { this.diaryReconcile(); } catch (e) {}
      }, 8e3);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.lifeStory = story;
})();
