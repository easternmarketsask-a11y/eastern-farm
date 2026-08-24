# 13 张宣传卡 · 油画版 Grok 提示词包（2026-08-24）

> 配套：`promo/sketch-cards/` 是简笔画版（已完成 13 张）。
> 这份是给**同样 13 句话**出油画的提示词。出好图发给我，我裁切压缩接进同一套版式，
> 你就能一句一句比简笔画和油画哪个更打动人。
>
> 这份跟 `PROMO-KEY-ART-PROMPTS.md` 分工：那份出**大图**（海报底、朋友圈头图、
> 网站横幅），这份出**卡片图**（每张只服务一句话）。

---

## 出图前先记住三件事

1. **每张图只服务一句话。** 图里必须有那句话说的东西。
   反例：车那张画成「房子门口停着车」，房子占了画面主体 —— 那张图撑不起
   「挑一辆车，农活快四倍」，标题在承诺画面里没有的东西。
2. **要 16:9，不是方图。** 卡片版式里图是横幅（1080×596），
   方图和竖图接进来会被裁掉一大半。提示词末尾写死 `--ar 16:9`。
3. **喂参考图。** 把 `promo/keyart-farm-landscape.jpg` 拖给 Grok 并写
   `Use the attached image as the style, palette and lighting reference.`
   不喂 = 出来很漂亮但跟游戏不是一个世界。

---

## 通用尾巴（每条都拼上）

```
STYLE: warm painterly game key art, oil-painting feel with soft visible brushwork.
Late-afternoon golden sunlight from the upper left, long soft shadows, saturated but
natural greens, gentle rim light. Saskatchewan prairie horizon: rolling green fields
and a distant dark spruce tree line. Clean readable shapes, subtle depth of field.

MUST NOT INCLUDE: no text, no letters, no numbers, no logos, no watermark, no UI,
no corn, no pumpkins, no sunflowers, no wheat, no scarecrow, no photorealism,
no dark or moody lighting.

QUALITY: high detail, crisp edges, print resolution. --ar 16:9
```

⚠️ `no corn / no pumpkins / no sunflowers / no wheat` 一定要留 ——
AI 一听「farm」就默认给你画美式农场，那不是我们的菜。

### 🔒 两条 Chris 定死的（2026-08-23）

**① 只要画到房子，一律欧式舒适豪宅。** 在提示词里写死：

```
ARCHITECTURE: comfortable European-style country manor — hipped or gabled slate roof,
dormer windows, a columned front portico with steps, symmetrical tall windows,
warm brick or stone walls, trimmed hedges. NO Chinese architecture: no upturned
flying eaves, no red paper lanterns, no lattice windows, no pagoda roof.
```

⚠️ 这条跟通用尾巴里的 `no western/European cottage-core` 冲突 ——
**画到房子时，以这条为准**，通用尾巴里那半句删掉。
（旧素材 `_art-house.jpg` 翘檐、`_art-house-promo.jpg` 挂红灯笼，都是这条出来之前的，作废。）

**② 讲车的图，车必须是主角。** 在提示词里写死：

```
COMPOSITION: the car fills at least 70% of the frame width, 3/4 front view,
camera at hood height. Everything else — fields, house, sky — is background only,
soft and low contrast. The car is the hero.
```

（旧素材 `_art-cars-promo.jpg` 是房子当主角、车停在旁边，作废。）

---

## 13 条正文

每条前面标着它要撑的那句话。**图里必须看得见那句话说的东西。**

### 01 · 越玩越省，不是越玩越花

> 要传达：钱是往回走的，不是往里掏的。

```
A rustic wooden farm table in warm afternoon light. On it: a woven basket brimming with
fresh Asian vegetables — bok choy, napa cabbage, Chinese chives, purple eggplant — and
beside it a simple green membership card and a small pile of golden coins catching the
light. A folded paper grocery receipt tucked under the basket. Behind the table, softly
out of focus, a small vegetable farm on the prairie.
COMPOSITION: table and basket fill the frame, shallow depth of field.
```

### 02 · 种菜挣的积分，到店买菜能抵钱

> 要传达：游戏 → 真实会员卡，这条链路。**全套里最该做好的一张。**

