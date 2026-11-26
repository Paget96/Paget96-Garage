// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Standby's tests: the clock's fixed digit slots, night dimming, the ice warning, the menu fade, the door panel,
 * drives, and that the pages draw every page with demo values and with a car that reports nothing. Plain node,
 * Node 8 compatible:
 *
 *   node tests/p96_standby.test.js
 */
const assert = require('assert');
const path = require('path');
const APP = path.join(__dirname, '..', 'apps', 'p96_standby');
const M = require(path.join(APP, 'model'));
const P = require(path.join(APP, 'pages'));
const RT = path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime');
const { Recorder } = require(path.join(RT, 'record'));

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const at = (h, m) => new Date(2026, 10, 26, h, m);
// times as this computer keeps them, so the tests pass in any zone (the car's zone: tests/cartime.test.js)
require(path.join(__dirname, '..', 'lib', 'cartime')).source('system');

/* ---------- the clock ---------- */
// a font where every digit has its own width, as real fonts do
const WIDTH = { '0': 60, '1': 38, '2': 55, '3': 56, '4': 61, '5': 54, '6': 58, '7': 50, '8': 59, '9': 58, ':': 22, ' ': 30 };
const widthOf = (ch) => WIDTH[ch];

test('clock: every digit slot is as wide as the widest digit, the colon its own', () => {
    const s = M.digitSlots('21:47', widthOf, 4);
    assert.deepStrictEqual(s.slots.map((q) => q.w), [61, 61, 22, 61, 61]);
    assert.strictEqual(s.w, 4 * 61 + 22 + 4 * 4);
});
test('clock: the slots do not move whatever the digits are', () => {
    const a = M.digitSlots('21:47', widthOf, 4), b = M.digitSlots('11:11', widthOf, 4), c = M.digitSlots('08:00', widthOf, 4);
    assert.deepStrictEqual(a.slots.map((q) => q.x), b.slots.map((q) => q.x));
    assert.deepStrictEqual(a.slots.map((q) => q.x), c.slots.map((q) => q.x));
    assert.strictEqual(a.w, b.w);
});
test('clock: every minute of the day keeps the same slots (24 h and 12 h)', () => {
    ['24', '12'].forEach((fmt) => {
        const ref = M.digitSlots(M.timeText(at(0, 0), fmt).text, widthOf, 4);
        for (let m = 0; m < 24 * 60; m++) {
            const s = M.digitSlots(M.timeText(at(Math.floor(m / 60), m % 60), fmt).text, widthOf, 4);
            assert.strictEqual(s.w, ref.w, fmt + ' ' + m);
            assert.deepStrictEqual(s.slots.map((q) => q.x), ref.slots.map((q) => q.x));
        }
    });
});
test('clock: 24 h and 12 h texts', () => {
    assert.deepStrictEqual(M.timeText(at(7, 5), '24'), { text: '07:05', ampm: '' });
    assert.deepStrictEqual(M.timeText(at(21, 47), '24'), { text: '21:47', ampm: '' });
    assert.deepStrictEqual(M.timeText(at(21, 47), '12'), { text: ' 9:47', ampm: 'PM' });
    assert.deepStrictEqual(M.timeText(at(0, 3), '12'), { text: '12:03', ampm: 'AM' });
    assert.deepStrictEqual(M.timeText(at(12, 0), '12'), { text: '12:00', ampm: 'PM' });
    assert.strictEqual(M.dateText(at(21, 47)), 'Thursday, 26 November');
    assert.strictEqual(M.shortTime(at(21, 47).getTime(), '12'), '9:47 PM');
});

