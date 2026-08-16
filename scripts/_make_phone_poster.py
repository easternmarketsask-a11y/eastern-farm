#!/usr/bin/env python3
"""1080x1920 mobile poster from keyart-farm-square.jpg."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import io
import os
import segno

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'promo', 'keyart-farm-square.jpg')
LOGO = os.path.join(ROOT, 'src', 'assets', 'images', 'logo-horizontal.png')
OUT = os.path.join(ROOT, 'promo', 'poster-phone.png')

W, H = 1080, 1920
YAHEI = r'C:\Windows\Fonts\msyh.ttc'
YAHEI_BD = r'C:\Windows\Fonts\msyhbd.ttc'


def font(size, bold=False):
    path = YAHEI_BD if bold else YAHEI
    try:
        return ImageFont.truetype(path, size, index=0)
    except OSError:
        return ImageFont.truetype(YAHEI, size, index=0)


def cover(im, tw, th):
    s = max(tw / im.width, th / im.height)
    nw, nh = int(im.width * s + 0.5), int(im.height * s + 0.5)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (nw - tw) // 2
    y = max(0, (nh - th) // 2 - 40)  # a hair toward the sky
    return im.crop((x, y, x + tw, y + th))


def main():
    art = Image.open(ART).convert('RGB')
    canvas = cover(art, W, H).convert('RGBA')

    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    # Sky wash so the headline stays readable
    for i in range(420):
        a = int(165 * (1 - i / 420) ** 1.15)
        d.line([(0, i), (W, i)], fill=(255, 236, 210, a))
    # Bottom wash into the dock
    for i in range(360):
        a = int(230 * (i / 360) ** 1.35)
        d.line([(0, H - 360 + i), (W, H - 360 + i)], fill=(40, 48, 28, a))
    canvas = Image.alpha_composite(canvas, overlay)
    draw = ImageDraw.Draw(canvas)

    logo = Image.open(LOGO).convert('RGBA')
    lw = 280
    lh = int(logo.height * lw / logo.width)
    logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
    lx, ly = (W - lw) // 2, 36
    draw.rounded_rectangle(
        [lx - 16, ly - 8, lx + lw + 16, ly + lh + 8],
        radius=16, fill=(255, 255, 255, 230),
    )
    canvas.paste(logo, (lx, ly), logo)

    def cx(text, fnt, y, fill, shadow=True):
        box = draw.textbbox((0, 0), text, font=fnt)
        tw = box[2] - box[0]
        x = (W - tw) / 2
        if shadow:
            draw.text((x + 1, y + 2), text, font=fnt, fill=(255, 248, 230, 180))
        draw.text((x, y), text, font=fnt, fill=fill)

    cx('免费种菜，真积分到账', font(62, True), 168, (32, 68, 36))
    cx('FREE TO PLAY  ·  REAL POINTS BACK', font(20, True), 250, (210, 72, 36))

    # Slim dock
    dock = [36, H - 292, W - 36, H - 36]
    draw.rounded_rectangle(dock, radius=28, fill=(255, 252, 244, 242))
    draw.rounded_rectangle(dock, radius=28, outline=(236, 226, 204, 255), width=2)

    qbuf = io.BytesIO()
    segno.make('https://farm.easternmarket.ca/', error='h').save(qbuf, kind='png', scale=8, border=2, dark='#2a5c34', light='#ffffff')
    qbuf.seek(0)
    qr = Image.open(qbuf).convert('RGBA').resize((188, 188), Image.Resampling.LANCZOS)
    qx, qy = 68, H - 270
    draw.rounded_rectangle([qx - 6, qy - 6, qx + 188 + 6, qy + 188 + 6], radius=14, fill=(255, 255, 255, 255))
    canvas.paste(qr, (qx, qy), qr)

    tx = 292
    draw.text((tx, H - 262), '扫码开始玩', font=font(42, True), fill=(42, 92, 52))
    draw.text((tx, H - 204), '手机打开就能种，不用下载', font=font(26, True), fill=(61, 50, 39))
    draw.text((tx, H - 166), '种店里的菜  ·  积分进会员卡', font=font(22), fill=(125, 114, 99))
    draw.text((tx, H - 118), 'farm.easternmarket.ca', font=font(28, True), fill=(42, 92, 52))

    rgb = canvas.convert('RGB')
    rgb.save(OUT, 'PNG', optimize=True)
    rgb.save(OUT.replace('.png', '.jpg'), 'JPEG', quality=92, optimize=True)
    print('wrote', OUT, rgb.size)


if __name__ == '__main__':
    main()
