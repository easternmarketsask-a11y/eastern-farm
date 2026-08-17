#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""US Letter 8.5x11 print poster (300 dpi). New files — does not overwrite A4."""
from PIL import Image, ImageDraw, ImageFont
import io
import os
import segno

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'promo', 'keyart-farm-square.jpg')
LOGO = os.path.join(ROOT, 'src', 'assets', 'images', 'logo-horizontal.png')
OUT_PNG = os.path.join(ROOT, 'promo', 'poster-letter-8.5x11.png')
OUT_JPG = os.path.join(ROOT, 'promo', 'poster-letter-8.5x11.jpg')
OUT_PDF = os.path.join(ROOT, 'promo', 'poster-letter-8.5x11.pdf')

SERIF = r'C:\Windows\Fonts\NotoSerifSC-VF.ttf'
SANS = r'C:\Windows\Fonts\NotoSansSC-VF.ttf'
SANS_BD = r'C:\Windows\Fonts\msyhbd.ttc'
GEORGIA = r'C:\Windows\Fonts\georgiab.ttf'
GEORGIA_R = r'C:\Windows\Fonts\georgia.ttf'

CREAM = (246, 239, 224)
INK = (28, 38, 26)
GOLD = (212, 184, 122)
FOREST = (42, 74, 40)

# 8.5" x 11" at 300 dpi. Home printers clip ~0.25–0.4"; keep type inside SAFE.
W, H = 2550, 3300
SAFE = 150  # 0.5"


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
        buf, kind='png', scale=12, border=2, dark='#1c261a', light='#f6efe0')
    buf.seek(0)
    return Image.open(buf).convert('RGBA').resize((px, px), Image.Resampling.LANCZOS)


