# 世界杯观赛台 + 竞猜模块 — Claude Code 实现规格

> 目标:在 **Eastern Farm**(farm.easternmarket.ca,浏览器游戏)内新增一个「世界杯观赛台」场景,
> 含赛程/赛果、积分与晋级、淘汰赛对阵图三大面板,外加一个**农场币竞猜**子系统。
> 单一赛事(2026 FIFA World Cup, 美/加/墨, 48 队 104 场)。所有时间转萨斯喀彻温 UTC−6(不调夏令时)。

---

## 0. 先做这件事:探查代码库(STEP 0,动手前必做)

不要假设技术栈。先 audit 当前 Eastern Farm 仓库,把下面这些摸清楚并写进一个 `WC_AUDIT.md`,然后再开始实现:

1. **前端框架**:原生 JS / React / Vue / Phaser / 其它?观赛台 UI 要复用现有的场景切换、UI 组件、字体与配色 token。
2. **后端**:Node / Python / 其它?路由怎么注册?有没有现成的定时任务(cron / scheduler)机制?
3. **农场币(农场币 Farm Coins)系统**:
   - 存在哪个表/集合?字段名?(余额、交易流水)
   - 有没有现成的「增减农场币」函数 / API?**竞猜发奖必须复用它,不要自己写余额读写**,以免和游戏经济不一致。
   - 用户标识怎么取(session / JWT / 玩家 id)?
4. **东方积分(Eastern Points)**:确认竞猜**完全不碰**东方积分。只读余额做展示都不要。竞猜奖励 100% 是农场币。
5. **现有数据落盘约定**:游戏存档、配置放哪?`data/wc2026.json` 应遵循同样位置与读写约定。

把发现写进 `WC_AUDIT.md` 再继续。后续所有「调用农场币接口」都用你在 audit 里确认的真实函数名。

---

## 1. 架构总览

```
Eastern Farm 仓库
├── 后端
│   ├── wc/fetch.<ext>          # API-Football 轮询器(写 data/wc2026.json)
│   ├── wc/settle.<ext>         # 竞猜结算(人工确认闸门后发农场币)
│   ├── wc/routes.<ext>         # /api/wc/* 路由
│   └── wc/predict.<ext>        # 晋级概率(蒙特卡洛)+ tiebreaker 计算
├── data/
│   ├── wc2026.json             # ★ 唯一真相源(matches/groups/teams)
│   └── wc_bets.<store>         # 竞猜下注 + 结算状态(走农场币现有库则不需要)
└── 前端
    └── scenes/worldcup/        # 观赛台场景(三面板 + 竞猜 UI)
```

**数据流哲学(照搬你 supplier-receipt-voucher 的「自动+人工纠错」):**
- API-Football 是**建议值**,写入 `wc2026.json` 的 `apiScore`。
- `wc2026.json` 是**唯一真相源**。前端、积分、竞猜结算都只读它。
- 比分进入 `officialScore` 字段、且 `settled=false→ready` 需要**你手动点「确认结算」**。
- 确认后才触发发农场币。**API 误报永远不会自动把农场币发出去。**

---

## 2. 数据源(已定方案,勿改)

### 主源:API-Football 免费档
- 免费档:全 endpoint 可用,**每日 100 次请求**上限。单一赛事够用。
- **轮询调度**(关键省额度):
  - 比赛窗口期(任意比赛 kickoff 前 5 分钟 → kickoff 后 130 分钟):每 **60 秒**拉一次该场。
  - 窗口外:**完全不拉**。每天预拉 1 次当日赛程即可。
  - 一天最多 8 场 × 各约 135 分钟 ≈ 远低于 100 次/天。
- 拉到的比分写入对应 match 的 `apiScore` 与 `apiStatus`,**绝不直接写 officialScore**。
- API key 放环境变量 `APIFOOTBALL_KEY`,不要硬编码。

### 兜底源:手动 JSON
- `data/wc2026.json` 可直接手编。API 抽风/争议/补录时,人工就是真相。
- 后端任何读取都以该文件现值为准;fetch 器只覆盖 `apiScore`/`apiStatus`,不动人工字段。

### 可选第三兜底
- 开源 repo `github.com/rezarahiminia/worldcup2026`(worldcup26.ir,有 `/get/games` `/get/groups` `/get/standings`,无需 auth)可作启动种子数据或离线兜底。**不可作结算依据**(个人维护、及时性不保证)。

---

## 3. `wc2026.json` Schema(唯一真相源)

见同目录 `data/wc2026.schema.json`(JSON Schema)与 `data/wc2026.seed.json`(可直接用的种子数据,含真实分组与截至 6/26 的积分)。要点:

