// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * The animations in Health's info popups and How to use page: draw(cv, x, y, w, h, t), t in seconds.
 * Data colours are fixed (green ok, amber warm, red bad, blue info, orange data), never the ambient accent.
 * Every line goes through UI.curve or has round caps; every arc is round-ended.
 */
function need(local, repo) {
    try { return require(local); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return require(repo); }
}
const UI = need('./garage_ui', '../../lib/ui');
const C = UI.C;
const GRID = '#282c34', DIM = C.dim, LINE = '#3c4048', GREY = '#969ea8';
const ease = (p) => p * p * (3 - 2 * p);
const loop = (t, s) => (t % s) / s;

/** Axes for a small chart in an illustration: y values right aligned at x, one grid line each. */
function axes(cv, x, y, w, h, lo, hi, step, unit) {
    for (let v = lo; v <= hi + 1e-6; v += step) {
        const yy = y + h - (v - lo) / (hi - lo) * h;
        cv.fillRect(x, Math.round(yy), w, 1, GRID);
        cv.text(v.toFixed(step < 1 ? 1 : 0) + (v + step > hi + 1e-6 && unit ? ' ' + unit : ''), x - 10, yy + 5, 13, DIM, { align: 'right', literal: true });
    }
}

/** The resting voltage: after the engine stops it settles over hours; the honest value is the flat end. */
function rest(cv, x, y, w, h, t) {
    const px = x + 90, pw = w - 190, py = y + 70, ph = h - 150;
    axes(cv, px, py, pw, ph, 12, 14, 0.5, 'V');
    [[12.7, C.green, 'full'], [12.4, C.amber, 'charge it'], [12.0, C.red, 'flat']].forEach((l) => {
        const yy = py + ph - (l[0] - 12) / 2 * ph;
        cv.line(px, yy, px + pw, yy, 1.5, l[1]);
        cv.text(l[2], px + pw + 8, yy + 5, 13, l[1], { literal: true });
    });
    const V = (f) => 12.63 + 1.5 * Math.exp(-f * 7);
    const p = Math.min(1, loop(t, 5) * 1.25), n = 48, pts = [];
    for (let i = 0; i <= n * p; i++) { const f = i / n; pts.push([px + f * pw, py + ph - (V(f) - 12) / 2 * ph]); }
    if (pts.length > 1) UI.curve(cv, pts, 4, C.green);
    const last = pts[pts.length - 1] || [px, py];
    cv.circle(last[0], last[1], 7, C.green);
    cv.text(V(p).toFixed(2) + ' V', x + w / 2, y + 42, 30, C.text, { font: 'bold', align: 'center', literal: true });
    ['stop', '1 h', '2 h', '4 h', '6 h'].forEach((s, i) => cv.text(s, px + pw * [0, 0.17, 0.33, 0.67, 1][i], py + ph + 24, 13, DIM, { align: 'center', literal: true }));
    cv.text('engine off: the voltage settles, then it is the resting voltage', x + w / 2, y + h - 22, 14, DIM, { align: 'center', literal: true });
}

/** The start dip: the starter pulls the voltage down for a moment, then the alternator lifts it above 14 V. */
function start(cv, x, y, w, h, t) {
    const px = x + 90, pw = w - 140, py = y + 70, ph = h - 150;
    axes(cv, px, py, pw, ph, 9, 15, 1.5, 'V');
    const V = (f) => (f < 0.25 ? 12.6 : f < 0.32 ? 12.6 - 2.2 * Math.sin((f - 0.25) / 0.07 * Math.PI / 2) : f < 0.45 ? 10.4 + 3.7 * ease((f - 0.32) / 0.13) : 14.1);
    const p = Math.min(1, loop(t, 4) * 1.2), n = 80, pts = [];
    for (let i = 0; i <= n * p; i++) { const f = i / n; pts.push([px + f * pw, py + ph - (V(f) - 9) / 6 * ph]); }
    if (pts.length > 1) cv.stroke(pts, 4, C.green);
    const ly = py + ph - (9.6 - 9) / 6 * ph;
    cv.line(px, ly, px + pw, ly, 1.5, C.amber);
    cv.text('9.6 V', px + pw - 4, ly - 8, 13, C.amber, { align: 'right', literal: true });
    if (p > 0.3) {
        const dx = px + 0.285 * pw, dy = py + ph - (10.4 - 9) / 6 * ph;
        cv.circle(dx, dy, 7, C.orange);
        cv.text('lowest 10.4 V', dx + 14, dy + 22, 15, C.orange, { font: 'bold', literal: true });
    }
    ['resting', 'cranking', 'charging'].forEach((s, i) => cv.text(s, px + pw * [0.12, 0.3, 0.75][i], py + ph + 24, 13, DIM, { align: 'center', literal: true }));
}

