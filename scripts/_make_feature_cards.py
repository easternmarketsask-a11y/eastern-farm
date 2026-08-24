#!/usr/bin/env python3
"""1080 square feature cards. Art is text-free; this script adds bilingual titles."""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _make_poster_onart import (vf, cover, measure, brand_lockup,
                                SANS, SANS_BD, GEORGIA, CREAM, INK, FOREST)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'promo', 'feature-cards')
SIZE = 1080
BAR = 248

CARDS = [
    ('01-points', '_art-points.jpg',
     '积分每天进会员卡', 'Points land on your member card'),
    ('02-crops', '_art-crops.jpg',
     '种的是店里在卖的菜', 'Grow what we sell in store'),
    ('03-house', '_art-house.jpg',
     '盖自己的家，一档一档换', 'Build and upgrade your house'),
    ('04-neighbors', '_art-neighbors.jpg',
     '串门看邻居，浇水或顺菜', 'Visit, water, or take a ripe crop'),
    ('05-invite', '_art-invite.jpg',
     '邀请好友，双方各得 200 农场币', 'Invite a friend — 200 coins each'),
    ('06-orders', '_art-orders.jpg',
     '给东超送货，比散卖更划算', 'Fill store orders. They pay better.'),
]


def fit_zh(draw, text, max_w):
    for size, wt in ((46, 720), (42, 700), (38, 700), (34, 680)):
        f = vf(SANS, size, wt, SANS_BD)
        w, h = measure(draw, text, f)
        if w <= max_w:
            return f, w, h
    f = vf(SANS, 32, 680, SANS_BD)
    w, h = measure(draw, text, f)
    return f, w, h


def card(stem, art_name, zh, en):
    art = Image.open(os.path.join(SRC, art_name)).convert('RGB')
    art = cover(art, SIZE, SIZE, bias_y=-20)
    canvas = art.convert('RGBA')
    layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    top = SIZE - BAR
    ld.rectangle([0, top, SIZE, SIZE], fill=(246, 239, 224, 250))
    ld.rectangle([0, top, SIZE, top + 8], fill=(201, 162, 74, 255))
    ld.rectangle([0, top + 8, SIZE, top + 11], fill=(42, 74, 40, 220))
    canvas = Image.alpha_composite(canvas, layer)
    draw = ImageDraw.Draw(canvas)

    zh_f, _, zh_h = fit_zh(draw, zh, SIZE - 72)
    en_f = ImageFont.truetype(GEORGIA, 24)

    y = top + 20
    y += brand_lockup(canvas, draw, SIZE, y) + 12
    zw, _ = measure(draw, zh, zh_f)
    draw.text(((SIZE - zw) / 2, y), zh, font=zh_f, fill=INK)
    y += zh_h + 10
    ew, _ = measure(draw, en, en_f)
    draw.text(((SIZE - ew) / 2, y), en, font=en_f, fill=(90, 78, 48))

    rgb = canvas.convert('RGB')
    png = os.path.join(SRC, stem + '.png')
    jpg = os.path.join(SRC, stem + '.jpg')
    rgb.save(png, 'PNG', optimize=True)
    rgb.save(jpg, 'JPEG', quality=92, optimize=True)
    print('wrote', png)


def main():
    for row in CARDS:
        card(*row)


if __name__ == '__main__':
    main()
