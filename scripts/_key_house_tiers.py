# -*- coding: utf-8 -*-
"""Cut cream studio bg from house concept art → transparent webp sprites."""
from pathlib import Path
import numpy as np
from PIL import Image
from collections import deque

SRC = Path(r"D:\easternmarket.ca\eastern-farm\promo\houses")
DST = Path(r"D:\easternmarket.ca\eastern-farm\src\assets\images\map")

JOBS = [
    ("01-nonghu-cottage.jpg", "p_house_1", 420),
    ("02-brick-farmhouse.jpg", "p_house_2", 460),
    ("03-courtyard-home.jpg", "p_house_3", 520),
    ("04-country-villa.jpg", "p_house_4", 580),
    ("05-garden-manor.jpg", "p_house_5", 620),
    ("06-pool-villa.jpg", "p_house_6", 680),
    ("07-lakeside-mansion.jpg", "p_house_7", 740),
    ("08-eastern-estate.jpg", "p_house_8", 800),
    ("09-stone-hut.jpg", "p_house_9", 420),
    ("10-grey-courtyard.jpg", "p_house_10", 520),
    ("11-twin-villa.jpg", "p_house_11", 580),
    ("12-pergola-manor.jpg", "p_house_12", 620),
    ("13-round-pool.jpg", "p_house_13", 680),
    ("14-garden-estate.jpg", "p_house_14", 800),
]


def cream(r, g, b):
    # studio beige: high, close RGB, not green grass / not wood
    mx, mn = max(r, g, b), min(r, g, b)
    if r < 195 or g < 180 or b < 150:
        return False
    if mx - mn > 72:
        return False
    if g > r + 8:  # grass-leaning
        return False
    return True


def flood_cream(arr):
    h, w = arr.shape[:2]
    vis = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        q.append((0, x))
        q.append((h - 1, x))
    for y in range(h):
        q.append((y, 0))
        q.append((y, w - 1))
    while q:
        y, x = q.popleft()
        if vis[y, x]:
            continue
        vis[y, x] = True
        r, g, b, a = (int(arr[y, x, 0]), int(arr[y, x, 1]),
                      int(arr[y, x, 2]), int(arr[y, x, 3]))
        if a == 0 or cream(r, g, b):
            arr[y, x, 3] = 0
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and not vis[ny, nx]:
                    q.append((ny, nx))
    # feather 1px on the cream frontier so no beige halo
    a = arr[:, :, 3]
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if a[y, x] == 0:
                continue
            if (a[y - 1, x] == 0 or a[y + 1, x] == 0
                    or a[y, x - 1] == 0 or a[y, x + 1] == 0):
                r, g, b = int(arr[y, x, 0]), int(arr[y, x, 1]), int(arr[y, x, 2])
                if cream(r, g, b) or (r > 210 and g > 200 and b > 175):
                    arr[y, x, 3] = 0
    return arr


def crop_pad(im, pad=8):
    a = np.array(im)
    ys, xs = np.where(a[:, :, 3] > 8)
    if len(xs) == 0:
        return im
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + 1 + pad)
    return Image.fromarray(a[y0:y1, x0:x1])


def main():
    DST.mkdir(parents=True, exist_ok=True)
    for src_name, stem, max_side in JOBS:
        src = SRC / src_name
        im = Image.open(src).convert("RGBA")
        arr = np.array(im)
        arr = flood_cream(arr)
        out = crop_pad(Image.fromarray(arr))
        w, h = out.size
        m = max(w, h)
        if m > max_side:
            s = max_side / m
            out = out.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)
        dest = DST / f"{stem}.webp"
        out.save(dest, "WEBP", quality=88, method=6)
        print(f"{stem}: {out.size} -> {dest.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
