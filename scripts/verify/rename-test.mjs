// 「小东」→「东超」改名契约（2026-08-22 Chris）。
// NPC 从一个人变成店本身，所以除了字面替换，还要保证不再把它当「人」称呼。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(js|json|html|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const files = [...walk('src'), ...walk('data')];
const hits = files.filter((f) => fs.readFileSync(join(root, f), 'utf8').includes('小东'));
assert.deepEqual(hits, [], '不该再有「小东」：' + hits.join(', '));

// 英文侧本来就叫 Orders / Kitchen / the storekeeper，但历史上有个 Xiaodong
const xd = files.filter((f) => /Xiaodong/i.test(fs.readFileSync(join(root, f), 'utf8')));
assert.deepEqual(xd, [], '英文里的 Xiaodong 也要一起改：' + xd.join(', '));

// JSON 改完不能坏
for (const f of files.filter((f) => f.endsWith('.json'))) {
  try { JSON.parse(fs.readFileSync(join(root, f), 'utf8')); }
  catch (e) { assert.fail(f + ' 不是合法 JSON：' + e.message); }
}
console.log('ok rename (' + files.length + ' files scanned)');