/** The score ring filling to its value, with the six checks lighting up under it. */
function score(cv, x, y, w, h, t) {
    const p = ease(Math.min(1, loop(t, 6) * 2)), v = Math.round(80 * p);
    const cx = x + w / 2, cy = y + h / 2 - 40, r = 100;
    cv.arc(cx, cy, r - 7, r + 7, -135, 135, C.track, { round: true });
    if (p > 0.01) cv.arc(cx, cy, r - 7, r + 7, -135, -135 + 270 * v / 100, C.green, { round: true });
    cv.text(String(v), cx, cy + 22, 64, C.text, { font: 'num', align: 'center', literal: true });
    cv.text('of 100', cx, cy + 50, 16, DIM, { align: 'center', literal: true });
    const checks = [['Faults', C.amber], ['12 V', C.green], ['Oil', C.green], ['Service', C.green], ['Tyres', C.amber], ['Check Control', '#3c4048']];
    checks.forEach((c, i) => {
        const on = p > (i + 1) / 7, cx2 = x + 50 + (i % 3) * (w - 80) / 3, cy2 = y + h - 76 + Math.floor(i / 3) * 36;
        cv.circle(cx2, cy2, 8, on ? c[1] : '#30343c');
        cv.text(c[0], cx2 + 18, cy2 + 6, 15, on ? C.text : DIM, { literal: true });
    });
}

/** A scan: the head unit asks every unit at once, the answers come back, two units hold a fault. */
function faults(cv, x, y, w, h, t) {
    const hx = x + 90, hy = y + h / 2;
    cv.roundRect(hx - 50, hy - 34, 100, 68, 14, '#30343c');
    cv.text('Health', hx, hy + 6, 16, C.text, { font: 'bold', align: 'center', literal: true });
    const units = [['DME', 1], ['BDC', 1], ['EGS', 0], ['DSC', 0], ['ACSM', 0], ['FLE', 0]];
    const p = loop(t, 4);
    units.forEach((u, i) => {
        const ux = x + w - 110, uy = y + 50 + i * (h - 100) / 5;
        const back = p > 0.45 + i * 0.05;
        cv.line(hx + 50, hy, ux - 54, uy, 2, LINE);
        // the question going out, then the answer coming back
        const q = Math.min(1, p / 0.4), a = Math.max(0, Math.min(1, (p - 0.45 - i * 0.05) / 0.3));
        if (q < 1) cv.circle(hx + 50 + (ux - 54 - hx - 50) * q, hy + (uy - hy) * q, 5, C.blue);
        if (a > 0 && a < 1) cv.circle(ux - 54 - (ux - 54 - hx - 50) * a, uy - (uy - hy) * a, 5, u[1] ? C.amber : C.green);
        cv.roundRect(ux - 54, uy - 20, 108, 40, 20, back ? (u[1] ? '#4a3a1e' : '#1e3a2a') : '#24272e');
        cv.text(u[0], ux, uy + 6, 15, back ? (u[1] ? C.amber : C.green) : DIM, { font: 'bold', align: 'center', literal: true });
    });
    cv.text(p > 0.8 ? '2 units hold a fault' : 'asking every unit', hx, hy + 70, 15, p > 0.8 ? C.amber : DIM, { align: 'center', literal: true });
}

