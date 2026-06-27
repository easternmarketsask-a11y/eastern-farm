/* Unit tests for the World Cup hub's group-ranking + tiebreaker logic.
   Required baseline from docs/TIEBREAKER_REFERENCE.md + the module's own
   groupStats-based display ranking and h2h tiebreak.

   Run: node worldcup/tests/rankgroup.test.js   (no deps; uses the real src file)
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- stub the browser globals worldcup.js touches at load time ----
const noop = () => {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Set, Map, Promise, Date, Math, JSON, parseInt, isNaN,
  fetch: () => Promise.reject(new Error('no fetch in test')),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  document: {
    readyState: 'loading',          // prevents init() from running
    addEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop, setAttribute: noop }),
    body: { appendChild: noop, classList: { add: noop, remove: noop } }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const code = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'worldcup.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const WC = sandbox.window.Farm.worldcup;

// ---- tiny test runner ----
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg || 'not equal') + ' — got ' + A + ' expected ' + B);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }
const FT = (home, away, h, a) => ({ home, away, stage: 'group', officialScore: [h, a], officialFinal: true });

console.log('\nrankGroupPure (canonical, from matches):');

test('three-way tie broken by head-to-head', () => {
  const codes = ['AAA', 'BBB', 'CCC', 'DDD'];
  const matches = [
    FT('AAA', 'DDD', 1, 0), FT('BBB', 'DDD', 1, 0), FT('CCC', 'DDD', 1, 0),
    FT('AAA', 'BBB', 2, 0), FT('BBB', 'CCC', 2, 0), FT('CCC', 'AAA', 1, 0)
  ];
  const r = WC._rankGroupPure(codes, matches).map(t => t.code);
  eq(r[3], 'DDD', 'DDD should be last');
  eq(r.slice(0, 3), ['AAA', 'BBB', 'CCC'], 'h2h order');
});

test('separated by goal difference globally', () => {
  const codes = ['AAA', 'BBB', 'CCC', 'DDD'];
  const matches = [FT('AAA', 'BBB', 3, 0), FT('CCC', 'DDD', 1, 1)];
  const r = WC._rankGroupPure(codes, matches);
  eq(r[0].code, 'AAA', 'AAA top on GD');
  eq(r[0].Pts, 3, 'AAA has 3 pts');
});

test('partial group does not throw', () => {
  const codes = ['AAA', 'BBB', 'CCC', 'DDD'];
  const matches = [FT('AAA', 'BBB', 1, 0)];
  WC._rankGroupPure(codes, matches);  // should not throw
});

console.log('\nrankGroupForDisplay (groupStats + h2h overlay):');

test('display ranking sorts by Pts then GD then GF', () => {
  WC._setDataForTest({
    teams: [{ code: 'AA' }, { code: 'BB' }, { code: 'CC' }, { code: 'DD' }],
    groups: { Z: ['AA', 'BB', 'CC', 'DD'] },
    groupStats: {
      Z: [
        { code: 'AA', P: 3, W: 3, D: 0, L: 0, GF: 7, GA: 1, status: 'q' },
        { code: 'BB', P: 3, W: 1, D: 1, L: 1, GF: 3, GA: 4, status: 'q' },
        { code: 'CC', P: 3, W: 1, D: 0, L: 2, GF: 3, GA: 4, status: 'alive' },
        { code: 'DD', P: 3, W: 0, D: 1, L: 2, GF: 1, GA: 5, status: 'out' }
      ]
    },
    matches: []
  });
  const r = WC._rankGroup('Z').map(t => t.code);
  eq(r, ['AA', 'BB', 'CC', 'DD'], 'order by Pts/GD/GF');
});

test('display ranking breaks Pts+GD+GF tie via head-to-head match', () => {
  WC._setDataForTest({
    teams: [{ code: 'AA' }, { code: 'BB' }, { code: 'CC' }, { code: 'DD' }],
    groups: { Z: ['AA', 'BB', 'CC', 'DD'] },
    // AA and BB identical on Pts/GD/GF -> need h2h; AA beat BB in a real match
    groupStats: {
      Z: [
        { code: 'AA', P: 3, W: 2, D: 0, L: 1, GF: 4, GA: 2, status: 'q' },
        { code: 'BB', P: 3, W: 2, D: 0, L: 1, GF: 4, GA: 2, status: 'q' },
        { code: 'CC', P: 3, W: 1, D: 0, L: 2, GF: 2, GA: 4, status: 'alive' },
        { code: 'DD', P: 3, W: 1, D: 0, L: 2, GF: 2, GA: 4, status: 'out' }
      ]
    },
    matches: [FT('AA', 'BB', 1, 0)]
  });
  const ranked = WC._rankGroup('Z');
  const r = ranked.map(t => t.code);
  eq(r.slice(0, 2), ['AA', 'BB'], 'AA ahead of BB via h2h');
  ok(ranked[0].h2h && ranked[1].h2h, 'h2h flag set on tied teams');
});

console.log('\ndetectUpset:');

test('flags a clear upset (weak beats strong)', () => {
  WC._setDataForTest({ teams: [{ code: 'BRA' }, { code: 'HAI' }], groups: {}, groupStats: {}, matches: [] });
  ok(WC._detectUpset({ home: 'HAI', away: 'BRA' }, [2, 1]) === true, 'HAI over BRA = upset');
  ok(WC._detectUpset({ home: 'BRA', away: 'HAI' }, [2, 1]) === false, 'BRA over HAI = not upset');
  ok(WC._detectUpset({ home: 'BRA', away: 'HAI' }, [1, 1]) === false, 'draw = not upset');
});

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
