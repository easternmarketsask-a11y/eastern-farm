/* pending-points-test.js — 待激活账号的积分与云存档（由 cdp.mjs 注入）。

   登录审查 🟠 J / K / L（2026-09-06），三条全钉在这里：
     J  待激活账号花「待领取」积分：本地不许扣（那不是余额）；真会员被服务端
        明确拒绝（409/422）时本地要把扣掉的加回去 —— 以前本地照扣、服务端不认、
        下一笔挣分又把数刷回来 = 花多少长回多少。
     K  兑换走**排队补发**时，服务端只记一部分（待激活总额封顶）也要按实际记上的
        分退农场币。即时那条路早就退了，排队这条漏了 —— 币扣了分没给，是白花钱。
     L  待激活账号的存档写 farm_saves/{authUid}，**不写 members、不写 farm_players**
        （不进邻居世界）；恢复存档也从那里读。以前一次都没上传过，
        而注册屏正拿「云存档」当卖点在卖。

   🔒 fetch / Firestore 全打桩：不真入账、不真写库、不发请求。
   ⚠️ 顺序有讲究：fb-points 里任何一次非 2xx（含 409）都会让同步暂停 1 分钟
      （模块私有变量，测试碰不到），所以唯一那次 409 必须是全场**最后**一次请求。 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !window.__splashReady; i++) await sleep(100);
  for (let i = 0; i < 120 && !(window.Farm && Farm.fbAuth && Farm.ui && Farm.fbQueue && Farm.fbGameSync
        && Farm.state && Farm.state.data && Farm.state.data.language); i++) {
    await sleep(100);
  }
  const A = window.Farm && Farm.fbAuth, S = Farm.state, Q = Farm.fbQueue, G = Farm.fbGameSync;
  if (!A || !S || !Q || !G) return { failures: ['Farm.fbAuth / state / fbQueue / fbGameSync 没加载'] };
  if (!Farm.fb || !Farm.fb.available || !Farm.fb.db) {
    return { ran: [], failures: [], inconclusive: 'Firebase SDK 没起来，队列与云存档这一层测不了' };
  }
  const failures = [], ran = [];
  const saved = {
    user: A.currentUser, doc: A.memberDoc, ep: S.data.eastPoints, coins: S.data.coins,
    worldStamped: S.data.worldStamped, db: Farm.fb.db, fetch: window.fetch, queue: Q.read(),
  };
  const pendingUser = { uid: 'pp-anon', isAnonymous: true, getIdToken: async () => 't' };
  const pendingDoc = { id: null, _pending: true, totalPoints: 0, pendingPoints: 5, pendingCap: 500, hasEmail: true };

  // ── 桩：fetch 只拦积分接口 ──
  const calls = [];
  let reply = { ok: true, status: 200, body: {} };
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (/\/api\/rewardup\/me\/(earn|spend)/.test(u)) {
      let body = {};
      try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
      calls.push({ url: u, body });
      return { ok: reply.ok, status: reply.status, text: async () => '', json: async () => reply.body };
    }
    return saved.fetch(url, opts);
  };
  // ── 桩：Firestore 记录每一次写、按 store 回读 ──
  const writes = [];
  const store = {};
  const fakeDb = {
    collection(name) {
      return {
        doc(id) {
          const key = name + '/' + id;
          return {
            set: async (data, opts) => { writes.push({ name, id, data, opts }); },
            update: async (data) => { writes.push({ name, id, data, update: true }); },
            get: async () => ({ exists: !!store[key], id, data: () => store[key] }),
          };
        },
        where() { return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } }; },
      };
    },
    runTransaction: async () => false,
  };
  Farm.fb.db = fakeDb;
  const only = (name) => writes.filter(w => w.name === name);

  try {
    // ════ L：待激活账号的云存档 ════
    ran.push('L 待激活存档只进 farm_saves');
    A.currentUser = pendingUser; A.memberDoc = pendingDoc;
    S.data.worldStamped = true;              // 别让真会员分支去盖 worldJoinedAt
    writes.length = 0;
    const p1 = await G.push();
    if (!p1 || !p1.ok || !p1.pending) failures.push('🔴 待激活账号 push 没成功：' + JSON.stringify(p1) + '（以前这里直接 member_doc_unresolved，一次都没上传过）');
    const fs1 = only('farm_saves');
    if (!fs1.length) failures.push('🔴 没写 farm_saves');
    else {
      const w = fs1[0];
      if (w.id !== 'pp-anon') failures.push('farm_saves 文档 id 应是 auth uid，现在是 ' + w.id);
      if (!(w.data && w.data.gameSave && typeof w.data.gameSave.blob === 'string')) failures.push('farm_saves 里没有 gameSave.blob');
      const keys = Object.keys(w.data || {}).sort().join(',');
      if (keys !== 'gameSave,updatedAt') failures.push('farm_saves 只许 gameSave + updatedAt 两个字段（规则白名单），现在是 ' + keys);
    }
    if (only('members').length) failures.push('🔴 待激活账号写进了 members —— 正面违反「待激活绝不写进会员表」');
    if (only('farm_players').length) failures.push('🔴 待激活账号写进了 farm_players —— 不进邻居世界');

    ran.push('L 待激活从 farm_saves 恢复');
    delete store['farm_saves/pp-anon'];
    let r1 = await G.restoreFromCloud();
    if (!r1 || r1.reason !== 'no_cloud_save') failures.push('没存档时应回 no_cloud_save，现在是 ' + JSON.stringify(r1));
    store['farm_saves/pp-anon'] = { gameSave: { blob: JSON.stringify({ level: 1, totalHarvests: 0, cropsEverGrown: [] }), harvests: 0, clientAt: 1 } };
    r1 = await G.restoreFromCloud();
    if (!r1 || r1.reason !== 'cloud_blank') failures.push('🔴 待激活账号没去 farm_saves 读存档（期望 cloud_blank，得到 ' + JSON.stringify(r1) + '）');

    ran.push('L 刚激活的会员兜底读 farm_saves');
    A.memberDoc = { id: 'ru_pp', name: 'T', totalPoints: 0 };   // members 上还没有 gameSave
    r1 = await G.restoreFromCloud();
    if (!r1 || r1.reason !== 'cloud_blank') failures.push('members 没存档时应兜底读 farm_saves，得到 ' + JSON.stringify(r1));
    A.memberDoc = { id: 'ru_pp', name: 'T', totalPoints: 0, gameSave: { blob: JSON.stringify({ level: 1, totalHarvests: 0, cropsEverGrown: [] }), harvests: 0 } };
    store['farm_saves/pp-anon'] = { gameSave: { blob: JSON.stringify({ level: 9, totalHarvests: 999 }), harvests: 999 } };
    r1 = await G.restoreFromCloud();
    if (!r1 || r1.reason !== 'cloud_blank') failures.push('members 上有存档时必须以它为准，不许被 farm_saves 抢走（得到 ' + JSON.stringify(r1) + '）');

    ran.push('L 真会员不写 farm_saves');
    writes.length = 0;
    A.memberDoc = { id: 'ru_pp', name: 'T', totalPoints: 0 };
    await G.push();
    if (only('farm_saves').length) failures.push('真会员的存档跑进了 farm_saves');
    if (!only('members').length) failures.push('真会员 push 应写 members（现在一条没写）');

    // ════ K：排队补发的兑换按实际记上的分退币 ════
    ran.push('K 排队补发退币');
    A.currentUser = pendingUser; A.memberDoc = pendingDoc;
    Q._write([]);
    S.data.coins = 100;
    calls.length = 0;
    Q.enqueue({ kind: 'earn', amount: 20, source: 'coin_exchange', description: 't', eventId: 'pp-k1-' + Date.now() });
    reply = { ok: true, status: 200, body: { pending: true, credited: 5, new_balance: 5, pendingPoints: 5, pendingCap: 500 } };
    await Q.flush();
    if (calls.length !== 1) failures.push('K1 补发应打一次 earn，打了 ' + calls.length + ' 次');
    if (S.data.coins !== 250) failures.push('🔴 只记上 5 分却没退 150 币：coins=' + S.data.coins + '（期望 250）');
    if (Q.read().length !== 0) failures.push('补发成功后队列应清空，还剩 ' + Q.read().length);

    ran.push('K 全额记上不退');
    S.data.coins = 100; calls.length = 0;
    Q.enqueue({ kind: 'earn', amount: 20, source: 'coin_exchange', description: 't', eventId: 'pp-k2-' + Date.now() });
    reply = { ok: true, status: 200, body: { pending: true, credited: 20, new_balance: 25, pendingPoints: 25, pendingCap: 500 } };
    await Q.flush();
    if (S.data.coins !== 100) failures.push('全额记上却退了币：coins=' + S.data.coins);

    ran.push('K 非兑换来源不退');
    S.data.coins = 100; calls.length = 0;
    Q.enqueue({ kind: 'earn', amount: 20, source: 'harvest', description: 't', eventId: 'pp-k3-' + Date.now() });
    reply = { ok: true, status: 200, body: { pending: true, credited: 0, new_balance: 25, pendingPoints: 25, pendingCap: 500 } };
    await Q.flush();
    if (S.data.coins !== 100) failures.push('收获来源没扣过币，不该退：coins=' + S.data.coins);

    // ════ J：待激活不许花；真会员被拒要退回 ════
    ran.push('J 待激活不扣');
    A.currentUser = pendingUser; A.memberDoc = pendingDoc;
    S.data.eastPoints = 50; calls.length = 0;
    const ok1 = S.spendEastPoints(10, { source: 'ep_shop:test', description: 't' });
    if (ok1 !== false) failures.push('🔴 待激活账号花「待领取」积分居然成功了');
    if (S.data.eastPoints !== 50) failures.push('🔴 待激活账号本地被扣了：' + S.data.eastPoints);
    await sleep(120);
    if (calls.length) failures.push('待激活账号不该打 spend 接口');

    // 🔒 全场最后一次请求：409 会让 fb-points 暂停同步 1 分钟
    ran.push('J 真会员被拒退回');
    A.memberDoc = { id: 'ru_pp', name: 'T', totalPoints: 50 };
    S.data.eastPoints = 50; calls.length = 0;
    reply = { ok: false, status: 409, body: { detail: '这些是待领取积分，到店激活成会员后才能用' } };
    const ok2 = S.spendEastPoints(10, { source: 'ep_shop:test', description: 't' });
    if (ok2 !== true) failures.push('真会员本地有 50 分花 10 分应先放行');
    await sleep(300);
    if (calls.length !== 1) failures.push('应打一次 spend，打了 ' + calls.length);
    if (S.data.eastPoints !== 50) failures.push('🔴 服务端 409 拒绝后本地没退回：' + S.data.eastPoints + '（期望 50）');
    if (Q.read().some(x => x.kind === 'spend')) failures.push('409 是终局拒绝，不该进队列重试');
  } catch (e) {
    failures.push('抛异常：' + (e && (e.stack || e.message)));
  } finally {
    window.fetch = saved.fetch;
    Farm.fb.db = saved.db;
    A.currentUser = saved.user; A.memberDoc = saved.doc;
    S.data.eastPoints = saved.ep; S.data.coins = saved.coins; S.data.worldStamped = saved.worldStamped;
    try { Q._write(saved.queue); } catch (_) {}
    try { S.save(); } catch (_) {}
    try { Farm.ui.hideModal(); } catch (_) {}
  }
  return { ran, failures };
})();
