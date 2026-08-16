#!/usr/bin/env python3
"""Bilingual posters: Chinese and English as designed partners, not stacked subtitles."""
from PIL import Image, ImageDraw, ImageFont
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

CREAM = (247, 241, 228)
INK = (28, 38, 26)
GOLD = (176, 132, 52)
FOREST = (42, 74, 40)
MUTED = (92, 80, 62)


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


def tw(draw, text, font):
    b = draw.textbbox((0, 0), text, font=font)
    return b[2] - b[0], b[3] - b[1]


def center(draw, text, y, font, fill, canvas_w):
    w, _ = tw(draw, text, font)
    draw.text(((canvas_w - w) / 2, y), text, font=font, fill=fill)


def spaced_center(draw, text, y, font, fill, tracking, canvas_w):
    widths = [tw(draw, ch, font)[0] for ch in text]
    total = sum(widths) + tracking * max(0, len(text) - 1)
    x = (canvas_w - total) / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking


def make_qr(px, dark='#1c261a', light='#f7f1e4'):
    buf = io.BytesIO()
    segno.make('https://farm.easternmarket.ca/', error='h').save(
        buf, kind='png', scale=10, border=1, dark=dark, light=light)
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
                         radius=16, fill=(247, 241, 228, 230))
    px = (w - plate.width) // 2
    canvas.paste(plate, (px, top), plate)
    canvas.paste(logo, (px + 22, top + 12), logo)
    return top + plate.height


def phone():
    W, H = 1080, 1920
    art_h = 1360
    canvas = Image.new('RGB', (W, H), CREAM)
    art = cover(Image.open(ART).convert('RGB'), W, art_h + 90, bias_y=30)
    canvas.paste(art, (0, 0))
    fade = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fade)
    for i in range(160):
        a = int(255 * (i / 159) ** 1.15)
        d.line([(0, art_h - 70 + i), (W, art_h - 70 + i)], fill=CREAM + (a,))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), fade)
    paste_logo(canvas, W, 40, 236)

    draw = ImageDraw.Draw(canvas)
    name = vf(SERIF, 78, 660)
    line = vf(SERIF, 36, 540)
    kick_zh = vf(SANS, 22, 650, SANS_BD)
    kick_en = ImageFont.truetype(GEORGIA, 15)
    en = ImageFont.truetype(GEORGIA, 18)
    en_i = ImageFont.truetype(GEORGIA_R, 16)
    meta = vf(SANS, 24, 560, SANS_BD)
    urlf = vf(SANS, 24, 650, SANS_BD)

    y = art_h + 8
    # one bilingual kicker, zh · en on one pill
    kicker = '东方超市会员专属   ·   Members Exclusive'
    kw, kh = tw(draw, kicker, kick_zh)
    # measure with mixed fonts roughly via zh font width
    pad_x, pad_y = 22, 10
    kw, _ = tw(draw, '东方超市会员专属   ·   Members Exclusive', kick_zh)
    # tighter: draw as two parts
    zh_w, zh_h = tw(draw, '东方超市会员专属', kick_zh)
    mid_w, _ = tw(draw, '  ·  ', kick_zh)
    en_w, en_h = tw(draw, 'Members Exclusive', kick_en)
    bw = zh_w + mid_w + en_w + pad_x * 2
    bh = max(zh_h, en_h) + pad_y * 2
    bx = (W - bw) / 2
    draw.rounded_rectangle([bx, y, bx + bw, y + bh], radius=bh / 2, fill=FOREST)
    cx = bx + pad_x
    cy = y + pad_y - 2
    draw.text((cx, cy), '东方超市会员专属', font=kick_zh, fill=CREAM)
    draw.text((cx + zh_w, cy), '  ·  ', font=kick_zh, fill=GOLD)
    draw.text((cx + zh_w + mid_w, cy + 3), 'Members Exclusive', font=kick_en, fill=CREAM)

    y = y + bh + 22
    spaced_center(draw, '东方农场', y, name, INK, 14, W)
    center(draw, 'Eastern Farm', y + 92, en, GOLD, W)
    draw.line([(W / 2 - 36, y + 128), (W / 2 + 36, y + 128)], fill=GOLD, width=2)
    spaced_center(draw, '玩农场游戏，赚超市积分', y + 148, line, INK, 4, W)
    center(draw, 'Play the farm. Earn store points.', y + 200, en_i, MUTED, W)

    qr = make_qr(132)
    qy = y + 248
    qx = 88
    draw.rounded_rectangle([qx - 8, qy - 8, qx + 132 + 8, qy + 132 + 8],
                           radius=12, fill=(255, 255, 255), outline=GOLD, width=2)
    canvas.paste(qr, (qx, qy), qr)
    tx = 250
    draw.text((tx, qy + 6), '扫码即玩  ·  Scan to play', font=meta, fill=INK)
    draw.text((tx, qy + 44), 'farm.easternmarket.ca', font=urlf, fill=FOREST)
    draw.text((tx, qy + 82), '积分进会员卡，到店可用', font=meta, fill=MUTED)
    draw.text((tx, qy + 112), 'Points on your member card', font=en_i, fill=MUTED)

    rgb = canvas.convert('RGB')
    rgb.save(OUT_PHONE, 'PNG', optimize=True)
    rgb.save(OUT_PHONE.replace('.png', '.jpg'), 'JPEG', quality=93, optimize=True)
    print('wrote', OUT_PHONE, rgb.size)
    return rgb


