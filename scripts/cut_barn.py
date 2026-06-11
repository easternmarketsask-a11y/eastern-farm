# -*- coding: utf-8 -*-
# Cut the 快乐仓库 barn from its background along a hand-traced silhouette.
# Supersampled polygon mask + slight feather → clean cartoon edge.
from PIL import Image, ImageDraw, ImageFilter

SRC = r'D:\Pictures\farm pictures\WhatsApp Image 2026-06-11 at 8.59.00 AM.jpeg'
OUT = r'D:\easternmarket.ca\eastern-farm\src\assets\images\warehouse-barn.png'
PREVIEW = r'C:\Users\yue00\AppData\Local\Temp\farm_test\barn_cut_preview.png'

# Silhouette vertices (clockwise, original 1408x768 coords), traced from the
# 50px grid overlay. Slightly inside the dark cartoon outline so no
# background bleeds; bottom follows the wall/post base line.
POLY = [
    (96, 556),    # left lean-to outer post base
    (94, 330),    # left lean-to roof outer top corner
    (118, 312),   # roof lip
    (352, 248),   # lean-to roof meets main wall
    (392, 126),   # gambrel knee (left)
    (482, 28),    # front ridge peak
    (560, 38),    # ridge running right-back
    (1086, 146),  # ridge right end (per row-scan of wood edge)
    (1160, 240),  # right roof edge (scan: x grows ~0.75/row)
    (1250, 292),  # roof → lean-to transition
    (1312, 336),  # right lean-to roof outer corner
    (1322, 600),  # right lean-to outer post base (fence starts ≥1335 — avoid)
    (1000, 602),
    (760, 594),
    (620, 586),
    (420, 574),
    (200, 562),
]

img = Image.open(SRC).convert('RGBA')
W, H = img.size
S = 3
mask_big = Image.new('L', (W * S, H * S), 0)
d = ImageDraw.Draw(mask_big)
d.polygon([(x * S, y * S) for (x, y) in POLY], fill=255)
mask = mask_big.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))

# ===== 周边裙边（2026-06-11 Chris：带点原图环境，别太突兀）=====
# 椭圆渐隐 alpha 把谷仓脚下的草地/灌木/土路一圈带进来，往外柔和化开，
# 融进游戏草坪。只作用于"植被/土路"色（绿系或亮土色），木栅栏(棕色)
# 不吃进来——免得出现半透明断桩。
import numpy as np
arr = np.asarray(img.convert('RGB')).astype(np.int16)
R, G, B = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
veg = (G > R + 8) & (G > B + 8)                         # 草/灌木
path = (R > 195) & (G > 160) & (B > 115) & (R > B + 40) # 亮土路
skirtable = veg | path

cx, cy, rx, ry = 705.0, 568.0, 640.0, 165.0
ys, xs = np.mgrid[0:H, 0:W]
dist = np.sqrt(((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2)
# 核心(0.55内)不透明度 ~210，向 1.0 衰减到 0；柔和 smoothstep
t = np.clip((1.0 - dist) / 0.45, 0, 1)
skirt = (t * t * (3 - 2 * t) * 215).astype(np.uint8)
skirt[~skirtable] = 0

mask_np = np.asarray(mask, dtype=np.uint8)
final = np.maximum(mask_np, skirt)
mask = Image.fromarray(final, 'L').filter(ImageFilter.GaussianBlur(0.8))

img.putalpha(mask)
bbox = mask.getbbox()
cut = img.crop(bbox)

# Downscale for the button (renders ~200 CSS px wide → 760 covers 2-3x DPR)
tw = 760
cut = cut.resize((tw, int(cut.height * tw / cut.width)), Image.LANCZOS)
cut.save(OUT, optimize=True)
print('saved', OUT, cut.size)

# Preview on a game-lawn-like green so edge quality is visible
bg = Image.new('RGBA', (cut.width + 80, cut.height + 80), (163, 192, 50, 255))
bg.alpha_composite(cut, (40, 40))
bg.convert('RGB').save(PREVIEW)
print('saved preview')
