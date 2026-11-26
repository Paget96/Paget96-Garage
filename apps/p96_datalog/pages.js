// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog pages, drawn with the Paget96 Garage UI (lib/ui.js, layout B): Now, Runs, Correction, Boost, Tyres,
 * Temps, Log and Compare, then How to use and Settings. draw(cv, model, t) draws one frame of whatever the model's
 * ui shows; every control writes to model.ui or the settings.
 *
 * Data colours are fixed (C.orange, C.blue, C.green, C.amber, C.red, C.text), never C.accent (owner, D14). Every
 * card has its (i) (INFO), every chart its axes, every number glides (lib/ui.js).
 */
function lib() {
    try { return require('./garage_ui'); }
    catch (e) { return require('../../lib/ui'); }
}
const UI = lib();
const C = UI.C;
const M = require('./maths');
const { column } = require('./runs');
const { sheet } = require('./dyno');
const { INFO, TOPICS } = require('./info');
const { APP_ROWS } = require('./model');
const ART = require('./art');
function need(local, repo) {
    try { return require(local); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return require(repo); }
}
const E = need('./garage_engine', '../../lib/engine');

const NAME = 'DATALOG';
const TABS = ['Now', 'Runs', 'Dyno', 'Correction', 'Tyres', 'Boost', 'Temps', 'Log', 'Compare'];
/**
 * The tabs this car gets (owner rule, 2026-11-26 18:21: show only what the car supports): Dyno needs torque,
 * Correction an air value, Tyres the tyre sensors, Boost the manifold and outside pressure, Temps a temperature.
 * Now, Runs, Log and Compare need only the speed. The demo shows all of them.
 */
function tabsFor(m) {
    const need = {
        Dyno: () => m.has('torque'), Correction: () => m.has('intake') || m.has('outside') || m.has('charge') || m.has('kPa'),
        Tyres: () => m.has('tyres'), Boost: () => m.has('boost'),
        Temps: () => ['oil', 'coolant', 'gearbox', 'intake', 'charge', 'egt'].some((k) => m.has(k)),
    };
    return TABS.filter((n) => !need[n] || need[n]());
}
const T = UI.CONTENT_TOP, L = UI.MARGIN, R = UI.W - UI.MARGIN, CW = R - L, BOTTOM = 504, CH = BOTTOM - T;
const isNum = (x) => typeof x === 'number' && isFinite(x);

/* ---------- units ---------- */

/** Converters for the units setting: values stay metric inside, only the screen converts. */
function units(m) {
    const imp = m.setting('units') === 'imperial';
    return {
        imp: imp,
        speed: (v) => (isNum(v) ? (imp ? v / 1.609344 : v) : null), speedU: imp ? 'mph' : 'km/h',
        press: (b) => (isNum(b) ? (imp ? b * 14.5038 : b) : null), pressU: imp ? 'psi' : 'bar', pressD: imp ? 1 : 2,
        temp: (c) => (isNum(c) ? (imp ? c * 9 / 5 + 32 : c) : null), tempU: imp ? '°F' : '°C',
        dtemp: (c) => (isNum(c) ? (imp ? c * 9 / 5 : c) : null),
        baro: (kPa) => (isNum(kPa) ? (imp ? kPa * 0.2953 : kPa * 10) : null), baroU: imp ? 'inHg' : 'hPa', baroD: imp ? 2 : 0,
        dist: (len) => (imp ? { 201: '1/8 mile', 402: '1/4 mile', 804: '1/2 mile' }[len] : M.LENGTH_NAME[len]),
    };
}

/* ---------- small helpers ---------- */

const secs = (s) => (isNum(s) ? s.toFixed(2) : '--');
const fix = (v, d) => (isNum(v) ? v.toFixed(d) : '--');
const signed = (v, d) => (isNum(v) ? (Math.abs(v) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(d)) : '--');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => (n < 10 ? '0' : '') + n;
function dayName(ms, now) {
    const d = new Date(ms), n = new Date(now || Date.now());
    if (d.toDateString() === n.toDateString()) return 'Today';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}
const clock = (ms) => { const d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); };
/** At most n values of a list, evenly picked (a chart's per-frame cost stays low). */
function thin(a, n) {
    if (!a || a.length <= n) return a || [];
    const out = [];
    for (let i = 0; i < n; i++) out.push(a[Math.round(i * (a.length - 1) / (n - 1))]);
    return out;
}
/** x labels 0 s .. end for a run of `secsLong` seconds. */
function runLabels(secsLong) {
    const st = secsLong > 16 ? 4 : 2, out = [];
    const end = Math.max(st, Math.ceil(secsLong / st) * st);
    for (let s = 0; s <= end + 1e-6; s += st) out.push(s + ' s');
    return { labels: out, end: end };
}
/**
 * A run's trace column at even steps from 0 to `end` seconds (at most 66 points), read between the trace's rows by
 * their own times; null past the run's end.
 */
function traceOver(run, name, end) {
    const col = column(run, name), ts = column(run, 't'), n = 66, out = [];
    for (let i = 0; i < n; i++) {
        const s = end * i / (n - 1);
        let v = null;
        if (ts.length && s <= ts[ts.length - 1] + 1e-6) {
            let k = 0;
            while (k < ts.length - 2 && ts[k + 1] < s) k++;
            const a = col[k], b = col[k + 1], ta = ts[k], tb = ts[k + 1];
            if (isNum(a) && isNum(b) && tb > ta) v = a + (b - a) * Math.max(0, Math.min(1, (s - ta) / (tb - ta)));
            else v = isNum(a) ? a : isNum(b) ? b : null;
        }
        out.push(v);
    }
    return out;
}
/** Text in a cell, right aligned. */
const rtext = (cv, s, x, y, size, c, font) => cv.text(s, x, y, size, c, { align: 'right', font: font || 'label', literal: true });
const ltext = (cv, s, x, y, size, c, font) => cv.text(s, x, y, size, c, { font: font || 'label', literal: true });

/* ---------- the frame around every page ---------- */

function head(cv, m) {
    UI.background(cv);
    const tabs = tabsFor(m);
    if (tabs.indexOf(m.ui.page) < 0) m.ui.page = 'Now';
    UI.tabs(cv, tabs, tabs.indexOf(m.ui.page), { onSelect: (i) => { m.ui.page = tabs[i]; } });
    UI.title(cv, NAME);
    UI.header(cv, {
        status: m.v.demo ? 'DEMO' : 'LIVE', statusColor: m.v.demo ? 'warm' : 'ok',
        onHelp: () => { m.ui.view = 'help'; }, onSettings: () => { m.ui.view = 'settings'; },
    });
}

/* ---------- Now ---------- */

