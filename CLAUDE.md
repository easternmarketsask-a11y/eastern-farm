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

### ③ 预缓存必须绕开 HTTP 缓存（2026-08-15，「刷新了还是旧代码」的根因）

`cache.add(url)` **走浏览器 HTTP 缓存**，而 GitHub Pages 对所有静态文件发
`Cache-Control: max-age=600`。于是新版 SW 安装时拿到的是**上一版的文件**，把它们装进
**新版本号的缓存**里，再缓存优先地一直发下去 —— 缓存名是新的、内容是旧的。
玩家刷新完全救不了（脏东西就在缓存里面），版本信标空刷一次后那道一次性防循环闸
还会**永久压住**自愈。

🔒 `service-worker.js` 的 `precacheAll()` 每一项都用 `new Request(u, { cache: 'reload' })`，
**别改回 `cache.add(u)`**。页面侧的新鲜度守卫发现版本不一致时，先 `postMessage`
一个 `refresh-precache` 让 SW 重抓整包再刷新，不再空刷。
回归测试 `scripts/verify/sw-update-test.mjs`（起一台发 max-age=600 的本地服务器真复现
「装好 v1 → 部署 v2 → 刷新」）已钉进 `deploy.sh` **闸门 C**，约 5 秒。

### 实测数据（生产站，改前 → 改后）

| 场景 | 改前 | 改后 |
|---|---|---|
| 回访 · 10kbps（缓存齐全） | **永远进不去**（45s 未就绪） | **1.03 秒** |
| 首访 · 400kbps（冷启动） | 24 秒 | 16 秒 |
| 回访 · 正常网速 | 0.8 秒 | 0.3–1.5 秒 |

⚠️ **仍未解决**：首访要下 ~600KB（50 个 JS 共 1.05MB 未压缩），弱网新客人依旧慢。
这是**打包/按需加载**的活，属独立任务，别指望上面两条修掉它。

---

## 🔒 存档与身份两条铁律（2026-08-15）

**① 同帐号多设备必须收敛到同一个农场。** `firebase-game-sync.restoreFromCloud`
是「富者胜出」：云端明显更富→自动换（本地先备份到 `eastern_farm_save_replaced_v1`）；
本地更富→保留（随后 push 追平）；相等看时间；各有所长→`_offerSaveChoice` 弹窗玩家选。
❌ 别改回「只恢复到全空设备」——那会让任何一份陈旧本地档永远挡住真农场，且反推云端。
❌ 被换下的档**永远先备份**，「永不弃档」是底线。

**② 对外名字：有昵称用昵称，没有就用会员真名。**（2026-08-18 Chris：不要打成「X邻居」。）
远景小屋挂这个名字。假称呼（王阿姨/李大爷）一律禁止（`ai-neighbors.RETIRED=true`）。
昵称保存入口仍是 `lifeStory.saveNickname`。

### 🔒 画面/海报口味（2026-08-16 Chris）

字叠在油画上。产品名 **东方农场**，**Eastern Farm** 要醒目并跟中文拉开，不许当下注脚。
双语是重新设计，不是中文底下叠一行小英文。「会员专属」必须可读。扫码是整宽奶油通栏+大码。
新海报另存版本号，不覆盖旧文件。开屏暖金薄纱、按钮高档能读清。细节见记忆 `project_chris_visual_taste`。
现行海报构图：**04c**（`promo/poster-phone-onart-04c.png`）。

### 🔒 文案原则（2026-08-18 Chris）

玩家看了要**舒服**，但不能有废话。

