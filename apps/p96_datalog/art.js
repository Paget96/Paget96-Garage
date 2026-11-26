// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog illustrations: the animations on the left of every info popup and in the middle of How to use.
 * Each is draw(cv, x, y, w, h, t) with t in seconds, so it moves. Data colours are fixed (never the accent).
 * Every line has round ends (cv.line and stroke draw round caps).
 */
function lib() {
    try { return require('./garage_ui'); }                     // inside a built app
    catch (e) { return require('../../lib/ui'); }             // in the repo (tests, previews)
}
const UI = lib();
const C = UI.C;
const GREY = '#969ea8', DIMLINE = '#6e7480', TRACK = '#30343c';
const lbl = (cv, s, x, y, c, size, bold) => cv.text(s, x, y, size || 14, c || C.dim, { align: 'center', literal: true, font: bold ? 'bold' : 'label' });
const ease = (f) => f * f * (3 - 2 * f);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- the engine the drawings show ---------- */
/** Set each frame by pages.js from the car or the demo car (lib/engine.js profile); null: one turbo, four cylinders. */
let ENGINE = null;
function setEngine(p) { ENGINE = p || null; }
const twinTurbo = () => !!(ENGINE && ENGINE.turbos === 2);
/** The engine block's cylinder dots: as many as the engine has (two rows for a V8), four when not known. */
function cylDots(cv, cx, cy, w, h) {
    const n = ENGINE && ENGINE.cylinders ? ENGINE.cylinders : 4, rows = ENGINE && ENGINE.banks === 2 ? 2 : 1, per = Math.ceil(n / rows);
    const pitch = Math.min(18, (w - 16) / per), r = Math.max(3, Math.min(7, pitch * 0.38));
    for (let b = 0; b < rows; b++) for (let k = 0; k < Math.min(per, n - b * per); k++) {
        const yy = rows === 2 ? cy - h * 0.22 + b * h * 0.44 : cy - h * 0.16;
        cv.arc(cx - (per - 1) * pitch / 2 + k * pitch, yy, r * 0.7, r, 0, 360, DIMLINE);
    }
}

/* ---------- the air path: filter, turbo, intercooler, throttle, engine ---------- */

/**
 * The air on its way into the engine, with the sensors along it. focus: 'outside' (the mirror sensor), 'intake'
 * (after the filter), 'charge' (before the throttle) or 'all': that sensor pulses.
 */