```jsonc
{
  "meta": { "competition": "FIFA World Cup 2026", "tzOffset": -6, "lastUpdated": "ISO" },
  "teams":  [ { "code":"MEX", "name":"Mexico", "cn":"墨西哥", "flag":"🇲🇽", "group":"A" } ],
  "groups": { "A": ["MEX","RSA","KOR","CZE"], ... },
  "matches": [
    {
      "id": "M001",
      "stage": "group|r32|r16|qf|sf|3p|final",
      "round": "小组赛 第1轮",         // 展示用
      "group": "A",                     // 淘汰赛为 null
      "kickoffUtc": "2026-06-11T19:00:00Z",
      "venue": "Mexico City", "city": "Mexico City",
      "home": "MEX", "away": "RSA",     // team code;淘汰赛未定时用占位 "1A","2B","W49"…
      "apiScore":      [2,1],           // API 建议值,可为 null
      "apiStatus":     "FT|LIVE|NS",    // not started / live / finished
      "officialScore": [2,1],           // ★ 人工确认的真相;结算只认它
      "officialFinal": true,            // 人工确认「这就是终场比分」
      "scorers": [ {"team":"MEX","player":"…","minute":23} ]  // 可选,有就显示时间线
    }
  ]
}
```

**字段责任边界(务必遵守):**
| 字段 | 谁写 | 谁读 |
|---|---|---|
| `apiScore` / `apiStatus` | fetch 器自动 | 前端显示「实时(待确认)」 |
| `officialScore` / `officialFinal` | **人工**(管理面板或直接编辑) | 积分计算、竞猜结算 |
| `scorers` | API 或人工 | 前端进球时间线 |

---

## 4. 三大面板(前端)

复用我已交付的单文件原型逻辑(`worldcup2026.html`,见附件)——把它的三块拆进 Farm 场景。视觉沿用 Farm 的 Hay Day 风格 token,不要用原型的暗色主题(那只是独立 demo 配色)。

### 4.1 赛程 / 赛果
- 全部 matches 按萨省时间分天排列。`officialFinal` 显示终场比分;`apiStatus=LIVE` 显示脉冲+「实时(待确认)」。
- 筛选:球队搜索、阶段、今天 / 未开始 / 已结束 / 黄金时段(萨省 17–23 点)。
- **新增 .ics 导出**:选中的比赛(或「我的球队」全部)导出标准 iCalendar,VEVENT 用萨省本地时间,黄金时段比赛加 `VALARM` 提前 30 分钟提醒。一键塞进 iPhone 日历。
- **「我的球队」**:玩家关注列表,存玩家档(走 Farm 现有玩家数据),只看跟的队。

### 4.2 积分 / 晋级
- 12 组实时积分,Pts/GD **由 officialScore 重算**,不信任何外部「现成表」。
- **完整官方 tiebreaker 链**(新赛制争议点,务必全做):
  1. 积分 → 2. 净胜球 → 3. 进球数 →
  4. **正面交锋**:同分球队之间的小积分、净胜球、进球数(需 match 级数据,你有 officialScore 就能算)→
  5. 公平竞赛分(红黄牌,数据没有就跳过并标注)→ 6. 抽签(标「待抽签」)。
  - 实现成纯函数 `rankGroup(teams, matches)`,带单元测试覆盖「三队同分靠 h2h 区分」的案例。
- **最佳第三名竞赛**:12 个第三名按 Pts→GD→GF→(抽签)排,前 8 出线,画晋级分界线。
- **第三名情景模拟器**:未踢的比赛,玩家手动设比分 →实时重算谁出线。纯前端 what-if,不写回真相源。

### 4.3 淘汰赛对阵图
- R32 落位:小组赛全部 `officialFinal` 后,按官方 bracket 规则锁定真实对阵(规则见 §6 附注,FIFA 公布的 1A/2B 等映射要用官方表,别用原型里的简化配对)。
- 未锁定前:显示「待小组赛结束」占位。
- **预测器**:玩家点选晋级,一路到决赛预测冠军(逻辑见原型,含清下游)。预测存玩家档。
- **赛后打分排行榜**:真实结果出来后,给每个玩家的预测打分(每轮命中给分),排行榜展示。可发农场币奖励(走 §5 同一发奖闸门)。

---

## 5. 竞猜子系统(农场币)★ 核心安全区

### 5.1 玩法(建议起步,简单可靠)
- **胜平负竞猜**:每场比赛开赛前,玩家用农场币押 主胜/平/客胜。赔率固定(如 1×/2×/3×)或简单按池分配。起步用**固定赔率**最省事。
- 截止:`kickoffUtc` 一到自动锁盘,不再接受下注。
- 结算:见 §5.3。