- **舒服 ≠ 口号、短句、切碎。** 2026-08-18 把 coach / 登录提示 / 建造 toast 改成「种好了。熟了会发光」「登录，农场不会丢」「按住建筑或菜地，拖到想放的地方」，Chris 原话：「这一版改不如不改」。已退回改前完整句。
- 完整、清楚、不卖萌、不公文。不要「啦/吧/哦/～」，也不要把句子削成广告口号。
- 一句一个用处：结果、条件或下一步。解释戏法、重复已知、感叹一律删。
- 双语各自成立，不是中文下面垫一行翻译腔。
- 没拿到 Chris 的原句，不要再改语气。改前那套完整句就是默认。
- **站在机会那一侧说话，不站在限制那一侧。** 2026-08-22 订单板副标题我写的是
  「东方超市只收它订的货」，Chris 改成「**东超每天都有很多订单，请按订单备货**」——
  同一件事，前者像在宣布规矩（你不能怎样），后者像在谈生意（有活干，来接）。
  规则类改动尤其容易写成前者，落笔前先问一句：这句话是在关门还是在开门。

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
- 🔒 **我的家换图靠 `o.lv`**（2026-08-18）：深度排序若只克隆 `{ type, gx, gy }`，
  升级只改存档、地图永远画 1 级小宅。`_drawBuilding` 必须带 `lv`；
  `_homeSprite` 不要退回 `this._img.house`。
  多座时每座自己的 `lv`，不要回落到「场上第一座」。
- 🔒 **点击必须真的点中贴图，不能只落进包围盒**（2026-08-22）：
  `_buildingAtPoint` 用 `_spriteHit` 做 **alpha 蒙版**判定（`_spriteMask`，128×128，
  懒建挂在 Image 上）。等距贴图是不规则形状，**拿包围盒当热区就会把旁边的草地算成房子**
  —— 房子按宅基地放大之后实测 7×7 庄园吃掉宅基地外 **95 格**地面，点旁边的草地
  也弹「我的家」（Chris 报的 bug）。
  - 建蒙版必须 `imageSmoothingEnabled = false`：缩图默认平均 alpha，源图里 1px 的
    铁艺栅栏能把整个 8×8 块染成实心，蒙版被撑胖。
  - 蒙版阈值保持宽松（`> 24`，沾到就算实心）：收紧到 128 只把误触从 34 降到 32，
    却让四合小院多出一处点不中 —— **宁可多认一点，也不能让塔尖/烟囱点不动**。
  - 取不到像素（跨域等）时 `_spriteHit` **退回矩形**：宁可多点中，也不能让房子点不动。
  - ⚠️ **落地格兜底是有意保留的**：`_buildingAtPoint` 最后一步 `_buildingAt(cell)`，
    落在**自家宅基地**上的点仍算点中这栋房子（那是它的院子，且小建筑靠这条「点底座
    就能选中」）。所以判据是「宅基地**之外**一格都不许误触」，不是「透明处一律不中」。
  - 回归闸门 K：`scripts/verify/tap-precision-test.js`（30 档 × 房子上必命中 ×
    宅基地外零误触；变异体退回矩形热区会跑出 1021 格误触，测试当场红）。
