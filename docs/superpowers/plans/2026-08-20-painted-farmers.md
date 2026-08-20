# 油画农户九款 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Art uses Imagine `image_gen` / `image_to_video` / `image_edit` on the parent session — do not dispatch this plan to a subagent that lacks those tools.

**Goal:** 农场上出现 9 款油画小人，会走、会浇水、会收获、会在菜摊前站着。

**Architecture:** 新模块 `src/js/farmer.js` 管人设表、look 哈希、内存演员状态机、精灵表切帧。`mapview-iso.js` 只负责画和点选挂钩。浇水/收获仍走现有 `tending.waterPlot` / `farm.harvestPlot`，成功后再叫 `Farm.farmer.play(plotIdx, 'water'|'harvest')`。贴图按需加载，不进 SW 预缓存。

**Tech Stack:** vanilla JS；canvas iso；WebP 精灵表；PIL 抠底拼表。

**Spec:** `docs/superpowers/specs/2026-08-20-painted-farmers-design.md`

## Global Constraints

- `USE_PAINTED_BG=false`
- 不搬 `landOrigin` / `map` / `plots` / `clearedCells`
- 不造假名、不上照片、不恢复乡路行人
- 浇水/收获数值立刻生效；人随后演戏
- 新号默认 `farmerLook=2`；匿名路人 look=1
- 贴图不进 `service-worker.js` 的 PRECACHE（只把新 JS 模块加进去）
- 文案完整句，不卖萌
- 手机 360px 能认出动作

## Files

| File | Role |
|---|---|
| `src/js/farmer.js` | 新建。目录、哈希、演员、切帧 |
| `src/js/state.js` | `farmerLook` 缺省 |
| `src/js/firebase-game-sync.js` | payload 带 `farmerLook` |
| `src/js/main.js` | 设置九宫格 |
| `src/js/farm.js` / `tending.js` | 成功收获/浇水后通知 farmer |
| `src/js/stall.js` | 客人带 look |
| `src/js/mapview-iso.js` | 每帧 tick + 画人，替换摊前色块 |
| `src/index.html` | `<script defer src="js/farmer.js">` 放在 mapview-iso 之前 |
| `service-worker.js` | PRECACHE 加 `/src/js/farmer.js` |
| `src/assets/images/farmers/p_farmer_1.webp` … `_9.webp` | 精灵表 |
| `scripts/_sheet_farmers.py` | 抠底拼表 |
| `scripts/verify/farmer-look-test.mjs` | 哈希契约 |

---

### Task 1: 人设表 + 哈希（无贴图也能测）

**Files:**
- Create: `src/js/farmer.js`
- Create: `scripts/verify/farmer-look-test.mjs`
- Modify: `src/index.html`（在 `mapview-iso.js` 前插入 farmer.js）
- Modify: `service-worker.js` PRECACHE 数组，在 `mapview-iso.js` 那一行旁加 `'/src/js/farmer.js'`

**Produces:**
- `Farm.farmer.LOOKS` 长度 9，id 1–9
- `Farm.farmer.clampLook(n) → 1–9`，缺省 2
- `Farm.farmer.lookFromUid(uid) → 1–9`，无 uid → 1
- `Farm.farmer.lookOf(obj)`：合法 farmerLook 优先，否则 uid 哈希

- [ ] **Step 1: 写 `scripts/verify/farmer-look-test.mjs`**

哈希必须与 spec 一致。把算法写在测试里，实现必须得到同一组固定答案：

```js
import assert from 'node:assert/strict';

function lookFromUid(uid) {
  if (!uid) return 1;
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return (h % 9) + 1;
}
function clampLook(n) {
  const x = n | 0;
  return (x >= 1 && x <= 9) ? x : 2;
}
assert.equal(lookFromUid(null), 1);
assert.equal(lookFromUid(''), 1);
assert.equal(lookFromUid('abc'), lookFromUid('abc'));
const a = lookFromUid('abc');
assert.ok(a >= 1 && a <= 9);
assert.equal(clampLook(0), 2);
assert.equal(clampLook(9), 9);
assert.equal(clampLook(99), 2);
assert.equal(clampLook(2), 2);
console.log('ok', 'abc→', a);
```

记下 `abc→` 的数字，实现必须返回同一个。

- [ ] **Step 2: 跑测试确认文件能跑**

```
node scripts/verify/farmer-look-test.mjs
```

Expected: `ok abc→ N`

- [ ] **Step 3: 写 `src/js/farmer.js` 最小骨架**

IIFE，挂 `Farm.farmer`。`LOOKS` 九条（zh/en 与 spec 表一致）。`lookFromUid` / `clampLook` 与测试同一算法。`COLS=6, ROWS=4`，`ANIMS={ idle:0, walk:1, water:2, harvest:3 }`。`tick`/`draw`/`play` 先空实现（后面任务填）。

