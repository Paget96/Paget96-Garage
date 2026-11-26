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
const RT = path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));

// a virtual clock: UI glides and the kit's springs read Date.now()
let clock = Date.UTC(2026, 10, 26, 17, 40);
const realNow = Date.now;
Date.now = () => clock;

const APP = path.join(__dirname, '..', 'apps', 'p96_health');
const UI = require('../lib/ui');
const VIEW = require(path.join(APP, 'view'));
const DEMO = require(path.join(APP, 'demo'));
const M = require(path.join(APP, 'model'));
const T = require(path.join(APP, 'texts'));

const args = process.argv.slice(2);
const gifDir = args[0] === '--gif' ? args[1] : null;
const out = gifDir || args[0] || path.join(__dirname, '..', 'docs', 'media', 'p96_health');
fs.mkdirSync(out, { recursive: true });

const demo = DEMO.state(clock);
function state() {
    const S = M.derive(Object.assign({}, demo, { at: clock, demo: true, live: false }), Object.assign({}, UI.DISPLAY_DEFAULTS,
        { batteryWarn: 12.4, tyreWarn: 0.1, nightly: 'on', units: 'metric', intervals: 'strict' }), T.faultShort);
    S.checkedText = 'checked 2 min ago';
    S.downBecause = 'the rear left tyre and the stored charge air fault.';
    return S;
}
const V = { page: 0, mode: 'main', mem: 'fault', unit: null, first: 0, detail: null, histSel: 0, dialog: null, helpSel: 0, values: {} };
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

if (!gifDir) {
    // pages
    const infos = (rec) => { if (!rec.targets.some((q) => /^p96info/.test(q.key))) throw new Error('no (i) on the page'); };
    VIEW.TABS.forEach((tab, i) => shot(tab.toLowerCase(), () => { V.page = i; }, infos));
    shot('faults-info', () => { V.page = 1; V.mem = 'info'; });
    shot('faults-permanent', () => { V.page = 1; V.mem = 'perm'; });
    shot('faults-history', () => { V.page = 1; V.mem = 'history'; });
    shot('faults-unit', () => { V.page = 1; V.unit = 0x40; });
    shot('fault-details', () => { V.page = 1; V.detail = M.listOf(S0.units, 'fault')[0]; });
    shot('clear', () => {
        V.page = 1;
        dlg({ label: 'Clear fault memory', labelColor: 'bad', h: 400, title: 'Clear 2 faults in 2 units?',
            text: 'Before clearing, Health saves the full report (Share keeps it), so your mechanic can still see what was there.\n\nOnly the fault memory is cleared. Info memory and permanent emission faults stay. A fault that is still there comes back at once, and Health shows you which ones did.',
            note: 'Only with the engine off and the ignition on. Never while driving.',
            chips: clearUnits.map((u) => ({ text: M.unitName(u.addr) + '  1' })),
            buttons: [{ label: 'Cancel', run: noop }, { label: 'Yes, clear', kind: 'bad', run: noop }] });
    }, onlyDialogButtons(2));
    shot('cleared', () => {
        V.page = 1;
        dlg({ label: 'Fault memory cleared', labelColor: 'warm', h: 330, title: 'Cleared 2 of 2 units',
            text: 'Back at once: Engine (DME). Their cause is still there: have it looked at.', buttons: [{ label: 'OK', kind: 'primary', run: noop }] });
    }, onlyDialogButtons(1));
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
    const PAGE_OF = { score: 0, faults: 0, battery12: 0, oil: 0, service: 0, tyres: 0, cc: 0, byUnit: 1, memories: 1, timeline: 1, rest: 2, start: 2, charge: 2,
        verdict: 2, nights: 2, cbs: 3, ours: 3, parts: 3, pressure: 4, trend: 4, levels: 5, warmup: 5, hist: 6, changes: 6, qr: 7 };
    fs.mkdirSync(path.join(out, 'popups'), { recursive: true });
    Object.keys(T.INFO).forEach((k) => {
        Object.assign(V, { page: PAGE_OF[k] || 0, mode: 'main', mem: k === 'timeline' ? 'history' : 'fault', dialog: null, detail: null });
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
    V.mem = 'fault';
    dlg({ label: 'Clear fault memory', labelColor: 'bad', h: 400, title: 'Clear 2 faults in 2 units?',
        text: 'Before clearing, Health saves the full report (Share keeps it), so your mechanic can still see what was there.\n\nOnly the fault memory is cleared. Info memory and permanent emission faults stay.',
        note: 'Only with the engine off and the ignition on. Never while driving.', chips: clearUnits.map((u) => ({ text: M.unitName(u.addr) + '  1' })),
        buttons: [{ label: 'Cancel', run: noop }, { label: 'Yes, clear', kind: 'bad', run: noop }] });
    const fadeIn = (secs) => { const steps = secs * 12.5; for (let i = 0; i < steps; i++) { V.dialog.a = Math.min(1, (i + 1) / 3); take(0.08); } };
    fadeIn(1.8);
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
