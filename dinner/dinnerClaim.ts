/**
 * 今晚吃什么 · 领券云函数。
 * 部署位置：EasternMarket_app/functions/src/dinnerClaim.ts
 * 并在 functions/src/index.ts 导出 dinnerClaim。
 * 项目 eastern-market-members，区域 us-central1。
 *
 * 浏览器报的星级不作数。这里用和 src/js/dinner-rules.js 同一套洗牌和打分。
 * 冷启动会核对一道金样，两处洗牌不一致就直接拒绝服务，避免发错券。
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';
const MENU_URL = 'https://farm.easternmarket.ca/data/dinner-menu.json';
const EPOCH = '2026-01-01';
const GOLDEN = ['scallion', 'egg', 'cilantro', 'potato', 'cucumber', 'sesame_oil', 'tomato', 'tofu'];

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return dt.toISOString().slice(0, 10);
}

function reginaWeekday(now: number): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Regina',
    weekday: 'short',
  }).format(new Date(now));
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[name];
}
function daysBetween(a: string, b: string): number {
  const ua = Date.parse(a + 'T00:00:00Z');
  const ub = Date.parse(b + 'T00:00:00Z');
  return Math.round((ub - ua) / 86400000);
}

function reginaDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Regina',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function orderOf(dish: { in: string[]; out: string[] }, seed: number): string[] {
  const arr = dish.in.concat(dish.out);
  const rand = mulberry32(seed >>> 0);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function assertGolden(): void {
  const order = orderOf(
    { in: ['tomato', 'egg', 'scallion', 'sesame_oil'], out: ['cucumber', 'tofu', 'cilantro', 'potato'] },
    1
  );
  if (order.join(',') !== GOLDEN.join(',')) throw new Error('dinner shuffle drift');
}
assertGolden();

function judge(dish: { in: string[]; out: string[]; coupon: string }, picks: { id: string; take: boolean }[]) {
  const shouldTake = new Set(dish.in);
  const total = dish.in.length + dish.out.length;
  let correct = 0;
  for (let i = 0; i < total; i++) {
    const p = picks[i];
    if (!p) continue;
    if (shouldTake.has(p.id) === !!p.take) correct++;
  }
  let stars = 0;
  if (correct === total) stars = 3;
  else if (correct >= total - 2) stars = 2;
  else if (correct >= Math.ceil(total / 2)) stars = 1;
  return { correct, total, stars, dollar: stars >= 2, raffle: stars === 3, couponId: dish.coupon };
}

function couponCode(): string {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const D = '23456789';
  const r = (n: number) => Math.floor(Math.random() * n);
  return 'D' + L[r(L.length)] + D[r(D.length)] + L[r(L.length)] + D[r(D.length)];
}

async function loadMenu(): Promise<any> {
  const res = await fetch(MENU_URL, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new HttpsError('unavailable', 'menu ' + res.status);
  return res.json();
}

function dishFor(menu: any, ymd: string): any {
  const index = ((daysBetween(EPOCH, ymd) % menu.dishes.length) + menu.dishes.length) % menu.dishes.length;
  return menu.dishes[index];
}

async function memberFor(uid: string) {
  const byUid = await db.collection('members').where('firebase_uid', '==', uid).limit(1).get();
  if (!byUid.empty) return byUid.docs[0];
  const linked = await db.collection('members').where('linked_uids', 'array-contains', uid).limit(1).get();
  if (!linked.empty) return linked.docs[0];
  return null;
}

export const dinnerClaim = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'sign in first');
  const data = req.data || {};
  const date = String(data.date || '');
  const dishId = String(data.dishId || '');
  const seed = Number(data.seed);
  const picks = Array.isArray(data.picks) ? data.picks : [];
  const today = reginaDate(Date.now());
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  const sundayPreview = reginaWeekday(Date.now()) === 0 && date === tomorrow;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (date !== today && date !== yesterday && !sundayPreview)) {
    throw new HttpsError('invalid-argument', 'date');
  }
  if (!Number.isFinite(seed)) throw new HttpsError('invalid-argument', 'seed');

  const menu = await loadMenu();
  const dish = dishFor(menu, date);
  if (!dish || dish.id !== dishId) throw new HttpsError('invalid-argument', 'dish');
  const order = orderOf(dish, seed >>> 0);
  if (picks.length !== order.length || picks.some((p: any, i: number) => !p || p.id !== order[i])) {
    throw new HttpsError('invalid-argument', 'picks');
  }
  const judged = judge(dish, picks.map((p: any) => ({ id: String(p.id), take: !!p.take })));

  const member = await memberFor(req.auth.uid);
  if (!member) return { action: 'not_member', stars: judged.stars, raffle: judged.raffle };

  const cap = Number(menu.dailyCap || 20);
  const memberId = member.id;
  const claimRef = db.collection('dinner_claims').doc(memberId + '_' + date);
  const quotaRef = db.collection('dinner_quota').doc(today);
  const memberRef = db.collection('dinner_members').doc(memberId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(claimRef);
    if (existing.exists) return existing.data();
    const memberSnap = await tx.get(memberRef);
    const quotaSnap = await tx.get(quotaRef);
    const lastDollarYmd = memberSnap.exists ? String(memberSnap.get('lastDollarYmd') || '') : '';
    const pending = memberSnap.exists ? memberSnap.get('pending') || null : null;
    const issuedToday = quotaSnap.exists ? Number(quotaSnap.get('issued') || 0) : 0;
    const weeklyOk = !lastDollarYmd || daysBetween(lastDollarYmd, today) >= 7;

    let action = 'none';
    let source: string | null = null;
    if (pending && pending.fromDate < today && weeklyOk) {
      action = issuedToday < cap ? 'issue' : 'keep_pending';
      source = 'pending';
    } else if (judged.stars >= 2 && weeklyOk) {
      action = issuedToday < cap ? 'issue' : 'defer';
      source = 'today';
    } else if (judged.stars >= 2 && !weeklyOk) {
      action = 'weekly_used';
    }

    const base: Record<string, unknown> = {
      action,
      stars: judged.stars,
      raffle: judged.raffle,
      memberId,
      date,
      dishId,
      couponId: dish.coupon,
    };

    if (action !== 'issue') {
      if (action === 'defer') {
        tx.set(memberRef, { pending: { fromDate: date, dishId, couponId: dish.coupon } }, { merge: true });
      }
      if (judged.raffle) {
        tx.set(db.collection('dinner_raffle').doc(date).collection('entries').doc(memberId), {
          memberId, dishId, at: Date.now(),
        });
      }
      tx.set(claimRef, base);
      return base;
    }

    const code = couponCode();
    const couponRef = db.collection('dinner_coupons').doc(code);
    tx.create(couponRef, {
      code,
      memberId,
      dishId: source === 'pending' ? pending.dishId : dishId,
      couponId: source === 'pending' ? pending.couponId : dish.coupon,
      cents: Number(menu.dollarCents || 100),
      redeemed: false,
      drawnAt: Date.now(),
    });
    tx.set(quotaRef, { issued: issuedToday + 1 }, { merge: true });
    tx.set(memberRef, { lastDollarYmd: today, pending: null }, { merge: true });
    tx.set(claimRef, Object.assign({}, base, { code }));
    if (judged.raffle) {
      tx.set(db.collection('dinner_raffle').doc(date).collection('entries').doc(memberId), {
        memberId, dishId, at: Date.now(),
      });
    }
    return Object.assign({}, base, { code });
  });
});
