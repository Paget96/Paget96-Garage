// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Health's pages, drawn with the Paget96 Garage UI (lib/ui.js, shipped as garage_ui.js). draw() takes the data (S),
 * where the user is (V) and the actions (A, called by the touch and knob targets), and records one frame.
 *
 *   S  model state, built by main.js (live) or demo.js: units, log, battery, cbs, pressures, ...
 *   V  { page, mode: 'main' | 'help' | 'settings', mem, unit, first, detail, histSel, dialog, helpSel, values }
 *   A  { tab, mem, unit, scroll, detail, back, save, askClear, askReset, askDone, togglePart, addPart, help, settings,
 *        setting, helpTopic }
 *
 * Data colours are fixed (green ok, amber warm, red bad, blue info, orange data); only the chrome follows the ambient
 * light (UI.C.accent). Every card has an (i): its info popup (UI.overlay) shows an animation and plain words.
 */
function need(local, repo) {
    try { return require(local); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return require(repo); }
}
const UI = need('./garage_ui', '../../lib/ui');
const M = require('./model');
const T = require('./texts');
const E = need('./garage_engine', '../../lib/engine');
const { artFor, setEngine } = require('./art');
const QR = need('./kit/qr', '../../upstream-kit/kit/runtime/qr');
const C = UI.C, TOP = UI.CONTENT_TOP, X0 = UI.MARGIN, X1 = UI.W - UI.MARGIN;

const TABS = ['Overview', 'Faults', 'Battery', 'Service', 'Tyres', 'Fluids', 'History', 'Share', 'Engine'];
const COL = { ok: C.green, warm: C.amber, bad: C.red, info: C.blue, dim: C.dim, accent: C.orange };
const col = (c) => COL[c] || c || C.text;

/* ---------- info popups: texts.INFO plus the animation ---------- */
const infos = {};
function info(key) {
    if (!infos[key]) {
        const i = T.INFO[key] || { label: key, title: key, text: '' };
        infos[key] = Object.assign({}, i, { draw: artFor(key, i) });
    }
    return infos[key];
}

/* ---------- small parts ---------- */

/** A thin divider inside a card. */
const rule = (cv, x, y, w) => cv.fillRect(x, y, w, 1, '#282c34');
/** Text that never runs past maxW: shortened with "..." (cached per string by the UI's wrap). */
function fit(cv, s, size, maxW, font) {
    s = String(s);
    const o = { font: font || 'label', literal: true };
    if (cv.textWidth(s, size, o) <= maxW) return s;
    while (s.length > 3 && cv.textWidth(s + '...', size, o) > maxW) s = s.slice(0, -1);
    return s + '...';
}
/** A filled pill with dark text, or a tinted one (UI.pill), right aligned at `right`. */
function pillRight(cv, right, y, text, color, filled) {
    const w = Math.ceil(cv.textWidth(text, 15, { font: 'bold' })) + 28;
    UI.pill(cv, right - w, y, text, color, filled);
    return w;
}
/** A check box: round corners, a tick in it when on (data colour orange: what is picked). */
function checkBox(cv, x, y, on) {
    if (on) {
        cv.roundRect(x, y, 26, 26, 7, C.orange);
        cv.stroke([[x + 6, y + 13], [x + 11, y + 19], [x + 20, y + 7]], 3.5, C.dark);
    } else cv.strokeRoundRect(x, y, 26, 26, 7, 2, '#5a606a');
}
/** A round-ended chevron, for "more" and the list arrows. */
function chev(cv, x, y, s, dir, c) {
    if (dir === 'up' || dir === 'down') {
        const k = dir === 'up' ? -1 : 1;
        cv.stroke([[x - s * 0.5, y - k * s * 0.3], [x, y + k * s * 0.3], [x + s * 0.5, y - k * s * 0.3]], 3, c);
    } else {
        const k = dir === 'left' ? -1 : 1;
        cv.stroke([[x - k * s * 0.3, y - s * 0.5], [x + k * s * 0.3, y], [x - k * s * 0.3, y + s * 0.5]], 3, c);
    }
}

/* ---------- the page frame ---------- */

function frame(cv, S, V, A) {
    UI.background(cv);
    const pages = M.pagesFor(S.caps, S);
    UI.tabs(cv, pages.map((i) => TABS[i]), pages.indexOf(V.page), { onSelect: (i) => A.tab(pages[i]) });
    UI.title(cv, 'HEALTH');
    const st = S.reading ? ['SCAN', 'info'] : S.demo ? ['DEMO', 'warm'] : S.live ? ['LIVE', 'ok'] : ['WAIT', 'dim'];
    UI.header(cv, { status: st[0], statusColor: st[1], onHelp: A.help, onSettings: A.settings });
}

/* ---------- Overview ---------- */

/** A check card: label and (i), a dot, a big value with a word after it, an optional bar, a coloured line at the bottom. */
function checkCard(cv, x, y, w, h, c) {
    UI.card(cv, x, y, w, h, c.label, { info: info(c.info) });
    cv.circle(x + 26, y + 56, 7, col(c.color));
    const vw = cv.text(c.value, x + 44, y + 68, 32, c.value === '--' ? C.dim : C.text, { font: 'num', literal: true });
    if (c.unit) cv.text(c.unit, x + 54 + vw, y + 66, 16, C.dim, { literal: true });
    if (c.frac != null) UI.bar(cv, x + 20, y + 96, w - 40, 10, c.frac, c.barColor || c.color, 'ov|' + c.info);
    if (c.sub) cv.text(fit(cv, c.sub, 16, w - 40), x + 20, y + h - 18, 16, col(c.color), { literal: true });
}

function overview(cv, S, V, A, t) {
    const sc = S.score;
    const ringInfo = info('score');
    UI.ring(cv, 200, TOP + 176, 130, { value: sc.value, min: 0, max: 100, text: sc.value == null ? '--' : null, unit: 'of 100',
        color: sc.color, scale: [0, 25, 50, 75, 100], info: ringInfo });
    cv.text(sc.word, 200, TOP + 348, 22, col(sc.color), { font: 'bold', align: 'center', spacing: 1, literal: true });
    cv.text(S.checkedText || '', 200, TOP + 376, 15, C.dim, { align: 'center', literal: true });
    const cw = 380, ch = 186, gx = 14, x = X1 - 3 * cw - 2 * gx;
    S.cards.forEach((c, i) => checkCard(cv, x + (i % 3) * (cw + gx), TOP + Math.floor(i / 3) * (ch + 16), cw, ch, c));
}

