# 邻里偷菜 + 作物打理（Phase 1a）— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给东方农场补上「玩法脊柱」：可选的浇水/施肥（核心循环加深）+ 异步偷菜（被偷/主动偷/回家小报/讨回来）+ 看家狗防御 + 够真的本地确定性 AI 邻居。纯前端、零后端、任意人气下可玩。

**Architecture:** 全部挂现有 `Farm.*` 命名空间、vanilla JS、无 build。新增 4 个模块（`ai-neighbors.js` 确定性 AI 引擎 / `social-steal.js` 偷菜规则与结算 / `home-report.js` 回家小报 / `tending.js` 浇水施肥动作）+ 1 个数据文件（`data/ai-neighbors.json`）；其余改动落在 `crops.js`（生长/产量数学）、`farm.js`（地块交互 UI）、`state.js`（存档字段+迁移）、`neighbors.js`（AI 混排+偷菜入口）、`main.js`（开局触发小报）、`ep-shop.js`/`shop.js`（化肥+看家狗）。AI 邻居农场 = `f(seed, now)` 纯函数，离线可算；被偷是「归来结算」异步模型，不需要对方在线。

**Tech Stack:** Vanilla JS（无 build / 无 npm / **无测试框架**——本项目铁律），现有 Firebase compat（本轮 Phase 1a 不动后端/Firestore），GitHub Pages 托管。

---

## ⚠️ 本计划的执行约定（务必先读）

沿用上一份计划（`2026-06-07-daily-engagement-retention.md`）的两条高优先级规矩：

1. **无测试框架、无 npm、无 build**。每个任务的「验证」= **手动试玩 + 浏览器控制台检查**，不写 jest/pytest。验证步骤都给了可观察预期。要快速验证时间相关逻辑，可临时改 `Date.now()` 或在控制台手动调 `Farm.*` 函数观察，**测完务必还原**。
2. **「写给 Claude Code 的 Prompt 原则」**：不规定函数名/参数/代码组织。每个任务**先读现有代码**，再按现有风格自己决定实现。计划给的是：改哪些文件、要什么行为、字段名、已知坑、验收标准。

**通用红线（每个任务都适用）：**
- 改 `state.js` 存档结构时：只**新增**字段（靠现有 `Object.assign(STARTER_STATE, parsed)` 自动补到老存档），**绝不**删字段或重置老玩家进度。存档是神圣的。改前先确认 `state.js` 的迁移机制 + 是否要升 `save.version`。
- **两币分离**：本轮经济只用**农场币**（`addCoins`）+ 作物，**不产出/不消耗超市积分**（`addEastPoints`）。文案统一「农场币」，**禁用「金币」**。
- **分寸红线（偷菜）**：单次离开最多被顺 `RAID_MAX_PLOTS=2` 块；离开 < `RAID_MIN_AWAY=2h` 零损失；**仓库永不被碰**（只动「已熟未收」的地块）；数值保证「主动偷到的 >> 被偷走的」；文案全程「顺走/尝鲜/小馋嘴/串门」，**禁用「偷/抢/盗」**。
- 所有新 UI 文案**中英双语**，走现有 `Farm.i18n` / `data/i18n.json`，不硬编码单语。
- 视觉遵守治愈系：奶油底、品牌红、圆角、轻阴影；禁高饱和霓虹/频闪。复用现有 confetti/toast/floatText/modal 体系，不另造。
- **单一数据源 / 统一模板**：作物状态读写统一走 `Farm.crops` + `Farm.state`；偷菜的几个调参常量（`RAID_*` / `STEAL_*` / `WATER_SPEEDUP` / `FERT_*`）**集中放一处**（建议 `social-steal.js` 顶部 `Farm.socialConfig`），别分散复制。
- 每个任务做完**先自测**（按验收清单），iPhone 真机 + 桌面 DevTools 移动模式各过一遍，控制台无红色报错，再 commit。
- **commit 可以做；push 一律 Chris 亲手执行。** 不要 `git push`。只 `git add` 本任务碰的文件，别把别的对话留下的未提交改动卷进来。
- **本轮 Phase 1a 改动较大且 main 自动部署到生产游戏**。建议 Chris 先开分支再让 Claude Code 动手：
  ```bash
  cd D:/easternmarket.ca/eastern-farm
  git status              # 确认干净
  git checkout -b farm-social-202606
  ```
  满意后再由 Chris 合回 main 触发上线（遵守父 CLAUDE.md「UI 改造工作流」）。

---

## 字段命名约定（跨任务必须一致）

| 字段 | 位置 | 含义 | 引入任务 |
|---|---|---|---|
| `plot.watered` | 每块 plot | 本生长周期是否已浇水（防重复浇） | T1 |
| `plot.fertilized` | 每块 plot | 本块是否已施肥（下次收获翻倍） | T2 |
| `state.data.fertilizer` | player | 拥有的化肥数量（库存） | T2 |
| `state.data.lastActiveAt` | player | 上次活跃/结算时间戳（算离开窗口） | T5（T1 先确认是否已存在） |
| `state.data.raidLog` | player | 最近一次离开期间的偷/帮事件数组（喂回家小报） | T5 |
| `state.data.aiRelationships` | player | `{aiId: {helpedByMe, stolenByMe, owesMeGift,...}}` AI 对你的记忆 | T3/T5 |
| `state.data.defenses` | player | `{dog: {owned, onDuty}}` 等防御道具状态 | T6 |
| `dailyClaims.stolenToday` | dailyClaims | 今日已主动偷的总块数（午夜重置） | T4 |
| `dailyClaims.stolenFromTargets` | dailyClaims | `{targetId: count}` 今日对每个对象偷了几块 | T4 |
| `Farm.socialConfig` | social-steal.js 顶部 | 全部调参常量集中处 | T4 |

