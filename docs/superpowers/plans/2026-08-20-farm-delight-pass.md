# 农场见到都喜欢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Visual work stays in this session — screenshot after each wave.

**Goal:** 进场画面和面板达到开屏油画同一档：人、光、土、HUD、弹窗不再各画各的。

**Architecture:** 不换世界（`USE_PAINTED_BG=false`）。程序化草地/苗床在 `mapview-iso.js` 改；人物预览切帧以 `farmer.js` 的 6×5 表为唯一规格；面板只改 HTML/CSS 和文案，不改经济。

**Tech Stack:** vanilla JS，canvas iso，CSS tokens in `style.css`。

**Spec:** `docs/superpowers/specs/2026-08-20-farm-delight-pass-design.md`

## Global Constraints

- `USE_PAINTED_BG=false`
- 不搬 `landOrigin` / `map` / `plots` / `clearedCells`
- 不改东点与一级 4 块田
- 镜头不拉近（农场在草甸里偏小是锁定）
- 不 push / 不部署
- 文案完整句，不卖萌
- 改 JS 后 `node --check`；验收靠 390×844 截图

## Files

| File | Role |
|---|---|
| `src/js/farmer.js` | 导出 6×5 预览样式，供设置/小东头像共用 |
| `src/js/main.js` | 农户九宫格走预览样式；菜单去掉商店/任务 |
| `src/js/mapview-iso.js` | 草地棋盘、空床土色、黄昏光 |
| `src/css/style.css` | toast 避弹窗、九宫格、商店页签、谷仓空态、HUD 玻璃 |
| `src/index.html` | 小东头像改油画店员 |
| `src/js/warehouse.js` | 空态谷仓图 |
| `src/js/neighbors.js` | 空态去掉立体 emoji |
| `src/js/tutorial.js` | 步骤图标不用立体 emoji |
| `scripts/verify/farmer-look-test.mjs` | 钉死 6×5 预览 |

---

### Task 1: 切帧规格 + 九宫格

精灵表是 6 列 5 行。设置页写成了 `600% 400%`，第五行从格子底下露出来。

- [ ] `farmer.js` 导出 `previewStyle(look)`：`background-size: 600% 500%`，idle 行 `0 0`
- [ ] 测试断言 `previewStyle(2)` 含 `600%` 和 `500%`
- [ ] `main.js` 九宫格用这个函数，不再手写 400%
- [ ] CSS `.farmer-look-face` 固定 44×52，九格一屏能看完

### Task 2: 成就条不再盖标题

- [ ] `body.modal-open .toast-stack` 改贴底部
- [ ] `body.modal-open .confetti-layer` 隐藏

### Task 3: 草地 / 空床 / 光

- [ ] 已拥有草甸和镜头前围裙：棋盘 stripe 为 0，菱形椭圆 alpha ≤ 0.10
- [ ] 空床垄土改深棕，木沿变窄（土菱形 ≥ 框的 0.86）
- [ ] 黄昏光略加强，作物不明显发黄

### Task 4: 小东头像

- [ ] `#storekeeper .storekeeper-avatar` 用 look 9 精灵 idle 帧，圆裁
- [ ] 点击行为不变

### Task 5: HUD 玻璃

- [ ] 可收条、顶栏背景更透明，功能按钮都在

### Task 6: 面板

- [ ] 商店页签 `grid 4 列`
- [ ] 谷仓空态用 `warehouse-barn.webp`
- [ ] 汉堡菜单去掉商店、任务
- [ ] 邻居空态用农户剪影，不用 🌱🏘️
- [ ] 教程三步用 CSS 图标，不用立体 emoji

### Task 7: 截图验收

- [ ] `promo/_audit/delight-farm.png` 390×844
- [ ] `promo/_audit/delight-shop.png` 标题为「商店」
- [ ] `promo/_audit/delight-settings.png` 九格无双头
- [ ] `promo/_audit/delight-wh.png` 空态有谷仓
- [ ] `node --check` 改过的 JS
