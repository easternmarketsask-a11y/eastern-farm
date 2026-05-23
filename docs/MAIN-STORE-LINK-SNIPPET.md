# Adding a "玩快乐农场" link from the main store site

The game side already has links back to https://easternmarket.ca/
(brand-bar logo + settings panel). For the reverse direction, you
need to add an entry point in the main store React app
(`EasternMarket_app`). A few placement options below — pick whichever
fits your layout and screen real estate.

## Option A — Header nav item (most discoverable)

In `frontend-web/src/components/TTHeader.tsx`, add a nav button:

```tsx
<a
  href="https://farm.easternmarket.ca/"
  className="text-sm font-medium text-green-700 hover:text-green-900 flex items-center gap-1"
>
  🌱 玩快乐农场
</a>
```

Place it next to the existing nav items.

## Option B — Homepage promo card (more visual)

In `frontend-web/src/pages/HomePageV8.tsx`, add a card section under the
hero carousel:

```tsx
<a
  href="https://farm.easternmarket.ca/"
  className="block mx-4 my-6 rounded-2xl p-5 bg-gradient-to-br from-green-50 to-amber-50
             border-2 border-green-200 shadow-sm hover:shadow-md transition-all"
>
  <div className="flex items-center gap-4">
    <div className="text-5xl">🌾</div>
    <div className="flex-1">
      <div className="text-lg font-bold text-green-800">
        东方超市·快乐农场
      </div>
      <div className="text-sm text-gray-600 mt-1">
        玩游戏赚积分 · 积分等同会员积分 · 可在店内兑换
      </div>
    </div>
    <div className="text-2xl text-green-600">→</div>
  </div>
</a>
```

## Option C — Member dashboard card (targeted)

In `frontend-web/src/pages/MemberCenter.tsx`, near the points display,
add a card that says "玩游戏多赚积分":

```tsx
<a
  href="https://farm.easternmarket.ca/"
  className="block rounded-xl p-4 bg-amber-50 border border-amber-200 hover:bg-amber-100"
>
  <div className="flex items-center gap-3">
    <span className="text-3xl">🌱</span>
    <div>
      <div className="font-semibold text-amber-900">玩快乐农场 +赚积分</div>
      <div className="text-xs text-amber-700">
        种菜收获自动入您的会员账户
      </div>
    </div>
  </div>
</a>
```

## Option D — Bottom-mobile-nav button (Eastern Market app pattern)

If you have `MobileNavBar.tsx` (the bottom tab bar referenced in CLAUDE.md),
add a 5th tab or replace an underused one:

```tsx
<a
  href="https://farm.easternmarket.ca/"
  className="flex flex-col items-center gap-0.5 px-3 py-2"
>
  <span className="text-2xl">🌱</span>
  <span className="text-xs text-gray-700">农场</span>
</a>
```

## Recommendation

**Option B (homepage card) + Option A (header nav)** together:
- The homepage card catches first-time / returning shoppers
- The header nav keeps it accessible from anywhere in the app

Both are static `<a target="_blank">` — no need to import anything new,
no Firebase calls, no behavior changes to the main store. Just markup.

Note that `target="_blank"` opens the game in a new tab so the user
doesn't lose their shopping session. On mobile this defaults to a new
view that's easy to swipe back from.

Once added, deploy the main store as usual (GitHub Actions → Firebase
Hosting). Game side is already deployed.

## Same-tab navigation (per Chris)

All snippets above use plain `<a href>` with no `target` attribute, so
clicking navigates in the same tab. This matches the game-side behavior
where tapping the brand-bar logo navigates back to easternmarket.ca in
the same tab. If you later want the link to open in a new tab instead
(e.g. to preserve shopping cart state on the store side), add
`target="_blank" rel="noopener noreferrer"` back to the specific link.