- 🔒 **东方超市不再无限收购，卖菜只能按订单供货**（2026-08-22 Chris 定）：
  谷仓的「卖给东方超市」已删除（`state.deliverWarehouse` / `warehouse.deliver()` 一并删掉，
  只留墓碑注释）。三层需求：**每日基础补货**（地板·限量·1.0×）/ **不定期订单**
  （主收入·1.5–2.2×）/ **大单**（少见·≥2.5×·可带超市积分）+ 顶部**备货预告**。
  - 🔒 **需求生成只有一处**：`src/js/store-demand.js`，**纯逻辑**（不碰 DOM、不读全局，
    连随机数都注入）。这样才能在 node 里跑经济模拟 —— 「新模式收入不低于旧模式」
    这条产品承诺只能靠模拟验证。`orders.js` 只管界面、接单、交付，别把生成抄回去。
  - 🔒 **需求量必须按「玩家真实日产能」定**＝地块数 × min(生长允许茬数, **登录次数**)。
    少了登录次数这一项：配额虚高 → 产出全被 1.0× 地板吃掉拿不到溢价（模拟 0.75×）；
    订单虚大 → 全有或全无根本交不出（模拟 **0.22×**）。两个坑都真的踩过。
  - 🔒 **每日基础补货必有一样是玩家谷仓里最多的菜**。这是防卡死的地板，也让新手
    第一次只收一棵也交得掉（引导第三步靠它）。没有这条，只种冷门贵菜又不看板的
    玩家会被打到旧收入的 **17%**。
  - 🔒 **没接的单不能交**，同时最多接 3 单（`ACCEPT_CAP`）；放弃**无惩罚**；
    过期只是消失，不扣钱不掉声望。**交完不立刻补位**（立刻补位＝无限供应）。
    免费换单已撤（那是无限收购的另一种形态）。
  - 🔒 **离线回来不追发**：清过期 → 按「现在」补到板位上限，不按错过的周期数补发
    （否则一次砸出几十张单）。生成即落档，刷新不重 roll（防 save-scum）。
  - 🔒 **`totalDeliveries` 由订单/补货交付接管**（原来只在 `deliverWarehouse` 自增）。
    冻结它会静默废掉：人生故事的交付章节、排行榜交付数、`daily.js` 的 `isNewbie`、
    漏斗 `sell_first`、**新手引导第三步的推进判据**。每日首单 +20% 也搬了过来（回访钩子）。
  - 🔒 **东超告示牌**（`board`）是实体建筑，免费、开局自动立在**谷仓正前方**、
    **不可拆**（它是唯一的卖菜出口）、不进建造调色盘。程序化绘制不加贴图。
    ⚠️ 落点必须**在附近所有建筑的前面**（`depthOK`）：等距深度按 gx+gy 排，1×1 的牌子
    夹在 2×2 中间会被邻居贴图盖住 —— 实测摆旁边点到谷仓、摆正前方点到温室，
    **四个探测点没一个点得中它**。点不开＝卖不了菜。
  - 老存档进新版发一张**一次性开业清仓单**（旧大宗价收掉存量库存，7 天有效、不占接单位）。
  - 回归闸门 L：`store-demand-test` / `store-economy-sim` / `store-state-test` /
    `no-bulk-sell-test` / `orders-ui-test` / `rename-test` / `steal-pay-test` +
    浏览器 E2E `store-order-tests.js`（25 条）。
  - 设计/计划：`docs/superpowers/specs/2026-08-22-store-order-economy-design.md`、
    `docs/superpowers/plans/2026-08-22-store-order-economy-phase1.md`。二期才接真店特价
    （`/api/public/farm-demand`，`store-demand` 里 `saleCropIds` 的钩子已留好并测过加权）。
- 🔒 **顺菜要按 5 折留下菜钱**（2026-08-22 Chris 定）：`social-steal.payFor()` 是
  **唯一**的算钱实现（顺的人扣钱、被顺的人收钱夹上限都用它）。付不起就顺不走；
  仓满不扣钱。⚠️ 事件里的 `coins` 是**跨用户写入、不可信**，收下时必须夹到本地
  `payFor()` 算出的应付额，否则伪造事件就能刷币（沿用 `caught` 那条的既有防线）。
  口径仍是「顺 / 留下菜钱」，不许写成「偷 / 抢」。
- 🔒 **人和车走「看得见的地方」，不再只限已买地界**（2026-08-22 Chris 定）：
  可走判据是 `_inWalkWorld`（`WALK` 矩形，与 `_drawWildWoods` 画地面的范围同界、
  往里收一格）**并上已买地界**——后半截是防回归，老存档 BACK 地界含 `gx+gy<4`
  的西北角，新规矩不能反过来把人关得更小。
  🔒 **买地的意义不变**：仍然只有买下的地能盖房、能开田（`_canPlace` / `_footprintFree` 不动）。
  - 🔒 **`_wildTreeAt` 是「这格有没有树」的唯一判据**，渲染(`_drawWildWoods`)和
    寻路(`farmer.cellWalkable`)共用。它**必须是纯世界函数**——掺进任何相机/视口项，
    树就会随镜头出现消失，挡路的位置跟着漂移。渲染侧只许再补出屏裁剪。
    （地平线那条 `dHl<0.50` 看着像相机项，其实 `dHl ≡ (gx+gy+3)/8.8`，
    camY/oy 相消，与镜头缩放无关，所以它可以进纯函数。）
  - 🔒 **疏林密度不能往回调高**：四邻接寻路 = 方格站点渗流，**空地率低于约 0.593
    就没有贯穿通路**。旧值 0.55/0.78（空地率 0.45/0.22）是实心墙——那时候光放开
    地界判据的话，人一步也走不出去，「改了等于没改」。现在内部 0.22、贴边升到 0.86。
  - 🔒 **最外两格是实心林墙**（`dEdge <= 1` 直接返回 true，不走概率）：概率密度再高
    也总有缝，实测 0.86 时仍有 14 格走到了硬矩形边界 = 隐形空气墙。
    **玩家撞到的必须是看得见的树。**
  - 取景/相机范围按 `WALK` 算，不是 `COLS/ROWS`；`_followActorCam` 开车居中跟、
    走路用死区跟（`W*0.30 / H*0.28`），别改成走一步就居中——农场会跟着人晃。
  - 自主闲逛（`pickIdleTarget`）**仍只在已买地界内**，出界只能由玩家点。
  - 回归闸门 J：`scripts/verify/roam-tests.js`（三种地界 × 连通性/树碰撞/
    判据不随镜头漂移/不撞硬边界/不回归/车也出得去 + 端到端走出去）。
  ⚠️ 测试要走**真实入口**进农场（点 `#splashStart`）：直接 `__splashDismiss()`
  会跳过 `isoView.init()`，`_on` 永远 false，而 `goTo()` 第一行就是
  `if (!iso._on) return false` —— 端到端会假红，且看起来像寻路坏了。
