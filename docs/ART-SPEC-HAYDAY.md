# Eastern Farm · Hay-Day 等距美术「Grok 生产手册」（2026-06-17 定稿）

> 目标：真正的 Hay Day 观感。之前失败**不是 Grok 画得差，而是规格/一致性没控住**：
> 作物把土块烤进图里、有的白底/棋盘格底、有的是文字占位、角度光照各张不同、地面
> 瓦片拼不上缝。本手册把每一项写死，照着出、逐张验收，就能得到一套**风格统一**的素材。
> 引擎已就绪（等距渲染/点击/取景/编辑器都能用），瓶颈只在素材一致性。

---

## 0. 最重要：一致性靠「基准图锚定」工作流（务必照做）
AI 每次单独生成都会飘。让它统一的唯一可靠办法是**给它一张参考图**：

1. **先只生成 1 张「基准图」= 耕地地块床**（见 §2.A），反复出到满意为止。这张定下
   **角度 / 光照 / 描边 / 色温 / 比例** 的基准。
2. **之后每生成一张别的素材，都把这张基准图一起喂给 Grok**，并在提示词结尾加：
   `Match the EXACT isometric angle, lighting (top-left), outline style, color temperature and scale of the attached reference image.`
3. 8 种作物：先把**第 1 种作物**出到完美，**之后 7 种都附上"那第 1 种作物图"当参考**
   （作物之间互为参考，比附地块床更准）。

---

## 1. 全局铁律（每一张图都必须满足）
- **视角**：等距 isometric，**2:1 dimetric**（菱形顶宽:高 = 2:1，约 30° 俯视），所有图同一角度。
- **光照**：**左上**单一柔光，阴影淡淡落向右下。全套一致，禁止逐图乱打光。
- **画风**：**手绘卡通**、软 cel-shading、圆润、暖色明快（Hay Day 感）。
  禁止：写实/3D 渲染感、像素风、低多边形(low-poly)、霓虹高饱和、深色大色块。
- **背景**：**纯透明 PNG**（真 alpha）。**绝对不要**白底、棋盘格底、风景底、地面底。
- **比例/画布**：同类素材用同一画布尺寸、主体大小一致（靠基准图锚定）。
- **不要文字/水印/标签**出现在图里。

---

## 2. 需要的素材清单（按优先级）

### A. 【基准图】耕地地块床 ×1  —— 先做这张
一块**单独的**方形耕地：略微抬起的长方体土床，**深棕肥沃土**，顶面 3–4 条整齐平行垄沟，
边角圆润；**不带任何植物/草/篱笆**。等距 2:1，左上光。透明底，画面只此一物。
> 用途：每块地的"土床"。空地显示它，种了的作物坐在它上面。

### B. 作物 ×8（**最关键**，纯植株、无土、矮而紧凑、每种 4 阶段）
**铁规：作物图里禁止出现任何土/土堆/花盆/地面/瓦片——只画植株本身，透明底。**
土由 A 的地块床负责。每种作物**矮而紧凑**（塞进一格、卡通敦实比例，不要细高杆）。
4 阶段横向一排、左→右、**之间留明显空隙、同一基线**（方便我切分）。
8 种：上海青、辣椒(牛角椒)、茄子、韭菜、番茄、黄瓜、香菜、大蒜。

### C. 草地 ×1–2（低对比、可平铺）
等距 2:1 **菱形**草地块：均匀短草、**很低对比、纹理均匀**以便平铺，铺满整个菱形、边到边，
左上光。无花无物无边框。菱形以外透明。
（我会再做柔化+混合+变体处理；低对比是关键。可选第 2 张带几朵小花的变体。）

### D. 小路 ×1、水塘 ×1（可选，等距 2:1 菱形，同上规格）

> 建筑（谷仓/小屋/温室/鸡舍/摊位/水井/树）和动物（鸡/猫/兔/狗）已有可用版本，
> **本轮可不重做**；若要统一风格，按全局铁律 + 附基准图重出即可。

---

## 3. 可直接复制的 Grok 提示词

