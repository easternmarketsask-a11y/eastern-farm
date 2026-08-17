# -*- coding: utf-8 -*-
"""Key chroma-green crop paintings to transparent PNG + WebP in map/."""
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(r"D:\easternmarket.ca\eastern-farm")
MAP = ROOT / "src" / "assets" / "images" / "map"
SESS = Path(r"C:\Users\yue00\.grok\sessions\D%3A%5C\01a00718-f95b-7452-b183-7f5defbb801b\images")

JOBS = [
    ("138.jpg", "crop_sprout", 0),
    ("135.jpg", "crop_sprout", 1),
    ("136.jpg", "crop_choysum", 3),
    ("137.jpg", "crop_spinach", 3),
]


def key_green(im: Image.Image) -> Image.Image:
    # 从四角采样实际幕布色（生成图经常不是纯 #00FF00），按 RGB 距离抠。
    # 不要用 HSV 色相：橄榄叶绿叶会跟幕布落在同一段色相里。
    rgba = im.convert("RGBA")
    a = np.array(rgba)
    rgb = a[:, :, :3].astype(np.float32)
    h, w = rgb.shape[:2]
    corners = np.stack([
        rgb[2, 2], rgb[2, w - 3], rgb[h - 3, 2], rgb[h - 3, w - 3],
        rgb[2, w // 2], rgb[h // 2, 2],
    ])
    bg = np.median(corners, axis=0)
    d = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    alpha = a[:, :, 3].astype(np.float32)
    alpha[d < 28] = 0
    near = (d >= 28) & (d < 52)
    alpha[near] = np.minimum(alpha[near], ((d[near] - 28.0) / 24.0) * 255.0)
    a[:, :, 3] = np.clip(alpha, 0, 255).astype(np.uint8)
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
    for job in JOBS:
        src_name, stem = job[0], job[1]
        stage = job[2] if len(job) > 2 else 3
        src = SESS / src_name
        im = key_green(Image.open(src))
        im = crop_content(im)
        long = max(im.size)
        if long > 320:
            s = 320 / long
            im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.Resampling.LANCZOS)
        tag = stem + "_" + str(stage)
        png = MAP / (tag + ".png")
        webp = MAP / (tag + ".webp")
        im.save(png, "PNG")
        im.save(webp, "WEBP", quality=90, method=6)
        print(tag, im.size, png.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