/** A car from above with four tyres; the rear left one slowly loses air. */
function tyre(cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2;
    const p = loop(t, 6), rl = 2.22 - 0.12 * ease(Math.min(1, p * 1.3)), k = Math.min(0.95, (h - 50) / 320);
    const tyres = [['FL', -1, -1, 2.20], ['FR', 1, -1, 2.21], ['RL', -1, 1, rl], ['RR', 1, 1, 2.19]], cols = {};
    tyres.forEach((q) => { cols[q[0]] = q[3] < 2.15 ? C.amber : C.green; });
    UI.carWithTyres(cv, cx, cy - 10, k, cols, { RL: (2.22 - rl) * 60 });
    tyres.forEach((q) => {
        const ty = cy - 10 + q[2] * 92 * k, low = q[3] < 2.15;
        cv.text(q[3].toFixed(2) + ' bar', cx + q[1] * 112 * k, ty + 6, 20, low ? C.amber : C.text, { font: 'bold', align: q[1] < 0 ? 'right' : 'left', literal: true });
    });
    cv.text('rear left: -0.03 bar a week', cx, y + h - 20, 15, C.amber, { align: 'center', literal: true });
}

/** Warm-up: coolant climbs first, oil follows slowly. */
function warm(cv, x, y, w, h, t) {
    const px = x + 80, pw = w - 120, py = y + 40, ph = h - 120;
    axes(cv, px, py, pw, ph, 0, 120, 30, '°C');
    const p = Math.min(1, loop(t, 5) * 1.2), n = 40;
    const oil = [], cool = [];
    for (let i = 0; i <= n * p; i++) {
        const m = i / n * 10;
        oil.push([px + i / n * pw, py + ph - (20 + 84 * (1 - Math.exp(-m / 4.2))) / 120 * ph]);
        cool.push([px + i / n * pw, py + ph - Math.min(92, 20 + 80 * (1 - Math.exp(-m / 2.6))) / 120 * ph]);
    }
    if (cool.length > 1) UI.curve(cv, cool, 4, C.blue);
    if (oil.length > 1) UI.curve(cv, oil, 4, C.green);
    ['0', '2', '4', '6', '8', '10 min'].forEach((s, i) => cv.text(s, px + pw * i / 5, py + ph + 22, 13, DIM, { align: 'center', literal: true }));
    cv.roundRect(px, y + h - 30, 20, 6, 3, C.green); cv.text('oil', px + 28, y + h - 22, 14, DIM, { literal: true });
    cv.roundRect(px + 120, y + h - 30, 20, 6, 3, C.blue); cv.text('coolant', px + 148, y + h - 22, 14, DIM, { literal: true });
}

/** A service item counting down by distance, then reset after the work: the bar fills again. */
function cbs(cv, x, y, w, h, t) {
    const p = loop(t, 6), bx = x + 60, bw = w - 120, by = y + h / 2 - 10;
    const f = p < 0.6 ? 0.8 - 0.75 * (p / 0.6) : p < 0.7 ? 0.05 : Math.min(1, 0.05 + 0.95 * ease((p - 0.7) / 0.2));
    cv.text('Engine oil', bx, by - 26, 22, C.text, { font: 'bold', literal: true });
    const km = Math.round(f * 30000 / 100) * 100;
    cv.text(UI_thousands(km) + ' km left', bx + bw, by - 26, 18, f < 0.2 ? C.amber : C.text, { align: 'right', literal: true });
    UI.bar(cv, bx, by, bw, 14, f, f < 0.2 ? 'warm' : 'ok');
    const said = p < 0.6 ? 'the car counts down as you drive' : p < 0.7 ? 'service done, engine off' : 'reset: the car starts again';
    cv.text(said, x + w / 2, by + 60, 16, p >= 0.6 && p < 0.7 ? C.amber : DIM, { align: 'center', literal: true });
}
function UI_thousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

/** A phone reading the QR code: the scan line passes, the text appears. */
function qr(cv, x, y, w, h, t) {
    const qx = x + 60, qy = y + h / 2 - 90, s = 180;
    cv.roundRect(qx - 10, qy - 10, s + 20, s + 20, 14, '#f0f0f0');
    for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) {
        const on = (i < 4 && j < 4) || (i > 10 && j < 4) || (i < 4 && j > 10) || ((i * 7 + j * 13) % 5 < 2);
        if (on) cv.fillRect(qx + i * 12, qy + j * 12, 12, 12, '#141414');
    }
    const p = loop(t, 4), ly = qy + s * Math.min(1, p * 1.6);
    if (p < 0.62) cv.line(qx - 4, ly, qx + s + 4, ly, 3, C.red);
    const px = x + w - 210, py = y + 30;
    cv.roundRect(px, py, 160, h - 60, 24, '#24272e');
    cv.strokeRoundRect(px, py, 160, h - 60, 24, 2, LINE);
    const lines = ['Health 86 of 100', 'Faults: 2 stored', '12 V: 12.62 V', 'Oil: OK', 'Tyres: RL low'];
    lines.forEach((l, i) => { if (p > 0.62 + i * 0.06) cv.text(l, px + 16, py + 50 + i * 30, 14, i ? C.text : C.green, { literal: true }); });
}

