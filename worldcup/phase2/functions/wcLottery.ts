/* ============================================================
 * World Cup Lottery — Cloud Functions (2026, removable)
 * 项目:eastern-market-members   区域:us-central1   Node 18+
 * firebase-functions v2(与现有 onOrderStatusChange 一致)
 *
 * 三个导出:
 *   wcLotteryTick   — 定时(每 30 分钟):自动 seed 比赛文档 + 开奖 + 决赛清仓
 *   wcLotteryDrawNow— 可调用(admin):立刻跑一次(测试/手动催)
 *   wcLotterySetWinner— 可调用(admin):人工指定某场晋级队并强制开奖(ESPN 失灵兜底)
 *
 * 机制(方案 A):
 *   - 实物:全部 entries 纯随机抽,不看猜对猜错;名额 = quota + carry(滚存)
 *   - 农场币:人人 coinsBase(1000),猜对晋级队 coinsCorrectTotal(2000)
 *   - 决赛后所有 KO 场开完仍有库存 → 在所有参与者里清仓抽光
 *   - 幂等:claim 用 status 推进;发币用「中奖文档 + 玩家币」同事务,不重复发
 *
 * 真相源:
 *   - 赛程/队伍:拉部署站点 data/wc2026.json(KO 场次 + kickoff + 双方代码)
 *   - 终场/晋级队:ESPN 公共 API(competitors[].winner);可被人工覆盖
 * ============================================================ */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ---- 可调参数 ----
const REGION = 'us-central1';
const DATA_URL = 'https://farm.easternmarket.ca/data/wc2026.json';
const CONFIG_REF = () => db.collection('wc_lottery_config').doc('config');
const KICKOFF_GRACE_MS = 150 * 60 * 1000; // 开球后 2.5h 才视为「可能终场」去查 ESPN

// 实物奖品 key(与前端 PRIZE_CN 对齐)
const PRIZE_KEYS = ['shaqima', 'ryukakusan', 'yogurt_orig', 'yogurt_muscat'] as const;
type PrizeKey = typeof PRIZE_KEYS[number];

// 配置默认值(首次自动写入 wc_lottery_config/config;Chris 备货后可在控制台改)
const DEFAULT_CONFIG = {
  coinsBase: 1000,
  coinsCorrectTotal: 2000,
  perMatchQuota: 2,
  carryQuota: 0,
  sweepDone: false,
  stock: { shaqima: 22, ryukakusan: 35, yogurt_orig: 10, yogurt_muscat: 10 } as Record<PrizeKey, number>,
};

// ============================================================
// 工具
// ============================================================
function randInt(n: number) { return Math.floor(Math.random() * n); }
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function coupon(): string {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混字符
  let s = 'WC';
  for (let i = 0; i < 5; i++) s += c[randInt(c.length)];
  return s;
}
function ymd(d: Date): string {
  return '' + d.getUTCFullYear() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
}

async function loadFixtures(): Promise<any> {
  const r = await fetch(DATA_URL, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error('fetch wc2026.json ' + r.status);
  return r.json();
}

async function ensureConfig() {
  const ref = CONFIG_REF();
  const snap = await ref.get();
  if (!snap.exists) { await ref.set(DEFAULT_CONFIG); return DEFAULT_CONFIG; }
  return snap.data() as typeof DEFAULT_CONFIG;
}

/** ESPN:确认某场是否终场 + 晋级队代码(含点球)。codeA/codeB = 我们的队代码(== ESPN abbreviation) */
async function espnResult(kickoffUtc: string, codeA: string, codeB: string):
  Promise<{ found: boolean; final: boolean; winner?: string }> {
  const k = new Date(kickoffUtc);
  // 用 ±1 天窗口,避开 UTC 跨日分组
  const lo = new Date(k.getTime() - 86400000), hi = new Date(k.getTime() + 86400000);
  const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=' +
    ymd(lo) + '-' + ymd(hi);
  const r = await fetch(url);
  if (!r.ok) return { found: false, final: false };
  const j: any = await r.json();
  for (const ev of (j.events || [])) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) continue;
    const cs = comp.competitors || [];
    const abbrs = cs.map((c: any) => c.team && c.team.abbreviation);
    if (!abbrs.includes(codeA) || !abbrs.includes(codeB)) continue;
    const state = ev.status && ev.status.type && ev.status.type.state; // pre | in | post
    if (state !== 'post') return { found: true, final: false };
    let winner: string | undefined;
    const w = cs.find((c: any) => c.winner === true);
    if (w && w.team) winner = w.team.abbreviation;
    else {
      const a = cs.find((c: any) => c.team && c.team.abbreviation === codeA);
      const b = cs.find((c: any) => c.team && c.team.abbreviation === codeB);
      const sa = Number(a && a.score), sb = Number(b && b.score);
      if (!isNaN(sa) && !isNaN(sb) && sa !== sb) winner = sa > sb ? codeA : codeB;
    }
    return { found: true, final: true, winner }; // winner 可能 undefined(平局未决,暂不开)
  }
  return { found: false, final: false };
}