function airPath(focus) {
    return function (cv, x, y, w, h, t) {
        const cy = y + h / 2 + 10, x0 = x + 80, x1 = x + w - 60;
        const at = (f) => x0 + (x1 - x0) * f;
        cv.line(x0, cy, at(0.9), cy, 26, TRACK);
        // filter
        cv.strokeRoundRect(at(0.1) - 25, cy - 35, 50, 70, 10, 3, GREY);
        for (let k = 0; k < 4; k++) cv.line(at(0.1) - 17 + k * 11, cy - 28, at(0.1) - 17 + k * 11, cy + 28, 2, DIMLINE);
        // turbo, spinning (two turbos: one above the other, each fed by its own bank or exhaust half)
        const tys = twinTurbo() ? [cy - 26, cy + 26] : [cy], tr = twinTurbo() ? 24 : 36;
        tys.forEach((ty, i) => {
            if (twinTurbo()) cv.line(at(0.33) - 30, ty, at(0.33) + 30, ty, 14, TRACK);
            cv.circle(at(0.33), ty, tr + 2, '#16181c');
            cv.arc(at(0.33), ty, tr, tr + 3, 0, 360, GREY);
            for (let k = 0; k < 5; k++) {
                const a = t * 12 + k * 1.2566 + i * 0.6;
                cv.line(at(0.33), ty, at(0.33) + (tr - 10) * Math.cos(a), ty + (tr - 10) * Math.sin(a), 3, GREY);
            }
        });
        // intercooler
        cv.strokeRoundRect(at(0.56) - 35, cy - 45, 70, 90, 10, 3, GREY);
        for (let k = 0; k < 6; k++) cv.line(at(0.56) - 29, cy - 36 + k * 14, at(0.56) + 29, cy - 36 + k * 14, 2, '#5a8cc8');
        // throttle, opening and closing a little
        const th = 0.5 + 0.5 * Math.sin(t * 1.3);
        cv.line(at(0.75) - 14 * th, cy - 18, at(0.75) + 14 * th, cy + 18, 4, GREY);
        cv.circle(at(0.75), cy, 6, GREY);
        // engine
        cv.strokeRoundRect(at(0.93) - 40, cy - 45, 80, 90, 14, 3, GREY);
        cylDots(cv, at(0.93), cy, 80, 90);
        // the air: cool before the turbo, hot after it, cooler after the intercooler
        for (let i = 0; i < 16; i++) {
            const f = (t * 0.5 + i / 16) % 1, px = x0 + f * (at(0.9) - x0);
            const c = px < at(0.33) ? C.blue : px < at(0.56) ? '#ff6e3c' : '#d2c896';
            cv.circle(px, cy, 5, c);
        }
        // the sensors
        const pulse = 0.5 + 0.5 * Math.sin(t * 6.28);
        const sensors = [
            ['outside', x0 - 30, y + 46, C.blue, 'mirror sensor'],
            ['intake', at(0.2), cy - 40, C.green, 'intake'],
            ['charge', at(0.66), cy - 40, C.amber, 'charge air'],
        ];
        sensors.forEach((s) => {
            const on = focus === s[0] || focus === 'all';
            if (on) cv.circle(s[1], s[2], 12 + 9 * pulse, [255, 255, 255, Math.round(25 + 50 * (1 - pulse))]);
            if (s[0] !== 'outside') cv.line(s[1], s[2] + 12, s[1], cy - 12, 3, s[3]);
            cv.circle(s[1], s[2], on ? 9 : 7, s[3]);
            lbl(cv, s[4], s[1], s[2] - 20, s[3], 14, on);
        });
        // the mirror: a little housing at the top left, the outside air around it
        cv.strokeRoundRect(x0 - 60, y + 30, 40, 30, 10, 2.5, GREY);
        [[0.1, 'filter'], [0.33, twinTurbo() ? 'two turbos' : 'turbo'], [0.56, 'intercooler'], [0.75, 'throttle'], [0.93, 'engine']].forEach((p) => lbl(cv, p[1], at(p[0]), cy + 72, C.dim, 13));
        lbl(cv, 'air in', x0 - 30, cy + 5, C.blue, 13);
    };
}

/* ---------- small gauge (for the boost popup) ---------- */

function miniGauge(cv, cx, cy, r, v, min, max, col, name, scale) {
    const a0 = -135, span = 270, ang = (val) => a0 + span * clamp((val - min) / (max - min), 0, 1);
    cv.arc(cx, cy, r - 7, r + 7, a0, a0 + span, TRACK, { round: true });
    cv.arc(cx, cy, r - 7, r + 7, a0, ang(v), col, { round: true });
    scale.forEach((s) => {
        const a = ang(s) * Math.PI / 180, px = cx + Math.sin(a) * (r + 24), py = cy - Math.cos(a) * (r + 24);
        cv.text(String(s), px, py + 4, 12, C.dim, { align: 'center', literal: true });
    });
    cv.text(v.toFixed(2), cx, cy + 10, 30, C.text, { align: 'center', font: 'num', literal: true });
    cv.text('bar', cx, cy + 32, 13, C.dim, { align: 'center', literal: true });
    lbl(cv, name, cx, cy + r + 34, col, 16, true);
}

/**
 * Boost explained: outside air into the turbo, packed tighter into the manifold; three gauges outside - manifold
 * = boost. The throttle goes idle (vacuum) - opening - full and back.
 */
