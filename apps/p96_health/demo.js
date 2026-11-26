// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Demo data: what Health shows with the setting Demo data on (or Auto while the car sends nothing). Realistic values
 * for a B48 car with 48 000 km: two stored faults, a rear left tyre that slowly loses air, a healthy battery.
 * Built for a given "now", so the dates on every page line up.
 */
const M = require('./model');
const DAY = M.DAY;

const f = (code, status, mem) => ({ code: code, status: status, mem: mem || 'fault' });

/** The scan: units and their memories. */
function units() {
    return [
        { addr: 0x12, dtcs: [f('120408', 0x08), f('CD8E41', 0x08, 'info'), f('482FE1', 0x08, 'info'), f('480A12', 0x08, 'info')] },
        { addr: 0x40, dtcs: [f('801C20', 0x08)] },
        { addr: 0x18, dtcs: [f('CD8E40', 0x08, 'info'), f('CF1402', 0x08, 'info')] },
        { addr: 0x29, dtcs: [] }, { addr: 0x01, dtcs: [] }, { addr: 0x43, dtcs: [] }, { addr: 0x60, dtcs: [] },
        { addr: 0x30, dtcs: [] }, { addr: 0x78, dtcs: [] }, { addr: 0x63, dtcs: [] },
    ];
}

/** The fault log with eight weeks of scans behind it (I9). */
function faultLog(now) {
    const ev = (d, km, kind) => ({ t: now - d * DAY, km: km, kind: kind });
    return {
        faults: {
            '18:120408:fault': { addr: 0x12, code: '120408', mem: 'fault', status: 0x08,
                events: [ev(38, 46900, 'first'), ev(31, 47350, 'again'), ev(2, 48120, 'again')] },
            '64:801C20:fault': { addr: 0x40, code: '801C20', mem: 'fault', status: 0x08, events: [ev(9, 47880, 'first')] },
            '18:2A8200:fault': { addr: 0x12, code: '2A8200', mem: 'fault', status: 0x08,
                events: [ev(49, 44800, 'first'), ev(34, 46010, 'cleared')] },
            '16:CD0487:fault': { addr: 0x10, code: 'CD0487', mem: 'fault', status: 0x08,
                events: [ev(38.5, 45900, 'first'), ev(35.5, 46100, 'gone'), ev(25, 46700, 'again'), ev(21.5, 46950, 'gone')] },
        },
        last: ['18:120408:fault', '64:801C20:fault'],
        units: [0x12, 0x40, 0x18, 0x29, 0x01, 0x43, 0x60, 0x30, 0x78, 0x63, 0x10],
        lastAt: now,
    };
}

/** How many times each demo fault was seen (the fault list's "seen 3 times"). */
const SEEN = { '120408': { count: 3, lastDays: 2, km: 48120 }, '801C20': { count: 1, lastDays: 9, km: 47880 } };

/** The freeze frame the engine unit kept for 120408 (shown on the details). */
const SNAPSHOT = {
    '120408': { rows: [['Engine speed', '4 850 rpm'], ['Load', '92 %'], ['Boost wanted', '1.42 bar'], ['Boost measured', '1.18 bar'],
        ['Charge air', '41 °C'], ['Coolant', '96 °C'], ['Km', '48 120'], ['Battery', '14.1 V']] },
    '801C20': { rows: [['Window', 'moving up'], ['Motor current', '0.0 A'], ['Door', 'closed'], ['Km', '47 880'], ['Battery', '12.4 V']] },
};

/** A daily series ending now: fn(i of n) per day. */
const days = (now, n, fn) => { const out = []; for (let i = 0; i < n; i++) out.push([now - (n - 1 - i) * DAY, fn(i, n)]); return out; };

function state(now) {
    now = now || Date.now();
    const wob = (i, a, b) => Math.sin(i * a + b);
    return {
        at: now, km: 48150,
        units: units(),
        log: faultLog(now),
        seen: SEEN,
        snapshots: SNAPSHOT,
        cc: 0,
        battery: {
            rest: 12.62, restAt: now - 3 * 3600000, startMin: 10.4, soc: 82,
            nights: days(now, 14, (i) => 12.64 + 0.03 * wob(i, 0.9, 0.3) - (i > 4 && i < 9 ? 0.04 : 0)),
            starts: days(now, 14, (i) => 10.4 + 0.08 * wob(i, 1.3, 1)),
            socHist: [80, 81, 83, 84, 84, 83, 82, 81, 81, 82, 82, 82],
        },
        cbs: [
            { id: 0x01, way: '4 200 km', date: '09/2027', colour: 3 },
            { id: 0x03, way: '', date: dueIn(now, 8), colour: 3 },
            { id: 0x02, way: '22 000 km', date: '', colour: 3 },
            { id: 0x06, way: '31 000 km', date: '', colour: 3 },
            { id: 0x64, way: '', date: dueIn(now, 14), colour: 3 },
        ],
        used: { oil: 7200, plugs: 30500, air: 12000, gearbox: 33000, coolant: 2 },
        parts: ['Oil filter', 'Engine oil', 'Spark plugs', 'Front pads'],
        partsOff: ['Air filter'],
        pressures: { FL: 2.20, FR: 2.21, RL: 2.10, RR: 2.19 },
        cold: {
            FL: days(now, 28, (i) => 2.20 + 0.005 * wob(i, 2.1, 0)),
            FR: days(now, 28, (i) => 2.21 + 0.005 * wob(i, 1.7, 1)),
            RL: days(now, 28, (i, n) => 2.22 - 0.12 * i / (n - 1) + 0.004 * wob(i, 2.3, 2)),
            RR: days(now, 28, (i) => 2.19 + 0.005 * wob(i, 1.9, 3)),
        },
        fluids: { oilCl: 55, oilTemp: 104, coolantTemp: 92, coolantLow: false, washerLow: true },
        warm: (function () {
            const oil = [], cool = [];
            for (let i = 0; i <= 20; i++) {
                const m = i / 2;
                oil.push(20 + 84 * (1 - Math.exp(-m / 4.2)));
                cool.push(Math.min(92, 20 + 80 * (1 - Math.exp(-m / 2.6))));
            }
            return { oil: oil, coolant: cool, minutes: 10 };
        })(),
        scores: days(now, 84, (i) => 92 - 6 * i / 83 + 1.2 * wob(i, 0.35, 0.5)),
        changes: [
            { t: now - 2 * DAY, kind: 'warm', text: 'Charge air pressure fault stored' },
            { t: now - 9 * DAY, kind: 'warm', text: 'Rear left door fault stored' },
            { t: now - 21 * DAY, kind: 'warm', text: 'Rear left tyre started to lose air' },
            { t: now - 42 * DAY, kind: 'ok', text: 'Oil service done, score +3' },
        ],
    };
}
/** "MM/YYYY" n months from now. */
function dueIn(now, n) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + n);
    return ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
}

module.exports = { state, units, faultLog, SEEN, SNAPSHOT };