### 通用前缀（每条都带；除基准图外都要"附参考图"）
```
Hand-drawn 2D cartoon game asset, cozy farm game style (like Hay Day), isometric 2:1 dimetric view (~30 degrees from top), single soft light from top-left with a gentle soft shadow to the bottom-right, warm cheerful palette, soft cel-shading, clean rounded shapes. Fully transparent background (PNG alpha) — no white, no checkerboard, no scenery, no ground. No text, no watermark.
```

### A. 基准图 · 耕地地块床（先出这张，不附参考）
```
<通用前缀>
A SINGLE square tilled-soil farm plot bed: a slightly raised rectangular block of rich dark brown soil, with 3-4 neat parallel furrow rows on the flat top, soft rounded edges. No plants, no grass, no fence, no decorations. One object only, centered.
```

### B. 作物（每种一条，出 4 阶段条图；第 2 种起附"第 1 种作物图"为参考）
```
<通用前缀>
PURE PLANT ONLY — absolutely NO soil, NO dirt, NO mound, NO pot, NO ground, NO tile, nothing beneath the plant. Four growth stages of a [作物] in one row, left to right, evenly spaced with clear empty gaps, all sharing the same bottom baseline. Each plant compact and SHORT (fits in one small plot, chunky cozy proportions, not a tall thin stalk). Stages: [阶段描述].
Match the EXACT cartoon style, isometric angle, top-left lighting, color temperature and scale of the attached reference image.
```
**各作物的 `[作物]` 与 `[阶段描述]`：**
- 上海青 bok choy：`sprout → small bok choy → fuller bok choy → mature bok choy with thick white stems and green leaves`
- 辣椒 horn pepper：`sprout → young leafy plant → bushier plant → mature plant with a few red horn chili peppers`
- 茄子 eggplant：`sprout → small plant → leafy plant → mature plant with one or two glossy purple eggplants`
- 韭菜 chinese chives：`tiny grass-like sprouts → short blades → taller clump → full lush thin green chive clump`
- 番茄 tomato：`sprout → small plant → bushier plant → mature compact plant with a few ripe red tomatoes`
- 黄瓜 cucumber：`sprout → small leafy plant → bigger leafy plant → mature plant with one or two green cucumbers`
- 香菜 cilantro：`tiny sprout → small cilantro → fuller cilantro → lush feathery cilantro bunch`
- 大蒜 garlic：`sprout → short green shoots → taller green stalks → mature with a white garlic bulb and green tops`

### C. 草地块
```
<通用前缀>
An isometric 2:1 DIAMOND (rhombus) tile of short cozy cartoon grass: uniform soft green, VERY low contrast and even texture so it can repeat seamlessly, filling the whole diamond edge to edge. No flowers, no objects, no border. Outside the diamond is transparent.
Match the angle and lighting of the attached reference image.
```

### D. 小路 / 水塘（把 grass 换成 dirt path / calm water，其余同 C）

---

## 4. 逐张验收清单（Chris 在发我之前先自检，不合格就重生成）
- ❌ 作物下面有土/土堆/花盆/地面 → 退（必须纯植株）
- ❌ 白底 / 棋盘格底 / 不透明 → 退（必须透明）
- ❌ 图里出现文字/标签 → 退
- ❌ 角度、光照方向和参考图不一样 → 退
- ❌ 写实/3D 渲染/像素/低多边形 → 退（必须手绘卡通）
- ❌ 作物细高杆、和别的作物比例差太多 → 退（要敦实、统一）
- ✅ 透明底 + 纯植株 + 同角度同光 + 敦实卡通 + 4 阶段同基线留空隙

---

## 5. 交付方式 / 我来做的
- 把验收通过的 PNG 全部丢进 `D:\easternmarket.ca\eastern-farm\_incoming\`（条图直接给我，我会切 4 阶段）。
- 命名随意（或按 `crop_<拼音>_stages.png` / `bed.png` / `grass.png`）。
- 我负责：抠透明、切片、缩放、调等距比例、接进引擎（地块床统一、纯植株坐其上、
  草地柔化平铺），**每步真机截图给你验收**，迭代到 Hay Day 观感。

## 6. 接入后清理
- 旧的"带土"作物图、`plot_bed.png`、临时方案全部退役。
