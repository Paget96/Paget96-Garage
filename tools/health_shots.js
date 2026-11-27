// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Screenshots and the demo GIF of Health, drawn by the app's own view (apps/p96_health/view.js) with its demo data,
 * through the head unit's software path (a record.js Recorder played into canvas.js), on a virtual clock so every
 * glide and animation moves as it does at 60 fps:
 *
 *   node tools/health_shots.js [out-dir]          every page, dialog and info popup as PNG (docs/media/p96_health/)
 *   node tools/health_shots.js --gif <frames-dir>  the frames of the demo GIF (tools/make_gif.py makes the GIF)
 *
 * It also checks what it draws: a dialog or popup leaves only its own buttons pressable, every card has an (i)
 * target, and it times a frame of each page.
 */
const fs = require('fs');
const path = require('path');
const RT = path.join(__dirname, '..', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));

// a virtual clock: UI glides and the kit's springs read Date.now()
let clock = Date.UTC(2026, 10, 26, 17, 40);
const realNow = Date.now;
Date.now = () => clock;

const APP = path.join(__dirname, '..', 'apps', 'p96_health');
const UI = require('../lib/ui');
// GARAGE_LAYOUT=standard: the pages as the Standard layout draws them (the car's own title and clock above them)
if (process.env.GARAGE_LAYOUT) UI.setLayout(process.env.GARAGE_LAYOUT);
const VIEW = require(path.join(APP, 'view'));
const DEMO = require(path.join(APP, 'demo'));
const M = require(path.join(APP, 'model'));
const T = require(path.join(APP, 'texts'));

let args = process.argv.slice(2);
// --car <id>: the pages of one demo car of lib/engine.js (the compatibility gallery), nothing else
const E = require('../lib/engine');
let CAR = null;
if (args[0] === '--car') { CAR = E.demoCar(args[1]); args = args.slice(2); }
const gifDir = args[0] === '--gif' ? args[1] : null;
const out = gifDir || args[0] || path.join(__dirname, '..', 'docs', 'media', 'p96_health');
fs.mkdirSync(out, { recursive: true });

const demo = DEMO.state(clock, CAR);
function state() {
    const S = M.derive(Object.assign({}, demo, { at: clock, demo: true, live: false, engine: CAR || E.demoCar('b48'), eng: DEMO.engineValues(clock, CAR || E.demoCar('b48')), dc: DEMO.driveCheck(clock, CAR || E.demoCar('b48')) }), Object.assign({}, UI.DISPLAY_DEFAULTS,
        { batteryWarn: 12.4, tyreWarn: 0.1, nightly: 'on', units: 'metric', intervals: 'strict' }), T.faultShort);
    S.checkedText = 'checked 2 min ago';
    S.downBecause = 'the rear left tyre and the stored charge air fault.';
    return S;
}
const V = { page: 0, mode: 'main', mem: 'fault', unit: null, first: 0, detail: null, histSel: 0, dialog: null, helpSel: 0,
    // the shots are demo data: Demo data On, so the header shows the DEMO pill and every card says DEMO (D26)
    values: { demo: 'on', demoCar: (CAR || E.demoCar('b48')).id } };
// Settings, Send a report: the flow as the app makes it (lib/report.js), on the app's own app.json
V.report = new (require('../lib/report').Flow)(() => ({ spec: require('../apps/p96_health/app.json'), get: () => undefined }));
// the side menu in the car frame (tools/carframe.js preloaded): the pages, the one shown
if (global.CF) global.CF.tabs = () => [VIEW.TABS, V.page, V.mode];
const noop = () => {};
const A = new Proxy({}, { get: (o, k) => (k === 'pick' ? (p) => { const d = V.dialog.d; const i = d.pick.indexOf(p); if (i >= 0) d.pick.splice(i, 1); else d.pick.push(p); } : noop) });

let t0 = clock;
function frame() {
    const rec = new Recorder(UI.W, UI.H);
    VIEW.draw(rec, state(), V, A, (clock - t0) / 1000);
    return rec;
}
function png(rec, file, scale) {
    const cv = new Canvas(UI.W, UI.H);
    play(rec.words(), cv);
    if (!scale) { fs.writeFileSync(file, cv.png(9)); return; }
    fs.writeFileSync(file, cv.png(1));
}
/** Let everything glide to rest (2 s of 60 fps frames), then draw one more. */
function settle(ms) { for (let i = 0; i < (ms || 2000) / 16; i++) { clock += 16; frame(); } return frame(); }

