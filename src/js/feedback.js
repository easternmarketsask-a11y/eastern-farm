/**
 * feedback.js — 意见反馈（Farm.feedback）
 *
 * 菜单入口。提交到 StockWise /api/public/farm-feedback：
 *   当天第一次成功提交 → 服务器允许后按后台规则发农场币
 *   当天再交仍送到店主，不再发币
 * 赠送数字以后台「游戏管理 → 赠送规则」为准；服务器没收下就不发币。
 */
(function () {
  const STOCKWISE_BASE = 'https://stockwise-app-873982544406.us-central1.run.app';
  const MIN_CHARS = 8;
  const MAX_CHARS = 800;
  const DEVICE_KEY = 'ef_feedback_device';
  const LOCAL_REWARD_DAY_KEY = 'ef_feedback_rewarded_day';

  let cachedCfg = { coinReward: 500, adoptEp: 500 };

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
    const bits = [];
    if (c > 0) bits.push(en()
      ? 'First note today gets <b>' + c + ' farm coins</b> right away.'
      : '今天第一次提交立刻送 <b>' + c + ' 农场币</b>。');
    if (p > 0) bits.push(en()
      ? 'If Chris adopts it, you also get <b>' + p + ' store points</b>.'
      : '写得有用、店主采纳后，再奖 <b>' + p + ' 超市积分</b>。');
    if (!bits.length) {
      return en()
        ? 'A bug, a wish, or anything that felt off — Chris reads every note.'
        : '哪里卡、看不懂、不好玩，写下来。店主每条都会看。';
    }
    return bits.join(en() ? ' ' : '');
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
      if (Farm.ui) Farm.ui.toast(en()
        ? 'Thanks! +' + coins + ' farm coins. More notes today still reach Chris.'
        : '收到了！+' + coins + ' 农场币。今天再写也会送到，只是不再发币。', 3200);
    } else {
      if (Farm.ui) Farm.ui.toast(en()
        ? 'Got it — Chris will read this.'
        : '收到了，店主会看到。', 2400);
    }
    if (Farm.audio && Farm.audio.play) Farm.audio.play('buy');
    if (Farm.ui) Farm.ui.hideModal();
  }

  window.Farm = window.Farm || {};
  Farm.feedback = { open: open };
  loadCfg();
})();
