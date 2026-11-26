// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * The car's time (lib/cartime.js): the summer time rules (EU and UK, US), each zone's offset, Auto on a head unit
 * that keeps UTC (Central Europe) and on one that keeps its own zone, carTime() / fromCar() whatever zone this
 * computer runs in, the clock under the app name, and the Time zone row on the Display card. Plain node, Node 8
 * compatible:
 *
 *   node tests/cartime.test.js
 */
const assert = require('assert');
const path = require('path');
const T = require(path.join(__dirname, '..', 'lib', 'cartime'));
const UI = require(path.join(__dirname, '..', 'lib', 'ui'));
const { Recorder } = require(path.join(__dirname, '..', 'kit', 'runtime', 'record'));

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi || 0);
const MIN = 60000;

/* ---------- the rules ---------- */

test('nthSunday: last Sunday of March and October, second of March, first of November', () => {
    assert.strictEqual(T.nthSunday(2026, 2, -1, 1), utc(2026, 3, 29, 1));
    assert.strictEqual(T.nthSunday(2026, 9, -1, 1), utc(2026, 10, 25, 1));
    assert.strictEqual(T.nthSunday(2026, 2, 2, 0), utc(2026, 3, 8, 0));
    assert.strictEqual(T.nthSunday(2026, 10, 1, 0), utc(2026, 11, 1, 0));
    assert.strictEqual(T.nthSunday(2027, 2, -1, 1), utc(2027, 3, 28, 1));   // March 2027 ends on a Wednesday
    assert.strictEqual(T.nthSunday(2025, 9, -1, 1), utc(2025, 10, 26, 1));  // October 2025 ends on a Friday
});

test('EU summer time: from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October', () => {
    assert.strictEqual(T.isSummer('eu', 60, utc(2026, 3, 29, 0, 59)), false);
    assert.strictEqual(T.isSummer('eu', 60, utc(2026, 3, 29, 1)), true);
    assert.strictEqual(T.isSummer('eu', 60, utc(2026, 10, 25, 0, 59)), true);
    assert.strictEqual(T.isSummer('eu', 60, utc(2026, 10, 25, 1)), false);
    assert.strictEqual(T.isSummer('eu', 60, utc(2026, 7, 1, 12)), true);
    assert.strictEqual(T.isSummer('eu', 60, utc(2026, 1, 15, 12)), false);
});

test('US summer time: from 02:00 local on the second Sunday of March to 02:00 local on the first Sunday of November', () => {
    // Eastern: 2026-03-08 02:00 EST = 07:00 UTC; 2026-11-01 02:00 EDT = 06:00 UTC
    assert.strictEqual(T.isSummer('us', -300, utc(2026, 3, 8, 6, 59)), false);
    assert.strictEqual(T.isSummer('us', -300, utc(2026, 3, 8, 7)), true);
    assert.strictEqual(T.isSummer('us', -300, utc(2026, 11, 1, 5, 59)), true);
    assert.strictEqual(T.isSummer('us', -300, utc(2026, 11, 1, 6)), false);
    // Pacific: 10:00 UTC and 09:00 UTC
    assert.strictEqual(T.isSummer('us', -480, utc(2026, 3, 8, 9, 59)), false);
    assert.strictEqual(T.isSummer('us', -480, utc(2026, 3, 8, 10)), true);
    assert.strictEqual(T.isSummer('us', -480, utc(2026, 11, 1, 8, 59)), true);
    assert.strictEqual(T.isSummer('us', -480, utc(2026, 11, 1, 9)), false);
    assert.strictEqual(T.isSummer(null, 0, utc(2026, 7, 1, 12)), false);
});

/* ---------- the zones ---------- */

test('offsets: Central Europe, UK, Eastern Europe, US, fixed ones', () => {
    const winter = utc(2026, 11, 26, 19, 12), summer = utc(2026, 7, 15, 12);
    const o = (id, t) => T.offsetMinutes(id, t, 0);
    assert.strictEqual(o('cet', winter), 60); assert.strictEqual(o('cet', summer), 120);
    assert.strictEqual(o('wet', winter), 0); assert.strictEqual(o('wet', summer), 60);
    assert.strictEqual(o('eet', winter), 120); assert.strictEqual(o('eet', summer), 180);
    assert.strictEqual(o('msk', summer), 180);
    assert.strictEqual(o('india', winter), 330);
    assert.strictEqual(o('useast', winter), -300); assert.strictEqual(o('useast', summer), -240);
    assert.strictEqual(o('uspacific', summer), -420);
    assert.strictEqual(o('arizona', summer), -420);
    assert.strictEqual(o('utc', summer), 0);
    assert.strictEqual(o('utc+3', summer), 180);
    assert.strictEqual(o('utc-5', summer), -300);
    assert.strictEqual(o('utc+14', winter), 840);
});

test('Auto: Central Europe while the head unit keeps UTC, else the head unit\'s own zone', () => {
    const t = utc(2026, 11, 26, 19, 12);
    assert.strictEqual(T.offsetMinutes('auto', t, 0), 60);
    assert.strictEqual(T.offsetMinutes('auto', utc(2026, 7, 1, 12), 0), 120);
    assert.strictEqual(T.offsetMinutes('auto', t, -300), -300);
    assert.strictEqual(T.offsetMinutes('system', t, 0), 0);
    assert.strictEqual(T.offsetMinutes('nonsense', t, 0), 60);     // an unknown saved value is Auto
    assert.strictEqual(T.DEFAULT, 'auto');
});

