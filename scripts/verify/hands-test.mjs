/**
 * 帮手源码契约。见 docs/superpowers/specs/2026-08-24-hired-farmhands-design.md
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const farmer = readFileSync(join(root, 'src/js/farmer.js'), 'utf8');
const hands = readFileSync(join(root, 'src/js/hands.js'), 'utf8');
const html = readFileSync(join(root, 'src/index.html'), 'utf8');
const sw = readFileSync(join(root, 'service-worker.js'), 'utf8');
const iso = readFileSync(join(root, 'src/js/mapview-iso.js'), 'utf8');
const orders = readFileSync(join(root, 'src/js/orders.js'), 'utf8');
const shop = readFileSync(join(root, 'src/js/shop.js'), 'utf8');
const harvest = readFileSync(join(root, 'src/js/harvest-status.js'), 'utf8');
const farm = readFileSync(join(root, 'src/js/farm.js'), 'utf8');

assert.match(hands, /Farm\.hands\s*=/, 'Farm.hands namespace');
assert.match(hands, /MAX_HANDS:\s*MAX_HANDS|MAX_HANDS\s*=\s*2/, 'MAX_HANDS = 2');
assert.match(hands, /isUnlocked\(\)\s*\?\s*this\.MAX_HANDS\s*:\s*0/, 'maxAllowed is unlocked ? 2 : 0');
assert.ok(!/SECOND_AT|16\s*plot|UNLOCK_SECOND/.test(hands), 'no 16-plot second-hand gate');

assert.match(hands, /WAGE\s*=\s*\[\s*180\s*,\s*280\s*\]/);
assert.ok(!/spendEastPoints|cost_ep|addEastPoints/.test(hands), 'hire/pay must not touch East Points');

assert.match(hands, /paidThroughDate === today\(\)|paidThroughDate === date|getDateString/);
assert.ok(!/rows\.splice\(i,\s*1\)/.test(hands.split('collectWage')[1] || ''), 'unpaid path does not splice the save row');

assert.ok(!/setInterval/.test(hands), 'no setInterval harvest loop');
assert.ok(!/harvestPlot/.test(hands), 'hands.js must not call harvestPlot itself');

assert.match(orders, /Farm\.farmer\.enqueue/);
assert.match(shop, /enqueuePlantAll|Farm\.farmer\.enqueue/);
assert.match(harvest, /enqueueHarvestAll/);
assert.match(farm, /enqueueWaterAll|Farm\.farmer\.enqueue/);

assert.match(iso, /_drawBuildWorkers/);
assert.ok(!/state\.data\.hands/.test((iso.match(/_drawBuildWorkers[\s\S]*?\n    \},/) || [''])[0]),
  '_drawBuildWorkers does not read state.data.hands');

assert.ok(!/王阿姨|李大爷/.test(hands + farmer), 'no fake names');

assert.match(farmer, /function tickActor\(/);
assert.match(farmer, /startJob\(iso, actor/);
assert.match(farmer, /iso\._build && !doingFarmWork/);
assert.match(farmer, /function doingFarmWork\(actor/);

assert.match(html, /farmer\.js[\s\S]*?hands\.js[\s\S]*?mapview-iso\.js/, 'hands.js after farmer.js');
assert.match(sw, /farmer\.js['"]\s*,\s*'\/src\/js\/hands\.js'|farmer\.js',\s*'\/src\/js\/hands\.js/);

assert.match(farmer, /board\.splice\(i,\s*1\)/);
assert.ok(!/board\.shift\(\)|A\.queue\.shift\(\)/.test(farmer.match(/function claim[\s\S]*?\n  \}/)[0]),
  'claim does not shift() then test plotBusy');

assert.match(hands, /Math\.min\(rows\.length,\s*this\.MAX_HANDS\)/);
assert.ok(!/for\s*\(\s*let i = 0; i < rows\.length/.test(hands),
  'payroll/spawn must not iterate rows.length without min');

assert.match(hands, /d\.hands\.push\(row\)[\s\S]{0,200}spendCoins/);
assert.match(hands, /paidThroughDate = today\(\)[\s\S]{0,200}spendCoins/);

assert.match(hands, /_visitLock[\s\S]{0,80}return/);
assert.match(hands, /onEnterVisit/);
assert.match(hands, /depthDraws[\s\S]{0,200}_visitLock/);

assert.match(farmer, /Farm\.hands && Farm\.hands\.tick/);
assert.ok(!/hands\.tick\(/.test(iso.match(/render\(\)\s*\{[\s\S]*?draws\.sort/)[0]),
  'isoView.render must not call hands.tick');
assert.ok(!/lastDt/.test(farmer + hands), 'no lastDt helper');

assert.match(hands, /maybeSyncFromSave/);
assert.match(iso, /hands\.maybeSyncFromSave|Farm\.hands\.maybeSyncFromSave/);
assert.match(hands, /tick:\s*function[\s\S]{0,200}maybeSyncFromSave/);

console.log('ok hands-test');
