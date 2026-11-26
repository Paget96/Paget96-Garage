#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
"""Draw a Paget96 Garage app icon on the one shared template.

Every Paget96 Garage icon uses this template and no other style (owner, 2026-11-26 19:28 to 19:33, set "B2"):
the iDrive 7 rounded square in three tones split on the diagonal (owner, 20:02, set "T1": orange, deep orange
and graphite towards the bottom right), the glyph in white lines with its details in light cream, a soft shadow
under the glyph, a faint light from the top like glass and a thin light edge. Every glyph is drawn at the size that gives it the
same visual size as the others, with the same line weight (owner, 19:29: "sve ikonice moraju da budu
srazmerne"). Drawn at 4x and scaled down to 140 x 140 px. The spec is in docs/ICONS.md.

This is a development tool: icons are committed as apps/<id>/icon.png, so it
needs Pillow on the developer's machine, never on the head unit.

  python tools/make_icon.py <glyph> <out.png>
  python tools/make_icon.py --mask <glyph.png> <out.png>
  python tools/make_icon.py --sheet <out.png> [glyph ...]

<glyph> is a name from GLYPHS below; a new app adds its glyph there.
--mask takes a glyph drawn as a white-on-transparent PNG (any square size):
its alpha becomes the white glyph, without details.
"""
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 140
SS = 4
S = SIZE * SS
MAX_BYTES = 128 * 1024

# the three tones, from the top left to the bottom right: (gradient top, gradient bottom) and where each ends
# along the diagonal (share of the way from the top left corner to the bottom right one)
BANDS = [((255, 150, 60), (235, 95, 20), 0.62),    # orange
         ((200, 70, 10), (150, 45, 5), 0.78),      # deep orange
         ((48, 52, 62), (22, 24, 30), None)]       # graphite
INK = (250, 250, 252)         # the glyph's lines
DETAIL = (255, 214, 170)      # its details: the needle, the beat, the flap, the star, the car
CORNER = 0.235                # rounded square corner radius, share of the side (the iDrive 7 shape)
STROKE = 0.06                 # line weight, share of the side, the same in every icon
BOX = 0.58                    # every glyph's box has the area of a square this share of the side ...
MAX_SIDE = 0.68               # ... and no side longer than this share
ART = 0.84                    # the icon fills this share of the 140 px tile, so the HMI's focus frame shows round it
SHADOW_BLUR = 0.02
SHADOW_ALPHA = 0.45
SHADOW_DX = 0.008
SHADOW_DY = 0.02
GLOSS = 38                    # the light from the top, alpha at the top edge, fading out by the middle
EDGE_ALPHA = 0.25             # the thin light edge


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


def dot(d, x, y, w, col): d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)

def poly(d, pts, w, col, ends=True):
    d.line(pts, fill=col, width=w, joint='curve')
    if ends:
        for p in (pts[0], pts[-1]): dot(d, p[0], p[1], w, col)

def _datalog(d, c, s, w, col, acc):
    # Datalog: a gauge, its needle rising into the last part of the scale (the details)
    r = s * 1.0; cy = c + s * 0.18
    d.arc([c - r, cy - r, c + r, cy + r], 160, 330, fill=col, width=w)
    d.arc([c - r, cy - r, c + r, cy + r], 330, 380, fill=acc, width=w)
    for a in (160, 380):
        t = math.radians(a); dot(d, c + (r - w / 2) * math.cos(t), cy + (r - w / 2) * math.sin(t), w, col if a == 160 else acc)
    for a in range(180, 330, 30):
        t = math.radians(a); poly(d, [(c + r * 0.62 * math.cos(t), cy + r * 0.62 * math.sin(t)), (c + r * 0.72 * math.cos(t), cy + r * 0.72 * math.sin(t))], int(w * 0.6), col)
    t = math.radians(305); poly(d, [(c, cy), (c + r * 0.78 * math.cos(t), cy + r * 0.78 * math.sin(t))], w, acc)
    dot(d, c, cy, w * 2.0, col)

def _health(d, c, s, w, col, acc):
    # Health: a heart, the beat across it
    pts = []
    for k in range(0, 361, 6):
        t = math.radians(k)
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((c + x * s / 16.5, c - y * s / 16.5 + s * 0.05))
    d.line(pts, fill=col, width=w, joint='curve')
    y0 = c + s * 0.05
    poly(d, [(c - s * 1.15, y0), (c - s * 0.4, y0), (c - s * 0.2, y0 - s * 0.38), (c + s * 0.05, y0 + s * 0.42), (c + s * 0.27, y0), (c + s * 1.15, y0)], int(w * 0.85), acc)
