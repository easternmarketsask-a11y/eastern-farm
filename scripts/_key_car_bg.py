#!/usr/bin/env python3
"""Flood-fill dark studio backdrop off car sprites. Tires stay: they are
inside the grass oval, so an edge flood cannot reach them."""
from PIL import Image
from collections import deque
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SESS = os.path.join(
    os.path.expanduser('~'), '.grok', 'sessions',
    'D%3A%5C', '01a00718-f95b-7452-b183-7f5defbb801b', 'images',
)
OUT = os.path.join(ROOT, 'src', 'assets', 'images', 'map')
PAIRS = [
    (176, 1), (177, 2), (194, 3), (179, 4), (181, 5), (193, 6), (190, 7), (183, 8),
    (184, 9), (187, 10), (185, 11), (186, 12), (192, 13), (188, 14), (191, 15), (189, 16),
]


def is_bg(r, g, b, br, bg, bb, tol):
    return abs(r - br) <= tol and abs(g - bg) <= tol and abs(b - bb) <= tol


def key_one(src, dst, tol=42):
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
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    mask = bytearray(w * h)
    while q:
        x, y = q.popleft()
        r, g, b, a = pix[x, y]
        if not is_bg(r, g, b, br, bg, bb, tol):
            continue
        mask[y * w + x] = 1
        pix[x, y] = (r, g, b, 0)
        if x + 1 < w:
            seed(x + 1, y)
        if x:
            seed(x - 1, y)
        if y + 1 < h:
            seed(x, y + 1)
        if y:
            seed(x, y - 1)

    # Fringe: dark, low-saturation pixels touching keyed bg fade out.
    for y in range(h):
        row = y * w
        for x in range(w):
            if mask[row + x]:
                continue
            r, g, b, a = pix[x, y]
            if a < 10:
                continue
            edge = False
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1),
                           (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1)):
                if 0 <= nx < w and 0 <= ny < h and mask[ny * w + nx]:
                    edge = True
                    break
            if not edge:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            if mx < 70 and (mx - mn) < 28:
                dist = abs(r - br) + abs(g - bg) + abs(b - bb)
                na = 0 if dist < 90 else int(a * (dist - 90) / 80)
                pix[x, y] = (r, g, b, max(0, min(a, na)))

    im.save(dst, 'WEBP', quality=90, method=4)
    # stats
    trans = sum(1 for i in range(0, w * h, 8) if pix[(i % w), (i // w)][3] < 10)
    print(os.path.basename(dst), 'bg', (br, bg, bb), 'trans_sample', trans)


def main():
    for src_n, dst_n in PAIRS:
        src = os.path.join(SESS, str(src_n) + '.jpg')
        dst = os.path.join(OUT, 'p_car_' + str(dst_n) + '.webp')
        if not os.path.isfile(src):
            raise SystemExit('missing ' + src)
        key_one(src, dst)


if __name__ == '__main__':
    main()
