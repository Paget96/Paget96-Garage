// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Demo data in every Paget96 Garage app: two values (Off, the default, and On), an old saved "auto" reads as Off,
 * nothing turns the demo on by itself, the amber DEMO pill sits where LIVE does, every card says DEMO, and a tap on
 * the pill turns the demo off. Plain node, Node 8 compatible:
 *
 *   node tests/demo.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RT = path.join(ROOT, 'upstream-kit', 'kit', 'runtime');
const { Recorder } = require(path.join(RT, 'record'));
const UI = require(path.join(ROOT, 'lib', 'ui'));
const APPS = ['p96_datalog', 'p96_exhaust', 'p96_health', 'p96_standby'];

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const store = (vals) => ({ vals: vals, get: (k) => vals[k], set: (k, v) => { vals[k] = v; } });
const targets = (rec, key) => rec.targets.filter((q) => q.key === key);
/** A Recorder that also keeps every string drawn straight onto it (not the cached layers): [str, colour]. */
function rec0() {
    const r = new Recorder(1600, 520), text = r.text.bind(r);
    r.drawn = [];
    r.text = (str, x, y, size, c, o) => { r.drawn.push([String(str), c]); return text(str, x, y, size, c, o); };
    return r;
}
const words = (rec) => rec.drawn.map((d) => d[0]);

/* ---------- the setting ---------- */

test('the Display card: Demo data is Off or On, Off by default, an old auto reads as Off', () => {
    const row = UI.DISPLAY_SETTINGS.filter((r) => r.key === 'demo')[0];
    assert.deepStrictEqual(row.options.map((o) => o[0]), ['off', 'on']);
    assert.strictEqual(row.default, 'off');
    assert.deepStrictEqual(row.aliases, { auto: 'off' });
    assert.strictEqual(UI.DISPLAY_DEFAULTS.demo, 'off');
});
test('every app.json: Demo data Off or On, default Off, auto saved before becomes Off', () => {
    APPS.forEach((id) => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', id, 'app.json'), 'utf8'));
        const s = spec.settings.filter((x) => x.key === 'demo')[0];
        assert.ok(s, id);
        assert.deepStrictEqual(s.options.map((o) => o[0]), ['off', 'on'], id);
        assert.strictEqual(s.default, 'off', id);
        assert.deepStrictEqual(s.aliases, { auto: 'off' }, id);
    });
});
test('demoOn: only "on" is on; auto, nothing, junk and off are off', () => {
    assert.strictEqual(UI.demoOn('on'), true);
    assert.strictEqual(UI.demoOn(true), true);
    [undefined, null, '', 'auto', 'off', 'Auto', 0, false, 'yes'].forEach((v) => assert.strictEqual(UI.demoOn(v), false, String(v)));
    assert.strictEqual(UI.demoValue('auto'), 'off');
    assert.strictEqual(UI.demoValue(undefined), 'off');
    assert.strictEqual(UI.demoValue('on'), 'on');
});
test('the Settings page shows a saved auto as Off (the segment lit is Off)', () => {
    // the lit segment's word is drawn dark on the accent: a saved auto lights the same words as off, not as on
    // (the lit segment glides; the kit's springs jump to their target after 500 ms, so draw, wait, draw again)
    const settle = () => { const e = Date.now() + 520; while (Date.now() < e) { /* wait */ } };
    const lit = (vals) => {
        UI.settingsPage(rec0(), [], vals, () => {}, { title: 'TEST' }); settle();
        const r = rec0(); UI.settingsPage(r, [], vals, () => {}, { title: 'TEST' });
        return r.drawn.filter((d) => d[1] === UI.C.dark).map((d) => d[0]).sort().join(',');
    };
    assert.strictEqual(lit({ demo: 'auto' }), lit({ demo: 'off' }));
    assert.notStrictEqual(lit({ demo: 'auto' }), lit({ demo: 'on' }));
    const rec = rec0();
    let got = null;
    UI.settingsPage(rec, [], { demo: 'auto' }, (k, v) => { got = [k, v]; }, { title: 'TEST' });
    rec.targets.filter((q) => q.key === 'p96seg|set|demo|1')[0].run();
    assert.deepStrictEqual(got, ['demo', 'on']);
});

/* ---------- nothing turns it on by itself ---------- */

