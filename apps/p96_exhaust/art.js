// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Exhaust's drawings: the exhaust path (engine to tail pipe, with the gas moving through it), the flap, the sound
 * waves, and the animations of every info popup and How to use topic: draw(cv, x, y, w, h, t), t in seconds.
 * Data colours are fixed (green ok, amber warm, red hot or bad, blue cool, orange data), never the ambient accent.
 * Every line has round ends; motion is time based.
 */
function need(local, repo) {
    try { return require(local); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return require(repo); }
}
const UI = need('./garage_ui', '../../lib/ui');
const M = require('./model');
const C = UI.C;
const DIM = C.dim, LINE = '#3c4048', GREY = '#969ea8', PIPE = '#30343c', GRID = '#282c34';
const ease = (p) => p * p * (3 - 2 * p);
const loop = (t, s) => (t % s) / s;
const lerp = (a, b, k) => a + (b - a) * k;
const hex = (r, g, b) => '#' + [r, g, b].map((v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');

/** A temperature as a fixed data colour: blue cool, green, amber, red hot (100 to 900 °C). */
function heat(t) {
    const x = Math.max(0, Math.min(1, (t - 100) / 800));
    const stops = [[0, [80, 170, 255]], [0.3, [70, 210, 130]], [0.6, [255, 186, 70]], [1, [255, 75, 60]]];
    for (let i = 1; i < stops.length; i++) {
        if (x <= stops[i][0]) {
            const k = (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]), a = stops[i - 1][1], b = stops[i][1];
            return hex(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
        }
    }
    return C.red;
}
/** A sound level as a fixed data colour: orange loud, amber, green quiet. */
const levelColour = (l) => (l > 0.6 ? C.orange : l > 0.25 ? C.amber : C.green);

/* ---------- the exhaust path ---------- */

const WIDTHS = { engine: 120, turbo: 68, cat: 70, opf: 90, scr: 80, mid: 120, flap: 40, rear: 140 };
const E = need('./garage_engine', '../../lib/engine');
/** The engine the drawings show (view.js sets it each frame from the car or the demo car); null: a generic one. */
let ENGINE = null;
function setEngine(p) { ENGINE = p || null; }
/**
 * How many pipes the drawing has: two where the car has two turbos, two banks or two flaps (twin pipes to the two
 * tail pipes), else one.
 */
function pipeRows(p, setup) {
    const s = Object.assign({}, M.SETUP_DEFAULT, setup || {});
    return p && (p.turbos === 2 || p.banks === 2 || p.flaps === 2) || s.flaps === '2' ? 2 : 1;
}
/**
 * The parts of this setup along the pipe from x0 to x1: [{ key, name, x, w }]. Parts the setup does not have (a car with no middle silencer, no OPF) are left
 * out. The filter is named for the engine
 * (OPF on a petrol, DPF on a diesel), a diesel with AdBlue gets its SCR catalyst after it.
 */
function layout(setup, x0, x1, sc, p) {
    const s = Object.assign({}, M.SETUP_DEFAULT, setup || {});
    p = p === undefined ? ENGINE : p;
    sc = sc || 1;
    const two = pipeRows(p, s) === 2;
    const parts = [['engine', 'Engine'], ['turbo', p && p.turbos === 2 ? 'Turbos' : 'Turbo']];
    if (s.cat !== 'none') parts.push(['cat', two ? 'Catalysts' : 'Catalyst']);
    if (s.opf !== 'none' && !(p && p.filter === null && p.fuel)) parts.push(['opf', E.filterName(p && p.fuel ? p : { filter: 'opf' })]);
    if (p && p.scr) parts.push(['scr', 'SCR (AdBlue)']);
    if (s.mid !== 'none') parts.push(['mid', 'Middle silencer']);
    // the flap is in the rear silencer's way out: closed, the gas goes through the silencer; open, the short way out
    parts.push(['rear', two ? 'Rear silencers' : 'Rear silencer']);
    if (s.flaps !== '0' && s.flaps !== 'removed' && !(p && p.fuel && !p.flaps && s.flaps === M.SETUP_DEFAULT.flaps)) parts.push(['flap', s.flaps === '2' || (p && p.flaps === 2) ? 'Flaps' : 'Flap']);
    const span = x1 - x0, n = parts.length, m0 = 60 * sc, m1 = 120 * sc;
    return parts.map((q, i) => ({ key: q[0], name: q[1], x: x0 + m0 + (span - m0 - m1) * i / (n - 1), w: WIDTHS[q[0]] * sc }));
}
/** The temperature along the pipe (0 engine .. 1 tail pipe), from the two the engine unit reports (cat, opf), for
 * the gas colour only; no number is drawn where there is no sensor. */
function tempAt(f, temps) {
    const cat = temps && temps.cat != null ? temps.cat : 600, opf = temps && temps.opf != null ? temps.opf : cat - 80;
    if (f < 0.3) return lerp(cat + 220, cat, f / 0.3);
    if (f < 0.45) return lerp(cat, opf, (f - 0.3) / 0.15);
    return lerp(opf, Math.max(60, opf * 0.4), (f - 0.45) / 0.55);
}

/** The flap seen from the side: a ring and its blade, open (flat, green), closed (across, amber) or the car's (dim). */
function flapGlyph(cv, x, y, r, state, a) {
    cv.arc(x, y, r - 3, r, 0, 360, GREY);
    const ang = a != null ? a : state === 'OPEN' ? 0 : state === 'CLOSED' ? 90 : 45;
    const c = state === 'OPEN' ? C.green : state === 'CLOSED' ? C.amber : DIM;
    const dx = Math.cos(ang * Math.PI / 180) * (r - 4), dy = Math.sin(ang * Math.PI / 180) * (r - 4);
    cv.line(x - dx, y - dy, x + dx, y + dy, 5, c);
}

/**
 * The engine block seen from above: one dot per cylinder, as many as the engine has (inline: one row; a V8: two
 * banks, one row each, with the V's two heads). A car whose count is not known yet gets a plain block.
 */
function engineBlock(cv, X, cy, S, p, rows, hot) {
    const two = rows.length === 2, hh = two ? S(52) : S(50);
    cv.roundRect(X - S(60), cy - hh, S(120), hh * 2, S(16), '#16181c');
    cv.strokeRoundRect(X - S(60), cy - hh, S(120), hh * 2, S(16), 3, GREY);
    const n = p && p.cylinders ? p.cylinders : 0;
    if (!n) return;
    const banks = p.banks === 2 ? 2 : 1, per = Math.ceil(n / banks);
    for (let b = 0; b < banks; b++) {
        const yy = banks === 2 ? rows[b] : two ? cy : cy - S(6), m = Math.min(per, n - b * per);
        const pitch = Math.min(S(24), S(96) / Math.max(1, m)), r = Math.max(3, Math.min(S(8), pitch * 0.36));
        for (let k = 0; k < m; k++) {
            const xx = X - (m - 1) * pitch / 2 + k * pitch;
            cv.arc(xx, yy, r * 0.7, r, 0, 360, hot ? '#8c94a0' : '#6e7480');
        }
    }
    if (banks === 2) cv.line(X - S(44), cy, X + S(44), cy, 2, '#3a3e46');
}

/**
 * The exhaust from the engine to the tail pipe, centred on cy, from x0 to x1. o = { setup, engine (lib/engine.js
 * profile, else the one set with setEngine), temps: { cat, opf }, flap ('OPEN', 'CLOSED', 'OEM'), flapAngle (0 open ..
 * 90 closed, gliding), t (s), rpm (the car's engine speed: the gas and the turbo follow it), boost (bar, the turbo
 * spins a little faster), flow (0..1.5, a fixed gas speed for the explanations, when no rpm is given), key, labels,
 * numbers }. Two turbos, two banks or two flaps: two
 * pipes, one above the other, each with its own parts and flap. The gas: dots coloured by temperature, moving; behind
 * a closed flap fewer of them.
 */
function exhaustPath(cv, x0, x1, cy, o) {
    o = o || {};
    const p = o.engine !== undefined ? o.engine : ENGINE;
    // the full drawing is made for about 1450 px; narrower (a popup, How to use) it shrinks, labels in two rows
    const sc = Math.min(1, (x1 - x0) / 1450), small = sc < 0.8;
    const parts = layout(o.setup, x0, x1, sc, p), t = o.t || 0, byRpm = o.rpm !== undefined;
    const flow = byRpm ? (o.rpm > 0 ? o.rpm / 2500 : 0.4) : o.flow == null ? 1 : o.flow;
    // the gas and the turbo run on phases that add speed x time each frame (owner, 2026-11-26 20:17: "trokira"):
    // time x speed jumped whenever a new rpm came in. A new speed eases in over 300 ms.
    const key = o.key || 'p96ex|' + Math.round(x0) + '|' + Math.round(cy), now = t * 1000;
    const gas = UI.phase(key + '|gas', byRpm ? UI.flowRate(o.rpm) : 0.25 * Math.max(0.2, flow), now);
    const spin = UI.phase(key + '|spin', byRpm ? UI.turboRate(o.rpm, o.boost) : 2.5 * Math.max(0.3, flow), now);
    const px0 = parts[0].x - 30 * sc, px1 = x1 - 30 * sc, S = (v) => v * sc;
    const two = pipeRows(p, o.setup) === 2, k = two ? 0.58 : 1, rows = two ? [cy - S(30), cy + S(30)] : [cy];
    const nFlaps = !p || !p.fuel ? ((o.setup || {}).flaps === '2' ? 2 : 1) : Math.max(1, p.flaps || 1);
    rows.forEach((ry) => cv.line(px0, ry, px1, ry, Math.max(8, S(22) * (two ? 0.7 : 1)), PIPE));
    if (two) cv.line(parts[0].x, rows[0], parts[0].x, rows[1], Math.max(8, S(16)), PIPE);
    parts.forEach((q, i) => {
        const X = q.x, tc = q.key === 'cat' ? (o.temps || {}).cat : q.key === 'opf' ? (o.temps || {}).opf : null;
        const col = tc != null ? heat(tc) : GREY;
        if (q.key === 'engine') engineBlock(cv, X, cy, S, p, rows, flow > 0.5);
        rows.forEach((ry, ri) => {
            const K = (v) => S(v) * k;
            if (q.key === 'engine') return;
            if (q.key === 'turbo') {
                if (two && p && p.turbos !== 2 && ri === 1) return;          // one turbo, two pipes after it: drawn once
                const ty = two && p && p.turbos !== 2 ? cy : ry;
                cv.circle(X, ty, K(34), '#16181c');
                cv.arc(X, ty, K(31), K(35), 0, 360, col);
                const a = spin * 6.2832 + ri * 0.7;
                for (let j = 0; j < 5; j++) { const aa = a + j * 1.2566; cv.line(X, ty, X + K(24) * Math.cos(aa), ty + K(24) * Math.sin(aa), 3, col); }
            } else if (q.key === 'flap') {
                if (ri >= nFlaps) return;
                cv.circle(X, ry, Math.max(10, K(20)), '#16181c');
                flapGlyph(cv, X, ry, Math.max(10, K(20)), ri === 1 && o.flap2 ? o.flap2 : o.flap, ri === 1 && o.flapAngle2 != null ? o.flapAngle2 : o.flapAngle);
            } else if (!q.pipeOnly) {
                const w = q.w * (two ? 0.86 : 1);
                cv.roundRect(X - w / 2, ry - K(34), w, K(68), K(18), '#16181c');
                cv.strokeRoundRect(X - w / 2, ry - K(34), w, K(68), K(18), small || two ? 3 : 4, q.key === 'scr' ? C.blue : col);
                if (q.key === 'cat' || q.key === 'opf' || q.key === 'scr') for (let j = 0; j < 6; j++) { const xx = X - w / 2 + S(12) + j * (w - S(24)) / 5; cv.line(xx, ry - K(22), xx, ry + K(22), 2, q.key === 'scr' ? '#3c6c96' : tc != null ? heat(tc - 120) : '#5a606a'); }
                if (q.key === 'scr' && ri === 0) {
                    // the AdBlue dosing: a small blue drop just before it, dripping in time
                    const dx = X - w / 2 - S(18), dy = ry - K(34) - S(8), f = (t * 1.2) % 1;
                    cv.circle(dx, dy, Math.max(4, S(7)), C.blue);
                    cv.circle(dx, dy + S(10) + f * S(18), Math.max(2, S(3.5)) * (1 - f * 0.5), C.blue);
                }
            }
        });
        const top = rows[0], bot = rows[rows.length - 1], off = two ? S(34) * k : 0;
        if (o.labels !== false) cv.text(q.name, X, bot + off + (small ? (i % 2 ? 72 : 50) * Math.max(0.75, sc) : two ? 20 : 68), small ? 13 : 15, DIM, { align: 'center', literal: true });
        if (o.numbers !== false && tc != null) cv.text(Math.round(tc) + ' °C', X, top - off - (small ? (i % 2 ? 40 : 62) * Math.max(0.75, sc) : two ? 12 : 52), small ? 16 : 19, C.text, { font: 'bold', align: 'center', literal: true });
    });
    // the gas, in each pipe
    const flapP = parts.filter((q) => q.key === 'flap')[0], n = 24, gx0 = parts[0].x + S(64), len = px1 - gx0;
    rows.forEach((ry, ri) => {
        for (let i = 0; i < n; i++) {
            const f = (gas + i / n + ri * 0.5 / n) % 1, x = gx0 + f * len;
            const fl = ri === 1 && o.flap2 ? o.flap2 : o.flap;
            if (flapP && ri < nFlaps && x > flapP.x + S(20) && fl === 'CLOSED' && i % 2) continue;
            cv.circle(x, ry, Math.max(3, S(5) * (two ? 0.8 : 1)), heat(tempAt(f, o.temps)));
        }
    });
    return parts;
}

/** A sine wave with round ends over the part at x: amplitude a (0..1), coloured by the level. */
function wave(cv, x, y, w, a, t, c) {
    const pts = [];
    for (let i = 0; i <= 32; i++) {
        const f = i / 32;
        pts.push([x - w / 2 + f * w, y - Math.sin(f * Math.PI * 4 - t * 7) * a * 34]);
    }
    cv.stroke(pts, 4, c || levelColour(a));
}

/* ---------- the info popup and How to use animations ---------- */

/** Axes for a small chart: y values right aligned at x, one grid line each. */
function axes(cv, x, y, w, h, lo, hi, step, unit) {
    for (let v = lo; v <= hi + 1e-6; v += step) {
        const yy = y + h - (v - lo) / (hi - lo) * h;
        cv.fillRect(x, Math.round(yy), w, 1, GRID);
        cv.text(String(Math.round(v)) + (v + step > hi + 1e-6 && unit ? ' ' + unit : ''), x - 10, yy + 5, 13, DIM, { align: 'right', literal: true });
    }
}
/** A curve drawn up to progress p (0..1) of f(0..1) -> value, in a box with lo..hi. */
function grow(cv, x, y, w, h, lo, hi, f, p, c, width) {
    const pts = [], n = 48;
    for (let i = 0; i <= n * p; i++) { const k = i / n; pts.push([x + k * w, y + h - (Math.max(lo, Math.min(hi, f(k))) - lo) / (hi - lo) * h]); }
    if (pts.length > 1) UI.curve(cv, pts, width || 4, c);
    return pts[pts.length - 1];
}

const ART = {
    path(cv, x, y, w, h, t) {
        exhaustPath(cv, x + 20, x + w - 10, y + h / 2 - 10, { t: t, temps: { cat: 640, opf: 560 }, flap: 'OPEN', labels: true, numbers: true });
    },
    egt(cv, x, y, w, h, t) {
        const px = x + 90, pw = w - 130, py = y + 60, ph = h - 130;
        axes(cv, px, py, pw, ph, 0, 800, 200, '°C');
        const p = Math.min(1, loop(t, 5) * 1.25);
        const f = (k) => (k < 0.5 ? 120 + 500 * (1 - Math.exp(-k * 6)) : k < 0.75 ? 620 + 180 * ease((k - 0.5) / 0.25) : 800 - 160 * ease((k - 0.75) / 0.25));
        const last = grow(cv, px, py, pw, ph, 0, 800, f, p, C.amber);
        if (last) { cv.circle(last[0], last[1], 7, heat(f(p))); cv.text(Math.round(f(p)) + ' °C', x + w / 2, y + 36, 28, C.text, { font: 'bold', align: 'center', literal: true }); }
        ['start', 'cruise', 'full load', 'cruise'].forEach((s, i) => cv.text(s, px + pw * [0.02, 0.3, 0.62, 0.9][i], py + ph + 24, 13, DIM, { align: 'center', literal: true }));
    },
    load(cv, x, y, w, h, t) {
        // the filter: soot dots filling it, at the mark they burn off (a regeneration), the ash stays
        const p = loop(t, 6), fill = p < 0.7 ? p / 0.7 : 1 - (p - 0.7) / 0.3 * 0.75;
        const bx = x + 70, by = y + 70, bw = w - 140, bh = h - 170;
        cv.roundRect(bx, by, bw, bh, 26, '#16181c');
        cv.strokeRoundRect(bx, by, bw, bh, 26, 4, GREY);
        for (let k = 1; k < 9; k++) cv.line(bx + k * bw / 9, by + 12, bx + k * bw / 9, by + bh - 12, 2, '#3a3e46');
        const nSoot = Math.round(60 * fill);
        for (let i = 0; i < nSoot; i++) cv.circle(bx + 18 + ((i * 37) % (bw - 36)), by + bh - 18 - Math.floor(i / 9) * 14 % (bh - 36), 5, '#5a5048');
        for (let i = 0; i < 8; i++) cv.circle(bx + 20 + i * (bw - 40) / 7, by + bh - 10, 4, '#b4bac4');
        UI.bar(cv, bx, y + h - 72, bw, 12, fill * 0.85, p < 0.7 ? C.green : C.amber);
        const mx = bx + bw * 0.8;
        cv.line(mx, y + h - 82, mx, y + h - 50, 3, C.amber);
        cv.text(p < 0.7 ? 'soot builds up' : 'regeneration: the soot burns off', x + w / 2, y + 44, 18, p < 0.7 ? C.text : C.amber, { font: 'bold', align: 'center', literal: true });
        cv.text('grey: ash, it stays', x + w / 2, y + h - 22, 14, DIM, { align: 'center', literal: true });
    },
    flap(cv, x, y, w, h, t) {
        // the rear silencer cut open (owner, 2026-11-26 23:51: draw how it really works). The inlet pipe goes on through
        // the silencer as a perforated tube to the flap and the first tail pipe; around it are chambers with baffle
        // walls, and a second tail pipe leaves from the last chamber. Flap closed: the tube is shut at its end, the gas
        // leaves through the holes and winds through the chambers, the sound is damped. Flap open: most of the gas
        // goes straight through the tube and out, the shortest way, loud.
        const p = loop(t, 6), open = p < 0.5, a = open ? lerp(90, 0, ease(Math.min(1, p / 0.12))) : lerp(0, 90, ease(Math.min(1, (p - 0.5) / 0.12)));
        const cx = x + w / 2, cy = y + h / 2 - 20, S = Math.min(1, w / 640), X = (v) => cx + v * S, Y = (v) => cy + v * S;
        cv.line(X(-300), Y(-34), X(-218), Y(-34), 18 * S, PIPE);
        cv.line(X(218), Y(-34), X(292), Y(-34), 16 * S, PIPE);
        cv.line(X(218), Y(48), X(292), Y(48), 16 * S, PIPE);
        cv.roundRect(X(-220), Y(-80), 440 * S, 170 * S, 30 * S, '#16181c');
        cv.strokeRoundRect(X(-220), Y(-80), 440 * S, 170 * S, 30 * S, 4, GREY);
        // the perforated tube, its holes, and the baffle walls of the chambers under it
        cv.line(X(-218), Y(-34), X(218), Y(-34), 18 * S, '#2b2f36');
        for (let i = -180; i <= 180; i += 24) cv.circle(X(i), Y(-24), 2.2 * S, '#5a616c');
        cv.line(X(-80), Y(-14), X(-80), Y(52), 4, GREY);
        cv.line(X(60), Y(14), X(60), Y(86), 4, GREY);
        flapGlyph(cv, X(256), Y(-34), 22 * S, open ? 'OPEN' : 'CLOSED', a);
        cv.text('flap', X(256), Y(-66), 14, DIM, { align: 'center', literal: true });
        // the gas: a dot moves along the way it takes now
        const way = open ? [[-300, -34], [300, -34]] : [[-300, -34], [-170, -34], [-150, 10], [-110, 66], [-50, 66], [-10, 30], [40, 0], [90, 0], [140, 40], [218, 48], [300, 48]];
        const lens = []; let tot = 0;
        for (let i = 1; i < way.length; i++) { const d = Math.hypot(way[i][0] - way[i - 1][0], way[i][1] - way[i - 1][1]); lens.push(d); tot += d; }
        const at = (f) => { let d = f * tot; for (let i = 0; i < lens.length; i++) { if (d <= lens[i]) { const k = d / lens[i]; return [lerp(way[i][0], way[i + 1][0], k), lerp(way[i][1], way[i + 1][1], k)]; } d -= lens[i]; } return way[way.length - 1]; };
        const n = open ? 12 : 16, sp = open ? 0.55 : 0.22;
        for (let i = 0; i < n; i++) { const q = at((t * sp + i / n) % 1); cv.circle(X(q[0]), Y(q[1]), 5 * S, open ? C.orange : C.amber); }
        const outY = open ? -34 : 48, waves = open ? 3 : 1;
        for (let k = 0; k < waves; k++) cv.arc(X(308) + k * 16 * S, Y(outY), (16 + k * 10) * S, (19 + k * 10) * S, 60, 120, withA(open ? C.green : C.amber, open ? 1 - k * 0.3 : 0.5), { round: true });
        cv.text(open ? 'OPEN: straight through the tube and out, the shortest way: loud' : 'CLOSED: through the chambers of the rear silencer: quiet',
            cx, y + h - 40, 18, open ? C.green : C.amber, { font: 'bold', align: 'center', literal: true });
    },
    engine(cv, x, y, w, h, t) {
        const cx = x + w / 2, cy = y + h / 2 + 20, r = 120, p = 0.5 + 0.45 * Math.sin(t * 1.3);
        cv.arc(cx, cy, r - 8, r + 8, -135, 135, C.track, { round: true });
        cv.arc(cx, cy, r - 8, r + 8, -135, -135 + 270 * p, C.orange, { round: true });
        cv.text(R2(7000 * p), cx, cy + 18, 54, C.text, { font: 'num', align: 'center', literal: true });
        cv.text('rpm', cx, cy + 48, 16, DIM, { align: 'center', literal: true });
        cv.text('load ' + Math.round(30 + 60 * p) + ' %', cx, y + 40, 20, C.text, { font: 'bold', align: 'center', literal: true });
    },
    rules(cv, x, y, w, h, t) {
        const rows = [['Quiet start', 'CLOSE', C.amber], ['Above 3 000 rpm', 'OPEN', C.green], ['Full throttle', 'OPEN', C.green], ['Sport mode', 'OPEN', C.green]];
        const step = Math.floor(loop(t, 6) * 8);
        const holds = [step >= 6 ? false : step < 2, step >= 2, step >= 4, true];
        let won = -1;
        rows.forEach((r, i) => {
            const yy = y + 50 + i * 72, h1 = holds[i];
            if (h1 && won < 0) won = i;
            const lit = won === i;
            cv.roundRect(x + 30, yy, w - 60, 58, 18, lit ? [70, 210, 130, 40] : [255, 255, 255, 10]);
            if (lit) cv.strokeRoundRect(x + 30, yy, w - 60, 58, 18, 1.5, [70, 210, 130, 120]);
            cv.text((i + 1) + '  ' + r[0], x + 54, yy + 36, 19, h1 ? C.text : DIM, { font: 'bold', literal: true });
            cv.text(h1 ? (lit ? 'wins' : 'holds, waits') : 'does not hold', x + w - 200, yy + 36, 15, lit ? C.green : DIM, { align: 'right', literal: true });
            UI.pill(cv, x + w - 160, yy + 14, r[1], r[2], false);
        });
        cv.text('the top rule that holds decides', x + w / 2, y + h - 20, 15, DIM, { align: 'center', literal: true });
    },
    week(cv, x, y, w, h, t) {
        const p = ease(Math.min(1, loop(t, 5) * 1.6)), bx = x + 60, bw = (w - 120) * p, by = y + h / 2 - 30;
        const parts = [[0.34, C.green, 'open'], [0.21, C.amber, 'closed'], [0.45, '#5a606a', 'the car']];
        let xx = bx;
        parts.forEach((q) => {
            const ww = bw * q[0];
            if (ww > 8) cv.roundRect(xx, by, ww - 6, 60, 22, q[1]);
            if (p > 0.95) cv.text(q[2] + ' ' + Math.round(q[0] * 100) + ' %', xx + ww / 2, by + 96, 16, C.text, { align: 'center', literal: true });
            xx += ww;
        });
    },
    changes(cv, x, y, w, h, t) {
        const items = [['18:12', 'CLOSE', C.amber, 'Quiet start'], ['18:30', 'OPEN', C.green, 'Sport mode'], ['18:41', 'CAR', DIM, 'no rule matched'], ['18:42', 'OPEN', C.green, 'Above 3 000 rpm']];
        const n = Math.min(items.length, Math.floor(loop(t, 6) * 6));
        items.slice(0, n).forEach((it, i) => {
            const yy = y + 60 + i * 74;
            cv.text(it[0], x + 50, yy + 26, 18, DIM, { font: 'bold', literal: true });
            UI.pill(cv, x + 130, yy + 6, it[1], it[2], false);
            cv.text(it[3], x + 250, yy + 26, 19, C.text, { literal: true });
        });
    },
    regen(cv, x, y, w, h, t) {
        const p = loop(t, 6), hot = p > 0.25 && p < 0.85, burn = Math.max(0, Math.min(1, (p - 0.3) / 0.5));
        const px = x + 90, pw = w - 170, py = y + 70, ph = h - 160;
        axes(cv, px, py, pw, ph, 0, 800, 200, '°C');
        const tf = (k) => (k < 0.25 ? 420 : k < 0.3 ? lerp(420, 620, (k - 0.25) / 0.05) : k < 0.8 ? 620 + 20 * Math.sin(k * 30) : lerp(620, 400, (k - 0.8) / 0.2));
        grow(cv, px, py, pw, ph, 0, 800, tf, p, C.red);
        // a diesel filter holds about four times the soot of a petrol one (lib/engine.js filterFigures, an estimate)
        const q = ENGINE && ENGINE.filter === 'dpf' ? 4 : 1, top = 10 * q;
        const sf = (k) => q * (k < 0.3 ? 9 : k < 0.8 ? 9 - (k - 0.3) / 0.5 * 6.5 : 2.5);
        grow(cv, px, py, pw, ph, 0, top, sf, p, C.green);
        for (let g = 0; g <= top + 1e-6; g += 2.5 * q) cv.text(g + (g >= top - 1e-6 ? ' g' : ''), px + pw + 10, py + ph - g / top * ph + 5, 13, C.green, { literal: true });
        cv.text(hot ? 'regenerating: filter hot, soot falling' : p < 0.25 ? 'filter warm, soot steady' : 'done: soot burnt off', x + w / 2, y + 40, 19, hot ? C.amber : C.text, { font: 'bold', align: 'center', literal: true });
        cv.roundRect(px, py + ph + 30, 20, 6, 3, C.red); cv.text('filter temperature', px + 28, py + ph + 37, 14, DIM, { literal: true });
        cv.roundRect(px + 220, py + ph + 30, 20, 6, 3, C.green); cv.text('soot ' + sf(p).toFixed(1) + ' g' + (burn > 0 && burn < 1 ? ', burning' : ''), px + 248, py + ph + 37, 14, DIM, { literal: true });
    },
    drives(cv, x, y, w, h, t) {
        const counts = [5, 4, 2, 1, 0], labels = ['< 5', '5 - 10', '10 - 20', '20 - 40', '> 40 min'], p = ease(Math.min(1, loop(t, 5) * 1.5));
        const bw = (w - 160) / 5, base = y + h - 80;
        counts.forEach((n, i) => {
            const bh = n * 48 * p, bx = x + 80 + i * bw;
            if (bh > 4) cv.roundRect(bx + 10, base - bh, bw - 20, bh, 14, i < 2 ? C.amber : C.green);
            cv.text(labels[i], bx + bw / 2, base + 26, 14, DIM, { align: 'center', literal: true });
        });
        cv.text('under 10 minutes: too short to clean', x + w / 2, y + 40, 18, C.amber, { font: 'bold', align: 'center', literal: true });
    },
    ash(cv, x, y, w, h, t) {
        const px = x + 80, pw = w - 130, py = y + 60, ph = h - 130, p = Math.min(1, loop(t, 5) * 1.3);
        axes(cv, px, py, pw, ph, 0, 60, 15, 'g');
        const fy = py + ph - 45 / 60 * ph;
        cv.line(px, fy, px + pw, fy, 2, C.red);
        cv.text('about full', px + pw, fy - 8, 13, C.red, { align: 'right', literal: true });
        grow(cv, px, py, pw * 0.55, ph, 0, 60, (k) => 14 * k, p, GREY);
        if (p > 0.9) for (let i = 0; i < 12; i++) { const k = i / 11; cv.circle(px + pw * (0.55 + 0.45 * k), py + ph - (14 + 31 * k) / 60 * ph, 2.5, C.green); }
        ['0', '48k km', '150k km'].forEach((s, i) => cv.text(s, px + pw * [0, 0.55, 1][i], py + ph + 22, 13, DIM, { align: 'center', literal: true }));
    },
    warmup(cv, x, y, w, h, t) {
        const px = x + 90, pw = w - 130, py = y + 60, ph = h - 130, p = Math.min(1, loop(t, 5) * 1.25);
        axes(cv, px, py, pw, ph, 0, 500, 100, '°C');
        const lo = py + ph - 300 / 500 * ph;
        cv.line(px, lo, px + pw, lo, 1.5, C.green);
        cv.text('catalyst works', px + pw, lo - 8, 13, C.green, { align: 'right', literal: true });
        const f = (k) => 10 + 470 * (1 - Math.exp(-k * 2.5));
        const last = grow(cv, px, py, pw, ph, 0, 500, f, p, C.amber);
        grow(cv, px, py, pw, ph, 0, 500, (k) => 10 + 75 * k, p, C.blue);
        if (last) cv.circle(last[0], last[1], 7, f(p) >= 300 ? C.green : C.amber);
        cv.text(f(p) >= 300 ? 'warm: it cleans now' : 'cold: richer and louder', x + w / 2, y + 36, 19, f(p) >= 300 ? C.green : C.amber, { font: 'bold', align: 'center', literal: true });
    },
    ready(cv, x, y, w, h, t) {
        const s = Math.min(160, Math.floor(loop(t, 6) * 200));
        cv.text(Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2), x + w / 2, y + h / 2 + 10, 84, s >= 160 ? C.green : C.text, { font: 'num', align: 'center', literal: true });
        UI.bar(cv, x + 80, y + h / 2 + 50, w - 160, 12, s / 160, s >= 160 ? C.green : C.amber);
        cv.text(s >= 160 ? 'catalyst ready' : 'warming up', x + w / 2, y + h - 40, 18, DIM, { align: 'center', literal: true });
    },
    sound(cv, x, y, w, h, t) {
        const parts = exhaustPath(cv, x + 10, x + w - 10, y + h / 2 + 50, { t: t, flap: 'OPEN', labels: false, numbers: false, temps: { cat: 640, opf: 560 } });
        const lv = M.sound(M.SETUP_DEFAULT, 'OPEN');
        parts.forEach((p) => { const lvl = M.levelAt(lv, p.key), l = lvl != null ? lvl : 0.2; wave(cv, p.x, y + 90, 50, l * 0.9, t); });
        cv.text('loud at the engine, quiet at the tail pipe', x + w / 2, y + h - 24, 15, DIM, { align: 'center', literal: true });
    },
    tips(cv, x, y, w, h, t) {
        const items = ['Flap open', 'Exhaust warm', 'Filter fresh', 'Revs 3 000 to 5 000', 'Sport mode'], n = Math.floor(loop(t, 6) * 7);
        items.forEach((s, i) => {
            const yy = y + 60 + i * 60, on = i < n, ok = i !== 2;
            cv.circle(x + 70, yy, 14, on ? (ok ? C.green : C.amber) : '#30343c');
            if (on) cv.text(ok ? 'v' : '!', x + 70, yy + 6, 16, C.dark, { font: 'bold', align: 'center', literal: true });
            cv.text(s, x + 100, yy + 7, 20, on ? C.text : DIM, { font: 'bold', literal: true });
        });
    },
    score(cv, x, y, w, h, t) {
        const p = ease(Math.min(1, loop(t, 5) * 1.6)), v = Math.round(72 * p), cx = x + w / 2, cy = y + h / 2, r = 110;
        cv.arc(cx, cy, r - 8, r + 8, -135, 135, C.track, { round: true });
        if (v > 0) cv.arc(cx, cy, r - 8, r + 8, -135, -135 + 270 * v / 100, C.orange, { round: true });
        cv.text(String(v), cx, cy + 20, 64, C.text, { font: 'num', align: 'center', literal: true });
        cv.text('an estimate', cx, cy + 52, 16, DIM, { align: 'center', literal: true });
    },
    hist(cv, x, y, w, h, t) {
        const px = x + 80, pw = w - 120, py = y + 50, ph = h - 120, p = Math.min(1, loop(t, 6) * 1.3);
        axes(cv, px, py, pw, ph, 0, 100, 25, '%');
        const my = py + ph - 0.8 * ph;
        cv.line(px, my, px + pw, my, 2, C.amber);
        const shape = [10, 30, 55, 78, 20, 40, 62, 80, 25, 45, 70, 38];
        grow(cv, px, py, pw, ph, 0, 100, (k) => { const f = k * 11, i = Math.min(10, Math.floor(f)); return lerp(shape[i], shape[i + 1], f - i); }, p, C.green);
        ['-8 w', '-4 w', 'now'].forEach((s, i) => cv.text(s, px + pw * i / 2, py + ph + 22, 13, DIM, { align: 'center', literal: true }));
    },
    setup(cv, x, y, w, h, t) {
        const steps = [M.SETUP_DEFAULT, Object.assign({}, M.SETUP_DEFAULT, { mid: 'none' }), Object.assign({}, M.SETUP_DEFAULT, { flaps: '2' })];
        const s = steps[Math.floor(loop(t, 9) * 3)];
        exhaustPath(cv, x + 10, x + w - 10, y + h / 2, { t: t, setup: s, flap: 'OPEN', labels: true, numbers: false, temps: { cat: 600, opf: 520 } });
        cv.text('the drawing follows your setup', x + w / 2, y + 44, 18, C.text, { font: 'bold', align: 'center', literal: true });
    },
};
function R2(v) { return String(Math.round(v / 50) * 50).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function withA(c, a) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), Math.round(255 * Math.max(0, Math.min(1, a)))]; }