// ============================================================
// seed:为已确定双方的 KO 场写 wc_lottery/{id} 文档(deadline=kickoff)
// ============================================================
async function seedMatches(fixtures: any) {
  const teams = fixtures.teams || {};
  const isTeam = (c: string) => !!teams[c];
  const ko = (fixtures.matches || []).filter((m: any) => m.stage && m.stage !== 'group');
  for (const m of ko) {
    if (!isTeam(m.home) || !isTeam(m.away)) continue; // 双方未定,先不开放
    const ref = db.collection('wc_lottery').doc(m.id);
    const snap = await ref.get();
    if (snap.exists) continue;
    await ref.set({
      kickoffUtc: m.kickoffUtc,
      deadline: admin.firestore.Timestamp.fromDate(new Date(m.kickoffUtc)),
      stage: m.stage, home: m.home, away: m.away,
      status: 'open', createdAt: FieldValue.serverTimestamp(),
    });
  }
}

// ============================================================
// 单场开奖
// ============================================================
type Entry = { uid: string; name?: string; phone?: string; pickedTeam: string; createdAt?: any };

async function resolveMatch(matchId: string, kickoffUtc: string, home: string, away: string,
  forcedWinner?: string): Promise<string> {
  const mref = db.collection('wc_lottery').doc(matchId);
  const msnap = await mref.get();
  const mdoc = msnap.exists ? (msnap.data() as any) : {};
  if (mdoc.status === 'drawn') return 'already-drawn';

  // 1) 确认终场 + 晋级队
  let winnerTeam = forcedWinner || mdoc.actualWinnerTeam;
  if (!winnerTeam) {
    if (Date.now() < new Date(kickoffUtc).getTime() + KICKOFF_GRACE_MS) return 'too-early';
    const r = await espnResult(kickoffUtc, home, away);
    if (!r.found || !r.final || !r.winner) return 'not-final';
    winnerTeam = r.winner;
  }

  // 2) 读全部报名(deadline 后不可变,tx 外读安全);兜底剔除迟到报名
  const ksMs = new Date(kickoffUtc).getTime();
  const esnap = await mref.collection('entries').get();
  const entries: Entry[] = [];
  esnap.forEach((d) => {
    const e = d.data() as Entry;
    const t = e.createdAt && e.createdAt.toMillis ? e.createdAt.toMillis() : 0;
    if (!t || t <= ksMs) entries.push({ ...e, uid: d.id });
  });

  // 3) claim + 预留库存 + 落定中奖名单(事务,幂等核心)
  const result = await db.runTransaction(async (tx) => {
    const cfgSnap = await tx.get(CONFIG_REF());
    const cfg = (cfgSnap.exists ? cfgSnap.data() : DEFAULT_CONFIG) as typeof DEFAULT_CONFIG;
    const m2 = await tx.get(mref);
    const md = m2.exists ? (m2.data() as any) : {};
    if (md.status === 'drawn' || md.status === 'resolved') return md.resolved || { skip: true };

    const stock = { ...(cfg.stock || {}) } as Record<PrizeKey, number>;
    let remaining = PRIZE_KEYS.reduce((s, k) => s + (stock[k] || 0), 0);
    const slots = (cfg.perMatchQuota || 0) + (cfg.carryQuota || 0);
    const physN = Math.min(slots, remaining, entries.length);

    const pool = shuffle(entries.slice());
    const winners: any[] = [];
    for (let i = 0; i < physN; i++) {
      const e = pool[i];
      // 在仍有库存的奖品里按剩余量加权随机选一款
      const avail = PRIZE_KEYS.filter((k) => (stock[k] || 0) > 0);
      let pick: PrizeKey = avail[0];
      let r = randInt(avail.reduce((s, k) => s + stock[k], 0));
      for (const k of avail) { if (r < stock[k]) { pick = k; break; } r -= stock[k]; }
      stock[pick] -= 1; remaining -= 1;
      winners.push({ uid: e.uid, name: e.name || '', phone: e.phone || '', pickedTeam: e.pickedTeam,
        prize: pick, couponCode: coupon() });
    }
    const newCarry = slots - physN; // 没抽满的名额滚存

    const resolved = { winnerTeam, winners, coinsBase: cfg.coinsBase, coinsCorrectTotal: cfg.coinsCorrectTotal };
    tx.update(CONFIG_REF(), { stock, carryQuota: newCarry });
    tx.set(mref, { status: 'resolved', actualWinnerTeam: winnerTeam, resolved,
      drawnAt: FieldValue.serverTimestamp() }, { merge: true });
    return resolved;
  });

  if ((result as any).skip) { /* 另一次运行已 resolve,继续做发奖(幂等) */ }

  // 4) 发奖(逐人幂等):中奖文档 + farm_players 加币 同事务
  const failures = await payout(matchId, winnerTeam!, entries);

  // 5) 全部发完才标 drawn;有失败则留 resolved,下一个 tick 重试发奖
  if (failures === 0) { await mref.set({ status: 'drawn' }, { merge: true }); return 'drawn'; }
  return 'partial';
}

