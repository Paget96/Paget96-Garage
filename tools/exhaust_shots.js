// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Screenshots and the demo GIF of Exhaust, drawn by the app's own view (apps/p96_exhaust/view.js) with its demo data,
 * through the head unit's software path (a record.js Recorder played into canvas.js), on a virtual clock so every
 * glide and animation moves as it does at 60 fps:
 *
 *   node tools/exhaust_shots.js [out-dir]          every page, dialog and info popup as PNG (docs/media/p96_exhaust/)
 *   node tools/exhaust_shots.js --gif <frames-dir>  the frames of the demo GIF (tools/frames_to_gif.py makes the GIF)
 *
 * It also checks what it draws: a dialog or popup leaves only its own buttons pressable, every page card has an (i),
 * and it times a frame of each page.
 */
const fs = require('fs');
const path = require('path');
const RT = path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));

let clock = Date.UTC(2026, 10, 26, 17, 44);
const realNow = Date.now;
Date.now = () => clock;

const APP = path.join(__dirname, '..', 'apps', 'p96_exhaust');
const UI = require('../lib/ui');
// GARAGE_LAYOUT=standard: the pages as the Standard layout draws them (the car's own title and clock above them)
if (process.env.GARAGE_LAYOUT) UI.setLayout(process.env.GARAGE_LAYOUT);
const VIEW = require(path.join(APP, 'view'));
const DEMO = require(path.join(APP, 'demo'));
const M = require(path.join(APP, 'model'));
const R = require(path.join(APP, 'rules'));
const F = require(path.join(APP, 'flap'));
const T = require(path.join(APP, 'texts'));

let args = process.argv.slice(2);
// --car <id>: the main pages of one demo car of lib/engine.js (the compatibility gallery), nothing else
const E = require('../lib/engine');
let CAR = null;
if (args[0] === '--car') { CAR = E.demoCar(args[1]); args = args.slice(2); }
const gifDir = args[0] === '--gif' ? args[1] : null;
const out = gifDir || args[0] || path.join(__dirname, '..', 'docs', 'media', 'p96_exhaust');
if (!fs.existsSync(out)) fs.mkdirSync(out);

// the app's demo wiring (main.js build() in demo): a simulated flap, the default rules, AUTO
const quiet = { info() {}, warn() {} };
let control = new F.FlapControl({ link: null, armed: () => false, log: quiet });
control.setUnits(CAR && CAR.flaps === 2 ? [{ addr: 0x12, el: true }, { addr: 0x13, el: true }] : [{ addr: 0x12, el: true }]);
const rules = new R.Rules(R.defaults());
const modes = {};
let regenNow = false, caps = CAR ? M.capsForCar(CAR) : M.ALL_CAPS;
function state() {
    const S = DEMO.state(clock, CAR);
    S.v = DEMO.values(clock, CAR);
    if (CAR) { S.engine = CAR; S.setup = DEMO.setupFor(CAR); }
    const vals = Object.assign({ minutes: 18 * 60 + 42 }, S.v);
    rules.tick(vals);
    S.rules = rules.list; S.held = rules.held; S.active = {}; S.caps = caps;
    const views = {}, decided = {}, sideMode = {};
    control.sides().forEach((s) => {
        const r = rules.pick(s), d = F.decide({ mode: modes[s] || 'AUTO', rule: r, rpm: vals.rpm, limit: 4000, armed: false });
        decided[s] = d; sideMode[s] = modes[s] || 'AUTO';
        if (d.action !== control.flaps[s].sent) control.set(s, d.action);
        views[s] = control.view(s);
        if (d.rule && d.action === d.rule.action) S.active[s] = d.rule.id;
    });
    S.flap = { sides: control.sides(), views: views, decided: decided, mode: sideMode[control.sides()[0]], sideMode: sideMode, armed: false };
    S.until = M.untilNext(S.v.load, S.loadsKm, 80);
    S.mark = 80;
    if (regenNow) S.regen = DEMO.regenNow();
    return S;
}
const V = { page: 0, mode: 'main', side: 'both', ruleFirst: 0, dialog: null, helpSel: 0, edit: null, editPart: 'when',
    // the shots are demo data: Demo data On, so the header shows the DEMO pill and every card says DEMO (D26)
    values: { demo: 'on', demoCar: (CAR || E.demoCar('b48')).id } };
// Settings, Send a report: the flow as the app makes it (lib/report.js), on the app's own app.json
V.report = new (require('../lib/report').Flow)(() => ({ spec: require('../apps/p96_exhaust/app.json'), get: () => undefined }));
const noop = () => {};
const A = new Proxy({}, { get: () => noop });

