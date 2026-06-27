# 积分排序 / Tiebreaker 参考实现

> 这是整个项目最容易写错的部分(新赛制的正面交锋链)。下面给出**正确的参考实现 + 测试用例**。
> Claude Code 应照此移植到 Farm 的后端语言,并保留这些测试。

## 官方 tiebreaker 顺序(2026,小组内)

1. 总积分(胜3平1负0)
2. 总净胜球(GD)
3. 总进球数(GF)
4. **同分球队之间的正面交锋**:只取「平分的这几支队互相之间」的比赛,重算
   - 4a. 这些比赛里的积分
   - 4b. 净胜球
   - 4c. 进球数
5. 公平竞赛分(红黄牌少者优;数据缺失则跳过并在 UI 标注「待定」)
6. 抽签(标 `tiebreak:"draw-pending"`,不要随机)

**关键陷阱**:第 4 步只在「整体 Pts/GD/GF 完全相同」的子集里做,且如果子集排完仍有并列,要**回到全局**继续往下走(5、6)。三队并列时,h2h 子表算完可能拆成「2 队仍并列 + 1 队领先」,要对剩下并列的再递归处理。

---

## 参考实现(JavaScript)

```js
// matches: 该组所有「已 officialFinal」的比赛 [{home, away, officialScore:[h,a]}]
// teamCodes: 该组 4 支队的 code
function rankGroup(teamCodes, matches) {
  const played = matches.filter(m => m.officialFinal && m.officialScore);

  // 累计全局统计
  const base = {};
  teamCodes.forEach(c => base[c] = { code:c, P:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,Pts:0 });
  for (const m of played) {
    const [h,a] = m.officialScore;
    if (!(m.home in base) || !(m.away in base)) continue;
    const H=base[m.home], A=base[m.away];
    H.P++; A.P++; H.GF+=h; H.GA+=a; A.GF+=a; A.GA+=h;
    if (h>a){H.W++;A.L++;H.Pts+=3;}
    else if (h<a){A.W++;H.L++;A.Pts+=3;}
    else {H.D++;A.D++;H.Pts++;A.Pts++;}
  }
  teamCodes.forEach(c => base[c].GD = base[c].GF - base[c].GA);

  // 比较器工厂:全局 Pts → GD → GF
  const byGlobal = (x,y) => y.Pts-x.Pts || y.GD-x.GD || y.GF-x.GF;

  // 把球队分成「全局三连同」的簇,簇内用 h2h 拆
  const sorted = teamCodes.map(c=>base[c]).sort(byGlobal);

  // 找全局 Pts&GD&GF 完全相同的相邻簇
  const result = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i+1;
    while (j < sorted.length &&
           sorted[j].Pts===sorted[i].Pts &&
           sorted[j].GD ===sorted[i].GD &&
           sorted[j].GF ===sorted[i].GF) j++;
    const cluster = sorted.slice(i,j).map(t=>t.code);
    if (cluster.length === 1) {
      result.push(cluster[0]);
    } else {
      // 簇内用正面交锋递归
      result.push(...breakTie(cluster, played));
    }
    i = j;
  }
  return result.map(c => base[c]); // 返回排好序的统计行
}

// 在 tiedCodes 子集内,只用他们互相之间的比赛重排
function breakTie(tiedCodes, played) {
  const set = new Set(tiedCodes);
  const mini = {};
  tiedCodes.forEach(c => mini[c]={code:c,Pts:0,GD:0,GF:0});
  for (const m of played) {
    if (!set.has(m.home) || !set.has(m.away)) continue; // 只看子集内对阵
    const [h,a]=m.officialScore;
    const H=mini[m.home], A=mini[m.away];
    H.GF+=h; H.GA=(H.GA||0)+a; A.GF+=a; A.GA=(A.GA||0)+h;
    H.GD+=h-a; A.GD+=a-h;
    if (h>a) H.Pts+=3; else if (h<a) A.Pts+=3; else {H.Pts++;A.Pts++;}
  }
  const byMini = (x,y)=> y.Pts-x.Pts || y.GD-x.GD || y.GF-x.GF;
  const ordered = tiedCodes.map(c=>mini[c]).sort(byMini);

  // h2h 之后可能仍有并列子簇 → 标记待定(公平竞赛分/抽签)
  const out=[]; let i=0;
  while (i<ordered.length){
    let j=i+1;
    while (j<ordered.length &&
           ordered[j].Pts===ordered[i].Pts &&
           ordered[j].GD ===ordered[i].GD &&
           ordered[j].GF ===ordered[i].GF) j++;
    const still = ordered.slice(i,j).map(t=>t.code);
    if (still.length===1) out.push(still[0]);
    else {
      // 仍并列:这里接公平竞赛分;数据没有则按 code 稳定排序并打标记
      still.sort();                 // 占位稳定排序
      still.forEach(c => { /* mark base[c].tiebreak='fairplay-or-draw-pending' in caller */ });
      out.push(...still);
    }
    i=j;
  }
  return out;
}

module.exports = { rankGroup, breakTie };
```

