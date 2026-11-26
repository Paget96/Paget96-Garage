#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
"""Reference codes for lib/qr.js, made by another encoder, and a decoder check of drawn codes.

    python3 tools/qr_reference.py                  # writes tests/fixtures/qr_reference.json (python qrcode)
    python3 tools/qr_reference.py --decode a.png   # reads every QR code in the pictures (pyzbar, libzbar)

The reference: the Python qrcode package (pip install qrcode) makes each case in byte mode with the same level and
mask, and tests/qr.test.js compares lib/qr.js's matrix with it module by module. The mask is given because
encoders choose it differently (qrcode's penalty count is not the standard's); every mask is compared at least once.
Only for development: nothing here runs on the head unit.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'qr_reference.json')

REPORT_URL = ('https://github.com/Paget96/Paget96-Garage/issues/new?title=Report+from+Health+1.1.0&body=What+happened%3A%0A%0A%0A'
              'App%3A+Health+1.1.0%0AiDrive+7%2C+firmware+P18_23w44.2-1-3%0AEngine%3A+petrol%2C+6+cylinders%2C+one+turbo%2C+OPF%0A'
              'Settings%3A+fps%3D30%2C+units%3Dimperial%0ALog%3A+1+error%2C+1+warning%0A17%3A04+ERROR+fault+memory+read%3A+no+answer')
# (text, level, mask): every level, every mask, versions 1 to 40, ASCII and UTF-8
CASES = [
    ('HELLO WORLD', 'M', 4),
    ('a', 'H', 0),
    ('https://github.com/Paget96/Paget96-Garage', 'L', 2),
    ('Paget96 Garage ćčšžđ', 'Q', 6),
    (REPORT_URL, 'L', 3),
    (REPORT_URL, 'M', 1),
    ('x' * 300, 'M', 5),
    ('y' * 1000, 'L', 7),
    ('0123456789' * 40, 'Q', 2),
    ('z' * 2900, 'L', 1),
]


def make():
    import qrcode
    from qrcode.util import QRData, MODE_8BIT_BYTE
    levels = {'L': qrcode.constants.ERROR_CORRECT_L, 'M': qrcode.constants.ERROR_CORRECT_M,
              'Q': qrcode.constants.ERROR_CORRECT_Q, 'H': qrcode.constants.ERROR_CORRECT_H}
    out = []
    for text, ecl, mask in CASES:
        q = qrcode.QRCode(version=None, error_correction=levels[ecl], border=0, mask_pattern=mask)
        q.add_data(QRData(text.encode('utf-8'), mode=MODE_8BIT_BYTE), optimize=0)
        q.make(fit=True)
        rows = [''.join('1' if v else '0' for v in r) for r in q.get_matrix()]
        out.append({'text': text, 'ecl': ecl, 'mask': mask, 'version': q.version, 'rows': rows})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'made_by': 'python qrcode %s, tools/qr_reference.py' % version_of('qrcode'), 'cases': out}, f, separators=(',', ':'))
        f.write('\n')
    print('%s: %d codes' % (os.path.relpath(OUT, ROOT), len(out)))


def version_of(pkg):
    try:
        from importlib.metadata import version
        return version(pkg)
    except Exception:
        return '?'


def decode(paths):
    from PIL import Image
    from pyzbar.pyzbar import decode as zbar
    bad = 0
    for p in paths:
        found = zbar(Image.open(p).convert('L'))
        if not found:
            bad += 1
            print('NONE %s' % p)
        for d in found:
            print('ok   %s: %s' % (p, d.data.decode('utf-8', 'replace')))
    return 1 if bad else 0


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--decode':
        sys.exit(decode(sys.argv[2:]))
    make()