function runWords(m, now) {
    const log = m.log(), st = log.state;
    if (st === 'run') return { text: 'RUNNING', color: 'accent' };
    if (st === 'ready') return { text: 'READY: go when you want', color: 'ok' };
    return { text: m.v.speed > 0.5 ? 'stop the car to arm' : 'arming...', color: 'dim' };
}
function trend(a, k) {
    const v = (a || []).filter(isNum);
    if (v.length < 10) return 'steady';
    const d = v[v.length - 1] - v[0];
    return Math.abs(d) < k ? 'steady' : d > 0 ? 'rising' : 'falling';
}
function pageNow(cv, m, t) {
    const v = m.v, U = units(m), h = m.h1, log = m.log(), now = m.lastT || Date.now();
    const target = m.setting('boostTarget'), boost = m.has('boost'), ring = boost || m.has('speed');
    if (!boost && ring) {
        // no boost to show (an electric car, a car without the engine unit's values): the speed ring in its place
        UI.ring(cv, 196, T + 196, 118, { value: U.speed(v.speed), min: 0, max: U.speed(250), decimals: 0, unit: U.speedU, label: 'Speed', color: 'accent',
            scale: { step: U.imp ? 50 : 50, decimals: 0 }, info: INFO.run });
    }
    if (boost) {
        UI.ring(cv, 196, T + 196, 118, {
            value: U.press(v.boost), min: U.press(-1) < 0 ? U.press(-1) : -1, max: U.press(2), decimals: U.pressD,
            unit: U.pressU + ', target ' + fix(U.press(target), U.pressD), label: 'Boost', color: 'accent',
            scale: U.imp ? { step: 10, decimals: 0 } : { step: 0.5, decimals: 1 }, target: U.press(target), info: INFO.boost,
        });
    }
    const outsideGap = isNum(v.intake) && isNum(v.outside) ? v.intake - v.outside : null;
    const chargeGap = isNum(v.charge) && isNum(v.intake) ? v.charge - v.intake : null;
    const rw = runWords(m, now), last = log.last, running = log.state === 'run';
    const lastSpeeds = last ? thin(column(last, 'v'), 40).map(U.speed) : null;
    // [the value the card needs, the card]: only the ones this car reports, in this order, as many as fit
    const cards = [
        ['kPa', { label: 'Ambient pressure', value: U.baro(v.kPa), decimals: U.baroD, unit: U.baroU, sub: trend(h.kPa, 0.05), color: 'dim',
            history: h.kPa.map(U.baro), minSpan: U.imp ? 0.1 : 4, info: INFO.ambient, seq: m.seq1 }],
        ['intake', { label: 'Intake air', value: U.temp(v.intake), decimals: 0, unit: U.tempU, color: 'ok',
            sub: isNum(outsideGap) ? 'after filter, ' + signed(U.dtemp(outsideGap), 0) + ' vs outside' : 'after the filter',
            history: h.intake.map(U.temp), info: INFO.intake, seq: m.seq1 }],
        [null, { label: 'Run', value: running ? log.elapsed(now) : last ? last.result[M.finalKey(last.length)] : null, decimals: 2, unit: 's',
            sub: running ? 'RUNNING  ' + Math.round(U.speed(v.speed) || 0) + ' ' + U.speedU : rw.text, color: rw.color,
            history: running ? null : lastSpeeds, spanLabel: 'last run', nowLabel: U.speedU, minSpan: 20, smooth: !running, info: INFO.run }],
        ['charge', { label: 'Charge air', value: U.temp(v.charge), decimals: 0, unit: U.tempU, color: M.zone('charge', v.charge),
            sub: isNum(chargeGap) ? signed(U.dtemp(chargeGap), 0) + ' over intake' : 'before the throttle',
            history: h.charge.map(U.temp), info: INFO.charge, seq: m.seq1 }],
        ['oil', { label: 'Engine oil', value: U.temp(v.oil), decimals: 0, unit: U.tempU, color: M.zone('oil', v.oil), sub: M.zoneWords('oil', v.oil),
            history: h.oil.map(U.temp), info: INFO.oil, seq: m.seq1 }],
        ['gearbox', { label: 'Gearbox', value: U.temp(v.gearbox), decimals: 0, unit: U.tempU, color: M.zone('gearbox', v.gearbox), sub: M.zoneWords('gearbox', v.gearbox),
            history: h.gearbox.map(U.temp), info: INFO.gearbox, seq: m.seq1 }],
        ['coolant', { label: 'Coolant', value: U.temp(v.coolant), decimals: 0, unit: U.tempU, color: M.zone('coolant', v.coolant), sub: M.zoneWords('coolant', v.coolant),
            history: h.coolant.map(U.temp), info: INFO.coolant, seq: m.seq1 }],
        ['outside', { label: 'Outside air', value: U.temp(v.outside), decimals: 0, unit: U.tempU, sub: 'mirror sensor', color: 'info',
            history: h.outside.map(U.temp), info: INFO.outside, seq: m.seq1 }],
        ['tyres', (function () {
            const tp = (v.tyres || {}).p || {}, ks = M.WHEELS.filter((k) => isNum(tp[k]));
            const lo = ks.length ? ks.reduce((a, k) => (tp[k] < tp[a] ? k : a), ks[0]) : null;
            return { label: 'Tyres', value: lo ? U.press(tp[lo]) : null, decimals: U.pressD, unit: U.pressU, color: 'ok',
                sub: lo ? 'lowest: ' + lo + ', of the four' : 'from the tyre sensors', info: INFO.tyresNow };
        })()],
    ].filter((c) => !c[0] || m.has(c[0])).map((c) => c[1]);
    // with the boost ring: 3 x 2 cards beside it; without: 4 x 2 over the whole width
    // (three cards or fewer: one row, each the full height, so the page is not half empty)
    // (four cards beside the ring: two by two, so none is left alone on a row)
    const cols = ring ? (cards.length === 4 ? 2 : 3) : 4, x0 = ring ? 390 : L, gap = 18, w = Math.floor((R - x0 - (cols - 1) * gap) / cols), one = cards.length <= cols, gh = one ? 392 : 189;
    cards.slice(0, cols * 2).forEach((g, i) => UI.stat(cv, x0 + (i % cols) * (w + gap), T + Math.floor(i / cols) * (gh + 14), w, gh, g));
}

/* ---------- Runs ---------- */

