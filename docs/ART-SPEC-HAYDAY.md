# Eastern Farm · Hay-Day 等距美术规格书（2026-06-16）

> 目标：真正的 Hay Day 观感。失败的根因是**素材不成体系**（风格/光源/比例/透视
> 各张不一致，作物把土块烤进图里，草地是会平铺出「人字被子」的尖刺立方体）。
> 引擎已就绪，能渲染任何素材——**瓶颈 100% 是素材一致性**。本规格书是所有素材
> （成品地基 + Grok 作物/建筑）必须共同遵守的唯一基准。

## 路线（Chris 2026-06-16 拍板）：混合
- **会平铺的「地面瓦片」（草地/土壤/小路）→ 用专业成品包**（Grok 画不好无缝平铺）。
  选定：**Soil & Grass Tileset by maellemarylloup**（itch.io，手绘卡通等距，可商用）。
- **站着的「物件」（作物/建筑/装饰）→ 用 Grok**，但严格照本规格，**纯植株、无土**。

## 全局风格铁律（每张图都要满足）
1. **视角**：等距 3/4 俯视（dimetric），与地面瓦片同一角度。
2. **光源**：**左上**单一方向，柔和；阴影落右下、淡。全套统一，禁止逐图乱来。
3. **描边**：统一——要么都有同粗细的柔描边，要么都无描边。不混用。
4. **色板**：暖、明快、低饱和偏柔（Hay Day 感）。禁止高饱和霓虹、禁止大块深色。
5. **画风**：手绘/卡通、软 cel-shading、圆润形状，与成品地基包一致。
6. **背景**：**纯透明 PNG**（真 alpha，不是棋盘格 jpg、不是白底）。

## 地面瓦片（成品包，接入要求）
- 找到「地面菱形顶」的中心比例，调引擎 `TW/TH` 与瓦片 2:1（或包实际比例）一致。
- 草地：低对比、可无缝平铺（成品包已保证）。
- 耕地（土壤）：干净、能拼成**整片平整菜畦**，明确格子边界。
- 小路/水塘：同包或同风格。

## 作物（Grok，纯植株无土，每种 4 阶段）
**最关键的规矩：作物图里禁止出现任何土块/土堆/花盆/地面/瓦片。只画植株本身，
透明底。** 土壤由地面瓦片负责，植株「坐」在格子里。

- **矮而紧凑**：成熟株高 ≤ 约 1.3 个地块高，能落在一格内，相邻不会叠成一团。
- **4 阶段**（横向一条，左→右，**每株之间留明显空隙、同一基线、透明底**，方便切分）：
  1. 嫩芽（刚冒头）
  2. 幼株（几片叶）
  3. 长大（叶丛饱满）
  4. 成熟（带果/可收：番茄红果、辣椒红椒、茄子紫茄、大蒜蒜头…）
- 8 种：上海青、辣椒（牛角椒）、茄子、韭菜、番茄、黄瓜、香菜、大蒜。

### Grok 提示词（每种作物一条，出 4 阶段条图）
**通用前缀（每条都带上）：**
```
Hand-drawn 2D cartoon isometric game asset, soft cel-shaded painterly style,
cute cozy farm game (Hay Day style), clean rounded shapes, warm cheerful palette,
soft light from top-left, subtle soft shadow, 3/4 isometric view.
PLANT ONLY — absolutely NO soil, NO dirt, NO mound, NO pot, NO ground, NO tile.
Transparent background. Four growth stages in one row, left to right, evenly spaced
with clear empty gaps between each, all sharing the same bottom baseline, each plant
short and compact (fits one small farm plot).
```
**各作物结尾（接在前缀后）：**
- 上海青 Bok choy：`Stages: tiny sprout → small bok choy → fuller bok choy → mature bok choy with thick white stems and green leaves.`
- 辣椒 Horn pepper：`Stages: sprout → young leafy plant → bushier plant → mature plant with a few red horn chili peppers.`
- 茄子 Eggplant：`Stages: sprout → small plant → leafy plant → mature plant with one or two glossy purple eggplants.`
- 韭菜 Chinese chives：`Stages: tiny grass-like sprouts → short chive blades → taller chive clump → full lush chive clump (thin green blades).`
- 番茄 Tomato：`Stages: sprout → small staked plant → bushier plant → mature plant with a few ripe red tomatoes.`
- 黄瓜 Cucumber：`Stages: sprout → small vine → leafy vine → mature vine with one or two green cucumbers.`
- 香菜 Cilantro：`Stages: tiny sprout → small cilantro → fuller cilantro → lush cilantro bunch (feathery green leaves).`
- 大蒜 Garlic：`Stages: sprout → short green shoots → taller green stalks → mature with a white garlic bulb and green tops.`

> 验收：每张要满足全局铁律 + 无土 + 透明底 + 4 阶段同基线留空隙。不满足就重生成。

## 接入流程（我做）
1. Chris 下载成品地基包 zip → 放进 `_incoming/`（或发我）。
2. 我把地面瓦片接进引擎，调 TW/TH 对齐，验证无缝平铺。
3. Chris 用上面提示词出 8 条作物 → 放 `_incoming/`。
4. 我按「植株簇」切 4 阶段、抠透明、缩放接入（纯植株好切，无土块干扰）。
5. 每步真机截图验收，直到达到 Hay Day 观感。

## 退役/清理
- 一旦新作物（无土）接入，旧 `crop_*`（带土）退役；`plot_bed.png` 等临时方案删除。
