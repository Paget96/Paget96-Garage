// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Screenshots of Send a report (lib/report.js, lib/ui.js reportPage), drawn through the head unit's software path
 * (a record.js Recorder played into canvas.js) on a virtual clock, with Health's app.json and a sample car:
 *
 *   node tools/report_shots.js [out-dir]     docs/media/report/: settings, explain, explain-vin, qr, help (PNG)
 *
 * GARAGE_LAYOUT=standard draws the pages as the Standard layout does. It checks what it draws: every button of
 * both steps is a target, the VIN shows only once ticked, and the drawn code reads back as the link when a decoder
 * is at hand (python3 tools/qr_reference.py --decode docs/media/report/qr.png).
 */
const fs = require('fs');
const path = require('path');
const RT = path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));

let clock = Date.UTC(2026, 10, 26, 18, 40);
Date.now = () => clock;

const UI = require('../lib/ui');
// GARAGE_LAYOUT=standard: the pages as the Standard layout draws them (the car's own title and clock above them)
if (process.env.GARAGE_LAYOUT) UI.setLayout(process.env.GARAGE_LAYOUT);
const R = require('../lib/report');

const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'media', 'report');
fs.mkdirSync(out, { recursive: true });

// a sample car and a sample log: what a Health on a B58 with two warnings and an error would send
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'p96_health', 'app.json'), 'utf8'));
const LOG = [
    '2026-11-26T17:31:02.120Z INFO Health started',
    '2026-11-26T17:31:09.004Z WARN engine unit: no answer to 22 F6 A0 within 1500 ms',
    '2026-11-26T17:33:40.551Z WARN tyre pressure: no value for RL',
    '2026-11-26T17:35:12.870Z ERROR fault memory of 0x40: 7F 19 31 request out of range',
].join('\n') + '\n';
const flow = new R.Flow(() => ({
    spec: spec, get: (k) => ({ units: 'imperial', fps: 30 })[k], screen: { w: 1920, h: 720 },
    firmware: 'BMW MGU P18_23w44.2-1-3 mgu-high', engine: 'petrol, 6 cylinders, one turbo, OPF',
    logText: LOG, vin: 'WBA5R31070FH12345',
}));

/** Draws page(cv, t) for 0.6 s of virtual time at 60 fps (glides settle), writes the last frame. */
function shot(name, page) {
    let rec = null;
    for (let i = 0; i < 36; i++) {
        clock += 1000 / 60;
        rec = new Recorder(UI.W, UI.H);
        page(rec, i / 60);
    }
    const cv = new Canvas(UI.W, UI.H);
    play(rec.words(), cv);
    fs.writeFileSync(path.join(out, name + '.png'), cv.png(9));
    return rec;
}
const keys = (rec) => rec.targets.map((q) => q.key);
const need = (rec, list, what) => (global.CF ? list.filter((k) => k !== 'p96back') : list).forEach((k) => { if (keys(rec).indexOf(k) < 0) throw new Error(what + ': no target ' + k); });

const APP_ROWS = [{ key: 'units', label: 'Units', hint: 'Pressure and temperature', type: 'choice', default: 'metric', options: [['metric', 'Metric'], ['imperial', 'Imperial']] }];
const s = shot('settings', (cv) => UI.settingsPage(cv, APP_ROWS, { units: 'imperial', fps: 30 }, () => {}, {
    title: 'HEALTH', appLabel: 'Health', onBack: () => {}, onHelp: () => {}, onReport: () => flow.open() }));
need(s, ['p96button|report'], 'settings');
s.targets.filter((q) => q.key === 'p96button|report')[0].run();

const e = shot('explain', (cv, t) => UI.reportPage(cv, flow, t, { title: 'HEALTH' }));
need(e, ['p96button|repmake', 'p96button|repcancel', 'p96tog|repvin', 'p96back'], 'explain');
if (flow.built.lines.some((l) => /^VIN/.test(l))) throw new Error('the VIN is in before it was ticked');
flow.toggleVin();
shot('explain-vin', (cv, t) => UI.reportPage(cv, flow, t, { title: 'HEALTH' }));
if (!flow.built.lines.some((l) => /^VIN/.test(l))) throw new Error('the VIN is not in once ticked');
flow.toggleVin();
flow.makeQr();
const q = shot('qr', (cv, t) => UI.reportPage(cv, flow, t, { title: 'HEALTH' }));
need(q, ['p96button|repdone', 'p96button|repback'], 'qr');
shot('help', (cv, t) => UI.howToUse(cv, [{ title: 'Read the score', text: 'x' }, { title: 'Faults: stored or active', text: 'x' }, UI.REPORT_TOPIC], 2, 1.9 + t,
    { title: 'HEALTH', onSelect: () => {}, onBack: () => {}, onSettings: () => {} }));

const b = flow.built;
console.log('%s: settings, explain, explain-vin, qr, help; the code: version %d, level %s, %d bytes, %d of %d log lines%s',
    out, b.qr.version, b.ecl, b.qr.bytes, b.logN, flow.facts.log.lines.length, b.trimmed ? ' (shortened)' : '');
