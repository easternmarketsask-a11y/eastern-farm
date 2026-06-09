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
    console.log('🌱 Happy Farm booting...');

    // 1. Load data files in parallel
    await Promise.all([
      Farm.i18n.load(),
      Farm.crops.load(),
      Farm.rewards.load(),
      Farm.achievements.load(),
      Farm.epShop.load(),
      Farm.daily.load(),
    ]);

    // 2. Init state, then migrate plots/seeds against the current catalog
    // (drops crops no longer in data/crops.json, renames qingcai → shanghai_miao)
    Farm.state.init();
    if (Farm.crops && Farm.crops.all) {
      const mainIds = Farm.crops.all().map(function (c) { return c.id; });
      const festIds = Object.keys(Farm.crops.festivalCrops || {});
      Farm.state.migrateCrops(mainIds.concat(festIds));
    }

    // 2b. Arm the one-time gesture gate so audio can resume on first interaction
    Farm.audio.armGestureGate();

    // 2c. Initialize member auth (Firebase). Safe no-op when Firebase is
    // unavailable (offline, CDN blocked, etc.) — game continues as guest.
    if (Farm.fbAuth) Farm.fbAuth.init();
    if (Farm.fbQueue) Farm.fbQueue.install();

    // 3. Language
    Farm.i18n.setLanguage(Farm.state.data.language || 'zh');

    // 3b. Live Saskatoon weather chip in the brandbar (cached 30 min)
    if (Farm.weather && Farm.weather.init) Farm.weather.init();

    // 4. Daily tasks
    Farm.tasks.initDaily();
    Farm.tasks.updateBadge();

    // 5. Festival check
    Farm.events.check();

    // 6. Initial render
    Farm.ui.refreshHUD();
    Farm.farm.renderGrid();
    if (Farm.seasons) Farm.seasons.apply();
    if (Farm.harvestStatus) Farm.harvestStatus.render();

    // 6b. Install the floating warehouse button on the farm view
    if (Farm.warehouse && Farm.warehouse.installButton) {
      Farm.warehouse.installButton();
    }

    // 7. Storekeeper
    Farm.storekeeper.refresh();

    // 8. Wire nav buttons + splash. Toast-emitting steps (daily login bonus,
    // retroactive achievement unlocks) are deferred to after splash dismiss
    // so they're not hidden under the splash overlay.
    wireNav();
    wireTodayButton();
    // Tap the Lv/title status strip to open the growth roadmap (成长之路).
    const statusbarEl = document.getElementById('statusbar');
    if (statusbarEl) {
      statusbarEl.style.cursor = 'pointer';
      statusbarEl.addEventListener('click', () => {
        _collectionTab = 'journey';
        if (Farm.audio) Farm.audio.play('tap');
        openCollection();
      });
    }
    wireSplash(() => {
      checkDailyLogin();
      Farm.achievements.checkAll();
      refreshTodayBadge();
      // First-time welcome overlay (3-step). Defer past the daily-login toast
      // so it lands on a clean screen, not under another notification.
      if (Farm.tutorial && Farm.tutorial.maybeShow) {
        setTimeout(() => Farm.tutorial.maybeShow(), 700);
      }
    });

    // Refresh the today badge whenever the modal closes
    setInterval(refreshTodayBadge, 60000);

    // 9. Ticks
    setInterval(() => Farm.farm.tick(), 1000);
    setInterval(() => Farm.storekeeper.refresh(), 45000);  // rotate every 45s
    setInterval(() => Farm.events.check(), 60000 * 30);    // re-check every 30 min

    console.log('✅ Happy Farm ready.');
  }

  function checkDailyLogin() {
    const data = Farm.state.data;
    const today = Farm.state.getDateString();
    // Bug fix: previously used toISOString() which is UTC, so the daily-login
    // date for a Saskatoon player at 9pm local would jump to tomorrow's UTC
    // date and double-claim. getDateString uses local time consistently.
    const lastStr = data.lastLogin ? Farm.state.getDateString(new Date(data.lastLogin)) : '';

    if (lastStr !== today) {
      // Streak bookkeeping ONLY. The daily-login reward is no longer paid here —
      // it moved to the 7-day sign-in calendar (login-calendar.js) so players
      // aren't paid twice. We still maintain loginStreak/maxStreak because
      // achievements depend on them.
      const yesterday = Farm.state.getDateString(new Date(Date.now() - 86400000));
      if (lastStr === yesterday) {
        data.loginStreak = (data.loginStreak || 0) + 1;
      } else {
        data.loginStreak = 1;
      }
      data.lastLogin = Date.now();
      Farm.state.recordStreak(data.loginStreak);
      Farm.state.save();
      if (Farm.achievements) Farm.achievements.checkAll();
    }

    // The 7-day sign-in calendar delivers the actual reward + celebration UI.
    // It auto-opens only if the player hasn't signed in today (checked inside).
    if (Farm.loginCalendar && Farm.loginCalendar.maybeAutoOpen) {
      Farm.loginCalendar.maybeAutoOpen();
    }
  }

  function wireSplash(onDismiss) {
    const splash = document.getElementById('splash');
    const startBtn = document.getElementById('splashStart');
    const loginBtn = document.getElementById('splashLogin');
    if (!splash || !startBtn) { if (onDismiss) onDismiss(); return; }
    let fired = false;
    const dismiss = () => {
      if (fired) return;
      fired = true;
      splash.classList.add('dismissed');
      if (Farm.audio) Farm.audio.play('plant');
      setTimeout(() => {
        splash.remove();
        if (onDismiss) onDismiss();
      }, 600);
    };
    startBtn.onclick = dismiss;
    // Splash login shortcut: dismiss splash + open login modal directly
    if (loginBtn) {
      loginBtn.onclick = () => {
        dismiss();
        setTimeout(() => {
          if (Farm.fbAuth && Farm.fbAuth.openLoginModal) Farm.fbAuth.openLoginModal();
        }, 700);
      };
    }
    document.addEventListener('keydown', (e) => {
      if (splash.parentNode && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        dismiss();
      }
    });
  }

  function wireTodayButton() {
    const btn = document.getElementById('todayButton');
    if (!btn) return;
    btn.onclick = () => {
      if (Farm.audio) Farm.audio.play('tap');
      Farm.daily.open();
    };
  }

  // Show how many daily items are still unclaimed today (news + lottery + neighbors + special seed = up to 4).
  function refreshTodayBadge() {
    const badge = document.getElementById('todayBadge');
    if (!badge) return;
    const c = Farm.state.data.dailyClaims;
    let pending = 0;
    if (!c.newsRead) pending++;
    if (!c.lotterySpunFree) pending++;
    if ((c.neighborsVisited || []).length < 3) pending++;
    // Special seed is always there if not bought; we'll count it if not yet planted today
    const specId = Farm.daily && Farm.daily.getSpecialSeedId();
    if (specId) pending++;
    badge.textContent = pending > 0 ? pending : '';
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

  let _collectionTab = 'crops';  // 'crops' | 'achievements' | 'journey'

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
    const tabJourneyLabel = lang === 'en' ? 'Journey' : '成长之路';

    const tabsHTML = `
      <div class="tab-bar">
        <button class="tab-btn ${_collectionTab === 'crops' ? 'active' : ''}" data-tab="crops">🥬 ${tabCropsLabel}</button>
        <button class="tab-btn ${_collectionTab === 'achievements' ? 'active' : ''}" data-tab="achievements">🏆 ${tabAchLabel}</button>
        <button class="tab-btn ${_collectionTab === 'journey' ? 'active' : ''}" data-tab="journey">🌱 ${tabJourneyLabel}</button>
      </div>
    `;

    const lvl = Farm.state.data.level;
    const title = Farm.state.levelTitle(lvl);
    const journeySubtitle = lang === 'en'
      ? 'Lv ' + lvl + ' · ' + title.en
      : 'Lv ' + lvl + ' · ' + title.zh;

    const subtitle = _collectionTab === 'crops' ? cropProgress
                   : _collectionTab === 'achievements' ? achProgress
                   : journeySubtitle;
    const bodyHTML = _collectionTab === 'crops' ? renderCropsList(all, grown, lang)
                   : _collectionTab === 'achievements' ? Farm.achievements.renderListHTML()
                   : renderJourney(lang);

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

  // Build the "成长之路 / Journey" timeline: titles + plot-unlock milestones,
  // merged + sorted by level, current row highlighted, past = green dimmed,
  // future = grey. Footer = the final goal (萨城传说 at Lv 200).
  function renderJourney(lang) {
    const curLevel = Farm.state.data.level;
    const curXp = Farm.state.data.xp;
    const titles = Farm.state.LEVEL_TITLES || [];
    const plotMap = Farm.state.PLOT_UNLOCK_AT || {};

    // Merge milestones into a single sorted list
    const milestones = [];
    titles.forEach(t => {
      milestones.push({
        level: t.min,
        kind: 'title',
        labelZh: '🏷 「' + t.zh + '」',
        labelEn: '🏷 ' + t.en,
      });
    });
    Object.keys(plotMap).forEach(lvStr => {
      const lv = parseInt(lvStr, 10);
      const count = plotMap[lvStr];
      milestones.push({
        level: lv,
        kind: 'plot',
        labelZh: '🏞 +' + count + ' 块地',
        labelEn: '🏞 +' + count + ' plot' + (count > 1 ? 's' : ''),
      });
    });
    // Crop-unlock milestones — the strongest "what's next" carrot in the genre.
    ((Farm.crops && Farm.crops.all && Farm.crops.all()) || []).forEach(function (c) {
      const lv = c.unlock_level || 1;
      const icon = c.icon || '🥬';
      milestones.push({
        level: lv,
        kind: 'crop',
        labelZh: icon + ' 解锁「' + (c.name_zh || c.id) + '」',
        labelEn: icon + ' Unlock ' + (c.name_en || c.id),
      });
    });
    milestones.sort(function (a, b) {
      if (a.level !== b.level) return a.level - b.level;
      return a.kind === 'title' ? -1 : 1;
    });

    const rowsHTML = milestones.map(function (m) {
      const isPast = m.level <= curLevel;
      const isCurrent = m.level === curLevel;
      const isFuture = m.level > curLevel;
      const stateClass = isCurrent ? 'current' : (isPast ? 'past' : 'future');
      const xpNeeded = isFuture ? Farm.state.xpForLevel(m.level) : null;
      const xpRemaining = xpNeeded != null ? Math.max(0, xpNeeded - curXp) : null;
      const label = lang === 'en' ? m.labelEn : m.labelZh;
      const xpHint = isFuture
        ? '<span class="journey-xp-needed">' +
            (lang === 'en' ? '−' + xpRemaining.toLocaleString() + ' XP' : '还需 ' + xpRemaining.toLocaleString() + ' XP') +
          '</span>'
        : isPast ? '<span class="journey-check">✓</span>' : '';
      return '<div class="journey-row journey-' + stateClass + '">' +
        '<div class="journey-level">Lv ' + m.level + '</div>' +
        '<div class="journey-label">' + label + '</div>' +
        '<div class="journey-meta">' + xpHint + '</div>' +
      '</div>';
    }).join('');

    const lastTitle = titles[titles.length - 1];
    const lastTitleName = lang === 'en' ? lastTitle.en : lastTitle.zh;
    const footer = '<div class="journey-footer">' +
      '🌅 ' + (lang === 'en'
        ? '「' + lastTitleName + '」 awaits — Lv ' + lastTitle.min
        : '「' + lastTitleName + '」 在等你 — Lv ' + lastTitle.min) +
    '</div>';

    return '<div class="journey-list">' + rowsHTML + '</div>' + footer;
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
        <div style="font-weight:600;margin-bottom:8px;">🌻 ${lang === 'en' ? 'Farm display' : '农场显示'}</div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
          <input id="decoToggle" type="checkbox" ${Farm.state.data.decorationsHidden ? '' : 'checked'}
                 style="width:16px;height:16px;cursor:pointer;"/>
          <span>${lang === 'en'
            ? 'Show pets + decorations on the farm'
            : '在农场上显示宠物 + 装饰品（小狗、气球等）'}</span>
        </label>
      </div>

      <div style="margin:16px 0;padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);">
        <div style="font-weight:600;margin-bottom:8px;">🏘 ${lang === 'en' ? 'Neighbor settings' : '邻居设置'}</div>
        <div style="font-size:11px;color:var(--warm-text-soft);margin-bottom:8px;">
          ${lang === 'en' ? 'How other members see you in the neighbor list.' : '其他会员在邻居列表里看到你的样子。'}
        </div>
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">${lang === 'en' ? 'Nickname' : '我的昵称'}</label>
        <input id="nicknameInput" type="text" maxlength="12" placeholder="${lang === 'en' ? 'e.g., Sask Mom' : '例如：萨城宝妈'}"
               value="${(Farm.state.data.nickname || '').replace(/"/g, '&quot;')}"
               style="width:100%;padding:8px 10px;font-size:13px;border:1.5px solid var(--border-soft);border-radius:8px;background:#fff;margin-bottom:10px;box-sizing:border-box;"/>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
          <input id="visibleToggle" type="checkbox" ${Farm.state.data.visibleToNeighbors !== false ? 'checked' : ''}
                 style="width:16px;height:16px;cursor:pointer;"/>
          <span>${lang === 'en' ? 'Show me in neighbor list' : '显示在邻居列表里'}</span>
        </label>
      </div>

      <div style="margin:16px 0;padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);">
        <div style="font-weight:600;margin-bottom:4px;">${Farm.i18n.t('settings_about')}</div>
        <div style="font-size:12px;color:var(--warm-text-soft);line-height:1.6;">
          ${Farm.i18n.t('about_made_by')}<br>
          ${Farm.i18n.t('about_visit_us')}
        </div>
        <a href="https://easternmarket.ca/"
           style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:8px 14px;background:linear-gradient(135deg,#3a8c50,#2a5c34);color:#fff;text-decoration:none;border-radius:var(--radius-pill);font-size:13px;font-weight:600;">
          🏪 ${lang === 'en' ? 'Visit Eastern Market site' : '访问东方超市官网'} →
        </a>
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
    // Farm display: decoration visibility toggle
    const decoEl = document.getElementById('decoToggle');
    if (decoEl) {
      decoEl.onchange = () => {
        Farm.state.data.decorationsHidden = !decoEl.checked;
        Farm.state.save();
        if (Farm.farm && Farm.farm.renderDecorations) Farm.farm.renderDecorations();
      };
    }
    // Neighbor settings: save nickname on blur, visibility on change
    const nickEl = document.getElementById('nicknameInput');
    if (nickEl) {
      nickEl.onblur = () => {
        const v = nickEl.value.trim().slice(0, 12);
        Farm.state.data.nickname = v || null;
        Farm.state.save();
        if (Farm.fbGameSync) Farm.fbGameSync.push();
      };
    }
    const visEl = document.getElementById('visibleToggle');
    if (visEl) {
      visEl.onchange = () => {
        Farm.state.data.visibleToNeighbors = visEl.checked;
        Farm.state.save();
        if (Farm.fbGameSync) Farm.fbGameSync.push();
      };
    }
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
