#!/usr/bin/env python3
"""Cars sit on the farm meadow — baked grass oval must be gone, body paint stays.

The sprites are 1024x1024 with studio already keyed. After platform keying:
  - lower band (under the car) is transparent so GRASS_A shows through
  - body / roof / hood stay opaque
  - Eastern Classic (16) dark-green paint is not eaten
"""
import os
import sys
from PIL import Image

# scripts/verify/ → repo root is two up
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    'src', 'assets', 'images', 'map')

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


def band_opaque(pix, w, h, y0, y1, step=2):
    op = tot = 0
    for y in range(y0, y1, step):
        for x in range(0, w, step):
            tot += 1
            if pix[x, y][3] >= 12:
                op += 1
    return op, tot


def box_opaque(pix, box, step=2):
    x0, y0, x1, y1 = box
    op = tot = 0
    for y in range(y0, y1, step):
        for x in range(x0, x1, step):
            tot += 1
            if pix[x, y][3] >= 12:
                op += 1
    return op, tot


def ratio(op, tot):
    return op / tot if tot else 0.0


for i in range(1, 17):
    for kind in ('', '_rear'):
        path = os.path.join(ROOT, 'p_car_%d%s.webp' % (i, kind))
        tag = os.path.basename(path)
        check(os.path.isfile(path), 'missing ' + tag)
        if not os.path.isfile(path):
            continue
        im = Image.open(path).convert('RGBA')
        w, h = im.size
        check(w >= 512 and h >= 512, '%s size %dx%d' % (tag, w, h))
        pix = im.load()
        # corners already studio-keyed
        for (cx, cy) in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)):
            check(pix[cx, cy][3] < 12, '%s corner (%d,%d) not transparent' % (tag, cx, cy))
        # Front-right cap of the baked grass oval (3/4 view). Cars whose
        # paint matches oval (jeep / cream wagon) keep a pad rather than
        # eating the body; 1 and 5 must be clean.
        op, tot = box_opaque(pix, (int(w * 0.78), int(h * 0.58), int(w * 0.94), int(h * 0.76)))
        r = ratio(op, tot)
        if i in (1, 5) and kind == '':
            check(r < 0.33, '%s oval cap still present (opaque %.1f%%)' % (tag, r * 100))
        # Screenshot 2026-08-20: cream sedan / pickup sat on a grass card.
        # Lower-left and lower-right meadow must stay empty — not a flower pad.
        if i in (1, 5):
            op, tot = box_opaque(pix, (int(w * 0.08), int(h * 0.72), int(w * 0.22), int(h * 0.90)))
            check(ratio(op, tot) < 0.05, '%s lower-left pad still present (opaque %.1f%%)' % (tag, ratio(op, tot) * 100))
            op, tot = box_opaque(pix, (int(w * 0.88), int(h * 0.82), int(w * 0.98), int(h * 0.95)))
            check(ratio(op, tot) < 0.05, '%s lower-right pad still present (opaque %.1f%%)' % (tag, ratio(op, tot) * 100))
        # Body mass in the upper-middle of the canvas.
        op, tot = box_opaque(pix, (int(w * 0.34), int(h * 0.36), int(w * 0.66), int(h * 0.58)))
        r = ratio(op, tot)
        check(r > 0.35, '%s body hollowed out (opaque %.1f%%)' % (tag, r * 100))

# Eastern Classic hood must stay dark green, not keyed.
p16 = os.path.join(ROOT, 'p_car_16.webp')
if os.path.isfile(p16):
    im = Image.open(p16).convert('RGBA')
    pix = im.load()
    op, tot = box_opaque(pix, (520, 430, 720, 560))
    r = ratio(op, tot)
    check(r > 0.70, 'p_car_16 hood eaten (opaque %.1f%%)' % (r * 100))
    # a specific hood pixel
    r, g, b, a = pix[600, 500]
    check(a >= 200, 'p_car_16 hood pixel transparent')
    check(g < 140 and (r + g + b) < 400, 'p_car_16 hood pixel not dark green %s' % ((r, g, b, a),))

# Family sedan brown roof stays.
p5 = os.path.join(ROOT, 'p_car_5.webp')
if os.path.isfile(p5):
    im = Image.open(p5).convert('RGBA')
    pix = im.load()
    op, tot = box_opaque(pix, (430, 300, 620, 400))
    r = ratio(op, tot)
    check(r > 0.55, 'p_car_5 roof eaten (opaque %.1f%%)' % (r * 100))

# Red convertible body stays; its dry oval goes.
p14 = os.path.join(ROOT, 'p_car_14.webp')
if os.path.isfile(p14):
    im = Image.open(p14).convert('RGBA')
    pix = im.load()
    op, tot = box_opaque(pix, (480, 430, 680, 560))
    r = ratio(op, tot)
    check(r > 0.70, 'p_car_14 hood eaten (opaque %.1f%%)' % (r * 100))
    r, g, b, a = pix[580, 500]
    check(a >= 200 and r > g + 20, 'p_car_14 hood not red paint %s' % ((r, g, b, a),))

# Cream pickup hood stays.
p1 = os.path.join(ROOT, 'p_car_1.webp')
if os.path.isfile(p1):
    im = Image.open(p1).convert('RGBA')
    pix = im.load()
    r, g, b, a = pix[620, 520]
    check(a >= 200, 'p_car_1 hood transparent %s' % ((r, g, b, a),))

if fails:
    print('FAIL car-platform')
    for f in fails:
        print(' -', f)
    sys.exit(1)
print('ok car-platform')
