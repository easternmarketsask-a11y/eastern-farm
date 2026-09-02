/**
 * feedback.js — 意见反馈（Farm.feedback）
 *
 * 菜单入口。提交到 StockWise /api/public/farm-feedback：
 *   当天第一次成功提交 → 服务器允许后按后台规则发农场币
 *   当天再交仍送到店主，不再发币
 *   提交当时把服务器回的 reply 做成东超来信；登录玩家同一封还写在
 *   members/{uid}.gameStats.farmMail，下次打开再弹（看过的不重复）。
 * 赠送数字以后台「游戏管理 → 赠送规则」为准；服务器没收下就不发币。
 * 自动回信不是采纳，不发超市积分。
 */
(function () {
  const STOCKWISE_BASE = 'https://stockwise-app-873982544406.us-central1.run.app';
  const MIN_CHARS = 8;
  const MAX_CHARS = 800;
  const DEVICE_KEY = 'ef_feedback_device';
  const LOCAL_REWARD_DAY_KEY = 'ef_feedback_rewarded_day';
  const SHOWN_KEY = 'ef_farm_mail_shown';
  const WAREHOUSE_KEYS = ['仓满', '仓库满', '谷仓满', '卖不了', '卖不掉', '卖不出去', '收不了', '不让收', '地不让收', '满了但是卖', '满了但卖'];
  const WAREHOUSE_KEYS_EN = ['barn is full', 'barn full', 'warehouse full', 'warehouse is full', "can't harvest", 'cannot harvest', "can't sell", 'cannot sell', 'cant harvest', 'cant sell'];
  const STUCK_KEYS = ['卖不', '收不', '订单', '谷仓', '仓库', '交货', '满了'];
  const STUCK_KEYS_EN = ['order', 'harvest', 'sell', 'barn', 'warehouse', 'full'];

  let cachedCfg = { coinReward: 300, adoptEp: 500 };
  let _mailTimer = null;
  /* 与 stockwise_final/farm_feedback_replies.py LETTERS 同步。
     新服务端会在提交响应里带 reply；旧服务端没有时用这一份当场回。 */
  const LETTERS = {
    warehouse_full: {
      topic: 'warehouse_full',
      title_zh: '谷仓满了',
      title_en: 'Barn is full',
      zh: '谷仓满了以后地里确实收不了，菜要先从谷仓交出去。\n\n请点农场里东超的告示牌，或者点谷仓，再选「看东超要什么」。上面「每日补货」里，有一样会是你谷仓里最多的菜，有货就可以直接交，交完谷仓就会空出位置。\n\n如果已经接满 3 单又交不出去，把交不出的那几单放弃即可，不扣钱。然后再接谷仓里对得上的那一单。\n\n另外打开谷仓可以扩建，扩建之后就能继续收。',
      en: 'When the barn is full, the plots will not let you harvest. Crops have to leave the barn first.\n\nPlease open the Eastern Market board on your farm, or open the barn and tap “See what Eastern Market needs.” Daily restock always includes the crop you have most of. Hand that over and the barn will have room again.\n\nIf you already took 3 orders you cannot fill, drop those orders — there is no penalty — then take the one that matches what is already in the barn.\n\nYou can also expand the barn from the barn panel, then keep harvesting.',
      cta: 'orders',
    },
    ack: {
      topic: 'ack',
      title_zh: '意见收到',
      title_en: 'Note received',
      zh: '收到了，店主会看。\n\n如果是谷仓满了收不了菜：请点东超的告示牌，交谷仓里已经有的菜。接满 3 单交不出的可以放弃，不扣钱。也可以打开谷仓扩建。',
      en: 'Got it — Chris will read this.\n\nIf the barn is full and you cannot harvest: open the Eastern Market board and hand over crops already in the barn. Orders you cannot fill can be dropped with no penalty. You can also expand the barn.',
      cta: '',
    },
  };

  function localReply(topic, id) {
    const L = LETTERS[topic] || LETTERS.ack;
    return {
      id: id || ('local_' + L.topic),
      topic: L.topic,
      title_zh: L.title_zh,
      title_en: L.title_en,
      zh: L.zh,
      en: L.en,
      cta: L.cta || '',
    };
  }

  function lang() {
    return (Farm.state && Farm.state.data && Farm.state.data.language) || 'zh';
  }
  function en() { return lang() === 'en'; }

  function saskDay() {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Regina' });
    } catch (_) {
      return new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
    }
  }

  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (id && /^[A-Za-z0-9_-]{8,80}$/.test(id)) return id;
      id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
      return id;
    } catch (_) {
      return 'd' + String(Date.now());
    }
  }

  function alreadyRewardedLocally() {
    try { return localStorage.getItem(LOCAL_REWARD_DAY_KEY) === saskDay(); }
    catch (_) { return false; }
  }

  function markRewardedLocally() {
    try { localStorage.setItem(LOCAL_REWARD_DAY_KEY, saskDay()); } catch (_) {}
  }

  function escapeHtml(s) {
    if (Farm.ui && Farm.ui.escapeHtml) return Farm.ui.escapeHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function warehouseFullNow() {
    try {
      return !!(Farm.state && Farm.state.isWarehouseFull && Farm.state.isWarehouseFull());
    } catch (_) { return false; }
  }

  function matchTopic(text, warehouseFull) {
    const blob = String(text || '');
    const low = blob.toLowerCase();
    if (WAREHOUSE_KEYS.some(function (k) { return blob.indexOf(k) >= 0; })) return 'warehouse_full';
    if (WAREHOUSE_KEYS_EN.some(function (k) { return low.indexOf(k) >= 0; })) return 'warehouse_full';
    if (warehouseFull) {
      if (STUCK_KEYS.some(function (k) { return blob.indexOf(k) >= 0; })) return 'warehouse_full';
      if (STUCK_KEYS_EN.some(function (k) { return low.indexOf(k) >= 0; })) return 'warehouse_full';
    }
    return 'ack';
  }

  function shownSet() {
    try {
      const raw = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw : []);
    } catch (_) { return new Set(); }
  }
  function markShown(id) {
    if (!id) return;
    const s = shownSet();
    s.add(String(id));
    try { localStorage.setItem(SHOWN_KEY, JSON.stringify(Array.from(s).slice(-40))); } catch (_) {}
  }
  function wasShown(id) { return !!(id && shownSet().has(String(id))); }

  async function markReadCloud(id) {
    if (!id || !Farm.fb || !Farm.fb.available) return;
    if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn || !Farm.fbAuth.isLoggedIn()) return;
    const uid = Farm.fbAuth.memberDocId ? Farm.fbAuth.memberDocId() : '';
    if (!uid) return;
    try {
      const patch = {};
      patch[id] = { read: true };
      await Farm.fb.db.collection('members').doc(uid).set(
        { gameStats: { farmMail: patch } },
        { merge: true }
      );
    } catch (e) { console.warn('[feedback] markRead failed', e); }
  }

  function showReply(reply, coins, fromSubmit) {
    if (!reply || !(reply.zh || reply.en) || !(Farm.ui && Farm.ui.showModal)) return false;
    markShown(reply.id);
    markReadCloud(reply.id);
    const isEn = en();
    const title = isEn ? (reply.title_en || 'Note received') : (reply.title_zh || '意见收到');
    const raw = isEn ? (reply.en || reply.zh || '') : (reply.zh || reply.en || '');
    const body = escapeHtml(raw).replace(/\n/g, '<br>');
    const coinN = Math.max(0, parseInt(coins, 10) || 0);
    const coinLine = coinN > 0
      ? '<div class="fbk-mail-coins">+' + coinN + (isEn ? ' farm coins' : ' 农场币') + '</div>'
      : '';
    const cta = reply.cta === 'orders'
      ? '<button class="btn" id="fbkMailCta" style="width:100%;margin-top:14px;">' + (isEn ? 'See orders' : '去看订单') + '</button>'
      : '';
    Farm.ui.showModal(
      '<div class="ls-letter">'
      + '<div class="ls-letter-stamp">📬</div>'
      + '<div class="ls-letter-eyebrow">' + (isEn ? 'A note from Eastern Market' : '东超的回信') + '</div>'
      + '<h2 class="ls-letter-title">' + escapeHtml(title) + '</h2>'
      + '<div class="ls-letter-body">' + body + '</div>'
      + coinLine
      + cta
      + '<button class="btn' + (cta ? ' secondary' : '') + '" id="fbkMailOk" style="width:100%;margin-top:8px;">'
      + (isEn ? 'Got it' : '知道了') + '</button>'
      + '</div>',
      {
        onShow: function () {
          const go = document.getElementById('fbkMailCta');
          if (go) go.onclick = function () {
            Farm.ui.hideModal();
            if (Farm.orders && Farm.orders.open) Farm.orders.open();
          };
          const ok = document.getElementById('fbkMailOk');
          if (ok) ok.onclick = function () { Farm.ui.hideModal(); };
          setTimeout(maybeShowMail, 500);
        }
      }
    );
    if (fromSubmit) {
      if (Farm.audio && Farm.audio.play) Farm.audio.play('buy');
    } else if (Farm.audio && Farm.audio.play) {
      Farm.audio.play('tap');
    }
    return true;
  }

  async function pullUnread() {
    if (!Farm.fb || !Farm.fb.available) return [];
    if (!Farm.fbAuth || !Farm.fbAuth.isLoggedIn || !Farm.fbAuth.isLoggedIn()) return [];
    const uid = Farm.fbAuth.memberDocId ? Farm.fbAuth.memberDocId() : '';
    if (!uid) return [];
    try {
      const snap = await Farm.fb.db.collection('members').doc(uid).get();
      if (!snap.exists) return [];
      const map = ((snap.data() || {}).gameStats || {}).farmMail || {};
      return Object.keys(map).map(function (k) {
        const m = map[k] || {};
        return {
          id: m.id || k,
          topic: m.topic || 'ack',
          title_zh: m.title_zh || '',
          title_en: m.title_en || '',
          zh: m.zh || '',
          en: m.en || '',
          cta: m.cta || '',
          at: m.at || 0,
          read: !!m.read,
        };
      }).filter(function (m) {
        return !!(m.zh || m.en) && !m.read && !wasShown(m.id);
      }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    } catch (e) {
      console.warn('[feedback] pullMail failed', e);
      return [];
    }
  }

  function maybeShowMail() {
    if (_mailTimer) return;
    const tick = async function () {
      if (Farm.ui && Farm.ui.isBusy && Farm.ui.isBusy()) {
        _mailTimer = setTimeout(tick, 1600);
        return;
      }
      _mailTimer = null;
      const list = await pullUnread();
      if (!list.length) return;
      if (Farm.ui && Farm.ui.isBusy && Farm.ui.isBusy()) {
        maybeShowMail();
        return;
      }
      showReply(list[0], 0);
    };
    _mailTimer = setTimeout(tick, 2400);
  }

  function buildMeta() {
    const meta = document.querySelector('meta[name="ef-build"]');
    return (meta && meta.getAttribute('content')) || '';
  }

  function nCoins() { return Math.max(0, parseInt(cachedCfg.coinReward, 10) || 0); }
  function nEp() { return Math.max(0, parseInt(cachedCfg.adoptEp, 10) || 0); }

  async function loadCfg() {
    try {
      const res = await fetch(STOCKWISE_BASE + '/api/public/farm-feedback-config');
      const d = await res.json();
      if (d && d.ok) {
        cachedCfg = {
          coinReward: Math.max(0, parseInt(d.coinReward, 10) || 0),
          adoptEp: Math.max(0, parseInt(d.adoptEp, 10) || 0),
        };
      }
    } catch (_) { /* 用上次缓存或缺省，不挡开窗 */ }
    return cachedCfg;
  }

  function blurb(rewarded) {
    const c = nCoins();
    const p = nEp();
    if (rewarded) {
      if (en()) return c > 0
        ? 'You already collected today\'s ' + c + ' coins. Send another note anyway — Chris still reads it.'
        : 'You already sent one today. Another note still reaches Chris.';
      return c > 0
        ? '今天的 ' + c + ' 农场币已经领过了。还可以再写，店主照样会看到。'
        : '今天交过了。还可以再写，店主照样会看到。';
    }
    if (c > 0 && p > 0) {
      return en()
        ? 'Submit feedback and get <b>' + c + ' farm coins</b> right away. If we adopt it, you get <b>' + p + ' store points</b>.'
        : '提交反馈立刻得' + c + '农场币。如意见被采纳，奖励' + p + '超市积分。';
    }
    if (c > 0) {
      return en()
        ? 'Submit feedback and get <b>' + c + ' farm coins</b> right away.'
        : '提交反馈立刻得' + c + '农场币。';
    }
    if (p > 0) {
      return en()
        ? 'If we adopt your note, you get <b>' + p + ' store points</b>.'
        : '如意见被采纳，奖励' + p + '超市积分。';
    }
    return en()
      ? 'A bug, a wish, or anything that felt off — Chris reads every note.'
      : '哪里卡、看不懂、不好玩，写下来。店主每条都会看。';
  }

  function submitLabel(rewarded) {
    const c = nCoins();
    if (rewarded || c <= 0) return en() ? 'Send to the store' : '提交给店主';
    return en() ? ('Send and get ' + c + ' coins') : ('提交并领取 ' + c + ' 农场币');
  }

  function open() {
    loadCfg().then(function () { render(); }).catch(function () { render(); });
  }

  function render() {
    const rewarded = alreadyRewardedLocally();
    const title = en() ? 'Send feedback' : '意见反馈';
    const ph = en()
      ? 'A bug, a wish, or anything that felt off…'
      : '遇到的问题、想要的功能、哪里不好玩……随便写';
    const html =
      '<h2 class="modal-title">' + title + '</h2>' +
      '<p class="modal-subtitle">' + blurb(rewarded) + '</p>' +
      '<div class="fbk-cats" role="tablist">' +
        '<button type="button" class="fbk-cat active" data-cat="bug">' + (en() ? 'A problem' : '遇到问题') + '</button>' +
        '<button type="button" class="fbk-cat" data-cat="idea">' + (en() ? 'An idea' : '我有想法') + '</button>' +
        '<button type="button" class="fbk-cat" data-cat="other">' + (en() ? 'Other' : '其他') + '</button>' +
      '</div>' +
      '<textarea id="fbkText" class="fbk-text" maxlength="' + MAX_CHARS + '" rows="5" placeholder="' + escapeHtml(ph) + '"></textarea>' +
      '<div class="fbk-meta"><span id="fbkCount">0 / ' + MAX_CHARS + '</span><span id="fbkHint"></span></div>' +
      '<div class="btn-row"><button class="btn" id="fbkSubmit">' + submitLabel(rewarded) + '</button></div>';

    Farm.ui.showModal(html, {
      onShow: function () {
        let category = 'bug';
        const box = document.getElementById('fbkText');
        const count = document.getElementById('fbkCount');
        const hint = document.getElementById('fbkHint');
        const submit = document.getElementById('fbkSubmit');
        document.querySelectorAll('#modalContent .fbk-cat').forEach(function (btn) {
          btn.onclick = function () {
            if (Farm.audio) Farm.audio.play('tap');
            category = btn.getAttribute('data-cat') || 'bug';
            document.querySelectorAll('#modalContent .fbk-cat').forEach(function (b) {
              b.classList.toggle('active', b === btn);
            });
          };
        });
        function syncCount() {
          const n = (box && box.value || '').trim().length;
          if (count) count.textContent = n + ' / ' + MAX_CHARS;
          if (hint) {
            hint.textContent = n > 0 && n < MIN_CHARS
              ? (en() ? ('Need ' + (MIN_CHARS - n) + ' more characters') : ('再写 ' + (MIN_CHARS - n) + ' 个字'))
              : '';
          }
        }
        if (box) {
          box.addEventListener('input', syncCount);
          setTimeout(function () { try { box.focus(); } catch (_) {} }, 80);
        }
        if (submit) submit.onclick = function () { send(category, box, submit); };
      }
    });
  }

  async function send(category, box, submit) {
    const text = ((box && box.value) || '').trim();
    if (text.length < MIN_CHARS) {
      if (Farm.ui) Farm.ui.toast(en()
        ? 'A bit more detail, please (' + MIN_CHARS + '+ characters)'
        : '再写几个字吧（至少 ' + MIN_CHARS + ' 个字）', 2200);
      return;
    }
    if (submit) {
      submit.disabled = true;
      submit.textContent = en() ? 'Sending…' : '正在提交…';
    }
    const memberId = (Farm.fbAuth && Farm.fbAuth.memberDocId) ? (Farm.fbAuth.memberDocId() || '') : '';
    const full = warehouseFullNow();
    const hint = matchTopic(text, full);
    const body = {
      text: text,
      category: category || 'other',
      memberId: memberId || undefined,
      nickname: (Farm.state && Farm.state.data && Farm.state.data.nickname) || '',
      deviceId: deviceId(),
      farmLevel: (Farm.state && Farm.state.data && Farm.state.data.level) || 1,
      build: buildMeta(),
      warehouseFull: !!full,
      topicHint: hint === 'warehouse_full' ? 'warehouse_full' : undefined,
    };
    let data = null;
    try {
      const res = await fetch(STOCKWISE_BASE + '/api/public/farm-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res.ok || !data || !data.ok) {
        const reason = (data && (data.reason || data.detail)) || '';
        if (reason === 'rate_limited') {
          if (Farm.ui) Farm.ui.toast(en() ? 'Daily limit reached' : '今日提交次数已满', 2600);
        } else {
          if (Farm.ui) Farm.ui.toast(en()
            ? 'Could not reach the store. Try again in a minute.'
            : '没送到店主那边，请稍后再试。', 2800);
        }
        if (submit) {
          submit.disabled = false;
          submit.textContent = submitLabel(alreadyRewardedLocally());
        }
        return;
      }
    } catch (_) {
      if (Farm.ui) Farm.ui.toast(en()
        ? 'Could not reach the store. Try again in a minute.'
        : '没送到店主那边，请稍后再试。', 2800);
      if (submit) {
        submit.disabled = false;
        submit.textContent = submitLabel(alreadyRewardedLocally());
      }
      return;
    }

    const coins = Math.max(0, parseInt(data.coins, 10) || 0);
    if (data.rewarded && coins > 0 && Farm.state && Farm.state.addCoins) {
      Farm.state.addCoins(coins);
      markRewardedLocally();
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
    }
    const reply = (data.reply && (data.reply.zh || data.reply.en))
      ? data.reply
      : localReply(matchTopic(text, full), data.id ? ('fb_' + data.id) : '');
    if (showReply(reply, data.rewarded ? coins : 0, true)) {
      return;
    }
    if (Farm.audio && Farm.audio.play) Farm.audio.play('buy');
    if (data.rewarded && coins > 0) {
      if (Farm.ui) Farm.ui.toast(en()
        ? 'Thanks! +' + coins + ' farm coins. More notes today still reach Chris.'
        : '收到了！+' + coins + ' 农场币。今天再写也会送到，只是不再发币。', 3200);
    } else if (Farm.ui) {
      Farm.ui.toast(en()
        ? 'Got it — Chris will read this.'
        : '收到了，店主会看到。', 2400);
    }
    if (Farm.ui) Farm.ui.hideModal();
  }

  window.Farm = window.Farm || {};
  Farm.feedback = {
    open: open,
    matchTopic: matchTopic,
    maybeShowMail: maybeShowMail,
    showReply: showReply,
  };
  loadCfg();
})();
