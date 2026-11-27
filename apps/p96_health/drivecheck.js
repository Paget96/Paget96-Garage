// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * drivecheck.js - Drive check (T35, I23; owner 2026-11-27 02:44): an engine runs in step, so while the car drives
 * Health compares the values that must agree and says, in plain words and with its evidence, what is out of step.
 * Pure logic: the app feeds it samples, it keeps no timers and reads nothing itself.
 *
 *   const dc = new DriveCheck({ cylinders: 4, learned });   dc.feed(sample)  (about every 2 s while driving)
 *   dc.checks()   -> [{ key, label, state: 'ok' | 'watch' | 'out' | 'nodata', words }]  one row per check
 *   dc.findings() -> [{ key, cyl, words, evidence, times, first, last }]               what repeated, worst first
 *   dc.learned()  -> what this car's normal is, per condition, to keep for the next drive (JSON)
 *
 * sample = { t (ms), rpm, load (%), coolant (°C), oil (°C), rough: [per cylinder, rad/s²], ignition: [per cylinder, °],
 *            misfire: [per cylinder, counter], knock (° retard), lambda, lambdaTarget, vanosIn, vanosInTarget, vanosEx,
 *            vanosExTarget, rail (bar), railTarget, boost (bar), boostTarget }  any of it may be missing.
 *
 * The rules, all estimates (not a dealer diagnosis):
 *   - Only like with like: a value is compared in its condition (revs band x load band, warm engine), never across.
 *   - A cylinder is compared with the others in the same moment (they share the same air, fuel and revs), and with
 *     what this car learned for that cylinder in that condition, so a car that always runs a little uneven is not
 *     flagged for it.
 *   - Actual against target only where the car reports both, and only after the value had time to follow (2 samples).
 *   - One odd moment is never a finding: a finding needs REPEAT moments at least GAP_MS apart.
 * Node 8: no optional chaining, no object spread.
 */

const REPEAT = 3;               // moments before something is a finding
const GAP_MS = 8000;            // two moments closer than this count once
const WARM = 70;                // °C coolant: below it the engine runs rich and uneven on purpose
const LEARN_MIN = 20;           // samples in a condition before its learned normal is used

/* the condition a sample is in: revs band x load band (idle is its own) */
function condition(s) {
    if (s.rpm == null) return null;
    if (s.rpm < 1000 && (s.load == null || s.load < 30)) return 'idle';
    const r = s.rpm < 2000 ? 'low' : s.rpm < 3500 ? 'mid' : 'high';
    const l = s.load == null ? 'any' : s.load < 30 ? 'light' : s.load < 60 ? 'part' : 'full';
    return r + '|' + l;
}
const median = (a) => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; };
const nums = (a) => (Array.isArray(a) ? a.filter((v) => typeof v === 'number' && isFinite(v)) : []);
const BAND = { idle: 'at idle', low: 'below 2 000 rpm', mid: '2 000 to 3 500 rpm', high: 'above 3 500 rpm' };
const LOADW = { light: 'light load', part: 'part load', full: 'high load', any: '' };
function where(cond) {
    if (!cond) return '';
    if (cond === 'idle') return 'at idle';
    const p = cond.split('|');
    return BAND[p[0]] + (LOADW[p[1]] ? ', ' + LOADW[p[1]] : '');
}

/* the checks, in the order the page lists them */
const CHECKS = [
    ['rough', 'Cylinders run even'],
    ['ignition', 'Ignition angle alike in every cylinder'],
    ['misfire', 'No misfires'],
    ['knock', 'No lasting knock retard'],
    ['lambda', 'Mixture on its target'],
    ['vanosIn', 'Intake camshaft on its target'],
    ['vanosEx', 'Exhaust camshaft on its target'],
    ['rail', 'Fuel pressure on its target'],
    ['boost', 'Boost on its target'],
    ['warmup', 'Oil follows the coolant'],
];
/* actual against target: [actual, target, tolerance (absolute, or fraction of target when rel), unit, words] */
const TRACK = {
    lambda: ['lambda', 'lambdaTarget', 0.05, '', 'the mixture'],
    vanosIn: ['vanosIn', 'vanosInTarget', 5, '°', 'the intake camshaft'],
    vanosEx: ['vanosEx', 'vanosExTarget', 5, '°', 'the exhaust camshaft'],
    rail: ['rail', 'railTarget', 0.12, ' bar', 'the fuel pressure', true],
    boost: ['boost', 'boostTarget', 0.15, ' bar', 'boost'],
};