**调参常量默认值**（集中在 `Farm.socialConfig`，上线后可调）：
`RAID_MIN_AWAY = 2*60*60*1000`（2h）、`RAID_MAX_PLOTS = 2`、`STEAL_MAX_PER_DAY = 6`、`STEAL_PER_TARGET = 2`、`WATER_SPEEDUP = 0.2`、`FERT_YIELD_MULT = 2`、`DOG_PROTECT = 1`（看家狗少被偷 1 块）。

---

## 文件结构总览

| 文件 | 责任 | 任务 |
|---|---|---|
| `src/js/tending.js`（新建） | 浇水/施肥的用户动作 + 视觉触发（数学在 crops.js） | T1, T2 |
| `src/js/crops.js`（改） | 浇水改有效生长时间；施肥改收获产量 | T1, T2 |
| `src/js/farm.js`（改） | 地块上的浇水/施肥按钮；被偷后重渲染；看家狗在岗视觉 | T1, T2, T6 |
| `src/js/state.js`（改） | 新增存档字段 + mutator + 迁移；午夜重置加偷菜计数 | T1–T6 |
| `src/js/shop.js` / `src/js/ep-shop.js`（改） | 商店卖化肥；看家狗（复用 pet 类别） | T2, T6 |
| `data/ai-neighbors.json`（新建） | ~12 个 AI 邻居名册（身份/性格/作息/升级速率） | T3 |
| `src/js/ai-neighbors.js`（新建） | 确定性 AI 引擎：`farmStateAt` / `levelAt` / 性格 / 模拟偷你 / 反应 | T3, T5 |
| `src/js/neighbors.js`（改） | AI 与真会员混排（today-3+排行榜）；viewFarm 渲染 AI 真农场 + 偷菜入口 | T3, T4 |
| `src/js/social-steal.js`（新建） | `Farm.socialConfig` + 主动偷动作 + 被偷结算规则 + 上限/冷却 | T4, T5 |
| `src/js/home-report.js`（新建） | 回家小报 modal + 「去讨回来」+ 互助好消息 | T5 |
| `src/js/main.js`（改） | 开局检测离开窗口 → 触发结算 + 小报 | T5 |
| `src/css/style.css` / `animations.css`（改） | 水光/金光/小报/偷菜动效 | T1–T6 |
| `data/i18n.json`（改） | 全部新文案双语 | T1–T7 |
| `src/index.html`（改） | 按依赖顺序引入 4 个新 JS（在 `main.js` 之前） | T1–T5 各自挂载 |

---

## Task 1: 打理系统 — 浇水（最小、最先做）

**纯前端 + 一个 plot 字段。立刻给核心循环加「每次进来有事做」。**

**Files:**
- Read first：
  - `src/js/crops.js`（`getStage`/`getProgress`/`timeRemaining` 怎么用 `plantedAt` + `grow_minutes` 算；`plant()` 初始化 plot 字段；`harvest()` 里 multi-harvest 怎么重置 `plantedAt`）
  - `src/js/state.js`（`STARTER_STATE` 里 `plots[]` 结构、`save()` 自动存、`Object.assign` 迁移机制、是否已有 `lastActiveAt`/类似字段——**记下来给 T5 用**）
  - `src/js/farm.js`（`createPlotElement` 里 growing 分支怎么画进度条/时间标签；`offerAccelerate` 点击生长中作物的现有交互——浇水按钮要和它共存不打架；`tick()` 刷新方式）
  - `src/js/firebase-game-sync.js` 的 `sendHelp`（**spec §6.2**：现有「帮浇水」到底干了什么——是否仅给帮忙者发农场币、有没有碰被帮者作物。决定 T1 是否顺便打通「帮浇水真生效」）
- Create：`src/js/tending.js`
- Modify：`src/js/crops.js`、`src/js/farm.js`、`src/js/state.js`、`src/index.html`、`src/css/style.css`、`data/i18n.json`