/** The splits of a run as rows [label, value text]. */
function splitRows(run, U) {
    const rows = [];
    M.splitsFor(run ? run.length : 402).forEach((s) => {
        if (run && s.key === M.finalKey(run.length)) return;
        const raw = run && run.result ? run.result[s.key] : null;
        rows.push([s.label, isNum(raw) ? secs(raw) + ' s' : '--']);
    });
    const fk = run ? M.finalKey(run.length) : 'd402';
    const trap = run && run.trap ? run.trap[fk] : null;
    rows.push(['Trap speed', isNum(trap) ? fix(U.speed(trap), 1) + ' ' + U.speedU : '--']);
    rows.push(['Reaction', run && isNum(run.reaction) ? secs(run.reaction) + ' s' : '--']);
    return rows;
}
/** The big card of one run: its time, the corrected time and the splits. live: the run going on now. */
function runCard(cv, m, x, y, w, h, run, opts) {
    opts = opts || {};
    const U = units(m), log = m.log(), now = m.lastT || Date.now(), running = opts.live && log.state === 'run';
    const len = run ? run.length : m.setting('runLength');
    UI.card(cv, x, y, w, h, opts.label || ('Last run, ' + U.dist(len)), { info: INFO.lastRun });
    cv.strokeRoundRect(x, y, w, h, 22, 1.5, opts.outline || C.orange);
    const fk = M.finalKey(len);
    const time = running ? log.elapsed(now) : run ? run.result[fk] : null;
    const key = 'dlrun|' + x + '|' + y;
    const shown = isNum(time) ? (running ? time : UI.glide(key, time)) : null;
    const tw = cv.text(isNum(shown) ? shown.toFixed(2) : '--', x + 20, y + 128, 92, isNum(shown) ? C.text : C.dim, { font: 'num', literal: true });
    cv.text('s', x + 34 + tw, y + 124, 24, C.dim, { literal: true });
    if (running) ltext(cv, 'RUNNING  ' + Math.round(U.speed(m.v.speed) || 0) + ' ' + U.speedU + ', ' + Math.round(log.live().dist) + ' m', x + 20, y + 160, 18, C.orange, 'bold');
    else if (run && isNum(run.cf)) ltext(cv, 'corrected to standard air: ' + secs(M.correctTime(time, run.cf, true)) + ' s', x + 20, y + 160, 18, C.green);
    else if (run && m.has('intake') && m.has('kPa')) ltext(cv, 'no air data for this run: not corrected', x + 20, y + 160, 18, C.dim);
    else ltext(cv, 'Stop the car, wait for READY, then go.', x + 20, y + 160, 18, C.dim);
    const rows = running ? [] : splitRows(run, U);
    const top = y + 206, pitch = Math.min(38, (h - 226) / Math.max(1, rows.length - 1));
    rows.forEach((r, i) => {
        const ry = top + i * pitch;
        ltext(cv, r[0], x + 20, ry, 18, C.dim);
        rtext(cv, r[1], x + w - 20, ry, 20, C.text, 'bold');
        if (i < rows.length - 1) cv.fillRect(x + 20, ry + pitch / 2 - 2, w - 40, 1, '#282c34');
    });
    if (running) {
        const live = log.live().result, done = M.splitsFor(len).filter((s) => isNum(live[s.key]));
        done.forEach((s, i) => {
            const ry = top + i * 38;
            ltext(cv, s.label, x + 20, ry, 18, C.dim);
            rtext(cv, secs(live[s.key]) + ' s', x + w - 20, ry, 20, C.text, 'bold');
        });
    }
}
/** A list of runs as a table: #, raw, corrected, trap, air, pill. onPick(run) makes each row a target. */
function runTable(cv, m, x, y, w, runs, opts) {
    opts = opts || {};
    const U = units(m), len = runs.length ? runs[runs.length - 1].length : m.setting('runLength');
    const best = M.bestRun(runs, len, true);
    const cols = [x + 20, x + 78, x + 228, x + 388, x + 548, x + w - 120];
    // columns only for what this car reports: corrected needs the intake air and the outside pressure
    const hasCorr = m.has('intake') && m.has('kPa'), hasAir = m.has('intake') || m.has('charge');
    [['#', 0, true], [U.dist(len), 1, true], ['corrected', 2, hasCorr], ['trap', 3, true], ['air', 4, hasAir]].forEach((c) => { if (c[2]) ltext(cv, c[0], cols[c[1]], y, 15, C.dim, 'bold'); });
    const shown = runs.slice(-(opts.max || 5));
    const first = runs.length - shown.length;
    shown.forEach((r, i) => {
        const ry = y + 38 + i * 52, fk = M.finalKey(r.length), raw = r.result[fk];
        const isBest = r === best, sel = opts.selected === r.at;
        if (isBest || sel) cv.roundRect(x + 10, ry - 32, w - 20, 46, 18, sel ? '#262a33' : '#1c2a22');
        ltext(cv, String(first + i + 1), cols[0], ry, 20, C.dim);
        ltext(cv, secs(raw) + ' s', cols[1], ry, 20, C.text);
        if (hasCorr) ltext(cv, isNum(r.cf) ? secs(M.correctTime(raw, r.cf, true)) + ' s' : '--', cols[2], ry, 20, C.text, 'bold');
        ltext(cv, fix(U.speed(r.trap && r.trap[fk]), 1), cols[3], ry, 20, C.text);
        if (hasAir) ltext(cv, [m.has('intake') ? r.intake : undefined, m.has('charge') ? r.charge : undefined].filter((x) => x !== undefined)
            .map((x) => fix(U.temp(x), 0) + ' ' + U.tempU).join(' / '), cols[4], ry, 20, C.text);
        if (isBest) UI.pill(cv, cols[5], ry - 24, 'best', 'ok');
        else if (M.heatSoaked(r)) UI.pill(cv, cols[5] - 20, ry - 24, 'heat soak', 'warm');
        if (opts.onPick && cv.target) cv.target(x + 10, ry - 32, w - 20, 46, () => opts.onPick(r), 'dlrow|' + r.at, 18);
    });
    return shown.length;
}
function pageRuns(cv, m) {
    const log = m.log(), runs = m.sessionRuns();
    runCard(cv, m, L, T, 560, CH, log.last, { live: true });
    const x = L + 574, w = R - x;
    UI.card(cv, x, T, w, CH, 'Runs today', { info: INFO.runsToday });
    if (!runs.length) ltext(cv, 'No runs in this session yet. Stop, wait for READY, go.', x + 20, T + 110, 20, C.dim);
    else runTable(cv, m, x, T + 60, w, runs, { max: 5 });
    const air = m.has('intake') && m.has('charge') ? 'Air: intake after the filter / charge air before the throttle. ' : '';
    ltext(cv, air + 'Times start when the car moves.', x + 20, BOTTOM - 20, 16, C.dim);
}

/* ---------- Dyno ---------- */

