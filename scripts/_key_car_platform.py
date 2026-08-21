#!/usr/bin/env python3
"""Key the baked grass oval off car sprites so they sit on the farm meadow.

Studio dark is already transparent on fronts; rears still have it. The remaining
platform is a yellow-green oval plus flowers that does not match GRASS_A.

Do NOT globally chroma-key green — Eastern Classic (p_car_16) is forest green
and cream/rust trucks match naive grass tests.

  1. Edge-flood the dark studio (same idea as _key_car_bg.py).
  2. Edge-flood oval-colored pixels. Window holes must not seed.
  3. Drop small flower specks in the lower half that now sit in empty meadow.

Usage:
  python scripts/_key_car_platform.py --dry-dir _tmp_keyed --magenta
  python scripts/_key_car_platform.py
"""
from PIL import Image
from collections import deque
import argparse
import os
import shutil

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'src', 'assets', 'images', 'map')

# Paint matches oval too closely — punching the platform eats the body.
# Studio is still keyed so they composite; the oval stays rather than a hole.
KEEP_OVAL = {
    'p_car_2.webp', 'p_car_2_rear.webp',
    'p_car_4.webp', 'p_car_4_rear.webp',
    'p_car_7.webp', 'p_car_7_rear.webp',
    'p_car_10.webp', 'p_car_10_rear.webp',
    'p_car_11.webp', 'p_car_11_rear.webp',
    'p_car_15.webp',
}


def is_cream_or_chrome(r, g, b):
    mn, mx = min(r, g, b), max(r, g, b)
    s = r + g + b
    if mn > 175:
        return True
    if mn > 140 and (mx - mn) < 58:
        return True
    # Rear-view tan body: brighter and flatter than oval grass.
    if s > 400 and (mx - mn) < 55 and mn > 128:
        return True
    return False


def is_red_paint(r, g, b):
    return r > 155 and (r - g) > 40


def is_car_paint(r, g, b):
    """Per-pixel shield. Stop the oval flood here. No connected-component,
    so oval grass cannot weld onto the car."""
    mx, mn = max(r, g, b), min(r, g, b)
    s = r + g + b
    if mx < 78 and (mx - mn) < 28:
        return True
    if is_cream_or_chrome(r, g, b):
        return True
    if r >= 125 and g >= 55 and (r - g) >= 22 and (r - b) >= 26:
        return True
    if 45 <= g <= 100 and s <= 270 and (g - b) <= 34 and abs(g - r) <= 18:
        return True
    if 130 <= r <= 195 and 100 <= g <= 155 and 15 <= (r - g) <= 55 and 20 <= (g - b) <= 55 and s >= 320:
        return True
    if r > 170 and g > 125 and b < 110 and (r - b) > 70:
        return True
    return False


def is_oval(r, g, b):
    """Yellow-green meadow oval. Not cream, not red, not forest-green body."""
    if is_cream_or_chrome(r, g, b) or is_red_paint(r, g, b):
        return False
    s = r + g + b
    if g < 82 or s < 170:
        return False
    if (g - b) < 20:
        return False
    if (g - r) > 14 or (g - r) < -12:
        return False
    if g < 100 and (g - r) > 4 and (g - b) < 36:
        return False
    return True


def is_dirt_oval(r, g, b):
    """Olive-brown oval stains. Not red body, not brown vinyl roof."""
    if is_cream_or_chrome(r, g, b) or is_red_paint(r, g, b):
        return False
    if r < 92 or r > 148:
        return False
    if g < 72 or g > 120:
        return False
    if r < g - 4 or (r - g) > 40:
        return False
    if g - b < 12:
        return False
    return True


def is_flower(r, g, b):
    if is_cream_or_chrome(r, g, b) or is_red_paint(r, g, b):
        return False
    mx, mn = max(r, g, b), min(r, g, b)
    if mx < 140 or mx - mn < 28:
        return False
    if r >= 155 and g >= 135 and b <= 118 and (g - b) >= 35:
        return True
    if r >= 155 and b <= 140 and (r - g) >= 22 and (r - b) >= 24 and g <= 175:
        return True
    if b >= 95 and r >= 85 and g <= min(r, b) - 12:
        return True
    return False


def is_floodable(r, g, b):
    if is_flower(r, g, b):
        return True
    if is_car_paint(r, g, b):
        return False
    return is_oval(r, g, b) or is_dirt_oval(r, g, b)


