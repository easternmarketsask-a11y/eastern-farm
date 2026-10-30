/**
 * 今晚吃什么 · 一页。菜单和规则分开，这里只负责场面。
 * Firebase 只在领取时才加载，开火不等人家的脚本。
 */
(function () {
  const KEY = 'em.dinner.v1';
  const PENDING_KEY = 'em.dinner.pending.v1';
  const STOCKWISE = 'https://stockwise-app-873982544406.us-central1.run.app';
  const CLAIM_URL = 'https://us-central1-eastern-market-members.cloudfunctions.net/dinnerClaim';
  const FB_CONFIG = {
    apiKey: 'AIzaSyDDhVm_n_TyV2mtp517qUoLU4A9HB1k3No',
    authDomain: 'eastern-market-members.firebaseapp.com',
    projectId: 'eastern-market-members',
  };

  const stage = document.getElementById('stage');
  const hours = document.getElementById('hours');
  let menu = null;
  let pick = null;
  let save = null;
  let mode = 'official';
  let lock = false;
  let timer = null;
  let login = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.today !== pick.today) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function writeSave() {
    try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {}
  }

  function round() {
    return mode === 'practice' ? save.practice : save.official;
  }

  function ingredient(id) {
    return (menu.ingredients && menu.ingredients[id]) || { zh: id, en: id };
  }

  function secondsLeft(r) {
    const total = (menu.roundSeconds || 90) * 1000;
    return Math.max(0, Math.ceil((r.startedAt + total - Date.now()) / 1000));
  }

  function stopClock() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function showOpen() {
    stopClock();
    mode = 'official';
    stage.classList.remove('playing');
    const d = pick.dish;
    const coupon = ingredient(d.coupon);
    const sunday = pick.closed
      ? '<p class="invite">今天周日，店休。这是明天的菜，先把清单备好。</p>'
      : '';
    stage.innerHTML =
      '<h1>' + esc(d.name_zh) + '</h1>' +
      '<p class="latin">' + esc(d.name_en) + '</p>' +
      sunday +
      '<p class="invite">点对的下锅，不对的留下。做对了，下次买' + esc(coupon.zh) + '可以减 $1。</p>' +
      '<div class="wok-wrap">' + DinnerArt.wok() + '<div class="steam"></div></div>' +
      '<button type="button" class="fire" id="start">开火</button>' +
      pendingButton() +
      '<p class="step">' + esc(d.step_zh) + '</p>' +
      '<p class="en-line">' + esc(d.step_en) + '</p>';
    document.getElementById('start').onclick = startOfficial;
    const pend = document.getElementById('pendingGo');
    if (pend) pend.onclick = claimPending;
  }

  function readPending() {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.fromDate || data.fromDate >= pick.today) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function pendingButton() {
    const pend = readPending();
    if (!pend) return '';
    return '<button type="button" class="claim" id="pendingGo">先领昨天的减 $1</button>';
  }

  async function claimPending() {
    const pend = readPending();
    if (!pend) return;
    const btn = document.getElementById('pendingGo');
    if (btn) btn.disabled = true;
    let auth;
    try { auth = await ensureAuth(); } catch (e) {
      if (btn) btn.disabled = false;
      return;
    }
    if (!auth.currentUser) {
      if (btn) btn.disabled = false;
      btn.insertAdjacentHTML('afterend', '<p class="invite">先打完今天这锅。结果页用店里的手机号登录，昨天的减 $1 会一起算。</p>');
      return;
    }
    await submitClaim(auth, pend.body, true);
  }

  function startOfficial() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    save = {
      today: pick.today,
      official: freshRound(seed),
      practice: null,
    };
    writeSave();
    mode = 'official';
    showPlay();
  }

  function freshRound(seed) {
    return {
      dishId: pick.dish.id,
      seed: seed,
      order: DinnerRules.orderOf(pick.dish, seed),
      picks: [],
      startedAt: Date.now(),
      done: false,
      timedOut: false,
      judged: null,
    };
  }

  function startPractice() {
    save.practice = freshRound((Math.random() * 0xffffffff) >>> 0);
    writeSave();
    mode = 'practice';
    showPlay();
  }

  function showPlay() {
    stage.classList.add('playing');
    const r = round();
    if (!r || r.done) { showResult(); return; }
    if (secondsLeft(r) <= 0) { finish(true); return; }
    const index = r.picks.length;
    if (index >= r.order.length) { finish(false); return; }
    const id = r.order[index];
    const item = ingredient(id);
    const d = pick.dish;
    const left = secondsLeft(r);
    const seeds = r.order.map(function (_, i) {
      return '<i class="' + (i < index ? 'on' : '') + '"></i>';
    }).join('');
    stage.innerHTML =
      '<div class="play-top"><h1>' + esc(d.name_zh) + '</h1>' +
      '<div class="clock' + (left <= 15 ? ' hot' : '') + '" id="clock">油还热着 ' + left + '</div></div>' +
      '<div class="holding" aria-live="polite">' +
      DinnerArt.icon(id) +
      '<p class="iname">' + esc(item.zh) + '</p>' +
      '<p class="en-line">' + esc(item.en) + '</p></div>' +
      '<p class="note" id="note"></p>' +
      '<div class="board"><div class="pair">' +
      '<button type="button" class="take" id="take"><b>下锅</b><span>Into the wok</span></button>' +
      '<button type="button" class="leave" id="leave"><b>留下</b><span>Leave it</span></button>' +
      '</div><div class="seeds">' + seeds + '</div></div>';
    document.getElementById('take').onclick = function () { choose(true); };
    document.getElementById('leave').onclick = function () { choose(false); };
    stopClock();
    timer = setInterval(tick, 250);
  }

  function tick() {
    const r = round();
    if (!r || r.done) { stopClock(); return; }
    const left = secondsLeft(r);
    const clock = document.getElementById('clock');
    if (clock) {
      clock.textContent = '油还热着 ' + left;
      clock.classList.toggle('hot', left <= 15);
    }
    if (left <= 0) finish(true);
  }

  function choose(take) {
    if (lock) return;
    const r = round();
    if (!r || r.done) return;
    const index = r.picks.length;
    const id = r.order[index];
    const should = pick.dish.in.indexOf(id) !== -1;
    const ok = should === take;
    r.picks.push({ id: id, take: take });
    writeSave();
    const note = document.getElementById('note');
    if (note) note.textContent = ok ? '' : (take ? '这味不用下锅。' : '这味要下锅。');
    lock = true;
    document.querySelectorAll('.take, .leave').forEach(function (b) { b.disabled = true; });
    window.setTimeout(function () {
      lock = false;
      showPlay();
    }, ok ? 160 : 420);
  }

  function finish(timedOut) {
    stopClock();
    const r = round();
    r.timedOut = !!timedOut;
    r.done = true;
    r.judged = DinnerRules.judge(pick.dish, r.picks);
    writeSave();
    showResult();
  }

  function heats(stars) {
    return '<div class="heats" aria-label="' + stars + ' of 3">' +
      [1, 2, 3].map(function (n) { return DinnerArt.heat(n <= stars); }).join('') +
      '</div>';
  }

  function resultCopy(r) {
    const d = pick.dish;
    const coupon = ingredient(d.coupon);
    const stars = r.judged.stars;
    if (mode === 'practice') {
      return {
        zh: '这是再练的一锅，减 $1 以今天第一锅为准。',
        en: 'This pot is practice. Today’s $1 off stays with the first pot.',
      };
    }
    if (stars === 3) {
      return {
        zh: '全对。' + coupon.zh + '下次结账减 $1，你也进了本周六的菜篮抽奖。',
        en: 'All correct. $1 off ' + coupon.en + ' next time, and you’re in Saturday’s basket draw.',
      };
    }
    if (stars === 2) {
      return {
        zh: '大体做对了。' + coupon.zh + '下次结账减 $1。同一张券七天用一次。',
        en: 'Close enough. $1 off ' + coupon.en + ' next time. One coupon every seven days.',
      };
    }
    const slow = r.timedOut ? '时间到了，没来得及点的算错过。' : '这锅还差几样。';
    return {
      zh: slow + '清单留着，明天可以再来。',
      en: 'The list is yours. Come back tomorrow and try the pot again.',
    };
  }

  function showResult() {
    stopClock();
    stage.classList.remove('playing');
    const r = round();
    const d = pick.dish;
    const coupon = ingredient(d.coupon);
    const rows = d.in.map(function (id) {
      const item = ingredient(id);
      const seal = id === d.coupon && r.judged.dollar && mode === 'official'
        ? '<div class="seal">减<br>$1</div>'
        : '';
      return '<div class="row">' + DinnerArt.icon(id) +
        '<div><div class="nm">' + esc(item.zh) + '</div><div class="en">' + esc(item.en) + '</div></div>' +
        seal + '</div>';
    }).join('');
    const claimBlock = (mode === 'official' && r.judged.dollar)
      ? '<button type="button" class="claim" id="claim">把减 $1 记到会员</button><div id="claimBox"></div>'
      : '';
    const said = resultCopy(r);
    stage.innerHTML =
      '<article class="paper">' +
      '<h1>' + esc(d.name_zh) + '</h1>' +
      '<p class="latin">' + esc(d.name_en) + '</p>' +
      heats(r.judged.stars) +
      '<p class="lead">' + esc(said.zh) + '</p>' +
      '<p class="en-line">' + esc(said.en) + '</p>' +
      '<h2 class="list-title">今晚买这四样。</h2>' +
      rows +
      '<p class="fine">减 $1 的是' + esc(coupon.zh) + ' / ' + esc(coupon.en) +
      '。要和它出现在同一张小票上，每个会员七天一张，全店一天 20 张。</p>' +
      claimBlock +
      '<button type="button" class="ghost" id="again">再练一锅</button>' +
      (mode === 'practice' && save.official && save.official.done
        ? '<button type="button" class="ghost" id="backOfficial">看回今天的清单</button>'
        : '') +
      '<button type="button" class="ghost" id="share">发给家里人</button>' +
      '</article>';
    const again = document.getElementById('again');
    if (again) again.onclick = startPractice;
    const back = document.getElementById('backOfficial');
    if (back) back.onclick = function () { mode = 'official'; showResult(); };
    const share = document.getElementById('share');
    if (share) share.onclick = shareList;
    const claim = document.getElementById('claim');
    if (claim) claim.onclick = onClaim;
    if (save.claimNote) paintClaimNote(save.claimNote);
  }

  function shareList() {
    const d = pick.dish;
    const lines = d.in.map(function (id) { return ingredient(id).zh; }).join('、');
    const text = '今晚吃什么 · ' + d.name_zh + '\n' + d.name_en + '\n' + lines +
      '\n东方超市 Eastern Market\nhttps://farm.easternmarket.ca/src/dinner.html';
    if (navigator.share) {
      navigator.share({ title: d.name_zh, text: text }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        const btn = document.getElementById('share');
        if (btn) btn.textContent = '已经复制，可以贴到微信';
      }).catch(function () {});
    }
  }

  function paintClaimNote(text, isErr) {
    const box = document.getElementById('claimBox');
    if (!box) return;
    box.innerHTML = '<p class="' + (isErr ? 'err' : 'fine') + '">' + esc(text) + '</p>';
  }

  async function ensureAuth() {
    if (window.firebase && firebase.auth) {
      if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
      return firebase.auth();
    }
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js');
    firebase.initializeApp(FB_CONFIG);
    return firebase.auth();
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script')); };
      document.head.appendChild(s);
    });
  }

  async function onClaim() {
    const btn = document.getElementById('claim');
    if (btn) btn.disabled = true;
    paintClaimNote('正在记到会员上。');
    let auth;
    try {
      auth = await ensureAuth();
    } catch (e) {
      if (btn) btn.disabled = false;
      paintClaimNote('登录脚本没有载入。清单现在就能用，稍后再试领取。', true);
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      if (btn) btn.disabled = false;
      showPhone();
      return;
    }
    await submitClaim(auth);
  }

  function showPhone() {
    const box = document.getElementById('claimBox');
    if (!box) return;
    box.innerHTML =
      '<p class="fine">输入店里登记的 10 位手机号，减 $1 记在这个会员上。</p>' +
      '<div class="phone-row"><span>+1</span>' +
      '<input id="phone" inputmode="numeric" autocomplete="tel" maxlength="14" placeholder="306 123 4567"></div>' +
      '<button type="button" class="yes" id="phoneGo">继续</button>' +
      '<p class="err" id="phoneErr"></p>';
    document.getElementById('phoneGo').onclick = lookupPhone;
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }

  function digitsOf(value) {
    const d = String(value || '').replace(/\D/g, '');
    return d.length === 11 && d.charAt(0) === '1' ? d.slice(1) : d;
  }

  async function lookupPhone() {
    const input = document.getElementById('phone');
    const err = document.getElementById('phoneErr');
    const digits = digitsOf(input && input.value);
    if (digits.length !== 10) {
      err.textContent = '请输入区号加号码，一共 10 位。';
      return;
    }
    const go = document.getElementById('phoneGo');
    if (go) go.disabled = true;
    let auth;
    try {
      auth = await ensureAuth();
      if (!auth.currentUser) await auth.signInAnonymously();
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(STOCKWISE + '/api/public/member-auth/lookup-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ phone: digits }),
      });
      const data = await res.json().catch(function () { return null; });
      if (res.status === 429) {
        err.textContent = '刚试过了，请等一分钟再试。';
        if (go) go.disabled = false;
        return;
      }
      if (!res.ok || !data) {
        err.textContent = '没有查到会员。清单现在就能用，稍后再试。';
        if (go) go.disabled = false;
        return;
      }
      if (!data.found) {
        err.textContent = '这个号码还没在店里登记。清单照样能用。到店可以免费办会员，地址在页面最下面。';
        if (go) go.disabled = false;
        return;
      }
      login = { digits: digits, name: String(data.name || '').trim() };
      showConfirm();
    } catch (e) {
      err.textContent = '连接不上服务器，请再试一次。';
      if (go) go.disabled = false;
    }
  }

  function showConfirm() {
    const box = document.getElementById('claimBox');
    box.innerHTML =
      '<p class="fine">是你吗？</p>' +
      '<p class="who">' + esc(login.name || '这位会员') + '</p>' +
      '<button type="button" class="yes" id="yesMe">是我</button>' +
      '<button type="button" class="ghost" id="notMe">不是，我输错了</button>' +
      '<p class="err" id="phoneErr"></p>';
    document.getElementById('yesMe').onclick = confirmMe;
    document.getElementById('notMe').onclick = showPhone;
  }

  async function confirmMe() {
    const err = document.getElementById('phoneErr');
    const btn = document.getElementById('yesMe');
    if (btn) btn.disabled = true;
    try {
      const auth = await ensureAuth();
      if (!auth.currentUser) await auth.signInAnonymously();
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(STOCKWISE + '/api/public/member-auth/claim-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ phone: login.digits }),
      });
      const data = await res.json().catch(function () { return null; });
      if (!res.ok) {
        err.textContent = (data && data.detail) || '没有记上，请再试一次。';
        if (btn) btn.disabled = false;
        return;
      }
      await submitClaim(auth);
    } catch (e) {
      err.textContent = '连接不上服务器，请再试一次。';
      if (btn) btn.disabled = false;
    }
  }

  async function submitClaim(auth, preset, fromPending) {
    const r = save && save.official;
    const body = preset || {
      data: {
        date: pick.today,
        dishId: r.dishId,
        seed: r.seed,
        picks: r.picks,
      },
    };
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(CLAIM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      });
      if (res.status === 404 || res.status === 403) {
        rememberClaim('成绩已经记下。券码要等店里开通核销后才会显示在这里，清单现在就能用。');
        return;
      }
      const payload = await res.json().catch(function () { return null; });
      const result = payload && (payload.result || payload);
      if (!res.ok || !result) {
        rememberClaim('这次没有领到券。清单现在就能用，过一会儿再点一次。', true);
        return;
      }
      if (result.code) {
        try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
        rememberClaim('券码 ' + result.code + '。结账时报给收银，买' + ingredient(pick.dish.coupon).zh + '减 $1。');
        return;
      }
      if ((result.action === 'defer' || result.action === 'keep_pending') && !fromPending) {
        try {
          localStorage.setItem(PENDING_KEY, JSON.stringify({ fromDate: pick.today, body: body }));
        } catch (e) {}
      }
      const reasons = {
        weekly_used: '这七天里你已经用过一张减 $1 了。清单还能用。',
        defer: '今天的 20 张已经发完。你的成绩还在，明天开饭时这张优先。',
        keep_pending: '昨天没发出去的那张还排着。今天名额也满了，明天再领。',
        not_member: '这个账号还不是会员。到店报一下手机号，券才能记上。',
        none: '这一锅还没到减 $1。清单留着。',
      };
      rememberClaim(reasons[result.action] || reasons[result.reason] || '清单现在就能用。');
    } catch (e) {
      rememberClaim('成绩已经记下。券码要等店里开通核销后才会显示在这里，清单现在就能用。');
    }
  }

  function rememberClaim(text, isErr) {
    save.claimNote = text;
    writeSave();
    showResult();
    paintClaimNote(text, !!isErr);
  }

  document.addEventListener('keydown', function (ev) {
    if (!round() || round().done) return;
    if (ev.key === 'ArrowLeft' || ev.key === '1') choose(true);
    if (ev.key === 'ArrowRight' || ev.key === '2') choose(false);
  });

  hours.textContent = '周一至周六 10:00–18:30 · 133-412 Willowgrove Square';

  fetch('../data/dinner-menu.json')
    .then(function (res) {
      if (!res.ok) throw new Error('menu ' + res.status);
      return res.json();
    })
    .then(function (data) {
      menu = data;
      pick = DinnerRules.pickDish(menu, Date.now());
      save = loadSave();
      if (save && save.official && save.official.done) showResult();
      else if (save && save.official) showPlay();
      else showOpen();
    })
    .catch(function () {
      stage.innerHTML = '<p class="invite">今天的菜单没有送到。检查一下网络，再开一次。</p>';
    });
})();