/** The engine oil in the sump with the sensor reading its level. */
function oil(cv, x, y, w, h, t) {
    const sx = x + w / 2 - 150, sy = y + 70, sw = 300, sh = 200;
    cv.strokeRoundRect(sx, sy, sw, sh, 30, 3, LINE);
    const lvl = 0.55 + 0.03 * Math.sin(t * 2), top = sy + sh - sh * lvl;
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push([sx + 6 + i * (sw - 12) / 20, top + 4 * Math.sin(t * 3 + i * 0.6)]);
    cv.fillUnder(pts, sy + sh - 6, [70, 210, 130, 60]);
    UI.curve(cv, pts, 3, C.green);
    [['max', 0.85], ['min', 0.3]].forEach((m) => {
        const my = sy + sh - sh * m[1];
        cv.line(sx + sw + 10, my, sx + sw + 40, my, 3, m[0] === 'min' ? C.amber : GREY);
        cv.text(m[0], sx + sw + 48, my + 5, 14, DIM, { literal: true });
    });
    cv.line(sx + 60, sy + sh, sx + 60, sy + sh - 70, 6, GREY);
    cv.circle(sx + 60, sy + sh - 74, 8, C.blue);
    cv.text('level sensor', sx + 76, sy + sh - 70, 14, C.blue, { literal: true });
    cv.text('0.55 l above minimum', x + w / 2, y + h - 22, 16, C.text, { align: 'center', literal: true });
}

/** The cluster with a Check Control message popping up. */
function cc(cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2;
    cv.strokeRoundRect(cx - 200, cy - 90, 400, 180, 40, 3, LINE);
    cv.arc(cx - 110, cy, 56, 62, -135, 135, '#30343c', { round: true });
    cv.arc(cx + 110, cy, 56, 62, -135, 135, '#30343c', { round: true });
    const p = loop(t, 4), on = p > 0.3;
    if (on) {
        const a = Math.min(1, (p - 0.3) / 0.15);
        cv.stroke([[cx - 24, cy + 22], [cx, cy - 22], [cx + 24, cy + 22], [cx - 24, cy + 22]], 4, a > 0.5 ? C.amber : '#5a4a2a');
        cv.text('!', cx, cy + 16, 22, C.amber, { font: 'bold', align: 'center', literal: true });
        cv.text('Low washer fluid', cx, cy + 60, 16, C.amber, { align: 'center', literal: true });
    }
}

/**
 * Readiness: a drive along a road (cold start, town, steady), the monitors turning ready one by one; then a clear of the
 * engine unit sets them all back to not ready, and the loop starts again.
 */
function ready(cv, x, y, w, h, t) {
    const mons = [['Catalyst', 0.55], ['Oxygen sensors', 0.35], ['O2 heaters', 0.15], ['Evap system', 0.8], ['EGR / VVT', 0.45], ['Misfire', 0.05]];
    const p = loop(t, 7), drive = Math.min(1, p / 0.82), cleared = p > 0.86;
    // the road with the car on it
    const rx = x + 40, rw = w - 80, ry = y + 56;
    UI.curve(cv, [[rx, ry], [rx + rw, ry]], 6, '#30343c');
    ['cold start', 'town', 'steady', 'idle'].forEach((s, i) => cv.text(s, rx + rw * (0.06 + i * 0.29), ry + 30, 13, DIM, { align: 'center', literal: true }));
    const cx = rx + rw * (cleared ? 0 : drive);
    cv.roundRect(cx - 18, ry - 13, 36, 20, 8, C.orange);
    cv.circle(cx - 9, ry + 8, 5, '#141414'); cv.circle(cx + 9, ry + 8, 5, '#141414');
    // the monitors
    mons.forEach((m, i) => {
        const col = i % 2, row = Math.floor(i / 2), mx = x + 40 + col * (w - 80) / 2, my = y + 120 + row * 54;
        const on = !cleared && drive >= m[1];
        cv.roundRect(mx, my, (w - 80) / 2 - 16, 42, 14, on ? '#1e3a2a' : '#2a2620');
        cv.circle(mx + 22, my + 21, 7, on ? C.green : C.amber);
        cv.text(m[0], mx + 40, my + 27, 15, C.text, { literal: true });
        cv.text(on ? 'READY' : 'NOT READY', mx + (w - 80) / 2 - 32, my + 27, 13, on ? C.green : C.amber, { font: 'bold', align: 'right', literal: true });
    });
    cv.text(cleared ? 'engine unit cleared: all back to not ready' : drive >= 0.8 ? 'all ready' : 'driving: each self-test runs when its conditions come',
        x + w / 2, y + h - 22, 14, cleared ? C.amber : drive >= 0.8 ? C.green : DIM, { align: 'center', literal: true });
}