function boostArt(cv, x, y, w, h, t) {
    const ph = t % 8, f = ph < 2 ? 0 : ph < 3.5 ? ease((ph - 2) / 1.5) : ph < 6.5 ? 1 : 1 - ease((ph - 6.5) / 1.5);
    const outside = 1.01, manifold = 0.45 + f * (2.43 - 0.45), boost = manifold - outside;
    // the tube: outside air (blue, spread out), the turbo, the manifold (orange, packed by the boost)
    const ty = y + 66, tx0 = x + 40, tx1 = x + w - 40, tc = x + w * 0.44;
    cv.roundRect(tx0, ty - 12, tx1 - tx0, 24, 12, '#262a32');
    for (let i = 0; i < 8; i++) {
        const px = tx0 + 18 + ((i * 28 + t * 40) % (tc - 40 - tx0));
        cv.circle(px, ty, 4.5, C.blue);
    }
    const gap = 28 - 16 * f, n = Math.floor((tx1 - tc - 50) / gap);
    // speeds that change run on phases (speed x time added each frame), so a change of speed never jumps (2026-11-26 20:17)
    const pk = 'dl|boostArt|' + Math.round(x) + '|' + Math.round(y);
    const run = UI.phase(pk + '|air', 40 + 60 * f, t * 1000), spin = UI.phase(pk + '|spin', 3 + 14 * f, t * 1000);
    for (let i = 0; i < n; i++) {
        const px = tc + 40 + ((i * gap + run) % (n * gap));
        cv.circle(px, ty, 4.5, C.orange);
    }
    cv.circle(tc, ty, 32, '#1a1c22');
    cv.arc(tc, ty, 30, 33, 0, 360, GREY);
    for (let k = 0; k < 5; k++) {
        const a = spin + k * 1.2566;
        cv.line(tc, ty, tc + 22 * Math.cos(a), ty + 22 * Math.sin(a), 3, GREY);
    }
    lbl(cv, 'outside air', (tx0 + tc - 32) / 2, ty + 40, C.blue, 14);
    lbl(cv, 'turbo', tc, ty + 52, C.dim, 14);
    lbl(cv, f > 0.5 ? 'manifold (packed tighter)' : 'manifold (throttle closed: thinner)', (tc + 32 + tx1) / 2, ty + 40, C.orange, 14);
    // the three gauges
    const gy = y + h - 130, gs = w / 3;
    miniGauge(cv, x + gs * 0.5, gy, 52, outside, 0, 3, C.blue, 'outside', [0, 1.5, 3]);
    miniGauge(cv, x + gs * 1.5, gy, 52, manifold, 0, 3, C.text, 'manifold', [0, 1.5, 3]);
    miniGauge(cv, x + gs * 2.5, gy, 52, boost, -1, 2, C.orange, 'boost', [-1, 0.5, 2]);
    cv.line(x + gs - 8, gy, x + gs + 8, gy, 4, C.dim);
    cv.line(x + 2 * gs - 8, gy - 5, x + 2 * gs + 8, gy - 5, 4, C.dim);
    cv.line(x + 2 * gs - 8, gy + 5, x + 2 * gs + 8, gy + 5, 4, C.dim);
    const st = f < 0.05 ? 'idle: vacuum' : f > 0.95 ? 'full throttle' : 'opening';
    lbl(cv, 'Throttle: ' + st, x + w / 2, y + h - 14, C.amber, 15, true);
}

/* ---------- the wastegate ---------- */

/** A point at fraction u along a polyline pts ([[x, y], ...]). */
function along(pts, u) {
    let total = 0;
    const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
    let left = clamp(u, 0, 1) * total;
    for (let i = 0; i < seg.length; i++) {
        if (left <= seg[i] || i === seg.length - 1) {
            const f = seg[i] ? left / seg[i] : 0;
            return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
        }
        left -= seg[i];
    }
    return pts[pts.length - 1];
}

/**
 * The wastegate explained: exhaust gas from the engine either spins the turbine (and so makes boost) or goes past it
 * through the wastegate flap. A 9 s cycle: idle (open), full throttle (shut, the boost climbs), at the target (opens
 * part way to hold it), lifting off (open again). Below: the boost needle with the target marked, and the position.
 */
