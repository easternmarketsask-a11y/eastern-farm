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
 * 机制(方案 A · 2026-06-27 改为「报名即抽」):
 *   - 报名即抽:玩家提交竞猜时,wcLotteryEnter 当场原子抽奖
 *       · 必发底币 coinsBase(1000) → farm_players
 *       · physChance 概率中实物(仍有库存才中,加权随机,原子扣库存),否则只发币
 *       · 写 entry + win 记录 + 券码索引;前端转盘据此动画揭晓
 *   - 猜对追加:赛后 resolveMatch 判定晋级队,猜对者追加 (coinsCorrectTotal-coinsBase) 币 + 推送
 *   - 决赛后所有 KO 场结算完仍有库存 → finalSweep 在所有参与者里清仓抽光(没中过实物者优先)
 *   - 幂等:win.paid 防重复发币;win.bonusPaid 防重复追加;库存扣减在事务内
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

// 中奖展示名(核销台/记录用)
const PRIZE_CN: Record<string, string> = {
  shaqima: '沙琪玛', ryukakusan: '龙角散',
  yogurt_orig: '气泡饮·原味', yogurt_muscat: '气泡饮·青提', coins: '农场币',
};
function maskPhone(p?: string): string {
  if (!p) return '';
  const s = String(p).replace(/\s/g, '');
  return s.length <= 4 ? s : '****' + s.slice(-4);
}
/** 姓名脱敏(批量记录列表用,降低 PII 暴露):只留首字,其余打点。单券当面核对仍用全名。 */
function maskName(n?: string): string {
  const s = String(n || '').trim();
  if (!s) return '';
  const first = Array.from(s)[0];
  return s.length <= 1 ? first : first + '••';
}