/** The six Overview cards from the state. */
function overviewCards(S) {
    const sc = {}; (S.score.checks || []).forEach((c) => { sc[c.key] = c; });
    const fl = M.listOf(S.units, 'fault').concat(M.listOf(S.units, 'perm'));
    const act = fl.filter((d) => d.status & 1).length;
    const b = S.battery || {}, bv = M.batteryVerdict(b.rest, S.values && S.values.batteryWarn);
    const svc = (S.service || [])[0];
    const ty = S.tyres || {};
    const oil = S.fluids || {};
    if (!S.caps) S.caps = M.ALL_CAPS;
    const pr = S.pressures || {};
    const low = ty.leak || ty.low;
    const cp = S.caps, has = (k) => M.has(cp, k);
    return [
        { cap: 'faults', label: 'Faults', info: 'faults', color: sc.faults ? sc.faults.color : 'dim', value: S.units ? String(fl.length) : '--',
            unit: act ? 'active' : 'stored', sub: S.ready && S.ready.mil ? 'the engine light is on' : !S.units ? 'not read yet' : act ? act + ' failing now' : fl.length ? 'none active, nothing urgent' : 'all clear' },
        { cap: 'volts', label: '12 V battery', info: 'battery12', color: bv.color, value: b.rest != null ? b.rest.toFixed(1) : '--', unit: 'V resting',
            frac: b.rest != null ? M.restCharge(b.rest) / 100 : null, sub: b.rest != null ? 'about ' + M.restCharge(b.rest) + ' % charged' : bv.word.toLowerCase() },
        { cap: 'oilLevel', label: 'Engine oil', info: 'oil', color: oil.oilCl == null ? 'dim' : oil.oilCl < 20 ? 'bad' : 'ok', value: oil.oilCl == null ? '--' : oil.oilCl < 20 ? 'LOW' : 'OK',
            unit: 'level', frac: oil.oilCl == null ? null : Math.min(1, oil.oilCl / 100),
            sub: has('oilTemp') && oil.oilTemp != null ? Math.round(oil.oilTemp) + ' °C, ' + (oil.oilTemp >= 80 ? 'warm' : 'warming up') : 'level from the engine unit' },
        { cap: 'cbs', label: 'Service', info: 'service', color: svc ? svc.color : 'dim', value: svc ? (svc.kmLeft != null ? M.fmtThousands(svc.kmLeft) : String(svc.monthsLeft)) : '--',
            unit: svc ? (svc.kmLeft != null ? 'km' : 'months') : '', frac: svc ? svc.frac : null, sub: svc ? svc.name.toLowerCase() + ' is next' : 'no service list yet' },
        { cap: 'tpms', label: 'Tyres', info: 'tyres', color: ty.color || 'dim', value: low || (ty.color === 'ok' ? 'OK' : '--'),
            unit: low ? (pr[low] != null && ty.lowBy ? ty.lowBy.toFixed(2) + ' bar low' : 'losing air') : '',
            sub: low ? 'others fine' : ty.color === 'ok' ? 'all four hold' : 'no pressures yet' },
        { cap: 'cc', label: 'Check Control', info: 'cc', color: S.cc == null ? 'dim' : S.cc ? 'warm' : 'ok', value: S.cc == null ? '--' : String(S.cc), unit: 'messages',
            sub: S.cc == null ? 'not heard yet' : S.cc ? 'see the cluster' : 'dashboard is clear' },
    ].filter((c) => has(c.cap));
}

/* ---------- Faults ---------- */

const MEMS = [['fault', 'Fault memory'], ['info', 'Info memory'], ['perm', 'Permanent'], ['history', 'History'], ['ready', 'Readiness']];
/** The memories this car answers (history goes with the fault memory; Readiness only when the engine unit answers 01 01). */
const memsFor = (S) => MEMS.filter((m) => M.has(S.caps, m[0] === 'perm' ? 'perm' : m[0] === 'info' ? 'info' : m[0] === 'ready' ? 'readiness' : 'faults'));

function memTabs(cv, x, y, S, V, A) {
    const opts = memsFor(S).map((m) => [m[0], m[1] + (m[0] === 'history' || m[0] === 'ready' ? '' : ' (' + M.listOf(S.units, m[0]).length + ')')]);
    // segmented() is right aligned: its width is the labels' (bold 16) plus 40 each, plus 8
    const w = opts.reduce((a, o) => a + Math.ceil(cv.textWidth(o[1], 16, { font: 'bold' })) + 40, 8);
    return UI.segmented(cv, x + w, y, opts, V.mem, A.mem, 'memtabs');
}

function faults(cv, S, V, A, t) {
    if (V.mem === 'history') return faultHistory(cv, S, V, A, t);
    // by unit
    const lw = 420;
    UI.card(cv, X0, TOP, lw, 392, 'By unit', { info: info('byUnit') });
    const rows = M.byUnit(S.units).slice(0, 6);
    rows.forEach((r, i) => {
        const yy = TOP + 50 + i * 52, sel = V.unit === r.addr;
        if (sel) cv.roundRect(X0 + 8, yy - 4, lw - 16, 48, 14, [255, 128, 40, 34]);
        cv.text(fit(cv, r.name, 19, 230), X0 + 20, yy + 26, 19, C.text, { literal: true });
        cv.text(r.text, X0 + lw - 20, yy + 26, 16, col(r.color), { font: 'bold', align: 'right', literal: true });
        if (i < rows.length - 1) rule(cv, X0 + 20, yy + 46, lw - 40);
        if (cv.target) cv.target(X0 + 8, yy - 4, lw - 16, 48, () => A.unit(r.addr), 'unit|' + r.addr, 14);
    });
    if (!rows.length) cv.text(S.units ? 'No unit answered' : 'Scanning when the page opens', X0 + 20, TOP + 80, 17, C.dim, { literal: true });
    // the list
    const rx = X0 + lw + 14, rw = X1 - rx;
    UI.card(cv, rx, TOP, rw, 392, '', { info: info(V.mem === 'ready' ? 'readiness' : 'memories') });
    if (V.detail) return faultDetail(cv, S, V, A, t, rx, rw);
    memTabs(cv, rx + 20, TOP + 34, S, V, A);
    if (V.mem === 'ready') return readinessView(cv, S, V, A, t, rx, rw);
    let bx = X1 - 56;              // clear of the card's (i)
    const clearW = UI.dialogButton(cv, bx, TOP + 10, 'Clear faults...', 'bad');
    if (cv.target) cv.target(bx - clearW, TOP + 10, clearW, 48, A.askClear, 'clear', 24);
    bx -= clearW + 12;
    const saveW = UI.dialogButton(cv, bx, TOP + 10, 'Save report', null);
    if (cv.target) cv.target(bx - saveW, TOP + 10, saveW, 48, A.save, 'save', 24);
    let list = M.listOf(S.units, V.mem);
    if (V.unit != null) list = list.filter((d) => d.addr === V.unit);
    const per = 2, first = Math.min(V.first || 0, Math.max(0, list.length - per));
    const off = UI.glide('faultlist', first * 138, null, 14);
    list.forEach((d, i) => {
        const yy = TOP + 80 + i * 138 - off;
        if (yy < TOP + 70 || yy > TOP + 80 + 138 + 2) return;
        faultRow(cv, S, d, rx + 20, yy, rw - 40, 124, A);
    });
    if (!list.length) cv.text(S.units ? (V.mem === 'fault' ? 'No faults stored' : V.mem === 'info' ? 'Nothing in the info memory' : 'No permanent emission faults')
        + (V.unit != null ? ' in ' + M.unitName(V.unit) : '') : 'Reading the fault memories...', rx + 20, TOP + 120, 19, C.dim, { literal: true });
    if (list.length > per) {
        const ax = rx + rw - 40;
        cv.text((first + 1) + '-' + Math.min(list.length, first + per) + ' of ' + list.length, ax - 30, TOP + 376, 14, C.dim, { align: 'right', literal: true });
        chev(cv, ax, TOP + 360, 14, 'up', first > 0 ? C.accent : '#464a52');
        chev(cv, ax + 1, TOP + 382, 14, 'down', first + per < list.length ? C.accent : '#464a52');
        if (cv.target) { cv.target(ax - 20, TOP + 344, 40, 26, () => A.scroll(-1), 'up', 12); cv.target(ax - 20, TOP + 370, 40, 26, () => A.scroll(1), 'down', 12); }
    }
    cv.text(S.faultMsg || 'Fault memory: real faults. Info memory: notes the units keep, not faults. Permanent: emission faults only the car can clear.',
        rx + 20, TOP + 380, 14, S.faultMsgColor ? col(S.faultMsgColor) : C.dim, { literal: true });
}

