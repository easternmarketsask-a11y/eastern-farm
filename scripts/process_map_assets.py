#!/usr/bin/env python3
"""
process_map_assets.py — clean the pixel-art map assets Chris generated (via Grok)
into transparent PNGs the Canvas2D map engine (src/js/mapview.js) can blit.

Problem: several source images were exported as JPEG, so their "transparent"
backgrounds were flattened (the gray checkerboard is baked into pixels, and the
white/sky backgrounds have no alpha). This script restores real alpha by
flood-filling the connected background from the image border, then crops to the
content bounding box and saves PNGs into src/assets/images/map/.

Run from project root:  python scripts/process_map_assets.py
"""
import os
from collections import deque
from PIL import Image

UP = r"C:\Users\yue00\.claude\uploads\220760db-1f0a-4557-9c68-ae9135bffd69"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "images", "map")
OUT = os.path.normpath(OUT)
os.makedirs(OUT, exist_ok=True)

SRC = {
    "soil":   os.path.join(UP, "8ca2e0f7-IMG_1657.jpeg"),  # tilled soil tile (checkerboard bg)
    "qingcai":os.path.join(UP, "b6a2b62e-IMG_1660.jpeg"),  # bok choy 4-stage (checkerboard bg)
    "barn":   os.path.join(UP, "94afb22e-IMG_1658.jpeg"),  # red barn (near-white bg)
    "house":  os.path.join(UP, "c71048cc-IMG_1659.jpeg"),  # cottage (tan sky scene)
    "grass":  os.path.join(UP, "b30529fa-IMG_1656.jpeg"),  # grass scene (reference)
    # Batch 2 (2026-06-15):
    "stall":     os.path.join(UP, "140e2c0a-IMG_1663.jpeg"),  # market stall (tan scene)
    "greenhouse":os.path.join(UP, "7ed11bbf-IMG_1664.jpeg"),  # greenhouse (checkerboard)
    "coop":      os.path.join(UP, "933144b7-IMG_1665.jpeg"),  # chicken coop (checkerboard)
    "tree":      os.path.join(UP, "d9bebf6b-IMG_1666.jpeg"),  # tree (near-white)
    "tomato":    os.path.join(UP, "2d6e3183-IMG_1667.jpeg"),  # tomato 4-stage (checkerboard)
}


def is_bg(px, mode):
    """Heuristic: is this pixel a removable background pixel?
    checker  = light & low-saturation gray  (two near-white shades)
    white    = very light, low-saturation
    sky      = the tan/beige top region (only used via border flood, so a loose
               light-low-sat test is enough)
    """
    r, g, b = px[0], px[1], px[2]
    mx, mn = max(r, g, b), min(r, g, b)
    light = mx
    sat = 0 if mx == 0 else (mx - mn) / mx
    if mode in ("checker", "white"):
        return light > 150 and sat < 0.18
    if mode == "sky":
        # tan sky: light-ish and not very saturated; brown building/ground are
        # darker or more saturated so they survive.
        return light > 150 and sat < 0.30
    return False


