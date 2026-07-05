# 东方农场 · 下一步优化方案（2026-07-05 制定）

> 承接同日「操作舒适度改造」4 批（见 `2026-07-05-ux-comfort-overhaul.md`）。
> 那一轮解决了「手感」；本方案解决 **Chris 的第一目标：店里引流 + 粘性**。
> 依据：同日跨仓库代码核实（游戏 eastern-farm / 后端 stockwise_final / 主站 frontend-web）。

## 一句话诊断

**粘性侧健康，业务闭环几乎全断。** 游戏能玩、社交完整、赚东方点能换真积分（正向单通）；
但「到店消费 → 农场奖励」的**回流闭环游戏侧一行没接**，也**没有任何度量能证明游戏带来了到店**。
后端三个端点全现成，缺的只是游戏侧接线 + 一个报表。

## 现状闭环体检（核实结论）

| 闭环 | 状态 | 断在哪 |
|---|---|---|
| 游戏赚东方点 → 真积分 | ✅ 通 | `firebase-points.js` → `/api/rewardup/me/earn`，单向发券 |
| 到店消费 → 农场奖励 | ❌ **全断** | `points_endpoints.py:402` claim + `clover_orders_endpoints.py:189` purchases 现成，游戏零调用 |
| 玩家是否带动到店（北极星） | ❌ **不存在** | 埋点只有匿名日计数 `farm_analytics`；`farm_players.id ≡ members.id` 可 join，二跳到 `clover_orders`，但对照计算没人写 |
| 本周真实特价 → 游戏 | ❌ 未接 | `is_on_sale`（`firebase_api_endpoints.py:163`）已上线可读，游戏没消费；`real_sku` 是占位码 |
| 粘性（社交/鸡舍/一键收/跳字动画） | ✅ 通 | — |
| 内容供给 | ⚠️ 悬崖 | XP/地块延到几百级，作物 Lv14 封顶、菜谱/成就 Lv10 封顶 → **真悬崖在 Lv10-14** |
| 手感打磨欠账 | ⚠️ | 面板全居中 modal（无底部抽屉）、相机无惯性、竖向开局大片天空 |

## 分阶段方案（按 Chris 目标价值排序）

### 🅰 阶段 A · 北极星度量先行（最便宜，解锁全部判断）✅ 上线 2026-07-05
> `GET /api/game/business-metrics`（`game_metrics_endpoints.py`，owner+staff 只读）+ 后台 game-mgmt Tab
> 只读对照卡片。单扫 clover_orders 窗口聚合 → join farm_players/members 分玩家 vs 非玩家，
> 输出到店率/人均差值 + joinCoverage。**下面是原始设计存档：**

**为什么先做**：不度量，后面所有引流改动都无法判断有没有用。数据现成，纯后端只读，零游戏改动、零成本、零风险。

- StockWise 加只读报表端点（admin 鉴权）：把 `farm_players`（≡ members）经 `members.clover_customer_id` join `clover_orders`，算：
  - 玩家群近 30 天：到店笔数 / 客单 / 复购率
  - 对照：有 `clover_customer_id` 但非玩家的会员群同指标
  - 输出「玩家 vs 非玩家到店差值」+ 玩家里「装了游戏后到店频次变化」
- 复用现成：`arch_member_purchase_history_20260518`（clover_orders 同步 + 手机号→customer_id）。
- 交付：StockWise 后台一个卡片 / 一封周报邮件（路由见 `project_workflow_email_routing`）。
- **红线**：只读，不碰积分账本；join 依赖 `clover_customer_id` 已回填——先报「可 join 覆盖率」，低了先补链。

### 🅱 阶段 B · 反向闭环：到店消费 → 农场奖励（引流核心，业务价值最高）✅ 上线 2026-07-05
> 后端 `POST /api/members/me/farm-purchase-rewards`（`game_rewards_endpoints.py`，会员鉴权，
> 只读 clover_orders + 只写 farm_purchase_rewards，事务幂等，**只发农场币不发东方点**）。
> 游戏侧 `store-rewards.js` 菜单入口「🧾 领取到店奖励」，四分支 + 庆祝揭示 + 农场币入账。
> 可选 `farm_rewards_config/config` 免部署调参。**下面是原始设计存档：**

**为什么最值**：这是「把线上玩家拉回实体店」最直接的机制，且完全缺失。买菜 = 农场有奖 → 玩家更愿意来店。

- 登录会员在游戏里点「🧾 领取到店奖励」→ 游戏调 `/api/members/me/purchases` 取近期订单 → 对**未认领**的订单发农场奖励。
- 无需扫码：会员已手机号→customer_id 解析，一键领即可（比扫小票顺滑；扫码作为未登录/未关联的兜底后置）。
- **奖励设计（严守成本铁律 #1）**：
  - 主奖 = 农场币（客户端货币，零真实成本，可慷慨，如每单 200-500 币按金额档）
  - 附奖 = 少量东方点（=真积分=负债），**每日封顶 + 幂等**，沿用 claim 的 `event_id="order:{oid}"` 防重复领
  - 泄压阀：单日领取上限、单单一次性、大额单不线性放大
- 后端可能要新增「游戏侧认领」轻端点（把已发农场奖励的 order 标记，防重复），或复用 claim 的幂等键在游戏账里记 claimedOrders[]。
- **红线**：农场币走客户端权威；任何东方点发放走服务端账本 + 封顶；POS 不写。