const ORD = (g) => g + (g === 1 ? 'st' : g === 2 ? 'nd' : g === 3 ? 'rd' : 'th');
/** "5 000": rpm with a thin space every three digits, as on a dyno sheet. */
const rpmText = (r) => String(Math.round(r / 50) * 50).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function pageDyno(cv, m) {
    const imp = m.setting('units') === 'imperial', pull = m.shownPull(), sh = sheet(pull), now = m.lastT || Date.now();
    const lw = 1100;
    // torque in Nm (lb-ft in imperial), power in hp
    const tq = (nm) => (imp ? nm * 0.737562 : nm), tqU = imp ? 'lb-ft' : 'Nm';
    if (!sh) {
        UI.card(cv, L, T, lw, CH, 'Dyno sheet', { info: INFO.dyno });
        UI.wrap(cv, 'No pull yet. In 2nd or 3rd gear, from about 2 000 rpm, go full throttle up to the shift point. Only on a closed road or strip.', 20, lw - 40)
            .forEach((ln, i) => ltext(cv, ln, L + 20, T + 110 + i * 30, 20, C.dim));
    } else {
        const xs = sh.rpm.map((r) => r / 1000);
        const lo = Math.floor(xs[0]), hi = Math.ceil(xs[xs.length - 1]), ticks = [];
        for (let k = lo; k <= hi; k++) ticks.push(k);
        const label = 'Dyno sheet: ' + (pull.at > now - 2 * 3600 * 1000 ? 'pull' : 'last pull') + ' in ' + ORD(pull.gear) + ' gear, ' + dayName(pull.at, now).replace('Today', 'today') + ' ' + clock(pull.at);
        const ip = sh.power.indexOf(sh.peakPower.v), it = sh.torque.indexOf(sh.peakTorque.v);
        UI.dualChart(cv, L, T, lw, CH, xs,
            { values: sh.power, color: 'accent', unit: 'hp', min: 0 },
            { values: sh.torque.map(tq), color: 'info', unit: tqU, min: 0 },
            { label: label, info: INFO.dyno, xTicks: ticks, xRange: [lo, hi], xUnit: 'x 1 000 rpm',
                marks: [{ side: 'left', i: ip, text: Math.round(sh.peakPower.v) + ' hp @ ' + rpmText(sh.peakPower.rpm) },
                    { side: 'right', i: it, text: Math.round(tq(sh.peakTorque.v)) + ' ' + tqU + ' @ ' + rpmText(sh.peakTorque.rpm) }] });
    }
    const x = L + lw + 14, w = R - x, ch = (CH - 14) / 2;
    const corr = sh && sh.corrected ? 'weather corrected, ' : '';
    UI.stat(cv, x, T, w, ch, { label: 'Peak power', value: sh ? sh.peakPower.v : null, decimals: 0, unit: 'hp',
        sub: corr + 'at the engine (est.)', color: 'accent', info: INFO.peakPower });
    UI.stat(cv, x, T + ch + 14, w, ch, { label: 'Peak torque', value: sh ? tq(sh.peakTorque.v) : null, decimals: 0, unit: tqU,
        sub: sh ? 'from the engine unit, ' + rpmText(sh.peakTorque.rpm) + ' rpm' : 'from the engine unit', color: 'info', info: INFO.peakTorque });
}

/* ---------- Correction ---------- */

function airChart(cv, m, x, y, w, h, info) {
    const U = units(m), last = m.log().last;
    let series, xl;
    if (last && last.trace && last.trace.length > 2) {
        const rl = runLabels(last.trace[last.trace.length - 1][0]);
        series = [
            { name: 'outside', color: 'info', values: traceOver(last, 'outside', rl.end).map(U.temp) },
            { name: 'after filter', color: 'ok', values: traceOver(last, 'intake', rl.end).map(U.temp) },
            { name: 'before throttle', color: 'warm', values: traceOver(last, 'charge', rl.end).map(U.temp) },
        ];
        xl = rl.labels;
    } else {
        series = [
            { name: 'outside', color: 'info', values: m.h1.outside.map(U.temp) },
            { name: 'after filter', color: 'ok', values: m.h1.intake.map(U.temp) },
            { name: 'before throttle', color: 'warm', values: m.h1.charge.map(U.temp) },
        ];
        xl = ['-60 s', '-45 s', '-30 s', '-15 s', 'now'];
    }
    const key = { outside: 'outside', 'after filter': 'intake', 'before throttle': 'charge' };
    series = series.filter((sr) => m.has(key[sr.name]));
    UI.chart(cv, x, y, w, h, series, { label: last ? 'Air temperatures over the last run' : 'Air temperatures, last minute', yTicks: 3, yUnit: U.tempU,
        xLabels: xl, legend: 'right', note: series.length > 1 ? 'gaps: engine bay heat and intercooler heat soak' : '', info: info, fill: false });
}
function pageCorrection(cv, m) {
    const v = m.v, U = units(m), h = m.h1, ch = 180;
    const gapOut = isNum(v.intake) && isNum(v.outside) ? v.intake - v.outside : null;
    const gapCh = isNum(v.charge) && isNum(v.outside) ? v.charge - v.outside : null;
    const vs = (g) => (isNum(g) ? ', ' + signed(U.dtemp(g), 0) + ' vs outside' : '');
    // only the cards this car reports; the correction card needs the intake air and the outside pressure
    const cards = [
        ['outside', { label: 'Outside air', value: U.temp(v.outside), decimals: 0, unit: U.tempU, sub: 'mirror sensor, reference', color: 'info', history: h.outside.map(U.temp), info: INFO.outside }],
        ['intake', { label: 'Intake air', value: U.temp(v.intake), decimals: 0, unit: U.tempU, sub: 'after filter' + vs(gapOut), color: 'ok', history: h.intake.map(U.temp), info: INFO.intake }],
        ['charge', { label: 'Charge air', value: U.temp(v.charge), decimals: 0, unit: U.tempU, sub: 'before throttle' + vs(gapCh), color: 'warm', history: h.charge.map(U.temp), info: INFO.charge }],
        ['kPa', { label: 'Ambient pressure', value: U.baro(v.kPa), decimals: U.baroD, unit: U.baroU, sub: 'from the engine unit', color: C.text, history: h.kPa.map(U.baro), minSpan: U.imp ? 0.1 : 4, info: INFO.ambient }],
    ].filter((c) => m.has(c[0])).map((c) => c[1]);
    const corr = m.has('intake') && m.has('kPa'), n = cards.length + (corr ? 1 : 0), gap = 14, cw = (CW - (n - 1) * gap) / Math.max(1, n);
    cards.forEach((g, i) => UI.stat(cv, L + i * (cw + gap), T, cw, ch, Object.assign({ seq: m.seq1 }, g)));
    if (corr) {
        // the correction factor now
        const x = L + cards.length * (cw + gap), cf = M.sae(v.intake, v.kPa), da = M.densityAltitude(v.intake, v.kPa);
        UI.card(cv, x, T, R - x, ch, 'Correction', { info: INFO.correction });
        const f = isNum(cf) ? UI.glide('dlcf', cf) : null;
        cv.text(isNum(f) ? 'x ' + f.toFixed(3) : '--', x + 20, T + 92, 46, isNum(f) ? C.text : C.dim, { font: 'num', literal: true });
        ltext(cv, 'SAE J1349', x + 20, T + 120, 16, C.dim);
        ltext(cv, isNum(da) ? 'density alt. ' + (U.imp ? Math.round(da * 3.28084) + ' ft' : Math.round(da) + ' m') : 'density alt. --', x + 20, T + 144, 16, C.dim);
        ltext(cv, M.airWords(cf), x + 20, T + 167, 15, isNum(cf) && Math.abs(cf - 1) > 0.003 ? C.amber : C.green);
    }
    airChart(cv, m, L, T + ch + 14, CW, CH - ch - 14, INFO.airChart);
}

/* ---------- Boost ---------- */

/** The wastegate's colour in the card and the chart (a fixed data colour, never the accent). */
const WG_COL = C.green;

/**
 * The samples the wastegate story is told from: the last run's trace when it has the wastegate, else the last minute.
 * { pairs: [[boost, wastegate], ...], from: 'last run' | 'last minute', target }
 */