function wastegateArt(cv, x, y, w, h, t) {
    const ph = t % 9;
    // boost and position over the cycle
    let boost, wg, words;
    if (ph < 1.5) { boost = -0.5; wg = 100; words = 'Idle: open, nothing to hold back'; }
    else if (ph < 4) {
        const f = ease(clamp((ph - 1.5) / 2.4, 0, 1));
        boost = -0.5 + f * 1.92; wg = 100 * (1 - ease(clamp((ph - 1.5) / 0.35, 0, 1)));
        words = 'Full throttle: shut, all the gas drives the turbine';
    } else if (ph < 6.8) {
        boost = 1.45 + 0.01 * Math.sin(ph * 9); wg = 45 * ease(clamp((ph - 4) / 0.6, 0, 1)) + 4 * Math.sin(ph * 3);
        words = 'At the target: opens part way to hold the boost';
    } else if (ph < 7.6) {
        const f = ease(clamp((ph - 6.8) / 0.8, 0, 1));
        boost = 1.45 - f * 1.95; wg = 45 + 55 * ease(clamp((ph - 6.8) / 0.3, 0, 1));
        words = 'Lift off: open again';
    } else { boost = -0.5; wg = 100; words = 'Idle: open, nothing to hold back'; }
    wg = clamp(wg, 0, 100);
    const share = wg / 100 * 0.75, flow = boost > 0 || (ph > 1.5 && ph < 6.8) ? 1 : 0.35;

    // the path: engine, pipe, turbine, pipe out; the bypass over the turbine with the flap at its foot
    const py = y + 132, ex = x + 120, out = x + w - 26, tx = x + w * 0.56, tr = 42;
    const bx0 = tx - 104, bx1 = tx + 104, by = y + 54;
    cv.strokeRoundRect(x + 24, py - 52, 96, 104, 16, 3, GREY);
    cylDots(cv, x + 72, py + 4, 96, 104);
    if (twinTurbo()) lbl(cv, 'two turbos: each has its own wastegate, both work like this', x + w / 2, y + 14, C.dim, 13);
    lbl(cv, 'engine', x + 72, py + 30, C.dim, 13);
    cv.line(ex, py, out, py, 26, TRACK);
    cv.line(bx0, py, bx0, by, 22, TRACK); cv.line(bx0, by, bx1, by, 22, TRACK); cv.line(bx1, by, bx1, py, 22, TRACK);
    // the gas: hot until it gives its energy to the turbine; through the flap it stays hot
    const A = [[ex, py], [out, py]], B = [[ex, py], [bx0, py], [bx0, by], [bx1, by], [bx1, py], [out, py]];
    const pk = 'dl|wgArt|' + Math.round(x) + '|' + Math.round(y);
    const gas = UI.phase(pk + '|gas', 0.18 + 0.22 * flow, t * 1000), turn = UI.phase(pk + '|spin', 2 + 16 * flow * (1 - share), t * 1000);
    for (let i = 0; i < 22; i++) {
        const bypass = ((i * 0.618034) % 1) < share;
        const u = (gas + i / 22) % 1;
        const p = along(bypass ? B : A, u);
        const past = bypass ? false : p[0] > tx;
        cv.circle(p[0], p[1], 5, past ? '#c8a078' : '#ff6e3c');
    }
    // the turbine, faster with more gas through it
    cv.circle(tx, py, tr, '#1a1c22');
    cv.arc(tx, py, tr - 2, tr + 1, 0, 360, GREY);
    const spin = turn;
    for (let k = 0; k < 6; k++) { const a = spin + k * 1.0472; cv.line(tx, py, tx + 30 * Math.cos(a), py + 30 * Math.sin(a), 3, GREY); }
    lbl(cv, 'turbine', tx, py + tr + 20, C.dim, 13);
    // the flap: hinged at the left of the bypass foot, flat when shut, standing up when open
    const fy = py - 15, fx = bx0 - 12, a = (wg / 100) * 75 * Math.PI / 180;
    cv.line(fx, fy, fx + 26 * Math.cos(a), fy - 26 * Math.sin(a), 7, C.green);
    cv.circle(fx, fy, 5, C.text);
    lbl(cv, 'wastegate flap', bx0, py + 30, C.green, 13, true);
    lbl(cv, 'past the turbine', (bx0 + bx1) / 2, by - 20, C.dim, 13);
    lbl(cv, 'to the exhaust', out - 50, py + 30, C.dim, 13);

    // below: the boost needle with the target, the position bar, what happens now
    const gy = y + h - 132, gx = x + w * 0.27;
    miniGauge(cv, gx, gy, 48, boost, -1, 2, C.orange, 'boost', [-1, 0.5, 2]);
    const ta = (-135 + 270 * (1.45 + 1) / 3) * Math.PI / 180;
    cv.line(gx + Math.sin(ta) * 36, gy - Math.cos(ta) * 36, gx + Math.sin(ta) * 60, gy - Math.cos(ta) * 60, 3, C.amber);
    const bx = x + w * 0.52, bw = w * 0.42, bry = gy - 6;
    lbl(cv, 'wastegate ' + Math.round(wg) + ' % open', bx + bw / 2, bry - 22, C.green, 16, true);
    cv.roundRect(bx, bry, bw, 14, 7, TRACK);
    if (wg > 1) cv.roundRect(bx, bry, Math.max(14, bw * wg / 100), 14, 7, C.green);
    cv.text('closed', bx, bry + 34, 12, C.dim, { literal: true });
    cv.text('open', bx + bw, bry + 34, 12, C.dim, { align: 'right', literal: true });
    lbl(cv, words, x + w / 2, y + h - 14, C.amber, 15, true);
}

