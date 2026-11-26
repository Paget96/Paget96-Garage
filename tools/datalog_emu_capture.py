#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
"""Screenshots and a video of Datalog running in the upstream emulator (the car's own draw engine, kit/renderd's
gfx.c as WebAssembly, drawn by Chrome), for docs/media/p96_datalog/.

Set up once: an idrive7-apps checkout at the vendored commit (upstream-kit/UPSTREAM.json) gives kit/tools/emu.js and
kit/emu/web. Then:

    python3 tools/datalog_emu_capture.py setup <idrive7-apps checkout> <emu dir>    # copies kit, app, lib/*.js
    node <emu dir>/kit/tools/emu.js p96_datalog --port 8099                          # in another shell
    python3 tools/datalog_emu_capture.py shots <out dir>                             # every page and popup
    python3 tools/datalog_emu_capture.py video <out dir> '<plan json>'               # video.webm, ffmpeg makes the GIF

Needs Python Playwright and Chrome (WebGL 2 through SwiftShader works headless). The emulator's build wants an oap-sdk/
folder; setup puts a stub there (the emulator's stubbed head unit never loads it). Demo data: set it to On in the
emulator's panel once (it is saved with the emulator's settings).
"""
import asyncio, json, os, shutil, subprocess, sys
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PORT = int(os.environ.get('EMU_PORT', '8099'))   # another port when 8099 is taken (EMU_PORT=8111)
# where each tab is, per selected page, from the app's own drawing (the tab bar scrolls with the selection)
TABMAP_JS = r"""
let VT = Date.now(); Date.now = () => VT;
const R = process.argv[1];
const { Recorder } = require(R + '/upstream-kit/kit/runtime/record');
const { Model } = require(R + '/apps/p96_datalog/model'); const P = require(R + '/apps/p96_datalog/pages');
const vals = { demo: 'on' }; const m = new Model({ settings: { get: (k) => vals[k], set: (k, v) => { vals[k] = v; } }, demo: () => true });
for (let i = 0; i < 40; i++) { VT += 50; m.tick(VT); }
const out = {};
for (const pg of P.TABS) {
    m.ui.page = pg; VT += 2000; let r;
    for (let k = 0; k < 3; k++) { r = new Recorder(1600, 520, { textScale: 1.164 }); P.draw(r, m, 1); }
    out[pg] = {};
    r.targets.forEach((q) => {
        if (/^p96tab\d/.test(q.key)) out[pg][P.TABS[+q.key.slice(6)]] = [q.x + q.w / 2, q.y + q.h / 2];
        if (/^p96info/.test(q.key)) (out[pg].info = out[pg].info || []).push([q.key, q.x + q.w / 2, q.y + q.h / 2]);
        if (q.key === 'p96help' || q.key === 'p96settings') out[pg][q.key] = [q.x + q.w / 2, q.y + q.h / 2];
    });
}
console.log(JSON.stringify(out));
"""


def setup(upstream, emu):
    if os.path.exists(emu):
        shutil.rmtree(emu)
    os.makedirs(os.path.join(emu, 'apps'))
    shutil.copytree(os.path.join(upstream, 'kit'), os.path.join(emu, 'kit'))
    app = os.path.join(emu, 'apps', 'p96_datalog')
    shutil.copytree(os.path.join(ROOT, 'apps', 'p96_datalog'), app, ignore=shutil.ignore_patterns('README.md'))
    for name in ('ui', 'engine', 'render', 'qr', 'report'):          # lib/*.js as tools/build.py ships them (LIB)
        shutil.copy(os.path.join(ROOT, 'lib', name + '.js'), os.path.join(app, 'garage_' + name + '.js'))
    shutil.copy(os.path.join(ROOT, 'lib', 'cartime.js'), os.path.join(app, 'garage_time.js'))
    os.makedirs(os.path.join(emu, 'oap-sdk'))
    open(os.path.join(emu, 'oap-sdk', 'index.js'), 'w').write('module.exports = {};\n')
    open(os.path.join(emu, 'oap-sdk', 'package.json'), 'w').write('{"name": "oap-sdk", "version": "0.0.0"}\n')


