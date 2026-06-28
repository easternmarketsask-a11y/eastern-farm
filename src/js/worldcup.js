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
  // Live scores: ESPN's public soccer API — REAL fixtures/scores, free, no key,
  // CORS-open (Access-Control-Allow-Origin: *). Overlays onto the static JSON;
  // graceful fallback keeps the page working if the source is down. Two date
  // ranges dodge ESPN's ~100-event-per-response cap (group stage + knockout).
  var LIVE_SB_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=';
  var LIVE_RANGES = ['20260611-20260627', '20260628-20260720'];
  var live = null;   // { at, byPair:{ "HOME|AWAY": {...} }, standings:{ group: rows[] }, ok:true }

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

  // Standalone mode: the hub is the whole page (its own shareable URL), with no
  // farm behind it. Set by worldcup.html before this script loads.
  var WC_STANDALONE = !!(window.WC_STANDALONE);

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
    if (/^3RD$/i.test(code)) return '小组第三';                       // ESPN 第三名占位
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
  // Label a dayKey ('YYYY-MM-DD', already a Saskatchewan-local date) WITHOUT
  // re-applying the timezone offset — passing a date-only string back through
  // skParts() would shift it a day earlier (parsed as UTC midnight − 6h).
  function labelForDayKey(dk) {
    var d = new Date(dk + 'T12:00:00Z');
    var days = ['周日','周一','周二','周三','周四','周五','周六'];
    return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + days[d.getUTCDay()];
  }

  function matchState(m) {
    // 'done' | 'live' | 'upcoming' | 'awaiting' (kicked off but no result in data yet)
    var k = new Date(m.kickoffUtc).getTime();
    var now = Date.now();
    var lf = liveFor(m);
    // 1. Confirmed finals always win: human official first, then a finished live record.
    if (m.officialFinal && m.officialScore) return 'done';
    if (m.officialScore) return 'done';            // score present even if final flag missing
    if (lf && lf.finished && lf.score) return 'done';
    // 2. Real-clock gate. The auto data source is NOT a true real-time feed (it is a
    //    fixed/simulated dataset and can leave a game stuck "in play"), so its in-play
    //    flag must agree with the Saskatchewan clock before we ever show LIVE — otherwise
    //    a phantom match shows "正在进行" at 凌晨. A match is live only inside its window.
    if (now < k) return 'upcoming';
    if (now <= k + 130 * 60000) return 'live';
    // 3. Past the window with no confirmed final:
    if (lf && lf.score) return 'done';             // source carries a score → treat as played
    if (m.apiScore) return 'done';
    return 'awaiting';   // past kickoff, no result in the data yet (stale / not entered)
  }
  function score(m) { var lf = liveFor(m); if (lf && lf.score) return lf.score; return m.officialScore || m.apiScore || null; }

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
     LIVE SCORES (client-side overlay onto the static truth source)
     Source: ESPN public soccer API (REAL fixtures/scores, no key, CORS *).
     Team codes (abbreviation) === our codes. Never blocks render: failure
     leaves `live=null` → static (which is itself real, ESPN-generated) data.
     ============================================================ */
  function espnMinute(c) {
    if (!c || !c.displayValue) return null;
    var n = parseInt(String(c.displayValue).replace(/'/g, '').trim(), 10);
    return isNaN(n) ? null : n;
  }
  function espnScorers(c, idToCode) {
    var out = [];
    (c.details || []).forEach(function (dd) {
      if (!dd.scoringPlay) return;
      var ath = (dd.athletesInvolved && dd.athletesInvolved[0]) || null;
      out.push({
        team: idToCode[dd.team && dd.team.id] || null,
        player: ath ? (ath.shortName || ath.displayName) : (dd.ownGoal ? 'OG' : ''),
        minute: espnMinute(dd.clock), pen: !!dd.penaltyKick, og: !!dd.ownGoal
      });
    });
    return out;
  }

  function fetchLive() {
    if (!data) return Promise.resolve(false);
    return Promise.all(LIVE_RANGES.map(function (r) {
      return fetch(LIVE_SB_URL + r, { cache: 'no-cache' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; });
    })).then(function (parts) {
      var evById = {};
      parts.forEach(function (p) { if (p && p.events) p.events.forEach(function (e) { evById[e.id] = e; }); });
      var events = Object.keys(evById).map(function (k) { return evById[k]; });
      if (!events.length) return false;
      var byPair = {}, groupGames = {};
      events.forEach(function (ev) {
        if (((ev.season && ev.season.slug) || '') !== 'group-stage') return;  // KO stays static
        var c = ev.competitions[0];
        var home = c.competitors.filter(function (x) { return x.homeAway === 'home'; })[0] || c.competitors[0];
        var away = c.competitors.filter(function (x) { return x.homeAway === 'away'; })[0] || c.competitors[1];
        var hc = home.team.abbreviation, ac = away.team.abbreviation;
        if (!T[hc] || !T[ac]) return;
        var stt = c.status.type;
        var finished = !!stt.completed;
        var inPlay = stt.state === 'in';
        var hs = parseInt(home.score, 10), as = parseInt(away.score, 10);
        var hasScore = !isNaN(hs) && !isNaN(as) && (finished || inPlay);
        var idToCode = {}; c.competitors.forEach(function (x) { idToCode[x.team.id] = x.team.abbreviation; });
        var grp = T[hc].group;
        var rec = {
          home: hc, away: ac, group: grp,
          score: hasScore ? [hs, as] : null,
          finished: finished, inPlay: inPlay,
          scorers: espnScorers(c, idToCode)
        };
        byPair[hc + '|' + ac] = rec;
        (groupGames[grp] = groupGames[grp] || []).push(rec);
      });
      if (!Object.keys(byPair).length) return false;
      // Recompute standings per group from the COMPLETE set of live group games.
      var standings = {};
      Object.keys(data.groups).forEach(function (g) {
        var codes = data.groups[g];
        var played = (groupGames[g] || []).filter(function (r) { return r.finished && r.score; })
          .map(function (r) { return { home: r.home, away: r.away, officialScore: r.score, officialFinal: true }; });
        var ranked = rankGroupPure(codes, played);
        var allDone = (groupGames[g] || []).filter(function (r) { return r.finished; }).length >= 6;
        ranked.forEach(function (row, i) {
          row.status = allDone ? (i < 2 ? 'q' : i === 2 ? 'alive' : 'out') : 'alive';
          row.h2h = false;
        });
        standings[g] = ranked;
      });
      live = { at: Date.now(), byPair: byPair, standings: standings, ok: true };
      return true;
    }).catch(function (e) { console.warn('[wc] ESPN live fetch failed — using static data', e); return false; });
  }

  // Live record for one of OUR matches (group stage only; KO stays static/placeholder).
  function liveFor(m) {
    if (!live || !live.ok || !m || m.stage !== 'group') return null;
    return live.byPair[m.home + '|' + m.away] || null;
  }
  function refreshLive() {
    return fetchLive().then(function (ok) {
      if (!hub) return;
      updateLottoBanner();                 // keep banner + 我的奖品 button state fresh (also catches fb-ready-after-open)
      if (!ok) return;
      rendered.standings = false;          // standings depend on live too
      if (activeTab === 'schedule') renderSchedule();
      else if (activeTab === 'standings') { renderStandings(); rendered.standings = true; }
      else if (activeTab === 'bracket') renderBracket();
    });
  }
  function liveStamp() {
    if (!live || !live.ok) return '';
    var sk = new Date(live.at + SK_OFFSET * 3600 * 1000);
    return '<div class="wc-live-note">⚡ 实时比分 · 更新于 ' + pad(sk.getUTCHours()) + ':' + pad(sk.getUTCMinutes()) +
      ' 萨省 <span class="wc-live-src">来源 ESPN · 60秒自动刷新</span></div>';
  }

  /* ============================================================
     OVERLAY SHELL
     ============================================================ */
  function buildHub() {
    hub = document.createElement('div');
    hub.id = 'wc-hub';
    hub.innerHTML =
      '<div class="wc-topbar">' +
        '<a class="wc-em-logo" href="https://easternmarket.ca/" target="_blank" rel="noopener" title="东方超市 Eastern Market" aria-label="东方超市 Eastern Market">' +
          '<img src="assets/images/logo-horizontal.png" alt="东方超市 Eastern Market"></a>' +
        '<div class="wc-title"><span class="wc-title-zh">世界杯观赛台</span></div>' +
        '<div class="wc-topbar-right">' +
          '<div class="wc-clock" id="wcClock"><span class="t">--:--:--</span><span class="z">萨省</span></div>' +
          '<button class="wc-close" id="wcClose" aria-label="关闭 Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<button class="wc-lotto-banner" id="wcLottoBanner" hidden>' +
        '<span class="bn">' +
          '<span class="bn-l1">🎁 淘汰赛竞猜有礼进行中</span>' +
          '<span class="bn-l2">会员参与即得好礼 <i class="bn-go">›</i></span>' +
        '</span>' +
      '</button>' +
      '<button class="wc-myprizes-btn" id="wcMyPrizes" hidden>🎁 我的奖品 · 兑奖码 ›</button>' +
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
    var lb = hub.querySelector('#wcLottoBanner');
    if (lb) lb.onclick = function () { var m = nearestLottoMatch(); if (m) openLottoMatch(m); };
    var mp = hub.querySelector('#wcMyPrizes');
    if (mp) mp.onclick = openMyPrizes;
  }

  // 有"可报名(开球前、双方已定)"的淘汰赛场 → 横幅出现,点它直达最近一场竞猜
  function nearestLottoMatch() {
    return (data.matches || []).filter(function (m) {
      return isKO(m) && lottoOpen(m) && isTeam(m.home) && isTeam(m.away);
    }).sort(function (a, b) { return new Date(a.kickoffUtc) - new Date(b.kickoffUtc); })[0];
  }
  function updateLottoBanner() {
    if (!hub) return;
    var lb = hub.querySelector('#wcLottoBanner');
    if (lb) lb.hidden = !nearestLottoMatch();
    var mp = hub.querySelector('#wcMyPrizes');
    // 有 Firebase(农场内)就显示;点击时再按登录态给反馈(避开 hub 打开时 auth 尚未就绪的时序)
    if (mp) mp.hidden = !fbReady();
  }
  function openLottoMatch(m) {
    switchTab('schedule');
    schedFilters.team = ''; schedFilters.stage = ''; schedFilters.quick = {};
    renderSchedule();
    setTimeout(function () {
      var card = hub.querySelector('#wcSchedList [data-id="' + m.id + '"]');
      if (card) { openCard(card, m); if (card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 70);
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
    updateLottoBanner();
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
      refreshLive();          // pull live scores in the background, re-render when ready
    }).catch(function (e) {
      console.error('[wc] data load failed', e);
      if (Farm.ui) Farm.ui.toast('观赛台数据加载失败，请检查网络');
    });
  }

  function close() {
    // Standalone page has nothing behind the hub — "close" returns to the farm game.
    if (WC_STANDALONE) { location.href = 'index.html'; return; }
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
    refreshTimer = setInterval(function () {
      refreshLive();                                                   // re-pull live + re-render on success
      if ((!live || !live.ok) && activeTab === 'schedule') renderSchedule();  // keep static states fresh too
    }, 60000);
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
    var html = liveStamp() + (focus ? focusCardHtml(focus) : '');

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
        out += '<div class="wc-day">' + labelForDayKey(dk) + '<span class="cnt">' + dayMatches.length + ' 场</span></div>';
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
      if (Q.upcoming && state !== 'upcoming') return false;
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
      mid = '<div class="wc-focus-live-tag"><span class="wc-pulse"></span> 实时进行中' + (s ? '' : ' · 比分待确认') + '</div>';
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
    } else if (state === 'live' && s) {
      center = '<div class="wc-focus-score live">' + s[0] + ' : ' + s[1] + '</div>';
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
    } else if (state === 'awaiting') {
      timeBlock = '<div class="t">' + p.time + '</div><div class="s">⏳ 待更新</div>';
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
  // 竞猜入口不再用每场卡片的促销徽章(显廉价);点开卡片展开的详情里就有竞猜表单,
  // 加顶部横幅直达 —— 列表更干净、更高档。

  function teamRow(code, sc, state, isWin, isLose) {
    var cls = '';
    if (state === 'done' && sc != null) { cls = isWin ? ' win' : (isLose ? ' lose' : ''); }
    var enHtml = isTeam(code) ? '<span class="en">' + esc(en(code)) + '</span>' : '';
    var fl = flag(code);
    var scHtml = '';
    if (sc != null && (state === 'done' || state === 'live')) {
      scHtml = '<span class="sc' + (state === 'live' ? ' live' : '') + '">' + sc + '</span>';
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
    var lt = det.querySelector('.wc-lotto');
    if (lt) lottoRender(lt, m);
    var fb = det.querySelector('.wc-follow-toggle');
    if (fb) fb.onclick = function (e) { e.stopPropagation(); toggleFollow(fb.getAttribute('data-team')); openCard(card, m); };
    var fb2 = det.querySelector('.wc-follow-toggle2');
    if (fb2) fb2.onclick = function (e) { e.stopPropagation(); toggleFollow(fb2.getAttribute('data-team')); openCard(card, m); };
  }
  function closeCard(card) { card.classList.remove('open'); }

  function detailHtml(m) {
    var state = matchState(m), s = score(m), p = skParts(m.kickoffUtc);
    var html = '<div class="wc-detail-venue">📍 ' + esc(m.venue) + ' · ' + esc(m.city) + ' &nbsp;·&nbsp; 🕐 ' + p.dayLabel + ' ' + p.time + ' 萨省</div>';
    // knockout-stage prediction lottery (filled async after render)
    if (isKO(m)) html += '<div class="wc-lotto" data-lotto="' + esc(m.id) + '"></div>';

    var lfD = liveFor(m);
    var scList = (lfD && lfD.scorers && lfD.scorers.length) ? lfD.scorers : (m.scorers || []);
    if (state === 'done' && s && canReveal(m) && scList.length) {
      var sc = scList.slice().sort(function (a, b) { return (a.minute || 0) - (b.minute || 0); });
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
    } else if (state === 'awaiting') {
      html += '<div class="wc-detail-empty">⏳ 比赛已开赛 · 比分待更新</div>';
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
     LOTTERY — 淘汰赛竞猜抽奖 · 百分百中奖 (Phase 1 front-end)
     Reuses the farm's member login (Farm.fbAuth) + Firestore (Farm.fb.db).
     KO matches only. Entry open until kickoff. Draw is server-side (Cloud
     Function, Phase 2). Degrades gracefully: standalone page (no Firebase)
     funnels users into the farm to log in & play. Deletes with the module.
     ============================================================ */
  var LOTTO_COL = 'wc_lottery';
  var LOTTO_WIN_COL = 'wc_lottery_winners';
  var PRIZE_CN = {
    shaqima: '沙琪玛', ryukakusan: '龙角散',
    yogurt_orig: '요구르트气泡饮 · 原味', yogurt_muscat: '요구르트气泡饮 · 香印青提',
    coins: '农场币'
  };

  function isKO(m) { return !!(m && m.stage && m.stage !== 'group'); }
  function lottoOpen(m) { return matchState(m) === 'upcoming'; }   // entry until kickoff
  function fbReady() { return !!(window.Farm && Farm.fb && Farm.fb.available && Farm.fb.db); }
  function lottoUser() {
    if (!window.Farm || !Farm.fbAuth || !Farm.fbAuth.isLoggedIn || !Farm.fbAuth.isLoggedIn()) return null;
    var u = Farm.fbAuth.currentUser || {}, md = Farm.fbAuth.memberDoc || {};
    var authUid = (Farm.fbAuth.uid && Farm.fbAuth.uid()) || u.uid;
    return {
      uid: authUid,
      memberId: (Farm.fbAuth.memberDocId && Farm.fbAuth.memberDocId()) || authUid,  // 推送 token 挂在会员文档
      name: md.name || md.username || u.displayName || '会员',
      phone: u.phoneNumber || md.phone || ''
    };
  }

  function lottoPrizeLine() {
    return '<div class="wc-lotto-prizes">竞猜参与，人人有礼！</div>';
  }
  function lottoCard(title, bodyHtml, sub) {
    return '<div class="wc-lotto-card">' +
      '<div class="wc-lotto-head"><span class="wc-lotto-tag">竞猜有礼</span>' + esc(title) + '</div>' +
      (sub || '') + bodyHtml + '</div>';
  }
  function teamPickBtn(m, code) {
    return '<button class="wc-lotto-pick" data-team="' + esc(code) + '">' +
      '<span class="fl">' + (flag(code) || '⚽') + '</span>' +
      '<span class="nm">' + esc(isTeam(code) ? cn(code) : placeholderLabel(code)) + '</span></button>';
  }
  function lottoFormHtml(m) {
    return lottoCard('猜谁晋级?',
      '<div class="wc-lotto-picks">' + teamPickBtn(m, m.home) + '<span class="wc-lotto-vs">VS</span>' + teamPickBtn(m, m.away) + '</div>' +
      '<button class="wc-lotto-submit" disabled>提交竞猜</button>',
      lottoPrizeLine());
  }
  function lottoEnteredHtml(m, entry) {
    var picked = entry.pickedTeam;
    return lottoCard('已参与 · 等开奖',
      '<div class="wc-lotto-mypick">你猜 <span class="fl">' + (flag(picked) || '⚽') + '</span> <b>' +
        esc(isTeam(picked) ? cn(picked) : placeholderLabel(picked)) + '</b> 晋级</div>' +
      '<div class="wc-lotto-wait">赛后揭晓 · 好礼见这里 🎁</div>', '');
  }
  // ---- 中奖结果卡(转盘转完 / 再次打开时显示) ----
  function lottoResultCard(win) {
    var phys = win.prize && win.prize !== 'coins';
    var doneTag = '<div class="wc-lotto-done-tag">✅ 本场已参与</div>';
    if (phys) {
      return '<div class="wc-lotto-card win">' + doneTag +
        '<div class="wc-lotto-win-h">🎉 您已抽中实物!</div>' +
        '<div class="wc-lotto-prize">🎁 ' + esc(PRIZE_CN[win.prize] || win.prize) + '</div>' +
        (win.couponCode ? '<div class="wc-lotto-code">兑奖码 <b>' + esc(win.couponCode) + '</b></div>' : '') +
        '<div class="wc-lotto-redeem">' + (win.redeemed ? '✓ 已核销' : (win.couponCode ? '到东方超市收银处出示此码领取 · 也可在「我的奖品」查看' : '兑奖码稍后在「我的奖品」查看')) + '</div>' +
        (win.coins ? '<div class="wc-lotto-coins">外加 <span class="coin-icon"></span> ' + win.coins + ' 农场币已到账</div>' : '') +
        '</div>';
    }
    return '<div class="wc-lotto-card win coins">' + doneTag +
      '<div class="wc-lotto-win-h">您已参与，获得 <span class="coin-icon"></span> ' + (win.coins || 1000) + ' 农场币!</div>' +
      '<div class="wc-lotto-redeem">已自动到账 · 回农场种菜用得上</div></div>';
  }

  // ---- 好礼过渡卡(报名即得:提交后先报喜,点击进入转盘揭晓礼物)----
  function lottoChanceGate() {
    return '<div class="wc-lotto-card wc-gate">' +
      '<div class="wc-gate-emoji">🎉</div>' +
      '<div class="wc-gate-h">参与成功！</div>' +
      '<div class="wc-gate-sub">您的专属好礼已就绪</div>' +
      '<button class="wc-lotto-submit wc-gate-go" type="button">🎡 立即开启</button>' +
    '</div>';
  }
  function showChanceThenWheel(el, m, win, u) {
    el.innerHTML = lottoChanceGate();
    var go = el.querySelector('.wc-gate-go');
    if (go) go.onclick = function () { el.innerHTML = wheelStageHtml(win); wireWheel(el, m, win, u); };
  }

  // ---- 幸运转盘(揭晓动画;结果由后台报名即抽时定好,转盘必停在真奖)----
  // 6 格,顺序须与 worldcup.css 里 conic-gradient 一致(从 0° 顺时针):
  // 0 绿=龙角散 / 1 金=1000币 / 2 琥珀=沙琪玛 / 3 红=气泡饮原味 / 4 金=2000币 / 5 浅绿=气泡饮青提
  var WHEEL_SEGS = [
    { key: 'ryukakusan',    label: '龙角散',       img: 'ryukakusan.png',    emoji: '🫙', dark: true },
    { key: 'coins1000',     label: '农场币<br><b class="amt">1000</b>', coin: true, dark: false },
    { key: 'shaqima',       label: '沙琪玛',       img: 'shaqima.png',       emoji: '🍪', dark: true },
    { key: 'yogurt_orig',   label: '气泡饮·原味',  img: 'yogurt_orig.png',   emoji: '🥤', dark: true },
    { key: 'coins2000',     label: '农场币<br><b class="amt">2000</b>', coin: true, dark: false },
    { key: 'yogurt_muscat', label: '气泡饮·青提',  img: 'yogurt_muscat.png', emoji: '🍇', dark: true }
  ];
  function wheelTargetIndex(win) {
    var p = win.prize;
    if (p === 'ryukakusan') return 0;
    if (p === 'shaqima') return 2;
    if (p === 'yogurt_orig') return 3;
    if (p === 'yogurt_muscat') return 5;
    return (win.coins && win.coins >= 2000) ? 4 : 1;   // coins
  }
  function wheelStageHtml(win) {
    var labs = '';
    for (var i = 0; i < 6; i++) {
      var s = WHEEL_SEGS[i], home = i * 60 + 30;
      var icon = s.coin
        ? '<span class="wc-wheel-coin"><span class="coin-icon"></span></span>'
        : '<img class="wc-wheel-photo" src="assets/worldcup/prizes/' + s.img + '" alt="">' +
          '<span class="wc-wheel-emoji">' + s.emoji + '</span>';
      labs += '<div class="wc-wheel-lab" style="transform:rotate(' + home + 'deg) translateY(calc(-1 * var(--wc-wheel-r)))">' +
                '<div class="li" data-home="' + home + '" style="transform:translate(-50%,-50%) rotate(' + (-home) + 'deg)">' +
                  '<span class="ic">' + icon + '</span>' +
                  '<span class="tx ' + (s.dark ? 'on-dark' : 'on-light') + '">' + s.label + '</span>' +
                '</div></div>';
    }
    var dots = '';
    for (var d = 0; d < 12; d++)
      dots += '<i class="wc-wheel-dot" style="transform:translate(-50%,-50%) rotate(' + (d * 30) + 'deg) translateY(calc(-1 * var(--wc-wheel-dotr)))"></i>';
    var head = win.correct ? '🎯 你猜中了晋级队,好礼加码!' : '🎁 转一转,揭晓你的专属好礼';
    return '<div class="wc-lotto-card wc-wheel-card">' +
      '<div class="wc-wheel-title">🎡 好礼转盘 · 揭晓你的礼物</div>' +
      '<div class="wc-wheel-sub">' + head + '</div>' +
      '<div class="wc-wheel-stage">' +
        '<i class="wc-wheel-ptr"></i>' +
        '<div class="wc-wheel-ring">' + dots +
          '<div class="wc-wheel-disc"></div>' +
          '<div class="wc-wheel-labels">' + labs + '</div>' +
          '<button class="wc-wheel-hub" type="button"><span class="go">GO</span><span class="gs">点击转动</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="wc-wheel-result" style="display:none"></div>' +
    '</div>';
  }
  function wireWheel(el, m, win, u) {
    // 默认先显 emoji,照片加载成功才换上(永不出现破图)
    Array.prototype.forEach.call(el.querySelectorAll('.wc-wheel-photo'), function (img) {
      if (img.complete && img.naturalWidth > 0) img.classList.add('ok');
      else img.onload = function () { this.classList.add('ok'); };
    });
    var disc = el.querySelector('.wc-wheel-disc');
    var layer = el.querySelector('.wc-wheel-labels');
    var hub = el.querySelector('.wc-wheel-hub');
    var lis = el.querySelectorAll('.wc-wheel-lab .li');
    if (!disc || !layer || !hub) return;
    var idx = wheelTargetIndex(win);
    hub.addEventListener('click', function () {
      if (hub._spun) return; hub._spun = true;
      hub.classList.add('spinning'); hub.disabled = true;
      var R = 360 * 6 - (idx * 60 + 30);   // 中奖格正中停在顶部指针下
      var T = 'transform 4.4s cubic-bezier(.15,.72,.18,1)';
      disc.style.transition = T; disc.style.transform = 'rotate(' + R + 'deg)';
      layer.style.transition = T; layer.style.transform = 'rotate(' + R + 'deg)';
      Array.prototype.forEach.call(lis, function (li) {
        var home = parseFloat(li.getAttribute('data-home')) || 0;
        li.style.transition = T;
        li.style.transform = 'translate(-50%,-50%) rotate(' + (-home - R) + 'deg)';  // 反向自转保持正立
      });
      var done = function () { disc.removeEventListener('transitionend', done); revealResult(el, m, win, u); };
      disc.addEventListener('transitionend', done);
      setTimeout(done, 4900);   // 兜底
    });
  }
  function revealResult(el, m, win, u) {
    if (el._revealed) return; el._revealed = true;
    lottoMarkReveal(u.memberId, m.id);
    var box = el.querySelector('.wc-wheel-result');
    if (box) { box.innerHTML = lottoResultCard(win); box.style.display = ''; }
    var hub = el.querySelector('.wc-wheel-hub');
    if (hub) { var g = hub.querySelector('.go'), s = hub.querySelector('.gs'); if (g) g.textContent = '🎉'; if (s) s.textContent = '已揭晓'; }
    try { if (Farm.audio && Farm.audio.play) Farm.audio.play('coin'); } catch (e) {}
    if (typeof miniConfetti === 'function') miniConfetti();
    if (box && box.scrollIntoView) try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
  }
  // 把中奖农场币加到本地存档:币不存 farm_players(隐私),后台只写 win 文档。
  // 按 localStorage 记的已发额做幂等增量 —— 兼顾赛后「猜对追加」(1000→2000 只补差额)。
  function lottoCreditKey(uid, id) { return 'wc_lotto_cr_' + uid + '_' + id; }
  function lottoApplyWin(uid, m, win) {
    try {
      if (!win || !win.coins || !uid || !m) return;
      if (!window.Farm || !Farm.state || !Farm.state.addCoins) return;
      var k = lottoCreditKey(uid, m.id);
      var had = Number(localStorage.getItem(k)) || 0;
      var delta = (win.coins || 0) - had;
      if (delta > 0) { Farm.state.addCoins(delta); localStorage.setItem(k, String(win.coins)); }
    } catch (e) {}
  }

  function lottoRevealKey(uid, id) { return 'wc_lotto_rv_' + uid + '_' + id; }
  function lottoSeenReveal(uid, id) { try { return localStorage.getItem(lottoRevealKey(uid, id)) === '1'; } catch (e) { return false; } }
  function lottoMarkReveal(uid, id) { try { localStorage.setItem(lottoRevealKey(uid, id), '1'); } catch (e) {} }

  function lottoRender(el, m) {
    if (!el || !isKO(m)) { if (el) el.style.display = 'none'; return; }
    if (!fbReady()) {   // standalone / no Firebase → funnel into the farm (goal: pull players in)
      el.innerHTML = lottoCard('会员竞猜有礼 · 人人有份',
        '<a class="wc-lotto-btn" href="index.html">进农场登录参与 ›</a>', lottoPrizeLine());
      return;
    }
    var u = lottoUser();
    if (!u) {
      el.innerHTML = lottoCard('会员竞猜有礼 · 人人有份',
        '<button class="wc-lotto-btn" data-act="login">登录参与 ›</button>', lottoPrizeLine());
      var b = el.querySelector('[data-act="login"]');
      if (b) b.onclick = function () { if (Farm.fbAuth && Farm.fbAuth.openLoginModal) Farm.fbAuth.openLoginModal(); };
      return;
    }
    // 会员专属:登录了但手机号不在会员库(memberDoc 为空)→ 不放行,引导用会员手机号登录。
    // 这样奖品永远绑在稳定的会员账号上,不会像非会员临时号那样事后找不回(Chris 踩过)。
    if (!(Farm.fbAuth && Farm.fbAuth.memberDoc)) {
      el.innerHTML = lottoCard('会员专属 · 竞猜有礼',
        '<div class="wc-lotto-closed">🎁 竞猜有礼是东方超市会员专属福利<br>请用你在东方超市登记的会员手机号登录参与</div>' +
        '<button class="wc-lotto-btn" data-act="login">用会员手机号登录 ›</button>', lottoPrizeLine());
      var bm = el.querySelector('[data-act="login"]');
      if (bm) bm.onclick = function () { if (Farm.fbAuth && Farm.fbAuth.openLoginModal) Farm.fbAuth.openLoginModal(); };
      return;
    }
    el.innerHTML = '<div class="wc-lotto-card"><div class="wc-lotto-wait">载入中…</div></div>';
    // 「我的中奖」由 wcLotteryMine 按稳定会员身份(server 解析)返回 —— 手机/邮箱登录都归一处,奖品不错位。
    lottoLoadMine().then(function (mine) {
      var win = mine[m.id] || null;
      if (win) {
        lottoApplyWin(u.memberId, m, win);   // 到账/补差额(幂等)
        if (lottoSeenReveal(u.memberId, m.id)) { el.innerHTML = lottoResultCard(win); }
        else { showChanceThenWheel(el, m, win, u); }   // 已报名未揭晓 → 重新进入「过渡卡→转盘」
        return;
      }
      if (!lottoOpen(m)) { el.innerHTML = lottoCard('竞猜有礼', '<div class="wc-lotto-closed">本场参与已截止 ⏱</div>', lottoPrizeLine()); return; }
      if (!isTeam(m.home) || !isTeam(m.away)) { el.innerHTML = lottoCard('竞猜有礼', '<div class="wc-lotto-closed">对阵未定 · 双方确定后开放竞猜</div>', lottoPrizeLine()); return; }
      el.innerHTML = lottoFormHtml(m);
      wireLottoForm(el, m, u);
    });
  }

  // 「我的中奖」缓存:调一次 wcLotteryMine 拿全部场次的 win(按会员身份),hub 内复用。
  var lottoMineCache = null, lottoMinePromise = null;
  function lottoAllIds() {
    var ids = (data.matches || []).filter(isKO).map(function (m) { return m.id; });
    ids.push('final-sweep');
    return ids;
  }
  function lottoLoadMine(force) {
    if (!force && lottoMineCache) return Promise.resolve(lottoMineCache);
    if (lottoMinePromise) return lottoMinePromise;
    var fn = Farm.fb && Farm.fb.callable && Farm.fb.callable('wcLotteryMine');
    if (!fn) return Promise.resolve(lottoMineCache || {});
    lottoMinePromise = fn({ ids: lottoAllIds() })
      .then(function (resp) {
        lottoMineCache = (resp && resp.data && resp.data.wins) || {};
        lottoMinePromise = null; return lottoMineCache;
      })
      .catch(function (e) { lottoMinePromise = null; console.warn('[wc-lotto mine]', e); return lottoMineCache || {}; });
    return lottoMinePromise;
  }

  // 云函数错误 → 顾客能懂的中文(后端显式抛的中文提示优先沿用,技术性错误码翻译)
  function lottoErrMsg(e) {
    var code = (e && e.code) ? String(e.code) : '';
    var msg = (e && e.message) ? String(e.message) : '';
    var hasZh = /[一-龥]/.test(msg);
    if (/resource-exhausted|failed-precondition|invalid-argument|not-found/.test(code) && hasZh) return msg;
    if (/unauthenticated/.test(code)) return '请先登录会员再参与';
    if (/permission-denied/.test(code)) return '暂无参与权限,请确认已登录会员';
    if (/unavailable|deadline-exceeded|internal|cancelled/.test(code)) return '网络不太稳,请稍后再试一次';
    return hasZh ? msg : '提交失败,请重试';
  }

  function wireLottoForm(el, m, u) {
    var picked = null;
    Array.prototype.forEach.call(el.querySelectorAll('.wc-lotto-pick'), function (btn) {
      btn.onclick = function () {
        picked = btn.getAttribute('data-team');
        Array.prototype.forEach.call(el.querySelectorAll('.wc-lotto-pick'), function (b) { b.classList.toggle('sel', b === btn); });
        var sub = el.querySelector('.wc-lotto-submit'); if (sub) sub.disabled = false;
      };
    });
    var sub = el.querySelector('.wc-lotto-submit');
    if (sub) sub.onclick = function () {
      if (!picked) return;
      if (!lottoOpen(m)) { if (Farm.ui) Farm.ui.toast('报名已截止'); lottoRender(el, m); return; }
      var fn = Farm.fb && Farm.fb.callable && Farm.fb.callable('wcLotteryEnter');
      if (!fn) { if (Farm.ui) Farm.ui.toast('暂时无法参与,请稍后重试'); return; }
      sub.disabled = true; sub.textContent = '好礼准备中…';
      // 报名即抽:服务器原子抽奖(扣库存+发币),返回奖品 → 直接进入「抽奖机会→转盘」
      fn({ matchId: m.id, pickedTeam: picked, name: u.name, phone: u.phone })
        .then(function (resp) {
          var win = (resp && resp.data) ? resp.data : {};
          if (!lottoMineCache) lottoMineCache = {};
          lottoMineCache[m.id] = { matchId: m.id, prize: win.prize, coins: win.coins || 0,
            couponCode: win.couponCode || null, correct: null, redeemed: false };
          lottoApplyWin(u.memberId, m, win);   // 底币立即到账(幂等)
          try { if (Farm.audio) Farm.audio.play('coin'); } catch (e) {}
          try { if (Farm.push && Farm.push.maybePromptAfterHarvest) Farm.push.maybePromptAfterHarvest(); } catch (e) {}
          showChanceThenWheel(el, m, win, u);
        })
        .catch(function (e) {
          sub.disabled = false; sub.textContent = '提交竞猜';
          if (Farm.ui) Farm.ui.toast(lottoErrMsg(e)); console.warn('[wc-lotto]', e);
        });
    };
  }

  // ---- 我的奖品 / 兑奖码(调 wcLotteryMine,按稳定会员身份返回全部中奖,手机/邮箱登录都看得到)----
  function loadMyPrizes() {
    return lottoLoadMine(true).then(function (mine) {
      var rows = Object.keys(mine || {}).map(function (id) { return mine[id]; });
      return { rows: rows, failed: 0 };
    }).catch(function () { return { rows: [], failed: 1 }; });
  }
  function mpMatchLabel(id) {
    if (id === 'final-sweep') return '决赛清仓好礼';
    var m = matchById(id);
    if (!m) return '淘汰赛';
    return cn(m.home) + ' vs ' + cn(m.away);
  }
  function myPrizesHtml(rows, failed) {
    var note = failed ? '<div class="wc-mp-note">⚠️ 有 ' + failed + ' 条记录暂时没加载出来,请关闭重开或稍后再看</div>' : '';
    var h = '<div class="wc-mp-h">🎁 我的奖品</div>';
    if (!rows.length) {
      return h + note + '<div class="wc-mp-empty">还没有领奖记录~<br>多参与淘汰赛竞猜有礼，人人有份！🎁</div>';
    }
    var phys = rows.filter(function (r) { return r.prize && r.prize !== 'coins'; });
    var coinsTotal = rows.reduce(function (s, r) { return s + (r.coins || 0); }, 0);
    // 概览
    h += '<div class="wc-mp-summary">共参与 <b>' + rows.length + '</b> 次 · 🪙 累计 <b>' + coinsTotal + '</b> 农场币' +
      (phys.length ? ' · 🎁 <b>' + phys.length + '</b> 件实物' : '') + '</div>';
    // 每一次抽中的明细:待领实物排最前(要行动),已核销实物 + 农场币随后
    var ordered = rows.slice().sort(function (a, b) {
      var rank = function (r) { var p = r.prize && r.prize !== 'coins'; return p ? (r.redeemed ? 1 : 0) : 2; };
      return rank(a) - rank(b);
    });
    h += '<div class="wc-mp-sub">📋 全部抽中记录</div>';
    ordered.forEach(function (r) {
      var isPhys = r.prize && r.prize !== 'coins';
      var head = '<div class="wc-mp-rec-m">' + esc(mpMatchLabel(r.matchId)) +
        (r.correct ? ' <span class="wc-mp-correct">🎯 猜中</span>' : '') + '</div>';
      if (isPhys) {
        h += '<div class="wc-mp-item' + (r.redeemed ? ' done' : '') + '">' + head +
          '<div class="wc-mp-pz">🎁 ' + esc(PRIZE_CN[r.prize] || r.prize) + '</div>' +
          '<div class="wc-mp-code">' + (r.couponCode ? esc(r.couponCode) : '生成中…') + '</div>' +
          '<div class="wc-mp-st">' + (r.redeemed ? '✓ 已核销' : (r.couponCode ? '待领取 · 到店出示此码' : '兑奖码生成中,请稍后刷新')) + '</div>' +
        '</div>';
      } else {
        h += '<div class="wc-mp-coinrec">' + head +
          '<div class="wc-mp-rec-p"><span class="coin-icon"></span> ' + (r.coins || 0) + ' 农场币 · 已到账农场</div>' +
        '</div>';
      }
    });
    return h + note;
  }
  function openMyPrizes() {
    if (!hub) return;
    if (!fbReady()) { if (Farm.ui && Farm.ui.toast) Farm.ui.toast('请在农场里打开观赛台查看奖品'); return; }
    var u = lottoUser();
    if (!u) {
      if (Farm.fbAuth && Farm.fbAuth.openLoginModal) Farm.fbAuth.openLoginModal();
      else if (Farm.ui && Farm.ui.toast) Farm.ui.toast('请先登录会员再查看奖品');
      return;
    }
    var ov = document.createElement('div');
    ov.className = 'wc-mp-overlay';
    ov.innerHTML = '<div class="wc-mp-card"><button class="wc-mp-close" aria-label="关闭">✕</button>' +
      '<div class="wc-mp-body"><div class="wc-mp-empty">载入中…</div></div></div>';
    hub.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.onclick = function (e) { if (e.target === ov) close(); };
    var cb = ov.querySelector('.wc-mp-close'); if (cb) cb.onclick = close;
    loadMyPrizes(u).then(function (res) {
      var body = ov.querySelector('.wc-mp-body'); if (body) body.innerHTML = myPrizesHtml(res.rows, res.failed);
    }).catch(function () {
      var body = ov.querySelector('.wc-mp-body'); if (body) body.innerHTML = '<div class="wc-mp-empty">载入失败,请稍后重试</div>';
    });
  }

  /* ============================================================
     STANDINGS
     ============================================================ */
  function renderStandings() {
    var root = hub.querySelector('#wc-standings');
    var html = liveStamp() +
      '<div class="wc-legend">' +
        '<i><span class="dot" style="background:var(--wc-pitch)"></span>小组第1 → 16强</i>' +
        '<i><span class="dot" style="background:var(--wc-pitch-soft)"></span>小组第2 → 16强</i>' +
        '<i><span class="dot" style="background:var(--wc-amber)"></span>第3名(争8席)</i>' +
      '</div>' +
      '<div class="wc-section-note">P 赛 / W 胜 / D 平 / L 负 / GF 进 / GA 失 / GD 净胜 / Pts 积分。Pts、GD 自动计算，按 积分→净胜球→进球→正面交锋 排序。' + (live && live.ok ? '实时计算。' : '截至 ' + dataDate() + '。') + '</div>';

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
    if (live && live.ok && live.standings[g]) return live.standings[g];   // live (from all 72 games)
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

  // Real R32 fixtures from ESPN (the OFFICIAL bracket draw), in BRACKET-TREE order.
  // The bracket renders by adjacency — every round pairs slots (2i, 2i+1) — so the 16
  // R32 fixtures must be listed top→bottom in true bracket-tree leaf order, NOT kickoff
  // order. Kickoff order was the old bug: it put M073(RSA/CAN) and M074(BRA/JPN) adjacent,
  // wrongly pairing them in the Round of 16. Officially they sit in the same QUARTER and
  // can meet no earlier than the quarter-final.
  // Leaf order derived from the official FIFA 2026 match-number linkage (matches 73-88):
  //   R16: 89=(74,77) 90=(73,75) 91=(76,78) 92=(79,80) 93=(83,84) 94=(81,82) 95=(86,88) 96=(85,87)
  //   QF:  97=(89,90) 98=(93,94) 99=(91,92) 100=(95,96)   SF: 101=(97,98) 102=(99,100)   F: 104=(101,102)
  // (source: en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage, corroborated by FIFA.com & ESPN)
  // Slots not yet decided by the group stage carry placeholders like "1L"/"3RD".
  var BR_R32_ORDER = ['M074', 'M077', 'M073', 'M075', 'M083', 'M084', 'M081', 'M082',
                      'M076', 'M078', 'M079', 'M080', 'M086', 'M088', 'M085', 'M087'];
  function r32Matches() {
    var ms = (data.matches || []).filter(function (m) { return m.stage === 'r32'; });
    return ms.sort(function (a, b) {
      var ia = BR_R32_ORDER.indexOf(a.id), ib = BR_R32_ORDER.indexOf(b.id);
      if (ia !== -1 && ib !== -1) return ia - ib;                  // both in official tree order
      if (ia !== -1) return -1;                                    // known fixtures before any unknown
      if (ib !== -1) return 1;
      return new Date(a.kickoffUtc) - new Date(b.kickoffUtc);      // unknown ids: stable kickoff fallback
    });
  }
  function seedR32() {
    var r = r32Matches(), pairs = [];
    for (var i = 0; i < 16; i++) { var m = r[i]; pairs.push(m ? [m.home, m.away] : [null, null]); }
    return pairs;
  }
  // Real winner of a played knockout match (null if undecided / drawn-pending-PK).
  function koWinner(m) {
    if (!m) return null;
    var s = score(m);
    if (!(m.officialFinal && s)) return null;
    if (s[0] > s[1]) return m.home;
    if (s[1] > s[0]) return m.away;
    return null;
  }

  function renderBracket() {
    var root = hub.querySelector('#wc-bracket');
    var r32 = seedR32();
    var ties = {};
    r32.forEach(function (p, i) { ties['r32-' + i] = { a: p[0], b: p[1] }; });

    // Real results lock R32 winners (auto-advance, not user-editable).
    var r32m = r32Matches(), decided = {};
    r32m.forEach(function (m, i) { var w = koWinner(m); if (w) decided['r32-' + i] = w; });
    function pick(tie) { return decided[tie] || bracketPicks[tie] || null; }

    function slotsFor(ri) {
      var r = BR_ROUNDS[ri], out = [];
      for (var i = 0; i < r.n; i++) {
        var id = r.id + '-' + i;
        if (r.id === 'r32') out.push({ id: id, a: ties[id].a, b: ties[id].b });
        else {
          var prev = BR_ROUNDS[ri - 1].id;
          out.push({ id: id, a: pick(prev + '-' + (i * 2)), b: pick(prev + '-' + (i * 2 + 1)) });
        }
      }
      return out;
    }

    var cols = '';
    BR_ROUNDS.forEach(function (r, ri) {
      var isLast = ri === BR_ROUNDS.length - 1;
      var ties = slotsFor(ri).map(function (sl) {
        var locked = !!decided[sl.id];
        return '<div class="wc-tie' + (locked ? ' locked' : '') + '">' +
          slotHtml(sl, sl.a, pick(sl.id), locked) + slotHtml(sl, sl.b, pick(sl.id), locked) + '</div>';
      });
      var body;
      if (isLast) {
        body = ties.join('');                       // 决赛单框,不成对、无连线
      } else {
        body = '';                                  // 成对包起来 → 每对画一根竖线 + 引向下一轮
        for (var i = 0; i < ties.length; i += 2) body += '<div class="wc-pair">' + ties[i] + (ties[i + 1] || '') + '</div>';
      }
      cols += '<div class="wc-round' + (isLast ? ' final' : '') + '">' +
        '<div class="wc-round-lbl">' + r.lbl + '</div>' +
        '<div class="wc-round-body">' + body + '</div></div>';
    });

    var champ = pick('f-0');
    var picks = Object.keys(bracketPicks).length;
    root.innerHTML =
      '<div class="wc-section-note">采用<b>真实 16 强对阵</b>(来源 ESPN)。已打完的比赛自动锁定晋级者;未定的位置(如「L组第1」「小组第三」)小组赛结束后自动填入。点球队预测后续晋级,一路点到决赛预测你的冠军 — 预测只存本机。</div>' +
      '<div class="wc-bracket-bar">' +
        '<span class="wc-progress">你的预测 <b>' + picks + '</b> 场</span>' +
        '<button class="wc-reset" id="wcBrReset">↺ 重置预测</button>' +
      '</div>' +
      '<div class="wc-bracket-wrap"><div class="wc-bracket">' + cols + '</div></div>' +
      (champ ? '<div class="wc-champ"><span class="f">' + (flag(champ) || '🏆') + '</span>' + (decided['f-0'] ? '🏆 冠军' : '你的预测冠军') + '<br>' + esc(cn(champ)) + (en(champ) ? ' · ' + esc(en(champ)) : '') + '</div>' : '');

    Array.prototype.forEach.call(root.querySelectorAll('.wc-slot[data-team]'), function (sl) {
      sl.onclick = function () {
        var tie = sl.getAttribute('data-tie'), team = sl.getAttribute('data-team');
        if (decided[tie]) return;                 // real result — locked, not editable
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

  function slotHtml(sl, team, effPick, locked) {
    if (!team) return '<div class="wc-slot tbd">待定 TBD</div>';
    var picked = effPick === team;
    var label = isTeam(team) ? cn(team) : placeholderLabel(team);
    var fl = isTeam(team) ? flag(team) : '◦';
    return '<div class="wc-slot' + (picked ? ' picked' : '') + (locked ? ' locked' : '') + '" data-tie="' + esc(sl.id) + '" data-team="' + esc(team) + '">' +
      '<span class="fl">' + fl + '</span><span class="nm">' + esc(label) + '</span>' +
      (picked && locked ? '<span class="wc-slot-win">✓</span>' : '') + '</div>';
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
    // Standalone page: just open the hub full-screen; no splash entry / reentry button.
    if (WC_STANDALONE) { open(); return; }
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
