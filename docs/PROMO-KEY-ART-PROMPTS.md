# 宣传插画 · Grok 提示词包

> 给 Chris：这里的图**不是游戏截图**，是海报/朋友圈/商店页用的「插画级」大图 ——
> 就是你说的「比游戏画面更靓丽」那种。生成后把图发给 Claude Code，我裁切压缩后接进物料。
>
> 游戏画面的精修图是另一条路，不用 AI：`node scripts/promo_shots.mjs promo` 会把农场
> 摆到最好看再超采样截图，产物在 `promo/hero-*.jpg`。
> **两条路并用**：插画负责吸引眼球，精修截图负责「点进来看到的就是这个」。

---

## 用之前先做的三件事

1. **喂参考图**。每次都把 `promo/hero-square.jpg` 拖给 Grok，并在提示词开头写：
   `Use the attached image as the style, palette, camera angle and lighting reference.`
   不喂参考图 = 出来的图很漂亮但跟游戏没关系，顾客点进来会失望 —— 这是宣传图最大的翻车方式。
2. **一次只改一个变量**。Grok 每次给 4 张，先挑构图最好的那张，再用
   `same image, but <一个改动>` 去迭代，别一次改五处。
3. **要中文长宽比**。海报 3:4、朋友圈 9:16、网站横幅 16:9 —— 在提示词末尾直接写死。

---

## 每条都要带的「通用尾巴」

把下面这段拼在每条提示词后面（这是防止翻车的部分，别省）：

```
STYLE: cozy stylized 3D game illustration, like a premium mobile farming game key art.
Warm late-afternoon sunlight from the upper left, long soft shadows, saturated but natural
greens, gentle rim light on edges, clean readable shapes, subtle depth of field on the
background. Isometric-leaning 3/4 aerial camera, same angle as the reference image.
Saskatchewan prairie horizon: rolling green fields and a distant dark spruce tree line.

MUST NOT INCLUDE: no text, no letters, no logos, no watermark, no UI, no buttons,
no corn, no pumpkins, no sunflowers, no wheat, no scarecrow, no barn quilt,
no western/European cottage-core clutter, no photorealism, no dark or moody lighting.

QUALITY: high detail, crisp edges, print resolution, centered composition.
```

> ⚠️ 那串 `no corn / no pumpkins / no sunflowers / no wheat` 一定要留着 ——
> AI 一听「farm」默认给你画美式农场，那不是我们的菜。

---

## 1️⃣ 主视觉 · 农场全景（海报 / 网站横幅首选）

```
Use the attached image as the style, palette, camera angle and lighting reference.

A cozy Asian family vegetable farm on the Canadian prairie, seen from a gentle 3/4 aerial
angle. Neat raised wooden soil beds packed with ripe ASIAN vegetables — bok choy, napa
cabbage, Chinese chives, daikon radish, long slender purple eggplant, scallions, choy sum,
coriander, winter melon. A small warm wooden farmhouse with a stone chimney and colourful
festive bunting; a red barn; a glass greenhouse; a wooden chicken coop; a little pond with
a turning water wheel; a dirt country road curving across the foreground. A fluffy puppy
and two chickens wander between the beds. A red Chinese lantern on a post beside the road.

COMPOSITION: farm fills the middle of the frame, clean sky and tree line across the top
third so a headline can be placed there, the dirt road across the bottom.
Aspect ratio 3:4 (portrait).

<通用尾巴>
```
用途：A4 海报底图、朋友圈长图头图。
> 想要横幅版就把最后一行换成 `Aspect ratio 16:9 (landscape), the farm spread wide across the frame.`

## 2️⃣ 母子同玩（情感向，朋友圈最好用）

```
Use the attached image as the style and colour reference for the game on the screen.

Warm cozy illustration: a Chinese-Canadian mother in her early forties and her 8-year-old
child sit close together on a sofa at home, sharing one phone, both smiling at the screen.
Soft afternoon window light, a bowl of mandarin oranges on the side table, calm tidy modern
living room in warm cream and wood tones. On the phone screen: a small bright cartoon
vegetable farm (kept soft and slightly out of focus).

COMPOSITION: the two people are the subject, the phone is small. Warmth between them is the
point. Empty wall space on the upper right for a headline. Aspect ratio 3:4.

<通用尾巴>
```
> ⚠️ 屏幕内容一定要「虚化、别画太具体」，否则会和真实游戏对不上。

