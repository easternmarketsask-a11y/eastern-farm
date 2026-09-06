/* identity-test.js — 「有没有登录」必须认真身份，不认「有没有 Firebase 账号」（由 cdp.mjs 注入）。

   2026-09-06 修的三条，全部钉在这里：
     ① 🔴 匿名 uid 没关联到任何会员档 → 不算登录。
        以前算：积分同步队列以为可以上传，拿匿名身份去入账 → 404 → 队列把 404
        当「永远不会成功」→ 整条队列丢弃。游客攒的积分就在「输个手机号」那一刻蒸发。
        顶栏也把访客画成「会员」，只有「退出登录」没有「登录」，人回不去。
     ② 🔴 注册成功那一刻激活码必须显示 —— 后端回什么就先用什么，再拉 whoami 兜底；
        whoami 偶发查空也不能把码冲掉。
     ③ 待激活档 totalPoints=0 不许把本地积分刷成 0。

   🔒 fetch / auth 全打桩，绝不真注册、不真登录、不发信。 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !window.__splashReady; i++) await sleep(100);
  for (let i = 0; i < 120 && !(window.Farm && Farm.fbAuth && Farm.ui
        && Farm.state && Farm.state.data && Farm.state.data.language); i++) {
    await sleep(100);
  }
  const A = window.Farm && Farm.fbAuth;
  if (!A) return { failures: ['Farm.fbAuth 没加载'] };
  const failures = [], ran = [];

  const savedUser = A.currentUser, savedDoc = A.memberDoc;
  const savedEp = Farm.state.data.eastPoints;
  const realFetch = window.fetch;
  const realQueueFlush = Farm.fbQueue && Farm.fbQueue.flush;
  let realAuthObj = null;
  let flushCalls = 0;
  try {
    // ── ① isLoggedIn 三态 ───────────────────────────────────────────────
    ran.push('isLoggedIn');
    A.currentUser = null; A.memberDoc = null;
    if (A.isLoggedIn()) failures.push('没账号也算登录');

    A.currentUser = { uid: 'anon1', isAnonymous: true };
    A.memberDoc = null;
    if (A.isLoggedIn()) failures.push('🔴 匿名 uid 没有会员档也被当成已登录（队列会拿它去入账然后 404 丢弃）');

    A.memberDoc = { id: 'ru_x', name: 'Nicole', totalPoints: 30 };
    if (!A.isLoggedIn()) failures.push('「手机号直接进」的匿名会员应算登录（否则 900 多人变游客）');

    A.memberDoc = { id: null, _pending: true, activationCode: '123456', totalPoints: 0 };
    if (!A.isLoggedIn()) failures.push('邮箱注册的待激活账号应算登录');

    A.currentUser = { uid: 'real1', isAnonymous: false, email: 'a@b.com' };
    A.memberDoc = null;
    if (!A.isLoggedIn()) failures.push('真账号（有凭据）就算会员档还没拉到也算登录');

    // 队列：匿名裸设备时 flush 必须直接返回，不打接口
    ran.push('队列不拿匿名去入账');
    A.currentUser = { uid: 'anon2', isAnonymous: true }; A.memberDoc = null;
    let hitEarn = false;
    window.fetch = async (url, opts) => {
      if (/\/earn|\/spend/.test(String(url))) { hitEarn = true; }
      return { ok: false, status: 404, json: async () => ({ detail: 'x' }) };
    };
    if (Farm.fbQueue && Farm.fbQueue.enqueue) {
      try { Farm.fbQueue.enqueue({ kind: 'earn', amount: 1, source: 'test', description: 't', eventId: 'ident-test-' + Date.now() }); } catch (_) {}
    }
    if (Farm.fbQueue && Farm.fbQueue.flush) { try { await Farm.fbQueue.flush(); } catch (_) {} }
    if (hitEarn) failures.push('🔴 匿名裸设备的队列还是被推上去了（404 会让整条队列被丢弃）');
    // 把测试塞进去的那条摘掉，别留给真玩家
    try {
      const q = Farm.fbQueue.read().filter(x => !String(x.eventId || '').startsWith('ident-test-'));
      Farm.fbQueue._write(q);
    } catch (_) {}

    // ── ③ 待激活档不刷积分 ──────────────────────────────────────────────
    ran.push('待激活不刷 0');
    Farm.state.data.eastPoints = 77;
    A.memberDoc = { id: null, _pending: true, totalPoints: 0, pendingPoints: 5 };
    A._syncLocalBalance();
    if (Farm.state.data.eastPoints !== 77) failures.push('🔴 待激活档把本地积分从 77 刷成了 ' + Farm.state.data.eastPoints);
    A.memberDoc = { id: 'ru_x', totalPoints: 12 };
    A._syncLocalBalance();
    if (Farm.state.data.eastPoints !== 12) failures.push('真会员档应照常同步余额（现在是 ' + Farm.state.data.eastPoints + '）');

    // ── ② 注册成功那一刻激活码要在 ─────────────────────────────────────
    ran.push('注册后激活码');
    const fakeReg = { uid: 'anonReg', isAnonymous: true, getIdToken: async () => 't', reload: async () => {} };
    A.currentUser = fakeReg;
    A.memberDoc = null;
    // _registerConfirm / _confirmClaim 读的是 Farm.fb.auth.currentUser（真 Firebase）。
    // 整个 auth 对象换成桩：绝不真的匿名登录、绝不真的发请求。
    realAuthObj = Farm.fb && Farm.fb.auth;
    if (Farm.fb) Farm.fb.auth = { currentUser: fakeReg, signInAnonymously: async () => {} };
    A._regName = '小测';
    A._view = 'regcode';
    // 屏上要有输入框给 _registerConfirm 读
    A._renderLoginModal(); await sleep(60);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('regCode', '123456'); set('regPw', 'abcdef123456');
    if (document.getElementById('regPw2')) set('regPw2', 'abcdef123456');

    // 后端：confirm 回激活码；whoami 第一次**故意查空**，模拟刚写入还没读到
    let whoamiCalls = 0;
    window.fetch = async (url) => {
      const u = String(url);
      if (u.indexOf('/register/confirm') >= 0) {
        return { ok: true, status: 200, json: async () => ({ ok: true, displayName: '小测', loginEmail: 'x@y.z', activationCode: '246810', codeExpiresAt: 9e12 }) };
      }
      if (u.indexOf('/whoami') >= 0) {
        whoamiCalls++;
        return { ok: true, status: 200, json: async () => ({ linked: false, pending: false }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    // Firestore 的三条查找也要落空（走到 whoami）
    const realDb = Farm.fb && Farm.fb.db;
    if (Farm.fb) Farm.fb.db = { collection: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      doc: () => ({ get: async () => ({ exists: false }) }),
    }) };
    if (Farm.fbQueue) Farm.fbQueue.flush = async () => { flushCalls++; };
    try { await A._registerConfirm(); } catch (e) { failures.push('注册提交抛异常：' + (e && e.message)); }
    if (Farm.fb) Farm.fb.db = realDb;
    const md = A.memberDoc || {};
    if (String(md.activationCode || '') !== '246810') failures.push('🔴 注册成功后激活码没在会员档里（拿到的是 ' + JSON.stringify(md.activationCode) + '）');
    if (!md._pending) failures.push('注册后的档应标 _pending（否则显示成「已同步的会员」和「欢迎回来」）');
    if (whoamiCalls < 1) failures.push('注册后没重拉 whoami 兜底');
    if (!A.isLoggedIn()) failures.push('注册完成后应算登录');

    // ── claim-phone 成功后要把队列推一次 ───────────────────────────────
    ran.push('认领后推队列');
    const fakeC = { uid: 'anonC', isAnonymous: true, getIdToken: async () => 't' };
    A.currentUser = fakeC;
    if (Farm.fb) Farm.fb.auth = { currentUser: fakeC, signInAnonymously: async () => {} };
    A.memberDoc = null; A._confirmDigits = '3062612802';
    A._view = 'confirm'; A._confirmName = 'Nicole'; A._renderLoginModal(); await sleep(60);
    window.fetch = async (url) => {
      const u = String(url);
      if (u.indexOf('/claim-phone') >= 0) return { ok: true, status: 200, json: async () => ({ ok: true, memberId: 'ru_x', name: 'Nicole' }) };
      if (u.indexOf('/whoami') >= 0) return { ok: true, status: 200, json: async () => ({ linked: true, memberId: 'ru_x', name: 'Nicole', points: 3, verified: false, hasEmail: true }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    if (Farm.fb) Farm.fb.db = { collection: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      doc: () => ({ get: async () => ({ exists: false }) }),
    }) };
    flushCalls = 0;
    try { await A._confirmClaim(); } catch (e) { failures.push('认领抛异常：' + (e && e.message)); }
    if (Farm.fb) Farm.fb.db = realDb;
    if (flushCalls < 1) failures.push('🔴 认领成功后没有推队列（游客攒的积分要等下次打开才上传）');
  } catch (e) {
    failures.push('抛异常：' + (e && e.message));
  } finally {
    window.fetch = realFetch;
    if (Farm.fb && typeof realAuthObj !== 'undefined' && realAuthObj) Farm.fb.auth = realAuthObj;
    if (Farm.fbQueue && realQueueFlush) Farm.fbQueue.flush = realQueueFlush;
    A.currentUser = savedUser; A.memberDoc = savedDoc;
    Farm.state.data.eastPoints = savedEp;
    try { Farm.ui.hideModal(); } catch (_) {}
    try { A._renderTopbar(); } catch (_) {}
  }
  return { ran, failures };
})();