def a4():
    W, H = 1587, 2245
    art_h = int(H * 0.46)
    canvas = Image.new('RGB', (W, H), CREAM)
    art = cover(Image.open(ART).convert('RGB'), W, art_h + 80, bias_y=36)
    canvas.paste(art, (0, 0))
    fade = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fade)
    for i in range(180):
        a = int(255 * (i / 179) ** 1.1)
        d.line([(0, art_h - 70 + i), (W, art_h - 70 + i)], fill=CREAM + (a,))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), fade)
    paste_logo(canvas, W, 44, 260)

    draw = ImageDraw.Draw(canvas)
    name_zh = vf(SERIF, 72, 660)
    name_en = ImageFont.truetype(GEORGIA, 36)
    body_zh = vf(SERIF, 36, 540)
    body_en = ImageFont.truetype(GEORGIA_R, 28)
    kick_zh = vf(SANS, 26, 650, SANS_BD)
    kick_en = ImageFont.truetype(GEORGIA, 16)
    small = vf(SANS, 26, 500, SANS_BD)
    urlf = vf(SANS, 30, 650, SANS_BD)

    y = art_h + 56
    zh_w, zh_h = tw(draw, '东方超市会员专属', kick_zh)
    mid_w, _ = tw(draw, '   ·   ', kick_zh)
    en_w, en_h = tw(draw, 'Members Exclusive', kick_en)
    pad_x, pad_y = 28, 11
    bw = zh_w + mid_w + en_w + pad_x * 2
    bh = max(zh_h, en_h) + pad_y * 2
    bx = (W - bw) / 2
    draw.rounded_rectangle([bx, y, bx + bw, y + bh], radius=bh / 2, fill=FOREST)
    draw.text((bx + pad_x, y + pad_y - 2), '东方超市会员专属', font=kick_zh, fill=CREAM)
    draw.text((bx + pad_x + zh_w, y + pad_y - 2), '   ·   ', font=kick_zh, fill=GOLD)
    draw.text((bx + pad_x + zh_w + mid_w, y + pad_y + 2), 'Members Exclusive', font=kick_en, fill=CREAM)

    # two equal columns — ZH left, EN right
    mid = W / 2
    left = 120
    right = mid + 48
    col_top = y + bh + 36
    draw.line([(mid, col_top + 8), (mid, col_top + 340)], fill=(210, 190, 150), width=2)

    draw.text((left, col_top), '东方农场', font=name_zh, fill=INK)
    draw.text((right, col_top + 18), 'Eastern Farm', font=name_en, fill=FOREST)

    draw.text((left, col_top + 110), '玩农场游戏', font=body_zh, fill=INK)
    draw.text((left, col_top + 164), '赚超市积分', font=body_zh, fill=INK)
    draw.text((right, col_top + 116), 'Play the farm', font=body_en, fill=MUTED)
    draw.text((right, col_top + 170), 'Earn store points', font=body_en, fill=MUTED)

    draw.text((left, col_top + 250), '手机打开就能种', font=small, fill=MUTED)
    draw.text((left, col_top + 290), '积分进会员卡，到店能用', font=small, fill=MUTED)
    draw.text((right, col_top + 250), 'Open on your phone — no app', font=en_i if False else ImageFont.truetype(GEORGIA_R, 22), fill=MUTED)
    draw.text((right, col_top + 290), 'Points on your member card', font=ImageFont.truetype(GEORGIA_R, 22), fill=MUTED)

    qr = make_qr(168)
    qx = int((W - 168) / 2)
    qy = col_top + 370
    draw.rounded_rectangle([qx - 12, qy - 12, qx + 168 + 12, qy + 168 + 12],
                           radius=14, fill=(255, 255, 255), outline=GOLD, width=3)
    canvas.paste(qr, (qx, qy), qr)
    center(draw, 'farm.easternmarket.ca', qy + 192, urlf, INK, W)
    center(draw, '扫码开始玩  ·  Scan to start', qy + 234, small, MUTED, W)

    rgb = canvas.convert('RGB')
    rgb.save(OUT_A4, 'PNG', optimize=True)
    print('wrote', OUT_A4, rgb.size)
    return rgb


if __name__ == '__main__':
    phone()
    a4()
