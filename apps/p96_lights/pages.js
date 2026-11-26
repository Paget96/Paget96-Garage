// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Lights' pages: pure drawing from the values, so the same code draws the head unit and the screenshots.
 *
 *   draw(cv, v, st, t, act)
 *     v:   { armed, moving (true, false or null: no speed yet), ambient: { state, n, scene }, lamps: { kind, running,
 *          note }, presets, preset, beat (the beat the preview shows), flash: { pattern, rate } }
 *     st:  { page: 'main' | 'help' | 'settings', tab, topic, settings, status, statusColor, demo, now }
 *     act: { tab(i), help(), settings(), back(), topic(i), set(k, v), colour(rgb), effect(kind), bright(d), carOwn(),
 *            pick(i), play(), stop(), flashPattern(p), flashRate(r), flash(), demoOff() }
 *
 * Everything that switches a light goes through the gate in main.js: armed in Settings, the car standing still for
 * the sequences and the flashes. Until it is armed the pages show what would happen on the drawing only.
 */
function ui() {
    try { return require('./garage_ui'); }
    catch (e) { return require('../../lib/ui'); }
}
const UI = ui();
const E = (function () { try { return require('./garage_engine'); } catch (e) { return require('../../lib/engine'); } })();
const PR = require('./presets');
const C = UI.C, T = UI.CONTENT_TOP, L = UI.MARGIN, R = UI.W - UI.MARGIN;
const lit = { literal: true };
const TITLE = 'LIGHTS';
const TABS = ['Ambient', 'Party', 'Flash'];

const APP_ROWS = [
    { key: 'arm', label: 'Light control', hint: 'Simulated: shown on the drawing only, nothing is sent to the car', type: 'choice', default: 'off',
        options: [['off', 'Simulated'], ['on', 'Armed']] },
];

const COLOURS = [['Red', [255, 30, 20]], ['Orange', [255, 110, 0]], ['Amber', [255, 170, 30]], ['White', [255, 245, 230]],
    ['Ice', [120, 200, 255]], ['Blue', [30, 80, 255]], ['Purple', [150, 40, 255]], ['Green', [40, 220, 90]]];
const EFFECTS = [['solid', 'Solid'], ['breathing', 'Breathe'], ['rainbow', 'Rainbow'], ['wave', 'Wave']];

/* ---------- the car with its lamps ---------- */

// where each light function sits on UI.carTop's G20 (front up, its units: half width 75, length -152 to 153)
const LAMPS = {
    high: [[-46, -146], [46, -146]], fog: [[-52, -150], [52, -150]], cornL: [[-62, -138]], cornR: [[62, -138]],
    indL: [[-68, -126], [-64, 138]], indR: [[68, -126], [64, 138]], parkL: [[-34, -149], [-50, 146]], parkR: [[34, -149], [50, 146]],
    brake: [[-40, 150], [40, 150]], reverse: [[-16, 152]], rearFog: [[16, 152]],
};
const LAMP_COL = { high: [255, 255, 240], fog: [255, 250, 220], cornL: [255, 250, 220], cornR: [255, 250, 220], indL: [255, 160, 20], indR: [255, 160, 20],
    parkL: [255, 245, 230], parkR: [255, 245, 230], brake: [255, 30, 20], reverse: [255, 255, 255], rearFog: [255, 40, 30] };

/** The car from above, the functions in on set lit with a glow; cabin: an ambient colour over the cabin ([r, g, b, a]). */
function carLamps(cv, cx, cy, k, on, cabin) {
    UI.carTop(cv, cx, cy, k);
    if (cabin) cv.roundRect(cx - 46 * 0.84 * k, cy - 60 * k, 92 * 0.84 * k, 140 * k, 20 * k, cabin);
    const kx = k * 0.84;
    Object.keys(LAMPS).forEach((fn) => LAMPS[fn].forEach((q) => {
        const x = cx + q[0] * kx, y = cy + q[1] * k, c = LAMP_COL[fn];
        if (on && on.has(fn)) {
            cv.circle(x, y, 16 * k, [c[0], c[1], c[2], 60]);
            cv.circle(x, y, 7 * k, [c[0], c[1], c[2], 255]);
        } else cv.circle(x, y, 4 * k, '#3a3f48');
    }));
}

/* ---------- the gate, said in words ---------- */

function gateLine(v, what) {
    if (!v.armed) return ['Simulated: shown on the drawing only. Arm it in Settings.', C.amber];
    if (what !== 'ambient' && v.moving !== false) return [v.moving ? 'Only while the car stands still.' : 'Waiting for the car\'s speed: stand still with the engine on.', C.amber];
    if (v.lamps && v.lamps.note) return [v.lamps.note, C.dim];
    return [what === 'ambient' ? 'Armed: the colour goes to the car.' : 'Armed: the car\'s own lights, only while parked.', C.green];
}

/* ---------- Ambient ---------- */

