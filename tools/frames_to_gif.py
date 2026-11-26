#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
"""Turn a folder of PNG frames into a README GIF: 960 px wide, under 3 MB.

    python tools/frames_to_gif.py <frames-dir> <out.gif> [fps]

A developer tool (Pillow). It lowers the colours until the GIF is under 3 MB.
"""
import glob
import os
import sys

from PIL import Image

MAX = 3 * 1024 * 1024


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    frames_dir, out = argv[0], argv[1]
    fps = float(argv[2]) if len(argv) > 2 else 12.5
    files = sorted(glob.glob(os.path.join(frames_dir, '*.png')))
    if not files:
        sys.exit('no frames in ' + frames_dir)
    frames = []
    for f in files:
        im = Image.open(f).convert('RGB')
        h = round(im.height * 960 / im.width)
        frames.append(im.resize((960, h), Image.LANCZOS))
    for colours in (256, 192, 128, 96, 64):
        # each frame its own palette: the orange and green stay true (a shared one made them brown)
        q = [f.quantize(colors=colours, method=Image.MEDIANCUT, dither=Image.NONE) for f in frames]
        q[0].save(out, save_all=True, append_images=q[1:], duration=round(1000 / fps), loop=0, optimize=True, disposal=1)
        size = os.path.getsize(out)
        print('%s: %d frames, %d colours, %.2f MB' % (out, len(q), colours, size / 1048576))
        if size <= MAX:
            return 0
    sys.exit('still over 3 MB: use fewer frames')


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
