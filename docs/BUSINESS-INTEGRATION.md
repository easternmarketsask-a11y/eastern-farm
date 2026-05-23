# Business Integration

How Eastern Farm connects to the real Eastern Market store, and how that
connection evolves across V1 → V2 → V3.

---

## Philosophy

The integration is **gentle**, not aggressive. The game must feel like a
warm gift from the store to its customers, not a marketing funnel. If a
customer never redeems a single coupon, they should still enjoy the game.
If they do redeem, the experience must be smooth.

**Three rules**:
1. The game stands on its own — playable without ever visiting Eastern Market
2. Brand presence is ambient — logo and store name appear naturally, not
   every screen
3. Real-world rewards are real — codes work, cashiers honor them, no fine print

---

## V1 — Brand Presence + Manual Coupon (Launch)

### What's live in V1

| Touchpoint | Implementation |
|---|---|
| Game title | "Eastern Farm" / "东方农场" with subtitle hint |
| Storekeeper character | Represents Eastern Market personality (warm shopkeeper) |
| Crop info screen | Shows "Available at Eastern Market — SKU EM-VEG-X" tag |
| Storekeeper greetings | Occasional store mention ("Bok choy in this week") |
| Festival decorations | Aligned with store festival promotions |
| East Points → Coupons | Pre-generated codes, manual cashier validation |

### Manual coupon validation flow

```
Player redeems 100 East Points
  ↓
Game picks unused code from data/coupons.json (e.g. EMFARM-A4F8K2)
  ↓
Game displays code with $5 off label
  ↓
Player screenshots the code
  ↓
Player visits Eastern Market, presents code at checkout
  ↓
Cashier validates:
  1. Looks code up against active code list (printout or spreadsheet)
  2. If valid + unused: marks used in spreadsheet, applies $5 discount
  3. If already used or invalid: politely declines, can offer rain check
```

### Operational setup needed before launch

1. Print or maintain the master code list (spreadsheet, monthly export from
   `data/coupons.json`)
2. Train cashiers (5-minute briefing): "If a customer shows an EMFARM-XXX
   code, look it up, cross off used ones"
3. Define expiration: V1 default is 30 days from redemption date
4. Decide max coupons per customer per week: V1 recommends 1
5. Plan for restock: generate new batch monthly via `scripts/gen_coupons.py`

### Anti-abuse considerations

- One code can only be used once (state tracks per-device)
- Players cannot game the system without serious effort (would require
  modifying localStorage manually — possible but high-friction)
- If a code is leaked or shared: rate-limit by date, kill code if abused
- V1 doesn't need server-side fraud prevention (too expensive for the volume)

### Promotional alignment

Eastern Market's existing weekly/festival promotions should be reflected
in the storekeeper. For example, if Chris is running a "Korean groceries
sale" week, the storekeeper can mention it (this can be a manual update
to `i18n.json` storekeeper pool).

V1 has no live data feed; promo messages are baked into the build.

---

## V2 — Storekeeper Live Promo + East Point Stacking (3-6 months post-launch)

### Goals
- Storekeeper messages refresh weekly without code releases
- East Point accumulation tied to a player's real Eastern Market activity
  (via a simple manual mechanism)

### Implementation ideas

**Live storekeeper messages**:
- Add `data/store-promos.json` hosted on a static URL Chris controls
  (could be GitHub Pages, S3, even Google Drive public link)
- Game fetches this JSON on startup; falls back to hardcoded pool if
  network fails
- Chris edits the JSON weekly to add 2-3 fresh promo lines

**Manual East Point top-up**:
- "Receipt entry" feature: player takes a photo of their Eastern Market
  receipt → uploads (or shows at checkout) → cashier issues a code for
  East Points worth ~1 point per dollar spent
- Customer enters code in game → East Points added
- Same pre-generated-code model as coupons, but reversed (store→player)

This bridges "play the game" and "shop at the store" without requiring
POS integration.