/** One fault in the list: code, words, unit and how often, its state as a pill, and the way into its details. */
function faultRow(cv, S, d, x, y, w, h, A) {
    const state = d.mem === 'info' ? 'info' : d.mem === 'perm' ? 'perm' : M.faultState(d.status);
    const c = state === 'active' ? 'bad' : state === 'info' ? 'info' : 'warm';
    cv.roundRect(x, y, w, h, 18, [255, 255, 255, 8]);
    cv.strokeRoundRect(x, y, w, h, 18, 1.5, state === 'info' ? [80, 170, 255, 70] : state === 'active' ? [255, 75, 60, 90] : [255, 186, 70, 70]);
    cv.text(d.code, x + 20, y + 30, 16, C.dim, { font: 'bold', spacing: 1, literal: true });
    cv.text(fit(cv, T.faultText(d.code, M.unitName(d.addr)), 22, w - 200, 'bold'), x + 20, y + 63, 22, C.text, { font: 'bold', literal: true });
    const seen = S.seen && S.seen[d.code];
    const how = state === 'info' ? 'kept by the unit for its makers, not a fault' : seen
        ? 'seen ' + (seen.count === 1 ? 'once' : seen.count + ' times') + ', ' + (seen.lastDays != null ? (seen.lastDays === 0 ? 'today' : seen.lastDays + ' days ago') : '') + (seen.km != null ? ', ' + M.fmtThousands(seen.km) + ' km' : '')
        : M.statusWords(d.status).slice(0, 2).join(', ').toLowerCase();
    cv.text(M.unitName(d.addr) + '   .   ' + how, x + 20, y + 93, 16, C.dim, { literal: true });
    pillRight(cv, x + w - 20, y + 14, { active: 'ACTIVE', stored: 'STORED', pending: 'PENDING', history: 'HISTORY', info: 'INFO', perm: 'PERMANENT' }[state], c, false);
    cv.text('details, freeze frame  >', x + w - 20, y + h - 14, 15, C.orange, { align: 'right', literal: true });
    if (cv.target) cv.target(x, y, w, h, () => A.detail(d), 'fault|' + d.addr + '|' + d.code + '|' + d.mem, 18);
}

/** A fault opened: what it means, its status bits, the freeze frame the unit kept and its events. */
function faultDetail(cv, S, V, A, t, rx, rw) {
    const d = V.detail, x = rx + 20;
    const bw = Math.ceil(cv.textWidth('Back to the list', 18, { font: 'bold' })) + 76;
    cv.roundRect(x, TOP + 14, bw, 48, 24, '#2a2d34');
    cv.strokeRoundRect(x, TOP + 14, bw, 48, 24, 1.5, C.glassLine);
    chev(cv, x + 26, TOP + 38, 16, 'left', C.accent);
    cv.text('Back to the list', x + 46, TOP + 45, 18, C.text, { font: 'bold', literal: true });
    if (cv.target) cv.target(x, TOP + 14, bw, 48, A.back, 'detailback', 24);
    cv.text(d.code + '   ' + M.unitName(d.addr), x, TOP + 92, 16, C.dim, { font: 'bold', spacing: 1, literal: true });
    cv.text(fit(cv, T.faultText(d.code, M.unitName(d.addr)), 24, rw - 60, 'bold'), x, TOP + 124, 24, C.text, { font: 'bold', literal: true });
    // status
    cv.text('STATUS', x, TOP + 166, 14, C.dim, { font: 'bold', spacing: 1, literal: true });
    M.statusWords(d.status).slice(0, 4).forEach((s, i) => { cv.circle(x + 6, TOP + 190 + i * 28, 5, i ? C.dim : C.amber); cv.text(s, x + 20, TOP + 196 + i * 28, 17, C.text, { literal: true }); });
    // freeze frame
    const fx = x + 360;
    cv.text('FREEZE FRAME (WHEN IT WAS STORED)', fx, TOP + 166, 14, C.dim, { font: 'bold', spacing: 1, literal: true });
    const snap = (S.snapshots || {})[d.code] || (V.context && V.context.rows ? V.context : null);
    if (V.context && V.context.reading) cv.text('Reading from ' + M.unitName(d.addr) + '...', fx, TOP + 196, 17, C.dim, { literal: true });
    else if (snap && snap.rows && snap.rows.length) {
        snap.rows.slice(0, 8).forEach((r, i) => {
            const cx = fx + (i % 2) * 300, cy = TOP + 196 + Math.floor(i / 2) * 30;
            cv.text(r[0], cx, cy, 16, C.dim, { literal: true });
            cv.text(r[1], cx + 270, cy, 17, C.text, { font: 'bold', align: 'right', literal: true });
        });
    } else cv.text(d.mem === 'perm' ? 'Permanent faults carry no freeze frame here.' : 'The unit kept no freeze frame for it.', fx, TOP + 196, 17, C.dim, { literal: true });
    // events
    const f = S.log && S.log.faults && S.log.faults[M.fkey(d.addr, d)];
    const evs = f ? f.events.slice(-3) : [];
    cv.text(evs.length ? evs.map((e) => M.EVENT_WORDS[e.kind] + ' ' + M.dayMonth(e.t) + (e.km != null ? ' (' + M.fmtThousands(e.km) + ' km)' : '')).join('   .   ') : 'First seen at this scan',
        x, TOP + 372, 15, C.dim, { literal: true });
}

/** Faults, History tab: one row per fault with bars between its events over 8 weeks, the selected fault's timeline. */
function faultHistory(cv, S, V, A, t) {
    const lw = 1100, now = S.at;
    UI.card(cv, X0, TOP, lw, 392, '', { info: info('timeline') });
    memTabs(cv, X0 + 20, TOP + 34, S, V, A);
    const rows = M.historyRows(S.log, 4);
    const px = X0 + 300, pw = lw - 330, span = 8 * M.WEEK;
    const xAt = (tt) => px + pw * Math.max(0, Math.min(1, 1 - (now - tt) / span));
    for (let w = 0; w <= 8; w++) {
        const gx = px + pw * w / 8;
        cv.fillRect(Math.round(gx), TOP + 74, 1, 280, '#24272e');
        cv.text(w === 8 ? 'now' : w === 0 ? '-8 w' : w === 7 ? '-1 w' : String(w - 8), gx, TOP + 370, 13, C.dim, { align: 'center', literal: true });
    }
    const KC = { first: C.red, again: C.amber, gone: C.green, cleared: C.blue };
    const sel = Math.min(V.histSel || 0, Math.max(0, rows.length - 1));
    rows.forEach((f, i) => {
        const yy = TOP + 76 + i * 64;
        if (i === sel) cv.roundRect(X0 + 12, yy - 4, lw - 24, 54, 14, [255, 128, 40, 30]);
        cv.text(f.code, X0 + 28, yy + 18, 15, C.dim, { font: 'bold', spacing: 1, literal: true });
        cv.text(fit(cv, T.faultShort(f.code), 17, 230), X0 + 28, yy + 40, 17, C.text, { literal: true });
        const by = yy + 24;
        // bars: amber while it is there, green from gone or cleared to the next event (or to now, when it is still gone)
        f.events.forEach((e, k) => {
            const nx = k + 1 < f.events.length ? f.events[k + 1].t : now;
            const there = e.kind === 'first' || e.kind === 'again';
            if (there || k + 1 < f.events.length) {
                const x1 = xAt(e.t), x2 = xAt(nx);
                if (x2 - x1 > 2) cv.roundRect(x1, by - 7, x2 - x1, 14, 7, there ? C.amber : C.green);
            }
        });
        f.events.forEach((e, k) => {
            const ex = xAt(e.t), mid = k > 0 && e.kind === 'again';
            cv.circle(ex, by, 8, '#141414');
            cv.circle(ex, by, 6, mid ? C.amber : KC[e.kind]);
            if (mid) cv.circle(ex, by, 3, '#141414');
        });
        if (cv.target) cv.target(X0 + 12, yy - 4, lw - 24, 54, () => A.histSel(i), 'hist|' + i, 14);
    });
    if (!rows.length) cv.text('No fault history yet: every scan from now on is kept.', X0 + 28, TOP + 120, 18, C.dim, { literal: true });
    [['first seen', C.red], ['seen again', C.amber], ['gone by itself', C.green], ['cleared', C.blue]].forEach((l, i) => {
        cv.circle(px + 8 + i * 190, TOP + 386, 6, l[1]);
        cv.text(l[0], px + 20 + i * 190, TOP + 391, 14, C.dim, { literal: true });
    });
    // the selected one's timeline
    const rx = X0 + lw + 14, rw = X1 - rx, f = rows[sel];
    UI.card(cv, rx, TOP, rw, 392, f ? f.code + ' timeline' : 'Timeline', { info: info('timeline') });
    if (f) {
        const evs = f.events.slice(-4);
        evs.forEach((e, i) => {
            const yy = TOP + 62 + i * 70, c = KC[e.kind];
            cv.circle(rx + 26, yy + 8, 6, c);
            if (i < evs.length - 1 || f.present) cv.line(rx + 26, yy + 22, rx + 26, yy + 60, 2, '#3c4048');
            cv.text(M.dayMonth(e.t) + (e.km != null ? ', ' + M.fmtThousands(e.km) + ' km' : ''), rx + 48, yy + 13, 15, C.dim, { literal: true });
            const nth = f.events.slice(0, f.events.indexOf(e) + 1).filter((q) => q.kind === 'first' || q.kind === 'again').length;
            cv.text(M.EVENT_WORDS[e.kind] + (e.kind === 'again' && nth > 2 ? ', ' + nth + (nth === 3 ? 'rd' : 'th') + ' time' : ''), rx + 48, yy + 40, 19, C.text, { literal: true });
        });
        cv.text('Every scan is kept, so a fault that comes', rx + 20, TOP + 362, 14, C.dim, { literal: true });
        cv.text('and goes still shows when and how often.', rx + 20, TOP + 382, 14, C.dim, { literal: true });
    }
}

