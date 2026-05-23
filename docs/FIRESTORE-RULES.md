# Firestore Security Rules — Eastern Farm member sync

These rules let the game (farm.easternmarket.ca) write EP earn events to
the **same** `eastern-market-members` Firestore project that the main
easternmarket.ca site already uses. The rules go in the **main store
repo** (`EasternMarket_app/firestore.rules`), not in this game repo, because
that's where Firebase Hosting deploys from.

---

## Prereq: enable login on the game subdomain

Before any Firebase Auth login from the game will work, **Chris must**
add `farm.easternmarket.ca` to the project's authorized domains:

1. Open https://console.firebase.google.com/project/eastern-market-members/authentication/settings
2. Scroll to **Authorized domains**
3. Click **Add domain** → enter `farm.easternmarket.ca` → save

Without this step, every login attempt from the game errors out with
`auth/unauthorized-domain`. The game shows a friendly admin-targeted
message in that case, so it's safe to ship before the domain is added —
players just can't sign in yet.

---

## Rules to add

Open `EasternMarket_app/firestore.rules`. Add (or extend) these blocks
inside `match /databases/{database}/documents { ... }`:

```javascript
// ============ Game EP sync (Eastern Farm v1.2+) ============

// members/{uid}: owner can read; owner can update ONLY totalPoints /
// lifetimePoints / updatedAt (prevents game from rewriting name, tier,
// phone, etc). Existing main-store rules for create/admin remain.
match /members/{uid} {
  allow read: if request.auth != null && request.auth.uid == uid;

  allow update: if request.auth != null
    && request.auth.uid == uid
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['totalPoints', 'lifetimePoints', 'updatedAt'])
    // Anti-abuse: increments only, no decrement, max +500 per write
    && request.resource.data.totalPoints >= resource.data.totalPoints
    && request.resource.data.totalPoints <= resource.data.totalPoints + 500
    && request.resource.data.lifetimePoints >= resource.data.lifetimePoints
    && request.resource.data.lifetimePoints <= resource.data.lifetimePoints + 500;
}

// points_transactions: owner can create earn events from the game, with
// hard caps. Read only own.
match /points_transactions/{txId} {
  allow read: if request.auth != null
    && resource.data.memberId == request.auth.uid;

  allow create: if request.auth != null
    && request.resource.data.memberId == request.auth.uid
    && request.resource.data.type == 'earn'
    && request.resource.data.source == 'game:farm'
    && request.resource.data.points is int
    && request.resource.data.points > 0
    && request.resource.data.points <= 500
    && request.resource.data.eventId is string
    && request.resource.data.eventId.size() > 0;

  // No update / delete from the client — only admin / Cloud Functions.
}
```

---

## Deploy

In the main store repo (`EasternMarket_app/`):

```bash
firebase deploy --only firestore:rules --project eastern-market-members
```

Verify in console:
https://console.firebase.google.com/project/eastern-market-members/firestore/rules

---

## What the game writes

For each EP earn event the game does ONE Firestore transaction containing
two operations:

1. **Update** `members/{uid}`:
   - `totalPoints` += amount
   - `lifetimePoints` += amount
   - `updatedAt` = serverTimestamp()

2. **Create** `points_transactions/{auto-id}`:
   ```json
   {
     "memberId": "<auth uid>",
     "type": "earn",
     "points": 5,
     "source": "game:farm",
     "subSource": "daily_login",   // or harvest_jackpot / achievement_X / lottery / coin_exchange / first_login_backfill / unknown
     "description": "每日登录第 8 天",
     "eventId": "uuid-v4",         // for client-side idempotency
     "createdAt": "<serverTimestamp>"
   }
   ```

Subsource values currently used:
- `first_login_backfill` — one-time backfill of pre-login local EP (cap 100 per account)
- `daily_login`, `harvest_jackpot`, `harvest_first_of_day`, `harvest_weekend`, `harvest_lucky`, `harvest_festival`
- `achievement_<id>`
- `task_<template>`
- `lottery_wheel`
- `coin_exchange`
- `neighbor_visit`, `news_read`
- `unknown` (legacy / not yet labeled)

---

## What the game does NOT do

- ❌ Never decrements `totalPoints` (redemption happens at POS, not in game)
- ❌ Never modifies other member fields (name, tier, phone)
- ❌ Never creates / deletes member docs (registration is in-store)
- ❌ Never writes to other users' documents

If we later need redemption from the game (V3), it'll go through a Cloud
Function, not directly from the client.

---

## Defense-in-depth

The 500-per-transaction cap is a hard rule. Combined with the client-side
1000 EP/day cap, the worst a single client can do is grind ~1000 EP/day
into their own account. Even if a client bypasses the client cap (e.g.
by changing the localStorage `epDailyCap` field), the server cap holds.

If we see abuse beyond that:
- Add a Cloud Function trigger on `points_transactions/{txId}` create
- It can re-check the per-day sum across all events in the user's history
- Adjust the member doc back down + flag the transaction

Stub for that function is in `functions/src/validateGameEarn.ts` (V2,
not yet implemented).
