"""Generate a 500×500 share card for WeChat / OpenGraph previews.

Output: src/assets/images/share-card.png

WeChat preview rules (as of 2026):
- Picks the first <img> >= 300x300 in the page, OR uses og:image
- Best results with SQUARE 500×500 PNG, < 200KB
- Caption falls back to <title> + meta[name="description"]
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / 'src' / 'assets' / 'images' / 'share-card.png'
LOGO = REPO / 'src' / 'assets' / 'images' / 'logo-horizontal.png'

W, H = 500, 500

# ---- Background: warm cream gradient + green ground at bottom ----
img = Image.new('RGB', (W, H), '#fef5e0')
draw = ImageDraw.Draw(img)

# Sky gradient
for y in range(0, 360):
    t = y / 360
    r = int(254 + (253 - 254) * t)
    g = int(245 + (248 - 245) * t)
    b = int(224 + (238 - 224) * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b))

# Green field at bottom (rolling hill)
for y in range(360, H):
    t = (y - 360) / (H - 360)
    r = int(174 + (88 - 174) * t)
    g = int(213 + (140 - 213) * t)
    b = int(129 + (80 - 129) * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b))

# Soft hill curve
hill = Image.new('RGBA', (W, 120), (0, 0, 0, 0))
hd = ImageDraw.Draw(hill)
hd.pieslice([-50, -40, W + 50, 200], 180, 360, fill=(124, 179, 66, 255))
img.paste(hill, (0, 320), hill)

# ---- Eastern Market logo at top ----
try:
    logo = Image.open(LOGO).convert('RGBA')
    lw, lh = logo.size
    target_w = 240
    target_h = int(lh * target_w / lw)
    logo = logo.resize((target_w, target_h), Image.LANCZOS)
    img.paste(logo, ((W - target_w) // 2, 24), logo)
except Exception as e:
    print(f"logo load failed: {e}", file=sys.stderr)

# ---- Game title "快乐农场" + "Happy Farm" ----
def load_font(size, bold=False):
    # Try Windows Chinese fonts in order of preference
    candidates = [
        'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc',
        'C:/Windows/Fonts/simhei.ttf',
        'C:/Windows/Fonts/simsun.ttc',
        'arial.ttf',
    ]
    for f in candidates:
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            continue
    return ImageFont.load_default()

title_font = load_font(60, bold=True)
en_font = load_font(26, bold=False)
tag_font = load_font(22, bold=True)
url_font = load_font(18, bold=False)

# Centered title with subtle shadow
title_zh = '快乐农场'
bbox = draw.textbbox((0, 0), title_zh, font=title_font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
title_x = (W - tw) // 2
title_y = 130
# Shadow
draw.text((title_x + 2, title_y + 3), title_zh, font=title_font, fill=(0, 0, 0, 80))
# Main
draw.text((title_x, title_y), title_zh, font=title_font, fill='#2a5c34')

# English subtitle
en_text = 'HAPPY FARM'
bbox2 = draw.textbbox((0, 0), en_text, font=en_font)
ew = bbox2[2] - bbox2[0]
draw.text(((W - ew) // 2, title_y + th + 12), en_text, font=en_font, fill='#3a8c50')

# ---- Crop sprout illustrations ----
# Just a simple sprout shape in green, repeated
def draw_sprout(x, y, scale=1.0):
    # Stem
    draw.line([(x, y), (x, y - int(40 * scale))], fill='#2e6b1d', width=int(4 * scale))
    # Left leaf
    draw.ellipse(
        [(x - int(20 * scale), y - int(38 * scale)),
         (x + int(2 * scale), y - int(18 * scale))],
        fill='#7cb342', outline='#3a6e1a', width=2
    )
    # Right leaf
    draw.ellipse(
        [(x - int(2 * scale), y - int(38 * scale)),
         (x + int(20 * scale), y - int(18 * scale))],
        fill='#9ccc65', outline='#3a6e1a', width=2
    )

# Five sprouts along the bottom field, varied sizes
draw_sprout(90,  440, scale=1.0)
draw_sprout(180, 460, scale=1.3)
draw_sprout(280, 455, scale=1.1)
draw_sprout(370, 470, scale=1.4)
draw_sprout(450, 450, scale=0.9)

# ---- Bottom tagline ----
tagline = '种菜 · 收获 · 来店换奖'
bbox3 = draw.textbbox((0, 0), tagline, font=tag_font)
tgw = bbox3[2] - bbox3[0]
# Background pill for readability
pad = 14
pill_w = tgw + pad * 2
pill_x = (W - pill_w) // 2
pill_y = 252
pill_overlay = Image.new('RGBA', (pill_w, 40), (255, 255, 255, 230))
po_d = ImageDraw.Draw(pill_overlay)
po_d.rounded_rectangle([(0, 0), (pill_w, 40)], radius=20, fill=(255, 248, 230, 245), outline=(232, 200, 130, 255), width=2)
img.paste(pill_overlay, (pill_x, pill_y), pill_overlay)
draw.text(((W - tgw) // 2, pill_y + 7), tagline, font=tag_font, fill='#8b5a00')

# URL footer
url_text = 'farm.easternmarket.ca'
bbox4 = draw.textbbox((0, 0), url_text, font=url_font)
uw = bbox4[2] - bbox4[0]
draw.text(((W - uw) // 2, H - 32), url_text, font=url_font, fill='#3a8c50')

# ---- Save ----
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, 'PNG', optimize=True)
print(f"Saved: {OUT}")
print(f"Size: {OUT.stat().st_size} bytes")