/** Faults, Readiness tab (I22): the engine light and each emission monitor the car has, ready or not, read only. */
function readinessView(cv, S, V, A, t, rx, rw) {
    const r = S.ready;
    if (!r) { cv.text('Reading the readiness from the engine unit...', rx + 20, TOP + 120, 19, C.dim, { literal: true }); return; }
    // left: the summary and the engine light
    const sx = rx + 20, sw = 300;
    cv.text('READY SINCE THE LAST CLEAR', sx, TOP + 96, 14, C.dim, { font: 'bold', spacing: 1, literal: true });
    const big = cv.text(String(r.ready), sx, TOP + 152, 52, C.text, { font: 'num', literal: true });
    cv.text('of ' + r.total, sx + big + 12, TOP + 150, 20, C.dim, { literal: true });
    cv.text(r.word, sx, TOP + 186, 20, col(r.color), { font: 'bold', spacing: 1, literal: true });
    UI.bar(cv, sx, TOP + 200, sw - 40, 10, r.total ? r.ready / r.total : 0, r.color, 'ready|bar');
    // the engine light: an engine glyph, lit amber when on
    const ly = TOP + 252, lc = r.mil ? C.amber : '#4a4e56';
    cv.strokeRoundRect(sx, ly - 18, 46, 30, 8, 3, lc);
    cv.line(sx + 46, ly - 3, sx + 54, ly - 3, 3, lc);
    cv.line(sx + 12, ly - 18, sx + 12, ly - 26, 3, lc);
    cv.line(sx + 6, ly - 26, sx + 22, ly - 26, 3, lc);
    cv.text('Engine light ' + (r.mil ? 'ON' : 'off'), sx + 70, ly + 4, 19, r.mil ? C.amber : C.text, { font: 'bold', literal: true });
    cv.text(r.dtcCount ? r.dtcCount + (r.dtcCount === 1 ? ' emission fault' : ' emission faults') + ' stored' : 'no emission fault stored', sx + 70, ly + 30, 15, C.dim, { literal: true });
    UI.wrap(cv, r.text, 15, sw - 20).slice(0, 3).forEach((ln, i) => cv.text(ln, sx, TOP + 312 + i * 21, 15, C.dim, { literal: true }));
    // right: the monitors in two columns
    const mx = rx + sw + 20, mw = rx + rw - 56 - mx, colW = Math.floor((mw - 20) / 2);
    const rows = r.rows, per = Math.ceil(rows.length / 2), rh = Math.min(56, Math.floor(270 / Math.max(1, per)));
    cv.text('MONITOR', mx, TOP + 96, 14, C.dim, { font: 'bold', spacing: 1, literal: true });
    if (r.drive) cv.text('THIS DRIVE', mx + colW + 20, TOP + 96, 14, C.dim, { font: 'bold', spacing: 1, literal: true });
    rows.forEach((m, i) => {
        const cx = mx + (i < per ? 0 : colW + 20), yy = TOP + 110 + (i % per) * rh;
        const c = m.complete ? 'ok' : 'warm';
        cv.roundRect(cx, yy, colW, rh - 8, 14, [255, 255, 255, 8]);
        cv.circle(cx + 20, yy + (rh - 8) / 2, 7, col(c));
        cv.text(fit(cv, m.name, 18, colW - 190), cx + 38, yy + (r.drive ? 22 : (rh - 8) / 2 + 7), 18, C.text, { font: 'bold', literal: true });
        if (r.drive) cv.text(m.continuous ? 'checked all the time' : { done: 'done this drive', running: 'running this drive', off: 'not run this drive' }[m.drive],
            cx + 38, yy + 42, 14, m.drive === 'done' ? C.green : C.dim, { literal: true });
        pillRight(cv, cx + colW - 12, yy + (rh - 8) / 2 - 16, m.complete ? 'READY' : 'NOT READY', c, false);
    });
    cv.text('Read only, from the engine unit (OBD, SAE J1979). A clear of the engine unit sets these back to not ready.', rx + 20, TOP + 380, 14, C.dim, { literal: true });
}

/**
 * The Clear faults dialog (D19, I22): every unit with a fault in its fault memory with a tick, the engine unit unticked
 * until the user ticks it, and the readiness warning only while it is ticked.
 * units: [{ addr, dtcs }] with faults; ticked: addresses; h: { tick(addr), all(), cancel(), run() }.
 */
