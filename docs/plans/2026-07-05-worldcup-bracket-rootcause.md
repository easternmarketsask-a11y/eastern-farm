# 世界杯赛程赛果不准 · 根因与修复（2026-07-05）

## 症状
Chris 报告：世界杯赛程/赛果有不准确的情况，需要及时性。

## 根因（已核实）
淘汰赛对阵**不是从真实赛程读的，而是用手工维护的 `KO_FEEDERS` 表推算**
（客户端 worldcup.js 显示 + 服务端 wcLottery.ts 竞猜 seeding，两处同一张表）。
这张表把 R32 胜者连到 R16 槽位的连线**错了 4 条**，推出的对阵在现实中**根本不存在**：

| 槽位(真实开球时间) | ESPN 真实对阵 | KO_FEEDERS 推算(错) |
|---|---|---|
| M089 07-04 17:00 | CAN v MAR | BRA v NOR |
| M090 07-04 21:00 | PAR v FRA | **CAN v PAR**（虚构）|
| M091 07-05 20:00 | BRA v NOR | **MAR v FRA**（虚构）|
| M092 07-06 00:00 | MEX v ENG | MEX v ENG ✓ |
| M093 07-06 19:00 | POR v ESP | ESP v POR ✓(顺序无妨) |
| M094 07-07 00:00 | USA v BEL | BEL v USA ✓ |
| M095 07-07 16:00 | ARG v EGY | **EGY v COL**（虚构）|
| M096 07-07 20:00 | SUI v COL | **SUI v ARG**（虚构）|

虚构对阵永远匹配不到 ESPN 的任何一场 → 该槽位永远拿不到比分/结果
→ 显示为「等待中」或错误对阵，并**级联污染** QF/SF/决赛。

**关键发现**：游戏每个淘汰赛槽位的 `kickoffUtc` 与 ESPN 对应场次的开球时间**逐分钟精确对齐**
（M089…M104 全部 1:1）。ESPN 按日期查询即给出该槽位的真实球队 + 比分 + 胜者。
所以正确做法是**按开球时间把槽位映射到 ESPN 场次，直接取真实对阵与结果**，
而不是维护一张会漂移、且与赛程 datetime 不一致的 KO_FEEDERS 推算表。

## 修复方案

### 客户端（显示，Chris 报告的核心）
- **ESPN datetime 权威映射**：fetchLive 里按 ESPN 场次开球时间建 `byTime` 索引；
  淘汰赛槽位按 `kickoffUtc` 命中 ESPN 场次 → 直接用 ESPN 的 home/away/比分/胜者填充
  （替代 KO_FEEDERS 推算）。已解析的槽位显示真实对阵 + 比分，及时（60s 刷新即出）。
- 未解析的未来槽位（ESPN 还是 RD16 Wx 占位）→ 显示中性「胜者待定」，
  **绝不再显示错误球队**。
- 结果：显示始终等于现实，且随 ESPN 发布即时更新。

### 服务端 / 竞猜（次要，涉及已有下注 + 已发奖）
- 竞猜已按错表 seed 了 4 场虚构 R16：M090(CAN v PAR)、M091(MAR v FRA)、
  M095(EGY v COL)、M096(SUI v ARG)，其中 M090/M091 **已有 3 笔下注**
  （Chris Huang 押 CAN、Jing 押 CAN、Jing 押 MAR），底币 1000 + 沙琪玛**已在下注时发出**（不可撤）。
- M089 已按 BRA v NOR 结算完（bonus-done）——BRA v NOR 是真实场次（只是槽位标签与
  datetime 不符），下注按真实结果结算有效，**不动已结算的**。
- 待办：把 4 场虚构 open 场次改成真实对阵（M095/M096 无下注可直接改；M090/M091 有下注需
  善后）；服务端 seeding 改为按 ESPN datetime（或至少停止产出虚构对阵）；3 笔下注按
  「店家 seeding 失误」善意处理（底币+沙琪玛保留，bonus 从宽）。**需 Chris 拍板善后口径。**

## 已完成（2026-07-05）
- ✅ **服务端** wcLottery.ts：`fillProgression` 重写为 `espnPairingAt(kickoffUtc)` 按开球时间
  取真实对阵，弃用 KO_FEEDERS。已部署 wcLotteryTick/DrawNow。验证：强制 tick 后
  **M097(QF1) 正确 seed 为 FRA v MAR**（旧表会出虚构对阵）。已 commit。
- ✅ **数据** 修正两场未来 R16：M095→ARG v EGY、M096→SUI v COL（0 下注，安全），现可正确下注。
- ✅ **已结算的 3 笔下注善后**：强制 tick 用真实对阵结算了 M090/M091（原虚构 open）：
  - M090 按真实 PAR v FRA 结算（FRA 胜）→ Chris Huang / Jing 押 CAN，correct=false，无 bonus
  - M091 按真实 BRA v NOR 结算（NOR 胜）→ Jing 押 MAR，correct=false，无 bonus
  - 三人**底币 1000 + 沙琪玛（报名时已发）全部保留**，无人被错发/错扣 bonus。结算无误。
  - doc 的 home/away 仍是当时展示的虚构对阵（与他们下注时所见一致，作历史记录保留）。
  - ⏳ **待 Chris 拍板**：是否对这 3 人（尤其 Jing 押 MAR，MAR 现实中确实赢了自己那场）
    发善意 bonus（纯免费农场币）。默认不发亦公平。
- ⏳ **客户端显示**：ESPN datetime 权威映射（子 agent 实施中，待验证+deploy.sh 上线）。

## 红线
- 不动已结算/已发奖的下注与实物券。
- 农场币/竞猜底币零成本，善后从宽不亏钱。
- 世界杯 7/19 结束、7 月底退场，修复以「剩余赛程正确 + 及时」为准。
