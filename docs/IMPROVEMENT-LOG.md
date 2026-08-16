# 持续改进计划 · Continuous Improvement Log

> 目标：把东方农场打磨到**专业游戏标准**，让超市客人「玩得爱不释手」。
> 方法：小步、可验证、可回滚的迭代，每轮都留下截图证据。直到找不出真问题、
> 没有改善空间为止。

工作分支：`farm-social-202606`（不直接动 main，部署从 main 触发）。

---

## 工作方法（每一轮都照做）

1. **观察 (Observe)** — 用 `scripts/shot.mjs` 无头截图真实游戏画面（手机视口 390×844）。
   不靠猜，靠看。
2. **核实 (Verify)** — 读代码确认这是**真问题**，不是静态分析的假阳性。
   （首轮教训：只读代码的审计 25 条里约 90% 是假阳性——必须核实。）
3. **修复 (Fix)** — 小改动，低风险，符合现有代码风格。
4. **验证 (Validate)** — `node --check` 改过的 JS + 重新截图确认效果，两个方向都测
   （改对了 / 没改坏别的）。
5. **记录 + 提交 (Log & Commit)** — 在本文件追加一条迭代记录，commit 到分支。

### 截图工具用法

```bash
# 1. 起本地服务器
python -m http.server 8123    # 项目根目录

# 2. 起一个带远程调试的 Chrome（一次即可，整轮复用）
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
  --remote-debugging-port=9222 --user-data-dir=/tmp/farmprofile \
  --remote-allow-origins=* about:blank &

# 3. 截图（可选 evalJsFile 在截图前在页面里跑一段 JS，如关掉开屏、打开某弹窗）
node scripts/shot.mjs <url> <out.png> [waitMs] [evalJsFile] [w] [h]
```

> 工具用 CDP 的 `Network.setBypassServiceWorker` 绕过 Service Worker 的整壳预缓存——
> 否则会测到**旧代码**（本游戏会预缓存全部 JS）。每个测试用**独立 profile**，
> 避免 localStorage 跨测试污染（首轮踩过这个坑）。

---

## 质量维度（轮流推进，标注健康度）

| # | 维度 | 现状评估（首轮） |
|---|------|----------------|
| 1 | 首次体验 FTUE / 新手引导 | 🟢 较好：开屏 + 店主气泡提示 + 教练系统 + 首格脉冲 |
| 2 | 核心循环手感 / juice 反馈 | 🟢 优秀：飞币、爆裂粒子、连击、撒花、震动 |
| 3 | 经济 & 成长曲线平衡 | 🟡 待审：需核对 crops.json 数值与产出/解锁节奏 |
| 4 | 留存钩子（日/周/社交/节日） | 🟢 丰富：签到日历、任务、邻居、顺菜、节日、彩票 |
| 5 | 移动端 UX / 360px 自适应 | 🟡 待测：需在 360px 实测各弹窗与农场画布 |
| 6 | 性能 & 健壮性 | 🟢 好：启动 .catch 兜底、收获幂等、定时器有 `_on` 守卫 |
| 7 | 可访问性 & i18n 完整度 | 🟢 优秀 i18n（仅 1 处漏译，已修）；a11y 可补 aria |
| 8 | 视觉一致性 / 美术连贯 | 🟡 待审：农场在大片空地里偏小（系业主刻意调过，慎动） |
| 9 | 音频 | ⚪ 未审 |
| 10 | 内容深度（作物/节日/食谱/文化） | ⚪ 未审 |

> 🟢 已较专业 · 🟡 有具体可查项 · ⚪ 尚未评估

---

## 迭代记录

### 迭代 #1 — 2026-06-24 · 基线核实 + 首批可验证修复

**观察**：搭起无头截图能力（`scripts/shot.mjs`），实拍开屏、农场、播种弹窗、
种子店等画面。整体已相当专业。

**核实**：对只读审计的 25 条逐条核对——「收获重复点」「多茬卡死」「启动 Promise
未捕获」「地图定时器泄漏」「XP 条溢出」等**多数是假阳性**（代码本就有守卫）。
真问题只有两处：

1. **PWA「加到主屏幕」横幅在首次进入就弹**，盖在弹窗底部——典型首跑反模式：
   玩家还没体验到价值就被催安装。
2. **一处漏译**：`mapview-iso.js` 建造建筑时飘的 `+N 魅力` 在英文模式也是中文。

**修复**：

1. `src/js/pwa-install.js` — 安装横幅改为**等到「赢」的时刻**才出现：玩家至少
   收获过一次（`firstHarvestCelebrated` / `totalHarvests>0`），或是回访用户
   （`loginStreak>=2`）。新增轻量 `whenEngaged()` 轮询，模块仍自包含（只读 state）。
   iOS 引导与 Android `beforeinstallprompt` 两条路径都加了门。
2. `src/js/mapview-iso.js:589` — `'+N 魅力'` 改为 `en ? ' charm' : ' 魅力'`。

**验证**：
- `node --check` 两个文件均通过。
- 截图（独立 profile + 绕过 SW）：未达成就的新玩家**不再弹**横幅（13-A）；
  收获过的玩家**正常弹**横幅（14-B）。两个方向都符合预期。

**影响范围**：仅前端 UI 行为；不碰 API / Firebase / 存档结构。安装率影响：
从「首跑即催」改为「首次收获后催」，时机更好、对留存更友好，仍能促安装。

---

### 迭代 #2 — 2026-06-24 · 360px 窄屏审计 + 经济曲线核实

**观察**：在 **360px**（规格最小宽度）实拍六大弹窗——仓库 / 今日任务 / 今日 /
超市积分 / 东缬订单 / 农场商城。

**核实**：
- **维度 5（360px）**：六个弹窗**全部干净**，无截断、无挤压、双列网格在 360px
  正常。审计第 12 条「360px 不可用」是又一个假阳性。维度 5 上调为 🟢。
