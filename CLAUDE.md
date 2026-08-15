# Eastern Farm · 东方农场

A cozy farm-management game for Eastern Market customers. Plant Asian vegetables,
harvest, sell, level up, celebrate festivals, and (eventually) earn real rewards
at the actual store in Saskatoon.

> Think *Happy Farm* meets *Stardew Valley*, but specifically designed for
> Chinese-Canadian families: mom and kid playing together, growing bok choy
> and Chinese chives, celebrating Chinese New Year and Mid-Autumn Festival,
> while quietly building loyalty to Eastern Market.

---

## Quick Start

```bash
# Single-folder app, no build step.
# Serve from the PROJECT ROOT (not from src/) — the JS uses
# fetch('../data/...') from the page URL, so data/ must be a
# sibling of src/ on the served tree.
cd eastern-farm
python3 -m http.server 8000
# then visit http://localhost:8000/src/index.html
```

> ⚠️ Do NOT use `--directory src` — it puts `data/` outside the served
> root and every fetch() will 404 on load. Likewise, double-clicking
> `src/index.html` (file://) fails in Chrome/Edge because they block
> fetch() over file:// for security reasons. Always go through the
> local HTTP server above.

---

## 部署 Deploy（一键）

生产站 `farm.easternmarket.ca` 由 **GitHub Pages 从 `main` 分支根目录** 自动部署（无 Actions、无 build）。

**一条命令部署全部**（在仓库根目录）：

```bash
bash deploy.sh                 # 自动提交未保存改动 → 推当前分支 → 快进推送到 main → Pages 上线
bash deploy.sh "本次改动说明"   # 自定义提交信息
```

Windows 也可**双击 `deploy.bat`**。脚本用「快进推送到 main」(`git push origin HEAD:main`)——
不切换你的分支、不会把你留在 main；若 main 上有分支外的独立改动会安全失败并提示先 merge。
上线约 1–2 分钟生效。

**deploy.sh 自带两件事（2026-07-02 起）：**
1. **自动注入 SW 缓存版本**：`service-worker.js` 的 `CACHE_VERSION` 每次部署自动改成
   `ef-YYMMDDHHMM` 时间戳，**不要再手动 +1**。已装 PWA 下次打开自动刷新，无需删 App。
2. **发布闸门**：全部 JS `node --check` + 无头 Chrome 冒烟启动（有未捕获异常 → 部署中止）。
   误报时可 `SKIP_SMOKE=1 bash deploy.sh` 跳过冒烟（语法检查不可跳）。
   冒烟依赖本机 Chrome + python，缺了会警告并降级为仅语法检查。

---

## 🔒 加载策略（2026-08-12 根因修复，别改回去）

Chris 长期反映「手机上一刷新就卡住 / 一直空白，很久了都是这样」，而开发机和无头
浏览器怎么试都复现不出（全新配置 260–800ms 就能玩）。以前一直被归因成「你清一下
浏览器缓存」——**他是对的，别的网站都不需要这样，那就是我们的代码问题**。查下来是
两条独立的缺陷叠在一起，弱网时互相放大：

### ① 跨域 CDN 脚本绝不能写成 `<script defer>`

`defer` 严格按**文档顺序**执行。5 个 `gstatic.com` 的 Firebase compat 脚本原本排在
50 个本地游戏模块**前面**，于是 CDN 一慢，整个游戏跟着一起卡死。

实测（限速 10kbps，本地缓存 61 条全都在）：**36 秒后 state / i18n / crops / ui /
farm / isoView / fbAuth 七个核心模块一个都没执行**，全在排队等 gstatic。
客人眼里就是「一直打不开」。

🔒 Firebase 只关系到**登录和云存档**，不该决定游戏**能不能打开**。
现在由 `index.html` 里的内联加载器动态按序注入（compat 版之间有依赖，必须串行，
不能用并发 `async`），SDK 落地后回调 `Farm.fbLateInit()` 补初始化。
- `firebase-init.js` 因此必须**可重入**：SDK 现在不在 ≠ 永远不在
- `main.js` 打 `Farm.__fbAuthInitTried` 标记，防止 `fbAuth.init()` 被重复注册
  （两次调用之间没有 `await`，单线程保证不会交错）

### ② Service Worker 一律缓存优先

上一版（2026-07-11 起）是「在线优先 + 超时回退缓存」，看着有兜底，实则有致命漏洞：
**`fetch()` 在响应头到达时就 resolve，不等内容体**，所以 3.5s / 4s / 6s 超时只保护
「连上了没」，完全不保护「数据下完了没」。手机信号飘时最典型的恰恰是「连上了、
然后数据爬不动」——这时 SW 把一个卡死的流交给页面，缓存里那份好的一次都用不到。
`css/style.css` 阻塞渲染 → 白屏。

实测同一条件（缓存装满 61 条）：全速 0.3s 可玩，10kbps **45 秒仍进不去**。
改成缓存优先后同条件 **1.03 秒**可玩（生产站已验证）。

🔒 **「永不困在旧代码」不靠缓存策略保证**，靠 `index.html` 底部内联的**新鲜度守卫**：
`controllerchange` 自动刷新 + 版本信标（`fetch('/service-worker.js?v=…',
{cache:'no-store'})` 比对线上 `CACHE_VERSION` 与本页 `<meta ef-build>`）。
所以 SW 的 fetch 处理器**必须放行 `/service-worker.js` 与 `cache:'no-store'` 请求**，
否则信标会被自己的缓存骗过去，自愈机制静默失效（已加测试验证能看见新版本）。

### 实测数据（生产站，改前 → 改后）

| 场景 | 改前 | 改后 |
|---|---|---|
| 回访 · 10kbps（缓存齐全） | **永远进不去**（45s 未就绪） | **1.03 秒** |
| 首访 · 400kbps（冷启动） | 24 秒 | 16 秒 |
| 回访 · 正常网速 | 0.8 秒 | 0.3–1.5 秒 |

⚠️ **仍未解决**：首访要下 ~600KB（50 个 JS 共 1.05MB 未压缩），弱网新客人依旧慢。
这是**打包/按需加载**的活，属独立任务，别指望上面两条修掉它。

---

## Why This Exists

Eastern Market is a Saskatoon supermarket (2,000+ SKUs, run by Chris). Chris
wants a branded interactive experience that:

1. **Resonates with the actual customer base**: Chinese/Asian-Canadian families,
   especially mothers (the primary grocery decision-makers) and their kids.
2. **Connects to the business** without feeling like an ad — players grow the
   same vegetables they buy at the store, and (eventually) earn real rewards.
3. **Lives in winter**: Saskatoon has 6 months of cold. A virtual farm where it's
   always green is a small joy in February.
4. **Has cultural depth**: celebrates real Chinese festivals (Spring Festival,
   Qingming, Dragon Boat, Mid-Autumn, Chongyang), teaches kids about Asian
   produce, includes recipe tips and folk knowledge.

This is the second project after a flight-shooter game (`stellar-ace`, archived
elsewhere) that was too genre-mismatched for the audience. This one is built
for actual customers.

---

## Target Audience

**Primary**: Mom + kid, playing together on phone/tablet.
- Mom is 35-55, Chinese-Canadian, primary household shopper at Eastern Market,
  reads Chinese fluently, English OK
- Kid is 6-14, born in Canada, English-first, knows some Chinese, finds Asian
  vegetables exotic

**Secondary**: Older Chinese immigrants (grandparents), university students,
solo shoppers.

**Design implication**: bilingual UI throughout. Visuals cute but not babyish.
Game must be playable in 5-minute sessions but reward daily return visits.

---

## Architecture

```
eastern-farm/
├── src/
│   ├── index.html              # Single-page app entry
│   ├── css/
│   │   ├── style.css           # Layout, typography, theme
│   │   └── animations.css      # Crop grow, harvest, button feedback
│   ├── js/
│   │   ├── main.js             # App entry, save load, main loop
│   │   ├── state.js            # Player state object + persistence
│   │   ├── crops.js            # Crop config + planting/harvest logic
│   │   ├── farm.js             # Farm plot grid, render, interactions
│   │   ├── shop.js             # Seed shop + market (sell crops)
│   │   ├── tasks.js            # Daily/weekly task system
│   │   ├── events.js           # Festival/season events
│   │   ├── ui.js               # Dialogs, toasts, currency display
│   │   ├── i18n.js             # Bilingual EN/ZH text bundle
│   │   ├── storekeeper.js      # Eastern Market NPC dialog system
│   │   └── rewards.js          # Coupon code generation/redemption
│   └── assets/
│       ├── crops/              # SVG icons per crop, multi-stage
│       └── ui/                 # UI icons, backgrounds
├── data/
│   ├── crops.json              # Master crop config (editable)
│   ├── tasks.json              # Task templates
│   ├── events.json             # Festival events
│   ├── store-inventory.json    # Real Eastern Market SKUs (sample/template)
│   └── coupons.json            # Reward codes
├── scripts/
│   └── gen_crop_svgs.py        # Pillow script — generate crop sprite sheet
├── docs/
│   ├── GAME-DESIGN.md          # Core mechanics, loops, progression
│   ├── CROPS.md                # Crop list with cultural notes
│   ├── EVENTS.md               # Festival event designs
│   ├── TASKS.md                # Prioritized work queue (READ FIRST)
│   ├── I18N.md                 # Localization guidelines
│   └── BUSINESS-INTEGRATION.md # How game connects to real store
└── CLAUDE.md (this file)
```

**Module loading**: plain `<script>` tags in dependency order. Each file
attaches to a `Farm` global namespace. No bundler, no build step, no npm.
This must stay double-click-and-go runnable from `file://`.

---

## Tech Stack

- **Vanilla JS** — readable, no framework lock-in
- **HTML + CSS** — mobile-first responsive layout
- **localStorage** — game save persistence (`eastern_farm_save_v1`)
- **JSON config files** — crops, tasks, events all data-driven so Chris can
  tune without touching code
- **Pillow (Python)** — pre-render cute crop SVGs/PNGs (optional; can also
  hand-author SVGs)
- **No backend in V1** — everything client-side. Coupons are pre-generated
  in `data/coupons.json`. Backend (Firebase/Supabase) comes in V2 if needed.

**Why no backend yet**: Chris wants to ship in 1-2 months. A backend adds 2-4
weeks of work (auth, sync, fraud prevention, hosting). Better to ship V1 with
client-side state + pre-generated coupons, observe usage, then add backend if
the game gets traction.

---

## Core Loop

```
Open game → See farm → Tap mature crops to harvest → 
  Get coins + Eastern Points → Plant new crops in empty plots →
    Optional: check tasks, check festival event, talk to storekeeper →
      Close. Come back in 30 min / 2 hrs / next day to harvest more.
```

**Session length**: 3-10 minutes typical.
**Return cadence**: 1-3 times/day for engaged players.
**No timer pressure**: crops don't wilt or die if left too long (this is
*cozy*, not stressful — different from original Happy Farm).

