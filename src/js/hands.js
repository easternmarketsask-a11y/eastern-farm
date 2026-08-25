/**
 * hands.js — 帮手：可见的额外农户，共用玩家已经排上的农活。
 * 只收 / 浇 / 种；只在游戏打开时干活；工钱是农场币按天付。
 * 契约：scripts/verify/hands-test.mjs
 */
(function () {
  const MAX_HANDS = 2;
  const UNLOCK_PLOTS = 12;
  const WAGE = [180, 280];

  function t(key, fallbackZh, fallbackEn) {
    if (Farm.i18n && Farm.i18n.t && Farm.i18n.strings && Farm.i18n.strings[key]) {
      return Farm.i18n.t(key);
    }
    const en = Farm.state && Farm.state.data && Farm.state.data.language === 'en';
    return en ? (fallbackEn || fallbackZh) : fallbackZh;
  }
  function today() {
    return (Farm.state && Farm.state.getDateString) ? Farm.state.getDateString() : '';
  }
  function handOpts(paid) {
    return {
      canDrive: false,
      canPolish: false,
      canIdleWander: true,
      claimBoard: !!paid,
    };
  }

  const hands = {
    MAX_HANDS: MAX_HANDS,
    UNLOCK_PLOTS: UNLOCK_PLOTS,
    WAGE: WAGE,
    board: [],
    actors: [],
    _visitHold: null,
    _lastWageDay: '',
    _lookOpen: -1,

    unlockedPlotCount: function () {
      const plots = (Farm.state.data && Farm.state.data.plots) || [];
      let n = 0;
      for (let i = 0; i < plots.length; i++) if (plots[i] && plots[i].unlocked) n++;
      return n;
    },
    isUnlocked: function () { return this.unlockedPlotCount() >= this.UNLOCK_PLOTS; },
    maxAllowed: function () { return this.isUnlocked() ? this.MAX_HANDS : 0; },
    liveCount: function () {
      const rows = (Farm.state.data && Farm.state.data.hands) || [];
      return Math.min(rows.length, this.MAX_HANDS);
    },
    wageOf: function (slot) { return this.WAGE[slot] || this.WAGE[0]; },
    canWork: function (slot) {
      if (Farm.state && Farm.state._visitLock) return false;
      if (slot < 0 || slot >= this.liveCount()) return false;
      const rows = Farm.state.data.hands || [];
      return !!(rows[slot] && rows[slot].paidThroughDate === today());
    },

    _defaultLook: function () {
      const used = (Farm.state.data && Farm.state.data.farmerLook) || 2;
      const prefer = [7, 9, 1, 3, 4, 8, 2, 5, 6];
      for (let i = 0; i < prefer.length; i++) if (prefer[i] !== used) return prefer[i];
      return 7;
    },
    _spawn: function (iso, actor, slot) {
      if (!iso || !actor) return;
      if (Farm.farmer && Farm.farmer.spawnAt) Farm.farmer.spawnAt(iso, actor);
      const player = Farm.farmer && Farm.farmer._actor ? Farm.farmer._actor() : null;
      const free = (Farm.farmer && Farm.farmer.walkableFor)
        ? Farm.farmer.walkableFor(iso, 1, 1) : function () { return true; };
      const occupied = [];
      if (player && player.gx != null) occupied.push(player);
      for (let i = 0; i < this.actors.length; i++) {
        if (this.actors[i] && this.actors[i] !== actor && this.actors[i].gx != null) occupied.push(this.actors[i]);
      }
      const taken = (gx, gy) => {
        const rx = Math.round(gx), ry = Math.round(gy);
        for (let i = 0; i < occupied.length; i++) {
          if (Math.round(occupied[i].gx) === rx && Math.round(occupied[i].gy) === ry) return true;
        }
        return false;
      };
      const originX = (player && player.gx != null) ? player.gx : (actor.gx || 0);
      const originY = (player && player.gy != null) ? player.gy : (actor.gy || 0);
      const ring = [
        [1.3 + slot * 0.8, 0.7], [0.7, 1.4 + slot * 0.6], [-1.1, 1.1],
        [1.6, 1.5], [-0.4, 1.8], [2.0, 0.4], [0.2, -1.2],
      ];
      for (let i = 0; i < ring.length; i++) {
        const gx = originX + ring[i][0], gy = originY + ring[i][1];
        if (!free(Math.round(gx), Math.round(gy))) continue;
        if (taken(gx, gy)) continue;
        actor.gx = gx;
        actor.gy = gy;
        return;
      }
      actor.gx = (actor.gx || originX) + 1.1 + (slot || 0) * 0.8;
      actor.gy = (actor.gy || originY) + 0.9;
    },

    maybeSyncFromSave: function () {
      if (Farm.state && Farm.state._visitLock) return;
      if (this.actors.length !== this.liveCount()) this.syncFromSave();
    },
    syncFromSave: function () {
      if (Farm.state && Farm.state._visitLock) return;
      const rows = (Farm.state.data && Farm.state.data.hands) || [];
      const n = Math.min(rows.length, this.MAX_HANDS);
      const prev = this.actors;
      const next = [];
      for (let i = 0; i < n; i++) {
        const look = Farm.farmer && Farm.farmer.clampLook
          ? Farm.farmer.clampLook(rows[i].look)
          : ((rows[i].look >= 1 && rows[i].look <= 9) ? (rows[i].look | 0) : 7);
        let actor = prev[i];
        if (!actor) actor = Farm.farmer.emptyActor(look);
        else actor.look = look;
        next.push(actor);
      }
      this.actors = next;
      const iso = Farm.isoView;
      if (iso && iso._on) {
        for (let i = 0; i < next.length; i++) {
          if (next[i].gx == null) this._spawn(iso, next[i], i);
        }
      }
    },

    hire: function (look) {
      if (Farm.state && Farm.state._visitLock) return false;
      if (!this.isUnlocked()) return false;
      if (this.liveCount() >= Math.min(this.MAX_HANDS, this.maxAllowed())) return false;
      const d = Farm.state.data;
      if (!d) return false;
      if (!Array.isArray(d.hands)) d.hands = [];
      const slot = this.liveCount();
      const wage = this.wageOf(slot);
      if ((d.coins || 0) < wage) {
        if (Farm.ui && Farm.ui.toast) {
          Farm.ui.toast(t('hands_broke', '农场币不够付今天的工钱。', 'Not enough farm coins for today\'s wage.'));
        }
        if (Farm.audio && Farm.audio.play) Farm.audio.play('error');
        return false;
      }
      const row = {
        look: Farm.farmer.clampLook(look != null ? look : this._defaultLook()),
        hiredAt: Date.now(),
        paidThroughDate: today(),
      };
      d.hands.push(row);
      if (!Farm.state.spendCoins(wage)) {
        d.hands.pop();
        return false;
      }
      this.maybeSyncFromSave();
      if (Farm.audio && Farm.audio.play) Farm.audio.play('buy');
      if (Farm.lifeStory && Farm.lifeStory.record) {
        Farm.lifeStory.record('hands_hire', '农场请来了帮手。', 'Hired a hand.');
      }
      if (Farm.track) Farm.track('hands_hire', { look: row.look });
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      if (Farm.isoView && Farm.isoView.render) Farm.isoView.render();
      return true;
    },
    pay: function (slot) {
      if (Farm.state && Farm.state._visitLock) return false;
      const d = Farm.state.data;
      const rows = d && d.hands;
      if (!rows || slot < 0 || slot >= Math.min(rows.length, this.MAX_HANDS)) return false;
      if (rows[slot].paidThroughDate === today()) return true;
      const wage = this.wageOf(slot);
      if ((d.coins || 0) < wage) {
        if (Farm.ui && Farm.ui.toast) {
          Farm.ui.toast(t('hands_broke', '农场币不够付今天的工钱。', 'Not enough farm coins for today\'s wage.'));
        }
        if (Farm.audio && Farm.audio.play) Farm.audio.play('error');
        return false;
      }
      const prev = rows[slot].paidThroughDate;
      rows[slot].paidThroughDate = today();
      if (!Farm.state.spendCoins(wage)) {
        rows[slot].paidThroughDate = prev;
        return false;
      }
      if (Farm.audio && Farm.audio.play) Farm.audio.play('buy');
      if (Farm.track) Farm.track('hands_pay', { slot: slot });
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      return true;
    },
    dismiss: function (slot) {
      if (Farm.state && Farm.state._visitLock) return false;
      const d = Farm.state.data;
      if (!d || !Array.isArray(d.hands) || slot < 0 || slot >= d.hands.length) return false;
      d.hands.splice(slot, 1);
      if (slot < this.actors.length) this.actors.splice(slot, 1);
      this._lookOpen = -1;
      if (Farm.state.save) Farm.state.save();
      this.maybeSyncFromSave();
      if (Farm.audio && Farm.audio.play) Farm.audio.play('tap');
      if (Farm.track) Farm.track('hands_dismiss', { slot: slot });
      if (Farm.isoView && Farm.isoView.render) Farm.isoView.render();
      return true;
    },
    applyLook: function (slot, look) {
      if (Farm.state && Farm.state._visitLock) return false;
      const rows = Farm.state.data && Farm.state.data.hands;
      if (!rows || slot < 0 || slot >= Math.min(rows.length, this.MAX_HANDS)) return false;
      const n = Farm.farmer.clampLook(look);
      rows[slot].look = n;
      if (this.actors[slot]) this.actors[slot].look = n;
      if (Farm.state.save) Farm.state.save();
      if (Farm.isoView && Farm.isoView.render) Farm.isoView.render();
      return true;
    },

    collectWage: function () {
      if (!Farm.state || Farm.state._visitLock) return;
      const date = today();
      if (this._lastWageDay === date) return;
      const rows = Farm.state.data.hands || [];
      const n = Math.min(rows.length, this.MAX_HANDS);
      let unpaid = false;
      for (let i = 0; i < n; i++) {
        if (rows[i].paidThroughDate === date) continue;
        const wage = this.wageOf(i);
        const prev = rows[i].paidThroughDate;
        rows[i].paidThroughDate = date;
        if ((Farm.state.data.coins || 0) >= wage && Farm.state.spendCoins(wage)) {
          // spendCoins saved the row + the debit
        } else {
          rows[i].paidThroughDate = prev;
          unpaid = true;
        }
      }
      this._lastWageDay = date;
      if (unpaid && Farm.ui && Farm.ui.toast
          && !(Farm.ui.isBusy && Farm.ui.isBusy())
          && !(Farm.farmer && Farm.farmer.doingFarmWork && Farm.farmer.doingFarmWork())) {
        Farm.ui.toast(t('hands_unpaid_toast',
          '今天的工钱还没付，这位帮手先歇着。',
          'Today\'s wage is unpaid, so this hired hand is sitting it out.'), 2800);
      }
    },

    maybePromptUnlock: function () {
      if (!Farm.state || Farm.state._visitLock) return;
      if (!this.isUnlocked()) return;
      const d = Farm.state.data;
      if (!d || d.handsUnlockSeen === '1') return;
      if (Farm.ui && Farm.ui.isBusy && Farm.ui.isBusy()) return;
      if (Farm.farmer && Farm.farmer.doingFarmWork && Farm.farmer.doingFarmWork()) return;
      for (let i = 0; i < this.actors.length; i++) {
        const k = this.actors[i] && this.actors[i].job && this.actors[i].job.kind;
        if (k === 'harvest' || k === 'water' || k === 'plant') return;
      }
      d.handsUnlockSeen = '1';
      if (Farm.state.save) Farm.state.save();
      if (Farm.track) Farm.track('hands_unlock_prompt');
      this._showUnlockPrompt();
    },
    _showUnlockPrompt: function () {
      const html = ''
        + '<h2 class="modal-title">' + t('hands_title', '帮手', 'Hired hand') + '</h2>'
        + '<p class="modal-subtitle">' + t('hands_unlock_body',
          '菜地够多了，可以请帮手一起收、浇、种。最多两位。按天付农场币，当天付过工钱才会干活。',
          'The farm is big enough to hire a hand. You can hire up to two. They harvest, water, and plant with you. Paid in farm coins each day — they only work on a day that is paid.')
        + '</p>'
        + '<div class="btn-row">'
        + '<button class="btn" id="handsUnlockYes">' + t('hands_unlock_yes', '去请帮手', 'Hire a hand') + '</button>'
        + '<button class="btn secondary" id="handsUnlockNo">' + t('hands_unlock_no', '先不要', 'Not now') + '</button>'
        + '</div>';
      Farm.ui.showModal(html, { closeOnBackdrop: true });
      const yes = document.getElementById('handsUnlockYes');
      if (yes) yes.onclick = () => this.openPanel();
      const no = document.getElementById('handsUnlockNo');
      if (no) no.onclick = () => Farm.ui.hideModal();
    },

    openPanel: function () {
      if (!Farm.ui || !Farm.ui.showModal) return;
      this.collectWage();
      const en = Farm.state && Farm.state.data && Farm.state.data.language === 'en';
      const looks = (Farm.farmer && Farm.farmer.LOOKS) || [];
      const rows = (Farm.state.data && Farm.state.data.hands) || [];
      const live = Math.min(rows.length, this.MAX_HANDS);
      let body = '<h2 class="modal-title">' + t('hands_title', '帮手', 'Hired hand') + '</h2>';

      if (!this.isUnlocked() && live === 0) {
        body += '<p class="modal-subtitle">' + t('hands_locked',
          '地还少，自己顾得过来。菜地到 12 块以后可以请帮手。',
          'The farm is still small enough to run on your own. A hired hand unlocks at 12 plots.') + '</p>';
        body += '<div class="btn-row"><button class="btn secondary" onclick="Farm.ui.hideModal()">'
          + t('btn_close', '关闭', 'Close') + '</button></div>';
        Farm.ui.showModal(body, { closeOnBackdrop: true });
        return;
      }

      const lookGrid = (selected, hireMode, slot) => {
        return '<div class="farmer-look-grid">'
          + looks.map((lk) => {
            const on = (Farm.farmer.clampLook(selected) === lk.id);
            const face = Farm.farmer.previewStyle ? Farm.farmer.previewStyle(lk.id) : '';
            return '<button type="button" class="farmer-look-btn' + (on ? ' is-on' : '') + '" data-look="' + lk.id + '"'
              + (hireMode ? ' data-hire="1"' : ' data-slot="' + slot + '"') + '>'
              + '<div class="farmer-look-face" style="' + face + '"></div>'
              + '<div class="farmer-look-name">' + (en ? lk.en : lk.zh) + '</div></button>';
          }).join('')
          + '</div>';
      };
      const lookName = (id) => {
        const lk = looks[Farm.farmer.clampLook(id) - 1];
        return lk ? (en ? lk.en : lk.zh) : '';
      };

      let anyPaid = false;
      for (let i = 0; i < live; i++) {
        if (rows[i].paidThroughDate === today()) anyPaid = true;
      }
      if (anyPaid) {
        body += '<p class="modal-subtitle">' + t('hands_paid_status',
          '帮手今天会跟你一起收菜、浇水、播种。点熟菜、点全收，或在打理里点浇水，大家一起去。',
          'The hired hand will harvest, water, and plant with you today. Tap ripe crops, Harvest all, or Water in plot care, and you go together.')
          + '</p>';
      }
      if (live > 0) {
        body += '<p class="hands-change-hint">' + t('hands_change_look',
          '点帮手的头像可以换样子。',
          'Tap a hired hand\'s portrait to change how they look.') + '</p>';
      }

      for (let i = 0; i < live; i++) {
        const paid = rows[i].paidThroughDate === today();
        const wage = this.wageOf(i);
        const face = Farm.farmer.previewStyle ? Farm.farmer.previewStyle(rows[i].look) : '';
        const open = this._lookOpen === i;
        body += '<div class="hands-person">';
        body += '<button type="button" class="hands-person-face' + (paid ? '' : ' is-dim') + (open ? ' is-on' : '')
          + '" data-hands-face="' + i + '" aria-label="' + lookName(rows[i].look) + '">'
          + '<div class="farmer-look-face" style="' + face + '"></div></button>';
        body += '<div class="hands-person-body">';
        body += '<div class="hands-person-name">' + lookName(rows[i].look) + '</div>';
        if (!paid) {
          body += '<p class="hands-person-hint">' + t('hands_unpaid',
            '今天的工钱还没付，这位帮手先歇着。',
            'Today\'s wage is unpaid, so this hired hand is sitting it out.') + '</p>';
          body += '<div class="btn-row"><button class="btn" data-hands-pay="' + i + '">'
            + t('hands_pay', '付今天工钱 · {n}', 'Pay today\'s wage · {n}').replace('{n}', String(wage))
            + '</button></div>';
        }
        body += '<div class="btn-row"' + (paid ? '' : ' style="margin-top:8px;"') + '>'
          + '<button class="btn secondary" data-hands-dismiss="' + i + '">'
          + t('hands_dismiss', '帮手先回去', 'Send home') + '</button></div>';
        if (open) body += '<div class="hands-person-look">' + lookGrid(rows[i].look, false, i) + '</div>';
        body += '</div></div>';
      }

      if (live === 0) {
        body += lookGrid(this._defaultLook(), true, 0);
        body += '<div class="btn-row"><button class="btn" id="handsHireBtn">'
          + t('hands_hire', '请帮手 · 180 农场币 / 天', 'Hire a hand · 180 farm coins a day')
          + '</button></div>';
      } else if (live < this.maxAllowed()) {
        body += '<p class="modal-subtitle">' + t('hands_hire_second_hint',
          '还可以再请一位。',
          'You can hire one more.') + '</p>';
        body += lookGrid(this._defaultLook(), true, live);
        body += '<div class="btn-row"><button class="btn" id="handsHireBtn">'
          + t('hands_hire_second', '再请一位 · 280 农场币 / 天', 'Hire a second hand · 280 farm coins a day')
          + '</button></div>';
      }

      Farm.ui.showModal(body, { closeOnBackdrop: true });

      let hireLook = this._defaultLook();
      document.querySelectorAll('.farmer-look-btn[data-hire]').forEach((btn) => {
        if (Farm.farmer.clampLook(hireLook) === (btn.getAttribute('data-look') | 0)) btn.classList.add('is-on');
        btn.onclick = () => {
          hireLook = btn.getAttribute('data-look') | 0;
          document.querySelectorAll('.farmer-look-btn[data-hire]').forEach((b) => b.classList.remove('is-on'));
          btn.classList.add('is-on');
          if (Farm.audio) Farm.audio.play('tap');
        };
      });
      document.querySelectorAll('.farmer-look-btn[data-slot]').forEach((btn) => {
        btn.onclick = () => {
          const slot = btn.getAttribute('data-slot') | 0;
          const id = btn.getAttribute('data-look') | 0;
          this.applyLook(slot, id);
          if (Farm.audio) Farm.audio.play('tap');
          this.openPanel();
        };
      });
      document.querySelectorAll('[data-hands-face]').forEach((btn) => {
        btn.onclick = () => {
          const slot = btn.getAttribute('data-hands-face') | 0;
          this._lookOpen = (this._lookOpen === slot) ? -1 : slot;
          if (Farm.audio) Farm.audio.play('tap');
          this.openPanel();
        };
      });
      const hireBtn = document.getElementById('handsHireBtn');
      if (hireBtn) hireBtn.onclick = () => {
        this._lookOpen = -1;
        if (this.hire(hireLook)) this.openPanel();
      };
      document.querySelectorAll('[data-hands-pay]').forEach((btn) => {
        btn.onclick = () => {
          if (this.pay(btn.getAttribute('data-hands-pay') | 0)) this.openPanel();
        };
      });
      document.querySelectorAll('[data-hands-dismiss]').forEach((btn) => {
        btn.onclick = () => this._confirmDismiss(btn.getAttribute('data-hands-dismiss') | 0);
      });
    },
    _confirmDismiss: function (slot) {
      const html = ''
        + '<h2 class="modal-title">' + t('hands_title', '帮手', 'Hired hand') + '</h2>'
        + '<p class="modal-subtitle">' + t('hands_dismiss_confirm',
          '帮手先回去？随时可以再请。',
          'Send the hired hand home? You can hire again any time.') + '</p>'
        + '<div class="btn-row">'
        + '<button class="btn" id="handsDismissNo">' + t('hands_dismiss_keep', '再想想', 'Keep them') + '</button>'
        + '<button class="btn secondary" id="handsDismissYes">' + t('hands_dismiss', '帮手先回去', 'Send home') + '</button>'
        + '</div>';
      Farm.ui.showModal(html, { closeOnBackdrop: true });
      const no = document.getElementById('handsDismissNo');
      if (no) no.onclick = () => this.openPanel();
      const yes = document.getElementById('handsDismissYes');
      if (yes) yes.onclick = () => {
        this.dismiss(slot);
        if (Farm.ui && Farm.ui.toast) {
          Farm.ui.toast(t('hands_dismiss_done',
            '帮手先回去了。随时可以再请。',
            'The hired hand has gone home. You can hire again any time.'), 2600);
        }
        this.openPanel();
      };
    },

    tick: function (iso, dt) {
      this.maybeSyncFromSave();
      this.collectWage();
      this.maybePromptUnlock();
      if (!iso) return;
      const n = Math.min(this.actors.length, this.MAX_HANDS);
      for (let i = 0; i < n; i++) {
        const actor = this.actors[i];
        if (!actor) continue;
        if (actor.gx == null) this._spawn(iso, actor, i);
        const paid = this.canWork(i);
        const k = actor.job && actor.job.kind;
        actor._handDim = !paid && k !== 'harvest' && k !== 'water' && k !== 'plant';
        if (Farm.farmer && Farm.farmer.tickActor) {
          Farm.farmer.tickActor(iso, actor, handOpts(paid), dt);
        }
      }
    },
    depthDraws: function (iso) {
      if (Farm.state && Farm.state._visitLock) return [];
      const out = [];
      if (!Farm.farmer || !Farm.farmer.depthDrawActor) return out;
      for (let i = 0; i < this.actors.length; i++) {
        const d = Farm.farmer.depthDrawActor(iso, this.actors[i]);
        if (d) out.push(d);
      }
      return out;
    },
    actorAtPoint: function (iso, x, y) {
      if (!iso || (Farm.state && Farm.state._visitLock)) return -1;
      const th = iso._th();
      const hw = th * 0.35, hh = th * 1.2;
      for (let i = this.actors.length - 1; i >= 0; i--) {
        const a = this.actors[i];
        if (!a || a.gx == null) continue;
        const c = iso._cell(a.gx, a.gy);
        if (Math.abs(x - c.x) <= hw && y <= c.y + th * 0.25 && y >= c.y - hh) return i;
      }
      return -1;
    },

    onEnterVisit: function () {
      this._visitHold = { actors: this.actors, board: this.board };
      this.actors = [];
      this.board = [];
    },
    onExitVisit: function () {
      const h = this._visitHold;
      this._visitHold = null;
      if (h) {
        this.actors = h.actors || [];
        this.board = h.board || [];
      }
      if (Farm.state && !Farm.state._visitLock) this.maybeSyncFromSave();
    },
  };

  Farm.hands = hands;
})();