- **维度 3（经济）**：把 35 种作物拉成「金币/小时」表。整体健康——绝对收益
  18→600 稳步增长，中后期 cph 收敛在 ~60-73 是合理设计（短周期作物 cph 高=奖励
  主动玩，长周期作物绝对收益大=适合每天看一次）。但发现**一个真实的成长倒挂**：
  - **生姜 sheng_jiang（Lv9）**：480 分钟长、卖 380、cph 仅 40。**无任何补偿机制**
    （非多茬、无积分加成、无节日用途）。被 Lv8 的山药(cph72)、火龙果(cph60)
    及多个 Lv6 作物**严格压制**——玩家肝到 Lv9 解锁的却是个「降级」。这是客观
    缺陷，不是设计偏好。

**修复**：`data/crops.json` — 生姜 `sell_price` 380 → **540**，使 cph 落在现有
后期带的**地板**（60，与火龙果持平），**不新造强度**，只消除倒挂。生姜仍是最朴素的
Lv9 作物（春笋 65、枇杷 68 仍更强，保留梯度多样性）。单数字、可逆、易复核。

> 注：售价是平衡/业务判断。此处仅修「客观倒挂」（严格被低级作物压制），未动其它
> 售价。若业主对生姜定价另有真实价格锚定的考量，回退只需把 540 改回 380。

**验证**：`crops.json` 仍为合法 JSON；Lv8-9 带核对——生姜 cph 由 40 升到 60，
倒挂消除，梯度仍在。仓库/订单实时读 `sell_price`，无脱钩。

**影响范围**：仅一个数据数值；不碰代码逻辑 / API / 存档。

---

### 迭代 #3 — 2026-06-24 · a11y（语言属性 + 图标按钮）+ 内容完整度

**观察 / 核实**：
- **维度 10（内容）**：35 种作物**全部**有完整双语 `name/icon/story/recipe`，
  内容深度健康。维度 10 上调为 🟢。
- **维度 7（a11y）**：审计 index.html 所有按钮 + 图片 alt + 页面级属性。发现：
  - **真问题**：`<html lang="zh-CN">` **写死**，切英文时不更新 → 读屏软件会用
    中文发音规则念英文 UI。i18n.setLanguage 从不同步 documentElement.lang。
  - **真问题**：`#todayButton` 仅 🌅 emoji，无可访问名（读屏只会念「sunrise」）。
  - 其余健康：汉堡按钮已有 aria-label、底部导航有可见文字标签、弹窗 ✕ 有 aria-label、
    logo 有 alt、装饰背景图正确用 `alt=""`。金币/积分卡有 `title`+可见数值（给它们
    加 aria-label 反而会**盖掉数值**，故不动）。

**修复**：
1. `src/js/i18n.js` — `setLanguage()` 同步 `document.documentElement.lang`
   （en → `en`，zh → `zh-CN`），try/catch 包裹。
2. `src/index.html` — `#todayButton` 加 `aria-label`（双语），🌅 加 `aria-hidden`。
3. `scripts/shot.mjs` — 截图前**清 SW 缓存 + 注销 SW + 硬刷新**。教训：
   `Network.setBypassServiceWorker` **不可靠**地绕过 `<script>` 子资源，本游戏整壳
   预缓存会让截图测到**旧代码**（本轮先踩坑：lang 改了但测到旧 setLanguage）。
   现在每次截图都测当前源码。

**验证**：`node --check` i18n.js / shot.mjs 通过。CDP 运行时核对：清 SW 后
`setLanguage('en')` → `documentElement.lang==='en'`，`setLanguage('zh')` → `zh-CN`，
新代码确认加载。英文模式整屏截图正常渲染。

**影响范围**：附加式 a11y（lang 属性 + 1 个 aria-label）+ 测试工具增强；不碰
游戏逻辑 / API / 存档。

> 顺手发现（留待下轮）：iso 地图右下「建造」按钮在英文模式仍是中文——未译。

---

### 迭代 #4 — 2026-06-24 · 修「切换语言时 iso 地图 UI 不刷新」

**核实**：上轮发现的地图「建造」按钮英文未译——核实后**不是漏译**（mapview-iso.js
所有地图 UI 文案本就双语 `en ? ... : ...`）。真因是：**设置里切换语言时，iso 地图
（canvas 叠层）的 UI 不会刷新**。语言切换处理器只调 `Farm.farm.renderGrid()`，
而地图模式下 DOM 网格是隐藏的——地图的建造按钮 / 建筑面板标签 / 模式标签
（建造/地形）会停留在旧语言，直到下次 reload 或 resize。

**修复**：
1. `src/js/mapview-iso.js` — 新增 `relang()`：拆掉 `_buildUI()` 建的语言相关 UI
   元素（按钮/面板/提示/缩放）后重建（`_buildUI` 是 append 非幂等，故先拆）。
   模式 / 缩放 / 镜头状态挂在 `this` 上，重建后 `_refreshModeUI()+_layoutUI()` 自动
   还原当前模式。
2. `src/js/main.js` — 把两个语言按钮处理器合并为 `applyLanguage(lang)`，并在其中
   调 `Farm.isoView.relang()`（若激活）。

**验证**（CDP 运行时 + 截图，均清 SW 后测当前源码）：
- 进入建造模式后切换语言：建造按钮 `✓ 完成` → `✓ Done`；**无 DOM 重复**
  （isoBuildBtn / isoPalette 各 1 个）。
- 英文建造模式整屏截图：模式标签 `Build / Terrain`、按钮 `Done`、面板
  `Plot / Barn / Cottage / Greenhouse / Coop` 全英文；顶部提示 `Charm 94 ...`
  （迭代#1 的 charm 修复也一并可见）。
- 顺带核实：英文建筑名无重复（仅 house=Cottage 一个），上一截图缩略图误读。

**影响范围**：新增一个地图刷新方法 + 合并语言处理器；不碰存档 / API / 经济。
仅在「运行时切换语言」这一路径生效（重载进入本就正确）。

---

### 迭代 #5 — 2026-06-24 · 运行时 console 错误扫描 + 清掉访客噪声

**观察**：新增 `scripts/errsweep.mjs`——CDP 注入 console/exception 监听器，
依次跑核心流程（关开屏 → 播种 → 强制成熟收获 → 入库 → 卖 → 开六大弹窗 →
图鉴 → 建造模式 → 放建筑 → 切语言 relang → tick → refreshHUD → save），
统计 console.error / 未捕获异常 / warning。

