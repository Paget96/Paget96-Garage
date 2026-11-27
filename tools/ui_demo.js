// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Draws the Paget96 Garage UI reference pages with lib/ui.js, through the same path the head unit's
 * software fallback uses (record.js Recorder played into canvas.js), so the library can be checked
 * against the reference pictures:
 *
 *   docs/design/ui-demo.png           the main page: tabs, header, ring with scale and target, stat cards
 *   docs/design/ui-demo-chart.png     stat strips with their range and a chart card with axes and a legend
 *   docs/design/ui-demo-popup.png     the info popup a card opens
 *   docs/design/ui-demo-help.png      the How to use page
 *   docs/design/ui-demo-settings.png  the Settings page with the Display block
 *
 * It also times a frame recording of the main page, the part the GPU path pays every frame.
 *
 *   node tools/ui_demo.js [out-dir]
 */
const fs = require('fs');
const path = require('path');
const RT = path.join(__dirname, '..', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));
const UI = require('../lib/ui');
// GARAGE_LAYOUT=standard: the pages as the Standard layout draws them (the car's own title and clock above them)
if (process.env.GARAGE_LAYOUT) UI.setLayout(process.env.GARAGE_LAYOUT);
const C = UI.C;

/* ---------- illustrations (an app passes its own as info.draw / topic.draw) ---------- */

/** Air path: filter, turbo, intercooler, throttle, engine, with the air moving through and changing colour. */
function airPath(cv, x, y, w, h, t) {
    const cy = y + h / 2 - 10, x0 = x + 70, x1 = x + w - 70, grey = '#969ea8', dimLine = '#6e7480';
    cv.line(x0, cy, x1 - 40, cy, 26, '#30343c');
    const at = (f) => x0 + (x1 - x0) * f;
    // filter
    cv.strokeRoundRect(at(0.1) - 25, cy - 35, 50, 70, 10, 3, grey);
    for (let k = 0; k < 4; k++) cv.line(at(0.1) - 17 + k * 11, cy - 28, at(0.1) - 17 + k * 11, cy + 28, 2, dimLine);
    // turbo, spinning
    cv.arc(at(0.33), cy, 36, 39, 0, 360, grey);
    for (let k = 0; k < 5; k++) {
        const a = t * 12 + k * 1.2566;
        cv.line(at(0.33), cy, at(0.33) + 26 * Math.cos(a), cy + 26 * Math.sin(a), 3, grey);
    }
    // intercooler
    cv.strokeRoundRect(at(0.56) - 35, cy - 45, 70, 90, 10, 3, grey);
    for (let k = 0; k < 6; k++) cv.line(at(0.56) - 29, cy - 36 + k * 14, at(0.56) + 29, cy - 36 + k * 14, 2, '#5a8cc8');
    // throttle
    cv.line(at(0.75), cy - 18, at(0.75), cy + 18, 4, grey);
    cv.circle(at(0.75), cy, 6, grey);
    // engine
    cv.strokeRoundRect(at(0.93) - 40, cy - 45, 80, 90, 14, 3, grey);
    cv.arc(at(0.93) - 16, cy - 14, 8, 10, 0, 360, dimLine); cv.arc(at(0.93) + 16, cy - 14, 8, 10, 0, 360, dimLine);
    // the air: cool before the turbo, hot after it, cooler after the intercooler
    for (let i = 0; i < 14; i++) {
        const f = (t * 0.6 + i / 14) % 1, px = x0 + f * (at(0.9) - x0);
        const c = px < at(0.33) ? C.blue : px < at(0.56) ? '#ff6e3c' : '#d2c896';
        cv.circle(px, cy, 5, c);
    }
    // sensors: intake (green) and charge air (amber, pulsing)
    const pulse = 0.5 + 0.5 * Math.sin(t * 12.56);
    [[at(0.2), C.green, 'intake', false], [at(0.66), C.amber, 'charge air', true]].forEach((s) => {
        if (s[3]) cv.circle(s[0], cy - 40, 12 + 8 * pulse, [255, 186, 70, Math.round(40 + 90 * (1 - pulse))]);
        cv.line(s[0], cy - 28, s[0], cy - 12, 3, s[1]);
        cv.circle(s[0], cy - 40, 8, s[1]);
        cv.text(s[2], s[0], cy - 60, 14, s[1], { font: 'bold', align: 'center', literal: true });
    });
    [[0.1, 'filter'], [0.33, 'turbo'], [0.56, 'intercooler'], [0.75, 'throttle'], [0.93, 'engine']].forEach((p) =>
        cv.text(p[1], at(p[0]), cy + 72, 13, C.dim, { align: 'center', literal: true }));
    cv.text('air in', x0 - 10, cy - 20, 13, C.blue, { align: 'center', literal: true });
}