def _exhaust(d, c, s, w, col, acc):
    # Exhaust: the exhaust tip seen from behind, with its flap inside turned half open, and the sound leaving it
    cx, r = c - s * 0.3, s * 0.78
    d.ellipse([cx - r, c - r, cx + r, c + r], outline=col, width=w)
    ri = r - w * 1.6
    d.ellipse([cx - ri, c - ri, cx + ri, c + ri], outline=col, width=int(w * 0.5))
    # the flap: a plate on its shaft, half open (seen as a tilted ellipse), the shaft across the pipe
    fl = Image.new('RGBA', d._image.size, (0, 0, 0, 0)); fd = ImageDraw.Draw(fl)
    fw, fh = ri * 0.95, ri * 0.42
    fd.ellipse([cx - fw, c - fh, cx + fw, c + fh], fill=acc)
    fl = fl.rotate(40, center=(cx, c), resample=Image.BICUBIC)
    d._image.alpha_composite(fl)
    dot(d, cx, c, w * 1.3, col)
    aw = int(w * 0.85)
    for rr in (s * 1.08, s * 1.4):
        a0, a1 = -32, 32
        d.arc([cx - rr, c - rr, cx + rr, c + rr], a0, a1, fill=col, width=aw)
        for an in (a0, a1):
            t = math.radians(an); dot(d, cx + (rr - aw / 2) * math.cos(t), c + (rr - aw / 2) * math.sin(t), aw, col)

def _standby(d, c, s, w, col, acc):
    # Standby: a crescent moon and a small star
    im = d._image
    m = Image.new('L', im.size, 0); md = ImageDraw.Draw(m)
    r = s * 0.95; md.ellipse([c - r, c - r, c + r, c + r], fill=255)
    br = r * 0.82; bx, by = c + r * 0.42, c - r * 0.3
    md.ellipse([bx - br, by - br, bx + br, by + br], fill=0)
    im.paste(Image.new('RGBA', im.size, col), (0, 0), m)
    sx, sy, sr = c + s * 0.62, c - s * 0.55, s * 0.22
    poly(d, [(sx - sr, sy), (sx + sr, sy)], int(w * 0.7), acc); poly(d, [(sx, sy - sr), (sx, sy + sr)], int(w * 0.7), acc)

def _house(d, c, s, w, col):
    rw = s * 1.05
    poly(d, [(c - rw, c - s * 0.15), (c, c - s * 0.95), (c + rw, c - s * 0.15)], w, col)
    x0, x1, y0, y1 = c - s * 0.78, c + s * 0.78, c - s * 0.08, c + s * 0.95
    poly(d, [(x0, y1), (x0, y0), (x1, y0), (x1, y1)], w, col)
    return x0, x1, y0, y1

def _garage(d, c, s, w, col, acc):
    # Garage, the brand mark: the garage with a car's front inside: the cabin, the body with two dark headlights, the wheels below
    x0, x1, y0, y1 = _house(d, c, s, w, col)
    aw = int(w * 0.75)
    by0, by1 = y1 - s * 0.5, y1 - s * 0.16
    poly(d, [(c - s * 0.42, by0), (c - s * 0.3, y0 + s * 0.28), (c + s * 0.3, y0 + s * 0.28), (c + s * 0.42, by0)], aw, acc)
    d.rounded_rectangle([c - s * 0.58, by0, c + s * 0.58, by1], radius=s * 0.12, fill=acc)
    for hx in (c - s * 0.34, c + s * 0.34):
        dot(d, hx, (by0 + by1) / 2, w * 0.95, col)
    for wx in (c - s * 0.4, c + s * 0.4):
        d.rounded_rectangle([wx - s * 0.1, by1 - s * 0.02, wx + s * 0.1, y1 - s * 0.02], radius=s * 0.04, fill=acc)

