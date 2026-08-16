#!/usr/bin/env python3
"""On-art posters (text over the painting). Writes NEW files — does not replace
promo/poster-phone.png or poster-A4.png."""
from PIL import Image, ImageDraw, ImageFont
import io
import os
import segno

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'promo', 'keyart-farm-square.jpg')
LOGO = os.path.join(ROOT, 'src', 'assets', 'images', 'logo-horizontal.png')
# 新版另存，不覆盖 poster-phone-onart / poster-phone-onart-01
OUT_PHONE = os.path.join(ROOT, 'promo', 'poster-phone-onart-02.png')
OUT_A4 = os.path.join(ROOT, 'promo', 'poster-A4-onart-02.png')

SERIF = r'C:\Windows\Fonts\NotoSerifSC-VF.ttf'
SANS = r'C:\Windows\Fonts\NotoSansSC-VF.ttf'
SANS_BD = r'C:\Windows\Fonts\msyhbd.ttc'
GEORGIA = r'C:\Windows\Fonts\georgiab.ttf'
GEORGIA_R = r'C:\Windows\Fonts\georgia.ttf'

CREAM = (246, 239, 224)
INK = (28, 38, 26)
GOLD = (212, 184, 122)
FOREST = (42, 74, 40)


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


def measure(draw, text, font):
    b = draw.textbbox((0, 0), text, font=font)
    return b[2] - b[0], b[3] - b[1]


def spaced(draw, text, y, font, fill, tracking, canvas_w, shadow=None):
    widths = [measure(draw, ch, font)[0] for ch in text]
    total = sum(widths) + tracking * max(0, len(text) - 1)
    x = (canvas_w - total) / 2
    for ch, w in zip(text, widths):
        if shadow:
            draw.text((x + shadow[0], y + shadow[1]), ch, font=font, fill=shadow[2])
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking


def center(draw, text, y, font, fill, canvas_w, shadow=None):
    w, _ = measure(draw, text, font)
    x = (canvas_w - w) / 2
    if shadow:
        draw.text((x + shadow[0], y + shadow[1]), text, font=font, fill=shadow[2])
    draw.text((x, y), text, font=font, fill=fill)


def make_qr(px):
    buf = io.BytesIO()
    segno.make('https://farm.easternmarket.ca/', error='h').save(
        buf, kind='png', scale=10, border=1, dark='#1c261a', light='#f6efe0')
    buf.seek(0)
    return Image.open(buf).convert('RGBA').resize((px, px), Image.Resampling.LANCZOS)


