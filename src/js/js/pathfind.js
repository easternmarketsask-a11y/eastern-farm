/**
 * pathfind.js — 等距网格上的 BFS 寻路。
 *
 * 人物移动原本是 moveToward() 直线插值：近距离没事，一旦允许「点任意地方」，
 * 人会从水塘和房子里直接穿过去。这个模块只回答「怎么绕过去」，不关心谁在走 ——
 * 可走判据由调用方用 isFree(x,y) 传进来（人是 1 格，车要整个车身放得下）。
 *
 * 🔒 只走 4 邻接：对角会擦过建筑/水塘的角，看起来就是穿墙。
 */
(function () {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function find(sx, sy, gx, gy, isFree, maxCells) {
    sx = Math.round(sx); sy = Math.round(sy);
    gx = Math.round(gx); gy = Math.round(gy);
    if (typeof isFree !== 'function' || !isFree(sx, sy)) return null;

    const k = (x, y) => x + ',' + y;
    const startK = k(sx, sy);
    const prev = {}, seen = {};
    const q = [[sx, sy]];
    let head = 0, scanned = 0;
    const cap = maxCells || 4000;

    seen[startK] = 1;
    // 目标不可达时退而求其次：记住 BFS 走过的、离目标最近的一格。
    let best = [sx, sy];
    let bestD = Math.abs(sx - gx) + Math.abs(sy - gy);

    while (head < q.length && scanned < cap) {
      const cur = q[head++]; scanned++;
      const cx = cur[0], cy = cur[1];
      if (cx === gx && cy === gy) { best = cur; bestD = -1; break; }
      const d = Math.abs(cx - gx) + Math.abs(cy - gy);
      if (d < bestD) { bestD = d; best = cur; }
      for (let i = 0; i < 4; i++) {
        const nx = cx + DIRS[i][0], ny = cy + DIRS[i][1], nk = k(nx, ny);
        if (seen[nk] || !isFree(nx, ny)) continue;
        seen[nk] = 1; prev[nk] = k(cx, cy); q.push([nx, ny]);
      }
    }

    const path = [];
    let ck = k(best[0], best[1]);
    while (ck) {
      const parts = ck.split(',');
      path.push({ gx: +parts[0], gy: +parts[1] });
      if (ck === startK) break;
      ck = prev[ck];
    }
    path.reverse();
    return path;
  }

  window.Farm = window.Farm || {};
  Farm.pathfind = { find: find };
})();
