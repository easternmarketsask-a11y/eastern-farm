/**
 * firebase-game-sync.js — Sync game stats to Firestore + query other
 * members for the neighbor / leaderboard system.
 *
 * Architecture:
 *   members/{uid}.gameStats = {
 *     level: number,
 *     totalHarvests: number,
 *     totalDeliveries: number,
 *     nickname: string | null,   // user-set; null → derive "{firstChar}邻居"
 *     visibleToNeighbors: bool,  // default true (set via settings)
 *     likesReceived: number,     // atomic counter, only ever incremented
 *     lastSeenAt: serverTimestamp,
 *   }
 *
 * Sync trigger: pushStatsDebounced() called by state.save(). Pushes at
 * most once every 60s OR when triggered by an explicit event (level up,
 * delivery completion). When offline / not logged in: no-op silently.
 */
(function () {
  // 与 firebase-auth.js / firebase-points.js / analytics.js / feedback.js 同一个后端
  const STOCKWISE_BASE = 'https://stockwise-app-873982544406.us-central1.run.app';
  const FRIEND_LOOKUP_TIMEOUT_MS = 15000;
  const SYNC_MIN_INTERVAL_MS = 30 * 1000;   // was 60s — halve worst-case loss between pushes
  const SAVE_BLOB_VERSION = 1;   // cloud save-blob schema version
  const PRIVACY_DEFAULT_VISIBLE = true;
  const DAILY_LIKE_CAP = 5;
  const DAILY_HELP_CAP = 5;       // help (water) up to 5 neighbors/day
  const DAILY_STICKER_CAP = 10;   // leave up to 10 stickers/day
  const HELP_RECIPIENT_COINS = 20;
  const HELP_SENDER_COINS = 10;
  const STICKER_SENDER_COINS = 2;
  // Largest legitimate single coin grant that can arrive via pendingGifts
  // (INVITE_BONUS = 200; gift coins = 50; help = 20). Inbound gifts are
  // written by OTHER players to our farm_players doc, so their amount is
  // untrusted — clamp to this to block crafted huge-amount exploits.
  const MAX_GIFT_COINS = 200;
  // 周榜官方发奖（weeklyLeaderboardRewards 云函数）冠军 2000 币，走同一个
  // pendingGifts 收件箱 — 旧钳制把 2000 吞成 200（冠军只到账 10%）。
  // fromUid:'system' 理论上可被其他玩家伪造，但农场币本就是客户端权威
  // （本地存档说了算），此钳制只防意外灌币，2000 上限风险可接受。
  const MAX_SYSTEM_GIFT_COINS = 2000;
  let _lastSyncAt = 0;
  let _pendingTimer = null;
  let _dirty = false;   // true when local state changed since the last successful cloud push

  // "Me": the REAL member doc id (store-keyed). All game data for the current
  // player must read/write this doc — NOT doc(authUid), which created the
  // legacy orphan docs. Other players are addressed by ids from queries, which
  // are real member doc ids once gameStats live on the real docs.
  function meId() {
    if (!(window.Farm && Farm.fbAuth)) return null;
    if (Farm.fbAuth.memberDocId) return Farm.fbAuth.memberDocId();
    return Farm.fbAuth.uid ? Farm.fbAuth.uid() : null;
  }

  const gameSync = {
    // Safe public display name for THIS player (no real name leaks to others):
    // nickname if set, else "{firstChar of own real name}邻居", else generic.
    // Computed for the player's OWN doc only, so reading their own member name
    // is fine — the derived string is what gets stored publicly.
    _selfDisplayName() {
      const s = Farm.state.data;
      if (s.nickname) return s.nickname;
      const md = (Farm.fbAuth && Farm.fbAuth.memberDoc) || {};
      const realName = md.name || md.firstName || '';
      const fc = (realName + '').trim().charAt(0);
      return this._fallbackName(fc);
    },

    // Language-aware fallback display name for members with no set nickname.
    // Keeps EN neighbor lists from leaking Chinese「邻居」when the viewer is
    // playing in English. Display/derive layer only — never a save field.
    _fallbackName(firstChar) {
      const en = (Farm.state && Farm.state.data && Farm.state.data.language) === 'en';
      if (firstChar) return en ? 'Neighbor ' + firstChar : firstChar + '邻居';
      return en ? 'Saskatoon farmer' : '萨城邻居';
    },

    // Compute the gameStats payload from local state. Pure function.
    _buildPayload() {
      const s = Farm.state.data;
      return {
        displayName: this._selfDisplayName(),
        level: s.level || 1,
        totalHarvests: s.totalHarvests || 0,
        totalDeliveries: s.totalDeliveries || 0,
        weeklyHarvests: s.weeklyHarvests || 0,
        weekId: s.weekId || '',
        nickname: s.nickname || null,
        visibleToNeighbors: s.visibleToNeighbors == null
          ? PRIVACY_DEFAULT_VISIBLE
          : !!s.visibleToNeighbors,
        // Store-owner flag: when true the account is dropped from EVERYONE
        // else's neighbor pool + leaderboards + weekly rewards, but the owner
        // can still browse the community (unlike visibleToNeighbors=false,
        // which also blinds the owner). Set via the owner toggle in settings.
        excludeFromRanking: !!(s.excludeFromRanking && Farm.fbAuth && Farm.fbAuth.isStoreOwner && Farm.fbAuth.isStoreOwner()),
        // Claimed limited-time promos (per-account guard against local reset).
        promoClaims: s.promoClaims || {},
        // Farm snapshot for real-member visits + stealing (spec 2026-06-11):
        // non-empty unlocked plots only, compact {i,c,p,g} = plotIdx/cropId/
        // plantedAt/growMinutes. Visitors (and the StockWise admin panel)
        // compute live maturity from p + g without needing crops.json.
        farmPlots: (s.plots || [])
          .map((p, i) => ({ i, c: p.crop, p: p.plantedAt || 0, u: !!p.unlocked }))
          .filter(p => p.u && p.c)
          .map(p => {
            const def = (Farm.crops && Farm.crops.get) ? Farm.crops.get(p.c) : null;
            return { i: p.i, c: p.c, p: p.p, g: (def && def.grow_minutes) || 0 };
          }),
        /* 🗺️ 世界布局镜像(2026-08-14, 共享世界 Phase A —— Chris:「要看到真实的
           邻居农场, 每个农场有相应的地理空间, 走得够远理论上能走访所有农场」):
           把农场的**几何布局**(地块坐标/建筑/水塘/小路/装饰/家的等级)放进公开
           档案, 供以后把邻居的农场**实景**画在共享地图上。零隐私(纯游戏视觉),
           压缩键名控制体积(约 1-4KB), 随既有 60 秒防抖一起推。
           ⚠️ Phase B(渲染邻居实景+世界坐标)要等大家的客户端先跑几天这段代码,
           数据攒起来了才有东西可画 —— 所以镜像先行。 */
        worldLayout: {
          v: 1,
          plots: (s.plots || [])
            .filter((p) => p && p.unlocked && Number.isInteger(p.gx))
            .slice(0, 48)
            .map((p) => ({ x: p.gx, y: p.gy, c: p.crop || null, p: p.plantedAt || 0 })),
          bld: (s.map || [])
            .filter((o) => o && Number.isInteger(o.gx))
            .slice(0, 24)
            .map((o) => ({ t: o.type, x: o.gx, y: o.gy, lv: o.lv || 0 })),
          terr: Object.entries(s.mapTerrain || {})
            .slice(0, 96)
            .map(([k, t]) => ({ k, t })),
          deco: (s.decorations || [])
            .filter((d) => d && Number.isInteger(d.gx))
            .slice(0, 40)
            .map((d) => ({ d: d.itemId, x: d.gx, y: d.gy })),
          landLevel: s.landLevel || 0,
          o: s.landOrigin === 'front' ? 'front' : 'back',
          cl: Object.keys(s.clearedCells || {}).slice(0, 32),
        },
        // Live balances for the admin 游戏管理 panel (display only — the
        // authoritative copy stays in the local save).
        coins: s.coins || 0,
        eastPoints: s.eastPoints || 0,
        // Guard-dog flag: thief side reads this to tighten caps + risk being caught.
        hasGuardDog: !!(Farm.defenses && Farm.defenses.hasDog && Farm.defenses.hasDog()),
        lastSeenAt: Farm.fb && Farm.fb.serverTimestamp
          ? Farm.fb.serverTimestamp()
          : new Date(),
      };
    },

    // Immediate push — used at boot or on explicit triggers.
    async push() {
      // 🔒 拜访模式: state.data 指向邻居的伪状态 —— 此刻 push 会把**别人的农场
      // 布局和 gameSave blob 覆盖进我的云档**。拜访期间云同步冻结。
      if (Farm.state && Farm.state._visitLock) return { ok: false, reason: 'visiting' };
      if (!Farm.fb || !Farm.fb.available) return { ok: false, reason: 'offline' };
      if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return { ok: false, reason: 'not_logged_in' };
      // Anti-orphan guard: never write gameStats until the REAL member doc has
      // resolved. Without this, meId() falls back to the auth uid and we'd
      // create an orphan ("匿名") doc + a farm_players write that security
      // rules reject. memberDoc resolves via _loadMemberDoc (firebase_uid or
      // phone bridge) right after login; the debounced retry picks it up.
      if (!Farm.fbAuth.memberDoc || !Farm.fbAuth.memberDoc.id) {
        return { ok: false, reason: 'member_doc_unresolved' };
      }
      const uid = meId();
      if (!uid) return { ok: false, reason: 'no_uid' };
      try {
        const payload = this._buildPayload();
        // Full save blob for cloud restore (private — members/ only, NOT the
        // public farm_players/ mirror). This is the lossless copy of local
        // state that restoreFromCloud() pulls back on a new device / wiped
        // storage. harvests + clientAt let the restore decide local-vs-cloud.
        const s = Farm.state.data;
        let gameSave = null;
        try {
          gameSave = {
            blob: JSON.stringify(s),
            harvests: s.totalHarvests || 0,
            clientAt: s.lastSavedAt || Date.now(),
            version: SAVE_BLOB_VERSION,
          };
        } catch (e) { gameSave = null; }
        // Merge so we never overwrite likesReceived (counter only) or other
        // server-managed fields. members/ keeps the gameStats mirror so the
        // StockWise admin game-management view (and points context) stay current.
        await Farm.fb.db.collection('members').doc(uid).set(
          gameSave ? { gameStats: payload, gameSave: gameSave } : { gameStats: payload },
          { merge: true }
        );
        /* 世界门牌号的地基: worldJoinedAt 只设一次(本地存档记 flag 防覆盖)。
           排序按它升序 = 新农场永远接在路的末端, 老农场的门牌**永不漂移**。 */
        if (!Farm.state.data.worldStamped) {
          try {
            await Farm.fb.db.collection('farm_players').doc(uid).set(
              { worldJoinedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            Farm.state.data.worldStamped = true;
            Farm.state.save();
          } catch (e) { /* 下轮再试 */ }
        }
        // Mirror the SAME game-safe stats to the public farm_players/ collection
        // (zero PII). The app's social reads (leaderboard / neighbors / self-rank)
        // query this collection, because members/ is locked to list limit<=1 by
        // security rules. merge() preserves likesReceived/likedBy/pendingGifts that
        // other players (or the weekly function) write here.
        try {
          // STRIP real-value / sensitive fields from the PUBLIC mirror: coins and
          // eastPoints (the latter mirrors the real store loyalty balance). The
          // social reads only use level/totalHarvests/totalDeliveries/weeklyHarvests,
          // so these must never live in the publicly-listable farm_players collection.
          // members/ keeps the full mirror for the StockWise admin view.
          const publicPayload = Object.assign({}, payload);
          delete publicPayload.coins;
          delete publicPayload.eastPoints;
          await Farm.fb.db.collection('farm_players').doc(uid).set(
            { gameStats: publicPayload },
            { merge: true }
          );
        } catch (e) {
          console.warn('[gameSync] farm_players mirror failed', e);
        }
        _lastSyncAt = Date.now();
        _dirty = false;   // cloud now has everything local had
        return { ok: true };
      } catch (e) {
        console.warn('[gameSync] push failed', e);
        _dirty = true;    // keep dirty so the next save/flush retries
        return { ok: false, reason: e.message };
      }
    },

    // Cloud restore: pull the full save blob from members/{uid}.gameSave and,
    // if the cloud copy is more advanced than local, replace local state.
    // Called once on login BEFORE push() so we never overwrite a real account
    // with a fresh/wiped local state (new device, cleared storage, iOS private
    // mode loss). Decision rule (avoids clobbering active local play):
    //   cloud wins if cloud.harvests > local.harvests, OR
    //   (equal harvests AND cloud saved later than local).
    // totalHarvests is monotonic, so it's a reliable "how far along" signal and
    // a 2-minute guest session can't overwrite a long-running account.
    async restoreFromCloud() {
      if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return { restored: false, reason: 'not_logged_in' };
      const md = Farm.fbAuth.memberDoc;
      if (!md || !md.id) return { restored: false, reason: 'member_doc_unresolved' };
      try {
        // Read the blob from the ALREADY-FETCHED member doc, NOT a fresh get().
        // Firestore rules only allow GET-by-id when auth.uid == docId, which is
        // false for legacy ru_ members (doc id != auth uid). _loadMemberDoc
        // fetched the full doc via the permitted list-where(firebase_uid) query,
        // so md already carries gameSave for every member type.
        const save = md.gameSave;
        if (!save || !save.blob) return { restored: false, reason: 'no_cloud_save' };
        let cloudState;
        try { cloudState = JSON.parse(save.blob); } catch (e) { return { restored: false, reason: 'bad_blob' }; }
        const local = Farm.state.data;
        // SAVE IS SACRED: only restore onto a genuinely BLANK device (new device /
        // cleared storage). Never overwrite a device that has ANY real progress —
        // totalHarvests alone is too coarse (coins/plots/sign-in/purchases don't
        // bump it), so an older-but-equal-harvest cloud blob must NOT clobber
        // active local play. The primary use cases (fresh device, wiped storage)
        // are blank, so this still recovers them.
        const localFresh =
          (local.totalHarvests || 0) === 0 &&
          (local.totalDeliveries || 0) === 0 &&
          (local.level || 1) <= 1 &&
          (local.cropsEverGrown || []).length === 0 &&
          !((local.loginCalendar || {}).lastSignDate);
        const cloudH = (save.harvests != null ? save.harvests : (cloudState.totalHarvests || 0)) || 0;
        const cloudHasProgress =
          cloudH > 0 || (cloudState.level || 1) > 1 ||
          (cloudState.cropsEverGrown || []).length > 0 ||
          (cloudState.totalDeliveries || 0) > 0;
        if (!cloudHasProgress) return { restored: false, reason: 'cloud_blank' };
        if (localFresh) {
          const ok = Farm.state.applyCloudSave(cloudState);
          return { restored: !!ok, cloudH: cloudH };
        }
        /* 🔒 多设备同帐号必须收敛到同一个农场(2026-08-15 Chris: 电脑和手机
           打开的农场不一样)。旧规则「只恢复到全空设备」挡住了真农场 ——
           电脑上留着几周前试玩的 Lv2 旧档就永远见不到手机上的 Lv7 本尊,
           而且旧档还会反推云端覆盖备份。
           新规则「富者胜出」:
             云端明显更富(收获更多且等级不低) → 自动换成云端(旧档备份, 不丢)
             本地明显更富 → 保留本地(随后的 push 自然把云端追平)
             不相上下且云端明显更新(>10 分钟) → 换云端(在别的设备玩到刚才)
             真正模棱两可 → 让玩家自己选(弹窗对比两边 Lv/收获/时间)
           被换下的本地档永远先备份到 eastern_farm_save_replaced_v1。 */
        const localH = local.totalHarvests || 0;
        const localLvl = local.level || 1;
        const cloudLvl = cloudState.level || 1;
        const cloudAt = save.clientAt || 0;
        const localAt = local.lastSavedAt || 0;
        const backupLocal = () => {
          try { localStorage.setItem('eastern_farm_save_replaced_v1', JSON.stringify(local)); } catch (e) {}
        };
        const applyCloud = (why) => {
          backupLocal();
          const ok = Farm.state.applyCloudSave(cloudState);
          if (ok && Farm.ui && Farm.ui.toast) {
            const en2 = (cloudState.language || local.language) === 'en';
            Farm.ui.toast(en2
              ? ('☁️ Synced your farm from the cloud (Lv' + cloudLvl + ')')
              : ('☁️ 已同步你的云端农场（Lv' + cloudLvl + '）'), 4200);
          }
          return { restored: !!ok, cloudH: cloudH, reason: why };
        };
        if (cloudH > localH && cloudLvl >= localLvl) return applyCloud('cloud_richer');
        if (localH > cloudH && localLvl >= cloudLvl) return { restored: false, reason: 'local_richer' };
        if (cloudH === localH && cloudLvl === localLvl) {
          // 同一份存档的两个快照: 谁新用谁(容忍 10 分钟时钟差)
          if (cloudAt > localAt + 600e3) return applyCloud('cloud_newer');
          return { restored: false, reason: 'local_current' };
        }
        // 模棱两可(各有所长): 玩家自己选, 每次登录最多问一次
        this._offerSaveChoice(cloudState, save, { localH, localLvl, cloudH, cloudLvl, localAt, cloudAt });
        return { restored: false, reason: 'ambiguous_choice_offered' };
      } catch (e) {
        console.warn('[gameSync] restoreFromCloud failed', e);
        return { restored: false, reason: e.message };
      }
    },

    /* 两份存档各有所长时的玩家选择弹窗(多设备收敛的最后一步)。
       选云端 → 本地备份后替换; 选本地 → 什么都不动, 随后的 push 把云端追平。 */
    _offerSaveChoice(cloudState, save, m) {
      if (this._choiceOffered) return;   // 每次会话最多问一次
      this._choiceOffered = true;
      const tryShow = () => {
        if (!(Farm.ui && Farm.ui.showModal)) { setTimeout(tryShow, 3000); return; }
        const modal = document.getElementById('modal');
        if (modal && !modal.classList.contains('hidden')) { setTimeout(tryShow, 5000); return; }
        const en = (Farm.state.data.language) === 'en';
        const fmt = (ts) => { if (!ts) return en ? 'unknown' : '未知'; const d2 = new Date(ts);
          return (d2.getMonth() + 1) + '/' + d2.getDate(); };
        const card = (title, lvl, h, at, id) =>
          '<button class="btn secondary" data-savepick="' + id + '" style="width:100%;text-align:left;margin-top:8px;padding:12px 14px;">'
          + '<div style="font-weight:700;">' + title + '</div>'
          + '<div style="font-size:12px;color:var(--warm-text-soft);margin-top:2px;">Lv ' + lvl + ' · '
          + (en ? (h + ' harvests · last played ' + fmt(at)) : ('收获 ' + h + ' 棵 · 最后游玩 ' + fmt(at)))
          + '</div></button>';
        Farm.ui.showModal(
          '<h2 class="modal-title">' + (en ? 'Two farm saves found' : '发现两份农场存档') + '</h2>'
          + '<div style="font-size:13px;color:var(--warm-text-soft);line-height:1.7;text-align:center;">'
          + (en ? 'This device and the cloud each have progress. Which farm do you want to keep using?'
                : '这台设备和云端各有一份进度。你想继续用哪一个农场？') + '</div>'
          + card(en ? '☁️ Cloud farm (other device)' : '☁️ 云端农场（另一台设备）', m.cloudLvl, m.cloudH, m.cloudAt, 'cloud')
          + card(en ? '💻 This device' : '💻 这台设备上的', m.localLvl, m.localH, m.localAt, 'local')
          + '<div style="font-size:11px;color:var(--warm-text-soft);text-align:center;margin-top:10px;">'
          + (en ? 'The other save is backed up — nothing is lost.' : '未选的那份会自动备份，不会丢。') + '</div>'
        );
        document.querySelectorAll('[data-savepick]').forEach((btn) => {
          btn.onclick = () => {
            const pick = btn.getAttribute('data-savepick');
            Farm.ui.hideModal();
            if (pick === 'cloud') {
              try { localStorage.setItem('eastern_farm_save_replaced_v1', JSON.stringify(Farm.state.data)); } catch (e) {}
              Farm.state.applyCloudSave(cloudState);
              if (Farm.ui.toast) Farm.ui.toast(en ? '☁️ Cloud farm loaded' : '☁️ 已切换到云端农场', 3000);
            } else {
              Farm.state.save();
              this.push();   // 本地为准 → 立刻把云端追平, 结束分叉
            }
          };
        });
      };
      setTimeout(tryShow, 2500);
    },

    // Debounced — called frequently from state.save(). Skips if recently
    // synced. Schedules a delayed push if within the cooldown window.
    pushStatsDebounced() {
      _dirty = true;   // local state changed; cloud is now behind
      const now = Date.now();
      const since = now - _lastSyncAt;
      if (since >= SYNC_MIN_INTERVAL_MS) {
        this.push();
        return;
      }
      // Schedule a flush at the end of the cooldown if not already pending
      if (_pendingTimer) return;
      _pendingTimer = setTimeout(() => {
        _pendingTimer = null;
        this.push();
      }, SYNC_MIN_INTERVAL_MS - since);
    },

    // Flush any pending changes to the cloud RIGHT NOW (bypass the debounce).
    // CRITICAL for mobile: the debounced setTimeout is killed when the page is
    // hidden/frozen (app switch, screen lock, tab close), so without this the
    // last <30s of play never reaches the server — and on flaky-storage phones
    // (iOS eviction, WeChat/in-app browsers, private mode) the local copy is lost
    // too, so the progress vanishes. Fire-and-forget: the Firestore write is sent
    // immediately and modern browsers let it complete during the hide grace period.
    flush() {
      if (_pendingTimer) { clearTimeout(_pendingTimer); _pendingTimer = null; }
      if (!_dirty) return;
      this.push();
    },

    // Compute the public display name for a member doc.
    displayName(doc) {
      if (!doc) return this._fallbackName('');
      const stats = doc.gameStats || {};
      // Prefer the safe precomputed name (farm_players docs carry no real name).
      if (stats.displayName) return stats.displayName;
      if (stats.nickname) return stats.nickname;
      // Legacy fallback (member docs): derive from real name first character.
      const realName = doc.name || doc.firstName || '';
      const firstChar = (realName + '').trim().charAt(0);
      return this._fallbackName(firstChar);
    },

    // Query a pool of visible members. We pick 3 of these deterministically
    // per day for the neighbor panel.
    async fetchVisiblePool(limit = 30) {
      if (!Farm.fb || !Farm.fb.available) return [];
      // Reading the player pool requires auth — Firestore rules deny guests, so
      // for a signed-out player this query ALWAYS fails with "insufficient
      // permissions". Skip it: that avoids a wasted round-trip and a scary
      // FirebaseError warning on every guest who reaches the neighbor panel
      // (the panel already degrades to an invite state with an empty pool).
      if (Farm.fbAuth && Farm.fbAuth.isLoggedIn && !Farm.fbAuth.isLoggedIn()) return [];
      try {
        const meUid = Farm.fbAuth && meId();
        // Note: Firestore can't query for "field exists" + "field is true"
        // in one query without composite index, so we filter visibility
        // client-side. Order by lastSeenAt to surface recently-active players.
        const q = await Farm.fb.db.collection('farm_players')
          .orderBy('gameStats.lastSeenAt', 'desc')
          .limit(limit)
          .get();
        const pool = [];
        q.forEach(d => {
          const data = d.data();
          const stats = data.gameStats || {};
          // Exclude self + opted-out + store owner + members who never played
          if (d.id === meUid) return;
          if (stats.visibleToNeighbors === false) return;
          if (stats.excludeFromRanking === true) return;
          if (!stats.level) return;
          pool.push({ uid: d.id, doc: data });
        });
        return pool;
      } catch (e) {
        console.warn('[gameSync] fetchVisiblePool failed', e);
        return [];
      }
    },

    // Pick today's 3 neighbors deterministically from the pool.
    pickDailyThree(pool) {
      if (pool.length === 0) return [];
      const today = Farm.state.getDateString();
      // Hash the date → seed RNG → shuffle pool → take first 3
      let h = 2166136261;
      for (let i = 0; i < today.length; i++) {
        h ^= today.charCodeAt(i);
        h = (h * 16777619) >>> 0;
      }
      const rng = () => {
        h |= 0; h = h + 0x6D2B79F5 | 0;
        let t = h;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
      const picked = [];
      const indices = new Set();
      // If pool is smaller than 3, return all.
      const n = Math.min(3, pool.length);
      while (indices.size < n) {
        indices.add(Math.floor(rng() * pool.length));
      }
      indices.forEach(idx => picked.push(pool[idx]));
      return picked;
    },

    // Send a like. Caps at DAILY_LIKE_CAP per sender per day. Sender
    // earns +1 EP. Receiver gets an atomic counter increment + their
    // UID is added to the sender's `likedBy` array (so we can detect
    // mutual likes if they reciprocate later).
    /* 永久门牌(2026-08-14 共享世界「地址是永久的」): 东方农场路 N 号。
       N = 该玩家在 worldJoinedAt 升序里的位置+1 —— 新农场接在路末端,
       老门牌永不漂移。列表缓存 10 分钟(门牌只增不改, 不用实时)。 */
    async fetchWorldAddress(uid) {
      try {
        if (!Farm.fb || !Farm.fb.available || !uid) return null;
        const now = Date.now();
        if (!this._addrList || now - (this._addrAt || 0) > 600e3) {
          const q = await Farm.fb.db.collection('farm_players')
            .orderBy('worldJoinedAt', 'asc').limit(500).get();
          this._addrList = q.docs.map((d) => d.id);
          this._addrAt = now;
        }
        const i = this._addrList.indexOf(uid);
        return i >= 0 ? i + 1 : null;
      } catch (e) { return null; }
    },

    async sendLike(toUid) {
      const lang = Farm.state.data.language || 'zh';
      const claims = Farm.state.data.dailyClaims;
      const givenToday = claims.likesSentToday || [];
      if (givenToday.length >= DAILY_LIKE_CAP) {
        return { ok: false, reason: 'cap_reached', message: lang === 'en'
          ? 'Daily 5-like cap reached, come back tomorrow!'
          : '今日点赞次数已用完' };
      }
      if (givenToday.includes(toUid)) {
        return { ok: false, reason: 'already_liked', message: lang === 'en'
          ? 'You already liked this neighbor today.'
          : '今天给这位邻居点过赞了。' };
      }
      // Mutual-like check: is recipient ALREADY in my likedBy list?
      // (Meaning: did they like ME at some point before now?) If yes,
      // this is a return-like — both get a bonus.
      let isMutual = false;
      try {
        const myUid = Farm.fbAuth && meId();
        if (myUid) {
          const me = await Farm.fb.db.collection('farm_players').doc(myUid).get();
          const mine = (me.exists && me.data().gameStats) || {};
          if (Array.isArray(mine.likedBy) && mine.likedBy.includes(toUid)) {
            isMutual = true;
          }
        }
      } catch (_) {}

      // Recipient atomic updates: counter + likedBy arrayUnion
      if (Farm.fb && Farm.fb.available) {
        try {
          const myUid = Farm.fbAuth && meId();
          const payload = {
            gameStats: {
              likesReceived: Farm.fb.increment(1),
              likedBy: firebase.firestore.FieldValue.arrayUnion(myUid),
            },
          };
          await Farm.fb.db.collection('farm_players').doc(toUid).set(payload, { merge: true });
        } catch (e) {
          console.warn('[gameSync] like update failed', e);
        }
      }
      // Sender bookkeeping
      claims.likesSentToday = givenToday.concat([toUid]);
      Farm.state.save();
      // Social rewards are farm coins (per owner): 超市积分 stays scarce.
      const baseBonus = 5;
      const mutualBonus = isMutual ? 15 : 0;
      Farm.state.addCoins(baseBonus + mutualBonus);
      return {
        ok: true,
        remaining: DAILY_LIKE_CAP - claims.likesSentToday.length,
        mutual: isMutual,
        coinsEarned: baseBonus + mutualBonus,
      };
    },

    // Check if receiver has new likes since last check. Returns
    // { newLikes, capped, epAwarded }. Called at boot when auth lands.
    // Awards up to DAILY_LIKE_CAP EP per day for received likes.
    async reconcileReceivedLikes() {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return null;
      const uid = meId();
      if (!uid) return null;
      try {
        const snap = await Farm.fb.db.collection('farm_players').doc(uid).get();
        if (!snap.exists) return null;
        const stats = (snap.data().gameStats) || {};
        const cur = stats.likesReceived || 0;
        const last = Farm.state.data.lastLikesSeen || 0;
        const newLikes = Math.max(0, cur - last);
        if (newLikes === 0) {
          Farm.state.data.lastLikesSeen = cur;
          Farm.state.save();
          return { newLikes: 0, capped: 0, epAwarded: 0 };
        }
        // Daily cap on EP from received-likes (mirrors send cap)
        const today = Farm.state.getDateString();
        const lastAt = Farm.state.data.lastLikesSeenAt || 0;
        const lastDay = lastAt ? new Date(lastAt).toDateString() : '';
        const todayDay = new Date().toDateString();
        if (lastDay !== todayDay) {
          Farm.state.data.likesAckedToday = 0;
        }
        const headroom = Math.max(0, DAILY_LIKE_CAP - (Farm.state.data.likesAckedToday || 0));
        const epAward = Math.min(newLikes, headroom);
        const capped = newLikes - epAward;
        Farm.state.data.lastLikesSeen = cur;
        Farm.state.data.lastLikesSeenAt = Date.now();
        Farm.state.data.likesAckedToday = (Farm.state.data.likesAckedToday || 0) + epAward;
        Farm.state.save();
        const coinAward = epAward * 10;  // 10 farm coins per received like
        if (coinAward > 0) {
          Farm.state.addCoins(coinAward);
        }
        return { newLikes, capped, coinsAwarded: coinAward };
      } catch (e) {
        console.warn('[gameSync] reconcileReceivedLikes failed', e);
        return null;
      }
    },

    // Daily quota indicator helper
    likesRemaining() {
      const given = (Farm.state.data.dailyClaims.likesSentToday || []).length;
      return Math.max(0, DAILY_LIKE_CAP - given);
    },

    helpRemaining() {
      const given = (Farm.state.data.dailyClaims.helpSentToday || []).length;
      return Math.max(0, DAILY_HELP_CAP - given);
    },
    stickersRemaining() {
      const given = (Farm.state.data.dailyClaims.stickersSentToday || []).length;
      return Math.max(0, DAILY_STICKER_CAP - given);
    },
    helpedToday(uid) {
      return (Farm.state.data.dailyClaims.helpSentToday || []).includes(uid);
    },

    // Help a neighbor (water their crops). Recipient gets coins + a notice in
    // their inbox on next login; helper earns a small reward. Cap 5/day, once
    // per recipient per day. Reuses the pendingGifts inbox (kind 'help').
    async sendHelp(toUid) {
      const lang = Farm.state.data.language || 'zh';
      const claims = Farm.state.data.dailyClaims;
      const done = claims.helpSentToday || [];
      if (done.length >= DAILY_HELP_CAP) {
        return { ok: false, reason: 'cap_reached', message: lang === 'en'
          ? 'Daily help limit reached' : '今日帮忙次数已用完' };
      }
      if (done.includes(toUid)) {
        return { ok: false, reason: 'already', message: lang === 'en'
          ? 'You already helped this neighbor today.' : '今天已经帮过这位邻居了。' };
      }
      const myUid = Farm.fbAuth && meId();
      if (!myUid) return { ok: false, reason: 'not_logged_in' };
      const gift = {
        id: myUid + '_help_' + Date.now(),
        fromUid: myUid, fromName: this._selfDisplayName(),
        kind: 'help', payload: { amount: HELP_RECIPIENT_COINS },
        sentAt: Date.now(),
      };
      try {
        await Farm.fb.db.collection('farm_players').doc(toUid).set(
          { gameStats: { pendingGifts: firebase.firestore.FieldValue.arrayUnion(gift) } },
          { merge: true }
        );
      } catch (e) {
        console.warn('[gameSync] sendHelp failed', e);
        return { ok: false, reason: 'write_failed' };
      }
      claims.helpSentToday = done.concat([toUid]);
      Farm.state.addCoins(HELP_SENDER_COINS);
      Farm.state.save();
      return { ok: true, remaining: DAILY_HELP_CAP - claims.helpSentToday.length, coinsEarned: HELP_SENDER_COINS };
    },

    // Leave a preset sticker on a neighbor (a friendly hello). Recipient sees a
    // notice in their inbox. Cap 10/day; repeats allowed. Inbox kind 'sticker'.
    async sendSticker(toUid, emoji) {
      const lang = Farm.state.data.language || 'zh';
      const claims = Farm.state.data.dailyClaims;
      const sent = claims.stickersSentToday || [];
      if (sent.length >= DAILY_STICKER_CAP) {
        return { ok: false, reason: 'cap_reached', message: lang === 'en'
          ? 'Daily sticker limit reached' : '今日贴纸次数已用完' };
      }
      const myUid = Farm.fbAuth && meId();
      if (!myUid) return { ok: false, reason: 'not_logged_in' };
      const gift = {
        id: myUid + '_sticker_' + Date.now(),
        fromUid: myUid, fromName: this._selfDisplayName(),
        kind: 'sticker', payload: { emoji: emoji || '👍' },
        sentAt: Date.now(),
      };
      try {
        await Farm.fb.db.collection('farm_players').doc(toUid).set(
          { gameStats: { pendingGifts: firebase.firestore.FieldValue.arrayUnion(gift) } },
          { merge: true }
        );
      } catch (e) {
        console.warn('[gameSync] sendSticker failed', e);
        return { ok: false, reason: 'write_failed' };
      }
      claims.stickersSentToday = sent.concat([{ to: toUid, emoji: emoji || '👍' }]);
      if (STICKER_SENDER_COINS > 0) Farm.state.addCoins(STICKER_SENDER_COINS);
      Farm.state.save();
      return { ok: true, remaining: DAILY_STICKER_CAP - claims.stickersSentToday.length, coinsEarned: STICKER_SENDER_COINS };
    },

    // Leaderboard by metric: 'level' | 'harvests' | 'deliveries'
    async fetchLeaderboard(metric, topN) {
      metric = metric || 'level';
      topN = topN || 10;
      if (!Farm.fb || !Farm.fb.available) return [];
      const fieldMap = {
        level: 'gameStats.level',
        harvests: 'gameStats.totalHarvests',
        deliveries: 'gameStats.totalDeliveries',
        weekly: 'gameStats.weeklyHarvests',
      };
      const field = fieldMap[metric] || fieldMap.level;
      const curWeek = (metric === 'weekly' && Farm.state.getWeekId) ? Farm.state.getWeekId() : null;
      try {
        // Fetch extra rows when weekly so client-side week filtering still
        // leaves a full top list.
        const q = await Farm.fb.db.collection('farm_players')
          .orderBy(field, 'desc')
          .limit(metric === 'weekly' ? topN * 3 : topN)
          .get();
        const list = [];
        q.forEach(d => {
          const data = d.data();
          const stats = data.gameStats || {};
          if (stats.visibleToNeighbors === false) return;
          if (stats.excludeFromRanking === true) return;  // store owner out of rankings
          if (!stats.level) return;
          // Weekly board: only count players whose counter is for THIS week.
          if (metric === 'weekly') {
            if (stats.weekId !== curWeek) return;
            if (!(stats.weeklyHarvests > 0)) return;
          }
          const value = metric === 'level' ? (stats.level || 0)
                      : metric === 'harvests' ? (stats.totalHarvests || 0)
                      : metric === 'weekly' ? (stats.weeklyHarvests || 0)
                      : (stats.totalDeliveries || 0);
          list.push({ uid: d.id, doc: data, level: stats.level || 1, value });
        });
        return list.slice(0, topN);
      } catch (e) {
        console.warn('[gameSync] fetchLeaderboard failed', e);
        return [];
      }
    },

    // Find self's rank by counting members with a higher metric value.
    // Returns { rank, total } or null if not logged in / not synced yet.
    // Note: this is an APPROXIMATION since we only count up to 100
    // members above us (Firestore can't do a true server-side rank).
    async fetchSelfRank(metric) {
      metric = metric || 'level';
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return null;
      const uid = meId();
      if (!uid) return null;
      const fieldMap = {
        level: 'gameStats.level',
        harvests: 'gameStats.totalHarvests',
        deliveries: 'gameStats.totalDeliveries',
        weekly: 'gameStats.weeklyHarvests',
      };
      const field = fieldMap[metric] || fieldMap.level;
      const curWeek = (metric === 'weekly' && Farm.state.getWeekId) ? Farm.state.getWeekId() : null;
      try {
        const myDoc = await Farm.fb.db.collection('farm_players').doc(uid).get();
        const myStats = (myDoc.exists && myDoc.data().gameStats) || {};
        const myValue = metric === 'level' ? (myStats.level || 1)
                      : metric === 'harvests' ? (myStats.totalHarvests || 0)
                      : metric === 'weekly' ? (myStats.weeklyHarvests || 0)
                      : (myStats.totalDeliveries || 0);
        // Count players with HIGHER value (those ranked above me)
        const q = await Farm.fb.db.collection('farm_players')
          .where(field, '>', myValue)
          .limit(100)
          .get();
        let above = 0;
        q.forEach(d => {
          const s = d.data().gameStats || {};
          if (s.visibleToNeighbors === false) return;
          if (s.excludeFromRanking === true) return;  // store owner not counted above me
          if (metric === 'weekly' && s.weekId !== curWeek) return;
          above++;
        });
        return { rank: above + 1, myValue, capped: above >= 100 };
      } catch (e) {
        console.warn('[gameSync] fetchSelfRank failed', e);
        return null;
      }
    },

    // ============ Friends (Phase 3) ============
    // Phone-based friend lookup. Returns { found, member } where member
    // is { uid, doc } if exists + visible, else null. Doesn't add the
    // friend — caller handles that to keep this fn pure.
    //
    // 🔒 **必须走后端，不许改回客户端直查 Firestore。**
    //
    // 2026-08-16 之前这里是：
    //     db.collection('members').where('phone','==', 任意号码).limit(1).get()
    // Firestore 查询返回的是**整份文档** —— 玩家随便输一个手机号，就能拿到对方
    // 的姓名、手机号、积分余额和 member_code。而 member_code 是收银台扫的身份
    // 凭据，拿到它等于拿到在柜台被认成这个人的凭据。
    //
    // `members` 的 firestore 规则已收紧成「只能查到自己」，这条路已经走不通；
    // 功能改由后端 GET /api/members/me/friend-lookup 承接，它只回
    //     { uid, gameStats: { displayName, level } }
    // 返回形状与本函数原来的一致，所以 neighbors.js 不用改。
    async findMemberByPhone(phoneE164) {
      if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn || !Farm.fbAuth.isLoggedIn()) {
        return { found: false, reason: 'not_logged_in' };
      }
      // 超时用 AbortController —— 弱网下「连上了但爬不动」不会让玩家一直转圈
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FRIEND_LOOKUP_TIMEOUT_MS);
      try {
        const idToken = await Farm.fbAuth.currentUser.getIdToken();
        const url = STOCKWISE_BASE + '/api/members/me/friend-lookup?phone='
          + encodeURIComponent(phoneE164);
        const res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + idToken },
          signal: ctl.signal,
        });
        // 查太频繁 ≠ 查不到这个人。分开报，否则玩家会以为好友不是会员。
        if (res.status === 429) return { found: false, reason: 'too_many' };
        if (!res.ok) return { found: false, reason: 'error' };
        return await res.json();
      } catch (e) {
        console.warn('[gameSync] findMemberByPhone failed', e);
        return { found: false, reason: 'error' };
      } finally {
        clearTimeout(timer);
      }
    },

    // Add a UID to local friends array + sync to Firestore. One-sided
    // follow (no mutual request needed — these are real-life friends).
    async addFriend(uid) {
      const list = Farm.state.data.friends || [];
      if (list.includes(uid)) return { ok: false, reason: 'already_friend' };
      list.push(uid);
      Farm.state.data.friends = list;
      Farm.state.save();
      // Also write to server (in case the user wants to access from another device)
      try {
        const myUid = Farm.fbAuth && meId();
        if (myUid) {
          await Farm.fb.db.collection('farm_players').doc(myUid).set(
            { gameStats: { friends: firebase.firestore.FieldValue.arrayUnion(uid) } },
            { merge: true }
          );
        }
      } catch (_) {}
      return { ok: true, count: list.length };
    },

    async removeFriend(uid) {
      const list = (Farm.state.data.friends || []).filter(x => x !== uid);
      Farm.state.data.friends = list;
      Farm.state.save();
      try {
        const myUid = Farm.fbAuth && meId();
        if (myUid) {
          await Farm.fb.db.collection('farm_players').doc(myUid).set(
            { gameStats: { friends: firebase.firestore.FieldValue.arrayRemove(uid) } },
            { merge: true }
          );
        }
      } catch (_) {}
      return { ok: true, count: list.length };
    },

    // Fetch full docs for all friend UIDs. Limited to 30 to avoid
    // hammering Firestore — players unlikely to have 30+ real friends.
    async fetchFriendDocs() {
      const uids = Farm.state.data.friends || [];
      if (uids.length === 0 || !Farm.fb || !Farm.fb.available) return [];
      const out = [];
      for (const uid of uids.slice(0, 30)) {
        try {
          const snap = await Farm.fb.db.collection('farm_players').doc(uid).get();
          if (snap.exists) out.push({ uid, doc: snap.data() });
        } catch (_) {}
      }
      return out;
    },

    // ============ Gifts (Phase 3) ============
    // Send a gift to a friend. kind: 'seed' | 'ep'. Daily cap = 1
    // gift sent per day. Recipient gets it in their pendingGifts
    // inbox on the server, reconciled on their next session.
    async sendGift(toUid, kind, options) {
      options = options || {};
      const lang = Farm.state.data.language || 'zh';
      const today = Farm.state.getDateString();
      const lastSent = Farm.state.data.lastGiftSentDate || '';
      if (lastSent === today) {
        return { ok: false, reason: 'daily_cap', message: lang === 'en'
          ? 'You already sent a gift today. Try again tomorrow!'
          : '今日免费礼物已送出' };
      }
      const myUid = Farm.fbAuth && meId();
      if (!myUid) return { ok: false, reason: 'not_logged_in' };
      const fromName = this._selfDisplayName();
      const giftId = myUid + '_' + Date.now();
      // Build payload by kind
      let payload;
      if (kind === 'seed') {
        // Pick a random Lv 1-3 seed (everyone has those unlocked)
        const easy = (Farm.crops && Farm.crops.all() || [])
          .filter(c => c.unlock_level <= 3);
        if (easy.length === 0) return { ok: false, reason: 'no_seeds' };
        const c = easy[Math.floor(Math.random() * easy.length)];
        payload = { cropId: c.id };
      } else if (kind === 'coins') {
        payload = { amount: 50 };
      } else {
        return { ok: false, reason: 'unknown_kind' };
      }
      // Atomic write to recipient's pendingGifts array
      try {
        const gift = {
          id: giftId, fromUid: myUid, fromName, kind, payload,
          sentAt: Date.now(),
        };
        await Farm.fb.db.collection('farm_players').doc(toUid).set(
          { gameStats: { pendingGifts: firebase.firestore.FieldValue.arrayUnion(gift) } },
          { merge: true }
        );
      } catch (e) {
        console.warn('[gameSync] sendGift write failed', e);
        return { ok: false, reason: 'write_failed' };
      }
      // Mark sent locally
      Farm.state.data.lastGiftSentDate = today;
      Farm.state.save();
      return { ok: true, kind, payload };
    },

    // Reconcile inbox: claim any pendingGifts on the server, apply to
    // local state, clear the server-side queue. Called at boot after
    // auth lands. Returns array of claimed gifts for UI feedback.
    async reconcileGifts() {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return [];
      const uid = meId();
      if (!uid) return [];
      try {
        const snap = await Farm.fb.db.collection('farm_players').doc(uid).get();
        if (!snap.exists) return [];
        const stats = (snap.data().gameStats) || {};
        const gifts = stats.pendingGifts || [];
        if (gifts.length === 0) return [];
        // Apply each gift to local state
        for (const g of gifts) {
          if (g.kind === 'seed' && g.payload && g.payload.cropId) {
            Farm.state.addSeed(g.payload.cropId, 1);
          } else if ((g.kind === 'coins' || g.kind === 'ep' || g.kind === 'help') && g.payload) {
            // 'ep' legacy; 'help' = neighbor watered your crops. All credited as coins.
            // Amount is untrusted (cross-player write) → reject non-numeric /
            // non-positive and clamp to the largest legit single grant.
            const amt = Number(g.payload.amount);
            if (Number.isFinite(amt) && amt > 0) {
              const isSystemWeekly = g.fromUid === 'system'
                && typeof g.id === 'string' && g.id.indexOf('weekly_') === 0;
              Farm.state.addCoins(Math.min(amt, isSystemWeekly ? MAX_SYSTEM_GIFT_COINS : MAX_GIFT_COINS));
            }
          }
          // 'sticker' carries no payout — it's a friendly hello (notice only,
          // surfaced by the reconcile toast in firebase-auth).
        }
        // Clear ONLY the gifts we claimed (arrayRemove), so a gift that
        // another player arrayUnion-appended between our get and this write
        // isn't silently dropped (read-modify-write race).
        await Farm.fb.db.collection('farm_players').doc(uid).set(
          { gameStats: { pendingGifts: firebase.firestore.FieldValue.arrayRemove.apply(null, gifts) } },
          { merge: true }
        );
        return gifts;
      } catch (e) {
        console.warn('[gameSync] reconcileGifts failed', e);
        return [];
      }
    },

    // Check if user can send a gift today (1 per day cap)
    canSendGiftToday() {
      const today = Farm.state.getDateString();
      return Farm.state.data.lastGiftSentDate !== today;
    },

    // ===== 真会员互偷（spec 2026-06-11）=====
    // 偷菜事件写入受害者的公共文档（与 pendingGifts 同模式/同安全规则）。
    // evt: { kind:'steal'|'caught', plotIdx, cropId, plantedAt, coins? }
    async sendStealEvent(victimUid, evt) {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) {
        return { ok: false, reason: 'offline' };
      }
      const myUid = meId();
      if (!myUid || !victimUid || victimUid === myUid) return { ok: false, reason: 'bad_target' };
      try {
        const full = Object.assign({
          id: 'se_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
          thiefUid: myUid,
          thiefName: this._selfDisplayName(),
          at: Date.now(),
        }, evt);
        await Farm.fb.db.collection('farm_players').doc(victimUid).set(
          { gameStats: { stealEvents: firebase.firestore.FieldValue.arrayUnion(full) } },
          { merge: true }
        );
        return { ok: true };
      } catch (e) {
        console.warn('[gameSync] sendStealEvent failed', e);
        return { ok: false, reason: 'write_failed' };
      }
    },

    // ===== 邀请好友双向奖励（社区温度包 2026-06-11）=====
    // 链接形如 farm.easternmarket.ca/?ref=<会员docId>。被邀请人登录后
    // applyReferral：双方各得 INVITE_BONUS 农场币。防滥用：每个账号只能
    // 被邀请一次(farm_players.gameStats.referredBy 一次性)、不能自邀。
    INVITE_BONUS: 200,

    inviteLink() {
      const uid = meId();
      return uid ? ('https://farm.easternmarket.ca/?ref=' + encodeURIComponent(uid)) : 'https://farm.easternmarket.ca';
    },

    // 分享邀请：原生分享面板，不支持则复制到剪贴板。
    async shareInvite() {
      const lang = Farm.state.data.language || 'zh';
      if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn() || !meId()) {
        Farm.ui.toast(lang === 'en' ? 'Sign in to invite friends' : '登录后即可邀请好友', 2600);
        return;
      }
      const link = this.inviteLink();
      const text = lang === 'en'
        ? 'I\'m farming at Eastern Farm — join me and we both get ' + this.INVITE_BONUS + ' coins!'
        : '我在东方农场种菜，点链接进来我们做邻居，你我各得 ' + this.INVITE_BONUS + ' 农场币！';
      if (navigator.share) {
        try { await navigator.share({ title: lang === 'en' ? 'Eastern Farm' : '东方农场', text: text, url: link }); } catch (_) {}
        return;
      }
      try {
        await navigator.clipboard.writeText(text + ' ' + link);
        Farm.ui.toast(lang === 'en' ? 'Invite link copied' : '邀请链接已复制', 2600);
      } catch (_) {
        Farm.ui.toast(link, 4000);
      }
    },

    // 登录后调用：若本地存有 ?ref= 来源且本账号从未被邀请过 → 双向发奖。
    async applyReferral() {
      let ref = null;
      try { ref = localStorage.getItem('eastern_farm_ref'); } catch (_) {}
      if (!ref) return;
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return;
      const myUid = meId();
      if (!myUid) return;
      const clear = () => { try { localStorage.removeItem('eastern_farm_ref'); } catch (_) {} };
      if (ref === myUid) { clear(); return; }   // 不能自邀
      const lang = Farm.state.data.language || 'zh';
      try {
        // 一次性：已被邀请过的账号不再发奖（跨设备以云端为准）
        const meSnap = await Farm.fb.db.collection('farm_players').doc(myUid).get();
        const myGs = (meSnap.exists && meSnap.data().gameStats) || {};
        if (myGs.referredBy) { clear(); return; }
        await Farm.fb.db.collection('farm_players').doc(myUid).set(
          { gameStats: { referredBy: ref, referredAt: Date.now() } },
          { merge: true }
        );
        // 被邀请人（自己）当场入账
        Farm.state.addCoins(this.INVITE_BONUS);
        Farm.state.save();
        Farm.ui.refreshHUD();
        Farm.ui.toast(lang === 'en'
          ? '🎉 Friend invite accepted: +' + this.INVITE_BONUS + ' <span class="coin-icon"></span>'
          : '🎉 接受好友邀请成功 +' + this.INVITE_BONUS + ' <span class="coin-icon"></span>', 3400);
        // 邀请人那边走礼物通道（reconcileGifts 自动入账+提示）
        await Farm.fb.db.collection('farm_players').doc(ref).set(
          { gameStats: { pendingGifts: firebase.firestore.FieldValue.arrayUnion({
              id: 'inv_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
              fromUid: myUid,
              fromName: this._selfDisplayName() + (lang === 'en' ? ' (invite reward)' : '（邀请奖励）'),
              kind: 'coins',
              payload: { amount: this.INVITE_BONUS },
              sentAt: Date.now(),
            }) } },
          { merge: true }
        );
        clear();
      } catch (e) {
        console.warn('[gameSync] applyReferral failed', e);
        // 不 clear：下次登录重试（referredBy 以云端为准，重试幂等）
      }
    },

    // ===== 来访足迹（社区温度包 2026-06-11）=====
    // 逛真会员农场时留一条足迹，对方下次上线在回家小报看到
    // 「XX 来你农场逛过🐾」。每天对同一家只记一次（本地节流）。
    async recordVisit(hostUid) {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return;
      const myUid = meId();
      if (!myUid || !hostUid || hostUid === myUid) return;
      const c = Farm.state.data.dailyClaims;
      const noted = c.visitFootprints || [];
      if (noted.includes(hostUid)) return;          // 今天已留过足迹
      c.visitFootprints = noted.concat([hostUid]);
      Farm.state.save();
      try {
        await Farm.fb.db.collection('farm_players').doc(hostUid).set(
          { gameStats: { visitEvents: firebase.firestore.FieldValue.arrayUnion({
              visitorUid: myUid,
              visitorName: this._selfDisplayName(),
              at: Date.now(),
            }) } },
          { merge: true }
        );
      } catch (e) {
        console.warn('[gameSync] recordVisit failed', e);
      }
    },

    // 一次性拉取并清空自己文档上的全部社交收件（偷菜事件+来访足迹）：
    // 登录结算只需一读一写，替代分别调用两个 fetchAndClear*（两读两写）。
    async fetchAndClearInbox() {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) {
        return { steals: [], visits: [] };
      }
      const uid = meId();
      if (!uid) return { steals: [], visits: [] };
      try {
        const snap = await Farm.fb.db.collection('farm_players').doc(uid).get();
        if (!snap.exists) return { steals: [], visits: [] };
        const gs = (snap.data().gameStats) || {};
        const steals = gs.stealEvents || [];
        const visits = gs.visitEvents || [];
        if (steals.length || visits.length) {
          // arrayRemove 只删读到的这几条，而非 set []——避免 get 与 clear
          // 之间别人 arrayUnion 新写入的事件被整片冲掉（读改写竞态丢事件）。
          const AR = firebase.firestore.FieldValue.arrayRemove;
          const upd = {};
          if (steals.length) upd.stealEvents = AR.apply(null, steals);
          if (visits.length) upd.visitEvents = AR.apply(null, visits);
          await Farm.fb.db.collection('farm_players').doc(uid).set(
            { gameStats: upd },
            { merge: true }
          );
        }
        return { steals, visits };
      } catch (e) {
        console.warn('[gameSync] fetchAndClearInbox failed', e);
        return { steals: [], visits: [] };
      }
    },

    // 拉取并清空自己文档上的来访足迹。
    async fetchAndClearVisitEvents() {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return [];
      const uid = meId();
      if (!uid) return [];
      try {
        const snap = await Farm.fb.db.collection('farm_players').doc(uid).get();
        if (!snap.exists) return [];
        const evts = ((snap.data().gameStats) || {}).visitEvents || [];
        if (evts.length === 0) return [];
        await Farm.fb.db.collection('farm_players').doc(uid).set(
          { gameStats: { visitEvents: firebase.firestore.FieldValue.arrayRemove.apply(null, evts) } },
          { merge: true }
        );
        return evts;
      } catch (e) {
        console.warn('[gameSync] fetchAndClearVisitEvents failed', e);
        return [];
      }
    },

    // 拉取并清空自己文档上的偷菜事件（结算逻辑在 Farm.steal.settleRealEvents）。
    async fetchAndClearStealEvents() {
      if (!Farm.fb || !Farm.fb.available || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn()) return [];
      const uid = meId();
      if (!uid) return [];
      try {
        const snap = await Farm.fb.db.collection('farm_players').doc(uid).get();
        if (!snap.exists) return [];
        const evts = ((snap.data().gameStats) || {}).stealEvents || [];
        if (evts.length === 0) return [];
        await Farm.fb.db.collection('farm_players').doc(uid).set(
          { gameStats: { stealEvents: firebase.firestore.FieldValue.arrayRemove.apply(null, evts) } },
          { merge: true }
        );
        return evts;
      } catch (e) {
        console.warn('[gameSync] fetchAndClearStealEvents failed', e);
        return [];
      }
    },

    // Online indicator helper — returns label/color tier from lastSeenAt
    onlineStatus(doc) {
      const stats = (doc && doc.gameStats) || {};
      const last = stats.lastSeenAt;
      if (!last) return null;
      // Firestore Timestamp has .toMillis(); fallback to Date()
      const ms = typeof last.toMillis === 'function' ? last.toMillis() : new Date(last).getTime();
      const diff = Date.now() - ms;
      if (diff < 5 * 60 * 1000) return { tier: 'online', label: '在线', labelEn: 'Online' };
      if (diff < 30 * 60 * 1000) return { tier: 'recent', label: '刚刚', labelEn: 'Recent' };
      if (diff < 24 * 60 * 60 * 1000) return { tier: 'today', label: '今天活跃', labelEn: 'Today' };
      return null;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.fbGameSync = gameSync;

  // ===== Flush-on-hide (the real fix for "mobile progress doesn't sync") =====
  // The Page Lifecycle API guarantees `visibilitychange → hidden` fires before
  // the page is frozen/discarded on mobile (app switch, screen lock, tab close);
  // `pagehide` is a secondary backup. `beforeunload` is intentionally NOT used —
  // it's unreliable on iOS/Android and can block bfcache. We push immediately on
  // hide so the trailing window of play is written to the cloud instead of dying
  // with the killed debounce timer.
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { try { gameSync.flush(); } catch (_) {} }
    });
    window.addEventListener('pagehide', function () { try { gameSync.flush(); } catch (_) {} });
  } catch (_) {}
})();
