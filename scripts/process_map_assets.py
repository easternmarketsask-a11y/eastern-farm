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
    # Isometric ground blocks (for ?iso=1 Hay-Day-style engine):
    "iso_grass": os.path.join(UP, "26f9f41b-IMG_1661.jpeg"),  # iso grass cube (pixel, checkerboard)
    "iso_dirt":  os.path.join(UP, "0788266c-IMG_1662.jpeg"),  # dirt/path block (pixel)
    # Painted iso tiles (batch 2026-06-15, matching Hay Day style):
    "p_grass": os.path.join(UP, "f57f5a34-IMG_1672.jpeg"),   # painted grass cube
    "p_soil":  os.path.join(UP, "a7c1ad54-IMG_1673.jpeg"),   # painted tilled soil
    "p_path":  os.path.join(UP, "6eaf743e-IMG_1674.jpeg"),   # painted dirt/path
    "p_water": os.path.join(UP, "7227589d-IMG_1675.jpeg"),   # painted water+shore
    "p_stall": os.path.join(UP, "0139a402-IMG_1676.jpeg"),   # painted market stall
    "p_greenhouse": os.path.join(UP, "2ad2b272-IMG_1677.jpeg"),
    "p_coop": os.path.join(UP, "c8525963-IMG_1678.jpeg"),
    "p_barn": os.path.join(UP, "ce969768-IMG_1679.jpeg"),
    "p_house": os.path.join(UP, "cf002d91-IMG_1680.jpeg"),
    "p_well": os.path.join(UP, "eb8cdba9-IMG_1681.jpeg"),
    "p_tomato": os.path.join(UP, "468bf3ab-IMG_1682.jpeg"),   # iso tomato 4-stage
    "p_cucumber": os.path.join(UP, "41b91da1-IMG_1683.jpeg"), # iso cucumber 4-stage
    "p_tree": os.path.join(UP, "6e5c8b6f-IMG_1684.jpeg"),
    # crop 4-stage strips (iso), batch 2:
    "c_chili":    os.path.join(UP, "b3df3544-IMG_1685.jpeg"),
    "c_eggplant": os.path.join(UP, "338d846b-IMG_1686.jpeg"),
    "c_chives":   os.path.join(UP, "94cf3734-IMG_1687.jpeg"),
    "c_cilantro": os.path.join(UP, "a254c5fa-IMG_1688.jpeg"),
    "c_garlic":   os.path.join(UP, "acc3987d-IMG_1689.jpeg"),
    # decorations (iso):
    "d_bush":   os.path.join(UP, "16c4f234-IMG_1690.jpeg"),
    "d_lantern":os.path.join(UP, "dfc5919d-IMG_1691.jpeg"),
    "d_fence":  os.path.join(UP, "1dc72411-IMG_1692.jpeg"),
    "d_wheel":  os.path.join(UP, "433a9873-IMG_1693.jpeg"),
    "d_bridge": os.path.join(UP, "43a574e7-IMG_1694.jpeg"),
    # animals (iso, on grass diamond):
    "a_chicken":os.path.join(UP, "a406f4ab-IMG_1695.jpeg"),
    "a_cat":    os.path.join(UP, "de98fca7-IMG_1696.jpeg"),
    "a_rabbit": os.path.join(UP, "39ef730a-IMG_1697.jpeg"),
    "a_dog":    os.path.join(UP, "a04783c4-IMG_1698.jpeg"),
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


