#!/usr/bin/env python3
"""House + car WeChat posters (phone 9:16 with QR) and square feature cards.
Does not overwrite 04c or 05-community."""
from PIL import Image, ImageDraw, ImageFont
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _make_poster_onart import (
    ROOT, CREAM, INK, FOREST,
    vf, cover, spaced, center, paste_logo, kicker_pill, make_qr,
    SERIF, SANS, SANS_BD, GEORGIA, measure,
)
from _make_poster_community import dusk, scan_bar
OUT = os.path.join(ROOT, 'promo')
CARDS = os.path.join(OUT, 'feature-cards')
SESSION = os.path.join(
    os.path.expanduser('~'), '.grok', 'sessions',
    'D%3A%5C', '01a00718-f95b-7452-b183-7f5defbb801b', 'images',
)


def square(art_path, stem, bias_y, zh, en):
    SIZE, BAR = 1080, 248
    art = cover(Image.open(art_path).convert('RGB'), SIZE, SIZE, bias_y=bias_y)
    canvas = art.convert('RGBA')
    layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    top = SIZE - BAR
    ld.rectangle([0, top, SIZE, SIZE], fill=(246, 239, 224, 250))
    ld.rectangle([0, top, SIZE, top + 8], fill=(201, 162, 74, 255))
    ld.rectangle([0, top + 8, SIZE, top + 11], fill=(42, 74, 40, 220))
    canvas = Image.alpha_composite(canvas, layer)
    draw = ImageDraw.Draw(canvas)
    kick = vf(SANS, 22, 600, SANS_BD)
    kick_en = ImageFont.truetype(GEORGIA, 18)
    zh_f = vf(SANS, 36, 700, SANS_BD)
    en_f = ImageFont.truetype(GEORGIA, 22)
    y = top + 22
    kw, _ = measure(draw, '东方农场  ·  Eastern Farm', kick)
    kx = (SIZE - kw) / 2
    draw.text((kx, y), '东方农场  ·  ', font=kick, fill=FOREST)
    mid_w, _ = measure(draw, '东方农场  ·  ', kick)
    draw.text((kx + mid_w, y + 2), 'Eastern Farm', font=kick_en, fill=FOREST)
    y += 40
    zw, zh_h = measure(draw, zh, zh_f)
    draw.text(((SIZE - zw) / 2, y), zh, font=zh_f, fill=INK)
    y += zh_h + 8
    ew, _ = measure(draw, en, en_f)
    draw.text(((SIZE - ew) / 2, y), en, font=en_f, fill=(90, 78, 48))
    rgb = canvas.convert('RGB')
    rgb.save(os.path.join(CARDS, stem + '.png'), 'PNG', optimize=True)
    rgb.save(os.path.join(CARDS, stem + '.jpg'), 'JPEG', quality=92, optimize=True)
    print('wrote', os.path.join(CARDS, stem + '.png'))


def phone(art_path, out_stem, zh1, zh2, en_line, couplet='bottom'):
    W, H = 1080, 1920
    art = cover(Image.open(art_path).convert('RGB'), W, H, bias_y=8).convert('RGBA')
    wash = 820 if couplet == 'bottom' else 520
    canvas = dusk(art, W, H, wash, top_band=360)
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
    if couplet == 'sky':
        tight = len(zh2) > 10
        kick_y = name_y + (152 if tight else 200)
        zh1_y = kick_y + (54 if tight else 68)
        zh2_y = zh1_y + (66 if tight else 78)
        en_y = zh2_y + (62 if tight else 78)
    else:
        en_y = bar_top - 50
        zh2_y = en_y - 102
        zh1_y = zh2_y - 84
        kick_y = zh1_y - 72
    kicker_pill(draw, kick_y, W, f_kick_zh, f_kick_en)
    spaced(draw, zh1, zh1_y, f_title, CREAM, 8, W, shadow=(0, 2, (0, 0, 0, 140)))
    spaced(draw, zh2, zh2_y, f_title, CREAM, 8, W, shadow=(0, 2, (0, 0, 0, 140)))
    center(draw, en_line, en_y, f_en_line, (243, 224, 176), W,
           shadow=(0, 2, (0, 0, 0, 150)))

    canvas = scan_bar(canvas, W, H)
    rgb = canvas.convert('RGB')
    png = os.path.join(OUT, out_stem + '.png')
    jpg = os.path.join(OUT, out_stem + '.jpg')
    rgb.save(png, 'PNG', optimize=True)
    rgb.save(jpg, 'JPEG', quality=93, optimize=True)
    print('wrote', png, rgb.size)


def main():
    house_src = os.path.join(SESSION, '195.jpg')
    cars_src = os.path.join(SESSION, '197.jpg')
    house_art = os.path.join(CARDS, '_art-house-promo.jpg')
    cars_art = os.path.join(CARDS, '_art-cars-promo.jpg')
    shutil.copyfile(house_src, house_art)
    shutil.copyfile(cars_src, cars_art)

    phone(house_art, 'poster-phone-onart-06-house',
          '盖自己的家', '农舍到豪宅都能换',
          'BUILD A HOME  ·  COTTAGE TO ESTATE', couplet='sky')
    phone(cars_art, 'poster-phone-onart-07-cars',
          '在农场', '心仪的汽车和房子同样重要',
          'THE CAR MATTERS AS MUCH AS THE HOUSE', couplet='sky')

    # Square cards: crop the tall art toward the subject (less sky).
    square(house_art, '03b-house', 140,
           '盖自己的家，农舍到豪宅都能换',
           'Build a home. Cottage to estate.')
    square(cars_art, '07-cars', 220,
           '在农场，心仪的汽车和房子同样重要',
           'The car matters as much as the house.')


if __name__ == '__main__':
    main()
