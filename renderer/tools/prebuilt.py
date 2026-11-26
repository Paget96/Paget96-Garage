#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
"""The Store tool p96-renderd in renderer/prebuilt/: the committed head unit binary and the files beside it.

    python3 renderer/tools/prebuilt.py make     # after `make` in the p96-renderd-build image (renderer/README.md)
    python3 renderer/tools/prebuilt.py check    # the copies match their sources, the binary matches the sources

make copies build/p96-renderd and the files the tool installs into prebuilt/ and writes prebuilt/SOURCE_SHA256: a
fingerprint of everything the binary is built from (src/, inputgate/*.cpp, protocol/*.xml, docker/, Makefile; line
endings ignored). check fails when a source changed since the binary was built (build and make again) or a copy in
prebuilt/ differs from its source.
"""
import hashlib
import os
import shutil
import sys

R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PRE = os.path.join(R, 'prebuilt')
SUM = os.path.join(PRE, 'SOURCE_SHA256')
# prebuilt/<name>: its source in renderer/ (or the repository root)
COPIES = {
    'p96-renderd.conf': 'p96-renderd.conf',
    'foreground_gate.js': 'js/foreground_gate.js',
    'p96-renderd.service': 'systemd/p96-renderd.service',
    'LICENSE': 'LICENSE',
    'LICENSE.mgu-renderd': 'LICENSE.mgu-renderd',
    'NOTICE': '../NOTICE',
}


def source_hash(parts=(('src', None), ('inputgate', ('.cpp',)), ('protocol', ('.xml',)), ('docker', None), ('', ('Makefile',)))):
    files = []
    for sub, exts in parts:
        d = os.path.join(R, sub)
        for n in sorted(os.listdir(d)):
            p = os.path.join(d, n)
            if not os.path.isfile(p):
                continue
            if exts and not any(n.endswith(e) for e in exts):
                continue
            files.append(((sub + '/' + n).lstrip('/'), p))
    h = hashlib.sha256()
    for rel, p in files:
        h.update(rel.encode() + b'\0' + open(p, 'rb').read().replace(b'\r\n', b'\n') + b'\0')
    return h.hexdigest()


def make():
    b = os.path.join(R, 'build', 'p96-renderd')
    if not os.path.isfile(b):
        sys.exit('no build/p96-renderd: build it first (renderer/README.md, Build)')
    os.makedirs(PRE, exist_ok=True)
    shutil.copy(b, os.path.join(PRE, 'p96-renderd'))
    os.chmod(os.path.join(PRE, 'p96-renderd'), 0o755)
    for dst, src in COPIES.items():
        shutil.copy(os.path.join(R, src), os.path.join(PRE, dst))
    with open(SUM, 'w') as f:
        f.write(source_hash() + '\n# sha256 of renderer/ src/, inputgate/*.cpp, protocol/*.xml, docker/, Makefile '
                '(tools/prebuilt.py) this binary was built from\n')
    print('prebuilt/ made, source', source_hash()[:16])


def check():
    bad = []
    try:
        have = open(SUM).read().split()[0]
    except (OSError, IndexError):
        have = None
    if have != source_hash():
        bad.append('prebuilt/p96-renderd was built from other sources: build again, then prebuilt.py make')
    if not os.path.isfile(os.path.join(PRE, 'p96-renderd')):
        bad.append('prebuilt/p96-renderd missing')
    for dst, src in COPIES.items():
        a, b = os.path.join(PRE, dst), os.path.join(R, src)
        if not os.path.isfile(a) or open(a, 'rb').read() != open(b, 'rb').read():
            bad.append('prebuilt/%s differs from %s: prebuilt.py make' % (dst, src))
    for b in bad:
        print('FAIL', b)
    if not bad:
        print('ok   prebuilt/ matches its sources')
    return 1 if bad else 0


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    sys.exit(make() if cmd == 'make' else check())