## 3️⃣ 单棵菜特写（做成一套系列图）

```
Use the attached image as the style, palette and lighting reference.

A hero close-up of a single ripe {上海青 bok choy / 大白菜 napa cabbage / 长茄子 long purple
eggplant / 白萝卜 daikon radish / 一把韭菜 a bundle of Chinese chives / 小葱 scallions},
growing in dark rich crumbly soil, fresh dew on the leaves, one or two tiny white flowers
nearby. Shallow depth of field, soft green bokeh background, warm sunlight.

COMPOSITION: single subject centered with generous empty margin. Aspect ratio 1:1.

<通用尾巴>
```
一菜一张，挑 6–9 种做成九宫格。用途：微信九宫格、店内货架小卡、图鉴页配图。

## 4️⃣ 「积分回到会员卡」概念图（**最该做的一张**）

这张讲的是整个宣传的核心：别的游戏是你往里掏钱，我们是积分回到你卡上。

```
A clean warm concept illustration on a soft cream background. On the left: a smartphone
showing a small bright cartoon vegetable farm. On the right: a green supermarket membership
card. Between them, a gentle glowing arc of golden coin-like points flowing FROM the farm
INTO the card, with a few sparkles. Minimal, lots of clean empty space, no clutter.

COMPOSITION: left-to-right flow, plenty of empty space at the bottom for text.
Aspect ratio 16:9.

<通用尾巴>
```

## 5️⃣ 节日版（春节 / 中秋，到时候换）

```
Use the attached image as the style, palette, camera angle and lighting reference.

The same cozy Asian vegetable farm, dressed for {Chinese New Year / Mid-Autumn Festival}:
{红灯笼串挂在屋檐和小路两侧、门口贴红春联、天上有小烟花
 / 一轮很大的暖黄满月低悬在云杉林上方、屋檐挂着圆形纸灯笼、桌上摆着月饼和柚子}.
Evening scene, warm lantern glow lighting the vegetable beds from the side, deep blue-teal
sky, cozy and peaceful.

COMPOSITION: clean sky in the upper third for a headline. Aspect ratio 3:4.

<通用尾巴>
```

---

## 拿到图之后

1. **先并排对比**：把 Grok 的图和 `promo/hero-square.jpg` 放一起看一眼。
   风格差太远的，就只用在店内海报，**别用在开屏/首页**（那里必须和真实画面一致，否则货不对板）。
2. 发给 Claude Code，我做：裁切 → 压缩（JPEG q88，控制在 300KB 内）→ 接进
   `promo/poster.html`、网站横幅、`og:image`。
3. 定稿的图存进 `promo/`，在这里记一笔用在哪、哪条提示词出的。

## 已出图（2026-08-15）

| 文件 | 提示词 | 用途 |
|---|---|---|
| `promo/keyart-farm-portrait.jpg` | #1 全景，从 `hero-portrait.jpg` 精修 | 朋友圈头图 |
| `promo/keyart-farm-landscape.jpg` | #1 全景 16:9，从 `hero-landscape.jpg` 精修 | 网站横幅 |
| `promo/keyart-farm-square.jpg` | #1 全景，从 `hero-square.jpg` 精修并去掉 UI | 微信分享 |
| `promo/keyart-farm-poster.jpg` | #1 全景 3:4 新画 | 店内海报底图（更插画，别当开屏） |
| `promo/keyart-points-flow.jpg` | #4 积分回卡 | 主轴概念图 |

未做：#2 母子同玩（不画小孩）、#3 单菜特写、#5 节日版。周末朋友圈用竖版 + 概念图即可。

## 出图不理想时的对症下药

| 症状 | 加这句 |
|---|---|
| 画成了美式农场（玉米/南瓜/麦垛） | `ONLY East Asian leafy vegetables. No corn, no pumpkin, no wheat, no sunflower.` |
| 太写实、像照片 | `stylized game illustration, NOT photorealistic, clean shapes, painted look` |
| 太暗/太冷 | `bright warm afternoon light, cheerful, high key` |
| 菜地乱糟糟 | `neat orderly raised beds in tidy rows, clean spacing between beds` |
| 没地方放字 | `leave the top third as clean empty sky with no detail` |
| 和游戏风格对不上 | 重新喂参考图，并加 `match the reference image's camera angle and colour palette exactly` |