/** The animation for an info popup or topic key: draw(cv, x, y, w, h, t). */
/** An electric car: a motor and a battery, current flowing between them, and no tail pipe. */
ART.noEngine = function (cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2;
    cv.roundRect(cx - 320, cy - 46, 220, 92, 22, '#16181c');
    cv.strokeRoundRect(cx - 320, cy - 46, 220, 92, 22, 4, C.blue);
    for (let k = 0; k < 6; k++) cv.roundRect(cx - 300 + k * 32, cy - 26, 22, 52, 8, k < 4 ? '#2c4c6c' : '#30343c');
    cv.text('battery', cx - 210, cy + 74, 15, DIM, { align: 'center', literal: true });
    cv.circle(cx + 210, cy, 54, '#16181c');
    cv.arc(cx + 210, cy, 50, 55, 0, 360, C.blue);
    const a = t * 3;
    for (let k = 0; k < 3; k++) { const aa = a + k * 2.094; cv.line(cx + 210, cy, cx + 210 + 38 * Math.cos(aa), cy + 38 * Math.sin(aa), 5, C.blue); }
    cv.text('motor', cx + 210, cy + 74, 15, DIM, { align: 'center', literal: true });
    cv.line(cx - 96, cy, cx + 152, cy, 6, PIPE);
    for (let i = 0; i < 8; i++) { const f = (t * 0.6 + i / 8) % 1; cv.circle(cx - 96 + f * 248, cy, 5, C.blue); }
    // where a tail pipe would be: crossed out, in grey
    const px = cx + 300;
    cv.line(px, cy - 20, px + 60, cy - 20, 4, GREY);
    cv.line(px + 4, cy - 38, px + 56, cy - 2, 4, DIM);
    cv.text('no tail pipe', px + 30, cy + 74, 15, DIM, { align: 'center', literal: true });
};
/** The SCR catalyst: AdBlue drops sprayed into the gas, the nitrogen oxides (amber) leave as clean gas (green). */
ART.scr = function (cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2 - 10;
    cv.line(x + 40, cy, x + w - 40, cy, 18, PIPE);
    cv.roundRect(cx - 40, cy - 60, 240, 120, 30, '#16181c');
    cv.strokeRoundRect(cx - 40, cy - 60, 240, 120, 30, 4, C.blue);
    for (let k = 0; k < 7; k++) cv.line(cx - 10 + k * 30, cy - 40, cx - 10 + k * 30, cy + 40, 2, '#3c6c96');
    cv.circle(cx - 120, cy - 70, 14, C.blue);
    cv.line(cx - 120, cy - 56, cx - 120, cy - 22, 4, C.blue);
    for (let i = 0; i < 14; i++) {
        const f = (t * 0.35 + i / 14) % 1, xx = x + 40 + f * (w - 80);
        const clean = xx > cx + 120;
        cv.circle(xx, cy + ((i * 7) % 5 - 2) * 3, 5, clean ? C.green : xx > cx - 120 ? C.blue : C.amber);
    }
    cv.text('nitrogen oxides in', x + 60, cy + 90, 15, C.amber, { literal: true });
    cv.text('AdBlue sprayed in', cx - 120, cy - 96, 15, C.blue, { align: 'center', literal: true });
    cv.text('nitrogen and water out', x + w - 60, cy + 90, 15, C.green, { align: 'right', literal: true });
};
function artFor(key) { return ART[key] || ART.path; }

module.exports = { exhaustPath, layout, pipeRows, setEngine, engineBlock, flapGlyph, wave, heat, levelColour, artFor, ART, tempAt };
