// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * report.js - "Send a report" in every Paget96 Garage app (owner, 2026-11-26 19:41 and 19:43, variant A).
 *
 * The car needs no internet and no account: the app shows a QR code with a GitHub "new issue" link whose title and
 * body are already filled in, and the user's phone opens it and sends it from his own GitHub account. Before
 * anything, a screen shows exactly what the link will carry, line by line (lib/ui.js reportPage).
 *
 * What goes in (and nothing else):
 *   the app: name, version, id
 *   iDrive: from the screen the renderer reports (1920 x 720 is iDrive 7, 2880 x 960 is iDrive 8), else "not known"
 *   the head unit's firmware: /etc/os-release-id-dlt (e.g. "BMW MGU P18_23w44.2-1-3 mgu-high"), else os-release
 *   the engine as the app found it on this car (engine.json in the app's data folder, lib/engine.js), never a guess
 *   the settings that differ from their defaults (the rest are default)
 *   the last warnings and errors of the app's log, short (times, levels, the first line of each), a VIN masked
 *   the VIN only when the user ticks it (and only an app that read it from the car can offer it)
 * Never: a location, the phone, contacts, names, the full log.
 *
 * The link has to stay small enough for a phone camera to read the code from the car's screen: version 15 at most
 * (77 modules). The log lines are dropped first, oldest first, until it fits; the car facts never are, and the body
 * says when the log was shortened.
 *
 *   const R = require('./garage_report');               // lib/report.js in the repo
 *   const rep = R.forApp(ctx, { vin: () => vin });     // in start(); then rep.open() from the Settings page
 *   rep.facts, rep.built ({ title, lines, url, qr }), rep.step ('explain' | 'qr'), rep.vin (ticked)
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */
function lib(name) {
    try { return require('./garage_' + name); }       // inside a built app
    catch (e) { return require('./' + name); }         // in the repo (tests, tools)
}
const QR = lib('qr');

const NEW_ISSUE = 'https://github.com/Paget96/Paget96-Garage/issues/new';
const MAX_VERSION = 15;          // 77 modules: what a phone camera reads reliably from the car's screen
const LOG_LINES = 6;             // the newest warnings and errors offered at most
const LINE_MAX = 90;             // characters a body line keeps (the screen shows each on one line)
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

/* ---------- what the app knows ---------- */

/** iDrive generation from the screen size the renderer reports, or null. */
function idriveOf(screen) {
    if (!screen || !screen.w) return null;
    if (screen.w === 1920 && screen.h === 720) return 'iDrive 7';
    if (screen.w === 2880 && screen.h === 960) return 'iDrive 8';
    return 'screen ' + screen.w + ' x ' + screen.h;
}

/** The head unit's firmware line, from the files it keeps (read only), or null. */
function firmwareOf(fs, etc) {
    etc = etc || '/etc';
    try {
        const t = String(fs.readFileSync(etc + '/os-release-id-dlt', 'utf8')).split('\n')[0].trim();
        if (t) return t;
    } catch (e) { /* not there */ }
    try {
        const m = /^PRETTY_NAME=["']?([^"'\n]*)/m.exec(String(fs.readFileSync(etc + '/os-release', 'utf8')));
        if (m && m[1].trim()) return m[1].trim();
    } catch (e) { /* not there */ }
    return null;
}

/** The engine in words from facts lib/engine.js found on this car, or null when nothing was found. */
function engineOf(E, facts) {
    if (!facts || !Object.keys(facts).length) return null;
    const p = E.profile(facts), bits = [];
    if (p.fuel) bits.push(p.hybrid ? p.fuel + ' hybrid' : p.fuel);
    if (!p.engine) return bits.concat(['no engine']).join(', ');
    bits.push(p.cylinders ? p.cylinders + ' cylinders' : 'cylinders not found');
    if (p.units === 2) bits.push('two engine units');
    if (facts.index) bits.push('engine unit index ' + facts.index);
    if (p.turbos) bits.push(p.turbos === 2 ? 'two turbos' : 'one turbo');
    if (p.filter) bits.push(E.filterName(p));
    return bits.join(', ');
}

/** Settings that differ from their defaults: [[key, value]] in the order of the app's list. */
function changedSettings(schema, get) {
    const out = [];
    (schema || []).forEach((s) => {
        if (!s || !s.key || s.key.charAt(0) === '_') return;
        const v = get(s.key);
        if (v === undefined || v === null || String(v) === String(s.default)) return;
        out.push([s.key, v]);
    });
    return out;
}

/** Text without control characters, a VIN masked, cut to n characters. */
function clean(s, n) {
    let t = String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, ' ').replace(VIN_RE, '<VIN>').replace(/\s+/g, ' ').trim();
    if (n && t.length > n) t = t.slice(0, n - 3).replace(/\s+\S*$/, '') + '...';
    return t;
}

/**
 * The app log's warnings and errors: { warn, error, lines: ['hh:mm ERROR text', ...] (newest last, at most max) }.
 * Lines are "<ISO time> <LEVEL> <text>" (kit/mgu.js fileLog); a stack's further lines have no time and are skipped.
 */
function logSummary(text, max) {
    const out = { warn: 0, error: 0, lines: [] };
    String(text || '').split('\n').forEach((ln) => {
        const m = /^(\d{4}-\d\d-\d\dT(\d\d:\d\d):\d\d(?:\.\d+)?Z?) (WARN|ERROR|FATAL|SDK_WARN|SDK_ERROR) (.*)$/.exec(ln);
        if (!m) return;
        const err = m[3] !== 'WARN' && m[3] !== 'SDK_WARN';
        if (err) out.error++; else out.warn++;
        out.lines.push(m[2] + ' ' + (err ? 'ERROR' : 'WARN') + ' ' + clean(m[4], 56));
    });
    out.lines = out.lines.slice(-(max || LOG_LINES));
    return out;
}

/* ---------- the issue ---------- */

/**
 * The facts a report carries. o = { spec (app.json), get(key) (a setting), screen, firmware, engine (words or null),
 * logText, vin }.
 */
function collect(o) {
    const spec = o.spec || {};
    return {
        app: (spec.title || spec.name || spec.id || 'app') + ' ' + (spec.version || '?') + ' (' + (spec.id || '?') + ')',
        name: spec.title || spec.name || spec.id || 'app',
        version: spec.version || '?',
        idrive: idriveOf(o.screen),
        firmware: o.firmware || null,
        engine: o.engine || null,
        changed: changedSettings(spec.settings, o.get || (() => undefined)),
        log: logSummary(o.logText, LOG_LINES),
        vin: o.vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(o.vin) ? o.vin : null,
    };
}

/** The firmware's short name: the train in the line (e.g. P18_23w44.2-1-3), else the line. */
function firmwareShort(fw) {
    const m = /\b[A-Z]\d\d_\d\dw\d\d[\w.\-]*/.exec(String(fw || ''));
    return m ? m[0] : clean(fw || '', 40);
}

/**
 * The body's lines for these facts: logN log lines (the newest), the VIN only when vin is true. Short on purpose:
 * every byte makes the code bigger, and a colon or a comma takes three in a link.
 */
function bodyLines(f, opts) {
    opts = opts || {};
    const L = [];
    L.push('What happened:');
    L.push('');
    L.push('');
    L.push('App: ' + f.name + ' ' + f.version);
    L.push((f.idrive || 'iDrive not known') + ', firmware ' + (f.firmware ? firmwareShort(f.firmware) : 'not known'));
    L.push('Engine: ' + (f.engine || 'not found yet'));
    if (opts.vin && f.vin) L.push('VIN: ' + f.vin);
    const set = f.changed.map((c) => c[0] + '=' + c[1]).join(', ');
    L.push('Settings: ' + (set ? clean(set, LINE_MAX - 10) : 'all default'));
    const lg = f.log, n = opts.logN == null ? lg.lines.length : Math.min(opts.logN, lg.lines.length);
    if (!lg.warn && !lg.error) L.push('Log: no warnings or errors');
    else {
        L.push('Log: ' + lg.error + (lg.error === 1 ? ' error, ' : ' errors, ') + lg.warn + (lg.warn === 1 ? ' warning' : ' warnings') +
            (n < lg.lines.length ? (n ? ' (the newest ' + n + ', shortened to fit)' : ' (lines left out to fit)') : ''));
        lg.lines.slice(lg.lines.length - n).forEach((x) => L.push(x));
    }
    return L;
}

/** URL encoding for a query value: spaces as "+", the rest percent encoded (UTF-8). */
function enc(s) { return encodeURIComponent(s).replace(/%20/g, '+'); }
function urlFor(title, lines) {
    return NEW_ISSUE + '?title=' + enc(title) + '&body=' + enc(lines.join('\n'));
}
function titleOf(f) { return 'Report from ' + f.name + ' ' + f.version; }

/**
 * The report as the code will carry it: { title, lines, url, qr, ecl, logN, trimmed }, version 15 at most. Level M when
 * it all fits, else level L; log lines go first (the oldest first), the car facts never.
 */
function build(f, opts) {
    opts = opts || {};
    const title = titleOf(f), all = f.log.lines.length;
    // level M when everything fits it (it reads through glare better), else level L with the newest log lines it holds
    const tries = [['M', all]];
    for (let n = all; n >= 0; n--) tries.push(['L', n]);
    for (let i = 0; i < tries.length; i++) {
        const ecl = tries[i][0], n = tries[i][1];
        const lines = bodyLines(f, { vin: opts.vin, logN: n }), url = urlFor(title, lines);
        if (Buffer.byteLength(url, 'utf8') <= QR.capacity(MAX_VERSION, ecl)) {
            return { title: title, lines: lines, url: url, ecl: ecl, logN: n, trimmed: n < all, qr: QR.encode(url, { ecl: ecl, maxVersion: MAX_VERSION }) };
        }
    }
    // the facts alone do not fit at version 15 (cannot happen with the lines cut as they are): the smallest code there is
    const lines = bodyLines(f, { vin: opts.vin, logN: 0 }), url = urlFor(title, lines);
    return { title: title, lines: lines, url: url, ecl: 'L', logN: 0, trimmed: all > 0, qr: QR.encode(url, { ecl: 'L' }) };
}

/* ---------- the flow an app keeps ---------- */

/**
 * The state of the report screens. gather() returns the facts' sources (collect()'s argument) at the moment the
 * user opens it. Steps: 'explain' (what goes in, Make QR code or Cancel) and 'qr' (the code and how to send it).
 * active() is false once the page was not drawn for a while (the user left Settings), so it opens fresh next time.
 */
class Flow {
    constructor(gather) {
        this.gather = gather;
        this.isOpen = false;
        this.step = 'explain';
        this.vin = false;
        this.seen = 0;
        this.facts = null;
        this.built = null;
    }
    open() {
        this.facts = collect(this.gather());
        this.vin = false;
        this.step = 'explain';
        this.built = build(this.facts, { vin: false });
        this.isOpen = true;
        this.seen = Date.now();
    }
    active() { return this.isOpen && Date.now() - this.seen < 1500; }
    drawn() { this.seen = Date.now(); }
    toggleVin() { this.vin = !this.vin && !!(this.facts && this.facts.vin); this.built = build(this.facts, { vin: this.vin }); }
    makeQr() { this.step = 'qr'; }
    back() { if (this.step === 'qr') this.step = 'explain'; else this.close(); }
    close() { this.isOpen = false; this.step = 'explain'; }
}

/**
 * A Flow for an app: reads what it needs from ctx (spec, settings, the data folder, the log, the renderer's screen).
 * extra = { vin() (the VIN the app read from the car, or null), engineFacts() (else engine.json in the data folder) }.
 */
function forApp(ctx, extra) {
    extra = extra || {};
    const fs = require('fs'), path = require('path');
    const E = lib('engine');
    return new Flow(() => {
        const spec = ctx.spec || {};
        let logText = '';
        const file = path.join(ctx.dataDir || '.', (spec.id || 'app') + '.log');
        [file + '.1', file].forEach((f) => { try { logText += fs.readFileSync(f, 'utf8'); } catch (e) { /* none yet */ } });
        let facts = null;
        try { facts = extra.engineFacts ? extra.engineFacts() : null; } catch (e) { facts = null; }
        if (!facts) { try { facts = JSON.parse(fs.readFileSync(path.join(ctx.dataDir || '.', 'engine.json'), 'utf8')).facts || null; } catch (e) { facts = null; } }
        const d = ctx.display, screen = d && d.gpu && d.gpu.ready ? d.gpu.screen : null;
        let vin = null;
        try { vin = extra.vin ? extra.vin() : null; } catch (e) { vin = null; }
        return { spec: spec, get: (k) => ctx.settings.get(k), screen: screen, firmware: firmwareOf(fs), engine: engineOf(E, facts), logText: logText, vin: vin };
    });
}

module.exports = { NEW_ISSUE, MAX_VERSION, idriveOf, firmwareOf, firmwareShort, engineOf, changedSettings, logSummary, clean, collect, bodyLines, urlFor, build, Flow, forApp };