**行为规格：**
- **每块生长中的作物，本周期可浇水 1 次**，浇水后**剩余生长时间减少 `WATER_SPEEDUP=20%`**（即 remaining → 0.8×remaining）。实现思路（自己定细节）：把 `plot.plantedAt` 往前移 `0.2 ×（当前剩余毫秒）`，使有效已用时间增加、剩余缩短；并置 `plot.watered = true` 防重复。
- **周期重置**：`plant()` 新种时 `watered=false`；multi-harvest 在 `harvest()` 重置 `plantedAt` 那处也要 `watered=false`（割一茬可再浇一次）。
- **不浇照常长**：缺省 `watered=false`，不浇水作物生长完全不受影响（不惩罚、不停滞）。
- **交互**：点击「生长中」的作物——现有是 `offerAccelerate`（加速券）。浇水按钮要与之并存：建议点生长中作物弹的小浮层里，同时给「💧 浇水」（未浇时）+ 现有加速券选项。已浇过则「💧 浇水」灰掉显示「今日已浇」。**不要**新开一套点击逻辑覆盖 `offerAccelerate`，在它基础上加。
- **视觉**：浇水后作物出现 💧 水光（短动画）+ 进度条立刻跳进。复用 `Farm.ui.floatText`/现有动画。
- **帮浇水打通（视 sendHelp 现状决定范围）**：若现有 `sendHelp` 只给帮忙者发币、没碰被帮者作物——本任务**先只做自己浇自己**，把「好友/AI 帮浇水真加速被帮者作物」留到 T5（需要异步作用于离线玩家，归到结算/小报体系更自然）。在 `tending.js` 留一个可复用的「对某 plot 施加浇水提速」纯函数，供 T5 调。

**Steps:**
- [ ] **Step 1: 读上述代码**，确认：生长时间数学在哪、点击生长中作物的现有入口、plot 字段初始化点、`sendHelp` 现状、`state.js` 有无 `lastActiveAt`（记给 T5）。
- [ ] **Step 2: 改 `state.js`**：`STARTER_STATE` 的 plot 模板加 `watered:false`（或在 plant 时写入）；确认老存档经 `Object.assign` 加载不报错（plot 内嵌字段可能不被顶层 assign 覆盖，**实测**老存档里旧 plot 没有 `watered` 时读取为 `undefined` 也能正常当 false 用）。
- [ ] **Step 3: 写 `tending.js`**（`Farm.tending`）：`waterPlot(plotIdx)` —— 校验生长中且未浇 → 调 crops 提速 + 置 `watered` + save + 视觉；导出一个纯函数 `applyWaterSpeedup(plot)` 供复用。挂 `window.Farm.tending`。
- [ ] **Step 4: 改 `crops.js`**：在 `plant()` 与 multi-harvest 重置处维护 `watered`；（提速可由 tending 调用，crops 提供改 `plantedAt` 的入口或直接在 tending 改——保持单一来源，别两处都改 plantedAt）。
- [ ] **Step 5: 改 `farm.js`**：生长中作物的点击浮层加「💧 浇水/今日已浇」按钮，接 `Farm.tending.waterPlot`；浇完即时重渲染该地块。
- [ ] **Step 6: index.html 引入 `tending.js`**（在 `crops.js`/`farm.js` 之后、`main.js` 之前）+ i18n 双语文案 + 水光样式。
- [ ] **Step 7: 手动验证**：
  - 种下一棵生长中作物 → 点它 → 出现「浇水」+ 现有加速券选项并存
  - 浇水 → 剩余时间明显缩短（约 -20%）、出现水光、进度条跳进、按钮变「今日已浇」
  - 再点 → 不能重复浇
  - 不浇的作物照常生长到成熟（不受影响）
  - multi-harvest（韭菜）割一茬后可再次浇水
  - 老存档加载不报错；中英文案都对；控制台无报错
- [ ] **Step 8: commit**：`git add src/js/tending.js src/js/crops.js src/js/farm.js src/js/state.js src/index.html src/css/style.css data/i18n.json && git commit -m "feat(打理): 浇水——生长中作物可浇水提速20%(可选不强制)"`

---

## Task 2: 打理系统 — 施肥（收敛 bumperCharges）

**高危：必须把现有全局 `bumperCharges` 收敛成逐块施肥，不留两套（单一数据源铁律）。**

**Files:**
- Read first：
  - **grep `bumperCharges` 全部读写点**（spec §6.3）：`crops.js`（`harvest()` 里用它给双倍）、`state.js`（`activeEffects` 初始化）、`ep-shop.js`/`daily.js`/转盘奖励（哪里发的 bumperCharges）、`farm.js`（收获时 `result.bumper` 飘字）。把每一处记下来。
  - `src/js/shop.js`（现有商店买东西的 UI + 扣农场币流程）、`src/js/ep-shop.js`（道具/装饰商品数据结构，化肥可作为农场币商品加在哪）
- Modify：`src/js/crops.js`、`src/js/state.js`、`src/js/tending.js`、`src/js/farm.js`、`src/js/shop.js`（或 `ep-shop.js`，按现有商店归属定）、`data/i18n.json`、`src/css/style.css`

