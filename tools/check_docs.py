#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
"""Fail when an app is not documented the Paget96 Garage way (owner rule, 2026-11-26).

For every apps/<id>/ with an app.json:
  - README.md has a section for it: a heading '### <Name>' or an anchor '<a id="<id>">'
  - apps/<id>/README.md exists
  - docs/media/<id>/ holds at least one .gif (each under 3 MB) and at least one .png screenshot
  - apps/<id>/icon.png exists, 140 x 140, at most 128 KiB (made by tools/make_icon.py)
Also: no em dash or en dash in any tracked text file.

    python tools/check_docs.py
"""
import json
import os
import struct
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DASHES = (chr(0x2014), chr(0x2013))
TEXT = ('.md', '.js', '.py', '.json', '.yml', '.yaml', '.txt', '.sh')


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    return struct.unpack('>II', head[16:24]) if head[:8] == b'\x89PNG\r\n\x1a\n' else (0, 0)


def main():
    errors = []
    readme = open(os.path.join(ROOT, 'README.md'), encoding='utf-8').read()
    apps = os.path.join(ROOT, 'apps')
    ids = sorted(d for d in os.listdir(apps) if os.path.isfile(os.path.join(apps, d, 'app.json'))) if os.path.isdir(apps) else []
    for i in ids:
        spec = json.load(open(os.path.join(apps, i, 'app.json'), encoding='utf-8'))
        name = spec.get('name') or spec.get('title') or i
        if ('### ' + name) not in readme and ('<a id="%s">' % i) not in readme:
            errors.append('%s: no section in README.md (### %s)' % (i, name))
        if not os.path.isfile(os.path.join(apps, i, 'README.md')):
            errors.append('%s: no apps/%s/README.md' % (i, i))
        media = os.path.join(ROOT, 'docs', 'media', i)
        files = os.listdir(media) if os.path.isdir(media) else []
        gifs = [f for f in files if f.endswith('.gif')]
        if not gifs:
            errors.append('%s: no GIF in docs/media/%s/' % (i, i))
        if not [f for f in files if f.endswith('.png')]:
            errors.append('%s: no screenshot (.png) in docs/media/%s/' % (i, i))
        for g in gifs:
            if os.path.getsize(os.path.join(media, g)) > 3 * 1024 * 1024:
                errors.append('%s: docs/media/%s/%s is over 3 MB' % (i, i, g))
        icon = os.path.join(apps, i, 'icon.png')
        if not os.path.isfile(icon):
            errors.append('%s: no icon.png' % i)
        else:
            if png_size(icon) != (140, 140):
                errors.append('%s: icon.png is %dx%d, not 140x140' % ((i,) + png_size(icon)))
            if os.path.getsize(icon) > 128 * 1024:
                errors.append('%s: icon.png is over 128 KiB' % i)
    try:
        tracked = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, universal_newlines=True).split('\n')
    except Exception:
        tracked = []
    for f in tracked:
        if f.endswith(TEXT) and not f.startswith('kit/'):
            try:
                s = open(os.path.join(ROOT, f), encoding='utf-8').read()
            except (OSError, UnicodeDecodeError):
                continue
            if any(d in s for d in DASHES):
                errors.append('%s: em or en dash' % f)
    for e in errors:
        print(e)
    print('%d app(s) checked, %d problem(s)' % (len(ids), len(errors)))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
