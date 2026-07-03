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
  // Shown when the browser isn't persisting localStorage across reloads (so
  // progress reverts every refresh). It's a device setting; tell the user how
  // to fix it on their end.
  function showStorageWarning() {
    if (!Farm.ui || !Farm.ui.showModal) return;
    const en = (Farm.state && Farm.state.data && Farm.state.data.language) === 'en';
    const html = en ? `
      <div style="text-align:center;padding:4px 2px;">
        <div style="font-size:46px;line-height:1;margin-bottom:6px;">⚠️</div>
        <h2 class="modal-title" style="margin-bottom:4px;">Progress isn't being saved</h2>
        <p style="font-size:13.5px;line-height:1.6;color:var(--warm-text-soft);margin:6px 6px 0;text-align:left;">
          This browser isn't keeping your save between page loads, so coins / sign-in / crops reset on every refresh. Usually one of:
          <br>• <b>Private Browsing</b> is on → turn it off<br>• Settings → Safari → <b>Block All Cookies</b> is on → turn it off<br>• Or tap Share → <b>Add to Home Screen</b> and open from that icon
        </p>
        <div class="btn-row" style="margin-top:16px;"><button class="btn" id="stoOk" style="width:100%;">Got it</button></div>
      </div>` : `
      <div style="text-align:center;padding:4px 2px;">
        <div style="font-size:46px;line-height:1;margin-bottom:6px;">⚠️</div>
        <h2 class="modal-title" style="margin-bottom:4px;">进度没能保存</h2>
        <p style="font-size:13.5px;line-height:1.7;color:var(--warm-text-soft);margin:6px 6px 0;text-align:left;">
          这个浏览器没有在刷新之间保留存档，所以每次刷新金币 / 签到 / 作物都会退回。多半是下面之一：
          <br>• 开了<b>「无痕浏览」</b> → 请关掉<br>• 设置 → Safari → <b>「阻止所有 Cookie」</b>开着 → 请关掉<br>• 或点分享 → <b>「添加到主屏幕」</b>，以后从那个图标打开
        </p>
        <div class="btn-row" style="margin-top:16px;"><button class="btn" id="stoOk" style="width:100%;">知道了</button></div>
      </div>`;
    Farm.ui.showModal(html);
    const ok = document.getElementById('stoOk');
    if (ok) ok.onclick = () => Farm.ui.hideModal();
  }

  async function boot() {
    console.log('🌱 Happy Farm booting...');

    // Storage-persistence probe — MUST run before Farm.state.init() writes.
    // sessionStorage survives same-tab reloads; localStorage should too. If
    // we've already loaded in this tab (marker present) yet the save key is
    // GONE, the browser isn't persisting localStorage across reloads — every
    // refresh wipes progress (coins/sign-in/crops appear to "revert"). This is
    // a device setting (Private Browsing / Block All Cookies / storage
    // eviction), not something code can fully fix — so we surface it clearly.
    // CONSERVATIVE trigger: only flag broken storage if a PRIOR boot fully
    // completed in this tab (ef_boot_done set at end of boot) yet the save is
    // now GONE — proving localStorage didn't persist across the reload. Avoids
    // false-warning a first-ever visit refreshed mid-load (no marker yet).
    let _storageBroken = false;
    try {
      const hadSave = !!localStorage.getItem('eastern_farm_save_v1');
      const bootDone = sessionStorage.getItem('ef_boot_done');
      if (bootDone && !hadSave) _storageBroken = true;
    } catch (_) {}

    // 1. Load data files in parallel. Each loader is wrapped in .catch so a single
    // failed/hung fetch on a flaky mobile network can NEVER reject the whole boot —
    // that was leaving the splash up with a dead "进入农场" button (Chris's recurring
    // "stuck, can't enter"). Each loader already degrades internally on failure.
    await Promise.all([
      Farm.i18n.load(),
      Farm.crops.load(),
      Farm.rewards.load(),
      Farm.achievements.load(),
      Farm.epShop.load(),
      Farm.daily.load(),
      Farm.aiNeighbors.load(),
    ].map(function (p) { return (p && p.catch) ? p.catch(function (e) { console.warn('[boot] a data loader failed (continuing):', e); }) : p; }));

    // 1b. 邀请链接：进场就把 ?ref=<会员id> 存下（登录后 applyReferral 发奖）。
    try {
      const refMatch = location.search.match(/[?&]ref=([A-Za-z0-9_-]{4,64})/);
      if (refMatch) localStorage.setItem('eastern_farm_ref', refMatch[1]);
    } catch (_) {}

    // 2-3b. Boot prelude (state/migrate/auth/i18n/weather). Wrapped so a throw in
    // ANY of these can't abort boot before wireSplash() below runs — the splash must
    // ALWAYS become dismissable so the player can enter the game (state.init() is
    // additionally hardened against corrupted saves). Same intent as the steps 4-7 try.
    try {
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
    } catch (e) {
      console.error('[boot] prelude (state/auth/i18n) failed — continuing so splash stays dismissable:', e);
    }

    // Steps 4-7 are wrapped so a failure in any single subsystem (tasks/events/render/
    // warehouse/orders/storekeeper) can't stop wireNav/wireSplash below from running —
    // the splash must ALWAYS become dismissable so the player can enter the game.
    try {
      // 4. Daily tasks
      Farm.tasks.initDaily();
      Farm.tasks.updateBadge();

      // 5. Festival check
      Farm.events.check();

      // 5b. 被偷结算（回家小报）——必须在 renderGrid 前，让农场直接显示被顺后的状态。
      if (Farm.homeReport) Farm.homeReport.settleOnBoot();

      // 6. Initial render
      Farm.ui.refreshHUD();
      Farm.farm.renderGrid();
      if (Farm.seasons) Farm.seasons.apply();
      if (Farm.harvestStatus) Farm.harvestStatus.render();

      // 6b. Install the floating warehouse button on the farm view
      if (Farm.warehouse && Farm.warehouse.installButton) {
        Farm.warehouse.installButton();
      }

      // 6c. Buildable map view init is now deferred until after splash dismiss (see wireSplash),
      // so the entry buttons are guaranteed responsive and no early canvas overlay conflicts.

      // 6d. Seed 小东's order board + show his fillable-order badge
      if (Farm.orders) { Farm.orders.ensure(); Farm.orders.refreshBadge(); }

      // 7. Storekeeper
      Farm.storekeeper.refresh();
    } catch (e) {
      console.error('[boot] render/init step failed (continuing to wire splash):', e);
    }

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
      // Defer the main farm view (iso or map) until after splash, to guarantee
      // splash entry buttons always work and avoid any early overlay conflicts.
      // Guarded: iso init hides the classic DOM grid first, so if it throws the
      // player would be left on a blank screen (splash already removed). On failure
      // we re-show the classic grid so there's always a playable view.
      try {
        if (Farm.isoView && Farm.isoView.active && Farm.isoView.active()) {
          Farm.isoView.init();
        } else if (Farm.mapView && Farm.mapView.active && Farm.mapView.active()) {
          Farm.mapView.init();
        }
      } catch (e) {
        console.error('[boot] farm view init failed — falling back to classic grid', e);
        try {
          ['farmGrid', 'farmDecorations'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = ''; });
          var sc = document.querySelector('.farm-scene'); if (sc) sc.style.display = '';
          if (Farm.farm && Farm.farm.renderGrid) Farm.farm.renderGrid();
        } catch (_) {}
      }

      try { checkDailyLogin(); } catch (e) { console.warn('[boot] checkDailyLogin failed', e); }
      Farm.achievements.checkAll();
      refreshTodayBadge();
      // First-time welcome overlay (3-step). Defer past the daily-login toast
      // so it lands on a clean screen, not under another notification.
      if (Farm.tutorial && Farm.tutorial.maybeShow) {
        setTimeout(() => Farm.tutorial.maybeShow(), 700);
      }
      // 回家小报：排在签到/教程之后，自排队避开撞窗。
      if (Farm.homeReport && Farm.homeReport.maybeShow) {
        setTimeout(() => Farm.homeReport.maybeShow(), 1100);
      }
    });

    // Refresh the today badge whenever the modal closes
    setInterval(refreshTodayBadge, 60000);

    // 9. Ticks
    setInterval(() => Farm.farm.tick(), 1000);
    setInterval(() => Farm.storekeeper.refresh(), 45000);  // rotate every 45s
    setInterval(() => Farm.events.check(), 60000 * 30);    // re-check every 30 min
    // 心跳：持续刷新"上次活跃"，让下次回来能正确算出离开多久（被偷结算用）。
    setInterval(() => { Farm.state.data.lastActiveAt = Date.now(); Farm.state.save(); }, 60000);

    console.log('✅ Happy Farm ready.');

    // 存储不持久 → 明确告知用户(刷新就丢进度的根因)。延迟到开屏散去后弹。
    if (_storageBroken) setTimeout(showStorageWarning, 1600);

    // 匿名漏斗:每次打开计一次。访客判定移到 firebase-auth 的 onAuthStateChanged
    // 首次解析(无 user)时记 open_guest——避免慢网络下把登录会员误判为访客。
    // Firebase 不可用(离线)时永远不会回调,这里兜底记一次访客。
    if (Farm.track) {
      Farm.track('open');
      if (!Farm.fb || !Farm.fb.available) Farm.track('open_guest');
    }

    // Mark a fully-completed boot in this tab. The storage probe (top of boot)
    // only warns when this marker is present on a later load yet the save is
    // gone — proving storage didn't persist (not just a mid-load refresh).
    try { sessionStorage.setItem('ef_boot_done', '1'); } catch (_) {}
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

    // The 7-day sign-in calendar NO LONGER auto-pops (Chris 2026-06-17). Players
    // open it from the「今日」panel (the sign-in card → 去签到/查看) or via tasks.
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

  // Show how many daily items are still unclaimed today (sign-in + news + lottery + neighbors + special seed = up to 5).
  function refreshTodayBadge() {
    const badge = document.getElementById('todayBadge');
    if (!badge) return;
    const c = Farm.state.data.dailyClaims;
    let pending = 0;
    // 签到是唯一带连续性损失厌恶的日钩子，但自动弹窗 2026-06-17 禁用后入口
    // 深达四层且无任何未签指示——断签压力完全不可见。未签到计入红点（2026-07-02）。
    const cal = Farm.state.data.loginCalendar || {};
    if (cal.lastSignDate !== Farm.state.getDateString()) pending++;
    if (!c.newsRead) pending++;
    if (!c.lotterySpunFree) pending++;
    if ((c.neighborsVisited || []).length < 3) pending++;
    // Special seed is always there if not bought; we'll count it if not yet planted today
    const specId = Farm.daily && Farm.daily.getSpecialSeedId();
    if (specId) pending++;
    badge.textContent = pending > 0 ? pending : '';
  }

  // Bottom-sheet nav menu opened by the top-right hamburger (replaces the old bottom bar).
  function openNavMenu() {
    const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
    const items = [
      { a: 'shop', icon: '🛒', zh: '种子店', en: 'Seeds' },
      { a: 'tasks', icon: '📋', zh: '任务', en: 'Tasks' },
      { a: 'orders', icon: '📦', zh: '东超订单', en: 'Orders' },
      { a: 'community', icon: '🏘', zh: '社区', en: 'Community' },
      { a: 'store', icon: '🛍️', zh: '农场商城', en: 'Mall' },
      { a: 'expand', icon: '🗺️', zh: '扩建农场', en: 'Expand' },
      { a: 'collection', icon: '📖', zh: '图鉴', en: 'Collection' },
      { a: 'guide', icon: '❓', zh: '怎么玩', en: 'How to' },
      { a: 'settings', icon: '⚙️', zh: '设置', en: 'Settings' },
    ];
    const grid = items.map(it =>
      '<button class="nav-menu-item" data-nav="' + it.a + '"><span class="nav-menu-icon">' + it.icon +
      '</span><span class="nav-menu-label">' + (lang === 'en' ? it.en : it.zh) + '</span></button>'
    ).join('');
    Farm.ui.showModal('<h2 class="modal-title">📂 ' + (lang === 'en' ? 'Menu' : '菜单') + '</h2><div class="nav-menu-grid">' + grid + '</div>');
    document.querySelectorAll('#modalContent .nav-menu-item').forEach(btn => {
      btn.onclick = () => {
        if (Farm.audio) Farm.audio.play('tap');
        switch (btn.getAttribute('data-nav')) {
          case 'shop': Farm.shop.open(); break;
          case 'tasks': Farm.tasks.open(); break;
          case 'orders': if (Farm.orders) Farm.orders.open(); break;
          case 'community': if (Farm.neighbors) Farm.neighbors.open(); break;
          case 'store': if (Farm.epShop) Farm.epShop.open(); break;
          case 'expand': if (Farm.isoView && Farm.isoView._tryUnlockLand) Farm.isoView._tryUnlockLand(); else if (Farm.ui) Farm.ui.toast('扩建仅在农场视图可用'); break;
          case 'collection': openCollection(); break;
          case 'guide': if (Farm.guide) Farm.guide.open(); break;
          case 'settings': openSettings(); break;
        }
      };
    });
  }

  function wireNav() {
    const hb = document.getElementById('hamburgerButton');
    if (hb) hb.onclick = () => { if (Farm.audio) Farm.audio.play('tap'); openNavMenu(); };
    document.querySelectorAll('.action-btn[data-action]').forEach(btn => {
      const action = btn.dataset.action;
      btn.onclick = () => {
        if (Farm.audio) Farm.audio.play('tap');
        switch (action) {
          case 'shop': Farm.shop.open(); break;
          case 'tasks': Farm.tasks.open(); break;
          case 'store': if (Farm.epShop) Farm.epShop.open(); break;   // 农场商城
          case 'rewards': Farm.rewards.open(); break;                  // legacy (now via points card)
          case 'community': if (Farm.neighbors) Farm.neighbors.open(); break;
          case 'collection': openCollection(); break;
          case 'settings': openSettings(); break;
        }
      };
    });

    // 顶部货币卡片点击：超市积分卡 → 兑换/积分明细面板；农场币卡 → 农场币
    // 信息面板（余额 / 兑换 / 获取规则）。
    const pointsCard = document.getElementById('pointsCard');
    if (pointsCard) pointsCard.onclick = () => {
      if (Farm.audio) Farm.audio.play('tap');
      if (Farm.rewards) Farm.rewards.open();
    };
    const coinsCard = document.getElementById('coinsCard');
    if (coinsCard) coinsCard.onclick = () => {
      if (Farm.audio) Farm.audio.play('tap');
      if (Farm.rewards && Farm.rewards.openCoinInfo) Farm.rewards.openCoinInfo();
    };
  }

  // Settings left the bottom nav (now reached via the 👤 account button, both
  // logged-in and logged-out). Expose it so firebase-auth.js can open it.
  window.Farm = window.Farm || {};
  Farm.openSettings = openSettings;

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
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-soft);">
          <input id="ownerExcludeToggle" type="checkbox" ${Farm.state.data.excludeFromRanking === true ? 'checked' : ''}
                 style="width:16px;height:16px;cursor:pointer;"/>
          <span>${lang === 'en' ? '🏪 Store owner — keep me out of all rankings (I can still browse)' : '🏪 我是店主，不参与所有排名（仍可逛社区）'}</span>
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
        <button class="btn danger" id="resetBtn">${Farm.i18n.t('settings_reset')}</button>
      </div>
    `;
    Farm.ui.showModal(html);

    const applyLanguage = (lang) => {
      Farm.state.data.language = lang;
      Farm.state.save();
      Farm.i18n.setLanguage(lang);
      Farm.ui.refreshHUD();
      Farm.farm.renderGrid();
      // The iso map is a canvas overlay the DOM grid render never touches —
      // refresh its Build button / palette / mode-tab labels too.
      if (Farm.isoView && Farm.isoView.relang) Farm.isoView.relang();
      Farm.events.check();
      Farm.storekeeper.refresh();
      openSettings();
    };
    document.getElementById('langZh').onclick = () => applyLanguage('zh');
    document.getElementById('langEn').onclick = () => applyLanguage('en');
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
        // Strip HTML-significant chars at the write boundary (defense-in-depth
        // with render-time escaping): a nickname is plain text, never markup.
        const v = nickEl.value.replace(/[<>&"']/g, '').trim().slice(0, 12);
        nickEl.value = v;
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
    const ownerEl = document.getElementById('ownerExcludeToggle');
    if (ownerEl) {
      ownerEl.onchange = () => {
        Farm.state.data.excludeFromRanking = ownerEl.checked;
        Farm.state.save();
        if (Farm.fbGameSync) Farm.fbGameSync.push();
        Farm.ui.toast(ownerEl.checked
          ? (Farm.state.data.language === 'en' ? '🏪 You are now hidden from all rankings' : '🏪 已设为店主，不出现在任何排名中')
          : (Farm.state.data.language === 'en' ? 'Back in the rankings' : '已重新参与排名'), 2200);
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
