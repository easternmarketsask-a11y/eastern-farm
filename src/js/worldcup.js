/* ============================================================
   Eastern Farm — 2026 世界杯观赛台 (World Cup Viewing Hub)
   Phase 1: read-only. Pure front-end. Reads data/wc2026.json.
   No farm coins, no Eastern Points, no backend. Self-contained
   under Farm.worldcup so the whole module deletes cleanly in July.
   All kickoff times are stored UTC, rendered Saskatchewan (UTC-6, no DST).
   ============================================================ */
(function () {
  'use strict';

  var SK_OFFSET = -6;                       // hours, no DST
  var PREFS_KEY = 'wc2026_prefs_v1';
  var DATA_URL = '../data/wc2026.json';

  // Approximate strength order (1 = strongest) for upset detection only.
  // Flavor, not official — used to flag "冷门" when a much lower side wins.
  var RANK = {
    ARG:1,FRA:2,ESP:3,ENG:4,BRA:5,POR:6,NED:7,BEL:8,GER:9,CRO:10,
    MAR:11,COL:12,URU:13,USA:14,MEX:15,SUI:16,JPN:17,SEN:18,KOR:19,IRN:20,
    AUS:21,ECU:22,AUT:23,SWE:24,NOR:25,EGY:26,CIV:27,QAT:28,KSA:29,PAR:30,
    TUR:31,SCO:32,CAN:33,RSA:34,GHA:35,ALG:36,PAN:37,IRQ:38,JOR:39,UZB:40,
    BIH:41,CZE:42,NZL:43,CPV:44,HAI:45,CUW:46,COD:47,TUN:48
  };

  var data = null;            // loaded wc2026.json
  var T = {};                 // code -> team object
  var prefs = loadPrefs();
  var revealed = new Set(prefs.revealed || []);
  var myTeams = new Set(prefs.myTeams || []);
  var bracketPicks = prefs.bracket || {};
  var spoilerMode = prefs.spoilerMode || 'hidden';   // 'hidden' | 'shown'

  var hub = null;             // overlay element
  var activeTab = 'schedule';
  var rendered = {};
  var clockTimer = null, refreshTimer = null;
  var reentryBtn = null, reentryPoll = null;

  /* ---------------------- prefs ---------------------- */
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function savePrefs() {
    prefs.revealed = Array.from(revealed);
    prefs.myTeams = Array.from(myTeams);
    prefs.bracket = bracketPicks;
    prefs.spoilerMode = spoilerMode;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  /* ---------------------- helpers ---------------------- */
  function esc(s) {
    if (Farm && Farm.ui && Farm.ui.escapeHtml) return Farm.ui.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }
  function isTeam(code) { return !!T[code]; }
  function flag(code) { return isTeam(code) ? T[code].flag : ''; }
  function cn(code) { return isTeam(code) ? T[code].cn : placeholderLabel(code); }
  function en(code) { return isTeam(code) ? T[code].name : ''; }

  // Friendly CN label for knockout placeholders like "1A","2B","3CDFGH","W73","L-SF1".
  function placeholderLabel(code) {
    if (!code) return '待定';
    var m;
    if ((m = /^([1-3])([A-L])$/.exec(code))) return m[2] + '组第' + m[1];
    if ((m = /^3([A-L]{2,})$/.exec(code))) return m[1].split('').join('/') + ' 组第三';
    if ((m = /^W-?SF(\d+)$/.exec(code))) return '半决赛' + m[1] + ' 胜者';
    if ((m = /^L-?SF(\d+)$/.exec(code))) return '半决赛' + m[1] + ' 负者';
    if ((m = /^W(\d+)$/.exec(code))) return 'M' + m[1] + ' 胜者';
    if ((m = /^L(\d+)$/.exec(code))) return 'M' + m[1] + ' 负者';
    return code;
  }

  function skParts(iso) {
    var d = new Date(iso);
    var sk = new Date(d.getTime() + SK_OFFSET * 3600 * 1000);
    var days = ['周日','周一','周二','周三','周四','周五','周六'];
    return {
      dayKey: sk.toISOString().slice(0, 10),
      dayLabel: (sk.getUTCMonth() + 1) + '月' + sk.getUTCDate() + '日 ' + days[sk.getUTCDay()],
      time: pad(sk.getUTCHours()) + ':' + pad(sk.getUTCMinutes()),
      hour: sk.getUTCHours()
    };
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function nowSkDayKey() { return skParts(new Date().toISOString()).dayKey; }

  function matchState(m) {
    // returns 'done' | 'live' | 'upcoming'
    if (m.officialFinal && m.officialScore) return 'done';
    var k = new Date(m.kickoffUtc).getTime();
    var now = Date.now();
    if (m.apiStatus === 'LIVE') return 'live';
    if (now >= k && now <= k + 115 * 60000 && !(m.officialFinal && m.officialScore)) return 'live';
    if (now < k) return 'upcoming';
    return m.officialScore ? 'done' : 'upcoming';   // past kickoff but no score -> treat as upcoming/awaiting
  }
  function score(m) { return m.officialScore || m.apiScore || null; }

  function fmtCountdown(ms) {
    if (ms <= 0) return null;
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var mi = Math.floor(s / 60); s -= mi * 60;
    return { d: d, h: h, m: mi, s: s };
  }

  /* ---------------------- data load ---------------------- */
  function ensureData() {
    if (data) return Promise.resolve(data);
    return fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        data = j;
        (data.teams || []).forEach(function (t) { T[t.code] = t; });
        return data;
      });
  }

  /* ============================================================
     OVERLAY SHELL
     ============================================================ */
  function buildHub() {
    hub = document.createElement('div');
    hub.id = 'wc-hub';
    hub.innerHTML =
      '<div class="wc-topbar">' +
        '<div class="wc-brand"><img class="wc-emblem" src="assets/images/wc2026-logo.png" alt="FIFA World Cup 2026">' +
          '<div class="wc-brand-text"><div class="wc-brand-zh">萨省观赛台</div>' +
          '<div class="wc-brand-en">World Cup 26</div></div>' +
        '</div>' +
        '<div class="wc-clock" id="wcClock"><span class="t">--:--</span><span class="z">SK · UTC−6</span></div>' +
        '<button class="wc-close" id="wcClose" aria-label="关闭 Close">✕</button>' +
      '</div>' +
      '<div class="wc-tabs" role="tablist">' +
        tabBtn('schedule', '赛程赛果', 'SCHEDULE') +
        tabBtn('standings', '积分榜', 'STANDINGS') +
        tabBtn('bracket', '对阵图', 'BRACKET') +
      '</div>' +
      '<div class="wc-body">' +
        '<section id="wc-schedule"></section>' +
        '<section id="wc-standings" hidden></section>' +
        '<section id="wc-bracket" hidden></section>' +
      '</div>';
    document.body.appendChild(hub);

    hub.querySelector('#wcClose').onclick = close;
    Array.prototype.forEach.call(hub.querySelectorAll('.wc-tabs button'), function (b) {
      b.onclick = function () { switchTab(b.getAttribute('data-tab')); };
    });
  }

  function tabBtn(id, zh, enTxt) {
    return '<button role="tab" data-tab="' + id + '" aria-selected="' + (id === 'schedule') + '">' +
      '<span class="zh">' + zh + '</span><span class="en">' + enTxt + '</span></button>';
  }

  function switchTab(tab) {
    activeTab = tab;
    Array.prototype.forEach.call(hub.querySelectorAll('.wc-tabs button'), function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-tab') === tab);
    });
    ['schedule', 'standings', 'bracket'].forEach(function (k) {
      hub.querySelector('#wc-' + k).hidden = (k !== tab);
    });
    if (tab === 'schedule') renderSchedule();        // always fresh (live states)
    else if (tab === 'standings') { if (!rendered.standings) renderStandings(); rendered.standings = true; }
    else if (tab === 'bracket') renderBracket();      // re-render to reflect picks
    hub.querySelector('.wc-body').scrollTop = 0;
  }

  function open() {
    if (Farm.audio) Farm.audio.play('tap');
    ensureData().then(function () {
      if (!hub) buildHub();
      document.body.appendChild(hub);    // ensure on top
      hub.classList.remove('wc-closing');
      hub.style.display = 'flex';
      switchTab('schedule');
      startTimers();
      checkStreak();
    }).catch(function (e) {
      console.error('[wc] data load failed', e);
      if (Farm.ui) Farm.ui.toast('观赛台数据加载失败，请检查网络');
    });
  }

  function close() {
    if (!hub) return;
    if (Farm.audio) Farm.audio.play('tap');
    stopTimers();
    hub.classList.add('wc-closing');
    setTimeout(function () { if (hub) hub.style.display = 'none'; hub.classList.remove('wc-closing'); }, 240);
    updateReentry();
  }

  function startTimers() {
    stopTimers();
    tickClock();
    clockTimer = setInterval(tickClock, 1000);
    refreshTimer = setInterval(function () { if (activeTab === 'schedule') renderSchedule(); }, 60000);
  }
  function stopTimers() {
    if (clockTimer) clearInterval(clockTimer); clockTimer = null;
    if (refreshTimer) clearInterval(refreshTimer); refreshTimer = null;
  }
  function tickClock() {
    if (!hub) return;
    var sk = new Date(Date.now() + SK_OFFSET * 3600 * 1000);
    var el = hub.querySelector('#wcClock .t');
    if (el) el.textContent = pad(sk.getUTCHours()) + ':' + pad(sk.getUTCMinutes()) + ':' + pad(sk.getUTCSeconds());
    // live countdowns on focus + match rows
    updateCountdowns();
  }
  function updateCountdowns() {
    if (!hub) return;
    Array.prototype.forEach.call(hub.querySelectorAll('[data-kickoff]'), function (el) {
      var cd = fmtCountdown(new Date(el.getAttribute('data-kickoff')).getTime() - Date.now());
      if (!cd) { el.textContent = '即将开始'; return; }
      if (el.classList.contains('wc-countdown')) {
        el.innerHTML = cdCell(cd.d, '天') + cdCell(cd.h, '时') + cdCell(cd.m, '分') + cdCell(cd.s, '秒');
      } else {
        el.textContent = (cd.d > 0 ? cd.d + '天' : '') + pad(cd.h) + ':' + pad(cd.m) + ':' + pad(cd.s);
      }
    });
  }
  function cdCell(n, l) { return '<div class="wc-cd-cell"><div class="n">' + pad(n) + '</div><div class="l">' + l + '</div></div>'; }

  /* ============================================================
     SCHEDULE / RESULTS  (the centerpiece)
     ============================================================ */
  var schedFilters = { team: '', stage: '', quick: { today: false, upcoming: false, done: false, prime: false, mine: false } };

  function renderSchedule() {
    var root = hub.querySelector('#wc-schedule');
    var scrollSaved = hub.querySelector('.wc-body') ? hub.querySelector('.wc-body').scrollTop : 0;
    var stages = uniqueStages();

    var focus = pickFocusMatch();
    var html = focus ? focusCardHtml(focus) : '';

    html +=
      '<div class="wc-filters">' +
        '<input class="wc-search" id="wcSearch" placeholder="搜索球队 / search team…" value="' + esc(schedFilters.team) + '">' +
        '<select class="wc-select" id="wcStage"><option value="">全部阶段</option>' +
          stages.map(function (s) { return '<option' + (s === schedFilters.stage ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="wc-chips">' +
        chip('today', '今天') + chip('upcoming', '未开始') + chip('done', '已结束') +
        chip('prime', '🌙 黄金时段') +
        chipMine() +
        '<button class="wc-chip wc-spoiler-toggle" id="wcSpoiler">' +
          (spoilerMode === 'hidden' ? '🙈 比分隐藏中' : '👁 比分已显示') + '</button>' +
      '</div>' +
      '<div id="wcSchedList"></div>';

    root.innerHTML = html;
    wireFocus(root, focus);

    var search = root.querySelector('#wcSearch');
    var stage = root.querySelector('#wcStage');
    search.oninput = function () { schedFilters.team = search.value; drawList(); };
    stage.onchange = function () { schedFilters.stage = stage.value; drawList(); };
    Array.prototype.forEach.call(root.querySelectorAll('.wc-chip[data-q]'), function (c) {
      c.onclick = function () {
        var q = c.getAttribute('data-q');
        schedFilters.quick[q] = !schedFilters.quick[q];
        renderSchedule();
      };
    });
    var sp = root.querySelector('#wcSpoiler');
    sp.onclick = function () {
      spoilerMode = (spoilerMode === 'hidden') ? 'shown' : 'hidden';
      savePrefs();
      renderSchedule();
    };

    drawList();
    if (hub.querySelector('.wc-body')) hub.querySelector('.wc-body').scrollTop = scrollSaved;

    function drawList() {
      var listEl = root.querySelector('#wcSchedList');
      var rows = filterMatches().sort(function (a, b) {
        return new Date(a.kickoffUtc) - new Date(b.kickoffUtc);
      });
      // my-team matches float to the top of their own day
      if (!rows.length) { listEl.innerHTML = '<div class="wc-empty">没有符合条件的比赛 ⚽<br><span style="font-size:11px">试试取消几个筛选</span></div>'; return; }
      var out = '', lastDay = '';
      // group by day, within day sort mine-first
      var byDay = {};
      rows.forEach(function (m) { var k = skParts(m.kickoffUtc).dayKey; (byDay[k] = byDay[k] || []).push(m); });
      Object.keys(byDay).sort().forEach(function (dk) {
        var dayMatches = byDay[dk].sort(function (a, b) {
          var am = involvesMine(a) ? 0 : 1, bm = involvesMine(b) ? 0 : 1;
          return am - bm || new Date(a.kickoffUtc) - new Date(b.kickoffUtc);
        });
        out += '<div class="wc-day">' + skParts(dk).dayLabel + '<span class="cnt">' + dayMatches.length + ' 场</span></div>';
        dayMatches.forEach(function (m) { out += matchCardHtml(m); });
      });
      listEl.innerHTML = out;
      wireMatchCards(listEl);
      updateCountdowns();
    }
  }

  function uniqueStages() {
    var seen = [], set = {};
    (data.matches || []).forEach(function (m) { if (!set[m.round]) { set[m.round] = 1; seen.push(m.round); } });
    return seen;
  }
  function chip(q, label) {
    return '<button class="wc-chip" data-q="' + q + '" aria-pressed="' + !!schedFilters.quick[q] + '">' + label + '</button>';
  }
  function chipMine() {
    var n = myTeams.size;
    return '<button class="wc-chip wc-chip-mine" data-q="mine" aria-pressed="' + !!schedFilters.quick.mine + '">⭐ 我的球队' + (n ? ' (' + n + ')' : '') + '</button>';
  }
  function involvesMine(m) { return myTeams.has(m.home) || myTeams.has(m.away); }

  function filterMatches() {
    var q = schedFilters.team.trim().toLowerCase(), st = schedFilters.stage, Q = schedFilters.quick;
    var anyQuick = Q.today || Q.upcoming || Q.done || Q.prime || Q.mine;
    return (data.matches || []).filter(function (m) {
      if (st && m.round !== st) return false;
      if (q) {
        var hay = (cn(m.home) + cn(m.away) + en(m.home) + en(m.away) + m.home + m.away).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      if (!anyQuick) return true;
      var p = skParts(m.kickoffUtc), state = matchState(m);
      if (Q.today && p.dayKey !== nowSkDayKey()) return false;
      if (Q.upcoming && state === 'done') return false;
      if (Q.done && state !== 'done') return false;
      if (Q.prime && !(p.hour >= 17 && p.hour <= 23)) return false;
      if (Q.mine && !involvesMine(m)) return false;
      return true;
    });
  }

  /* ----- focus match ----- */
  function pickFocusMatch() {
    var ms = (data.matches || []).slice();
    var now = Date.now();
    // 1. a live match (prefer mine)
    var live = ms.filter(function (m) { return matchState(m) === 'live'; })
                 .sort(function (a, b) { return (involvesMine(b) - involvesMine(a)); });
    if (live.length) return live[0];
    // 2. next upcoming today, prefer mine, then chronological
    var upcoming = ms.filter(function (m) { return matchState(m) === 'upcoming' && new Date(m.kickoffUtc).getTime() >= now; })
                     .sort(function (a, b) { return new Date(a.kickoffUtc) - new Date(b.kickoffUtc); });
    var todayMine = upcoming.filter(function (m) { return involvesMine(m) && skParts(m.kickoffUtc).dayKey === nowSkDayKey(); });
    if (todayMine.length) return todayMine[0];
    var anyMine = upcoming.filter(involvesMine);
    if (anyMine.length) return anyMine[0];
    if (upcoming.length) return upcoming[0];
    // 3. most recent finished (tournament tail) -> review
    var done = ms.filter(function (m) { return matchState(m) === 'done'; })
                 .sort(function (a, b) { return new Date(b.kickoffUtc) - new Date(a.kickoffUtc); });
    return done[0] || null;
  }

  function focusCardHtml(m) {
    var state = matchState(m), p = skParts(m.kickoffUtc), s = score(m);
    var mineTag = involvesMine(m) ? '<span class="wc-badge mine">⭐ 我的球队</span>' : '';
    var kicker, mid, cta;
    if (state === 'live') {
      kicker = '<span class="wc-pulse"></span> 正在进行 <span class="en">LIVE NOW</span>' + mineTag;
      mid = '<div class="wc-focus-live-tag"><span class="wc-pulse"></span> 实时进行中 · 比分待确认</div>';
      cta = '点开看详情 ›';
    } else if (state === 'upcoming') {
      kicker = '🔥 今日焦点战 <span class="en">FEATURED</span>' + mineTag;
      mid = '<div class="wc-countdown" data-kickoff="' + esc(m.kickoffUtc) + '"></div>';
      cta = involvesMine(m) ? '关注中 · 点开看详情 ›' : '点开 · 加入「我的球队」›';
    } else {
      kicker = '⭐ 焦点回顾 <span class="en">RESULT</span>' + mineTag;
      mid = '<div class="wc-focus-meta">' + p.dayLabel + ' · ' + p.time + ' 萨省</div>';
      cta = '点开看进球时间线 ›';
    }
    var center;
    if (state === 'done' && s) {
      var reveal = canReveal(m);
      center = '<div class="wc-focus-score">' + (reveal ? s[0] + ' : ' + s[1] : '? : ?') + '</div>';
    } else if (state === 'live') {
      center = '<div class="wc-focus-vs">VS</div>';
    } else {
      center = '<div class="wc-focus-vs">VS</div>';
    }
    return '<div class="wc-focus" id="wcFocus" data-id="' + esc(m.id) + '">' +
      '<div class="wc-focus-kicker">' + kicker + '</div>' +
      '<div class="wc-focus-teams">' +
        '<div class="wc-focus-team"><span class="fl">' + (flag(m.home) || '⚽') + '</span><div class="nm">' + esc(cn(m.home)) + '</div></div>' +
        center +
        '<div class="wc-focus-team"><span class="fl">' + (flag(m.away) || '⚽') + '</span><div class="nm">' + esc(cn(m.away)) + '</div></div>' +
      '</div>' +
      (state === 'done' ? '' : '<div class="wc-focus-meta">' + esc(m.venue) + ' · ' + esc(m.city) + ' · ' + p.time + ' 萨省</div>') +
      mid +
      '<button class="wc-focus-cta" id="wcFocusCta">' + cta + '</button>' +
    '</div>';
  }
  function wireFocus(root, m) {
    if (!m) return;
    var cta = root.querySelector('#wcFocusCta');
    if (cta) cta.onclick = function () {
      if (matchState(m) === 'upcoming' && !involvesMine(m)) { toggleFollow(m.home); }
      // jump to the match card + open it
      schedFilters.team = '';
      renderSchedule();
      setTimeout(function () {
        var card = hub.querySelector('.wc-match[data-id="' + m.id + '"]');
        if (card) { openCard(card, m); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }, 40);
    };
  }

  /* ----- match card ----- */
  function matchCardHtml(m) {
    var state = matchState(m), p = skParts(m.kickoffUtc), s = score(m);
    var mine = involvesMine(m);
    var spoilerHidden = state === 'done' && !canReveal(m);
    var timeBlock;
    if (state === 'live') {
      timeBlock = '<div class="t">' + p.time + '</div><div class="s live"><span class="wc-pulse"></span> 进行中</div>';
    } else if (state === 'done') {
      timeBlock = '<div class="t">' + p.time + '</div><div class="s">FT 完场</div>';
    } else {
      timeBlock = '<div class="t">' + p.time + '</div><div class="cd" data-kickoff="' + esc(m.kickoffUtc) + '"></div>';
    }

    var hw = s && s[0] > s[1], aw = s && s[1] > s[0];
    var badges = matchBadges(m, state, s);

    return '<div class="wc-match' + (mine ? ' mine' : '') + (spoilerHidden ? ' spoiler-hidden' : '') + '" data-id="' + esc(m.id) + '">' +
      '<div class="wc-match-head">' +
        '<div class="wc-match-time">' + timeBlock + '</div>' +
        '<div class="wc-teams">' +
          teamRow(m.home, s ? s[0] : null, state, hw, aw === false) +
          teamRow(m.away, s ? s[1] : null, state, aw, hw === false) +
        '</div>' +
        '<div class="wc-match-meta">' +
          '<span class="stage">' + esc(stageShort(m)) + '</span>' +
          (badges ? '<div class="badges">' + badges + '</div>' : '') +
          '<span class="chev">⌄</span>' +
        '</div>' +
      '</div>' +
      '<div class="wc-match-detail" data-detail="' + esc(m.id) + '"></div>' +
    '</div>';
  }

  function teamRow(code, sc, state, isWin, isLose) {
    var cls = '';
    if (state === 'done' && sc != null) { cls = isWin ? ' win' : (isLose ? ' lose' : ''); }
    var enHtml = isTeam(code) ? '<span class="en">' + esc(en(code)) + '</span>' : '';
    var fl = flag(code);
    var scHtml = '';
    if (sc != null && state === 'done') {
      if (canRevealCode()) {} // noop
      scHtml = '<span class="sc">' + sc + '</span>';
    }
    return '<div class="wc-team' + cls + '">' +
      '<span class="fl wc-flag" data-team="' + esc(code) + '">' + (fl || '<span style="opacity:.4">◦</span>') + '</span>' +
      '<span class="nm">' + esc(cn(code)) + enHtml + '</span>' + scHtml +
    '</div>';
  }
  function canRevealCode() { return true; }

  function stageShort(m) {
    if (m.group) return m.round.replace('小组赛 ', '') + ' · ' + m.group + '组';
    return m.round;
  }

  function matchBadges(m, state, s) {
    var b = '';
    if (state === 'live') b += '<span class="wc-badge live"><span class="wc-pulse" style="background:#fff"></span>LIVE</span>';
    if (state === 'done' && s && canReveal(m)) {
      var diff = Math.abs(s[0] - s[1]);
      if (diff >= 3) b += '<span class="wc-badge big">💥 大胜 ' + s[0] + '-' + s[1] + '</span>';
      var up = detectUpset(m, s);
      if (up) b += '<span class="wc-badge upset">😱 冷门</span>';
    }
    return b;
  }
  function detectUpset(m, s) {
    if (!s || s[0] === s[1]) return false;
    var winner = s[0] > s[1] ? m.home : m.away;
    var loser = s[0] > s[1] ? m.away : m.home;
    if (!isTeam(winner) || !isTeam(loser)) return false;
    var rw = RANK[winner] || 40, rl = RANK[loser] || 40;
    return (rw - rl) >= 12;     // winner ranked clearly weaker
  }

  /* ----- spoiler ----- */
  function canReveal(m) { return spoilerMode === 'shown' || revealed.has(m.id); }

  function wireMatchCards(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('.wc-match'), function (card) {
      var id = card.getAttribute('data-id');
      var m = matchById(id);
      var head = card.querySelector('.wc-match-head');
      head.onclick = function (ev) {
        // flag tap = follow micro-interaction (don't toggle the card)
        var fl = ev.target.closest('.wc-flag');
        if (fl) { ev.stopPropagation(); flagTap(fl, m); return; }
        // tapping a blurred score reveals just this match
        if (card.classList.contains('spoiler-hidden')) {
          revealed.add(id); savePrefs();
          card.classList.remove('spoiler-hidden');
          renderSchedule();
          return;
        }
        if (card.classList.contains('open')) closeCard(card);
        else openCard(card, m);
      };
    });
  }
  function openCard(card, m) {
    card.classList.add('open');
    var det = card.querySelector('.wc-match-detail');
    det.innerHTML = detailHtml(m);
    // animate goal timeline
    var goals = det.querySelectorAll('.wc-goal');
    goals.forEach(function (g, i) { setTimeout(function () { g.classList.add('in'); }, 80 + i * 140); });
    var fb = det.querySelector('.wc-follow-toggle');
    if (fb) fb.onclick = function (e) { e.stopPropagation(); toggleFollow(fb.getAttribute('data-team')); openCard(card, m); };
    var fb2 = det.querySelector('.wc-follow-toggle2');
    if (fb2) fb2.onclick = function (e) { e.stopPropagation(); toggleFollow(fb2.getAttribute('data-team')); openCard(card, m); };
  }
  function closeCard(card) { card.classList.remove('open'); }

  function detailHtml(m) {
    var state = matchState(m), s = score(m), p = skParts(m.kickoffUtc);
    var html = '<div class="wc-detail-venue">📍 ' + esc(m.venue) + ' · ' + esc(m.city) + ' &nbsp;·&nbsp; 🕐 ' + p.dayLabel + ' ' + p.time + ' 萨省</div>';

    if (state === 'done' && s && canReveal(m) && m.scorers && m.scorers.length) {
      var sc = m.scorers.slice().sort(function (a, b) { return (a.minute || 0) - (b.minute || 0); });
      html += '<div class="wc-timeline">';
      sc.forEach(function (g) {
        html += '<div class="wc-goal"><span class="min">' + (g.minute != null ? g.minute + "'" : '') + '</span>' +
          '<span class="who"><span class="ball">' + (flag(g.team) || '⚽') + '</span>' + esc(g.player || '进球') + '</span></div>';
      });
      html += '</div>';
    } else if (state === 'done' && s && canReveal(m)) {
      html += '<div class="wc-detail-empty">⚽ 终场 ' + s[0] + ' - ' + s[1] + ' · 进球详情待补充</div>';
    } else if (state === 'done' && !canReveal(m)) {
      html += '<div class="wc-detail-empty">🙈 比分已隐藏 — 点上方比分揭晓</div>';
    } else if (state === 'live') {
      html += '<div class="wc-detail-empty"><span class="wc-pulse"></span> 比赛进行中 · 实时比分待官方确认</div>';
    } else {
      html += '<div class="wc-detail-empty">⏳ 比赛尚未开始</div>';
    }

    // follow buttons for the two teams (real teams only)
    var btns = [];
    [m.home, m.away].forEach(function (code, idx) {
      if (!isTeam(code)) return;
      var on = myTeams.has(code);
      btns.push('<button class="wc-follow-btn wc-follow-toggle' + (idx ? '2' : '') + (on ? ' on' : '') + '" data-team="' + esc(code) + '">' +
        (on ? '✓ 已关注 ' : '+ 关注 ') + flag(code) + ' ' + esc(cn(code)) + '</button>');
    });
    if (btns.length) html += '<div style="display:flex;gap:8px;flex-wrap:wrap">' + btns.join('') + '</div>';
    return html;
  }

  /* ----- follow / flag micro-interaction ----- */
  function flagTap(el, m) {
    el.classList.remove('wc-wiggle'); void el.offsetWidth; el.classList.add('wc-wiggle');
    var code = el.getAttribute('data-team');
    if (isTeam(code)) toggleFollow(code, el);
  }
  function toggleFollow(code, anchorEl) {
    if (!isTeam(code)) return;
    if (myTeams.has(code)) {
      myTeams.delete(code);
      if (Farm.ui) Farm.ui.toast('已取消关注 ' + flag(code) + ' ' + cn(code));
    } else {
      myTeams.add(code);
      if (Farm.ui) Farm.ui.toast('⭐ 已关注 ' + flag(code) + ' ' + cn(code) + ' · 比赛将置顶高亮');
      miniConfetti();
      if (Farm.audio) Farm.audio.play('coin');
    }
    savePrefs();
    if (activeTab === 'schedule') renderSchedule();
  }

  function matchById(id) { return (data.matches || []).filter(function (m) { return m.id === id; })[0]; }

  /* ============================================================
     STANDINGS
     ============================================================ */
  function renderStandings() {
    var root = hub.querySelector('#wc-standings');
    var html =
      '<div class="wc-legend">' +
        '<i><span class="dot" style="background:var(--wc-pitch)"></span>小组第1 → 16强</i>' +
        '<i><span class="dot" style="background:var(--wc-pitch-soft)"></span>小组第2 → 16强</i>' +
        '<i><span class="dot" style="background:var(--wc-amber)"></span>第3名(争8席)</i>' +
      '</div>' +
      '<div class="wc-section-note">P 赛 / W 胜 / D 平 / L 负 / GF 进 / GA 失 / GD 净胜 / Pts 积分。Pts、GD 自动计算，按 积分→净胜球→进球→正面交锋 排序。截至 ' + dataDate() + '。</div>';

    var thirds = [];
    Object.keys(data.groups).forEach(function (g) {
      var ranked = rankGroupForDisplay(g);
      if (ranked[2]) thirds.push(extend(ranked[2], { g: g }));
      html += groupTableHtml(g, ranked);
    });

    // third-place race
    thirds.sort(function (a, b) { return b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.g.localeCompare(b.g); });
    html += '<div class="wc-grp"><div class="wc-grp-h"><span class="g" style="color:var(--wc-amber-deep)">最佳第三名 Third-Place</span><span class="note">前 8 出线</span></div>' +
      '<div class="wc-section-note">12 个小组第三按 积分→净胜球→进球 排序，前 8 进 16 强。部分小组未踢完，排名会变。</div>' +
      '<table class="wc-table"><thead><tr><th class="l">球队</th><th>组</th><th>Pts</th><th>GD</th><th>GF</th></tr></thead><tbody>';
    thirds.forEach(function (r, i) {
      if (i === 8) html += '<tr class="wc-cut"><td colspan="5" class="lbl">— 出线分界线 cut line —</td></tr>';
      html += '<tr class="' + (i < 8 ? '' : 'elim') + '">' +
        '<td class="team"><span class="pos">' + (i + 1) + '</span><span class="fl">' + flag(r.code) + '</span>' + esc(cn(r.code)) + '</td>' +
        '<td>' + r.g + '</td><td class="pts">' + r.Pts + '</td><td>' + sign(r.GD) + '</td><td>' + r.GF + '</td></tr>';
    });
    html += '</tbody></table></div>';

    root.innerHTML = html;
  }

  function groupTableHtml(g, ranked) {
    var html = '<div class="wc-grp"><div class="wc-grp-h"><span class="g">' + g + ' 组</span><span class="note">Pts → GD → GF → h2h</span></div>' +
      '<table class="wc-table"><thead><tr><th class="l">球队</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>';
    ranked.forEach(function (r, i) {
      var cls = r.status === 'out' ? 'elim' : (i === 0 ? 'q1' : i === 1 ? 'q2' : i === 2 ? 'q3' : '');
      html += '<tr class="' + cls + '">' +
        '<td class="team"><span class="pos">' + (i + 1) + '</span><span class="fl">' + flag(r.code) + '</span>' + esc(cn(r.code)) +
          (r.h2h ? '<span class="wc-h2h">h2h</span>' : '') + '</td>' +
        '<td>' + r.P + '</td><td>' + r.W + '</td><td>' + r.D + '</td><td>' + r.L + '</td>' +
        '<td>' + r.GF + '</td><td>' + r.GA + '</td><td>' + sign(r.GD) + '</td><td class="pts">' + r.Pts + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // Display ranking: totals from groupStats; ties broken by head-to-head from matches[].
  function rankGroupForDisplay(g) {
    var rows = (data.groupStats[g] || []).map(function (r) {
      return { code: r.code, P: r.P, W: r.W, D: r.D, L: r.L, GF: r.GF, GA: r.GA, GD: r.GF - r.GA, Pts: r.W * 3 + r.D, status: r.status, h2h: false };
    });
    rows.sort(function (a, b) { return b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF; });
    // find clusters tied on Pts+GD+GF -> break by h2h
    var out = [], i = 0;
    while (i < rows.length) {
      var j = i + 1;
      while (j < rows.length && rows[j].Pts === rows[i].Pts && rows[j].GD === rows[i].GD && rows[j].GF === rows[i].GF) j++;
      var cluster = rows.slice(i, j);
      if (cluster.length > 1) {
        var ordered = breakTieH2H(cluster.map(function (r) { return r.code; }));
        if (ordered) {
          var map = {}; cluster.forEach(function (r) { map[r.code] = r; });
          ordered.forEach(function (code) { map[code].h2h = true; out.push(map[code]); });
        } else { cluster.forEach(function (r) { out.push(r); }); }
      } else { out.push(cluster[0]); }
      i = j;
    }
    return out;
  }

  // Head-to-head among tied teams, using officialFinal matches that exist. Returns
  // ordered code array, or null if there isn't enough match data to separate them.
  function breakTieH2H(tiedCodes) {
    var set = new Set(tiedCodes);
    var mini = {}; tiedCodes.forEach(function (c) { mini[c] = { code: c, Pts: 0, GD: 0, GF: 0, played: 0 }; });
    (data.matches || []).forEach(function (m) {
      if (m.stage !== 'group') return;
      if (!m.officialFinal || !m.officialScore) return;
      if (!set.has(m.home) || !set.has(m.away)) return;
      var h = m.officialScore[0], a = m.officialScore[1];
      var H = mini[m.home], A = mini[m.away];
      H.GF += h; A.GF += a; H.GD += h - a; A.GD += a - h; H.played++; A.played++;
      if (h > a) H.Pts += 3; else if (h < a) A.Pts += 3; else { H.Pts++; A.Pts++; }
    });
    var anyPlayed = tiedCodes.some(function (c) { return mini[c].played > 0; });
    if (!anyPlayed) return null;     // no h2h data -> leave as-is (alphabetical fall-through avoided)
    var ordered = tiedCodes.slice().sort(function (x, y) {
      return mini[y].Pts - mini[x].Pts || mini[y].GD - mini[x].GD || mini[y].GF - mini[x].GF;
    });
    return ordered;
  }

  /* ----------------------------------------------------------------
     Canonical group ranking from match data (ported verbatim from
     docs/TIEBREAKER_REFERENCE.md). The standings UI uses the
     groupStats-based variant above because the seed's matches[] omit
     rounds 1-2; this pure version is the correct general implementation
     and is what the unit tests cover.
     ---------------------------------------------------------------- */
  function rankGroupPure(teamCodes, matches) {
    var played = (matches || []).filter(function (m) { return m.officialFinal && m.officialScore; });
    var base = {};
    teamCodes.forEach(function (c) { base[c] = { code: c, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 }; });
    played.forEach(function (m) {
      if (!(m.home in base) || !(m.away in base)) return;
      var h = m.officialScore[0], a = m.officialScore[1];
      var H = base[m.home], A = base[m.away];
      H.P++; A.P++; H.GF += h; H.GA += a; A.GF += a; A.GA += h;
      if (h > a) { H.W++; A.L++; H.Pts += 3; }
      else if (h < a) { A.W++; H.L++; A.Pts += 3; }
      else { H.D++; A.D++; H.Pts++; A.Pts++; }
    });
    teamCodes.forEach(function (c) { base[c].GD = base[c].GF - base[c].GA; });
    var sorted = teamCodes.map(function (c) { return base[c]; })
      .sort(function (x, y) { return y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF; });
    var result = [], i = 0;
    while (i < sorted.length) {
      var j = i + 1;
      while (j < sorted.length && sorted[j].Pts === sorted[i].Pts && sorted[j].GD === sorted[i].GD && sorted[j].GF === sorted[i].GF) j++;
      var cluster = sorted.slice(i, j).map(function (t) { return t.code; });
      if (cluster.length === 1) result.push(cluster[0]);
      else result.push.apply(result, breakTiePure(cluster, played));
      i = j;
    }
    return result.map(function (c) { return base[c]; });
  }
  function breakTiePure(tiedCodes, played) {
    var set = {}; tiedCodes.forEach(function (c) { set[c] = 1; });
    var mini = {}; tiedCodes.forEach(function (c) { mini[c] = { code: c, Pts: 0, GD: 0, GF: 0, GA: 0 }; });
    played.forEach(function (m) {
      if (!set[m.home] || !set[m.away]) return;
      var h = m.officialScore[0], a = m.officialScore[1];
      var H = mini[m.home], A = mini[m.away];
      H.GF += h; H.GA += a; A.GF += a; A.GA += h; H.GD += h - a; A.GD += a - h;
      if (h > a) H.Pts += 3; else if (h < a) A.Pts += 3; else { H.Pts++; A.Pts++; }
    });
    var ordered = tiedCodes.map(function (c) { return mini[c]; })
      .sort(function (x, y) { return y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF; });
    var out = [], i = 0;
    while (i < ordered.length) {
      var j = i + 1;
      while (j < ordered.length && ordered[j].Pts === ordered[i].Pts && ordered[j].GD === ordered[i].GD && ordered[j].GF === ordered[i].GF) j++;
      var still = ordered.slice(i, j).map(function (t) { return t.code; });
      if (still.length === 1) out.push(still[0]);
      else { still.sort(); out.push.apply(out, still); }   // fair-play / draw pending -> stable
      i = j;
    }
    return out;
  }

  /* ============================================================
     KNOCKOUT BRACKET PREDICTOR
     ============================================================ */
  var BR_ROUNDS = [
    { id: 'r32', lbl: '16强 R32', n: 16 },
    { id: 'r16', lbl: '8强 R16', n: 8 },
    { id: 'qf', lbl: '四分之一', n: 4 },
    { id: 'sf', lbl: '半决赛', n: 2 },
    { id: 'f', lbl: '决赛', n: 1 }
  ];

  function rowScore(r) { return { code: r.code, score: (r.Pts || 0) * 100 + (r.GD || 0) * 10 + (r.GF || 0) }; }
  function seedR32() {
    // 32 distinct qualifiers = 12 group winners + 12 runners-up + best 8 third places,
    // seeded by current record and paired 1-vs-32, 2-vs-31 … (standard tournament seeding).
    // Indicative only — NOT the official FIFA slot map — but every team appears exactly once.
    var quals = [], thirds = [];
    Object.keys(data.groups).forEach(function (g) {
      var s = rankGroupForDisplay(g);
      if (s[0]) quals.push(rowScore(s[0]));
      if (s[1]) quals.push(rowScore(s[1]));
      if (s[2]) thirds.push(rowScore(s[2]));
    });
    thirds.sort(function (a, b) { return b.score - a.score; });
    quals = quals.concat(thirds.slice(0, 8));
    quals.sort(function (a, b) { return b.score - a.score; });   // seed 1..32
    var pairs = [];
    for (var i = 0; i < 16; i++) {
      pairs.push([quals[i] ? quals[i].code : null, quals[31 - i] ? quals[31 - i].code : null]);
    }
    return pairs;
  }

  function renderBracket() {
    var root = hub.querySelector('#wc-bracket');
    var r32 = seedR32();
    var ties = {};
    r32.forEach(function (p, i) { ties['r32-' + i] = { a: p[0], b: p[1] }; });

    function slotsFor(ri) {
      var r = BR_ROUNDS[ri], out = [];
      for (var i = 0; i < r.n; i++) {
        var id = r.id + '-' + i;
        if (r.id === 'r32') out.push({ id: id, a: ties[id].a, b: ties[id].b });
        else {
          var prev = BR_ROUNDS[ri - 1].id;
          out.push({ id: id, a: bracketPicks[prev + '-' + (i * 2)] || null, b: bracketPicks[prev + '-' + (i * 2 + 1)] || null });
        }
      }
      return out;
    }

    var cols = '';
    BR_ROUNDS.forEach(function (r, ri) {
      var inner = '<div class="wc-round-lbl">' + r.lbl + '</div>';
      slotsFor(ri).forEach(function (sl) {
        inner += '<div class="wc-tie">' + slotHtml(sl, sl.a) + slotHtml(sl, sl.b) + '</div>';
      });
      cols += '<div class="wc-round">' + inner + '</div>';
    });

    var champ = bracketPicks['f-0'];
    var picks = Object.keys(bracketPicks).length;
    root.innerHTML =
      '<div class="wc-section-note">16强由各组前二 + 最佳 8 个第三名按当前战绩种子排序生成（示意性，非官方分区）。点任意球队让它晋级，一路点到决赛预测你的冠军。预测只存在本机。</div>' +
      '<div class="wc-bracket-bar">' +
        '<span class="wc-progress">已预测 <b>' + picks + '</b> 场</span>' +
        '<button class="wc-reset" id="wcBrReset">↺ 重置预测</button>' +
      '</div>' +
      '<div class="wc-bracket-wrap"><div class="wc-bracket">' + cols + '</div></div>' +
      (champ ? '<div class="wc-champ"><span class="f">' + (flag(champ) || '🏆') + '</span>你的预测冠军<br>' + esc(cn(champ)) + (en(champ) ? ' · ' + esc(en(champ)) : '') + '</div>' : '');

    Array.prototype.forEach.call(root.querySelectorAll('.wc-slot[data-team]'), function (sl) {
      sl.onclick = function () {
        var tie = sl.getAttribute('data-tie'), team = sl.getAttribute('data-team');
        if (bracketPicks[tie] !== team) {
          bracketPicks[tie] = team;
          clearDownstream(tie);
          savePrefs();
          if (Farm.audio) Farm.audio.play('tap');
        }
        renderBracket();
        if (tie === 'f-0') { miniConfetti(); if (Farm.audio) Farm.audio.play('levelUp'); }
      };
    });
    root.querySelector('#wcBrReset').onclick = function () {
      bracketPicks = {}; savePrefs(); renderBracket();
    };
  }

  function slotHtml(sl, team) {
    if (!team) return '<div class="wc-slot tbd">待定 TBD</div>';
    var picked = bracketPicks[sl.id] === team;
    var label = isTeam(team) ? cn(team) : placeholderLabel(team);
    var fl = isTeam(team) ? flag(team) : '◦';
    var clickable = true; // allow advancing placeholders too (shows TBD downstream resolves once picked)
    return '<div class="wc-slot' + (picked ? ' picked' : '') + '" data-tie="' + esc(sl.id) + '" data-team="' + esc(team) + '">' +
      '<span class="fl">' + fl + '</span><span class="nm">' + esc(label) + '</span></div>';
  }

  function clearDownstream(tieId) {
    var parts = tieId.split('-'), rid = parts[0], idx = parseInt(parts[1], 10);
    var ri = BR_ROUNDS.map(function (r) { return r.id; }).indexOf(rid);
    var cur = idx;
    for (var i = ri + 1; i < BR_ROUNDS.length; i++) {
      cur = Math.floor(cur / 2);
      delete bracketPicks[BR_ROUNDS[i].id + '-' + cur];
    }
  }

  /* ============================================================
     EASTER EGGS
     ============================================================ */
  function checkStreak() {
    var today = nowSkDayKey();
    if (prefs.lastVisit === today) return;
    var yesterday = skParts(new Date(Date.now() - 86400000).toISOString()).dayKey;
    if (prefs.lastVisit === yesterday) prefs.streak = (prefs.streak || 1) + 1;
    else prefs.streak = 1;
    prefs.lastVisit = today;
    savePrefs();
    if (prefs.streak >= 2) {
      streakToast('🔥 连续观赛 ' + prefs.streak + ' 天！');
      miniConfetti();
    }
  }
  function streakToast(text) {
    var el = document.createElement('div');
    el.className = 'wc-streak';
    el.textContent = text;
    document.body.appendChild(el);
    void el.offsetWidth; el.classList.add('show');
    setTimeout(function () { el.remove(); }, 3000);
  }
  function miniConfetti() {
    var colors = ['#f4a72c', '#6ab04c', '#3a7d2c', '#e0392b', '#88c8e8', '#9b59b6'];
    var layer = document.createElement('div'); layer.className = 'wc-confetti';
    for (var i = 0; i < 26; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = (1.1 + Math.random() * 0.9) + 's';
      p.style.animationDelay = (Math.random() * 0.25) + 's';
      p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 2400);
  }

  /* ============================================================
     SPLASH ENTRY + RE-ENTRY BUTTON
     ============================================================ */
  function wireSplashEntry() {
    var btn = document.getElementById('splashWorldcup');
    if (btn && !btn._wcWired) { btn._wcWired = true; btn.onclick = open; }
  }
  function ensureReentry() {
    if (reentryBtn) return;
    reentryBtn = document.createElement('button');
    reentryBtn.id = 'wcReentry';
    reentryBtn.setAttribute('aria-label', '世界杯观赛台 World Cup');
    reentryBtn.innerHTML = '⚽<span class="wcre-dot"></span>';
    reentryBtn.onclick = open;
    document.body.appendChild(reentryBtn);
    updateReentry();
  }
  function updateReentry() {
    if (!reentryBtn) return;
    var splashUp = !!document.getElementById('splash');
    var hubUp = hub && hub.style.display !== 'none' && !hub.classList.contains('wc-closing');
    reentryBtn.style.display = (splashUp || hubUp) ? 'none' : 'flex';
  }

  /* ---------------------- misc ---------------------- */
  function sign(n) { return (n > 0 ? '+' : '') + n; }
  function extend(o, e) { for (var k in e) o[k] = e[k]; return o; }
  function dataDate() {
    try { return data.meta.lastUpdated.slice(5, 10).replace('-', '月') + '日'; } catch (e) { return ''; }
  }

  /* ---------------------- init ---------------------- */
  function init() {
    wireSplashEntry();
    ensureReentry();
    // splash may render slightly after us; re-check entry + reentry visibility briefly
    reentryPoll = setInterval(function () {
      wireSplashEntry();
      updateReentry();
      if (!document.getElementById('splash')) { clearInterval(reentryPoll); reentryPoll = null; updateReentry(); }
    }, 700);
    setTimeout(function () { if (reentryPoll) { clearInterval(reentryPoll); reentryPoll = null; } updateReentry(); }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ---------------------- emblem (original SVG, not the FIFA mark) ---------------------- */
  function emblemSvg(cls) {
    return '<svg class="' + cls + '" viewBox="0 0 60 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      // trophy cup
      '<path d="M16 8 H44 V20 Q44 34 30 38 Q16 34 16 20 Z" fill="#f4a72c" stroke="#d98410" stroke-width="2"/>' +
      '<path d="M16 11 H8 Q5 11 6 17 Q8 26 17 26" fill="none" stroke="#d98410" stroke-width="2.4"/>' +
      '<path d="M44 11 H52 Q55 11 54 17 Q52 26 43 26" fill="none" stroke="#d98410" stroke-width="2.4"/>' +
      '<rect x="25" y="37" width="10" height="8" fill="#e0961a"/>' +
      '<path d="M19 45 H41 L43 52 H17 Z" fill="#f4a72c" stroke="#d98410" stroke-width="2"/>' +
      // soccer ball on the cup
      '<circle cx="30" cy="20" r="8" fill="#fffdf6" stroke="#3a7d2c" stroke-width="1.6"/>' +
      '<path d="M30 14 l3 2.4 -1.2 3.6 h-3.6 L27 16.4 Z" fill="#3a7d2c"/>' +
      // "26"
      '<text x="30" y="66" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="15" fill="#3a7d2c">26</text>' +
    '</svg>';
  }

  /* ---------------------- public API ---------------------- */
  window.Farm = window.Farm || {};
  window.Farm.worldcup = {
    open: open,
    close: close,
    _emblem: emblemSvg,
    _rankGroup: rankGroupForDisplay,    // exposed for tests
    _rankGroupPure: rankGroupPure,      // canonical (matches -> ranking), unit-tested
    _breakTieH2H: breakTieH2H,
    _detectUpset: detectUpset,
    _setDataForTest: function (d) { data = d; T = {}; (d.teams || []).forEach(function (t) { T[t.code] = t; }); }
  };
})();
