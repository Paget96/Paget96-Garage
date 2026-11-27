// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Standby's screenshots: the demo values on a cold evening, every page drawn through the head unit's software path
 * (record.js Recorder played into canvas.js), written to docs/media/p96_standby/, and a GIF of the app working: the
 * menu fading out, a minute passing, the night colour coming, then Glance, Last drive and How to use
 * (tools/frames_to_gif.py, Pillow).
 *
 *   node tools/standby_shots.js [out-dir]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const RT = path.join(__dirname, '..', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));
const UI = require('../lib/ui');
// GARAGE_LAYOUT=standard: the pages as the Standard layout draws them (the car's own title and clock above them)
if (process.env.GARAGE_LAYOUT) UI.setLayout(process.env.GARAGE_LAYOUT);
const M = require('../apps/p96_standby/model');
const P = require('../apps/p96_standby/pages');

// --car <id>: the Glance of one demo car of lib/engine.js (the compatibility gallery), nothing else
let argv = process.argv.slice(2), CAR = null;
if (argv[0] === '--car') { CAR = require('../lib/engine').demoCar(argv[1]); argv = argv.slice(2); }
const out = argv[0] || path.join(__dirname, '..', 'docs', 'media', 'p96_standby');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });   // Node 8 throws EEXIST despite recursive

const T0 = new Date(2026, 10, 26, 21, 46, 50).getTime();
const drives = M.Demo.drives(T0);
const hist = { outside: [], volts: [] };
for (let k = 59; k >= 0; k--) { const d = M.Demo.values(T0 - k * 10000); hist.outside.push(M.Demo.values(T0).outside + k * 0.03); hist.volts.push(d.volts); }
function values(t) {
    const v = M.Demo.values(t, CAR);
    v.outsideHist = hist.outside; v.voltsHist = hist.volts; v.drives = drives; v.has = (k) => v[k] !== undefined && v[k] !== null;
    return v;
}
const st = { page: 'main', tab: 0, topic: 0, settings: Object.assign({}, P.DEFAULTS, { demo: 'on' }), status: 'LIVE', statusColor: 'ok',
    demo: true, now: T0, menuA: 1, nightP: 0 };   // the shots are demo data: Demo data On, the DEMO pill and the DEMO mark on every card (D26)
// Settings, Send a report: the flow as the app makes it (lib/report.js), on the app's own app.json
st.report = new (require('../lib/report').Flow)(() => ({ spec: require('../apps/p96_standby/app.json'), get: () => undefined }));
const act = { tab() {}, help() {}, settings() {}, back() {}, topic() {}, set() {}, wake() {}, demoOff() {} };

function frame(t, popup) {
    if (global.CF) global.CF.tabs = () => [P.TABS, st.tab, st.page];
    const rec = UI.zoom(new Recorder(UI.RW, UI.RH));
    P.draw(rec, values(st.now), st, t, act);
    if (popup) UI.infoPopup(rec, popup, t);
    const cv = new Canvas(UI.RW, UI.RH);
    play(rec.words(), cv);
    return { rec: rec, png: cv.png(9) };
}
const settle = () => { const e = Date.now() + 520; while (Date.now() < e) { /* the springs jump to their target after 500 ms */ } };
function shot(name, set, t, popup) {
    settle();
    Object.assign(st, { page: 'main', tab: 0, menuA: 1, nightP: 0, now: T0 + 60000 }, set);
    frame(t || 0, popup);     // one frame first: the page sets how far the side menu is in, the next frame draws it so
    const r = frame(t || 0, popup);
    fs.writeFileSync(path.join(out, name + '.png'), r.png);
    if (!popup && st.page === 'main' && st.menuA > 0.5 && !r.rec.targets.some((q) => q.key === 'p96tab0' || q.key === 'p96rail|0' || q.key === 'sbwake')) console.warn(name + ': no tab targets (the side menu is drawn by the car frame here)');
    return r;
}

if (CAR) { shot('glance', { tab: 1 }); console.log(CAR.id + ': glance in ' + out); process.exit(0); }
const files = [
    shot('clock', {}),
    shot('clock-quiet', { menuA: 0 }),
    shot('night', { menuA: 0, nightP: 1 }),
    shot('glance', { tab: 1 }),
    shot('drive', { tab: 2 }),
    shot('help', { page: 'help' }, 2.2),
    shot('settings', { page: 'settings' }),
    shot('popup', { tab: 1 }, 2.4, P.INFO.outside),
];

// the GIF: 8 frames a second
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbshots-'));
let k = 0;
const put = (t, popup) => fs.writeFileSync(path.join(tmp, ('000' + k++).slice(-4) + '.png'), frame(t, popup).png);
Object.assign(st, { page: 'main', tab: 0, menuA: 1, nightP: 0, now: T0 });
for (let i = 0; i < 12; i++) put(i / 8);                                        // the clock with its menu
for (let i = 0; i <= 8; i++) { st.menuA = 1 - i / 8; put(1.5 + i / 8); }        // the menu fades out
for (let i = 0; i < 10; i++) { st.now = T0 + i * 1500; put(2.6 + i / 8); }      // 21:46 becomes 21:47, nothing moves
for (let i = 0; i <= 12; i++) { st.nightP = i / 12; put(4 + i / 8); }           // night comes
for (let i = 0; i < 6; i++) put(5.6 + i / 8);
st.menuA = 1; st.nightP = 0;
[1, 2].forEach((tab) => { st.tab = tab; for (let i = 0; i < 10; i++) put(i / 8); });
st.tab = 1;
for (let i = 0; i < 14; i++) put(i / 8, P.INFO.outside);
st.page = 'help';
for (let i = 0; i < 14; i++) put(i / 8);
const gif = path.join(out, 'standby.gif');
execFileSync(process.env.PYTHON || 'python3', [path.join(__dirname, 'frames_to_gif.py'), tmp, gif, '8'], { stdio: 'inherit', timeout: 300000 });
fs.readdirSync(tmp).forEach((n) => fs.unlinkSync(path.join(tmp, n)));
fs.rmdirSync(tmp);
const size = fs.statSync(gif).size;
if (size > 3 * 1024 * 1024) throw new Error('standby.gif is ' + (size >> 10) + ' KiB, over 3 MB');
console.log('%s: %d pages and standby.gif (%d frames, %d KiB)', out, files.length, k, size >> 10);