def corner_flood(img, tol=78):
    """Background removal that ADAPTS to the actual corner colour (cream / beige /
    vignette), flooding from the 4 corners and stopping at the sprite's dark
    cartoon outline. Works even when the subject is the same hue as the bg
    (e.g. a cream chicken on a cream background) because the outline blocks the
    flood. tol = Manhattan RGB distance from a corner sample."""
    from collections import deque
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
    """Split a horizontal crop-growth strip into n stages, left-to-right.

    Tall plants overhang the gaps between stages, so a full-height column scan
    fails. Instead detect the SOIL CUBES in the bottom band (which never overhang
    each other), then slice full-height at the midpoints between cube clusters."""
    w, h = img.size
    px = img.load()
    band_top = int(h * 0.62)          # bottom ~38% = where the soil cubes sit
    col = [0] * w
    for x in range(w):
        c = 0
        for y in range(band_top, h):
            if px[x, y][3] > 16:
                c += 1
        col[x] = c
    thr = max(col) * 0.18 if max(col) else 1
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
    # keep the n widest cube-runs, ordered left→right
    runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    runs = sorted(runs[:n], key=lambda r: r[0])
    if len(runs) < 2:                 # detection failed → fall back to equal slices
        runs = [(int(i * w / n), int((i + 1) * w / n)) for i in range(n)]
    # split boundaries at midpoints between adjacent cube centers
    centers = [(s + e) / 2 for (s, e) in runs]
    bounds = [0]
    for i in range(len(centers) - 1):
        bounds.append(int((centers[i] + centers[i + 1]) / 2))
    bounds.append(w)
    sprites = []
    for i in range(len(centers)):
        sub = img.crop((bounds[i], 0, bounds[i + 1], h))
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

    # --- isometric ground blocks ---
    igrass = fit_w(autocrop(flood_alpha(Image.open(SRC["iso_grass"]), "checker")), 256)
    igrass.save(os.path.join(OUT, "iso_grass.png"), optimize=True)
    log.append(f"iso_grass.png {igrass.size}")
    idirt = fit_w(autocrop(flood_alpha(Image.open(SRC["iso_dirt"]), "checker")), 256)
    idirt.save(os.path.join(OUT, "iso_dirt.png"), optimize=True)
    log.append(f"iso_dirt.png {idirt.size}")

    # --- painted iso batch (2026-06-15): ground tiles, buildings, crops, tree ---
    def save_iso(key, out, bg, maxw):
        im = fit_w(autocrop(flood_alpha(Image.open(SRC[key]), bg)), maxw)
        im.save(os.path.join(OUT, out), optimize=True)
        log.append(f"{out} {im.size}")
    save_iso("p_grass", "p_grass.png", "checker", 220)
    save_iso("p_soil", "p_soil.png", "checker", 220)
    save_iso("p_path", "p_path.png", "checker", 220)
    save_iso("p_water", "p_water.png", "checker", 220)
    save_iso("p_stall", "p_stall.png", "checker", 360)
    save_iso("p_greenhouse", "p_greenhouse.png", "white", 360)
    save_iso("p_coop", "p_coop.png", "checker", 360)
    save_iso("p_barn", "p_barn.png", "white", 360)
    save_iso("p_house", "p_house.png", "checker", 360)
    save_iso("p_well", "p_well.png", "checker", 320)
    save_iso("p_tree", "p_tree.png", "checker", 260)
    for key, out in [("p_tomato", "crop_tomato"), ("p_cucumber", "crop_cucumber")]:
        st = split_stages(flood_alpha(Image.open(SRC[key]), "white"), 4)
        tall = max(s.height for s in st) or 1
        f = min(1.0, 300 / tall)
        for i, s in enumerate(st):
            scale(s, f).save(os.path.join(OUT, f"{out}_{i}.png"), optimize=True)
        log.append(f"{out} stages={len(st)} f={f:.3f}")

    # crop 4-stage strips (batch 2) -> per-stage PNGs
    for key, out in [("c_chili", "crop_chili"), ("c_eggplant", "crop_eggplant"), ("c_chives", "crop_chives"),
                     ("c_cilantro", "crop_cilantro"), ("c_garlic", "crop_garlic")]:
        st = split_stages(flood_alpha(Image.open(SRC[key]), "checker"), 4)
        tall = max(s.height for s in st) or 1
        f = min(1.0, 300 / tall)
        for i, s in enumerate(st):
            scale(s, f).save(os.path.join(OUT, f"{out}_{i}.png"), optimize=True)
        log.append(f"{out} stages={len(st)} f={f:.3f}")

    # decorations
    for key, out, bg, w in [("d_bush", "deco_bush.png", "checker", 200), ("d_lantern", "deco_lantern.png", "sky", 200),
                            ("d_fence", "deco_fence.png", "checker", 300), ("d_wheel", "deco_wheel.png", "sky", 280),
                            ("d_bridge", "deco_bridge.png", "checker", 280)]:
        save_iso(key, out, bg, w)
    # animals: adaptive corner-flood removes the cream/vignette bg (stops at the
    # dark outline, so cream-on-cream works), then detect + crop off the baked
    # grass-tile base so the pet stands on the REAL farm ground (no square card).
    # Per-animal keep-fraction (the baked grass base is a different height in each
    # source image; hand-tuned by screenshot so only the animal remains).
    ACROP = {"a_chicken": ("animal_chicken.png", 0.73), "a_cat": ("animal_cat.png", 0.60),
             "a_rabbit": ("animal_rabbit.png", 0.73), "a_dog": ("animal_dog.png", 0.74)}
    for key, (out, frac) in ACROP.items():
        im = corner_flood(Image.open(SRC[key]))
        w, h = im.size
        im = fit_w(autocrop(im.crop((0, 0, w, int(h * frac)))), 200)
        im.save(os.path.join(OUT, out), optimize=True)
        log.append(f"{out} {im.size}")

    # --- grass color sample (no file saved; the engine uses the hex) ---
    grass = Image.open(SRC["grass"]).convert("RGB")
    gp = grass.load()
    samples = sorted(gp[x, y] for x in range(10, 60) for y in range(10, 60))
    mid = samples[len(samples) // 2]
    log.append(f"grass color ~ #{mid[0]:02x}{mid[1]:02x}{mid[2]:02x}")

    print("\n".join(log))


if __name__ == "__main__":
    main()
