// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Standby's illustrations: each is draw(cv, x, y, w, h, t), t in seconds, called every frame by the info popup
 * and the How to use page, so they move. Own drawings only (no BMW artwork). Every end is round.
 */
function ui() {
    try { return require('./garage_ui'); }              // inside a built app
    catch (e) { return require('../../lib/ui'); }        // in the repo
}
const UI = ui();
const M = require('./model');
const C = UI.C;
const GREY = '#969ea8', DARK = '#30343c';
const lit = { align: 'center', literal: true };
const ease = (p) => p * p * (3 - 2 * p);
const tri = (t, period) => { const p = (t / period) % 1; return p < 0.5 ? p * 2 : 2 - p * 2; };

/** The fixed slots: four digit boxes and the colon, the minute rolling over, the boxes never moving. */
function slotsArt(cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2 - 10, sw = 86, cw = 30, gap = 8;
    const total = 4 * sw + cw + 4 * gap, x0 = cx - total / 2;
    const m = Math.floor(t / 1.6) % 60, hh = 21, mm = 46 + m;
    const s = M.timeText(new Date(2026, 0, 1, hh + Math.floor(mm / 60), mm % 60), '24').text;
    const sl = M.digitSlots(s, (ch) => (ch === ':' ? cw : sw), gap);
    const fresh = (t % 1.6) / 1.6;
    sl.slots.forEach((q, i) => {
        const bx = x0 + q.x;
        if (q.ch !== ':') cv.strokeRoundRect(bx, cy - 70, q.w, 140, 14, 2, DARK);
        const isNew = i === 4 && fresh < 0.3;
        cv.text(q.ch, bx + q.w / 2, cy + 38, 110, isNew ? C.amber : C.text, { font: 'num', align: 'center', literal: true });
    });
    for (let i = 0; i < 4; i++) {
        const q = sl.slots[i < 2 ? i : i + 1];
        cv.line(x0 + q.x + 10, cy + 92, x0 + q.x + q.w - 10, cy + 92, 4, C.orange);
    }
    cv.text('every digit has a slot of the same width', cx, y + h - 26, 15, C.dim, lit);
}

/** Day to night: the sky turns, the sun sets and the moon rises, the clock fades to the warm dark colour. */
function nightArt(cv, x, y, w, h, t) {
    const p = ease(tri(t, 6)), cx = x + w / 2;
    const sun = [x + 110, y + 70 + p * 120], moon = [x + w - 110, y + 190 - p * 120];
    cv.circle(sun[0], sun[1], 26, M.mixColour('#ffba46', '#30343c', p));
    cv.circle(moon[0], moon[1], 24, M.mixColour('#30343c', '#c8ced6', p));
    cv.circle(moon[0] + 12, moon[1] - 8, 20, '#0e0f12');
    cv.line(x + 40, y + 210, x + w - 40, y + 210, 3, DARK);
    cv.text('21:47', cx, y + 170, 84, M.mixColour(C.text, M.NIGHT_TEXT, p), { font: 'num', align: 'center', literal: true });
    cv.text(p > 0.5 ? 'night: warm and dark' : 'day: bright white', cx, y + 250, 17, p > 0.5 ? M.NIGHT_TEXT : C.dim, lit);
    cv.text('the car\'s own day / night, else 20:00 to 07:00', cx, y + h - 26, 15, C.dim, lit);
}

/** A finger taps, the menu comes back, waits and fades out again. */
function menuArt(cv, x, y, w, h, t) {
    const ph = t % 7, cx = x + w / 2;
    const a = ph < 0.8 ? 0 : ph < 1.1 ? (ph - 0.8) / 0.3 : ph < 5 ? 1 : Math.max(0, 1 - (ph - 5) / 0.8);
    const top = y + 40, col = (c) => M.mixColour('#0e0f12', c, a);
    cv.roundRect(x + 30, top, w - 60, 46, 23, col('#24272e'));
    cv.roundRect(x + 140, top + 6, 90, 34, 17, col(C.orange));
    cv.circle(x + w - 70, top + 23, 16, col('#24272e'));
    cv.circle(x + w - 110, top + 23, 16, col('#24272e'));
    cv.text('21:47', cx, y + 200, 72, C.text, { font: 'num', align: 'center', literal: true });
    if (ph < 1.1) {
        const r = 14 + 30 * (ph / 1.1);
        cv.arc(cx + 120, y + 260, r - 3, r, 0, 360, [255, 186, 70, Math.round(200 * (1 - ph / 1.1))]);
        cv.circle(cx + 120, y + 260, 10, C.amber);
    }
    cv.text(a > 0.5 ? 'tap: the menu is back' : 'after a few seconds only the clock stays', cx, y + h - 26, 15, C.dim, lit);
}

