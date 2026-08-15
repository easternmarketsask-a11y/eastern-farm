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

  const story = {
    _st() {
      const d = Farm.state.data;
      if (!d.lifeStory) d.lifeStory = { seen: {}, claimed: {} };
      return d.lifeStory;
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

    async open() {
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
    },

    install() {
      // 轻量轮询送信: 20 秒一查, 有新章节且画面空闲才弹。绝不碰升级核心路径。
      setInterval(() => { this.maybeDeliverLetter().catch(() => {}); }, 20e3);
      setTimeout(() => { this.maybeDeliverLetter().catch(() => {}); }, 8e3);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.lifeStory = story;
})();