test('the kit car.js never starts its demo drive: no car for a minute, demo saved as auto or missing', () => {
    const Car = require(path.join(RT, 'car'));
    [{ demo: 'auto' }, {}, { demo: 'off' }].forEach((vals) => {
        const self = { ctx: { settings: UI.demoSettings(store(vals)) }, carPresent: () => false, t0: Date.now() - 60000 };
        assert.strictEqual(Car.prototype._wantDemo.call(self), false, JSON.stringify(vals));
    });
    const on = { ctx: { settings: UI.demoSettings(store({ demo: 'on' })) }, carPresent: () => true, t0: Date.now() };
    assert.strictEqual(Car.prototype._wantDemo.call(on), true);
});
test('no app decides on demo by itself: every demo test is the setting through UI.demoOn', () => {
    APPS.forEach((id) => {
        const dir = path.join(ROOT, 'apps', id);
        fs.readdirSync(dir).filter((f) => /\.js$/.test(f)).forEach((f) => {
            const src = fs.readFileSync(path.join(dir, f), 'utf8');
            assert.ok(!/demo[A-Za-z]*\(\)\s*===\s*'auto'/.test(src), id + '/' + f + ': an auto demo');
            assert.ok(!/get\('demo'\)\s*\|\|\s*'auto'/.test(src), id + '/' + f + ': demo defaults to auto');
            assert.ok(!/val\('demo'\)\s*;?\s*\n\s*return d === 'on' \|\|/.test(src), id + '/' + f + ': demo turns on without the setting');
            (src.match(/const (useDemo|usingDemo) = [^\n]*/g) || []).forEach((line) => assert.ok(/UI\.demoOn\(/.test(line), id + '/' + f + ': ' + line));
        });
    });
    const dl = fs.readFileSync(path.join(ROOT, 'apps', 'p96_datalog', 'main.js'), 'utf8');
    assert.ok(/demo: \(\) => UI\.demoOn\(settings\.get\('demo'\)\)/.test(dl), 'Datalog: the model follows the setting');
    assert.ok(/new Car\(carCtx/.test(dl) && /UI\.demoSettings\(settings\)/.test(dl), 'Datalog: car.js sees only on or off');
});
test('Datalog: with the demo off and no car the header says WAIT, the model shows no demo', () => {
    const { Model } = require(path.join(ROOT, 'apps', 'p96_datalog', 'model'));
    const s = store({});
    const m = new Model({ settings: s, demo: () => UI.demoOn(s.get('demo')), live: () => false });
    m.tick(Date.now() + 60000);
    assert.strictEqual(m.isDemo(), false);
    assert.strictEqual(m.isLive(), false);
    assert.strictEqual(m.v.demo, false);
});

/* ---------- the DEMO pill ---------- */

test('header: demo on draws the DEMO pill where LIVE sits; tapping it runs onDemo', () => {
    let off = 0;
    const rec = rec0();
    UI.header(rec, { status: 'LIVE', demo: true, onDemo: () => { off++; }, onHelp: () => {}, onSettings: () => {} });
    const t = targets(rec, 'p96demo');
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].x, UI.pillX(rec));
    t[0].run();
    assert.strictEqual(off, 1);
    assert.ok(words(rec).indexOf('DEMO') >= 0 && words(rec).indexOf('LIVE') < 0);
    assert.strictEqual(UI.isDemoShown(), true);
});
test('header: demo off has no DEMO target and cards carry no mark', () => {
    const rec = new Recorder(1600, 520);
    UI.header(rec, { status: 'LIVE', demo: false, onDemo: () => {} });
    assert.strictEqual(targets(rec, 'p96demo').length, 0);
    assert.strictEqual(UI.isDemoShown(), false);
    const c = rec0();
    UI.card(c, 28, 112, 300, 140, 'Oil', {});
    assert.ok(words(c).indexOf('DEMO') < 0);
});
test('cards drawn while the demo is on say DEMO', () => {
    UI.setDemo(true);
    const c = rec0();
    UI.card(c, 28, 112, 300, 140, 'Oil', {});
    UI.stat(c, 340, 112, 300, 140, { label: 'Coolant', value: 90, unit: '°C' });
    const n = words(c).filter((w) => w === 'DEMO').length;
    UI.setDemo(false);
    assert.ok(n >= 2, 'marks: ' + n);
});
test('the DEMO badge (a page without our header): drawn and tappable only while on', () => {
    let off = 0;
    const rec = new Recorder(1600, 520);
    UI.demoBadge(rec, 100, 50, true, () => { off++; });
    targets(rec, 'p96demo')[0].run();
    assert.strictEqual(off, 1);
    const r2 = new Recorder(1600, 520);
    UI.demoBadge(r2, 100, 50, false, () => { off++; });
    assert.strictEqual(targets(r2, 'p96demo').length, 0);
});

