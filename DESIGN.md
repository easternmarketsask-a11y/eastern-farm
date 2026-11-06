---
name: Eastern Market Games
description: Warm painterly games with readable, tactile controls.
colors:
  leaf: "#285c3b"
  ink: "#233e2e"
  paper: "#faf7ef"
  surface: "#fffdf7"
  line: "#d8d9c8"
  gold: "#a77a39"
  muted: "#5c6a58"
  focus: "#9d441e"
typography:
  display:
    fontFamily: "Noto Serif SC, Songti SC, STSong, SimSun, serif"
    fontSize: "clamp(27px, 3.2vw, 41px)"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: ".04em"
  body:
    fontFamily: "Plus Jakarta Sans, Segoe UI, PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  control: "14px"
  scene: "26px"
spacing:
  tight: "8px"
  group: "16px"
  section: "24px"
components:
  home-link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.leaf}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px minimum"
---

# Design System: Eastern Market Games

## Overview

The existing sunlit, painterly farm and familiar family table define the visual world. Scene content carries the experience; paper and ceramic surfaces carry the controls. The premium treatment comes from legibility, consistent materials, useful feedback and responsive operation.

The 2026-11-06 upgrade preserves the official logo, existing farm art and typography. World Cup is excluded from this upgrade by Chris's instruction. The route-specific composition lives in `.impeccable/briefs/game-centre.md`.

## Colors

Dark leaf green carries actions and headings. Cream and warm white separate controls from the scenery; restrained warm gold marks farm currency and material edges. Muted text remains a readable green or earth tone. Focus rings must stand out from both paper and vegetation.

Shared tokens live in `src/css/game-shell.css`. Farm-specific tokens live in `src/css/farm-premium.css`; table-specific ceramic materials live in `src/css/dinner.css`. Avoid flattening the two game scenes into one generic panel style.

## Typography

The centre uses the serif display stack and sans body stack declared above. Farm keeps `ZCOOL XiaoWei`, Noto Sans SC and Plus Jakarta Sans, including its `EF XiaoWei Patch` for U+56DE. Body copy and small controls remain sans. HUD values use tabular figures. English and Chinese have independent readable hierarchies, not a title with an illegible translated footnote.

## Layout

The centre container caps at 1440px. Desktop game scenes use unequal columns (1.38fr / 1fr); at 600px they stack. Gaps are 16–24px, with 18px mobile page padding. Gameplay uses the viewport, safe-area insets and clearly separated HUD/tool positions. Scene content must remain operable at 360px.

## Elevation & Depth

Directional, soft shadows imply contact beneath plates and controls. Farm illustration light and the procedural world remain coherent. Shadows use tinted earth/green tones; glow is reserved for meaningful selected or completed states. Pointer feedback never obscures the item being acted on.

## Shapes

Controls use a 14px shared radius; game scenes use 26px desktop and 22px mobile corners. Ceramic dishes are circular because they represent plates and bowls. Touch targets have a minimum 44px width and height, independent of icon size.

## Components

- **Game scenes:** large semantic links with bilingual title, useful description and clear enter action. Cover failure preserves the title, fallback background and usable link.
- **Home link:** static anchor styled by `.game-home-link`, positioned by the owning game. No history interception.
- **Recent game:** only the allowlisted local route is stored in `em_games_recent_v1`; unavailable or malformed storage is ignored. No economic state is read.
- **Farm HUD:** identity, level/experience, currency and account functions around a clear current action. Existing module IDs and hooks remain authoritative.
- **Table controls:** equal mouse, touch and keyboard access; instruction, progress, completion and recovery remain visible at the appropriate states.
- **Motion:** deliberate press, placement and state transitions; reduced-motion preference removes decorative motion without losing feedback.

## Do's and Don'ts

- Do verify actual mobile gameplay, long labels, missing imagery and failure paths.
- Do keep the official logo and existing artwork provenance.
- Do keep feedback specific to pressed, selected, busy, complete or failed states.
- Don't use black-and-gold casino styling, intrusive reward badges or copied game assets.
- Don't change savings, rewards, authentication or settlement through the presentation layer.
- Don't use a new visual layer to hide loading or incomplete data.