- 🔒 **地界只许放大**（2026-08-18）：`LAND_LEVELS_*` 每一档必须是旧矩形的超集，
  老存档的 map / plots / clearedCells 坐标一律不改。世界往东加格（COLS），
  也往镜头前加格（ROWS，镜头前那片草甸）。默认不画程序化乡路（2026-08-19 Chris）；
  玩家在建造里刷的小路仍在。`SHOW_COUNTRY_ROAD=true` 可恢复旧乡路。
  开垦菜地帽仍是 `EXTRA_PLOT_CAP=4`。
- 🔒 **房子计价**（2026-08-18）：点现有房子=改建，只补与现款的差价（降档不退款）；
  调色盘再建=按图册全价（农户小宅另建至少 300）。全场最多 4 座。
  图册分农舍 / 小院 / 洋房 / 豪宅四类卡片。章节 `home_level` 按造价档，不按图册序号。
- 🔒 **房子画多大，只由宅基地决定**（2026-08-21）：`_spriteBox` 是**唯一**的贴图盒实现
  （曾有四份抄本：`_drawBuilding` ×2 / `_buildingAtPoint` / `barnScreenRect`，
  改一处忘一处 = 房子画大了但点不中）。带 `plotFill` 的走
  「宽 = (w+h)/2 × tw × fill」，高度随贴图长宽比自然长出来。
  - **`HOME_LEVELS.draw` 是屋檐溢出系数**（1.0 = 正好盖住宅基地），
    不是「放大倍数」。小房子溢出多、大房子溢出少（2×2≈1.18 → 7×7≈1.00），
    同档内按造价微调 ±3%。
  - ⛔ **不许再引入与占地无关的高度上限**。旧写法 `b.sc * th * 2.2` 就是这种上限，
    宽度被它反推出来 → 3000 币的 4×4 院子比 6000 币的 5×5 别墅还宽、
    7×7 庄园只盖住自家地的 42–55%，**花钱改建反而缩水**。
  - 其余建筑（鸡舍/温室/水井/树/车/装饰）**不写 `fill`**，保持 2026-06-18 手调尺寸。
    只有谷仓给了 `fill: 1.08` —— 房子变大后它按老口径只占地 64%，小得像玩具。
  - 🔒 **取景要框宅基地的四个角**：`_autoFrame` / `_buildFrame` 里
    `(gx,gy)` 与 `(gx+w-1,gy+h-1)` 只是等距菱形的上下两尖，左右两尖在
    `(gx,gy+h-1)` / `(gx+w-1,gy)`。少框这两个，屏幕横轴每边少算 (w+h-2)/2 格 ——
    7×7 庄园会被切在屏幕左缘（390 竖屏实测）。
  - 贴图入库前必须**去背 + 裁到内容外接框**（工具 `scripts/_fix_house_bg.py`）。
    p_house_23 曾整张压在 (33,33,33) 黑底上直接上线，草地上就是一块黑方砖；
    23–30 那批 1024×1024 留白没裁，同档次比 1–22 小一圈。

---

## Visual Direction

See `docs/GAME-DESIGN.md` for full spec. TL;DR:

- **Warm cozy color palette**: cream backgrounds, soft greens, earthy browns,
  warm accent reds (matching Eastern Market brand)