---

## Two-Currency System

| Currency      | How to earn                       | How to spend                          |
|---------------|-----------------------------------|---------------------------------------|
| 🪙 Coins      | Sell harvested crops              | Buy seeds, expand farm, decorate     |
| 🎫 East Points| Daily login (+1), tasks (+5-10),  | Exchange for **real Eastern Market** |
|              | festivals (bonus), big harvests   | coupon codes (see `rewards.js`)      |

**Coins** are the game's economy — abundant, used constantly.
**East Points** are scarce and meaningful — they represent goodwill toward
real-world Eastern Market.

V1: East Points exchange shows a pre-generated coupon code (from
`data/coupons.json`) that customer screenshots and brings to store. Cashier
manually validates.

V2 (later): API connection to Clover POS for real-time validation.

---

## Code Conventions

- **2-space indent**, single quotes, semicolons.
- **Bilingual comments OK** for design intent; code identifiers in English.
- **Namespace pattern**: each `.js` file ends with
  `window.Farm = window.Farm || {}; Farm.crops = { ... };`.
- **No frameworks**, no `npm install`. If a third-party lib is essential,
  bundle the file in `src/js/vendor/`.
- **Save state is sacred**: never silently corrupt or reset player data.
  Always version the save format (`save.version = 1`) and write migration
  code when changing structure.
