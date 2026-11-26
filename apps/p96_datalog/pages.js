// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog's pages: pure drawing from the model, no car wiring, so the same code draws the head unit's
 * screen and the screenshots on a PC.
 *
 *   draw(cv, model, st, t, act)
 *     st:  { page: 'main' | 'help' | 'settings', tab, topic, settings, status, statusColor, now }
 *     act: { tab(i), help(), settings(), back(), topic(i), set(key, v), compare(n) }
 *     t:   seconds, for the illustrations
 *
 * Every card that shows data has an (i): its info popup says what the value is and where it comes from.
 * Data colours are the fixed ones (orange, amber, green, blue, red); C.accent is the chrome only.
 */
function ui() {
    try { return require('./garage_ui'); }              // inside a built app
    catch (e) { return require('../../lib/ui'); }        // in the repo
}
const UI = ui();
const A = require('./art');
const M = require('./model');
const C = UI.C, T = UI.CONTENT_TOP, L = UI.MARGIN, R = UI.W - UI.MARGIN, CW = R - L;
const isNum = M.isNum;
const lit = { literal: true };
const TITLE = 'DATALOG';
const TABS = ['Now', 'Runs', 'Correction', 'Boost', 'Tyres', 'Temps', 'Log', 'Compare'];

const APP_ROWS = [
    { key: 'runLength', label: 'Run length', hint: 'The distance a run is timed over', type: 'choice', default: 402,
        options: [[201, '201 m'], [402, '402 m']] },
    { key: 'corrected', label: 'Corrected times', hint: 'Show times corrected to standard air', type: 'bool', default: false },
    { key: 'boostTarget', label: 'Boost mark', hint: 'Used when the engine sends no setpoint', type: 'number', default: 1.45,
        min: 0.5, max: 3, step: 0.05, decimals: 2, unit: 'bar' },
    { key: 'tyreHot', label: 'Tyre target (hot)', hint: 'The Tyres page compares with it', type: 'number', default: 2.5,
        min: 1.5, max: 3.5, step: 0.05, decimals: 2, unit: 'bar' },
];

/* ---------- small helpers ---------- */

