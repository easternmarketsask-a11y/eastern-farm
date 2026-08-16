/**
 * ui.js — Generic UI helpers: modal, toast, currency display, level bar.
 */
(function() {
  // Escape a string for safe insertion into HTML (text OR attribute context).
  // Cross-player names (nicknames, thief/visitor/gift sender names) flow into
  // many innerHTML sinks; without this a player named `<img onerror=...>` would
  // run JS in every other player's client (stored XSS). 2026-06-11.
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const ui = {
    escapeHtml: escapeHtml,

    // Respect the OS "reduce motion" setting: the big celebratory effects
    // (confetti, coin rain, flying coins, harvest bursts) are skipped for
    // motion-sensitive users (target audience includes older family members).
    // Sounds + HUD number updates still happen — only the large motion is cut.
    _prefersReducedMotion() {
      return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    },
    // Last HUD-shown balances — lets refreshHUD tick-count + pulse on change
    // (Hay Day-style juice) instead of snapping numbers silently.
    _shownCoins: null,
    _shownPoints: null,

    // Animate a counter element from `from` to `to` over ~420ms + pulse its
    // parent currency card. Falls back to instant set for tiny deltas.
    _tickCounter(el, from, to) {
      if (!el) return;
      if (from == null || from === to || Math.abs(to - from) < 2) {
        el.textContent = to.toLocaleString();
        return;
      }
      const card = el.closest('.currency');
      if (card) {
        card.classList.remove('hud-bump');
        void card.offsetWidth;             // restart the pulse animation
        card.classList.add('hud-bump');
      }
      // Cancellation token: a rapid second update (e.g. deliver + bonus in
      // quick succession) supersedes the running loop instead of having two
      // rAF loops fight over textContent.
      const token = (el._tickToken = (el._tickToken || 0) + 1);
      const t0 = performance.now(), DUR = 420;
      const step = (t) => {
        if (el._tickToken !== token) return;   // superseded
        const k = Math.min(1, (t - t0) / DUR);
        const eased = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    refreshHUD() {
      const s = Farm.state.data;
      const lang = s.language || 'zh';
      this._tickCounter(document.getElementById('coinsValue'), this._shownCoins, s.coins);
      this._tickCounter(document.getElementById('pointsValue'), this._shownPoints, s.eastPoints);
      this._shownCoins = s.coins;
      this._shownPoints = s.eastPoints;
      // 金币→积分兑换提示（audit P1 首条提示喧宾夺主 2026-07-07）：开局余额
      // 就是 100 币，旧阈值 ≥100 让它成为新手看到的第一条店主提示——高级功能
      // 抢占核心循环（种→收→卖）的教学位。阈值提到开局余额之上，且至少完成
      // 过一次卖货（学会核心循环）后才教兑换。
      if (s.coins >= 300 && (s.totalDeliveries || 0) > 0 &&
          Farm.coach && !Farm.coach.seen('first_coins_exchange')) {
        Farm.coach.fire('first_coins_exchange', 1200);
      }
      document.getElementById('levelValue').textContent = s.level;
      const topLvl = document.getElementById('topbarLevel'); if (topLvl) topLvl.textContent = 'Lv ' + s.level;

      // Title (e.g. 新手 / 学徒 / 农神 / 萨城传说)
      const titleEl = document.getElementById('titleLabel');
      if (titleEl) {
        const t = Farm.state.levelTitle ? Farm.state.levelTitle(s.level) : null;
        titleEl.textContent = t ? (lang === 'en' ? t.en : t.zh) : '';
      }

      // XP bar — formula handles any level (level system is open-ended)
      const curT = Farm.state.xpForLevel ? Farm.state.xpForLevel(s.level) : 0;
      const nextT = Farm.state.xpForLevel ? Farm.state.xpForLevel(s.level + 1) : (curT + 1);
      const span = Math.max(1, nextT - curT);
      const progress = Math.max(0, s.xp - curT);
      const pct = Math.min(100, progress / span * 100);
      document.getElementById('xpFill').style.width = pct + '%';
      const xpTextEl = document.getElementById('xpText');
      if (xpTextEl) {
        xpTextEl.textContent = progress.toLocaleString() + ' / ' + span.toLocaleString();
      }

      // Next plot hint — gives a long-term "next milestone" cue in the status bar
      const nextPlotEl = document.getElementById('nextPlotHint');
      if (nextPlotEl && Farm.state.nextPlotUnlockAt) {
        const nextLv = Farm.state.nextPlotUnlockAt(s.level);
        if (nextLv != null) {
          nextPlotEl.textContent = (lang === 'en' ? '🏞 Lv ' : '🏞 Lv ') + nextLv;
          nextPlotEl.style.display = '';
        } else {
          // Already at max plot tier
          nextPlotEl.textContent = lang === 'en' ? '🏆 MAX' : '🏆 已满';
          nextPlotEl.style.display = '';
        }
      }
    },

    // ===== Modal queue（UX 第 3 批 #7，2026-07-05）=====
    // 延时自动触发的祝贺类弹窗（升级/开张礼/活动红包）传 opts.queue=true：
    // 玩家正读着别的弹窗时不顶掉，先入队，hideModal 后依次弹出。
    // - 队列上限 3，超出丢最旧（离开几天回来不连环轰炸）
    // - 同 queueKey（缺省从 modal-title 推导）去重
    // - opts.onShow 在弹窗真正渲染后才调用——事件绑定/彩带/音效都放这里，
    //   入队瞬间不产生任何副作用（含 shop.stickyEnd 退出钩子）
    _modalQueue: [],

    _modalKeyFromHtml(html) {
      const m = /<h2 class="modal-title"[^>]*>([\s\S]*?)<\/h2>/.exec(html || '');
      return m ? m[1].trim() : String(html || '');
    },

    showModal(html, opts) {
      opts = opts || {};
      const modal = document.getElementById('modal');
      if (!modal) return;
      if (opts.queue && !modal.classList.contains('hidden')) {
        const key = opts.queueKey || this._modalKeyFromHtml(html);
        if (this._modalQueue.some(q => q.key === key)) return;   // 同 title 去重
        this._modalQueue.push({ html: html, opts: opts, key: key });
        if (this._modalQueue.length > 3) this._modalQueue.shift();  // 丢最旧
        return;
      }
      // 打开任何面板 → 退出粘性连续种植（UX 第 2 批 #2 的退出条件之一）。
      // 单一挂钩点：所有 modal 都走这里，不必在每个面板入口各写一次。
      // 注意：必须在 queue 分支之后——入队不算「打开」，真显示时才触发。
      if (window.Farm && Farm.shop && Farm.shop.stickyEnd) Farm.shop.stickyEnd();
      // Defensive: rebuild #modalContent (and the backdrop) if it ever went missing,
      // so a popup can never crash with "Cannot set innerHTML of null".
      let content = document.getElementById('modalContent');
      if (!content) {
        if (!modal.querySelector('.modal-backdrop')) { const bd = document.createElement('div'); bd.className = 'modal-backdrop'; modal.appendChild(bd); }
        content = document.createElement('div'); content.id = 'modalContent'; content.className = 'modal-content'; modal.appendChild(content);
      }
      // Auto-inject a floating ✕ button at the top-right of every modal.
      // Was previously only a bottom "Close" button which required scrolling
      // on long modals (warehouse, shop, leaderboard). The ✕ is always
      // reachable without scroll, matches universal close-affordance.
      content.innerHTML = '<button class="modal-close-x" aria-label="关闭 Close">✕</button>' + html;
      // Cancel any in-flight close animation (rapid reopen) so we don't land
      // .hidden on top of a freshly-shown modal.
      clearTimeout(this._closeTimer);
      modal.classList.remove('closing');
      modal.classList.remove('hidden');
      // Mark the body so persistent fixed overlays (e.g. the PWA install banner,
      // z-index 9000) can hide themselves while a modal is open — otherwise they
      // float on top of the modal's bottom content.
      document.body.classList.add('modal-open');
      // Click backdrop to close
      modal.querySelector('.modal-backdrop').onclick = () => this.hideModal();
      // ✕ button click
      const xBtn = content.querySelector('.modal-close-x');
      if (xBtn) xBtn.onclick = () => this.hideModal();
      // Escape key support (desktop)
      this._escHandler = (e) => {
        if (e.key === 'Escape') this.hideModal();
      };
      document.addEventListener('keydown', this._escHandler);
      // 弹窗已真正渲染 → 现在才执行调用方的绑定/庆祝副作用（队列场景下
      // 这可能发生在入队之后很久）。
      if (typeof opts.onShow === 'function') {
        try { opts.onShow(); } catch (e) { console.warn('[ui] modal onShow failed:', e); }
      }
    },

    hideModal() {
      const modal = document.getElementById('modal');
      // Exit animation (B7): play a 180ms reverse scale+fade before hiding.
      // The container gets pointer-events:none during .closing (see style.css)
      // so the dying modal never swallows a tap meant for the screen behind it
      // (MEMORY: feedback_modal_pointer_events). Skipped under reduced motion.
      if (modal && !modal.classList.contains('hidden')) {
        if (this._prefersReducedMotion()) {
          modal.classList.add('hidden');
        } else {
          modal.classList.add('closing');
          clearTimeout(this._closeTimer);
          this._closeTimer = setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('closing');
          }, 185);
        }
      }
      // Dock fades back in immediately (CSS transitions the transform/opacity),
      // so it eases in as the modal eases out instead of snapping.
      document.body.classList.remove('modal-open');
      // 商店关闭且未购买 → 清掉「买完种子回填原地块」的挂起状态（UX 第 2 批 #4）。
      // 买种成功的路径在 hideModal 之前就把 pending 消费掉了，这里只兜「放弃购买」。
      if (window.Farm && Farm.shop) Farm.shop._pendingPlotIdx = null;
      if (this._escHandler) {
        document.removeEventListener('keydown', this._escHandler);
        this._escHandler = null;
      }
      // 出队：关窗后稍候片刻再弹下一个排队的祝贺弹窗（给关窗动作留缓冲）。
      // 若 250ms 内玩家又主动打开了别的面板，queue:true 的重放会自动再入队。
      if (this._modalQueue.length > 0) {
        const next = this._modalQueue.shift();
        clearTimeout(this._modalDequeueTimer);
        this._modalDequeueTimer = setTimeout(() => {
          this.showModal(next.html, next.opts);
        }, 250);
      }
    },

    /* 「画面正忙」统一判定（2026-08-15）：任何**自动**弹出的东西（章节来信、
       回家小报、催登录……）出手前都该问一句。以前各处只查 #modal 有没有开，
       漏了两个不走 modal 的覆盖层：开屏 + 新手聚光灯 —— 实测全新玩家点完欢迎窗
       8 秒后，「初来乍到」的信直接盖在「点这块发光的地」的聚光灯上。 */
    isBusy() {
      const modal = document.getElementById('modal');
      if (modal && !modal.classList.contains('hidden')) return true;
      if (document.getElementById('splash')) return true;
      if (window.Farm && Farm.spotlight && Farm.spotlight._active) return true;
      if (document.getElementById('spotlightOverlay')) return true;
      if (window.Farm && Farm.isoView && Farm.isoView._clearMode) return true;
      return false;
    },

    // Small toast stack (B7): up to 2 toasts stacked vertically, each with its
    // own fade timer. A 3rd toast evicts the oldest (FIFO) instead of the old
    // single-slot overwrite that truncated the previous message — so the
    // harvest bonus toasts (jackpot / first-of-day / weekend), fired 700ms
    // apart, no longer cut each other off. Container is created lazily.
    _toastStack() {
      let stack = document.getElementById('toastStack');
      if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toastStack';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
      }
      return stack;
    },

    toast(text, duration) {
      duration = duration || 2800;
      const stack = this._toastStack();
      // FIFO cap at 2 — evict the oldest immediately if we're already full.
      while (stack.children.length >= 2) {
        const old = stack.firstElementChild;
        if (old && old._toastTimer) clearTimeout(old._toastTimer);
        stack.removeChild(old);
      }
      const el = document.createElement('div');
      el.className = 'toast';
      // Author-controlled strings only (no XSS risk here); inline HTML supports
      // the styled coin/points icon spans.
      el.innerHTML = text;
      /* ⚠️ CSS 的 toastOut 动画起点是 var(--toast-out-delay, 2.5s)。注释一直声称
         「由 JS 按实际时长写入」，但这行**从来没存在过** —— 结果所有 toast 不管
         要求多长，2.5 秒就开始淡出：8 秒的重要提示实际 2.8 秒就看不见了
         （2026-08-14 推广前体检抓到）。 */
      el.style.setProperty('--toast-out-delay', Math.max(0, duration - 300) + 'ms');
      // 点一下就关（Chris 阻塞项 #5「提示要能关掉」推广到所有 toast）
      el.addEventListener('click', () => dismiss(), { once: true });
      stack.appendChild(el);
      const dismiss = () => {
        if (el._toastDone) return;
        el._toastDone = true;
        clearTimeout(el._toastTimer);
        el.classList.add('toast-out');
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
      };
      el._toastTimer = setTimeout(dismiss, duration);
      return el;
    },

    floatText(text, x, y, color) {
      const el = document.createElement('div');
      el.className = 'float-coin';
      // Support inline HTML so the floating "+5 [coin]" can use the styled
      // coin-icon span instead of the inconsistent 🪙 emoji.
      el.innerHTML = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      if (color) el.style.color = color;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    },

    // ===== Game-feel juice (2026-06-11, Hay Day benchmark) =====

    // Fly N gold coins from (x,y) to the HUD coin counter along a slight
    // arc, staggered. Each arrival nudges the counter card. Pure DOM +
    // Web Animations API; coins render with the standard .coin-icon disc.
    flyCoins(x, y, n) {
      // Reduced motion: skip the flight but keep the sound; callers still run
      // their own refreshHUD (warehouse.deliver does so on a timer).
      if (this._prefersReducedMotion()) { if (Farm.audio) Farm.audio.play('coin'); return; }
      const target = document.getElementById('coinsValue');
      if (!target) return;
      const r = target.getBoundingClientRect();
      const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
      const count = Math.max(1, Math.min(n || 5, 10));
      for (let i = 0; i < count; i++) {
        const c = document.createElement('span');
        c.className = 'coin-icon fly-coin';
        c.textContent = '';
        // small scatter around the origin so the flock feels organic
        const sx = x + (Math.random() - 0.5) * 36;
        const sy = y + (Math.random() - 0.5) * 24;
        c.style.left = sx + 'px';
        c.style.top = sy + 'px';
        document.body.appendChild(c);
        // Ancient Safari (≤iOS 12) lacks the Web Animations API — degrade to
        // no flight rather than leaving orphaned coins on screen.
        if (typeof c.animate !== 'function') { c.remove(); continue; }
        const dx = tx - sx, dy = ty - sy;
        // arc: rise a bit before homing in on the counter
        const anim = c.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 46}px) scale(1.05)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0.9 },
        ], {
          duration: 560 + Math.random() * 120,
          delay: i * 55,
          easing: 'cubic-bezier(0.5, -0.1, 0.7, 1)',
          fill: 'forwards',
        });
        anim.onfinish = () => {
          c.remove();
          // pulse on landing — throttled to one restart per 120ms so ten
          // landings don't force ten layout reflows back-to-back
          const card = target.closest('.currency');
          const now = performance.now();
          if (card && (!card._lastBumpAt || now - card._lastBumpAt > 120)) {
            card._lastBumpAt = now;
            card.classList.remove('hud-bump');
            void card.offsetWidth;
            card.classList.add('hud-bump');
          }
        };
      }
      if (Farm.audio) Farm.audio.play('coin');
    },

    // Radial particle burst at (x,y) — used for harvest picks & mature pops.
    // emojis: array to sample from; count ~6-10 keeps it lively not noisy.
    burst(x, y, emojis, count) {
      if (this._prefersReducedMotion()) return;
      emojis = emojis && emojis.length ? emojis : ['✨', '🍃'];
      count = count || 7;
      for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'burst-particle';
        p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        const ang = (Math.PI * 2 / count) * i + Math.random() * 0.7;
        const dist = 34 + Math.random() * 30;
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.setProperty('--bx', Math.cos(ang) * dist + 'px');
        p.style.setProperty('--by', Math.sin(ang) * dist - 18 + 'px');
        p.style.fontSize = (11 + Math.random() * 8) + 'px';
        p.style.animationDelay = (Math.random() * 70) + 'ms';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 800);
      }
    },

    setStorekeeperLine(text) {
      const bubble = document.getElementById('storekeeperBubble');
      if (!bubble) return;
      // Polish: re-trigger the storekeeperPop CSS animation by toggling
      // the .refresh class off → reflow → on. Without the reflow the
      // browser coalesces the class change and skips the restart.
      bubble.textContent = text;
      bubble.classList.remove('refresh');
      void bubble.offsetWidth;
      bubble.classList.add('refresh');
    },

    setFestivalBanner(text) {
      const banner = document.getElementById('festivalBanner');
      if (!text) {
        banner.classList.add('hidden');
      } else {
        document.getElementById('festivalText').textContent = text;
        banner.classList.remove('hidden');
      }
    },

    setTaskBadge(count) {
      // UX 第 4 批（2026-07-05）：任务红点落在底部 dock 任务钮上（#taskBadge 就在
      // 那颗钮里），不再镜像到顶栏汉堡——汉堡聚合红点只统计「菜单里才有的功能」
      // （目前 = 厨房出锅，见 refreshDockDots），避免与 dock 重复计数。
      const badge = document.getElementById('taskBadge');
      if (badge) badge.textContent = count > 0 ? count : '';
    },

    // ===== 底部 dock 红点接线（UX 第 4 批 2026-07-05）=====
    // 谷仓钮：仓储 ≥80% 黄点、满仓红点——数据口径与 iso 谷仓头顶点完全一致
    // （warehouse.length vs warehouseCapacity，mapview-iso.js ~1270，不另算）。
    // 菜单钮 + 顶栏汉堡：厨房出锅数 kitchen.readyCount()>0 → 红点/计数
    // （审计发现 readyCount 此前没接任何红点，这里接上；厨房入口在菜单里）。
    refreshDockDots() {
      if (!window.Farm || !Farm.state || !Farm.state.data) return;
      const barnDot = document.getElementById('dockBarnDot');
      if (barnDot) {
        const n = (Farm.state.data.warehouse || []).length;
        const cap = Farm.state.data.warehouseCapacity || 20;
        const show = cap > 0 && n >= cap * 0.8;
        barnDot.classList.toggle('show', show);
        barnDot.classList.toggle('warn', show && n < cap);   // 将满=黄，满仓=红
      }
      let ready = 0;
      try { if (Farm.kitchen && Farm.kitchen.readyCount) ready = Farm.kitchen.readyCount(); } catch (e) {}
      const menuDot = document.getElementById('dockMenuDot');
      if (menuDot) menuDot.classList.toggle('show', ready > 0);
      const nav = document.getElementById('navBadge');
      if (nav) { nav.textContent = ready > 0 ? ready : ''; nav.classList.toggle('show', ready > 0); }
    },

    // Big celebratory modal shown when the player levels up. Shows the level
    // jump, any new title, what got unlocked (plots / EP bonus), and previews
    // the next milestone so the player can see "still room to grow".
    showLevelUpModal(oldLevel, newLevel, opts) {
      opts = opts || {};
      const lang = Farm.state.data.language || 'zh';
      const epAwarded = opts.epAwarded || 0;

      const oldTitle = Farm.state.levelTitle(oldLevel);
      const newTitle = Farm.state.levelTitle(newLevel);
      const titleChanged = newTitle.min !== oldTitle.min;

      // Count plots unlocked between oldLevel+1 and newLevel
      let plotsUnlocked = 0;
      for (let lv = oldLevel + 1; lv <= newLevel; lv++) {
        plotsUnlocked += (Farm.state.PLOT_UNLOCK_AT && Farm.state.PLOT_UNLOCK_AT[lv]) || 0;
      }

      // Next milestones
      const nextTitle = Farm.state.nextTitleAt(newLevel);
      const nextPlotLv = Farm.state.nextPlotUnlockAt(newLevel);
      const nextLevelXp = Farm.state.xpForLevel(newLevel + 1);
      const curLevelXp = Farm.state.xpForLevel(newLevel);
      const curXp = Farm.state.data.xp || 0;
      const intoNext = Math.max(0, curXp - curLevelXp);
      const span = Math.max(1, nextLevelXp - curLevelXp);
      const pct = Math.min(100, intoNext / span * 100);

      // 新解锁作物（2026-08-15）：升级最强的「盼头」是新菜，原弹窗只提地块/积分/币，
      // 成长之路里的作物里程碑在这里一句都没提。同时算出下一个作物解锁等级
      const allCrops = (Farm.crops && Farm.crops.all) ? Farm.crops.all() : [];
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const cropIcon = (c) => (Farm.cropArt && Farm.cropArt.icon) ? Farm.cropArt.icon(c.id, 22) : (c.icon || '🥬');
      const justUnlocked = allCrops.filter((c) => (c.unlock_level || 1) > oldLevel && (c.unlock_level || 1) <= newLevel);
      let nextCropLv = null;
      allCrops.forEach((c) => { const lv = c.unlock_level || 1; if (lv > newLevel && (nextCropLv === null || lv < nextCropLv)) nextCropLv = lv; });
      const nextCrops = nextCropLv ? allCrops.filter((c) => (c.unlock_level || 1) === nextCropLv) : [];

      // Build "unlocked" list
      const unlockedItems = [];
      if (justUnlocked.length) {
        unlockedItems.push('<span class="lvup-crops">' + (lang === 'en' ? '🌱 New crops: ' : '🌱 解锁新菜：')
          + justUnlocked.map((c) => '<span class="lvup-crop">' + cropIcon(c) + c[nameKey] + '</span>').join(' ') + '</span>');
      }
      if (plotsUnlocked > 0) {
        unlockedItems.push((lang === 'en'
          ? '🏞 +' + plotsUnlocked + ' new plot' + (plotsUnlocked > 1 ? 's' : '')
          : '🏞 新解锁 ' + plotsUnlocked + ' 块地'));
      }
      if (epAwarded > 0) {
        unlockedItems.push('<span class="points-icon"></span> +' + epAwarded + (lang === 'en' ? ' points' : ' 超市积分'));
      }
      // Always include a coin bonus mention to make level-up feel rewarding
      unlockedItems.push('<span class="coin-icon"></span> +' + (50 * (newLevel - oldLevel)) + (lang === 'en' ? ' coins' : ' 农场币'));

      const titleZhEn = (t) => lang === 'en' ? t.en : t.zh;

      const titleChipHTML = titleChanged
        ? '<div class="lvup-title-change">' +
            '<span class="lvup-title-old">' + titleZhEn(oldTitle) + '</span>' +
            ' → ' +
            '<span class="lvup-title-new">' + titleZhEn(newTitle) + '</span>' +
          '</div>'
        : '<div class="lvup-title-stay">' + titleZhEn(newTitle) + '</div>';

      const nextHTML = nextTitle || nextPlotLv || nextCropLv ? (
        '<div class="lvup-next">' +
          '<div class="lvup-next-label">' + (lang === 'en' ? 'Next milestone' : '下个里程碑') + '</div>' +
          (nextCropLv ? (
            '<div class="lvup-next-row">' +
              '<span>🌱 ' + (lang === 'en' ? 'New crop' : '新菜') + '</span>' +
              '<span>' + nextCrops.slice(0, 2).map((c) => c[nameKey]).join(' · ') + (nextCrops.length > 2 ? ' …' : '') + ' · Lv ' + nextCropLv + '</span>' +
            '</div>'
          ) : '') +
          (nextTitle ? (
            '<div class="lvup-next-row">' +
              '<span>🏷 ' + (lang === 'en' ? 'Title' : '称号') + '</span>' +
              '<span>「' + titleZhEn(nextTitle) + '」 ' + (lang === 'en' ? 'at Lv ' : '在 Lv ') + nextTitle.min + '</span>' +
            '</div>'
          ) : '') +
          (nextPlotLv ? (
            '<div class="lvup-next-row">' +
              '<span>🏞 ' + (lang === 'en' ? 'New plot' : '新地块') + '</span>' +
              '<span>Lv ' + nextPlotLv + '</span>' +
            '</div>'
          ) : '') +
          '<div class="lvup-next-bar"><div class="lvup-next-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="lvup-next-xp">' + intoNext.toLocaleString() + ' / ' + span.toLocaleString() +
            ' XP → Lv ' + (newLevel + 1) +
          '</div>' +
        '</div>'
      ) : (
        '<div class="lvup-next lvup-next-max">' +
          '🏆 ' + (lang === 'en' ? 'You\'ve reached the farthest title!' : '已抵达最高称号！') +
        '</div>'
      );

      const html = `
        <div class="lvup-modal lvup-burst">
          <div class="lvup-emoji-row">
            <span class="lvup-emoji">🎉</span>
            <span class="lvup-emoji">✨</span>
            <span class="lvup-emoji">🎊</span>
            <span class="lvup-emoji">⭐</span>
            <span class="lvup-emoji">🎉</span>
          </div>
          <div class="lvup-label">${lang === 'en' ? 'Level Up!' : '升级了！'}</div>
          <div class="lvup-jump">
            <span class="lvup-old">Lv ${oldLevel}</span>
            <span class="lvup-arrow">▶</span>
            <span class="lvup-new" id="lvupNewNum" data-from="${oldLevel}" data-to="${newLevel}">Lv ${oldLevel}</span>
          </div>
          ${titleChipHTML}
          <div class="lvup-unlocked">
            ${unlockedItems.map(t => '<div class="lvup-unlocked-row">' + t + '</div>').join('')}
          </div>
          ${nextHTML}
          <div class="btn-row">
            <button class="btn" id="lvupOkBtn">${lang === 'en' ? 'Keep growing' : '继续耕耘'}</button>
          </div>
        </div>
      `;
      // queue:true——升级弹窗常由收获后 500ms 延时触发，玩家可能正读着
      // 任务奖励/选种器等弹窗，不顶掉，排队等当前弹窗关闭后再弹（#7）。
      // 绑定与庆祝副作用全部放 onShow：入队瞬间不放彩带不响音效。
      this.showModal(html, {
        queue: true,
        queueKey: 'levelup',
        onShow: () => {
          const okBtn = document.getElementById('lvupOkBtn');
          if (okBtn) okBtn.onclick = () => this.hideModal();
          if (Farm.audio) Farm.audio.play('levelUp');
          // Big confetti shower over the whole screen
          this.showConfetti(36, 2600);
          // Count-up animation on the new level number
          this._animateLevelCount(oldLevel, newLevel);
          // Optional haptic feedback on mobile
          if (navigator.vibrate) { try { navigator.vibrate([20, 40, 20]); } catch (_) {} }
        },
      });
    },

    // Spawn N falling confetti pieces across the screen for `duration` ms.
    // Used by level-up + other big celebrations. Pieces are absolutely
    // positioned, randomly colored, fall + rotate + fade.
    showConfetti(count, duration) {
      if (this._prefersReducedMotion()) return;
      count = count || 30;
      duration = duration || 2200;
      const layer = document.createElement('div');
      layer.className = 'confetti-layer';
      document.body.appendChild(layer);
      const colors = ['#ff7043', '#ffd54f', '#aed581', '#4fc3f7', '#ba68c8', '#f06292', '#fff176'];
      const shapes = ['🎉', '✨', '🎊', '⭐', '🌟', '💫', '🎁'];
      for (let i = 0; i < count; i++) {
        const piece = document.createElement('span');
        piece.className = 'confetti-piece';
        // 70% emoji, 30% colored squares for variety
        if (Math.random() < 0.7) {
          piece.textContent = shapes[Math.floor(Math.random() * shapes.length)];
          piece.style.fontSize = (14 + Math.floor(Math.random() * 12)) + 'px';
        } else {
          piece.classList.add('confetti-square');
          piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        }
        piece.style.left = (Math.random() * 100) + '%';
        piece.style.animationDuration = (1.4 + Math.random() * 1.8) + 's';
        piece.style.animationDelay = (Math.random() * 0.5) + 's';
        piece.style.setProperty('--end-rot', (Math.random() * 720 - 360) + 'deg');
        piece.style.setProperty('--end-x', (Math.random() * 80 - 40) + 'px');
        layer.appendChild(piece);
      }
      setTimeout(() => layer.remove(), duration + 800);
    },

    // Golden coin rain — harvest payoff celebration. Reuses the confetti
    // layer/animation but rains coins (and a few sparkles) instead of party
    // shapes, so the player feels the "I just made money" moment. `intensity`
    // (1–3) scales how many coins fall.
    coinBurst(intensity) {
      if (this._prefersReducedMotion()) return;
      intensity = Math.max(1, Math.min(3, intensity || 1));
      const count = 10 + intensity * 8;
      const layer = document.createElement('div');
      layer.className = 'confetti-layer';
      document.body.appendChild(layer);
      const glyphs = ['🪙', '🪙', '🪙', '💰', '✨', '🌟'];
      for (let i = 0; i < count; i++) {
        const piece = document.createElement('span');
        piece.className = 'confetti-piece';
        piece.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
        piece.style.fontSize = (16 + Math.floor(Math.random() * 12)) + 'px';
        piece.style.left = (Math.random() * 100) + '%';
        piece.style.animationDuration = (1.1 + Math.random() * 1.3) + 's';
        piece.style.animationDelay = (Math.random() * 0.35) + 's';
        piece.style.setProperty('--end-rot', (Math.random() * 360 - 180) + 'deg');
        piece.style.setProperty('--end-x', (Math.random() * 60 - 30) + 'px');
        layer.appendChild(piece);
      }
      setTimeout(() => layer.remove(), 2600);
    },

    // Animate the level number from old → new over ~700ms (eases nicely
    // because the user is reading the modal at the same time).
    _animateLevelCount(from, to) {
      const el = document.getElementById('lvupNewNum');
      if (!el) return;
      if (to === from) { el.textContent = 'Lv ' + to; return; }
      const start = performance.now();
      const dur = 700;
      const step = (now) => {
        const t = Math.min(1, (now - start) / dur);
        // Ease-out cubic
        const ease = 1 - Math.pow(1 - t, 3);
        const cur = Math.round(from + (to - from) * ease);
        el.textContent = 'Lv ' + cur;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.ui = ui;
})();
