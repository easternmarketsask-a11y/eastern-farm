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
  // (Removed dead FALLBACK_POOL of textbook names 王阿姨/张大叔… — neighbor
  // fill-in now uses the deterministic AI roster, never these placeholders.)

  // HTML-escape any cross-player name before it hits innerHTML (stored-XSS
  // guard, 2026-06-11). Falls back to a local escaper if ui.js absent.
  const esc = (s) => (Farm.ui && Farm.ui.escapeHtml)
    ? Farm.ui.escapeHtml(s)
    : String(s == null ? '' : s).replace(/[<>&"']/g, '');

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

    visitTarget() {
      const n = (this._todayList || []).length;
      if (n <= 0) return 0;
      return Math.min(3, n);
    },
    noteVisit(neighbor) {
      const id = (neighbor && neighbor.id) || (neighbor && neighbor.uid ? 'real_' + neighbor.uid : '');
      if (!id || !Farm.state.claimNeighborVisit) return;
      const wasNew = Farm.state.claimNeighborVisit(id);
      if (!wasNew) return;
      const visited = Farm.state.data.dailyClaims.neighborsVisited || [];
      const need = this.visitTarget() || 3;
      const claims = Farm.state.data.dailyClaims;
      if (claims.neighborQuestPaid || visited.length < need) return;
      claims.neighborQuestPaid = true;
      Farm.state.addCoins(40);
      Farm.state.save();
      if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      const lang = Farm.state.data.language;
      setTimeout(() => {
        if (Farm.ui.toast) Farm.ui.toast(lang === 'en'
          ? 'Visited today\'s neighbors · +40 coins'
          : '今日走访完成 · +40 农场币', 3000);
        if (Farm.audio) Farm.audio.play('achievement');
      }, 400);
    },

    // 今天在过线的真人，不够 3 个也全列，不补假人。
    async _fetchToday() {
      if (this._todayList) return this._todayList;
      let real = [];
      if (Farm.fbGameSync && Farm.fbGameSync.fetchOnlineToday) {
        try { real = await Farm.fbGameSync.fetchOnlineToday(20); } catch (_) {}
      }
      const list = real.map((m, order) => ({
        isReal: true,
        uid: m.uid,
        name: Farm.fbGameSync.displayName(m.doc, m.uid),
        emoji: avatarFor(m.uid),
        level: (m.doc.gameStats || {}).level || 1,
        totalHarvests: (m.doc.gameStats || {}).totalHarvests || 0,
        totalDeliveries: (m.doc.gameStats || {}).totalDeliveries || 0,
        likesReceived: (m.doc.gameStats || {}).likesReceived || 0,
        _doc: m.doc,
        id: 'real_' + m.uid,
        order,
      }));
      this._todayList = list;
      return this._todayList;
    },

    _leaderboardMetric: 'harvests',  // landing tab: all-time harvests (always populated); 'weekly' | 'level' | 'harvests' | 'deliveries'
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
            const gs = (r.doc && r.doc.gameStats) || {};
            const cw = gs.championWeek;
            return {
              uid: r.uid,
              id: 'real_' + r.uid,        // stable visit id (matches today-list)
              name: Farm.fbGameSync.displayName(r.doc, r.uid),
              emoji: avatarFor(r.uid),
              level: r.level,
              value: r.value,
              totalHarvests: gs.totalHarvests || 0,
              likesReceived: gs.likesReceived || 0,
              isSelf: r.uid === myId,
              needsName: !Farm.fbGameSync.hasRealName(r.doc),
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
      // 把今日出场的 AI 邻居并入排行榜后按指标重排取前 10（与真会员混排，让榜单
      // 是活的）。只混入 todaysCast 小名单（≤maxFill 个），不再全员 12 人刷榜。
      if (Farm.aiNeighbors && Farm.aiNeighbors.loaded) {
        const now = Date.now();
        const aiRows = Farm.aiNeighbors.todaysCast().map(aiId => {
          const card = Farm.aiNeighbors.displayCard(aiId, now);
          const active = Farm.aiNeighbors.isActiveNow(aiId, now);
          return {
            uid: aiId, id: aiId, isAI: true,
            name: card.name, emoji: card.emoji, level: card.level,
            value: Farm.aiNeighbors.metricValue(aiId, metric, now),
            totalHarvests: card.totalHarvests, likesReceived: card.likesReceived,
            isSelf: false, champion: false,
            online: active ? { tier: 'online', label: '在线', labelEn: 'online' } : null,
          };
        });
        list = list.concat(aiRows).sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 10);
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
      if (Farm.isoView) Farm.isoView._distantAt = 0;
      this._render();
    },

    async _render() {
      const lang = Farm.state.data.language;
      const tab = this._currentTab;
      const visited = Farm.state.data.dailyClaims.neighborsVisited || [];
      const likesRemaining = Farm.fbGameSync ? Farm.fbGameSync.likesRemaining() : 0;

      /* 🔒 待激活账号（邮箱注册、还没到店激活）先不开社交（2026-08-20）。
         串门/互偷/点赞的每日上限都是按账号算的，而邮箱注册零成本 —— 一个人
         开五个小号刷自己的大号是几分钟的事。激活要报手机号，那才是真的闸。
         ⚠️ 文案照实说「激活之后就能串门」，不是「无权限」。这是又一个把人
            推进店门的理由，不是惩罚。 */
      if (Farm.fbAuth && Farm.fbAuth.memberDoc && Farm.fbAuth.memberDoc._pending) {
        const en = lang === 'en';
        Farm.ui.showModal(`
          <h2 class="modal-title">${en ? '🏘 Community' : '🏘 邻居广场'}</h2>
          <div style="padding:20px 16px;text-align:center;">
            <div style="font-size:44px;margin-bottom:12px;">🏡</div>
            <div style="font-size:14.5px;line-height:1.7;color:var(--warm-text);margin-bottom:10px;">
              ${en
                ? 'Visiting neighbours opens up once your member card is set up.'
                : '办好会员卡之后就能串门了。'}
            </div>
            <div style="font-size:12.5px;color:var(--warm-text-soft);line-height:1.65;margin-bottom:16px;">
              ${en
                ? 'Give us your phone number next time you shop — it takes a few seconds at the till, and the points you have earned land on your card at the same time.'
                : '下次来店里报一下手机号，收银台几秒钟就好 —— 你攒的超市积分也会同时到账。'}
            </div>
            <div style="font-size:12px;color:var(--warm-text-soft);line-height:1.6;">
              133-412 Willowgrove Square<br>${en ? 'Mon–Sat 10am–6:30pm' : '周一至周六 10am–6:30pm'}
            </div>
            <button class="btn" style="width:100%;margin-top:16px;" onclick="Farm.ui.hideModal()">
              ${en ? 'Got it' : '知道了'}
            </button>
          </div>
        `);
        return;
      }

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
          // Settings moved off the bottom nav → open it directly.
          if (Farm.openSettings) Farm.openSettings();
        };
        return;
      }

      const friendCount = (Farm.state.data.friends || []).length;
      const tabBarHtml = `
        <div class="tab-bar" style="margin-bottom:10px;">
          <button class="tab-btn ${tab === 'today' ? 'active' : ''}" data-tab="today">
            🏘 ${lang === 'en' ? 'Online today' : '今天在线'}
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
        <div class="btn-row nb-footer" style="margin-top:12px;gap:8px;">
          <button class="btn" id="nbFooterInvite" style="flex:1.2;" onclick="Farm.fbGameSync && Farm.fbGameSync.shareInvite()">📨 ${lang === 'en' ? 'Invite' : '邀请好友'}</button>
          <button class="btn secondary" style="flex:1;" onclick="Farm.share && Farm.share.open()">📸 ${lang === 'en' ? 'Share' : '晒农场'}</button>
          <button class="btn secondary" style="flex:0.8;" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
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
        // No real neighbors visible yet → invite state instead of fake people.
        if (list.length === 0) {
          const face = (n) => (Farm.farmer && Farm.farmer.previewStyle)
            ? '<div class="farmer-look-face" style="' + Farm.farmer.previewStyle(n) + '"></div>'
            : '';
          document.getElementById('neighborBody').innerHTML = `
            <div style="padding:22px 16px;text-align:center;">
              <div class="nb-empty-faces">${face(2)}${face(1)}${face(9)}</div>
              <div style="font-size:14px;font-weight:600;color:var(--warm-text);margin-bottom:8px;">
                ${lang === 'en' ? 'No neighbors around yet' : '现在还没有邻居在线'}
              </div>
              <div style="font-size:12px;color:var(--warm-text-soft);line-height:1.6;margin-bottom:16px;">
                ${lang === 'en'
                  ? 'As more Eastern Market members start farming, real neighbors show up here. Invite a friend, or add one by phone number.'
                  : '随着更多东方超市会员开始种菜，真实邻居就会出现在这里。叫上朋友一起玩，或用手机号直接加好友。'}
              </div>
              <button class="btn" id="emptyInviteBtn">📨 ${lang === 'en' ? 'Invite a friend (+' : '邀请好友（各得 '}${Farm.fbGameSync ? Farm.fbGameSync.INVITE_BONUS : 200}${lang === 'en' ? ' coins each)' : ' 农场币）'}</button>
              <button class="btn secondary" id="emptyAddFriendBtn" style="margin-top:8px;">➕ ${lang === 'en' ? 'Add a friend by phone' : '用手机号加好友'}</button>
            </div>
          `;
          const invBtn = document.getElementById('emptyInviteBtn');
          if (invBtn) invBtn.onclick = () => { if (Farm.fbGameSync) Farm.fbGameSync.shareInvite(); };
          // 空状态正文已经有一颗带奖励说明的大「邀请好友」，底栏那颗同名按钮就藏起来，别一屏两个
          const footInv = document.getElementById('nbFooterInvite');
          if (footInv) footInv.style.display = 'none';
          const addBtn = document.getElementById('emptyAddFriendBtn');
          if (addBtn) addBtn.onclick = () => { this._currentTab = 'friends'; this._render(); };
          return;
        }
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
              <div class="neighbor-name">${esc(n.name)} ${realBadge}</div>
              <div class="neighbor-status">
                Lv ${n.level} · ${isVisited
                  ? '✅ ' + (lang === 'en' ? 'Visited' : '已访问')
                  : '🚪 ' + (lang === 'en' ? 'Visit' : '去看看')}
              </div>
            </div>
          `;
        }).join('');
        // Progress bar + counter
        const need = Math.min(3, Math.max(1, list.length));
        const visitPct = Math.min(100, visited.length / need * 100);
        const progressHtml = `
          <div class="neighbor-progress-wrap">
            <div style="margin-bottom:8px;">
              <button class="btn" id="todayInviteBtn" style="width:100%;">📨 ${lang === 'en' ? 'Invite a friend' : '邀请好友'}</button>
            </div>
            <div class="neighbor-progress-text">
              <span>${lang === 'en' ? ('Visit ' + need + ' → +40 <span class="coin-icon"></span>') : ('走访 ' + need + ' 户 → +40 <span class="coin-icon"></span>')}</span>
              <span class="neighbor-progress-count">${visited.length}/${need}</span>
            </div>
            <div class="neighbor-progress-bar"><div class="neighbor-progress-fill" style="width:${visitPct}%;"></div></div>
            <div class="neighbor-likes-meta">${lang === 'en' ? 'Likes left today' : '今日剩余赞'}: ❤️ ${likesRemaining}</div>
          </div>
        `;
        document.getElementById('neighborBody').innerHTML = progressHtml + '<div class="neighbor-list">' + cardsHtml + '</div>';
        const todayInv = document.getElementById('todayInviteBtn');
        if (todayInv) todayInv.onclick = () => { if (Farm.fbGameSync) Farm.fbGameSync.shareInvite(); };
        if (list.length > 0 && Farm.coach) Farm.coach.fire('first_neighbor', 500);
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
              ${lang === 'en' ? 'No ranking data yet' : '暂无排行数据'}
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
              <div class="leaderboard-row ${m.isSelf ? 'is-self' : 'is-visitable'}" ${m.isSelf ? '' : 'data-lb-uid="' + m.uid + '"'}>
                <span class="lb-rank">${medal}</span>
                <span class="lb-avatar">${m.emoji}${onlineDot}</span>
                <span class="lb-name">${m.champion ? '👑 ' : ''}${esc(m.name)}${m.isSelf ? ' <span class="lb-you">' + (lang === 'en' ? '(you)' : '(你)') + '</span>' : ''}${m.isSelf && m.needsName ? ' <button class="lb-name-cta" data-lb-name="1">' + (lang === 'en' ? 'Name it' : '起个名字') + '</button>' : ''}</span>
                <span class="lb-level">${m.value}</span>
                ${m.isSelf ? '' : '<span class="lb-visit">🏘</span>'}
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
        // Tap any leaderboard row → visit that player's farm (like/help/sticker).
        // This is how players reach anyone beyond today's 3 neighbors.
        /* 榜上看到自己是「萨城邻居」时，一步就能起名 —— 不用去翻设置。
           这也是同名问题的出口：榜上几个「萨城邻居」谁也分不清谁。 */
        document.querySelectorAll('[data-lb-name]').forEach((b) => {
          b.onclick = (e) => {
            e.stopPropagation();
            if (Farm.audio) Farm.audio.play('tap');
            if (Farm.lifeStory && Farm.lifeStory.promptNickname) Farm.lifeStory.promptNickname();
          };
        });
        document.querySelectorAll('.leaderboard-row.is-visitable[data-lb-uid]').forEach(row => {
          row.onclick = () => {
            const uid = row.dataset.lbUid;
            const m = (this._leaderboardList || []).find(x => x.uid === uid);
            if (!m) return;
            if (Farm.audio) Farm.audio.play('tap');
            this.viewFarm(m);
          };
        });
      }
    },

    // Visit a single neighbor's farm + offer the Like button
    async viewFarm(neighbor, opts) {
      const lang = Farm.state.data.language;
      const isAI = !!neighbor.isAI;
      /* 🏡 门后是真实世界(2026-08-14): 真会员且有 worldLayout 布局镜像 →
         直接走进 TA 家的**实景农场**(渲染器拜访模式)。opts.classic 强制
         经典卡片面板(顺菜/送礼在那边, 有完整的上限与看门狗)。
         布局镜像是 Phase A 新数据, 老客户端玩家还没有 → 自动回落经典面板。 */
      if (!isAI && !(opts && opts.classic) && neighbor.uid
          && Farm.isoView && Farm.isoView.enterVisitFarm && Farm.isoView.active()) {
        let wl = neighbor._doc && neighbor._doc.gameStats && neighbor._doc.gameStats.worldLayout;
        if (!wl && Farm.fb && Farm.fb.available) {
          try {
            const snap = await Farm.fb.db.collection('farm_players').doc(neighbor.uid).get();
            if (snap.exists) {
              const gs = snap.data().gameStats || {};
              if (gs.worldLayout) { wl = gs.worldLayout; neighbor._doc = Object.assign({}, neighbor._doc, { gameStats: gs }); }
            }
          } catch (_) {}
        }
        if (wl && Array.isArray(wl.plots)) {
          if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
          const ok = Farm.isoView.enterVisitFarm({
            uid: neighbor.uid, name: neighbor.name, emoji: neighbor.emoji,
            level: neighbor.level || 1, layout: wl, _neighbor: neighbor,
            farmerLook: neighbor._doc && neighbor._doc.gameStats && neighbor._doc.gameStats.farmerLook,
          });
          if (ok) return;
        }
      }
      const myId = Farm.fbAuth && (Farm.fbAuth.memberDocId ? Farm.fbAuth.memberDocId() : Farm.fbAuth.uid && Farm.fbAuth.uid());

      // 农场数据源（spec 2026-06-11）：
      //   AI → 确定性引擎；真会员 → farm_players 快照(farmPlots)真农场；
      //   无快照(老客户端/离线) → 回落生成的占位农场（不可偷）。
      let fd = null;
      let realSnap = null;   // { hasGuardDog, level } — 有真快照才可偷
      if (isAI && Farm.aiNeighbors && Farm.aiNeighbors.loaded) {
        fd = Farm.aiNeighbors.farmDisplay(neighbor.uid, Date.now());
      } else if (!isAI && neighbor.uid && Farm.fb && Farm.fb.available) {
        let gs = (neighbor._doc && neighbor._doc.gameStats) || null;
        if (!gs || !Array.isArray(gs.farmPlots)) {
          try {
            const snap = await Farm.fb.db.collection('farm_players').doc(neighbor.uid).get();
            if (snap.exists) gs = snap.data().gameStats || gs;
          } catch (_) {}
        }
        if (gs && Array.isArray(gs.farmPlots)) {
          realSnap = { hasGuardDog: !!gs.hasGuardDog, level: gs.level || neighbor.level || 1 };
          // 回填卡片头部缺失字段（小报"去讨回来"只带 uid+name 进来）
          if (neighbor.level == null) neighbor.level = gs.level || 1;
          if (neighbor.totalHarvests == null) neighbor.totalHarvests = gs.totalHarvests || 0;
          if (neighbor.likesReceived == null) neighbor.likesReceived = gs.likesReceived || 0;
          const slots = Array.from({ length: 12 }, () => ({ cropId: null, stage: -1, mature: false }));
          gs.farmPlots.forEach((fp) => {
            const def = fp && Farm.crops.get(fp.c);
            if (!def || fp.i == null || fp.i < 0 || fp.i >= 12) return;
            const growMs = (def.grow_minutes || 30) * 60000;
            const frac = growMs > 0 ? (Date.now() - (fp.p || 0)) / growMs : 1;
            slots[fp.i] = {
              cropId: fp.c,
              stage: frac >= 1 ? 2 : (frac >= 0.4 ? 1 : 0),
              mature: frac >= 1,
              plantedAt: fp.p || 0,
              plotIdx: fp.i,
            };
          });
          fd = { plots: slots, decos: [] };
        }
      }
      if (!fd) fd = generateFarmDisplay(neighbor.id);

      const cfg = Farm.socialConfig || {};
      const stealUnlocked = !!(Farm.steal && Farm.steal.isUnlocked && Farm.steal.isUnlocked());
      // 可偷判定：解锁 + 真会员需有真快照 + 不是自己 + 已登录 + 对方过新手保护线
      const realStealable = stealUnlocked && !!realSnap && !!myId && neighbor.uid !== myId &&
        (realSnap.level >= (cfg.NEWBIE_PROTECT_LEVEL || 3)) &&
        Farm.steal && Farm.steal.stealFromReal;

      const plotsHtml = fd.plots.map((p, i) => {
        if (!p.cropId) return '<div class="neighbor-plot empty"></div>';
        const def = Farm.crops.get(p.cropId);
        if (!def) return '<div class="neighbor-plot empty"></div>';
        const svg = Farm.cropArt ? Farm.cropArt.svg(p.cropId, p.stage, 40) : `<span style="font-size:28px;">${def.icon}</span>`;
        const mature = p.stage >= 2;
        const canSteal = mature && stealUnlocked && (isAI || realStealable);
        const cls = `neighbor-plot ${mature ? 'mature' : 'growing'}${canSteal ? ' stealable' : ''}`;
        const dataAttr = canSteal
          ? ` data-steal-idx="${p.plotIdx != null ? p.plotIdx : i}" data-steal-crop="${p.cropId}" data-steal-planted="${p.plantedAt || 0}"`
          : '';
        const basket = canSteal ? '<span class="neighbor-steal-hint">🧺</span>' : '';
        return `<div class="${cls}"${dataAttr}>${svg}${basket}</div>`;
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
          : '❤️ ' + (lang === 'en' ? 'Like +1 ' : '点赞 +1 ') + '<span class="points-icon"></span>';

      // Help (water) button state
      const gs = Farm.fbGameSync;
      const helpedAlready = gs && gs.helpedToday && gs.helpedToday(neighbor.uid);
      const helpRemaining = gs && gs.helpRemaining ? gs.helpRemaining() : 0;
      const helpDisabled = !!helpedAlready || helpRemaining === 0;
      const helpLabel = helpedAlready
        ? '💧 ' + (lang === 'en' ? 'Helped today' : '今日已帮')
        : helpRemaining === 0
          ? '💧 ' + (lang === 'en' ? 'Daily limit' : '今日已满')
          : '💧 ' + (lang === 'en' ? 'Water +10 ' : '帮浇水 +10 ') + '<span class="coin-icon"></span>';
      const STICKERS = ['👍', '🌸', '🎉', '💪', '😋'];
      const stickersLeft = gs && gs.stickersRemaining ? gs.stickersRemaining() : 0;
      const stickerRow = stickersLeft > 0
        ? `<div class="neighbor-stickers">
             <span class="sticker-hint">${lang === 'en' ? 'Say hi:' : '打个招呼：'}</span>
             ${STICKERS.map(e => `<button class="sticker-btn" data-sticker="${e}">${e}</button>`).join('')}
           </div>`
        : `<div class="neighbor-stickers"><span class="sticker-hint">${lang === 'en' ? 'Sticker limit reached today' : '今日贴纸已用完'}</span></div>`;

      const html = `
        <h2 class="modal-title">${neighbor.emoji} ${esc(neighbor.name)}</h2>
        <div style="text-align:center;font-size:12px;color:var(--warm-text-soft);margin-bottom:4px;">
          Lv ${neighbor.level} · ${lang === 'en' ? 'Harvests' : '收获'} ${neighbor.totalHarvests} · ${lang === 'en' ? 'Likes' : '赞'} ❤️${neighbor.likesReceived}
        </div>
        <div class="neighbor-greeting">"${greeting}"</div>
        <div class="neighbor-farm">${plotsHtml}</div>
        ${(isAI || realStealable)
          ? `<div class="neighbor-steal-tip">${lang === 'en' ? 'Tap a ripe crop to take one' : '点成熟作物可取回一棵'}</div>`
          : (!stealUnlocked && fd.plots.some(p => p.cropId && p.stage >= 2)
              ? `<div class="neighbor-steal-tip" style="opacity:.85;">${lang === 'en' ? 'Harvest a crop of your own first, then you can take one here.' : '先收一次自己的菜，才能在这里顺。'}</div>`
              : '')}
        ${decoHtml}
        <div class="neighbor-actions">
          <button class="btn ${likeDisabled ? 'disabled' : ''}" id="neighborLikeBtn" ${likeDisabled ? 'disabled' : ''}>${likeLabel}</button>
          <button class="btn secondary ${helpDisabled ? 'disabled' : ''}" id="neighborHelpBtn" ${helpDisabled ? 'disabled' : ''}>${helpLabel}</button>
        </div>
        ${stickerRow}
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn secondary" id="neighborBack">${lang === 'en' ? 'Back' : '返回'}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      // 来访足迹：逛真会员农场给对方留一条「来逛过🐾」（每天每家一次，
      // recordVisit 内部节流；AI/自己/未登录自动跳过）。
      if (!isAI && neighbor.uid && myId && neighbor.uid !== myId &&
          Farm.fbGameSync && Farm.fbGameSync.recordVisit) {
        Farm.fbGameSync.recordVisit(neighbor.uid);
      }

      // Mark visited + reward if 3rd of day
      this.noteVisit(neighbor);

      document.getElementById('neighborBack').onclick = () => this._render();

      // 主动偷：点熟了的菜顺一棵入仓（遵守每日/单户上限 + 仓库满保护）。
      // AI 走本地 stealOne；真会员走 stealFromReal（含看家狗判定 + 事件写云端）。
      if ((neighbor.isAI || realStealable) && Farm.steal) {
        const stealSuccessUi = (cell) => {
          cell.classList.remove('stealable', 'mature');
          cell.classList.add('stolen');
          cell.onclick = null;
          cell.innerHTML = '<span class="neighbor-steal-done">✓</span>';
          const rect = cell.getBoundingClientRect();
          if (Farm.ui.floatText) {
            Farm.ui.floatText('🧺 +1 ' + (lang === 'en' ? 'to barn' : '入库'),
              rect.left + rect.width / 2 - 18, rect.top, '#3a8c50');
          }
          if (Farm.audio) Farm.audio.play('coin');
          Farm.ui.refreshHUD();
          Farm.ui.toast(Farm.i18n.t('steal_done', { name: esc(neighbor.name) }), 2000);
        };
        const failToast = (r) => {
          if (r.message) { Farm.ui.toast(r.message, 3000); return; }
          Farm.ui.toast(r.reason === 'warehouse_full'
            ? Farm.i18n.t('steal_warehouse_full')
            : (r.reason === 'daily_cap' ? Farm.i18n.t('steal_daily_cap') : Farm.i18n.t('steal_target_cap')), 2700);
        };
        document.querySelectorAll('.neighbor-plot.stealable').forEach(cell => {
          cell.onclick = async () => {
            const cropId = cell.dataset.stealCrop;
            if (neighbor.isAI) {
              const can = Farm.steal.canStealFrom(neighbor.uid);
              if (!can.ok) { failToast(can); return; }
              const r = Farm.steal.stealOne(neighbor.uid, cropId);
              if (!r.ok) { failToast(r); return; }
              stealSuccessUi(cell);
              return;
            }
            // 真会员：防连点 → 异步走完整规则
            if (cell.dataset.busy) return;
            cell.dataset.busy = '1';
            const r = await Farm.steal.stealFromReal(
              { uid: neighbor.uid, name: neighbor.name, level: realSnap.level, hasGuardDog: realSnap.hasGuardDog },
              { plotIdx: parseInt(cell.dataset.stealIdx, 10),
                cropId: cropId,
                plantedAt: parseInt(cell.dataset.stealPlanted, 10) || 0 }
            );
            delete cell.dataset.busy;
            if (!r.ok) {
              if (r.reason === 'caught') {
                // 被狗逮住：这块菜偷不成了
                cell.classList.remove('stealable', 'mature');
                cell.classList.add('stolen');
                cell.onclick = null;
                cell.innerHTML = '<span class="neighbor-steal-done">🐕</span>';
                if (Farm.audio) Farm.audio.play('error');
                Farm.ui.refreshHUD();
              }
              failToast(r);
              return;
            }
            stealSuccessUi(cell);
          };
        });
      }

      const likeBtn = document.getElementById('neighborLikeBtn');
      if (likeBtn && !likeDisabled) {
        likeBtn.onclick = async () => {
          likeBtn.disabled = true;
          const result = neighbor.isAI
            ? Farm.aiNeighbors.interact(neighbor.uid, 'like')
            : await Farm.fbGameSync.sendLike(neighbor.uid);
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

      // Help (water) button
      const helpBtn = document.getElementById('neighborHelpBtn');
      if (helpBtn && !helpDisabled) {
        helpBtn.onclick = async () => {
          helpBtn.disabled = true;
          const r = neighbor.isAI
            ? Farm.aiNeighbors.interact(neighbor.uid, 'help')
            : await Farm.fbGameSync.sendHelp(neighbor.uid);
          if (!r.ok) {
            Farm.ui.toast(r.message || '❌');
            helpBtn.disabled = false;
            return;
          }
          helpBtn.innerHTML = '💧 ' + (lang === 'en' ? 'Watered!' : '已帮浇水！');
          Farm.ui.refreshHUD();
          if (Farm.audio) Farm.audio.play('coin');
          Farm.ui.toast(lang === 'en'
            ? `💧 Watered ${esc(neighbor.name)}'s crops! +${r.coinsEarned} <span class="coin-icon"></span> (${r.remaining} left)`
            : `💧 帮 ${esc(neighbor.name)} 浇了水！+${r.coinsEarned} <span class="coin-icon"></span>（今日还剩 ${r.remaining}）`, 2600);
        };
      }

      // Sticker buttons (say hi)
      document.querySelectorAll('.sticker-btn[data-sticker]').forEach(btn => {
        btn.onclick = async () => {
          const emoji = btn.dataset.sticker;
          document.querySelectorAll('.sticker-btn').forEach(b => { b.disabled = true; });
          const r = neighbor.isAI
            ? Farm.aiNeighbors.interact(neighbor.uid, 'sticker', emoji)
            : await Farm.fbGameSync.sendSticker(neighbor.uid, emoji);
          if (!r.ok) {
            Farm.ui.toast(r.message || '❌');
            document.querySelectorAll('.sticker-btn').forEach(b => { b.disabled = false; });
            return;
          }
          btn.style.transform = 'scale(1.4)';
          if (Farm.audio) Farm.audio.play('tap');
          Farm.ui.refreshHUD();
          Farm.ui.toast(emoji + ' ' + (lang === 'en' ? `Sent to ${esc(neighbor.name)}!` : `已发给 ${esc(neighbor.name)}！`), 1800);
        };
      });
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
        const name = Farm.fbGameSync.displayName(m.doc, m.uid);
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
              name: Farm.fbGameSync.displayName(friendDoc.doc, uid),
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
        <h2 class="modal-title">${lang === 'en' ? 'Add friend' : '加好友'}</h2>
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
            // 后端限流命中（防手机号枚举）。必须与「查不到这个人」分开说，
            // 否则玩家会以为好友不是会员。
            too_many: lang === 'en'
              ? 'Too many lookups just now — please try again in a bit.'
              : '刚才查得太频繁了，过一会儿再试。',
            not_logged_in: lang === 'en'
              ? 'Please sign in first to add friends.'
              : '请先登录再添加好友。',
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
        <h2 class="modal-title">${lang === 'en' ? 'Send gift to ' : '送礼物给 '}${safeName}</h2>
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

  // 头像函数对外暴露：回家小报给真小偷配头像时要和邻居卡片一致。
  neighbors.avatarFor = avatarFor;

  window.Farm = window.Farm || {};
  window.Farm.neighbors = neighbors;
})();