def _lights(d, c, s, w, col, acc):
    # Lights: a headlight seen from the side, its beam as three lines, the low one dipped
    r = s * 0.55; cx = c - s * 0.35
    d.ellipse([cx - r, c - r, cx + r * 0.6, c + r], outline=col, width=w)
    poly(d, [(cx + r * 0.05, c - r * 0.95), (cx + r * 0.05, c + r * 0.95)], w, col)
    for k, dy in enumerate((-0.55, 0.0, 0.55)):
        y0 = c + dy * r; drop = s * 0.18 * (k + 1) / 2
        poly(d, [(cx + r * 0.85, y0), (c + s * 0.95, y0 + drop)], int(w * 0.85), acc)


# name -> draw(d, centre, radius, stroke, ink, detail); add new apps' glyphs here
GLYPHS = {'garage': _garage, 'datalog': _datalog, 'health': _health, 'exhaust': _exhaust, 'standby': _standby, 'lights': _lights}


def _draw(fn, s):
    big = 2 * S
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    fn(ImageDraw.Draw(im), big / 2, s, int(S * STROKE), INK + (255,), DETAIL + (255,))
    return im.crop(im.getchannel('A').getbbox())


def glyph_layer(name):
    """The glyph centred on a transparent S x S layer, sized like every other glyph. It is drawn twice: once to
    measure it, then again at the radius that fits, so the line weight stays the same in every icon."""
    fn = GLYPHS[name]
    g = _draw(fn, S * 0.26)
    k = min(BOX * S / math.sqrt(g.size[0] * g.size[1]), MAX_SIDE * S / max(g.size))
    g = _draw(fn, S * 0.26 * k)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.alpha_composite(g, ((S - g.size[0]) // 2, (S - g.size[1]) // 2))
    return out


def mask_layer(path):
    src = Image.open(path).convert('RGBA').resize((S, S), Image.LANCZOS)
    im = Image.new('RGBA', (S, S), INK + (0,))
    im.putalpha(src.getchannel('A'))
    return im


def _background():
    base = Image.new('RGBA', (S, S))
    lo = -2.0
    for top, bottom, hi in BANDS:
        hi = 3.0 if hi is None else hi
        m = Image.new('L', (S, S), 0)
        # the band between the lines x + y = lo * 2S and x + y = hi * 2S
        a, b = lo * 2 * S, hi * 2 * S
        ImageDraw.Draw(m).polygon([(a - 2 * S, 2 * S), (a + 2 * S, -2 * S), (b + 2 * S, -2 * S), (b - 2 * S, 2 * S)], fill=255)
        base.paste(_gradient(S, top, bottom), (0, 0), m)
        lo = hi
    return base


def icon(gl):
    r = int(S * CORNER)
    shape = _squircle(S, r)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(_background(), (0, 0), shape)
    light = Image.new('L', (S, S), 0)
    ld = ImageDraw.Draw(light)
    for i in range(S // 2):
        ld.line([(0, i), (S, i)], fill=int(GLOSS * (1 - i / (S / 2))))
    gloss = Image.new('RGBA', (S, S), (255, 255, 255, 0))
    gloss.putalpha(ImageChops.multiply(light, shape))
    out = Image.alpha_composite(out, gloss)
    sh = gl.getchannel('A').filter(ImageFilter.GaussianBlur(S * SHADOW_BLUR)).point(lambda v: int(v * SHADOW_ALPHA))
    si = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    si.putalpha(sh)
    out = Image.alpha_composite(out, ImageChops.offset(si, int(S * SHADOW_DX), int(S * SHADOW_DY)))
    out = Image.alpha_composite(out, gl)
    edge = ImageChops.subtract(shape, _squircle(S, r - 3, int(S * 0.008)))
    e = Image.new('RGBA', (S, S), (255, 255, 255, 0))
    e.putalpha(edge.point(lambda v: int(v * EDGE_ALPHA)))
    out = Image.alpha_composite(out, e)
    # owner 2026-11-26 20:59: a little smaller, so the HMI's selector shows round the icon when the knob is on it
    side = int(round(SIZE * ART))
    tile = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    tile.alpha_composite(out.resize((side, side), Image.LANCZOS), ((SIZE - side) // 2, (SIZE - side) // 2))
    return tile


def save(im, out):
    im.save(out, optimize=True)
    n = os.path.getsize(out)
    if n > MAX_BYTES:
        os.remove(out)
        sys.exit('%s: %d bytes, over the 128 KiB icon limit' % (out, n))


def main(argv):
    if len(argv) >= 2 and argv[0] == '--sheet':
        names = argv[2:] or list(GLYPHS)
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
