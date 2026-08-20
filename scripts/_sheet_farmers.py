#!/usr/bin/env python3
"""Key gray studio off farmer stills and pack 4x6 webp sheets."""
from PIL import Image
from collections import deque
import os

SESS = os.path.join(
    os.path.expanduser('~'), '.grok', 'sessions',
    'D%3A%5C', '01a00718-f95b-7452-b183-7f5defbb801b', 'images',
)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'src', 'assets', 'images', 'farmers')
CELL_W, CELL_H = 128, 160
COLS, ROWS = 6, 4

# look id -> session jpg numbers
IDLE = {1: 222, 2: 206, 3: 220, 4: 209, 5: 217, 6: 218, 7: 223, 8: 229, 9: 221}
WALK_A = {1: 225, 2: 214, 3: 224, 4: 226, 5: 228, 6: 230, 7: 227, 8: 229, 9: 231}
WALK_B = {1: 235, 2: 216, 3: 233, 4: 234, 5: 236, 6: 238, 7: 232, 8: 237, 9: 239}
WATER = {1: 243, 2: 210, 3: 242, 4: 240, 5: 246, 6: 245, 7: 241, 8: 247, 9: 244}
HARVEST = {1: 250, 2: 215, 3: 251, 4: 248, 5: 255, 6: 253, 7: 249, 8: 254, 9: 252}


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
    # fringe
    for y in range(h):
        for x in range(w):
            if mask[y * w + x]:
                continue
            r, g, b, a = pix[x, y]
            if a < 10:
                continue
            edge = False
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and mask[ny * w + nx]:
                    edge = True
                    break
            if not edge:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            if mx < 80 and (mx - mn) < 30:
                pix[x, y] = (r, g, b, 0)
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


def load_cell(n):
    path = os.path.join(SESS, str(n) + '.jpg')
    if not os.path.isfile(path):
        raise SystemExit('missing ' + path)
    return fit_cell(key_rgba(path))


def pack(look, frames_by_row):
    sheet = Image.new('RGBA', (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
    for row, frames in enumerate(frames_by_row):
        for col in range(COLS):
            sheet.paste(frames[col % len(frames)], (col * CELL_W, row * CELL_H), frames[col % len(frames)])
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, 'p_farmer_%d.webp' % look)
    sheet.save(dst, 'WEBP', quality=88, method=4, lossless=False)
    px = sheet.load()
    print(dst, 'corner', px[0, 0], 'size', sheet.size)


def main():
    idle_cells = {i: load_cell(n) for i, n in IDLE.items()}
    for look, idle in idle_cells.items():
        a = load_cell(WALK_A[look])
        b = load_cell(WALK_B[look])
        w = load_cell(WATER[look])
        h = load_cell(HARVEST[look])
        walk = [a, b, a, b, a, b]
        wat = [idle, w, w, w, w, idle]
        har = [idle, h, h, h, h, idle]
        pack(look, [[idle], walk, wat, har])
    print('done')


if __name__ == '__main__':
    main()