### 🅲 阶段 C · 真实特价进游戏（引流放大器）
- 游戏每周读 `is_on_sale` → 首页/店长 NPC 提示「本周店内特价：XX，去东方超市看看」+ 对应当季作物做联动高亮。
- 把 `real_sku` 从占位码用脚本匹配到真实 Clover 商品（C 依赖此，或先用商品名模糊匹配）。
- 让「农场当季作物」与「店内本周特价」对齐，游戏成为特价的软广渠道。
- **红线**：分类/商品数据唯一源是后端 API，不硬编码（CLAUDE.md 分类铁律）。

### 🅳 阶段 D · 内容悬崖 Lv10-16（粘性，非引流）
- 补 Lv10-16 作物（当前 Lv10 后每级 ≤1 种、Lv14 封顶）、菜谱（当前 Lv10 封顶 8 道）、成就（当前 Lv10 封顶 12 个）。
- 目标：让活跃两三周的玩家「等级涨 = 有新东西」，而不是空涨级。
- **红线**：作物真实（对应店内真卖的菜）；ROI 曲线不倒挂（沿用 2026-07-02 调参）。

### 🅴 阶段 E · 手感收尾（今天欠账）
- 底部抽屉面板替代居中 modal（无尽冬日式，最大剩余手感差距；需新写，无现成可复用）——先挑高频面板（商店/仓库/任务）试点。
- 相机松手惯性/动量（`_drag` 现在松手即停）。
- 竖向开局 fit（背景世界锚定，需动渲染层）+ 签到胶囊 390px 折行。

### ⚽ 里程碑 · 世界杯 7/19 退场承接（有硬期限，约 2 周）
- 决赛后 ⚽ 观赛台入口 / 首页横幅要有落地：改成引导到农场核心循环或下一个活动，别留死链。
- 未核销实物券收尾（当前 6 张 WC 老码 + 新沙琪玛保底档产出的券）。
- 提前 1 周（~7/12）定方案，避免临期赶工。

## 推荐执行顺序

**A → B 先行**（度量 + 引流核心，二者是 Chris 目标的正中），**C 紧随放大**；
**D、E 作为粘性/打磨常态推进**；**⚽ 承接按 7/19 硬期限倒排**。

A 便宜且解锁判断，B 是真正的引流引擎——建议这两个一起先开工。

## 🔧 A+B 实施合约（2026-07-05 开工，跨仓库核实后定稿）

**关键修正**：东方点已由 `_run_award` 批次 + `_award_orders_for_member` 按 `event_id=order:{oid}`
**全自动发放**给会员到店订单。故 **B 只发农场币（零真实成本），不再发东方点**——否则同一单
重复计负债。比原草案更省更安全。

### B · 反向闭环端点（stockwise_final，会员鉴权）
- `POST /api/members/me/farm-purchase-rewards`，`require_member`，新文件 `game_rewards_endpoints.py`
  导出 `router`，在 app_server.py `create_app()` ~23774 后 `include_router`。
- 复用 `_resolve_clover_customer_id`（clover_orders_endpoints）、`clover_orders_sync.COLLECTION`、
  `db_members`。未关联 customer → `{unlinked:true, coins:0, newRewards:[]}`。
- 读近 windowDays（默认 30）clover_orders；对**未发过农场币**且未退款、total>0 的单，
  按档发农场币：`coins = clamp(round(total)*10, 100, 600)/单`（零成本可慷慨，单单封顶）。
- 幂等账本：`db_members/farm_purchase_rewards/{memberId}` = `{claimedOrders:{oid:coins}, totalCoins, updatedAt}`，
  事务内加新单 + 写入前 prune 掉早于 windowDays 的 oid（保证 doc 有界，且过窗单不会重发）。
- 返回 `{ok, coins:<本次>, newRewards:[{orderId,total,coins,date}], totalCoinsAllTime}`。
- 可选 `farm_rewards_config/config`（enabled/coinsPerDollar/minCoins/maxCoinsPerOrder/windowDays）
  让 Chris 免部署调参；缺省内置。**不写 POS，不碰积分账本。**

### A · 北极星度量端点（stockwise_final，admin 鉴权，只读）
- `GET /api/game/business-metrics?days=30`，admin（X-Admin-Token/cookie 中间件已处理）。
- 单扫 clover_orders 窗口 → 按 customer_id 聚合（笔数/金额）；再 customer_id→member→是否有
  farm_players doc 分玩家/非玩家两群。**避免 per-member 查订单**（Cloud Run 60s）。
- 输出两群：规模、有 customer_id 数、窗口内到店人数、总笔数/总额、人均、到店率 + 差值 headline。
- StockWise 后台加一个紧凑只读卡片展示（改 HTML_PAGE 内嵌 JS 后 `node --check`）。

### 游戏侧 B（eastern-farm）
- 底部 dock 菜单里加「🧾 领取到店奖励」；调 B 端点；`coins>0` 时农场币客户端入账
  （客户端权威，走现有加币+存档）+ 庆祝揭示（复用 flyCoins/跳字）；unlinked 给引导文案
  「下次到店出示会员码关联」。deploy.sh 上线。

## 全局红线（所有阶段）
- 不动 Firebase 初始化 / 云同步机制 / 登录中间件
- 东方点=真负债：任何发放走服务端账本 + 幂等 + 封顶（成本铁律 #1）
- 农场币客户端权威；POS 只读不写
- 存档结构只加不改（state.js init() 顶层 Object.assign）
- 每批 `bash deploy.sh`（语法闸门 + 无头冒烟）；后端 StockWise 走 git push 触发 Actions
- 世界杯模块 7 月底整体退场，非承接需求别投入