const ART = { ready: ready, rest: rest, start: start, score: score, faults: faults, tyre: tyre, warm: warm, cbs: cbs, qr: qr, oil: oil, cc: cc };
/** The art a card's info uses when it names none. */
/* ---------- the engine, per cylinder ---------- */
const E = need('./garage_engine', '../../lib/engine');
/** The engine the animations show (view.js sets it each frame from the car or the demo car). */
let ENGINE = null;
function setEngine(p) { ENGINE = p || null; }
/** The firing order of common BMW engines (the 3 and 12 cylinders: plain order), for the animation only. */
const ORDER = { 3: [1, 3, 2], 4: [1, 3, 4, 2], 6: [1, 5, 3, 6, 2, 4], 8: [1, 5, 4, 8, 6, 3, 7, 2] };
/**
 * The cylinders of this car seen from the side, firing in turn: each piston goes up and down, the one firing glows.
 * kind: 'misfire' (one cylinder misses: no glow, amber), 'rough' (the crankshaft's wobble drawn under it),
 * 'ignition' (the spark's timing: the glow comes a little later on the one the knock control pulls back).
 */
function cylAnim(kind) {
    return function (cv, x, y, w, h, t) {
        const p = ENGINE && ENGINE.cylinders ? ENGINE : E.demoCar('b48');
        const banks = E.cylinderBanks(p), n = p.cylinders, order = ORDER[n] || banks[0].cylinders;
        const cycle = 2.2, phase = (t % cycle) / cycle, firing = order[Math.floor(phase * n) % n];
        const bad = kind === 'misfire' ? order[Math.min(n - 1, 2)] : null;
        const rowsY = banks.length === 2 ? [y + 70, y + h / 2 + 20] : [y + h / 2 - 50];
        const slotW = Math.min(110, (w - 120) / Math.max(1, banks[0].cylinders.length));
        banks.forEach((b, bi) => {
            const by = rowsY[bi], x0 = x + w / 2 - slotW * b.cylinders.length / 2;
            if (banks.length === 2) cv.text('BANK ' + b.bank, x0 - 16, by + 40, 13, DIM, { font: 'bold', align: 'right', literal: true });
            b.cylinders.forEach((c, i) => {
                const cx = x0 + slotW * (i + 0.5), k = order.indexOf(c);
                const up = 0.5 + 0.5 * Math.cos(2 * Math.PI * (phase * 2 - k * 2 / n));
                const cyh = banks.length === 2 ? 90 : 130, pw = slotW * 0.62;
                cv.strokeRoundRect(cx - pw / 2 - 4, by, pw + 8, cyh, 10, 3, GREY);
                const py = by + 14 + (1 - up) * (cyh - 50);
                cv.roundRect(cx - pw / 2, py, pw, 22, 8, '#6e7480');
                cv.line(cx, py + 22, cx, by + cyh + 14, 4, LINE);
                if (c === firing && c !== bad) cv.circle(cx, by + 12, 10, kind === 'ignition' && c === order[1] ? C.amber : C.orange);
                if (c === firing && c === bad) cv.arc(cx, by + 12, 8, 11, 0, 360, C.amber);
                cv.text(String(c), cx, by + cyh + 34, 15, c === bad ? C.amber : DIM, { align: 'center', literal: true });
            });
        });
        if (kind === 'rough') {
            const px = x + 80, pw = w - 160, py = y + h - 46, pts = [];
            for (let i = 0; i <= 60; i++) { const f = i / 60; pts.push([px + f * pw, py - Math.sin(f * Math.PI * 2 * n / 2 - t * 6) * (8 + (Math.floor(f * n) === 2 ? 10 : 0))]); }
            UI.curve(cv, pts, 3, C.green);
            cv.text('crankshaft speed: an even wave is a smooth engine', x + w / 2, y + h - 10, 14, DIM, { align: 'center', literal: true });
        } else cv.text(kind === 'misfire' ? 'cylinder ' + bad + ' misses a stroke now and then: the engine unit counts it' : kind === 'ignition' ? 'each cylinder\'s spark timing; one pulled back: knock control at work' : p.cylinders + ' cylinders, firing in turn',
            x + w / 2, y + h - 14, 15, kind === 'misfire' ? C.amber : DIM, { align: 'center', literal: true });
    };
}
ART.misfire = cylAnim('misfire');
ART.rough = cylAnim('rough');
ART.ignition = cylAnim('ignition');
ART.cylinders = cylAnim('cylinders');
/** Fuel rail pressure: a needle rising to the engine's own range (petrol direct injection or diesel common rail). */
ART.rail = function (cv, x, y, w, h, t) {
    const p = ENGINE && ENGINE.fuel ? ENGINE : E.demoCar('b48'), hi = p.rail[1], v = p.rail[0] + (hi - p.rail[0]) * (0.5 + 0.4 * Math.sin(t * 1.4));
    UI.ring(cv, x + w / 2, y + h / 2 + 10, Math.min(110, h / 2 - 50), { value: v, min: 0, max: hi, decimals: 0, unit: 'bar', color: 'ok', scale: { step: p.diesel ? 500 : 50 }, smooth: false });
};
/** Drive check: a value and its target over a drive; they move together, three times the value leaves it (red), the
 *  third time makes it a finding. */
