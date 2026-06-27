# CLAUDE.md — 世界杯观赛台模块

本目录是 Eastern Farm 内的「2026 世界杯观赛台 + 农场币竞猜」模块。

## 动手前必读(按顺序)
1. `WORLDCUP_VIEWING_HUB.md` — 总规格,含 STEP 0 代码库探查(**必须先做**)
2. `docs/TIEBREAKER_REFERENCE.md` — 积分排序参考实现 + 测试(最易写错,照移植)
3. `docs/SETTLEMENT_SAFETY.md` — 农场币结算安全(硬性,账要平)
4. `data/wc2026.schema.json` + `data/wc2026.seed.json` — 真相源 schema 与种子数据

## 不可违反的约束
- **STEP 0 先探查**:不假设技术栈/农场币接口,先写 `WC_AUDIT.md` 摸清再动手。
- **农场币复用现有接口**:增减农场币一律调 Farm 现有函数,不自己读写余额。
- **东方积分零接触**:竞猜只发农场币,完全不碰东方积分(真钱、可核销)。
- **`wc2026.json` 是唯一真相源**:fetch 器只写 `apiScore/apiStatus`;`officialScore/officialFinal` 仅人工写;积分与结算只读 official。
- **结算三道闸门**:API 自动 → 人工确认终场 → 人工点结算才发币。误报绝不自动发币。
- **结算幂等 + 可撤销 + 留审计 + 定期对账**。
- 全部时间转萨斯喀彻温 UTC−6(不调夏令时)。

## 数据源(已定,勿改)
- 主:API-Football 免费档(100 req/天)。比赛窗口期每 60s 轮询,窗口外不打。Key 走环境变量 `APIFOOTBALL_KEY`。
- 兜底:手动编辑 `wc2026.json`,人工即真相。
- 可选种子/离线兜底:开源 `github.com/rezarahiminia/worldcup2026`(不可作结算依据)。

## 交付顺序
audit → 真相源+state 路由 → 三面板(读)→ fetch 轮询 → 管理面板(official+settle)→ 竞猜(下注+结算)→ 概率/模拟器/排行榜/.ics → 测试 + Task Scheduler 引导

## 测试基线(必须保留)
- `rankGroup` 单测(含三队同分靠正面交锋 + 完美循环→待抽签)
- 结算幂等(重复 settle 不重复发币)、unsettle 回收
- 下注并发(余额刚够时只成功一个)
- .ics 可被 iPhone 日历解析、时间为萨省本地
