#!/usr/bin/env python3
"""Pack 6×2 back sheets: row 0 standing idle, row 1 existing walk cycle."""
from PIL import Image
from collections import deque
import os

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'src', 'assets', 'images', 'farmers')
SESS = os.path.join(
    os.path.expanduser('~'), '.grok', 'sessions',
    'D%3A%5Ceasternmarket.ca', '01a02114-4d64-74e3-8ada-e5eb8152bbf4', 'images',
)
CELL_W, CELL_H, COLS = 128, 160, 6

# look -> standing-back jpg in the session images folder
IDLE = {
    1: '66.jpg', 2: '71.jpg', 3: '70.jpg', 4: '68.jpg',
    5: '73.jpg', 6: '67.jpg', 7: '69.jpg', 8: '64.jpg',
    9: '74.jpg',
}


def key_rgba(im, tol=42):
    im = im.convert('RGBA')
    w, h = im.size
    pix = im.load()
    samples = [pix[0, 0][:3], pix[w - 1, 0][:3], pix[0, h - 1][:3], pix[w - 1, h - 1][:3]]
    br = sum(s[0] for s in samples) // 4
    bg = sum(s[1] for s in samples) // 4
    bb = sum(s[2] for s in samples) // 4
    visited = bytearray(w * h)
    q = deque()

    def seed(x, y):
        i = y * w + x
        if visited[i]:
            return
        visited[i] = 1
        q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)
    while q:
        x, y = q.popleft()
        r, g, b, a = pix[x, y]
        if abs(r - br) > tol or abs(g - bg) > tol or abs(b - bb) > tol:
            continue
        pix[x, y] = (r, g, b, 0)
        if x + 1 < w:
            seed(x + 1, y)
        if x:
            seed(x - 1, y)
        if y + 1 < h:
            seed(x, y + 1)
        if y:
            seed(x, y - 1)
    return im


def fit_cell(im):
    bbox = im.split()[-1].getbbox()
    if not bbox:
        return Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    cropped = im.crop(bbox)
    pad = 6
    cw, ch = cropped.size
    scale = min((CELL_W - pad * 2) / cw, (CELL_H - pad * 2) / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    cropped = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    cell.paste(cropped, ((CELL_W - nw) // 2, CELL_H - nh - 2), cropped)
    return cell


def pack():
    for look, name in IDLE.items():
        src = os.path.join(SESS, name)
        walk_path = os.path.join(ROOT, 'p_farmer_%d_back.webp' % look)
        if not os.path.isfile(src):
            raise SystemExit('missing idle ' + src)
        idle = fit_cell(key_rgba(Image.open(src)))
        walk = Image.open(walk_path).convert('RGBA')
        ww, wh = walk.size
        wc = ww // COLS
        walk_cells = [walk.crop((c * wc, 0, (c + 1) * wc, wh)).resize((CELL_W, CELL_H), Image.Resampling.LANCZOS)
                      for c in range(COLS)]
        sheet = Image.new('RGBA', (CELL_W * COLS, CELL_H * 2), (0, 0, 0, 0))
        for c in range(COLS):
            sheet.paste(idle, (c * CELL_W, 0), idle)
            sheet.paste(walk_cells[c], (c * CELL_W, CELL_H), walk_cells[c])
        dst = os.path.join(ROOT, 'p_farmer_%d_back.webp' % look)
        sheet.save(dst, 'WEBP', quality=90, method=4)
        print('packed', look, sheet.size)


if __name__ == '__main__':
    pack()