/* ---------- a run on the strip ---------- */

function runArt(cv, x, y, w, h, t) {
    const p = (t % 5) / 5, ph = clamp((p - 0.22) / 0.7, 0, 1), pos = ph * ph;
    const tx0 = x + 42, tx1 = x + w - 46, ty = y + h - 86;
    cv.line(tx0, ty, tx1, ty, 4, TRACK);
    ['0', '100 m', '201 m', '300 m', '402 m'].forEach((l, k) => {
        const lx = tx0 + (tx1 - tx0) * k / 4;
        cv.line(lx, ty - 8, lx, ty + 8, 2, '#5a606a');
        cv.text(l, lx, ty + 30, 13, C.dim, { align: 'center', literal: true });
    });
    const cx = tx0 + (tx1 - tx0) * pos, by = ty - 36;
    cv.roundRect(cx - 34, by + 4, 68, 26, 12, GREY);
    cv.roundRect(cx - 18, by - 12, 34, 20, 8, '#78808c');
    [cx - 20, cx + 20].forEach((wx) => { cv.circle(wx, by + 31, 9, GREY); cv.circle(wx, by + 31, 7, '#1e2026'); });
    if (ph > 0 && ph < 1) for (let k = 0; k < 3; k++) cv.line(cx - 44 - k * 14, by + 12 + k * 6, cx - 56 - k * 14, by + 12 + k * 6, 3, C.orange);
    const armed = p < 0.16, throttle = p >= 0.16 && ph === 0;
    const state = armed ? 'READY' : throttle ? 'THROTTLE' : ph < 1 ? 'RUNNING' : 'DONE';
    cv.text((12.84 * ph).toFixed(2) + ' s', x + w / 2, y + 80, 64, C.text, { font: 'num', align: 'center', literal: true });
    cv.text(state, x + w / 2, y + 120, 18, armed ? C.green : throttle ? C.amber : C.orange, { font: 'bold', align: 'center', literal: true });
    cv.text(throttle ? 'reaction counts, the timer waits' : Math.round(172.4 * Math.pow(ph, 0.6)) + ' km/h', x + w / 2, y + 152, 18, C.dim, { align: 'center', literal: true });
}

/* ---------- speed over a run with its splits ---------- */

