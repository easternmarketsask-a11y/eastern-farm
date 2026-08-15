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

    // 1. Load data files in parallel. Each loader is wrapped so a single failed/hung
    // fetch on a flaky mobile network can NEVER reject the whole boot — that was
    // leaving the splash up with a dead "进入农场" button (Chris's recurring
    // "stuck, can't enter"). Each loader already degrades internally on failure.
    //
    // ⚠️ 关键加固（2026-07-03，Chris 手机开屏冻死的根因）：模块对象本身也可能
    // 不存在——弱网/部署构建窗口里任何一个 <script> 加载失败（例如新增的
    // kitchen.js 不在旧 SW 缓存里、网络又恰好 404），直接写 Farm.kitchen.load()
    // 会在 await 之前同步 TypeError，把 boot 炸死在 wireSplash 之前 → 开屏按钮
    // 全死、页面「完全不能动」。所以必须按名字取模块、逐个 try：缺哪个跳哪个
    // （所有消费方都有 Farm.xxx && 守卫，缺模块只是少个功能，绝不能是死机）。
    // ⚠️ 关键加固（2026-07-05，Chris「这个页面总是卡着」根因之一）：每个 loader 内部是
    // 裸 `await fetch()`，**没有客户端超时**。弱网 / Service Worker 未接管本次加载（首次
    // 访问、部署换版刷新的时序窗口、SW 安装失败）时，fetch 可能「永挂」——既不 resolve
    // 也不 reject。try/catch 接不住永挂，SW 的 6s 超时又不在这条路径上 → 这个 Promise.all
    // 永不完成 → 下面的 wireSplash() 永不执行 → 「进入农场 / 登录」按钮永不绑 onclick →
    // 开屏死键。而「世界杯」按钮由 worldcup.js 独立绑定仍能点 —— 正是 Chris 截图里那个
    // 「世界杯能看/farm 进不去 + 顶部一直转圈」的不对称症状。所以给每个 loader 套一个
    // 客户端硬超时：5 秒没回就放它过去（模块都有 Farm.xxx && 守卫会优雅降级，数据还有
    // SW 缓存兜底）。绝不让「能不能进游戏」取决于某个 fetch 会不会挂。
    // ⚠️ 2026-08-11 修：定时器必须在 loader 正常完成后 clearTimeout。
    // 原来只用 Promise.race 抢，赢了也不清 timer —— 于是 5 秒后那个 setTimeout
    // 照样触发、照样 console.warn。实测 9 个 JSON 全在 50ms 内就加载完了，
    // 控制台却每次都打 9 条假的「loader timed out」。玩家无感，但 deploy.sh 的
    // 冒烟闸门只打印前 4 条警告 —— 9 条假警告永远排在最前面，等于真警告永远
    // 看不见。保护逻辑本身不变（5 秒没回照样放行），只是别再谎报。
    const withTimeout = function (p, k) {
      if (!p || typeof p.then !== 'function') return p;
      let timer = null;
      const guard = new Promise(function (res) {
        timer = setTimeout(function () {
          timer = null;
          console.warn('[boot] loader timed out (continuing):', k);
          res(null);
        }, 5000);
      });
      const clear = function (v) { if (timer !== null) { clearTimeout(timer); timer = null; } return v; };
      return Promise.race([p.then(clear, clear), guard]);
    };
    await Promise.all(['i18n', 'crops', 'rewards', 'achievements', 'epShop', 'daily',
      'aiNeighbors', 'tasks', 'kitchen'].map(function (k) {
      try {
        const m = Farm[k];
        const p = (m && typeof m.load === 'function') ? m.load() : null;
        const guarded = (p && p.catch)
          ? p.catch(function (e) { console.warn('[boot] loader failed (continuing):', k, e); })
          : p;
        return withTimeout(guarded, k);
      } catch (e) { console.warn('[boot] loader threw (continuing):', k, e); return null; }
    }));

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
      if (Farm.lifeStory) Farm.lifeStory.install();   // 农场人生: 章节信轮询
      // Firebase SDK 现在是动态加载的（见 index.html），此刻可能还没到，上面两行
      // 会因 Farm.fb.available=false 提前返回。打上标记，等 SDK 落地后
      // firebase-init.js 的 fbLateInit 负责补跑，避免登录静默失效。
      Farm.__fbAuthInitTried = true;

      // 3. Language
      // Register the language-change re-render hooks BEFORE the first
      // setLanguage so any switch (settings toggle or otherwise) instantly
      // reflows the always-on-screen dynamic widgets that carry no
      // [data-i18n] attribute (HUD currencies, harvest-status pill, weather
      // chip). The settings path also calls these explicitly — double render
      // is harmless; this guarantees coverage for every setLanguage caller.
      Farm.i18n.onChange(function () {
        try { if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD(); } catch (e) {}
        try { if (Farm.harvestStatus && Farm.harvestStatus.render) Farm.harvestStatus.render(); } catch (e) {}
        try { if (Farm.weather && Farm.weather.refresh) Farm.weather.refresh(); } catch (e) {}
      });
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

      // 6e. 底部 dock 红点首刷（谷仓将满/满 + 厨房出锅，UX 第 4 批）
      if (Farm.ui.refreshDockDots) Farm.ui.refreshDockDots();

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
    // Global tap-sound delegation (B7): every .btn / .ds-btn / close-x / menu
    // item plays the UI click once, so button audio is consistent instead of
    // sampled per hand-wired onclick. audio.play('tap') dedupes within 60ms, so
    // buttons that still call play('tap') themselves won't double up.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const btn = t.closest('.btn, .ds-btn, .modal-close-x, .nav-menu-item, .action-btn');
      if (btn && !btn.disabled && window.Farm && Farm.audio) Farm.audio.play('tap');
    }, true);
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
      // Defer the iso farm view until after splash, to guarantee splash entry
      // buttons always work and avoid any early overlay conflicts.
      // Guarded: iso init hides the underlying DOM grid first, so if it throws the
      // player would be left on a blank screen (splash already removed). On failure
      // we re-show that DOM grid so there's always a playable view.
      // （2026-08-11：原来这里还有一条 Farm.mapView 分支——俯视像素渲染器。
      //   三渲染器已收编成 iso 一套，mapview.js 已删；DOM 网格仍是 iso 的底座
      //   兼崩溃兜底，所以下面 catch 里的降级路径保留。）
      try {
        if (Farm.isoView && Farm.isoView.active && Farm.isoView.active()) {
          Farm.isoView.init();
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
      if (Farm.achievements && Farm.achievements.checkAll) Farm.achievements.checkAll();
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
      // 引导中断恢复（audit P1 spotlight.js:70 2026-07-07）：欢迎窗已确认但
      // spotlight 未完成（刷新/关页打断）→ 自动续接对应步骤。此前 maybeStart
      // 全仓唯一调用点在欢迎窗按钮里，中断一次引导就永远丢了。全新玩家仍走
      // tutorial 按钮的原路径（tutorialV1Done 未置时这里不触发，不会抢在欢迎
      // 窗前面）。maybeStart 内部自带「已变现则毕业」守卫，不会骚扰老玩家。
      if (Farm.spotlight && Farm.spotlight.maybeStart &&
          Farm.state.data.tutorialV1Done && !Farm.state.data.spotlightDone) {
        setTimeout(() => Farm.spotlight.maybeStart(), 1500);
      }
    });

    // Refresh the today badge whenever the modal closes
    setInterval(refreshTodayBadge, 60000);

    // 9. Ticks
    setInterval(() => Farm.farm.tick(), 1000);
    // dock 红点轻量轮询：厨房倒计时走完/仓储变化 2 秒内点亮（纯 class 切换，无重排成本）
    setInterval(() => { if (Farm.ui.refreshDockDots) Farm.ui.refreshDockDots(); }, 2000);
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

  // ⚠️ 2026-08-11 Chris「我卡在这个页面按任何地方都没有反应」的根因修复。
  //
  // 老设计：#splashStart 的 onclick 在 wireSplash() 里绑，而 wireSplash 排在
  // boot 的一堆 await 之后。boot 只要慢（弱网、SW 换版、iOS 冻结标签页后恢复），
  // 这颗按钮就是**死的**——而登录态下 firebase-auth._renderSplash 早就把
  // 「欢迎回来 · Lv N」画出来了，界面看着完全就绪，按下去毫无反应、也没有任何
  // 反馈。bootSafe 的应急兜底要等 10 秒才装，没人会等满 10 秒。
  //
  // 新设计：**点击意图先于 boot 记录**。DOMContentLoaded 一到就绑一个「预约进场」
  // 处理器：boot 已好就直接进；没好就把按钮改成「正在加载…」并记下意图，boot 一
  // 完成立刻自动进场。这样「能不能进游戏」不再取决于 boot 跑没跑完 ——
  // 最差情况是等，而不是死，而且用户看得见在等。
  // 「我要进去」这个意图由 index.html 里的内联脚本最先接住（它在 HTML 解析时
  // 就跑，早于本文件下载完成 —— 详见那段注释）。这里只负责认领。
  // 🔒 window.__splashEnterRequested / __splashReady / __splashDismiss 是这三个
  // 文件之间的契约，改名要三处同改：index.html 内联脚本、本文件、bootSafe。
  function _enterRequested() { return !!window.__splashEnterRequested; }

  function wireSplash(onDismiss) {
    const splash = document.getElementById('splash');
    const startBtn = document.getElementById('splashStart');
    const loginBtn = document.getElementById('splashLogin');
    if (!splash || !startBtn) { if (onDismiss) onDismiss(); return; }
    let fired = false;
    let removed = false;
    /* 🔒 真正的移除必须可重试，绝不能只靠那个 600ms 定时器（2026-08-12 修，别改回去）
       -----------------------------------------------------------------------
       Chris 2026-08-12：开屏完整显示「欢迎回来 · Lv7 园丁」，点任何地方都没反应，
       连「正在加载…」都不出现 —— 那说明走的是「已就绪 → __splashDismiss()」这条路，
       而 dismiss() 第一行 `if (fired) return` 直接把它吃掉了。
       成因：加载慢时他先点了一下，boot 完成后 wireSplash 会替他补执行 dismiss()
       （见下面的 _enterRequested 分支）→ fired 置 true、移除排到 600ms 之后。
       而 iOS 对后台/繁忙标签页会**冻结计时器**（他开着 44 个标签页），那一次
       setTimeout 没跑到 → 开屏留在屏幕上，但闸门已经落下 → 之后每一次点击都是空转。
       一次性闸门 + 延后执行 + 不校验结果 = 永久死锁。
       修法：fired 只用来防重复播音效/重复回调；**只要开屏还在 DOM 里，
       任何一次点击都必须能把它拿掉**。 */
    const finish = () => {
      if (removed) return;
      removed = true;
      try { if (splash.parentNode) splash.remove(); } catch (_) {}
      if (onDismiss) onDismiss();
    };
    const dismiss = () => {
      if (fired) {
        // 已经 dismiss 过、开屏却还在 → 定时器被系统掐了。立刻硬移除，不是 return。
        if (splash.parentNode) finish();
        return;
      }
      fired = true;
      splash.classList.add('dismissed');
      if (Farm.audio) Farm.audio.play('plant');
      setTimeout(finish, 600);          // 正常路径：等淡出动画
      setTimeout(finish, 2500);         // 兜底：动画/计时器被掐也一定会消失
    };
    startBtn.onclick = dismiss;
    window.__splashReady = true;
    window.__splashDismiss = dismiss;
    // 用户在 boot 完成前点过了 —— 现在补上他那一下，不用再点第二次
    if (_enterRequested()) { dismiss(); return; }
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
    // 走访：只有真有邻居可走时才计（没邻居时「今日」面板会把走访卡撤掉，红点不该还替它数着）
    const nb = Farm.neighbors && Farm.neighbors._todayList;
    if (nb && nb.length && (c.neighborsVisited || []).length < 3) pending++;
    // 今日特价种子：买过就不再计（2026-08-15 之前它永远 +1，红点一天到晚清不掉＝没有红点）
    const specId = Farm.daily && Farm.daily.getSpecialSeedId();
    if (specId && !c.specialSeedBought) pending++;
    badge.textContent = pending > 0 ? pending : '';
  }

  // Bottom-sheet nav menu opened by the top-right hamburger (replaces the old bottom bar).
  function openNavMenu() {
    const lang = (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
    // 图标是 index.html 内嵌 sprite 的 symbol id（视觉升级第1批：chrome 不再用 emoji）。
    const items = [
      { a: 'shop', icon: 'shop', zh: '种子店', en: 'Seeds' },
      { a: 'tasks', icon: 'tasks', zh: '任务', en: 'Tasks' },
      { a: 'orders', icon: 'orders', zh: '小东订单', en: 'Orders' },
      { a: 'storeRewards', icon: 'receipt', zh: '领取到店奖励', en: 'Store Rewards' },
      { a: 'story', icon: 'story', zh: '农场人生', en: 'My Story' },
      { a: 'kitchen', icon: 'kitchen', zh: '小东厨房', en: 'Kitchen' },
      { a: 'community', icon: 'community', zh: '社区', en: 'Community' },
      { a: 'store', icon: 'mall', zh: '农场商城', en: 'Mall' },
      { a: 'expand', icon: 'expand', zh: '扩建农场', en: 'Expand' },
      { a: 'collection', icon: 'collection', zh: '图鉴', en: 'Collection' },
      { a: 'guide', icon: 'guide', zh: '怎么玩', en: 'How to' },
      { a: 'settings', icon: 'settings', zh: '设置', en: 'Settings' },
    ];
    const grid = items.map(it =>
      '<button class="nav-menu-item" data-nav="' + it.a + '"><span class="nav-menu-icon">' +
      '<svg class="ui-icon" aria-hidden="true"><use href="#ui-' + it.icon + '"/></svg>' +
      '</span><span class="nav-menu-label">' + (lang === 'en' ? it.en : it.zh) + '</span></button>'
    ).join('');
    Farm.ui.showModal('<h2 class="modal-title">' + (lang === 'en' ? 'Menu' : '菜单') + '</h2><div class="nav-menu-grid">' + grid + '</div>');
    document.querySelectorAll('#modalContent .nav-menu-item').forEach(btn => {
      btn.onclick = () => {
        if (Farm.audio) Farm.audio.play('tap');
        switch (btn.getAttribute('data-nav')) {
          case 'shop': Farm.shop.open(); break;
          case 'tasks': Farm.tasks.open(); break;
          case 'orders': if (Farm.orders) Farm.orders.open(); break;
          case 'storeRewards': if (Farm.storeRewards) Farm.storeRewards.open(); break;
          case 'story': if (Farm.lifeStory) Farm.lifeStory.open(); break;
          case 'kitchen': if (Farm.kitchen) Farm.kitchen.open(); break;
          case 'community': if (Farm.neighbors) Farm.neighbors.open(); break;
          case 'store': if (Farm.epShop) Farm.epShop.open(); break;
          case 'expand': if (Farm.isoView && Farm.isoView._tryUnlockLand) Farm.isoView._tryUnlockLand(); else if (Farm.ui) Farm.ui.toast(lang === 'en' ? 'Expand is only available in farm view' : '扩建仅在农场视图可用'); break;
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
    // 底部 dock（UX 第 4 批 2026-07-05：任务/商店/谷仓/菜单）+ 任何遗留 .action-btn。
    document.querySelectorAll('.action-btn[data-action]').forEach(btn => {
      const action = btn.dataset.action;
      btn.onclick = () => {
        if (Farm.audio) Farm.audio.play('tap');
        switch (action) {
          case 'shop': Farm.shop.open(); break;
          case 'tasks': Farm.tasks.open(); break;
          case 'warehouse': if (Farm.warehouse) Farm.warehouse.open(); break;  // dock 谷仓
          case 'menu': openNavMenu(); break;                           // dock 菜单 = 汉堡同一函数
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
      <h2 class="modal-title">${Farm.i18n.t('collection_title')}</h2>
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
    // 成长之路：打开就把「当前等级」那几行滚到眼前（2026-08-15）—— Lv8 的玩家
    // 原来要先划过 Lv1–7 三十几行绿色 ✓ 才看得到下一步是什么
    if (_collectionTab === 'journey') {
      const row = document.querySelector('.journey-row.journey-current') || document.querySelector('.journey-row.journey-future');
      const box = document.getElementById('modalContent');
      if (row && box) {
        requestAnimationFrame(() => {
          const top = row.offsetTop - box.clientHeight * 0.35;
          if (top > 0) box.scrollTop = top;
        });
      }
    }
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
          const art = unlocked ? Farm.cropArt.icon(c.id, 32) : '<span style="font-size:22px;">❔</span>';
          // .seed-card 是「38px 图标列 + 信息列」的两列网格 —— 图标与文字必须各占一列，
          // 否则第三个子元素会掉进 38px 窄列，把「种植解锁」折成「种植解 / 锁」（2026-08-15 修）
          return `
            <div class="seed-card" data-crop="${c.id}" style="${unlocked ? '' : 'opacity:0.55;'}">
              <div class="seed-icon">${art}</div>
              <div style="min-width:0;">
                <div class="seed-name" ${unlocked ? '' : 'style="color:var(--warm-text-soft);"'}>${c[nameKey]}</div>
                <div style="font-size:10.5px;color:var(--warm-text-soft);margin-top:3px;white-space:nowrap;">
                  ${unlocked ? (lang === 'en' ? 'Tap for info' : '点击看详情') : (lang === 'en' ? 'Plant to unlock' : '种植解锁')}
                </div>
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
    const tier = (Farm.audio && Farm.audio.currentTier) ? Farm.audio.currentTier() : 'normal';
    const ambientOn = !(Farm.audio && Farm.audio.ambientEnabled) ? true : Farm.audio.ambientEnabled();
    const html = `
      <h2 class="modal-title">${Farm.i18n.t('settings_title')}</h2>

      <div style="margin:16px 0;padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);">
        <div style="font-weight:600;margin-bottom:8px;">${Farm.i18n.t('settings_language')}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn ${lang === 'zh' ? '' : 'secondary'}" id="langZh" style="flex:1;">中文</button>
          <button class="btn ${lang === 'en' ? '' : 'secondary'}" id="langEn" style="flex:1;">English</button>
        </div>
      </div>

      <div style="margin:16px 0;padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);">
        <div style="font-weight:600;margin-bottom:8px;">${Farm.i18n.t('settings_sound')}</div>
        <div style="display:flex;gap:8px;" class="settings-sound-row">
          <button class="btn ${tier === 'normal' ? '' : 'secondary'}" id="soundNormal" style="flex:1;">${lang === 'en' ? '🔊 Normal' : '🔊 正常'}</button>
          <button class="btn ${tier === 'low' ? '' : 'secondary'}" id="soundLow" style="flex:1;">${lang === 'en' ? '🔉 Low' : '🔉 小声'}</button>
          <button class="btn ${tier === 'off' ? '' : 'secondary'}" id="soundOff" style="flex:1;">${lang === 'en' ? '🔇 Off' : '🔇 关'}</button>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-soft);">
          <input id="ambientToggle" type="checkbox" ${ambientOn ? 'checked' : ''}
                 style="width:16px;height:16px;cursor:pointer;"/>
          <span>${lang === 'en' ? '🍃 Background farm ambience (wind + birds)' : '🍃 农场环境声（轻风 + 鸟鸣）'}</span>
        </label>
      </div>

      <div style="margin:16px 0;padding:12px;background:var(--cream-bg);border-radius:var(--radius-md);">
        <div style="font-weight:600;margin-bottom:8px;">🌻 ${lang === 'en' ? 'Farm display' : '农场显示'}</div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
          <input id="petsToggle" type="checkbox" ${Farm.state.data.petsEnabled === false ? '' : 'checked'}
                 style="width:16px;height:16px;cursor:pointer;"/>
          <span>${lang === 'en'
            ? '🐾 Pets roam the yard (bought in the Mall)'
            : '🐾 小动物在院子里走动（农场商城买的宠物）'}</span>
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
      // Weather chip renders its city label per-language but only refreshed on
      // page load before — re-render it now so it flips zh/en immediately
      // (audit B3 P1). Same for the harvest-status pill's dynamic innerHTML.
      if (Farm.weather && Farm.weather.refresh) Farm.weather.refresh();
      if (Farm.harvestStatus && Farm.harvestStatus.render) Farm.harvestStatus.render();
      openSettings();
    };
    document.getElementById('langZh').onclick = () => applyLanguage('zh');
    document.getElementById('langEn').onclick = () => applyLanguage('en');
    document.getElementById('soundNormal').onclick = () => {
      if (Farm.audio) { Farm.audio.setVolumeTier('normal'); Farm.audio.play('tap'); }
      openSettings();
    };
    document.getElementById('soundLow').onclick = () => {
      if (Farm.audio) { Farm.audio.setVolumeTier('low'); Farm.audio.play('tap'); }
      openSettings();
    };
    document.getElementById('soundOff').onclick = () => {
      if (Farm.audio) Farm.audio.setVolumeTier('off');
      openSettings();
    };
    const ambientEl = document.getElementById('ambientToggle');
    if (ambientEl) {
      ambientEl.onchange = () => {
        if (Farm.audio && Farm.audio.setAmbientEnabled) Farm.audio.setAmbientEnabled(ambientEl.checked);
      };
    }
    // 农场显示：走动小动物开关（2026-08-15 从「怎么玩」搬来，那里放设置太怪；
    // 旧的「显示宠物+装饰品」勾选只作用于已被 iso 盖住的 DOM 网格，是个死开关，删了）。
    // 语义：只有 === false 才藏；买宠物时 ep-shop 会自动置 true。
    const petsEl = document.getElementById('petsToggle');
    if (petsEl) {
      petsEl.onchange = () => {
        Farm.state.data.petsEnabled = !!petsEl.checked;
        Farm.state.save();
        if (Farm.audio) Farm.audio.play('tap');
        if (Farm.isoView && Farm.isoView.render) Farm.isoView.render();
      };
    }
    // Neighbor settings: save nickname on blur, visibility on change
    const nickEl = document.getElementById('nicknameInput');
    if (nickEl) {
      nickEl.onblur = () => {
        // Strip HTML-significant chars at the write boundary (defense-in-depth
        // with render-time escaping): a nickname is plain text, never markup.
        if (Farm.lifeStory && Farm.lifeStory.saveNickname) {
          nickEl.value = Farm.lifeStory.saveNickname(nickEl.value);   // 统一入口(清洗+推云+日记)
          return;
        }
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

  // Start when DOM ready. boot 内部已层层兜底，这里是最后一道防线
  // （2026-07-03）：若 boot 仍在 wireSplash 之前致命失败，给开屏按钮接一个
  // 最小 dismiss —— 页面永远不允许「完全不能动」。
  function bootSafe() {
    const installEmergency = function (why) {
      try {
        const splash = document.getElementById('splash');
        const hard = function () { if (splash && splash.parentNode) splash.remove(); };
        // ⚠️ 这里必须**强行覆盖** onclick，不能沿用老的 `if (!b.onclick)` 判据 ——
        // armEarlySplash 一开始就绑了「预约进场」处理器，那个判据永远不成立，
        // 兜底会被自己架空（2026-08-11）。走到这里说明 boot 已经废了，
        // 用户的诉求就是「让我进去」，那就直接把开屏撕掉。
        ['splashStart', 'splashLogin'].forEach(function (id) {
          const b = document.getElementById(id);
          if (b) b.onclick = hard;
        });
        // 只有**用户已经点过**才替他放行；没点过的人留在开屏页 ——
        // boot 挂了的情况下自作主张撕掉开屏，等于把人扔进一个可能残缺的农场。
        if (_enterRequested() && splash && splash.parentNode) hard();
        console.error('[boot] emergency dismiss installed (' + why + ')');
      } catch (_) {}
    };
    let p;
    try { p = boot(); } catch (e) { p = Promise.reject(e); }
    if (p && p.catch) p.catch(function (e) {
      console.error('[boot] FATAL before splash wiring — installing emergency dismiss', e);
      installEmergency('reject');
    });
    // 永挂兜底（2026-07-05，Chris「总是卡着」）：hung fetch 让 boot 的 await 永不
    // resolve/reject → 上面的 p.catch 永不触发 → 开屏死。加一道独立超时：10 秒后若
    // 开屏还在、且「进入农场」按钮仍没绑 onclick（= wireSplash 没跑到），就装应急
    // dismiss —— 页面永远不允许「完全不能动」。（正常 boot 早已 <2s 绑好，不会误触。）
    // 应急兜底：boot 迟迟不完成时，强行放人进去。
    // 2026-08-11 从 10 秒缩到 6 秒，判据也从「按钮没绑 onclick」改成「boot 没就绪」——
    // 现在 armEarlySplash 一开始就给按钮绑了处理器，老判据永远不成立、兜底等于失效。
    setTimeout(function () {
      try {
        const s = document.getElementById('splash');
        if (s && s.parentNode && !window.__splashReady) installEmergency('timeout-6s');
      } catch (_) {}
    }, 6000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSafe);
  } else {
    bootSafe();
  }
})();
