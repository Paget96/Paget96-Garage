// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Exhaust's demo data: a made-up car with everything (a filter, one flap, a week of drives, eight weeks of
 * regenerations), for the screenshots and for a head unit with no car. Values move a little with the time, so the
 * pages look alive. Nothing here is ever sent anywhere.
 */
const R = require('./rules');
const M = require('./model');

const DAY = M.DAY, MIN = M.MIN;

/** The car's values at time t (ms): a steady drive at about 3 400 rpm in Sport, the exhaust warm. */
function values(t) {
    const s = t / 1000, w = Math.sin(s / 7), w2 = Math.sin(s / 3.1);
    return { rpm: 3400 + 260 * w, speed: 92 + 6 * w, gear: 3, mode: 1, coolant: 91, outside: 4, soot: 9.1, ash: 14, load: 38,
        pfTemp: 560 + 12 * w2, egt: 640 + 14 * w, exVanos: 12.5 + w, engLoad: 72 + 6 * w2 };
}
/** The last 60 s of a value, one sample a second, ending at t. */
function last60(t, key, f) {
    const out = [];
    for (let i = 59; i >= 0; i--) out.push(f(t - i * 1000));
    return out;
}

/** The whole demo state at `now`. */
function state(now) {
    const v = values(now);
    const rise = (from, to) => (q) => from + (to - from) * (1 - Math.exp(-3 * (q / 60000 + 0.2)));
    const hist = {
        egt: last60(now, 'egt', (q) => rise(520, 640)(q - now + 60000)),
        load: last60(now, 'load', (q) => 30 + 8 * (q - now + 60000) / 60000),
        rpm: last60(now, 'rpm', (q) => rise(1800, 3400)(q - now + 60000)),
        seq: Math.floor(now / 1000),
    };
    // regenerations, newest first (km: the app's own count since it was installed)
    const regens = [
        { start: now - 5 * DAY, mins: 18, loadBefore: 80, loadAfter: 20, peak: 640, km: 4820, cut: false },
        { start: now - 19 * DAY, mins: 22, loadBefore: 80, loadAfter: 25, peak: 655, km: 3940, cut: false },
        { start: now - 36 * DAY, mins: 20, loadBefore: 78, loadAfter: 20, peak: 630, km: 3030, cut: false },
        { start: now - 50 * DAY, mins: 7, loadBefore: 80, loadAfter: 52, peak: 610, km: 2250, cut: true },
        { start: now - 51 * DAY, mins: 19, loadBefore: 81, loadAfter: 22, peak: 648, km: 2220, cut: false },
    ];
    // the filter load over 8 weeks: rising between regenerations, a drop at each
    const loads = [], loadsKm = [];
    const shape = [10, 30, 55, 78, 20, 40, 62, 80, 25, 45, 70, 38];
    for (let d = 0; d < 56; d++) {
        const f = d / 55 * (shape.length - 1), i = Math.floor(f), k = f - i;
        const val = i + 1 < shape.length ? shape[i] + (shape[i + 1] - shape[i]) * k : shape[i];
        loads.push([now - (55 - d) * DAY, Math.round(val * 10) / 10]);
        loadsKm.push([d * 90, val]);
    }
    // a week of drives: mostly short ones
    const lens = [3, 4, 2, 6, 8, 4, 9, 12, 3, 25, 7, 14];
    const drives = lens.map((m, i) => ({ start: now - (i + 0.5) * 13 * 3600000, mins: m }));
    // ash over km
    const ash = [[0, 0], [1200, 0.4], [2400, 0.8], [3600, 1.1], [4800, 1.5], [5200, 1.6]].map((p) => [p[0] * 9.2, p[1] * 8.75]);
    // this morning's cold start: the exhaust after the catalyst and the coolant, every 5 s for 5 minutes
    const warm = [];
    for (let s = 0; s <= 300; s += 5) {
        const egt = 4 + 476 * (1 - Math.exp(-s / 120)) * Math.min(1, s / 18 + 0.15);
        warm.push([s, Math.round(egt), Math.round(4 + 80 * (1 - Math.exp(-s / 260)))]);
    }
    const starts = [];
    for (let i = 0; i < 16; i++) starts.push({ t: now - (i + 0.3) * 0.45 * DAY, coolant: i % 4 === 3 ? 70 : 8, mins: [3, 12, 4, 20, 2, 9, 4, 30, 15, 3, 25, 18, 40, 22, 9, 35][i] });
    // the flap's log, newest first
    const at = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.getTime(); };
    const flapLog = [
        { t: at(18, 42), action: 'OPEN', rule: 'Above 3 000 rpm', reason: 'Above 3 000 rpm', detail: '3 120 rpm, 3rd gear' },
        { t: at(18, 41), action: 'OEM', rule: null, reason: 'no rule matched', detail: 'back under 2 500 rpm' },
        { t: at(18, 30), action: 'OPEN', rule: 'Sport mode', reason: 'Sport mode', detail: 'Sport selected' },
        { t: at(18, 12, 30), action: 'CLOSED', rule: 'Quiet start', reason: 'Quiet start', detail: 'coolant 31 °C' },
        { t: at(18, 12), action: 'CLOSED', rule: 'Quiet start', reason: 'Quiet start', detail: 'engine started' },
    ];
    // the week before, for the time per state and per rule
    const week = [];
    for (let d = 1; d <= 6; d++) {
        const b = now - d * DAY;
        week.push({ t: b - 140 * MIN, action: 'CLOSED', rule: 'Quiet start' }, { t: b - 125 * MIN, action: 'OPEN', rule: 'Sport mode' },
            { t: b - 106 * MIN, action: 'OPEN', rule: 'Above 3 000 rpm' }, { t: b - 79 * MIN, action: 'OEM', rule: null },
            { t: b - 40 * MIN, action: 'OPEN', rule: 'Full throttle' }, { t: b - 34 * MIN, action: 'CLOSED', rule: 'Town speed' }, { t: b - 2 * MIN, action: 'OEM', rule: null, off: true });
    }
    return {
        demo: true, at: now, caps: M.ALL_CAPS, v: v, hist: hist,
        regens: regens, regen: null, loads: loads, loadsKm: loadsKm, drives: drives, ash: ash, kmNow: 5200 * 9.2,
        warm: warm, warmWhen: 'This morning', warmOutside: 4, lightOffs: [190, 175, 182, 168, 170, 165, 172, 160, 162, 160],
        starts: starts, flapLog: flapLog, flapWeekLog: flapLog.slice().reverse().concat(week),
        setup: { downpipe: 'stock', cat: 'stock', opf: 'stock', mid: 'resdelete', rear: 'stock', flaps: '1' },
        setupFound: { cat: true, opf: true, flaps: 1 },
    };
}

/** The regeneration screen in demo: one under way for 6 minutes. */
function regenNow() { return { mins: 6, burnt: 2.5, temp: 640, from: 9.1, to: 6.6 }; }

module.exports = { state, values, regenNow, rules: R.defaults };