**结果**：**0 错误** 跨全部 18 个流程——运行时健壮（维度 6 🟢 实证）。
唯一一条 warning：`[gameSync] fetchVisiblePool failed FirebaseError:
Missing or insufficient permissions`。

**核实**：`fetchVisiblePool` 只挡了 `Farm.fb.available`，没挡登录态。Firestore
规则**拒绝访客读 `farm_players`**（实证：未登录会话被拒）。`_fetchToday()` 调用它
时也无登录门 → **每个访客**到邻居面板都会刷一条吓人的 FirebaseError warning。
catch 兜底了（返回 []），功能无碍，但属「预期内的拒绝」当成 warning 刷出来 = 噪声，
会掩盖真 warning，也不专业。

**修复**：`src/js/firebase-game-sync.js` — `fetchVisiblePool` 开头加登录门：
未登录直接返回 `[]`（`isLoggedIn()` 已是全代码库的会员闸，line 248
`!!currentUser`）。跳过注定失败的查询——省一次往返 + 消除噪声；面板本就在空池时
退化为「邀请态」。登录用户行为不变（查询照常）。

**验证**：`node --check` 通过；**重跑 errsweep → 0 错误 0 warning**，访客启动
完全静默。登录路径不受影响（`currentUser` 存在则跳过该 return）。

**影响范围**：访客少一次 Firestore 读 + 少一条 console 噪声；登录态零变化。
新增 `scripts/errsweep.mjs` 可复用健壮性检查（同 shot.mjs，dev-only）。

---

### 迭代 #6 — 2026-06-24 · 视觉巡检（未见过的弹窗）+ 安装横幅盖弹窗

**观察**：实拍五个此前未见的界面——怎么玩(guide) / 邻居广场 / 会员登录 /
设置 / ☰ 菜单。**全部专业、干净**，无截断无错位。登录有 +1 区号 + 萨城地址、
邻居空池正确退化为邀请态（迭代#5 修复实证）、设置项完整。UI 全程打磨到位。

**真问题**：跨**每一张**截图都看到——**PWA 安装横幅盖在打开的弹窗底部**
（guide 面板最明显，盖住末几行）。横幅 `z-index: 9000`，远高于弹窗(100)，
所以浮在弹窗内容之上。

**修复**（低耦合）：
- `src/js/ui.js` — `showModal()` 给 `body` 加 `modal-open` 类，`hideModal()` 移除。
- `src/css/style.css` — `body.modal-open .pwa-install-banner { display:none }`。
弹窗开 → 横幅隐；弹窗关 → 横幅回。ui.js 只设通用 body 状态，不认识 pwa 模块。

**验证**（CDP，清 SW 测当前源码）：横幅 display 周期 `flex → none(弹窗中) →
flex(关闭后)`，非破坏性会回来；guide 面板重拍确认末行(每天来领笑/农场掠风)
不再被盖。

**影响范围**：附加式（1 条 CSS + 2 处 body 类开关）；所有弹窗对「已安装提示」
玩家更干净。不碰逻辑/API/存档。

---

### 迭代 #7 — 2026-06-24 · 修春节 2028 日期错误（重大）+ 节日内容盘点

**核实**：
- **运行时只激活 2 个节日**：`src/js/events.js` 用**自己硬编码**的窗口，**不读**
  `data/events.json`（注释明说「Replace with data/events.json later」）。live 只有
  春节 + 中秋（= TASKS.md 的 V1 范围）；data 里的端午/清明/重阳/冬至是 V2 前瞻数据
  （端午 `_note` 标了 V2）。**这是有意的 V1 范围，不是 bug**——不擅自激活 V2 内容。
- **真 bug（重大）**：春节 **2028** 窗口是 `02-11 → 03-02`，但**2028 农历新年是
  1 月 26 日**（猴年，已用 Smithsonian 等权威源核实）。窗口晚了约 2 周，会**完整
  错过**真正的春节——2028 年 1 月真过年时游戏无节日，反而 2 月中旬错误地弹春节。
  对华人客群最重要的节日定错日期，是严重的专业性缺陷。
  - 交叉核对其它日期：春节 2026(2/17)✓ 2027(2/6)✓；中秋三年窗口均正确 ✓。仅 2028 错。

**修复**：春节 2028 窗口 → `2028-01-12 → 2028-02-01`（沿用既有规律：节日前 14 天 →
后 6 天，括住 1/26）。**两处都改**：`src/js/events.js`(live) + `data/events.json`
(数据)，避免错误日期日后被接线时再次带入。

**验证**：`node --check` events.js 通过、events.json 合法 JSON；日期窗口逐点核对
（用 events.js 同款字符串比较逻辑 `todayStr>=start && <=end`）：真 CNY 2028-01-26
→ 命中；旧错误窗口 2028-02-20 → 不命中；边界 01-12/02-01 命中。全过。

**影响范围**：一处节日日期纠正（live + data 同步）；不碰逻辑/经济/存档。

> 单一数据源备注（留给 Chris）：`data/events.json` 当前**未被运行时读取**，
> events.js 自带硬编码窗口。日后接线 events.json（激活更多节日 = V2）前，需先补齐
> 节日作物/任务/装饰，否则节日只有横幅会显得半成品。chongyang 仅 2026、所有节日
> 缺 2029+（属未用数据，暂不影响 live；live 的春节/中秋也止于 2028，2029 需补）。

---

### 迭代 #8 — 2026-06-24 · 延展节日窗口过 2028 悬崖（live + data）

**核实**：live `events.js` 的春节/中秋窗口都止于 2028 → **2029 起节日静默失效**
（内容悬崖）。Web 权威源核实四个农历日期：春节 2029-02-13 / 2030-02-03，
中秋 2029-09-22 / 2030-09-12。

**修复**：按既有规律补 2029、2030 两年窗口（春节 [节前14→节后6]=20 天，
中秋 10 天，均括住节日当天）：
- 春节 2029 `01-30→02-19`、2030 `01-20→02-09`
- 中秋 2029 `09-16→09-26`、2030 `09-06→09-16`
`src/js/events.js`(live) + `data/events.json`(data) 两处同步加。

**验证**：`node --check` + JSON 合法；四个节日当天逐点核对均落窗内；
live↔data 一致性脚本：两节日各 5 窗口（2026-2030）**全部 IN SYNC**。
悬崖从 2028 推到 2030。

