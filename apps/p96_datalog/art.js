// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog's illustrations: each is draw(cv, x, y, w, h, t), t in seconds, called every frame by the info
 * popup and the How to use page, so they animate. Own drawings only (no BMW artwork).
 */
function ui() {
    try { return require('./garage_ui'); }              // inside a built app
    catch (e) { return require('../../lib/ui'); }        // in the repo
}
const UI = ui();
const C = UI.C;
const GREY = '#969ea8', LINE = '#6e7480', DARK = '#30343c';
const lit = { align: 'center', literal: true };
const ease = (p) => p * p * (3 - 2 * p);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Air path: filter, turbo, intercooler, throttle, engine, the air moving and changing colour, the three sensors. */
function airPath(cv, x, y, w, h, t) {
    const cy = y + h / 2 - 10, x0 = x + 70, x1 = x + w - 70;
    cv.line(x0, cy, x1 - 40, cy, 26, DARK);
    const at = (f) => x0 + (x1 - x0) * f;
    cv.strokeRoundRect(at(0.1) - 25, cy - 35, 50, 70, 10, 3, GREY);
    for (let k = 0; k < 4; k++) cv.line(at(0.1) - 17 + k * 11, cy - 28, at(0.1) - 17 + k * 11, cy + 28, 2, LINE);
    cv.arc(at(0.33), cy, 36, 39, 0, 360, GREY);
    for (let k = 0; k < 5; k++) {
        const a = t * 12 + k * 1.2566;
        cv.line(at(0.33), cy, at(0.33) + 26 * Math.cos(a), cy + 26 * Math.sin(a), 3, GREY);
    }
    cv.strokeRoundRect(at(0.56) - 35, cy - 45, 70, 90, 10, 3, GREY);
    for (let k = 0; k < 6; k++) cv.line(at(0.56) - 29, cy - 36 + k * 14, at(0.56) + 29, cy - 36 + k * 14, 2, '#5a8cc8');
    cv.line(at(0.75), cy - 18, at(0.75), cy + 18, 4, GREY);
    cv.circle(at(0.75), cy, 6, GREY);
    cv.strokeRoundRect(at(0.93) - 40, cy - 45, 80, 90, 14, 3, GREY);
    for (let i = 0; i < 14; i++) {
        const f = (t * 0.6 + i / 14) % 1, px = x0 + f * (at(0.9) - x0);
        cv.circle(px, cy, 5, px < at(0.33) ? C.blue : px < at(0.56) ? '#ff6e3c' : '#d2c896');
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 6.28);
    [[x0 - 30, C.blue, 'outside', 0], [at(0.2), C.green, 'intake', 0], [at(0.66), C.amber, 'charge air', 1]].forEach((s) => {
        if (s[3]) cv.circle(s[0], cy - 40, 12 + 8 * pulse, [255, 186, 70, Math.round(40 + 90 * (1 - pulse))]);
        cv.line(s[0], cy - 28, s[0], cy - 12, 3, s[1]);
        cv.circle(s[0], cy - 40, 8, s[1]);
        cv.text(s[2], s[0], cy - 60, 14, s[1], { font: 'bold', align: 'center', literal: true });
    });
    [[0.1, 'filter'], [0.33, 'turbo'], [0.56, 'intercooler'], [0.75, 'throttle'], [0.93, 'engine']].forEach((p) =>
        cv.text(p[1], at(p[0]), cy + 72, 13, C.dim, lit));
}

