# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
"""Refresh upstream-kit/ from cauliflowermossgrape/idrive7-apps at a given commit.

    python tools/sync_upstream_kit.py <path to an idrive7-apps checkout> [<commit>]

Paget96 Garage builds its apps with upstream's kit, unchanged. The MGU Store builds a repo tree on the head unit
from that repo alone (no submodules are fetched), so the parts of the kit our builds need are kept here as a copied,
pinned snapshot: kit/runtime, kit/platform, kit/localization and the build tools. Nothing in upstream-kit/ is edited
by hand; change it upstream (a PR there) and sync again. The commit and date go to upstream-kit/UPSTREAM.json and NOTICE.
"""
import json, os, shutil, subprocess, sys

PATHS = [
    'LICENSE',
    'kit/runtime', 'kit/platform', 'kit/localization',
    'kit/tools/build.py', 'kit/tools/pack_data.py', 'kit/tools/localize.py', 'kit/tools/locale-revisions.json',
    'kit/tools/oapgen', 'kit/tools/make_icon.js',
]
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEST = os.path.join(ROOT, 'upstream-kit')
REPO = 'https://github.com/cauliflowermossgrape/idrive7-apps'


def git(src, *args):
    return subprocess.check_output(['git', '-C', src] + list(args), text=True).strip()


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = os.path.abspath(sys.argv[1])
    commit = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'
    sha = git(src, 'rev-parse', commit)
    if git(src, 'rev-parse', 'HEAD') != sha:
        sys.exit('check out %s in %s first (git -C %s checkout %s)' % (sha, src, src, sha))
    if git(src, 'status', '--porcelain', '--', *PATHS):
        sys.exit('%s has local changes in the kit: sync from a clean checkout' % src)
    date = git(src, 'show', '-s', '--format=%cI', sha)
    if os.path.isdir(DEST):
        shutil.rmtree(DEST)
    for p in PATHS:
        s, d = os.path.join(src, p), os.path.join(DEST, p)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        (shutil.copytree if os.path.isdir(s) else shutil.copy2)(s, d)
    with open(os.path.join(DEST, 'UPSTREAM.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump({'repo': REPO, 'commit': sha, 'date': date, 'paths': PATHS}, fh, indent=2)
        fh.write('\n')
    notice = os.path.join(ROOT, 'NOTICE')
    if os.path.isfile(notice):
        lines = open(notice, encoding='utf-8').read().split('\n')
        lines = [('Pinned upstream commit: %s (%s)' % (sha, date)) if l.startswith('Pinned upstream commit:') else l for l in lines]
        open(notice, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    print('upstream-kit/ is now %s (%s)' % (sha[:12], date))


if __name__ == '__main__':
    main()