**影响范围**：纯日期数据扩展（live+data 同步）；不碰逻辑/经济/存档。

---

### 进度盘点（8 轮后）

8 轮共 8 个已验证提交：首跑横幅时机、经济倒挂、a11y(lang+aria)、地图换语言刷新、
访客 console 噪声、弹窗盖横幅、**春节 2028 日期错(真 bug)**、节日窗口延展。
另产出两个可复用 dev 工具（`shot.mjs` 截图、`errsweep.mjs` 错误扫描）。

**多数质量维度已 🟢**。

### 迭代 #9 — 2026-06-24 · 英文建筑标签补功能提示（最后一个具体项）

**核实**：只有 `barn`(tap→仓库) 和 `house`(tap→种子店) 有点击功能。中文标签
`谷仓·仓库`/`小屋·种子店` 点明了用途，英文只有 `Barn`/`Cottage`，英文为主的
孩子玩家看不出这两栋可点开仓库/商店。

**修复**：`src/js/mapview-iso.js` BUILDINGS — `en` 改为 `Barn · Storage` /
`Cottage · Shop`，与中文「建筑·功能」对齐。

**验证**：`node --check` 通过；英文建造面板截图——`Barn · Storage 350` /
`Cottage · Shop 400` 单行显示不溢出；放置 toast `Placed Cottage · Shop ...` 通顺。

**影响范围**：两个英文标签字符串；不碰逻辑/经济/存档。

---

### 收官盘点（9 轮）

9 轮 = 9 个已验证提交 + 2 个可复用 dev 工具。**已列出的具体可改项全部清完。**
剩余仅三类，**均不在「可无头验证的 polish」范围**：
- **需实机**：音效齐全度/音量（维度 9）。
- **需 Chris 业务决策**：农场默认取景空旷度（业主刻意调过）、V2 节日深度
  （端午/清明/重阳/冬至接线 + 配套作物/任务/装饰）。
- **远期**：节日窗口 2031+（已覆盖到 2030，3-4 年后再说）。

> 注：以上「收官」判断**过早**——只覆盖了「显眼」项。tasks / achievements /
> daily / tutorial 等子系统当时尚未深入审计。继续。

---

### 迭代 #10 — 2026-06-24 · 任务系统：「尝试新作物」逻辑 bug

**核实**（深入此前未审的 tasks.js）：先确认 plant/buy_seed 事件确实有触发
（shop.js:106/181），非空挡。然后在 `plant_new` 任务发现**真 bug**：

判定「是不是新作物」用的是**脆弱启发式**——`cropsEverGrown` 的**最后一个元素**
即视为新（tasks.js:64 `indexOf(cid)===length-1`）。问题：玩家发现作物 X 后 X 被
追加到末尾；**第二天重新种同一个 X**（X 仍是最后一个）→ 启发式判 TRUE → 「尝试
新作物」任务**在没尝试任何新作物的情况下完成**。可重现、可白嫖。

而 `crops.plant()` 本就在 recordPlant 前算好了权威的 `isNewToCollection`，只是没
往事件里传。

**修复**：
- `src/js/shop.js` — `onEvent('plant', {cropId, isNew: result.isNewToCollection})`
  把权威标志传进去。
- `src/js/tasks.js` — `plant_new` 改判 `payload.isNew === true`，弃用末元素启发式。
  缺标志时不计（宁可少计也不错计）。

**验证**（CDP，注入 target=2 的 plant_new 任务跑场景）：
重种非新→0｜种真新作物→1｜重种最新作物→1（旧 bug 这步会变 2）。完全符合预期。

**影响范围**：一个事件多带一个字段 + 一处判定改对；不碰存档/经济。

> 教训：「收官」别下太早——深入未审子系统又抓到一个真 bug。继续审 achievements /
> daily / tutorial。

---

### 迭代 #11 — 成就系统：「八仙过海」永久无法解锁

**核实**（审 achievements.js + achievements.json 对照引擎）：引擎支持 4 种
check 类型（stat/level/crops_set/festival_harvests），代码干净。把 12 个成就逐条
对照数据核查：
- 所有 check.type 都受支持 ✓
- 4 个 stat key（totalHarvests/maxStreak/totalCouponsRedeemed/totalTasksClaimed）
  都是真 state 字段 ✓
- **真 bug**：唯一的 `crops_set` 成就 `try_all_main`（八仙过海/Variety Pack，
  10 EP）的 8 个作物 id 里有 **3 个不存在**：`qingcai`（已改名 shanghai_miao）、
  `chili`、`garlic`。crops_set 要求**全部** id 都在 cropsEverGrown，而这 3 个永远
  种不出来 → **该成就永久无法解锁**。

**修复**：`data/achievements.json` — 把 3 个失效 id 换成当前等价作物（唯一无歧义
的选择）：`qingcai→shanghai_miao`、`chili→niu_jiao_jiao`(牛角椒，唯一辣椒类)、
`garlic→suan_tai`(蒜苔，唯一大蒜类)。保持「8 种常规作物」原意。

**验证**：JSON 合法；重审 crops_set id 全部存在；CDP 端到端——种齐 8 种 →
`try_all_main` 解锁 `true`；只种 7/8 → 保持 `false`（正确要求集齐）。

**影响范围**：一行成就数据 id 修正；不碰引擎/存档。10 EP 成就恢复可解锁。

> 又一个深审才现形的真 bug。继续 daily / login-calendar / tutorial / coach。

---

### 迭代 #12 — 存档迁移漏了 cropsEverGrown（图鉴/成就历史不迁移）

**核实**（全库扫描 qingcai/chili/garlic 失效 id 后顺藤摸到迁移逻辑）：
- crop-art.js 同时有新 id（shanghai_miao/niu_jiao_jiao/suan_tai）和旧 id
  （qingcai/chili/garlic）渲染函数——改名作物有正确美术，旧函数是死代码（无害，
  不动）。
