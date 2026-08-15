# 宣传插画（key art）· Gemini 提示词包

> 给 Chris：这里的图**不是游戏截图**，是商店页/海报用的「插画级」大图 ——
> 就是你说的「比游戏画面更逼真靓丽」那种。生成后把图发给 Claude Code，
> 我裁切压缩后接进海报/横幅/分享卡。
>
> 游戏画面的精修图另有一条路，不用 AI：`node scripts/promo_shots.mjs`
> 会把农场摆到最好看（满级的家、种满成熟的菜、水塘小动物路人）再超采样截图，
> 产物在 `promo/hero-*.jpg`。**两条路并用**：插画负责吸引眼球，精修截图负责
> 「点进来看到的就是这个」，不货不对板。

---

## 三条铁律（每次都要满足，否则要返工）

1. **必须和游戏是同一个世界**。喂参考图：把 `promo/hero-portrait.jpg` 和
   `src/assets/images/map/p_house.webp`、`p_barn.webp`、`p_stall.webp` 一起丢给
   Gemini 当 style reference，写 `match the style, palette and lighting of the reference`。
   不然出来的图很漂亮但跟游戏没关系，顾客点进来会失望 —— 这是宣传图最大的翻车方式。
2. **要亚洲蔬菜，不要西式农场**。默认生成的农场是玉米/南瓜/麦垛，那不是我们的菜。
   一定要在提示词里点名：`bok choy, napa cabbage, Chinese chives, daikon, long eggplant,
   scallions, choy sum, coriander`。不要 corn / pumpkin / sunflower / wheat。
3. **留出放字的地方**。海报要压标题和二维码，所以构图上部或下部要有一块干净的天空/草地。
   写 `generous clean sky area at the top for text overlay, no busy detail in the top third`。

**通用尾巴**（拼在每条后面）：
```
cozy stylized 3D-illustration look, warm afternoon sunlight from upper left,
saturated but natural greens, soft rim light, clean dark outlines, gentle depth of field,
Saskatchewan prairie horizon with a distant spruce tree line,
NO text, NO watermark, NO UI elements, NO people's faces in close-up,
16:9 (or 3:4 for the portrait one), high detail, print quality.
```

---

## 1. 主视觉 · 农场全景（海报/横幅首选）

```
A cozy isometric-style Asian family vegetable farm on the Canadian prairie, seen from a
gentle 3/4 aerial angle. Neat raised soil beds bursting with ripe Asian vegetables —
bok choy, napa cabbage, Chinese chives, daikon radish, long purple eggplant, scallions,
choy sum. A small warm wooden farmhouse with festive bunting and a stone chimney, a red
barn, a glass greenhouse, a chicken coop, a little pond with a water wheel, a dirt country
road curving through the foreground. A puppy and a few chickens wander between the beds.
Late afternoon golden light, long soft shadows, distant spruce forest line and rolling
green hills on the horizon.
```
用途：A4 海报底图、网站首页横幅、微信长图头图。

## 2. 母子同玩（情感向，微信朋友圈用）

```
Warm illustration: a Chinese-Canadian mother in her forties and her 8-year-old child sit
together on a sofa at home, sharing one phone, both smiling at the screen. Over their
shoulder the phone shows a bright cozy cartoon vegetable farm. Soft window light, a bowl of
mandarin oranges on the table, calm modern living room. Focus on the warmth between them,
not on the device.
```
⚠️ 别让手机屏幕内容太具体（会和真实游戏对不上）；虚化一点更好。
用途：朋友圈长版配图、店内海报的第二版。

## 3. 一棵菜的特写（做系列图 / 小票背面 / 卡片）

```
A single hero shot of one ripe [bok choy / napa cabbage / long purple eggplant / daikon
radish / bunch of Chinese chives], growing in dark rich soil, dew on the leaves, cozy
stylized 3D-illustration look, shallow depth of field, warm sunlight, clean simple
background with soft green bokeh, centered with generous margin.
```
一菜一张，做成一套（我们游戏里 40+ 种菜，挑 6-8 种最有代表性的）。
用途：微信九宫格、店内货架小卡、游戏图鉴页配图。

## 4. 「积分回到会员卡」概念图（讲清楚玩法价值）

```
A clean warm concept illustration: on the left a small cartoon vegetable farm on a phone
screen, on the right an Eastern Market membership card, connected by a gentle glowing arc
of golden points flowing from the farm into the card. Soft cream background, minimal, no
text. Cozy stylized 3D-illustration look, warm lighting.
```
用途：这是整个宣传的**核心信息图** —— 别的游戏是你往里掏钱，我们是积分回到你卡上。

## 5. 竖版手机屏（朋友圈/小红书 3:4 或 9:16）

把 #1 的提示词加一句：
```
vertical composition, 9:16, the farm occupying the lower two thirds,
big clean sky in the upper third for a headline.
```

---

## 拿到图之后

1. 发给 Claude Code，我做：裁切 → 压缩（JPEG q88，控制在 300KB 内）→ 接进
   `promo/poster.html`、网站横幅、`og:image`。
2. **接进游戏之前先对比**：把插画和 `promo/hero-portrait.jpg` 并排看一眼 ——
   风格差太远就别用在「点进来就看到」的位置（开屏/首页），只用在店内海报。
3. 定稿的图存进 `promo/`，并在这里记一笔用在哪。