def is_pad_leftover(r, g, b):
    """Olive leftover under the chassis. Stricter than a global chroma widen
    so cream body shading is not treated as grass."""
    if is_car_paint(r, g, b) or is_red_paint(r, g, b):
        return False
    if is_floodable(r, g, b) or is_flower(r, g, b):
        return True
    s = r + g + b
    if g < 70 or s < 160 or s > 520:
        return False
    if (g - b) < 16:
        return False
    if (g - r) > 16 or (g - r) < -20:
        return False
    return True


def is_studio(r, g, b, br, bg, bb, tol=42):
    return abs(r - br) <= tol and abs(g - bg) <= tol and abs(b - bb) <= tol


def key_studio(pix, w, h):
    corners = [pix[0, 0], pix[w - 1, 0], pix[0, h - 1], pix[w - 1, h - 1]]
    if all(c[3] < 12 for c in corners):
        return 0
    br = sum(c[0] for c in corners) // 4
    bgc = sum(c[1] for c in corners) // 4
    bb = sum(c[2] for c in corners) // 4
    if max(br, bgc, bb) > 70:
        return 0
    n = w * h
    visited = bytearray(n)
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

    n_keyed = 0
    while q:
        x, y = q.popleft()
        r, g, b, a = pix[x, y]
        if a >= 12 and not is_studio(r, g, b, br, bgc, bb, 42):
            continue
        if a >= 12:
            pix[x, y] = (r, g, b, 0)
            n_keyed += 1
        if x + 1 < w:
            seed(x + 1, y)
        if x:
            seed(x - 1, y)
        if y + 1 < h:
            seed(x, y + 1)
        if y:
            seed(x, y - 1)
    return n_keyed


def _box_opaque(pix, box, step=2):
    x0, y0, x1, y1 = box
    op = tot = 0
    for y in range(y0, y1, step):
        for x in range(x0, x1, step):
            tot += 1
            if pix[x, y][3] >= 12:
                op += 1
    return op / tot if tot else 0.0