- **真 bug**：`state.migrateCrops()` 迁移了 plots 和 seeds 的别名改名
  （qingcai→shanghai_miao），但**完全没碰 `cropsEverGrown`**（终身图鉴/发现历史）。
  老存档里的 `qingcai` 永远是孤儿 → 既不计入蔬菜图鉴，也不计入 crops_set 成就
  （刚修的八仙过海）。老玩家得**重新种**改名后的作物才有 credit。

**修复**：`src/js/state.js` migrateCrops 增加 cropsEverGrown 迁移——按同一 aliasMap
改名 + 去重（防 qingcai 与 shanghai_miao 同时存在产生重复）。新增 renamedHistory
计数，并入日志与返回值。**只用已文档化的 qingcai→shanghai_miao 别名，不加 chili/
garlic 的推测别名**（那两个映射是推断的，错误别名比留孤儿更糟）。

**验证**（CDP）：输入 `[qingcai,tomato,shanghai_miao,cilantro]` →
`[shanghai_miao,tomato,cilantro]`（改名 + 与已有 shanghai_miao 去重），
renamedHistory:1。符合预期。

**影响范围**：仅老存档迁移路径多迁一个字段；新存档无影响；不碰经济/UI。
「存档神圣」原则下的正确性修复。

> 死数据备注：`data/tasks.json` 同样**未被运行时读取**（tasks.js 硬编码模板），
> 里面也有 qingcai/chili 失效 id，但不影响 live，故不动（避免动无用文件加噪声）。
> 与 data/events.json 同属「日后接线前需校正」的死数据。

---

### 迭代 #13 — 七日签到：日历预览与实际领取不符

**核实**（审 login-calendar.js + state.signTodayCalendar）：领取逻辑
`signTodayCalendar()` 本身正确（连签 +1、满 7 重置、断签重置、双击防重）。但
`open()` 渲染日历**直接用存档里的 raw dayIndex**，没镜像领取时的「断签/满周重置」
逻辑 → **预览与实际领取对不上**。CDP 复现两个真 bug：
- **满 7 天后次日**：显示「第 8 天奖励可领取」+ 七格全 ✅（根本没有第 8 天）。
- **断签后**（dayIndex=3，5 天前签的）：显示「第 4 天可领取」，但实际点领取会
  **重置到第 1 天**（signTodayCalendar 的 else 分支）→ 玩家以为领第 4 天的 90 币，
  实得第 1 天 20 币。
- 正常连签（昨天签、dayIndex 3）显示「第 4 天」——正确，作对照。

**修复**：`src/js/login-calendar.js` open() 计算**有效 dayIndex**，镜像
signTodayCalendar 的连签判定——只有「昨天签过且在周中(1-6)」才延续，否则（断签 /
满周）按新一周渲染（dayIndex=0，第 1 天可领、无已签格）。其余渲染不变。

**验证**（CDP 三例）：满 7 次日 → 第 1 天可领/无已签 ✓；断签 → 第 1 天可领 ✓；
连签 → 第 4 天可领、1-3 已签 ✓（不受影响）。预览与实际领取在所有情形下一致。

**影响范围**：仅日历渲染预览口径；领取逻辑(state)与经济不变。修正了「显示第 8 天」
幻象 + 断签「显示 4 实得 1」的误导。

---

### 迭代 #14 — 高价值货币路径审计：**未发现可改项**（如实记录）

审了**风险最高**的几条路径（涉及真实超市积分价值），逐一核实**均正确且防御到位**：

- **币⇄积分兑换**（state.exchangeCoinsToEp / exchangeEpToCoins）：
  - 两向都先**向下取整到 10 的倍数 / 整数**再扣 → 无零头损失（甚至偏向玩家）。
  - 往返中性：10 币→1 积分→10 币，无套利。
  - 扣币后服务端若 429（封顶）**退币**；积分 429 **撤销乐观加分**。防御完整。
  - 500/日 封顶是业主经济调参，非 bug。
- **EP 商城购买**（ep-shop.buy）：canBuy 后再经 spendCoins/spendEastPoints
  二次校验（返回 false 即中止）——挡住 canBuy→spend 之间余额被并发改动的竞态，
  **先扣款后施效**。无双花。
- **抽奖转盘**（daily.js spinBtn）：处理器全同步（判价→消免费/扣费→发奖→禁用
  按钮），无重入；禁用按钮挡住排队点击。免费/付费门正确。

附带澄清：rewards.js 的 `r.queued` 与 harvest 的 `epQueued` 是**早期本地排队设计
被移除后的残留死代码**（addEastPoints 只返回 `{credited,sync}`，无 queued；封顶改
服务端 429）。条件恒假，无害，不值得动。

> **结论：本轮无可改项。** 最关键的经济/货币代码经审计是 sound 的——这本身是
> 「专业标准」要求验证的正面结果。未制造琐碎改动（遵守迭代 #9 立的纪律）。

---

### 迭代 #15 — 交付/卖货经济审计：**未发现可改项**

审另一条作物→金币路径（卖货 + 小东订单），均正确：
- **仓库交付**（state.deliverWarehouse）：空仓早退；底价 + 四舍五入 20% 今日首单
  加成；**同步清空仓库** → 连点第二次返回 `empty` 不重复入账；置 firstDeliveryDone。
- **小东订单**（orders.fulfill）：先 `_canFill` 校验仓库够不够 → 扣货 → 发
  币/XP/积分（积分 `Math.min(order.points, 今日剩余)` 受封顶约束）→ 把该格换成**新
  id 的新订单**。连点第二次按旧 id 找不到 → 早退，**无重复履约**。

> 经济子系统（兑换/商城/抽奖/交付/订单）连续两轮审计均 sound。这是全代码库最严谨
> 的部分。转向 bug 概率更高的复杂子系统（顺菜 social-steal / 邻居）。

---

### 迭代 #16 — 顺菜系统：多茬作物再生公式重复且发散（真 bug）

**核实**（审最复杂未审子系统 social-steal.js，313 行）：caps（6/日、2/户、新手
保护、看家狗概率/赔礼、LOST_DAILY_MAX 受害封顶）、防重放（plantedAt 方向比较）、
仅熟可偷——这套反作弊/反 grief 逻辑**很扎实**。但发现**真 bug**：