/** A 402 m run: the timer counts, the car accelerates along a scale. */
function runIllustration(cv, x, y, w, h, t) {
    const p = (t % 4) / 4, ph = Math.max(0, (p - 0.2) / 0.8), pos = ph * ph;
    const tx0 = x + 42, tx1 = x + w - 46, ty = y + h - 86;
    cv.line(tx0, ty, tx1, ty, 4, '#30343c');
    ['0', '100 m', '201 m', '300 m', '402 m'].forEach((l, k) => {
        const lx = tx0 + (tx1 - tx0) * k / 4;
        cv.line(lx, ty - 8, lx, ty + 8, 2, '#5a606a');
        cv.text(l, lx, ty + 30, 13, C.dim, { align: 'center', literal: true });
    });
    const cx = tx0 + (tx1 - tx0) * pos, by = ty - 36;
    cv.roundRect(cx - 34, by + 4, 68, 26, 12, '#969ea8');
    cv.roundRect(cx - 18, by - 12, 34, 20, 8, '#78808c');
    [cx - 20, cx + 20].forEach((wx) => { cv.circle(wx, by + 31, 9, '#969ea8'); cv.circle(wx, by + 31, 7, '#1e2026'); });
    if (ph > 0) for (let k = 0; k < 3; k++) cv.line(cx - 44 - k * 14, by + 12 + k * 6, cx - 58 - k * 14, by + 12 + k * 6, 3, C.orange);
    const state = p < 0.2 ? 'READY' : ph < 1 ? 'RUNNING' : 'DONE';
    cv.text((12.84 * ph).toFixed(2) + ' s', x + w / 2, y + 80, 64, C.text, { font: 'num', align: 'center', literal: true });
    cv.text(state, x + w / 2, y + 120, 18, p < 0.2 ? C.green : C.orange, { font: 'bold', align: 'center', literal: true });
    cv.text(Math.round(172.4 * Math.pow(ph, 0.6)) + ' km/h', x + w / 2, y + 152, 20, C.dim, { align: 'center', literal: true });
}

/* ---------- pages ---------- */

const CHARGE_AIR = {
    label: 'Charge air', title: 'The air that goes into the engine', draw: airPath,
    text: 'Measured in the intake tract after the intercooler, just before the throttle. The turbo heats the air when it compresses it; the intercooler cools it down again.\n\n' +
        'Cooler air holds more oxygen, so the engine makes more power. When it climbs run after run, the intercooler is heat soaked: wait a minute before the next run.',
    note: 'Normal: 10 to 25 °C above the outside air under load.',
};
const CONTENT = [
    { label: 'Ambient pressure', value: 1012, unit: 'hPa', sub: 'steady', color: 'dim', history: [1011, 1012, 1012, 1013, 1012, 1012] },
    { label: 'Air temperature', value: 18, unit: '°C', sub: 'cooler than last run', color: 'ok', history: [22, 21, 20, 19, 18, 18] },
    { label: 'Boost', value: 1.42, decimals: 2, unit: 'bar', sub: 'target 1.45', color: 'accent', history: [0.2, 0.6, 1.1, 1.4, 1.42, 1.38] },
    { label: 'Charge air', value: 34, unit: '°C', sub: '+16 over ambient', color: 'warm', history: [24, 27, 30, 33, 34, 34], info: CHARGE_AIR },
    { label: 'Engine oil', value: 102, unit: '°C', sub: 'ready', color: 'ok', history: [88, 92, 96, 99, 101, 102] },
    { label: 'Gearbox', value: 78, unit: '°C', sub: 'warming', color: 'warm', history: [60, 65, 70, 74, 77, 78] },
];
CONTENT.forEach((g) => { if (!g.info) g.info = { label: g.label, title: g.label, text: 'What this value shows.' }; });
const TABS = ['Now', 'Runs', 'Correction', 'Tyres', 'Boost', 'Temps', 'Log'];

