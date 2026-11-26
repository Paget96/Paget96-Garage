#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
"""Draw a Paget96 Garage app icon on the one shared template.

Every Paget96 Garage icon uses this template and no other style (owner, 2026-11-26):
a dark glass squircle with a vertical gradient, a faint orange edge, the glyph
in orange with amber accents, a soft orange glow and a small drop shadow,
drawn at 4x and scaled down to 140 x 140 px. The spec is in docs/ICONS.md.

This is a development tool: icons are committed as apps/<id>/icon.png, so it
needs Pillow on the developer's machine, never on the head unit.

  python tools/make_icon.py <glyph> <out.png>
  python tools/make_icon.py --mask <glyph.png> <out.png>
  python tools/make_icon.py --sheet <out.png> [glyph ...]

<glyph> is a name from GLYPHS below; a new app adds its glyph there.
--mask takes a glyph drawn as a white-on-transparent PNG (any square size):
its alpha becomes the orange glyph, without amber accents.
"""
import math
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 140
SS = 4
S = SIZE * SS
MAX_BYTES = 128 * 1024

BG_TOP = (30, 33, 40)
BG_BOTTOM = (10, 11, 14)
EDGE = (255, 140, 50)
EDGE_ALPHA = 0.55
ORANGE = (255, 128, 40)
AMBER = (255, 186, 70)
CORNER = 0.235      # squircle corner radius, share of the side
GLOW_BLUR = 0.03    # share of the side
GLOW_ALPHA = 0.7
SHADOW_BLUR = 0.012
SHADOW_ALPHA = 0.45
SHADOW_DY = 0.012


def _gradient(size, c1, c2):
    g = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(g)
    for i in range(size):
        t = i / (size - 1)
        d.line([(0, i), (size, i)], fill=tuple(int(c1[k] * (1 - t) + c2[k] * t) for k in range(3)) + (255,))
    return g


def _squircle(size, r, inset=0):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([inset, inset, size - 1 - inset, size - 1 - inset], r, fill=255)
    return m


def _clock(d, c, s, w, col, acc):
    d.ellipse([c - s, c - s, c + s, c + s], outline=col, width=w)
    d.line([c, c, c, c - s * 0.62], fill=col, width=w)
    d.line([c, c, c + s * 0.46, c + s * 0.18], fill=acc, width=w)
    d.ellipse([c - w, c - w, c + w, c + w], fill=col)


def _flag(d, c, s, w, col, acc):
    x0 = c - s * 0.8
    d.line([x0, c - s * 1.05, x0, c + s * 1.05], fill=col, width=w)
    q = s * 0.42
    for i in range(3):
        for j in range(4):
            if (i + j) % 2 == 0:
                d.rectangle([x0 + w / 2 + j * q, c - s + i * q, x0 + w / 2 + (j + 1) * q, c - s + (i + 1) * q],
                            fill=col if (i + j) % 4 == 0 else acc)


def _gauge(d, c, s, w, col, acc):
    d.arc([c - s, c - s, c + s, c + s], 145, 395, fill=col, width=w)
    d.arc([c - s, c - s, c + s, c + s], 330, 395, fill=acc, width=w)
    a = math.radians(-35)
    d.line([c, c, c + s * 0.82 * math.cos(a), c + s * 0.82 * math.sin(a)], fill=acc, width=w)
    d.ellipse([c - w * 1.2, c - w * 1.2, c + w * 1.2, c + w * 1.2], fill=col)


def _wrench(d, c, s, w, col, acc):
    hx, hy, hr = c + s * 0.45, c - s * 0.45, s * 0.5
    d.line([c - s * 0.8, c + s * 0.8, hx - hr * 0.55, hy + hr * 0.55], fill=col, width=int(w * 1.7))
    d.arc([hx - hr, hy - hr, hx + hr, hy + hr], 10, 280, fill=col, width=int(w * 1.5))
    d.ellipse([c - s * 0.98, c + s * 0.62, c - s * 0.62, c + s * 0.98], fill=acc)


def _garage(d, c, s, w, col, acc):
    # the Paget96 Garage brand mark: a garage roof and an open door with a gauge glowing inside
    rw = s * 1.05
    d.line([c - rw, c - s * 0.15, c, c - s * 0.95, c + rw, c - s * 0.15], fill=col, width=w, joint='curve')
    for x, y in ((c - rw, c - s * 0.15), (c, c - s * 0.95), (c + rw, c - s * 0.15)):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)
    x0, x1, y0, y1 = c - s * 0.78, c + s * 0.78, c - s * 0.08, c + s * 0.95
    d.line([x0, y1, x0, y0, x1, y0, x1, y1], fill=col, width=w, joint='curve')
    for x, y in ((x0, y1), (x1, y1)):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)
    gr = s * 0.42
    gy = y1 - s * 0.12
    d.arc([c - gr, gy - gr, c + gr, gy + gr], 180, 360, fill=acc, width=int(w * 0.8))
    a = math.radians(-50)
    d.line([c, gy, c + gr * 0.8 * math.cos(a), gy + gr * 0.8 * math.sin(a)], fill=acc, width=int(w * 0.8))
    d.ellipse([c - w * 0.7, gy - w * 0.7, c + w * 0.7, gy + w * 0.7], fill=col)