### 5.2 下注流程
1. 校验:比赛未开赛(`now < kickoffUtc` 且 `apiStatus=NS`)、玩家农场币余额 ≥ 押注额。
2. **扣农场币**:调用 audit 里确认的农场币扣减函数(原子操作,防并发双花)。
3. 写入 `wc_bets`:`{betId, playerId, matchId, pick, stake, oddsAtBet, status:"pending", createdAt}`。
4. 失败回滚:扣币与写注必须同一事务;任一失败则全回滚。

### 5.3 结算 ★ 人工确认闸门(绝不自动发币)
**三步,缺一不可:**
1. fetch 器把 API 比分写进 `apiScore`(自动)。
2. **你在管理面板看一眼**,把比分录入 `officialScore` 并勾 `officialFinal=true`(人工)。
   - 可提供「采用 API 比分」一键按钮,但仍需人点一下确认,等于人工背书。
3. 点「**结算本场**」→ `settle` 脚本对该 match 所有 `pending` 注:
   - 判定输赢 → 赢家**发农场币** = `stake × odds`(调用农场币增加函数)。
   - 标 `status:"won"|"lost"|"void"`、写 `settledAt`、`payout`。
   - **幂等**:已结算的注不可重复发币(用 status 守卫 + 唯一约束)。

**安全要求(硬性):**
- 发农场币只走「人工确认 officialFinal + 点结算」这一条路径。API 状态再怎么变都不会触发发币。
- 结算操作要幂等、有审计日志(谁、何时、发了多少)。
- 比分录错可「撤销结算」:回收已发农场币、注退回 pending。实现成可逆。
- 竞猜涉及农场币变动的每一步都写流水,跟你 ledger.csv 思路一致——**农场币账要平**。

### 5.4 边界情况
- 比赛取消/改期:注 `void` 全额退农场币。
- 平局玩法缺失:确保三选项(主/平/客)都能押。
- 玩家中途余额不足并发:扣币原子化解决。

---

## 6. 后端路由(`/api/wc/*`)

```
GET  /api/wc/state                 → 返回 wc2026.json(前端三面板的全部数据)
GET  /api/wc/me                    → 当前玩家:农场币余额、我的球队、我的预测、我的注
POST /api/wc/bet                   → {matchId, pick, stake} 下注(§5.2)
GET  /api/wc/bets                  → 我的注列表 + 状态
POST /api/wc/predict               → 保存对阵图预测
GET  /api/wc/ics?teams=MEX,CAN     → 返回 .ics(萨省时间 + 黄金时段提醒)
-- 管理(鉴权,仅你)--
POST /api/wc/admin/official        → {matchId, score:[h,a], final:true} 录真相
POST /api/wc/admin/settle          → {matchId} 结算本场(发币闸门)
POST /api/wc/admin/unsettle        → {matchId} 撤销结算(回收农场币)
```

管理路由必须鉴权(复用 Farm 现有 admin 鉴权;没有就加最简 token 校验)。普通玩家碰不到结算。

---

## 7. 定时任务(Windows Task Scheduler / Farm 现有调度)

- `wc/fetch` 跑法:常驻轻量进程或每分钟触发,内部判断「现在是否处于任意比赛窗口」,是才打 API。
- 沿用你 daily-briefing-pipeline 的 Task Scheduler 引导风格写一个 `wc_scheduler_setup.md`。
- 记录每次拉取的请求计数,逼近 100/天 时降频并告警(留余量)。

---

## 8. 测试(必须有)

- `rankGroup` 单元测试:含三队同分靠正面交锋区分、第三名跨组排序。
- 结算幂等测试:重复调 settle 不重复发币;unsettle 正确回收。
- 下注并发测试:余额刚好够一注时两个并发请求只成功一个。
- .ics 输出:能被 iPhone 日历正确解析,时间是萨省本地。

---

## 9. 交付顺序(建议)

1. STEP 0 audit → `WC_AUDIT.md`
2. 落地 `wc2026.json`(用种子数据)+ schema 校验 + `/api/wc/state`
3. 前端三面板(读 state),先静态后交互
4. fetch 器 + 轮询(写 apiScore)
5. 管理面板 official + settle 闸门
6. 竞猜下注 + 结算(农场币走 audit 确认的接口)
7. 晋级概率、情景模拟器、预测排行榜、.ics 导出
8. 测试 + Task Scheduler 引导

---

## 附:已交付原型
独立单文件原型 `worldcup2026.html`(暗色 demo 主题)已包含可直接复用的:萨省时区转换、赛程筛选、tiebreaker 排序骨架、第三名竞赛表、对阵图预测器(含清下游)。**逻辑复用,视觉换成 Farm 风格。**
