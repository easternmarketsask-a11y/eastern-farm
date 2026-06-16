#!/usr/bin/env python3
"""
process_map_assets_20260616.py — 2026-06-16 art REFRESH batch.

Chris re-generated (via Grok) a fully style-consistent painted/iso set:
  - 3 grass cube tiles (plain / flowers / mossy)  -> p_grass{,_b,_c}.png
  - 8 crop 4-stage strips (the V1 core eight)      -> crop_<name>_{0..3}.png
  - 4 animals (chicken/cat/rabbit/dog)             -> animal_<name>.png

These OVERWRITE the existing same-named assets the iso engine already wires
(ISO_CROPS / ANIMALS / ISO_TILES in src/js/mapview-iso.js). Source files were
archived with descriptive names under _incoming/grok_batch_20260616/.

Run from project root:  python scripts/process_map_assets_20260616.py
"""
import os
from collections import deque
from PIL import Image

SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "_incoming", "grok_batch_20260616")
SRC_DIR = os.path.normpath(SRC_DIR)
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "assets", "images", "map"))
os.makedirs(OUT, exist_ok=True)


def is_bg(px, mode):
    r, g, b = px[0], px[1], px[2]
    mx, mn = max(r, g, b), min(r, g, b)
    light = mx
    sat = 0 if mx == 0 else (mx - mn) / mx
    if mode in ("checker", "white"):
        return light > 150 and sat < 0.18
    if mode == "cream":          # warm beige flat bg (crop strips on cream paper)
        return light > 165 and sat < 0.22
    if mode == "sky":
        return light > 150 and sat < 0.30
    return False


def flood_alpha(img, mode):
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


def corner_flood(img, tol=78):
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    refs = [px[x, y][:3] for x, y in seeds]

    def near(c):
        for r in refs:
            if abs(c[0] - r[0]) + abs(c[1] - r[1]) + abs(c[2] - r[2]) <= tol:
                return True
        return False

    visited = bytearray(w * h)
    q = deque()

    def consider(x, y):
        i = y * w + x
        if visited[i]:
            return
        visited[i] = 1
        if near(px[x, y][:3]):
            q.append((x, y))

    for s in seeds:
        consider(*s)
    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                consider(nx, ny)
    return img


def autocrop(img):
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def fit_w(img, max_w):
    if img.width <= max_w:
        return img
    h = round(img.height * max_w / img.width)
    return img.resize((max_w, h), Image.LANCZOS)


def scale(img, factor):
    return img.resize((max(1, round(img.width * factor)),
                       max(1, round(img.height * factor))), Image.LANCZOS)


def _runs_in_band(px, w, h, y0, y1, thr_frac):
    """x-runs where alpha-content in band [y0,y1) exceeds thr_frac*max."""
    col = [0] * w
    for x in range(w):
        c = 0
        for y in range(y0, y1):
            if px[x, y][3] > 16:
                c += 1
        col[x] = c
    mx = max(col) if col else 0
    if not mx:
        return []
    thr = mx * thr_frac
    runs = []
    x = 0
    while x < w:
        if col[x] >= thr:
            s = x
            while x < w and col[x] >= thr:
                x += 1
            runs.append((s, x))
        else:
            x += 1
    return runs


def split_smart(img, n=4):
    """Split a 4-stage strip robustly across mixed source layouts.

    Strategy, in order:
      1. SOIL CUBES: detect separated soil clusters in the bottom band — works
         when each stage sits on its own cube/plate (gaps between them).
      2. PLANT CLUSTERS: if (1) doesn't yield exactly n, detect foliage clusters
         in the UPPER band — works when soil is one continuous strip (no bottom
         gaps) but the plants are still separated above ground.
      3. EQUAL QUARTERS: last resort.
    Cuts are placed at the midpoint between adjacent cluster centers (full
    height), so tall-plant overhang lands on the correct side of the seam.
    """
    w, h = img.size
    px = img.load()
    runs = _runs_in_band(px, w, h, int(h * 0.60), h, 0.20)            # soil cubes
    if len(runs) != n:
        runs = _runs_in_band(px, w, h, 0, int(h * 0.62), 0.10)        # plant clusters
    # merge tiny spurious runs / keep the n widest, ordered left->right
    if len(runs) > n:
        runs.sort(key=lambda r: r[1] - r[0], reverse=True)
        runs = sorted(runs[:n], key=lambda r: r[0])
    if len(runs) != n:
        runs = [(int(i * w / n), int((i + 1) * w / n)) for i in range(n)]
    centers = [(s + e) / 2 for s, e in runs]
    bounds = [0]
    for i in range(len(centers) - 1):
        bounds.append(int((centers[i] + centers[i + 1]) / 2))
    bounds.append(w)
    out = []
    for i in range(len(centers)):
        out.append(autocrop(img.crop((bounds[i], 0, bounds[i + 1], h))))
    return out