/** 逐 entry 发奖:实物者写 winner 文档;所有人加农场币。每人一个事务,已发过则跳过。
 *  返回失败人数(0 = 全部成功)。 */
async function payout(matchId: string, winnerTeam: string, entries: Entry[]): Promise<number> {
  const mref = db.collection('wc_lottery').doc(matchId);
  const md = (await mref.get()).data() as any;
  const resolved = md && md.resolved;
  if (!resolved) return 0;
  let failures = 0;
  const physByUid: Record<string, any> = {};
  for (const w of (resolved.winners || [])) physByUid[w.uid] = w;
  const coinsBase = resolved.coinsBase || 1000;
  const coinsCorrect = resolved.coinsCorrectTotal || 2000;

  for (const e of entries) {
    const correct = e.pickedTeam === winnerTeam;
    const coins = correct ? coinsCorrect : coinsBase;
    const phys = physByUid[e.uid];
    const wref = db.collection('wc_lottery_winners').doc(matchId).collection('w').doc(e.uid);
    const pref = db.collection('farm_players').doc(e.uid);
    try {
      await db.runTransaction(async (tx) => {
        const wsnap = await tx.get(wref);
        if (wsnap.exists && (wsnap.data() as any).paid) return; // 已发,跳过
        tx.set(wref, {
          uid: e.uid, name: e.name || '', phone: e.phone || '',
          matchId, correct, coins,
          prize: phys ? phys.prize : 'coins',
          couponCode: phys ? phys.couponCode : null,
          redeemed: false, paid: true, drawnAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(pref, { coins: FieldValue.increment(coins) }, { merge: true });
      });
    } catch (err) { failures++; console.error('[wc-lotto payout]', matchId, e.uid, err); }
  }
  return failures;
}

// ============================================================
// 决赛清仓:全部 KO 场 drawn 且仍有库存 → 在所有参与者里抽光
// ============================================================
async function finalSweep(fixtures: any) {
  const cfg = await ensureConfig();
  if (cfg.sweepDone) return;
  const teams = fixtures.teams || {};
  const koIds = (fixtures.matches || [])
    .filter((m: any) => m.stage && m.stage !== 'group' && teams[m.home] && teams[m.away])
    .map((m: any) => m.id);
  if (!koIds.length) return;
  // 所有 KO 场都开完了吗
  for (const id of koIds) {
    const s = await db.collection('wc_lottery').doc(id).get();
    if (!s.exists || (s.data() as any).status !== 'drawn') return;
  }
  const stock = { ...(cfg.stock || {}) } as Record<PrizeKey, number>;
  let remaining = PRIZE_KEYS.reduce((s, k) => s + (stock[k] || 0), 0);
  if (remaining <= 0) { await CONFIG_REF().set({ sweepDone: true }, { merge: true }); return; }

  // 收集所有参与过的 uid(去重),优先没中过实物的人
  const seen = new Map<string, Entry>();
  const wonPhysical = new Set<string>();
  for (const id of koIds) {
    const es = await db.collection('wc_lottery').doc(id).collection('entries').get();
    es.forEach((d) => { if (!seen.has(d.id)) seen.set(d.id, { ...(d.data() as Entry), uid: d.id }); });
    const ws = await db.collection('wc_lottery_winners').doc(id).collection('w').get();
    ws.forEach((d) => { const x = d.data() as any; if (x.prize && x.prize !== 'coins') wonPhysical.add(d.id); });
  }
  let pool = shuffle(Array.from(seen.values()));
  pool = pool.filter((e) => !wonPhysical.has(e.uid)).concat(pool.filter((e) => wonPhysical.has(e.uid)));

  const sweepId = 'final-sweep';
  const n = Math.min(remaining, pool.length);
  for (let i = 0; i < n; i++) {
    const e = pool[i];
    const avail = PRIZE_KEYS.filter((k) => (stock[k] || 0) > 0);
    if (!avail.length) break;
    let pick: PrizeKey = avail[0];
    let r = randInt(avail.reduce((s, k) => s + stock[k], 0));
    for (const k of avail) { if (r < stock[k]) { pick = k; break; } r -= stock[k]; }
    const wref = db.collection('wc_lottery_winners').doc(sweepId).collection('w').doc(e.uid);
    try {
      await db.runTransaction(async (tx) => {
        const wsnap = await tx.get(wref);
        if (wsnap.exists) return;
        const cfgS = await tx.get(CONFIG_REF());
        const st = ((cfgS.data() as any).stock || {}) as Record<PrizeKey, number>;
        if ((st[pick] || 0) <= 0) throw new Error('oos ' + pick);
        st[pick] -= 1;
        tx.update(CONFIG_REF(), { stock: st });
        tx.set(wref, { uid: e.uid, name: e.name || '', phone: e.phone || '', matchId: sweepId,
          prize: pick, couponCode: coupon(), correct: false, coins: 0, redeemed: false, paid: true,
          drawnAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      stock[pick] -= 1;
    } catch (err) { console.error('[wc-lotto sweep]', e.uid, err); }
  }
  await CONFIG_REF().set({ sweepDone: true }, { merge: true });
}

// ============================================================
// 主流程
// ============================================================
async function runTick(): Promise<{ seeded: boolean; processed: string[] }> {
  await ensureConfig();
  const fixtures = await loadFixtures();
  await seedMatches(fixtures);

  const teams = fixtures.teams || {};
  const ko = (fixtures.matches || [])
    .filter((m: any) => m.stage && m.stage !== 'group' && teams[m.home] && teams[m.away]);
  const processed: string[] = [];
  for (const m of ko) {
    try {
      const r = await resolveMatch(m.id, m.kickoffUtc, m.home, m.away);
      if (r === 'drawn') processed.push(m.id);
    } catch (err) { console.error('[wc-lotto resolve]', m.id, err); }
  }
  await finalSweep(fixtures);
  return { seeded: true, processed };
}

// ---- 定时:每 30 分钟 ----
export const wcLotteryTick = onSchedule(
  { schedule: 'every 30 minutes', region: REGION, timeZone: 'Etc/UTC', timeoutSeconds: 300 },
  async () => { const r = await runTick(); console.log('[wc-lotto tick]', JSON.stringify(r)); }
);

// ---- 手动催一次(admin)----
export const wcLotteryDrawNow = onCall({ region: REGION }, async (req: CallableRequest) => {
  assertAdmin(req);
  return await runTick();
});

// ---- 人工指定晋级队并强制开奖(ESPN 失灵兜底,admin)----
export const wcLotterySetWinner = onCall({ region: REGION }, async (req: CallableRequest) => {
  assertAdmin(req);
  const { matchId, winnerTeam } = (req.data || {}) as { matchId?: string; winnerTeam?: string };
  if (!matchId || !winnerTeam) throw new HttpsError('invalid-argument', 'matchId + winnerTeam 必填');
  const m = await db.collection('wc_lottery').doc(matchId).get();
  if (!m.exists) throw new HttpsError('not-found', '该场未 seed');
  const d = m.data() as any;
  const r = await resolveMatch(matchId, d.kickoffUtc, d.home, d.away, winnerTeam);
  return { result: r };
});

// 管理员校验:members/{uid}.role == 'admin'(按你现有 admin 判定调整)
function assertAdmin(req: CallableRequest) {
  if (!req.auth) throw new HttpsError('unauthenticated', '需登录');
  const token: any = req.auth.token || {};
  if (token.admin === true || token.role === 'admin') return;
  throw new HttpsError('permission-denied', '仅管理员'); // 如无自定义 claim,改成校验固定 uid
}