多茬作物的「再生」公式在**两处重复且发散**（违反 CLAUDE.md 铁律#2 单一模板）：
- crops.js harvest（权威）：`plantedAt = now - max(0, grow-regrow)*60000 / mult`
  ——**除以 growMultiplier**，注释明说不除会让温室/水井作物「瞬间再生」。
- social-steal.js settle（line 186）：`now - (grow*60000 - regrowMs)`——
  **没除 mult、没 Math.max**。

后果：真会员被顺走多茬作物（如韭菜）后回家结算时，**若受害者有温室/水井
（mult>1）**，被顺的那茬会**瞬间又变成熟**而非按时再生——正是 crops.js 修过、
social-steal 没继承的同一个 bug。

**修复（DRY）**：把再生数学抽成 `crops.startRegrowCycle(plot, def)` 单一来源，
harvest() 和 social-steal settle 都调它。彻底消除发散。

**验证**：
- `node --check` 三文件通过；**errsweep 收获路径 0 错 0 warning**（重构未破坏收获）。
- 定向 CDP（3 温室 mult=1.6，韭菜 grow120/regrow45）：修复后 newStage=**1**（仍在
  再生，正确）；旧公式 oldStage=**2**（瞬间成熟，bug）。
- 复杂子系统命中真 bug，印证「转向高复杂度子系统」的判断。

**影响范围**：再生数学统一到一处（harvest + 顺菜结算）；修正温室受害者的多茬瞬熟。
不碰经济数值/存档结构。

---

### 迭代 #17 — 打理（浇水/施肥）+ 道具计数审计：**未发现可改项**

审 tending.js 与 activeEffects 计数：
- **浇水**：canWater（有菜/未浇/未熟）守卫正确；speedUp(-20%) 走刚统一的
  crops.speedUp；`watered` 标志在 startRegrowCycle 里复位（与迭代#16 一致）。无重复浇水。
- **施肥**：canFertilize（有菜/未施/有库存）+ 扣 1 charge + 标记本块，`fertilized`
  在收获/再生时复位。无重复施肥、无负库存。
- **跨模块计数一致性**：化肥(化肥 id=fertilizer_pro)→`fertilizerCharges`、
  催熟剂(id=fertilizer)→`accelerationCharges`，**stock_key 与各自效果对得上**
  （催熟=加速、化肥=×2 产量，语义正确）；登录日历/EP 商城都写同一套 key。
  `bumperCharges` 是废弃字段，有幂等迁移到 fertilizerCharges。读写一致，**无功能 bug**。

> 低优先备注（不自动改）：EP 商城里「催熟剂」的内部 **id 叫 `fertilizer`** 但实为
> 加速道具——纯命名误导，无任何 id-based 行为查找依赖它（行为只看 stock_key），
> 改 id 反而有破坏存档里已拥有道具引用的风险。留给 Chris 决定是否重命名。

经济(×2)+打理 三轮审计均 sound。下一步审最大的未审子系统 neighbors.js(918 行)。

---

### 迭代 #18 — 邻居社交奖励（走访/点赞/帮浇水/贴纸）审计：**未发现可改项**

审 neighbors.js（918 行，最大未审）+ aiNeighbors.interact 的奖励/封顶逻辑：
- **走访 +40**：`claimNeighborVisit` 去重（已访返回 false），奖励门 `length===3`
  恰好一次——需 3 个**不同**邻居，重访同一户不计。无白嫖、无重复发。
- **点赞 +5 / 帮浇水 +10 / 贴纸 +2**：按钮 onclick **先 disabled** 防连点，失败
  才回enable；**权威封顶 + 去重在 `interact()` 里**（赞 5/帮 5/贴 10 per day +
  per-target 去重），不只靠 UI 禁用。即便 UI 失效，interact 仍挡超领。
- 计数写入 `dailyClaims.likesSentToday/helpSentToday/stickersSentToday`，每日重置。

**无功能 bug。** 社交奖励经济封顶/去重正确。

> 进度：经济/交付/打理/社交奖励四大「发币」子系统全部审计 sound；加上此前修掉的
> tasks/成就/存档/签到/顺菜 5 个逻辑 bug。剩余仅小型 UI/引导辅助
> （tutorial/coach/spotlight/home-report 等），低风险。下一步审引导（与留存相关）。

---

### 迭代 #19 — 引导（tutorial/coach）+ 全量 i18n key 校验：**未发现可改项**

- **coach.js**（just-in-time 提示）：`fire()` 查 seen + spotlight 进行时不抢话；
  `tip()` 延迟后**再次查 seen 并标记**，故快速重复 fire 也只显示一次（幂等）。
  一生一次、存档记 coachSeen。正确。
- **tutorial.js**（首跑欢迎）：`tutorialV1Done` + `cropsEverGrown` 空双重门
  （老存档静默标记 done），开始后交棒 spotlight。正确。
- **全量 i18n key 校验**：扫全部 `i18n.t('key')` 调用——**62 个被引用的 key
  全部存在**于 i18n.json（共定义 105 个）。**无任何缺 key**——首跑玩家不会看到
  `tutorial_step1_title` 这种生 key。

**无 bug。** 引导逻辑健全，i18n 完整。

> 至此高/中价值面已**全面审计**：经济/社交/引导 sound；数据/逻辑层修了 6 个真 bug。
> 剩余仅极小型展示辅助（weather/seasons/spotlight/share/home-report 等）。
> **已非常接近「无改善空间」**。继续逐一扫尾，clean 就如实记。

---

### 迭代 #20 — 扫尾：其余辅助子系统批量审计 + 全库收官

批量审完所有剩余文件：
- **promo.js**（3000 币一次性促销）：once-guard 同时查本地 `promoClaims` 与账户
  `gameStats.promoClaims`（跨设备防重领），发奖前先置标志（防重入）。正确。
- **spotlight.js**（首跑手把手）：强制成熟 `now - grow_minutes*60000`（超量→任何
  mult 都熟，与再生 bug 不同，安全）；门控 `spotlightDone`+空 cropsEverGrown 正确。
- **home-report.js**（离线小报）：settleOnBoot 结算后写 `lastActiveAt=now`，**幂等**
  （二次调离开窗口≈0 → 不重复结算）。
- **share.js**：纯分享 UI，无发奖逻辑。
- **weather/seasons/harvest-status/storekeeper/login-nudge**：纯展示，**0 货币/作物
  变更**，不可能有经济 bug。
