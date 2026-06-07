# 每日打开率 / 留存增强包 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给东方农场补上"把客人每天拉回来"的能力：可安装 PWA + 每日定时推送 + 7天签到日历 + 菜熟倒计时 + 高光庆祝。

**Architecture:** 纯前端模块（C/B/D）挂在现有 `Farm.*` 命名空间，复用 `state.js` 的 `Object.assign` 自动补字段做存档迁移、`Farm.ui` 弹窗/toast、现有彩带动画体系。PWA（A1）是同源静态文件（manifest + service worker）。推送（A2）= 游戏前端注册 FCM token 写入 Firestore（`eastern-market-members`，复用 `firebase-game-sync.js` 的玩家 doc）+ 在 **另一个 repo** `EasternMarket_app/functions` 新增一个每日定时 Cloud Function 发送。

**Tech Stack:** Vanilla JS（无 build / 无 npm / 无测试框架——本项目铁律），Firebase compat SDK（auth/firestore 已用，新增 messaging），Firebase Cloud Functions（Node 20，已有 `onOrderStatusChange` 部署管线），GitHub Pages 托管游戏静态站。

---

## ⚠️ 本计划的执行约定（务必先读）

本项目有两条**优先级高于通用 plan 模板**的锁定规矩，本计划据此调整：

1. **无测试框架、无 npm、无 build**（eastern-farm CLAUDE.md）。因此每个任务的"验证"是**手动试玩 + 浏览器控制台检查**，不写 jest/pytest。验证步骤都给了明确的可观察预期。
2. **「写给 Claude Code 的 Prompt 原则」**（父 CLAUDE.md）：不规定函数名/参数/代码组织。因此每个任务**先要求你读现有代码**，再让你按现有风格自己决定实现。计划给的是：改哪些文件、要什么行为、数据字段名、已知坑、验收标准——不是替你写好的函数体。

**通用红线（每个任务都适用）：**
- 改 `state.js` 存档结构时：只新增字段（靠 `Object.assign(STARTER_STATE, parsed)` 自动补），**绝不**删字段或重置老玩家进度。存档是神圣的。
- 所有新 UI 文案必须**中英双语**，走现有 `Farm.i18n` / `data/i18n.json` 模式，不硬编码单语。
- 视觉遵守 CLAUDE.md 治愈系方向：奶油底、品牌红、圆角、轻阴影；禁高饱和霓虹/闪烁。
- 每个任务做完**先自测**（按验收清单），iPhone 真机 + 桌面 DevTools 移动模式各过一遍，控制台无红色报错，再 commit。
- **commit 可以做；push 一律 Chris 亲手执行。** 不要 `git push`。
- 不要把别的对话留下的未提交改动（如 `data/crops.json`、`src/js/crop-art.js`）卷进你的 commit——只 `git add` 你本任务碰的文件。
- 实现 A2 推送前，**先在 main 之外开分支**做（涉及生产 Firebase 项目 Functions），遵守父 CLAUDE.md「UI 改造工作流」四道保险。

---

## 文件结构总览

| 文件 | 责任 | 任务 |
|---|---|---|
| `src/js/harvest-status.js` (新建) | 首页菜熟/倒计时状态条 | Task 1 |
| `src/js/login-calendar.js` (新建) | 7天签到日历 | Task 2 |
| `src/js/state.js` (改) | 新增 `loginCalendar` 存档字段 + 签到 mutator | Task 2 |
| `src/js/main.js` (改) | 接入签到日历到启动流程，合并旧 `checkDailyLogin` | Task 2 |
| `src/js/farm.js` (改) | 连击收获飘字 hook | Task 3 |
| `src/css/animations.css` (改) | 连击 / 完成庆祝动画 | Task 3 |
| `src/js/achievements.js` / 图鉴入口 (改) | 解锁完成仪式动画 | Task 3 |
| `manifest.webmanifest` (新建) | PWA 安装清单 | Task 4 |
| `service-worker.js` (新建) | 离线壳缓存 | Task 4 |
| `src/js/pwa-install.js` (新建) | iOS「添加到主屏幕」引导 | Task 4 |
| `src/index.html` (改) | 链接 manifest、注册 SW、引入新 JS | Task 1-5 各自挂载 |
| `firebase-messaging-sw.js` (新建) | FCM 后台消息 SW | Task 5a |
| `src/js/firebase-push.js` (新建) | FCM token 注册 + 写 Firestore | Task 5a |
| `EasternMarket_app/functions/src/dailyFarmReminder.ts` (新建, 另一 repo) | 每日定时推送函数 | Task 5b |