function clearDialog(units, ticked, h) {
    const n = units.filter((u) => ticked.indexOf(u.addr) >= 0)
        .reduce((a, u) => a + u.dtcs.filter((d) => d.mem === 'fault').length, 0);
    const k = ticked.length, warning = M.clearWarning(ticked);
    const d = { label: 'Clear fault memory', labelColor: 'bad', w: 1240, h: 480, ticked: ticked, warning: warning,
        title: k ? 'Clear ' + n + (n === 1 ? ' fault' : ' faults') + ' in ' + k + (k === 1 ? ' unit?' : ' units?') : 'Tick the units to clear',
        buttons: [{ label: 'Cancel', run: h.cancel }, k ? { label: 'Yes, clear', kind: 'bad', run: h.run } : { label: 'Yes, clear', kind: null, run: null }] };
    d.body = (cv, x, y, w, hh) => {
        // left: the units
        const lw = 470;
        cv.text('UNITS WITH FAULTS', x, y + 14, 14, C.dim, { font: 'bold', spacing: 1, literal: true });
        const aw = Math.ceil(cv.textWidth('All but the engine', 15, { font: 'bold' })) + 30;
        cv.strokeRoundRect(x + lw - aw, y - 6, aw, 30, 15, 1.5, C.accent);
        cv.text('All but the engine', x + lw - aw / 2, y + 14, 15, C.accent, { font: 'bold', align: 'center', literal: true });
        if (cv.target) cv.target(x + lw - aw, y - 6, aw, 30, h.all, 'clearall', 15);
        units.slice(0, 5).forEach((u, i) => {
            const yy = y + 34 + i * 46, on = ticked.indexOf(u.addr) >= 0, eng = M.isEngine(u.addr);
            cv.roundRect(x, yy, lw, 40, 14, on ? [255, 128, 40, 30] : '#22252b');
            checkBox(cv, x + 10, yy + 7, on);
            const nf = u.dtcs.filter((q) => q.mem === 'fault').length;
            cv.text(M.unitName(u.addr), x + 48, yy + 27, 18, on ? C.text : C.dim, { font: on ? 'bold' : 'label', literal: true });
            cv.text(eng && !on ? 'needs its own tick' : nf + (nf === 1 ? ' fault' : ' faults'), x + lw - 14, yy + 26, 15, eng ? C.amber : C.dim, { align: 'right', literal: true });
            if (cv.target) cv.target(x, yy, lw, 40, () => h.tick(u.addr), 'tick|' + u.addr, 14);
        });
        cv.text('Only with the engine off and the ignition on. Never while driving.', x, y + hh - 4, 15, C.amber, { literal: true });
        // right: what happens, and the engine warning while the engine unit is ticked
        const rx = x + lw + 36, rw = w - lw - 36;
        UI.wrap(cv, 'Health saves the full report first (Share keeps it). Only the fault memory of the ticked units is cleared; a fault that is still there comes back at once.', 16, rw)
            .slice(0, 3).forEach((ln, i) => cv.text(ln, rx, y + 14 + i * 24, 16, '#c8ced6', { literal: true }));
        const by = y + 92, bh = hh - 92;
        if (warning) {
            cv.roundRect(rx, by, rw, bh, 16, [255, 186, 70, 22]);
            cv.strokeRoundRect(rx, by, rw, bh, 16, 1.5, [255, 186, 70, 120]);
            cv.text('ENGINE UNIT TICKED: READINESS GOES BACK TO NOT READY', rx + 18, by + 28, 14, C.amber, { font: 'bold', spacing: 1, literal: true });
            UI.wrap(cv, warning, 15, rw - 36).slice(0, 7).forEach((ln, i) => cv.text(ln, rx + 18, by + 54 + i * 21, 15, C.text, { literal: true }));
        } else if (units.some((u) => M.isEngine(u.addr))) {
            UI.wrap(cv, 'The engine unit is not ticked: its faults, freeze frames and the emission readiness stay as they are.', 15, rw)
                .forEach((ln, i) => cv.text(ln, rx, by + 24 + i * 21, 15, C.dim, { literal: true }));
        }
    };
    return d;
}

/** The words after a clear: what came back, what was refused, and (engine unit cleared) that the readiness was reset. */
function clearedText(back, failed, engine) {
    let t = back.length ? 'Back at once: ' + back.map(M.unitName).join(', ') + '. ' + (back.length === 1 ? 'Its' : 'Their') + ' cause is still there: have it looked at.' : 'Nothing came back.';
    if (failed && failed.length) t += '\n\nNot cleared: ' + failed.map((f) => M.unitName(f.addr) + ' (' + f.why + ')').join(', ') + '.';
    if (engine) t += '\n\nThe engine unit was cleared, so its emission readiness is reset: the monitors show not ready until a drive cycle has run them again. Faults, Readiness shows each one, and History notes when they are ready again.';
    return t;
}

/* ---------- Battery ---------- */

function battery(cv, S, V, A, t) {
    const b = S.battery || {}, warn = (S.values && S.values.batteryWarn) || 12.4, cp = S.caps;
    const volts = M.has(cp, 'volts'), soc = M.has(cp, 'soc');
    const nights = (b.nights || []).map((p) => p[1]), starts = (b.starts || []).map((p) => p[1]);
    const bv = M.batteryVerdict(b.rest, warn), sv = M.startVerdict(b.startMin);
    // the cards this car has, side by side over the width
    const cards = [];
    if (volts) cards.push((x, w) => UI.stat(cv, x, TOP, w, ch, { label: 'Resting voltage', value: b.rest, decimals: 2, unit: 'V', sub: b.rest != null ? 'after the night, ' + bv.word.toLowerCase() : 'open Health before starting',
        color: bv.color, history: nights, minSpan: 2, spanLabel: '-14 d', nowLabel: 'today', info: info('rest') }));
    if (volts && b.startMin != null) cards.push((x, w) => UI.stat(cv, x, TOP, w, ch, { label: 'Lowest at start', value: b.startMin, decimals: 1, unit: 'V', sub: sv.text, color: sv.color,
        history: starts, minSpan: 2, spanLabel: '-14 d', nowLabel: 'today', info: info('start') }));
    if (soc) cards.push((x, w) => UI.stat(cv, x, TOP, w, ch, { label: 'Charge (car)', value: b.soc, decimals: 0, unit: '%', sub: 'what the car reports', color: b.soc == null ? 'dim' : b.soc >= 70 ? 'ok' : 'warm',
        history: b.socHist, minSpan: 4, spanLabel: '-12 h', nowLabel: 'now', info: info('charge') }));
    if (volts) cards.push((x, w) => {
        UI.card(cv, x, TOP, w, ch, 'Verdict', { info: info('verdict') });
        cv.text(bv.word, x + 20, TOP + 84, 36, col(bv.color), { font: 'bold', literal: true });
        UI.wrap(cv, bv.text, 16, w - 40).slice(0, 3).forEach((ln, i) => cv.text(ln, x + 20, TOP + 116 + i * 24, 16, C.dim, { literal: true }));
    });
    const gap = 14, cw = Math.floor((X1 - X0 - gap * (cards.length - 1)) / Math.max(1, cards.length));
    const ch = volts ? 180 : 392;
    cards.forEach((f, i) => f(X0 + i * (cw + gap), i === cards.length - 1 ? X1 - X0 - i * (cw + gap) : cw));
    if (!volts) return;
    const n = Math.max(2, nights.length);
    UI.chart(cv, X0, TOP + ch + 14, X1 - X0, 392 - ch - 14, [
        { name: 'resting voltage', color: 'ok', values: nights.length ? nights : [null, null] },
        { name: warn.toFixed(1) + ' V: charge it', color: 'warm', values: new Array(n).fill(warn) },
    ], { label: 'Resting voltage, last 14 nights', info: info('nights'), min: 12.0, max: 12.8, yTicks: 4, yUnit: 'V', legend: 'right', fill: false,
        xLabels: ['-14 d', '-12', '-10', '-8', '-6', '-4', '-2', 'today'] });
}

/* ---------- Service ---------- */

