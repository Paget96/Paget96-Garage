// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
process.env.GARAGE_MENU = 'off';   // these tests check the page's own tab bar and buttons (the header menu is off)
/**
 * Send a report (lib/report.js, lib/ui.js reportPage) and the Full screen setting (lib/ui.js setLayout, attach) in every
 * Paget96 Garage app: what a report carries and never carries, the link and its code size, the flow, the pages' targets,
 * the header in the Standard layout, and the taps there. Plain node, Node 8 compatible:
 *
 *   node tests/report.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'lib', 'report'));
const QR = require(path.join(ROOT, 'lib', 'qr'));
const UI = require(path.join(ROOT, 'lib', 'ui'));
const { Recorder } = require(path.join(ROOT, 'upstream-kit', 'kit', 'runtime', 'record'));

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const APPS = fs.readdirSync(path.join(ROOT, 'apps')).filter((d) => fs.existsSync(path.join(ROOT, 'apps', d, 'app.json')));
const spec = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', id, 'app.json'), 'utf8'));
const VIN = 'WBA5R31070FH12345';
const line = (t, lvl, msg) => '2026-11-26T' + t + ':00.000Z ' + lvl + ' ' + msg + '\n';
const LOG = line('17:01', 'INFO', 'started') + line('17:02', 'WARN', 'engine unit link: timeout after 1500 ms') +
    line('17:03', 'ERROR', 'fault memory read for ' + VIN + ' failed') + '    at Object.<anonymous> (main.js:1:1)\n' +
    line('17:04', 'SDK_WARN', 'resource slow') + line('17:05', 'FATAL', 'uncaught: TypeError: x is null');
const facts = (o) => R.collect(Object.assign({ spec: spec('p96_health'), get: () => undefined, screen: { w: 1920, h: 720 },
    firmware: 'BMW MGU P18_23w44.2-1-3 mgu-high', engine: 'petrol, 6 cylinders, one turbo, OPF', logText: LOG, vin: VIN }, o || {}));
/** The title and body a link carries, decoded as GitHub reads them ("+" a space). */
function decode(url) {
    const q = url.split('?')[1], out = {};
    q.split('&').forEach((kv) => { const i = kv.indexOf('='); out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    return out;
}

test('the log: warnings and errors only, first line of each, times short, a VIN masked, the newest kept', () => {
    const s = R.logSummary(LOG, 6);
    assert.strictEqual(s.warn, 2);
    assert.strictEqual(s.error, 2);
    assert.deepStrictEqual(s.lines.map((l) => l.slice(0, 11)), ['17:02 WARN ', '17:03 ERROR', '17:04 WARN ', '17:05 ERROR']);
    assert.ok(s.lines.every((l) => l.indexOf(VIN) < 0 && l.indexOf('at Object') < 0));
    assert.ok(/<VIN>/.test(s.lines[1]));
    const many = R.logSummary(new Array(20).join(line('10:00', 'WARN', 'x')), 6);
    assert.strictEqual(many.lines.length, 6);
    assert.strictEqual(many.warn, 19);
});

test('settings: only the ones changed from their defaults', () => {
    const f = facts({ get: (k) => ({ fps: 30, units: 'imperial', renderer: 'auto', layout: 'full' })[k] });
    assert.deepStrictEqual(f.changed, [['fps', 30], ['units', 'imperial']]);
    assert.deepStrictEqual(facts().changed, []);
});

test('the body: the car facts always, the VIN only when ticked, nothing else', () => {
    const f = facts({ get: (k) => (k === 'fps' ? 30 : undefined) });
    const off = R.bodyLines(f, {}), on = R.bodyLines(f, { vin: true });
    assert.ok(off.every((l) => l.indexOf(VIN) < 0), 'VIN sent without the tick');
    assert.ok(on.some((l) => l === 'VIN: ' + VIN));
    ['App: Health 1.1.0', 'iDrive 7, firmware P18_23w44.2-1-3', 'Engine: petrol, 6 cylinders, one turbo, OPF', 'Settings: fps=30']
        .forEach((x) => assert.ok(off.indexOf(x) >= 0, 'missing ' + x));
    const unknown = R.bodyLines(R.collect({ spec: spec('p96_standby'), get: () => undefined }), {});
    assert.ok(unknown.indexOf('iDrive not known, firmware not known') >= 0);
    assert.ok(unknown.indexOf('Engine: not found yet') >= 0);
    assert.ok(unknown.indexOf('Log: no warnings or errors') >= 0);
    // no location, no phone: the body is made only of these lines
    off.concat(on).forEach((l) => assert.ok(/^(What happened:|App: |iDrive|Engine: |VIN: |Settings: |Log: |\d\d:\d\d (WARN|ERROR) |$)/.test(l), 'unexpected line ' + l));
});

test('a VIN that is not 17 valid characters is never offered', () => {
    assert.strictEqual(facts({ vin: 'car' }).vin, null);
    assert.strictEqual(facts({ vin: 'WBA5R31070FH1234O' }).vin, null);   // O is not in a VIN
});

test('the link: GitHub new issue with title and body, decoded back exactly, version 15 at most', () => {
    const b = R.build(facts(), {});
    assert.ok(b.url.indexOf('https://github.com/Paget96/Paget96-Garage/issues/new?') === 0);
    const d = decode(b.url);
    assert.strictEqual(d.title, 'Report from Health 1.1.0');
    assert.strictEqual(d.body, b.lines.join('\n'));
    assert.ok(b.qr.version <= R.MAX_VERSION, 'version ' + b.qr.version);
    assert.ok(Buffer.byteLength(b.url) <= QR.capacity(b.qr.version, b.ecl));
});

test('a long log is shortened to fit, the facts never, and the body says so', () => {
    let big = '';
    for (let i = 0; i < 6; i++) big += line('12:0' + i, 'ERROR', 'a long error message number ' + i + ' with words that take room in the link');
    const f = facts({ logText: big, get: (k) => ({ fps: 30, units: 'imperial', demo: 'on' })[k] });
    [false, true].forEach((vin) => {
        const b = R.build(f, { vin: vin });
        assert.ok(b.trimmed && b.logN < 6, 'not trimmed');
        assert.ok(b.qr.version <= 15);
        assert.ok(b.lines.some((l) => /shortened to fit|left out to fit/.test(l)));
        ['App: ', 'iDrive', 'Engine: ', 'Settings: '].forEach((x) => assert.ok(b.lines.some((l) => l.indexOf(x) === 0), 'lost ' + x));
        if (vin) assert.ok(b.lines.indexOf('VIN: ' + VIN) >= 0);
    });
    // short: level M, nothing cut
    const s = R.build(facts({ logText: '' }), {});
    assert.strictEqual(s.ecl, 'M');
    assert.ok(!s.trimmed);
});

test('the firmware from the head unit files, its short name in the body', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p96etc-'));
    assert.strictEqual(R.firmwareOf(fs, dir), null);
    fs.writeFileSync(path.join(dir, 'os-release'), 'NAME=x\nPRETTY_NAME="MGU 22"\n');
    assert.strictEqual(R.firmwareOf(fs, dir), 'MGU 22');
    fs.writeFileSync(path.join(dir, 'os-release-id-dlt'), 'BMW MGU P18_24w07 mgu-high\n');
    assert.strictEqual(R.firmwareOf(fs, dir), 'BMW MGU P18_24w07 mgu-high');
    assert.strictEqual(R.firmwareShort('BMW MGU P18_24w07 mgu-high'), 'P18_24w07');
    assert.strictEqual(R.idriveOf({ w: 2880, h: 960 }), 'iDrive 8');
    assert.strictEqual(R.idriveOf(null), null);
});

test('forApp: the app log and engine.json from the data folder, the screen from the renderer, the VIN from the app', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p96rep-'));
    fs.writeFileSync(path.join(dir, 'p96_exhaust.log'), LOG);
    fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify({ facts: { fuel: 'diesel', cylinders: 6, index: '0F2460' } }));
    const vals = { fps: 15 };
    const ctx = { spec: spec('p96_exhaust'), dataDir: dir, settings: { get: (k) => vals[k] }, display: { gpu: { ready: true, screen: { w: 1920, h: 720 } } } };
    const flow = R.forApp(ctx, { vin: () => VIN });
    flow.open();
    const L = flow.built.lines;
    assert.ok(L.indexOf('App: Exhaust ' + ctx.spec.version) >= 0);
    assert.ok(L.some((l) => /^Engine: diesel, 6 cylinders/.test(l)), L.join('|'));
    assert.ok(L.indexOf('Settings: fps=15') >= 0);
    assert.ok(L.some((l) => /^Log: 2 errors, 2 warnings/.test(l)));
    assert.ok(L.every((l) => l.indexOf(VIN) < 0));
    flow.toggleVin();
    assert.ok(flow.built.lines.indexOf('VIN: ' + VIN) >= 0);
    flow.toggleVin();
    assert.ok(flow.built.lines.every((l) => l.indexOf(VIN) < 0));
});