---

## Task 1: 菜熟倒计时 / 已熟状态条（模块 C）

**最先做：纯前端、纯读现状、零存档改动，立刻见效。**

**Files:**
- Read first: `src/js/farm.js`（看 tick 循环、作物成熟判定、`plots` 结构、收获函数、warehouse 满判定）、`src/js/state.js`（`plots[].crop/plantedAt/harvestsLeft`、`isWarehouseFull()`、`addToWarehouse`）、`src/js/crops.js`（`grow_minutes` 字段名、成熟时间算法）、`src/js/ui.js`（HUD 渲染位置、toast）、`data/i18n.json`（加文案）
- Create: `src/js/harvest-status.js`
- Modify: `src/index.html`（在其他 Farm.* 之后、`main.js` 之前引入新脚本）、`src/css/style.css`（状态条样式）、`data/i18n.json`（双语文案）

**行为规格：**
- 首页 HUD 下方一条状态条，三种状态：
  - 有已熟作物：`🌾 N 棵已熟可收` + 一个「全部收获」按钮
  - 无已熟、有在长：`⏳ 下一批 1 小时 23 分后成熟`（取所有生长中地块里**最早成熟**的剩余时间）
  - 全空/全已熟已收：`🌱 地都空着，种点什么吧`
- 倒计时每分钟刷新（接现有 farm tick，不要新开高频 setInterval；若现有 tick 是 1s，每 tick 更新文字即可）。
- 「全部收获」按钮：遍历所有已熟地块依次收获（复用 farm.js 现有单棵收获函数，**不要**另写一套收获逻辑——统一模板铁律）。**必须尊重 warehouse 容量**：仓满时停止并提示"仓库满了，先去卖菜"（复用现有满仓提示）。
- 文案双语，治愈系，不施压。

**Steps:**
- [ ] **Step 1: 读现有代码**，搞清 farm.js 怎么判断成熟、单棵收获入口函数、warehouse 满怎么提示、HUD DOM 挂在哪。记下你要复用的函数名。
- [ ] **Step 2: 新建 `harvest-status.js`**，实现 `Farm.harvestStatus.render()`（计算三态并更新 DOM）和「全部收获」处理（循环调用现有收获函数 + 满仓中断）。挂 `window.Farm.harvestStatus`。
- [ ] **Step 3: 接入刷新**：在现有 farm tick 里调用 `Farm.harvestStatus.render()`；收获/种植后也调一次即时刷新。
- [ ] **Step 4: index.html 引入脚本 + 加 i18n 文案 + 样式**。
- [ ] **Step 5: 手动验证**：
  - 种下一棵 → 状态条显示倒计时，分钟数随时间减少
  - 成熟后 → 变 `🌾 1 棵已熟可收` + 按钮出现
  - 点「全部收获」→ 全部进仓、状态条归零、显示下一批或"地空着"
  - 仓库填满后点全部收获 → 中途停止 + 满仓提示，没有作物凭空消失
  - 中英切换文案都对；控制台无报错
- [ ] **Step 6: commit**（只 add 本任务文件）：`git add src/js/harvest-status.js src/index.html src/css/style.css data/i18n.json && git commit -m "feat(C): 首页菜熟倒计时/已熟状态条 + 一键收获"`

---

## Task 2: 7天签到日历（模块 B）

**改 `state.js` 存档 = 高危区，务必只增不删、写迁移。需要谨慎合并现有每日登录奖励。**

**Files:**
- Read first: `src/js/main.js` 的 `checkDailyLogin()`（现有连续登录 + 倍数 + toast 逻辑）、`src/js/state.js`（`loginStreak`/`lastLogin`/`getDateString`/`recordStreak`、mutator 风格）、`src/js/ui.js`（showModal）、升级彩带动画在哪（commit 8863cb6，找全屏 confetti 函数，第 7 天复用）
- Modify: `src/js/state.js`（新增字段 + 签到 mutator）、`src/js/main.js`（用日历替代/包住旧 `checkDailyLogin`）、`data/i18n.json`、`src/css/style.css`
- Create: `src/js/login-calendar.js`

**行为规格：**
- 存档新增字段（加进 `STARTER_STATE`，靠 `Object.assign` 自动补到老存档）：
  ```
  loginCalendar: { cycleStartDate: '', lastSignDate: '', dayIndex: 0 }
  ```
