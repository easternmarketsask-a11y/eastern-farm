#!/usr/bin/env python3
"""Crop harvest/plant cells as pose-edit references."""
from PIL import Image
import os

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'src', 'assets', 'images', 'farmers')
OUT = os.path.join(ROOT, '_turn')
os.makedirs(OUT, exist_ok=True)
COLS, ROWS = 6, 5

for i in range(1, 10):
    im = Image.open(os.path.join(ROOT, 'p_farmer_%d.webp' % i)).convert('RGBA')
    cw, ch = im.width // COLS, im.height // ROWS
    for name, row, col in (('harvest', 3, 1), ('plant', 4, 1)):
        cell = im.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        canvas = Image.new('RGBA', (256, 320), (8, 8, 10, 255))
        scale = min(220 / cell.width, 280 / cell.height)
        nw, nh = max(1, int(cell.width * scale)), max(1, int(cell.height * scale))
        cell = cell.resize((nw, nh), Image.Resampling.LANCZOS)
        canvas.paste(cell, ((256 - nw) // 2, 320 - nh - 8), cell)
        canvas.convert('RGB').save(os.path.join(OUT, '%s_%d.jpg' % (name, i)), quality=92)
        print(name, i, nw, nh)

print('wrote', OUT)
