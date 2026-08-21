#!/usr/bin/env python3
"""Crop walk-row cells from farmer sheets as turnaround references."""
from PIL import Image
import os

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'src', 'assets', 'images')
OUT = os.path.join(ROOT, 'farmers', '_turn')
os.makedirs(OUT, exist_ok=True)
COLS, ROWS = 6, 5

for i in range(1, 10):
    path = os.path.join(ROOT, 'farmers', 'p_farmer_%d.webp' % i)
    im = Image.open(path).convert('RGBA')
    cw, ch = im.width // COLS, im.height // ROWS
    walk = im.crop((0, ch, im.width, ch * 2))
    walk.save(os.path.join(OUT, 'walkrow_%d.png' % i))
    # stride frame (col 1) on opaque black so the editor has a keyable studio
    cell = im.crop((cw, ch, cw * 2, ch * 2))
    canvas = Image.new('RGBA', (256, 320), (8, 8, 10, 255))
    scale = min(220 / cell.width, 280 / cell.height)
    nw, nh = max(1, int(cell.width * scale)), max(1, int(cell.height * scale))
    cell = cell.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(cell, ((256 - nw) // 2, 320 - nh - 12), cell)
    canvas.convert('RGB').save(os.path.join(OUT, 'pose_%d.jpg' % i), quality=92)
    print('pose', i, canvas.size, 'cell', cw, ch)

print('wrote', OUT)