- 7 格横向日历：已签（打勾）/今日可签（高亮脉冲）/未来（灰）。
- 奖励阶梯（第 1–7 天，金币为主、第 7 天给大奖）。**先去现有经济里取合理量级**（参考 daily.js 的转盘奖、登录倍数），别拍脑袋给爆通胀的数。建议梯度示意（执行时按现有经济微调）：
  - D1–D6：金币递增 + 偶尔种子/少量积分
  - **D7：大额积分 + 稀有种子/装饰 + 全屏仪式动画**（复用现有升级 confetti，强度调到比平时更隆重）
- 断签逻辑：若 `lastSignDate` 不是昨天也不是今天（中断 ≥1 天）→ `dayIndex` 重置为 0，`cycleStartDate` 设为今天。文案温和（"新的一轮开始啦"，不指责）。
- 签到入口：进游戏当天未签到时自动弹一次；「今日」面板内也放一张常驻卡可随时打开。
- **与旧 `checkDailyLogin` 合并**：旧的"连续登录 +10币+1积分×倍数 toast"和新日历是**同一件事的两种表现**，不能并存发两次奖励。决策：保留 `loginStreak`（成就/`maxStreak` 仍依赖它），但把"发奖 + 展示"统一到签到日历；旧的 toast 发奖逻辑删掉或改为只更新 streak 不再单独发币。实现前先确认 `loginStreak` 还有哪些地方读（grep），别改坏成就。

**Steps:**
- [ ] **Step 1: 读 + grep**：`checkDailyLogin` 全貌、`loginStreak` 所有读取点、全屏 confetti 函数名、现有经济量级。
- [ ] **Step 2: 改 `state.js`**：`STARTER_STATE` 加 `loginCalendar` 字段；加 mutator（如 `signTodayCalendar()` 返回今天第几天 + 是否断签重置），auto-save。确认 `init()` 的 `Object.assign` 会给老存档补上该字段（已是现有机制，无需额外迁移代码，但要**实测**老存档加载不报错）。
- [ ] **Step 3: 新建 `login-calendar.js`**：渲染 7 格 + 领奖逻辑（领奖发币/种子/积分走现有 `Farm.state.addCoins/addSeed/addEastPoints`）；第 7 天触发全屏庆祝。挂 `Farm.loginCalendar`。
- [ ] **Step 4: 改 `main.js`**：启动时调用签到日历（替代旧 `checkDailyLogin` 的发奖+toast），保留 streak 更新；「今日」面板加入口卡。
- [ ] **Step 5: i18n + 样式**。
- [ ] **Step 6: 手动验证**：
  - 全新存档：第 1 天进入弹日历，签到得 D1 奖
  - 改系统日期/或临时改 `getDateString` 测：连签到 D7 → 触发全屏大奖 → 次日进入新一轮 D1
  - 中断一天 → 回到 D1，文案温和
  - **老存档迁移**：用一个旧版 localStorage（无 loginCalendar 字段）加载 → 不报错、自动补字段、进度不丢
  - 确认没有"旧登录奖励 + 新签到奖励"双发
  - 成就里依赖 streak 的仍正常
- [ ] **Step 7: commit**：`git add src/js/login-calendar.js src/js/state.js src/js/main.js src/index.html src/css/style.css data/i18n.json && git commit -m "feat(B): 7天签到日历（递增奖励+第7天全屏大奖），合并旧每日登录奖励"`

---

## Task 3: 高光时刻（模块 D）

**只补与"回归/里程碑"绑定的庆祝，不给普通收获加更多彩带。**

**Files:**
- Read first: `src/js/farm.js`（单棵收获飘字/粒子现状）、`src/js/audio.js`（音效 id：coin/buy/error 等）、`src/css/animations.css`（现有动画类）、`src/js/achievements.js` + `main.js` 的 `openCollection`（解锁/完成现在多是 toast）
- Modify: `src/js/farm.js`、`src/css/animations.css`、`src/js/achievements.js`（或图鉴解锁处）、`data/i18n.json`