function wastegateSamples(m) {
    const last = m.log().last, h = m.h1;
    const wg = column(last, 'wastegate');
    if (wg.some(isNum)) {
        const b = column(last, 'boost');
        return { pairs: b.map((x, i) => [x, wg[i]]), from: 'last run', target: isNum(last.boostTarget) ? last.boostTarget : m.setting('boostTarget') };
    }
    return { pairs: h.boost.map((x, i) => [x, h.wastegate[i]]), from: 'last minute', target: isNum(m.v.boostTarget) ? m.v.boostTarget : m.setting('boostTarget') };
}

/** The Wastegate card: the position now, closed / open in words, and when it opens and closes from the live data. */
function wastegateCard(cv, m, x, y, w, h) {
    const v = m.v, U = units(m);
    UI.card(cv, x, y, w, h, 'Wastegate', { info: INFO.wastegate });
    const pos = isNum(v.wastegate) ? UI.glide('dlwg', v.wastegate) : null;
    const vw = cv.text(isNum(pos) ? String(Math.round(pos)) : '--', x + 20, y + 80, 48, isNum(pos) ? C.text : C.dim, { font: 'num', literal: true });
    ltext(cv, '% open', x + 28 + vw, y + 76, 18, C.dim);
    cv.text(M.wastegateState(v.wastegate), x + w - 20, y + 76, 17, isNum(v.wastegate) ? WG_COL : C.dim, { font: 'bold', align: 'right', literal: true });
    if (m.has('wastegate2')) {
        // two turbos, each with its wastegate: bank 1 and bank 2, a bar each
        UI.bar(cv, x + 20, y + 88, w - 40, 8, isNum(v.wastegate) ? v.wastegate / 100 : 0, WG_COL, 'dlwg' + Math.round(x));
        UI.bar(cv, x + 20, y + 102, w - 40, 8, isNum(v.wastegate2) ? v.wastegate2 / 100 : 0, WG_COL, 'dlwg2' + Math.round(x));
    } else UI.bar(cv, x + 20, y + 94, w - 40, 10, isNum(v.wastegate) ? v.wastegate / 100 : 0, WG_COL, 'dlwg' + Math.round(x));
    const sm = wastegateSamples(m);
    ltext(cv, 'closed', x + 20, y + 122, 12, C.dim);
    cv.text(m.has('wastegate2') ? 'bank 1, bank 2 ' + (isNum(v.wastegate2) ? Math.round(v.wastegate2) + ' %' : '--') : isNum(v.wgDuty) ? 'actuator ' + Math.round(v.wgDuty) + ' %' : sm.from, x + w / 2, y + 122, 12, C.dim, { align: 'center', literal: true });
    cv.text('open', x + w - 20, y + 122, 12, C.dim, { align: 'right', literal: true });
    const story = M.wastegateStory(sm.pairs, sm.target);
    // a run starts at the launch: how it sits at idle comes from the last minute
    if (story.idle === null && sm.from === 'last run') story.idle = M.wastegateStory(m.h1.boost.map((b, i) => [b, m.h1.wastegate[i]])).idle;
    const st = M.wastegateWords(story, (b) => fix(U.press(b), U.pressD) + ' ' + U.pressU);
    const col = st.level === 'warm' ? C.amber : st.level === 'dim' ? C.dim : '#c8ced6';
    let size = 15, step = 21, lines = UI.wrap(cv, st.text, size, w - 40, 'label');
    if (lines.length > 2) { size = 13; step = 17; lines = UI.wrap(cv, st.text, size, w - 40, 'label').slice(0, 3); }
    const y0 = lines.length > 2 ? y + 142 : y + 148;
    lines.forEach((ln, i) => ltext(cv, ln, x + 20, y0 + i * step, size, col));
}

function pageBoost(cv, m) {
    const v = m.v, U = units(m), h = m.h1, wg = m.has('wastegate'), n = wg ? 5 : 4;
    const ch = 180, last = m.log().last, gap = 16, cw = Math.floor((CW - (n - 1) * gap) / n);
    const target = m.setting('boostTarget');
    const cards = [
        { label: m.has('boost2') ? 'Boost, bank 1' : 'Boost', value: U.press(v.boost), decimals: U.pressD, unit: U.pressU,
            sub: m.has('boost2') ? 'bank 2 ' + (isNum(v.boost2) ? fix(U.press(v.boost2), U.pressD) + ' ' + U.pressU : '--') : m.car().turbos === 2 ? 'two turbos, one manifold' : 'manifold minus outside', color: 'accent', history: h.boost.map(U.press), minSpan: 0.5, info: INFO.boost },
        { label: 'Manifold pressure', value: U.press(v.manifold), decimals: U.pressD, unit: U.pressU + ' abs', sub: 'what the engine gets', color: C.text, history: h.manifold.map(U.press), minSpan: 0.5, info: INFO.manifold },
        { label: 'Outside pressure', value: U.press(v.ambient), decimals: U.pressD, unit: U.pressU + ' abs', sub: 'weather and altitude', color: 'info', history: h.ambient.map(U.press), minSpan: 0.5, info: INFO.ambient },
    ];
    cards.forEach((g, i) => UI.stat(cv, L + i * (cw + gap), T, cw, ch, Object.assign({ seq: m.seq1 }, g)));
    const x = L + 3 * (cw + gap), tpw = wg ? cw : R - x;
    UI.card(cv, x, T, tpw, ch, 'Target and peak', { info: INFO.targetPeak });
    const tw = cv.text(fix(U.press(target), U.pressD), x + 20, T + 92, 46, C.text, { font: 'num', literal: true });
    ltext(cv, U.pressU + ' target', x + 40 + tw, T + 88, 18, C.dim);
    const peak = last ? last.boostPeak : null, reach = last ? M.timeToTarget(last.trace, target, 2) : null;
    ltext(cv, 'peak last run ' + (isNum(peak) ? fix(U.press(peak), U.pressD) + ' ' + U.pressU : '--'), x + 20, T + 130, 18, C.text);
    ltext(cv, !last ? 'no run yet' : isNum(reach) ? 'reached target in ' + reach.toFixed(1) + ' s' : 'did not reach the target', x + 20, T + 158, 17, !last ? C.dim : isNum(reach) ? C.green : C.amber);
    if (wg) wastegateCard(cv, m, L + 4 * (cw + gap), T, R - (L + 4 * (cw + gap)), ch);
    // pressure over the last run, else the last minute; the wastegate on its own axis on the right (0 to 100 %)
    let series, xl, label;
    if (last && last.trace && last.trace.length > 2) {
        const rl = runLabels(last.trace[last.trace.length - 1][0]);
        series = [
            { name: 'manifold (abs)', color: C.text, values: traceOver(last, 'manifold', rl.end).map(U.press) },
            { name: 'outside (abs)', color: 'info', values: traceOver(last, 'ambient', rl.end).map(U.press) },
            { name: 'boost', color: 'accent', values: traceOver(last, 'boost', rl.end).map(U.press) },
        ];
        if (m.has('boost2') && column(last, 'boost2').some(isNum)) series.push({ name: 'boost bank 2', color: 'warm', values: traceOver(last, 'boost2', rl.end).map(U.press) });
        if (wg && column(last, 'wastegate').some(isNum)) series.push({ name: 'wastegate (%)', color: WG_COL, axis: 'right', values: traceOver(last, 'wastegate', rl.end) });
        xl = rl.labels; label = 'Pressure over the last run';
    } else {
        series = [
            { name: 'manifold (abs)', color: C.text, values: h.manifold.map(U.press) },
            { name: 'outside (abs)', color: 'info', values: h.ambient.map(U.press) },
            { name: 'boost', color: 'accent', values: h.boost.map(U.press) },
        ];
        if (m.has('boost2')) series.push({ name: 'boost bank 2', color: 'warm', values: h.boost2.map(U.press) });
        if (wg) series.push({ name: 'wastegate (%)', color: WG_COL, axis: 'right', values: h.wastegate });
        xl = ['-60 s', '-45 s', '-30 s', '-15 s', 'now']; label = 'Pressure, last minute';
    }
    // two banks: their two boost lines in place of the manifold (its card is above), so the legend keeps four lines
    if (m.has('boost2')) { series = series.filter((q) => q.name !== 'manifold (abs)'); series.forEach((q) => { if (q.name === 'boost') q.name = 'boost bank 1'; }); }
    const withWg = series.some((q) => q.axis === 'right');
    UI.chart(cv, L, T + ch + 14, CW, CH - ch - 14, series, { label: withWg ? label + ' and the wastegate' : label, yTicks: 4, yUnit: U.pressU, xLabels: xl, legend: 'right',
        note: withWg ? null : 'boost = manifold minus outside', info: withWg ? INFO.pressureWgChart : INFO.pressureChart, fill: false,
        right: withWg ? { min: 0, max: 100, unit: '%', color: WG_COL } : null });
}