/** A thermometer falling past 3 °C, and an ice crystal growing on the road under it. */
function iceArt(cv, x, y, w, h, t) {
    const p = tri(t, 8), temp = 8 - p * 12, cx = x + 170, top = y + 40, bot = y + h - 90;
    cv.line(cx, top, cx, bot, 22, DARK);
    const lo = -6, hi = 10, yOf = (v) => bot - (v - lo) / (hi - lo) * (bot - top);
    const risk = M.iceRisk(temp), c = risk.level === 'none' ? C.green : risk.level === 'possible' ? C.blue : '#a0d2ff';
    cv.line(cx, bot, cx, yOf(temp), 12, c);
    cv.circle(cx, bot + 8, 20, c);
    cv.line(cx + 22, yOf(3), cx + 60, yOf(3), 2.5, C.amber);
    cv.text('3 °C', cx + 70, yOf(3) + 5, 15, C.amber, { literal: true });
    cv.line(cx + 22, yOf(0), cx + 60, yOf(0), 2.5, GREY);
    cv.text('0 °C', cx + 70, yOf(0) + 5, 15, GREY, { literal: true });
    const ix = x + w - 170, iy = y + h / 2 - 20, g = risk.level === 'none' ? 0 : risk.level === 'possible' ? 0.6 : 1;
    cv.line(x + w - 300, iy + 90, x + w - 40, iy + 90, 6, '#46494f');
    if (g > 0) {
        for (let k = 0; k < 6; k++) {
            const a = k * Math.PI / 3, r = 60 * g;
            cv.line(ix, iy, ix + r * Math.cos(a), iy + r * Math.sin(a), 4, '#a0d2ff');
            cv.line(ix + r * 0.55 * Math.cos(a), iy + r * 0.55 * Math.sin(a), ix + r * 0.55 * Math.cos(a) + 16 * g * Math.cos(a + 0.8), iy + r * 0.55 * Math.sin(a) + 16 * g * Math.sin(a + 0.8), 3, '#a0d2ff');
        }
    }
    cv.text(temp.toFixed(1) + ' °C', ix, iy + 130, 26, C.text, { font: 'num', align: 'center', literal: true });
    cv.text(risk.text, ix, iy + 158, 15, c, lit);
}

/** The 12 V battery: its voltage resting, and the line that is healthy. */
function batteryArt(cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2 - 20, bw = 220, bh = 130;
    cv.strokeRoundRect(cx - bw / 2, cy - bh / 2, bw, bh, 16, 4, GREY);
    cv.roundRect(cx - 70, cy - bh / 2 - 16, 34, 16, 6, GREY);
    cv.roundRect(cx + 36, cy - bh / 2 - 16, 34, 16, 6, GREY);
    const v = 12.6 + 0.15 * Math.sin(t * 1.2), f = (v - 11.8) / 1.2;
    cv.roundRect(cx - bw / 2 + 14, cy - bh / 2 + 14, Math.max(20, (bw - 28) * f), bh - 28, 10, v >= 12.4 ? C.green : C.amber);
    cv.text(v.toFixed(2) + ' V', cx, cy + bh / 2 + 50, 30, C.text, { font: 'num', align: 'center', literal: true });
    cv.text('resting: 12.4 V and more is healthy, under 12.2 V charge it', cx, y + h - 26, 15, C.dim, lit);
}

/** Range: a road running away, the fuel needle falling slowly. */
function rangeArt(cv, x, y, w, h, t) {
    const cx = x + w / 2, hz = y + 70, base = y + h - 60;
    cv.stroke([[cx - 220, base], [cx - 10, hz]], 4, GREY);
    cv.stroke([[cx + 220, base], [cx + 10, hz]], 4, GREY);
    for (let k = 0; k < 5; k++) {
        const f = ((t * 0.5 + k / 5) % 1), q = f * f, yy = hz + (base - hz) * q;
        cv.line(cx, yy, cx, yy + 6 + 24 * q, 3 + 4 * q, C.amber);
    }
    const g = 0.75 - 0.25 * tri(t, 10), a = -60 + 120 * g, gx = x + w - 120, gy = y + 150;
    cv.arc(gx, gy, 52, 58, -60, 60, DARK, { round: true });
    cv.line(gx, gy, gx + 48 * Math.sin(a * Math.PI / 180), gy - 48 * Math.cos(a * Math.PI / 180), 4, C.orange);
    cv.circle(gx, gy, 6, C.orange);
    cv.text('E', gx - 52, gy + 22, 14, C.dim, lit);
    cv.text('F', gx + 52, gy + 22, 14, C.dim, lit);
}

/** The car from above: doors swing open and shut, the windows, the lock. */
function doorsArt(cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2 - 10, bw = 130, bh = 260;
    cv.strokeRoundRect(cx - bw / 2, cy - bh / 2, bw, bh, 40, 4, GREY);
    cv.strokeRoundRect(cx - bw / 2 + 18, cy - 60, bw - 36, 120, 16, 3, DARK);
    const open = ease(tri(t, 4));
    [[-1, -40], [1, -40], [-1, 40], [1, 40]].forEach((d, i) => {
        const ang = (i === 0 ? open : 0) * 0.9, hx = cx + d[0] * bw / 2, hy = cy + d[1] - 30;
        cv.line(hx, hy, hx + d[0] * 58 * Math.sin(ang), hy + 58 * Math.cos(ang), 6, i === 0 && open > 0.1 ? C.amber : C.green);
    });
    const locked = open < 0.05;
    cv.text(locked ? 'all closed, locked' : 'driver door open', cx, y + h - 26, 16, locked ? C.green : C.amber, { font: 'bold', align: 'center', literal: true });
}

