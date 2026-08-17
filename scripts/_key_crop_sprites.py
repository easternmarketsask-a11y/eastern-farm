# -*- coding: utf-8 -*-
"""Key chroma-green crop paintings to transparent PNG + WebP in map/."""
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(r"D:\easternmarket.ca\eastern-farm")
MAP = ROOT / "src" / "assets" / "images" / "map"
SESS = Path(r"C:\Users\yue00\.grok\sessions\D%3A%5C\01a00718-f95b-7452-b183-7f5defbb801b\images")

JOBS = [
    ("85.jpg", "crop_narcissus"),
    ("86.jpg", "crop_taro"),
    ("87.jpg", "crop_ginger"),
    ("88.jpg", "crop_mango"),
    ("89.jpg", "crop_osmanthus"),
    ("90.jpg", "crop_dragon"),
    ("91.jpg", "crop_grape"),
    ("92.jpg", "crop_lychee"),
]


def key_green(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    hsv = rgba.convert("HSV")
    a = np.array(rgba)
    h = np.array(hsv)[:, :, 0]
    s = np.array(hsv)[:, :, 1]
    v = np.array(hsv)[:, :, 2]
    # chroma green: hue ~80-100 in PIL 0-255 (~120 deg)
    green = (h > 50) & (h < 115) & (s > 70) & (v > 70)
    alpha = a[:, :, 3].copy()
    alpha[green] = 0
    near = (~green) & (h > 45) & (h < 125) & (s > 45) & (v > 55)
    alpha[near] = np.minimum(alpha[near], 40)
    a[:, :, 3] = alpha
    return Image.fromarray(a, "RGBA")


def crop_content(im: Image.Image, pad=8) -> Image.Image:
    a = np.array(im)
    ys, xs = np.where(a[:, :, 3] > 12)
    if len(xs) == 0:
        return im
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(im.width - 1, x1 + pad)
    y1 = min(im.height - 1, y1 + pad)
    return im.crop((x0, y0, x1 + 1, y1 + 1))


def main():
    MAP.mkdir(parents=True, exist_ok=True)
    for src_name, stem in JOBS:
        src = SESS / src_name
        im = key_green(Image.open(src))
        im = crop_content(im)
        long = max(im.size)
        if long > 320:
            s = 320 / long
            im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.Resampling.LANCZOS)
        png = MAP / (stem + "_3.png")
        webp = MAP / (stem + "_3.webp")
        im.save(png, "PNG")
        im.save(webp, "WEBP", quality=90, method=6)
        print(stem, im.size, png.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