const t0 = clock;
function frame() {
    if (global.CF && !global.CF.tabs) global.CF.tabs = () => { const S = state(), pg = M.pagesFor(S.caps, S.engine), nm = M.tabsFor(S.engine); return [pg.map((i) => nm[i]), pg.indexOf(V.page), V.mode]; };
    const rec = new Recorder(UI.W, UI.H);
    VIEW.draw(rec, state(), V, A, (clock - t0) / 1000);
    return rec;
}
function png(rec, file) {
    const cv = new Canvas(UI.W, UI.H);
    play(rec.words(), cv);
    fs.writeFileSync(file, cv.png(9));
}
/** Let everything glide to rest, then draw one more. */
function settle(ms) { for (let i = 0; i < (ms || 2000) / 16; i++) { clock += 16; frame(); } return frame(); }

const shots = [];
function reset() {
    Object.assign(V, { page: 0, mode: 'main', side: 'both', ruleFirst: 0, dialog: null, helpSel: 0, edit: null, editPart: 'when' });
    regenNow = false; caps = CAR ? M.capsForCar(CAR) : M.ALL_CAPS;
    UI.closeInfo();
}
/** Every control gets its own tap: the first target under the centre of each one is that one (owner 2026-11-26 20:23:
 * on the car a card's info target took every tap). */
function reachable(rec, name) {
    rec.targets.forEach((q) => {
        const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
        const hit = rec.targets.find((t) => cx >= t.x && cx < t.x + t.w && cy >= t.y && cy < t.y + t.h);
        if (/^p96tab/.test(q.key)) return;   // the tab bar's own scroll and tap handling is checked in tests/tabs.test.js
        if (hit !== q && hit && hit.key !== q.key) throw new Error(name + ': a tap on ' + q.key + ' goes to ' + hit.key);
    });
}
function shot(name, setup, check) {
    reset(); settle(300);
    setup();
    settle(name === 'help' ? 2600 : 1600);
    const rec = frame();
    png(rec, path.join(out, name + '.png'));
    if (check) check(rec);
    reachable(rec, name);
    shots.push(name);
    return rec;
}
const onlyDialogButtons = (n) => (rec) => {
    const k = rec.targets.filter((q) => /^p96dlg/.test(q.key)).length;
    if (k !== n) throw new Error('a dialog must have its ' + n + ' buttons, found ' + rec.targets.map((q) => q.key).join(','));
    if (rec.targets.some((q) => /^(p96tab|p96info|mode\||rule)/.test(q.key))) throw new Error('the page under a dialog can still be pressed');
};
const popupOnly = (rec) => { if (rec.targets.map((q) => q.key).join(',') !== 'p96popx,p96popok') throw new Error('popup: the page can still be pressed'); };
const infos = (rec) => { if (!rec.targets.some((q) => /^p96info/.test(q.key))) throw new Error('no (i) on the page'); };
const dlg = (d) => { V.dialog = { d: d, open: true, a: 1 }; };
const ruleDlg = (r, part, index) => { V.edit = R.draft(r); V.editPart = part || 'when'; dlg(VIEW.ruleDialog(state(), V, A, index == null ? -1 : index)); };

