/**
 * 建造过程契约。
 * 付钱立刻占地，当时不能用；脚手架按墙钟走；老档没有 buildUntil 的已建成。
 * 跳过：农场币（造价×12%×剩余）或超市积分（每 2 分钟 1 分，1–5），剩不到 2 秒不提供。
 * 车是开进来，不走脚手架、不能跳过。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const isoSrc = readFileSync(join(root, 'src/js/mapview-iso.js'), 'utf8');
const audioSrc = readFileSync(join(root, 'src/js/audio.js'), 'utf8');
const deploySrc = readFileSync(join(root, 'deploy.sh'), 'utf8');

function extract(name, args) {
  const re = new RegExp('function ' + name + '\\(' + args + '\\) \\{[\\s\\S]*?\\n  \\}');
  const m = isoSrc.match(re);
  assert.ok(m, name + ' 必须是 IIFE 顶层纯函数，测得出时长和跳过价');
  return m[0];
}

const buildDurationMs = eval('(' + extract('buildDurationMs', 'type, w, h') + ')');
const buildSkipCoins = eval('(' + extract('buildSkipCoins', 'cost, remainMs, totalMs') + ')');
const buildSkipPoints = eval('(' + extract('buildSkipPoints', 'remainMs') + ')');
const isUnderConstruction = eval('(' + extract('isUnderConstruction', 'o, now') + ')');

assert.equal(buildDurationMs('fence', 1, 1), 8000);
assert.equal(buildDurationMs('bush', 1, 1), 8000);
assert.equal(buildDurationMs('lantern', 1, 1), 8000);
assert.equal(buildDurationMs('tree', 1, 1), 20000);
assert.equal(buildDurationMs('well', 1, 1), 20000);
assert.equal(buildDurationMs('bridge', 2, 1), 20000);
assert.equal(buildDurationMs('plot', 1, 1), 20000);
assert.equal(buildDurationMs('barn', 2, 2), 75000);
assert.equal(buildDurationMs('house', 2, 2), 75000);
assert.equal(buildDurationMs('coop', 2, 2), 75000);
assert.equal(buildDurationMs('greenhouse', 2, 2), 75000);
assert.equal(buildDurationMs('wheel', 2, 2), 75000);
assert.equal(buildDurationMs('home', 2, 2), 90000);
assert.equal(buildDurationMs('home', 4, 4), 180000);
assert.equal(buildDurationMs('home', 5, 5), 300000);
assert.equal(buildDurationMs('home', 7, 7), 480000);
assert.equal(buildDurationMs('car', 2, 2), 0, '车立刻能用，没有建造等待');

assert.equal(buildSkipCoins(350, 75000, 75000), 42);
assert.equal(buildSkipCoins(350, 37500, 75000), 21);
assert.equal(buildSkipCoins(40, 8000, 8000), 5);
assert.equal(buildSkipCoins(60000, 480000, 480000), 7200);
assert.equal(buildSkipCoins(350, 0, 75000), 0);
assert.equal(buildSkipCoins(0, 90000, 90000), 1, '造价 0 也至少 1 币，避免白嫖跳过');

assert.equal(buildSkipPoints(0), 0);
assert.equal(buildSkipPoints(8000), 1);
assert.equal(buildSkipPoints(75000), 1);
assert.equal(buildSkipPoints(480000), 4);
assert.equal(buildSkipPoints(10 * 60 * 1000), 5);

const now = 1_700_000_000_000;
assert.equal(isUnderConstruction({ buildUntil: now + 1000 }, now), true);
assert.equal(isUnderConstruction({ buildUntil: now }, now), false);
assert.equal(isUnderConstruction({ buildUntil: now - 1 }, now), false);
assert.equal(isUnderConstruction({}, now), false, '老档没有 buildUntil = 已经建成');
assert.equal(isUnderConstruction(null, now), false);

function fnBody(name) {
  const start = isoSrc.indexOf('    ' + name + '(');
  assert.ok(start >= 0, name + ' 必须存在');
  const brace = isoSrc.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < isoSrc.length; i++) {
    if (isoSrc[i] === '{') depth++;
    else if (isoSrc[i] === '}') {
      depth--;
      if (depth === 0) return isoSrc.slice(start, i + 1);
    }
  }
  return isoSrc.slice(start, start + 8000);
}

assert.match(isoSrc, /buildUntil/, '建造必须写入 buildUntil');
assert.match(isoSrc, /_startBuild|_markBuild/);
assert.match(isoSrc, /_beginPlace|_placing/);
assert.match(fnBody('_addBuilding'), /_beginPlace\(/);
assert.match(fnBody('_commitPlace'), /_startBuild\(/);
assert.match(fnBody('_placeNewHome'), /_beginPlace\(/);
assert.match(fnBody('_buyHome'), /_startBuild\(/);
assert.match(fnBody('_addPlot'), /_beginPlace\(/);
assert.match(fnBody('_move'), /_placing|_updatePlace/);
assert.match(fnBody('_up'), /_commitPlace/);
assert.match(fnBody('_up'), /_placeDown|_placeArmedAt/, '松手落地必须是农场上的新一按，不能是点图册那一下穿过来的');
assert.ok(isoSrc.lastIndexOf('this._drawPlaceGhost()') > isoSrc.indexOf('this._drawGoldenHour(W, H)'),
  '放置影子必须画在金色光罩之后，否则几乎看不见');

assert.match(isoSrc, /_openBuildSkip|_skipBuild/);
assert.match(isoSrc, /isUnderConstruction\(/);
assert.match(fnBody('_up'), /isUnderConstruction\(/, '点建筑先看是不是还在建');

assert.match(isoSrc, /spendEastPoints/);
assert.match(isoSrc, /iso_build_skip|build_skip/);
assert.match(isoSrc, /isLoggedIn/);
assert.match(isoSrc, /remainMs < 2000|remain < 2000/);

assert.match(isoSrc, /_startCarArrive/);
assert.ok(!/_startBuild\([^)]*'car'/.test(isoSrc), '车不得走脚手架建造');

assert.match(isoSrc, /_defaultMapFront[\s\S]{0,800}\{ type: 'barn'/);
assert.ok(!/_defaultMapFront[\s\S]{0,1200}buildUntil/.test(isoSrc),
  '开局自带建筑不得带着 buildUntil');

assert.match(isoSrc, /_drawScaffold|_drawBuildSite/);
assert.match(isoSrc, /rise|buildProg|clip/, '贴图要从地面往上长（clip/rise）');
assert.match(isoSrc, /_tickBuilds|_finishBuild|_completeBuild/);

assert.match(audioSrc, /case 'build'/);
assert.match(audioSrc, /case 'buildDone'/);
const buildSnd = audioSrc.match(/case 'build':[\s\S]*?break;/);
assert.ok(buildSnd && /_noise/.test(buildSnd[0]), '建造音要有槌木噪声，不能是单音蜂鸣');
const doneSnd = audioSrc.match(/case 'buildDone':[\s\S]*?break;/);
assert.ok(doneSnd && /_noise/.test(doneSnd[0]) && /_tone/.test(doneSnd[0]),
  '完工要噪声质感 + 乐音收尾');

assert.match(deploySrc, /build-construct-test/);

console.log('ok build-construct');