/** A round gauge for the boost popup: label, value, a needle over min..max. */
function gauge(cv, cx, cy, r, v, min, max, label, unit, c) {
    cv.arc(cx, cy, r - 5, r + 5, -135, 135, DARK, { round: true });
    const f = clamp((v - min) / (max - min), 0, 1), a = -135 + 270 * f;
    if (f > 0.01) cv.arc(cx, cy, r - 5, r + 5, -135, a, c, { round: true });
    cv.text(v.toFixed(2), cx, cy + 8, 26, C.text, { font: 'num', align: 'center', literal: true });
    cv.text(unit, cx, cy + 30, 13, C.dim, lit);
    cv.text(label, cx, cy + r + 28, 14, c, { font: 'bold', align: 'center', literal: true });
}
/** Idle (vacuum) to full throttle: outside, manifold and boost = manifold minus outside, then a mountain road. */
function boostArt(cv, x, y, w, h, t) {
    const p = (t % 8) / 8, hill = p > 0.55, k = hill ? ease(clamp((p - 0.55) / 0.2, 0, 1)) : 0;
    const thr = hill ? 1 : ease(clamp((p - 0.1) / 0.3, 0, 1));
    const out = 1.01 - 0.2 * k, man = 0.35 + (2.43 - 0.35) * thr - (hill ? 0 : 0), boost = man - out;
    const cy = y + h / 2 - 20, r = 62;
    gauge(cv, x + w * 0.2, cy, r, out, 0, 3, 'outside', 'bar abs', C.blue);
    gauge(cv, x + w * 0.5, cy, r, man, 0, 3, 'manifold', 'bar abs', C.text);
    gauge(cv, x + w * 0.8, cy, r, boost, -1, 2, 'boost', 'bar', C.orange);
    cv.text('-', x + w * 0.35, cy + 8, 30, C.dim, lit);
    cv.text('=', x + w * 0.65, cy + 8, 30, C.dim, lit);
    // throttle pedal
    const py = y + h - 54;
    cv.text(hill ? 'up a mountain: thinner air outside, the same manifold pressure, more boost' : thr < 0.05 ? 'idle: the throttle is shut, vacuum in the manifold' : 'full throttle: the turbo pushes air in',
        x + w / 2, py + 34, 15, hill ? C.amber : C.dim, lit);
    UI.bar(cv, x + 120, py, w - 240, 12, thr, C.orange);
    cv.text('pedal', x + 80, py + 11, 13, C.dim, lit);
}

/** A 402 m run: the timer counts, the car accelerates along a scale. */
function runArt(cv, x, y, w, h, t) {
    const p = (t % 5) / 5, ph = clamp((p - 0.2) / 0.7, 0, 1), pos = ph * ph;
    const tx0 = x + 42, tx1 = x + w - 46, ty = y + h - 86;
    cv.line(tx0, ty, tx1, ty, 4, DARK);
    ['0', '100 m', '201 m', '300 m', '402 m'].forEach((l, k) => {
        const lx = tx0 + (tx1 - tx0) * k / 4;
        cv.line(lx, ty - 8, lx, ty + 8, 2, '#5a606a');
        cv.text(l, lx, ty + 30, 13, C.dim, lit);
    });
    const cx = tx0 + (tx1 - tx0) * pos, by = ty - 36;
    cv.roundRect(cx - 34, by + 4, 68, 26, 12, GREY);
    cv.roundRect(cx - 18, by - 12, 34, 20, 8, '#78808c');
    [cx - 20, cx + 20].forEach((wx) => { cv.circle(wx, by + 31, 9, GREY); cv.circle(wx, by + 31, 7, '#1e2026'); });
    if (ph > 0 && ph < 1) for (let k = 0; k < 3; k++) cv.line(cx - 44 - k * 14, by + 12 + k * 6, cx - 58 - k * 14, by + 12 + k * 6, 3, C.orange);
    const state = p < 0.2 ? 'READY' : ph < 1 ? 'RUNNING' : 'SAVED';
    cv.text((12.84 * ph).toFixed(2) + ' s', x + w / 2, y + 86, 64, C.text, { font: 'num', align: 'center', literal: true });
    cv.text(state, x + w / 2, y + 124, 18, p < 0.2 ? C.green : ph < 1 ? C.orange : C.blue, { font: 'bold', align: 'center', literal: true });
    cv.text(Math.round(172.4 * Math.pow(ph, 0.6)) + ' km/h', x + w / 2, y + 156, 20, C.dim, lit);
}

