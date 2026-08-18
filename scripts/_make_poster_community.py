#!/usr/bin/env python3
"""Community promo poster — same 04c composition, new couplet. Does not overwrite 04c."""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _make_poster_onart import (
    ROOT, ART, CREAM, GOLD, INK, FOREST,
    vf, cover, spaced, center, paste_logo, kicker_pill, make_qr,
    SERIF, SANS, SANS_BD, GEORGIA,
)

OUT = os.path.join(ROOT, 'promo')


def dusk(canvas, w, h, band, top_band=0):
    wash = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(wash)
    for i in range(220):
        a = int(70 * (1 - i / 220) ** 1.4)
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


def scan_bar(canvas, w, h):
    bar_h = 390
    top = h - bar_h
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rectangle([0, top, w, h], fill=(246, 239, 224, 252))
    ld.rectangle([0, top, w, top + 10], fill=(201, 162, 74, 255))
    ld.rectangle([0, top + 10, w, top + 13], fill=(42, 74, 40, 220))
    canvas = Image.alpha_composite(canvas, layer)
    draw = ImageDraw.Draw(canvas)

    qr_px = 268
    qr = make_qr(qr_px)
    qx = 36
    qy = top + (bar_h - qr_px) // 2 + 4
    draw.rounded_rectangle(
        [qx - 10, qy - 10, qx + qr_px + 10, qy + qr_px + 10],
        radius=18, fill=CREAM, outline=(201, 162, 74), width=4)
    canvas.paste(qr, (qx, qy), qr)

    zh = vf(SANS, 48, 720, SANS_BD)
    en = ImageFont.truetype(GEORGIA, 28)
    urlf = vf(SANS, 34, 720, SANS_BD)
    sub = vf(SANS, 26, 580, SANS_BD)
    sub_en = ImageFont.truetype(GEORGIA, 22)
    tx = qx + qr_px + 40
    ty = qy + 4
    draw.text((tx, ty), '扫码即玩', font=zh, fill=INK)
    draw.text((tx, ty + 58), 'Scan to play', font=en, fill=FOREST)
    draw.text((tx, ty + 100), 'farm.easternmarket.ca', font=urlf, fill=FOREST)
    draw.text((tx, ty + 154), '邀请好友，双方各得 200 农场币', font=sub, fill=INK)
    draw.text((tx, ty + 196), 'Invite a friend — 200 coins each', font=sub_en, fill=(90, 78, 48))
    return canvas


def main():
    W, H = 1080, 1920
    art = cover(Image.open(ART).convert('RGB'), W, H, bias_y=10).convert('RGBA')
    canvas = dusk(art, W, H, 580, top_band=400)
    paste_logo(canvas, W, 40, 232)
    draw = ImageDraw.Draw(canvas)
    f_name = vf(SERIF, 88, 660)
    f_title = vf(SERIF, 48, 560)
    f_kick_zh = vf(SANS, 22, 650, SANS_BD)
    f_kick_en = ImageFont.truetype(GEORGIA, 20)
    f_en_line = ImageFont.truetype(GEORGIA, 22)

    name_y = 180
    spaced(draw, '东方农场', name_y, f_name, CREAM, 16, W, shadow=(0, 3, (0, 0, 0, 150)))
    en_name = ImageFont.truetype(GEORGIA, 42)
    center(draw, 'Eastern Farm', name_y + 136, en_name, (255, 244, 214), W,
           shadow=(0, 3, (0, 0, 0, 170)))

    bar_top = H - 390
    en_y = bar_top - 50
    zh2_y = en_y - 102
    zh1_y = zh2_y - 84
    kick_y = zh1_y - 72
    kicker_pill(draw, kick_y, W, f_kick_zh, f_kick_en)
    spaced(draw, '串门看邻居', zh1_y, f_title, CREAM, 8, W, shadow=(0, 2, (0, 0, 0, 140)))
    spaced(draw, '浇水或顺菜', zh2_y, f_title, CREAM, 8, W, shadow=(0, 2, (0, 0, 0, 140)))
    center(draw, 'VISIT NEIGHBORS  ·  WATER OR TAKE A CROP', en_y, f_en_line,
           (243, 224, 176), W, shadow=(0, 2, (0, 0, 0, 150)))

    canvas = scan_bar(canvas, W, H)
    rgb = canvas.convert('RGB')
    png = os.path.join(OUT, 'poster-phone-onart-05-community.png')
    jpg = os.path.join(OUT, 'poster-phone-onart-05-community.jpg')
    rgb.save(png, 'PNG', optimize=True)
    rgb.save(jpg, 'JPEG', quality=93, optimize=True)
    print('wrote', png, rgb.size)


if __name__ == '__main__':
    main()