test('the flow: explain, the code, back, done; it opens fresh after Settings was left', () => {
    const flow = new R.Flow(() => ({ spec: spec('p96_datalog'), get: () => undefined }));
    assert.ok(!flow.active());
    flow.open();
    assert.strictEqual(flow.step, 'explain');
    assert.ok(flow.active());
    flow.makeQr();
    assert.strictEqual(flow.step, 'qr');
    flow.back();
    assert.strictEqual(flow.step, 'explain');
    flow.back();
    assert.ok(!flow.active());
    flow.open(); flow.makeQr();
    flow.seen = Date.now() - 5000;          // not drawn for 5 s: the user left Settings
    assert.ok(!flow.active());
    flow.open();
    assert.strictEqual(flow.step, 'explain');
});

test('Settings: the Send a report button; the report pages: their buttons, the VIN tick only with a VIN', () => {
    const rec = new Recorder(UI.W, UI.H);
    UI.settingsPage(rec, [], {}, () => {}, { title: 'X', onReport: () => {}, onBack: () => {}, onHelp: () => {} });
    assert.ok(rec.targets.some((q) => q.key === 'p96button|report'));
    const noReport = new Recorder(UI.W, UI.H);
    UI.settingsPage(noReport, [], {}, () => {}, { title: 'X' });
    assert.ok(!noReport.targets.some((q) => q.key === 'p96button|report'));
    [VIN, null].forEach((vin) => {
        const flow = new R.Flow(() => ({ spec: spec('p96_health'), get: () => undefined, vin: vin, logText: LOG }));
        flow.open();
        const a = new Recorder(UI.W, UI.H);
        UI.reportPage(a, flow, 0, { title: 'HEALTH' });
        const keys = a.targets.map((q) => q.key);
        ['p96button|repmake', 'p96button|repcancel', 'p96back', 'p96settings'].forEach((k) => assert.ok(keys.indexOf(k) >= 0, k));
        assert.strictEqual(keys.indexOf('p96tog|repvin') >= 0, !!vin);
        a.targets.filter((q) => q.key === 'p96button|repmake')[0].run();
        assert.strictEqual(flow.step, 'qr');
        const b = new Recorder(UI.W, UI.H);
        UI.reportPage(b, flow, 0, { title: 'HEALTH' });
        ['p96button|repdone', 'p96button|repback'].forEach((k) => assert.ok(b.targets.some((q) => q.key === k), k));
        b.targets.filter((q) => q.key === 'p96button|repdone')[0].run();
        assert.ok(!flow.isOpen);
    });
});

