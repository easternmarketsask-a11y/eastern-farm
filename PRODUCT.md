# Eastern Market Games

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Eastern Market customers and their families, primarily playing on phones. Existing project guidance identifies Chinese-Canadian parents, children, older customers, and students. Both Chinese and English must work independently.

## Product Purpose

A branded game centre connecting farm management, food discovery, and seasonal community activities. On 2026-11-06 Chris requested an upgrade of the entire game centre and every game, with premium visual quality, controls, and experience.

## Capabilities and Constraints

- `index.html`: game selection; currently links to Eastern Farm and Tonight's Table.
- `src/index.html`: Eastern Farm, including planting, harvesting, store orders, building, neighbours, sound, local saves, and member cloud synchronisation.
- `src/dinner.html`: Tonight's Table; arrange four dishes and soup, rotate the completed table, and share it. Uses the current public menu endpoint with a local fallback.
- `src/worldcup.html`: seasonal World Cup viewing hub, including results, standings, bracket, and existing prize access. It is an existing module even though the game-centre homepage does not currently link to it.
- Plain HTML, CSS, and JavaScript, with the existing `Farm` namespace. No framework or package installation is needed.
- Existing player saves, authentication, member balances, prize settlement, and reward limits are authoritative. Presentation changes must preserve these behaviours.
- Local dates and times use `America/Regina`.
- Cloud authentication must not block opening the farm. Preserve the documented Service Worker update and offline safeguards.

## Brand Commitments

Eastern Market / 东方超市, Eastern Farm / 东方农场, and Tonight's Table / 今晚餐桌. Preserve the official logo and the farm's established warm, painterly identity, coherent isometric world, and readable bilingual naming. Player-facing Chinese uses clear, complete sentences and the tone documented in `CLAUDE.md`.

## Evidence on Hand

- Product rules and visual constraints: `CLAUDE.md`.
- Existing executable pages and their CSS, scripts, and assets.
- Existing deployment and verification scripts under `scripts/verify/`.
- Live mobile inspection on 2026-11-06 confirmed the current game selector, farm introduction, table, and World Cup hub. Local preview is available at `http://127.0.0.1:8037/`; the local table's public API request encounters expected localhost CORS restrictions and uses the existing JSON fallback.

## Product Principles

- The player should understand the next useful action without reading a manual.
- Touch, mouse, and keyboard interactions need clear feedback and recovery.
- Returning players keep their progress and can resume their game.
- Premium quality means coherent visuals, legibility, responsive controls, and dependable behaviour.

## Open Decisions

Chris approved the upgrade design in `docs/superpowers/specs/2026-11-06-game-centre-premium-design.md` on 2026-11-06 and instructed direct implementation, then explicitly excluded the World Cup module (“世界杯那个不要管了”). The current deliverable is the game centre, Eastern Farm, and Tonight's Table. The approved direction retains the warm painterly identity and does not change reward economics.
