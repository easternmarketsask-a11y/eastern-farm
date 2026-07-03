/**
 * tasks.js — Daily + weekly task system, data-driven from data/tasks.json.
 *
 * 每日 3 个随机任务 + 每周 1 个「本周挑战」（按周号确定性轮换，全服同款）。
 * 模板真相源是 data/tasks.json（2026-07-02 接线，Chris 改 JSON 即可调任务）；
 * fetch 失败回落到内置 FALLBACK，任务系统永不因数据文件缺失而消失。
 *
 * 进度事件（onEvent）:
 *   plant(cropId,isNew) / harvest(cropId) / buy_seed(cropId,cost)
 *   deliver(coins)=仓库卖货 / order(coins)=交小东订单
 *
 * earn_coins 语义（2026-07-02 修正）: 进度只来自真实到账的卖货/交单金币。
 * 旧实现在 harvest 事件按「应得卖价」预记——仓库 V2 后收获并不给币，
 * 任务会在钱没到手时就完成。
 */
(function() {
  // fetch 失败时的兜底模板（离线/file:// 场景）。日常调参改 data/tasks.json。
  const FALLBACK = {
    daily: [
      { id: 'plant_3', type: 'plant', target: 3, title_zh: '种 3 棵任意作物', title_en: 'Plant 3 of any crop', reward_coins: 20, reward_points: 0 },
      { id: 'harvest_5', type: 'harvest', target: 5, title_zh: '收获 5 次', title_en: 'Harvest 5 times', reward_coins: 25, reward_points: 1 },
      { id: 'earn_150', type: 'earn_coins', target: 150, title_zh: '卖货或交订单赚 150 金币', title_en: 'Earn 150 coins from sales or orders', reward_coins: 30, reward_points: 1 },
      { id: 'buy_5_seeds', type: 'buy_seed', target: 5, title_zh: '买 5 包种子', title_en: 'Buy 5 seed packs', reward_coins: 15, reward_points: 0 },
      { id: 'try_new', type: 'plant_new', target: 1, title_zh: '尝试一种没种过的作物', title_en: 'Try a crop you\'ve never grown', reward_coins: 0, reward_points: 2, min_level: 3 },
    ],
    weekly: [
      { id: 'w_harvest_40', type: 'harvest', target: 40, title_zh: '本周收获 40 次', title_en: 'Harvest 40 times this week', reward_coins: 150, reward_points: 5 },
      { id: 'w_variety_5', type: 'variety', target: 5, title_zh: '本周种 5 种不同的作物', title_en: 'Plant 5 different crops this week', reward_coins: 120, reward_points: 3 },
    ],
  };

  const tasks = {
    templates: null,

    async load() {
      try {
        const res = await fetch('../data/tasks.json');
        const data = await res.json();
        if (data && Array.isArray(data.daily) && data.daily.length) {
          this.templates = {
            daily: data.daily,
            weekly: Array.isArray(data.weekly) ? data.weekly : [],
          };
          return;
        }
      } catch (e) {
        console.warn('[tasks] tasks.json load failed — using built-in fallback', e);
      }
      this.templates = FALLBACK;
    },

    _tpl() { return this.templates || FALLBACK; },

    initDaily() {
      const today = Farm.state.getDateString();
      const data = Farm.state.data;
      this.initWeekly();

      // Already generated today?
      if (data.dailyTasks && data.dailyTasks.length > 0 && data.dailyTasksDate === today) {
        return;
      }

      // Pick 3 templates appropriate for current level
      const eligible = this._tpl().daily.filter(t => !t.min_level || data.level >= t.min_level);
      const shuffled = eligible.slice().sort(() => Math.random() - 0.5);
      data.dailyTasks = shuffled.slice(0, 3).map(t => ({
        id: t.id + '_' + Math.floor(Math.random() * 10000),
        templateId: t.id,
        type: t.type,
        target: t.target,
        cropId: t.cropId || null,
        title_zh: t.title_zh,
        title_en: t.title_en,
        reward_coins: t.reward_coins || 0,
        reward_points: t.reward_points || 0,
        progress: 0,
        claimed: false,
      }));
      data.dailyTasksDate = today;
      Farm.state.save();
    },

    // 周任务：每周 1 个，按周号确定性挑选 → 全服本周同一个挑战（社区感 +
    // 排行榜话题）。存 state.weeklyTask（此前该字段一直闲置）。
    initWeekly() {
      const d = Farm.state.data;
      const wid = Farm.state.getWeekId ? Farm.state.getWeekId() : null;
      if (!wid) return;
      if (d.weeklyTask && d.weeklyTask.weekId === wid) return;
      const pool = this._tpl().weekly || [];
      if (pool.length === 0) { d.weeklyTask = null; return; }
      let h = 0;
      const s = 'w:' + wid;
      for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
      const t = pool[h % pool.length];
      d.weeklyTask = {
        weekId: wid,
        templateId: t.id,
        type: t.type,
        target: t.target,
        cropId: t.cropId || null,
        title_zh: t.title_zh,
        title_en: t.title_en,
        reward_coins: t.reward_coins || 0,
        reward_points: t.reward_points || 0,
        progress: 0,
        seen: [],        // variety 类型：本周已种过的不同作物 id
        claimed: false,
      };
      Farm.state.save();
    },

    onEvent(eventType, payload) {
      this.initWeekly();   // 跨周边界的会话内滚动
      const daily = Farm.state.data.dailyTasks || [];
      const wt = Farm.state.data.weeklyTask;
      const all = (wt && !wt.claimed) ? daily.concat([wt]) : daily;
      let anyComplete = false;
      all.forEach(t => {
        if (t.claimed) return;
        if (t.progress >= t.target) return;

        const cid = payload && payload.cropId;
        if (eventType === 'plant') {
          if (t.type === 'plant') t.progress++;
          if (t.type === 'plant_specific' && t.cropId === cid) t.progress++;
          if (t.type === 'plant_new') {
            // Count ONLY a genuinely-new crop (caller passes isNew from
            // crops.plant's pre-recordPlant check).
            if (payload && payload.isNew === true) {
              t.progress = Math.min(t.target, t.progress + 1);
            }
          }
          if (t.type === 'variety' && cid) {
            t.seen = t.seen || [];
            if (!t.seen.includes(cid)) {
              t.seen.push(cid);
              t.progress = t.seen.length;
            }
          }
        }
        if (eventType === 'harvest') {
          if (t.type === 'harvest') t.progress++;
          if (t.type === 'harvest_specific' && t.cropId === cid) t.progress++;
        }
        if (eventType === 'buy_seed') {
          if (t.type === 'buy_seed') t.progress++;
          if (t.type === 'spend_coins' && payload && payload.cost > 0) t.progress += payload.cost;
        }
        // 真实到账金币：仓库卖货(deliver) 与 小东订单(order) 都算
        if ((eventType === 'deliver' || eventType === 'order')
            && t.type === 'earn_coins' && payload && payload.coins > 0) {
          t.progress += payload.coins;
        }
        if (eventType === 'order' && t.type === 'order') t.progress++;

        if (t.progress >= t.target && !t.claimed) {
          // Auto-claim
          t.claimed = true;
          Farm.state.addCoins(t.reward_coins);
          if (t.reward_points > 0) {
            Farm.state.addEastPoints(t.reward_points, {
              source: 'task_completion',
              description: (t === wt ? 'Weekly task: ' : 'Daily task: ') + (t.templateId || t.id),
            });
          }
          Farm.state.recordTaskClaim();
          anyComplete = true;
          const isWeekly = (t === wt);
          setTimeout(() => {
            const lang = Farm.state.data.language;
            const title = lang === 'en' ? t.title_en : t.title_zh;
            Farm.ui.toast((isWeekly ? '🗓✅ ' : '✅ ') + title + ' +' + t.reward_coins + '<span class="coin-icon"></span>' +
              (t.reward_points ? ' +' + t.reward_points + '<span class="points-icon"></span>' : ''), isWeekly ? 3600 : 3000);
            Farm.ui.refreshHUD();
            this.updateBadge();
            if (Farm.audio) Farm.audio.play(isWeekly ? 'achievement' : 'coin');
            if (isWeekly && Farm.ui.showConfetti) Farm.ui.showConfetti(20, 1600);
          }, 200);
        }
      });
      Farm.state.save();
      this.updateBadge();
      if (anyComplete && Farm.achievements) Farm.achievements.checkAll();
    },

    open() {
      const lang = Farm.state.data.language;
      this.initWeekly();
      const tasksList = Farm.state.data.dailyTasks || [];
      const wt = Farm.state.data.weeklyTask;

      const card = (t, isWeekly) => {
        const title = lang === 'en' ? t.title_en : t.title_zh;
        const pct = Math.min(100, t.progress / t.target * 100);
        return `
          <div class="task-card ${t.claimed ? 'done' : ''}">
            <div style="font-size:24px;">${t.claimed ? '✅' : (isWeekly ? '🗓' : '📋')}</div>
            <div class="task-info">
              <div class="task-title">${title}</div>
              <div class="task-progress">${Math.min(t.progress, t.target)} / ${t.target}</div>
              <div style="margin-top:4px;height:4px;background:var(--border-soft);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${isWeekly ? 'var(--sun-gold, #e8b93c)' : 'var(--leaf-green)'};"></div>
              </div>
            </div>
            <div class="task-reward">
              +${t.reward_coins}<span class="coin-icon"></span>${t.reward_points ? '<br>+' + t.reward_points + '<span class="points-icon"></span>' : ''}
            </div>
          </div>`;
      };

      const weeklyHtml = wt
        ? `<div class="seed-group-title">🗓 ${lang === 'en' ? 'Weekly challenge' : '本周挑战'}</div>${card(wt, true)}`
        : '';
      const dailyHtml = tasksList.length === 0
        ? `<p style="text-align:center;color:var(--warm-text-soft);padding:20px;">${Farm.i18n.t('tasks_all_done')}</p>`
        : `<div class="seed-group-title">📋 ${lang === 'en' ? 'Today' : '今日任务'}</div>
           <div class="task-list">${tasksList.map(t => card(t, false)).join('')}</div>`;

      const html = `
        <h2 class="modal-title">📋 ${Farm.i18n.t('tasks_title')}</h2>
        ${weeklyHtml}
        ${dailyHtml}
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);
    },

    updateBadge() {
      const tasksList = Farm.state.data.dailyTasks || [];
      const wt = Farm.state.data.weeklyTask;
      const unclaimed = tasksList.filter(t => !t.claimed).length + ((wt && !wt.claimed) ? 1 : 0);
      Farm.ui.setTaskBadge(unclaimed);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.tasks = tasks;
})();