function pageAmbient(cv, v, st, t, act) {
    const lw = 640, s = (v.ambient && v.ambient.scene) || {}, up = s.upper || { rgb: COLOURS[4][1], bright: 70 };
    UI.card(cv, L, T, lw, UI.hh(), 'Ambient light', {});
    const k = Math.min(1.3, (UI.hh() - 90) / 320);
    const glow = s.kind === 'breathing' ? 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(t * 1.6)) : 1;
    const rgb = s.kind === 'rainbow' || s.kind === 'wave' ? hsv((t * 40) % 360) : up.rgb;
    carLamps(cv, L + lw / 2, T + UI.hh() / 2 + 8, k, null, s.own ? null : [rgb[0], rgb[1], rgb[2], Math.round(150 * glow * up.bright / 100)]);
    const g = gateLine(v, 'ambient');
    cv.text(g[0], L + 20, T + UI.hh() - 16, 14, g[1], lit);
    const x = L + lw + 14, w = R - x;
    UI.card(cv, x, T, w, UI.hh(), 'Colour', {});
    const cols = 4, gap = 14, sw = Math.floor((w - 40 - gap * (cols - 1)) / cols), sh = 64;
    COLOURS.forEach((c, i) => {
        const cx = x + 20 + (i % cols) * (sw + gap), cy = T + 56 + Math.floor(i / cols) * (sh + gap), sel = !s.own && same(up.rgb, c[1]);
        cv.roundRect(cx, cy, sw, sh, 18, [c[1][0], c[1][1], c[1][2], 230]);
        if (sel) cv.strokeRoundRect(cx - 3, cy - 3, sw + 6, sh + 6, 20, 3, C.text);
        cv.text(c[0], cx + sw / 2, cy + sh / 2 + 6, 16, [20, 20, 24], { font: 'bold', align: 'center', literal: true });
        if (cv.target) cv.target(cx, cy, sw, sh, () => act.colour(c[1]), 'lcol|' + i, 18);
    });
    const ry = T + 56 + 2 * (sh + gap) + 18;
    cv.text('Effect', x + 20, ry + 6, 16, C.dim, lit);
    UI.segmented(cv, x + w - 20, ry, EFFECTS, s.kind || 'solid', act.effect, 'leffect');
    cv.text('Brightness', x + 20, ry + 62, 16, C.dim, lit);
    UI.stepper(cv, x + w - 20, ry + 56, up.bright, { unit: '%', decimals: 0, key: 'lbright', onMinus: () => act.bright(-10), onPlus: () => act.bright(10) });
    UI.button(cv, x + 20, T + UI.hh() - 64, 'The car\'s own colour', act.carOwn, { key: 'lown', filled: !!s.own });
}

/* ---------- Party ---------- */

function pageParty(cv, v, st, t, act) {
    const lw = 640, list = v.presets || PR.DEFAULTS, p = list[v.preset || 0] || list[0];
    UI.card(cv, L, T, lw, UI.hh(), 'Party: ' + p.name, {});
    const k = Math.min(1.3, (UI.hh() - 90) / 320);
    carLamps(cv, L + lw / 2, T + UI.hh() / 2 + 8, k, PR.lit(p, v.beat || 0), null);
    // the beats under the car: the one playing now lit
    const bw = (lw - 40) / PR.BEATS;
    for (let i = 0; i < PR.BEATS; i++) cv.roundRect(L + 20 + i * bw + 2, T + UI.hh() - 46, bw - 4, 8, 4, i === (v.beat || 0) ? C.accent : p.beats[i].length ? '#4a4f58' : '#2a2d34');
    const g = gateLine(v, 'sequence');
    cv.text(g[0], L + 20, T + UI.hh() - 16, 14, g[1], lit);
    const x = L + lw + 14, w = R - x;
    UI.card(cv, x, T, w, UI.hh(), 'Sequences', {});
    const rh = Math.min(56, (UI.hh() - 140) / list.length);
    list.forEach((q, i) => {
        const yy = T + 50 + i * rh, sel = i === (v.preset || 0);
        if (sel) cv.roundRect(x + 10, yy, w - 20, rh - 6, 18, '#262a33');
        cv.text(q.name, x + 28, yy + rh / 2 + 3, 19, sel ? C.text : C.dim, { font: 'bold', literal: true });
        cv.text(q.beatMs + ' ms a beat', x + w - 28, yy + rh / 2 + 3, 14, C.dim, { align: 'right', literal: true });
        if (cv.target) cv.target(x + 10, yy, w - 20, rh - 6, () => act.pick(i), 'lpre|' + i, 18);
    });
    const running = v.lamps && v.lamps.running === 'sequence';
    UI.button(cv, x + 20, T + UI.hh() - 64, running ? 'Stop' : 'Play', running ? act.stop : act.play, { key: 'lplay', filled: true });
}

/* ---------- Flash ---------- */

