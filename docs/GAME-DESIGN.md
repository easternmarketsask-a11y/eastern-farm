# Game Design Document

## Vision

**A cozy farm where a Chinese-Canadian mom and her kid in Saskatoon grow
the same vegetables they'd buy at Eastern Market — bok choy, garlic, garlic chives — celebrate Chinese festivals together, and slowly earn rewards for the real store.**

The game must feel like a small warm thing in a Saskatoon February: outside is -30°C, inside is your phone, on the phone is your green farm with a smiling tomato.

---

## Core Loop

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   Open game                                                  │
│        ↓                                                     │
│   See farm + greet from storekeeper                          │
│        ↓                                                     │
│   Harvest mature crops → coins + (sometimes) East Points     │
│        ↓                                                     │
│   Check today's tasks                                        │
│        ↓                                                     │
│   Plant new seeds in empty plots                             │
│        ↓                                                     │
│   (Optional) Visit shop, check festival event, talk to NPC   │
│        ↓                                                     │
│   Close game                                                 │
│        ↓                                                     │
│   Wait (30 min / 2 hrs / next day) ─────────┐                │
│        ↑                                     │                │
│        └─────────────────────────────────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Session length**: 3-10 minutes.
**Return cadence**: 1-3 times/day.

---

## Progression

### Player Level

Players gain XP from harvests. Each crop gives XP equal to its tier (tier 1 crops = 2 XP, tier 2 = 5 XP, etc).

| Level | XP Required (cumulative) | Unlock |
|-------|--------------------------|--------|
| 1     | 0                        | Starter: 4 plots, bok choy |
| 2     | 50                       | +2 plots, tomato, +5 East Points |
| 3     | 150                      | +2 plots, cucumber |
| 4     | 350                      | +2 plots, chili pepper, +5 East Points |
| 5     | 700                      | +2 plots (12 total), Chinese chive (multi-harvest) |
| 6     | 1200                     | Eggplant, +5 East Points |
| 7     | 2000                     | Garlic, decorations shop opens |
| 8     | 3000                     | Cilantro/coriander, +10 East Points |
| 9     | 4500                     | Special: festival crop boost |
| 10    | 6500                     | "Master Farmer" title, +20 East Points |

After level 10, more cosmetic milestones (no new crops in V1 to keep scope tight).

### Two-Currency Economy

| Currency | Symbol | Earn Rate | Use |
|----------|--------|-----------|-----|
| Coins | 🪙 | Plentiful — every harvest gives them | Seeds, decorations, plot upgrades |
| East Points | 🎫 | Scarce — ~3-5/day for engaged player | Real Eastern Market coupons |

**Why two currencies**: Coins keep the moment-to-moment game loop engaging (constant rewards). East Points are the dopamine drip toward real-world value. Player saves them up over weeks for a $5 coupon — small but real.

**East Point earn sources**:
- Daily login: 1 (streak multiplier up to 3×)
- Daily task completion: 1-2 per task
- Festival tasks: 5-10 per festival task
- Achievements: 5-20 per achievement
- Random harvest bonus: 5% chance of +1 per harvest

**Target rate**: A mom playing 10 min/day for a month earns ~100 East Points = one $5 coupon. Two coupons/month is sustainable and meaningful.

---

## Crop System

### Crop Properties

```json
{
  "id": "tomato",
  "name_zh": "番茄",
  "name_en": "Tomato",
  "icon": "🍅",
  "color": "#e94d3f",
  "tier": 2,
  "grow_minutes": 30,
  "seed_cost": 15,
  "sell_price": 60,
  "xp_reward": 5,
  "category": "fruit_vegetable",
  "season": "all",  // or "spring", "summer", etc
  "multi_harvest": false,
  "story_zh": "番茄是少有的能生吃的果蔬,凉拌番茄是夏天必备...",
  "story_en": "One of the few veg you can eat raw...",
  "recipe_zh": "番茄炒蛋:番茄+鸡蛋+葱花,5分钟出锅",
  "recipe_en": "Tomato stir-fried egg: tomato + egg + scallion, 5 min",
  "real_sku": "EM-VEG-TOMATO",
  "stages": 3,
  "festival_only": null
}
```

### V1 Crop List (8 crops)

