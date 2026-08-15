// precache-check.mjs — deploy 闸门：index.html 里 <script defer> 加载的每个模块，
// 都必须在 service-worker.js 的 PRECACHE 里（2026-08-15 加：store-rewards.js 漏了
// 一个多月没人发现——离线/弱网时它走网络，缓存优先策略对它形同虚设）。
// 反向（PRECACHE 里有、页面不加载）只警告，因为 data/*.json 是按需 fetch 的。
import { readFileSync } from 'node:fs';
const idx = readFileSync('src/index.html', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');
const scripts = [...idx.matchAll(/<script defer src="js\/([a-z0-9-]+\.js)"/g)].map((m) => m[1]);
const pre = new Set([...sw.matchAll(/'\/src\/js\/([a-z0-9-]+\.js)'/g)].map((m) => m[1]));
const missing = scripts.filter((s) => !pre.has(s));
if (missing.length) {
  console.error('✗ service-worker.js PRECACHE 缺少 index.html 加载的模块: ' + missing.join(', '));
  process.exit(1);
}
const extra = [...pre].filter((s) => !scripts.includes(s));
if (extra.length) console.log('⚠ PRECACHE 里有页面不再加载的模块(不阻断): ' + extra.join(', '));
console.log('  ✓ 预缓存清单覆盖全部 ' + scripts.length + ' 个页面模块');
