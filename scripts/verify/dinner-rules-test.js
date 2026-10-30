/**
 * node scripts/verify/dinner-rules-test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rules = require('../../src/js/dinner-rules.js');
const art = require('../../src/js/dinner-art.js');
const menu = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/dinner-menu.json'), 'utf8'));

function at(iso) { return new Date(iso).getTime(); }

assert.strictEqual(rules.reginaDate(at('2026-10-30T05:59:00.000Z')), '2026-10-29');
assert.strictEqual(rules.reginaDate(at('2026-10-30T06:00:00.000Z')), '2026-10-30');
assert.strictEqual(rules.reginaWeekday(at('2026-11-01T18:00:00.000Z')), 0);

const sunday = rules.pickDish(menu, at('2026-11-01T18:00:00.000Z'));
assert.strictEqual(sunday.closed, true);
assert.strictEqual(sunday.today, '2026-11-01');
assert.strictEqual(sunday.playDate, '2026-11-02');
const monday = rules.pickDish(menu, at('2026-11-02T18:00:00.000Z'));
assert.strictEqual(monday.closed, false);
assert.strictEqual(monday.dish.id, sunday.dish.id);

assert.strictEqual(menu.dishes.length, 7);
menu.dishes.forEach(function (dish) {
  assert.strictEqual(dish.in.length, 4, dish.id);
  assert.strictEqual(dish.out.length, 4, dish.id);
  assert.ok(dish.in.includes(dish.coupon), dish.id + ' coupon');
  const ids = dish.in.concat(dish.out);
  assert.strictEqual(new Set(ids).size, 8, dish.id + ' unique');
  ids.forEach(function (id) {
    assert.ok(menu.ingredients[id], id);
    assert.ok(art.icon(id), 'art ' + id);
  });
});

const dish = menu.dishes[0];
const order = rules.orderOf(dish, 1);
assert.deepStrictEqual(order, rules.orderOf(dish, 1));
assert.strictEqual(new Set(order).size, 8);
assert.deepStrictEqual(order.slice().sort(), dish.in.concat(dish.out).slice().sort());

const allRight = order.map(function (id) { return { id: id, take: dish.in.includes(id) }; });
const perfect = rules.judge(dish, allRight);
assert.strictEqual(perfect.stars, 3);
assert.strictEqual(perfect.dollar, true);
assert.strictEqual(perfect.raffle, true);

const six = allRight.map(function (p, i) { return i < 2 ? { id: p.id, take: !p.take } : p; });
const mid = rules.judge(dish, six);
assert.strictEqual(mid.correct, 6);
assert.strictEqual(mid.stars, 2);
assert.strictEqual(mid.dollar, true);
assert.strictEqual(mid.raffle, false);

const four = allRight.map(function (p, i) { return i < 4 ? { id: p.id, take: !p.take } : p; });
const low = rules.judge(dish, four);
assert.strictEqual(low.stars, 1);
assert.strictEqual(low.dollar, false);

const none = rules.judge(dish, []);
assert.strictEqual(none.stars, 0);

const base = { today: '2026-10-29', lastDollarYmd: null, issuedToday: 0, dailyCap: 20, pending: null, hasAccount: true };
assert.strictEqual(rules.evaluateClaim(Object.assign({}, base, { stars: 3 })).action, 'issue');
assert.strictEqual(rules.evaluateClaim(Object.assign({}, base, { stars: 2, issuedToday: 20 })).action, 'defer');
assert.strictEqual(rules.evaluateClaim(Object.assign({}, base, { stars: 3, lastDollarYmd: '2026-10-26' })).action, 'weekly_used');
assert.strictEqual(rules.evaluateClaim(Object.assign({}, base, { stars: 3, lastDollarYmd: '2026-10-22' })).action, 'issue');
assert.strictEqual(rules.evaluateClaim(Object.assign({}, base, { stars: 1 })).action, 'none');
assert.strictEqual(rules.evaluateClaim(Object.assign({}, base, { stars: 3, hasAccount: false })).action, 'need_login');
assert.strictEqual(
  rules.evaluateClaim(Object.assign({}, base, { stars: 0, pending: { fromDate: '2026-10-28' } })).action,
  'issue'
);
assert.strictEqual(
  rules.evaluateClaim(Object.assign({}, base, { stars: 0, pending: { fromDate: '2026-10-28' }, issuedToday: 20 })).action,
  'keep_pending'
);

assert.strictEqual(rules.comingSaturday('2026-10-29'), '2026-10-31');
assert.strictEqual(rules.comingSaturday('2026-10-31'), '2026-10-31');
assert.strictEqual(rules.daysBetween('2026-10-22', '2026-10-29'), 7);

console.log('dinner-rules ok', order.join(','));