function pageFlash(cv, v, st, t, act) {
    const lw = 640, f = v.flash || {}, rate = f.rate || 'normal', per = { fast: 0.18, normal: 0.3, slow: 0.6 }[rate];
    UI.card(cv, L, T, lw, UI.hh(), 'High beam flashes', {});
    const k = Math.min(1.3, (UI.hh() - 90) / 320), ph = Math.floor(t / per) % 2;
    const running = v.lamps && v.lamps.running === 'strobe';
    const on = new Set(running || !v.armed ? (f.pattern === 'alternate' ? [ph ? 'cornL' : 'cornR', 'high'] : ph ? ['high'] : []) : []);
    carLamps(cv, L + lw / 2, T + UI.hh() / 2 + 8, k, on, null);
    const g = gateLine(v, 'strobe');
    cv.text(g[0], L + 20, T + UI.hh() - 16, 14, g[1], lit);
    const x = L + lw + 14, w = R - x;
    UI.card(cv, x, T, w, UI.hh(), 'How', {});
    cv.text('Pattern', x + 20, T + 86, 16, C.dim, lit);
    UI.segmented(cv, x + w - 20, T + 80, [['both', 'Both'], ['alternate', 'Left and right']], f.pattern || 'both', act.flashPattern, 'lpat');
    cv.text('Speed', x + 20, T + 146, 16, C.dim, lit);
    UI.segmented(cv, x + w - 20, T + 140, [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], rate, act.flashRate, 'lrate');
    UI.wrap(cv, 'For a show on private ground, never on a public road: the car\'s own high beam, each flash under 150 ms, and the car takes its lights back by itself when the app stops.', 15, w - 40)
        .forEach((ln, i) => cv.text(ln, x + 20, T + 210 + i * 22, 15, C.dim, lit));
    UI.button(cv, x + 20, T + UI.hh() - 64, running ? 'Stop' : 'Start', running ? act.stop : act.flash, { key: 'lflash', filled: true });
}

/* ---------- helpers ---------- */

function same(a, b) { return !!a && !!b && a.every((x, i) => Math.abs(x - b[i]) < 4); }
function hsv(h) {
    const f = (n) => { const kk = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(kk, 4 - kk, 1)))); };
    return [f(5), f(3), f(1)];
}

/* ---------- How to use ---------- */

const TOPICS = [
    { title: 'Ambient light', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), null, [...hsv((t * 40) % 360), 150]),
        text: 'Pick a colour, an effect and how bright: the car\'s ambient lights take it. The car\'s own colour gives every light back to the car.\n\nThe colour goes out over the body controller, about five writes a second, so a moving effect is gentle rather than fast.' },
    { title: 'Party', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), PR.lit(PR.DEFAULTS[0], Math.floor(t * 4) % PR.BEATS), null),
        text: 'Six light sequences over the car\'s own lamps: high beam, cornering, fog, indicators, parking lights, brake, reverse and rear fog. Each beat switches its lamps on for a moment; the car switches them off by itself.\n\nOnly while the car stands still, and only once you arm it in Settings.' },
    { title: 'Flash', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), new Set(Math.floor(t * 3) % 2 ? ['high'] : []), null),
        text: 'High beam flashes, both or left and right, for a show on private ground. Never on a public road.' },
    { title: 'Simulated until armed', draw: null,
        text: 'Out of the box nothing is sent: the drawing shows what would happen. Settings, Light control, Armed: from then on the app switches the car\'s lights the way a workshop tester does, and gives them back when it stops.' },
    UI.DEMO_TOPIC,
];
const HELP_TOPICS = TOPICS.concat([UI.REPORT_TOPIC]);
const PAGES = [pageAmbient, pageParty, pageFlash];

function head(cv, st, act) {
    UI.background(cv);
    UI.tabs(cv, TABS, st.tab, { onSelect: act.tab });
    UI.title(cv, TITLE, null, null, { clock: false });
    UI.header(cv, { status: st.status, statusColor: st.statusColor, demo: !!st.demo, onDemo: act.demoOff, onHelp: act.help, onSettings: act.settings });
    if (UI.railOn && UI.railOn(cv)) UI.setRailShown(1);
}

function draw(cv, v, st, t, act) {
    if (st.page === 'help') {
        UI.howToUse(cv, HELP_TOPICS, st.topic || 0, t, { title: TITLE, onSelect: act.topic, onBack: act.back, onSettings: act.settings });
    } else if (st.page === 'settings' && st.report && st.report.active()) {
        UI.reportPage(cv, st.report, t, { title: TITLE, onHelp: () => { st.report.close(); act.help(); } });
    } else if (st.page === 'settings') {
        UI.settingsPage(cv, (st.demo ? [E.DEMO_ROW] : []).concat(APP_ROWS), st.settings, act.set, { title: TITLE, appLabel: 'Lights', onBack: act.back, onHelp: act.help,
            onReport: st.report ? () => st.report.open() : null });
    } else {
        head(cv, st, act);
        PAGES[st.tab || 0](cv, v, st, t, act);
    }
    UI.overlay(cv, t);
}

const DEFAULTS = {};
UI.DISPLAY_SETTINGS.concat(APP_ROWS, [E.DEMO_ROW]).forEach((r) => { DEFAULTS[r.key] = r.default; });

module.exports = { draw, TABS, TOPICS, APP_ROWS, PAGES, DEFAULTS, COLOURS, TITLE, carLamps };