### What V2 is NOT

- Still no real-time API to Clover
- Still no user accounts (everything device-local)
- Still no push notifications
- Still no payment processing

---

## V3 — Clover POS Integration (Future, when stable)

### Vision

Customer shops at Eastern Market → at checkout, scans a QR code from the
game → real-time East Points credited based on purchase amount.

Coupon redemption: customer shows game code → cashier scans → POS validates
+ applies discount automatically.

### Technical requirements

- Clover API access (Chris has POS administrator access already)
- A small backend service to:
  - Issue + validate codes
  - Track per-customer East Point balance
  - Mediate between game (client) and Clover (POS)
- User account system (so points persist across devices)
- Privacy & data handling policy (Chris should consult Canadian PIPEDA
  basics)

### Why this is V3, not V1

- Backend = ongoing maintenance + hosting cost
- User accounts = friction (kid-friendly games don't want sign-ups)
- Clover API integration time: 4-8 weeks
- All of this is worth it ONLY IF V1+V2 prove the game has retention

### Decision gate

Move to V3 when:
- V1 has >100 weekly active users for 2+ months
- Customers ask for cross-device sync
- Manual coupon redemption is becoming an operational burden

If V1 fizzles (lessons learned, but it happens), V3 never gets built. No
sunk-cost issue because V1 was built with this exit ramp in mind.

---

## SKU Data Sync (V2)

`data/crops.json` includes `real_sku` per crop. V2 could automate matching:

1. Chris exports Eastern Market inventory from Clover (weekly CSV)
2. A script converts to `data/store-inventory.json`:
   ```json
   {
     "EM-VEG-TOMATO": {
       "price_cad": 2.99,
       "on_sale": false,
       "in_stock": true,
       "weekly_special_text": null
     }
   }
   ```
3. Game's crop info card pulls live data: "Currently $2.99/lb · in stock"
4. If on sale: highlight with a flash icon

The script is straightforward Python (already in Chris's wheelhouse). The
JSON is static-hosted (no backend needed for read-only data).

---

## Customer Lifecycle (Designed Outcome)

What we want to happen over time:

**Week 1**: Customer learns the game exists (sticker on Eastern Market door,
or QR code at checkout: "Free game from Eastern Market — try it!"). Plays
once or twice.

**Week 2-4**: Continues playing because the bok choy growth loop is
satisfying. Notices the storekeeper mentions real store stuff. Casually
plans grocery list around what's in the game.

**Month 2**: First East Points coupon redemption ($5 off). Comes to store
specifically to use it. Cashier honors it warmly.

**Month 3+**: Festival event hits (e.g., Mid-Autumn). Special task draws
them in. Kid asks mom why they're growing taro. Mom explains. Bonding moment.

**Long term**: The game becomes a small ambient thing in their life. Not
"a thing they have to do" but "a thing they like checking on." Eastern
Market becomes "our grocery store" not just "a grocery store."

That's the goal. Build the game so this lifecycle is possible — even if
only 20% of players go through it, that's still meaningful.

---

## Metrics to Track (V2)

Once we have backend telemetry (or even client-side reporting):

- DAU / WAU / MAU (engagement)
- Day 1, Day 7, Day 30 retention
- Average session length
- East Points earned vs redeemed (does economy work?)
- Festival event engagement (what % play during a festival window?)
- Coupon redemption → store visit attribution (manual: cashier asks)

V1 has no analytics. Add only after launch when we have something to measure.

---

## Anti-Patterns to Avoid

- ❌ Loot boxes / gambling mechanics
- ❌ "Pay to skip" timers (no real-money in V1, ever)
- ❌ Push notifications that pressure ("Your bok choy is wilting! Come back!")
  — and we don't have wilting at all (per design)
- ❌ Selling player data
- ❌ Targeted ads from third parties
- ❌ Anything that makes a 7-year-old or a 50-year-old uncomfortable
