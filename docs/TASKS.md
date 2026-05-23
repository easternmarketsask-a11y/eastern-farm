# Tasks — Prioritized Work Queue

This is the work queue. Do P0 in order, then P1, then P2. Each task includes
acceptance criteria — verify before moving on.

---

## P0 — Core Loop (Week 1-2)

The game must be playable end-to-end after P0 is done. No festivals, no
tasks, no NPC — just: plant → grow → harvest → sell → buy seed → repeat.

### Task 0.1: Project skeleton & state foundation

**Files to create**: `src/index.html`, `src/css/style.css`, `src/js/main.js`,
`src/js/state.js`.

- HTML page with viewport meta for mobile, single `<div id="app">`
- CSS resets, base font import (Noto Sans SC + Plus Jakarta Sans), cozy color
  vars (`--color-bg`, `--color-primary`, etc.)
- `state.js` exposes `Farm.state` with:
  ```
  { version: 1, coins: 100, eastPoints: 0, level: 1, xp: 0,
    plots: [{id, crop, plantedAt, stage}, ...12 items],
    seeds: { qingcai: 5 },
    lastLogin: <timestamp>, language: 'zh' }
  ```
- Save to `localStorage` key `eastern_farm_save_v1` on every state mutation
- Load + migrate on startup; default starter state if no save exists

**Acceptance**: Load page → check console: `Farm.state` exists with starter
values. Mutate `Farm.state.coins += 100`, reload page, coins persisted.

### Task 0.2: Farm grid view

**Files**: `src/js/farm.js`, `src/js/ui.js`, `src/css/style.css`.

Render the 12 plots (start with 4 unlocked, 8 locked) as a 4×3 grid.
- Each plot is a tappable card showing: empty (brown soil), growing (crop
  emoji + progress), or mature (crop + ✨ glow + tap-to-harvest)
- Locked plots show a 🔒 with "Lv X required to unlock"
- Plot cards use rounded corners, drop shadow, ~80×80px on phone

**Acceptance**: Open page, see 4 plots in 4×3 grid (8 locked). Cards look
cozy, not generic.

### Task 0.3: Crops data + planting flow

**Files**: `data/crops.json`, `src/js/crops.js`.

`crops.json` schema (start with these 8):

```json
{
  "qingcai": {
    "id": "qingcai",
    "name_zh": "上海青",
    "name_en": "Bok Choy",
    "icon": "🥬",
    "grow_minutes": 5,
    "seed_cost": 5,
    "sell_price": 20,
    "xp_reward": 2,
    "category": "leaf",
    "story_zh": "上海青是炒饭的好搭档...",
    "story_en": "A staple in Cantonese stir-fries...",
    "real_sku": "EM-VEG-001",
    "stages": 3
  },
  ...
}
```

Implement in `crops.js`:
- `plantSeed(plotId, cropId)` — deducts seed, sets plot
- `getStage(plot)` — returns 0/1/2 based on elapsed time
- `harvest(plotId)` — credits coins + xp + East Point chance (5%)
- Crops mature in real time (use `Date.now()` diff against `plantedAt`)

**Acceptance**: Tap empty plot → seed picker opens. Pick bok choy. Plot
shows growing. Wait 5 min (or hack `plantedAt` to test) → plot shows mature.
Tap → coins increase, plot resets to empty.

### Task 0.4: Seed shop

**Files**: `src/js/shop.js`, UI overlay.

A modal that shows all crops player can afford. Buy 1, 5, or 10 at a time.

**Acceptance**: Open shop, buy 5 bok choy seeds for 25 coins (5×5). Coins
decrease, seed inventory shows 5.

### Task 0.5: Sell harvested crops (auto)

For V1 simplicity, **harvest = instant sell**. Player gets coins immediately
when tapping a mature plot. (Later we may add a "store" mechanic where they
can choose to sell now or hold for prices.)

**Acceptance**: After harvest, coins go up by the crop's `sell_price`.

### Task 0.6: Player level + XP

XP from harvests. Level thresholds: 0, 50, 150, 350, 700, 1200, 2000...
Each level unlocks: 1-2 more plots, 1 new crop, 1 milestone reward (5 East
Points).

Show level bar at top of screen.

**Acceptance**: Harvest enough bok choy to hit level 2. Toast: "🎉 Level 2!
+2 plots unlocked, +5 East Points". Next plots become tappable.

### Task 0.7: Bilingual toggle

**Files**: `src/js/i18n.js`, `data/i18n.json`.

EN/中文 toggle in settings. All static UI strings go through
`Farm.i18n.t('key')`. Crop names use `name_zh` / `name_en` from crops.json
based on `state.language`.

**Acceptance**: Toggle language. UI flips between 中文 and English. Setting
persists.

---

## P1 — Engagement Features (Week 3-4)

After P0, players can play but won't return. P1 builds reasons to come back.

### Task 1.1: Daily login bonus

On first open of the day (date string different from `lastLogin`):
- Toast: "🌅 Welcome back! Day N consecutive login"
- Award: 10 coins + 1 East Point (consecutive days multiply: ×2 day 7,
  ×3 day 14, etc.)
- Update `lastLogin`

**Acceptance**: Open today → bonus shows. Open again same day → no bonus.
Set system date to tomorrow → bonus shows, day count increments.