const shots = [];
function shot(name, setup, check) {
    Object.assign(V, { page: 0, mode: 'main', mem: 'fault', unit: null, first: 0, detail: null, histSel: 0, dialog: null, helpSel: 0 });
    UI.closeInfo(); settle(400);
    setup();
    settle(name === 'help' ? 2600 : 1600);
    clock += 60000 - ((clock - t0) % 60000) + 59200;
    settle(50);
    const rec = frame();
    png(rec, path.join(out, name + '.png'));
    if (check) check(rec);
    shots.push(name);
    return rec;
}
const onlyDialogButtons = (n) => (rec) => {
    if (rec.targets.length !== n) throw new Error('a dialog must leave only its ' + n + ' buttons pressable, found ' + rec.targets.map((q) => q.key).join(','));
};
const popupOnly = (rec) => { if (rec.targets.map((q) => q.key).join(',') !== 'p96popx,p96popok') throw new Error('popup: the page can still be pressed'); };
const S0 = state();
const clearUnits = S0.units.filter((u) => u.dtcs.some((d) => d.mem === 'fault'));
const dlg = (d) => { V.dialog = { d: d, open: true, a: 1 }; };
/** The Clear faults dialog as the app builds it, with these units ticked (default: as it opens, the engine unit not ticked). */
const clearDlg = (ticked) => VIEW.clearDialog(clearUnits, ticked || M.clearDefaults(clearUnits), { tick: noop, all: noop, cancel: noop, run: noop });