**行为规格：**
- **连击收获**：短时间内（如 2 秒窗口）连续收获多棵时，飘字递进显示连击数（`连击 ×2 / ×3 …`），音效渐强（复用 audio.js 现有音，不引入新资源也可），节奏感强但不刺眼。一次性多棵（Task1 的"全部收获"）触发一个"丰收"小高潮汇总飘字。
- **图鉴/成就完成**：解锁新作物（首次种某作物进图鉴）或达成成就时，从 toast 升级为一次**有完成感的仪式动画**（卡片放大 + 微光 + 一句祝贺），复用现有 confetti 体系的轻量版。
- **不做**：普通单棵收获维持现状；不加高饱和霓虹/频闪。

**Steps:**
- [ ] **Step 1: 读现有收获飘字 + 完成 toast 代码**，确认连击计数挂在哪最自然（farm 收获函数内维护一个时间戳+计数）。
- [ ] **Step 2: 实现连击**：在收获函数里维护连击窗口；飘字组件复用现有，加连击数样式。
- [ ] **Step 3: 实现完成仪式**：图鉴解锁/成就达成处替换/包裹现有 toast 为仪式动画。
- [ ] **Step 4: animations.css 加动画类 + i18n 文案**。
- [ ] **Step 5: 手动验证**：
  - 快速连点收获多棵 → 出现连击递进飘字 + 音效渐强
  - 间隔慢慢收 → 不触发连击（维持普通飘字）
  - 首次种一个新作物（进图鉴）→ 完成仪式动画
  - 普通单棵收获画面没变吵；控制台无报错
- [ ] **Step 6: commit**：`git add src/js/farm.js src/css/animations.css src/js/achievements.js data/i18n.json && git commit -m "feat(D): 连击收获飘字 + 图鉴/成就完成仪式动画"`

---

## Task 4: 可安装 PWA（模块 A1）

**A2 推送的前提。图标首发必须定稿（iOS 图标永久缓存，换图要删 App 重装）。**

**Files:**
- Read first: `src/index.html`（`<head>` 结构、现有 meta、脚本加载顺序）；确认部署 base path（自定义域 `farm.easternmarket.ca` 下应为根 `/`）
- Create: `manifest.webmanifest`、`service-worker.js`、`src/js/pwa-install.js`、PWA 图标（192/512 普通 + maskable；复用现有 logo 资产，无则用笑脸番茄/上海青主视觉）
- Modify: `src/index.html`（link manifest + apple-touch-icon + theme-color meta + 注册 SW + 引入 pwa-install.js）、`data/i18n.json`

**行为规格：**
- `manifest.webmanifest`：`name`=东方农场/Eastern Farm，`short_name`，`display: standalone`，`start_url`/`scope` 对齐部署根路径，`theme_color`/`background_color` 用奶油底+品牌红，`icons`（192/512 + maskable）。
- iOS 需要 `<link rel="apple-touch-icon">` + `<meta name="apple-mobile-web-app-capable">` + `<meta name="apple-mobile-web-app-status-bar-style">`（manifest 在 iOS 支持有限，apple meta 必须补）。
- `service-worker.js`：缓存 app shell（html/css/js/图标）做离线壳；**`data/*.json` 走 network-first**，别缓存死游戏数据；SW 带 `CACHE_VERSION` 常量，版本变更时清旧缓存（避免用户卡旧版）。
- `pwa-install.js`：
  - Android/桌面：监听 `beforeinstallprompt`，存事件，在合适时机给个"安装到桌面"按钮（可选，低优先）。
  - **iOS Safari 且未安装**（`navigator.standalone !== true` 且 UA 为 iOS Safari）：显示一次性引导浮层，教"分享 → 添加到主屏幕"，带示意。「不再提示」记 localStorage。
  - 已是 standalone 模式则不显示任何引导。

**Steps:**
- [ ] **Step 1: 确认部署 base path**（farm.easternmarket.ca 根路径），定 manifest 的 `start_url`/`scope` 和 SW 注册 scope。
- [ ] **Step 2: 做图标**（定稿！）+ 写 `manifest.webmanifest`。
- [ ] **Step 3: 写 `service-worker.js`**（app shell 缓存 + data network-first + 版本清理）。
- [ ] **Step 4: index.html** 加 manifest link、apple-touch-icon、apple meta、theme-color；加 SW 注册脚本（带失败兜底，注册失败不影响游戏）。
- [ ] **Step 5: 写 `pwa-install.js`** + iOS 引导浮层 + i18n。
- [ ] **Step 6: 手动验证（重点真机）**：
  - 桌面 Chrome DevTools → Application → Manifest 无报错、图标显示；Service Worker 已激活
  - 断网刷新 → 游戏壳仍能打开
  - 改一个 data json 后刷新 → 拿到新数据（没被 SW 缓存死）
  - **iPhone Safari** 打开 → 出现"添加到主屏幕"引导 → 添加 → 桌面独立图标 → 点开全屏无地址栏
  - 已添加后再开网页 → 不再弹引导
  - 控制台无报错