# crop strip -> (output stem, bg mode). Output stems match existing ISO_CROPS wiring.
CROPS = [
    ("crop_qingcai_stages.jpeg",  "crop_qingcai",  "cream"),
    ("crop_lajiao_stages.jpeg",   "crop_chili",    "cream"),
    ("crop_qiezi_stages.jpeg",    "crop_eggplant", "cream"),
    ("crop_jiucai_stages.jpeg",   "crop_chives",   "checker"),
    ("crop_fanqie_stages.jpeg",   "crop_tomato",   "checker"),
    ("crop_huanggua_stages.jpeg", "crop_cucumber", "checker"),
    ("crop_xiangcai_stages.jpeg", "crop_cilantro", "checker"),
    ("crop_dasuan_stages.jpeg",   "crop_garlic",   "checker"),
]


def main():
    log = []

    # --- 8 crop strips ---
    for fn, stem, bg in CROPS:
        im = flood_alpha(Image.open(os.path.join(SRC_DIR, fn)), bg)
        st = split_smart(im, 4)
        tall = max(s.height for s in st) or 1
        f = min(1.0, 300 / tall)
        sizes = []
        for i, s in enumerate(st):
            s = scale(s, f)
            s.save(os.path.join(OUT, f"{stem}_{i}.png"), optimize=True)
            sizes.append(s.size)
        log.append(f"{stem}: stages={len(st)} f={f:.3f} {sizes}")

    # --- 3 grass cube tiles ---
    for fn, out in [("grass_tile_A_plain.jpeg", "p_grass.png"),
                    ("grass_tile_B_flowers.jpeg", "p_grass_b.png"),
                    ("grass_tile_C_mossy.jpeg", "p_grass_c.png")]:
        im = fit_w(autocrop(flood_alpha(Image.open(os.path.join(SRC_DIR, fn)), "checker")), 220)
        im.save(os.path.join(OUT, out), optimize=True)
        log.append(f"{out} {im.size}")

    # --- 4 animals (base-less so pets stand on real ground) ---
    # chicken/dog: gray-checker transparent bg, NO base -> flood checker, no crop
    # cat: cream flat bg + soft shadow, NO base -> corner_flood, no crop
    # rabbit: light bg + wooden BOARD under it -> flood checker, then crop board off
    chick = fit_w(autocrop(flood_alpha(Image.open(os.path.join(SRC_DIR, "animal_chicken.jpeg")), "checker")), 200)
    chick.save(os.path.join(OUT, "animal_chicken.png"), optimize=True)
    log.append(f"animal_chicken.png {chick.size}")

    dog = fit_w(autocrop(flood_alpha(Image.open(os.path.join(SRC_DIR, "animal_dog.jpeg")), "checker")), 200)
    dog.save(os.path.join(OUT, "animal_dog.png"), optimize=True)
    log.append(f"animal_dog.png {dog.size}")

    cat = fit_w(autocrop(corner_flood(Image.open(os.path.join(SRC_DIR, "animal_cat.jpeg")))), 200)
    cat.save(os.path.join(OUT, "animal_cat.png"), optimize=True)
    log.append(f"animal_cat.png {cat.size}")

    # rabbit: remove checker bg, then crop off the bottom wooden board.
    rb = flood_alpha(Image.open(os.path.join(SRC_DIR, "animal_rabbit.jpeg")), "checker")
    rb = autocrop(rb)
    w, h = rb.size
    rb = fit_w(autocrop(rb.crop((0, 0, w, int(h * 0.86)))), 200)   # 0.86 = drop board, keep paws
    rb.save(os.path.join(OUT, "animal_rabbit.png"), optimize=True)
    log.append(f"animal_rabbit.png {rb.size}")

    print("\n".join(log))


if __name__ == "__main__":
    main()