| Tier | Name (zh/en)        | Grow Time | Seed  | Sell | Notes                       |
|------|---------------------|-----------|-------|------|-----------------------------|
| 1    | 上海青 / Bok Choy   | 5 min     | 5     | 20   | Starter crop                |
| 2    | 番茄 / Tomato       | 30 min    | 15    | 60   | Common, broad appeal        |
| 2    | 黄瓜 / Cucumber     | 30 min    | 15    | 60   |                             |
| 3    | 辣椒 / Chili        | 2 hours   | 30    | 150  | Iconic Sichuan ingredient   |
| 3    | 茄子 / Eggplant     | 2 hours   | 30    | 150  | Asian variety (long, thin)  |
| 4    | 韭菜 / Chive        | 4 hours   | 50    | 100×3| **Multi-harvest** — cuts 3× |
| 5    | 大蒜 / Garlic       | 12 hours  | 80    | 400  | Slow but profitable         |
| 5    | 香菜 / Cilantro     | 8 hours   | 60    | 250  | Polarizing flavor (joke!)   |

### Growth Stages

Every crop has 3 stages: seed (10% of grow time), sprout (50%), mature (100%).
- Stage 0: brown soil with small green dot
- Stage 1: small plant
- Stage 2: full crop with glow + tap prompt

### Multi-Harvest Mechanic (Chinese Chive)

韭菜 grows once, then can be harvested 3 times with 1-hour regrow each. Teaches the cultural fact: "韭菜越割越旺" (the more you cut, the more it grows). This is **culturally authentic** and a learning moment for kids.

### "No Wilting" Design