function service(cv, S, V, A, t) {
    // the columns this car has: the car's list (CBS), our intervals, the parts (always)
    const carCol = M.has(S.caps, 'cbs'), oursCol = (S.ours || []).length > 0, gap = 14;
    const w1 = carCol ? (oursCol ? 620 : 900) : 0, w2 = oursCol ? (carCol ? 450 : 760) : 0;
    const w3 = X1 - X0 - w1 - w2 - gap * ((carCol ? 1 : 0) + (oursCol ? 1 : 0));
    if (carCol) serviceCar(cv, S, A, X0, w1);
    if (oursCol) serviceOurs(cv, S, A, X0 + (carCol ? w1 + gap : 0), w2);
    serviceParts(cv, S, A, X1 - w3, w3);
}
function serviceCar(cv, S, A, X0, w1) {
    // the car's
    UI.card(cv, X0, TOP, w1, 392, 'The car recommends', { info: info('cbs') });
    const items = (S.service || []).slice(0, 5);
    items.forEach((it, i) => {
        const yy = TOP + 50 + i * 58;
        cv.text(it.name, X0 + 20, yy + 26, 19, C.text, { font: 'bold', literal: true });
        cv.text(it.left, X0 + w1 - 20, yy + 24, 17, C.text, { align: 'right', literal: true });
        UI.bar(cv, X0 + 20, yy + 38, w1 - 40, 10, it.frac == null ? 0 : it.frac, it.color, 'cbs|' + it.id);
        if (cv.target && it.resettable) cv.target(X0 + 8, yy, w1 - 16, 54, () => A.askReset(it), 'cbs|' + it.id, 14);
    });
    if (!items.length) cv.text('Waiting for the car\'s service list', X0 + 20, TOP + 80, 17, C.dim, { literal: true });
    const canReset = (S.service || []).some((it) => it.resettable);
    cv.text(S.serviceMsg || (canReset ? 'From the car (CBS). Tap an item to reset it after the work.' : 'From the car (CBS).'), X0 + 20, TOP + 374, 14, S.serviceMsgColor ? col(S.serviceMsgColor) : C.dim, { literal: true });
}
function serviceOurs(cv, S, A, ox, w2) {
    UI.card(cv, ox, TOP, w2, 392, 'Our intervals', { info: info('ours') });
    (S.ours || []).forEach((o, i) => {
        const yy = TOP + 50 + i * 58;
        cv.text(o.name, ox + 20, yy + 24, 19, C.text, { font: 'bold', literal: true });
        cv.text(o.everyText, ox + 20, yy + 44, 13, C.dim, { literal: true });
        cv.text(o.leftText, ox + w2 - 20, yy + 22, 17, o.color === 'bad' ? C.red : C.text, { align: 'right', literal: true });
        UI.bar(cv, ox + 200, yy + 34, w2 - 220, 10, o.frac == null ? 0 : o.frac, o.color, 'ours|' + o.key);
        if (cv.target) cv.target(ox + 8, yy, w2 - 16, 54, () => A.askDone(o), 'ours|' + o.key, 14);
    });
    cv.text('Ours: stricter, for harder driving. Change any in Settings.', ox + 20, TOP + 374, 14, C.dim, { literal: true });
}
function serviceParts(cv, S, A, px, w3) {
    UI.card(cv, px, TOP, w3, 392, 'Next service: parts', { info: info('parts') });
    const parts = (S.parts || []).map((p) => [p, true]).concat((S.partsOff || []).map((p) => [p, false])).slice(0, 5);
    parts.forEach((p, i) => {
        const yy = TOP + 50 + i * 52;
        checkBox(cv, px + 20, yy + 6, p[1]);
        cv.text(p[0], px + 58, yy + 27, 19, p[1] ? C.text : C.dim, { font: p[1] ? 'bold' : 'label', literal: true });
        if (cv.target) cv.target(px + 8, yy, w3 - 16, 44, () => A.togglePart(p[0]), 'part|' + p[0], 12);
    });
    if (!parts.length) cv.text('Nothing planned yet', px + 20, TOP + 80, 17, C.dim, { literal: true });
    const ay = TOP + 330, aw = w3 - 40;
    cv.strokeRoundRect(px + 20, ay, aw, 44, 22, 2, C.accent);
    cv.text('+ Add a part', px + 20 + aw / 2, ay + 29, 18, C.accent, { font: 'bold', align: 'center' });
    if (cv.target) cv.target(px + 20, ay, aw, 44, A.addPart, 'addpart', 22);
}

/** The body of the Add a part dialog: three columns of parts to pick. */
function addPartBody(S, V, A) {
    return (cv, x, y, w, h) => {
        const PARTS = M.partsFor(S.engine), groups = Object.keys(PARTS), cw = Math.floor((w - 40) / 3);
        groups.forEach((g, gi) => {
            const gx = x + gi * (cw + 20);
            cv.text(g.toUpperCase(), gx, y + 12, 14, C.dim, { font: 'bold', spacing: 1, literal: true });
            PARTS[g].forEach((p, i) => {
                const yy = y + 24 + i * 36, on = (V.dialog.pick || []).indexOf(p) >= 0, had = (S.parts || []).indexOf(p) >= 0;
                cv.roundRect(gx, yy, cw - 40, 30, 15, on ? [255, 128, 40, 70] : '#2a2d34');
                if (on) cv.strokeRoundRect(gx, yy, cw - 40, 30, 15, 1.5, C.orange);
                cv.text(p + (had ? '  (on the list)' : ''), gx + 16, yy + 21, 16, on ? C.text : had ? C.dim : '#b4bac4', { font: on ? 'bold' : 'label', literal: true });
                if (cv.target && !had) cv.target(gx, yy, cw - 40, 30, () => A.pick(p), 'pick|' + p, 16);
            });
        });
        cv.text('Picked parts show on the Service page and in the report you share with your mechanic.', x, y + h + 34, 14, C.dim, { literal: true });
    };
}

/* ---------- Tyres ---------- */

function tyres(cv, S, V, A, t) {
    const lw = 700, pr = S.pressures || {}, ty = S.tyres || {};
    UI.card(cv, X0, TOP, lw, 392, 'Pressure now' + (S.coldNow ? ' (cold)' : ''), { info: info('pressure') });
    const cx = X0 + lw / 2, cy = TOP + 214;
    cv.strokeRoundRect(cx - 78, cy - 148, 156, 296, 70, 3, '#3c4048');
    [['FL', -1, -1], ['FR', 1, -1], ['RL', -1, 1], ['RR', 1, 1]].forEach((q) => {
        const w = q[0], v = pr[w], tx = cx + q[1] * 110, ty0 = cy + q[2] * 96;
        const c = v == null ? 'dim' : ty.leak === w || ty.low === w ? 'warm' : 'ok';
        const v2 = v == null ? null : UI.glide('tyre|' + w, v, null, 10);
        cv.roundRect(tx - 14, ty0 - 36, 28, 72, 14, col(c));
        const ax = q[1] < 0 ? tx - 30 : tx + 30, al = q[1] < 0 ? 'right' : 'left';
        cv.text(v2 == null ? '--' : v2.toFixed(2) + ' bar', ax, ty0 - 2, 26, C.text, { font: 'bold', align: al, literal: true });
        cv.text(w, ax, ty0 + 28, 16, C.dim, { align: al, literal: true });
    });
    // the trend of the wheel that matters (the leaking or low one, else rear left), with the others' mean
    const rx = X0 + lw + 14, rw = X1 - rx, w = ty.leak || ty.low || 'RL';
    const cold = S.cold || {}, mine = (cold[w] || []).map((p) => p[1]);
    const others = (cold.FL || []).map((p, i) => {
        const o = M.WHEELS.filter((q) => q !== w).map((q) => cold[q] && cold[q][i] ? cold[q][i][1] : null).filter((x) => x != null);
        return o.length ? o.reduce((a, b) => a + b, 0) / o.length : null;
    });
    UI.chart(cv, rx, TOP, rw, 268, [
        { name: M.WHEEL_NAMES[w].toLowerCase(), color: ty.leak === w || ty.low === w ? 'warm' : 'ok', values: mine.length ? mine : [null, null] },
        { name: 'the other three', color: '#8c94a0', values: others.length ? others : [null, null] },
    ], { label: M.WHEEL_NAMES[w] + ', last 4 weeks', info: info('trend'), yTicks: 3, yUnit: 'bar', xLabels: ['-4 w', '-3 w', '-2 w', '-1 w', 'now'], fill: false, legend: 'right' });
    UI.card(cv, rx, TOP + 282, rw, 110, 'What it means', { info: info('tyres') });
    cv.text(ty.text || 'Waiting for the tyre pressure sensors', rx + 20, TOP + 348, 19, col(ty.color === 'ok' ? 'ok' : ty.color || 'dim'), { font: 'bold', literal: true });
    cv.text(ty.hint || '', rx + 20, TOP + 376, 16, C.dim, { literal: true });
}

/* ---------- Fluids ---------- */