- [ ] **Step 7: commit**：`git add manifest.webmanifest service-worker.js src/js/pwa-install.js src/index.html data/i18n.json src/assets/ && git commit -m "feat(A1): 可安装PWA（manifest+service worker+iOS添加到主屏幕引导）"`

---

## Task 5a: FCM token 注册（模块 A2 前端）

**前置：Task 4 完成（必须先是 PWA）。需在 Firebase Console 生成 Web Push VAPID key 备用。**

**Files:**
- Read first: `src/js/firebase-init.js`（`firebaseConfig`、`Farm.fb` 形态）、`src/js/firebase-game-sync.js`（玩家 doc 在 Firestore 的**集合/路径/字段**——token 要写进同一个 doc，遵守单一数据源）、`src/js/firebase-auth.js`（登录态判断 `Farm.fbAuth.isLoggedIn()`、当前 uid）、`src/index.html`（firebase compat SDK 引入处）
- Create: `firebase-messaging-sw.js`（根路径）、`src/js/firebase-push.js`
- Modify: `src/index.html`（引入 `firebase-messaging-compat` SDK + `firebase-push.js`）、`data/i18n.json`

**行为规格：**
- 引入 `firebase-messaging-compat.js`（与现有 app/auth/firestore compat 同版本 CDN）。
- `firebase-messaging-sw.js`：FCM 要求的独立 SW（与 A1 的 service-worker.js 共存），处理后台消息显示 + 点击通知打开游戏落到农场页。
- `src/js/firebase-push.js`（`Farm.push`）：
  - `requestAndRegister()`：请求通知权限 → `getToken(messaging, { vapidKey })` → 写 Firestore 玩家 doc：`{ fcmTokens: [...去重], pushOptIn: true, lang, lastOpenedAt: <serverTimestamp/本地日> }`。
  - 每次启动（已授权时）静默刷新 token + 更新 `lastOpenedAt`。
  - 前台消息监听（`onMessage`）→ 用现有 toast 友好展示，不打断。
- **权限请求时机**：不要一进门就弹。在**首次成功收获后**触发一次温和请求（"开启提醒，菜熟了第一时间叫你？"）；被拒绝则不再问（记 localStorage）。
- 仅在已安装 PWA（standalone）+ 支持 messaging 时才尝试；不支持/未装则静默跳过，不报错。

**数据写入位置**：必须复用 `firebase-game-sync.js` 已有的玩家 doc（先读该文件确认路径，如 `members/{uid}` 下的游戏子字段或独立游戏集合）。**不要新开一个并行集合存 token**（单一数据源铁律）。未登录访客如何处理：若玩家 doc 依赖登录，则未登录时不注册推送（或用匿名/设备 id，按现有 sync 策略决定，先读代码再定）。

**Steps:**
- [ ] **Step 1: 读 firebase-game-sync.js + firebase-auth.js**，确认玩家 doc 路径、uid 来源、登录态判断、未登录策略。
- [ ] **Step 2: Firebase Console 生成 VAPID key**（Chris 操作或给指引），填入 firebase-push.js 配置。
- [ ] **Step 3: 写 `firebase-messaging-sw.js`**（后台消息 + 点击打开）。
- [ ] **Step 4: 写 `src/js/firebase-push.js`**（`Farm.push`），并在首次收获处接 `requestAndRegister()`。
- [ ] **Step 5: index.html 引入 messaging SDK + 脚本 + i18n**。
- [ ] **Step 6: 手动验证（真机装 PWA）**：
  - iPhone 从主屏幕图标打开 → 首次收获后弹权限请求 → 同意
  - Firebase Console / Firestore 看到玩家 doc 出现 `fcmTokens` + `pushOptIn:true` + `lastOpenedAt`
  - 用 Firebase Console「Cloud Messaging → 发送测试消息」对该 token 发一条 → 收到通知 → 点击落到农场
  - 拒绝权限的设备不再被反复打扰；未装 PWA 的不报错
- [ ] **Step 7: commit**：`git add firebase-messaging-sw.js src/js/firebase-push.js src/index.html data/i18n.json && git commit -m "feat(A2/前端): FCM通知权限+token注册写Firestore"`