- **Mobile-first**: everything must work on a 360px-wide phone. Test in
  Chrome DevTools device mode before committing.
- **Touch + click parity**: every interaction must work with both tap and
  mouse click.

---

## Visual Direction

See `docs/GAME-DESIGN.md` for full spec. TL;DR:

- **Warm cozy color palette**: cream backgrounds, soft greens, earthy browns,
  warm accent reds (matching Eastern Market brand)
- **程序化世界（2026-08-14 起）**：天空/远山/云杉林线/薄雾/草地/乡路全部
  canvas 程序化绘制，与农场物件同一套世界坐标（`_cell()`）——任何缩放都
  清晰、贴合是构造保证。旧照片背景 `hd_bg.webp` 已退役但资产保留，
  `mapview-iso.js` 里 `USE_PAINTED_BG=true` 可一键回滚。别再往世界里
  引入「不懂格子」的整幅位图
- **Rounded everything**: chunky rounded buttons, soft shadows, no sharp lines
- **Cute but not babyish**: crops have personality (smiling tomato, sleepy
  garlic) but aren't infantilized
- **Avoid**: high-saturation neon, dark mode (this is sunny daytime feel),
  Comic Sans, Material Design generic chips
- **Typography**（2026-08-13 重设计：高档 · 专业 · 友好 · 有质感）:
  - Display（标题/大字）: **ZCOOL XiaoWei 站酷小薇** —— 书法骨架的中文标题字，
    精品农产包装气质。只有 400 一档（body 已设 `font-synthesis:none` 防假粗）；
    **小于 13px 不用它**（笔画细节糊掉），小标签走 Noto Sans SC 加重
  - Chinese body: Noto Sans SC 400/500/700
  - English: Plus Jakarta Sans
  - Numbers（金币/积分/倒计时）: `--font-num` = Plus Jakarta Sans 700 +
    `font-variant-numeric: tabular-nums` —— HUD 数字要稳不要雅，跳动时位宽不抖
  - ❌ 卡通体（ZCOOL KuaiLe / Fredoka）已于 2026-08-13 移除，别加回来
  - 🔒 **ZCOOL XiaoWei 里「回」是坏字形**（字体自带豆腐块，浏览器不回退；
    2026-08-15 逐字扫 20,902 个汉字确认只此一字）。`style.css` 顶部
    `@font-face 'EF XiaoWei Patch'` 用 `unicode-range: U+56DE` 把它交给系统字体，
    排在 `--font-display` 栈首。**别删这个补丁、别把它从栈首挪走**
  - 正文不用衬线体；display 的笔锋对比是刻意保留的例外