- **程序化世界（2026-08-14 起）**：天空/远山/云杉林线/薄雾/草地全部
  canvas 程序化绘制，与农场物件同一套世界坐标（`_cell()`）——任何缩放都
  清晰、贴合是构造保证。旧照片背景 `hd_bg.webp` 已退役但资产保留，
  `mapview-iso.js` 里 `USE_PAINTED_BG=true` 可一键回滚。别再往世界里
  引入「不懂格子」的整幅位图。默认不画乡路（`SHOW_COUNTRY_ROAD=false`，
  2026-08-19）；不要把土路加回默认开局。
- **农户形象（2026-08-20）**：场上是油画小人 9 款（设置 → 农场显示），
  走 / 浇水 / 收获 / 摊前站着。新号默认女农户。不造假名、不上照片。
  贴图按需加载，不进 SW 预缓存。规格：
  `docs/superpowers/specs/2026-08-20-painted-farmers-design.md`
- 🔒 **收割/种植落点（2026-08-20）**：人站在**本块地朝镜头的前缘**（`plotPos`，偏移约 +0.14/+0.38），
  手够得到土和菜。寻路/停车只走到邻格 `approachPos`，最后一小段再走进垄。
  收割是弯腰空手去摘（地里的菜还在，播完才进仓）；种植是蹲下拿手按进土，图里不带土堆。
  契约：`scripts/verify/farmer-work-test.mjs`。
- 🔒 **音效（2026-08-20）**：零音频文件，全是 `audio.js` WebAudio 合成。每种必须
  噪声质感 + 乐音收尾（土扑/叶片/水流/木贴），不得退回单振荡器蜂鸣。浇水播
  `water` 不得播 `coin`。环境层独立 gain（风+鸟+偶发叶响）。契约：
  `scripts/verify/audio-test.mjs`。
- 🔒 **等距朝向（2026-08-20）**：格子是 2:1，`_cell` 里 `x∝(gx-gy)`、`y∝(gx+gy)`。
  人/车贴图都是 3/4 朝右下。朝向**必须**走 `farmer.heading(dx, dy)`：
  屏幕右 = `dx-dy ≥ 0` → 水平翻转；背对镜头 = `dx+dy < 0` → 换
  `p_farmer_N_back.webp`（6×2：上站立 / 下走路）/ `p_car_N_rear.webp`。
  走路**不许** `rotate` 歪着迈。摊前客人背对镜头、面向菜摊。
  新买的车默认 `face:'r', away:false`（朝镜头）；开过之后朝向写进存档。
  ❌ 不许再用世界轴 `|dx| vs |dy|`（+gy 会被错画成朝右，人侧着走、车侧着开）。
  宠物已经是 `dx-dy` 翻转，人/车必须同一套。契约：`scripts/verify/iso-heading-test.mjs`。
- 🔒 **车辆落地贴合草地（2026-08-20）**：买来的车坐在程序化草地上，不带影棚黄绿椭圆。
  `scripts/_key_car_platform.py` 从边缘洪水抠椭圆；车漆跟草地太像的款（2/4/7/10/11/15）
  只抠影棚、保留椭圆，避免把车身抠穿。轮子围住的那块草洪水到不了——再放宽颜色
  会抠穿奶油车门，所以 p_car_1 / p_car_5（截图里的皮卡和家庭轿车）改为品红底
  隔离后再抠。引擎 `_drawBuilding` 已经画接地影。
  契约：`scripts/verify/car-platform-test.py`（1/5 左下右下草地框必须空）。
- 🔒 **开车动画（2026-08-20）**：车不是贴图在滑。驾驶中必须有悬挂弹跳、扬尘、
  起步蹲下/刹车点头、转弯微倾、车头灯/尾灯，引擎是低通噪声循环（不是蜂鸣）。
  镜头轻跟（玩家正在拖地图时不跟）。状态只在内存，不落盘。
  上车/下车有一跳；附近的小猫小狗鸡兔会坐上车斗（马牛不上，太大）。宠物上车
  **不落盘**。契约：`scripts/verify/car-motion-test.mjs`。
