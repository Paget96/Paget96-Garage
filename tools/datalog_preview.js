// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Draws Datalog (apps/p96_datalog) on demo data through the head unit's software path (record.js Recorder played
 * into canvas.js), on a clock of its own, so the pages, the popups and the motion come out the same every time:
 *
 *   <out>/<page>.png                       every page, the info popups, How to use, Settings (default .stage/datalog-preview)
 *   <frames>/<gif>/NNNN.png               the frames of the GIFs (tools/make_gif.py turns them into GIFs)
 *
 *   node tools/datalog_preview.js [media dir] [frames dir]
 *
 * Every frame is drawn the way the app draws it (pages.js draw()); the clock only moves the demo and the glides. It also
 * fails when an info text is too long for its popup. The README media come from the emulator (datalog_emu_capture.py).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RT = path.join(ROOT, 'upstream-kit', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));

// the clock: every Date.now() in the app, the kit and lib/ui.js reads this
const START = new Date(2026, 10, 26, 18, 40, 0).getTime();
let VT = START;
Date.now = () => VT;

const UI = require('../lib/ui');
// GARAGE_LAYOUT=standard: the pages as the Standard layout draws them (the car's own title and clock above them)
if (process.env.GARAGE_LAYOUT) UI.setLayout(process.env.GARAGE_LAYOUT);
const APP = path.join(ROOT, 'apps', 'p96_datalog');
const { Model } = require(path.join(APP, 'model'));
const P = require(path.join(APP, 'pages'));
const { INFO } = require(path.join(APP, 'info'));

// --car <id>: the pages of one demo car of lib/engine.js (the compatibility gallery), no GIF frames
let argv = process.argv.slice(2), CAR = null;
if (argv[0] === '--car') { CAR = argv[1]; argv = argv.slice(2); }
const media = path.resolve(argv[0] || path.join(ROOT, '.stage', 'datalog-preview'));
const framesDir = path.resolve(argv[1] || path.join(ROOT, '.stage', 'datalog-frames'));
fs.mkdirSync(media, { recursive: true });

const values = { demo: 'on', demoCar: CAR || 'b48' };
const settings = { get: (k) => values[k], set: (k, v) => { values[k] = v; } };
const m = new Model({ settings, demo: () => true });
// the side menu in the car frame (tools/carframe.js preloaded)
if (global.CF) global.CF.tabs = () => { const t = P.tabsFor(m); return [t, t.indexOf(m.ui.page), m.ui.view]; };
// Settings, Send a report: the flow as the app makes it (lib/report.js), on the app's own app.json
m.report = new (require('../lib/report').Flow)(() => ({ spec: require('../apps/p96_datalog/app.json'), get: () => undefined }));

/** Move the clock by ms, stepping the model every 50 ms as the app does. */
function run(ms) { const end = VT + ms; while (VT < end) { VT += 50; m.tick(VT); } }
/** Draw one frame now into a Canvas. */
function frame() {
    const rec = new Recorder(UI.W, UI.H);
    P.draw(rec, m, (VT - START) / 1000);
    const cv = new Canvas(UI.W, UI.H);
    play(rec.words(), cv);
    return { cv, rec };
}
/** Let the glides settle (frames at 60 fps for ms), then save a PNG. */
function shot(name, settle) {
    const end = VT + (settle == null ? 600 : settle);
    while (VT < end) { VT += 16; m.tick(VT); frame(); }
    const f = frame();
    fs.writeFileSync(path.join(media, name + '.png'), f.cv.png(9));
    return f.rec;
}
/** Press the target named key in the frame now (as a tap would). */
function press(key) {
    const rec = new Recorder(UI.W, UI.H);
    P.draw(rec, m, (VT - START) / 1000);
    const q = rec.targets.filter((x) => x.key === key)[0];
    if (!q) throw new Error('no target ' + key + ' (have ' + rec.targets.map((x) => x.key).join(', ') + ')');
    q.run();
}

/* ---------- every info text fits its popup (lib/ui.js popupPanel: text from y 138, the note ends at 346) ---------- */

{
    const rec = new Recorder(UI.W, UI.H), tw = 1300 - 690 - 40, long = [];
    Object.keys(INFO).forEach((k) => {
        const inf = INFO[k], head = UI.wrap(rec, inf.title || '', 26, tw - 50, 'bold').length;
        const body = UI.wrap(rec, inf.text || '', 17, tw).length, note = inf.note ? UI.wrap(rec, inf.note, 16, tw - 170).length : 0;
        const textEnd = 138 + (head - 1) * 32 + (body - 1) * 27, noteTop = 346 - (note - 1) * 24 - 18;
        if (textEnd + 6 > noteTop) long.push(k + ' (' + body + ' lines, ' + Math.round(textEnd - noteTop + 6) + ' px too long)');
    });
    if (long.length) throw new Error('info text too long for its popup: ' + long.join(', '));
}