/** Air density: the same box of air, cold and dense, then warm and thin; the correction factor moves. */
function correctionArt(cv, x, y, w, h, t) {
    const p = 0.5 + 0.5 * Math.sin(t * 0.9), temp = 5 + 35 * p, cf = 0.96 + 0.08 * p;
    const bx = x + 60, by = y + 50, bw = w * 0.5, bh = h - 140;
    cv.strokeRoundRect(bx, by, bw, bh, 18, 3, GREY);
    const n = Math.round(60 - 26 * p);
    for (let i = 0; i < n; i++) {
        const sx = (Math.sin(i * 12.9898) * 43758.5453) % 1, sy = (Math.sin(i * 78.233) * 12345.678) % 1;
        const jx = Math.sin(t * (1.5 + p * 3) + i) * 6, jy = Math.cos(t * (1.3 + p * 3) + i * 2) * 6;
        cv.circle(bx + 20 + Math.abs(sx) * (bw - 40) + jx, by + 20 + Math.abs(sy) * (bh - 40) + jy, 5, p > 0.5 ? '#ff6e3c' : C.blue);
    }
    cv.text('the same litre of air', bx + bw / 2, by + bh + 34, 14, C.dim, lit);
    const rx = x + w * 0.64;
    cv.text(Math.round(temp) + ' °C', rx + 80, y + 110, 40, C.text, { font: 'num', align: 'center', literal: true });
    cv.text(p > 0.5 ? 'warm: less oxygen' : 'cool: more oxygen', rx + 80, y + 140, 15, p > 0.5 ? C.amber : C.green, lit);
    cv.text('x ' + cf.toFixed(3), rx + 80, y + 230, 40, C.orange, { font: 'num', align: 'center', literal: true });
    cv.text('correction factor', rx + 80, y + 260, 15, C.dim, lit);
}

/** Tyres: four tyres warming up, pressure rising toward the hot target. */
function tyreArt(cv, x, y, w, h, t) {
    const p = (t % 6) / 6, warm = ease(clamp(p / 0.8, 0, 1));
    const cx = x + w / 2, cy = y + h / 2 - 10;
    cv.roundRect(cx - 70, cy - 120, 140, 240, 50, '#262a31');
    cv.strokeRoundRect(cx - 70, cy - 120, 140, 240, 50, 2, '#3c4048');
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((q) => {
        const tx = cx + q[0] * 105, ty = cy + q[1] * 75, c = UI.C.blue;
        const col = warm < 0.5 ? c : warm < 0.9 ? C.green : C.amber;
        cv.roundRect(tx - 18, ty - 34, 36, 68, 14, col);
        const bar = (2.1 + 0.3 * warm).toFixed(2) + ' bar';
        cv.text(bar, tx + q[0] * 90, ty + 6, 18, C.text, { font: 'bold', align: 'center', literal: true });
        cv.text(Math.round(20 + 45 * warm) + ' °C', tx + q[0] * 90, ty + 30, 14, C.dim, lit);
    });
    cv.text(warm < 0.5 ? 'cold: pressure low' : warm < 0.9 ? 'warm: on target' : 'hot: over the target', cx, y + h - 20, 15, warm < 0.5 ? C.blue : warm < 0.9 ? C.green : C.amber, lit);
}

/** Temperatures: bars filling toward their working range, the ok zone marked. */
function tempArt(cv, x, y, w, h, t) {
    const p = ease(clamp((t % 6) / 4, 0, 1));
    const rows = [['oil', 105, 140, C.green], ['coolant', 95, 130, C.green], ['gearbox', 85, 140, C.amber], ['charge air', 45, 90, C.amber]];
    rows.forEach((r, i) => {
        const ry = y + 70 + i * 74, v = 20 + (r[1] - 20) * p;
        cv.text(r[0], x + 40, ry + 6, 16, C.text, { font: 'bold', literal: true });
        UI.bar(cv, x + 170, ry - 6, w - 330, 14, v / r[2], v > r[1] * 0.9 ? r[3] : C.blue);
        cv.text(Math.round(v) + ' °C', x + w - 60, ry + 6, 18, C.text, { font: 'num', align: 'right', literal: true });
    });
    cv.text(p < 1 ? 'warming up: wait before a run' : 'ready', x + w / 2, y + h - 22, 15, p < 1 ? C.amber : C.green, lit);
}