- 🔒 **车辆保养奖励型（2026-08-21）**：擦亮最多快 22%，不擦就是目录速度。
  **没有油、不会坏、永远开得了**。`catalogSpeed()` 不吃 shine（闸门 I 钉死 4.4/9.0）。
  契约：`scripts/verify/car-shine-test.mjs`。
- **开车（2026-08-20）**：点农场任意空地，人绕开障碍走过去（`src/js/pathfind.js`
  的 BFS，只走 4 邻接不擦角）。点场上的车 →「🚗 上车」，之后点哪儿车开哪儿，
  到了人下车、车停在新位置并写进存档。车款价差＝速度差（农用 4.4 / 家用 6.0 /
  越野 7.5 / 豪华 9.0 格·秒⁻¹，走路 2.2）。🔒 `A.driving` **不落盘**，刷新即下车；
  建造模式与拜访别人农场时一律开不了。**派农活时人会自己算「走过去 vs 去开车」
  谁快（快 1.3 倍才开车），划算就自己去开车，到地头下车干活**；除此之外
  🔒 **到了不自动下车，点一下车才下车**；开车时左下角常驻「🚶 下车」按钮
  （车可能开出视野，点车不是唯一出路）。回归测试是 `deploy.sh` 闸门 I。
  规格：`docs/superpowers/specs/2026-08-20-drive-car-anywhere-design.md`
- **声音（2026-08-21）**：音效走三级混音总线（削毛刺 → 程序化院子混响 0.55s →
  胶合压缩），**零音频文件**。🔒 同一事件的所有层共用同一声像值；UI 音走干声不进混响。
  发动机是**点火脉冲循环**（四缸，加速＝脉冲变密），🔒 响度按 RMS 定不按峰值
  （波峰因数 11.7dB，按峰值调会轻 12 倍＝听不到）。
  背景音乐 `music.js` 程序化生成七款风格，**风格＝一条数据**；按
  节日（`events.js`）→ 萨斯卡通实况天气（`weather.js`）→ 日常 自动选曲，
  `?music=xxx` 可临时指定。设置里可关（`musicOff`）。试听页 `src/audio-lab.html`。
  规格：`docs/superpowers/specs/2026-08-21-farm-audio-and-music-design.md`
- **金色黄昏光（2026-08-15）**：程序化天空/草地/林影对齐宣传插画
  （`promo/keyart-farm-*.jpg`）——左上侧光、暖黄绿草地、云杉往右下拉长影。
  只改调色和影子方向，不换位图。别把天空改回冷薄荷绿。
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

## 🔒 自动弹窗与叫法约定（2026-08-15）

- **任何自动弹出的东西**（章节来信、回家小报、催登录、促销……）出手前先问
  `Farm.ui.isBusy()`：它统一判定 `#modal` 开着 / 开屏还在 / 新手聚光灯进行中。
  别再各自只查 `#modal` —— 聚光灯与开屏都不走 modal，漏了就会盖在新手引导上（实测过）。
- 🔒 **弹窗手感（2026-08-20）**：✕ 钉在不滚动的 `.modal-content` 上，正文进
  `.modal-body`（长列表一滑叉不能跟着走掉）。登录/短信 `closeOnBackdrop:false`。
  弹窗里输入框 ≥16px。关窗期间 `.modal.closing { pointer-events:none }`。
  列表入场走 `_staggerModalItems`（`.ef-pop`），按钮 48px 厚边、点下去有
  轻触震动。关闭叉是奶油圆钮不是灰影。契约 `scripts/verify/modal-ux-test.mjs`。
- **玩家可见叫法一律**：游戏名「东方农场 / Eastern Farm」（「东方农场路」是世界里的地址）；存储建筑「谷仓 / barn」（别再写 仓库 / silo / warehouse）；
  NPC 叫「**东超**」（东方超市的简称，2026-08-22 由「小东」改名；它现在就是店本身，不是一个人，文案别再用「他」）。英文侧沿用 Eastern Market / the storekeeper。
- 宠物显示语义：`state.petsEnabled === false` 才藏，`undefined` 视为开；买宠物自动置 true。
  开关只在「设置 → 农场显示」。
- 部署闸门 `scripts/verify/smoke-flows.js` 走 23 个入口，任一步抛异常即中止；
  新增大入口时**顺手加一行**。

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