- [ ] **Step 4: 把同一组 assert 对着 `Farm.farmer` 再写进测试**（用 `fs.readFileSync` 抽函数会脆；保持测试文件里的纯函数与 farmer.js **逐字相同**，并在 farmer.js 顶部注释「哈希契约：scripts/verify/farmer-look-test.mjs」）。

- [ ] **Step 5: `node --check src/js/farmer.js` 以及 `node scripts/verify/precache-check.mjs`**

Expected: 语法过；预缓存清单覆盖 farmer.js（html + sw 都要改）。

- [ ] **Step 6: Commit**

```
git add src/js/farmer.js src/index.html service-worker.js scripts/verify/farmer-look-test.mjs
git commit -m "农户模块：九款目录和 look 哈希"
```

---

### Task 2: 存档 + 云同步

**Files:**
- Modify: `src/js/state.js` `STARTER_STATE` 加 `farmerLook: 2`
- Modify: `src/js/firebase-game-sync.js` `_buildPayload` 加 `farmerLook: Farm.farmer.clampLook(s.farmerLook)`

- [ ] **Step 1: STARTER_STATE 加字段**（不升 version）。`load` 的 Object.assign 会给老档补上；再在 migrate 附近加一行消毒：`this.data.farmerLook = Farm.farmer ? Farm.farmer.clampLook(this.data.farmerLook) : 2;` 若 farmer.js 尚未 init，先存原值，iso 启动时再 clamp。

- [ ] **Step 2: payload 带整数 1–9。** 不要放进会被 strip 的 PII 名单（它本来就不该被删）。

- [ ] **Step 3: `node --check` 两个文件。Commit。**

```
git commit -m "存档和公开档案增加 farmerLook"
```

---

### Task 3: 设置九宫格

**Files:**
- Modify: `src/js/main.js` 「农场显示」卡片内，宠物开关下方加九宫格

**Copy (锁死):**
- 中文标题：农户形象
- 中文说明：这是你在农场里走动的样子。
- English title: Farm look
- English hint: This is how you look on the farm.

- [ ] **Step 1: 九个 button，3 列 grid。** 每格一张 `assets/images/farmers/p_farmer_{id}.webp` 的 idle 第 0 帧（可用 `background-position`）。没图时格上只显示中文名，不要破图大红叉（`onerror` 藏 img、留文字）。

- [ ] **Step 2: click → `Farm.state.data.farmerLook = id; Farm.state.save();` 若 `Farm.farmer.applyLook` 存在则立刻换场上的人。当前选中格描边 `var(--leaf-dark)`。**

- [ ] **Step 3: 不弹 toast 以外的向导。Commit。**

```
git commit -m "设置里九宫格选农户形象"
```

---

### Task 4: 九张精灵表（形象是否生动卡在这一档）

**Files:**
- Create: `src/assets/images/farmers/p_farmer_{1-9}.webp`
- Create: `scripts/_sheet_farmers.py`（抠透明底 + 拼 4×6 表）
- Create: `scripts/_key_farmer_bg.py`（边缘洪水填充，tol 与汽车脚本同类，禁止按亮度全局抠，以免黑发/绿围裙被抠穿）

**Pipeline per look id:**
1. `image_gen` 站立 ¾ 侧面，全身，平涂单色可抠底（#11cc55 或纯灰），无草地无长影。风格词锁死：`cozy painted isometric farm character, Eastern Market warm gouache, Hay Day proportions, 3/4 view facing camera-right, full body, feet planted, isolated on flat #2d2d2d studio, no ground shadow, no grass oval`.
2. 儿童 id 5–6 明确 `child proportions, about three-quarters adult height, larger head`.
3. `image_to_video` 三段：原地走路（相机锁死）、原地浇水、原地摘菜。各 6 秒。
4. `ffmpeg -i clip.mp4 -vf fps=12` 抽帧，挑 6 帧能循环的。
5. 洪水抠底，脚对齐，拼进 768×640 表（6×128 宽，4×160 高）。
6. 用 Python 把表叠到 `#7eaa3d` 上存 `D:\tmp\farmer{id}-on-grass.jpg`，肉眼确认无黑方块。

- [ ] **Step 1: 先出 id 2（默认女农户）完整四行动作表，叠草地验收。** 通了再复制流程到其余 8 款。不要 9 张并行以免 429。

- [ ] **Step 2: 九张并排接触页（只 idle 第 0 帧）。** 不看标签也要能分成九个不同的人；5、6 明显矮。

- [ ] **Step 3: 任意一张四角 `alpha==0`。** Commit 资产（不要把 `D:\tmp` 合成图提交）。

```
git add src/assets/images/farmers scripts/_sheet_farmers.py scripts/_key_farmer_bg.py
git commit -m "九款农户精灵表（走浇摘站）"
```