test('every app: Full screen in app.json the same as the Display card (default on), and the report wired in', () => {
    const row = UI.DISPLAY_SETTINGS.filter((s) => s.key === 'layout')[0];
    assert.ok(row && row.default === 'full');
    APPS.forEach((id) => {
        const s = spec(id).settings.filter((x) => x.key === 'layout')[0];
        assert.ok(s, id + ': no layout setting');
        assert.deepStrictEqual([s.label, s.type, s.default, s.options], [row.label, row.type, row.default, row.options], id);
        const src = fs.readdirSync(path.join(ROOT, 'apps', id)).filter((f) => /\.js$/.test(f))
            .map((f) => fs.readFileSync(path.join(ROOT, 'apps', id, f), 'utf8')).join('\n');
        ['UI.attach(ctx)', 'forApp(ctx', 'UI.reportPage(', 'onReport', 'REPORT_TOPIC'].forEach((k) => assert.ok(src.indexOf(k) >= 0, id + ': no ' + k));
    });
});

test('Full screen is not offered on the Software renderer (it would do nothing there)', () => {
    const rows = (vals) => { const r = new Recorder(UI.W, UI.H); UI.settingsPage(r, [], vals, () => {}, { title: 'X' }); return r.targets.map((q) => q.key).join(' '); };
    assert.ok(/set\|layout/.test(rows({})));
    assert.ok(!/set\|layout/.test(rows({ renderer: 'software' })));
});

