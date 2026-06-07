# 设计文档：每日打开率 / 留存增强包

> 日期：2026-06-07
> 项目：Eastern Farm 东方农场（farm.easternmarket.ca）
> 目标：让东方超市的客人**每天主动打开来玩**。

---

## 1. 背景与判断

### 1.1 现状（已经做得很足的部分）

线上版本已有丰富的**即时反馈和视觉奖励**：

- 收获：粒子爆汁 + 金币飘字 + 音效
- 升级：全屏彩带 + 数字滚动 + 微光 + emoji 爆发
- 每日登录：连续天数 + 倍数奖励弹窗
- 「今日」面板：每日新闻(+2积分)、今日特价种子(-50%)、每日大转盘(免费+付费)、邻居走访
- 任务 / 成就 / 图鉴收集 / 节日 / 邻居送礼 / 天气
- 新人引导：欢迎浮层、首种+10、首收彩纸、会员首登 3000 币

**结论**：场内"加更多彩带飘字"已接近边际饱和，继续堆会让治愈系画面变吵，收益低。

### 1.2 真正的瓶颈（本设计要补的空白）

代码核查结果：项目**接了 Firebase（`eastern-market-members`），但没有 PWA manifest、没有 Service Worker、没有任何推送/通知**。

→ **App 一关上，游戏就再也戳不到客人了。** 所有现有奖励只对"已打开的人"生效，对"忘了打开的人"零作用。这是对"每天打开"这个目标**最大且目前完全空白**的杠杆。

### 1.3 本轮范围（已与 Chris 确认 2026-06-07）

| 模块 | 做 | 说明 |
|---|---|---|
| **A1** PWA 可安装 | ✅ | manifest + service worker + iOS「添加到主屏幕」引导 |
| **A2** 每日定时推送 | ✅ | 云端定时 Cloud Function，每天傍晚给当天未打开者推一条 |
| **A3** 按菜成熟精准推送 | ❌ 本轮不做 | 成本高，看 A2 数据后下一期再评估 |
| **B** 7 天签到日历 | ✅ | 纯前端，递增奖励，第 7 天超大奖 + 全屏仪式 |
| **C** 菜熟预告 / 倒计时钩子 | ✅ | 纯前端，首页状态条 |
| **D** 场内爆汁（仅高光时刻） | ✅ | 纯前端，只补与"回归"绑定的庆祝，不堆通用彩带 |

---

## 2. 关键技术约束（必读，决定可行性）

### 2.1 iOS 网页推送三条铁律

客群和店主都用 iPhone，iOS Safari 的 Web Push 限制：

1. **必须先「添加到主屏幕」**（装成 PWA，iOS 16.4+）才允许推送。没装 = 发不出。
   → **A1 是 A2 的前提，必须先做、必须引导用户安装。**
2. **网页无法在关闭状态自行定时弹通知**（iOS 不支持本地定时通知 / Notification Triggers）。
   → 关闭状态戳人**必须靠云端按时发**（FCM + 定时 Cloud Function）。
3. 因此「每天傍晚提醒一次」便宜，「你那棵番茄此刻正好熟了」贵（要在云端逐棵菜计时 = A3，本轮不做）。

### 2.2 现成地基

- `src/js/firebase-init.js` 已有 `messagingSenderId: 515107029536` → FCM 地基现成。
- Firebase 项目 `eastern-market-members` 已有 Cloud Functions（订单邮件 `onOrderStatusChange`，在 `EasternMarket_app/functions`）→ 推送函数挂同一项目，复用部署管线。

### 2.3 跨两个 repo（重要）

| 改动 | 所在 repo | 部署方式 |
|---|---|---|
| PWA 文件、前端 FCM 注册、B/C/D 功能 | **eastern-farm**（GitHub Pages） | git push → GitHub Pages 自动上线 |
| 定时推送 Cloud Function | **EasternMarket_app/functions** | `firebase deploy --only functions:<name> --project eastern-market-members` |

→ 实现分两个阶段、两次部署。两个 repo 各自独立 commit，**push 由 Chris 亲手执行**。

### 2.4 时区简化

萨斯卡通全年 UTC-6、不调夏令时。「本地 19:00 = UTC 01:00」，定时函数只需一条 cron，无需逐玩家时区计算。

---

## 3. 模块设计

### A1 — 可安装 PWA

**目标**：游戏能「添加到主屏幕」，有独立图标、全屏启动、离线壳。

**组件**
- `manifest.webmanifest`（放游戏 repo 根或 src/，与页面同源）：
  - `name` / `short_name`：东方农场 / Eastern Farm
  - `display: standalone`、`theme_color` / `background_color` 用项目奶油底+品牌红
  - `icons`：192/512 png（maskable 各一份）。图标可复用游戏现有 logo 资产；若无则用一只笑脸番茄/上海青做主视觉
  - `start_url`：指向游戏入口（注意 GitHub Pages 子路径）