function fluids(cv, S, V, A, t) {
    let lw = 760;
    const fl = S.fluids || {};
    const fluid = (S.service || []).filter((s) => s.id === 0x03)[0];
    const cp = S.caps;
    const rows = [
        M.has(cp, 'oilLevel') && ['Engine oil level', fl.oilCl == null ? null : Math.min(1, fl.oilCl / 100), fl.oilCl == null ? 'not read yet' : fl.oilCl < 20 ? 'low, top up now' : 'OK, ' + (fl.oilCl / 100).toFixed(2) + ' l above min', fl.oilCl == null ? 'dim' : fl.oilCl < 20 ? 'bad' : 'ok'],
        M.has(cp, 'cc') && ['Coolant level', fl.coolantLow == null ? null : 1, fl.coolantLow == null ? 'no word from the car' : fl.coolantLow ? 'low: the car warns' : 'OK, no warning', fl.coolantLow ? 'bad' : fl.coolantLow == null ? 'dim' : 'ok'],
        M.has(cp, 'cc') && ['Washer fluid', fl.washerLow == null ? null : fl.washerLow ? 0.15 : 1, fl.washerLow == null ? 'no word from the car' : fl.washerLow ? 'low, top up soon' : 'OK, no warning', fl.washerLow ? 'warm' : fl.washerLow == null ? 'dim' : 'ok'],
        fluid && ['Brake fluid', fluid ? fluid.frac : null, fluid ? 'due in ' + fluid.left.replace(' left', '') : 'from the service list', fluid ? fluid.color : 'dim'],
    ];
    const shownRows = rows.filter(Boolean);
    const warmCol = M.has(cp, 'oilTemp') || M.has(cp, 'coolantTemp');
    if (!shownRows.length) lw = X1 - X0;
    if (!warmCol) lw = X1 - X0;
    if (shownRows.length) UI.card(cv, X0, TOP, lw, 392, 'Levels', { info: info('levels') });
    shownRows.forEach((r, i) => {
        const yy = TOP + 52 + i * 76;
        cv.text(r[0], X0 + 20, yy + 26, 20, C.text, { font: 'bold', literal: true });
        cv.text(r[2], X0 + lw - 20, yy + 24, 17, col(r[3]), { align: 'right', literal: true });
        UI.bar(cv, X0 + 20, yy + 44, lw - 40, 12, r[1] == null ? 0 : r[1], r[3], 'lvl|' + i);
    });
    if (!warmCol) return;
    const wx = shownRows.length ? X0 + lw + 14 : X0;
    const wu = S.warm || {}, n = Math.max(2, (wu.oil || []).length), mins = wu.minutes || 10;
    const xl = []; for (let k = 0; k <= 5; k++) xl.push(k === 5 ? Math.round(mins) + ' min' : String(Math.round(mins * k / 5)));
    UI.chart(cv, wx, TOP, X1 - wx, 392, [
        M.has(cp, 'oilTemp') && { name: 'oil', color: 'ok', values: wu.oil && wu.oil.length > 1 ? wu.oil : new Array(n).fill(null) },
        M.has(cp, 'coolantTemp') && { name: 'coolant', color: 'info', values: wu.coolant && wu.coolant.length > 1 ? wu.coolant : new Array(n).fill(null) },
    ].filter(Boolean), { label: 'Warm-up, ' + (wu.when || 'today'), info: info('warmup'), min: 0, max: 120, yTicks: 6, yUnit: '°C', xLabels: xl, fill: false });
}

/* ---------- Engine (per cylinder) ---------- */

/** The per-cylinder views this car has, in order: misfires, rough running, ignition angle (petrol only). */
const CYL_VIEWS = [['misfire', 'Misfires'], ['rough', 'Rough running'], ['ignition', 'Ignition']];
const CYL_FMT = {
    misfire: { label: 'Misfires per cylinder', lo: 0, hi: 40, unit: 'counted', decimals: 0, info: 'misfire' },
    rough: { label: 'Rough running per cylinder', lo: -6, hi: 6, mid: 0, unit: 'rad/s²', decimals: 1, info: 'rough' },
    ignition: { label: 'Ignition angle per cylinder', lo: -10, hi: 40, mid: 0, unit: '°', decimals: 1, info: 'ignition' },
};
function engine(cv, S, V, A, t) {
    const cp = S.caps, p = S.engine || E.profile({}), ev = S.eng || {}, cyl = ev.cyl || {};
    const views = CYL_VIEWS.filter((k) => M.has(cp, k[0]) && (k[0] !== 'ignition' || p.ignition));
    const right = [];
    if (M.has(cp, 'knock') && p.knock) right.push({ label: 'Knock control', value: ev.knock, decimals: 1, unit: '°', sub: ev.knock == null ? 'not read yet' : Math.abs(ev.knock) < 0.5 ? 'no timing pulled back' : 'timing pulled back on average', color: ev.knock == null ? 'dim' : Math.abs(ev.knock) < 2 ? 'ok' : 'warm', info: 'knock' });
    if (M.has(cp, 'vanos')) right.push({ label: 'Camshafts (VANOS)', value: ev.vanosIn, decimals: 1, unit: '°', sub: ev.vanosEx == null ? 'intake' : 'intake, exhaust ' + ev.vanosEx.toFixed(1) + ' °', color: 'ok', info: 'vanos' });
    if (M.has(cp, 'lambda')) right.push({ label: 'Lambda', value: ev.lambda, decimals: 3, unit: '', sub: ev.lambda == null ? 'not read yet' : p.diesel ? 'lean, as a diesel runs' : Math.abs(ev.lambda - 1) < 0.03 ? 'right at 1: clean burn' : ev.lambda < 1 ? 'rich: more fuel (full load, cooling)' : 'lean', color: 'ok', info: 'lambda' });
    const railOnly = M.has(cp, 'rail') && right.length === 0;
    if (M.has(cp, 'rail') && !railOnly) right.push({ label: 'Fuel rail pressure', value: ev.rail, decimals: 0, unit: 'bar', sub: 'normal ' + p.rail[0] + ' to ' + p.rail[1] + ' bar', color: 'ok', info: 'rail' });
    const hasRight = right.length || railOnly;
    const lw = views.length ? (hasRight ? 1000 : X1 - X0) : 0, rx = X0 + (lw ? lw + 14 : 0), rw = X1 - rx;
    if (views.length) {
        const pick = views.some((k) => k[0] === V.cyl) ? V.cyl : views[0][0], f = CYL_FMT[pick];
        UI.cylinders(cv, X0, TOP, lw, 392, { label: f.label, banks: E.cylinderBanks(p), values: cyl[pick] || {}, lo: f.lo, hi: f.hi, mid: f.mid,
            unit: f.unit, decimals: f.decimals, status: (v) => M.cylStatus(pick, v, cyl[pick]), info: info(f.info),
            sub: p.banks === 2 && pick === 'ignition' ? 'bank 2 from the second engine unit' : p.cylinders ? E.describe(p) : 'the cylinder count comes from the engine unit' });
        if (views.length > 1) {
            const opts = views.map((k) => [k[0], k[1]]);
            UI.segmented(cv, X0 + lw - 60, TOP + 26, opts, pick, (k) => A.cyl(k), 'cylview');
        }
    }
    if (railOnly) {
        UI.card(cv, rx, TOP, rw, 392, 'Fuel rail pressure', { info: info('rail') });
        UI.ring(cv, rx + rw / 2, TOP + 210, 110, { value: ev.rail, min: 0, max: p.rail[1], decimals: 0, unit: 'bar', color: 'ok',
            scale: { step: p.diesel ? 500 : 50 } });
        cv.text(p.diesel ? 'common rail: up to about ' + p.rail[1] + ' bar' : 'direct injection: up to about ' + p.rail[1] + ' bar', rx + rw / 2, TOP + 378, 15, C.dim, { align: 'center', literal: true });
        return;
    }
    if (!right.length) return;
    const rows = Math.ceil(right.length / (right.length > 2 ? 2 : 1)), cols = right.length > 2 ? 2 : 1, gap = 14;
    const cw = (rw - gap * (cols - 1)) / cols, ch = (392 - gap * (rows - 1)) / rows;
    right.forEach((c, i) => {
        const x = rx + (i % cols) * (cw + gap), y = TOP + Math.floor(i / cols) * (ch + gap);
        UI.stat(cv, x, y, cw, ch, { label: c.label, value: c.value, decimals: c.decimals, unit: c.unit, sub: c.sub, color: c.color, info: info(c.info) });
    });
}

