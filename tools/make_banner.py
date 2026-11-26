#!/usr/bin/env python3
"""Draw the Paget96 Garage banner for the README (docs/brand/banner.png).

The brand (owner, 2026-11-26 17:25: "promeni repo name u Paget96 Garage ... i brendiraj sve"):
the brand mark from tools/make_icon.py ('garage' glyph) next to the wordmark PAGET96 GARAGE in
orange with a soft glow, on the page gradient of lib/ui.js. Development tool, needs Pillow.

  python tools/make_banner.py
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
import make_icon  # noqa: E402

W, H, SS = 1600, 360, 2
ORANGE, AMBER, TEXT, DIM = (255, 128, 40), (255, 186, 70), (236, 240, 245), (140, 148, 160)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def font(size, bold=False):
    for name in (['DejaVuSans-Bold.ttf'] if bold else ['DejaVuSans.ttf']):
        for d in ('/usr/share/fonts/truetype/dejavu', 'C:/Windows/Fonts', '/Library/Fonts'):
            p = os.path.join(d, name)
            if os.path.exists(p):
                return ImageFont.truetype(p, size * SS)
    return ImageFont.load_default()


def main():
    w, h = W * SS, H * SS
    im = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip((16, 18, 22), (6, 7, 9))) + (255,))
    mark = make_icon.icon(make_icon.glyph_layer('garage')).resize((220 * SS, 220 * SS), Image.LANCZOS)
    im.alpha_composite(mark, (120 * SS, 70 * SS))
    lay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)
    ld.text((400 * SS, 150 * SS), 'PAGET96 GARAGE', font=font(88, True), fill=ORANGE + (255,), anchor='lm')
    glow = lay.getchannel('A').filter(ImageFilter.GaussianBlur(14 * SS)).point(lambda v: int(v * 0.6))
    gl = Image.new('RGBA', (w, h), ORANGE + (0,))
    gl.putalpha(glow)
    im = Image.alpha_composite(Image.alpha_composite(im, gl), lay)
    d = ImageDraw.Draw(im)
    d.text((404 * SS, 240 * SS), 'Modern apps for the BMW iDrive 7 head unit', font=font(34), fill=TEXT, anchor='lm')
    d.text((404 * SS, 288 * SS), 'Live data, clear charts, one look. Installed from the MGU Store.', font=font(24), fill=DIM, anchor='lm')
    d.rounded_rectangle([402 * SS, 200 * SS, 562 * SS, 206 * SS], 3 * SS, fill=AMBER)
    out = os.path.join(ROOT, 'docs', 'brand', 'banner.png')
    im.resize((W, H), Image.LANCZOS).convert('RGB').save(out, optimize=True)
    print(out)


if __name__ == '__main__':
    main()
