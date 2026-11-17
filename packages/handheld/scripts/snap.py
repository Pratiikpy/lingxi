"""Turns the raw RGB565 frames of scripts/snap.ts into PNGs at 3x (nearest neighbour, as the screen's pixels are)
and a contact sheet per language.

    python scripts/snap.py <dir>
"""
import json
import os
import sys

from PIL import Image

d = sys.argv[1]
shots = json.load(open(os.path.join(d, "index.json")))
W, H, S = 240, 135, 3
by_lang = {}
for s in shots:
    raw = open(s["file"], "rb").read()
    im = Image.new("RGB", (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            v = raw[2 * (y * W + x)] | (raw[2 * (y * W + x) + 1] << 8)
            r, g, b = (v >> 11) & 31, (v >> 5) & 63, v & 31
            px[x, y] = (r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2)
    im = im.resize((W * S, H * S), Image.NEAREST)
    im.save(os.path.join(d, s["name"] + ".png"))
    by_lang.setdefault(s["name"].split("-")[0], []).append(im)
for lang, ims in by_lang.items():
    cols = 3
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (W * S + 12), rows * (H * S + 12)), (255, 255, 255))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % cols) * (W * S + 12), (i // cols) * (H * S + 12)))
    sheet.save(os.path.join(d, f"sheet-{lang}.png"))
print(len(shots), "frames")