```
A smartphone lying on a wooden table, its screen showing a tiny sunlit vegetable farm
with neat raised beds. From the screen, a soft stream of glowing golden coins arcs
through the air and lands on a green membership card lying next to the phone. A few
fresh vegetables and a paper grocery bag at the edge of the frame.
COMPOSITION: phone on the left, card on the right, the arc of coins connecting them
across the middle. Clean uncluttered background.
```

### 03 · 8 月 31 日前，登录送 3000 农场币

> 要传达：一份礼物。别画日历，日期由文案说。

```
An open wooden crate on a farm table, tied with a simple ribbon, overflowing with
glowing golden coins that spill onto the table and catch the low sun. A few seed packets
and a small green sprout in a clay pot beside it. Warm celebratory light, soft sparkles
in the air.
COMPOSITION: the crate centered and filling the frame, coins spilling toward the viewer.
```

### 04 · 叫上一个街坊，两个人各得 200

> 要传达：两个人，一部手机，都高兴。

```
Two Chinese-Canadian neighbours standing at a low wooden fence between two vegetable
gardens in the late afternoon, both leaning in to look at one phone held between them,
smiling. Warm friendly body language. Behind each of them, their own tidy vegetable beds.
A few golden coins glinting softly in the air above them.
COMPOSITION: both people in the frame from the waist up, the phone at the centre.
```

### 05 · 有空再来，菜一直等着你

> 要传达：不催你，回来菜还在。安静、居家。

```
A quiet kitchen windowsill at golden hour. A steaming cup of tea, a phone propped
against the window frame showing a small green vegetable farm on its screen, and a
potted seedling beside it. Outside the window, soft prairie fields. Nobody in frame —
calm, unhurried, nothing demanding attention.
COMPOSITION: windowsill across the lower third, warm light flooding in from the left.
```

### 06 · 和孩子一起种，中英文随时换

> 要传达：母子同框，一部手机，温度。

```
A Chinese-Canadian mother in her forties and her young child sitting close together on
a sofa by a bright window, both looking at the same phone she is holding, both smiling.
On the phone screen, a small colourful vegetable farm. A bowl of fresh bok choy and
oranges on the coffee table in front of them. Soft warm indoor daylight.
COMPOSITION: the two of them fill the frame from the chest up, phone visible and lit.
```

### 07 · 看看街坊家的农场

> 要传达：越过篱笆看对面那家，好奇心。

```
Late afternoon on the prairie. In the foreground, a low wooden fence; leaning on it from
this side, a person seen from behind, looking across at the neighbour's vegetable garden
— tidy raised beds full of ripe Asian vegetables, a watering can on the path, a small
cottage with a chimney behind. Long warm shadows.
COMPOSITION: fence across the lower third, the neighbour's garden filling the middle.
ARCHITECTURE: modest European-style country cottage, no Chinese architecture.
```

### 08 · 我们的节，一个都不少

> 要传达：中国节日的实物摆在一起，家里的桌上。

```
A festive table set for a Chinese family celebration at dusk. On it: a round mooncake
with an ornate pressed pattern on a ceramic plate, two wrapped bamboo-leaf zongzi tied
with string, a small plate of tangyuan, and a red silk lantern hanging above casting
warm light. A sprig of chrysanthemum in a small vase. Rich warm colours.
COMPOSITION: the table fills the frame, lantern glowing in the upper right.
NOTE: this is the ONE card where Chinese motifs are the subject — lanterns are correct here.
```

### 09 · 店里的新鲜菜和水果，都能自己种

> 要传达：又菜又水果，多到看着就想买。

```
Neat raised wooden garden beds packed to bursting with ripe ASIAN vegetables AND fruit —
bok choy, napa cabbage, Chinese chives, daikon radish, long purple eggplant, winter melon,
scallions, choy sum — and alongside them fruit: bunches of lychee, Asian pears, mandarins
and a small persimmon tree heavy with fruit. Everything glossy and fresh in the low sun.
COMPOSITION: beds fill the whole frame edge to edge, seen from a gentle 3/4 aerial angle.
```

### 10 · 外面下雨，农场也下雨

> 要传达：雨落在菜地上，叶子是湿的。

