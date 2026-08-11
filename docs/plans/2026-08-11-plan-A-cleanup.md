# 方案 A · 地基收拾（2026-08-11）

Chris 在 8-11 全面审核后拍板做 A：**清世界杯代码 · 三渲染器收成一套 · 修首屏构图**。
目标不是加功能，是把地基收干净，为 9/19–9/29 中秋引流测试（方案 B）做准备。

## 红线（沿用 07-07 审计那份）

- ❌ 东方点经济一律不动（真负债）
- ❌ 不新增外部依赖 / CDN
- ❌ **存档神圣**：`farmStyle` 字段保留，只做「值收敛」，绝不静默重置别的字段
- ❌ 不动 POS / StockWise 写路径
- ❌ `worldcup.html` 独立回顾页 + `/redeem/` 核销页**保持可用**（只从主游戏里摘除，不删页面）
- 每批 `node --check` + CDP 冒烟通过才 commit；三批做完一次性 `deploy.sh`

## 开工前实测基线（2026-08-11，生产 `ef-2608110939`）

| 项 | 现状 |
|---|---|
| 主游戏加载的世界杯资源 | `worldcup.css` + `worldcup.js` + `wc2026.json`（本地 254KB / 线上压缩 58KB） |
| 云存档 `farmStyle` 分布 | **6/6 全是 `iso`** —— 没有任何玩家选过 topdown/classic |
| 竖屏 390×844 首屏 | zoom 2.294 · 地块块 314×159px · 占屏宽 **80.5%** / 屏高 **18.8%** · 上方空白 **43.9%** / 下方 37.2% |
| 竖屏 360×640 首屏 | zoom 2.118 · 290×147px · 占屏宽 80.5% / 屏高 22.9% · 上方空白 39.8% |

首屏构图的**真实根因**（不是「zoom 不够大」）：
1. 2:1 等距下，地块块屏高 ≈ 屏宽的一半 —— 宽已占 80%，高必然只有 19%，**再放大也填不满竖屏**。
2. 背景 `hd_bg.png`（1248×832，天空/远山/树线/草甸碗/前景草）是**世界锁定**的：
   焦点 `BG_FY=0.66`（草甸碗）钉在农场中心。当前 zoom 2.29 下 `dh≈2596px`，
   竖屏只能看到图片 **y≈0.51–0.81** 那一段 —— 正好是最平的草甸带，
   **天空和树线全在屏外**。所以上方那 44% 不是「空」，是背景图最没内容的一块被放大铺满。

结论：构图要靠**降 zoom 让树线/远山进画** + **把农场压到画面下半**，而不是继续放大农场。
约束：地块屏宽不得低于可点性底线（现 `minTap` 53px）。

## 批次

### 批 1 — 清世界杯代码（只动主游戏，不删页面）
- `src/index.html`：删三段 `<!-- WC2026 START … END -->`（css link / splash 按钮 / lazy-loader IIFE）
- `service-worker.js`：PRECACHE 去掉 `worldcup.css` / `worldcup.js` / `wc2026.json`；
  **保留 `/src/worldcup.html`**（回顾页要能离线打开就留着，它自己会拉 js）
- `src/js/main.js` 等：清掉 `__loadWorldcup` / `Farm.worldcup` 的调用点（若有）
- 保留：`worldcup.html`、`js/worldcup.js`、`css/worldcup.css`、`data/wc2026.json`、`/redeem/`
- 验收：主游戏 CDP 实测 **不再请求任何 worldcup 资源**；`worldcup.html` 仍能打开

### 批 2 — 三渲染器收成一套（iso 唯一）
- `src/js/state.js`：`farmStyle()` 恒返回 `'iso'`（保留字段，做值收敛 + 一次性把
  存档里的 `topdown`/`classic` 改写成 `iso`）；去掉 `?topdown=1&map=1&classic=1` URL 分支
- `src/js/guide.js`：删「🎨 农场画风」三选一（保留 🐾 走动小动物开关）
- `src/index.html` + `service-worker.js`：删 `js/mapview.js`（971 行 / 48KB）
- 删文件 `src/js/mapview.js`；清 `Farm.mapView` 的残余引用（guide.js / main.js / spotlight.js）
- 验收：CDP 实测不再请求 mapview.js；旧存档带 `farmStyle:'topdown'` 时能正常进 iso

### 批 3 — 修首屏构图（竖屏）
- 在 `_autoFrame` 的竖屏分支加**背景构图约束**：让背景图的树线（约 `BG_FY-0.24`）
  落到视口顶部，农场块中心压到屏高 ~62%，同时守住 `minTap`
- 用 390×844 / 360×640 / 428×926 三档截图人审，量化指标：
  **上方空白 < 30%**、地块屏宽 ≥ 62px、农场块可见且不贴底
- 横屏 / 桌面分支不动

## 进度

- [ ] 批 1 清世界杯代码
- [ ] 批 2 三渲染器收成一套
- [ ] 批 3 首屏构图
- [ ] deploy.sh + 生产实测 + 报告