### Task 1.2: Daily task system

**Files**: `src/js/tasks.js`, `data/tasks.json`.

3 random daily tasks each day. Examples:
- "Plant 3 bok choy" → reward 20 coins
- "Harvest 5 tomatoes" → reward 30 coins + 1 East Point
- "Earn 100 coins from harvests" → reward 1 East Point

Tasks reset at local midnight. Show in a "📋 Today's Tasks" panel.

**Acceptance**: Open game, see 3 tasks. Plant bok choy 3 times, task ticks
to "3/3 ✅", auto-claims reward.

### Task 1.3: Storekeeper NPC

**Files**: `src/js/storekeeper.js`.

A character (Chris cartoon-avatar?) in the corner with a speech bubble.
Greeting rotates daily/weekly.

Greetings tied to context:
- Festival days: "Spring Festival is in 3 days! Plant kumquats now to
  harvest in time."
- Weekly tip: "Bok choy and garlic stir-fry — try it this weekend!"
- Sales callout: "Real bok choy at Eastern Market today: $1.99/lb!"
- New player: "Welcome! Tap the brown plot to plant your first seed."

Static greetings in `i18n.json` for V1; randomize from a pool.

**Acceptance**: Different greeting each session. Tap NPC → dialog with 1-2
buttons (e.g., "View today's task" / "Got it").

### Task 1.4: First festival event — Spring Festival (春节)

**Files**: `src/js/events.js`, `data/events.json`.

Detect: if `today` is within 14 days of Spring Festival → activate event:
- Limited-time crops appear in shop: 水仙 (narcissus), 年橘 (kumquat),
  腊梅 (wintersweet) — for decoration not eating, but earn 2× East Points
- Red lantern decoration appears on top corner of farm
- Special task: "Harvest 3 kumquats" → reward 5 East Points + festival
  achievement
- Storekeeper rotates festival greetings

**Acceptance**: Manually set system date to Chinese New Year - 7 days.
Event activates, festival crops in shop, decorations visible. Move date
past festival, returns to normal.

### Task 1.5: Second festival event — Mid-Autumn (中秋)

Similar structure: limited-time crops (芋头, 柚子, 桂花), moon decoration,
special task ("Make a mooncake plate" — harvest taro + pomelo + osmanthus).

### Task 1.6: East Points coupon redemption

**Files**: `src/js/rewards.js`, `data/coupons.json`.

`coupons.json` is a pre-generated list:
```json
[
  { "code": "EMFARM-A4F8K2", "value": 5, "points": 100, "used": false },
  { "code": "EMFARM-X9P3Q7", "value": 5, "points": 100, "used": false },
  ...
]
```

When player taps "Exchange 100 East Points for $5 off":
- Confirm dialog: "Use 100 East Points for a $5 Eastern Market coupon?"
- On confirm: deduct points, mark coupon as used in localStorage, show:
  ```
  ┌─────────────────────────────┐
  │  Your Eastern Market Coupon │
  │                             │
  │      EMFARM-A4F8K2          │
  │       $5 OFF                │
  │                             │
  │  Show this code at checkout │
  │  Valid until [date]         │
  │  [Screenshot to save]       │
  └─────────────────────────────┘
  ```

V1 trust model: code generation + screenshot. Cashier validates manually
(write the code down or have a checklist).

**Acceptance**: 100 East Points exchange → coupon code displays, point
balance drops. Cannot reuse same code (state tracks redemptions).

---

## P2 — Polish & Depth (Month 2)

### Task 2.1: Crop catalog / 蔬菜图鉴

A "collection" screen showing all crops, locked silhouettes for ones not
yet grown. Each entry shows the cultural story, real-world tip, and recipe
suggestion. Achievement: "Catalog Complete" → 20 East Points.

### Task 2.2: Achievements

10-15 achievements: "First Harvest", "Level 5 Farmer", "Festival Master",
"100 Crops Harvested", "Try All 8 Crops", etc. Each awards East Points.

### Task 2.3: Decorations

Player can spend coins on farm decorations: 灯笼 (lanterns), 风车 (windmill),
石头 (stones), 红包树 (red envelope tree). Purely cosmetic, but gives long-term
spending sinks.

### Task 2.4: Better crop sprites

Replace emoji with proper SVG art. Run `scripts/gen_crop_svgs.py` or
hand-author. Each crop has 3 growth stages.

### Task 2.5: Sound design

Soft ambient music (one looped track), pleasant harvest sound, gentle
task-complete chime. WebAudio synth or small MP3s (~50KB each).

### Task 2.6: Recipe tips integration

Inside each crop's detail view, show a short recipe using that crop +
1-2 other Eastern Market products. "Bok Choy + Garlic + Sesame Oil →
3-minute stir-fry. All 3 available at Eastern Market."

---

## P3 — Wishlist (Future)

- Real-time multiplayer farms (friend visit)
- Backend (Firebase/Supabase) for user accounts + cross-device sync
- Push notification "Your bok choy is ready!"
- Clover POS integration for real-time East Points from real shopping
- Native app wrapper (Capacitor/PWA)
- More crops (Asian eggplant, lotus root, daikon, ...)
- Mini-games (cook a dish, pack a 年货 gift box)
- Customer-submitted recipes
- Family co-op: parent + kid share one farm