if (CAR) {
    const names = ['now', 'flap', 'flap-log', 'opf', 'filter-care', 'cold-start', 'sound', 'better-sound', 'history', 'setup'];
    const pages = M.pagesFor(caps, CAR);
    pages.forEach((i) => shot(names[i], () => { V.page = i; }, infos));
    shot('help-cars', () => { V.mode = 'help'; V.helpSel = VIEW.helpTopics().length - 1; });
    if (CAR.diesel) { reset(); settle(300); UI.openInfo(VIEW.info('adblue')); settle(2600); png(frame(), path.join(out, 'popup-adblue.png')); shots.push('popup-adblue'); }
    console.log('%s: %d pictures in %s (%s)', CAR.id, shots.length, out, shots.join(', '));
} else if (!gifDir) {
    const names = ['now', 'flap', 'flap-log', 'opf', 'filter-care', 'cold-start', 'sound', 'better-sound', 'history', 'setup'];
    names.forEach((n, i) => shot(n, () => { V.page = i; }, infos));
    shot('opf-regen', () => { V.page = 3; regenNow = true; });
    shot('rule-new', () => { V.page = 1; ruleDlg(null); }, onlyDialogButtons(2));
    shot('rule-edit', () => {
        V.page = 1;
        const r = Object.assign({}, rules.list[1], { and: { kind: 'mode', op: 'is', value: 'sport' } });
        ruleDlg(r, 'when', 1);
    }, onlyDialogButtons(4));
    shot('flap-two', () => {
        V.page = 1; V.side = 'both';
        control = new F.FlapControl({ link: null, armed: () => false, log: quiet });
        control.setUnits([{ addr: 0x12, el: true }, { addr: 0x13, el: true }]);
    });
    control = new F.FlapControl({ link: null, armed: () => false, log: quiet });
    control.setUnits([{ addr: 0x12, el: true }]);
    shot('arm', () => {
        V.mode = 'settings';
        dlg({ label: 'Flap control', labelColor: 'warm', h: 400, title: 'Arm the flap control?',
            text: 'From now on the app commands the real exhaust flap, the way a workshop tester does: BMW\'s own flap control on the engine unit, OPEN, CLOSE and hand back (CAR). The rules on the Flap page decide in AUTO.\n\nCAR always hands it back to the car. The engine unit takes back a command it is not sent again within about 20 s.',
            note: 'Try it standing first. Disarm it before a workshop visit or an emissions test.',
            buttons: [{ label: 'Cancel', run: noop }, { label: 'Yes, arm it', kind: 'bad', run: noop }] });
    }, onlyDialogButtons(2));
    shot('help', () => { V.mode = 'help'; });
    shot('settings', () => { V.mode = 'settings'; });
    // every info popup, from the page its card is on
    const PAGE_OF = { path: 0, egt: 0, opfLoad: 0, flapCard: 0, engine: 0, flap: 1, rules: 1, week: 2, changes: 2, opf: 3, regen: 3, regens: 3,
        drives: 4, ash: 4, warmup: 5, ready: 5, coldstarts: 5, sound: 6, tips: 7, score: 7, hist: 8, regenList: 8, setup: 9 };
    if (!fs.existsSync(path.join(out, 'popups'))) fs.mkdirSync(path.join(out, 'popups'));
    Object.keys(T.INFO).forEach((k) => {
        reset(); V.page = PAGE_OF[k] || 0; settle(300);
        UI.openInfo(VIEW.info(k));
        settle(2600);
        const rec = frame();
        png(rec, path.join(out, 'popups', k + '.png'));
        popupOnly(rec);
        shots.push('popups/' + k);
    });
    fs.writeFileSync(path.join(out, 'popup.png'), fs.readFileSync(path.join(out, 'popups', 'regen.png')));
    reset(); settle(300);
    const ms = names.map((n, i) => {
        Object.assign(V, { page: i, mode: 'main', dialog: null });
        settle(300);
        const s = realNow(), k = 60;
        for (let q = 0; q < k; q++) { clock += 16; frame(); }
        return n + ' ' + ((realNow() - s) / k).toFixed(2);
    });
    console.log('%d pictures in %s\nms per frame (record only, with the state built): %s', shots.length, out, ms.join(', '));
} else {
    // the demo GIF: 960 px wide frames at 12.5 a second, the app used as a person would
    let n = 0;
    const take = (secs) => {
        for (let i = 0; i < secs * 12.5; i++) {
            for (let k = 0; k < 4; k++) { clock += 16; frame(); }
            clock += 16;
            const rec = frame(), cv = new Canvas(UI.W, UI.H);
            play(rec.words(), cv);
            fs.writeFileSync(path.join(out, 'f' + ('0000' + (n++)).slice(-4) + '.png'), cv.png(1));
        }
    };
    reset();
    take(2.4);                                   // Now: the gas moving
    V.page = 1; take(1.6);                       // Flap and its rules
    ruleDlg(null); take(1.6); V.dialog = null; V.edit = null;
    modes.both = 'CLOSED'; take(1.2); modes.both = 'AUTO'; take(0.8);
    V.page = 2; take(1.2);
    V.page = 3; take(1.2); regenNow = true; take(1.2); regenNow = false;
    V.page = 4; take(1.2);
    V.page = 5; take(1.2);
    V.page = 6; take(2.4);                       // Sound: the waves
    V.page = 7; take(1.4);
    UI.openInfo(VIEW.info('regen')); take(3); UI.closeInfo(); take(0.4);
    V.page = 8; take(1.2);
    V.page = 9; take(1.2);
    V.mode = 'help'; take(2);
    V.mode = 'settings'; take(1.2);
    console.log('%d GIF frames in %s', n, out);
}