/* ---------- Tyres ---------- */

function tyreColour(p, target) {
    if (!isNum(p)) return C.dim;
    const d = Math.abs(p - target);
    return p < 1.6 || d > 0.3 ? C.red : d > 0.1 ? C.amber : C.green;
}
function pageTyres(cv, m) {
    const U = units(m), ty = m.v.tyres || { p: {}, t: {} }, p = ty.p || {}, tt = ty.t || {}, target = m.setting('tyreTarget');
    // left: the car from above, each tyre's pressure and temperature
    const lw = 700;
    UI.card(cv, L, T, lw, CH, 'Tyres now', { info: INFO.tyresNow });
    const cx = L + lw / 2, cy = T + 210;
    cv.strokeRoundRect(cx - 79, cy - 150, 158, 300, 70, 3, '#4a4e58');
    cv.strokeRoundRect(cx - 55, cy - 70, 110, 88, 14, 2, '#3a3e48');
    [['FL', -1, -1], ['FR', 1, -1], ['RL', -1, 1], ['RR', 1, 1]].forEach((w) => {
        const k = w[0], wx = cx + w[1] * 110, wy = cy + w[2] * 95, col = tyreColour(p[k], target);
        cv.roundRect(wx - 14, wy - 36, 28, 72, 14, col);
        const tx = cx + w[1] * 150, al = w[1] < 0 ? 'right' : 'left';
        const pv = isNum(p[k]) ? UI.glide('dlty|' + k, U.press(p[k])) : null;
        cv.text(isNum(pv) ? pv.toFixed(U.pressD) + ' ' + U.pressU : '--', tx, wy - 2, 28, C.text, { align: al, font: 'bold', literal: true });
        cv.text((m.has('tyreTemp') ? (isNum(tt[k]) ? Math.round(U.temp(tt[k])) + ' ' + U.tempU : '--') + '  ' : '') + k, tx, wy + 26, 16, C.dim, { align: al, literal: true });
    });
    // right top: cold to hot this session
    const x = L + lw + 14, w = R - x, ch = 186;
    UI.card(cv, x, T, w, ch, 'Cold to hot, this session', { info: INFO.coldHot });
    const cold = m.cold || {};
    M.WHEELS.forEach((k, i) => {
        const ry = T + 65 + i * 30;
        ltext(cv, k, x + 20, ry + 6, 16, C.dim, 'bold');
        UI.bar(cv, x + 70, ry - 5, w - 290, 12, isNum(p[k]) ? (p[k] - 1) / 2 : 0, tyreColour(p[k], target), 'dlcold' + k);
        rtext(cv, isNum(cold[k]) && isNum(p[k]) ? fix(U.press(cold[k]), U.pressD) + ' > ' + fix(U.press(p[k]), U.pressD) : '--', x + w - 20, ry + 6, 17, C.text);
    });
    // right bottom: the note
    const ny = T + ch + 14;
    UI.card(cv, x, ny, w, BOTTOM - ny, 'Note', { info: INFO.tyreNote });
    const note = M.tyreNote(p);
    ltext(cv, note.text, x + 20, ny + 72, 21, note.odd ? C.amber : C.green);
    UI.wrap(cv, 'Target from your Settings: ' + fix(U.press(target), U.pressD) + ' ' + U.pressU + ' hot. The car sends ' + (m.has('tyreTemp') ? 'pressure and temperature' : 'the pressure') + ' from its tyre sensors (TPMS), about once a minute.', 17, w - 40)
        .forEach((ln, i) => ltext(cv, ln, x + 20, ny + 112 + i * 25, 17, '#a8b0ba'));
}

/* ---------- Temps ---------- */

function pageTemps(cv, m) {
    const v = m.v, U = units(m), lw = 900;
    UI.card(cv, L, T, lw, CH, 'Temperatures', { info: INFO.temps });
    const rows = [['Engine oil', 'oil', v.oil], ['Coolant', 'coolant', v.coolant], ['Gearbox oil', 'gearbox', v.gearbox],
        ['Intake air', 'intake', v.intake], ['Charge air', 'charge', v.charge], ['Exhaust gas (EGT)', 'egt', v.egt]].filter((r) => m.has(r[1]));
    const pitch = Math.min(56, (CH - 90) / Math.max(1, rows.length - 1));
    rows.forEach((r, i) => {
        const ry = T + 72 + i * pitch, z = M.ZONES[r[1]], lo = z.cold != null ? z.cold - 50 : 0;
        ltext(cv, r[0], L + 20, ry, 19, '#c8ced6');
        if (isNum(r[2])) rtext(cv, Math.round(U.temp(UI.glide('dltemp|' + r[1], r[2]))) + ' ' + U.tempU, L + lw - 20, ry, 22, C.text, 'bold');
        else rtext(cv, '--', L + lw - 20, ry, 22, C.dim, 'bold');
        UI.bar(cv, L + 272, ry + 14, lw - 292, 10, isNum(r[2]) ? (r[2] - lo) / (z.max - lo) : 0, M.zone(r[1], r[2]), 'dltb' + r[1]);
    });
    const h = m.h10;
    UI.chart(cv, L + lw + 14, T, R - L - lw - 14, CH, [
        { k: 'oil', name: 'oil', color: 'ok', values: h.oil.map(U.temp) },
        { k: 'gearbox', name: 'gearbox', color: 'info', values: h.gearbox.map(U.temp) },
        { k: 'charge', name: 'charge air', color: 'warm', values: h.charge.map(U.temp) },
        { k: 'coolant', name: 'coolant', color: C.text, values: h.coolant.map(U.temp) },
    ].filter((sr) => m.has(sr.k)).slice(0, 3), { label: 'Last 10 minutes', yTicks: 5, yUnit: U.tempU, xLabels: ['-10 min', '-8', '-6', '-4', '-2', 'now'], info: INFO.tempsChart, fill: false, seq: m.seq10 });
}

