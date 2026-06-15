# 东方农场 · 像素素材 Grok 提示词包

> 给 Chris：把这些提示词逐条丢给 Grok 生成。**生成后把图片发给 Claude Code 接进地图引擎。**

## ⚠️ 三条铁律（每次生成都要满足，否则要返工）

1. **必须导出 PNG，带真正透明背景（alpha 通道）**。
   - 上一批是 JPEG，"透明"变成了灰白格子被烤进图里，我得用脚本一张张抠回来。
   - 在提示词里写死：`transparent background, PNG with alpha channel, NO checkerboard, NO white background, NO sky`。
   - 拿到图先看：背景是真透明（能看到底下）还是画上去的灰格子？是灰格子就让 Grok 重出或导出 PNG。
2. **风格统一**：把已经做好的 `谷仓/小屋/土块` 三张图一起喂给 Grok 当 style reference，
   写 `same pixel-art style, same chunky pixel scale, same top-down 3/4 angle, same warm lighting from top-left`。
3. **单个物体、无场景**：不要带地面、天空、阴影大色块。只要物体本身 + 物体底部一点点接触阴影。
   写 `single object centered, generous empty margin, no ground, no scene`。

通用尾巴（拼在每条提示词后面）：
```
top-down 3/4 isometric-ish view, cozy pixel-art, chunky pixels, warm soft lighting from top-left,
single object centered with generous margin, transparent background, export as PNG with alpha channel,
NO checkerboard, NO white/sky background, no large ground plane, only a small soft contact shadow.
Warm cozy palette (greens ~#4CAF50, oranges ~#FF9800), matches the attached barn/cottage reference style.
```

---

## 优先级 1 — 地形瓦片（让整张地图不再是纯色草地）

这几张最值钱，先做。要 **可平铺无缝（seamless tileable）** 的方形瓦片。

**P1-1 草地瓦片**
```
A seamless tileable top-down grass ground tile, 256x256, subtle grass-blade texture and a
few tiny flowers, edges wrap seamlessly so it can tile infinitely. Pixel-art. PNG.
（这张可以不透明，是底层地面）
```

**P1-2 泥土小路瓦片**
```
A seamless tileable top-down dirt path / road tile, 256x256, warm brown packed earth with
small pebbles, edges tile seamlessly. Pixel-art. PNG.
```

**P1-3 水面瓦片 + 水边**
```
A seamless tileable top-down water tile (pond/river), 256x256, calm blue water with gentle
ripples; PLUS a separate set of grass-to-water edge tiles (straight edges + corners).
Pixel-art. PNG with transparent background on the edge pieces.
```

---

## 优先级 2 — 可摆放建筑（丰富建造模式的素材盘）

每张一个建筑，正方形画布（约 512×512），透明背景。

**P2-1 东方超市摊位 / 商店**（招牌建筑，最重要）
```
A small cozy market stall / grocery shop building, red-and-cream awning, wooden crates of
vegetables out front, a hanging sign. Asian-grocery vibe. （招牌可留空，我后期叠"东方超市"字）
[通用尾巴]
```

**P2-2 温室 / 大棚**
```
A small glass greenhouse with a wooden frame and a peaked glass roof, a few green plants
visible inside. [通用尾巴]
```

**P2-3 鸡舍**
```
A small wooden chicken coop with a little ramp and a round entrance hole, red roof.
[通用尾巴]
```

**P2-4 水井**
```
A classic stone water well with a small wooden roof and a bucket on a rope. [通用尾巴]
```

**P2-5 仓库 / 储物棚**
```
A small wooden storage shed with double doors and a sloped roof, a few sacks beside it.
[通用尾巴]
```

---

## 优先级 3 — 装饰物（点缀农场）

正方形画布，透明背景，单个物体。

**P3-1 树**（做 2~3 棵不同的）：`A cute round leafy tree with a brown trunk. [通用尾巴]`
**P3-2 灌木 / 花丛**：`A small flowering bush with little red and yellow flowers. [通用尾巴]`
**P3-3 篱笆**（要可拼接）：`A wooden fence segment, straight piece + corner piece + gate piece, designed to connect end-to-end. [通用尾巴]`
**P3-4 路灯 / 灯笼**：`A cozy lamp post with a warm glowing lantern (red Chinese-style lantern variant too). [通用尾巴]`
**P3-5 稻草人**：`A friendly scarecrow with a straw hat and a patchwork shirt on a wooden cross. [通用尾巴]`
**P3-6 木牌 / 指示牌**：`A small wooden signboard on a post, blank face. [通用尾巴]`

---

## 优先级 4 — 作物生长条（4 阶段，复用青菜的格式）

**格式**（和已做好的青菜 `crop_qingcai` 一致）：
```
A horizontal strip of EXACTLY 4 evenly-spaced growth stages of {作物}, left to right:
(1) tiny seedling sprout, (2) small young plant, (3) medium plant, (4) full mature {作物} ready to harvest.
Each stage sits on a small soil mound, all on the same baseline, equal spacing, clear transparent
gaps between stages. Top-down 3/4 view, pixel-art, transparent background PNG with alpha, no checkerboard.
```