**Decision**: crops do NOT wilt or die if left too long. Mature crops just sit waiting. **Rationale**: 
- Original Happy Farm's wilt mechanic created anxiety. Mom comes home tired, opens game, finds 50% of crops dead. Bad UX.
- Mid-Autumn target audience wants *cozy*, not *punishing*.
- Removes need to send push notifications (great — we don't have a backend anyway).

---

## Festival Events

Full design in `docs/EVENTS.md`. Summary:

V1 launches with two festivals:

### Spring Festival (春节) — 14-day window

- Limited crops: 水仙 (narcissus, decoration), 年橘 (kumquat), 腊梅 (wintersweet)
- Red lantern decorations on farm UI
- Special task: "Plant the 8-treasure garden" → 5 East Points
- Storekeeper greetings in festival mode: "Year of the [X] is coming!"
- Possible real-world tie-in: in-store coupon for 八角 / star anise

### Mid-Autumn Festival (中秋) — 7-day window

- Limited crops: 芋头 (taro), 柚子 (pomelo), 桂花 (osmanthus)
- Moon visible in upper corner of farm
- Special task: "Mooncake plate" — harvest taro + pomelo + osmanthus together
- East Points doubled for limited crops

Future festivals (P2+):
- 清明 / Qingming (April) — 艾草 mugwort, story of 青团
- 端午 / Dragon Boat (May/June) — 粽叶, 糯米, 蜜枣
- 重阳 / Chongyang (October) — 菊花, "honor your elders" theme
- 冬至 / Winter Solstice (Dec) — 饺子 dumpling mini-event

---

## Task System

### Daily Tasks (3 per day, refreshes at midnight local time)

Templates in `data/tasks.json`. Randomly pick 3 each day.

Example templates:
```
plant_N_crops:    "Plant N [crop] today"  → 20 coins
harvest_N_crops:  "Harvest N [crop]"      → 30 coins + 1 East Pt
earn_N_coins:     "Earn N coins from harvests" → 1 East Pt
buy_N_seeds:      "Buy N seeds at the shop" → 15 coins
level_up:         "Reach level [N]"       → 5 East Pt (rare)
```

### Weekly Tasks (1 per week, refreshes Monday)

Bigger goals:
- "Harvest 50 crops this week" → 5 East Points
- "Try 3 different crops" → 3 East Points
- "Spend 500 coins" → 3 East Points

### Festival Tasks

Only active during festival window. Higher reward, themed.

---

## Storekeeper NPC

A character in the bottom-left corner of the farm screen. Can be:
- A cartoon avatar of Chris (recommended — adds personal touch)
- A generic "store owner" character

**Behavior**:
- Idle: small wave animation, speech bubble preview
- Tap: opens dialog with greeting + 1-2 action buttons

**Greeting pool** (rotated): see `i18n.json`.
- Morning vs evening
- New player vs returning
- Festival mode (different pool)
- Level milestones ("Great job reaching level 5!")
- Suggestion based on farm state ("You have empty plots — try planting cucumber!")
- Cross-promote: "Real bok choy at Eastern Market this week: $1.99!"

**Important**: greetings should feel like a warm shop owner, not a sales agent. **One in every 5 should be totally unrelated to selling** — just a chat. E.g., "Did you know the Bessborough Hotel was opened in 1935?" Adds personality, builds parasocial warmth.

---

## Eastern Market Integration

Two integration layers in V1:

### Layer 1: Brand presence (always-on)

- Game title: "Eastern Farm" / "东方农场" with Eastern Market logo in corner
- Storekeeper character represents the store
- Crops show "Available at Eastern Market" tag with real SKU
- Splash screen says "made by Eastern Market"

### Layer 2: Coupon exchange (V1 ships with this)

- East Points exchange shop: 100 pts → $5 off coupon
- Codes pre-generated, validated manually by cashier
- Each player can redeem max 1 coupon/week (anti-abuse)

### Layer 3: Live SKU/promo integration (V2 — NOT in V1)

- Game pulls weekly specials from a JSON file Chris updates
- Storekeeper says: "Real X is on sale this week, $Y/lb!"
- Festival crops align with in-store festival promotions

### Layer 4: Clover POS API (V3 — Future)

- Customer scans QR at checkout, real shopping earns East Points
- Real-time coupon validation
- Loyalty integration

---

## Visual Design

### Color Palette

```css
--cream-bg:       #fdf8ee;  /* Page background */
--soil-brown:     #8b5a3c;  /* Empty plot */
--leaf-green:     #6ab04c;  /* Healthy crop */
--mature-glow:    #f7c948;  /* Ripe crop highlight */
--barn-red:       #c44536;  /* Eastern Market brand red, accents */
--sky-blue:       #88c8e8;  /* Background accents */
--warm-text:      #3a2e26;  /* Body text */
--gold-coin:      #f1c40f;  /* Coin currency */
--purple-points:  #9b59b6;  /* East Points currency */
```

### Typography

```css
--font-zh: 'Noto Sans SC', 'PingFang SC', sans-serif;
--font-en: 'Plus Jakarta Sans', 'Quicksand', sans-serif;
--font-display: 'ZCOOL KuaiLe', 'Plus Jakarta Sans', cursive; /* for titles */
```

### Layout (mobile-first, 360-430px width)

```
┌─────────────────────────────┐
│ 🪙 250  🎫 12     [Lv 3 ▰▰▱]│ ← top bar (currency + level)
├─────────────────────────────┤
│                             │
│   ▢ ▢ ▢ ▢                  │ ← 4×3 plot grid
│   ▢ ▢ ▢ ▢                  │
│   ▢ ▢ 🔒 🔒                  │
│                             │
├─────────────────────────────┤
│  🛒 Shop  📋 Tasks  🎫 Rewards│ ← bottom action bar
├─────────────────────────────┤
│ 👨 [Storekeeper says: "..."] │ ← NPC slot
└─────────────────────────────┘
```

### Animation Principles

- Tap feedback: scale 1 → 0.95 → 1, 100ms
- Crop grow: soft fade-in stage-to-stage
- Harvest: small particle burst (sparkles), +N coin text floats up
- Festival decoration: gentle sway / sparkle loop
- No jarring motion. No flashing. Calm.

---

## Audio (V2 — not in V1 MVP)

When added:
- Light ambient bgm (one track, looped, can be muted)
- Plant sound: soft *tap*
- Harvest sound: gentle *pop* + sparkle chime
- Task complete: short cheerful jingle
- Festival activation: themed motif (春节 → suona excerpt, 中秋 → guqin note)

All sounds either WebAudio synth or <50KB MP3.

---

## Open Design Questions (for Chris)

1. **Should there be a "send to Eastern Market" mechanic** where the player chooses to donate their harvest in exchange for bonus East Points? Mechanically interesting (gives meaning to crops beyond cash) but adds complexity. Defer to V2?

2. **Family co-op**: should mom and kid share one farm, or have separate ones with the ability to "visit"? V1 says single-farm-per-device, V2 explores.

3. **Real-world recipe tutorials**: should clicking a crop's "recipe" link open a recipe page on the Eastern Market website? Would require a website to link TO. Discuss with Chris.

4. **Avatar customization**: let players choose their farmer avatar (mom/kid/grandma)? Small effort, big personalization payoff. Probably worth doing in V1.

5. **Tutorial flow**: first-time players need guidance. Pop-up tooltips or storekeeper-led intro? Recommend storekeeper-led (consistent with NPC's role as warm guide).