def paste_logo(canvas, w, top, max_w):
    logo = Image.open(LOGO).convert('RGBA')
    lw = max_w
    lh = int(logo.height * lw / logo.width)
    logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
    plate = Image.new('RGBA', (lw + 56, lh + 32), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    pd.rounded_rectangle([0, 0, plate.width - 1, plate.height - 1],
                         radius=20, fill=(246, 239, 224, 230))
    px = (w - plate.width) // 2
    canvas.paste(plate, (px, top), plate)
    canvas.paste(logo, (px + 28, top + 16), logo)


def kicker_pill(draw, y, canvas_w, zh_font, en_font):
    zh, en = '东方超市会员专属', 'Members Exclusive'
    zh_w, zh_h = measure(draw, zh, zh_font)
    mid = '  ·  '
    mid_w, _ = measure(draw, mid, zh_font)
    en_w, en_h = measure(draw, en, en_font)
    pad_x, pad_y = 34, 16
    bw = zh_w + mid_w + en_w + pad_x * 2
    bh = max(zh_h, en_h) + pad_y * 2
    bx = (canvas_w - bw) / 2
    draw.rounded_rectangle([bx, y, bx + bw, y + bh], radius=bh / 2, fill=CREAM)
    cy = y + pad_y - 2
    draw.text((bx + pad_x, cy), zh, font=zh_font, fill=INK)
    draw.text((bx + pad_x + zh_w, cy), mid, font=zh_font, fill=GOLD)
    draw.text((bx + pad_x + zh_w + mid_w, cy + (zh_h - en_h) / 2), en, font=en_font, fill=INK)
    return y + bh


def dusk(canvas, w, h, band, top_band=0):
    wash = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(wash)
    for i in range(280):
        a = int(78 * (1 - i / 280) ** 1.4)
        d.line([(0, i), (w, i)], fill=(255, 232, 200, a))
    if top_band > 1:
        for i in range(top_band):
            t = 1 - i / (top_band - 1)
            a = int(110 * (t ** 1.25))
            d.line([(0, i), (w, i)], fill=(42, 30, 18, a))
    for i in range(band):
        t = i / (band - 1)
        a = int(12 + 248 * (t ** 1.12))
        d.line([(0, h - band + i), (w, h - band + i)], fill=(16, 22, 12, a))
    return Image.alpha_composite(canvas, wash)


def scan_bar(canvas):
    """04c 同款奶油扫码栏。"""
    bar_h = 520
    top = H - bar_h
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rectangle([0, top, W, H], fill=(246, 239, 224, 252))
    ld.rectangle([0, top, W, top + 12], fill=(201, 162, 74, 255))
    ld.rectangle([0, top + 12, W, top + 16], fill=(42, 74, 40, 220))
    canvas = Image.alpha_composite(canvas, layer)
    draw = ImageDraw.Draw(canvas)

    qr_px = 360
    qr = make_qr(qr_px)
    qx = SAFE + 20
    qy = top + (bar_h - qr_px) // 2 + 6
    draw.rounded_rectangle(
        [qx - 14, qy - 14, qx + qr_px + 14, qy + qr_px + 14],
        radius=22, fill=CREAM, outline=(201, 162, 74), width=6)
    canvas.paste(qr, (qx, qy), qr)

    zh = vf(SANS, 68, 720, SANS_BD)
    en = ImageFont.truetype(GEORGIA, 38)
    urlf = vf(SANS, 46, 720, SANS_BD)
    sub = vf(SANS, 36, 560, SANS_BD)
    sub_en = ImageFont.truetype(GEORGIA_R, 30)
    tx = qx + qr_px + 56
    ty = qy + 18
    draw.text((tx, ty), '扫码即玩', font=zh, fill=INK)
    draw.text((tx, ty + 88), 'Scan to play', font=en, fill=FOREST)
    draw.text((tx, ty + 148), 'farm.easternmarket.ca', font=urlf, fill=FOREST)
    draw.text((tx, ty + 220), '积分每天进会员卡，到店可用', font=sub, fill=INK)
    draw.text((tx, ty + 272), 'Points on your member card', font=sub_en, fill=(90, 78, 48))
    return canvas


def letter():
    # 04c：店名上天，胶囊+对联贴扫码栏，菜地全露
    BAR_H = 520
    art = cover(Image.open(ART).convert('RGB'), W, H, bias_y=10).convert('RGBA')
    canvas = dusk(art, W, H, 720, top_band=620)
    paste_logo(canvas, W, SAFE - 16, 400)
    draw = ImageDraw.Draw(canvas)

    name = vf(SERIF, 148, 660)
    title = vf(SERIF, 78, 560)
    kick_zh = vf(SANS, 34, 650, SANS_BD)
    kick_en = ImageFont.truetype(GEORGIA, 30)
    en_name = ImageFont.truetype(GEORGIA, 64)
    en_line = ImageFont.truetype(GEORGIA, 34)
    cream_en = (255, 244, 214)
    couplet_en = (243, 224, 176)

    name_y = 390
    spaced(draw, '东方农场', name_y, name, CREAM, 20, W, shadow=(0, 4, (0, 0, 0, 150)))
    center(draw, 'Eastern Farm', name_y + 228, en_name, cream_en, W,
           shadow=(0, 3, (0, 0, 0, 170)))

    bar_top = H - BAR_H
    en_y = bar_top - 78
    zh2_y = en_y - 158
    zh1_y = zh2_y - 132
    kick_y = zh1_y - 110
    kicker_pill(draw, kick_y, W, kick_zh, kick_en)
    spaced(draw, '玩农场游戏', zh1_y, title, CREAM, 10, W, shadow=(0, 3, (0, 0, 0, 140)))
    spaced(draw, '赚超市积分', zh2_y, title, CREAM, 10, W, shadow=(0, 3, (0, 0, 0, 140)))
    center(draw, 'PLAY THE FARM  ·  EARN STORE POINTS', en_y, en_line,
           couplet_en, W, shadow=(0, 2, (0, 0, 0, 150)))

    canvas = scan_bar(canvas)

    rgb = canvas.convert('RGB')
    rgb.save(OUT_PNG, 'PNG', optimize=True, dpi=(300, 300))
    rgb.save(OUT_JPG, 'JPEG', quality=94, optimize=True, dpi=(300, 300))
    # 整图嵌入 PDF，保持 8.5×11 / 300dpi，不走 Pillow 默认压缩
    import fitz
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_image(page.rect, filename=OUT_PNG)
    doc.save(OUT_PDF, deflate=True)
    doc.close()
    print('wrote', OUT_PNG, rgb.size)
    print('wrote', OUT_PDF)


if __name__ == '__main__':
    letter()