def _health(d, c, s, w, col, acc):
    # Health: a shield, and a heart-beat line across it
    top, bot, hw = c - s * 1.0, c + s * 1.02, s * 0.86
    pts = [(c, top), (c + hw, top + s * 0.28), (c + hw, c + s * 0.05)]
    # the lower sides curve in to the point
    for i in range(1, 9):
        t = i / 8
        pts.append((c + hw * (1 - t) ** 1.4, c + s * 0.05 + (bot - c - s * 0.05) * t ** 0.9))
    pts += [(c - hw * (1 - t) ** 1.4, c + s * 0.05 + (bot - c - s * 0.05) * t ** 0.9) for t in [i / 8 for i in range(7, 0, -1)]]
    pts += [(c - hw, c + s * 0.05), (c - hw, top + s * 0.28), (c, top)]
    d.line(pts, fill=col, width=w, joint='curve')
    for x, y in ((c, top), (c, bot)):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)
    # the beat, in amber, round ends
    y0 = c + s * 0.02
    beat = [(c - s * 1.18, y0), (c - s * 0.42, y0), (c - s * 0.22, y0 - s * 0.42), (c + s * 0.02, y0 + s * 0.5),
            (c + s * 0.24, y0 - s * 0.22), (c + s * 0.4, y0), (c + s * 1.18, y0)]
    aw = int(w * 0.85)
    d.line(beat, fill=acc, width=aw, joint='curve')
    for x, y in (beat[0], beat[-1]):
        d.ellipse([x - aw / 2, y - aw / 2, x + aw / 2, y + aw / 2], fill=acc)



def _log(d, c, s, w, col, acc):
    # Datalog: two axes and a trace climbing like a run, the newest sample a dot
    x0, x1, y0, y1 = c - s * 0.95, c + s * 0.95, c - s * 0.9, c + s * 0.8
    d.line([x0, y0, x0, y1, x1, y1], fill=col, width=w, joint='curve')
    for x, y in ((x0, y0), (x1, y1)):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)
    pts = [(x0 + s * 0.3 + (x1 - x0 - s * 0.6) * k / 10, y1 - s * 0.25 - (y1 - y0 - s * 0.55) * (1 - math.exp(-k / 3.2)) / (1 - math.exp(-10 / 3.2)))
           for k in range(11)]
    d.line(pts, fill=acc, width=w, joint='curve')
    x, y = pts[-1]
    d.ellipse([x - w * 1.1, y - w * 1.1, x + w * 1.1, y + w * 1.1], fill=acc)


# name -> draw(d, centre, radius, stroke, colour, accent); add new apps' glyphs here
GLYPHS = {'clock': _clock, 'flag': _flag, 'gauge': _gauge, 'wrench': _wrench, 'garage': _garage, 'health': _health, 'log': _log}


def glyph_layer(name):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    GLYPHS[name](ImageDraw.Draw(im), S / 2, S * 0.26, int(S * 0.055), ORANGE + (255,), AMBER + (255,))
    return im


def mask_layer(path):
    src = Image.open(path).convert('RGBA').resize((S, S), Image.LANCZOS)
    im = Image.new('RGBA', (S, S), ORANGE + (0,))
    im.putalpha(src.getchannel('A'))
    return im


def icon(gl):
    r = int(S * CORNER)
    base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    base.paste(_gradient(S, BG_TOP, BG_BOTTOM), (0, 0), _squircle(S, r))
    edge = ImageChops.subtract(_squircle(S, r), _squircle(S, r - 3, int(S * 0.012)))
    base.paste(EDGE, (0, 0), edge.point(lambda v: int(v * EDGE_ALPHA)))
    glow = gl.getchannel('A').filter(ImageFilter.GaussianBlur(S * GLOW_BLUR)).point(lambda v: int(v * GLOW_ALPHA))
    gc = Image.new('RGBA', (S, S), ORANGE + (0,))
    gc.putalpha(glow)
    base = Image.alpha_composite(base, gc)
    sh = gl.getchannel('A').filter(ImageFilter.GaussianBlur(S * SHADOW_BLUR)).point(lambda v: int(v * SHADOW_ALPHA))
    si = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    si.putalpha(sh)
    si = ImageChops.offset(si, 0, int(S * SHADOW_DY))
    base = Image.alpha_composite(base, si)
    base = Image.alpha_composite(base, gl)
    return base.resize((SIZE, SIZE), Image.LANCZOS)


def save(im, out):
    im.save(out, optimize=True)
    import os
    n = os.path.getsize(out)
    if n > MAX_BYTES:
        os.remove(out)
        sys.exit('%s: %d bytes, over the 128 KiB icon limit' % (out, n))


def main(argv):
    if len(argv) >= 2 and argv[0] == '--sheet':
        names = argv[2:] or ['clock', 'flag', 'gauge', 'wrench']
        sheet = Image.new('RGBA', (len(names) * 160 + 20, 180), (34, 37, 44, 255))
        for i, g in enumerate(names):
            sheet.alpha_composite(icon(glyph_layer(g)), (20 + i * 160, 20))
        sheet.save(argv[1], optimize=True)
        return
    if len(argv) == 3 and argv[0] == '--mask':
        return save(icon(mask_layer(argv[1])), argv[2])
    if len(argv) == 2 and argv[0] in GLYPHS:
        return save(icon(glyph_layer(argv[0])), argv[1])
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
