# Festival Events

Festivals are the heart of Eastern Farm's cultural authenticity and its
main "return-after-a-month" hook. Each festival is a 1-3 week window where
limited crops, decorations, and themed tasks appear.

---

## Design Philosophy

1. **Real festivals only**: no made-up "Farm Fest". The whole point is
   reinforcing actual Chinese culture for kids growing up in Canada.

2. **Tied to the lunar calendar correctly**: hardcoded date windows for the
   next 3 years to avoid lunar-conversion bugs in V1. Update windows yearly.

3. **Cultural authenticity over game mechanics**: a festival is a chance for
   the storekeeper to share a story or recipe. The game is the vehicle, not
   the destination.

4. **Mom + kid moment**: festival activities should be something they
   discuss together. "Why is the kumquat lucky?" is a great question for
   mom to answer.

5. **Quietly drives store sales**: festival crops align with real promotional
   periods at Eastern Market — mooncakes for Mid-Autumn, dumpling supplies
   for Spring Festival.

---

## V1 Festivals (Launch Set)

### 春节 / Spring Festival — 21 days

**Window**: see `data/events.json` for exact lunar dates per year.

**Visual changes**:
- Red lantern emoji 🏮 in upper corners
- Subtle spring couplets along the screen border (optional, V2)
- Storekeeper avatar can wear a small red hat or carry a red envelope

**Limited crops** (only available during the window):
- 水仙 / Narcissus — decorative, doesn't sell well in coins but gives bonus
  East Points
- 年橘 / Kumquat — both decorative AND profitable

**Special task**:
- "Harvest 3 kumquats for good fortune" → 50 coins + 5 East Points
- "Collect all Spring Festival limited crops" → 10 East Points (the big one)

**Storekeeper greetings** (rotate during festival):
- "新年快乐! 今年是 [zodiac] 年." / "Happy Lunar New Year!"
- "春节限定的水仙花已经上架啦, 10 天就开花."
- "腊月二十三小年到, 东方超市的年货货架已经摆好了."
- "记得吃饺子! 游戏里种的韭菜可以包饺子馅."

**Real-world tie-in promo idea** (V2):
- In-store: "Show this game screenshot at checkout for 10% off 八角 star anise"
- This is opt-in marketing, not forced.

---

### 中秋 / Mid-Autumn — 11 days

**Window**: lunar 8/15 ±5 days. Hardcoded in `events.json` for 2026-2028.

**Visual changes**:
- A glowing 🌕 full moon in upper-right of farm
- Slow-drift osmanthus petals animation (V2 polish)
- Storekeeper can mention "tonight is the brightest"

**Limited crops**:
- 芋头 / Taro
- 柚子 / Pomelo
- 桂花 / Osmanthus

**Special task — "Mooncake Plate"**:
Harvest all three festival crops within the window → 8 East Points.

This is **the** event task — culturally meaningful (each crop is a real
Mid-Autumn food), rewards effort, and teaches kids what's on the table.

**Storekeeper greetings**:
- "中秋节快乐! 今晚月亮特别圆."
- "拼齐芋头 + 柚子 + 桂花, 就是一盘中秋的家."
- "东方超市的月饼已经到货——双黄莲蓉、抹茶豆沙、海盐流心."
- "「八月桂花遍地开」——你的农场也种一棵吧."

**Real-world tie-in**:
- In-store: mooncake gift box display. Game completion = small token offer
  (sticker, tea pack).

---

## P1-P2 Festivals (Add After V1 Launch)

### 清明 / Qingming — 8 days, early April
- Theme: spring cleaning, ancestor remembrance, mugwort/青团
- Limited crop: 艾草 (mugwort)
- Mini-game (V2): make green rice balls (青团) by harvesting mugwort
- Tone: quiet, respectful. Not a "party" festival.

### 端午 / Dragon Boat — 8 days, May/June
- Theme: zongzi, dragon boats, salted duck eggs
- Limited crops: 粽叶 (bamboo leaves), 糯米 (sticky rice — abstracted as a
  crop), 蜜枣 (jujube)
- Mini-game (V2): wrap a zongzi (drag and drop ingredients into a leaf wrap)
- Real-world: Eastern Market sells fresh-made zongzi during the festival

### 重阳 / Chongyang (Double Ninth) — 5 days, October
- Theme: honor the elderly, chrysanthemum, mountain climbing
- Limited crops: 菊花 (chrysanthemum), 茱萸 (cornel)
- Special task: "Call your grandparents" — toast-only, no in-game reward,
  just a gentle reminder
- The storekeeper says one warm line and moves on

### 冬至 / Winter Solstice — 5 days, December
- Theme: dumplings (north) / tangyuan (south)
- Mini-game (V2): fold a dumpling — quick rhythm minigame
- Cultural duality: serves both northern and southern Chinese traditions

### V3 — Western/Canadian crossover (optional)
- Canadian Thanksgiving (October): pumpkin, corn
- Lunar New Year overlap with Valentine's Day: storekeeper can quip
- These are debatable — keep the game culturally focused first.

---

## Implementation Notes

### Date handling
Always use **local time** for date comparisons. A festival "starts" at
00:00 local time on the start date and "ends" at 23:59 local on end date.

### Window definitions (`data/events.json`)
- Lunar festivals (Spring, Mid-Autumn, Dragon Boat, Chongyang): hardcode
  exact dates per year, 3 years out. Update yearly.
- Solar festivals (Qingming around April 4-6, Winter Solstice Dec 21-23):
  can use `start_mmdd`/`end_mmdd` and apply to any year.

### Adding a new festival
1. Add event entry to `data/events.json`
2. Add any new festival crops to `data/crops.json` under `_festival_crops`
3. Add a couple of storekeeper greetings in `_storekeeper_greetings_zh/en`
4. Add a festival-specific task template (optional) in `data/tasks.json`
5. Test by manually setting system clock to within the window
6. Verify decorations appear, festival crops show in shop, tasks unlock

### Don't over-engineer
V1 has hardcoded festival logic in `src/js/events.js`. That's fine. Once
the game has 4+ festivals, refactor to fully data-driven from `events.json`.
Premature abstraction here would cost time without value.

---

## What festivals should NOT do

- ❌ Force the player to log in daily during the window (no FOMO mechanics)
- ❌ Make festival crops *required* for progression
- ❌ Be aggressively promotional ("buy mooncakes NOW")
- ❌ Use deals/discounts as the primary engagement (it's a game, not a flyer)
- ❌ Trivialize the festival ("Spring Festival = double XP!" misses the point)

What festivals SHOULD do:
- ✅ Make the player feel "oh, it's that time of year"
- ✅ Teach kids something via a one-line storekeeper greeting
- ✅ Reward existing players with limited content and a "I was here" badge
- ✅ Gently align with what's actually happening at Eastern Market