class DriveCheck {
    constructor(o) {
        o = o || {};
        this.cylinders = o.cylinders || 0;
        this.L = o.learned && typeof o.learned === 'object' ? JSON.parse(JSON.stringify(o.learned)) : {};
        this.seen = {};           // check -> samples that had its values
        this.events = {};         // finding key -> { key, check, cyl, words, times: [ms], first, last, worst, cond }
        this.state = {};          // check -> { off: consecutive samples off target, last words }
        this.prev = null;
        this.n = 0;
    }

    feed(s) {
        if (!s || s.t == null) return;
        this.n++;
        const cond = condition(s), warm = s.coolant != null && s.coolant >= WARM;
        if (warm && cond) {
            this._cylinders(s, cond, 'rough', nums(s.rough), 8, 'rad/s²', (c, d) => 'cylinder ' + c + ' runs rougher than the others ' + where(cond), true);
            this._cylinders(s, cond, 'ignition', nums(s.ignition), 4, '°', (c, d) => 'cylinder ' + c + ' gets ' + Math.abs(d).toFixed(1) + '° ' + (d < 0 ? 'later' : 'earlier') + ' ignition than the others ' + where(cond), false);
            this._knock(s, cond);
            Object.keys(TRACK).forEach((k) => this._track(k, s, cond));
        }
        this._misfire(s, cond);
        this._warmup(s);
        this.prev = s;
    }

    /* one cylinder against the others in the same moment, and against its own learned normal there */
    _cylinders(s, cond, check, v, minDev, unit, say, absOnly) {
        if (v.length < 3) return;
        this.seen[check] = (this.seen[check] || 0) + 1;
        const vals = absOnly ? v.map(Math.abs) : v;
        const lk = check + '|' + cond, L = this.L[lk] || (this.L[lk] = { n: 0, dev: v.map(() => 0) });
        v.forEach((_, i) => {
            const others = vals.filter((x, j) => j !== i), m = median(others), spread = median(others.map((x) => Math.abs(x - m))) || 0;
            const d = vals[i] - m;
            const learned = L.n >= LEARN_MIN ? L.dev[i] || 0 : 0;
            // out: far from the others now (more than the minimum and three times their own spread), and further than
            // this cylinder usually is here
            const out = absOnly ? d > Math.max(minDev, 3 * spread) && d - learned > minDev * 0.75
                : Math.abs(d) > Math.max(minDev, 3 * spread) && Math.abs(d - learned) > minDev * 0.75;
            if (out) this._event(check + '|' + (i + 1), check, i + 1, say(i + 1, d), s.t, Math.abs(d), cond, unit);
            // learn this cylinder's usual place here: quickly while it is in step, very slowly while it is out, so a
            // cylinder that is always a little different becomes this car's normal over a long drive, and a new fault
            // stands out against weeks of normal (the learned values are kept between drives)
            const rate = out ? 1 / 600 : 1 / Math.min(L.n + 1, 200);
            L.dev[i] = L.n ? L.dev[i] + (d - L.dev[i]) * rate : d;
        });
        L.n = Math.min(L.n + 1, 100000);
    }

    _misfire(s, cond) {
        const v = nums(s.misfire), p = this.prev ? nums(this.prev.misfire) : [];
        if (v.length < 1) return;
        this.seen.misfire = (this.seen.misfire || 0) + 1;
        if (p.length !== v.length) return;
        v.forEach((x, i) => { const add = x - p[i]; if (add > 0 && add < 1000) this._event('misfire|' + (i + 1), 'misfire', i + 1, 'cylinder ' + (i + 1) + ' misfired ' + where(cond), s.t, add, cond, ''); });
    }