def paste_logo(canvas, w, top, max_w):
    logo = Image.open(LOGO).convert('RGBA')
    lw = max_w
    lh = int(logo.height * lw / logo.width)
    logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
    plate = Image.new('RGBA', (lw + 44, lh + 24), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    pd.rounded_rectangle([0, 0, plate.width - 1, plate.height - 1],
                         radius=16, fill=(246, 239, 224, 225))
    px = (w - plate.width) // 2
    canvas.paste(plate, (px, top), plate)
    canvas.paste(logo, (px + 22, top + 12), logo)


def kicker_pill(draw, y, canvas_w, zh_font, en_font):
    zh, en = '东方超市会员专属', 'Members Exclusive'
    zh_w, zh_h = measure(draw, zh, zh_font)
    mid = '  ·  '
    mid_w, _ = measure(draw, mid, zh_font)
    en_w, en_h = measure(draw, en, en_font)
    pad_x, pad_y = 22, 11
    bw = zh_w + mid_w + en_w + pad_x * 2
    bh = max(zh_h, en_h) + pad_y * 2
    bx = (canvas_w - bw) / 2
    draw.rounded_rectangle([bx, y, bx + bw, y + bh], radius=bh / 2, fill=CREAM)
    cy = y + pad_y - 2
    draw.text((bx + pad_x, cy), zh, font=zh_font, fill=INK)
    draw.text((bx + pad_x + zh_w, cy), mid, font=zh_font, fill=GOLD)
    draw.text((bx + pad_x + zh_w + mid_w, cy + (zh_h - en_h) / 2), en, font=en_font, fill=INK)
    return y + bh


def dusk(canvas, w, h, band):
    wash = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(wash)
    for i in range(220):
        a = int(70 * (1 - i / 220) ** 1.4)
        d.line([(0, i), (w, i)], fill=(255, 232, 200, a))
    for i in range(band):
        t = i / (band - 1)
        a = int(12 + 248 * (t ** 1.12))
        d.line([(0, h - band + i), (w, h - band + i)], fill=(16, 22, 12, a))
    return Image.alpha_composite(canvas, wash)


def phone():
    W, H = 1080, 1920
    art = cover(Image.open(ART).convert('RGB'), W, H, bias_y=10).convert('RGBA')
    canvas = dusk(art, W, H, 820)
    paste_logo(canvas, W, 40, 232)
    draw = ImageDraw.Draw(canvas)

    # 对齐 onart-01：胶囊 → 东方农场 → 留空 → Eastern Farm → 两行利益句 → 英文
    name = vf(SERIF, 88, 660)
    title = vf(SERIF, 48, 560)
    kick_zh = vf(SANS, 22, 650, SANS_BD)
    kick_en = ImageFont.truetype(GEORGIA, 20)
    en_name = ImageFont.truetype(GEORGIA, 30)
    en_line = ImageFont.truetype(GEORGIA, 22)
    meta = vf(SANS, 24, 560, SANS_BD)
    meta_en = ImageFont.truetype(GEORGIA, 22)
    urlf = vf(SANS, 26, 650, SANS_BD)

    by = kicker_pill(draw, H - 740, W, kick_zh, kick_en)
    spaced(draw, '东方农场', by + 20, name, CREAM, 16, W, shadow=(0, 3, (0, 0, 0, 130)))
    center(draw, 'Eastern Farm', by + 168, en_name, GOLD, W, shadow=(0, 2, (0, 0, 0, 100)))
    spaced(draw, '玩农场游戏', by + 220, title, CREAM, 8, W)
    spaced(draw, '赚超市积分', by + 282, title, CREAM, 8, W)
    center(draw, 'PLAY THE FARM  ·  EARN STORE POINTS', by + 348, en_line, GOLD, W)

    qr = make_qr(152)
    qx, qy = 80, H - 230
    draw.rounded_rectangle([qx - 8, qy - 8, qx + 152 + 8, qy + 152 + 8],
                           radius=14, fill=CREAM)
    canvas.paste(qr, (qx, qy), qr)
    tx = 260
    draw.text((tx, H - 220), '扫码即玩', font=meta, fill=CREAM)
    draw.text((tx, H - 188), 'Scan to play', font=meta_en, fill=GOLD)
    draw.text((tx, H - 148), 'farm.easternmarket.ca', font=urlf, fill=GOLD)
    draw.text((tx, H - 108), '积分每天进会员卡，到店可用', font=meta, fill=CREAM)
    draw.text((tx, H - 76), 'Points on your member card', font=meta_en, fill=GOLD)

    rgb = canvas.convert('RGB')
    rgb.save(OUT_PHONE, 'PNG', optimize=True)
    rgb.save(OUT_PHONE.replace('.png', '.jpg'), 'JPEG', quality=93, optimize=True)
    print('wrote', OUT_PHONE, rgb.size)


def a4():
    W, H = 1587, 2245
    art = cover(Image.open(ART).convert('RGB'), W, H, bias_y=40).convert('RGBA')
    canvas = dusk(art, W, H, 980)
    paste_logo(canvas, W, 48, 260)
    draw = ImageDraw.Draw(canvas)

    name = vf(SERIF, 110, 660)
    title = vf(SERIF, 52, 560)
    kick_zh = vf(SANS, 28, 650, SANS_BD)
    kick_en = ImageFont.truetype(GEORGIA, 26)
    en_name = ImageFont.truetype(GEORGIA, 36)
    en_line = ImageFont.truetype(GEORGIA, 30)
    meta = vf(SANS, 30, 560, SANS_BD)
    meta_en = ImageFont.truetype(GEORGIA, 26)
    urlf = vf(SANS, 32, 650, SANS_BD)

    by = kicker_pill(draw, H - 900, W, kick_zh, kick_en)
    spaced(draw, '东方农场', by + 28, name, CREAM, 16, W, shadow=(0, 3, (0, 0, 0, 130)))
    center(draw, 'Eastern Farm', by + 188, en_name, GOLD, W)
    spaced(draw, '玩农场游戏', by + 250, title, CREAM, 10, W)
    spaced(draw, '赚超市积分', by + 320, title, CREAM, 10, W)
    center(draw, 'PLAY THE FARM  ·  EARN STORE POINTS', by + 396, en_line, GOLD, W)

    qr = make_qr(180)
    qx = (W - 180) // 2
    qy = H - 310
    draw.rounded_rectangle([qx - 10, qy - 10, qx + 180 + 10, qy + 180 + 10],
                           radius=16, fill=CREAM)
    canvas.paste(qr, (qx, qy), qr)
    center(draw, '扫码即玩  ·  Scan to play', qy + 198, meta, CREAM, W)
    center(draw, 'farm.easternmarket.ca', qy + 238, urlf, GOLD, W)

    rgb = canvas.convert('RGB')
    rgb.save(OUT_A4, 'PNG', optimize=True)
    print('wrote', OUT_A4, rgb.size)


if __name__ == '__main__':
    phone()
    a4()
