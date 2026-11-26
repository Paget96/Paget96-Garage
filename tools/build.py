#!/usr/bin/env python3
"""Build Garage apps with the vendored upstream kit.

    python tools/build.py <app id> [...] [--language xx] [--preview-only]

Upstream's kit/tools/build.py finds kit/, apps/, dist/ and oap-sdk/ next to itself, so this
stages a tree it understands in .stage/ and runs it there:

    .stage/kit       -> upstream-kit/kit            (symlink, or a copy where links are refused)
    .stage/apps/<id>    copy of apps/<id> plus lib/ui.js as garage_ui.js
    .stage/oap-sdk   -> oap-sdk                     (the MGU Store places the SDK there)
    .stage/dist      -> dist                        (the .tgz lands in dist/<id>@<version>.tgz)

The MGU Store runs this on the head unit (Python 3.12, mgu-repo.json); it works the same on a PC.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
STAGE = os.path.join(ROOT, '.stage')
LIB = {'ui.js': 'garage_ui.js'}


def link(src, dst):
    if os.path.lexists(dst):
        if os.path.islink(dst) or os.path.isfile(dst):
            os.remove(dst)
        else:
            shutil.rmtree(dst)
    try:
        os.symlink(src, dst, target_is_directory=os.path.isdir(src))
    except OSError:
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy(src, dst)


def stage(ids):
    os.makedirs(os.path.join(STAGE, 'apps'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'oap-sdk'), exist_ok=True)
    link(os.path.join(ROOT, 'upstream-kit', 'kit'), os.path.join(STAGE, 'kit'))
    link(os.path.join(ROOT, 'oap-sdk'), os.path.join(STAGE, 'oap-sdk'))
    link(os.path.join(ROOT, 'dist'), os.path.join(STAGE, 'dist'))
    for i in ids:
        src = os.path.join(ROOT, 'apps', i)
        if not os.path.isfile(os.path.join(src, 'app.json')):
            sys.exit('no app %s (apps/%s/app.json)' % (i, i))
        dst = os.path.join(STAGE, 'apps', i)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns('README.md'))
        for name, as_name in LIB.items():
            shutil.copy(os.path.join(ROOT, 'lib', name), os.path.join(dst, as_name))


def main(argv):
    ids, flags, i = [], [], 0
    while i < len(argv):
        a = argv[i]
        if a == '--language' and i + 1 < len(argv):
            flags += argv[i:i + 2]; i += 2; continue
        (flags if a.startswith('-') else ids).append(a); i += 1
    if not ids:
        apps = os.path.join(ROOT, 'apps')
        ids = sorted(d for d in os.listdir(apps) if os.path.isfile(os.path.join(apps, d, 'app.json'))) if os.path.isdir(apps) else []
        if not ids:
            sys.exit('no apps to build')
    stage(ids)
    return subprocess.call([sys.executable, os.path.join(STAGE, 'kit', 'tools', 'build.py')] + flags + ids, cwd=ROOT)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