function splitsArt(cv, x, y, w, h, t) {
    const px = x + 70, py = y + 40, pw = w - 110, ph = h - 110, T = 13, V = 180;
    for (let i = 0; i <= 3; i++) {
        const gy = py + ph * i / 3;
        cv.fillRect(px, gy, pw, 1, i === 3 ? '#3c4048' : '#262a32');
        cv.text(String(V - i * 60), px - 10, gy + 5, 12, C.dim, { align: 'right', literal: true });
    }
    cv.text('km/h', px - 10, py - 14, 12, C.dim, { align: 'right', literal: true });
    ['0 s', '4 s', '8 s', '12 s'].forEach((s, i) => cv.text(s, px + pw * (i * 4) / T, py + ph + 22, 12, C.dim, { align: 'center', literal: true }));
    const vAt = (s) => 172.4 * (1 - Math.exp(-s / 6.2)) / (1 - Math.exp(-12.84 / 6.2));
    const k = (t % 6) / 5, upto = Math.min(1, k) * 12.84, pts = [];
    for (let s = 0; s <= upto + 1e-6; s += 0.25) pts.push([px + pw * s / T, py + ph - ph * vAt(s) / V]);
    if (pts.length > 1) UI.curve(cv, pts, 4, C.orange);
    const marks = [[5.42, '0-100', C.blue], [8.31, '201 m', C.amber], [12.84, '402 m', C.green]];
    marks.forEach((m) => {
        if (upto < m[0]) return;
        const mx = px + pw * m[0] / T, my = py + ph - ph * vAt(m[0]) / V;
        cv.line(mx, my + 10, mx, py + ph, 2, m[2]);
        cv.circle(mx, my, 7, m[2]);
        cv.text(m[1] + '  ' + m[0].toFixed(2) + ' s', mx - 8, my - 16, 14, m[2], { align: 'right', font: 'bold', literal: true });
    });
}

/* ---------- standard air against the air today ---------- */

function correctionArt(cv, x, y, w, h, t) {
    const bw = (w - 60) / 2, bh = h - 150, by = y + 50;
    const boxes = [['standard air', '25 °C  99 kPa', 1.0, C.dim], ['your air now', '21 °C  97.9 kPa', 0.95, C.blue]];
    boxes.forEach((b, i) => {
        const bx = x + 20 + i * (bw + 20);
        cv.strokeRoundRect(bx, by, bw, bh, 16, 2, '#3c4048');
        lbl(cv, b[0], bx + bw / 2, by - 14, b[3], 15, true);
        lbl(cv, b[1], bx + bw / 2, by + bh + 24, C.dim, 14);
        const n = Math.round(40 * b[2]);
        for (let k = 0; k < n; k++) {
            const r1 = Math.sin(k * 12.9898) * 43758.5453, r2 = Math.sin(k * 78.233) * 12345.6789;
            const fx = r1 - Math.floor(r1), fy = r2 - Math.floor(r2);
            const dx = Math.sin(t * 1.5 + k) * 6, dy = Math.cos(t * 1.2 + k * 2) * 6;
            cv.circle(bx + 18 + fx * (bw - 36) + dx, by + 18 + fy * (bh - 36) + dy, 5, i ? C.blue : '#78808c');
        }
    });
    const f = 0.5 + 0.5 * Math.sin(t * 1.2);
    lbl(cv, 'factor x 1.0065: the time is shown as if the air were standard', x + w / 2, y + h - 34, C.amber, 15, true);
    lbl(cv, 'thinner air = less oxygen = less power', x + w / 2, y + h - 12, f > 0.5 ? C.text : C.dim, 14);
}

/* ---------- outside pressure: lower up a mountain ---------- */

function pressureArt(cv, x, y, w, h, t) {
    const base = y + h - 60;
    const hill = (f) => base - Math.max(0, Math.sin(f * Math.PI)) * (h - 150);
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push([x + 30 + (w - 60) * i / 40, hill(i / 40)]);
    UI.curve(cv, pts, 4, '#5a606a');
    const f = (t % 8) / 8, cf = f < 0.5 ? f * 2 : 2 - f * 2, carX = x + 30 + (w - 60) * cf * 0.5, carY = hill(cf * 0.5);
    cv.roundRect(carX - 22, carY - 22, 44, 16, 7, GREY);
    cv.circle(carX - 12, carY - 6, 6, GREY); cv.circle(carX + 12, carY - 6, 6, GREY);
    const height = Math.round(Math.sin(cf * 0.5 * Math.PI) * 1800), hPa = 1013 * Math.pow(1 - height / 44330, 5.255);
    cv.text(Math.round(hPa) + ' hPa', x + w - 40, y + 50, 40, C.blue, { align: 'right', font: 'num', literal: true });
    cv.text('at ' + height + ' m', x + w - 40, y + 78, 15, C.dim, { align: 'right', literal: true });
    for (let k = 0; k < 18; k++) {
        const r1 = Math.sin(k * 12.9898) * 43758.5453, fx = r1 - Math.floor(r1), py = y + 30 + (k % 6) * 22;
        if ((k % 6) / 6 < 0.35 + 0.6 * (1 - height / 1800)) cv.circle(x + 40 + fx * (w * 0.45), py + Math.sin(t + k) * 4, 4, [80, 170, 255, 150]);
    }
    lbl(cv, 'weather moves it a little, a mountain a lot', x + w / 2, y + h - 18, C.dim, 14);
}