/* ---------- night ---------- */
test('night: on and off win over everything', () => {
    assert.strictEqual(M.isNight('on', false, at(12, 0)), true);
    assert.strictEqual(M.isNight('off', true, at(23, 0)), false);
});
test('night: auto follows the car when it says day or night', () => {
    assert.strictEqual(M.isNight('auto', true, at(12, 0)), true);
    assert.strictEqual(M.isNight('auto', false, at(23, 0)), false);
});
test('night: auto without the car uses 20:00 to 07:00', () => {
    assert.strictEqual(M.isNight('auto', null, at(19, 59)), false);
    assert.strictEqual(M.isNight('auto', null, at(20, 0)), true);
    assert.strictEqual(M.isNight('auto', null, at(3, 0)), true);
    assert.strictEqual(M.isNight('auto', null, at(6, 59)), true);
    assert.strictEqual(M.isNight('auto', null, at(7, 0)), false);
});
test('night: the car\'s day / night value, names and numbers', () => {
    assert.strictEqual(M.nightOf({ dayNightChangeOver: 'NACHT' }), true);
    assert.strictEqual(M.nightOf({ dayNightChangeOver: 1 }), false);
    assert.strictEqual(M.nightOf(2), true);
    assert.strictEqual(M.nightOf({ dayNightChangeOver: 'KEINE_AENDERUNG' }), null);
    assert.strictEqual(M.nightOf({ dayNightChangeOver: 3 }), null);
});
test('night: the colour glides from white to the warm dark colour', () => {
    assert.strictEqual(M.mixColour('#ecf0f5', M.NIGHT_TEXT, 0), '#ecf0f5');
    assert.strictEqual(M.mixColour('#ecf0f5', M.NIGHT_TEXT, 1), M.NIGHT_TEXT);
    assert.strictEqual(M.mixColour('#000000', '#ffffff', 0.5), '#808080');
    const n = parseInt(M.NIGHT_TEXT.slice(1), 16);
    assert.ok((n >> 16) > (n & 255) * 1.4, 'warm: more red than blue');
    assert.ok((n >> 16) < 0xb0, 'dark');
});

/* ---------- the ice warning ---------- */
test('ice: below 3 °C possible, below 0 likely, else none', () => {
    assert.strictEqual(M.iceRisk(3).level, 'none');
    assert.strictEqual(M.iceRisk(2.9).level, 'possible');
    assert.strictEqual(M.iceRisk(0).level, 'possible');
    assert.strictEqual(M.iceRisk(-0.5).level, 'likely');
    assert.strictEqual(M.iceRisk(20).level, 'none');
    assert.strictEqual(M.iceRisk(null), null);
    assert.strictEqual(M.iceRisk(NaN), null);
});

/* ---------- the menu ---------- */
test('menu: stays for the delay, fades out, never with 0', () => {
    assert.strictEqual(M.menuAlpha(0, 9999, 10), 1);
    assert.strictEqual(M.menuAlpha(0, 10000, 10), 1);
    const mid = M.menuAlpha(0, 10000 + M.MENU_FADE_MS / 2, 10);
    assert.ok(mid > 0.4 && mid < 0.6, String(mid));
    assert.strictEqual(M.menuAlpha(0, 10000 + M.MENU_FADE_MS, 10), 0);
    assert.strictEqual(M.menuAlpha(0, 99999999, 0), 1);
    assert.strictEqual(M.menuAlpha(0, 99999999, '0'), 1);
    assert.strictEqual(M.menuAlpha(0, 5200, '5'), 0.75);
});

/* ---------- doors ---------- */
test('doors: open switches named, closed list empty, no door field null', () => {
    assert.deepStrictEqual(M.doorsOf({ statusDoorSwitchDRD: 0, statusDoorSwitchPSD: 0, statusDoorSwitchDRDR: 0, statusDoorSwitchPSDR: 0 }), []);
    assert.deepStrictEqual(M.doorsOf({ statusDoorSwitchDRD: 'TUER_OFFEN', statusDoorSwitchPSD: 'TUER_GESCHLOSSEN', statusDoorSwitchPSDR: 1 }), ['driver', 'rear right']);
    assert.strictEqual(M.doorsOf({ other: 1 }), null);
    assert.strictEqual(M.windowsOf({ statusDoorSwitchDRD: 0 }), null);
    assert.deepStrictEqual(M.windowsOf({ positionWindowDR: 0, positionWindowPS: 40 }), { open: 1, of: 2 });
    assert.strictEqual(M.lockOf({ statusCentralLocking: 'VERRIEGELT' }), true);
    assert.strictEqual(M.lockOf({ statusCentralLocking: 'ENTRIEGELT' }), false);
    assert.strictEqual(M.lockOf({ statusDoorSwitchDRD: 0 }), null);
});
test('seat level and one(): lists of zones, levels capped at 3', () => {
    assert.strictEqual(M.seatLevel(2), 2);
    assert.strictEqual(M.seatLevel(7), 3);
    assert.strictEqual(M.seatLevel(15), null);
    assert.strictEqual(M.one({ list: [{ statusSeatHeaterDR: 1 }] }, 'statusSeatHeaterDR'), 1);
});

