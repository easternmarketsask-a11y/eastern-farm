/**
 * tasks.js — Daily task system. 3 random tasks per day, refresh at midnight.
 *
 * V1 simplified: hardcoded task templates + event-driven progress tracking.
 * P1 task 1.2 in TASKS.md may want to refactor to load from data/tasks.json.
 */
(function() {
  const TASK_TEMPLATES = [
    { id: 'plant_3', type: 'plant', target: 3, title_zh: '种 3 棵任意作物', title_en: 'Plant 3 of any crop', reward_coins: 20, reward_points: 0 },
    { id: 'plant_5_qingcai', type: 'plant_specific', target: 5, cropId: 'qingcai', title_zh: '种 5 棵上海青', title_en: 'Plant 5 bok choy', reward_coins: 30, reward_points: 1 },
    { id: 'harvest_5', type: 'harvest', target: 5, title_zh: '收获 5 次', title_en: 'Harvest 5 times', reward_coins: 25, reward_points: 1 },
    { id: 'earn_100', type: 'earn_coins', target: 100, title_zh: '靠收获赚 100 金币', title_en: 'Earn 100 coins from harvests', reward_coins: 30, reward_points: 1 },
    { id: 'buy_5_seeds', type: 'buy_seed', target: 5, title_zh: '买 5 包种子', title_en: 'Buy 5 seed packs', reward_coins: 15, reward_points: 0 },
    { id: 'harvest_3_tomato', type: 'harvest_specific', target: 3, cropId: 'tomato', title_zh: '收获 3 颗番茄', title_en: 'Harvest 3 tomatoes', reward_coins: 30, reward_points: 1, min_level: 2 },
    { id: 'try_new', type: 'plant_new', target: 1, title_zh: '尝试新作物', title_en: 'Try a new crop', reward_coins: 0, reward_points: 2, min_level: 3 },
  ];

  const tasks = {
    initDaily() {
      const today = Farm.state.getDateString();
      const data = Farm.state.data;

      // Already generated today?
      if (data.dailyTasks && data.dailyTasks.length > 0 && data.dailyTasksDate === today) {
        return;
      }

      // Pick 3 templates appropriate for current level
      const eligible = TASK_TEMPLATES.filter(t => !t.min_level || data.level >= t.min_level);
      const shuffled = eligible.slice().sort(() => Math.random() - 0.5);
      data.dailyTasks = shuffled.slice(0, 3).map(t => ({
        id: t.id + '_' + Math.floor(Math.random() * 10000),
        templateId: t.id,
        type: t.type,
        target: t.target,
        cropId: t.cropId || null,
        title_zh: t.title_zh,
        title_en: t.title_en,
        reward_coins: t.reward_coins,
        reward_points: t.reward_points,
        progress: 0,
        claimed: false,
      }));
      data.dailyTasksDate = today;
      Farm.state.save();
    },

    onEvent(eventType, payload) {
      const tasks = Farm.state.data.dailyTasks || [];
      let anyComplete = false;
      tasks.forEach(t => {
        if (t.claimed) return;
        if (t.progress >= t.target) return;

        const cid = payload && payload.cropId;
        if (eventType === 'plant') {
          if (t.type === 'plant') t.progress++;
          if (t.type === 'plant_specific' && t.cropId === cid) t.progress++;
          if (t.type === 'plant_new') {
            // "first time growing this crop"
            const grown = Farm.state.data.cropsEverGrown;
            // We added it just before this in recordPlant; check if it was newly added
            // Heuristic: if cropsEverGrown has it and progress<target, count once
            if (grown.includes(cid) && grown.indexOf(cid) === grown.length - 1) {
              t.progress = Math.min(t.target, t.progress + 1);
            }
          }
        }
        if (eventType === 'harvest') {
          if (t.type === 'harvest') t.progress++;
          if (t.type === 'harvest_specific' && t.cropId === cid) t.progress++;
          if (t.type === 'earn_coins' && payload.coins) t.progress += payload.coins;
        }
        if (eventType === 'buy_seed') {
          if (t.type === 'buy_seed') t.progress++;
        }

        if (t.progress >= t.target && !t.claimed) {
          // Auto-claim
          t.claimed = true;
          Farm.state.addCoins(t.reward_coins);
          if (t.reward_points > 0) {
            Farm.state.addEastPoints(t.reward_points, {
              source: 'task_completion',
              description: 'Daily task: ' + (t.templateId || t.id),
            });
          }
          Farm.state.recordTaskClaim();
          anyComplete = true;
          setTimeout(() => {
            const lang = Farm.state.data.language;
            const title = lang === 'en' ? t.title_en : t.title_zh;
            Farm.ui.toast('✅ ' + title + ' +' + t.reward_coins + '🪙' +
              (t.reward_points ? ' +' + t.reward_points + '🎫' : ''), 3000);
            Farm.ui.refreshHUD();
            this.updateBadge();
            if (Farm.audio) Farm.audio.play('coin');
          }, 200);
        }
      });
      Farm.state.save();
      this.updateBadge();
      if (anyComplete && Farm.achievements) Farm.achievements.checkAll();
    },

    open() {
      const lang = Farm.state.data.language;
      const tasksList = Farm.state.data.dailyTasks || [];

      let body;
      if (tasksList.length === 0) {
        body = `<p style="text-align:center;color:var(--warm-text-soft);padding:20px;">${Farm.i18n.t('tasks_all_done')}</p>`;
      } else {
        body = `<div class="task-list">
          ${tasksList.map(t => {
            const title = lang === 'en' ? t.title_en : t.title_zh;
            const pct = Math.min(100, t.progress / t.target * 100);
            return `
              <div class="task-card ${t.claimed ? 'done' : ''}">
                <div style="font-size:24px;">${t.claimed ? '✅' : '📋'}</div>
                <div class="task-info">
                  <div class="task-title">${title}</div>
                  <div class="task-progress">${Math.min(t.progress, t.target)} / ${t.target}</div>
                  <div style="margin-top:4px;height:4px;background:var(--border-soft);border-radius:4px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:var(--leaf-green);"></div>
                  </div>
                </div>
                <div class="task-reward">
                  +${t.reward_coins}🪙${t.reward_points ? '<br>+' + t.reward_points + '🎫' : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>`;
      }

      const html = `
        <h2 class="modal-title">📋 ${Farm.i18n.t('tasks_title')}</h2>
        ${body}
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);
    },

    updateBadge() {
      const tasksList = Farm.state.data.dailyTasks || [];
      const unclaimed = tasksList.filter(t => !t.claimed).length;
      Farm.ui.setTaskBadge(unclaimed);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.tasks = tasks;
})();
