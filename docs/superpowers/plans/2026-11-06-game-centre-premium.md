# Game Centre Premium Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the game selector, Eastern Farm and Tonight's Table to the approved premium visual and interaction standard. World Cup was explicitly excluded by Chris during implementation.

**Architecture:** Keep the static HTML/CSS/JavaScript app and existing game systems. Add a small presentation/navigation layer shared by the entry pages; isolate farm, table, and World Cup implementation ownership. Shared code never reads economic state or authenticates.

**Tech Stack:** HTML, CSS, vanilla JavaScript, existing Node/CDP verification, Python local HTTP server.

**Spec:** `docs/superpowers/specs/2026-11-06-game-centre-premium-design.md` (approved, direct implementation requested).

## Global Constraints

- Touch targets at least 44×44 CSS px; review widths 360, 390, 768, and 1440 CSS px.
- Preserve `America/Regina`, saves, rewards, authentication, coin operations, cloud sync, and Service Worker safeguards.
- No frameworks, npm installation, backend writes, generated reward promises, copied commercial game assets, or fabricated results.
- Preserve official logo, warm painterly art, procedural farm world, font patch, complete Chinese copy, and readable English.
- Browser tests block `game-track`; local preview is `http://127.0.0.1:8037/`.

## Review Focus

1. Interrupted gestures must not commit a placement, click a crop, or leave a stuck pointer state: farm and table browser regressions.
2. Returning users and unavailable localStorage must retain game access: shell tests and farm save/reload regression.
3. Missing images, timed-out menu fetches, and clipboard rejection must expose usable alternatives: table fallback and retry regressions.
4. Historical matches without official scores must remain unknown, not become invented results or future fixtures: World Cup archive tests.
5. Narrow screens, large names, and reduced motion must keep controls visible and avoid repeated actions: all-page viewport/interaction checks.

### Task 1: Shared shell and game centre (parent ownership)

**Files:** `index.html`, new `src/css/game-shell.css`, new `src/js/game-shell.js`, `DESIGN.md`, `.impeccable/design.json`, and this plan.

**Interfaces:** Pages set `body[data-game]` to `farm`, `table`, or `worldcup`; include `css/game-shell.css` and deferred `js/game-shell.js`. A static `.game-home-link` anchor links to `/`; shared CSS provides accessible 44px styling but no absolute positioning. `game-shell.js` writes only `em_games_recent_v1={id,path,at}` using known local routes. The homepage reads and validates this key and exposes a resume link; blocked storage is harmless. No game state access.

- [x] Implement shared tokens, focus/reduced-motion rules and recent-route storage with a Node VM test covering blocked storage and invalid external paths.
- [x] Replace homepage with a scene-led premium selector, full bilingual game facts and resume action; seasonal archive entry cancelled by Chris.
- [x] Inspect mobile/desktop and no-recent states; verify links and no horizontal overflow at 360/390/768/1440. Cover errors preserve accessible links.

### Task 2: Farm presentation and controls (farm ownership)

**Files:** `src/index.html`, `src/css/style.css`, `src/css/animations.css`, new `src/css/farm-premium.css`, and narrow changes in `src/js/ui.js`, `src/js/coach.js`, `src/js/mapview-iso.js`, `src/js/tutorial.js`, `src/js/harvest-status.js` only where demonstrated necessary. Relevant verification scripts belong to this task.

**Interfaces:** Consume Task 1 shell files and `.game-home-link`. Preserve all `Farm` module interfaces, DOM IDs and `data-action` hooks. Camera and pointers remain owned by `Farm.isoView`.

- [ ] Inspect running farm and existing HUD/touch code; reproduce small-target and cancelled-gesture defects before fixing behaviour.
- [ ] Add cohesive premium styling and rearrange HUD/tool positions without removing reachable functionality. Fit 360px, respect safe areas, target 44px.
- [ ] Ensure current-action guidance, press/selected/pending feedback and accessible tool labels. Resolve confirmed gesture cancellation bugs without rewriting world/economy.
- [ ] Run existing farm syntax, modal, coach, hit/heading and save-related checks; browser-test plant, harvest, orders, menus, drag/zoom, reload and reduced motion.

### Task 3: Tonight's Table full experience (table ownership)