test('the Standard layout: no app name and no clock (the car shows its own), the tabs from the margin', () => {
    const draw = () => {
        const r = new Recorder(UI.W, UI.H);
        UI.background(r);
        UI.tabs(r, ['One', 'Two', 'Three'], 0, { onSelect: () => {} });
        const n = r.words().length;
        UI.title(r, 'APP');
        return { r: r, title: r.words().length - n, tab0: r.targets.filter((q) => q.key === 'p96tab0')[0] };
    };
    try {
        const full = draw();
        assert.ok(full.title > 0, 'full screen: the name and clock are drawn');
        assert.ok(full.tab0.x > 270);
        UI.setLayout('standard');
        const std = draw();
        assert.strictEqual(std.title, 0, 'standard: the name or the clock drawn twice');
        assert.ok(std.tab0.x < 60, 'standard: the tabs do not start at the margin');
        // a placement the renderer reports as not full counts as Standard too
        UI.setLayout('full');
        const r = new Recorder(UI.W, UI.H);
        r.place = { full: false };
        assert.ok(UI.standard(r));
    } finally { UI.setLayout('full'); }
});

test('attach: the layout follows the setting; in Standard every target stays pressable through the kit\'s tabs', () => {
    const vals = { layout: 'standard' }, listeners = [];
    const settings = { get: (k) => vals[k], onChange: (fn) => listeners.push(fn) };
    const display = {}, images = [];
    const ctx = { settings: settings, display: display, ui: { image: (n, cv) => { images.push(cv); return Promise.resolve(); } },
        onTab(fn) { display.onTab = fn; } };
    const got = [];
    try {
        UI.attach(ctx);
        ctx.onTab((i) => got.push('tab' + i));
        assert.ok(UI.standard(null));
        // a Standard frame: its targets go to the kit as tabs from 1000; tapping one runs it
        let ran = '';
        const cv = new Recorder(UI.W, UI.H);
        cv.place = { full: false, scale: 1, ox: 0, oy: 0 };
        cv.target(10, 10, 50, 50, () => { ran = 'a'; }, 'a');
        cv.target(100, 10, 50, 50, () => { ran = 'b'; }, 'b');
        ctx.ui.image('MAIN_GFX', cv);
        assert.deepStrictEqual(cv.tabRects.map((q) => q.i), [1000, 1001]);
        display.onTab(1001);
        assert.strictEqual(ran, 'b');
        display.onTab(2);
        assert.deepStrictEqual(got, ['tab2']);
        // a Full screen frame is left as it is (the kit runs that screen itself)
        vals.layout = 'full';
        listeners.forEach((fn) => fn('layout', 'full'));
        assert.ok(!UI.standard(null));
        const full = new Recorder(UI.W, UI.H);
        full.place = { full: true, scale: 1.164, ox: 0, oy: 0 };
        full.target(0, 0, 10, 10, () => {}, 'x');
        ctx.ui.image('MAIN_GFX', full);
        assert.ok(!full.tabRects);
    } finally { UI.setLayout('full'); }
});

test('Node 8: no optional chaining, nullish coalescing or object spread in lib/report.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'report.js'), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\?\.[a-zA-Z_(]/.test(src) && !/\?\?/.test(src) && !/\{\s*\.\.\./.test(src));
});

(async function () {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
    }
    console.log(tests.length + ' tests, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