/* ---------- screenshots ---------- */

run(5 * 60000);                         // five minutes of demo: a few runs, warm fluids, ten minutes of nothing yet
// wait for the moment a run has just ended and the car stands again
while (m.log().state !== 'ready') run(250);
if (CAR) {
    const tabs = P.tabsFor(m), shots = [];
    tabs.forEach((tab) => { m.ui.page = tab; shot(tab.toLowerCase()); shots.push(tab.toLowerCase()); });
    if (tabs.indexOf('Boost') >= 0) {
        m.ui.page = 'Boost'; UI.openInfo(INFO.boost); shot('popup-boost', 3200); UI.closeInfo(); run(400); shots.push('popup-boost');
        if (m.has('wastegate')) { UI.openInfo(INFO.wastegate); shot('popup-wastegate', ((5.5 - ((VT - START) / 1000) % 9) + 18) % 9 * 1000); UI.closeInfo(); shots.push('popup-wastegate'); }
    }
    m.ui.view = 'settings'; shot('settings'); shots.push('settings');
    console.log(CAR + ': ' + shots.length + ' pictures in ' + media + ' (' + shots.join(', ') + ')');
    process.exit(0);
}
const pages = P.TABS.map((x) => x.toLowerCase());
const page = (name) => P.TABS[pages.indexOf(name)];
pages.forEach((name) => { m.ui.page = page(name); shot(name); });
// a run opened in the Log
m.ui.page = page('log');
const ses = require(path.join(APP, 'maths')).sessions(m.log().runs);
m.ui.logSession = 0; m.ui.logRun = ses[0].runs[1].at;
shot('log-run');
m.ui.logRun = null;
// the info popups
[['boost', 'boost', 'popup-boost', 3200], ['charge', 'correction', 'popup-charge', 900], ['correction', 'correction', 'popup-correction', 2200],
    ['tyresNow', 'tyres', 'popup-tyres', 2600], ['run', 'now', 'popup-run', 2500], ['dyno', 'dyno', 'popup-dyno', 4800], ['wastegate', 'boost', 'popup-wastegate', 4700]].forEach((p) => {
    // (the wastegate popup is caught at the target, its flap part open: 5.5 s into its 9 s cycle)
    const settle = p[0] === 'wastegate' ? ((5.5 - ((VT - START) / 1000) % 9) + 18) % 9 * 1000 : p[3];
    m.ui.page = page(p[1]); UI.openInfo(INFO[p[0]]); shot(p[2], settle); UI.closeInfo(); run(400);
});
// How to use and Settings
m.ui.view = 'help'; m.ui.topic = 0; shot('help', 2600);
m.ui.topic = 4; shot('help-boost', 3000);
m.ui.view = 'settings'; shot('settings');
m.ui.view = 'main'; m.ui.page = 'Now';

/* ---------- GIF frames ---------- */

function frames(name, fps, ms, script) {
    const dir = path.join(framesDir, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const step = 1000 / fps, n = Math.round(ms / step);
    let k = 0;
    for (let i = 0; i < n; i++) {
        if (script) script(i * step);
        // 60 fps between the frames kept, so the motion is what the car shows
        const end = VT + step;
        while (VT < end) { VT += 16; m.tick(VT); }
        fs.writeFileSync(path.join(dir, String(k++).padStart(4, '0') + '.png'), frame().cv.png(1));
    }
    return n;
}
// the walk through: a run from READY on the Runs page, then the other pages
while (m.log().state !== 'ready') run(250);
m.ui.page = 'Runs';
const go = (name) => () => { m.ui.page = page(name); };
const plan = [[0, go('now')], [3500, go('runs')], [17500, go('dyno')], [20000, go('correction')], [22500, go('boost')],
    [25000, () => { UI.openInfo(INFO.boost); }], [30000, () => { UI.closeInfo(); }], [30600, go('tyres')], [33000, go('temps')],
    [35500, go('log')], [38000, go('compare')]];
let next = 0;
const nDemo = frames('demo', 10, 41000, (ms) => { while (next < plan.length && plan[next][0] <= ms) { plan[next][1](); next++; } });
m.ui.page = page('boost');
UI.openInfo(INFO.boost);
const nPop = frames('popup-boost', 12, 8000);
UI.closeInfo(); run(400);
m.ui.view = 'help'; m.ui.topic = 0;
const nHelp = frames('help', 12, 10000, (ms) => { m.ui.topic = Math.min(7, Math.floor(ms / 1250)); });
m.ui.view = 'main';
console.log('%s: %d screenshots; frames in %s (demo %d, popup-boost %d, help %d)', media, pages.length + 10, framesDir, nDemo, nPop, nHelp);
