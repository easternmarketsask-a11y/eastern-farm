"""Generate a 500×500 share card for WeChat / OpenGraph previews.

Output: src/assets/images/share-card.png
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / 'src' / 'assets' / 'images' / 'share-card.png'
LOGO = REPO / 'src' / 'assets' / 'images' / 'logo-horizontal.png'
ART = REPO / 'promo' / 'keyart-farm-square.jpg'

W, H = 500, 500


def load_font(size, bold=False, serif=False):
    if serif:
        for f in [r'C:\Windows\Fonts\NotoSerifSC-VF.ttf', r'C:\Windows\Fonts\msyhbd.ttc']:
            try:
                font = ImageFont.truetype(f, size)
                if hasattr(font, 'set_variation_by_axes'):
                    try:
                        font.set_variation_by_axes([700 if bold else 560])
                    except Exception:
                        pass
                return font
            except Exception:
                continue
    for f in [
        r'C:\Windows\Fonts\georgiab.ttf' if bold else r'C:\Windows\Fonts\georgia.ttf',
        r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
    ]:
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            continue
    return ImageFont.load_default()


def cover(im, tw, th, bias_y=40):
    s = max(tw / im.width, th / im.height)
    nw, nh = int(im.width * s + 0.5), int(im.height * s + 0.5)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (nw - tw) // 2
    y = max(0, min(nh - th, (nh - th) // 2 + bias_y))
    return im.crop((x, y, x + tw, y + th))


art = cover(Image.open(ART).convert('RGB'), W, H, bias_y=30).convert('RGBA')
wash = Image.new('RGBA', (W, H), (0, 0, 0, 0))
wd = ImageDraw.Draw(wash)
for i in range(170):
    a = int(90 * (1 - i / 170) ** 1.35)
    wd.line([(0, i), (W, i)], fill=(40, 28, 16, a))
for i in range(90):
    a = int(70 * (i / 89) ** 1.2)
    wd.line([(0, H - 90 + i), (W, H - 90 + i)], fill=(20, 16, 10, a))
canvas = Image.alpha_composite(art, wash)
draw = ImageDraw.Draw(canvas)

logo = Image.open(LOGO).convert('RGBA')
lw = 200
lh = int(logo.height * lw / logo.width)
logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
plate = Image.new('RGBA', (lw + 36, lh + 20), (0, 0, 0, 0))
pd = ImageDraw.Draw(plate)
pd.rounded_rectangle([0, 0, plate.width - 1, plate.height - 1], radius=14, fill=(246, 239, 224, 230))
px = (W - plate.width) // 2
canvas.paste(plate, (px, 16), plate)
canvas.paste(logo, (px + 18, 26), logo)

title_font = load_font(44, bold=True, serif=True)
en_font = load_font(22, bold=True)
url_font = load_font(15, bold=True)
draw = ImageDraw.Draw(canvas)

title_zh = '东方农场'
tb = draw.textbbox((0, 0), title_zh, font=title_font)
tw, th = tb[2] - tb[0], tb[3] - tb[1]
tx, ty = (W - tw) // 2, 16 + plate.height + 14
draw.text((tx + 1, ty + 2), title_zh, font=title_font, fill=(20, 14, 8, 140))
draw.text((tx, ty), title_zh, font=title_font, fill=(255, 248, 236))

en = 'Eastern Farm'
eb = draw.textbbox((0, 0), en, font=en_font)
ex = (W - (eb[2] - eb[0])) // 2
draw.text((ex, ty + th + 22), en, font=en_font, fill=(255, 244, 210))

bar = Image.new('RGBA', (W, 44), (246, 239, 224, 235))
canvas.paste(bar, (0, H - 44), bar)
url = 'farm.easternmarket.ca'
ub = draw.textbbox((0, 0), url, font=url_font)
ux = (W - (ub[2] - ub[0])) // 2
draw = ImageDraw.Draw(canvas)
draw.text((ux, H - 32), url, font=url_font, fill=(42, 74, 40))

rgb = canvas.convert('RGB')
q = rgb.convert('P', palette=Image.ADAPTIVE, colors=128)
q.save(OUT, 'PNG', optimize=True)
print('Saved:', OUT, OUT.stat().st_size, 'bytes')