if (CAR) {
    const pages = M.pagesFor(state().caps, state());
    pages.forEach((i) => shot(VIEW.TABS[i].toLowerCase().replace(/ /g, '-'), () => { V.page = i; }));
    if (pages.indexOf(8) >= 0) ['rough', 'ignition'].forEach((k) => shot('engine-' + k, () => { V.page = 8; V.cyl = k; }));
    shot('help-engine', () => { V.mode = 'help'; V.helpSel = T.TOPICS.findIndex((tp) => /per cylinder/.test(tp.title)); });
    if (pages.indexOf(8) >= 0) { Object.assign(V, { page: 8, mode: 'main', dialog: null }); UI.closeInfo(); settle(300); UI.openInfo(VIEW.info('misfire')); settle(2600); png(frame(), path.join(out, 'popup-misfire.png')); shots.push('popup-misfire'); UI.closeInfo(); }
    console.log('%s: %d pictures in %s (%s)', CAR.id, shots.length, out, shots.join(', '));
} else if (!gifDir) {
    // pages
    const infos = (rec) => { if (!rec.targets.some((q) => /^p96info/.test(q.key))) throw new Error('no (i) on the page'); };
    VIEW.TABS.forEach((tab, i) => shot(tab.toLowerCase().replace(/ /g, '-'), () => { V.page = i; }, infos));
    shot('faults-info', () => { V.page = 1; V.mem = 'info'; });
    shot('faults-permanent', () => { V.page = 1; V.mem = 'perm'; });
    shot('faults-history', () => { V.page = 1; V.mem = 'history'; });
    shot('faults-unit', () => { V.page = 1; V.unit = 0x40; });
    shot('faults-readiness', () => { V.page = 1; V.mem = 'ready'; });
    shot('fault-details', () => { V.page = 1; V.detail = M.listOf(S0.units, 'fault')[0]; });
    // the clear dialog: its two buttons, "All but the engine" and one tick per unit stay pressable
    shot('clear', () => { V.page = 1; dlg(clearDlg()); }, onlyDialogButtons(2 + 1 + clearUnits.length));
    shot('clear-engine', () => { V.page = 1; dlg(clearDlg(clearUnits.map((u) => u.addr))); }, onlyDialogButtons(2 + 1 + clearUnits.length));
    shot('cleared', () => {
        V.page = 1;
        dlg({ label: 'Fault memory cleared', labelColor: 'warm', h: 420, title: 'Cleared 2 of 2 units', text: VIEW.clearedText([0x12], [], true),
            buttons: [{ label: 'OK', run: noop }, { label: 'See readiness', kind: 'primary', run: noop }] });
    }, onlyDialogButtons(2));
    shot('service-add', () => {
        V.page = 3;
        const d = { label: 'Add a part', title: 'Pick what you plan to change', w: 1080, h: 460, pick: ['Air filter', 'Cabin filter'] };
        d.body = VIEW.addPartBody(state(), { dialog: d }, A);
        d.buttons = [{ label: 'Cancel', run: noop }, { label: 'Add 2', kind: 'primary', run: noop }];
        dlg(d);
    });
    shot('service-reset', () => {
        V.page = 3;
        dlg({ label: 'Reset service item', labelColor: 'warm', h: 360, title: 'Reset brake fluid?',
            text: 'Only after the work was done. The car then counts this item down again from today, as after a workshop service.\n\nNow: 8 months left.',
            note: 'Only with the engine off and the ignition on.', buttons: [{ label: 'Cancel', run: noop }, { label: 'Yes, reset', kind: 'bad', run: noop }] });
    }, onlyDialogButtons(2));
    shot('reminder', () => {
        dlg({ label: 'Reminder', labelColor: 'warm', h: 330, title: '2 things coming up',
            text: 'Engine oil (our interval): 2 800 km\n\nLosing about 0.03 bar a week while the others hold.', buttons: [{ label: 'OK', kind: 'primary', run: noop }] });
    });
    shot('help', () => { V.mode = 'help'; });
    shot('settings', () => { V.mode = 'settings'; });
    // every info popup, from the page its card is on
    const PAGE_OF = { score: 0, faults: 0, battery12: 0, oil: 0, service: 0, tyres: 0, cc: 0, byUnit: 1, memories: 1, timeline: 1, readiness: 1, rest: 2, start: 2, charge: 2,
        verdict: 2, nights: 2, cbs: 3, ours: 3, parts: 3, pressure: 4, trend: 4, levels: 5, warmup: 5, hist: 6, changes: 6, qr: 7 };
    fs.mkdirSync(path.join(out, 'popups'), { recursive: true });
    Object.keys(T.INFO).forEach((k) => {
        Object.assign(V, { page: PAGE_OF[k] || 0, mode: 'main', mem: k === 'timeline' ? 'history' : k === 'readiness' ? 'ready' : 'fault', dialog: null, detail: null });
        UI.closeInfo(); settle(300);
        UI.openInfo(VIEW.info(k));
        settle(2600);
        // the animations loop every 4, 5 or 6 s: show them near the end of a loop, where they are complete
        clock += 60000 - ((clock - t0) % 60000) + 59200;
        const rec = frame();
        png(rec, path.join(out, 'popups', k + '.png'));
        popupOnly(rec);
        shots.push('popups/' + k);
    });
    // the README's main picture of the popup
    fs.copyFileSync(path.join(out, 'popups', 'rest.png'), path.join(out, 'popup.png'));
    UI.closeInfo(); settle(300);
    // a frame's cost, per page (the part the GPU path pays every frame)
    const ms = VIEW.TABS.map((tab, i) => {
        Object.assign(V, { page: i, mode: 'main', mem: 'fault', dialog: null, detail: null });
        settle(300);
        const s = realNow(), n = 60;
        for (let k = 0; k < n; k++) { clock += 16; frame(); }
        return tab + ' ' + ((realNow() - s) / n).toFixed(2);
    });
    console.log('%d pictures in %s\nms per frame (record only, with the state built): %s', shots.length, out, ms.join(', '));
} else {
    // the demo GIF: 960 px wide frames at 12.5 per second, the app used as a person would
    let n = 0;
    const take = (secs) => { for (let i = 0; i < secs * 12.5; i++) { for (let k = 0; k < 5; k++) { clock += 16; if (k < 4) frame(); } png(frame(), path.join(out, 'f' + ('0000' + (n++)).slice(-4) + '.png'), true); } };
    Object.assign(V, { page: 0 });
    // the score fills from 0: start the ring from nothing
    const S1 = state();
    take(0.1);
    take(2.2);
    V.page = 1; take(1.6);
    V.detail = M.listOf(S1.units, 'fault')[0]; take(1.6);
    V.detail = null; V.mem = 'history'; take(1.6);
    V.mem = 'ready'; take(1.8);
    V.mem = 'fault';
    dlg(clearDlg());
    const fadeIn = (secs) => { const steps = secs * 12.5; for (let i = 0; i < steps; i++) { V.dialog.a = Math.min(1, (i + 1) / 3); take(0.08); } };
    fadeIn(1.6);
    V.dialog.d = clearDlg(clearUnits.map((u) => u.addr)); take(2.0);
    V.dialog = null;
    V.page = 2; take(1.4);
    UI.openInfo(VIEW.info('rest')); take(3.4); UI.closeInfo(); take(0.4);
    V.page = 3; take(1.6);
    V.page = 4; take(1.4);
    V.page = 5; take(1.2);
    V.page = 6; take(1.2);
    V.page = 7; take(1.6);
    V.mode = 'help'; take(2.4);
    V.mode = 'settings'; take(1.4);
    console.log('%d GIF frames in %s', n, out);
}