/* ---------- each app's pill turns the demo off ---------- */

test('Datalog: the DEMO pill sets Demo data to off', () => {
    const { Model } = require(path.join(ROOT, 'apps', 'p96_datalog', 'model'));
    const P = require(path.join(ROOT, 'apps', 'p96_datalog', 'pages'));
    const s = store({ demo: 'on' });
    const m = new Model({ settings: s, demo: () => UI.demoOn(s.get('demo')), live: () => false });
    m.tick(Date.now());
    const rec = new Recorder(1600, 520);
    P.draw(rec, m, 1);
    targets(rec, 'p96demo')[0].run();
    assert.strictEqual(s.get('demo'), 'off');
});
test('Standby: the pill, and with the menu faded the badge on top of it, turn the demo off', () => {
    const M = require(path.join(ROOT, 'apps', 'p96_standby', 'model'));
    const P = require(path.join(ROOT, 'apps', 'p96_standby', 'pages'));
    const now = new Date(2026, 10, 26, 21, 47).getTime();
    const v = M.Demo.values(now);
    v.outsideHist = [5, 4]; v.voltsHist = [12.6, 12.6]; v.drives = M.Demo.drives(now); v.has = () => true;
    let off = 0;
    const act = { tab() {}, help() {}, settings() {}, back() {}, topic() {}, set() {}, wake() {}, demoOff: () => { off++; } };
    const st = { page: 'main', tab: 0, topic: 0, settings: Object.assign({}, P.DEFAULTS, { demo: 'on' }), status: 'LIVE', statusColor: 'ok', demo: true, now: now, menuA: 1, nightP: 0 };
    const a = new Recorder(1600, 520);
    P.draw(a, v, st, 1, act);
    targets(a, 'p96demo')[0].run();
    const b = new Recorder(1600, 520);
    P.draw(b, v, Object.assign({}, st, { menuA: 0 }), 1, act);
    const t = targets(b, 'p96demo');
    assert.strictEqual(t.length, 1, 'the badge with the menu gone');
    assert.ok(b.targets.indexOf(t[0]) < b.targets.indexOf(targets(b, 'sbwake')[0]), 'the badge wins over the wake tap');
    t[0].run();
    assert.strictEqual(off, 2);
});
test('Health and Exhaust: the header gets demo and onDemo from the app (A.demoOff)', () => {
    ['p96_health', 'p96_exhaust'].forEach((id) => {
        const view = fs.readFileSync(path.join(ROOT, 'apps', id, 'view.js'), 'utf8');
        const main = fs.readFileSync(path.join(ROOT, 'apps', id, 'main.js'), 'utf8');
        assert.ok(/demo: !!S\.demo, onDemo: A\.demoOff/.test(view), id + ' view');
        assert.ok(/demoOff: \(\) => \{ settings\.set\('demo', 'off', 'user'\)/.test(main), id + ' main');
    });
});
test('How to use: every app ends with the Demo data topic', () => {
    assert.ok(UI.DEMO_TOPIC && /DEMO/.test(UI.DEMO_TOPIC.text) && typeof UI.DEMO_TOPIC.draw === 'function');
    const rec = new Recorder(1600, 520);
    [0, 1, 2, 3.5].forEach((t) => UI.DEMO_TOPIC.draw(rec, 438, 128, 568, 360, t));
    assert.ok(require(path.join(ROOT, 'apps', 'p96_standby', 'pages')).TOPICS.indexOf(UI.DEMO_TOPIC) >= 0);
    ['p96_health', 'p96_exhaust', 'p96_datalog'].forEach((id) => {
        const f = id === 'p96_datalog' ? 'pages.js' : 'view.js';
        assert.ok(/concat\(\[UI\.DEMO_TOPIC[\],]/.test(fs.readFileSync(path.join(ROOT, 'apps', id, f), 'utf8')), id);
    });
});

let failed = 0;
tests.forEach(([name, fn]) => {
    try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
});
console.log(tests.length + ' tests, ' + failed + ' failed');
if (failed) process.exit(1);
