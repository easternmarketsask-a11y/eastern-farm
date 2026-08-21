#!/usr/bin/env python3
"""Key farmer back poses and pack 6-frame walk strips; convert car rears to webp."""
from PIL import Image
from collections import deque
import os
import shutil

SESS = os.path.join(
    os.path.expanduser('~'), '.grok', 'sessions',
    'D%3A%5Ceasternmarket.ca', '01a02114-4d64-74e3-8ada-e5eb8152bbf4', 'images',
)
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'src', 'assets', 'images')
FARMER_OUT = os.path.join(ROOT, 'farmers')
MAP_OUT = os.path.join(ROOT, 'map')
CELL_W, CELL_H = 128, 160
COLS = 6

# look -> (A frame jpg, B frame jpg)
BACK = {
    1: (9, 25), 2: (6, 23), 3: (3, 20), 4: (4, 24), 5: (5, 22),
    6: (7, 21), 7: (8, 18), 8: (10, 19), 9: (11, 26),
}
CARS = {
    1: 16, 2: 12, 3: 15, 4: 17, 5: 13, 6: 14,
    7: 30, 8: 27, 9: 29, 10: 33, 11: 32, 12: 28, 13: 31,
    14: 36, 15: 35, 16: 34,
}


def is_bg(r, g, b, br, bg, bb, tol):
    return abs(r - br) <= tol and abs(g - bg) <= tol and abs(b - bb) <= tol


def key_rgba(src, tol=38):
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


def fit_cell(im):
    bbox = im.split()[-1].getbbox()
    if not bbox:
        return Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    cropped = im.crop(bbox)
    pad = 8
    cw, ch = cropped.size
    scale = min((CELL_W - pad * 2) / cw, (CELL_H - pad * 2) / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    cropped = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    cell.paste(cropped, ((CELL_W - nw) // 2, CELL_H - nh - 4), cropped)
    return cell


def sess(n):
    return os.path.join(SESS, str(n) + '.jpg')


def pack_farmers():
    for look, (a, b) in BACK.items():
        pa, pb = sess(a), sess(b)
        if not os.path.isfile(pa) or not os.path.isfile(pb):
            print('skip farmer', look, 'missing', pa if not os.path.isfile(pa) else pb)
            continue
        ca = fit_cell(key_rgba(pa))
        cb = fit_cell(key_rgba(pb))
        # A B A B A B — same two-pose gait as the front sheets
        frames = [ca, cb, ca, cb, ca, cb]
        sheet = Image.new('RGBA', (CELL_W * COLS, CELL_H), (0, 0, 0, 0))
        for col, fr in enumerate(frames):
            sheet.paste(fr, (col * CELL_W, 0), fr)
        dst = os.path.join(FARMER_OUT, 'p_farmer_%d_back.webp' % look)
        sheet.save(dst, 'WEBP', quality=88, method=4, lossless=False)
        print('farmer back', look, dst, sheet.size)


def pack_cars():
    for n, jpg in CARS.items():
        src = sess(jpg)
        if not os.path.isfile(src):
            print('skip car', n, 'missing', src)
            continue
        im = Image.open(src).convert('RGBA')
        dst = os.path.join(MAP_OUT, 'p_car_%d_rear.webp' % n)
        im.save(dst, 'WEBP', quality=88, method=4, lossless=False)
        print('car rear', n, dst, im.size)


if __name__ == '__main__':
    pack_farmers()
    pack_cars()