/* ---------- Log ---------- */

function pageLog(cv, m) {
    const U = units(m), log = m.log(), ses = M.sessions(log.runs), ui = m.ui, now = m.lastT || Date.now();
    const lw = 560;
    UI.card(cv, L, T, lw, CH, 'Sessions', { info: INFO.logSessions, infoIcon: true });
    if (!ses.length) ltext(cv, 'No runs saved yet.', L + 20, T + 110, 20, C.dim);
    if (ui.logSession >= ses.length) ui.logSession = 0;
    const per = 4, off = Math.min(ui.logOff, Math.max(0, ses.length - per));
    ses.slice(off, off + per).forEach((s, k) => {
        const i = off + k, ry = T + 58 + k * 68, sel = i === ui.logSession, len = s.runs[s.runs.length - 1].length;
        const best = M.bestRun(s.runs, len, true), fk = M.finalKey(len);
        if (sel) cv.roundRect(L + 10, ry, lw - 20, 60, 20, '#262a33');
        ltext(cv, dayName(s.start, now) + ', ' + clock(s.start), L + 26, ry + 27, 19, C.text, 'bold');
        ltext(cv, s.runs.length + (s.runs.length === 1 ? ' run, ' : ' runs, ') + U.dist(len) + ', air ' + fix(U.temp(s.runs[0].intake), 0) + ' ' + U.tempU + ', ' + fix(U.baro(s.runs[0].kPa), U.baroD) + ' ' + U.baroU, L + 26, ry + 50, 15, C.dim);
        rtext(cv, best ? secs(best.result[fk]) + ' s' : '--', L + lw - 26, ry + 38, 22, sel ? C.green : C.text, 'bold');
        if (cv.target) cv.target(L + 10, ry, lw - 20, 60, () => { ui.logSession = i; ui.logRun = null; }, 'dlses|' + i, 20);
    });
    if (ses.length > per) {
        const by = BOTTOM - 58;
        if (off > 0) UI.button(cv, L + 20, by, 'Newer', () => { ui.logOff = Math.max(0, off - per); }, { key: 'dlnewer' });
        if (off + per < ses.length) UI.button(cv, L + lw - 130, by, 'Older', () => { ui.logOff = off + per; }, { key: 'dlolder' });
    }
    // right: the runs of the session, or the run opened
    const x = L + lw + 14, w = R - x, s = ses[ui.logSession];
    const open = ui.logRun != null ? m.runAt(ui.logRun) : null;
    if (open) { runDetail(cv, m, x, T, w, CH, open, s); return; }
    UI.card(cv, x, T, w, CH, s ? 'Runs, ' + dayName(s.start, now) + ' ' + clock(s.start) : 'Runs', { info: INFO.logRuns, infoIcon: true });
    if (s) {
        runTable(cv, m, x, T + 60, w, s.runs, { max: 5, onPick: (r) => { ui.logRun = r.at; } });
        ltext(cv, s.runs.length > 5 ? 'The newest 5 of ' + s.runs.length + ' runs. Tap a run to open it.' : 'Tap a run to open it.', x + 20, BOTTOM - 22, 16, C.dim);
    }
}
function runDetail(cv, m, x, y, w, h, run, s) {
    const U = units(m), ui = m.ui, idx = s ? s.runs.indexOf(run) + 1 : 0;
    const half = 420;
    runCard(cv, m, x, y, half, h, run, { label: 'Run ' + (idx || '') + ', ' + clock(run.at), outline: '#3c4048' });
    const cx = x + half + 14, cw = w - half - 14;
    const rl = runLabels(run.trace && run.trace.length ? run.trace[run.trace.length - 1][0] : 12);
    const withBoost = m.has('boost'), ch = withBoost ? (h - 74) / 2 : h - 60;
    UI.chart(cv, cx, y, cw, ch, [{ name: 'speed', color: C.text, values: traceOver(run, 'v', rl.end).map(U.speed) }],
        { label: 'Speed', yTicks: withBoost ? 2 : 4, yUnit: U.speedU, xLabels: withBoost ? [rl.labels[0], rl.labels[rl.labels.length - 1]] : rl.labels, info: INFO.lastRun, fill: false });
    if (withBoost) {
        UI.chart(cv, cx, y + ch + 14, cw, ch, [{ name: 'boost', color: 'accent', values: traceOver(run, 'boost', rl.end).map(U.press) }],
            { label: 'Boost', yTicks: 2, yUnit: U.pressU, xLabels: [rl.labels[0], rl.labels[rl.labels.length - 1]], info: INFO.boost, fill: false });
    }
    const by = y + h - 46;
    let bx = cx;
    bx += UI.button(cv, bx, by, 'Back', () => { ui.logRun = null; }, { key: 'dlback' }) + 12;
    bx += UI.button(cv, bx, by, ui.cmpA === run.at ? 'Run A' : 'Compare as A', () => { ui.cmpA = run.at; if (ui.cmpB === run.at) ui.cmpB = null; }, { key: 'dlA', filled: ui.cmpA === run.at }) + 12;
    UI.button(cv, bx, by, ui.cmpB === run.at ? 'Run B' : 'Compare as B', () => { ui.cmpB = run.at; if (ui.cmpA === run.at) ui.cmpA = null; }, { key: 'dlB', filled: ui.cmpB === run.at });
}

/* ---------- Compare ---------- */