---

### Task 5: 场上的人（tick + draw）

**Files:**
- Modify: `src/js/farmer.js` 填 `spawn` / `tick` / `play` / `draw`
- Modify: `src/js/mapview-iso.js` `render()` 深度排序里画农户；`_startLoop` 已有，farmer.tick(dt) 挂在 render 开头

**Produces:**
- `Farm.farmer.play(plotIdx, 'water'|'harvest')` 把 task 设成该地块
- 闲逛：随机可走格，走过去，idle 2–4 秒
- `_cellFreeForFarmer(gx,gy)`：owned，不是菜地，不是建筑，不是水

- [ ] **Step 1: `draw(ctx, iso)`** 用 iso._cell 把 gx,gy 转屏坐标，脚对准格子中心偏下，`_shadow` 然后 blit 当前帧。朝左 `ctx.scale(-1,1)`。缺图走 `_drawVillager`。

- [ ] **Step 2: 深度。** 把 farmer 推进 `draws` 列表，key = gx+gy，与建筑/菜同一排序。

- [ ] **Step 3: 点击不测 farmer。** 现有 `_tapCell` 顺序不动。

- [ ] **Step 4: 无头截图 `_shot_keyart.js` 一类脚本，确认人站在草上、无黑底。Commit。**

```
git commit -m "农户出现在农场上，闲时走走停停"
```

---

### Task 6: 挂钩浇水 / 收获

**Files:**
- Modify: `src/js/farm.js` `harvestPlot` 在 `result.ok` 之后 `Farm.farmer.play(plotIdx, 'harvest')`
- Modify: `src/js/tending.js` `waterPlot` 在 `r.ok` 之后 `Farm.farmer.play(plotIdx, 'water')`
- 拜访路径 `_visitPlotTap` **不要** 调 `Farm.farmer.play`

- [ ] **Step 1: 仓满失败不 play。**
- [ ] **Step 2: play 只改内存 task；连点覆盖 task（last-write-wins）。**
- [ ] **Step 3: 截图或肉眼：点熟菜人走过去摘；打理浇水人走过去浇。Commit。**

```
git commit -m "浇水和收获成功后农户演戏"
```

---

### Task 7: 菜摊客人 + 拜访主人

**Files:**
- Modify: `src/js/stall.js` `_loadPool` map 里抄 `farmerLook`：`look: Farm.farmer.lookOf({ farmerLook: (m.doc && m.doc.gameStats && m.doc.gameStats.farmerLook), uid: m.uid })`。`_spawn` 把 `look` 写入 customer。匿名不写 uid，look=1。
- Modify: `src/js/mapview-iso.js` 摊前 `_drawVillager` 改为 `Farm.farmer.drawStallGuest(ctx, iso, customer, x, y)`（idle，bob 可保留）。
- Modify: visit enter：`Farm.farmer.setVisitLook(hostLook)`；exit 恢复本地 `farmerLook`。禁止 visit 期间 save 已有 `_visitLock`。

- [ ] **Step 1: 匿名客人 look=1。**
- [ ] **Step 2: 拜访进/出 look 不污染本地存档。**
- [ ] **Step 3: Commit。**

```
git commit -m "菜摊和拜访用油画人，不改访客存档"
```

---

### Task 8: 验收清单（对照 spec）

- [ ] 自己农场油画人；闲逛不踩菜/房
- [ ] 熟菜立刻进仓 + 人去摘；连点只去最后一块；仓满不去
- [ ] 浇水立刻缩短 + 人去浇；已浇/已熟不演浇水
- [ ] 九宫格换款，刷新还在
- [ ] 摊前油画人 + 原气泡
- [ ] 拜访是那家形象；回来自己的没变
- [ ] 草地合成无黑底；儿童更矮
- [ ] 老档摊仓田坐标不变（抽一张老号 `landOrigin=back` 对照）
- [ ] `node --check src/js/*.js`；`node scripts/verify/farmer-look-test.mjs`；`node scripts/verify/precache-check.mjs`
- [ ] 手机 360×640 截图能认出走、浇、摘

Commit 修掉的洞。部署走 `deploy.sh`，且 `git status` + `git branch --show-current` 确认在 `farm-social-202606`。

---

## Spec coverage

| Spec | Task |
|---|---|
| 9 looks + 默认 2 + 匿名 1 | 1, 2, 3 |
| lookFromUid 哈希 | 1 |
| 闲逛可走/不可走 | 5 |
| 收获/浇水挂钩真实函数 | 6 |
| 连点 last-write-wins | 6 |
| 精灵表格式与抠底 | 4 |
| 不进 SW 预缓存（图） | 4, 1 只加 js |
| 摊前 + 拜访 | 7 |
| 验收 1–9 | 8 |
