#!/usr/bin/env python3
"""Paste bent-harvest and kneel-plant poses into farmer sheets (cols 1-4)."""
from PIL import Image
from collections import deque
import os

SESS = os.path.join(
    os.path.expanduser('~'), '.grok', 'sessions',
    'D%3A%5Ceasternmarket.ca', '01a02114-4d64-74e3-8ada-e5eb8152bbf4', 'images',
)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'src', 'assets', 'images', 'farmers')
CELL_W, CELL_H = 128, 160
COLS, ROWS = 6, 5

HARVEST = {1: 44, 2: 39, 3: 38, 4: 40, 5: 42, 6: 41, 7: 37, 8: 43, 9: 47}
PLANT = {1: 48, 2: 52, 3: 46, 4: 51, 5: 50, 6: 45, 7: 49, 8: 53, 9: 54}


def is_bg(r, g, b, br, bg, bb, tol):
    return abs(r - br) <= tol and abs(g - bg) <= tol and abs(b - bb) <= tol


def key_rgba(src, tol=42):
    im = Image.open(src).convert('RGBA')
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
        seed(x, 0); seed(x, h - 1)
    for y in range(h):
        seed(0, y); seed(w - 1, y)
    mask = bytearray(w * h)
    while q:
        x, y = q.popleft()
        r, g, b, a = pix[x, y]
        if not is_bg(r, g, b, br, bg, bb, tol):
            continue
        mask[y * w + x] = 1
        pix[x, y] = (r, g, b, 0)
        if x + 1 < w: seed(x + 1, y)
        if x: seed(x - 1, y)
        if y + 1 < h: seed(x, y + 1)
        if y: seed(x, y - 1)
    return im


def wipe_ground(cell):
    pix = cell.load()
    w, h = cell.size
    xs = []
    for y in range(int(h * 0.32), int(h * 0.68)):
        for x in range(w):
            if pix[x, y][3] > 40:
                xs.append(x)
    x0, x1 = (min(xs) - 8, max(xs) + 8) if xs else (0, w)
    for y in range(int(h * 0.70), h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if a < 10:
                continue
            chroma = max(r, g, b) - min(r, g, b)
            if (x < x0 or x > x1) and chroma < 50:
                pix[x, y] = (r, g, b, 0)
            elif y > int(h * 0.90) and chroma < 38 and max(r, g, b) < 115:
                pix[x, y] = (r, g, b, 0)
    return cell


def strip_floor(im):
    """Drop the studio ground wash under the figure so planting dirt isn't baked in."""
    pix = im.load()
    w, h = im.size
    last = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if a < 24:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            if (mx - mn) > 26 or mx > 95:
                last = y
    if last < 8:
        return im
    return im.crop((0, 0, w, min(h, last + 5)))


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


def sess(n):
    return os.path.join(SESS, str(n) + '.jpg')


def main():
    for look in range(1, 10):
        path = os.path.join(OUT, 'p_farmer_%d.webp' % look)
        sheet = Image.open(path).convert('RGBA')
        cw, ch = sheet.width // COLS, sheet.height // ROWS
        assert cw == CELL_W and ch == CELL_H, (look, cw, ch)
        hv = fit_cell(key_rgba(sess(HARVEST[look])))
        pl = wipe_ground(fit_cell(strip_floor(key_rgba(sess(PLANT[look])))))
        blank = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
        for col in range(1, 5):
            sheet.paste(blank, (col * CELL_W, 3 * CELL_H))
            sheet.paste(hv, (col * CELL_W, 3 * CELL_H), hv)
            sheet.paste(blank, (col * CELL_W, 4 * CELL_H))
            sheet.paste(pl, (col * CELL_W, 4 * CELL_H), pl)
        sheet.save(path, 'WEBP', quality=88, method=4, lossless=False)
        print('packed', look, path)
    print('done')


if __name__ == '__main__':
    main()