function pageCompare(cv, m) {
    const U = units(m), pair = m.comparePair(), a = pair[0], b = pair[1], now = m.lastT || Date.now();
    const lw = 560;
    UI.card(cv, L, T, lw, CH, 'Run A vs run B', { info: INFO.compare });
    if (!a || !b || a === b) {
        ltext(cv, 'Two runs are needed. Make a run or pick two on the Log page.', L + 20, T + 110, 18, C.dim);
        return;
    }
    const cA = L + 250, cB = L + 380, cD = L + lw - 20;
    const tag = (r, col, cx) => {
        cv.roundRect(cx - 98, T + 44, 18, 6, 3, col);
        rtext(cv, dayName(r.at, now).replace('Today', 'today') + ' ' + clock(r.at), cx, T + 52, 13, C.dim);
    };
    rtext(cv, 'A', cA, T + 80, 18, C.blue, 'bold'); rtext(cv, 'B', cB, T + 80, 18, C.orange, 'bold'); rtext(cv, 'B - A', cD, T + 80, 16, C.dim, 'bold');
    tag(a, C.blue, cA); tag(b, C.orange, cB);
    const fa = M.finalKey(a.length), fb = M.finalKey(b.length);
    const rows = [[U.dist(a.length) + ' time', a.result[fa], b.result[fb], 1]];
    const hasCorr = m.has('intake') && m.has('kPa');
    if (hasCorr) rows.push(['corrected', M.correctTime(a.result[fa], a.cf, true), M.correctTime(b.result[fb], b.cf, true), 1]);
    M.splitsFor(Math.min(a.length, b.length)).forEach((sp) => { if (sp.key !== fa && sp.key !== fb) rows.push([sp.label, a.result[sp.key], b.result[sp.key], 1]); });
    rows.push(['trap ' + U.speedU, U.speed(a.trap && a.trap[fa]), U.speed(b.trap && b.trap[fb]), -1]);
    rows.push(['reaction', a.reaction, b.reaction, 1]);
    const pitch = Math.min(40, (CH - 110) / rows.length);
    rows.forEach((r, i) => {
        const ry = T + 118 + i * pitch, d = isNum(r[1]) && isNum(r[2]) ? r[2] - r[1] : null;
        ltext(cv, r[0], L + 20, ry, 17, C.dim);
        const dec = r[3] < 0 ? 1 : 2;
        rtext(cv, fix(r[1], dec), cA, ry, 19, C.text, i < 2 ? 'bold' : 'label');
        rtext(cv, fix(r[2], dec), cB, ry, 19, C.text, i < 2 ? 'bold' : 'label');
        const better = isNum(d) && (r[3] > 0 ? d < -0.005 : d > 0.05), worse = isNum(d) && (r[3] > 0 ? d > 0.005 : d < -0.05);
        rtext(cv, signed(d, dec), cD, ry, 19, better ? C.green : worse ? C.red : C.dim, 'bold');
    });
    // right: boost of both runs, charge air of both, the air difference
    const x = L + lw + 14, w = R - x, top = 186;
    const endA = a.trace && a.trace.length ? a.trace[a.trace.length - 1][0] : 12, endB = b.trace && b.trace.length ? b.trace[b.trace.length - 1][0] : 12;
    const rl = runLabels(Math.max(endA, endB));
    const top2 = m.has('boost') ? ['boost', 'Boost', U.press, U.pressU, INFO.cmpBoost] : ['v', 'Speed', U.speed, U.speedU, INFO.compare];
    UI.chart(cv, x, T, w, top, [
        { name: 'A', color: 'info', values: traceOver(a, top2[0], rl.end).map(top2[2]) },
        { name: 'B', color: 'accent', values: traceOver(b, top2[0], rl.end).map(top2[2]) },
    ], { label: top2[1], yTicks: 3, yUnit: top2[3], xLabels: rl.labels, legend: 'right', info: top2[4], fill: false });
    const y2 = T + top + 14, h2 = BOTTOM - y2, airCard = m.has('intake') || m.has('kPa'), cw2 = airCard ? 560 : w;
    if (m.has('charge')) {
        UI.chart(cv, x, y2, airCard ? cw2 : w, h2, [
            { name: 'A', color: 'info', values: traceOver(a, 'charge', rl.end).map(U.temp) },
            { name: 'B', color: 'accent', values: traceOver(b, 'charge', rl.end).map(U.temp) },
        ], { label: 'Charge air', yTicks: 3, yUnit: U.tempU, xLabels: [rl.labels[0], rl.labels[rl.labels.length - 1]], info: INFO.cmpCharge, fill: false });
    }
    if (!airCard) return;
    const ax = m.has('charge') ? x + cw2 + 14 : x, aw = R - ax;
    UI.card(cv, ax, y2, aw, h2, 'Air difference', { info: INFO.cmpAir });
    const lines = [
        ['intake', fix(U.temp(a.intake), 0), fix(U.temp(b.intake), 0), U.tempU, 'intake'],
        ['pressure', fix(U.baro(a.kPa), U.baroD), fix(U.baro(b.kPa), U.baroD), U.baroU, 'kPa'],
        ['factor', fix(a.cf, 3), fix(b.cf, 3), '', 'cf'],
    ].filter((l) => l[4] === 'cf' ? m.has('intake') && m.has('kPa') : m.has(l[4]));
    lines.forEach((l, i) => {
        const ry = y2 + 64 + i * 28;
        ltext(cv, l[0], ax + 20, ry, 16, C.dim);
        rtext(cv, l[1], ax + 210, ry, 17, C.blue, 'bold');
        rtext(cv, l[2] + (l[3] ? ' ' + l[3] : ''), ax + aw - 20, ry, 17, C.orange, 'bold');
    });
    const raw = isNum(a.result[fa]) && isNum(b.result[fb]) ? b.result[fb] - a.result[fa] : null;
    const corr = hasCorr && rows[1][1] != null && rows[1][2] != null ? rows[1][2] - rows[1][1] : null;
    const air = isNum(raw) && isNum(corr) ? raw - corr : null;
    const words = !isNum(air) ? 'no air data for one of the runs' : 'the air explains ' + signed(air, 2) + ' s of ' + signed(raw, 2) + ' s';
    UI.wrap(cv, words, 15, aw - 40).forEach((ln, i) => ltext(cv, ln, ax + 20, y2 + 160 + i * 20, 15, C.amber));
}

/* ---------- one frame ---------- */

const PAGES = { Now: pageNow, Runs: pageRuns, Dyno: pageDyno, Correction: pageCorrection, Tyres: pageTyres, Boost: pageBoost, Temps: pageTemps, Log: pageLog, Compare: pageCompare };

/** Draw one frame of what model.ui shows. t: seconds (the animations). */
function draw(cv, m, t) {
    const ui = m.ui;
    ART.setEngine(m.car());
    if (ui.view === 'help') {
        const topics = TOPICS.filter((tp) => !tp.needs || m.has(tp.needs)).concat([UI.REPORT_TOPIC]);
        if (ui.topic >= topics.length) ui.topic = 0;
        UI.howToUse(cv, topics, ui.topic, t, { title: NAME, onSelect: (i) => { ui.topic = i; },
            onBack: () => { ui.view = 'main'; }, onSettings: () => { ui.view = 'settings'; } });
    } else if (ui.view === 'settings' && m.report && m.report.active()) {
        UI.reportPage(cv, m.report, t, { title: NAME, onHelp: () => { m.report.close(); ui.view = 'help'; } });
    } else if (ui.view === 'settings') {
        const vals = {};
        UI.DISPLAY_SETTINGS.concat(APP_ROWS).forEach((r) => { vals[r.key] = m.setting(r.key); });
        vals.demoCar = m.setting('demoCar');
        const rows = (m.isDemo() ? [E.DEMO_ROW] : []).concat(APP_ROWS.filter((r) => (r.key === 'boostTarget' ? m.has('boost') : r.key === 'tyreTarget' ? m.has('tyres') : true)));
        UI.settingsPage(cv, rows, vals, (k, val) => { if (m.settings) m.settings.set(k, val); }, { title: NAME, appLabel: 'Datalog',
            onBack: () => { ui.view = 'main'; }, onHelp: () => { ui.view = 'help'; }, onReport: m.report ? () => m.report.open() : null });
    } else {
        head(cv, m);
        PAGES[ui.page](cv, m, t);
    }
    UI.overlay(cv, t);
}

module.exports = { draw, TABS, tabsFor, NAME, units, splitRows, PAGES };
