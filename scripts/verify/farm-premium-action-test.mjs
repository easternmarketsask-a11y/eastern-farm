import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const elements = {};
for (const id of ['harvestStatusText', 'harvestStatusCenter', 'harvestStatusBtn']) {
  elements[id] = { textContent: '', onclick: null, attrs: {}, classList: { add() {}, toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; } };
}
let openedPlot = -1, orders = 0;
const context = {
  window: {}, document: { getElementById: id => elements[id] },
  Farm: {
    state: { data: { language: 'en', plots: [{ unlocked: true, crop: null }] }, isWarehouseFull: () => false },
    crops: { isMature: p => p.ripe, timeRemaining: () => 2000, formatTimeRemaining: () => '2m' },
    i18n: { t: k => k }, shop: { openSeedPickerForPlot: i => { openedPlot = i; } },
    orders: { fillableCount: () => orders, stapleReadyCount: () => 0, open: () => { orders = -1; } },
  },
};
context.window = context;
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../../src/js/harvest-status.js', import.meta.url), 'utf8'), context);
const status = context.Farm.harvestStatus, center = elements.harvestStatusCenter;
status._signHintDue = () => false;
status.render();
assert.equal(typeof center.onclick, 'function', 'empty farm needs a direct choose-seeds action');
center.onclick();
assert.equal(openedPlot, 0, 'choose seeds must use the existing plot seed picker');
orders = 1;
context.Farm.state.data.plots[0].crop = 'bok_choy';
status.render(); center.onclick();
assert.equal(orders, -1, 'deliverable order should be reachable while crops grow');
context.Farm.farmer = { doingFarmWork: () => true, _actor: () => ({ job: { kind: 'harvest' } }) };
status.render();
assert.equal(center.disabled, true, 'a running farm action must not enqueue duplicate harvests');
assert.equal(center.attrs['aria-busy'], 'true');
assert.match(elements.harvestStatusText.textContent, /Harvest/i);
console.log('ok farm-premium current action (plant, delivery, working)');
