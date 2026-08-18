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
    // 给农场起名(2026-08-15): 远景名牌只挂玩家自起的昵称, 没起就是匿名小屋
    nickname_set: (s) => (s.nickname && String(s.nickname).trim()) ? 1 : 0,
  };
  // 有「去做」入口的目标类型 → 目标行右侧给一个按钮直达
  const GOAL_ACTIONS = { nickname_set: { zh: '起名 ✏️', en: 'Name it ✏️', run: () => Farm.lifeStory.promptNickname() } };

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
    { k: 'homelv', vals: [2, 3, 4, 5, 6, 7, 8], get: (s2) => { const h = (s2.map || []).find((m) => m && m.type === 'home'); return h ? (h.lv || 1) : 0; },
      zh: (n) => ({ 2:'家换成了：砖瓦农居。', 3:'家换成了：院落人家。', 4:'家换成了：乡绅别墅。', 5:'家换成了：花园洋房。', 6:'家换成了：泳池雅墅。', 7:'家换成了：湖景豪宅。', 8:'家换成了：东方庄园。' })[n] || '',
      en: (n) => ({ 2:'Moved into Brick Farmhouse.', 3:'Moved into Courtyard Home.', 4:'Moved into Country Villa.', 5:'Moved into Garden Manor.', 6:'Moved into Pool Villa.', 7:'Moved into Lakeside Mansion.', 8:'Moved into Eastern Estate.' })[n] || '' },
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
    /* 公共记录口(2026-08-15): 其他系统写一条带去重键的日记。
       常客好感等(动态人名)用它 —— 对账规则只适合静态里程碑。 */
    record(key, zh, en) {
      const d = this._diary();
      if (d.diaryMarks[key]) return false;
      d.diaryMarks[key] = 1;
      this._diaryAdd(key, zh, en);
      Farm.state.save();
      return true;
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
      // 开屏 / 别的弹窗 / 新手聚光灯进行中 → 信晚点再送（ui.isBusy 统一判定）
      if (Farm.ui && Farm.ui.isBusy ? Farm.ui.isBusy() : document.getElementById('splash')) return;
      // 欢迎窗还没确认过的全新玩家：先让他把第一棵菜种下去，信随后就到
      if (!Farm.state.data.tutorialV1Done) return;
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

    /* 某章还有「已达成但没领」的目标吗 —— 时间线上给旧章节挂「可领」角标用 */
    _claimableIn(ch) {
      const st = this._st();
      return ch.goals.filter((g) => !st.claimed[g.id] && this._progress(g) >= g.target).length;
    },

    /* open(tab, viewIdx)：viewIdx 是要翻看的章节下标（默认当前章）。
       2026-08-15：升级过章后旧章目标不再消失 —— 点时间线里走过的章节能翻回去，
       没领的奖励照领（只发农场币，零真实成本）；下一章可以先看目标（有盼头），
       但上锁不给领。再往后的章节保持神秘。 */
    async open(tab, viewIdx) {
      this._tab = tab || this._tab || 'chapter';
      if (this._tab === 'diary') return this.openDiary();
      await this._load();
      if (!(Farm.ui && Farm.ui.showModal) || !CHAPTERS.length) return;
      const en = Farm.state.data.language === 'en';
      const lvl = Farm.state.data.level || 1;
      const nowCh = this._chapterFor(lvl);
      const st = this._st();
      const nowIdx = CHAPTERS.indexOf(nowCh);
      const idx = (typeof viewIdx === 'number' && viewIdx >= 0 && viewIdx <= Math.min(nowIdx + 1, CHAPTERS.length - 1))
        ? viewIdx : nowIdx;
      const cur = CHAPTERS[idx];
      const isPast = idx < nowIdx, isFuture = idx > nowIdx;

      const goalRow = (g) => {
        const have = this._progress(g);
        const done = have >= g.target;
        const claimed = !!st.claimed[g.id];
        const pct = Math.min(100, Math.round(have / g.target * 100));
        let right;
        if (isFuture) right = '<span class="ls-count">🔒 +' + g.reward + ' <span class="coin-icon"></span></span>';
        else if (claimed) right = '<span class="ls-claimed">✓</span>';
        else if (done) right = '<button class="btn ls-claim" data-claim="' + g.id + '">'
          + (en ? 'Claim' : '领取') + ' +' + g.reward + ' <span class="coin-icon"></span></button>';
        else if (GOAL_ACTIONS[g.type]) right = '<button class="btn ls-claim ls-act" data-goact="' + g.type + '">'
          + (en ? GOAL_ACTIONS[g.type].en : GOAL_ACTIONS[g.type].zh) + '</button>';
        else right = '<span class="ls-count">' + Math.min(have, g.target) + '/' + g.target + '</span>';
        return '<div class="ls-goal ' + (claimed ? 'is-claimed' : done && !isFuture ? 'is-done' : '') + (isFuture ? ' is-locked' : '') + '">'
          + '<div class="ls-goal-main"><div class="ls-goal-name">' + (en ? g.en : g.zh) + '</div>'
          + '<div class="ls-goal-bar"><div class="ls-goal-fill" style="width:' + (isFuture ? 0 : pct) + '%"></div></div></div>'
          + right + '</div>';
      };

      // 章节时间线: 已过的章节打勾(可点回看, 有没领的奖励挂角标), 当前高亮, 下一章可预览, 更远的上锁
      const timeline = CHAPTERS.map((c, i) => {
        const cls = (i < nowIdx ? 'past' : i === nowIdx ? 'now' : 'future') + (i === idx ? ' viewing' : '');
        const clickable = i <= nowIdx + 1;
        const pend = i < nowIdx ? this._claimableIn(c) : 0;
        const badge = pend ? '<span class="ls-tl-badge">' + (en ? 'Claim' : '可领') + '</span>'
          : (i === nowIdx + 1 ? '<span class="ls-tl-hint">Lv ' + c.from_lv + '</span>' : '');
        return '<div class="ls-tl ' + cls + '"' + (clickable ? ' data-tl="' + i + '" role="button" tabindex="0"' : '') + '>'
          + '<span class="ls-tl-dot">' + (i < nowIdx ? '✓' : (i === nowIdx ? '📖' : '🔒')) + '</span>'
          + '<span class="ls-tl-name">' + (en ? c.name_en : c.name_zh) + '</span>' + badge + '</div>';
      }).join('');

      const eyebrow = en
        ? ('Chapter ' + (idx + 1) + (isPast ? ' · Completed' : isFuture ? (' · Unlocks at Lv ' + cur.from_lv) : ''))
        : ('第' + '一二三四五六七八九'[idx] + '章' + (isPast ? ' · 走过的路' : isFuture ? (' · Lv ' + cur.from_lv + ' 解锁') : ''));

      Farm.ui.showModal(
        '<h2 class="modal-title">' + (en ? 'My Farm Story' : '我的农场人生') + '</h2>'
        + this._tabsHtml(en, 'chapter')
        + '<div class="ls-chapter-head">'
        + '<div class="ls-ch-eyebrow">' + eyebrow + '</div>'
        + '<div class="ls-ch-name">' + (en ? cur.name_en : cur.name_zh) + '</div>'
        + (isFuture ? '' : '<button class="ls-reread" data-reread="1">📬 ' + (en ? 'Re-read the letter' : '重读来信') + '</button>')
        + (idx !== nowIdx ? '<button class="ls-reread" data-tl="' + nowIdx + '">↩ ' + (en ? 'Back to current chapter' : '回到当前章') + '</button>' : '')
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
          this.open('chapter', idx);   // 原地刷新（留在正在看的这一章）
        };
      });
      const rr = document.querySelector('[data-reread]');
      if (rr) rr.onclick = () => this._showLetter(cur);
      document.querySelectorAll('[data-goact]').forEach((b) => {
        b.onclick = () => { const a = GOAL_ACTIONS[b.getAttribute('data-goact')]; if (a) a.run(); };
      });
      document.querySelectorAll('[data-tl]').forEach((el) => {
        const go = () => { const i = parseInt(el.getAttribute('data-tl'), 10); if (i !== idx) this.open('chapter', i); };
        el.onclick = go;
        el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      });
      this._wireTabs();
    },

    /* 昵称的唯一保存入口(设置页 + 章节目标共用): 清洗 → 存 → 推云 → 记日记。
       名字是玩家在这条路上的身份 —— 远景名牌 / 邻居列表 / 菜摊顾客名都读它。 */
    saveNickname(raw) {
      const v = String(raw || '').replace(/[<>&"']/g, '').trim().slice(0, 12);
      const before = Farm.state.data.nickname || null;
      Farm.state.data.nickname = v || null;
      Farm.state.save();
      if (Farm.fbGameSync) Farm.fbGameSync.push();
      if (v && v !== before) {
        this.record('farm_named_' + v, '给农场起了名字：「' + v + '」。', 'Named the farm "' + v + '".');
      }
      return v;
    },
    promptNickname() {
      const en = Farm.state.data.language === 'en';
      const cur = Farm.state.data.nickname || '';
      Farm.ui.showModal(
        '<h2 class="modal-title">' + (en ? 'Name your farm' : '给农场起个名字') + '</h2>'
        + '<div style="font-size:13px;color:var(--warm-text-soft);line-height:1.7;text-align:center;margin-bottom:12px;">'
        + (en ? 'It goes on the roadside sign — neighbours will know whose farm this is. Up to 12 characters.'
              : '它会挂在路边的名牌上，邻居一看就知道这是谁家。最多 12 个字。') + '</div>'
        + '<input id="lsNickInput" type="text" maxlength="12" value="' + cur.replace(/"/g, '&quot;') + '" '
        + 'placeholder="' + (en ? 'e.g., Sask Mom' : '例如：萨城宝妈') + '" '
        + 'style="width:100%;padding:12px 14px;font-size:16px;border:1.5px solid var(--border-soft);border-radius:10px;background:#fff;box-sizing:border-box;text-align:center;"/>'
        + '<div class="btn-row" style="margin-top:14px;">'
        + '<button class="btn" id="lsNickSave" style="width:100%;">' + (en ? 'Save name' : '就叫这个') + '</button></div>'
        + '<div class="btn-row" style="margin-top:8px;"><button class="btn secondary" style="width:100%;" id="lsNickBack">'
        + (en ? 'Back' : '返回') + '</button></div>'
      );
      const inp = document.getElementById('lsNickInput');
      if (inp) setTimeout(() => { try { inp.focus(); } catch (e) {} }, 50);
      const back = () => { Farm.ui.hideModal(); this.open('chapter'); };
      const save = () => {
        const v = this.saveNickname(inp ? inp.value : '');
        if (!v) { if (Farm.ui.toast) Farm.ui.toast(en ? 'Type a name first' : '先写个名字吧', 2200); return; }
        Farm.ui.hideModal();
        if (Farm.ui.toast) Farm.ui.toast(en ? ('🪧 Your farm is now "' + v + '"') : ('🪧 农场名牌挂好了：「' + v + '」'), 3200);
        if (Farm.audio) Farm.audio.play('achievement');
        this.open('chapter');
      };
      const sb = document.getElementById('lsNickSave'); if (sb) sb.onclick = save;
      const bb = document.getElementById('lsNickBack'); if (bb) bb.onclick = back;
      if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') save(); };
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
