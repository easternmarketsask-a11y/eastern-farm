/**
 * feedback.js — 意见反馈（Farm.feedback）
 *
 * 菜单入口。提交到 StockWise /api/public/farm-feedback：
 *   当天第一次成功提交 → 服务器允许后本地 +500 农场币
 *   当天再交仍送到店主，不再发币
 * 服务器没收下就不发币（避免「领了币、店主看不见」）。
 */
(function () {
  const STOCKWISE_BASE = 'https://stockwise-app-873982544406.us-central1.run.app';
  const COIN_REWARD = 500;
  const MIN_CHARS = 8;
  const MAX_CHARS = 800;
  const DEVICE_KEY = 'ef_feedback_device';
  const LOCAL_REWARD_DAY_KEY = 'ef_feedback_rewarded_day';

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
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildMeta() {
    const meta = document.querySelector('meta[name="ef-build"]');
    return (meta && meta.getAttribute('content')) || '';
  }

  function open() {
    const rewarded = alreadyRewardedLocally();
    const title = en() ? 'Send feedback' : '意见反馈';
    const blurb = rewarded
      ? (en()
        ? 'You already collected today\'s 500 coins. Send another note anyway — Chris still reads it.'
        : '今天的 500 农场币已经领过了。还可以再写，店主照样会看到。')
      : (en()
        ? 'First note today gets <b>500 farm coins</b> right away. If Chris adopts it, you also get <b>500 store points</b>.'
        : '今天第一次提交立刻送 <b>500 农场币</b>。写得有用、店主采纳后，再奖 <b>500 超市积分</b>。');
    const ph = en()
      ? 'A bug, a wish, or anything that felt off…'
      : '遇到的问题、想要的功能、哪里不好玩……随便写';
    const submitLabel = rewarded
      ? (en() ? 'Send to the store' : '提交给店主')
      : (en() ? 'Send and get 500 coins' : '提交并领取 500 农场币');
    const html =
      '<h2 class="modal-title">' + title + '</h2>' +
      '<p class="modal-subtitle">' + blurb + '</p>' +
      '<div class="fbk-cats" role="tablist">' +
        '<button type="button" class="fbk-cat active" data-cat="bug">' + (en() ? 'A problem' : '遇到问题') + '</button>' +
        '<button type="button" class="fbk-cat" data-cat="idea">' + (en() ? 'An idea' : '我有想法') + '</button>' +
        '<button type="button" class="fbk-cat" data-cat="other">' + (en() ? 'Other' : '其他') + '</button>' +
      '</div>' +
      '<textarea id="fbkText" class="fbk-text" maxlength="' + MAX_CHARS + '" rows="5" placeholder="' + escapeHtml(ph) + '"></textarea>' +
      '<div class="fbk-meta"><span id="fbkCount">0 / ' + MAX_CHARS + '</span><span id="fbkHint"></span></div>' +
      '<div class="btn-row"><button class="btn" id="fbkSubmit">' + submitLabel + '</button></div>';

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
    const body = {
      text: text,
      category: category || 'other',
      memberId: memberId || undefined,
      nickname: (Farm.state && Farm.state.data && Farm.state.data.nickname) || '',
      deviceId: deviceId(),
      farmLevel: (Farm.state && Farm.state.data && Farm.state.data.level) || 1,
      build: buildMeta(),
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
          if (Farm.ui) Farm.ui.toast(en() ? 'Too many notes today — try tomorrow' : '今天交得有点多，明天再写吧', 2600);
        } else {
          if (Farm.ui) Farm.ui.toast(en()
            ? 'Could not reach the store. Try again in a minute.'
            : '没送到店主那边，请稍后再试。', 2800);
        }
        if (submit) {
          submit.disabled = false;
          submit.textContent = alreadyRewardedLocally()
            ? (en() ? 'Send to the store' : '提交给店主')
            : (en() ? 'Send and get 500 coins' : '提交并领取 500 农场币');
        }
        return;
      }
    } catch (_) {
      if (Farm.ui) Farm.ui.toast(en()
        ? 'Could not reach the store. Try again in a minute.'
        : '没送到店主那边，请稍后再试。', 2800);
      if (submit) {
        submit.disabled = false;
        submit.textContent = alreadyRewardedLocally()
          ? (en() ? 'Send to the store' : '提交给店主')
          : (en() ? 'Send and get 500 coins' : '提交并领取 500 农场币');
      }
      return;
    }

    if (data.rewarded && Farm.state && Farm.state.addCoins) {
      Farm.state.addCoins(COIN_REWARD);
      markRewardedLocally();
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      if (Farm.ui) Farm.ui.toast(en()
        ? 'Thanks! +' + COIN_REWARD + ' farm coins. More notes today still reach Chris.'
        : '收到了！+' + COIN_REWARD + ' 农场币。今天再写也会送到，只是不再发币。', 3200);
    } else {
      if (Farm.ui) Farm.ui.toast(en()
        ? 'Got it — Chris will read this.'
        : '收到了，店主会看到。', 2400);
    }
    if (Farm.audio && Farm.audio.play) Farm.audio.play('buy');
    if (Farm.ui) Farm.ui.hideModal();
  }

  window.Farm = window.Farm || {};
  Farm.feedback = { open: open, COIN_REWARD: COIN_REWARD };
})();