/* ---------- tyres warming from cold to hot ---------- */

function tyreArt(cv, x, y, w, h, t) {
    const f = 0.5 - 0.5 * Math.cos(t * 0.8), cx = x + w / 2, cy = y + h / 2 - 6;
    const tc0 = f > 0.6 ? C.green : f > 0.3 ? C.amber : C.blue, k = Math.min(0.95, (h - 40) / 320);
    UI.carWithTyres(cv, cx, cy, k, { FL: tc0, FR: tc0, RL: tc0, RR: tc0 });
    [[-1, -1, 'FL'], [1, -1, 'FR'], [-1, 1, 'RL'], [1, 1, 'RR']].forEach((p) => {
        const ty = cy + p[1] * 92 * k;
        const pr = (p[2] === 'RL' ? 2.1 : 2.2) + f * 0.22, tc = 19 + f * 16;
        const ax = cx + p[0] * 220;
        cv.text(pr.toFixed(2) + ' bar', ax, ty - 4, 22, C.text, { align: 'center', font: 'bold', literal: true });
        cv.text(Math.round(tc) + ' °C  ' + p[2], ax, ty + 22, 14, C.dim, { align: 'center', literal: true });
    });
    lbl(cv, f < 0.3 ? 'cold' : f > 0.7 ? 'hot: about 0.2 bar more' : 'warming', cx, y + h - 14, f > 0.7 ? C.green : C.amber, 16, true);
}

/* ---------- a temperature and its zones ---------- */

/** A bar with the zones (warming, ok, warm, too hot) of a temperature kind, a marker sweeping over it. */
function thermoArt(zones, unit, words) {
    return function (cv, x, y, w, h, t) {
        const bx = x + 50, bw = w - 100, by = y + h / 2 - 12, bh = 24, z = zones, min = z.cold != null ? z.cold - 40 : 0, max = z.max;
        const X = (v) => bx + bw * clamp((v - min) / (max - min), 0, 1);
        const seg = [];
        if (z.cold != null) seg.push([min, z.cold, C.amber, words[0]]);
        seg.push([z.cold != null ? z.cold : min, z.hot, C.green, words[1]], [z.hot, z.limit, C.amber, words[2]], [z.limit, max, C.red, words[3]]);
        seg.forEach((s) => {
            cv.roundRect(X(s[0]) + 2, by, Math.max(8, X(s[1]) - X(s[0]) - 4), bh, bh / 2, s[2]);
            lbl(cv, s[3], (X(s[0]) + X(s[1])) / 2, by + bh + 30, s[2], 14, true);
        });
        [z.cold, z.hot, z.limit].forEach((v) => { if (v != null) lbl(cv, v + ' ' + unit, X(v), by - 16, C.dim, 13); });
        const v = min + (max - min) * (0.5 - 0.5 * Math.cos(t * 0.7));
        cv.line(X(v), by - 4, X(v), by + bh + 4, 6, C.text);
        cv.text(Math.round(v) + ' ' + unit, X(v), by - 44, 30, C.text, { align: 'center', font: 'num', literal: true });
    };
}

/* ---------- the log: runs appear in a list, the best lit ---------- */

