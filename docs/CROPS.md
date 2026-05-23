# Crops — Cultural & Game Notes

This is a companion doc to `data/crops.json`. Use this when adding new crops,
writing storekeeper dialog, or balancing the economy.

---

## V1 Crops (Main 8)

### 上海青 / Bok Choy (`qingcai`) — Tier 1
- **Why this is the starter crop**: cheap, fast, universally familiar to
  Chinese-Canadian families. Mom recognizes it instantly. Kid can be told
  "this is what's in your wonton soup."
- **Game role**: tutorial crop. First seed in starter inventory (3 free).
- **Real-world tie-in**: Eastern Market sells fresh bok choy from local
  Chinese-Canadian wholesalers. Weekly turnover is high.

### 番茄 / Tomato (`tomato`) — Tier 2
- **Universal appeal**: known to both Asian and Western kids.
- **Recipe hook**: 番茄炒蛋 (tomato + scrambled egg) — the most
  beginner-friendly Chinese dish. Storekeeper can mention this.
- **Unlocks at level 2** to give early growth a sense of progression.

### 黄瓜 / Cucumber (`cucumber`) — Tier 2
- **Cultural note**: Asian cucumber (Chinese cucumber) is different from
  Western — thinner skin, less bitter. Eastern Market carries the Asian
  variety, this is a teachable moment.
- **Visual pair with tomato**: both red and green, classic Chinese summer
  dish "番茄黄瓜沙拉" (cold tomato cucumber).

### 辣椒 / Chili Pepper (`chili`) — Tier 3
- **Iconic for Sichuan/Hunan cuisine**.
- **Sub-varieties** (V2 idea): 线椒, 朝天椒, 二荆条 — different heat levels.
  For V1 we use one generic chili to keep things simple.

### 茄子 / Asian Eggplant (`eggplant`) — Tier 3
- **Differentiation note**: Asian eggplant is long, slender, light purple —
  very different from Western round eggplant. Less bitter, no salting needed.
- **Cultural recipe**: 鱼香茄子 (yuxiang eggplant) — a Sichuan classic.

### 韭菜 / Chinese Chive (`jiucai`) — Tier 4, MULTI-HARVEST
- **The "magic" crop**: cuts 3 times per plant, regrows in 1 hour.
- **Cultural saying**: "韭菜越割越旺" — teaches a real fact about chive biology.
- **Recipe gateway**: chive dumplings, chive pockets (韭菜盒子), chive scrambled
  egg. All staple Chinese home dishes.
- **Why this is the standout crop**: the multi-harvest mechanic feels rewarding,
  the cultural story is authentic, and it leads to multiple recipe references
  for Eastern Market.

### 大蒜 / Garlic (`garlic`) — Tier 5
- **Long grow time (12 hours)** = "set it before bed, harvest in the morning."
  Creates a pleasant overnight loop.
- **Soul of Chinese cuisine**: nearly every dish uses garlic. Eastern Market
  keeps it in constant stock.

### 香菜 / Cilantro (`cilantro`) — Tier 5
- **The polarizing crop** — joke material. Storekeeper can say:
  "I either love it or it tastes like soap. Genetic, they say!"
- **Universal in Chinese garnishing**: scallion + ginger + cilantro is the
  holy trinity.

---

## V1 Festival Crops (5)

### Spring Festival
- **水仙 / Narcissus** (`narcissus`) — decorative flower, southern Chinese new
  year tradition. Eastern Market stocks bulbs pre-festival.
- **年橘 / Kumquat** (`kumquat`) — "桔" sounds like "lucky" in Cantonese.

### Mid-Autumn
- **芋头 / Taro** (`taro`) — traditional moon-worship offering.
- **柚子 / Pomelo** (`pomelo`) — round like the full moon. Cultural moment:
  kids wear the pomelo rind as a hat (this is a real Chinese tradition).
- **桂花 / Osmanthus** (`osmanthus`) — autumn fragrance, infuses into wine,
  tea, and pastries.

---

## Future Crop Ideas (V2+)

Each adds variety without major balancing work:

| Crop | Tier | Notes |
|---|---|---|
| 大白菜 / Napa Cabbage | 2 | Winter staple, dumpling filling |
| 萝卜 / Daikon | 3 | "冬吃萝卜夏吃姜" proverb |
| 莲藕 / Lotus Root | 4 | Visually distinctive, soup ingredient |
| 苦瓜 / Bitter Melon | 4 | Cantonese summer veg |
| 豆芽 / Bean Sprouts | 2 | Very fast, used in many stir-fries |
| 香菇 / Shiitake | 5 | Mushroom variety, slow but valuable |
| 木耳 / Wood Ear Fungus | 5 | Cold dish staple |
| 紫菜 / Nori | 4 | Soup ingredient |

---

## Balancing Principles

When tuning `crops.json`:

1. **Tier 1 (5 min)**: nearly free, almost no profit, just to keep the player
   busy in early sessions. ROI per minute: ~3 coins/min.
2. **Tier 2 (30 min)**: ~2 coins/min ROI. Reasonable middle ground.
3. **Tier 3 (2h)**: ~1.25 coins/min ROI. Players plant and walk away.
4. **Tier 4 (4h, multi-harvest)**: extra rewarding to compensate for higher
   investment.
5. **Tier 5 (8-12h)**: "set before sleep" crops. ~0.5 coins/min ROI but big
   absolute coin payout, satisfying when collected next day.

**Important**: don't make late-game crops too efficient. The fun is in
*choice*, not optimization. Tier 1 should still feel useful for filling
small time gaps between sessions.

---

## SKU Mapping (V2 — Eastern Market integration)

Each crop has a `real_sku` field. Format: `EM-{CATEGORY}-{NAME}`.

V2 plan: Chris periodically exports the Eastern Market product catalog
(JSON or CSV from Clover) → a script matches `real_sku` to current store
inventory → the game's "View in Store" button can show:
- Current store price
- Whether it's on sale this week
- Stock status (in stock / arriving soon)

V1 just hardcodes the SKU string; the data won't be live. That's fine.

---

## Bilingual Naming

Always provide both `name_zh` and `name_en`. Some translations are
straightforward (番茄 = tomato), some need care:

- 韭菜 → "Chinese chive" or "garlic chive" (NOT "leek" — different plant)
- 茄子 → "Asian eggplant" (specify variety, not generic "eggplant")
- 香菜 → "cilantro" (US/Canada term, NOT "coriander" which is the seed)
- 大蒜 → "garlic" (specifically the bulb, not green garlic stems)

The English name matters: Chinese-Canadian kids may not know the Chinese
name. Mom shopping in English at the store benefits from the matching term.