def flood_alpha(img, mode):
    """Flood-fill background from the border; set those pixels' alpha to 0."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    visited = bytearray(w * h)
    q = deque()

    def consider(x, y):
        i = y * w + x
        if visited[i]:
            return
        visited[i] = 1
        if is_bg(px[x, y], mode):
            q.append((x, y))

    for x in range(w):
        consider(x, 0)
        consider(x, h - 1)
    for y in range(h):
        consider(0, y)
        consider(w - 1, y)

    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                i = ny * w + nx
                if not visited[i]:
                    visited[i] = 1
                    if is_bg(px[nx, ny], mode):
                        q.append((nx, ny))
    return img


def autocrop(img):
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def fit_w(img, max_w):
    """Downscale so width <= max_w (keep aspect). Assets render at ~60-130px
    tiles, so big source PNGs are wasted bytes on a no-build mobile web game."""
    if img.width <= max_w:
        return img
    h = round(img.height * max_w / img.width)
    return img.resize((max_w, h), Image.LANCZOS)


def scale(img, factor):
    return img.resize((max(1, round(img.width * factor)),
                       max(1, round(img.height * factor))), Image.LANCZOS)


def split_stages(img, n=4):
    """Split a horizontal sprite strip into n sprites by transparent gutters.
    Returns list of cropped sprite images, left-to-right."""
    w, h = img.size
    px = img.load()
    # column has content if any pixel alpha>16
    col_has = [False] * w
    for x in range(w):
        for y in range(h):
            if px[x, y][3] > 16:
                col_has[x] = True
                break
    # find runs of content columns
    runs = []
    x = 0
    while x < w:
        if col_has[x]:
            s = x
            while x < w and col_has[x]:
                x += 1
            runs.append((s, x))
        else:
            x += 1
    # merge tiny gaps: keep largest n runs by width
    runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    runs = sorted(runs[:n], key=lambda r: r[0])
    sprites = []
    for (s, e) in runs:
        sub = img.crop((s, 0, e, h))
        sprites.append(autocrop(sub))
    return sprites


def main():
    log = []

    # --- soil tile ---
    soil = fit_w(autocrop(flood_alpha(Image.open(SRC["soil"]), "checker")), 256)
    soil.save(os.path.join(OUT, "soil.png"), optimize=True)
    log.append(f"soil.png  {soil.size}")

    # --- barn ---
    barn = fit_w(autocrop(flood_alpha(Image.open(SRC["barn"]), "white")), 512)
    barn.save(os.path.join(OUT, "barn.png"), optimize=True)
    log.append(f"barn.png  {barn.size}")

    # --- house (best effort: remove tan sky from top) ---
    house = fit_w(autocrop(flood_alpha(Image.open(SRC["house"]), "sky")), 512)
    house.save(os.path.join(OUT, "house.png"), optimize=True)
    log.append(f"house.png {house.size}")

    # --- bok choy 4-stage strip -> 4 sprites (uniform scale so frames stay
    #     proportional to each other; tallest ~360px is plenty for display) ---
    qc = flood_alpha(Image.open(SRC["qingcai"]), "checker")
    stages = split_stages(qc, 4)
    tallest = max(s.height for s in stages) or 1
    factor = min(1.0, 360 / tallest)
    log.append(f"qingcai stages={len(stages)} scale={factor:.3f}")
    for i, s in enumerate(stages):
        s = scale(s, factor)
        s.save(os.path.join(OUT, f"crop_qingcai_{i}.png"), optimize=True)
        log.append(f"  crop_qingcai_{i}.png {s.size}")

    # --- batch 2 buildings ---
    # NOTE: stall (IMG_1663) and tomato (IMG_1667) are NOT exported:
    #   - stall's tan background is too close to its own colours to flood-cut;
    #     needs a re-gen with a real transparent PNG background.
    #   - tomato's 4 stages share a connected soil base so they won't split,
    #     and there is no 'tomato' crop id in data/crops.json yet.
    # Re-enable here once Chris provides a transparent-bg stall / a tomato crop.

    gh = fit_w(autocrop(flood_alpha(Image.open(SRC["greenhouse"]), "checker")), 512)
    gh.save(os.path.join(OUT, "greenhouse.png"), optimize=True)
    log.append(f"greenhouse.png {gh.size}")

    coop = fit_w(autocrop(flood_alpha(Image.open(SRC["coop"]), "checker")), 512)
    coop.save(os.path.join(OUT, "coop.png"), optimize=True)
    log.append(f"coop.png {coop.size}")

    tree = fit_w(autocrop(flood_alpha(Image.open(SRC["tree"]), "white")), 256)
    tree.save(os.path.join(OUT, "tree.png"), optimize=True)
    log.append(f"tree.png {tree.size}")

    # --- grass color sample (no file saved; the engine uses the hex) ---
    grass = Image.open(SRC["grass"]).convert("RGB")
    gp = grass.load()
    samples = sorted(gp[x, y] for x in range(10, 60) for y in range(10, 60))
    mid = samples[len(samples) // 2]
    log.append(f"grass color ~ #{mid[0]:02x}{mid[1]:02x}{mid[2]:02x}")

    print("\n".join(log))


if __name__ == "__main__":
    main()
