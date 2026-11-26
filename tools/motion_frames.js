// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Frames of the motion that must not jump (owner, 2026-11-26 20:16 and 20:17), drawn by the apps' own pages on demo
 * data through the head unit's software path, on a virtual clock stepped at 60 fps:
 *
 *   node tools/motion_frames.js datalog <out-dir> [secs] [every-ms]   Datalog Now from the start: the 60 s charts filling
 *   node tools/motion_frames.js exhaust <out-dir> [secs] [every-ms]   Exhaust Now: the gas and the turbo, rpm hunting at
 *                                                                     idle (a new value 4 times a second), then 3500 rpm
 *
 * Every frame is drawn (60 fps); one PNG is saved each every-ms (default 100) as <out-dir>/NNNN.png.
 * tools/frames_to_gif.py makes a GIF of them. Runs on an older tree too, to compare before and after.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RT = path.join(ROOT, 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));

const START = Date.UTC(2026, 10, 26, 19, 14);
let VT = START;
Date.now = () => VT;
const UI = require('../lib/ui');

const which = process.argv[2], out = path.resolve(process.argv[3] || path.join(ROOT, '.stage', 'motion-' + which));
const secs = Number(process.argv[4]) || 12, every = Number(process.argv[5]) || 100;
fs.mkdirSync(out, { recursive: true });

let draw;
if (which === 'datalog') {
    const APP = path.join(ROOT, 'apps', 'p96_datalog');
    const { Model } = require(path.join(APP, 'model'));
    const P = require(path.join(APP, 'pages'));
    const values = { demo: 'on', demoCar: 'b48' };
    const m = new Model({ settings: { get: (k) => values[k], set: (k, v) => { values[k] = v; } }, demo: () => true });
    let tm = VT;
    draw = (rec) => { while (tm + 50 <= VT) { tm += 50; m.tick(tm); } P.draw(rec, m, (VT - START) / 1000); };
} else if (which === 'exhaust') {
    const APP = path.join(ROOT, 'apps', 'p96_exhaust');
    const VIEW = require(path.join(APP, 'view'));
    const DEMO = require(path.join(APP, 'demo'));
    const M = require(path.join(APP, 'model'));
    const F = require(path.join(APP, 'flap'));
    const control = new F.FlapControl({ link: null, armed: () => false, log: { info() {}, warn() {} } });
    control.setUnits([{ addr: 0x12, el: true }]);
    const V = { page: 0, mode: 'main', side: 'both', ruleFirst: 0, dialog: null, helpSel: 0, values: {} };
    const A = new Proxy({}, { get: () => () => {} });
    draw = (rec) => {
        const t = (VT - START) / 1000, S = DEMO.state(VT, null);
        S.v = DEMO.values(VT, null);
        // the car's rpm: hunting around idle like the owner's photo (621 to 821), a new value 4 times a second,
        // then the revs up to 3500 at 6 s
        const q = Math.floor(t * 4);
        S.v.rpm = t < 6 ? 710 + 90 * Math.sin(q * 2.1) : 3500 + 120 * Math.sin(q * 1.3);
        S.caps = M.ALL_CAPS; S.rules = []; S.active = {}; S.held = {};
        const views = {};
        control.sides().forEach((sd) => { views[sd] = control.view(sd); });
        S.flap = { sides: control.sides(), views: views, decided: {}, mode: 'AUTO', sideMode: {}, armed: false };
        VIEW.draw(rec, S, V, A, t);
    };
} else {
    console.error('node tools/motion_frames.js <datalog|exhaust> <out-dir> [secs] [every-ms]');
    process.exit(2);
}

/*
 * MOTION_STATS=x,y,w,h:lx,ly,lw,lh measures every frame (60 fps) into <out-dir>/stats.csv: in the plot box x,y,w,h the
 * line's leftmost x and its mean y (bright pixels), and whether anything in the label box lx,ly,lw,lh changed since
 * the frame before (the axis numbers being rewritten).
 */
const ST = process.env.MOTION_STATS ? process.env.MOTION_STATS.split(':').map((q) => q.split(',').map(Number)) : null;
const rows = ['ms,left_x,mean_y,labels_changed'];
let prevLab = null;
function measure(cv, ms) {
    const d = cv.d, W = cv.w, P = ST[0], L = ST[1];
    let left = -1, sy = 0, cnt = 0;
    for (let x = P[0]; x < P[0] + P[2]; x++) {
        for (let y = P[1]; y < P[1] + P[3]; y++) {
            const i = (y * W + x) * 4, br = Math.max(d[i], d[i + 1], d[i + 2]);
            if (br > 150) { if (left < 0) left = x; sy += y; cnt++; }
        }
    }
    let lab = '';
    for (let y = L[1]; y < L[1] + L[3]; y++) for (let x = L[0]; x < L[0] + L[2]; x++) lab += d[(y * W + x) * 4] > 90 ? '1' : '0';
    rows.push([Math.round(ms), left, cnt ? (sy / cnt).toFixed(2) : '', prevLab != null && lab !== prevLab ? 1 : 0].join(','));
    prevLab = lab;
}

let n = 0, nextShot = 0;
const FRAME = 1000 / 60;
for (let ms = 0; ms <= secs * 1000; ms += FRAME) {
    VT = START + Math.round(ms);
    const rec = new Recorder(UI.W, UI.H);
    draw(rec);
    const shot = ms >= nextShot;
    if (shot || ST) {
        const cv = new Canvas(UI.W, UI.H);
        play(rec.words(), cv);
        if (ST) measure(cv, ms);
        if (shot) { fs.writeFileSync(path.join(out, ('000' + n++).slice(-4) + '.png'), cv.png(6)); nextShot += every; }
    }
}
if (ST) fs.writeFileSync(path.join(out, 'stats.csv'), rows.join('\n') + '\n');
console.log(which + ': ' + n + ' frames in ' + out);