**行为规格：**
- 商店出售 🌟 **化肥**（农场币购买，价格参考现有经济量级，别拍脑袋通胀）。买入增加 `state.data.fertilizer` 计数。
- **逐块施用**：对某块作物施肥 → 消耗 1 个化肥 + 置 `plot.fertilized=true`。该块**下次收获产量翻倍**（入库 2 棵，受仓库容量约束）。
- **收敛现有 bumper**：把 `crops.harvest()` 里「`activeEffects.bumperCharges>0 则双倍」改为「`plot.fertilized` 则双倍」，收获后 `plot.fertilized=false`。`result.bumper` 飘字逻辑保留（复用现有「🌟 双倍收获」飘字）。
- **迁移老玩家的 bumperCharges**：`state.init()` 迁移时若老存档 `activeEffects.bumperCharges>0` → 转成等量 `state.data.fertilizer`（别让老玩家道具凭空消失）。迁移后清零 `bumperCharges`。
- **断掉旧发放源**：原来发 bumperCharges 的地方（转盘/商店等）改发 `fertilizer` 计数，保持「同一种东西只有一个表示」。
- **决策价值**：施肥宜投在高价值/可能被偷的作物（与偷菜赌注咬合）——文案点一句即可，不强制。
- **视觉**：施过肥的作物金色微光（与浇水水光区分）。

**Steps:**
- [ ] **Step 1: grep + 读**：列出 `bumperCharges` 每个读写点 + 现有商店买入流程 + 经济量级。
- [ ] **Step 2: 改 `state.js`**：加 `fertilizer:0`（STARTER_STATE）；plot 模板加 `fertilized:false`；写迁移：老 `bumperCharges` → `fertilizer` 后清零；加 mutator（买入加、施用减）。
- [ ] **Step 3: 改 `crops.js`**：`harvest()` 双倍判定从 `bumperCharges` 切到 `plot.fertilized`，收获后清 `fertilized`；multi-harvest 同样逐茬判定。
- [ ] **Step 4: 改 `tending.js`**：`fertilizePlot(plotIdx)` —— 校验有化肥库存且该块未施 → 扣库存 + 置 `fertilized` + save + 金光视觉。
- [ ] **Step 5: 改 `farm.js`**：地块点击浮层加「🌟 施肥（剩 N）/已施肥」；接 `Farm.tending.fertilizePlot`。
- [ ] **Step 6: 改商店**（`shop.js`/`ep-shop.js`）：上架化肥（农场币）；把旧 bumperCharges 发放源改发 fertilizer。
- [ ] **Step 7: i18n + 样式**。
- [ ] **Step 8: 手动验证**：
  - 商店买化肥 → `fertilizer` 计数 +1、扣对农场币
  - 对一块作物施肥 → 金光、库存 -1、标记已施
  - 收获该块 → 入库 2 棵（仓满则只入到满 + 提示，不凭空消失）、`fertilized` 复位
  - **老存档迁移**：造一个 `activeEffects.bumperCharges=3` 的旧存档 → 加载后变成 `fertilizer=3`、`bumperCharges` 清零、收获行为正常
  - 全局再没有「自动双倍」残留（旧 bumper 完全切到逐块）
  - 中英文案对；控制台无报错
- [ ] **Step 9: commit**：`git add src/js/tending.js src/js/crops.js src/js/state.js src/js/farm.js src/js/shop.js src/js/ep-shop.js data/i18n.json src/css/style.css && git commit -m "feat(打理): 施肥——逐块化肥产量翻倍，收敛旧全局bumperCharges+迁移老存档"`

---

## Task 3: 够真的 AI 邻居引擎

**核心新引擎。AI 农场必须随真实时间长、有真实熟了的菜（T4 偷菜依赖）、随天数升级、有性格。反转「不要假玩家」旧决策（已经 Chris 确认）。**

**Files:**
- Read first：
  - `src/js/neighbors.js`（**全文**：`generateFarmDisplay()` 随机一次性农场怎么生成、`_fetchToday()`/`_fetchLeaderboard()` 怎么取真会员、`avatarFor()`、`viewFarm()` 渲染结构、`hashStr`/`mulberry32` 既有确定性工具——复用别重写）
  - `src/js/crops.js`（`all()`/作物 `grow_minutes`/`unlock_level`，AI 种什么、长多快要用真实作物配置）
  - `src/js/firebase-game-sync.js`（`fetchVisiblePool`/`fetchLeaderboard`/`displayName`/`onlineStatus` 返回结构——AI 条目要拼成兼容形状才能和真会员混排）
- Create：`data/ai-neighbors.json`、`src/js/ai-neighbors.js`
- Modify：`src/js/neighbors.js`、`src/index.html`、`data/i18n.json`

**行为规格：**
- `data/ai-neighbors.json`：~12 个 AI 邻居，每个：`id`（稳定字符串 seed）、`name_zh`/`name_en`、`avatar`(emoji)、`personality`(`greedy`/`kind`/`balanced`)、`activeHours`([起,止] 24h，如傍晚)、`levelEpoch`(某固定起算日期串)、`growthRate`(每多少天升 1 级)、`cropPrefs`(偏好作物 id 数组)。名字要像萨城华人邻里（王阿姨/张大叔/李奶奶…可扩展现有 `FALLBACK_POOL`）。
- `src/js/ai-neighbors.js`（`Farm.aiNeighbors`），**全确定性、纯函数**（复用 neighbors.js 的 `hashStr`/`mulberry32`，或自带同款）：
  - `roster()` → 读 json。
  - `farmStateAt(aiId, nowMs)` → 12 块地的 `{cropId, stage, mature}`。要点：用 `(seed, 时间分桶)` 推每块地的「播种时刻」，使作物随真实时间**播种→生长→成熟→（被收/重播）**。**同一 aiId+同一时刻结果恒定**；不同时刻看不一样；**要有若干真实 mature 的地块**（供 T4 偷）。成熟用真实作物 `grow_minutes`。
  - `levelAt(aiId, nowMs)` → `base + floor(自 levelEpoch 的天数 / growthRate)`，随天数缓慢增长。
  - `isActiveNow(aiId, nowMs)` / personality 读取 → 供 T5 模拟「谁来偷你」。
  - `displayCard(aiId)` → 拼成与真会员混排兼容的条目（name/emoji/level/totalHarvests 等可由确定性函数估算）。
- **整合进 `neighbors.js`**：
  - `_fetchToday()`：真会员不足 3 个时，用 AI 邻居补足到 3（**有真会员优先真人**，AI 兜底；不再显示「还没邻居在线」空状态）。AI 条目带 `isAI:true`（内部用，UI 不显式标「AI」字样——要够真）。
  - `_fetchLeaderboard()`：把 AI 邻居按其 `levelAt`/收获估值并入排行榜一起排序（真会员 + AI 混排）。
  - `viewFarm()`：当对象是 AI 时，菜地用 `aiNeighbors.farmStateAt(id, Date.now())` 渲染**真实在长的农场**（替换对 AI 用 `generateFarmDisplay` 的随机版；真会员在 1a 仍用占位 `generateFarmDisplay`，因为没同步真农场）。
- **本任务不做偷**：T3 只让 AI 农场「看起来真、有熟菜」；点熟菜偷的动作 T4 做。

**Steps:**
- [ ] **Step 1: 读 neighbors.js 全文 + fbGameSync 取数结构**，确认混排需要的条目形状、可复用的 hash/rng/avatar。
- [ ] **Step 2: 写 `data/ai-neighbors.json`**（12 个，性格/作息/升级速率分布合理）。
- [ ] **Step 3: 写 `ai-neighbors.js`**：`roster`/`farmStateAt`/`levelAt`/`isActiveNow`/`displayCard`，全确定性。先单独在控制台验证：`Farm.aiNeighbors.farmStateAt('wang_ayi', Date.now())` 早晚跑结果不同、同一时刻多次跑一致、有 mature 地块。
- [ ] **Step 4: 改 `neighbors.js`**：today-3 用 AI 兜底补足；排行榜混排；viewFarm 对 AI 渲染真农场。保留真会员逻辑不变。
- [ ] **Step 5: index.html 引入 `ai-neighbors.json` 加载 + `ai-neighbors.js`**（在 `neighbors.js` 之前）+ i18n。
- [ ] **Step 6: 手动验证**：
  - 无真会员时，今日邻居仍显示 3 个有名有姓的 AI（不再是空状态）
  - 点进某 AI → 看到一个像样的、有熟菜也有在长的菜地；早上看和（改系统时间/等）晚些看状态不同
  - 排行榜里 AI 和真会员混在一起，等级看着正常、不同 AI 不同
  - 同一 AI 反复进出农场布局稳定（不是每次随机乱跳）
  - 控制台无报错
- [ ] **Step 7: commit**：`git add data/ai-neighbors.json src/js/ai-neighbors.js src/js/neighbors.js src/index.html data/i18n.json && git commit -m "feat(AI邻居): 本地确定性引擎——随时间生长的真农场+随天数升级+性格作息，混排进今日/排行榜"`

---

## Task 4: 主动偷（你 → AI 邻居）

**让逛邻居变成有即时奖励的爽点。建立 `Farm.socialConfig` 调参中心 + 偷菜上限/冷却。**

**Files:**
- Read first：
  - `src/js/neighbors.js` 的 `viewFarm()`（菜地每块怎么渲染——要在 mature 块上加「顺一棵」入口；现有 like/help/sticker 按钮区结构）
  - `src/js/state.js`（`addToWarehouse`/`isWarehouseFull`、`dailyClaims` 结构与午夜重置点——偷菜每日计数要并进 dailyClaims）
  - `src/js/ai-neighbors.js`（`farmStateAt` 返回的 plot 形状，确定哪些块 mature 可偷）
- Create：`src/js/social-steal.js`
- Modify：`src/js/neighbors.js`、`src/js/state.js`、`src/index.html`、`data/i18n.json`、`src/css/style.css`

**行为规格：**
- `social-steal.js`（`Farm.steal` + `Farm.socialConfig`）：
  - `Farm.socialConfig` = 上面「调参常量默认值」全集中在此（T5/T6 也引用同一处）。
  - `canStealFrom(targetId)` → 校验今日总数 `dailyClaims.stolenToday < STEAL_MAX_PER_DAY` 且对该对象 `stolenFromTargets[targetId] < STEAL_PER_TARGET`。
  - `stealOne(targetId, cropId)` → 入自己仓库（遵守 `isWarehouseFull`，满则提示去卖菜、不偷成）；`stolenToday++`、`stolenFromTargets[targetId]++`；save。
- **`viewFarm()` 加偷菜入口**：AI（1b 起含真人）农场里**已熟**的地块显示可点「🧺 顺一棵」。点击 → `Farm.steal.stealOne`；成功后该地块本次访问内标记已顺（视觉变空/灰），并飘「🧺 +1 入库」。
- **上限/冷却**：达到单户上限 → 该农场其余熟菜按钮显示「今天就顺这么多啦」；达到每日总上限 → 提示「今天顺得够多啦，明天再来」。**逼用户多逛几家**。
- **净占便宜**：`STEAL_MAX_PER_DAY=6` 远大于被偷上限（T5 的 2），保证净赚。
- **话术红线**：按钮/提示用「顺/尝鲜/串门」，禁「偷/抢」。
- 偷 AI 是**本地收益**（AI 农场确定性，不需真扣对方）；本次访问内隐藏已顺地块即可。

**Steps:**
- [ ] **Step 1: 读 viewFarm 渲染 + state 仓库/ dailyClaims**，确认每日计数挂哪、午夜怎么重置（并进现有 dailyClaims 重置）。
- [ ] **Step 2: 写 `social-steal.js`**：`Farm.socialConfig` + `canStealFrom`/`stealOne`，每日计数读写 dailyClaims。
- [ ] **Step 3: 改 `state.js`**：`dailyClaims` 加 `stolenToday:0`、`stolenFromTargets:{}`，纳入午夜重置；确认迁移不报错。
- [ ] **Step 4: 改 `neighbors.js` viewFarm**：mature 地块加「顺一棵」按钮 + 点击接 steal + 上限态提示 + 飘字。
- [ ] **Step 5: index.html 引入 `social-steal.js`**（在 ai-neighbors/neighbors 之后）+ i18n + 样式。
- [ ] **Step 6: 手动验证**：
  - 进 AI 农场 → 熟菜上有「顺一棵」→ 点 → 入仓 + 飘字 + 该块变空
  - 对同一家顺到 `STEAL_PER_TARGET=2` → 其余熟菜提示「今天就顺这么多」
  - 逛多家顺到每日 `STEAL_MAX_PER_DAY=6` → 提示「明天再来」
  - 仓库满时顺 → 不偷成 + 提示去卖菜（无凭空入仓）
  - 次日（改日期/清 dailyClaims）→ 计数重置
  - 文案无「偷/抢」字样；控制台无报错
- [ ] **Step 7: commit**：`git add src/js/social-steal.js src/js/neighbors.js src/js/state.js src/index.html data/i18n.json src/css/style.css && git commit -m "feat(偷菜): 主动顺菜——逛邻居顺熟菜入仓，每日总/单户上限+冷却(净占便宜)"`

---

## Task 5: 被偷结算 + 回家小报 + 讨回来

**把「牵挂」做出来：离开归来时，AI 顺了你的菜 + 有人帮了你，一张温馨小报告诉你，并给「去讨回来」闭环。也在此打通「帮浇水真生效」。**

**Files:**
- Read first：
  - `src/js/main.js`（启动流程：存档加载后、首屏渲染处——小报要在这触发；确认 `Farm.state.data` 此时已就绪）
  - `src/js/state.js`（**确认/新增 `lastActiveAt`**：是否已有等价字段记上次活跃；`plots` 成熟判定、清空地块方式；`addEastPoints` 别误用——本轮只用农场币）
  - `src/js/ai-neighbors.js`（`isActiveNow`/personality/`displayCard`——选「谁来偷你」）
  - `src/js/social-steal.js`（`Farm.socialConfig` 的 `RAID_*`）
  - `src/js/crops.js` + `src/js/tending.js`（`applyWaterSpeedup` 纯函数——「帮浇水」好消息要真作用于你的某块在长作物）
- Create：`src/js/home-report.js`
- Modify：`src/js/main.js`、`src/js/state.js`、`src/js/ai-neighbors.js`、`data/i18n.json`、`src/css/style.css`

**行为规格：**
- **离开窗口**：开局算 `awayMs = Date.now() - lastActiveAt`。结算后把 `lastActiveAt = Date.now()`。`lastActiveAt` 若 T1 发现已有等价字段就复用（单一数据源），没有则在此新增 + 迁移（老存档缺则初始化为 now，**首次加载不误判为离开很久**）。
- **触发条件**：`awayMs >= RAID_MIN_AWAY(2h)` 才结算 + 弹小报；否则什么都不做（短暂查看零打扰、零损失）。
- **被偷结算**（`Farm.steal` 里加 `settleRaid(awayMs)`，或放 ai-neighbors，择一，别重复）：
  - 候选 = 你「已熟、未收、未被防御保护」的地块。
  - 选最多 `RAID_MAX_PLOTS(2)` 块（T6 看家狗会再减）。离开越久越可能吃满，但**不超上限**。
  - 被顺的地块**清空**（等同被人替你收走）；**仓库不碰**。
  - 给每块指派一个「小贼」AI（按 `isActiveNow`+`greedy` 性格优先），写进 `raidLog`。
- **互助好消息（平衡情绪）**：按概率/关系，挑 1–2 个 `kind` 性格 AI 做好事，真生效：
  - 「帮你浇水」→ 对你某块在长作物调 `Farm.tending.applyWaterSpeedup`（真提速）。
  - 「送你种子/农场币」→ `addSeed`/`addCoins` 小额真到账。
  - 写进 `raidLog`（好消息段）。
  - **关系反应**（`aiRelationships`）：你之前帮过/偷过的 AI，这次行为相应偏向（你帮过的更可能回礼；你偷过的更可能来顺你）。
- **回家小报**（`home-report.js`，`Farm.homeReport.show(raidLog)`）：
  - 坏消息列表（🐔 谁顺了你 N 棵 X）每条带头像 + 「去讨回来 ➡️」。
  - 好消息列表（💧 谁帮你浇水 / 🎁 谁送你东西）。
  - 无任何事件则不弹。视觉温馨「邻里公告栏」，复用现有 modal，不指责不施压。
  - 「去讨回来」→ 关小报 + 调 `Farm.neighbors.viewFarm` 进该 AI 农场；对「偷过你」的对象本次主动偷享**额外宽限**（临时 `STEAL_PER_TARGET+1`，记在内存/ dailyClaims）。
- **首屏顺序**：小报应在农场渲染后、其它开局弹窗（签到/促销）之前或之后排好队，别和现有开局弹窗打架（读 main.js 现有开局弹窗序）。

**Steps:**
- [ ] **Step 1: 读 main.js 开局序 + state lastActiveAt 现状**，定 `lastActiveAt` 复用还是新增 + 小报插在弹窗队列哪一环。
- [ ] **Step 2: 改 `state.js`**：确保有 `lastActiveAt`（缺则加 + 迁移初始化为 now）、`raidLog:[]`、`aiRelationships:{}`；加结算后更新 `lastActiveAt` 的方式。
- [ ] **Step 3: 写被偷+互助结算**（放 `social-steal.js` 的 `settleRaid` 或 ai-neighbors，单一处）：算 awayMs、选地块、清空被顺块、指派小贼、生成好消息真到账、写 raidLog。引用 `Farm.socialConfig`。
- [ ] **Step 4: 写 `home-report.js`**：渲染坏/好消息 + 去讨回来（含额外宽限）。
- [ ] **Step 5: 改 `main.js`**：开局（存档就绪、农场渲染后）调结算；有事件则 `Farm.homeReport.show`。
- [ ] **Step 6: i18n（小报全套文案，含小贼/帮忙模板，可参考现有 `viewFarm` greeting 风格）+ 样式**。
- [ ] **Step 7: 手动验证**（用临时改 `lastActiveAt` 往前推 3h 模拟离开）：
  - 地里留几块熟菜不收 → 把 `lastActiveAt` 往前推 3h → 刷新 → 弹小报：被顺 ≤2 块、对应地块清空、仓库没动
  - 小报里有「去讨回来」→ 点 → 进那个 AI 农场，可多顺一块（宽限生效）
  - 好消息「帮你浇水」→ 你某块在长作物确实提速了
  - 离开 < 2h（推 1h）→ 不弹小报、零损失
  - 看家狗未做时，被顺正好到上限；无熟菜可顺时只显示好消息或不弹
  - 首次全新存档不会误判「离开很久」被狂偷
  - 只动农场币、没动超市积分；文案无「偷/抢」；控制台无报错；**测完还原 lastActiveAt**
- [ ] **Step 8: commit**：`git add src/js/home-report.js src/js/social-steal.js src/js/ai-neighbors.js src/js/main.js src/js/state.js data/i18n.json src/css/style.css && git commit -m "feat(偷菜): 被偷结算+回家小报+去讨回来，打通帮浇水真生效，AI关系反应"`

---

## Task 6: 看家狗防御

**给「护菜」一个花农场币的选择 + 抓贼反转爽点。复用现有 pet 装饰渲染。**

**Files:**
- Read first：
  - `src/js/ep-shop.js`（`pet` 装饰类别商品数据结构、`decoration_emoji` 字段、购买流程）
  - `src/js/farm.js` 的 `renderDecorations()`（**现有已渲染会走动的 pet**——看家狗可复用这套，在岗时画一只狗）
  - `src/js/social-steal.js` 的 `settleRaid`（防御要在选地块/指派小贼时介入）
- Modify：`src/js/ep-shop.js`（或 shop.js）、`src/js/social-steal.js`、`src/js/state.js`、`src/js/farm.js`、`data/i18n.json`、`src/css/style.css`

**行为规格：**
- 商店上架 🐕 **看家狗**（农场币购买；可直接做成 `pet` 类别的一个装饰商品，买了即「装饰 + 防御」二合一）。
- `state.data.defenses = { dog: { owned:false, onDuty:false } }`（买后 owned=true，可在岗切换；简单起见买了默认在岗）。
- **结算介入**（`settleRaid`）：狗在岗时，被偷上限 `RAID_MAX_PLOTS` 减 `DOG_PROTECT(1)`；**并有概率抓住小贼**：抓住时该次不被偷且生成反转好消息「🐕 旺财逮住了来串门的 X，TA 赔了你 1 棵菜赔礼！」（给你 +1 对应作物入仓，仓满则给少量农场币）。写进 raidLog 好消息段。
- **视觉**：在岗看家狗复用 `renderDecorations()` 的 pet 渲染（农场里有只狗溜达）。
- 范围控制：**V1 只做看家狗**，篱笆/稻草人不做（spec 允许）。

**Steps:**
- [ ] **Step 1: 读 ep-shop pet 商品结构 + renderDecorations pet 渲染 + settleRaid**。
- [ ] **Step 2: 改 `state.js`**：加 `defenses.dog`，迁移补默认。
- [ ] **Step 3: 上架看家狗**（ep-shop/shop，农场币），买入置 owned/onDuty。
- [ ] **Step 4: 改 `settleRaid`**：在岗狗减被偷上限 + 抓贼概率 + 赔礼反转好消息（引用 `Farm.socialConfig.DOG_PROTECT`）。
- [ ] **Step 5: 改 `farm.js`**：在岗狗走 renderDecorations pet 渲染。
- [ ] **Step 6: i18n + 样式**。
- [ ] **Step 7: 手动验证**：
  - 买看家狗 → 扣农场币 → 农场里出现溜达的狗
  - 留熟菜 + 推 lastActiveAt 3h + 狗在岗 → 被偷数比没狗时少（少 1）或触发「抓贼赔礼」反转好消息、对应到账
  - 没买狗的对照：被偷正常到上限
  - 老存档无 defenses 字段加载不报错
  - 文案双语；控制台无报错
- [ ] **Step 8: commit**：`git add src/js/ep-shop.js src/js/shop.js src/js/social-steal.js src/js/state.js src/js/farm.js data/i18n.json src/css/style.css && git commit -m "feat(防御): 看家狗——在岗减少被偷+概率抓贼赔礼(复用pet装饰渲染)"`

---

## Task 7: 整合 + 调性打磨 + 净占便宜校准

**把六块串成一个连贯体验，做净值校验和双语/视觉收尾。无新功能，只打磨。**

**Files:**
- Read first：以上全部新模块 + `data/i18n.json`（查漏补缺）
- Modify：按打磨需要小改各文件 + `data/i18n.json`、`src/css/*`

**行为规格 / 检查项：**
- **净占便宜实测**：模拟「正常玩一天」（早晚各上线一次、各离开几小时），核对「主动顺到的总数」明显多于「被顺走的总数」。不达标则调 `Farm.socialConfig`（升 `STEAL_MAX_PER_DAY` 或降 `RAID_MAX_PLOTS`），**只改这一处常量**。
- **入口可达性**：浇水/施肥（地块点击浮层）、主动偷（邻居农场）、回家小报（开局）、看家狗（商店）、去讨回来（小报）——每条路径都顺、无死链。
- **情绪平衡**：小报里坏消息从不「一边倒」——确保 `kind` AI 的好消息有足够出现率，玩家不会每次回来只看到被偷。
- **双语全覆盖**：grep 新增 UI 里有没有漏成单语的硬编码字符串。
- **视觉一致**：水光/金光/小报/偷菜飘字都在治愈系范围，无霓虹/频闪；移动端 360px 不溢出。
- **红线复查**：全程无「偷/抢/盗」；离开<2h 零损失；仓库永不被碰；只动农场币不动超市积分。

**Steps:**
- [ ] **Step 1: 通玩一遍**（桌面 + iPhone 真机）：种→浇→施→收→逛邻居顺菜→离开→回来看小报→讨回来→买狗→再离开验证狗生效。
- [ ] **Step 2: 净值校验**，必要时只调 `Farm.socialConfig` 常量。
- [ ] **Step 3: 双语 + 视觉 + 移动端**查漏补缺。
- [ ] **Step 4: 红线逐条复查**（对照本计划「分寸红线」）。
- [ ] **Step 5: 自测报告**（按四道保险格式：✅/❌/⚠️ 列每条功能）。
- [ ] **Step 6: commit**：`git add -A -- src/ data/ && git commit -m "polish(社交): 整合打磨——净占便宜校准+双语/视觉收尾+红线复查"`（只 add src/ data/，别卷入无关改动）
- [ ] **Step 7: 交回 Chris**：在分支自测全过后，由 Chris 按父 CLAUDE.md「合并回 main 之前」清单确认，再合 main 触发上线；上线后 5–10 分钟抽查生产 URL 核心功能。

---

## 自查（计划 vs 设计 spec 覆盖）

- 打理-浇水（可选/提速20%/不惩罚/帮浇水生效）→ T1 + T5（帮浇水）✅
- 打理-施肥（农场币买/逐块/产量翻倍/收敛 bumperCharges + 迁移）→ T2 ✅
- 偷菜-赌注（仅已熟未收/仓库安全）→ T4 + T5 ✅
- 偷菜-被偷（≥2h/≤2块/可防御/指派小贼）→ T5 + T6 ✅
- 偷菜-主动偷（每日总6/单户2/冷却/净占便宜）→ T4 ✅
- 回家小报（坏+好消息/无事不弹/不指责）→ T5 ✅
- 讨回来（直达+额外宽限）→ T5 ✅
- 防御-看家狗（减被偷+抓贼反转/复用pet）→ T6 ✅
- AI够真（随时间生长真农场/随天数升级/性格作息/会偷你/会回应/混排）→ T3 + T5 ✅
- 历史决策反转（重新引入高质量AI）→ T3 ✅
- 数值集中 `Farm.socialConfig`、净占便宜校准 → T4 建立 + T7 校准 ✅
- 存档迁移安全（watered/fertilized/fertilizer/lastActiveAt/raidLog/aiRelationships/defenses/dailyClaims计数）→ 各任务 Step「改 state.js」+ 迁移实测 ✅
- 两币分离（只农场币不超市积分）→ 通用红线 + T2/T4/T5 强调 ✅
- 双语 / 治愈系视觉 / 移动端 → 通用红线 + T7 ✅
- Phase 1b（真人互偷）明确不在本计划 → spec §5 已声明，本计划只 1a ✅

**字段名跨任务一致**（见「字段命名约定」表）；调参常量集中 `Farm.socialConfig`；无占位符——每个任务都给了 Read-first、行为规格、可观察验收、commit 命令。