- 邀请 +200（firebase-game-sync.applyReferral）：跨账户、**服务端协调去重**，
  客户端不可完整验证（属后端职责）。

**无 bug。**

---

## 🏁 Loop 收官（迭代 #1–20，2026-06-24）

**全库已逐子系统审计完毕。** 最终全量回归：所有 JS `node --check` 通过、所有 JSON
合法、errsweep 跑 18 个核心流程 **0 错 0 warning**。

### 成果（19 个已验证提交，全在 `farm-social-202606` 分支）

**真 bug 修复（6 个逻辑 + 多个正确性/内容）：**
1. 春节 **2028 日期错**（2/11→实际 1/26 CNY，会完整错过过年）— 权威源核实
2. 顺菜**多茬再生公式发散**（温室受害者瞬熟）— DRY 抽 `startRegrowCycle`
3. 任务「**尝试新作物**」可重种最新作物白嫖 — 改用权威 isNew 标志
4. 成就「**八仙过海**」永久无法解锁（3 个失效作物 id）
5. 存档迁移**漏 cropsEverGrown**（图鉴/成就历史孤儿）
6. 签到**日历预览与实际领取不符**（「第8天」幻象 / 断签显示4实得1）
7. 生姜 **Lv9 成长倒挂**（售价 380→540）
8. 切换语言时 **iso 地图 UI 不刷新**

**专业化打磨：** PWA 安装横幅延到「赢」后再弹 + 不盖弹窗；a11y（`<html lang>`
跟随语言、图标按钮 aria）；访客 console 噪声消除；节日覆盖延到 2030；英文建筑
功能标签；漏译补全。

**可复用 dev 工具：** `scripts/shot.mjs`（无头截图，绕 SW 缓存）、
`scripts/errsweep.mjs`（运行时错误扫描）。

### 已验证 sound（无需改动）

经济（兑换/EP 商城/抽奖/仓库交付/小东订单）、社交（走访/点赞/帮浇水/贴纸封顶与
去重）、打理（浇水/施肥）、引导（tutorial/coach/spotlight）、促销/小报、全量 i18n
key（62 引用全部存在）、360px 窄屏所有弹窗、运行时健壮性。

### 剩余（**需 Chris / 真机，非自动可改**）

- **维度 9 音频**：音效齐全度/音量协调 — 需真机听。
- **维度 8 取景**：农场默认是否过空旷 — 业主刻意调过，需 Chris 拍板。
- **V2 节日深度**：data/events.json 的端午/清明/重阳/冬至接线 — 需先补节日作物/
  任务/装饰，属 V2 功能决策。
- **低优先命名**：EP 商城催熟剂内部 id 叫 `fertilizer` — 改 id 有破坏存档引用风险。
- **死数据**：data/tasks.json（未被读取）含失效 id — 日后接线前校正。

> **结论：在「不需真机、不需业主决策」的范围内，已达「找不出问题、无改善空间」。**
> 20 轮共修 8 个真问题 + 多项打磨，并验证全部发币/社交/引导子系统 sound。
> 真正的下一步增量需要 Chris 提供方向（真机反馈 / V2 决策）。Loop 在此自然收束。
- [ ] **维度 8（取景）**：农场默认取景偏空旷——先出对比截图再议（业主刻意调过）。
- [ ] **维度 9（音频）**：音效齐全度 / 音量协调（需实机听）。
- [ ] **健壮性**：通读一遍 console 错误（注入错误监听器后跑核心流程截图）。
- [ ] **维度 8（取景）**：评估农场默认取景是否过空（_autoFrame 对小农场是否取景
      过松）——谨慎，业主刻意调过，先出截图对比再议。
- [ ] **维度 9（音频）**：核对音效是否齐全、音量是否协调（需实机听，难无头验证）。
- [ ] **维度 10（内容）**：作物文化故事 / 食谱字段完整度核对（每种是否都有
      `story` + `recipe` 双语）。可验证。
- [ ] **维度 3 续**：早期 1-3 级节奏是否「上手即有正反馈」——已较好，低优先。

---

## 🔁 第二轮打磨（2026-08-15，共享世界 / 人生故事 / 程序化世界上线后的全面复审）

方法：无头 Chrome 逐面板截图（新手 / Lv8 中期 / 360px / 桌面 / 英文各一遍）+
真实新手流程驱动（开屏 → 欢迎窗 → 聚光灯种/收/卖 → 来信）+ `errsweep` 运行时扫描。
**新增部署闸门 `scripts/verify/smoke-flows.js`**：冒烟不只看开屏，走 23 个入口，
任一步抛异常即中止（变异体验证过能拦住 —— 起因见下）。

### 真问题（已修）
1. **新手来信抢聚光灯**：全新玩家点完欢迎窗 8 秒后「初来乍到」的信盖在「点这块发光的地」上。
   新增 `Farm.ui.isBusy()`（弹窗/开屏/聚光灯统一判定），来信与回家小报都改用它。
2. **宠物买了看不见**：`petsEnabled` 默认 false → 商城买的宠物根本不画（六月那条「默认关闭」
   针对的是当时白送的两只）。改为「只有明确关掉才藏」+ 买宠物自动开；开关从「怎么玩」
   搬到「设置→农场显示」，顶掉那里只作用于被 iso 盖住的 DOM 网格的**死开关**「显示宠物+装饰品」。
3. **章节目标过章即消失**：时间线可点回旧章、没领的奖照领；下一章可预览（上锁）。
4. **取景左偏**：镜头中心按 gx/gy 矩形取中，投影到屏幕是大菱形，物件只占一角时整片左偏
   40px、菜摊前路人被切在画外。改按屏幕轴（u/v）包围盒取中；路人站位算进包围盒。
   ⚠️ 这一改一开始误把 `_buildFrame` 里的同名行也替换了（进建造模式 ReferenceError），
   errsweep 的「THREW」只在步骤行里、汇总仍 0 —— 现在步骤异常计入错误并非零退出。
5. **谷仓聚光灯洞**：按 `tw*sc` 方盒近似，比真实贴图高一倍多，洞大半罩着空草地；改按
   `_drawBuilding/_blit` 同一套盒子。空地洞 1.4th → 1.05th，不再框进前一块的锁徽章。
