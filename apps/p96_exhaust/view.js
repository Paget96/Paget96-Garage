// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Exhaust's pages, drawn with the Paget96 Garage UI (lib/ui.js, shipped as garage_ui.js). draw() takes the data (S),
 * where the user is (V) and the actions (A, called by the touch and knob targets), and records one frame.
 *
 *   S  { at, demo, live, caps, v (live values), hist, flap { mode, sides, views, decided, armed }, rules, held, active,
 *        flapLog, regen, regens, loads, loadsKm, drives, ash, kmNow, warm, lightOffs, starts, setup, setupFound, values }
 *   V  { page, mode: 'main' | 'help' | 'settings', side, ruleFirst, dialog, helpSel, edit, editPart, values }
 *   A  { tab, help, settings, back, helpTopic, setting, flapMode, flapSide, ruleToggle, ruleOpen, ruleScroll, setup,
 *        and the rule dialog's: kind, op, step, action, flap, addAnd, dropAnd, part }
 *
 * Only what the car reports is drawn (M.has(caps, ...)); data colours are fixed, only the chrome follows the ambient
 * light (UI.C.accent). Every card has an (i).
 */
function need(local, repo) {
    try { return require(local); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return require(repo); }
}
const UI = need('./garage_ui', '../../lib/ui');
const M = require('./model');
const R = require('./rules');
const F = require('./flap');
const T = require('./texts');
const ART = require('./art');
const E = need('./garage_engine', '../../lib/engine');
const C = UI.C, TOP = UI.CONTENT_TOP, X0 = UI.MARGIN, X1 = UI.W - UI.MARGIN;
const TEXT2 = '#c8ced6';

const COL = { ok: C.green, warm: C.amber, bad: C.red, info: C.blue, dim: C.dim, accent: C.orange };
const col = (c) => COL[c] || c || C.text;
const ACT_COL = { OPEN: 'ok', CLOSED: 'warm', OEM: 'dim' };
const has = (S, k) => M.has(S.caps, k);
const num = (v, d) => (v == null ? '--' : d ? v.toFixed(d) : R.thousands(v));

/* ---------- info popups ---------- */
const infos = {};
/** The engine the texts are for (set each frame): the filter is the OPF on a petrol, the DPF on a diesel. */
let ENG = null;
const fname = () => { const n = E.filterName(ENG && ENG.fuel ? ENG : { filter: 'opf' }); return n === 'filter' ? 'OPF' : n; };
/** A text for this engine: OPF named as this car's filter, the petrol words for a diesel's. */
function forEngine(str) {
    if (!str || fname() === 'OPF') return str;
    return String(str).replace(/OPF/g, 'DPF').replace(/petrol particulate filter/g, 'diesel particulate filter');
}
function info(key) {
    const k = key + '|' + fname();
    if (!infos[k]) {
        const i = T.INFO[key] || { label: key, title: key, text: '' };
        infos[k] = Object.assign({}, i, { label: forEngine(i.label), title: forEngine(i.title), text: forEngine(i.text), note: forEngine(i.note), draw: ART.artFor(i.art || key) });
        if (key === 'opfLoad' && ENG && ENG.filter === 'dpf') infos[k].note = 'A diesel filter holds far more soot than a petrol one: the engine unit burns it off with extra fuel near the mark, on a longer drive at steady speed (an estimate, BMW gives no figures).';
    }
    return infos[k];
}

/* ---------- small parts ---------- */
const rule = (cv, x, y, w) => cv.fillRect(x, y, w, 1, '#282c34');
function fit(cv, s, size, maxW, font) {
    s = String(s);
    const o = { font: font || 'label', literal: true };
    if (cv.textWidth(s, size, o) <= maxW) return s;
    while (s.length > 3 && cv.textWidth(s + '...', size, o) > maxW) s = s.slice(0, -1);
    return s + '...';
}
function pillRight(cv, right, y, text, color, filled) {
    const w = Math.ceil(cv.textWidth(text, 15, { font: 'bold' })) + 28;
    UI.pill(cv, right - w, y, text, color, filled);
    return w;
}
function chev(cv, x, y, s, dir, c) {
    const k = dir === 'up' ? -1 : 1;
    cv.stroke([[x - s * 0.5, y - k * s * 0.3], [x, y + k * s * 0.3], [x + s * 0.5, y - k * s * 0.3]], 3, c);
}
/** A pill button: filled in `fill` when on (dark text), glass when off. Returns its rect and adds a target. */
function choice(cv, x, y, w, h, label, on, fill, run, key, size) {
    size = size || 17;
    if (on) cv.roundRect(x, y, w, h, h / 2, fill || C.accent);
    else { cv.roundRect(x, y, w, h, h / 2, '#2a2d34'); cv.strokeRoundRect(x, y, w, h, h / 2, 1.5, C.glassLine); }
    cv.text(label, x + w / 2, y + h / 2 + size * 0.36, size, on ? C.dark : (run ? C.text : '#5a606a'), { font: 'bold', align: 'center', literal: true });
    if (run && cv.target) cv.target(x, y, w, h, run, key, h / 2);
}
/** Cards side by side over the width: fns are (x, w) => draw; their count decides the width. */
function row(cv, y, fns, x0, x1) {
    x0 = x0 == null ? X0 : x0; x1 = x1 == null ? X1 : x1;
    const gap = 14, n = fns.length, w = Math.floor((x1 - x0 - gap * (n - 1)) / Math.max(1, n));
    fns.forEach((f, i) => f(x0 + i * (w + gap), i === n - 1 ? x1 - x0 - i * (w + gap) : w));
}
const actionWord = (a) => R.ACTION_WORD[a] || a;

/* ---------- the frame ---------- */
function frame(cv, S, V, A) {
    UI.background(cv);
    ENG = S.engine || null;
    ART.setEngine(ENG);
    const pages = M.pagesFor(S.caps, S.engine), names = M.tabsFor(S.engine);
    UI.tabs(cv, pages.map((i) => names[i]), pages.indexOf(V.page), { onSelect: (i) => A.tab(pages[i]) });
    UI.title(cv, 'EXHAUST');
    const st = S.live || S.demo ? ['LIVE', 'ok'] : ['WAIT', 'dim'];
    UI.header(cv, { status: st[0], statusColor: st[1], demo: !!S.demo, onDemo: A.demoOff, onHelp: A.help, onSettings: A.settings });
}

/* ---------- Now ---------- */
function flapShown(S, i) {
    const f = S.flap || {}, v = f.views && f.views[f.sides ? f.sides[i || 0] || f.sides[0] : 'both'];
    return v ? (v.confirmed !== 'UNKNOWN' ? v.confirmed : v.requested) : 'OEM';
}
/** An electric car: no exhaust, nothing to read (owner rule 2026-11-26 19:03: the app says so). */
function noExhaust(cv, S, t) {
    UI.card(cv, X0, TOP, X1 - X0, UI.hh(), 'This car', { info: info('noEngine') });
    const cx = (X0 + X1) / 2;
    ART.ART.noEngine(cv, X0 + 40, TOP + 40, X1 - X0 - 80, 230, t);
    cv.text('No exhaust on an electric car', cx, TOP + 300, 30, C.text, { font: 'bold', align: 'center', literal: true });
    cv.text('Exhaust shows the flap, the particulate filter and the sound of a car with an engine. This car has none, so there is nothing to show.', cx, TOP + 340, 17, C.dim, { align: 'center', literal: true });
}
function now(cv, S, V, A, t) {
    const v = S.v || {};
    if (S.engine && S.engine.engine === false) return noExhaust(cv, S, t);
    const two = ART.pipeRows(S.engine, S.setup) === 2;
    UI.card(cv, X0, TOP, X1 - X0, Math.round(UI.hh() * 0.5), two ? 'Exhaust now: engine to the two tail pipes' : 'Exhaust now: engine to tail pipe', { info: info('path') });
    const fs = flapShown(S), ang = UI.glide('ex|flapangle', fs === 'OPEN' ? 0 : fs === 'CLOSED' ? 90 : 45, null, 10);
    const fs2 = flapShown(S, 1), ang2 = UI.glide('ex|flapangle2', fs2 === 'OPEN' ? 0 : fs2 === 'CLOSED' ? 90 : 45, null, 10);
    ART.exhaustPath(cv, X0 + 50, X1 - 20, TOP + Math.round(UI.hh() * 0.29), { setup: S.setup, engine: S.engine, temps: { cat: has(S, 'egt') ? v.egt : null, opf: has(S, 'pfTemp') ? v.pfTemp : null },
        flap: has(S, 'flap') ? fs : 'OEM', flapAngle: ang, flap2: has(S, 'flap2') ? fs2 : null, flapAngle2: ang2, t: t, rpm: v.rpm == null ? null : v.rpm, boost: v.boost, key: 'ex|now' });
    const h = S.hist || {}, y = TOP + Math.round(UI.hh() * 0.5) + 14, ch = UI.hh() - Math.round(UI.hh() * 0.5) - 14;
    const cards = [];
    if (has(S, 'egt')) cards.push((x, w) => UI.stat(cv, x, y, w, ch, { label: 'Exhaust after cat', value: v.egt, decimals: 0, unit: '°C', sub: 'model from the engine unit',
        color: 'warm', history: h.egt, minSpan: 20, seq: h.seq, every: 1000, info: info('egt') }));
    if (has(S, 'load')) cards.push((x, w) => UI.stat(cv, x, y, w, ch, { label: fname() + ' load', value: v.load, decimals: 0, unit: '%',
        sub: (v.soot != null ? 'soot ' + v.soot.toFixed(1) + ' g' : '') + (has(S, 'ash') && v.ash != null ? ', ash ' + Math.round(v.ash) + ' g' : ''),
        color: v.load != null && v.load >= 80 ? 'warm' : 'ok', history: h.load, minSpan: 4, seq: h.seq, every: 1000, info: info('opfLoad') }));
    else if (has(S, 'soot')) cards.push((x, w) => UI.stat(cv, x, y, w, ch, { label: fname() + ' soot', value: v.soot, decimals: 1, unit: 'g', sub: 'in the particulate filter', color: 'ok', info: info('opfLoad') }));
    if (has(S, 'adblue')) cards.push((x, w) => UI.stat(cv, x, y, w, ch, { label: 'AdBlue tank', value: v.adblue, decimals: 0, unit: '%',
        sub: v.adblue == null ? 'reading' : v.adblue < 15 ? 'low: top up soon' : 'for the SCR catalyst', color: v.adblue != null && v.adblue < 15 ? 'warm' : 'info', info: info('adblue') }));
    if (has(S, 'flap')) cards.push((x, w) => {
        UI.card(cv, x, y, w, ch, has(S, 'flap2') ? 'Flaps' : 'Flap', { info: info('flapCard') });
        const word = fs === 'OEM' ? 'CAR' : fs === 'CLOSED' ? 'CLOSED' : 'OPEN';
        cv.text(word, x + 20, y + 80, 48, fs === 'OPEN' ? C.green : fs === 'CLOSED' ? C.amber : C.text, { font: 'bold', literal: true });
        const d = S.flap.decided && S.flap.decided[S.flap.sides[0]];
        const vw = S.flap.views[S.flap.sides[0]];
        cv.text(fit(cv, (d ? d.reason : '') + ', ' + F.stateWords(vw).replace(/^simulated: .*/, 'simulated'), 16, w - 40), x + 20, y + ch - 13, 16, fs === 'OPEN' ? C.green : C.dim, { literal: true });
    });
    if (has(S, 'rpm')) cards.push((x, w) => UI.stat(cv, x, y, w, ch, { label: 'Engine', value: v.rpm, decimals: 0, unit: 'rpm', smooth: true,
        sub: has(S, 'engLoad') && v.engLoad != null ? 'load ' + Math.round(v.engLoad) + ' %' : (v.gear ? 'gear ' + v.gear : ''), color: '#ecf0f5', history: h.rpm, minSpan: 200, seq: h.seq, every: 1000, info: info('engine') }));
    row(cv, y, cards);
}

/* ---------- Flap ---------- */
function flapPage(cv, S, V, A, t) {
    const f = S.flap, lw = 560, side = f.sides.indexOf(V.side) >= 0 ? V.side : f.sides[0];
    const v = f.views[side], d = f.decided[side] || {};
    UI.card(cv, X0, TOP, lw, UI.hh(), 'Exhaust flap', { info: info('flap') });
    if (v.simulated) pillRight(cv, X0 + lw - 150, TOP + 12, 'SIMULATED', 'warm', false);
    const shown = v.confirmed !== 'UNKNOWN' ? v.confirmed : v.requested;
    const word = shown === 'OPEN' ? 'OPEN' : shown === 'CLOSED' ? 'CLOSED' : 'THE CAR';
    const cx = X0 + lw / 2;
    cv.text(word, cx, TOP + 76, 34, shown === 'OPEN' ? C.green : shown === 'CLOSED' ? C.amber : C.text, { font: 'bold', align: 'center', literal: true });
    // the rear silencer from behind and its two tail pipes (owner, 2026-11-26 22:21: the old drawing looked like a robot
    // with antennas): a butterfly flap sits in the right pipe (both with two flaps), seen end on, so a shut flap fills
    // the pipe and an open one is a thin edge
    const cy = TOP + 182, two = f.sides.length > 1;
    const ang = (s) => { const vv = f.views[s], sh = vv.confirmed !== 'UNKNOWN' ? vv.confirmed : vv.requested; return UI.glide('ex|flap|' + s, sh === 'OPEN' ? 0 : sh === 'CLOSED' ? 90 : 45, null, 10); };
    // the car's rear: bumper, tail lights, plate, the diffuser with the two tips in it
    cv.roundRect(cx - 240, cy - 70, 480, 124, 44, '#23262c');
    cv.strokeRoundRect(cx - 240, cy - 70, 480, 124, 44, 3, '#7d858f');
    cv.roundRect(cx - 200, cy - 68, 400, 10, 5, '#30343b');
    [-1, 1].forEach((k) => cv.fill([[cx + k * 236, cy - 58], [cx + k * 150, cy - 58], [cx + k * 150, cy - 48], [cx + k * 222, cy - 48], [cx + k * 226, cy - 30], [cx + k * 236, cy - 34]].map((q) => q), '#d0302c'));
    cv.roundRect(cx - 62, cy - 40, 124, 32, 5, '#3a3f49');
    cv.roundRect(cx - 58, cy - 36, 116, 24, 3, '#c9d0d8');
    cv.fill([[cx - 210, cy + 14], [cx + 210, cy + 14], [cx + 186, cy + 52], [cx - 186, cy + 52]], '#121418');
    [-1, 1].forEach((k) => {
        const tx = cx + k * 150, ty = cy + 32, s = two ? (k < 0 ? 'left' : 'right') : 'both', hasFlap = two || k > 0;
        cv.arc(tx, ty, 22, 29, 0, 360, '#c9d0d8');
        cv.arc(tx, ty, 27, 29, 0, 360, '#8e969f');
        cv.circle(tx, ty, 22, '#0b0c0e');
        if (!hasFlap) return;
        const vv = f.views[s], sh = vv.confirmed !== 'UNKNOWN' ? vv.confirmed : vv.requested, a = ang(s) * Math.PI / 180;
        const col = sh === 'OPEN' ? C.green : sh === 'CLOSED' ? C.amber : '#9aa1ad', ry = Math.max(2, 20 * Math.sin(a));
        const disc = [];
        for (let q = 0; q < 28; q++) { const th = q / 28 * Math.PI * 2; disc.push([tx + Math.cos(th) * 20, ty + Math.sin(th) * ry]); }
        cv.fill(disc, col);
        cv.line(tx - 25, ty, tx + 25, ty, 2.5, '#5c636f');
        // gas leaving an open pipe
        if (sh === 'OPEN') for (let q = 0; q < 3; q++) {
            const p = (t * 1.2 + q / 3) % 1, al = Math.round(180 * (1 - p));
            cv.arc(tx, ty + 6 + p * 30, 18 + p * 14, 21 + p * 14, 120, 240, [70, 210, 130, al], { round: true });
        }
    });
    const by = f.mode === 'AUTO' ? (d.rule ? 'by rule: ' + d.rule.name : d.reason || '') : d.reason || '';
    cv.text(fit(cv, by + '   .   ' + F.stateWords(v), 15, lw - 40), cx, TOP + 296, 15, v.error ? C.red : C.dim, { align: 'center', literal: true });
    // with two flaps: which one the buttons set
    let bTop = TOP + 334;
    if (two) {
        UI.segmented(cv, cx + 150, TOP + 322, [['both', 'Both'], ['left', 'Left'], ['right', 'Right']], V.side || 'both', A.flapSide, 'flapside');
        bTop = TOP + 358;
    }
    const modes = [['AUTO', 'AUTO'], ['OPEN', 'OPEN'], ['CLOSED', 'CLOSE'], ['OEM', 'CAR']];
    const mode = two && V.side && V.side !== 'both' ? (f.sideMode && f.sideMode[V.side]) || f.mode : f.mode;
    modes.forEach((m, i) => choice(cv, X0 + 20 + i * 130, bTop, 120, 44, m[1], mode === m[0], C.accent, () => A.flapMode(m[0]), 'mode|' + m[0]));
    cv.text(v.simulated ? 'Simulated: nothing is sent to the car. Arm it in Settings.' : 'AUTO: the rules on the right decide. CAR: the car decides.',
        X0 + 20, TOP + UI.hh() - 14, 14, v.simulated ? C.amber : C.dim, { literal: true });
    rulesCard(cv, S, V, A, X0 + lw + 14, X1 - X0 - lw - 14);
}

function rulesCard(cv, S, V, A, x, w) {
    UI.card(cv, x, TOP, w, UI.hh(), 'Automation (top rule wins)', { info: info('rules') });
    const list = S.rules || [], per = 6, first = Math.max(0, Math.min(V.ruleFirst || 0, list.length - per));
    const active = S.active || {};
    list.slice(first, first + per).forEach((r, k) => {
        const i = first + k, yy = TOP + 46 + k * 50, lit = S.flap.mode === 'AUTO' && Object.keys(active).some((s) => active[s] === r.id);
        if (lit) { cv.roundRect(x + 10, yy - 2, w - 20, 48, 14, [70, 210, 130, 34]); cv.strokeRoundRect(x + 10, yy - 2, w - 20, 48, 14, 1.5, [70, 210, 130, 110]); }
        cv.text(String(i + 1), x + 30, yy + 28, 15, C.dim, { align: 'center', literal: true });
        cv.text(fit(cv, r.name, 19, w - 420, 'bold'), x + 56, yy + 20, 19, r.on ? C.text : C.dim, { font: 'bold', literal: true });
        cv.text(fit(cv, R.describe(r), 14, w - 420), x + 56, yy + 40, 14, C.dim, { literal: true });
        const right = x + w - 110;
        pillRight(cv, lit ? right - 70 : right, yy + 8, actionWord(r.action), ACT_COL[r.action], false);
        if (lit) cv.text('ACTIVE', right - 2, yy + 28, 14, C.green, { font: 'bold', align: 'right', spacing: 1, literal: true });
        UI.toggle(cv, x + w - 24, yy + 22, r.on, () => A.ruleToggle(r.id), 'rule|' + r.id);
        if (cv.target) cv.target(x + 10, yy - 2, w - 120, 48, () => A.ruleOpen(r.id), 'ruleopen|' + r.id, 14);
    });
    if (!list.length) cv.text('No rules yet: add one, the top one wins.', x + 20, TOP + 90, 17, C.dim, { literal: true });
    if (list.length > per) {
        const ax = x + w - 300;
        cv.text((first + 1) + '-' + Math.min(list.length, first + per) + ' of ' + list.length, ax - 24, TOP + 376, 14, C.dim, { align: 'right', literal: true });
        chev(cv, ax, TOP + 362, 14, 'up', first > 0 ? C.accent : '#464a52');
        chev(cv, ax + 26, TOP + 362, 14, 'down', first + per < list.length ? C.accent : '#464a52');
        if (cv.target) { cv.target(ax - 14, TOP + 346, 28, 32, () => A.ruleScroll(-1), 'rup', 12); cv.target(ax + 12, TOP + 346, 28, 32, () => A.ruleScroll(1), 'rdown', 12); }
    }
    const ay = TOP + UI.hh() - 48, aw = 220;
    cv.strokeRoundRect(x + 20, ay, aw, 36, 18, 2, C.accent);
    cv.text('+ Add a rule', x + 20 + aw / 2, ay + 24, 17, C.accent, { font: 'bold', align: 'center', literal: true });
    if (cv.target) cv.target(x + 20, ay, aw, 36, () => A.ruleOpen(null), 'addrule', 18);
    cv.text(list.length > per ? 'No rule holds: the car decides.' : 'No rule holds: the car decides. Simulated until armed in Settings.', x + aw + 44, ay + 24, 14, C.dim, { literal: true });
}

/** The body of the rule dialog: what, above or below what value, and then what the flap does. */
function ruleBody(S, V, A) {
    return (cv, x, y, w, h) => {
        // Cancel and Save clear V.edit while the dialog still fades out for 200 ms: draw nothing then (it threw)
        if (!V.edit) return;
        const d = V.edit, part = V.editPart === 'and' && d.and ? 'and' : 'when', c = d[part];
        const kinds = M.kindsFor(S.caps), cw = Math.floor((w - 3 * 14) / 4);
        if (d.and) UI.segmented(cv, x + w, y - 30, [['when', 'When'], ['and', 'and ...']], part, A.part, 'rulepart');
        kinds.forEach((k, i) => choice(cv, x + (i % 4) * (cw + 14), y + Math.floor(i / 4) * 48, cw, 38, R.KINDS[k].label, c.kind === k, C.accent, () => A.kind(k), 'kind|' + k, 16));
        const ry = y + Math.ceil(kinds.length / 4) * 48 + 14, K = R.KINDS[c.kind];
        if (c.kind === 'mode') {
            cv.text('is', x, ry + 28, 18, C.dim, { literal: true });
            K.choices.forEach((m, i) => choice(cv, x + 34 + i * 160, ry + 2, 150, 40, m[1], c.value === m[0], C.accent, () => A.modeValue(m[0]), 'modev|' + m[0], 16));
        } else if (c.kind === 'time') {
            cv.text('from', x, ry + 28, 18, C.dim, { literal: true });
            UI.stepper(cv, x + 220, ry + 22, null, { text: R.hhmm(c.value[0]), key: 'tfrom', onMinus: () => A.step(-1, 0), onPlus: () => A.step(1, 0) });
            cv.text('to', x + 244, ry + 28, 18, C.dim, { literal: true });
            UI.stepper(cv, x + 440, ry + 22, null, { text: R.hhmm(c.value[1]), key: 'tto', onMinus: () => A.step(-1, 1), onPlus: () => A.step(1, 1) });
        } else {
            cv.text('is', x, ry + 28, 18, C.dim, { literal: true });
            choice(cv, x + 34, ry + 2, 110, 40, 'above', c.op === 'above', C.accent, () => A.op('above'), 'op|above', 16);
            choice(cv, x + 154, ry + 2, 110, 40, 'below', c.op === 'below', C.accent, () => A.op('below'), 'op|below', 16);
            UI.stepper(cv, x + 500, ry + 22, null, { text: R.valueText(c), key: 'cval', onMinus: () => A.step(-1), onPlus: () => A.step(1) });
            const h1 = R.hystOf(c);
            if (h1) cv.text('back after it ' + (c.op === 'above' ? 'drops ' : 'rises ') + R.thousands(h1) + (K.unit ? ' ' + K.unit : '') + ' (no flapping)', x + 530, ry + 28, 15, C.dim, { literal: true });
        }
        // then the flap
        const ty = ry + 62;
        cv.text('... then the flap', x, ty + 22, 24, C.text, { font: 'bold', literal: true });
        [['OPEN', 'OPEN', C.green], ['CLOSED', 'CLOSE', C.amber], ['OEM', 'CAR DECIDES', C.dim]].forEach((a, i) =>
            choice(cv, x + 230 + i * 180, ty, 170, 38, a[1], d.action === a[0], a[2], () => A.action(a[0]), 'act|' + a[0], 16));
        if (S.flap && S.flap.sides.length > 1) UI.segmented(cv, x + w, ty + 19, [['both', 'Both flaps'], ['left', 'Left'], ['right', 'Right']], d.flap || 'both', A.flapOf, 'ruleflap');
        // the "and"
        const ay = ty + 58;
        const s = d.and ? 'and ' + R.condText(d.and, true) + '   (remove)' : '+ Add an "and" condition, for example: and in Sport mode.';
        cv.text(s, x, ay + 16, 15, d.and ? TEXT2 : C.accent, { literal: true });
        if (cv.target) cv.target(x, ay - 6, Math.ceil(cv.textWidth(s, 15, { literal: true })) + 10, 30, d.and ? A.dropAnd : A.addAnd, 'and', 12);
    };
}
/** The rule dialog for the rule being edited (V.edit). */
function ruleDialog(S, V, A, index) {
    const isNew = V.edit.id == null, buttons = [];
    if (!isNew) buttons.push({ label: 'Delete', kind: 'bad', run: A.ruleDelete });
    if (!isNew && index > 0) buttons.push({ label: 'Move up', run: A.ruleUp });
    buttons.push({ label: 'Cancel', run: A.closeDialog }, { label: isNew ? 'Save rule' : 'Save', kind: 'primary', run: A.ruleSave });
    return { label: isNew ? 'New rule' : 'Rule ' + (index + 1) + ': ' + V.edit.name, labelColor: 'dim', title: 'When ...', w: 1180, h: 480, body: ruleBody(S, V, A), buttons: buttons };
}

/* ---------- Flap log ---------- */
function flapLog(cv, S, V, A, t) {
    const lw = 620, wk = M.flapWeek(S.flapWeekLog || S.flapLog, S.at);
    UI.card(cv, X0, TOP, lw, UI.hh(), 'This week', { info: info('week') });
    const bx = X0 + 20, bw = lw - 40, segs = [['OPEN', C.green, 'Open'], ['CLOSED', C.amber, 'Closed'], ['OEM', '#5a606a', 'Car decides']];
    let xx = bx;
    if (wk.total > 0) segs.forEach((s) => {
        const ww = UI.glide('ex|wk|' + s[0], bw * wk.ms[s[0]] / wk.total, null, 10);
        if (ww > 12) cv.roundRect(xx, TOP + 64, ww - 6, 32, 16, s[1]);
        xx += ww;
    });
    else cv.roundRect(bx, TOP + 64, bw, 32, 16, C.track);
    segs.forEach((s, i) => {
        const yy = TOP + 132 + i * 40;
        cv.circle(bx + 6, yy - 6, 6, s[1]);
        cv.text(s[2], bx + 24, yy, 18, C.text, { literal: true });
        cv.text(wk.total ? M.hm(wk.ms[s[0]]) + '  (' + Math.round(100 * wk.ms[s[0]] / wk.total) + ' %)' : '--', bx + bw, yy, 17, C.text, { align: 'right', literal: true });
    });
    cv.text('By rule', bx, TOP + 272, 15, C.dim, { font: 'bold', literal: true });
    const top = wk.rules.slice(0, 4), max = top.length ? top[0].ms : 1;
    top.forEach((r, i) => {
        const yy = TOP + 298 + i * 24;
        cv.text(fit(cv, r.name, 15, 190), bx, yy, 15, C.text, { literal: true });
        UI.bar(cv, bx + 202, yy - 9, 280, 8, r.ms / max * 0.6, C.orange, 'wkr|' + i);
        cv.text(M.hm(r.ms), bx + bw, yy, 15, C.dim, { align: 'right', literal: true });
    });
    if (!top.length) cv.text('No rule held the flap this week.', bx, TOP + 300, 15, C.dim, { literal: true });
    const rx = X0 + lw + 14, rw = X1 - rx;
    UI.card(cv, rx, TOP, rw, UI.hh(), 'Last changes', { info: info('changes') });
    const ch = (S.flapLog || []).slice(0, 5);
    ch.forEach((c, i) => {
        const yy = TOP + 48 + i * 62;
        cv.text(M.clock(c.t), rx + 20, yy + 30, 17, C.dim, { font: 'bold', literal: true });
        UI.pill(cv, rx + 98, yy + 12, actionWord(c.action), ACT_COL[c.action], false);
        cv.text(fit(cv, c.rule || c.reason, 19, rw - 260, 'bold'), rx + 218, yy + 24, 19, C.text, { font: 'bold', literal: true });
        if (c.detail) cv.text(fit(cv, c.detail, 15, rw - 260), rx + 218, yy + 46, 15, C.dim, { literal: true });
        if (i < ch.length - 1) rule(cv, rx + 20, yy + 58, rw - 40);
    });
    if (!ch.length) cv.text('No change yet: every change shows here, with why.', rx + 20, TOP + 90, 17, C.dim, { literal: true });
}

/* ---------- OPF ---------- */
function opf(cv, S, V, A, t) {
    const v = S.v || {}, w1 = 430, w2 = 520;
    UI.card(cv, X0, TOP, w1, UI.hh(), ENG && ENG.filter === 'dpf' ? 'Diesel particulate filter' : 'Particulate filter', { info: info('opf') });
    const cx = X0 + w1 / 2;
    if (has(S, 'load')) {
        UI.ring(cv, cx, TOP + 178, 92, { value: v.load, min: 0, max: 100, decimals: 0, unit: '% full', color: v.load != null && v.load >= 80 ? 'warm' : 'ok', scale: [0, 25, 50, 75, 100], target: S.mark || 80 });
    } else cv.text(num(v.soot, 1) + ' g soot', cx, TOP + 190, 40, C.text, { font: 'bold', align: 'center', literal: true });
    const bits = [];
    if (v.soot != null) bits.push('soot ' + v.soot.toFixed(1) + ' g');
    if (has(S, 'ash') && v.ash != null) bits.push('ash ' + Math.round(v.ash) + ' g');
    if (has(S, 'pfTemp') && v.pfTemp != null) bits.push(Math.round(v.pfTemp) + ' °C');
    cv.text(bits.join('   .   '), cx, TOP + 328, 15, C.dim, { align: 'center', literal: true });
    if (has(S, 'load')) cv.text('the mark: the car regenerates near ' + (S.mark || 80) + ' % (an estimate)', cx, TOP + 356, 14, C.amber, { align: 'center', literal: true });
    // the regeneration
    const mx = X0 + w1 + 14;
    UI.card(cv, mx, TOP, w2, UI.hh(), 'Regeneration', { info: info('regen') });
    const rn = S.regen, bx = mx + 20, bw = w2 - 40;
    if (rn) {
        cv.roundRect(bx, TOP + 52, bw, 78, 18, [255, 128, 40, 40]);
        cv.strokeRoundRect(bx, TOP + 52, bw, 78, 18, 1.5, [255, 128, 40, 150]);
        cv.text('REGENERATING NOW', bx + 20, TOP + 88, 22, C.orange, { font: 'bold', literal: true });
        cv.text(fit(cv, 'filter at ' + Math.round(rn.temp) + ' °C, soot burning off: ' + rn.from.toFixed(1) + ' g to ' + rn.to.toFixed(1) + ' g', 15, bw - 40), bx + 20, TOP + 114, 15, C.text, { literal: true });
    } else {
        cv.roundRect(bx, TOP + 52, bw, 78, 18, [70, 210, 130, 30]);
        cv.strokeRoundRect(bx, TOP + 52, bw, 78, 18, 1.5, [70, 210, 130, 120]);
        cv.text('Not regenerating', bx + 20, TOP + 88, 22, C.green, { font: 'bold', literal: true });
        const u = S.until;
        cv.text(u ? 'next one in about ' + Math.round(u.left) + ' % more load' : 'watching the filter', bx + 20, TOP + 114, 15, C.text, { literal: true });
    }
    const pairs = [];
    if (rn) {
        pairs.push(['Running for', rn.mins + ' min'], ['Soot burnt so far', rn.burnt.toFixed(1) + ' g'], ['Keep driving', '10 to 15 more minutes, steady, above 2 000 rpm'], ['Do not', 'switch off now if you can avoid it']);
    } else {
        const u = S.until, last = (S.regens || [])[0], gap = M.averageGap(S.regens);
        pairs.push(['Until the next one', u && u.km != null ? 'about ' + R.thousands(u.km) + ' km, if you drive like the last weeks' : u ? 'about ' + Math.round(u.left) + ' % more load' : '--']);
        pairs.push(['Last one', last ? M.ago(last.start, S.at) + ', ' + last.mins + ' min, ' + Math.round(last.loadBefore) + ' % to ' + Math.round(last.loadAfter) + ' %' : 'none seen yet']);
        pairs.push(['Average gap', gap ? 'every ' + Math.round(gap.days) + ' days' + (gap.km != null ? ', about ' + R.thousands(Math.round(gap.km / 10) * 10) + ' km' : '') : 'after two, here']);
        pairs.push(['Helps it finish', '15 min of steady driving, above 2 000 rpm']);
    }
    pairs.forEach((p, i) => {
        const yy = TOP + 168 + i * 56;
        cv.text(p[0], bx, yy, 15, C.dim, { literal: true });
        cv.text(fit(cv, p[1], 18, bw, 'bold'), bx, yy + 24, 18, C.text, { font: 'bold', literal: true });
    });
    // the last five
    const tx = mx + w2 + 14, tw = X1 - tx;
    UI.card(cv, tx, TOP, tw, UI.hh(), 'Last 5 regenerations', { info: info('regens') });
    const cols = [tx + 20, tx + 252, tx + 362, tx + 450];
    ['when', 'load', 'time', 'peak'].forEach((h, i) => cv.text(h, cols[i], TOP + 62, 14, C.dim, { font: 'bold', literal: true }));
    (S.regens || []).slice(0, 5).forEach((r, i) => {
        const yy = TOP + 92 + i * 58;
        cv.text(fit(cv, M.ago(r.start, S.at) + (r.km != null && S.kmNow != null ? ', ' + R.thousands(Math.max(0, S.kmNow - r.km)) + ' km ago' : ''), 16, 226), cols[0], yy, 16, C.text, { literal: true });
        cv.text(Math.round(r.loadBefore) + ' > ' + Math.round(r.loadAfter) + ' %', cols[1], yy, 16, C.text, { literal: true });
        cv.text(r.mins + ' min', cols[2], yy, 16, C.text, { literal: true });
        cv.text(r.peak + ' °C', cols[3], yy, 16, C.text, { literal: true });
        cv.text(r.cut ? 'cut short: engine switched off, finished later' : 'complete', cols[0], yy + 20, 13, r.cut ? C.amber : C.green, { literal: true });
        if (i < 4) rule(cv, tx + 20, yy + 32, tw - 40);
    });
    if (!(S.regens || []).length) cv.text('None seen yet: the app keeps every one it sees.', cols[0], TOP + 100, 16, C.dim, { literal: true });
}

/* ---------- Filter care ---------- */
function care(cv, S, V, A, t) {
    const lw = 760, dv = M.drives(S.drives, S.at), withAsh = has(S, 'ash');
    const w = withAsh ? lw : X1 - X0;
    UI.card(cv, X0, TOP, w, UI.hh(), 'Your drives and the ' + fname(), { info: info('drives') });
    const bx = X0 + 20, bw = w - 40;
    const warn = dv.warn, c = warn ? [255, 186, 70] : [70, 210, 130];
    cv.roundRect(bx, TOP + 52, bw, 80, 18, c.concat([34]));
    cv.strokeRoundRect(bx, TOP + 52, bw, 80, 18, 1.5, c.concat([130]));
    cv.text(!dv.total ? 'No drives counted yet' : warn ? 'Mostly short drives this week' : 'Long enough drives this week', bx + 20, TOP + 88, 22, warn ? C.amber : C.green, { font: 'bold', literal: true });
    cv.text(dv.total ? dv.short + ' of ' + dv.total + ' drives were under 10 min' + (warn ? ': the filter fills but cannot clean itself.' : '.') : 'Every drive with the head unit on counts.', bx + 20, TOP + 116, 15, C.text, { literal: true });
    const max = Math.max(1, Math.max.apply(null, dv.counts)), cw = Math.floor(bw / 5), base = TOP + 322;
    dv.counts.forEach((n, i) => {
        const h = UI.glide('ex|drv|' + i, n / max * 130, null, 10), x = bx + i * cw;
        if (h > 4) cv.roundRect(x + 18, base - h, cw - 36, h, 14, i < 2 ? C.amber : C.green);
        cv.text(String(n), x + cw / 2, base - h - 12, 16, C.text, { font: 'bold', align: 'center', literal: true });
        cv.text(dv.labels[i], x + cw / 2, base + 22, 14, C.dim, { align: 'center', literal: true });
    });
    cv.fillRect(bx, base, bw, 1, '#3c4048');
    cv.text('Tip: one steady drive of 15 to 20 minutes lets it regenerate. The car does it by itself.', bx, TOP + UI.hh() - 16, 15, C.green, { literal: true });
    if (!withAsh) return;
    // ash over km, the line to "about full" (an estimate)
    const rx = X0 + lw + 14, rw = X1 - rx, af = M.ashFuture(S.ash, M.ASH_FULL);
    UI.card(cv, rx, TOP, rw, UI.hh(), fname() + ' life (ash)', { info: info('ash') });
    const px = rx + 70, pw = rw - 330, py = TOP + 60, ph = 196, lo = 0, hi = 60, kmMax = Math.max(1000, S.kmNow || 1000);
    for (let g = 0; g <= 60; g += 15) {
        const yy = py + ph - g / hi * ph;
        cv.fillRect(px, Math.round(yy), pw, 1, '#282c34');
        cv.text(g + (g === 60 ? ' g' : ''), px - 10, yy + 5, 13, C.dim, { align: 'right', literal: true });
    }
    const fy = py + ph - M.ASH_FULL / hi * ph;
    cv.line(px, fy, px + pw, fy, 2, C.red);
    cv.text('about full (' + M.ASH_FULL + ' g, an estimate)', px + 6, fy - 8, 13, C.red, { literal: true });
    for (let k = 0; k <= 4; k++) cv.text(k === 4 ? R.thousands(Math.round(kmMax / 1000)) + 'k km' : R.thousands(Math.round(kmMax * k / 4 / 1000)) + (k ? 'k' : ''), px + pw * k / 4, py + ph + 22, 13, C.dim, { align: 'center', literal: true });
    const pts = (S.ash || []).map((p) => [px + pw * Math.min(1, p[0] / kmMax), py + ph - Math.min(hi, p[1]) / hi * ph]);
    if (pts.length > 1) UI.curve(cv, pts, 3, '#969ea8');
    if (af && af.kmLeft != null && pts.length) {
        const end = pts[pts.length - 1];
        // the trend dots stay inside the chart, clear of the numbers beside it
        for (let i = 1; i <= 6 && end[0] + i * 10 <= px + pw; i++) cv.circle(end[0] + i * 10, end[1] - i * 1.2, 2.5, C.green);
    }
    const tx = px + pw + 30;
    cv.text(af ? Math.round(af.now) + ' g now' : '--', tx, TOP + 98, 24, C.text, { font: 'bold', literal: true });
    if (af && af.per1000 != null) {
        cv.text('grows about ' + af.per1000.toFixed(1) + ' g', tx, TOP + 126, 15, C.dim, { literal: true });
        cv.text('per 1 000 km', tx, TOP + 146, 15, C.dim, { literal: true });
    }
    cv.text('Full of ash in', tx, TOP + 192, 15, C.dim, { literal: true });
    cv.text(af && af.kmLeft != null ? 'about ' + R.thousands(af.kmLeft) + ' km' : 'not known yet', tx, TOP + 220, 21, af && af.kmLeft != null ? C.green : C.dim, { font: 'bold', literal: true });
    cv.text('An estimate from how fast the ash grew so far (km counted by the app). Ash never', rx + 20, TOP + 330, 14, C.dim, { literal: true });
    cv.text('burns off; a filter full of ash is cleaned or replaced at a workshop.', rx + 20, TOP + 352, 14, C.dim, { literal: true });
}

/* ---------- Cold start ---------- */
function cold(cv, S, V, A, t) {
    const lw = 1000, warm = S.warm || [], lo = M.lightOff(warm.map((p) => [p[0], p[1]]));
    const egtS = warm.map((p) => p[1]), clS = warm.map((p) => p[2]);
    const series = [];
    if (has(S, 'egt')) series.push({ name: 'exhaust after cat', color: 'warm', values: egtS.length > 1 ? egtS : [null, null] });
    if (has(S, 'coolant')) series.push({ name: 'coolant', color: 'info', values: clS.length > 1 ? clS : [null, null] });
    const mins = warm.length ? Math.round(warm[warm.length - 1][0] / 60) : 5;
    const xl = ['start']; for (let k = 1; k <= mins; k++) xl.push(k + ' min');
    UI.chart(cv, X0, TOP, lw, UI.hh(), series, { label: (S.warmWhen || 'Last cold start') + ': catalyst warm-up', info: info('warmup'), min: 0, max: 500, yTicks: 5, yUnit: '°C',
        xLabels: xl, fill: false, legend: 'right',
        note: lo != null ? 'Catalyst working after ' + Math.floor(lo / 60) + ' min ' + (lo % 60) + ' s (about ' + M.LIGHT_OFF + ' °C). Until then the engine runs a bit richer and louder.' : 'Waiting for a cold start.' });
    const rx = X0 + lw + 14, rw = X1 - rx, offs = (S.lightOffs || []).map((s) => s / 60);
    if (has(S, 'egt')) UI.stat(cv, rx, TOP, rw, Math.floor((UI.hh() - 14) / 2), { label: 'Catalyst ready in', value: lo != null ? Math.floor(lo / 60) + ':' + ('0' + (lo % 60)).slice(-2) : null, unit: 'min',
        sub: (S.warmWhen || '').toLowerCase() + (S.warmOutside != null ? ', outside ' + Math.round(S.warmOutside) + ' °C' : ''), color: 'ok', history: offs, minSpan: 1, spanLabel: '-' + offs.length + ' starts', nowLabel: 'last', info: info('ready') });
    const cw = M.coldWeek(S.starts, S.at), cy = has(S, 'egt') ? TOP + Math.floor((UI.hh() - 14) / 2) + 14 : TOP, chh = has(S, 'egt') ? UI.hh() - Math.floor((UI.hh() - 14) / 2) - 14 : UI.hh();
    UI.card(cv, rx, cy, rw, chh, 'Cold starts', { info: info('coldstarts') });
    const vw = cv.text(String(cw.count), rx + 20, cy + 98, 48, C.text, { font: 'num', literal: true });
    cv.text('this week', rx + 32 + vw, cy + 94, 18, C.dim, { literal: true });
    cv.text(cw.short ? cw.short + ' of them under 5 min' : 'none of them under 5 min', rx + 20, cy + chh - 18, 16, cw.short ? C.amber : C.green, { literal: true });
}

/* ---------- Sound ---------- */
function soundPage(cv, S, V, A, t) {
    UI.card(cv, X0, TOP, X1 - X0, UI.hh(), 'How the sound is made, and what damps it', { info: info('sound') });
    const fs = flapShown(S), lv = M.sound(S.setup, has(S, 'flap') ? fs : 'OEM', S.v && S.v.load != null && S.v.load < 25, S.engine);
    const parts = ART.exhaustPath(cv, X0 + 50, X1 - 20, TOP + 214, { setup: S.setup, flap: has(S, 'flap') ? fs : 'OEM', t: t, labels: true, numbers: false,
        temps: { cat: S.v && S.v.egt, opf: S.v && S.v.pfTemp }, rpm: S.v && S.v.rpm != null ? S.v.rpm : null, boost: S.v && S.v.boost, key: 'ex|sound' });
    parts.forEach((p) => {
        const lvl = M.levelAt(lv, p.key), l = lvl != null ? UI.glide('ex|lvl|' + p.key, lvl, null, 8) : 0;
        ART.wave(cv, p.x, TOP + 104, 100, l, t);
        cv.text(Math.round(l * 100) + ' %', p.x, TOP + 56, 15, C.text, { font: 'bold', align: 'center', literal: true });
    });
    cv.text('Each cylinder fires a pressure pulse. The turbo and the filters smooth the pulses, the silencers take most of the loudness. The flap in the rear silencer: closed, through the silencer; open, the shortest way out.',
        X0 + 20, TOP + UI.hh() - 40, 15, C.dim, { literal: true });
    cv.text('The percentages illustrate each part, following your Setup page: not a measurement.', X0 + 20, TOP + UI.hh() - 16, 15, C.dim, { literal: true });
}

/* ---------- Better sound ---------- */
function better(cv, S, V, A, t) {
    const v = S.v || {}, tp = M.tips({ engine: S.engine, hasFlap: has(S, 'flap') && (S.setup || {}).flaps !== 'removed', hasOpf: has(S, 'load') && (S.setup || {}).opf !== 'none', flap: has(S, 'flap') ? flapShown(S) : null,
        egt: has(S, 'egt') ? v.egt : null, load: has(S, 'load') ? v.load : null, rpm: has(S, 'rpm') ? v.rpm : null, mode: has(S, 'mode') ? v.mode : null });
    const lw = 960;
    UI.card(cv, X0, TOP, lw, UI.hh(), 'Better sound, no changes to the car', { info: info('tips') });
    tp.list.forEach((x, i) => {
        const yy = TOP + 72 + i * 64, c = x.ok === true ? C.green : x.ok === false ? C.amber : '#5a606a';
        cv.circle(X0 + 32, yy, 13, c);
        cv.text(x.ok === true ? 'v' : x.ok === false ? '!' : '?', X0 + 32, yy + 6, 15, C.dark, { font: 'bold', align: 'center', literal: true });
        cv.text(x.title, X0 + 60, yy + 7, 21, C.text, { font: 'bold', literal: true });
        cv.text(fit(cv, x.text, 16, lw - 100), X0 + 60, yy + 31, 16, C.dim, { literal: true });
    });
    const rx = X0 + lw + 14, rw = X1 - rx;
    UI.card(cv, rx, TOP, rw, UI.hh(), 'Sound score now', { info: info('score') });
    UI.ring(cv, rx + rw / 2, TOP + 200, 100, { value: tp.score, min: 0, max: 100, decimals: 0, text: tp.score == null ? '--' : null,
        unit: tp.ready + ' of ' + tp.list.length + ' ready', color: 'accent', scale: [0, 25, 50, 75, 100] });
    cv.text('An estimate from the conditions on the left, not a measurement.', rx + rw / 2, TOP + UI.hh() - 24, 14, C.dim, { align: 'center', literal: true });
}

/* ---------- History ---------- */
function history(cv, S, V, A, t) {
    const lw = 1000, days = M.loadDays(S.loads, S.at, 56), mark = S.mark || 80;
    UI.chart(cv, X0, TOP, lw, UI.hh(), [
        { name: 'filter load', color: 'ok', values: days.some((x) => x != null) ? days : [null, null] },
        { name: 'regeneration mark (estimate)', color: 'warm', values: [mark, mark] },
    ], { label: 'Filter load, last 8 weeks', info: info('hist'), min: 0, max: 100, yTicks: 4, yUnit: '%', xLabels: ['-8 w', '-6 w', '-4 w', '-2 w', 'now'], fill: false });
    const rx = X0 + lw + 14, rw = X1 - rx, list = (S.regens || []).slice(0, 4);
    UI.card(cv, rx, TOP, rw, UI.hh(), 'Regenerations', { info: info('regenList') });
    list.forEach((r, i) => {
        const yy = TOP + 62 + i * 76;
        cv.circle(rx + 26, yy + 8, 6, r.cut ? C.amber : C.green);
        if (i < list.length - 1) cv.line(rx + 26, yy + 22, rx + 26, yy + 66, 2, '#3c4048');
        cv.text(M.ago(r.start, S.at) + (r.cut ? ', cut short' : ''), rx + 48, yy + 13, 15, C.dim, { literal: true });
        cv.text(fit(cv, Math.round(r.loadBefore) + ' % to ' + Math.round(r.loadAfter) + ' %, ' + r.mins + ' min, ' + r.peak + ' °C', 19, rw - 70), rx + 48, yy + 40, 19, C.text, { literal: true });
    });
    if (!list.length) cv.text('None seen yet.', rx + 20, TOP + 80, 17, C.dim, { literal: true });
    const gap = M.averageGap(S.regens), af = M.ashFuture(S.ash);
    const sum = (S.regens || []).length + ' regenerations' + (gap ? ', every ' + Math.round(gap.days) + ' days' : '') + (af && af.per1000 ? '. Ash grows about ' + af.per1000.toFixed(1) + ' g per 1 000 km.' : '.');
    UI.wrap(cv, sum, 14, rw - 40).slice(0, 2).forEach((ln, i, a) => cv.text(ln, rx + 20, TOP + UI.hh() - 18 - (a.length - 1 - i) * 20, 14, C.dim, { literal: true }));
}

/* ---------- Setup ---------- */
function setupPage(cv, S, V, A, t) {
    UI.card(cv, X0, TOP, X1 - X0, UI.hh(), 'Your exhaust', { info: info('setup') });
    const fd = S.setupFound || {}, s = Object.assign({}, M.SETUP_DEFAULT, S.setup || {});
    const foundTxt = [];
    if (fd.opf) foundTxt.push(fname() + ' yes');
    if (fd.cat) foundTxt.push('catalyst yes');
    if (fd.flaps != null) foundTxt.push('flaps ' + fd.flaps + (fd.flaps === 2 ? ' (left and right)' : ''));
    if (foundTxt.length) cv.text('found on this car: ' + foundTxt.join(', '), X1 - 56, TOP + 34, 15, C.green, { align: 'right', literal: true });
    const cw = Math.floor((X1 - X0 - 40 - 2 * 14) / 3), ch = 146;
    M.SETUP.forEach((p, i) => {
        const x = X0 + 20 + (i % 3) * (cw + 14), y = TOP + 56 + Math.floor(i / 3) * (ch + 12);
        cv.roundRect(x, y, cw, ch, 18, [255, 255, 255, 8]);
        cv.strokeRoundRect(x, y, cw, ch, 18, 1.5, [255, 255, 255, 22]);
        cv.text(p.name, x + 20, y + 36, 21, C.text, { font: 'bold', literal: true });
        const auto = p.key === 'opf' ? fd.opf : p.key === 'cat' ? fd.cat : p.key === 'flaps' ? fd.flaps != null : false;
        const tag = auto ? (p.key === 'flaps' ? 'auto: ' + fd.flaps + ' answer' + (fd.flaps === 1 ? 's' : '') : p.key === 'opf' ? 'auto: found (soot read)' : 'auto: found') : 'you set';
        cv.text(tag, x + cw - 20, y + 34, 14, auto ? C.green : C.blue, { align: 'right', literal: true });
        let cx = x + 20, cy = y + 60, wrapped = false;
        p.choices.forEach((c) => {
            // what the car found is fixed; what contradicts it can not be picked
            const lock = auto && (p.key === 'flaps' ? c[0] !== String(fd.flaps) : p.key === 'opf' ? c[0] === 'none' : c[0] === 'none');
            const ww = Math.ceil(cv.textWidth(c[1], 16, { font: 'bold' })) + 34;
            // a part with many choices takes a second row rather than running out of its card
            if (cx + ww > x + cw - 20) { cx = x + 20; cy += 46; wrapped = true; }
            choice(cv, cx, cy, ww, 38, c[1], s[p.key] === c[0], C.accent, lock ? null : () => A.setup(p.key, c[0]), 'setup|' + p.key + '|' + c[0], 16);
            cx += ww + 10;
        });
        const hint = wrapped ? '' : { mid: s.mid === 'resdelete' || s.mid === 'straight' ? 'Sound page and tips count the louder middle part' : '', flaps: s.flaps === '2' && fd.flaps === 2 ? 'Flap page controls both, or each one on its own' : '' }[p.key];
        if (hint) cv.text(hint, x + 20, y + ch - 18, 14, C.dim, { literal: true });
    });
    cv.text('The drawing, the Sound page and the tips follow what you set here. The app only records it; it never advises removing a part.', X0 + 20, TOP + UI.hh() - 12, 14, C.dim, { literal: true });
}

/* ---------- How to use, Settings ---------- */
let topics = null;
let topicsFor = null;
function helpTopics() {
    if (!topics || topicsFor !== fname()) {
        topicsFor = fname();
        topics = T.TOPICS.map((tp) => Object.assign({}, tp, { title: forEngine(tp.title), text: forEngine(tp.text), draw: ART.artFor(tp.art) })).concat([UI.DEMO_TOPIC]);
        topics.push({ title: 'Which cars', art: 'path', text: T.WORKS_WITH, draw: ART.artFor('path') });
        topics.push(UI.REPORT_TOPIC);
    }
    return topics;
}
/** Exhaust's own Settings rows (after the Display block). */
const APP_ROWS = [
    { key: 'arm', label: 'Flap control', hint: 'Simulated sends nothing; Armed commands the real flap', type: 'choice', default: 'off', options: [['off', 'Simulated'], ['on', 'Armed']] },
    { key: 'hold', label: 'Hold OPEN and CLOSE', hint: 'Sent again every 15 s; off: the car takes it back after 20 s', type: 'bool', default: true },
    { key: 'closeLimit', label: 'Keep CLOSED up to', hint: 'Above this engine speed the car gets the flap back and opens it under load (less back pressure). Never: stays closed', type: 'choice', default: '4000',
        options: [['3000', '3 000'], ['4000', '4 000'], ['5000', '5 000'], ['0', 'Never']] },
    { key: 'leftIs', label: 'Left flap is', hint: 'Which engine unit drives the left flap (check by ear)', type: 'choice', default: '1', options: [['1', 'Bank 1'], ['2', 'Bank 2']] },
];
function appRowsFor(S) {
    return (S.demo ? [E.DEMO_ROW] : []).concat(APP_ROWS.filter((r) => (r.key === 'leftIs' ? has(S, 'flap2') : r.key === 'arm' || r.key === 'hold' || r.key === 'closeLimit' ? has(S, 'flap') : true)));
}

/* ---------- one frame ---------- */
const PAGES = [now, flapPage, flapLog, opf, care, cold, soundPage, better, history, setupPage];

function draw(cv, S, V, A, t) {
    ENG = S.engine || null;
    ART.setEngine(ENG);
    if (V.mode === 'help') {
        UI.howToUse(cv, helpTopics(), V.helpSel || 0, t, { title: 'EXHAUST', onSelect: A.helpTopic, onBack: A.back, onSettings: A.settings });
    } else if (V.mode === 'settings' && V.report && V.report.active()) {
        UI.reportPage(cv, V.report, t, { title: 'EXHAUST', onHelp: () => { V.report.close(); A.help(); } });
    } else if (V.mode === 'settings') {
        UI.settingsPage(cv, appRowsFor(S), V.values || {}, A.setting, { title: 'EXHAUST', appLabel: 'Exhaust', onBack: A.back, onHelp: A.help,
            onReport: V.report ? () => V.report.open() : null });
    } else {
        if (M.pagesFor(S.caps, S.engine).indexOf(V.page) < 0) V.page = 0;
        frame(cv, S, V, A);
        PAGES[V.page || 0](cv, S, V, A, t);
    }
    if (V.dialog) UI.dialog(cv, V.dialog.d, t, { a: V.dialog.a == null ? 1 : V.dialog.a });
    UI.overlay(cv, t);
}

module.exports = { draw, APP_ROWS, appRowsFor, ruleDialog, info, helpTopics, PAGES };