- `service-worker.js`：最小离线壳 + 缓存静态资源（app shell 缓存策略，数据文件走 network-first 避免吃旧数据）。
- iOS「添加到主屏幕」引导浮层：
  - 检测 `navigator.standalone === false` 且为 iOS Safari 且未安装时显示
  - 文案：教用户点「分享 → 添加到主屏幕」，配示意图
  - 一次性 + 「不再提示」，记 localStorage，**不骚扰**

**关键陷阱**
- iOS PWA 图标会被永久缓存：换图标后用户必须删 App 重装才看到新图标（见 memory `ios_pwa_icon_cache`）。首发就要把图标定稿。
- Service Worker 缓存要有版本号 + 更新策略，否则用户卡在旧版本。`fetch('../data/*.json')` 必须 network-first，别缓存死游戏数据。
- GitHub Pages 的 base path：manifest 的 `start_url`/`scope` 和 SW 的 `scope` 要和实际部署路径一致（自定义域 farm.easternmarket.ca 下应为根 `/`）。

**验收**
- iPhone Safari 打开 → 出现引导 → 添加到主屏幕 → 桌面有独立图标 → 点开全屏无地址栏 → 断网仍能打开游戏壳。

---

### A2 — 每日定时推送

**目标**：每天傍晚，给「今天还没打开游戏」的玩家推一条提醒，把人拉回来。

**默认值（后台可调，已替 Chris 定）**
- 推送时间：本地 19:00（= UTC 01:00）
- 频率：每人每天最多 1 条
- 受众：当天（本地日）未打开游戏的已安装用户
- 防骚扰：连续 3 天未打开就停止推送该用户（避免无效骚扰 / 被系统降权）
- 文案轮换（中英双语，跟随用户语言）：
  - 「🌾 你的菜熟了，回农场收一收吧」
  - 「🔥 连续登录第 N 天，今天别断了哦」
  - 「🎁 {节日}限定作物已上线，手慢就过季了」（仅节日窗口）
  - 1/5 概率发"纯陪伴型"非推销文案（延续店主 NPC 的温暖人设）

**数据流**
```
玩家打开游戏(已装PWA)
  → 请求通知权限 (Notification.requestPermission，时机：完成首次收获后再问，不要一进门就弹)
  → 拿到 FCM token (firebase-messaging getToken + VAPID key)
  → 写入 Firestore 玩家记录: { fcmTokens: [...], pushOptIn: true, lastOpenedAt, lang }
  → 每次打开更新 lastOpenedAt (本地日)

云端 Cloud Function (scheduled, cron "0 1 * * *" UTC)
  → 查询 pushOptIn==true 且 lastOpenedAt < 今日本地起点 的玩家
  → 排除连续未打开 ≥3 天者
  → 选文案(按 lang + 是否节日 + streak) → FCM sendMulticast
  → 清理失效 token (messaging 返回 NotRegistered 的删掉)
```

**组件**
- 前端（游戏 repo）：
  - 引入 `firebase-messaging-compat` SDK
  - `firebase-messaging-sw.js`（FCM 要求的独立 SW，处理后台消息点击 → 打开游戏）
  - `firebase-push.js`（新模块）：注册权限、取 token、写 Firestore、监听前台消息
  - 权限请求时机：**首次成功收获后**触发一次温和的请求（"开启提醒，菜熟了第一时间叫你"），拒绝就不再问
- 后端（EasternMarket_app/functions）：
  - 新增 scheduled function（如 `dailyFarmReminder`），`onSchedule('0 1 * * *')`
  - 复用现有 functions 部署管线
  - 文案表可放 Firestore 配置 doc，方便 Chris 后台改（与现有"店主台词池"思路一致）

**玩家记录存哪**：复用 `firebase-game-sync.js` 已有的玩家存档路径（实现时先读该文件确认集合/字段，token/pushOptIn/lastOpenedAt 加在同一 doc 下，遵守单一数据源铁律）。

**关键陷阱**
- iOS 必须装成 PWA 后、且从主屏幕图标打开时，权限请求才有效。引导文案要说清这个顺序。
- VAPID key 要在 Firebase Console → Cloud Messaging → Web Push certificates 生成并填入前端。
- 权限只能请求一次，被拒绝后浏览器不再弹 → 时机选在"用户已尝到甜头(首收)"后，转化率最高。
- token 会过期/换设备 → 函数发送失败要清理，前端每次启动刷新 token。

**验收**
- 真机装 PWA → 授权 → Firestore 看到 token 与 pushOptIn。
- 手动触发函数（或临时改 cron）→ 未打开的测试账号收到推送 → 点推送打开游戏落到农场页。
- 当天已打开的账号**不**收到推送。

---

### B — 7 天签到日历（纯前端）

**目标**：把"明天还要来"变成看得见、舍不得断的进度。

