#!/usr/bin/env python3
"""
gen_terrain_tiles.py — generate seamless pixel-art terrain tiles for the map
(src/js/mapview.js): grass texture overlay, dirt path, pond water.

All tiles are perfectly tileable (flecks wrap across edges via modulo placement),
so the engine can repeat them per cell with no visible seams. Run from root:
    python scripts/gen_terrain_tiles.py
"""
import os
import random
from PIL import Image

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src",
                                    "assets", "images", "map", "terrain"))
os.makedirs(OUT, exist_ok=True)
N = 64  # tile size in px

random.seed(7)  # deterministic output (no Date.now/random surprises in review)


def put(px, x, y, color):
    px[x % N, y % N] = color


def fleck(px, x, y, w, h, color):
    for dy in range(h):
        for dx in range(w):
            put(px, x + dx, y + dy, color)


def scatter(px, count, sizes, palette):
    for _ in range(count):
        x, y = random.randrange(N), random.randrange(N)
        w, h = random.choice(sizes)
        fleck(px, x, y, w, h, random.choice(palette))


def grass_tile():
    """Transparent overlay: green flecks + a few blades. Drawn OVER the checker
    grass fill so per-cell repetition is masked by the base tone variation."""
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    px = img.load()
    dark = [(111, 137, 74, 90), (120, 145, 80, 80)]
    light = [(148, 168, 98, 90), (158, 178, 110, 80)]
    scatter(px, 120, [(2, 2), (3, 2), (2, 3)], dark + light)
    # blade marks: short vertical 1x3 strokes
    for _ in range(26):
        x, y = random.randrange(N), random.randrange(N)
        c = random.choice([(95, 120, 60, 130), (140, 165, 90, 120)])
        fleck(px, x, y, 1, 3, c)
    img.save(os.path.join(OUT, "grass.png"))
    return img.size


def path_tile():
    """Opaque packed-dirt path with pebbles."""
    img = Image.new("RGBA", (N, N), (168, 116, 58, 255))
    px = img.load()
    scatter(px, 80, [(2, 2), (3, 2)], [(138, 94, 46, 255), (150, 104, 52, 255)])
    scatter(px, 40, [(2, 2)], [(192, 138, 74, 255), (200, 150, 90, 255)])  # lit pebbles
    img.save(os.path.join(OUT, "path.png"))
    return img.size


def water_tile():
    """Opaque calm pond water with ripple highlights."""
    img = Image.new("RGBA", (N, N), (74, 144, 184, 255))
    px = img.load()
    scatter(px, 50, [(2, 2), (3, 2)], [(63, 130, 170, 255), (88, 156, 196, 255)])
    # ripple dashes (horizontal 3x1 light streaks)
    for _ in range(22):
        x, y = random.randrange(N), random.randrange(N)
        fleck(px, x, y, 3, 1, (140, 196, 224, 255))
    img.save(os.path.join(OUT, "water.png"))
    return img.size


if __name__ == "__main__":
    print("grass", grass_tile())
    print("path", path_tile())
    print("water", water_tile())
    print("->", OUT)
