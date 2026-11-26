// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog's screenshots: runs the demo drive through the model (four runs, then a fifth one under way),
 * draws every page through the head unit's software path (record.js Recorder played into canvas.js)
 * and writes them to docs/media/p96_datalog/, with a short GIF of the pages (Python with PIL).
 *
 *   node tools/datalog_shots.js [out-dir]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const RT = path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));
const UI = require('../lib/ui');
const { Model, Demo } = require('../apps/p96_datalog/model');
const P = require('../apps/p96_datalog/pages');

const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'media', 'p96_datalog');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });   // Node 8 throws EEXIST despite recursive

// the demo drive on a simulated clock, 20 samples a second
const T0 = Date.UTC(2026, 10, 26, 16, 0, 0);
const m = new Model({ runLength: 402, t: T0 }), demo = new Demo(T0);
let now = T0;
function drive(toSec) {
    for (; now <= T0 + toSec * 1000; now += 50) { demo.feed(m, now); m.tick(now); }
}
const settings = Object.assign({}, P.DEFAULTS);
const st = { page: 'main', tab: 0, topic: 0, settings: settings, status: 'DEMO', statusColor: 'info', now: 0 };
const act = { tab() {}, help() {}, settings() {}, back() {}, topic() {}, set() {}, compare() {} };

function frame(t) {
    const rec = new Recorder(UI.W, UI.H);
    st.now = now;
    P.draw(rec, m, st, t, act);
    const cv = new Canvas(UI.W, UI.H);
    play(rec.words(), cv);
    return { rec: rec, png: cv.png(9) };
}

drive(4 * 36 + 4 + 7.5);           // four runs saved, the fifth 7.5 s into its run
m.compareWith = 3;
const shots = [];
P.TABS.forEach((name, i) => { st.tab = i; shots.push([name.toLowerCase(), 'main', i]); });
shots.push(['help', 'help', 0], ['settings', 'settings', 0], ['popup', 'popup', 0]);
const files = [];
shots.forEach((s) => {
    st.page = s[1] === 'popup' ? 'main' : s[1]; st.tab = s[1] === 'popup' ? 0 : s[2];
    let r;
    if (s[1] === 'popup') {
        const rec = new Recorder(UI.W, UI.H);
        P.draw(rec, m, st, 0.6, act);
        UI.infoPopup(rec, P.INFO.boost, 2.4);
        const cv = new Canvas(UI.W, UI.H);
        play(rec.words(), cv);
        r = { rec: rec, png: cv.png(9) };
    } else r = frame(s[1] === 'help' ? 2.2 : 0);
    const f = path.join(out, s[0] + '.png');
    fs.writeFileSync(f, r.png);
    files.push(f);
    if (s[1] === 'main' && !r.rec.targets.some((q) => q.key === 'p96tab0')) throw new Error(s[0] + ': no tab targets');
});

// the GIF: every page for a moment while the drive goes on, frames at 960 px
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlshots-'));
let k = 0;
const order = [0, 3, 1, 2, 4, 5, 6, 7];
order.forEach((tab) => {
    st.page = 'main'; st.tab = tab;
    for (let i = 0; i < 6; i++) {
        drive((now - T0) / 1000 + 0.25);
        fs.writeFileSync(path.join(tmp, ('000' + k++).slice(-4) + '.png'), frame(i * 0.25).png);
    }
});
st.page = 'help';
for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(tmp, ('000' + k++).slice(-4) + '.png'), frame(i * 0.25).png);
const gif = path.join(out, 'datalog.gif');
const py = [
    'import sys, os', 'from PIL import Image',
    'd, out = sys.argv[1], sys.argv[2]',
    'fr = [Image.open(os.path.join(d, n)).convert("RGB").resize((960, 312), Image.LANCZOS) for n in sorted(os.listdir(d))]',
    'pal = [f.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.NONE) for f in fr]',
    'pal[0].save(out, save_all=True, append_images=pal[1:], duration=250, loop=0, optimize=True)',
].join('\n');
execFileSync(process.env.PYTHON || 'python', ['-c', py, tmp, gif], { stdio: 'inherit', timeout: 120000 });
fs.readdirSync(tmp).forEach((n) => fs.unlinkSync(path.join(tmp, n)));
fs.rmdirSync(tmp);
const size = fs.statSync(gif).size;
if (size > 3 * 1024 * 1024) throw new Error('datalog.gif is ' + (size >> 10) + ' KiB, over 3 MB');
console.log('%s: %d pages and datalog.gif (%d frames, %d KiB); %d runs in the demo', out, files.length, k, size >> 10, m.runs.length);