function logArt(cv, x, y, w, h, t) {
    const rows = [['Tue 24 Nov', '4 runs', '13.27 s'], ['Sat 21 Nov', '3 runs', '13.41 s'], ['Today', '3 runs', '13.25 s']];
    const n = Math.min(rows.length, Math.floor((t % 6) / 1.2) + 1);
    for (let i = 0; i < n; i++) {
        const ry = y + 50 + i * 74, best = i === 2;
        cv.roundRect(x + 30, ry, w - 60, 60, 18, best ? '#1c2a22' : '#1a1c22');
        cv.text(rows[i][0], x + 56, ry + 37, 18, C.text, { font: 'bold', literal: true });
        cv.text(rows[i][1], x + w / 2, ry + 37, 16, C.dim, { align: 'center', literal: true });
        cv.text(rows[i][2], x + w - 56, ry + 37, 20, best ? C.green : C.text, { align: 'right', font: 'bold', literal: true });
    }
    lbl(cv, 'tap a run to open it, then pick it as A or B to compare', x + w / 2, y + h - 18, C.dim, 14);
}

/* ---------- a dyno sheet drawing itself ---------- */

function dynoArt(cv, x, y, w, h, t) {
    const px = x + 60, py = y + 50, pw = w - 120, ph = h - 120, k = Math.min(1, (t % 6) / 4.5);
    cv.fillRect(px, py + ph, pw, 1, '#3c4048');
    for (let r = 2; r <= 6; r++) cv.text(String(r), px + pw * (r - 2) / 4.5, py + ph + 22, 13, C.dim, { align: 'center', literal: true });
    cv.text('x 1 000 rpm', px + pw / 2, py + ph + 44, 13, C.dim, { align: 'center', literal: true });
    const tq = (r) => (r < 3000 ? 488 - 68 * Math.pow((3000 - r) / 1000, 2) : 488 - 0.025 * (r - 3000) - 0.0000115 * (r - 3000) * (r - 3000));
    const tp = [], pp = [];
    for (let r = 2000; r <= 2000 + 4500 * k + 1e-6; r += 100) {
        const X = px + pw * (r - 2000) / 4500;
        tp.push([X, py + ph - ph * tq(r) / 520]);
        pp.push([X, py + ph - ph * (tq(r) * r / 7121) / 300]);
    }
    if (tp.length > 1) { UI.curve(cv, pp, 4, C.orange); UI.curve(cv, tp, 4, C.blue); }
    lbl(cv, 'power (hp)', x + 90, y + 30, C.orange, 15, true);
    lbl(cv, 'torque (Nm)', x + w - 90, y + 30, C.blue, 15, true);
    if (k >= 1) lbl(cv, 'hp = Nm x rpm / 7 121', x + w / 2, y + 30, C.dim, 14);
}

/* ---------- two runs side by side ---------- */

function compareArt(cv, x, y, w, h, t) {
    const px = x + 50, py = y + 50, pw = w - 100, ph = h - 140;
    cv.fillRect(px, py + ph, pw, 1, '#3c4048');
    const k = Math.min(1, (t % 6) / 4.5);
    const curve = (tau, end, col, name, row) => {
        const pts = [];
        for (let s = 0; s <= k * 13 + 1e-6; s += 0.25) pts.push([px + pw * s / 13, py + ph - ph * Math.min(1, (1 - Math.exp(-s / tau)) / (1 - Math.exp(-13 / tau)) * end)]);
        if (pts.length > 1) UI.curve(cv, pts, 4, col);
        cv.roundRect(px + row * 160, py + ph + 30, 20, 6, 3, col);
        cv.text(name, px + row * 160 + 28, py + ph + 38, 15, C.dim, { literal: true });
    };
    curve(6.0, 1.0, C.blue, 'run A', 0);
    curve(6.4, 0.97, C.orange, 'run B', 1);
    if (k >= 1) lbl(cv, 'B: 0.14 s slower, 6 °C warmer charge air', x + w / 2, y + 30, C.amber, 16, true);
}

module.exports = { setEngine, airPath, boostArt, wastegateArt, runArt, splitsArt, correctionArt, pressureArt, tyreArt, thermoArt, logArt, compareArt, dynoArt, miniGauge };