// 配置默认值(首次自动写入 wc_lottery_config/config;Chris 备货后可在控制台改)
const DEFAULT_CONFIG = {
  coinsBase: 1000,
  coinsCorrectTotal: 2000,
  physChance: 0.18,        // 报名即抽时,单次中实物的概率(仍有库存才生效;可在控制台调)
  dailyLimit: 2,           // 每个会员每天最多参与抽奖次数(萨省日)
  perMatchQuota: 2,        // (旧·已不用于即抽;保留兼容)
  carryQuota: 0,           // (旧·已不用于即抽;保留兼容)
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
/** 萨省(UTC-6)日期串 YYYYMMDD,用于每日抽奖次数计数 */
function skDateStr(ms: number): string { return ymd(new Date(ms - 6 * 3600 * 1000)); }

// wc2026.json 的 teams 是数组 [{code,...}] —— 转成代码集合做归属判断
function teamCodeSet(fx: any): Set<string> {
  return new Set((((fx && fx.teams) || []) as any[]).map((t) => t && t.code));
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
  const data = snap.data() as any;
  // 给老配置补上即抽机制新增字段(physChance / dailyLimit),不覆盖其它字段
  const patch: any = {};
  if (typeof data.physChance !== 'number') { patch.physChance = DEFAULT_CONFIG.physChance; data.physChance = DEFAULT_CONFIG.physChance; }
  if (typeof data.dailyLimit !== 'number') { patch.dailyLimit = DEFAULT_CONFIG.dailyLimit; data.dailyLimit = DEFAULT_CONFIG.dailyLimit; }
  if (Object.keys(patch).length) await ref.set(patch, { merge: true });
  return data as typeof DEFAULT_CONFIG;
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
  const codes = teamCodeSet(fixtures);
  const isTeam = (c: string) => codes.has(c);
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
type Entry = { uid: string; memberId?: string; name?: string; phone?: string; pickedTeam: string; createdAt?: any };

/** 收集一批 entries 的推送 token(去重)。 */
async function tokensFor(entries: Entry[]): Promise<string[]> {
  const tokens: string[] = [];
  for (const e of entries) {
    const id = e.memberId || e.uid;
    try {
      const ms = await db.collection('members').doc(id).get();
      const t = ms.exists && (ms.data() as any).push && (ms.data() as any).push.fcmTokens;
      if (Array.isArray(t)) tokens.push(...t);
    } catch (_) { /* ignore */ }
  }
  return Array.from(new Set(tokens));
}
async function pushTo(tokens: string[], title: string, body: string) {
  for (let i = 0; i < tokens.length; i += 500) {
    try {
      await admin.messaging().sendEachForMulticast({
        tokens: tokens.slice(i, i + 500),
        notification: { title, body },
        webpush: { fcmOptions: { link: 'https://farm.easternmarket.ca/' },
          notification: { icon: 'https://farm.easternmarket.ca/src/assets/images/wc2026-logo.png' } },
      });
    } catch (err) { console.error('[wc-lotto push]', err); }
  }
}
/** 赛后给「猜中晋级队」的报名者推送结果(奖品当场已抽,这里只报喜+追加币)。幂等:match.notified 守门。 */
async function notifyResult(matchId: string, winnerTeam: string, entries: Entry[]) {
  const mref = db.collection('wc_lottery').doc(matchId);
  const md = (await mref.get()).data() || {};
  if ((md as any).notified) return;
  const correct = entries.filter((e) => e.pickedTeam === winnerTeam);
  if (correct.length) {
    const tokens = await tokensFor(correct);
    await pushTo(tokens, '🎯 你猜对了!', '竞猜结果出炉,你猜中晋级队,农场币奖励已到账!');
  }
  await mref.set({ notified: true }, { merge: true });
}

async function resolveMatch(matchId: string, kickoffUtc: string, home: string, away: string,
  forcedWinner?: string): Promise<string> {
  const mref = db.collection('wc_lottery').doc(matchId);
  const msnap = await mref.get();
  const mdoc = msnap.exists ? (msnap.data() as any) : {};
  if (mdoc.status === 'bonus-done') return 'already-done';

  // 1) 确认终场 + 晋级队
  let winnerTeam = forcedWinner || mdoc.actualWinnerTeam;
  if (!winnerTeam) {
    if (Date.now() < new Date(kickoffUtc).getTime() + KICKOFF_GRACE_MS) return 'too-early';
    const r = await espnResult(kickoffUtc, home, away);
    if (!r.found || !r.final || !r.winner) return 'not-final';
    winnerTeam = r.winner;
  }

  // 2) 读全部报名(deadline 后不可变);兜底剔除迟到报名
  const ksMs = new Date(kickoffUtc).getTime();
  const esnap = await mref.collection('entries').get();
  const entries: Entry[] = [];
  esnap.forEach((d) => {
    const e = d.data() as Entry;
    const t = e.createdAt && e.createdAt.toMillis ? e.createdAt.toMillis() : 0;
    if (!t || t <= ksMs) entries.push({ ...e, uid: d.id });
  });

  // 3) 猜对追加币(逐人幂等):奖品在报名时已即抽即发,这里只补「猜中晋级队」的追加币
  const cfg = await ensureConfig();
  const failures = await payoutBonus(matchId, winnerTeam!, entries, cfg);

  // 4) 全部处理完才标 bonus-done;有失败则下一个 tick 重试
  if (failures === 0) {
    await mref.set({ status: 'bonus-done', actualWinnerTeam: winnerTeam }, { merge: true });
    await notifyResult(matchId, winnerTeam!, entries);   // 推送「你猜对了」(幂等)
    return 'done';
  }
  return 'partial';
}

/** 赛后逐 entry 处理猜对追加币:猜中晋级队 → 追加 (coinsCorrectTotal - coinsBase) 币 + 标 correct。
 *  奖品(实物/底币)报名时已发,这里不再动库存。每人一个事务,bonusPaid 防重复。返回失败人数。 */
async function payoutBonus(matchId: string, winnerTeam: string, entries: Entry[],
  cfg: typeof DEFAULT_CONFIG): Promise<number> {
  const coinsBase = cfg.coinsBase || 1000;
  const coinsCorrect = cfg.coinsCorrectTotal || 2000;
  const bonus = Math.max(0, coinsCorrect - coinsBase);
  let failures = 0;

  for (const e of entries) {
    const correct = e.pickedTeam === winnerTeam;
    const wref = db.collection('wc_lottery_winners').doc(matchId).collection('w').doc(e.uid);
    try {
      await db.runTransaction(async (tx) => {
        const wsnap = await tx.get(wref);
        if (!wsnap.exists) return;             // 没抽过(没转过转盘)→ 不处理
        const w = wsnap.data() as any;
        if (w.bonusPaid) return;               // 已追加过,跳过
        if (correct && bonus > 0) {
          // 只更新 win.coins(追加后总额);前端读到增量后加到本地存档
          tx.set(wref, { correct: true, bonusPaid: true, bonusCoins: bonus,
            coins: (w.coins || coinsBase) + bonus }, { merge: true });
        } else {
          tx.set(wref, { correct: false, bonusPaid: true }, { merge: true });
        }
      });
    } catch (err) { failures++; console.error('[wc-lotto bonus]', matchId, e.uid, err); }
  }
  return failures;
}

// ============================================================
// 决赛清仓:全部 KO 场 drawn 且仍有库存 → 在所有参与者里抽光
// ============================================================
async function finalSweep(fixtures: any) {
  const cfg = await ensureConfig();
  if (cfg.sweepDone) return;
  const codes = teamCodeSet(fixtures);
  const koIds = (fixtures.matches || [])
    .filter((m: any) => m.stage && m.stage !== 'group' && codes.has(m.home) && codes.has(m.away))
    .map((m: any) => m.id);
  if (!koIds.length) return;
  // 所有 KO 场都结算完了吗
  for (const id of koIds) {
    const s = await db.collection('wc_lottery').doc(id).get();
    if (!s.exists || (s.data() as any).status !== 'bonus-done') return;
  }
  const stock = { ...(cfg.stock || {}) } as Record<PrizeKey, number>;
  let remaining = PRIZE_KEYS.reduce((s, k) => s + (stock[k] || 0), 0);
  if (remaining <= 0) { await CONFIG_REF().set({ sweepDone: true }, { merge: true }); return; }

  // 收集所有参与过的 uid(去重),优先没中过实物的人。
  // 只认 win 文档(云函数写,客户端不可伪造),不读 entries —— 防伪造 entry 混进清仓池。
  const seen = new Map<string, Entry>();
  const wonPhysical = new Set<string>();
  for (const id of koIds) {
    const ws = await db.collection('wc_lottery_winners').doc(id).collection('w').get();
    ws.forEach((d) => {
      const x = d.data() as any;
      if (!seen.has(d.id)) seen.set(d.id, { uid: d.id, name: x.name || '', phone: x.phone || '', pickedTeam: '' });
      if (x.prize && x.prize !== 'coins') wonPhysical.add(d.id);
    });
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
    const code = coupon();
    const cref = db.collection('wc_coupons').doc(code);
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
          prize: pick, couponCode: code, correct: false, coins: 0, redeemed: false, paid: true,
          drawnAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(cref, { code, matchId: sweepId, uid: e.uid, name: e.name || '', phone: e.phone || '',
          prize: pick, redeemed: false, drawnAt: FieldValue.serverTimestamp() }, { merge: true });
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

  const codes = teamCodeSet(fixtures);
  const ko = (fixtures.matches || [])
    .filter((m: any) => m.stage && m.stage !== 'group' && codes.has(m.home) && codes.has(m.away));
  const processed: string[] = [];
  for (const m of ko) {
    try {
      const r = await resolveMatch(m.id, m.kickoffUtc, m.home, m.away);
      if (r === 'done') processed.push(m.id);
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

// ---- 玩家报名即抽(登录玩家调用)----
// 提交竞猜 → 原子:校验截止 + 即时抽奖(底币必发 + physChance 概率中实物) + 写 entry/win/券码 + 加币
// 返回 { prize, coins, couponCode } 供前端转盘揭晓。幂等:已抽过直接回原结果。
export const wcLotteryEnter = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', '需登录');
  const uid = req.auth.uid;
  const { matchId, pickedTeam, name, phone, memberId } =
    (req.data || {}) as { matchId?: string; pickedTeam?: string; name?: string; phone?: string; memberId?: string };
  if (!matchId || !pickedTeam || typeof pickedTeam !== 'string' || pickedTeam.length === 0 || pickedTeam.length > 8)
    throw new HttpsError('invalid-argument', '参数错误');

  const mref = db.collection('wc_lottery').doc(matchId);
  const eref = mref.collection('entries').doc(uid);
  const wref = db.collection('wc_lottery_winners').doc(matchId).collection('w').doc(uid);
  const dayKey = skDateStr(Date.now());
  const dailyRef = db.collection('wc_lottery_daily').doc(uid + '_' + dayKey);

  // 快路径:已抽过直接回原结果(免事务,不计入当日次数)
  const existing = await wref.get();
  if (existing.exists) {
    const x = existing.data() as any;
    return { prize: x.prize, coins: x.coins, couponCode: x.couponCode || null, already: true };
  }

  return await db.runTransaction(async (tx) => {
    const msnap = await tx.get(mref);
    if (!msnap.exists) throw new HttpsError('failed-precondition', '该场暂未开放竞猜');
    const md = msnap.data() as any;
    if (md.deadline && md.deadline.toMillis && Date.now() >= md.deadline.toMillis())
      throw new HttpsError('failed-precondition', '本场报名已截止');

    const wsnap = await tx.get(wref);          // 事务内再确认一次幂等
    if (wsnap.exists) {
      const x = wsnap.data() as any;
      return { prize: x.prize, coins: x.coins, couponCode: x.couponCode || null, already: true };
    }

    const cfgSnap = await tx.get(CONFIG_REF());
    const cfg = (cfgSnap.exists ? cfgSnap.data() : DEFAULT_CONFIG) as any;
    const coinsBase = cfg.coinsBase || 1000;
    const physChance = typeof cfg.physChance === 'number' ? cfg.physChance : DEFAULT_CONFIG.physChance;
    const dailyLimit = typeof cfg.dailyLimit === 'number' ? cfg.dailyLimit : DEFAULT_CONFIG.dailyLimit;
    const stock = { ...(cfg.stock || {}) } as Record<PrizeKey, number>;

    // 每日次数限制(萨省日):新报名才计数,重开同场不计
    const daySnap = await tx.get(dailyRef);    // ⚠️ 所有 read 必须在 write 之前
    const dayCount = daySnap.exists ? ((daySnap.data() as any).count || 0) : 0;
    if (dayCount >= dailyLimit)
      throw new HttpsError('resource-exhausted', '今天的抽奖机会用完啦(每天' + dailyLimit + '次),明天再来 🎁');

    // 即时抽奖:physChance 概率中实物(仅在仍有库存时),按剩余量加权选款,原子扣库存;否则只发底币
    let prize: string = 'coins';
    let couponCode: string | null = null;
    const avail = PRIZE_KEYS.filter((k) => (stock[k] || 0) > 0);
    if (avail.length && Math.random() < physChance) {
      let r = randInt(avail.reduce((s, k) => s + stock[k], 0));
      let pick: PrizeKey = avail[0];
      for (const k of avail) { if (r < stock[k]) { pick = k; break; } r -= stock[k]; }
      stock[pick] -= 1;
      prize = pick; couponCode = coupon();
      tx.update(CONFIG_REF(), { stock });
    }
    const coins = coinsBase;

    tx.set(eref, {
      uid, memberId: memberId || uid, name: name || '', phone: phone || '',
      pickedTeam, matchId, createdAt: FieldValue.serverTimestamp(), prize, coins,
    }, { merge: true });
    // win 文档是「币」的可信来源:前端读它把 coins 加到本地存档(农场币不存 farm_players,见隐私规则)
    tx.set(wref, {
      uid, name: name || '', phone: phone || '', matchId,
      prize, couponCode, coins, correct: null, bonusPaid: false,
      redeemed: false, paid: true, drawnAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(dailyRef, { uid, date: dayKey, count: dayCount + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (prize !== 'coins' && couponCode) {
      tx.set(db.collection('wc_coupons').doc(couponCode), {
        code: couponCode, matchId, uid, name: name || '', phone: phone || '',
        prize, redeemed: false, drawnAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return { prize, coins, couponCode };
  });
});

// ---- 人工指定晋级队并强制开奖(ESPN 失灵兜底,admin)----
export const wcLotterySetWinner = onCall({ region: REGION }, async (req: CallableRequest) => {
  assertAdmin(req);
  const { matchId, winnerTeam } = (req.data || {}) as { matchId?: string; winnerTeam?: string };
  if (!matchId || !winnerTeam) throw new HttpsError('invalid-argument', 'matchId + winnerTeam 必填');
  const m = await db.collection('wc_lottery').doc(matchId).get();
  if (!m.exists) throw new HttpsError('not-found', '该场未 seed');
  const d = m.data() as any;
  if (winnerTeam !== d.home && winnerTeam !== d.away)
    throw new HttpsError('invalid-argument', 'winnerTeam 必须是本场双方之一(' + d.home + '/' + d.away + ')');
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

// ============================================================
// 收银核销(Phase 3):独立核销页 redeem/ 调用,口令校验,无需登录
// 口令存 wc_lottery_admin/secret.cashierPass(read:false,只有云函数能读)
// Chris 在控制台给该文档设 cashierPass;没设则用下面的默认值。
// ============================================================
const DEFAULT_CASHIER_PASS = '8888';   // ⚠️ Chris 部署前改掉,或在控制台设 wc_lottery_admin/secret

async function assertCashier(pass?: string) {
  let expected = DEFAULT_CASHIER_PASS;
  try {
    const s = await db.collection('wc_lottery_admin').doc('secret').get();
    if (s.exists && (s.data() as any).cashierPass) expected = String((s.data() as any).cashierPass);
  } catch (e) { /* 读不到就用默认 */ }
  if (!pass || String(pass) !== expected) throw new HttpsError('permission-denied', '口令错误');
}

function fmtSK(ts: any): string {
  if (!ts || !ts.toDate) return '';
  const d = new Date(ts.toDate().getTime() - 6 * 3600 * 1000); // 萨省 UTC-6
  const p = (n: number) => String(n).padStart(2, '0');
  return (d.getUTCMonth() + 1) + '-' + d.getUTCDate() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

export const wcLotteryRedeem = onCall({ region: REGION }, async (req: CallableRequest) => {
  const { action, code, pass } = (req.data || {}) as { action?: string; code?: string; pass?: string };
  await assertCashier(pass);

  if (action === 'ping') return { ok: true };

  if (action === 'list') {
    const snap = await db.collection('wc_coupons').orderBy('drawnAt', 'desc').limit(300).get();
    let redeemedCount = 0;
    const items = snap.docs.map((d) => {
      const x = d.data() as any;
      if (x.redeemed) redeemedCount++;
      return { code: x.code, prizeCn: PRIZE_CN[x.prize] || x.prize, name: maskName(x.name),
        redeemed: !!x.redeemed, redeemedAt: fmtSK(x.redeemedAt) };
    });
    return { items, total: snap.size, redeemedCount };
  }

  const c = (code || '').trim().toUpperCase();
  if (!c) throw new HttpsError('invalid-argument', '缺少券码');
  const cref = db.collection('wc_coupons').doc(c);

  if (action === 'lookup') {
    const s = await cref.get();
    if (!s.exists) return { found: false, code: c };
    const x = s.data() as any;
    return { found: true, code: c, prizeCn: PRIZE_CN[x.prize] || x.prize,
      name: x.name || '', phone: maskPhone(x.phone), redeemed: !!x.redeemed, redeemedAt: fmtSK(x.redeemedAt),
      matchId: x.matchId };
  }

  if (action === 'redeem') {
    const out = await db.runTransaction(async (tx) => {
      const s = await tx.get(cref);
      if (!s.exists) throw new HttpsError('not-found', '查无此券码');
      const x = s.data() as any;
      const prizeCn = PRIZE_CN[x.prize] || x.prize;
      if (x.redeemed) return { already: true, prizeCn, name: x.name || '' };
      tx.set(cref, { redeemed: true, redeemedAt: FieldValue.serverTimestamp() }, { merge: true });
      // 同步顾客的中奖文档,让其手机显示「✓ 已核销」
      if (x.matchId && x.uid) {
        const wref = db.collection('wc_lottery_winners').doc(x.matchId).collection('w').doc(x.uid);
        tx.set(wref, { redeemed: true, redeemedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return { already: false, prizeCn, name: x.name || '' };
    });
    return out;
  }

  if (action === 'unredeem') {
    const out = await db.runTransaction(async (tx) => {
      const s = await tx.get(cref);
      if (!s.exists) throw new HttpsError('not-found', '查无此券码');
      const x = s.data() as any;
      const prizeCn = PRIZE_CN[x.prize] || x.prize;
      if (!x.redeemed) return { wasRedeemed: false, prizeCn, name: x.name || '' };
      tx.set(cref, { redeemed: false, redeemedAt: FieldValue.delete(), unredeemedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (x.matchId && x.uid) {
        const wref = db.collection('wc_lottery_winners').doc(x.matchId).collection('w').doc(x.uid);
        tx.set(wref, { redeemed: false, redeemedAt: FieldValue.delete() }, { merge: true });
      }
      return { wasRedeemed: true, prizeCn, name: x.name || '' };
    });
    return out;
  }

  throw new HttpsError('invalid-argument', '未知操作');
});