/** Two speed traces drawn side by side, the gap between them. */
function compareArt(cv, x, y, w, h, t) {
    const p = clamp((t % 5) / 4, 0, 1), px0 = x + 60, px1 = x + w - 40, py0 = y + 40, py1 = y + h - 70;
    cv.fillRect(px0, py1, px1 - px0, 1.5, '#3c4048');
    const pts = (k) => {
        const out = [];
        for (let i = 0; i <= 40 * p; i++) {
            const s = i / 40 * 13, v = 230 * k * (1 - Math.exp(-s / 8.6));
            out.push([px0 + (px1 - px0) * s / 13, py1 - (py1 - py0) * v / 200]);
        }
        return out;
    };
    const a = pts(1), b = pts(0.97);
    if (a.length > 1) { UI.curve(cv, b, 4, C.blue); UI.curve(cv, a, 4, C.orange); }
    cv.roundRect(px0, y + h - 40, 20, 6, 3, C.orange); cv.text('best', px0 + 28, y + h - 32, 15, C.dim, { literal: true });
    cv.roundRect(px0 + 120, y + h - 40, 20, 6, 3, C.blue); cv.text('this run', px0 + 148, y + h - 32, 15, C.dim, { literal: true });
    cv.text('+' + (0.18 * p).toFixed(2) + ' s', px1 - 10, y + h - 32, 18, C.amber, { font: 'bold', align: 'right', literal: true });
}

/** The log: lines arrive one by one, a dot blinks while it records. */
function logArt(cv, x, y, w, h, t) {
    const lines = ['17:02  Datalog started', '17:04  Run 1: 402 m in 12.67 s', '17:06  Run 2: 402 m in 12.79 s', '17:07  Charge air 27 °C over intake', '17:09  Run 3: 402 m in 12.91 s'];
    const n = Math.floor((t % 6) / 1.1) + 1;
    lines.slice(0, n).forEach((l, i) => cv.text(l, x + 50, y + 70 + i * 40, 17, i === n - 1 ? C.text : C.dim, { literal: true }));
    const on = Math.floor(t * 2) % 2 === 0;
    cv.circle(x + w - 60, y + 50, 9, on ? C.red : '#5a2626');
    cv.text('REC', x + w - 76, y + 56, 15, C.red, { font: 'bold', align: 'right', literal: true });
}

/** What the car must report: the head unit asks the engine unit, values come back. */
function carArt(cv, x, y, w, h, t) {
    const hu = [x + 120, y + h / 2], ecu = [x + w - 120, y + h / 2];
    cv.strokeRoundRect(hu[0] - 70, hu[1] - 45, 140, 90, 16, 3, GREY);
    cv.text('head unit', hu[0], hu[1] + 6, 16, C.text, { font: 'bold', align: 'center', literal: true });
    cv.strokeRoundRect(ecu[0] - 70, ecu[1] - 45, 140, 90, 16, 3, GREY);
    cv.text('engine unit', ecu[0], ecu[1] + 6, 16, C.text, { font: 'bold', align: 'center', literal: true });
    const f = (t % 1.6) / 1.6, go = f < 0.5, q = go ? f * 2 : (f - 0.5) * 2;
    const px = go ? hu[0] + 80 + (ecu[0] - hu[0] - 160) * q : ecu[0] - 80 - (ecu[0] - hu[0] - 160) * q;
    cv.line(hu[0] + 80, hu[1], ecu[0] - 80, ecu[1], 3, DARK);
    cv.circle(px, hu[1], 8, go ? C.blue : C.green);
    cv.text(go ? 'read 580B' : '2.43 bar', px, hu[1] - 20, 14, go ? C.blue : C.green, lit);
    cv.text('read only: Datalog only asks, it never writes', x + w / 2, y + h - 30, 15, C.dim, lit);
}

module.exports = { airPath, boostArt, runArt, correctionArt, tyreArt, tempArt, compareArt, logArt, carArt };
