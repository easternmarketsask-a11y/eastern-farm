#!/usr/bin/env node
/**
 * sim-level-pace.mjs — B5 内容曲线验收模型。
 *
 * 重跑「休闲盘 / 活跃盘」升级节奏，重点看 Lv15→20 每级空窗天数（内容悬崖修复目标 ≤4 天/级）。
 *
 * 模型（与 2026-07-07 审计一致）：
 *   - 每天 3 个白天档 + 1 个过夜档；白天各种一茬 ≤6h 的最优作物，过夜种一茬 ≤12h 的最优作物。
 *   - 每块地每天理论完成 3 茬（2×6h + 1×12h）；乘 utilization（休闲 0.6 / 活跃 0.9）。
 *   - 最优作物 = 当前等级已解锁、生长时长落在槽位内、xp 最高者（multi_harvest 计整段总 xp）。
 *   - 地块数 = PLOT_UNLOCK_AT 累计（与 state.js 同表）。
 *
 * xpForLevel 复制 state.js（XP_TABLE_FIXED + 超线性外推）。
 * 用法: node scripts/verify/sim-level-pace.mjs
 * 退出码 0 = Lv15-19 每级休闲盘空窗 ≤4 天；否则 1。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const crops = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'crops.json'), 'utf8')).crops;

// ---- state.js xpForLevel (keep in sync) ----
const XP_TABLE_FIXED = [0, 10, 30, 80, 180, 350, 600, 1000, 1600, 2500, 4000,
                        6000, 8500, 11500, 15000, 19000];
function xpForLevel(level) {
  if (level <= 0) return 0;
  if (level <= XP_TABLE_FIXED.length) return XP_TABLE_FIXED[level - 1];
  const k = level - XP_TABLE_FIXED.length;
  return Math.round(19000 + 4000 * k * (1 + k * 0.05));   // keep in sync with state.js
}

// ---- PLOT_UNLOCK_AT (keep in sync with state.js) ----
const PLOT_UNLOCK_AT = { 2: 2, 3: 2, 4: 2, 5: 2, 7: 1, 10: 1, 12: 1, 15: 1, 17: 1, 20: 1, 30: 1, 50: 1, 75: 1, 100: 1, 150: 1, 200: 1, 300: 1, 500: 1 };
function basePlots(L) {
  let n = 4;
  for (let lv = 2; lv <= L; lv++) n += (PLOT_UNLOCK_AT[lv] || 0);
  return n;
}

// crop total xp for one full cycle (multi_harvest counts all cuts)
function cropCycleXp(c) {
  const cuts = c.multi_harvest ? (c.harvest_count || 3) : 1;
  return (c.xp_reward || 0) * cuts;
}
// effective grow span for a multi_harvest crop's full cycle (first grow + regrows)
function cropCycleMinutes(c) {
  if (!c.multi_harvest) return c.grow_minutes;
  const cuts = c.harvest_count || 3;
  return c.grow_minutes + (cuts - 1) * (c.regrow_minutes || c.grow_minutes);
}

function bestXpForSlot(level, maxMinutes) {
  // Honest gate: a crop only counts for a slot if its FULL cycle (incl. all
  // multi_harvest regrows) fits the slot — so jiu_huang (5h+2×2h) is a 12h
  // crop, not a 6h one. Prevents over-crediting multi-harvest in short slots.
  let best = 0, name = null;
  for (const id of Object.keys(crops)) {
    const c = crops[id];
    if ((c.unlock_level || 1) > level) continue;
    if (cropCycleMinutes(c) > maxMinutes) continue;
    const x = cropCycleXp(c);
    if (x > best) { best = x; name = id; }
  }
  return { xp: best, id: name };
}

function dailyXp(level, util) {
  const plots = basePlots(level);
  const b6 = bestXpForSlot(level, 360).xp;     // two daytime 6h slots
  const b12 = bestXpForSlot(level, 720).xp;    // one overnight 12h slot
  return util * plots * (2 * b6 + b12);
}

function simulate(util) {
  const rows = [];
  for (let L = 1; L <= 25; L++) {
    const need = xpForLevel(L + 1) - xpForLevel(L);
    const perDay = dailyXp(L, util);
    const days = perDay > 0 ? need / perDay : Infinity;
    rows.push({ L, need, perDay: Math.round(perDay), days: +days.toFixed(2), plots: basePlots(L),
                best6: bestXpForSlot(L, 360), best12: bestXpForSlot(L, 720) });
  }
  return rows;
}

function report(label, rows) {
  console.log('\n=== ' + label + ' ===');
  console.log('Lv  plots  need   xp/day  days   best6h        best12h');
  for (const r of rows) {
    if (r.L < 8 || r.L > 21) continue;
    console.log(
      String(r.L).padStart(2) + '   ' +
      String(r.plots).padStart(3) + '   ' +
      String(r.need).padStart(5) + '  ' +
      String(r.perDay).padStart(6) + '  ' +
      String(r.days).padStart(5) + '   ' +
      String((r.best6.id || '-') + '(' + r.best6.xp + ')').padEnd(14) +
      (r.best12.id || '-') + '(' + r.best12.xp + ')'
    );
  }
}

const casual = simulate(0.6);
const active = simulate(0.9);
report('CASUAL (util 0.6)', casual);
report('ACTIVE (util 0.9)', active);

// Cumulative days to reach each level (casual) — surfaces the "content cliff".
function cumDays(rows) {
  let d = 0; const out = {};
  for (const r of rows) { out[r.L] = +d.toFixed(1); d += r.days; }
  out[26] = +d.toFixed(1);
  return out;
}
const cum = cumDays(casual);
console.log('\nCasual cumulative days to reach: Lv14=' + cum[14] + '  Lv15=' + cum[15] +
            '  Lv17=' + cum[17] + '  Lv20=' + cum[20] + '  Lv21=' + cum[21]);

// GATE: casual days-per-level for Lv15..19 must be ≤ 4 (content-cliff target).
const CLIFF = casual.filter(r => r.L >= 15 && r.L <= 19);
const worst = Math.max(...CLIFF.map(r => r.days));
const pass = worst <= 4;
console.log('\nLv15-19 worst days/level (casual): ' + worst.toFixed(2) + '  → GATE ' + (pass ? 'PASS' : 'FAIL') + ' (need ≤4)');
process.exit(pass ? 0 : 1);