**设计**
- 7 格横向日历，标记已签/今日可签/未来。
- 递增奖励：第 1–6 天给金币/种子/少量积分阶梯递增，**第 7 天开超大奖**（大额积分 / 稀有种子 / 装饰）+ **全屏仪式动画**（复用现有升级彩带体系，做到比平时更隆重）。
- 断签处理：错过一天则进度**重置回第 1 天**（这是"舍不得断"的张力来源；但文案要温和，不指责）。
- 与现有"每日登录倍数"的关系：本日历是**视觉化、有终点奖励**的升级版，二者合并为一套，避免两套登录奖励并存（遵守单一数据源 / 统一模板铁律——实现时先看现有 `checkDailyLogin` 再决定合并方式）。
- 入口：进游戏自动弹一次（当天未签到时），或「今日」面板内常驻一张卡。

**数据**：state 增加 `loginCalendar: { cycleStartDate, lastSignDate, dayIndex }`，跨设备随存档同步。

**验收**：连签 7 天逐格点亮 → 第 7 天触发全屏大奖 → 第 8 天进入新一轮；中断一天后回到第 1 天。

---

### C — 菜熟预告 / 倒计时钩子（纯前端）

**目标**：给一个明确的"几点回来"理由，与 A2 推送互补。

**设计**
- 首页顶部（HUD 下方）一条状态条：
  - 有已熟："🌾 2 棵已熟可收" + 一键「全部收获」按钮
  - 全在长："⏳ 下一批 1 小时 23 分后成熟"（取最近一棵的剩余时间，每秒/每分刷新）
  - 全空："🌱 地都空着，种点什么吧"
- 收获后状态条即时更新（接现有 farm tick）。
- 文案双语，风格延续治愈系，不施压。

**数据**：纯读现有 `plots` 状态计算，无新存档字段。

**验收**：种下后显示倒计时 → 成熟后变"X 棵已熟可收" → 点一键收获后归零并更新到下一批。

---

### D — 场内爆汁（仅高光时刻，纯前端）

**原则**：不堆通用彩带，只补**与"回归/里程碑"绑定**的庆祝，强化"今天来对了"。

**做**
- **连击收获**：连续快速收获多棵时，飘字递进（连击数 / 渐强音效），一次性多棵收获给"丰收"小高潮。
- **7 天签到第 7 天**：B 的全屏仪式（见上）。
- **图鉴/成就完成**：解锁新作物或达成成就时，做一次仪式动画（现在多为 toast，升级为有"完成感"的庆祝）。

**不做**
- 不给每次普通收获加更多彩带（已饱和）。
- 不引入高饱和霓虹 / 闪烁（违背 CLAUDE.md 治愈系视觉方向）。

**验收**：快速连收触发连击视觉 → 解锁新图鉴条目触发完成动画 → 普通单棵收获维持现状不变吵。

---

## 4. 实施顺序与风险

建议顺序（先纯前端见效，后端最后压轴）：

1. **C 菜熟倒计时** — 最小、纯读现状、零存档改动，立刻见效。
2. **B 7 天签到日历** — 纯前端 + 小存档字段，需谨慎合并现有登录奖励。
3. **D 高光时刻** — 纯前端动画，复用现有彩带体系。
4. **A1 PWA** — 静态文件，独立可测；图标首发要定稿（iOS 缓存陷阱）。
5. **A2 推送** — 跨 repo、动后端，最后做；分前端注册 + 后端定时函数两步，各自验收。

**风险点**
- A2 跨 `eastern-market-members` 生产项目部署 Functions：必须走分支隔离 + 不碰现有 `onOrderStatusChange`，新增独立函数，遵守父 CLAUDE.md「UI 改造工作流」四道保险与部署铁律。
- B 合并现有登录奖励：改动 `state` + `checkDailyLogin`，属"存档是神圣的"高危区，必须写存档迁移、不得清空老玩家进度。
- A1 SW 缓存：数据文件 network-first，别把玩家卡在旧版本。

---

## 5. 验收总览（Definition of Done）

- [ ] iPhone 真机可「添加到主屏幕」，独立图标 + 全屏 + 断网开壳。
- [ ] 首次收获后弹通知授权；授权后 Firestore 有 token/pushOptIn/lastOpenedAt。
- [ ] 定时函数：未打开账号收到推送、已打开账号不收到、连 3 天未开停推。
- [ ] 7 天签到逐格点亮，第 7 天全屏大奖，断签重置，老存档不丢。
- [ ] 首页倒计时/已熟状态条实时准确，一键收获可用。
- [ ] 连击收获 + 图鉴完成有高光动画；普通收获不变吵。
- [ ] 中英双语全覆盖；iPhone 上无控制台报错。
- [ ] 两个 repo 各自 push 由 Chris 执行；Functions 部署后 `gh run`/日志确认成功。
