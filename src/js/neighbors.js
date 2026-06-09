/**
 * neighbors.js — Real Eastern Market members as neighbors (Phase 1).
 *
 * V1 used 60 procedural fake profiles. V2 (this file) queries
 * members/{uid}.gameStats from Firestore via Farm.fbGameSync, picks
 * 3 visible members daily (deterministic by date hash), and lets
 * players visit + like them. Falls back to procedural pool if
 * Firebase is unavailable (offline / SDK blocked).
 *
 * Includes a "排行榜 / Leaderboard" tab: top 10 members by farm level.
 */
(function () {
  // Procedural fallback pool — kept for offline mode / before Firestore
  // population is seeded. Smaller list, just safe defaults.
  const FALLBACK_POOL = [
    { name_zh: '王阿姨', name_en: 'Auntie Wang', emoji: '👩' },
    { name_zh: '张大叔', name_en: 'Uncle Zhang', emoji: '👨' },
    { name_zh: '李奶奶', name_en: 'Grandma Li', emoji: '👵' },
    { name_zh: '陈爷爷', name_en: 'Grandpa Chen', emoji: '👴' },
    { name_zh: '小红', name_en: 'Little Hong', emoji: '👧' },
    { name_zh: '小明', name_en: 'Little Ming', emoji: '👦' },
    { name_zh: '萨城宝妈', name_en: 'Sask Mom', emoji: '👩' },
    { name_zh: '黄医生', name_en: 'Dr. Huang', emoji: '👨‍⚕️' },
  ];

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = seed;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Generate a deterministic emoji + virtual farm layout for ANY neighbor
  // (real OR fallback). Used for the visit view so even brand-new real
  // members with empty farms have a friendly visual.
  function generateFarmDisplay(seed) {
    const playerLevel = Farm.state.data.level;
    const avail = Farm.crops.all().filter(c => c.unlock_level <= Math.min(playerLevel + 2, 10));
    const rng = mulberry32(hashStr(seed + ':farm'));
    const plots = [];
    const occupiedCount = 6 + Math.floor(rng() * 5);
    for (let i = 0; i < 12; i++) {
      if (i < occupiedCount && avail.length > 0) {
        const def = avail[Math.floor(rng() * avail.length)];
        plots.push({ cropId: def.id, stage: Math.floor(rng() * 3) });
      } else {
        plots.push({ cropId: null, stage: -1 });
      }
    }
    const decoEmojis = ['🏮', '🎐', '🌷', '🌻', '🦋'];
    const decoCount = Math.floor(rng() * 3);
    const decos = [];
    for (let i = 0; i < decoCount; i++) {
      decos.push(decoEmojis[Math.floor(rng() * decoEmojis.length)]);
    }
    return { plots, decos };
  }

  // Pick an avatar emoji for a member uid (deterministic so same person
  // always has the same face).
  function avatarFor(seed) {
    const pool = ['👩', '👨', '👵', '👴', '👧', '👦', '🧑', '👩‍🌾', '👨‍🌾',
                  '🧓', '🧑‍🎓', '👩‍🏫', '👨‍🍳', '🌺', '🌟', '🌅'];
    const idx = hashStr(seed + ':avatar') % pool.length;
    return pool[idx];
  }

  const neighbors = {
    _currentTab: 'today',  // 'today' | 'leaderboard'
    _todayList: null,
    _leaderboardList: null,

    // Build "today's 3 neighbors". Tries Firestore first; falls back to
    // procedural if Firestore returned no real members (e.g., first week
    // after launch when only Chris has the app).
    async _fetchToday() {
      if (this._todayList) return this._todayList;
      let real = [];
      if (Farm.fbGameSync) {
        try {
          const pool = await Farm.fbGameSync.fetchVisiblePool(30);
          real = Farm.fbGameSync.pickDailyThree(pool);
        } catch (_) {}
      }
      if (real.length === 3) {
        this._todayList = real.map((m, order) => ({
          isReal: true,
          uid: m.uid,
          name: Farm.fbGameSync.displayName(m.doc),
          emoji: avatarFor(m.uid),
          level: (m.doc.gameStats || {}).level || 1,
          totalHarvests: (m.doc.gameStats || {}).totalHarvests || 0,
          totalDeliveries: (m.doc.gameStats || {}).totalDeliveries || 0,
          likesReceived: (m.doc.gameStats || {}).likesReceived || 0,
          _doc: m.doc,
          id: 'real_' + m.uid,
          order,
        }));
      } else {
        // Top up with fallback profiles to ensure 3 cards
        const today = Farm.state.getDateString();
        const rng = mulberry32(hashStr(today + ':fallback'));
        const indices = new Set();
        while (indices.size < 3 - real.length) {
          indices.add(Math.floor(rng() * FALLBACK_POOL.length));
        }
        const fb = Array.from(indices).map(idx => {
          const p = FALLBACK_POOL[idx];
          const seed = 'fb_' + today + '_' + idx;
          return {
            isReal: false,
            uid: seed,
            name: Farm.state.data.language === 'en' ? p.name_en : p.name_zh,
            emoji: p.emoji,
            level: 2 + Math.floor(rng() * 6),
            totalHarvests: Math.floor(rng() * 100),
            totalDeliveries: Math.floor(rng() * 20),
            likesReceived: Math.floor(rng() * 10),
            id: seed,
            order: 99,
          };
        });
        this._todayList = real.map((m, order) => ({
          isReal: true,
          uid: m.uid,
          name: Farm.fbGameSync.displayName(m.doc),
          emoji: avatarFor(m.uid),
          level: (m.doc.gameStats || {}).level || 1,
          totalHarvests: (m.doc.gameStats || {}).totalHarvests || 0,
          totalDeliveries: (m.doc.gameStats || {}).totalDeliveries || 0,
          likesReceived: (m.doc.gameStats || {}).likesReceived || 0,
          id: 'real_' + m.uid,
          order,
        })).concat(fb).slice(0, 3);
      }
      return this._todayList;
    },

    _leaderboardMetric: 'weekly',  // 'weekly' | 'level' | 'harvests' | 'deliveries'
    _selfRank: null,

    async _fetchLeaderboard(metric) {
      metric = metric || this._leaderboardMetric;
      // Always refresh when metric changes
      if (this._leaderboardList && this._leaderboardMetric === metric) return this._leaderboardList;
      this._leaderboardMetric = metric;
      let list = [];
      if (Farm.fbGameSync) {
        try {
          const rows = await Farm.fbGameSync.fetchLeaderboard(metric, 10);
          const myId = Farm.fbAuth && (Farm.fbAuth.memberDocId ? Farm.fbAuth.memberDocId() : Farm.fbAuth.uid());
          const thisW = Farm.state.getWeekId ? Farm.state.getWeekId() : null;
          const lastW = Farm.state.getWeekId ? Farm.state.getWeekId(new Date(Date.now() - 7 * 86400000)) : null;
          list = rows.map(r => {
            const cw = r.doc && r.doc.gameStats && r.doc.gameStats.championWeek;
            return {
              uid: r.uid,
              name: Farm.fbGameSync.displayName(r.doc),
              emoji: avatarFor(r.uid),
              level: r.level,
              value: r.value,
              isSelf: r.uid === myId,
              champion: !!cw && (cw === thisW || cw === lastW),
              online: Farm.fbGameSync.onlineStatus(r.doc),
            };
          });
          // Self-rank (if not in top 10)
          if (Farm.fbAuth && Farm.fbAuth.isLoggedIn()) {
            this._selfRank = await Farm.fbGameSync.fetchSelfRank(metric);
          }
        } catch (_) {}
      }
      this._leaderboardList = list;
      return list;
    },

    async open() {
      // Invalidate cached fetches so a fresh open gets fresh data
      this._todayList = null;
      this._leaderboardList = null;
      this._selfRank = null;
      this._currentTab = 'today';
      this._render();
    },

    async _render() {
      const lang = Farm.state.data.language;
      const tab = this._currentTab;
      const visited = Farm.state.data.dailyClaims.neighborsVisited || [];
      const likesRemaining = Farm.fbGameSync ? Farm.fbGameSync.likesRemaining() : 0;

      // Reciprocal privacy: if user opted out of being visible, they
      // also can't browse other neighbors (no lurking allowed).
      if (Farm.state.data.visibleToNeighbors === false) {
        const title = lang === 'en' ? '🏘 Community' : '🏘 邻居广场';
        Farm.ui.showModal(`
          <h2 class="modal-title">${title}</h2>
          <div style="padding:24px 16px;text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;">🙈</div>
            <div style="font-size:14px;font-weight:600;color:var(--warm-text);margin-bottom:8px;">
              ${lang === 'en' ? "You're hidden from neighbors" : '你目前是隐身状态'}
            </div>
            <div style="font-size:12px;color:var(--warm-text-soft);line-height:1.6;margin-bottom:18px;">
              ${lang === 'en'
                ? "To browse neighbors + the leaderboard, you need to be visible too — it's only fair. Toggle visibility on in Settings."
                : '邻居广场是互相看的——你不让别人看到你，自然也看不到别人。要逛邻居 + 看排行榜，请到「设置」打开"显示在邻居列表里"。'}
            </div>
            <button class="btn" id="goToSettingsBtn">⚙️ ${lang === 'en' ? 'Open Settings' : '打开设置'}</button>
          </div>
        `);
        const goBtn = document.getElementById('goToSettingsBtn');
        if (goBtn) goBtn.onclick = () => {
          Farm.ui.hideModal();
          // Open settings via the bottom nav button
          const settingsBtn = document.querySelector('[data-action="settings"]');
          if (settingsBtn) settingsBtn.click();
        };
        return;
      }

      const friendCount = (Farm.state.data.friends || []).length;
      const tabBarHtml = `
        <div class="tab-bar" style="margin-bottom:10px;">
          <button class="tab-btn ${tab === 'today' ? 'active' : ''}" data-tab="today">
            🏘 ${lang === 'en' ? 'Today' : '今日'}
          </button>
          <button class="tab-btn ${tab === 'friends' ? 'active' : ''}" data-tab="friends">
            💚 ${lang === 'en' ? 'Friends' : '好友'}${friendCount > 0 ? ' (' + friendCount + ')' : ''}
          </button>
          <button class="tab-btn ${tab === 'leaderboard' ? 'active' : ''}" data-tab="leaderboard">
            🏆 ${lang === 'en' ? 'Leaderboard' : '排行榜'}
          </button>
        </div>
      `;

      let body = `<div style="text-align:center;padding:20px;color:var(--warm-text-soft);">⏳ ${lang === 'en' ? 'Loading…' : '加载中…'}</div>`;
      const title = lang === 'en' ? '🏘 Community' : '🏘 邻居广场';
      Farm.ui.showModal(`
        <h2 class="modal-title">${title}</h2>
        ${tabBarHtml}
        <div id="neighborBody">${body}</div>
        <div class="btn-row" style="margin-top:12px;">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `);

      // Wire tab buttons
      document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
        btn.onclick = () => {
          this._currentTab = btn.dataset.tab;
          if (Farm.audio) Farm.audio.play('tap');
          this._render();
        };
      });

      // Load + render body
      if (tab === 'today') {
        const list = await this._fetchToday();
        const cardsHtml = list.map(n => {
          const isVisited = visited.includes(n.id);
          const realBadge = n.isReal
            ? '<span class="neighbor-real-badge">✨ ' + (lang === 'en' ? 'real' : '真会员') + '</span>'
            : '';
          // Online indicator for real members only (fallback profiles have no real lastSeenAt)
          const online = (n.isReal && n._doc && Farm.fbGameSync)
            ? Farm.fbGameSync.onlineStatus(n._doc) : null;
          const onlineDot = (online && online.tier === 'online')
            ? '<span class="neighbor-online" title="' + (lang === 'en' ? online.labelEn : online.label) + '"></span>' : '';
          return `
            <div class="neighbor-card ${isVisited ? 'visited' : ''}" data-id="${n.id}">
              <div class="neighbor-avatar">${n.emoji}${onlineDot}</div>
              <div class="neighbor-name">${n.name} ${realBadge}</div>
              <div class="neighbor-status">
                Lv ${n.level} · ${isVisited
                  ? '✅ ' + (lang === 'en' ? 'Visited' : '已访问')
                  : '🚪 ' + (lang === 'en' ? 'Visit' : '去看看')}
              </div>
            </div>
          `;
        }).join('');
        // Progress bar + counter
        const visitPct = Math.min(100, visited.length / 3 * 100);
        const progressHtml = `
          <div class="neighbor-progress-wrap">
            <div class="neighbor-progress-text">
              <span>${lang === 'en' ? 'Visit 3 → +40 <span class="coin-icon"></span>' : '走访 3 户 → +40 <span class="coin-icon"></span>'}</span>
              <span class="neighbor-progress-count">${visited.length}/3</span>
            </div>
            <div class="neighbor-progress-bar"><div class="neighbor-progress-fill" style="width:${visitPct}%;"></div></div>
            <div class="neighbor-likes-meta">${lang === 'en' ? 'Likes left today' : '今日剩余赞'}: ❤️ ${likesRemaining}</div>
          </div>
        `;
        document.getElementById('neighborBody').innerHTML = progressHtml + '<div class="neighbor-list">' + cardsHtml + '</div>';
        document.querySelectorAll('.neighbor-card').forEach(card => {
          card.onclick = () => {
            const id = card.dataset.id;
            const found = list.find(x => x.id === id);
            if (found) this.viewFarm(found);
          };
        });
      } else if (tab === 'friends') {
        await this._renderFriendsTab(lang);
      } else if (tab === 'leaderboard') {
        const metric = this._leaderboardMetric;
        const metricLabels = {
          weekly:     lang === 'en' ? 'This Week'   : '本周',
          level:      lang === 'en' ? 'Level'       : '等级',
          harvests:   lang === 'en' ? 'Harvests'    : '收获数',
          deliveries: lang === 'en' ? 'Deliveries'  : '卖货次数',
        };
        const metricTabs = `
          <div class="lb-metric-tabs">
            <button class="lb-metric ${metric === 'weekly' ? 'active' : ''}" data-lb-metric="weekly">🔥 ${metricLabels.weekly}</button>
            <button class="lb-metric ${metric === 'level' ? 'active' : ''}" data-lb-metric="level">🏅 ${metricLabels.level}</button>
            <button class="lb-metric ${metric === 'harvests' ? 'active' : ''}" data-lb-metric="harvests">🌾 ${metricLabels.harvests}</button>
            <button class="lb-metric ${metric === 'deliveries' ? 'active' : ''}" data-lb-metric="deliveries">🏪 ${metricLabels.deliveries}</button>
          </div>
        `;
        const list = await this._fetchLeaderboard(metric);
        const selfInTop = list.some(m => m.isSelf);
        const selfRankHtml = (!selfInTop && this._selfRank)
          ? `<div class="lb-self-rank">${lang === 'en' ? 'Your rank' : '你的排名'}: <strong>#${this._selfRank.rank}${this._selfRank.capped ? '+' : ''}</strong> · ${metricLabels[metric]}: ${this._selfRank.myValue}</div>`
          : '';
        if (list.length === 0) {
          document.getElementById('neighborBody').innerHTML = `
            ${metricTabs}
            <p style="text-align:center;padding:30px 16px;color:var(--warm-text-soft);">
              ${lang === 'en' ? 'No leaderboard data yet. Be the first farmer!' : '排行榜还没人，你来当第一名吧！'}
            </p>
          `;
        } else {
          const rowsHtml = list.map((m, i) => {
            const rank = i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '<span style="display:inline-block;width:18px;text-align:center;color:var(--warm-text-soft);">' + rank + '</span>';
            const onlineDot = m.online && m.online.tier === 'online'
              ? '<span class="lb-online" title="' + m.online.label + '"></span>'
              : '';
            return `
              <div class="leaderboard-row ${m.isSelf ? 'is-self' : ''}">
                <span class="lb-rank">${medal}</span>
                <span class="lb-avatar">${m.emoji}${onlineDot}</span>
                <span class="lb-name">${m.champion ? '👑 ' : ''}${m.name}${m.isSelf ? ' <span class="lb-you">(你)</span>' : ''}</span>
                <span class="lb-level">${m.value}</span>
              </div>
            `;
          }).join('');
          document.getElementById('neighborBody').innerHTML = `
            ${metricTabs}
            <div class="leaderboard-list">${rowsHtml}</div>
            ${selfRankHtml}
          `;
        }
        // Wire metric tabs
        document.querySelectorAll('.lb-metric[data-lb-metric]').forEach(btn => {
          btn.onclick = () => {
            this._leaderboardMetric = btn.dataset.lbMetric;
            this._leaderboardList = null;  // force refetch
            if (Farm.audio) Farm.audio.play('tap');
            this._render();
          };
        });
      }
    },

    // Visit a single neighbor's farm + offer the Like button
    viewFarm(neighbor) {
      const lang = Farm.state.data.language;
      const fd = generateFarmDisplay(neighbor.id);

      const plotsHtml = fd.plots.map(p => {
        if (!p.cropId) return '<div class="neighbor-plot empty"></div>';
        const def = Farm.crops.get(p.cropId);
        if (!def) return '<div class="neighbor-plot empty"></div>';
        const svg = Farm.cropArt ? Farm.cropArt.svg(p.cropId, p.stage, 40) : `<span style="font-size:28px;">${def.icon}</span>`;
        return `<div class="neighbor-plot ${p.stage >= 2 ? 'mature' : 'growing'}">${svg}</div>`;
      }).join('');
      const decoHtml = fd.decos.length > 0
        ? '<div class="neighbor-decos">' + fd.decos.map(e => `<span>${e}</span>`).join('') + '</div>'
        : '';

      // Greeting line
      const greetings = lang === 'en' ? [
        'Welcome to my farm!',
        'Look at my crops!',
        'Just harvested some great greens today.',
        'I shop at Eastern Market every Saturday.',
      ] : [
        '欢迎来到我的农场！',
        '看看我的菜长得多好。',
        '今天刚收了一波青菜。',
        '我每周六去东方超市采购。',
      ];
      const greeting = greetings[hashStr(neighbor.id + Farm.state.getDateString()) % greetings.length];

      // Like button state
      const claims = Farm.state.data.dailyClaims;
      const alreadyLiked = (claims.likesSentToday || []).includes(neighbor.uid);
      const likesRemaining = Farm.fbGameSync ? Farm.fbGameSync.likesRemaining() : 0;
      const likeDisabled = alreadyLiked || likesRemaining === 0;
      const likeLabel = alreadyLiked
        ? '❤️ ' + (lang === 'en' ? 'Liked today' : '今日已赞')
        : likesRemaining === 0
          ? '❤️ ' + (lang === 'en' ? 'Daily limit' : '今日已满')
          : '❤️ ' + (lang === 'en' ? 'Send Like  +1 ' : '点个赞  +1 ') + '<span class="points-icon"></span>';

      const html = `
        <h2 class="modal-title">${neighbor.emoji} ${neighbor.name}</h2>
        <div style="text-align:center;font-size:12px;color:var(--warm-text-soft);margin-bottom:4px;">
          Lv ${neighbor.level} · ${lang === 'en' ? 'Harvests' : '收获'} ${neighbor.totalHarvests} · ${lang === 'en' ? 'Likes' : '赞'} ❤️${neighbor.likesReceived}
        </div>
        <div class="neighbor-greeting">"${greeting}"</div>
        <div class="neighbor-farm">${plotsHtml}</div>
        ${decoHtml}
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn secondary" id="neighborBack">${lang === 'en' ? 'Back' : '返回'}</button>
          <button class="btn ${likeDisabled ? 'disabled' : ''}" id="neighborLikeBtn" ${likeDisabled ? 'disabled' : ''}>
            ${likeLabel}
          </button>
        </div>
      `;
      Farm.ui.showModal(html);

      // Mark visited + reward if 3rd of day
      const wasNew = Farm.state.claimNeighborVisit(neighbor.id);
      if (wasNew) {
        const visited = Farm.state.data.dailyClaims.neighborsVisited;
        if (visited.length === 3) {
          Farm.state.addCoins(40);
          Farm.ui.refreshHUD();
          setTimeout(() => {
            Farm.ui.toast(lang === 'en'
              ? '🎉 Visited 3 neighbors! +40 <span class="coin-icon"></span>'
              : '🎉 走访 3 户完成 +40 <span class="coin-icon"></span>', 3000);
            if (Farm.audio) Farm.audio.play('achievement');
          }, 400);
        }
      }

      document.getElementById('neighborBack').onclick = () => this._render();
      const likeBtn = document.getElementById('neighborLikeBtn');
      if (likeBtn && !likeDisabled) {
        likeBtn.onclick = async () => {
          likeBtn.disabled = true;
          const result = await Farm.fbGameSync.sendLike(neighbor.uid);
          if (!result.ok) {
            Farm.ui.toast(result.message || '❌');
            likeBtn.disabled = false;
            return;
          }
          // Update UI: button becomes "liked"
          likeBtn.innerHTML = '❤️ ' + (lang === 'en' ? 'Liked!' : '已点赞！');
          Farm.ui.refreshHUD();
          if (Farm.audio) Farm.audio.play('coin');
          Farm.ui.toast(lang === 'en'
            ? `❤️ Liked! +${result.coinsEarned} <span class="coin-icon"></span> (${result.remaining} left today)`
            : `❤️ 点赞成功！+${result.coinsEarned} <span class="coin-icon"></span>（今日还剩 ${result.remaining}）`, 2200);
        };
      }
    },

    // ============ Friends tab ============
    async _renderFriendsTab(lang) {
      const friendUids = Farm.state.data.friends || [];
      const isLoggedIn = Farm.fbAuth && Farm.fbAuth.isLoggedIn();
      const body = document.getElementById('neighborBody');
      if (!isLoggedIn) {
        body.innerHTML = `
          <p style="text-align:center;padding:30px 16px;color:var(--warm-text-soft);">
            ${lang === 'en' ? 'Sign in to add friends.' : '登录后才能添加好友。'}
          </p>`;
        return;
      }
      // "Add friend" button always at top
      const addBtnHtml = `
        <button class="btn friend-add-btn" id="friendAddBtn">➕ ${lang === 'en' ? 'Add friend by phone' : '按手机号加好友'}</button>
      `;
      if (friendUids.length === 0) {
        body.innerHTML = `
          ${addBtnHtml}
          <p style="text-align:center;padding:24px 16px;color:var(--warm-text-soft);font-size:13px;line-height:1.6;">
            ${lang === 'en' ? 'No friends yet. Add the phone numbers of people you know from Eastern Market — see their farms anytime and send daily gifts.' : '还没好友。把你认识的东方超市会员手机号加进来——随时看他们的农场、每天送 1 份礼物。'}
          </p>`;
        const addBtn = document.getElementById('friendAddBtn');
        if (addBtn) addBtn.onclick = () => this._openAddFriendModal();
        return;
      }
      // Loading placeholder while fetching
      body.innerHTML = `${addBtnHtml}<div style="text-align:center;padding:20px;color:var(--warm-text-soft);">⏳</div>`;
      const addBtn = document.getElementById('friendAddBtn');
      if (addBtn) addBtn.onclick = () => this._openAddFriendModal();
      // Fetch friend docs
      const docs = await Farm.fbGameSync.fetchFriendDocs();
      const giftAvailable = Farm.fbGameSync.canSendGiftToday();
      const cardsHtml = docs.map(m => {
        const name = Farm.fbGameSync.displayName(m.doc);
        const stats = m.doc.gameStats || {};
        const level = stats.level || 1;
        const harvests = stats.totalHarvests || 0;
        const emoji = avatarFor(m.uid);
        const online = Farm.fbGameSync.onlineStatus(m.doc);
        const onlineDot = (online && online.tier === 'online')
          ? '<span class="neighbor-online"></span>' : '';
        return `
          <div class="friend-card" data-friend-uid="${m.uid}">
            <div class="friend-avatar">${emoji}${onlineDot}</div>
            <div class="friend-info">
              <div class="friend-name">${name}</div>
              <div class="friend-meta">Lv ${level} · ${lang === 'en' ? 'Harvests' : '收获'} ${harvests}</div>
            </div>
            <div class="friend-actions">
              <button class="friend-action-btn friend-visit-btn" data-action="visit" data-uid="${m.uid}" title="${lang === 'en' ? 'Visit' : '看农场'}">🏘</button>
              <button class="friend-action-btn friend-gift-btn ${giftAvailable ? '' : 'disabled'}" data-action="gift" data-uid="${m.uid}" ${giftAvailable ? '' : 'disabled'} title="${lang === 'en' ? 'Send gift' : '送礼物'}">🎁</button>
            </div>
          </div>
        `;
      }).join('');
      const giftHintHtml = giftAvailable
        ? `<p class="friend-gift-hint">🎁 ${lang === 'en' ? "Today's free gift available (1 per day)" : '今日还有 1 份免费礼物可送'}</p>`
        : `<p class="friend-gift-hint friend-gift-hint--used">🎁 ${lang === 'en' ? "Today's gift already sent. Come back tomorrow!" : '今日礼物已送出，明天再来吧'}</p>`;
      body.innerHTML = `
        ${addBtnHtml}
        ${giftHintHtml}
        <div class="friend-list">${cardsHtml}</div>
      `;
      const addBtn2 = document.getElementById('friendAddBtn');
      if (addBtn2) addBtn2.onclick = () => this._openAddFriendModal();
      // Wire visit + gift action buttons
      document.querySelectorAll('.friend-action-btn').forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          const uid = b.dataset.uid;
          const action = b.dataset.action;
          const friendDoc = docs.find(d => d.uid === uid);
          if (!friendDoc) return;
          if (action === 'visit') {
            this.viewFarm({
              id: 'friend_' + uid,
              uid,
              name: Farm.fbGameSync.displayName(friendDoc.doc),
              emoji: avatarFor(uid),
              level: (friendDoc.doc.gameStats || {}).level || 1,
              totalHarvests: (friendDoc.doc.gameStats || {}).totalHarvests || 0,
              totalDeliveries: (friendDoc.doc.gameStats || {}).totalDeliveries || 0,
              likesReceived: (friendDoc.doc.gameStats || {}).likesReceived || 0,
              isReal: true,
            });
          } else if (action === 'gift') {
            this._openGiftModal(uid, Farm.fbGameSync.displayName(friendDoc.doc));
          }
        };
      });
    },

    _openAddFriendModal() {
      const lang = Farm.state.data.language;
      const html = `
        <h2 class="modal-title">➕ ${lang === 'en' ? 'Add friend' : '加好友'}</h2>
        <p class="modal-subtitle">${lang === 'en'
          ? "Enter their Eastern Market phone number"
          : '输入对方在东方超市留的手机号'}</p>
        <div class="auth-field">
          <div class="auth-phone-input">
            <span class="auth-phone-prefix">+1</span>
            <input type="tel" id="friendPhone" class="auth-input auth-input-phone"
                   inputmode="numeric" maxlength="14" placeholder="(306) 123-4567"/>
          </div>
        </div>
        <div id="friendAddError" class="auth-error"></div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_cancel')}</button>
          <button class="btn" id="friendAddSubmit">${lang === 'en' ? 'Add' : '添加'}</button>
        </div>
      `;
      Farm.ui.showModal(html);
      const input = document.getElementById('friendPhone');
      const errEl = document.getElementById('friendAddError');
      const submitBtn = document.getElementById('friendAddSubmit');
      if (input) {
        setTimeout(() => input.focus(), 100);
        input.oninput = (e) => {
          const d = e.target.value.replace(/\D/g, '').slice(0, 10);
          e.target.value = d.length <= 3 ? d
            : d.length <= 6 ? `(${d.slice(0,3)}) ${d.slice(3)}`
            : `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`;
        };
        input.onkeydown = (e) => { if (e.key === 'Enter') submitBtn.click(); };
      }
      submitBtn.onclick = async () => {
        const digits = (input.value || '').replace(/\D/g, '');
        if (digits.length !== 10) {
          errEl.textContent = lang === 'en' ? 'Please enter a 10-digit phone number.' : '请输入 10 位手机号';
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = lang === 'en' ? 'Looking up…' : '查询中…';
        const e164 = '+1' + digits;
        const res = await Farm.fbGameSync.findMemberByPhone(e164);
        if (!res.found) {
          submitBtn.disabled = false;
          submitBtn.textContent = lang === 'en' ? 'Add' : '添加';
          const msgs = {
            self:        lang === 'en' ? "That's your own phone!" : '这是你自己的手机号',
            hidden:      lang === 'en' ? 'This member is hidden from neighbors.' : '此会员已隐身',
            not_member:  lang === 'en' ? "Phone not registered at our store. Ask them to sign up at Eastern Market." : '此号码未注册东方超市会员',
            not_playing: lang === 'en' ? "This member hasn't started playing the game yet." : '此会员还没玩这个游戏',
            error:       lang === 'en' ? 'Lookup failed. Try again.' : '查询失败，请重试',
          };
          errEl.textContent = msgs[res.reason] || (lang === 'en' ? 'Not found.' : '未找到');
          return;
        }
        // Add friend locally + sync
        const add = await Farm.fbGameSync.addFriend(res.member.uid);
        if (!add.ok && add.reason === 'already_friend') {
          errEl.textContent = lang === 'en' ? 'Already your friend.' : '已经是好友了';
          submitBtn.disabled = false;
          submitBtn.textContent = lang === 'en' ? 'Add' : '添加';
          return;
        }
        Farm.ui.hideModal();
        if (Farm.audio) Farm.audio.play('achievement');
        const name = Farm.fbGameSync.displayName(res.member.doc);
        Farm.ui.toast(lang === 'en'
          ? `💚 Added ${name} as a friend!`
          : `💚 已加好友：${name}`, 2400);
        // Refresh friends tab
        this._currentTab = 'friends';
        this._render();
      };
    },

    _openGiftModal(toUid, toName) {
      const lang = Farm.state.data.language;
      const safeName = String(toName).replace(/[<>"&]/g, '');
      const html = `
        <h2 class="modal-title">🎁 ${lang === 'en' ? 'Send gift to ' : '送礼物给 '}${safeName}</h2>
        <p class="modal-subtitle">${lang === 'en'
          ? 'Pick one (1 free gift per day):'
          : '挑一个（每天 1 份免费）：'}</p>
        <div class="gift-choices">
          <button class="btn gift-choice" data-gift-kind="seed">
            <div class="gift-choice-title">🌱 ${lang === 'en' ? 'Random seed' : '随机种子'}</div>
            <div class="gift-choice-sub">${lang === 'en' ? 'A surprise easy-tier seed' : '一棵初级蔬菜种子'}</div>
          </button>
          <button class="btn gift-choice" data-gift-kind="coins">
            <div class="gift-choice-title">🪙 ${lang === 'en' ? '+50 Farm Coins' : '+50 农场币'}</div>
            <div class="gift-choice-sub">${lang === 'en' ? 'A coin gift for their farm' : '送给对方一点农场币'}</div>
          </button>
        </div>
      `;
      Farm.ui.showModal(html);
      document.querySelectorAll('.gift-choice').forEach(btn => {
        btn.onclick = async () => {
          const kind = btn.dataset.giftKind;
          btn.disabled = true;
          const res = await Farm.fbGameSync.sendGift(toUid, kind);
          if (!res.ok) {
            Farm.ui.toast(res.message || (lang === 'en' ? '❌ Failed to send' : '❌ 发送失败'), 2400);
            btn.disabled = false;
            return;
          }
          Farm.ui.hideModal();
          if (Farm.audio) Farm.audio.play('coin');
          Farm.ui.toast(lang === 'en'
            ? `🎁 Gift sent to ${safeName}!`
            : `🎁 礼物已送给 ${safeName}！`, 2600);
          // Refresh tab so gift hint updates
          this._currentTab = 'friends';
          this._render();
        };
      });
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.neighbors = neighbors;
})();