```
A gentle rain shower falling on a vegetable garden on the prairie. Raindrops beading on
glossy bok choy and cabbage leaves, small puddles in the dirt paths reflecting the sky,
a soft grey-and-gold rain-light with a break of sun at the horizon. A wooden watering can
sitting unused on the path, tipped over — the rain is doing the work.
COMPOSITION: vegetable beds in the foreground, rain visible as soft streaks, prairie behind.
```

### 11 · 从一间茅屋，盖成一座庄园

> 要传达：**三栋房子在同一张图里由小到大。** 只画一栋的话，标题就落空了。

```
Three houses standing in a row on the same prairie lawn in late afternoon light, clearly
increasing in size from left to right: on the left a small simple stone cottage with one
chimney; in the middle a two-storey farmhouse with a porch; on the right a large
comfortable European country manor with a hipped slate roof, two dormer windows, a
columned front portico with steps, symmetrical tall windows, warm brick walls, clipped
hedges and a small fountain. Same lighting on all three, same ground line.
COMPOSITION: all three houses in one frame, the size difference obvious at a glance.
ARCHITECTURE: European country manor. NO Chinese architecture — no upturned flying eaves,
no red paper lanterns, no lattice windows.
```

### 12 · 挑一辆车，农活快四倍

> 要传达：**车就是主角，而且在动。** 别画成风景里停着一辆车。

```
A handsome classic 1950s-style car in deep green with chrome trim, driving toward the
camera down a dirt farm road, kicking up a light dust trail behind the rear wheels.
Late afternoon sun raking across the bodywork, chrome catching the light. Blurred
vegetable fields and a soft prairie horizon behind.
COMPOSITION: the car fills at least 70% of the frame width, 3/4 front view, camera at
hood height. Everything else is background only, soft and low contrast. The car is the hero.
```

### 13 · 院子摆成自己的样子

> 要传达：一个布置得很讲究的院子。

```
A lovingly decorated farm yard at golden hour: a low white picket fence, a blossoming
cherry tree, a bed of tulips and a row of terracotta pots, a stone birdbath, a small
wooden windmill turning, a paper lantern on a post, and a ginger cat sitting on the path
washing itself. Everything tidy and personal, clearly arranged by someone who cares.
COMPOSITION: the yard fills the frame, path leading in from the lower left.
```

---

## 拿到图之后

1. 四张里挑构图最好的一张，用 `same image, but <一个改动>` 迭代，一次只改一处。
2. 把选中的图（原分辨率）发给我，我：
   - 裁成卡片版式要的 1080×596
   - 套上抬头（东方超市 logo + 东方农场）和扫码栏
   - 出 `.png`（打印二倍图）+ `.jpg`（微信）
3. 存进 `promo/feature-cards/_art-card-<编号>.jpg`（原图）
   与 `promo/oil-cards/<编号>.png`（成品）。

## 验收清单（每张都过一遍）

- [ ] 图里有那句话说的东西吗？（车那张车是主角吗？房子那张有三栋吗？）
- [ ] 房子是欧式吗？有没有混进翘檐、红灯笼、格子窗？（第 8 张节日除外）
- [ ] 有没有玉米、南瓜、向日葵、麦子、稻草人？有就重出。
- [ ] 图里有没有混进文字、字母、水印？有就重出 —— 字全部由版式来加。
- [ ] 裁成 16:9 之后，主体还在画面里吗？

---

## 已出的旧素材（对照用，多数已作废）

| 文件 | 状态 |
|---|---|
| `_art-crops.jpg` | ✅ 可用（09 菜） |
| `_art-invite.jpg` | ✅ 可用（04 邀请） |
| `_art-neighbors.jpg` | ✅ 勉强可用（07 街坊） |
| `_art-points.jpg` | ⚠️ 是 3D 渲染不是油画，跟其余不同路，建议按 02 重出 |
| `_art-orders.jpg` | ⚠️ 订单那张卡在 v2 已撤，暂无对应文案 |
| `_art-house.jpg` | ❌ 翘檐，中式 |
| `_art-house-promo.jpg` | ❌ 门廊挂红灯笼，中式 |
| `_art-cars-promo.jpg` | ❌ 房子当主角，车在旁边 |
