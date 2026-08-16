#!/usr/bin/env python3
"""Phone poster layout variants (04a–04d). Does not overwrite 01 / 02 / 03."""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _make_poster_onart import (
    ROOT, ART, CREAM, GOLD, INK, FOREST,
    vf, cover, spaced, center, paste_logo, kicker_pill, scan_bar,
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


def fonts():
    return {
        'name': vf(SERIF, 88, 660),
        'title': vf(SERIF, 48, 560),
        'kick_zh': vf(SANS, 22, 650, SANS_BD),
        'kick_en': ImageFont.truetype(GEORGIA, 20),
        'en_name': ImageFont.truetype(GEORGIA, 30),
        'en_line': ImageFont.truetype(GEORGIA, 22),
    }


def save(canvas, stem):
    rgb = canvas.convert('RGB')
    png = os.path.join(OUT, stem + '.png')
    jpg = os.path.join(OUT, stem + '.jpg')
    rgb.save(png, 'PNG', optimize=True)
    rgb.save(jpg, 'JPEG', quality=93, optimize=True)
    print('wrote', png, rgb.size)


def base(top_band, bot_band):
    W, H = 1080, 1920
    art = cover(Image.open(ART).convert('RGB'), W, H, bias_y=10).convert('RGBA')
    canvas = dusk(art, W, H, bot_band, top_band=top_band)
    paste_logo(canvas, W, 40, 232)
    return canvas, ImageDraw.Draw(canvas), W, H, fonts()


def draw_name(draw, y, W, f):
    spaced(draw, '东方农场', y, f['name'], CREAM, 16, W, shadow=(0, 3, (0, 0, 0, 150)))
    center(draw, 'Eastern Farm', y + 108, f['en_name'], (243, 224, 176), W,
           shadow=(0, 2, (0, 0, 0, 160)))
    return y + 108


def draw_couplet(draw, y, W, f):
    spaced(draw, '玩农场游戏', y, f['title'], CREAM, 8, W, shadow=(0, 2, (0, 0, 0, 140)))
    spaced(draw, '赚超市积分', y + 54, f['title'], CREAM, 8, W, shadow=(0, 2, (0, 0, 0, 140)))
    center(draw, 'PLAY THE FARM  ·  EARN STORE POINTS', y + 108, f['en_line'], (243, 224, 176), W,
           shadow=(0, 2, (0, 0, 0, 150)))
    return y + 108


def variant_a():
    """天头店名：胶囊+店名在 logo 下；对联贴扫码栏。"""
    canvas, draw, W, H, f = base(420, 520)
    by = kicker_pill(draw, 188, W, f['kick_zh'], f['kick_en'])
    draw_name(draw, by + 18, W, f)
    draw_couplet(draw, H - 390 - 200, W, f)
    save(scan_bar(canvas, W, H), 'poster-phone-onart-04a')


def variant_b():
    """整块上移：标题对联全在 logo 下，菜地完全露出来。"""
    canvas, draw, W, H, f = base(620, 280)
    by = kicker_pill(draw, 188, W, f['kick_zh'], f['kick_en'])
    ny = draw_name(draw, by + 14, W, f)
    draw_couplet(draw, ny + 16, W, f)
    save(scan_bar(canvas, W, H), 'poster-phone-onart-04b')


def variant_c():
    """只上移店名：东方农场上天；胶囊+对联仍贴扫码栏。"""
    canvas, draw, W, H, f = base(380, 620)
    draw_name(draw, 200, W, f)
    bar_top = H - 390
    by = kicker_pill(draw, bar_top - 350, W, f['kick_zh'], f['kick_en'])
    # 下区字阶：胶囊 → 空 → 对联两行拉开 → 再空一截 → 英文贴扫码栏上沿
    spaced(draw, '玩农场游戏', by + 28, f['title'], CREAM, 8, W, shadow=(0, 2, (0, 0, 0, 140)))
    spaced(draw, '赚超市积分', by + 104, f['title'], CREAM, 8, W, shadow=(0, 2, (0, 0, 0, 140)))
    center(draw, 'PLAY THE FARM  ·  EARN STORE POINTS', bar_top - 58, f['en_line'],
           (243, 224, 176), W, shadow=(0, 2, (0, 0, 0, 150)))
    save(scan_bar(canvas, W, H), 'poster-phone-onart-04c')


def variant_d():
    """对联上天、店名贴栏：承诺在天空，店名挨着扫码。"""
    canvas, draw, W, H, f = base(400, 560)
    by = kicker_pill(draw, 188, W, f['kick_zh'], f['kick_en'])
    draw_couplet(draw, by + 22, W, f)
    draw_name(draw, H - 390 - 220, W, f)
    save(scan_bar(canvas, W, H), 'poster-phone-onart-04d')


if __name__ == '__main__':
    variant_a()
    variant_b()
    variant_c()
    variant_d()