    _knock(s, cond) {
        if (s.knock == null) return;
        this.seen.knock = (this.seen.knock || 0) + 1;
        const st = this.state.knock || (this.state.knock = { off: 0 });
        st.off = Math.abs(s.knock) > 3 && s.load != null && s.load > 40 ? st.off + 1 : 0;
        if (st.off >= 2) this._event('knock', 'knock', 0, 'the engine pulls the ignition back for knock ' + where(cond) + ' (low octane fuel, heat or carbon)', s.t, Math.abs(s.knock), cond, '°');
    }

    _track(k, s, cond) {
        const t = TRACK[k], a = s[t[0]], g = s[t[1]];
        if (a == null || g == null) return;
        this.seen[k] = (this.seen[k] || 0) + 1;
        const tol = t[5] ? Math.abs(g) * t[2] : t[2], d = a - g;
        const st = this.state[k] || (this.state[k] = { off: 0 });
        st.off = Math.abs(d) > tol ? st.off + 1 : 0;
        // two samples in a row: the value had time to follow its target
        if (st.off >= 2) {
            const how = k === 'lambda' ? (d > 0 ? 'leaner' : 'richer') + ' than the engine unit asks' : (d > 0 ? 'above' : 'below') + ' its target';
            this._event(k, k, 0, t[4] + ' stays ' + how + ' ' + where(cond), s.t, Math.abs(d), cond, t[3]);
        }
    }

    /* after 15 minutes warm, the oil should be within 35 °C of the coolant (a thermostat or a sensor if not) */
    _warmup(s) {
        if (s.oil == null || s.coolant == null) return;
        this.seen.warmup = (this.seen.warmup || 0) + 1;
        const st = this.state.warmup || (this.state.warmup = { since: null });
        if (s.coolant >= 80 && st.since == null) st.since = s.t;
        if (st.since != null && s.t - st.since > 15 * 60000 && s.coolant - s.oil > 35)
            this._event('warmup', 'warmup', 0, 'the oil stays much colder than the coolant (' + Math.round(s.oil) + ' against ' + Math.round(s.coolant) + ' °C)', s.t, s.coolant - s.oil, null, '°C');
    }

    _event(key, check, cyl, words, t, size, cond, unit) {
        const e = this.events[key] || (this.events[key] = { key: key, check: check, cyl: cyl, words: words, times: [], first: t, last: t, worst: 0, unit: unit, conds: {} });
        e.words = words; e.last = t;
        if (cond) e.conds[cond] = (e.conds[cond] || 0) + 1;
        if (size > e.worst) e.worst = size;
        if (!e.times.length || t - e.times[e.times.length - 1] >= GAP_MS) e.times.push(t);
    }

    /** What repeated: REPEAT moments or more, the most often first. */
    findings() {
        return Object.keys(this.events).map((k) => this.events[k]).filter((e) => e.times.length >= REPEAT)
            .sort((a, b) => b.times.length - a.times.length)
            .map((e) => ({ key: e.key, check: e.check, cyl: e.cyl, words: e.words.charAt(0).toUpperCase() + e.words.slice(1),
                evidence: e.times.length + ' times this drive, up to ' + (Math.round(e.worst * 10) / 10) + (e.unit ? (e.unit.charAt(0) === ' ' || e.unit.charAt(0) === '°' ? '' : ' ') + e.unit : '') + ' off',
                times: e.times.length, first: e.first, last: e.last }));
    }

    /** One row per check: off (no values from this car), ok, watch (seen once or twice), out (a finding). */
    checks() {
        const f = this.findings();
        return CHECKS.map(([key, label]) => {
            if (!this.seen[key]) return { key: key, label: label, state: 'nodata', words: 'not reported by this car yet' };
            const mine = f.filter((x) => x.check === key);
            if (mine.length) return { key: key, label: label, state: 'out', words: mine[0].words };
            const some = Object.keys(this.events).some((k) => this.events[k].check === key);
            return { key: key, label: label, state: some ? 'watch' : 'ok', words: some ? 'seen once or twice, watching' : 'in step, ' + this.seen[key] + ' readings' };
        });
    }

    learned() { return this.L; }
}

module.exports = { DriveCheck, condition, where, CHECKS, TRACK, REPEAT, GAP_MS, WARM, LEARN_MIN };
