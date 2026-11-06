import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = () => readFileSync(new URL('../../src/js/game-shell.js', import.meta.url), 'utf8');
function run({ game = '', saved = null, blocked = false } = {}) {
  const writes = [];
  const resume = { hidden: true, href: '', querySelector: () => label };
  const label = { textContent: '' };
  const document = {
    body: { dataset: { game } },
    readyState: 'complete',
    querySelector: (selector) => selector === '[data-resume-game]' ? resume : null,
    querySelectorAll: () => [],
  };
  const localStorage = {
    getItem: () => { if (blocked) throw new Error('storage denied'); return saved; },
    setItem: (key, value) => { if (blocked) throw new Error('storage denied'); writes.push({ key, value: JSON.parse(value) }); },
  };
  vm.runInNewContext(source(), { document, localStorage, Date, JSON, window: {} });
  return { writes, resume, label };
}

const farm = run({ game: 'farm' });
assert.equal(farm.writes[0].key, 'em_games_recent_v1');
assert.equal(farm.writes[0].value.path, '/src/index.html');
assert.equal(farm.writes[0].value.id, 'farm');
assert.ok(Number.isFinite(farm.writes[0].value.at));
assert.equal(run({ game: 'unknown' }).writes.length, 0);
assert.doesNotThrow(() => run({ game: 'table', blocked: true }));
assert.doesNotThrow(() => run({ blocked: true }));
assert.equal(run({ saved: '{bad json' }).resume.hidden, true);
assert.equal(run({ saved: JSON.stringify({ id: '__proto__' }) }).resume.hidden, true);
assert.equal(run({ game: 'constructor' }).writes.length, 0);
assert.equal(run({ saved: JSON.stringify({ id: 'table', path: 'https://evil.example/' }) }).resume.hidden, true);
assert.equal(run({ saved: JSON.stringify({ id: 'farm', path: '/src/dinner.html' }) }).resume.hidden, true);
assert.equal(run({ saved: JSON.stringify({ id: 'worldcup', path: '/src/worldcup.html' }) }).resume.hidden, true);
const table = run({ saved: JSON.stringify({ id: 'table', path: '/src/dinner.html', at: Date.now() }) });
assert.equal(table.resume.hidden, false);
assert.equal(table.resume.href, '/src/dinner.html');
assert.equal(table.label.textContent, '继续摆桌 · Continue your table');
console.log('PASS game shell: valid resume, safe routes, archive exclusion, blocked/corrupt storage (13 checks)');
