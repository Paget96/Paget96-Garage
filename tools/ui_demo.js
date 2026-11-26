'use strict';
/**
 * Draws the Garage UI reference page (docs/design/ui-B-final.png) with lib/ui.js, through the
 * same path the head unit's software fallback uses (record.js Recorder played into canvas.js),
 * and writes docs/design/ui-demo.png, so the library can be checked against the reference.
 * It also times a frame recording, the part the GPU path pays every frame.
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
    UI.ring(cv, 200, 300, 150, { value: 0.72, min: 0, max: 1, text: '1.42', unit: 'bar, target 1.45', label: 'Boost', smooth: false });
    CONTENT.forEach((g, i) => UI.stat(cv, 390 + (i % 3) * 400, 90 + Math.floor(i / 3) * 212, 382, 198, g));
}

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