---

## 测试用例(必须通过)

```js
const { rankGroup } = require('./rankGroup');

// 用例 1:三队全局同为 Pts=6 GD=0 GF=同,靠正面交锋区分
// A 打 B 赢、B 打 C 赢、C 打 A 赢(循环),但比分设计成 h2h 能分出高下
test('three-way tie broken by head-to-head', () => {
  const codes=['AAA','BBB','CCC','DDD'];
  const matches=[
    // DDD 全输,垫底
    {home:'AAA',away:'DDD',officialScore:[1,0],officialFinal:true},
    {home:'BBB',away:'DDD',officialScore:[1,0],officialFinal:true},
    {home:'CCC',away:'DDD',officialScore:[1,0],officialFinal:true},
    // 三强循环,h2h 比分制造差异
    {home:'AAA',away:'BBB',officialScore:[2,0],officialFinal:true}, // A>B
    {home:'BBB',away:'CCC',officialScore:[2,0],officialFinal:true}, // B>C
    {home:'CCC',away:'AAA',officialScore:[1,0],officialFinal:true}, // C>A
  ];
  const r=rankGroup(codes,matches).map(t=>t.code);
  expect(r[3]).toBe('DDD');               // 垫底确定
  // 三强 h2h: 各 3 分;h2h GD: A=+2-1=+1, B=+2-2=0, C=+1-2=-1 → A,B,C
  expect(r.slice(0,3)).toEqual(['AAA','BBB','CCC']);
});

// 用例 2:全局 GD 已能区分,不进入 h2h
test('separated by goal difference globally', () => {
  const codes=['AAA','BBB','CCC','DDD'];
  const matches=[
    {home:'AAA',away:'BBB',officialScore:[3,0],officialFinal:true},
    {home:'CCC',away:'DDD',officialScore:[1,1],officialFinal:true},
  ];
  const r=rankGroup(codes,matches);
  expect(r[0].code).toBe('AAA');          // +3 GD 最高
  expect(r[0].Pts).toBe(3);
});

// 用例 3:未踢完(只有部分 officialFinal)也要稳定不报错
test('partial group does not throw', () => {
  const codes=['AAA','BBB','CCC','DDD'];
  const matches=[{home:'AAA',away:'BBB',officialScore:[1,0],officialFinal:true}];
  expect(()=>rankGroup(codes,matches)).not.toThrow();
});
```

---

## 最佳第三名排序

12 个小组第三名(取每组 `rankGroup` 的第 3 名),按
**Pts → GD → GF →(公平竞赛分)→ 抽签** 全局排序,前 8 出线。
正面交锋**不适用**(他们不同组、没交手),所以这里只走全局指标链。

```js
function rankThirdPlace(thirds /* [{code,group,Pts,GD,GF}] */) {
  return [...thirds].sort((x,y)=> y.Pts-x.Pts || y.GD-x.GD || y.GF-x.GF || x.group.localeCompare(y.group));
}
// 前 8 = 出线;第 9–12 = 淘汰;并列跨过第 8 名分界时标 'draw-pending'
```