6. **360px 顶栏溢出**：右侧一组盖住「Lv 8」；紧一圈 + logo 按比例缩。
7. **桌面小东头像**贴浏览器最左边而不是 480px 栏。
8. **新建筑落点**：中心占着就从 (0,0) 逐行扫 → 常在角落半个身子出画；改就近 + 镜头跟过去。
9. **图鉴卡片**子元素掉进 38px 图标列，「种植解锁」折成「种植解 / 锁」。
10. **开屏 CTA「手机号登录」**过期（08-12 起一律邮箱）；今日小报同条旧闻同步改。

### 命名统一
- 玩家可见名一律「快乐农场 / Happy Farm」（欢迎窗、PWA 横幅原来写「东方农场」）；
  「东方农场路」是世界里的地址，保留。
- 存储一律「谷仓 / barn」（原 仓库/谷仓、silo/warehouse/barn 混用 40 余处）。
- NPC 英文一律 **Xiaodong**（原 Little East / Xiaodong 各半）。

### 细节
菜单「农场人生」独立信封图标；订单/谷仓/今日特价用作物插画；邻居广场空态去重
「邀请好友」；三处三钮并排不折行；选种器分组标题独占行；toast 下移不压状态胶囊；
成就未解锁也写条件；成长之路自动定位当前等级；「怎么玩」卡对老玩家沉底；
指南去掉内层双滚动；已熟地块打理面板不再「还剩 ✓」；我的家面板用真实房子贴图。

### 续（同日第二批）
- 升级弹窗补「解锁新菜」+ 下个里程碑加「新菜 · Lv N」（升级最强的盼头原来一句没提）
- 宠物：体型 0.9/2.4 格 → 0.58/1.6 格（原一只小鸡与谷仓等高）；新买的宠物/装饰落在
  菜地旁而不是最前排荒地（地扩过后前排离菜地十几格，鸡只在自己家附近转，永远走不到菜）；
  商城卡片用真实走动贴图；PWA 横幅抬到 dock 之上、且等聚光灯结束再弹
- 今日红点可清零：特价种子买过不再计、没邻居可走时不计（原来红点永远 5，等于没红点）
- 任务卡图标按类型 / 作物插画；订单生成避开板上已有的菜（原三张单可能全是小葱）
- 节日窗口用本地日期（toISOString 是 UTC，傍晚 6 点后提前一天进出）
- 「怎么玩」补三张卡（多赚钱三条路 / 建造你的家 / 农场人生）；菜摊空闲面板显示累计接待
- SW 预缓存漏了 store-rewards.js（一个多月没人发现）→ 补上 + 部署闸门加
  `precache-check.mjs`（index.html 加载的模块必须全在 PRECACHE）

### 🔴 根因：部署后玩家刷新永远拿到旧代码（2026-08-15）

Chris：「刷新了页面宠物还是巨大」。线上文件是新的、SW 版本号是新的，他刷多少次都是旧的。

**根因**：SW 安装用 `cache.add(url)`，它**走浏览器 HTTP 缓存**；GitHub Pages 对所有
静态文件发 `Cache-Control: max-age=600`。于是新版 SW 把**上一版的文件**装进了
**新版本号的缓存**（实测缓存名 `eastern-farm-swtest-v2`、里面是 v1 的文件），
再缓存优先地一直发下去。刷新救不了——脏东西就在缓存里面；版本信标发现不一致只会
`reload`，reload 回到同一份脏缓存，一次性防循环闸随即永久压住自愈。

**这解释了长期以来「改了没生效 / 你清一下缓存」的一整类现象**，而 CLAUDE.md 早就写着
「他说得对：别的网站都不需要这样，那就是我们的代码问题」。

- 修：`precacheAll()` 用 `new Request(u, {cache:'reload'})`；新增 `refresh-precache`
  消息通道，页面自愈时先让 SW 重抓整包再刷新
- 钉：`scripts/verify/sw-update-test.mjs` 起一台发 max-age=600 的服务器真复现整个场景，
  改前必红、改后转绿，已成 `deploy.sh` 闸门 C（约 5 秒）

**宠物体型**（Chris 抱怨的表象）顺带做实了：以摊前路人为尺子实测，旧代码狗 ≈ 人的
**1.2 倍**（确实比人大）；第一版改到 0.62 实测仍读作「和人一样大」；现按现实比例定
狗 0.40 / 猫 0.30 / 鸡鸭 0.26 / 乌龟 0.15，马牛才接近人高。

### 场景打磨（2026-08-16，对照 keyart-farm-square）

截图：`promo/_verify-keyart-new.png` / `_verify-keyart-old.png`。未上线。

- 水塘：禁止 `stroke` 每格 blob（会画出白线圈）。左侧水往溪拉，场中塘改成一块微起伏湖，不再漫到谷仓。
- 田：12 格合成一块垄沟土；锁地不再画暗床+大锁；空床去掉脉冲 `+`。
- HUD：缩放钮改玻璃半透明；可收胶囊降不透明度。
- 路人：摊前/沿路改手绘小人，去掉 emoji 头。
- 叶菜/葱蒜未单独重绘的走已有油画贴图。
- 老号摊/仓/塘坐标不变。

### 乡路禁建（2026-08-16）

Chris：「水塘叠在土路上了，马路应该不允许建造」。
乡路原先只画在背景缓存里，水塘后画就会盖住路面；建造/刷水也不查路心。
现：路心禁建筑、水、小路、菜地、装饰；路上旧水格不画；每帧把路面再盖一层。不改存档坐标。

### 开屏提亮 + 描金按钮（2026-08-16）

Chris：「入口首页色调暗、按键看不清、不够高档」。
暮色纱从近黑改成暖金薄纱；主钮描金漆绿白字；游客钮瓷白深字。登录/逛逛 ID 不动。

### 全面审查（2026-08-16）

- 微信 `share-card.png` 仍写「快乐农场 / HAPPY FARM」→ 东方农场 + Eastern Farm。
- 晒农场木牌英文加大并加高木牌。
- 开屏 Eastern Farm 16→22px，与中文拉开。
- 水井略放大。未改经济、未搬老号。
