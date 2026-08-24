#!/usr/bin/env python3
"""给「无字底图」压上品牌抬头，输出到 promo/branded/。

Chris 2026-08-23：「所有这些宣传图都要有东方超市 LOGO 以及东方农场。」

promo/ 根目录下的 hero-* / keyart-* 是**没有任何文字**的原图，两种用途：
  ① 直接发朋友圈 / 小红书 / 店内电视 / 网页横幅  ← 这种必须有牌
  ② 当别的海报的底图，以及**美术对照基准**       ← 这种绝不能有牌

🔒 所以不在原地改，另存到 promo/branded/。
   `keyart-farm-*.jpg` 尤其不许覆盖 —— CLAUDE.md 的「金色黄昏光」和
   docs/plans/2026-08-15-keyart-*.md 都拿它当验收对照，压了字就没法比了。

用法：python scripts/_make_branded_art.py
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _make_poster_onart import ROOT, logo_keyed, vf, measure, SANS, SANS_BD, GEORGIA, INK, FOREST

PROMO = os.path.join(ROOT, 'promo')
OUT = os.path.join(PROMO, 'branded')

# (文件名, 抬头放哪) —— 'c' 顶部居中，'l' 顶部靠左（宽幅横图居中会飘在正中间很怪）
SOURCES = [
    ('hero-portrait.jpg', 'c'),
    ('hero-square.jpg', 'c'),
    ('hero-landscape.jpg', 'l'),
    ('hero-wide.jpg', 'l'),
    ('keyart-farm-portrait.jpg', 'c'),
    ('keyart-farm-square.jpg', 'c'),
    ('keyart-farm-landscape.jpg', 'l'),
    ('keyart-farm-poster.jpg', 'c'),
    ('keyart-points-flow.jpg', 'l'),
]


def lockup(im, align='c'):
    """奶油圆角牌 + [logo] │ 东方农场  Eastern Farm，压在顶部。

    尺寸按图宽走，所以 1200 方图和 2400 长横幅上的观感一致。
    """
    W, H = im.size
    logo_h = max(34, int(W * 0.045))
    pad_x, pad_y = int(logo_h * 0.62), int(logo_h * 0.40)
    gap = int(logo_h * 0.42)

    logo = logo_keyed()
    lw = int(logo.width * logo_h / logo.height)
    zh_f = vf(SANS, int(logo_h * 0.70), 600, SANS_BD)
    en_f = ImageFont.truetype(GEORGIA, int(logo_h * 0.50))

    probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    zh, en = '东方农场', 'Eastern Farm'
    zh_w, _ = measure(probe, zh, zh_f)
    en_w, _ = measure(probe, en, en_f)

    inner = lw + gap + 2 + gap + zh_w + int(gap * 0.8) + en_w
    plate_w, plate_h = inner + pad_x * 2, logo_h + pad_y * 2

    plate = Image.new('RGBA', (plate_w, plate_h), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    pd.rounded_rectangle([0, 0, plate_w - 1, plate_h - 1],
                         radius=int(plate_h * 0.30), fill=(250, 245, 232, 238))

    x, y = pad_x, pad_y
    plate.paste(logo.resize((lw, logo_h), Image.Resampling.LANCZOS), (x, y),
                logo.resize((lw, logo_h), Image.Resampling.LANCZOS))
    x += lw + gap
    pd.rectangle([x, y + logo_h * 0.14, x + 2, y + logo_h * 0.86], fill=(42, 74, 40, 90))
    x += 2 + gap
    pd.text((x, y + logo_h / 2 - zh_f.size * 0.60), zh, font=zh_f, fill=INK)
    x += zh_w + int(gap * 0.8)
    pd.text((x, y + logo_h / 2 - en_f.size * 0.62), en, font=en_f, fill=FOREST)

    margin = int(W * 0.035)
    px = margin if align == 'l' else (W - plate_w) // 2
    py = margin if H <= W else int(H * 0.035)

    out = im.convert('RGBA')
    out.alpha_composite(plate, (px, py))
    return out.convert('RGB')


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, align in SOURCES:
        src = os.path.join(PROMO, name)
        if not os.path.exists(src):
            print('skip (缺源图)', name)
            continue
        im = lockup(Image.open(src).convert('RGB'), align)
        dst = os.path.join(OUT, name)
        im.save(dst, 'JPEG', quality=92, optimize=True)
        print('wrote', dst, im.size)


if __name__ == '__main__':
    main()
