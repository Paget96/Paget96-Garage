// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Draws the Paget96 Garage UI reference page (docs/design/ui-B-final.png) with lib/ui.js, through the
 * same path the head unit's software fallback uses (record.js Recorder played into canvas.js),
 * and writes docs/design/ui-demo.png, so the library can be checked against the reference.
 * It also times a frame recording, the part the GPU path pays every frame. Beside it, it draws a
 * card's info popup (<out>-popup.png) and the How to use page (<out>-help.png).
 *
 *   node tools/ui_demo.js [out.png]
 */
const fs = require('fs');
const path = require('path');
const RT = path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));
const UI = require('../lib/ui');

const CONTENT = [
    { label: 'Ambient pressure', value: 1012, unit: 'hPa', sub: 'steady', color: 'dim', history: [1011, 1012, 1012, 1013, 1012, 1012] },
    { label: 'Air temperature', value: 18, unit: '°C', sub: 'cooler than last run', color: 'ok', history: [22, 21, 20, 19, 18, 18] },
    { label: 'Boost', value: 1.42, decimals: 2, unit: 'bar', sub: 'target 1.45', color: 'accent', history: [0.2, 0.6, 1.1, 1.4, 1.42, 1.38] },
    { label: 'Intake temp', value: 34, unit: '°C', sub: '+16 over ambient', color: 'warm', history: [24, 27, 30, 33, 34, 34] },
    { label: 'Engine oil', value: 102, unit: '°C', sub: 'ready', color: 'ok', history: [88, 92, 96, 99, 101, 102] },
    { label: 'Gearbox', value: 78, unit: '°C', sub: 'warming', color: 'warm', history: [60, 65, 70, 74, 77, 78] },
];

function frame(cv) {
    UI.background(cv);
    UI.tabs(cv, ['Now', 'Runs', 'Correction', 'Tyres', 'Boost', 'Temps', 'Log', 'Compare'], 4, { w: 900 });
    UI.title(cv, 'RACE DAY');
    UI.header(cv, { status: 'LIVE', statusColor: 'ok' });
    UI.ring(cv, 200, UI.CONTENT_TOP + (504 - UI.CONTENT_TOP) / 2 + 4, 140, { value: 0.72, min: 0, max: 1, text: '1.42', unit: 'bar, target 1.45', label: 'Boost', smooth: false });
    CONTENT.forEach((g, i) => UI.stat(cv, 390 + (i % 3) * 400, UI.CONTENT_TOP + Math.floor(i / 3) * 203, 382, 189, g));
}

/** The Boost popup's animation: the ring fills and falls back, as boost builds and drops. */
function boostArt(cv, x, y, w, h, t) {
    const v = 0.45 + 0.4 * Math.sin(t * 1.6);
    UI.ring(cv, x + w / 2, y + h / 2 - 10, 140, { value: v, min: 0, max: 1, text: (v * 2).toFixed(2), unit: 'bar', label: 'Boost', smooth: false });
}
const BOOST_INFO = {
    title: 'Boost',
    sections: [
        { head: 'What it is', text: 'How far the turbo pushes the intake air above the air pressure outside, in bar.' },
        { head: 'Where it comes from', text: 'The engine computer reports the charge pressure; the app takes away the ambient pressure.' },
        { head: 'Why it matters', text: 'Boost that stays under its target on a run points at a leak, a hot intake or thin air.' },
        { head: 'Normal values', text: 'Near 0 at idle, up to the target under full load. The target is the small line under the number.' },
    ],
    art: boostArt,
};
const HELP = [
    { title: 'Start a run', text: 'Stop, choose a run on the Runs tab and pull away. The run starts by itself when the car moves.', art: boostArt },
    { title: 'Read the cards', text: 'Every card shows one value, a coloured line under it and its trend on the right. Tap a card to see what it means.' },
    { title: 'Correction', text: 'Times are corrected to standard air, so runs on hot and cold days can be compared.' },
    { title: 'Settings', text: 'The gear opens Settings: renderer, frame rate, follow ambient lighting and demo data.' },
];

function popupFrame(cv) { frame(cv); UI.infoPopup(cv, Object.assign({ since: Date.now() - 600, onClose() {} }, BOOST_INFO)); }
function helpFrame(cv) { UI.helpPage(cv, { topics: HELP, sel: 0, since: Date.now() - 600, onSelect() {}, onClose() {} }); }

const rec = new Recorder(UI.W, UI.H);
frame(rec);                                    // first frame records the cached layers
const N = 200, t0 = process.hrtime();
for (let i = 0; i < N; i++) { rec.reset(); frame(rec); }
const dt = process.hrtime(t0), ms = (dt[0] * 1e3 + dt[1] / 1e6) / N;
const cv = new Canvas(UI.W, UI.H);
play(rec.words(), cv);
const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'design', 'ui-demo.png');
fs.writeFileSync(out, cv.png(9));
console.log('%s: one frame records in %s ms (%d words)', out, ms.toFixed(3), rec.words().length);

[['popup', popupFrame], ['help', helpFrame]].forEach((d) => {
    const r = new Recorder(UI.W, UI.H);
    d[1](r);
    if (d[0] === 'popup' && r.targets.length !== 2) throw new Error('the popup must leave only its own two targets, has ' + r.targets.length);
    const c = new Canvas(UI.W, UI.H);
    play(r.words(), c);
    const o = out.replace(/\.png$/, '') + '-' + d[0] + '.png';
    fs.writeFileSync(o, c.png(9));
    console.log('%s: %d words, %d targets', o, r.words().length, r.targets.length);
});