/* ---------- drives ---------- */
test('drives: a drive from the speed, ends after 3 minutes standing', () => {
    const d = new M.Drives();
    const t0 = at(8, 0).getTime();
    let t = t0;
    for (; t <= t0 + 600000; t += 1000) d.feed(t, 60, 4, 7.2);        // 10 min at 60 km/h
    const s = d.summary(t);
    assert.ok(Math.abs(s.km - 10) < 0.05, String(s.km));
    assert.ok(s.live);
    assert.ok(Math.abs(s.avg - 60) < 1, String(s.avg));
    assert.strictEqual(s.fuel, 7.2);
    for (let k = 0; k < 200; k++, t += 1000) d.feed(t, 0, 3, 7.2);
    assert.strictEqual(d.cur, null);
    const day = d.day(t);
    assert.strictEqual(day.n, 1);
    assert.strictEqual(day.pts[day.pts.length - 1][1] > 9.9, true);
    assert.strictEqual(d.summary(t).lo, 3);
});
test('drives: gaps in the data are not counted, a roll is no drive, yesterday drops', () => {
    const d = new M.Drives();
    const t0 = at(9, 0).getTime();
    d.feed(t0, 50, null, null); d.feed(t0 + 60000, 50, null, null);
    assert.strictEqual(d.cur.km, 0);
    const e = new M.Drives();
    e.feed(t0, 5, null, null); e.feed(t0 + 1000, 5, null, null); e.finish();
    assert.strictEqual(e.list.length, 0);
    const f = M.Demo.drives(at(20, 0).getTime());
    assert.strictEqual(f.day(at(20, 0).getTime()).n, 3);
    assert.strictEqual(f.day(at(20, 0).getTime() + 86400000).n, 0);
});

/* ---------- the pages draw ---------- */
const ACT = { tab() {}, help() {}, settings() {}, back() {}, topic() {}, set() {}, wake() {} };
function drawAll(v, st) {
    const out = [];
    [0, 1, 2].forEach((tab) => {
        const rec = new Recorder(1600, 520);
        P.draw(rec, v, Object.assign({}, st, { tab: tab }), 1, ACT);
        out.push(rec);
    });
    return out;
}
const baseSt = { page: 'main', topic: 0, settings: Object.assign({}, P.DEFAULTS), status: 'LIVE', statusColor: 'ok', now: at(21, 47).getTime(), menuA: 1, nightP: 0 };
test('pages: demo values draw every page, tabs are targets', () => {
    const v = M.Demo.values(baseSt.now);
    v.outsideHist = [5, 4]; v.voltsHist = [12.6, 12.6]; v.drives = M.Demo.drives(baseSt.now); v.has = () => true;
    drawAll(v, baseSt).forEach((r) => assert.ok(r.targets.some((q) => q.key === 'p96tab1')));
    assert.strictEqual(P.glanceCards(v).length, 6);
});
test('pages: a car that reports nothing shows no cards and no small values', () => {
    const v = { has: () => false, drives: new M.Drives(), seats: {} };
    assert.strictEqual(P.glanceCards(v).length, 0);
    drawAll(v, baseSt);
});
test('pages: only what the car reports (outside and range only)', () => {
    const v = { outside: 1, range: 300, has: (k) => k === 'outside' || k === 'range', drives: new M.Drives(), seats: {} };
    const c = P.glanceCards(v);
    assert.deepStrictEqual(c.map((x) => x.g.label), ['Outside', 'Range']);
    assert.strictEqual(c[0].g.color, 'info');
});
test('pages: with the menu faded the tabs and buttons are no targets, a tap anywhere wakes it', () => {
    const v = { has: () => false, drives: new M.Drives(), seats: {} };
    const rec = new Recorder(1600, 520);
    P.draw(rec, v, Object.assign({}, baseSt, { tab: 0, menuA: 0 }), 1, ACT);
    assert.ok(!rec.targets.some((q) => /^p96(tab|help|settings)/.test(q.key)));
    const w = rec.targets.filter((q) => q.key === 'sbwake')[0];
    assert.ok(w && w.y === 0 && w.h === 520);
});
test('pages: Settings and How to use draw', () => {
    const v = { has: () => false, drives: new M.Drives(), seats: {} };
    ['settings', 'help'].forEach((p) => { const rec = new Recorder(1600, 520); P.draw(rec, v, Object.assign({}, baseSt, { page: p }), 1, ACT); });
    assert.deepStrictEqual(P.APP_ROWS.map((r) => r.key), ['clock', 'night', 'menuDelay']);
});

let failed = 0;
tests.forEach((t) => {
    try { t[1](); console.log('ok   ' + t[0]); }
    catch (e) { failed++; console.log('FAIL ' + t[0] + '\n     ' + (e && e.stack || e)); }
});
console.log(tests.length + ' tests, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