function head(cv, sel) {
    UI.background(cv);
    UI.tabs(cv, TABS, sel, { w: 900, onSelect: () => {} });
    UI.title(cv, 'RACE DAY');
    // sample values: Demo data On, so the DEMO pill sits where LIVE does and every card says DEMO (D26)
    UI.header(cv, { status: 'LIVE', statusColor: 'ok', demo: true, onDemo: () => {}, onHelp: () => {}, onSettings: () => {} });
}
function mainPage(cv) {
    head(cv, 4);
    UI.ring(cv, 196, UI.CONTENT_TOP + 196, 118, { value: 1.42, min: 0, max: 2, decimals: 2, unit: 'bar', label: 'Boost',
        scale: { step: 0.5, decimals: 1 }, target: 1.45, smooth: false, info: CONTENT[2].info });
    CONTENT.forEach((g, i) => UI.stat(cv, 390 + (i % 3) * 400, UI.CONTENT_TOP + Math.floor(i / 3) * 203, 382, 189, g));
}
function chartPage(cv) {
    head(cv, 4);
    const T = UI.CONTENT_TOP, cw = 374;
    UI.stat(cv, 28, T, cw, 180, { label: 'Boost', value: 1.42, decimals: 2, unit: 'bar', sub: 'manifold minus outside', color: 'accent', history: [-0.5, 0.1, 0.9, 1.35, 1.42, 1.4], info: {} });
    UI.stat(cv, 28 + (cw + 14), T, cw, 180, { label: 'Manifold pressure', value: 2.43, decimals: 2, unit: 'bar abs', sub: 'what the engine gets', color: C.text, history: [0.5, 1.1, 1.9, 2.36, 2.43, 2.41], info: {} });
    UI.stat(cv, 28 + 2 * (cw + 14), T, cw, 180, { label: 'Outside pressure', value: 1.01, decimals: 2, unit: 'bar abs', sub: 'weather and altitude', color: 'info', history: [1.01, 1.01, 1.01, 1.01, 1.01, 1.01], info: {} });
    UI.stat(cv, 28 + 3 * (cw + 14), T, 1572 - (28 + 3 * (cw + 14)), 180, { label: 'Engine oil', value: 104, unit: '°C', sub: 'ready', color: 'ok', history: [88, 92, 96, 99, 101, 104], info: {} });
    const t = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    UI.chart(cv, 28, T + 194, 1544, 198, [
        { name: 'manifold (abs)', color: C.text, values: t.map((s) => 0.45 + 1.95 / (1 + Math.exp(-(s - 3.2) * 1.1))) },
        { name: 'outside (abs)', color: 'info', values: t.map(() => 1.01) },
        { name: 'boost', color: 'accent', values: t.map((s) => -0.56 + 1.95 / (1 + Math.exp(-(s - 3.2) * 1.1))) },
    ], { label: 'Pressure over the last run', yTicks: 4, yUnit: 'bar', xLabels: ['0 s', '2 s', '4 s', '6 s', '8 s', '10 s', '12 s'], legend: 'right',
        note: 'boost = manifold minus outside', info: {}, fill: false });
}
function popupPage(cv, t) {
    mainPage(cv);
    UI.infoPopup(cv, CHARGE_AIR, t);
}
const TOPICS = [
    { title: 'Start a 402 m run', draw: runIllustration, note: 'Only on closed roads. Never in traffic.',
        text: 'Stop the car on a closed road or strip. Race Day shows READY when the car is standing still and the engine is warm.\n\n' +
            'Go full throttle. The time starts the moment the car moves, so your reaction is shown on its own and not counted.\n\n' +
            'At 402 m the run is saved with the air, tyre and temperature readings of that run.' },
    { title: 'Read the result', text: 'x' }, { title: 'Air correction', text: 'x' }, { title: 'Tyres and temps', text: 'x' },
    { title: 'Compare two runs', text: 'x' }, { title: 'What the car must report', text: 'x' },
];
function helpPage(cv, t) {
    UI.howToUse(cv, TOPICS, 0, t, { title: 'RACE DAY', onSelect: () => {}, onBack: () => {}, onSettings: () => {} });
}
const APP_ROWS = [
    { key: 'runLength', label: 'Run length', hint: 'The distance a run is timed over', type: 'choice', default: 402, options: [[201, '201 m'], [402, '402 m'], [804, '1/2 mile']] },
    { key: 'boostTarget', label: 'Boost target', hint: 'The mark on the boost ring', type: 'number', default: 1.45, min: 0.5, max: 3, step: 0.05, decimals: 2, unit: 'bar' },
    { key: 'tyreTarget', label: 'Tyre target (hot)', hint: 'Tyres page compares with it', type: 'number', default: 2.4, min: 1.5, max: 3.5, step: 0.05, decimals: 2, unit: 'bar' },
    { key: 'units', label: 'Units', hint: 'Speed, pressure and temperature', type: 'choice', default: 'metric', options: [['metric', 'Metric'], ['imperial', 'Imperial']] },
];
function settingsPage(cv) {
    UI.settingsPage(cv, APP_ROWS, { demo: 'on' }, () => {}, { title: 'RACE DAY', appLabel: 'Race Day', onBack: () => {}, onHelp: () => {}, onReport: () => {} });
}