if __name__ == '__main__':
    if len(sys.argv) >= 4 and sys.argv[1] == 'setup':
        setup(sys.argv[2], sys.argv[3])
        sys.exit(0)
    MODE, OUT = sys.argv[1], sys.argv[2]
    PLAN = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
    TM = json.loads(subprocess.check_output(['node', '-e', TABMAP_JS, ROOT]))
    OX, OY, S = 71, 75, 1.164
    K = 1888 / 1920
    def cl(ax, ay): return (16 + (OX + ax * S) * K, 16 + (OY + ay * S) * K)
    CLIP = {'x': 16, 'y': 16, 'width': 1888, 'height': 708}
    os.makedirs(OUT, exist_ok=True)
    async def main():
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            pg = await b.new_page(viewport={'width': 1920, 'height': 1300})
            await pg.goto('http://127.0.0.1:%d/' % PORT + '?panel=bottom')
            await pg.wait_for_timeout(3000)
            await pg.click('button:has-text("Restart")')
            await pg.wait_for_timeout(9000)
            cur = 'Now'
            async def tap(ax, ay, wait=1500):
                x, y = cl(ax, ay); await pg.mouse.click(x, y); await pg.wait_for_timeout(wait)
            async def shot(name):
                await pg.screenshot(path=os.path.join(OUT, name + '.png'), clip=CLIP)
            mode = MODE
            if mode == 'shots':
                for page in ['Now', 'Runs', 'Dyno', 'Correction', 'Tyres', 'Boost', 'Temps', 'Log', 'Compare']:
                    if page != cur:
                        await tap(*TM[cur][page]); cur = page
                    await pg.wait_for_timeout(1200)
                    await shot(page.lower())
                    if page == 'Log':
                        await tap(900, 253, 1800); await shot('log-run')
                        await tap(1070, 480, 1200)
                    if page == 'Boost':
                        await tap(*TM['Boost']['info'][0][1:], 2600); await shot('popup-boost')
                        await tap(1410, 80, 900)
                        # the wastegate card (the fifth card): its animation, caught while the flap is part open
                        await tap(*TM['Boost']['info'][4][1:], 1200)
                        for k in range(12):
                            await shot('popup-wastegate-%d' % k); await pg.wait_for_timeout(750)
                        await tap(1410, 80, 900)
                    if page == 'Correction':
                        await tap(*TM['Correction']['info'][2][1:], 1800); await shot('popup-charge')
                        await tap(1410, 80, 900)
                    if page == 'Dyno':
                        await tap(*TM['Dyno']['info'][0][1:], 3500); await shot('popup-dyno')
                        await tap(1410, 80, 900)
                await tap(*TM[cur]['p96help'], 2500); await shot('help')
                await tap(*TM[cur]['p96settings'], 1500); await shot('settings')
                await tap(330, 50, 1000)
            else:
                # a video of the screen canvas while the pages are walked through
                await pg.evaluate("""() => { const c = document.getElementById('screen'); const st = c.captureStream(30);
                    window._chunks = []; const r = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
                    r.ondataavailable = (e) => window._chunks.push(e.data); r.start(500); window._rec = r; }""")
                plan = PLAN
                for step in plan:
                    if step[0] == 'tab':
                        await tap(*TM[cur][step[1]], step[2]); cur = step[1]
                    elif step[0] == 'info':
                        await tap(*TM[cur]['info'][step[1]][1:], step[2])
                    elif step[0] == 'close':
                        await tap(1410, 80, step[1])
                    elif step[0] == 'wait':
                        await pg.wait_for_timeout(step[1])
                    elif step[0] == 'xy':
                        await tap(step[1], step[2], step[3])
                data = await pg.evaluate("""() => new Promise((res) => { window._rec.onstop = async () => {
                    const b = new Blob(window._chunks, { type: 'video/webm' }); const buf = new Uint8Array(await b.arrayBuffer());
                    let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); res(btoa(s)); };
                    window._rec.stop(); })""")
                import base64
                open(os.path.join(OUT, 'video.webm'), 'wb').write(base64.b64decode(data))
            await b.close()
    asyncio.run(main())
