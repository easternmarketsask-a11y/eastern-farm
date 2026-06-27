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

## 文件清单(本期新增)

| 文件 | 作用 | 性质 |
|---|---|---|
| `data/wc2026.json` | 唯一数据源(seed + groupStats) | 新增 |
| `src/js/worldcup.js` | 观赛台全部逻辑(`Farm.worldcup`) | 新增 |
| `src/css/worldcup.css` | `.wc-*` scoped 样式(农场 token) | 新增 |
| `src/index.html` | +1 `<link>` +1 `<script>` + `#splash` 入口块 | 改(纯加法) |
| `src/js/main.js` | wireSplash 里 +1 行绑定入口 | 改(纯加法) |

## 7 月底整体移除步骤

1. 删 `src/js/worldcup.js`、`src/css/worldcup.css`、`data/wc2026.json`
2. `index.html`:删 `worldcup.css` 的 `<link>`、`worldcup.js` 的 `<script>`、`#splash` 内 `id="splashWorldcup"` 整块(以 `<!-- WC2026 START -->` / `<!-- WC2026 END -->` 注释标界)
3. `main.js`:删 `wireSplash` 里 `// WC2026` 注释那一行
4. （可选)`worldcup/` 整个目录可留作存档或删除

移除后农场游戏完全恢复原状,无残留。