test('every zone id is unique and has a label', () => {
    const ids = T.ZONES.map((z) => z[0]);
    assert.strictEqual(new Set(ids).size, ids.length);
    T.ZONES.forEach((z) => assert.ok(z[1] && typeof z[1] === 'string'));
    assert.ok(ids.indexOf('utc+1') >= 0 && ids.indexOf('utc-12') >= 0);
});

/* ---------- carTime and fromCar, on any computer ---------- */

test('the owner\'s photo: 19:12 UTC on 26 November is 20:12 in Serbia', () => {
    const t = utc(2026, 11, 26, 19, 12);
    assert.strictEqual(T.hhmm(t, 'cet'), '20:12');
    const d = T.carTime(t, 'cet');
    assert.strictEqual(d.getHours(), 20); assert.strictEqual(d.getMinutes(), 12);
    assert.strictEqual(d.getDate(), 26); assert.strictEqual(d.getDay(), 4);   // Thursday
    assert.strictEqual(T.hhmm(t, 'useast'), '14:12');
    assert.strictEqual(T.hhmm(t, 'utc'), '19:12');
});

test('carTime: the day changes at the car\'s midnight, not at UTC midnight', () => {
    const d = T.carTime(utc(2026, 11, 26, 23, 30), 'cet');
    assert.strictEqual(d.getDate(), 27); assert.strictEqual(d.getHours(), 0);
    assert.strictEqual(T.carTime(utc(2026, 7, 1, 22, 30), 'cet').getHours(), 0);     // CEST
});

test('fromCar: "today at 20:00" in the car is the right UTC moment, summer and winter', () => {
    [['cet', utc(2026, 11, 26, 10), utc(2026, 11, 26, 19)], ['cet', utc(2026, 7, 1, 10), utc(2026, 7, 1, 18)],
        ['useast', utc(2026, 11, 26, 15), utc(2026, 11, 27, 1)]].forEach((c) => {
        const d = T.carTime(c[1], c[0]);
        d.setHours(20, 0, 0, 0);
        assert.strictEqual(T.fromCar(d.getTime(), c[0]), c[2], c[0]);
    });
    const t = utc(2026, 3, 1, 8, 7);
    assert.strictEqual(T.fromCar(T.carTime(t, 'cet').getTime(), 'cet'), t);
});

test('source: the zone comes from the setting, an unknown one falls back to Auto', () => {
    let z = 'useast';
    T.source(() => z);
    assert.strictEqual(T.zone(), 'useast');
    assert.strictEqual(T.carTime(utc(2026, 11, 26, 19, 12)).getHours(), 14);
    z = undefined;
    assert.strictEqual(T.zone(), 'auto');
    T.source('utc+2');
    assert.strictEqual(T.carTime(utc(2026, 11, 26, 19, 12)).getHours(), 21);
    T.source(() => { throw new Error('no settings yet'); });
    assert.strictEqual(T.zone(), 'auto');
    T.source(() => 'auto');
});

/* ---------- lib/ui.js ---------- */

test('the clock under the app name shows the car\'s time', () => {
    T.source('cet');
    const rec = new Recorder(1600, 520);
    const seen = [];
    const text = rec.text.bind(rec);
    rec.text = function (s) { seen.push(s); return text.apply(null, arguments); };
    UI.clock(rec, 28, UI.CLOCK_CY, utc(2026, 11, 26, 19, 12));
    assert.strictEqual(seen.join(''), '20:12');
    T.source('auto');
});

test('the Display card has the Time zone row, every zone in its options, Auto by default', () => {
    const row = UI.DISPLAY_SETTINGS.filter((r) => r.key === 'timeZone')[0];
    assert.ok(row && row.list);
    assert.strictEqual(UI.DISPLAY_DEFAULTS.timeZone, 'auto');
    assert.strictEqual(row.options.length, T.ZONES.length);
    assert.strictEqual(UI.T, T);
});

test('the Time zone stepper walks the list both ways and wraps', () => {
    const rec = new Recorder(1600, 520);
    const got = [];
    UI.settingsPage(rec, [], { timeZone: 'cet' }, (k, v) => got.push([k, v]), { title: 'TEST' });
    const ts = (rec.targets || []).filter((q) => /\|set\|timeZone\|/.test(q.key));
    assert.strictEqual(ts.length, 2);
    ts.forEach((q) => q.run());
    const ids = T.ZONES.map((z) => z[0]), i = ids.indexOf('cet');
    assert.deepStrictEqual(got.map((g) => g[1]).sort(), [ids[i - 1], ids[i + 1]].sort());
    const got2 = [];
    const rec2 = new Recorder(1600, 520);
    UI.settingsPage(rec2, [], { timeZone: 'auto' }, (k, v) => got2.push(v), { title: 'TEST' });
    (rec2.targets || []).filter((q) => /\|set\|timeZone\|-$/.test(q.key)).forEach((q) => q.run());
    assert.deepStrictEqual(got2, [ids[ids.length - 1]]);
});

let failed = 0;
for (const t of tests) {
    try { t[1](); console.log('ok   ' + t[0]); }
    catch (e) { failed++; console.log('FAIL ' + t[0] + '\n     ' + (e && e.stack || e)); }
}
console.log(tests.length + ' tests, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
