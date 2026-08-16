#!/usr/bin/env python3
"""Editorial phone + A4 posters. Exact copy, painted on the keyart."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import io
import os
import segno

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'promo', 'keyart-farm-square.jpg')
LOGO = os.path.join(ROOT, 'src', 'assets', 'images', 'logo-horizontal.png')
OUT_PHONE = os.path.join(ROOT, 'promo', 'poster-phone.png')
OUT_A4 = os.path.join(ROOT, 'promo', 'poster-A4.png')

SERIF = r'C:\Windows\Fonts\NotoSerifSC-VF.ttf'
SANS = r'C:\Windows\Fonts\NotoSansSC-VF.ttf'
SANS_BD = r'C:\Windows\Fonts\msyhbd.ttc'
GEORGIA = r'C:\Windows\Fonts\georgiab.ttf'
GEORGIA_R = r'C:\Windows\Fonts\georgia.ttf'

CREAM = (246, 239, 224)
INK = (28, 38, 26)
GOLD = (201, 162, 74)
GOLD_SOFT = (212, 184, 122)
DUSK = (22, 28, 18)


def vf(path, size, weight=500, fallback=None):
    try:
        f = ImageFont.truetype(path, size)
        if hasattr(f, 'set_variation_by_axes'):
            try:
                f.set_variation_by_axes([weight])
            except Exception:
                pass
        return f
    except OSError:
        return ImageFont.truetype(fallback or SANS_BD, size)


def cover(im, tw, th, bias_y=0):
    s = max(tw / im.width, th / im.height)
    nw, nh = int(im.width * s + 0.5), int(im.height * s + 0.5)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (nw - tw) // 2
    y = max(0, min(nh - th, (nh - th) // 2 + bias_y))
    return im.crop((x, y, x + tw, y + th))


def spaced(draw, text, y, font, fill, tracking, canvas_w, shadow=None):
    widths = []
    for ch in text:
        b = draw.textbbox((0, 0), ch, font=font)
        widths.append(b[2] - b[0])
    total = sum(widths) + tracking * max(0, len(text) - 1)
    x = (canvas_w - total) / 2
    for ch, w in zip(text, widths):
        if shadow:
            draw.text((x + shadow[0], y + shadow[1]), ch, font=font, fill=shadow[2])
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking
    return total


def hairline(draw, cx, y, half, color, width=2):
    draw.line([(cx - half, y), (cx + half, y)], fill=color, width=width)


def make_qr(px, dark='#1c261a', light='#f6efe0'):
    buf = io.BytesIO()
    segno.make('https://farm.easternmarket.ca/', error='h').save(
        buf, kind='png', scale=10, border=1, dark=dark, light=light)
    buf.seek(0)
    qr = Image.open(buf).convert('RGBA')
    return qr.resize((px, px), Image.Resampling.LANCZOS)


def paste_logo(canvas, w, top, max_w):
    logo = Image.open(LOGO).convert('RGBA')
    lw = max_w
    lh = int(logo.height * lw / logo.width)
    logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
    # soft plate so the mark reads on any sky, without a chunky white card
    plate = Image.new('RGBA', (lw + 48, lh + 28), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    pd.rounded_rectangle([0, 0, plate.width - 1, plate.height - 1],
                         radius=18, fill=(246, 239, 224, 210))
    blurred = plate.filter(ImageFilter.GaussianBlur(0.4))
    px = (w - plate.width) // 2
    canvas.paste(blurred, (px, top), blurred)
    canvas.paste(logo, (px + 24, top + 14), logo)
    return top + plate.height


def phone():
    W, H = 1080, 1920
    art = cover(Image.open(ART).convert('RGB'), W, H, bias_y=20).convert('RGBA')

    wash = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(wash)
    for i in range(260):
        a = int(80 * (1 - i / 260) ** 1.4)
        d.line([(0, i), (W, i)], fill=(255, 232, 200, a))
    # 字落在独立的暮色带上，不跟路牌抢
    band = 700
    for i in range(band):
        t = i / (band - 1)
        a = int(8 + 248 * (t ** 1.25))
        d.line([(0, H - band + i), (W, H - band + i)], fill=(18, 24, 14, a))
    canvas = Image.alpha_composite(art, wash)
    paste_logo(canvas, W, 42, 248)

    draw = ImageDraw.Draw(canvas)
    title = vf(SERIF, 76, 620)
    en = ImageFont.truetype(GEORGIA, 20)
    meta = vf(SANS, 24, 500, SANS_BD)
    urlf = vf(SANS, 28, 620, SANS_BD)

    y0 = H - 548
    kick = vf(SANS, 22, 520, SANS_BD)
    spaced(draw, '东方超市会员专属', y0, kick, GOLD_SOFT, 8, W)
    spaced(draw, '玩农场游戏', y0 + 48, title, CREAM, 12, W, shadow=(0, 3, (0, 0, 0, 110)))
    spaced(draw, '赚超市积分', y0 + 142, title, CREAM, 12, W, shadow=(0, 3, (0, 0, 0, 110)))
    hairline(draw, W // 2, y0 + 252, 48, GOLD, 2)
    spaced(draw, 'PLAY THE FARM   ·   EARN STORE POINTS', y0 + 272, en, GOLD_SOFT, 2, W)

    qr = make_qr(168)
    qx, qy = 88, H - 268
    draw.rounded_rectangle([qx - 10, qy - 10, qx + 168 + 10, qy + 168 + 10],
                           radius=16, fill=CREAM)
    canvas.paste(qr, (qx, qy), qr)

    tx = 292
    draw.text((tx, H - 248), '扫码即玩', font=meta, fill=CREAM)
    draw.text((tx, H - 204), 'farm.easternmarket.ca', font=urlf, fill=GOLD_SOFT)
    draw.text((tx, H - 154), '积分每天进会员卡，到店可用', font=meta, fill=(214, 206, 188))

    rgb = canvas.convert('RGB')
    rgb.save(OUT_PHONE, 'PNG', optimize=True)
    rgb.save(OUT_PHONE.replace('.png', '.jpg'), 'JPEG', quality=93, optimize=True)
    print('wrote', OUT_PHONE, rgb.size)
    return rgb


def a4():
    # ~190 dpi A4, matches the previous print size
    W, H = 1587, 2245
    art_h = int(H * 0.47)
    canvas = Image.new('RGB', (W, H), (247, 241, 228))
    art = cover(Image.open(ART).convert('RGB'), W, art_h + 80, bias_y=40)
    canvas.paste(art, (0, 0))

    fade = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fade)
    for i in range(200):
        a = int(255 * (i / 199) ** 1.1)
        yy = art_h - 70 + i
        d.line([(0, yy), (W, yy)], fill=(247, 241, 228, a))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), fade)
    paste_logo(canvas, W, 48, 280)

    draw = ImageDraw.Draw(canvas)
    title = vf(SERIF, 110, 640)
    en = ImageFont.truetype(GEORGIA, 24)
    body = vf(SANS, 30, 450, SANS_BD)
    urlf = vf(SANS, 34, 650, SANS_BD)

    y = art_h + 150
    kick = vf(SANS, 28, 520, SANS_BD)
    spaced(draw, '东方超市会员专属', y, kick, (154, 118, 48), 10, W)
    spaced(draw, '玩农场游戏', y + 52, title, INK, 12, W)
    spaced(draw, '赚超市积分', y + 180, title, INK, 12, W)
    hairline(draw, W // 2, y + 328, 56, GOLD, 3)
    spaced(draw, 'PLAY THE FARM   ·   EARN STORE POINTS', y + 352, en, (154, 118, 48), 2, W)
    spaced(draw, '手机打开就能种，不用下载', y + 414, body, (72, 64, 52), 1, W)
    spaced(draw, '积分每天进入会员卡，到店买菜能用', y + 458, body, (72, 64, 52), 1, W)

    qr = make_qr(190, dark='#1c261a', light='#f7f1e4')
    qx = (W - 190) // 2
    qy = y + 528
    draw.rounded_rectangle([qx - 14, qy - 14, qx + 220 + 14, qy + 220 + 14],
                           radius=16, fill=(255, 255, 255), outline=GOLD, width=3)
    canvas.paste(qr, (qx, qy), qr)
    spaced(draw, 'farm.easternmarket.ca', qy + 228, urlf, INK, 1, W)
    spaced(draw, '扫码开始玩', qy + 276, body, (110, 96, 72), 2, W)

    rgb = canvas.convert('RGB')
    rgb.save(OUT_A4, 'PNG', optimize=True)
    print('wrote', OUT_A4, rgb.size)
    return rgb


if __name__ == '__main__':
    phone()
    a4()
