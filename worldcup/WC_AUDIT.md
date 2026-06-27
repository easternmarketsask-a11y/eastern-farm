# WC_AUDIT.md — 世界杯观赛台 Phase 1 实现说明

> Phase 1 = **纯前端、只读** 观赛台(三标签 + 趣味钩子)+ 登录页入口。
> 竞猜 / 后端轮询 / 结算闸门(见 `WORLDCUP_VIEWING_HUB.md` 大规格)**本期不做**。

## STEP 0 代码库探查结果

| 项目 | 结论 |
|---|---|
| 前端框架 | 原生 JS,无 build。每个 `src/js/*.js` 挂到 `window.Farm` 命名空间,`<script>` 按依赖顺序加载。 |
| 视觉 token | `src/css/style.css` `:root`:`--cream-bg #fdf8ee` / `--leaf-green #6ab04c` / `--leaf-dark #3a7d2c` / `--mature-glow #f7c948` / `--barn-red #c44536` / `--kawaii-amber #FFC107`;字体 `--font-display`(ZCOOL KuaiLe + Fredoka)、`--font-zh`、`--font-en`;圆角 `--radius-sm/md/lg/pill`;`--shadow-card`。**观赛台全部复用这些,不用原型暗色主题。** |
| 弹窗 / overlay | `Farm.ui.showModal(html)` / `hideModal()` 是居中弹窗。大场景(mapview)用 `position:fixed` 全屏 overlay + body class。观赛台用后者(`#wc-hub`)。 |
| 登录页 | `index.html` 的 `#splash` overlay。`main.js` `wireSplash()` 绑定 `#splashStart`(逛逛)/`#splashLogin`(登录)。世界杯入口加在这里。 |
| 数据落盘 | 配置在 repo 根 `data/*.json`,页面从 `/src/` 用相对 `../data/` fetch;`service-worker.js` 对 `/data/` 走 network-first。世界杯数据 → `data/wc2026.json`。 |
| 玩家档 / 农场币 | Phase 1 只读,不碰农场币、不碰东方积分。"我的球队"等个人偏好存 `localStorage`(key `wc2026_prefs_v1`),不写玩家云档,保证可整体移除。 |

## 数据现实(重要)

`wc2026.seed.json` 的 `matches[]` 只有揭幕战 + 第3轮 + 淘汰赛空壳,**缺第1、2轮**。原型把累计积分写死在 JS。因此:

- `data/wc2026.json` 在 schema 基础上**新增 `groupStats`**(每队累计 P/W/D/L/GF/GA + status),来自原型权威表(截至 6/26)。
- 积分榜的 P/W/D/L/GF/GA 读 `groupStats`;**Pts/GD 自动算**;tiebreaker 链照 `docs/TIEBREAKER_REFERENCE.md`,正面交锋用 `matches[]` 里存在的对阵(主要是第3轮)能算则算,算不了标"待 h2h"。
- 赛程页列 `matches[]` 现有真实比赛 + 淘汰赛空壳。**不编造缺失赛果**(守 "officialScore 是人工真相" 铁律)。Chris 往 JSON 补比赛 / scorers,页面自动呈现。

## 实时数据(2026-06-27 改用 ESPN 真实数据源)

> ⚠️ 历史:最初(06-26)接的 **worldcup26.ir** 实为社区**模拟/预测数据集**(虚构赛果、
> 固定日期、波斯历、有一场永久卡在 in-play),不是真实赛事 → 已弃用。

现在前端打开观赛台 + 每 60s 从 **ESPN 公开足球 API** 拉真实数据:
- 端点:`site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD-YYYYMMDD`
  - **真实赛果/赛程/射手**,免费、**无需 key**、`Access-Control-Allow-Origin: *`(纯前端可直拉)。
  - 球队 `abbreviation` 与我们的 code **完全一致**;每队还自带真实国旗图(`espncdn.com/.../{code}.png`)。
  - 两个日期区间(小组赛 `20260611-20260627` + 淘汰赛 `20260628-20260720`)绕开单响应 ~100 事件上限。
- **赛程**:小组赛按 `home|away` code 配对,用实时比分/状态/射手覆盖静态。KO 用静态(已是 ESPN 真实数据)。
- **积分榜**:从实时**全部 72 场小组赛** `rankGroupPure` 重算,覆盖静态 groupStats。
- **失败兜底**:任一 fetch 失败 → `live=null` → 回退静态(静态本身也是 ESPN 生成的真实数据),绝不白屏。
- **标注**:顶部「⚡ 实时比分 · 更新于 HH:MM 萨省 · 来源 ESPN · 60秒自动刷新」。
- **真实时钟闸门**:`matchState` 只在当前萨省时间落入开球窗口时才显示「正在进行」(防模拟源/卡死状态造成的假 LIVE)。

### 重建静态数据(`data/wc2026.json`)
`node worldcup/tools/gen_wc2026_from_espn.js data/wc2026.json /tmp/out.json` 然后用 out.json 覆盖。
从 ESPN 拉真实赛程/比分/小组/射手,复用现有中文名,生成完整 104 场 + 12 组。
静态文件是「快照 + 兜底」;线上靠 60s 实时刷新保持最新。建议每天重跑一次刷新快照。

## 文件清单(本期新增)

| 文件 | 作用 | 性质 |
|---|---|---|
| `data/wc2026.json` | 唯一数据源(seed + groupStats) | 新增 |
| `src/js/worldcup.js` | 观赛台全部逻辑(`Farm.worldcup`,含 `WC_STANDALONE` 独立模式) | 新增 |
| `src/css/worldcup.css` | `.wc-*` scoped 样式(农场 token) | 新增 |
| `src/worldcup.html` | 独立分享页(`/src/worldcup.html`,自动全屏打开观赛台) | 新增 |
| `worldcup.html`(repo 根) | 短链重定向 → `src/worldcup.html`(`farm.easternmarket.ca/worldcup.html`) | 新增 |
| `src/index.html` | +1 `<link>` +1 `<script>` + `#splash` 入口块 | 改(纯加法) |
| `src/assets/images/wc2026-logo.png` | 官方世界杯徽标(登录页 + 顶栏 + 独立页) | 新增 |

## 7 月底整体移除步骤

1. 删 `src/js/worldcup.js`、`src/css/worldcup.css`、`data/wc2026.json`
2. `index.html`:删 `worldcup.css` 的 `<link>`、`worldcup.js` 的 `<script>`、`#splash` 内 `id="splashWorldcup"` 整块(以 `<!-- WC2026 START -->` / `<!-- WC2026 END -->` 注释标界)
3. `main.js`:删 `wireSplash` 里 `// WC2026` 注释那一行
4. （可选)`worldcup/` 整个目录可留作存档或删除

移除后农场游戏完全恢复原状,无残留。
