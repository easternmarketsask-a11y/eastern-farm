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