/** A seat and a steering wheel with heat rising, its level bars filling. */
function heatArt(cv, x, y, w, h, t) {
    const sx = x + 170, sy = y + h / 2 + 40;
    cv.stroke([[sx - 50, sy], [sx + 40, sy], [sx + 60, sy - 10]], 10, GREY);
    cv.stroke([[sx - 50, sy], [sx - 70, sy - 130], [sx - 60, sy - 150]], 10, GREY);
    for (let k = 0; k < 3; k++) {
        const p = (t * 0.7 + k / 3) % 1, yy = sy - 30 - p * 120;
        cv.stroke([[sx - 20 + k * 22, yy + 20], [sx - 14 + k * 22, yy + 10], [sx - 20 + k * 22, yy]], 3, [255, 128, 40, Math.round(220 * (1 - p))]);
    }
    const lvl = 1 + Math.floor(t / 1.5) % 3;
    for (let k = 0; k < 3; k++) cv.roundRect(sx - 60 + k * 44, sy + 40, 36, 10, 5, k < lvl ? C.orange : DARK);
    const wx = x + w - 170, wy = y + h / 2 - 10;
    cv.arc(wx, wy, 64, 72, 0, 360, GREY);
    cv.line(wx - 66, wy, wx + 66, wy, 8, GREY);
    cv.line(wx, wy, wx, wy + 66, 8, GREY);
    cv.arc(wx, wy, 64, 72, -100 + t * 40 % 360, -40 + t * 40 % 360, C.orange, { round: true });
    cv.text('seat level ' + lvl, sx, y + h - 26, 15, C.dim, lit);
    cv.text('wheel on', wx, y + h - 26, 15, C.orange, lit);
}

/** The climate: a fan turning at its blower level, cold or warm air. */
function climateArt(cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2 - 20;
    cv.arc(cx, cy, 86, 92, 0, 360, GREY);
    for (let k = 0; k < 5; k++) {
        const a = t * 4 + k * 1.2566;
        cv.stroke([[cx, cy], [cx + 40 * Math.cos(a), cy + 40 * Math.sin(a)], [cx + 70 * Math.cos(a + 0.4), cy + 70 * Math.sin(a + 0.4)]], 6, GREY);
    }
    cv.circle(cx, cy, 10, C.orange);
    for (let k = 0; k < 4; k++) {
        const p = (t * 0.8 + k / 4) % 1;
        cv.circle(cx + 130 + p * 120, cy - 30 + k * 20, 6, [255, 186, 70, Math.round(230 * (1 - p))]);
    }
    cv.text('climate on, A/C off, fan 3', cx, y + h - 26, 15, C.dim, lit);
}

/** Today: the distance line climbing drive by drive. */
function dayArt(cv, x, y, w, h, t) {
    const x0 = x + 60, x1 = x + w - 40, y0 = y + 40, y1 = y + h - 70, p = (t / 5) % 1;
    cv.line(x0, y1, x1, y1, 2, DARK);
    cv.line(x0, y0, x0, y1, 2, DARK);
    const pts = [];
    const steps = [[0, 0], [0.12, 0], [0.22, 0.33], [0.45, 0.33], [0.52, 0.48], [0.78, 0.48], [0.92, 1]];
    for (let i = 0; i < steps.length; i++) {
        if (steps[i][0] > p) break;
        pts.push([x0 + steps[i][0] * (x1 - x0), y1 - steps[i][1] * (y1 - y0)]);
    }
    if (pts.length > 1) UI.curve(cv, pts, 4, C.orange);
    cv.text('distance so far today, one step per drive', x + w / 2, y + h - 26, 15, C.dim, lit);
}

/** This drive: a car moving along a route, the distance counting up. */
function driveArt(cv, x, y, w, h, t) {
    const p = (t / 6) % 1, pts = [];
    for (let k = 0; k <= 20; k++) pts.push([x + 60 + k * (w - 120) / 20, y + h / 2 + 50 * Math.sin(k / 3)]);
    UI.curve(cv, pts, 6, DARK);
    const n = Math.max(2, Math.round(p * 20) + 1);
    UI.curve(cv, pts.slice(0, n), 6, C.orange);
    const q = pts[n - 1];
    cv.circle(q[0], q[1], 11, C.text);
    cv.text((42.6 * p).toFixed(1) + ' km', x + w / 2, y + 60, 34, C.text, { font: 'num', align: 'center', literal: true });
    cv.text('from the moment the car moves until it stood for 3 minutes', x + w / 2, y + h - 26, 15, C.dim, lit);
}

module.exports = { slotsArt, nightArt, menuArt, iceArt, batteryArt, rangeArt, doorsArt, heatArt, climateArt, dayArt, driveArt };
