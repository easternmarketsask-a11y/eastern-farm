#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
B4 加载性能 · 图片压缩管线（离线本机工具，无外部依赖 / 不进运行时）。

生成 WebP：
  1) src/assets/images/map/*.png  → 同名 .webp（保原图，代码改引 .webp）
  2) 首屏三张图 → 重采样 + WebP 小图（各自新文件名，原图保留回滚）
  3) worldcup 奖品照片 png → webp

原 PNG 一律不删（回滚保险）。运行：  py -3 scripts/webp_convert_b4.py
"""
import os
import sys

try:
    from PIL import Image
except Exception as e:  # pragma: no cover
    print('需要 Pillow：pip install pillow', e)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'src', 'assets', 'images')
MAP = os.path.join(IMG, 'map')
PRIZES = os.path.join(ROOT, 'src', 'assets', 'worldcup', 'prizes')


def kb(path):
    return os.path.getsize(path) / 1024.0


def save_webp(im, out, quality=80, lossless=False):
    params = {'method': 6}
    if lossless:
        params['lossless'] = True
    else:
        params['quality'] = quality
    im.save(out, 'WEBP', **params)


def convert_map():
    print('== 地图/建筑 PNG → WebP ==')
    total_png = total_webp = 0
    for name in sorted(os.listdir(MAP)):
        if not name.lower().endswith('.png'):
            continue
        src = os.path.join(MAP, name)
        out = os.path.join(MAP, name[:-4] + '.webp')
        im = Image.open(src)
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA')
        save_webp(im, out, quality=80)
        b, a = kb(src), kb(out)
        total_png += b
        total_webp += a
        flag = '  <-- big' if b > 200 else ''
        print(f'  {name:28s} {b:7.0f}KB -> {a:7.0f}KB{flag}')
    print(f'  MAP TOTAL {total_png:.0f}KB -> {total_webp:.0f}KB '
          f'(-{100*(1-total_webp/total_png):.0f}%)')


def resample_logos():
    print('== 首屏 logo 重采样 + WebP ==')
    jobs = [
        # (src, out, target_width, quality)
        ('wc2026-logo.png', 'wc2026-logo-160.webp', 160, 88),
        ('logo-horizontal.png', 'logo-horizontal-560.webp', 560, 86),
        ('warehouse-barn.png', 'warehouse-barn.webp', 460, 84),
    ]
    for fn, outfn, w, q in jobs:
        src = os.path.join(IMG, fn)
        out = os.path.join(IMG, outfn)
        im = Image.open(src)
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA')
        if im.width > w:
            h = round(im.height * w / im.width)
            im = im.resize((w, h), Image.LANCZOS)
        save_webp(im, out, quality=q)
        print(f'  {fn:24s} {kb(src):7.0f}KB -> {outfn} {kb(out):7.0f}KB  ({im.width}x{im.height})')


def convert_prizes():
    if not os.path.isdir(PRIZES):
        return
    print('== worldcup 奖品照片 PNG → WebP ==')
    for name in sorted(os.listdir(PRIZES)):
        if not name.lower().endswith('.png'):
            continue
        src = os.path.join(PRIZES, name)
        out = os.path.join(PRIZES, name[:-4] + '.webp')
        im = Image.open(src)
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA')
        if im.width > 400:
            h = round(im.height * 400 / im.width)
            im = im.resize((400, h), Image.LANCZOS)
        save_webp(im, out, quality=80)
        print(f'  {name:22s} {kb(src):7.0f}KB -> {kb(out):7.0f}KB')


if __name__ == '__main__':
    convert_map()
    resample_logos()
    convert_prizes()
    print('done.')