---

## Task 5b: 每日定时推送函数（模块 A2 后端 — 另一个 repo）

**在 `D:/easternmarket.ca/EasternMarket_app` 这个 repo 里做，不是游戏 repo。先开分支。**

**Files:**
- Read first: `EasternMarket_app/functions/src/orderEmailNotifications.ts`（现有函数风格、Firebase Admin 初始化、部署目标项目 `eastern-market-members`）、`functions/package.json`（依赖、Node 版本、是否已有 firebase-admin messaging）、`functions/src/index.ts`（函数导出方式）
- Create: `EasternMarket_app/functions/src/dailyFarmReminder.ts`
- Modify: `functions/src/index.ts`（导出新函数）

**行为规格：**
- 一个 scheduled function（`onSchedule`，cron `0 1 * * *` UTC = 萨斯卡通 19:00，全年无 DST）：
  - 查询玩家 doc 集合中 `pushOptIn == true` 且 `lastOpenedAt` < 今日本地起点（UTC-6 当天 00:00）的玩家。
  - 排除连续未打开 ≥3 天者（`lastOpenedAt` 早于 3 天前 → 跳过，避免无效骚扰/被降权）。
  - 按玩家 `lang` 选双语文案；文案池放 Firestore 配置 doc（方便 Chris 后台改，类比店主台词池）：
    - 菜熟提醒 / 连签别断（带 streak）/ 节日限定（仅节日窗口）/ 1-in-5 纯陪伴非推销。
  - `admin.messaging().sendEachForMulticast()` 批量发；对返回 `messaging/registration-token-not-registered` 的 token 从玩家 doc 删除（清理失效 token）。
  - 日志输出发送数 / 跳过数 / 清理数，便于 Chris 用 Functions 日志核查。
- **绝不碰** `onOrderStatusChange` 或任何现有订单/邮件逻辑——新增独立函数。

**Steps:**
- [ ] **Step 1: 在 EasternMarket_app 开分支**（Chris 终端跑 `git checkout -b farm-push-202606`），读现有 functions 代码 + 确认 firebase-admin 已含 messaging。
- [ ] **Step 2: 写 `dailyFarmReminder.ts`**（scheduled + 查询 + 文案选择 + multicast + 失效 token 清理 + 日志），按现有函数风格。
- [ ] **Step 3: 在 `index.ts` 导出**新函数。
- [ ] **Step 4: 本地构建检查**：`cd functions && npm run build`（确认 TS 编译无错；不部署）。
- [ ] **Step 5: 部署（Chris 执行）**：`firebase deploy --only functions:dailyFarmReminder --project eastern-market-members`。
- [ ] **Step 6: 验证**：
  - 临时把 cron 改近一点或用 Cloud Scheduler 手动触发一次
  - 一个"昨天打开过、今天没打开、已授权"的测试账号 → 收到推送，点击落到农场
  - 当天已打开的账号 → 不收到
  - 连 3 天没开的账号 → 不收到
  - Functions 日志显示发送/跳过/清理数；现有订单邮件函数不受影响（下个订单状态变更仍正常发邮件）
- [ ] **Step 7: commit + 合并**（Chris）：分支 commit 后，按父 CLAUDE.md「合并回 main 之前」清单确认，再 push / 合 main；`gh run list --limit 1` 确认 Actions success。

---

## 自查（计划 vs 设计 spec 覆盖）

- A1 PWA → Task 4 ✅
- A2 推送（前端注册 + 后端定时）→ Task 5a + 5b ✅
- A3 → 明确不做（spec 已声明）✅
- B 7天签到 → Task 2 ✅
- C 菜熟倒计时 → Task 1 ✅
- D 高光时刻 → Task 3 ✅
- 默认值（19:00 / 每天1条 / 当天未开才推 / 连3天停推）→ Task 5b 行为规格 ✅
- iOS 三铁律（先装PWA / 云端定时 / 权限时机）→ Task 4 + 5a/5b ✅
- 跨两 repo + push 由 Chris → 执行约定 + Task 5b ✅
- 存档迁移安全 → Task 2 Step 2/6 ✅
- 双语 / 治愈系视觉 → 通用红线 ✅
- 仓库容量约束（一键收获）→ Task 1 行为规格 ✅

无占位符；字段名（`loginCalendar`/`fcmTokens`/`pushOptIn`/`lastOpenedAt`）跨任务一致。