---

## What V1 (this 1-2 month build) MUST have

Read `docs/TASKS.md` for the full prioritized list. Summary:

1. ✅ 12-plot farm grid
2. ✅ 8 core crops (青菜, 番茄, 黄瓜, 辣椒, 茄子, 韭菜, 香菜, 大蒜)
3. ✅ Plant → grow (timer) → harvest → sell flow
4. ✅ Seed shop
5. ✅ Coins + East Points dual currency
6. ✅ Daily login bonus
7. ✅ 1-2 festival events (Spring Festival + Mid-Autumn for first launch)
8. ✅ Daily task system (3 tasks/day)
9. ✅ Storekeeper NPC with rotating greetings
10. ✅ Bilingual UI (中文 / English toggle)
11. ✅ East Points → coupon code redemption flow
12. ✅ Save/load via localStorage
13. ✅ Mobile-optimized layout

## What V1 must NOT have (scope discipline)

- ❌ Real-time multiplayer
- ❌ User accounts / login (everything saved local)
- ❌ Real money transactions
- ❌ Push notifications
- ❌ Native mobile app
- ❌ Clover POS integration (V2)
- ❌ Friend system / social leaderboards (V2)
- ❌ More than ~10 crops in V1 (more variety = exponential balancing work)

---

## 验收守则（Chris 的硬规矩 — 2026-07-05 从历史会话审计沉淀）

这些是 Chris 在开发过程中反复纠正过的点，headless / loop 运行时同样生效：

1. **先算成本再设计奖励**：任何发奖 / 兑换 / 概率玩法，先算 Chris 的真实成本
   （东方点 1:1 变真积分 = 负债）。用泄压阀（限量 / 限时 / 前 N 人）控成本，
   别硬砍体验。反例："如果可以这样让客人白嫖，生意不是亏大了？"
2. **修 bug 必须浏览器实测复现才准报"已修"**：本地起 HTTP 服务器 → 浏览器里
   走一遍出问题的路径（含刷新 / 重进）→ 拿到证据。反例：报了"已修"，Chris
   刷新几次"问题依旧"。
3. **现实数据默认接实时源**：天气（萨斯卡通）、日历、赛程等现实信息不用假数据、
   不用过时快照。世界杯赛程按日期自动推进，不等 Chris 来说"小组赛该收起来了"。
4. **可玩性对标成功同类**（Hay Day 等）：进度曲线要有变化和期待感，"游戏一直
   不变化"是被打回过的。宣传图 / 视觉物料按 premium 标准自审一轮再交付。
5. **长任务先落 plan 文件**：UI / 玩法大改（预计动 ≥5 个文件）先把步骤写进
   `docs/` 或 scratchpad 的 plan md，做完一块 commit 一块——本项目会话多次
   撞 compact 丢进度，进度必须能从文件恢复（详见 D:\CLAUDE.md 第 4 节）。

---

## Testing Approach

- Manual play-testing. After any change, run a full day-cycle:
  - Plant something
  - Wait (or hack timer for testing)
  - Harvest
  - Sell
  - Buy new seed
  - Check task progress
  - Open festival event panel
  - Save/reload page to confirm persistence
- Test on real phone (Chris has iPhone 17) before declaring "done"
- Verify both 中文 and English UI render correctly

---

## Owner Context (Chris)

- Runs Eastern Market in Saskatoon (2000+ SKUs)
- Uses Clover POS (data export possible but no real-time API access in V1)
- Hardware: 2 Windows PCs (dev), iPhone 17 (testing), 2017 iMac (limited)
- Background: financial analysis, supermarket ops, Claude-tooling enthusiast
- Speaks/reads Chinese and English fluently
- Lives in Saskatoon (game references local context where natural)

When making design calls, optimize for:
1. **A mom in Saskatoon plays it and smiles**
2. **Single folder, open `index.html`, it works**
3. **Code stays editable by Chris himself** — readable, plain JS, no magic
