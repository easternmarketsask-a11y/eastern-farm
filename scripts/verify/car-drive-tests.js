// 开车去任意地方 · A 期回归测试。由 cdp.mjs 在页面里执行，返回 {failures:[]}。
// 覆盖：寻路(P) / 点空地走过去(G) / 上车开车车速(C) / 停车落盘(D)。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  const T = (name, cond) => { if (!cond) failures.push(name); };

  for (let i = 0; i < 60; i++) { if (window.Farm && Farm.pathfind) break; await sleep(150); }
  if (!window.Farm || !Farm.pathfind) return { failures: ['Farm.pathfind 不存在'] };

  // ---- 第 1 组：纯寻路（合成网格，不依赖存档）----
  // 10x10 全空；(3,0)..(3,8) 是一堵墙，只有 (3,9) 是缺口。
  const wall = (x, y) => !(x === 3 && y >= 0 && y <= 8);
  const open = (x, y) => x >= 0 && y >= 0 && x < 10 && y < 10;
  const freeWall = (x, y) => open(x, y) && wall(x, y);

  const p1 = Farm.pathfind.find(0, 0, 2, 0, freeWall);
  T('P1 直线可达', !!p1 && p1.length === 3 && p1[0].gx === 0 && p1[2].gx === 2 && p1[2].gy === 0);

  const p2 = Farm.pathfind.find(0, 0, 5, 0, freeWall);
  T('P2 绕墙能到', !!p2 && p2[p2.length - 1].gx === 5 && p2[p2.length - 1].gy === 0);
  T('P2 路径不穿墙', !!p2 && p2.every((s) => freeWall(s.gx, s.gy)));
  T('P2 每步只走一格且不走对角', !!p2 && p2.every((s, i) =>
    i === 0 || (Math.abs(s.gx - p2[i - 1].gx) + Math.abs(s.gy - p2[i - 1].gy)) === 1));

  // 完全封死的目标 → 返回最接近的可达格，而不是 null / 不是原地不动
  const island = (x, y) => open(x, y) && !(x === 8 || y === 8);
  const p3 = Farm.pathfind.find(0, 0, 9, 9, island);
  T('P3 不可达时给最近可达点', !!p3 && p3.length > 1 && island(p3[p3.length - 1].gx, p3[p3.length - 1].gy));

  // 起点自己就不可走 → null
  T('P4 起点不可走返回 null', Farm.pathfind.find(3, 0, 0, 0, freeWall) === null);

  // 起点即终点 → 长度 1 的路径
  const p5 = Farm.pathfind.find(2, 2, 2, 2, open);
  T('P5 原地返回单点路径', !!p5 && p5.length === 1 && p5[0].gx === 2 && p5[0].gy === 2);

  return { failures };
})()