**Files:** `src/dinner.html`, `src/css/dinner.css`, `src/js/table.js`, new `scripts/verify/table-premium-test.mjs` and/or dedicated browser eval fixture.

**Interfaces:** Consume shell tokens/navigation. Preserve four-main/one-soup slot rules, current API and fallback, existing gestures, and rotation. Restart uses in-memory accepted menu, not a new fetch.

- [ ] Add meaningful regressions for tap/keyboard placement, full meal completion, restart, pointer cancellation and missing image/share failure before behavioural implementation.
- [ ] Build clear title, next-action instruction, progress, tabletop materials and responsive first viewport; all visible actions bilingual and accessible.
- [ ] Implement click/keyboard placement equivalent to dragging, feedback, guarded animation completion and cancellation, restart, retry and readable fallback sharing.
- [ ] Verify full round with drag and separately keyboard; image failure, API fallback, reduced motion, share rejection and narrow layout.

### Task 4: World Cup archive and mobile experience — CANCELLED by Chris

Chris: “世界杯那个不要管了”. Do not implement this task or add World Cup to the home page. Worker has been stopped and will undo only its own changes. The instructions below remain as cancelled historical scope.

**Files:** `src/worldcup.html`, `src/css/worldcup.css`, `src/js/worldcup.js`, new `src/css/worldcup-premium.css`, and relevant archive tests.

**Interfaces:** Consume shell tokens/navigation. Preserve existing score fields, standings logic, endpoints, prize and settlement hooks. Archive state is derived from existing match timing and actual official data, not guessed scores.

- [ ] Inspect owning World Cup rules and current code. Add regression for past/unscored fixtures and future fixtures before changing labels.
- [ ] Integrate visual hierarchy, clear archive/data-missing states, accessible 44px controls, mobile filters and bracket scroll affordance.
- [ ] Verify tabs, filters, score hiding, team names, bracket, prize entry, unknown results and return navigation without submitting rewards or bets.

### Task 5: Integration, verification and release (parent ownership)

**Files:** `service-worker.js`, `deploy.sh` only if verification integration is needed, shared tests, design documentation and review receipt.

- [ ] Integrate all page references. Include essential shell/CSS resources in precache; retain cache reload/no-store/version guard behaviour. Generate version with existing deployment mechanism.
- [ ] Run JavaScript syntax plus existing deployment gates and new behaviour checks. Record real failures and fix their owning cause.
- [ ] Batch capture desktop and mobile states across all games; inspect 360/768 widths, keyboard, reduced motion, offline/fallback and saves. Fix material gaps.
- [ ] Run Impeccable detector once on changed UI; obtain independent finish/code review, resolve material findings, and record remaining device limits.
- [ ] Check staged diff for secrets, unrelated edits and generated output; commit only scoped files. Fetch/compare production branch before push and any merge. Use Thermos for merges, existing git/Pages deployment, and verify GitHub status plus live version.

## Execution

Chris explicitly approved the complete design and requested direct implementation. No further plan-approval pause is needed. Parallel work is limited to the independent farm/table/World Cup ownership above; integration and release remain with the parent. Mark completed boxes and record verification evidence as work progresses.

## Verification ledger

- Local server initially failed under interactive execution; detached hidden Python service at 127.0.0.1:8037 now works. Native browser screenshots and MCP live checks verified real content, not browser error pages.
- Shared shell regression RED (missing implementation), then GREEN; added prototype-key recovery regression RED→GREEN. Valid routes, invalid/external/prototype routes, corrupted/blocked storage, and archive exclusion verified.
- Root screenshots: `.impeccable/review/centre-desktop.png`, `centre-mobile.png`; 360/768/1440 DOM checks have no horizontal overflow. Existing farm and recipe rasters reused without modification.
- All game JS syntax passed; 16 focused shell/farm/current deployment contract checks passed. Git Bash syntax passes outside sandbox (sandbox blocks MSYS named object creation).
- First `EF_VERIFY_ONLY=1` release run passed syntax/precache/shell/farm cancellation/current-action checks and initial table interaction cases, then correctly blocked on table primary action falling below 360×740 viewport. Table owner is fixing actual layout before rerun.
- World Cup worker made no changes. Deployment script's automatic build-stamp change to `src/worldcup.html` will be excluded from final changes, preserving Chris's scope correction.