ART.driveCheck = function (cv, x, y, w, h, t) {
    const px = x + 40, pw = w - 80, top = y + 30, ph = h - 110, n = 90, sh = (t * 0.25) % 1;
    const out = (f) => [0.22, 0.52, 0.8].some((c) => Math.abs(f - c) < 0.04);
    const want = (f) => 0.5 + 0.3 * Math.sin(f * 9 + sh * 6.283), tgt = [], act = [];
    for (let i = 0; i <= n; i++) { const f = i / n; tgt.push([px + f * pw, top + ph * (1 - want(f))]); act.push([px + f * pw, top + ph * (1 - want(f) + (out(f) ? 0.22 : 0.02 * Math.sin(f * 40)))]); }
    UI.curve(cv, tgt, 2, [150, 158, 170, 200]);
    UI.curve(cv, act, 3, C.green);
    [0.22, 0.52, 0.8].forEach((c, k) => { const xx = px + c * pw; cv.circle(xx, top + ph * (1 - want(c) + 0.22), 9, [255, 70, 60, 120]); cv.text(String(k + 1), xx, top + ph * (1 - want(c) + 0.22) - 14, 14, C.red, { font: 'bold', align: 'center', literal: true }); });
    cv.text('grey: what the engine unit asks.   green: what the car does.   red: out of step', x + w / 2, y + h - 54, 14, DIM, { align: 'center', literal: true });
    cv.text('the third time it comes back, it is a finding', x + w / 2, y + h - 28, 15, C.amber, { align: 'center', literal: true });
};
const BY_INFO = {
    driveCheck: 'driveCheck', driveFound: 'driveCheck',
    score: 'score', hist: 'score', changes: 'score', faults: 'faults', byUnit: 'faults', memories: 'faults', timeline: 'faults',
    battery12: 'rest', rest: 'rest', nights: 'rest', verdict: 'rest', charge: 'rest', start: 'start', oil: 'oil', levels: 'oil',
    service: 'cbs', cbs: 'cbs', ours: 'cbs', parts: 'cbs', tyres: 'tyre', pressure: 'tyre', trend: 'tyre', warmup: 'warm',
    cc: 'cc', qr: 'qr', readiness: 'ready', misfire: 'misfire', rough: 'rough', ignition: 'ignition', knock: 'ignition', vanos: 'cylinders',
    lambda: 'cylinders', rail: 'rail', engineCars: 'cylinders',
};
function artFor(key, info) { return ART[(info && info.art) || BY_INFO[key]] || score; }

module.exports = { ART, artFor, setEngine };