按这个格式各出一条（先做 V1 核心 8 菜，已做青菜）：
- 番茄 tomato（红番茄结在藤上）
- 黄瓜 cucumber（绿黄瓜挂藤）
- 辣椒 chili pepper（红/绿辣椒）
- 茄子 eggplant（紫茄子）
- 韭菜 Chinese chives（细长绿叶丛）
- 香菜 cilantro（小簇香菜叶）
- 大蒜 garlic（蒜苗到蒜头）

> 之后还有萝卜/白菜/冬瓜/水果类等 30 多种，按需再出。每出一种作物，
> 告诉我作物中文名，我对到 `data/crops.json` 里的 id 接进地图。

---

## 接入流程（Chris 拿到图之后）

1. 把生成的 PNG 发给 Claude Code，说清楚每张是什么（"这是温室 / 这是番茄 4 阶段"）。
2. Claude Code 跑 `scripts/process_map_assets.py` 同款流程：抠背景（若需要）+ 裁剪 + 降采样，
   存进 `src/assets/images/map/`，再把建筑加进 `BUILDINGS` 素材盘 / 作物对到 crop id。
3. `?map=1` 截图验收 → 合并部署。

---

# 🟦 等距(2.5D Hay Day)素材包 — 2026-06-15 新增

> Chris 拍板走「真·等距 Hay Day」。`?iso=1` 引擎已就绪(建造/地形/装饰全有),
> 现在缺的是**一整套风格统一的等距素材**。这是"像不像 Hay Day"的唯一瓶颈。
> 出图后发我,我把现在的「平菱形+3/4 立绘+emoji」混搭逐件替换掉。

## ⚠️ 等距铁律(比之前更严,务必统一)
1. **统一等距投影**:全部 **2:1 dimetric 等距**(菱形格,顶面宽:高 = 2:1)。
   写 `isometric 2:1 dimetric projection, 30-degree, top face is a 2:1 diamond`。
2. **统一光照**:全部 `light from top-left`,同一套阴影方向。
3. **统一画风**:二选一并**全程只用一种** —— 推荐 `cozy painted isometric, soft rounded, Hay Day style`
   (比像素更像 Hay Day);若想省事统一也可全用 `pixel-art isometric`。**别再混**。
4. **透明 PNG**(同前):`transparent background PNG, NO checkerboard, NO white bg`。
5. **统一尺寸基准**:地块顶面菱形 = **128×64 px**(再加底部泥土厚度,总高约 128×112)。
   建筑/作物按这个格子对齐(2×2 建筑 = 256 宽的菱形底)。

## 优先级 1 — 地形瓦片(等距菱形,最关键)
一组同尺寸菱形顶面瓦片,**底部带一点泥土厚度**(像 Hay Day 的小岛):
```
A set of matching isometric 2:1 farm ground tiles, each a 128x64 top diamond with a
short earth side skirt below (total ~128x112): (1) grass, (2) tilled dark soil with
furrows, (3) dirt path, (4) water/pond with a lighter shoreline edge. Cozy painted
isometric, soft rounded, warm light from top-left. Transparent PNG, no checkerboard.
All tiles share the exact same diamond footprint so they tessellate seamlessly.
```

## 优先级 2 — 等距建筑(统一角度重出)
现有谷仓/小屋/温室/鸡舍角度不完全一致。重出一套**同投影**的:
```
Isometric 2:1 buildings matching the ground-tile style and light, each sitting on a
2x2 (256px-wide) diamond base, transparent PNG: 谷仓 barn / 小屋 cottage /
温室 greenhouse / 鸡舍 chicken coop / 🛒 东方超市摊位 market stall(招牌留空) /
水井 well / 仓库 storage shed. Same painted isometric style, light from top-left.
```

## 优先级 3 — 等距作物(4 阶段,立在菱形土块上)
每种作物一条 4 阶段,**站在一块等距菜地菱形上**:
```
A horizontal strip of EXACTLY 4 isometric growth stages of {作物}, standing on a small
isometric 2:1 tilled-soil diamond, left→right: tiny sprout → young → medium → mature.
Same painted isometric style, light from top-left, equal spacing, transparent PNG, no
checkerboard. Each stage on its own diamond, same baseline.
```
先出 V1 核心:上海青/番茄/黄瓜/辣椒/茄子/韭菜/香菜/大蒜(番茄记得同时在 crops.json 加 `tomato` id)。

## 优先级 4 — 等距装饰/动物
`Isometric 2:1, painted, transparent PNG`:树/花丛/篱笆(可拼接)/灯笼/水车/栅栏门/
小桥;动物:鸡🐔/猫🐱/兔🐰/狗🐶(各 1~2 帧)。同投影同光照。

## 接入流程
1. 把成套图发我,标注每张是什么(顶面尺寸尽量按 128×64)。
2. 我跑抠图+裁剪+按菱形对齐,替换 `mapview-iso.js` 里的程序化平菱形/3-4 立绘。
3. `?iso=1` 截图验收 → 满意后把 `?iso` 设成默认、退役俯视版。
