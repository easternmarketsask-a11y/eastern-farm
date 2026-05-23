/**
 * main.js — App entry point. Loads data, initializes state, wires up UI.
 *
 * Boot sequence:
 *  1. Load i18n strings + crop catalog + coupon data (parallel)
 *  2. Init state (load save or starter)
 *  3. Apply language to UI
 *  4. Check daily login bonus
 *  5. Init daily tasks
 *  6. Check festival events
 *  7. Render farm grid + HUD
 *  8. Refresh storekeeper greeting
 *  9. Wire bottom nav buttons
 * 10. Set tick interval (1s farm update, periodic storekeeper rotation)
 */
(function() {
  async function boot() {
    console.log('🌱 Eastern Farm booting...');

    // 1. Load data files in parallel
    await Promise.all([
      Farm.i18n.load(),
      Farm.crops.load(),
      Farm.rewards.load(),
      Farm.achievements.load(),
    ]);

    // 2. Init state
    Farm.state.init();

    // 2b. Arm the one-time gesture gate so audio can resume on first interaction
    Farm.audio.armGestureGate();

    // 3. Language
    Farm.i18n.setLanguage(Farm.state.data.language || 'zh');

    // 4. Daily login bonus
    checkDailyLogin();

    // 5. Daily tasks
    Farm.tasks.initDaily();
    Farm.tasks.updateBadge();

    // 6. Festival check
    Farm.events.check();

    // 7. Initial render
    Farm.ui.refreshHUD();
    Farm.farm.renderGrid();

    // 8. Storekeeper
    Farm.storekeeper.refresh();

    // 8b. Retroactive achievement check (catches unlocks for existing saves
    // after a new achievement is shipped, or for the streak/level the player
    // already had on first launch).
    Farm.achievements.checkAll();

    // 9. Wire nav buttons
    wireNav();

    // 10. Ticks
    setInterval(() => Farm.farm.tick(), 1000);
    setInterval(() => Farm.storekeeper.refresh(), 45000);  // rotate every 45s
    setInterval(() => Farm.events.check(), 60000 * 30);    // re-check every 30 min

    console.log('✅ Eastern Farm ready.');
  }

  function checkDailyLogin() {
    const data = Farm.state.data;
    const today = Farm.state.getDateString();
    const lastStr = data.lastLogin ? new Date(data.lastLogin).toISOString().slice(0, 10) : '';

    if (lastStr === today) return;  // already counted today

    // Streak: increment if yesterday, otherwise reset
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (lastStr === yesterday) {
      data.loginStreak = (data.loginStreak || 0) + 1;
    } else {
      data.loginStreak = 1;
    }
    data.lastLogin = Date.now();
    Farm.state.recordStreak(data.loginStreak);

    // Reward: 10 coins + 1 East Point, multiplied by streak milestones
    let multiplier = 1;
    if (data.loginStreak >= 14) multiplier = 3;
    else if (data.loginStreak >= 7) multiplier = 2;

    const coins = 10 * multiplier;
    const points = 1 * multiplier;
    Farm.state.addCoins(coins);
    Farm.state.addEastPoints(points);

    setTimeout(() => {
      const lang = data.language;
      const title = Farm.i18n.t('daily_login_title');
      const streakText = Farm.i18n.t('daily_login_streak', { n: data.loginStreak });
      const rewardText = Farm.i18n.t('daily_login_reward', { coins, points });
      Farm.ui.toast(title + ' · ' + streakText + ' · ' + rewardText, 4000);
    }, 500);

    if (Farm.achievements) Farm.achievements.checkAll();
  }

  function wireNav() {
    document.querySelectorAll('.action-btn[data-action]').forEach(btn => {
      const action = btn.dataset.action;
      btn.onclick = () => {
        if (Farm.audio) Farm.audio.play('tap');
        switch (action) {
          case 'shop': Farm.shop.open(); break;
          case 'tasks': Farm.tasks.open(); break;
          case 'rewards': Farm.rewards.open(); break;
          case 'collection': openCollection(); break;
          case 'settings': openSettings(); break;
        }
      };
    });
  }

  let _collectionTab = 'crops';  // 'crops' | 'achievements'

  function openCollection() {
    const lang = Farm.state.data.language;
    const all = Farm.crops.all();
    const grown = Farm.state.data.cropsEverGrown || [];
    const cropProgress = Farm.i18n.t('collection_progress', {
      done: grown.filter(g => all.find(c => c.id === g)).length,
      total: all.length,
    });
    const achDone = Farm.achievements.unlockedCount();
    const achTotal = Farm.achievements.totalCount();
    const achProgress = Farm.i18n.t('achievements_progress', { done: achDone, total: achTotal });
    const tabCropsLabel = Farm.i18n.t('collection_tab_crops');
    const tabAchLabel = Farm.i18n.t('collection_tab_achievements');

    const tabsHTML = `
      <div class="tab-bar">
        <button class="tab-btn ${_collectionTab === 'crops' ? 'active' : ''}" data-tab="crops">🥬 ${tabCropsLabel}</button>
        <button class="tab-btn ${_collectionTab === 'achievements' ? 'active' : ''}" data-tab="achievements">🏆 ${tabAchLabel}</button>
      </div>
    `;

    const subtitle = _collectionTab === 'crops' ? cropProgress : achProgress;
    const bodyHTML = _collectionTab === 'crops' ? renderCropsList(all, grown, lang) : Farm.achievements.renderListHTML();

    const html = `
      <h2 class="modal-title">📖 ${Farm.i18n.t('collection_title')}</h2>
      ${tabsHTML}
      <p class="modal-subtitle" style="margin-top:10px;">${subtitle}</p>
      <div id="collectionBody">${bodyHTML}</div>
      <div class="btn-row">
        <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
      </div>
    `;
    Farm.ui.showModal(html);

    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
      btn.onclick = () => {
        _collectionTab = btn.dataset.tab;
        if (Farm.audio) Farm.audio.play('tap');
        openCollection();
      };
    });

    if (_collectionTab === 'crops') bindCropDetailClicks(lang, grown);
  }

  function renderCropsList(all, grown, lang) {
    const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
    return `
      <div class="seed-list" style="grid-template-columns:repeat(2,1fr);">
        ${all.map(c => {
          const unlocked = grown.includes(c.id);
          const art = unlocked
            ? Farm.cropArt.icon(c.id, 48)
            : '<div style="font-size:36px;line-height:48px;height:48px;">❔</div>';
          return `
            <div class="seed-card" data-crop="${c.id}" style="${unlocked ? '' : 'opacity:0.55;'}">
              <div style="display:flex;justify-content:center;height:48px;">${art}</div>
              <div class="seed-name" style="margin-top:6px;">${unlocked ? c[nameKey] : Farm.i18n.t('collection_locked')}</div>
              <div style="font-size:10px;color:var(--warm-text-soft);margin-top:4px;">
                ${unlocked ? (lang === 'en' ? 'Tap for info' : '点击看详情') : (lang === 'en' ? 'Plant to unlock' : '种植解锁')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function bindCropDetailClicks(lang, grown) {
    const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
    const storyKey = lang === 'en' ? 'story_en' : 'story_zh';
    const recipeKey = lang === 'en' ? 'recipe_en' : 'recipe_zh';
    document.querySelectorAll('.seed-card[data-crop]').forEach(card => {
      const cropId = card.dataset.crop;
      if (!grown.includes(cropId)) return;
      card.onclick = () => {
        const c = Farm.crops.get(cropId);
        if (Farm.audio) Farm.audio.play('tap');
        const html = `
          <h2 class="modal-title">${c[nameKey]}</h2>
          <div style="display:flex;justify-content:center;margin-bottom:8px;">${Farm.cropArt.icon(c.id, 96)}</div>
          <p style="text-align:center;color:var(--warm-text-soft);font-size:12px;margin-bottom:12px;">
            ${lang === 'en' ? 'Eastern Market SKU' : '东方超市商品码'}: ${c.real_sku || '—'}
          </p>
          <div style="padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);margin-bottom:12px;">
            <div style="font-weight:600;margin-bottom:6px;font-size:13px;">${lang === 'en' ? 'Story' : '小故事'}</div>
            <div style="font-size:13px;line-height:1.6;">${c[storyKey] || ''}</div>
          </div>
          <div style="padding:12px;background:#fff3d6;border-radius:var(--radius-md);margin-bottom:12px;">
            <div style="font-weight:600;margin-bottom:6px;font-size:13px;">${lang === 'en' ? '🍳 Try this recipe' : '🍳 推荐做法'}</div>
            <div style="font-size:13px;line-height:1.6;">${c[recipeKey] || ''}</div>
          </div>
          <div class="btn-row">
            <button class="btn secondary" id="backToCollection">${Farm.i18n.t('btn_close')}</button>
          </div>
        `;
        Farm.ui.showModal(html);
        document.getElementById('backToCollection').onclick = () => openCollection();
      };
    });
  }

  function openSettings() {
    const lang = Farm.state.data.language;
    const muted = Farm.audio && Farm.audio.isMuted();
    const soundOnLabel = lang === 'en' ? '🔊 On' : '🔊 开';
    const soundOffLabel = lang === 'en' ? '🔇 Off' : '🔇 静音';
    const html = `
      <h2 class="modal-title">⚙️ ${Farm.i18n.t('settings_title')}</h2>

      <div style="margin:16px 0;padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);">
        <div style="font-weight:600;margin-bottom:8px;">${Farm.i18n.t('settings_language')}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn ${lang === 'zh' ? '' : 'secondary'}" id="langZh" style="flex:1;">中文</button>
          <button class="btn ${lang === 'en' ? '' : 'secondary'}" id="langEn" style="flex:1;">English</button>
        </div>
      </div>

      <div style="margin:16px 0;padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);">
        <div style="font-weight:600;margin-bottom:8px;">${Farm.i18n.t('settings_sound')}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn ${!muted ? '' : 'secondary'}" id="soundOn" style="flex:1;">${soundOnLabel}</button>
          <button class="btn ${muted ? '' : 'secondary'}" id="soundOff" style="flex:1;">${soundOffLabel}</button>
        </div>
      </div>

      <div style="margin:16px 0;padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);">
        <div style="font-weight:600;margin-bottom:4px;">${Farm.i18n.t('settings_about')}</div>
        <div style="font-size:12px;color:var(--warm-text-soft);line-height:1.6;">
          ${Farm.i18n.t('about_made_by')}<br>
          ${Farm.i18n.t('about_visit_us')}
        </div>
      </div>

      <div class="btn-row">
        <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        <button class="btn" id="resetBtn" style="background:#999;">${Farm.i18n.t('settings_reset')}</button>
      </div>
    `;
    Farm.ui.showModal(html);

    document.getElementById('langZh').onclick = () => {
      Farm.state.data.language = 'zh';
      Farm.state.save();
      Farm.i18n.setLanguage('zh');
      Farm.ui.refreshHUD();
      Farm.farm.renderGrid();
      Farm.events.check();
      Farm.storekeeper.refresh();
      openSettings();
    };
    document.getElementById('langEn').onclick = () => {
      Farm.state.data.language = 'en';
      Farm.state.save();
      Farm.i18n.setLanguage('en');
      Farm.ui.refreshHUD();
      Farm.farm.renderGrid();
      Farm.events.check();
      Farm.storekeeper.refresh();
      openSettings();
    };
    document.getElementById('soundOn').onclick = () => {
      if (Farm.audio) {
        Farm.audio.setMuted(false);
        Farm.audio.play('tap');  // confirmation blip
      }
      openSettings();
    };
    document.getElementById('soundOff').onclick = () => {
      if (Farm.audio) Farm.audio.setMuted(true);
      openSettings();
    };
    document.getElementById('resetBtn').onclick = () => {
      if (confirm(Farm.i18n.t('settings_reset_confirm'))) {
        Farm.state.reset();
        location.reload();
      }
    };
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