function render(draw, file, t) {
    const rec = UI.zoom(new Recorder(UI.RW, UI.RH));
    draw(rec, t || 0);
    const cv = new Canvas(UI.RW, UI.RH);
    play(rec.words(), cv);
    fs.writeFileSync(file, cv.png(9));
    return rec;
}

const dir = process.argv[2] || path.join(__dirname, '..', 'docs', 'design');
render(mainPage, path.join(dir, 'ui-demo.png'));
render(chartPage, path.join(dir, 'ui-demo-chart.png'));
const pRec = render(popupPage, path.join(dir, 'ui-demo-popup.png'), 0.3);
if (pRec.targets.map((q) => q.key).join(',') !== 'p96popx,p96popok') throw new Error('popup: the page under it can still be pressed');
render(helpPage, path.join(dir, 'ui-demo-help.png'), 2.6);
const sRec = render(settingsPage, path.join(dir, 'ui-demo-settings.png'));
if (sRec.targets.length < 20) throw new Error('settings page: expected a target per control, got ' + sRec.targets.length);

// time a frame of the main page (the cached layers were recorded by the first frame)
const rec = UI.zoom(new Recorder(UI.RW, UI.RH));
mainPage(rec);
const N = 200, t0 = process.hrtime();
for (let i = 0; i < N; i++) { rec.reset(); mainPage(rec); }
const dt = process.hrtime(t0), ms = (dt[0] * 1e3 + dt[1] / 1e6) / N;
console.log('%s: 5 pages drawn; the main page records in %s ms (%d words, %d targets)', dir, ms.toFixed(3), rec.words().length, rec.targets.length);