def key_platform(path, out_path=None):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    pix = im.load()
    n = w * h
    key_studio(pix, w, h)
    if os.path.basename(path) in KEEP_OVAL:
        dest = out_path or path
        im.save(dest, 'WEBP', quality=90, method=4)
        return 0, im
    before = im.copy()
    body_box = (int(w * 0.36), int(h * 0.34), int(w * 0.64), int(h * 0.56))
    cab_box = (int(w * 0.40), int(h * 0.46), int(w * 0.70), int(h * 0.66))
    body0 = _box_opaque(pix, body_box)
    cab0 = _box_opaque(pix, cab_box)

    seen = bytearray(n)
    q = deque()

    def seed(x, y):
        i = y * w + x
        if seen[i]:
            return
        seen[i] = 1
        q.append((x, y))

    # Image edge only. Window / cockpit holes are also transparent after
    # studio key; flooding from them eats door and roof paint.
    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    n_keyed = 0
    while q:
        x, y = q.popleft()
        r, g, b, a = pix[x, y]
        if a < 12:
            pass
        elif is_floodable(r, g, b):
            pix[x, y] = (r, g, b, 0)
            n_keyed += 1
        else:
            continue
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1),
                       (x + 1, y + 1), (x - 1, y + 1), (x + 1, y - 1), (x - 1, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                seed(nx, ny)

    # Trapped under the chassis: remaining pad CCs no longer reach the
    # image edge (wheels close the ring). Skip blobs that sit on the body.
    visited = bytearray(n)
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if visited[i]:
                continue
            r, g, b, a = pix[x, y]
            if a < 12 or not is_pad_leftover(r, g, b):
                visited[i] = 1
                continue
            blob = []
            bq = deque([(x, y)])
            visited[i] = 1
            while bq:
                cx, cy = bq.popleft()
                blob.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    ni = ny * w + nx
                    if visited[ni]:
                        continue
                    rr, gg, bb, aa = pix[nx, ny]
                    if aa < 12:
                        visited[ni] = 1
                        continue
                    if is_pad_leftover(rr, gg, bb):
                        visited[ni] = 1
                        bq.append((nx, ny))
            on_body = 0
            for cx, cy in blob:
                if (body_box[0] <= cx < body_box[2] and body_box[1] <= cy < body_box[3]) or (
                        cab_box[0] <= cx < cab_box[2] and cab_box[1] <= cy < cab_box[3]):
                    on_body += 1
            if on_body > 0.12 * len(blob):
                continue
            for cx, cy in blob:
                rr, gg, bb, aa = pix[cx, cy]
                pix[cx, cy] = (rr, gg, bb, 0)
                n_keyed += 1

    # Opaque islands far from the car body are leftover flowers / oval scraps.
    # Chrome bumpers sit next to the body — keep those.
    comps = []
    visited2 = bytearray(n)
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if visited2[i] or pix[x, y][3] < 12:
                visited2[i] = 1
                continue
            blob = []
            bq = deque([(x, y)])
            visited2[i] = 1
            while bq:
                cx, cy = bq.popleft()
                blob.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    ni = ny * w + nx
                    if visited2[ni] or pix[nx, ny][3] < 12:
                        visited2[ni] = 1
                        continue
                    visited2[ni] = 1
                    bq.append((nx, ny))
            xs = [p[0] for p in blob]
            ys = [p[1] for p in blob]
            comps.append((len(blob), min(xs), min(ys), max(xs), max(ys), blob))
    if comps:
        comps.sort(key=lambda t: t[0], reverse=True)
        _n0, car_x0, car_y0, car_x1, car_y1, _car = comps[0]
        pad = 18
        near = (car_x0 - pad, car_y0 - pad, car_x1 + pad, car_y1 + pad)
        for _n, x0, y0, x1, y1, blob in comps[1:]:
            overlaps = not (x1 < near[0] or x0 > near[2] or y1 < near[1] or y0 > near[3])
            if overlaps:
                continue
            for cx, cy in blob:
                rr, gg, bb, aa = pix[cx, cy]
                pix[cx, cy] = (rr, gg, bb, 0)
                n_keyed += 1

    # 2px pad fringe on already-keyed meadow, lower half only.
    y_fringe = int(h * 0.48)
    for _pass in range(2):
        fringe = []
        for y in range(y_fringe, h):
            for x in range(w):
                r, g, b, a = pix[x, y]
                if a < 12 or not is_pad_leftover(r, g, b):
                    continue
                if (body_box[0] <= x < body_box[2] and body_box[1] <= y < body_box[3]):
                    continue
                hit = False
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and pix[nx, ny][3] < 12:
                        hit = True
                        break
                if hit:
                    fringe.append((x, y))
        for x, y in fringe:
            r, g, b, a = pix[x, y]
            pix[x, y] = (r, g, b, 0)
            n_keyed += 1

    body1 = _box_opaque(pix, body_box)
    cab1 = _box_opaque(pix, cab_box)
    ate = ((body0 > 0.25 and body1 < body0 * 0.82) or
           (cab0 > 0.25 and cab1 < cab0 * 0.82))
    if ate:
        # Flood ate the car. Keep studio-keyed original.
        im = before
        pix = im.load()
        n_keyed = -n_keyed

    dest = out_path or path
    im.save(dest, 'WEBP', quality=90, method=4)
    return n_keyed, im


def magenta(im, dest):
    bg = Image.new('RGB', im.size, (255, 0, 255))
    bg.paste(im, mask=im.split()[-1])
    bg.save(dest, 'JPEG', quality=85)


def car_paths():
    paths = []
    for i in range(1, 17):
        paths.append(os.path.join(ROOT, 'p_car_%d.webp' % i))
        paths.append(os.path.join(ROOT, 'p_car_%d_rear.webp' % i))
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-dir', default='',
                    help='Write copies into this folder under map/ instead of originals')
    ap.add_argument('--magenta', action='store_true')
    ap.add_argument('--only', default='', help='Comma ids e.g. 1,5,14,16')
    args = ap.parse_args()

    ids = None
    if args.only:
        ids = set(int(x) for x in args.only.split(',') if x.strip())

    out_dir = None
    if args.dry_dir:
        out_dir = os.path.join(ROOT, args.dry_dir)
        os.makedirs(out_dir, exist_ok=True)

    for src in car_paths():
        base = os.path.basename(src)
        num = int(base.split('_')[2].split('.')[0])
        if ids is not None and num not in ids:
            continue
        if not os.path.isfile(src):
            raise SystemExit('missing ' + src)
        dest = os.path.join(out_dir, base) if out_dir else src
        if out_dir:
            shutil.copy2(src, dest)
            n, im = key_platform(dest)
        else:
            n, im = key_platform(src)
        print(base, 'keyed', n)
        if args.magenta:
            magenta(im, dest.replace('.webp', '_mag.jpg'))


if __name__ == '__main__':
    main()