const f = (v, d) => (isNum(v) ? v.toFixed(d || 0) : '--');
const sec = (v) => (isNum(v) ? v.toFixed(2) + ' s' : '--');
const clock = (ms) => { const d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
const vals = (h) => (h ? h.values() : []);
const bar100 = (h) => vals(h).map((v) => (isNum(v) ? v / 100 : null));
function tempColour(v, ok, hot) { return !isNum(v) ? 'dim' : v < ok ? 'info' : v > hot ? 'bad' : 'ok'; }

/* ---------- the info popups ---------- */

const INFO = {
    boost: { label: 'Boost', title: 'How hard the turbo pushes', draw: A.boostArt,
        text: 'Boost is the pressure in the intake manifold minus the outside air pressure. At idle the throttle is shut and the manifold is below the outside pressure, so boost is negative (vacuum).\n\n' +
            'The white mark is the engine\'s own boost setpoint. When the needle reaches it the turbo gives what the engine asks for.',
        note: 'Both pressures come from the engine unit (DME), read only.' },
    manifold: { label: 'Manifold pressure', title: 'The pressure the engine gets', draw: A.boostArt,
        text: 'Absolute pressure in the intake manifold, after the throttle. This is what fills the cylinders: it does not change with altitude for the same power, while boost does.' },
    ambient: { label: 'Outside pressure', title: 'Weather and altitude', draw: A.correctionArt,
        text: 'The outside air pressure, measured by the engine unit. It falls about 12 hPa every 100 m up and changes with the weather. Thinner air means less oxygen and slower runs.' },
    charge: { label: 'Charge air', title: 'The air that goes into the engine', draw: A.airPath,
        text: 'Measured after the intercooler, just before the throttle. The turbo heats the air when it compresses it; the intercooler cools it down again.\n\n' +
            'When it climbs run after run, the intercooler is heat soaked: wait a minute before the next run.',
        note: 'Normal: 10 to 25 °C above the intake air under load.' },
    intake: { label: 'Intake air', title: 'The air after the filter', draw: A.airPath,
        text: 'The air temperature after the air filter, before the turbo. Datalog corrects times with it, because it is the air the engine really breathes. Without it, the outside (mirror) sensor is used.' },
    outside: { label: 'Outside air', title: 'The mirror sensor', draw: A.airPath,
        text: 'The outside temperature the car shows on the dash. It warms up in the sun and in slow traffic, so after standing it can read a few degrees high.' },
    cf: { label: 'Correction factor', title: 'Times as if the air were standard', draw: A.correctionArt,
        text: 'SAE J1349 standard air is 25 °C at 99 kPa. Warm or thin air makes the engine weaker: the factor is above 1 and the corrected time is quicker than the measured one.\n\n' +
            'Speed windows are divided by the factor, distances by its cube root, as Dragy does.',
        note: 'Compare corrected times between days, measured times within a day.' },
    da: { label: 'Density altitude', title: 'How high the air feels', draw: A.correctionArt,
        text: 'The height at which standard air would be as thin as the air now. Warm air at sea level can feel like 600 m up.' },
    run: { label: 'Run', title: 'Timing a run', draw: A.runArt,
        text: 'Stop the car. When it stands still the timer shows READY. The time starts the moment the car moves and stops at the run length (201 or 402 m) or when you lift.\n\n' +
            'Every run is saved with the air, boost and temperatures of that run.',
        note: 'Only on closed roads or a strip. Never in traffic.' },
    speed: { label: 'Speed', title: 'The car\'s own speed', draw: A.runArt,
        text: 'The speed the car computes from all four wheels. Datalog times runs with it, 20 times a second.' },
    tyres: { label: 'Tyres', title: 'Pressure and temperature', draw: A.tyreArt,
        text: 'The tyre pressure sensors report pressure and temperature. Pressure rises as the tyres warm up; the hot target is what you want after a few runs.\n\n' +
            'Blue: below the target. Green: within 0.1 bar. Amber: above. Red: more than 0.3 bar off.' },
    temps: { label: 'Temperatures', title: 'Ready for a run', draw: A.tempArt,
        text: 'Oil, coolant and gearbox should be warm before a run: cold oil is thick and wears the engine, a hot gearbox slows the shifts. The exhaust value is the engine unit\'s own model after the catalyst, not a sensor.' },
    log: { label: 'Log', title: 'What was recorded', draw: A.logArt,
        text: 'Datalog keeps the last 60 seconds of every value and the last 10 minutes of the temperatures. Every run is saved on the head unit with its full trace, so it is still there after a restart.' },
    compare: { label: 'Compare', title: 'Two runs side by side', draw: A.compareArt,
        text: 'The best run against the one you pick on Runs (or the latest). The speed traces show where the time was won or lost; the table shows each split and the gap.' },
};

/* ---------- head ---------- */

function head(cv, st, act) {
    UI.background(cv);
    UI.tabs(cv, TABS, st.tab, { w: 900, onSelect: act.tab });
    UI.title(cv, TITLE);
    UI.header(cv, { status: st.status, statusColor: st.statusColor, onHelp: act.help, onSettings: act.settings });
}

/* ---------- Now ---------- */

function pageNow(cv, m, st) {
    const target = isNum(m.boostTarget()) && m.state() === 'run' ? m.boostTarget() : st.settings.boostTarget;
    UI.ring(cv, 196, T + 196, 118, { value: m.boost(), min: -1, max: 2, decimals: 2, unit: 'bar', label: 'Boost',
        scale: { step: 0.5, decimals: 1 }, target: target, color: 'accent', info: INFO.boost });
    const state = m.state(), el = m.elapsed(m.t);
    const air = m.air(), soak = m.heatSoak();
    const cards = [
        { label: 'Run', value: state === 'run' ? f(el, 2) : state === 'ready' ? 'READY' : 'WAIT', unit: state === 'run' ? 's' : '',
            sub: state === 'run' ? 'running' : state === 'ready' ? 'go full throttle' : 'stop the car to arm', color: state === 'ready' ? 'ok' : state === 'run' ? 'accent' : 'dim', info: INFO.run },
        { label: 'Speed', value: m.get('speed'), unit: 'km/h', sub: m.runs.length ? m.runs.length + ' runs this session' : 'no runs yet', color: 'info',
            history: vals(m.sec.speed), seq: m.sec.speed.seq, minSpan: 20, info: INFO.speed },
        { label: 'Air correction', value: air.cf, decimals: 3, unit: '', sub: air.from === 'intake' ? 'from the intake air' : 'from the outside sensor', color: isNum(air.cf) && air.cf > 1.02 ? 'warm' : 'ok', info: INFO.cf },
        { label: 'Intake air', value: m.get('intake'), unit: '°C', sub: 'after the filter', color: 'ok', history: vals(m.sec.intake), seq: m.sec.intake.seq, info: INFO.intake },
        { label: 'Charge air', value: m.get('charge'), unit: '°C', sub: isNum(soak) ? '+' + Math.round(soak) + ' over intake' : 'before the throttle',
            color: isNum(soak) && soak > 25 ? 'bad' : 'warm', history: vals(m.sec.charge), seq: m.sec.charge.seq, info: INFO.charge },
        { label: 'Engine oil', value: m.get('oil'), unit: '°C', sub: !isNum(m.get('oil')) ? 'no data' : m.get('oil') < 90 ? 'warming' : 'ready',
            color: tempColour(m.get('oil'), 90, 130), history: vals(m.sec.oil), seq: m.sec.oil.seq, info: INFO.temps },
    ];
    cards.forEach((g, i) => UI.stat(cv, 390 + (i % 3) * 400, T + Math.floor(i / 3) * 203, 382, 189, g));
}

/* ---------- Runs ---------- */

function runTime(run, key, corrected) { return corrected ? run.corrected[key] : run.result[key]; }

function pageRuns(cv, m, st, act) {
    const corr = !!st.settings.corrected, key = m.mainKey(), run = m.runs[0], best = m.best(corr);
    const lw = 520;
    UI.card(cv, L, T, lw, 392, corr ? 'Last run (corrected)' : 'Last run', { info: INFO.run });
    if (!run) {
        cv.text('No runs yet', L + lw / 2, T + 190, 30, C.dim, { font: 'bold', align: 'center', literal: true });
        cv.text('Stop the car; READY on Now arms the timer.', L + lw / 2, T + 226, 16, C.dim, { align: 'center', literal: true });
    } else {
        const s = runTime(run, key, corr);
        const w = cv.text(sec(s), L + 20, T + 110, 64, C.text, { font: 'num', literal: true });
        cv.text(m.runLength + ' m', L + 32 + w, T + 104, 20, C.dim, lit);
        cv.text('run ' + run.n + ' at ' + clock(run.at) + (best === run ? ', best' : '') + (isNum(run.trap[key]) ? ', ' + Math.round(run.trap[key]) + ' km/h' : ''),
            L + 20, T + 142, 16, best === run ? C.green : C.dim, lit);
        M.SPLITS(m.runLength).forEach((sp, i) => {
            const y = T + 190 + i * 38, v = runTime(run, sp.key, corr), bv = best ? runTime(best, sp.key, corr) : null;
            cv.text(sp.label, L + 20, y, 17, C.dim, lit);
            cv.text(sec(v), L + 300, y, 20, C.text, { font: 'num', align: 'right', literal: true });
            if (isNum(v) && isNum(bv) && best !== run) {
                const d = v - bv;
                cv.text((d >= 0 ? '+' : '') + d.toFixed(2), L + 400, y, 17, d > 0.005 ? C.amber : C.green, { font: 'bold', align: 'right', literal: true });
            }
            if (i < 4) cv.fillRect(L + 20, y + 13, lw - 40, 1, '#282c34');
        });
        cv.text('air ' + f(run.air.c) + ' °C, ' + f(run.air.kPa, 1) + ' kPa, factor ' + f(run.cf, 3), L + 20, T + 380, 14, C.dim, lit);
    }
    // the table
    const x = L + lw + 14, w = R - x;
    UI.card(cv, x, T, w, 392, 'This session');
    const cols = [['Run', 40, 'left'], [corr ? m.runLength + ' m corr.' : m.runLength + ' m', 250, 'right'], ['0-100', 380, 'right'], ['Trap', 500, 'right'],
        ['Air', 610, 'right'], ['Peak boost', 760, 'right'], ['Soak', 880, 'right']];
    cols.forEach((c) => cv.text(c[0], x + c[1], T + 66, 14, C.dim, { font: 'bold', align: c[2], literal: true }));
    const rows = m.runs.slice(0, 7);
    if (!rows.length) cv.text('Runs appear here as you make them.', x + w / 2, T + 200, 17, C.dim, { align: 'center', literal: true });
    rows.forEach((r, i) => {
        const y = T + 106 + i * 40, isBest = best === r, sel = m.compareWith === r.n;
        if (sel) cv.roundRect(x + 14, y - 26, w - 28, 36, 18, [80, 170, 255, 40]);
        const col = isBest ? C.green : C.text;
        cv.text('#' + r.n, x + 40, y, 18, col, { font: 'bold', literal: true });
        cv.text(sec(runTime(r, key, corr)), x + 250, y, 18, col, { font: 'num', align: 'right', literal: true });
        cv.text(sec(runTime(r, '0-100', corr)), x + 380, y, 18, C.text, { font: 'num', align: 'right', literal: true });
        cv.text(isNum(r.trap[key]) ? Math.round(r.trap[key]) + ' km/h' : '--', x + 500, y, 18, C.text, { align: 'right', literal: true });
        cv.text(f(r.air.c) + ' °C', x + 610, y, 18, C.text, { align: 'right', literal: true });
        cv.text(f(r.peakBoost, 2) + ' bar', x + 760, y, 18, C.orange, { align: 'right', literal: true });
        cv.text(isNum(r.soak) ? '+' + Math.round(r.soak) + ' °C' : '--', x + 880, y, 18, isNum(r.soak) && r.soak > 25 ? C.red : C.dim, { align: 'right', literal: true });
        if (cv.target) cv.target(x + 14, y - 26, w - 28, 36, () => act.compare(r.n), 'dlrun|' + i, 18);
    });
    if (rows.length) cv.text('Tap a run to compare it with the best.', x + w - 20, T + 380, 14, C.dim, { align: 'right', literal: true });
}

/* ---------- Correction ---------- */

function pageCorrection(cv, m) {
    const cw = 374, air = m.air();
    const amb = m.get('ambient');
    UI.stat(cv, L, T, cw, 180, { label: 'Outside air', value: m.get('outside'), unit: '°C', sub: 'mirror sensor', color: 'info', history: vals(m.sec.outside), seq: m.sec.outside.seq, info: INFO.outside });
    UI.stat(cv, L + cw + 14, T, cw, 180, { label: 'Intake air', value: m.get('intake'), unit: '°C', sub: air.from === 'intake' ? 'used for the correction' : 'no data', color: 'ok', history: vals(m.sec.intake), seq: m.sec.intake.seq, info: INFO.intake });
    UI.stat(cv, L + 2 * (cw + 14), T, cw, 180, { label: 'Charge air', value: m.get('charge'), unit: '°C', sub: 'after the intercooler', color: 'warm', history: vals(m.sec.charge), seq: m.sec.charge.seq, info: INFO.charge });
    UI.stat(cv, L + 3 * (cw + 14), T, R - (L + 3 * (cw + 14)), 180, { label: 'Outside pressure', value: isNum(amb) ? amb * 10 : null, unit: 'hPa', sub: 'from the engine unit', color: 'info',
        history: vals(m.sec.ambient).map((v) => (isNum(v) ? v * 10 : null)), seq: m.sec.ambient.seq, info: INFO.ambient });
    const y = T + 194, h = 198, lw = 500;
    UI.card(cv, L, y, lw, h, 'Correction factor', { info: INFO.cf });
    cv.text(isNum(air.cf) ? 'x ' + air.cf.toFixed(3) : '--', L + 20, y + 110, 56, isNum(air.cf) ? C.orange : C.dim, { font: 'num', literal: true });
    cv.text(isNum(air.da) ? 'density altitude ' + Math.round(air.da) + ' m' : 'needs air temperature and pressure', L + 20, y + 150, 17, C.dim, lit);
    cv.text(!isNum(air.cf) ? '' : air.cf > 1 ? 'worse than standard air: corrected times are quicker' : 'better than standard air: corrected times are slower', L + 20, y + 178, 15, air.cf > 1 ? C.amber : C.green, lit);
    UI.chart(cv, L + lw + 14, y, R - (L + lw + 14), h, [
        { name: 'charge air', color: 'warm', values: vals(m.sec.charge) },
        { name: 'intake', color: 'ok', values: vals(m.sec.intake) },
        { name: 'outside', color: 'info', values: vals(m.sec.outside) },
    ], { label: 'Air temperatures', yTicks: 3, yUnit: '°C', xLabels: ['-60 s', '-40 s', '-20 s', 'now'], legend: 'right', seq: m.sec.charge.seq, fill: false,
        note: 'heat soak: charge air far over intake', info: INFO.charge });
}

/* ---------- Boost ---------- */

function pageBoost(cv, m, st) {
    const cw = 374, b = m.boost(), man = m.get('manifold'), amb = m.get('ambient'), tg = m.boostTarget(), last = m.runs[0];
    UI.stat(cv, L, T, cw, 180, { label: 'Boost', value: b, decimals: 2, unit: 'bar', sub: isNum(tg) && tg > 0 ? 'setpoint ' + tg.toFixed(2) + ' bar' : 'manifold minus outside', color: 'accent',
        history: vals(m.secBoost), seq: m.secBoost ? m.secBoost.seq : 0, minSpan: 0.5, info: INFO.boost });
    UI.stat(cv, L + cw + 14, T, cw, 180, { label: 'Manifold pressure', value: isNum(man) ? man / 100 : null, decimals: 2, unit: 'bar abs', sub: 'what the engine gets', color: C.text,
        history: bar100(m.sec.manifold), seq: m.sec.manifold.seq, minSpan: 0.5, info: INFO.manifold });
    UI.stat(cv, L + 2 * (cw + 14), T, cw, 180, { label: 'Outside pressure', value: isNum(amb) ? amb / 100 : null, decimals: 2, unit: 'bar abs', sub: 'weather and altitude', color: 'info',
        history: bar100(m.sec.ambient), seq: m.sec.ambient.seq, minSpan: 0.05, info: INFO.ambient });
    const peak = m.state() === 'run' ? m.peakBoost : last ? last.peakBoost : null;
    UI.stat(cv, L + 3 * (cw + 14), T, R - (L + 3 * (cw + 14)), 180, { label: 'Peak boost', value: peak, decimals: 2, unit: 'bar',
        sub: m.state() === 'run' ? 'this run' : last ? 'run ' + last.n : 'no run yet', color: 'accent', info: INFO.boost });
    // the chart: the last run when there is one and the car is not on a run, else the last 60 s
    const y = T + 194, h = 198, useRun = last && last.fast.length > 4 && m.state() !== 'run';
    const rows = useRun ? last.fast : m.fast.map((r) => [(r[0] - m.t) / 1000, r[1], r[2], r[3]]);
    const pick = (k) => rows.map((r) => r[k]);
    const span = rows.length ? rows[rows.length - 1][0] - rows[0][0] : 0;
    const xl = useRun ? [0, 0.25, 0.5, 0.75, 1].map((q) => Math.round(rows[0][0] + span * q) + ' s') : ['-60 s', '-45 s', '-30 s', '-15 s', 'now'];
    UI.chart(cv, L, y, CW, h, [
        { name: 'manifold (abs)', color: C.text, values: pick(2) },
        { name: 'outside (abs)', color: 'info', values: pick(3) },
        { name: 'boost', color: 'accent', values: pick(1) },
    ], { label: useRun ? 'Pressure over run ' + last.n : 'Pressure, the last 60 s', yTicks: 4, yUnit: 'bar', xLabels: xl, legend: 'right',
        note: 'boost = manifold minus outside', fill: false, info: INFO.boost });
}

/* ---------- Tyres ---------- */

function tyreColour(p, hot) {
    if (!isNum(p) || !isNum(hot)) return 'dim';
    const d = p - hot;
    return Math.abs(d) > 0.3 ? 'bad' : d < -0.1 ? 'info' : d > 0.1 ? 'warm' : 'ok';
}
function pageTyres(cv, m, st) {
    const hot = st.settings.tyreHot, lw = 1000, cx = L + lw / 2, cy = T + 196;
    UI.card(cv, L, T, lw, 392, 'Tyres', { info: INFO.tyres });
    cv.roundRect(cx - 80, cy - 150, 160, 300, 60, '#262a31');
    cv.strokeRoundRect(cx - 80, cy - 150, 160, 300, 60, 2, '#3c4048');
    cv.roundRect(cx - 56, cy - 96, 112, 54, 16, '#1a1d22');          // windscreen
    cv.roundRect(cx - 50, cy + 70, 100, 36, 12, '#1a1d22');          // rear window
    cv.text('front', cx, cy - 120, 13, C.dim, { align: 'center', literal: true });
    const POS = { fl: [-1, -1], fr: [1, -1], rl: [-1, 1], rr: [1, 1] };
    M.TYRES.forEach((k) => {
        const q = POS[k], tx = cx + q[0] * 112, ty = cy + q[1] * 92, p = m.tyres.p[k], tt = m.tyres.t[k];
        const col = UI.STATUS[tyreColour(p, hot)] || C.dim;
        cv.roundRect(tx - 20, ty - 40, 40, 80, 16, col);
        const ax = tx + q[0] * 50, o = { align: q[0] < 0 ? 'right' : 'left', literal: true };
        cv.text(f(p, 2) + ' bar', ax, ty - 2, 30, C.text, { font: 'num', align: o.align, literal: true });
        cv.text(isNum(tt) ? Math.round(tt) + ' °C' : '-- °C', ax, ty + 28, 17, C.dim, o);
    });
    // the side card: target, spread, advice
    const x = L + lw + 14, w = R - x, ps = M.TYRES.map((k) => m.tyres.p[k]).filter(isNum);
    UI.card(cv, x, T, w, 392, 'Against the target', { info: INFO.tyres });
    cv.text(f(hot, 2), x + 20, T + 110, 56, C.text, { font: 'num', literal: true });
    cv.text('bar hot target' + (isNum(m.tyres.target) ? ', car says ' + m.tyres.target.toFixed(1) + ' cold' : ''), x + 20, T + 140, 15, C.dim, lit);
    const avg = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null, spread = ps.length ? Math.max.apply(null, ps) - Math.min.apply(null, ps) : null;
    const lines = [['Average', f(avg, 2) + ' bar'], ['Spread', f(spread, 2) + ' bar'],
        ['Front', f(avg2(m, 'fl', 'fr'), 2) + ' bar'], ['Rear', f(avg2(m, 'rl', 'rr'), 2) + ' bar']];
    lines.forEach((l, i) => {
        const y = T + 196 + i * 40;
        cv.text(l[0], x + 20, y, 17, C.dim, lit);
        cv.text(l[1], x + w - 20, y, 19, C.text, { font: 'bold', align: 'right', literal: true });
    });
    const adv = !isNum(avg) ? 'No tyre data from the car' : avg < hot - 0.1 ? 'Below the target: still warming, or add air' : avg > hot + 0.1 ? 'Over the target: let some air out when hot' : 'On the target';
    cv.text(adv, x + 20, T + 372, 15, !isNum(avg) ? C.dim : avg < hot - 0.1 ? C.blue : avg > hot + 0.1 ? C.amber : C.green, lit);
}
function avg2(m, a, b) { const p = m.tyres.p[a], q = m.tyres.p[b]; return isNum(p) && isNum(q) ? (p + q) / 2 : isNum(p) ? p : q; }

/* ---------- Temps ---------- */

const TEMP_ROWS = [['oil', 'Engine oil', 90, 130, 150], ['coolant', 'Coolant', 80, 112, 130], ['gearbox', 'Gearbox', 60, 120, 140],
    ['charge', 'Charge air', 0, 70, 90], ['intake', 'Intake air', -10, 45, 70], ['egt', 'Exhaust (model)', 200, 980, 1050]];
function pageTemps(cv, m) {
    const lw = 640;
    UI.card(cv, L, T, lw, 392, 'Now', { info: INFO.temps });
    TEMP_ROWS.forEach((r, i) => {
        const y = T + 84 + i * 52, v = m.get(r[0]);
        cv.text(r[1], L + 20, y + 6, 17, C.text, { font: 'bold', literal: true });
        UI.bar(cv, L + 200, y - 6, lw - 360, 14, isNum(v) ? (v - Math.min(0, r[2])) / (r[4] - Math.min(0, r[2])) : 0, tempColour(v, r[2], r[3]), 'temp|' + r[0]);
        cv.text(isNum(v) ? Math.round(v) + ' °C' : '--', L + lw - 20, y + 6, 20, isNum(v) ? C.text : C.dim, { font: 'num', align: 'right', literal: true });
    });
    UI.chart(cv, L + lw + 14, T, R - (L + lw + 14), 392, [
        { name: 'oil', color: 'accent', values: vals(m.min.oil) },
        { name: 'coolant', color: 'info', values: vals(m.min.coolant) },
        { name: 'gearbox', color: 'warm', values: vals(m.min.gearbox) },
    ], { label: 'The last 10 minutes', yTicks: 4, yUnit: '°C', xLabels: ['-10 min', '-5 min', 'now'], legend: 'bottom', seq: m.min.oil.seq, fill: false, info: INFO.temps });
}

/* ---------- Log ---------- */

function pageLog(cv, m, st) {
    const lw = 460;
    UI.card(cv, L, T, lw, 392, 'Recording', { info: INFO.log });
    const on = Math.floor((st.now || Date.now()) / 500) % 2 === 0;
    cv.circle(L + 34, T + 86, 10, on ? C.red : '#5a2626');
    cv.text('Recording', L + 56, T + 94, 26, C.text, { font: 'bold', literal: true });
    const have = Object.keys(M.CHANNELS).filter((k) => isNum(m.get(k))).length;
    const lines = [['Runs saved', String(m.runs.length)], ['Values live', have + ' of ' + Object.keys(M.CHANNELS).length],
        ['Fast samples', m.fast.length + ' (10 a second)'], ['Events', String(m.events.length)], ['Run length', m.runLength + ' m']];
    lines.forEach((l, i) => {
        const y = T + 150 + i * 42;
        cv.text(l[0], L + 20, y, 17, C.dim, lit);
        cv.text(l[1], L + lw - 20, y, 19, C.text, { font: 'bold', align: 'right', literal: true });
    });
    cv.text('Runs are kept on the head unit after a restart.', L + 20, T + 372, 14, C.dim, lit);
    const x = L + lw + 14, w = R - x;
    UI.card(cv, x, T, w, 392, 'Events');
    m.events.slice(0, 8).forEach((e, i) => {
        const y = T + 76 + i * 40, c = e.kind === 'warn' ? C.amber : e.kind === 'run' ? C.text : C.dim;
        cv.circle(x + 30, y - 6, 5, e.kind === 'warn' ? C.amber : e.kind === 'run' ? C.green : C.dim);
        cv.text(clock(e.at), x + 48, y, 16, C.dim, { font: 'num', literal: true });
        cv.text(e.text, x + 120, y, 17, c, lit);
    });
}

/* ---------- Compare ---------- */

function pageCompare(cv, m, st) {
    const corr = !!st.settings.corrected, best = m.best(corr);
    let other = null;
    m.runs.forEach((r) => { if (r.n === m.compareWith) other = r; });
    if (!other) other = m.runs[0] === best ? m.runs[1] : m.runs[0];
    const cw = 1000;
    if (!best || !other) {
        UI.card(cv, L, T, CW, 392, 'Compare', { info: INFO.compare });
        cv.text('Two runs are needed to compare', L + CW / 2, T + 190, 28, C.dim, { font: 'bold', align: 'center', literal: true });
        cv.text(m.runs.length ? 'One run so far. Make another one.' : 'No runs yet.', L + CW / 2, T + 226, 16, C.dim, { align: 'center', literal: true });
        return;
    }
    // both speed traces on one time axis, 0.25 s steps
    const end = Math.min(20, Math.max(trEnd(best.trace), trEnd(other.trace)));
    const grid = [];
    for (let s = 0; s <= end + 1e-6; s += 0.25) grid.push(s);
    UI.chart(cv, L, T, cw, 392, [
        { name: 'best: run ' + best.n, color: 'accent', values: grid.map((s) => at(best.trace, s)) },
        { name: 'run ' + other.n, color: 'info', values: grid.map((s) => at(other.trace, s)) },
    ], { label: 'Speed', yTicks: 4, yUnit: 'km/h', min: 0, xLabels: [0, 0.25, 0.5, 0.75, 1].map((q) => Math.round(end * q) + ' s'), legend: 'bottom', fill: false, info: INFO.compare });
    const x = L + cw + 14, w = R - x;
    UI.card(cv, x, T, w, 392, corr ? 'Splits (corrected)' : 'Splits');
    [['', 20, 'left'], ['#' + best.n, 300, 'right'], ['#' + other.n, 420, 'right'], ['gap', w - 20, 'right']].forEach((c) =>
        cv.text(c[0], x + c[1], T + 66, 14, c[1] === 300 ? C.orange : c[1] === 420 ? C.blue : C.dim, { font: 'bold', align: c[2], literal: true }));
    M.SPLITS(m.runLength).forEach((sp, i) => {
        const y = T + 110 + i * 44, a = runTime(best, sp.key, corr), b = runTime(other, sp.key, corr);
        cv.text(sp.label, x + 20, y, 17, C.dim, lit);
        cv.text(f(a, 2), x + 300, y, 19, C.text, { font: 'num', align: 'right', literal: true });
        cv.text(f(b, 2), x + 420, y, 19, C.text, { font: 'num', align: 'right', literal: true });
        const d = isNum(a) && isNum(b) ? b - a : null;
        cv.text(isNum(d) ? (d >= 0 ? '+' : '') + d.toFixed(2) : '--', x + w - 20, y, 19, !isNum(d) ? C.dim : d > 0.005 ? C.amber : C.green, { font: 'bold', align: 'right', literal: true });
    });
    const da = isNum(other.air.c) && isNum(best.air.c) ? other.air.c - best.air.c : null;
    cv.text(isNum(da) ? 'air ' + (da >= 0 ? '+' : '') + Math.round(da) + ' °C, soak ' + f(other.soak) + ' against ' + f(best.soak) + ' °C' : '', x + 20, T + 372, 14, C.dim, lit);
}
function trEnd(tr) { return tr.length ? tr[tr.length - 1][0] : 0; }
/** Speed at s seconds into a trace [[s, kmh]], interpolated; null after its end. */
function at(tr, s) {
    if (!tr.length || s > trEnd(tr)) return null;
    for (let i = 1; i < tr.length; i++) {
        if (tr[i][0] >= s) {
            const a = tr[i - 1], b = tr[i], k = b[0] > a[0] ? (s - a[0]) / (b[0] - a[0]) : 0;
            return a[1] + (b[1] - a[1]) * k;
        }
    }
    return tr[0][1];
}

/* ---------- How to use ---------- */

const TOPICS = [
    { title: 'Time a run', draw: A.runArt, note: 'Only on closed roads or a strip. Never in traffic.',
        text: 'Stop the car. Now shows READY when it stands still.\n\nGo full throttle. The time starts the moment the car moves and the run is saved at the run length, or when you lift.\n\nEvery run keeps its air, boost and temperatures.' },
    { title: 'Read the result', draw: A.runArt,
        text: 'Runs shows the last run with every split and the gap to your best one, and a table of the session.\n\nGreen is the best run. A red soak value means the charge air was far over the intake air: the intercooler was heat soaked.' },
    { title: 'Air correction', draw: A.correctionArt,
        text: 'Warm or thin air makes every engine slower. Correction shows the factor (SAE J1349) from the intake air and the outside pressure.\n\nTurn on Corrected times in Settings to compare runs from different days.' },
    { title: 'Boost', draw: A.boostArt,
        text: 'Boost is the manifold pressure minus the outside pressure. The ring\'s white mark is the engine\'s own setpoint during a run, or your boost mark from Settings.\n\nThe chart shows the pressures over the last run.' },
    { title: 'Tyres and temperatures', draw: A.tyreArt,
        text: 'Tyres compares each pressure with your hot target. Temps shows oil, coolant, gearbox and air, and the last 10 minutes.\n\nWait until the oil is over 90 °C before a run.' },
    { title: 'Compare two runs', draw: A.compareArt,
        text: 'Tap a run on Runs. Compare draws its speed over your best run\'s and lists every split with the gap.' },
    { title: 'The log', draw: A.logArt,
        text: 'Log shows what is recorded and what happened: runs, new best times and heat soak warnings. Runs stay on the head unit after a restart.' },
    { title: 'What the car must report', draw: A.carArt, note: 'Datalog only reads. It never writes to the car.',
        text: 'Speed, temperatures and tyres come from the car\'s own signals. The pressures and the intake and charge air come from the engine unit, read the way a diagnostic tester reads them.\n\nA value the car does not send shows --.' },
];

/* ---------- the frame ---------- */

const PAGES = [pageNow, pageRuns, pageCorrection, pageBoost, pageTyres, pageTemps, pageLog, pageCompare];

function draw(cv, m, st, t, act) {
    if (st.page === 'help') {
        UI.howToUse(cv, TOPICS, st.topic || 0, t, { title: TITLE, onSelect: act.topic, onBack: act.back, onSettings: act.settings });
    } else if (st.page === 'settings') {
        UI.settingsPage(cv, APP_ROWS, st.settings, act.set, { title: TITLE, appLabel: 'Datalog', onBack: act.back, onHelp: act.help });
    } else {
        head(cv, st, act);
        PAGES[st.tab || 0](cv, m, st, act);
    }
    UI.overlay(cv, t);
}

/** Every setting's default: the Display block and Datalog's own rows. */
const DEFAULTS = {};
UI.DISPLAY_SETTINGS.concat(APP_ROWS).forEach((r) => { DEFAULTS[r.key] = r.default; });

module.exports = { draw, TABS, TOPICS, APP_ROWS, INFO, PAGES, DEFAULTS };