/* ---------- History ---------- */

function history(cv, S, V, A, t) {
    const lw = 1000, wk = M.weekly(S.scores || [], S.at, 12);
    UI.chart(cv, X0, TOP, lw, 392, [{ name: '', color: 'ok', values: wk.some((v) => v != null) ? wk : [null, null] }],
        { label: 'Health score, last 12 weeks', info: info('hist'), min: 60, max: 100, yTicks: 4, yUnit: 'pts', xLabels: ['-12 w', '-9 w', '-6 w', '-3 w', 'now'] });
    const rx = X0 + lw + 14, rw = X1 - rx;
    UI.card(cv, rx, TOP, rw, 392, 'What changed', { info: info('changes') });
    const ch = (S.changes || []).slice(0, 4);
    ch.forEach((c, i) => {
        const yy = TOP + 62 + i * 74;
        cv.circle(rx + 26, yy + 8, 6, col(c.kind));
        if (i < ch.length - 1) cv.line(rx + 26, yy + 22, rx + 26, yy + 62, 2, '#3c4048');
        cv.text(M.ago(c.t, S.at), rx + 48, yy + 13, 15, C.dim, { literal: true });
        cv.text(fit(cv, c.text, 19, rw - 70), rx + 48, yy + 40, 19, C.text, { literal: true });
    });
    if (!ch.length) cv.text('Nothing yet: changes show here as they happen.', rx + 20, TOP + 80, 17, C.dim, { literal: true });
    const first = wk.filter((v) => v != null)[0], last = wk.filter((v) => v != null).pop();
    if (first != null && last != null) {
        const d = Math.round(last - first);
        const why = d < -1 ? 'Slowly down ' + -d + ' points in 12 weeks' + (S.downBecause ? ': ' + S.downBecause : '.') : d > 1 ? 'Up ' + d + ' points in 12 weeks.' : 'Steady over 12 weeks.';
        UI.wrap(cv, why, 15, rw - 40).slice(0, 2).forEach((ln, i, a) => cv.text(ln, rx + 20, TOP + 378 - (a.length - 1 - i) * 21, 15, C.dim, { literal: true }));
    }
}

/* ---------- Share ---------- */

let qrCache = { text: null, q: null };
function share(cv, S, V, A, t) {
    const lw = 560;
    UI.card(cv, X0, TOP, lw, 392, 'Scan with your phone', { info: info('qr') });
    const text = S.report || '';
    if (qrCache.text !== text) {
        let q = null;
        try { q = QR.encode(Buffer.from(text, 'utf8'), { ecl: 'L' }); } catch (e) { q = null; }
        qrCache = { text: text, q: q };
    }
    const q = qrCache.q, box = 320, bx = X0 + (lw - box) / 2, by = TOP + 52;
    cv.roundRect(bx, by, box, box, 18, '#f0f0f0');
    if (q) {
        const m = Math.floor((box - 36) / q.size), ox = bx + Math.floor((box - m * q.size) / 2), oy = by + Math.floor((box - m * q.size) / 2);
        // one rectangle per run of dark modules in a row: far fewer draw calls than one per module
        for (let yy = 0; yy < q.size; yy++) {
            let run = -1;
            for (let xx = 0; xx <= q.size; xx++) {
                const dark = xx < q.size && q.get(xx, yy);
                if (dark && run < 0) run = xx;
                if (!dark && run >= 0) { cv.fillRect(ox + run * m, oy + yy * m, (xx - run) * m, m, '#141414'); run = -1; }
            }
        }
    }
    const rx = X0 + lw + 14, rw = X1 - rx;
    UI.card(cv, rx, TOP, rw, 392, 'What the report says', { info: info('qr') });
    const lines = text.split('\n').slice(1);
    lines.slice(0, 9).forEach((ln, i) => cv.text(fit(cv, ln, 17, rw - 40), rx + 20, TOP + 66 + i * 30, 17, C.text, { literal: true }));
    cv.text(S.savedText || 'Plain text: any phone camera reads it, no app needed. Show it to your mechanic.', rx + 20, TOP + 370, 16, C.dim, { literal: true });
}

/* ---------- How to use, Settings ---------- */

let topics = null;
function helpTopics() {
    if (!topics) topics = T.TOPICS.map((tp) => Object.assign({}, tp, { draw: artFor(tp.art, { art: tp.art }) })).concat([UI.REPORT_TOPIC]);
    return topics;
}

/** Health's own Settings rows (after the Display block, which is the same in every app). */
const APP_ROWS = [
    { key: 'nightly', label: 'Nightly battery check', hint: 'Reads the 12 V resting voltage after the car sleeps', type: 'choice', default: 'on', options: [['on', 'On'], ['off', 'Off']] },
    { key: 'batteryWarn', label: 'Battery warning at', hint: 'Warn when resting voltage stays below', type: 'number', default: 12.4, steps: [11.8, 11.9, 12.0, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6], decimals: 2, unit: 'V' },
    { key: 'tyreWarn', label: 'Tyre warning at', hint: 'Warn when a tyre is this much lower than the others', type: 'number', default: 0.1, steps: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3], decimals: 2, unit: 'bar' },
    { key: 'units', label: 'Units', hint: 'Pressure and temperature', type: 'choice', default: 'metric', options: [['metric', 'Metric'], ['imperial', 'Imperial']] },
    { key: 'intervals', label: 'Our intervals', hint: 'Oil, plugs, air filter, gearbox oil, coolant', type: 'choice', default: 'strict', options: [['strict', 'Strict'], ['car', 'As the car']] },
];

/** Health's settings rows this car has a use for. */
function appRowsFor(S) {
    const cp = S.caps;
    return APP_ROWS.filter((r) => (r.key === 'nightly' || r.key === 'batteryWarn' ? M.has(cp, 'volts') : r.key === 'tyreWarn' ? M.has(cp, 'tpms')
        : r.key === 'intervals' ? M.has(cp, 'speed') || M.has(cp, 'oilKm') || M.has(cp, 'plugKm') : true));
}

/* ---------- one frame ---------- */

const PAGES = [overview, faults, battery, service, tyres, fluids, history, share, engine];

/** Records one frame of Health on cv. t: seconds (for the animations). */
function draw(cv, S, V, A, t) {
    setEngine(S.engine);
    if (V.mode === 'help') {
        UI.howToUse(cv, helpTopics(), V.helpSel || 0, t, { title: 'HEALTH', onSelect: A.helpTopic, onBack: A.back, onSettings: A.settings });
    } else if (V.mode === 'settings' && V.report && V.report.active()) {
        UI.reportPage(cv, V.report, t, { title: 'HEALTH', onHelp: () => { V.report.close(); A.help(); } });
    } else if (V.mode === 'settings') {
        UI.settingsPage(cv, appRowsFor(S), V.values || {}, A.setting, { title: 'HEALTH', appLabel: 'Health', onBack: A.back, onHelp: A.help,
            onReport: V.report ? () => V.report.open() : null });
    } else {
        if (!S.caps) S.caps = M.ALL_CAPS;
        if (!S.cards) S.cards = overviewCards(S);
        if (M.pagesFor(S.caps, S).indexOf(V.page) < 0) V.page = 0;
        if (V.page === 1 && V.mem && !memsFor(S).some((m) => m[0] === V.mem)) V.mem = 'fault';
        frame(cv, S, V, A);
        PAGES[V.page || 0](cv, S, V, A, t);
    }
    if (V.dialog) UI.dialog(cv, V.dialog.d, t, { a: V.dialog.a == null ? 1 : V.dialog.a });
    UI.overlay(cv, t);
}

module.exports = { draw, TABS, APP_ROWS, appRowsFor, overviewCards, addPartBody, clearDialog, clearedText, info, helpTopics, MEMS };
