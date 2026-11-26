// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog's data, without any drawing or car wiring, so the pages can be drawn and tested on a PC.
 *
 *   const m = new Model({ runLength: 402 });
 *   m.set('intake', 24, now)        a value arrived (names in CHANNELS); null = the car has none
 *   m.speed(now, kmh)               a speed sample: the run timer (kit run_timer.js) times the runs
 *   m.tick(now)                     about every 50 ms: histories, the timer's clock, peaks
 *   m.runs, m.best(), m.events      the runs of this session, the best one, what happened
 *
 * Air correction: SAE J1349, the same formula Drag Timer uses (upstream draggy weather.js), with the
 * intake air after the filter instead of the outside (mirror) sensor (owner + Zuki, I4).
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */
function kit(name) {
    try { return require('./kit/' + name); }                                   // inside a built app
    catch (e) { return require('../../upstream-kit/kit/runtime/' + name); }    // in the repo (previews, tests)
}
const { RunTimer } = kit('run_timer');

const isNum = (v) => typeof v === 'number' && isFinite(v);

/** Every value Datalog keeps: unit, how many decimals, and a plausible range (anything outside is dropped). */
const CHANNELS = {
    speed: { unit: 'km/h', min: 0, max: 400 },
    rpm: { unit: 'rpm', min: 0, max: 10000 },
    outside: { unit: '°C', min: -40, max: 60 },        // the mirror sensor (EnvironmentalInformation)
    intake: { unit: '°C', min: -40, max: 120 },        // after the air filter (OBD 0F)
    charge: { unit: '°C', min: -40, max: 150 },        // after the intercooler, before the throttle (OBD 77, charge air cooler)
    manifold: { unit: 'kPa', min: 10, max: 400 },      // intake manifold, absolute (DME 580B, OBD 70 / 87 / 0B)
    ambient: { unit: 'kPa', min: 50, max: 115 },       // outside air pressure from the engine unit (OBD 33)
    boostTarget: { unit: 'kPa', min: 10, max: 400 },   // the engine's own boost setpoint, absolute (DME 4AB0)
    oil: { unit: '°C', min: -40, max: 170 },
    coolant: { unit: '°C', min: -40, max: 140 },
    gearbox: { unit: '°C', min: -40, max: 160 },
    egt: { unit: '°C', min: 0, max: 1100 },            // the catalyst, the engine's own model (OBD 3C)
};
const TYRES = ['fl', 'fr', 'rl', 'rr'];

/** SAE J1349 correction factor for air at c °C and kPa (dry air). >1: the air was worse than standard. */
function saeCf(c, kPa) {
    if (!isNum(c) || !isNum(kPa) || kPa <= 0) return null;
    return 1.176 * (99 / kPa) * Math.sqrt((c + 273) / 298) - 0.176;
}
/** Density altitude in m: the height of standard air as thin as this air. */
function densityAltitude(c, kPa) {
    if (!isNum(c) || !isNum(kPa)) return null;
    const rho = kPa * 1000 / (287.05 * (c + 273.15));
    return 44330.8 * (1 - Math.pow(rho / 1.225, 0.234969));
}
/** A time corrected to standard air: speed windows by the power ratio, distances by its cube root (as Dragy). */
function correct(sec, cf, isDist) {
    if (!isNum(sec) || !isNum(cf) || cf <= 0) return null;
    return isDist ? sec / Math.cbrt(cf) : sec / cf;
}

/** A fixed length history: push() adds, values() is oldest first. seq counts every push (charts scroll by it). */
class Hist {
    constructor(n) { this.n = n; this.v = []; this.seq = 0; }
    push(x) { this.v.push(isNum(x) ? x : null); if (this.v.length > this.n) this.v.shift(); this.seq++; }
    values() { return this.v; }
    last() { return this.v.length ? this.v[this.v.length - 1] : null; }
}

const SPLITS = (runLength) => [
    { key: '0-100', label: '0-100 km/h', from: 0, to: 100 },
    { key: '60-100', label: '60-100 km/h', from: 60, to: 100 },
    { key: '100-200', label: '100-200 km/h', from: 100, to: 200 },
    { key: 'em', label: '201 m', dist: 201.168 },
].concat(runLength === 201 ? [] : [{ key: 'qm', label: '402 m', dist: 402.336 }]);
const isDistKey = (k) => k === 'em' || k === 'qm';

class Model {
    constructor(opts) {
        opts = opts || {};
        this.runLength = opts.runLength === 201 ? 201 : 402;
        this.now = {};                 // channel -> latest value
        this.at = {};                  // channel -> when it came (ms)
        this.tyres = { p: {}, t: {}, target: null };      // pressures in bar, temperatures in °C, the car's target
        this.sec = {};                 // channel -> Hist of 1 s samples, the last 60 s (the card strips)
        this.min = {};                 // channel -> Hist of 10 s samples, the last 10 min (Temps chart)
        Object.keys(CHANNELS).forEach((k) => { this.sec[k] = new Hist(60); this.min[k] = new Hist(60); });
        this.fast = [];                // [t, boost bar, manifold bar abs, ambient bar abs, intake, charge, outside] at 10 Hz, last 60 s
        this.runs = [];                // this session's runs, newest first
        this.events = [];              // { at, kind, text }, newest first
        this.peakBoost = null;
        this.compareWith = null;       // the run Compare shows against the best (null: the latest)
        this.lastSec = 0; this.lastMin = 0; this.lastFast = 0; this.t = opts.t || Date.now();
        this.timer = this._newTimer();
        this.runStart = null;
        this.event('start', 'Datalog started', opts.t || Date.now());
    }
    _newTimer() {
        return new RunTimer(SPLITS(this.runLength), {
            onLaunch: () => { this.runStart = this.t; this.peakBoost = null; },
            onDone: (r) => this._done(r),
        });
    }
    setRunLength(m) { this.runLength = m === 201 ? 201 : 402; this.timer = this._newTimer(); }

    /** A value arrived. Out of range or not a number: the channel shows no data. */
    set(ch, v, t) {
        const c = CHANNELS[ch];
        if (!c) return;
        const ok = isNum(v) && v >= c.min && v <= c.max;
        this.now[ch] = ok ? v : null;
        if (ok) this.at[ch] = t || Date.now();
    }
    get(ch, maxAgeMs, t) {
        const v = this.now[ch];
        if (!isNum(v)) return null;
        if (maxAgeMs && (t || Date.now()) - (this.at[ch] || 0) > maxAgeMs) return null;
        return v;
    }
    tyre(pos, p, temp) {
        if (TYRES.indexOf(pos) < 0) return;
        if (p !== undefined) this.tyres.p[pos] = isNum(p) && p > 0.3 && p < 5 ? p : null;
        if (temp !== undefined) this.tyres.t[pos] = isNum(temp) && temp > -40 && temp < 150 ? temp : null;
    }

    /** Boost: manifold pressure minus the outside pressure, bar. Below 0 is vacuum (part throttle). */
    boost() {
        const m = this.get('manifold'), a = this.get('ambient');
        return isNum(m) && isNum(a) ? (m - a) / 100 : null;
    }
    boostTarget() {
        const m = this.get('boostTarget'), a = this.get('ambient');
        return isNum(m) && isNum(a) ? (m - a) / 100 : null;
    }
    /** The air the engine breathes now: the intake temperature after the filter, else the outside sensor. */
    air() {
        const c = isNum(this.get('intake')) ? this.get('intake') : this.get('outside'), kPa = this.get('ambient');
        const cf = saeCf(c, kPa);
        return { c: c, kPa: kPa, cf: cf, da: densityAltitude(c, kPa), from: isNum(this.get('intake')) ? 'intake' : 'outside' };
    }
    /** Heat soak: the charge air more than 25 °C over the intake air. */
    heatSoak() {
        const i = this.get('intake'), c = this.get('charge');
        return isNum(i) && isNum(c) ? c - i : null;
    }

    speed(t, kmh) { this.t = t; this.set('speed', kmh, t); this.timer.feed(t, kmh); }
    tick(t) {
        this.t = t;
        this.timer.idle(t);
        const b = this.boost();
        if (this.timer.state === 'run' && isNum(b)) this.peakBoost = isNum(this.peakBoost) ? Math.max(this.peakBoost, b) : b;
        if (t - this.lastFast >= 100) {
            this.lastFast = t;
            const bar = (k) => (isNum(this.get(k)) ? this.get(k) / 100 : null);
            this.fast.push([t, b, bar('manifold'), bar('ambient'), this.get('intake'), this.get('charge'), this.get('outside'), this.get('speed')]);
            while (this.fast.length && t - this.fast[0][0] > 60000) this.fast.shift();
        }
        if (t - this.lastSec >= 1000) {
            this.lastSec = t;
            Object.keys(CHANNELS).forEach((k) => this.sec[k].push(this.get(k, 15000, t)));
            this.secBoost = this.secBoost || new Hist(60);
            this.secBoost.push(b);
        }
        if (t - this.lastMin >= 10000) {
            this.lastMin = t;
            Object.keys(CHANNELS).forEach((k) => this.min[k].push(this.get(k, 30000, t)));
        }
    }
    /** The run timer's state for the screen: 'wait' (moving), 'ready' (standing, armed), 'run'. */
    state() { return this.timer.state; }
    elapsed(t) { return this.timer.elapsed(t); }

    _done(r) {
        const t = this.t || r.at, air = this.air(), soak = this.heatSoak();
        const start = this.runStart || t - 1000 * (this.timer.trace.length ? this.timer.trace[this.timer.trace.length - 1][0] : 0);
        const fast = this.fast.filter((f) => f[0] >= start - 500).map((f) => [(f[0] - start) / 1000, f[1], f[2], f[3], f[4], f[5], f[6]]);
        const run = {
            n: this.runs.length ? this.runs[0].n + 1 : 1,
            at: t, result: r.result, trap: r.trap, vmax: r.vmax,
            air: { c: air.c, kPa: air.kPa, from: air.from, outside: this.get('outside'), intake: this.get('intake'), charge: this.get('charge') },
            cf: air.cf, da: air.da, soak: soak, peakBoost: this.peakBoost,
            trace: this.timer.trace.slice(), fast: fast,
        };
        run.corrected = {};
        Object.keys(run.result).forEach((k) => { run.corrected[k] = correct(run.result[k], run.cf, isDistKey(k)); });
        this.addRun(run);
    }
    addRun(run) {
        const best = this.best();
        this.runs.unshift(run);
        if (this.runs.length > 30) this.runs.pop();
        const key = this.mainKey(), s = run.result[key];
        const label = this.runLength + ' m';
        if (isNum(s)) {
            const nb = !best || !isNum(best.result[key]) || s < best.result[key];
            this.event('run', 'Run ' + run.n + ': ' + label + ' in ' + s.toFixed(2) + ' s' + (isNum(run.trap[key]) ? ' at ' + Math.round(run.trap[key]) + ' km/h' : '') + (nb ? ', best so far' : ''), run.at);
        } else if (isNum(run.result['0-100'])) this.event('run', 'Run ' + run.n + ': 0-100 km/h in ' + run.result['0-100'].toFixed(2) + ' s', run.at);
        if (isNum(run.soak) && run.soak > 25) this.event('warn', 'Run ' + run.n + ': charge air ' + Math.round(run.soak) + ' °C over intake, heat soak', run.at);
        this.compareWith = null;
    }
    event(kind, text, t) {
        this.events.unshift({ at: t || Date.now(), kind: kind, text: text });
        if (this.events.length > 60) this.events.pop();
    }
    /** The split a run is judged by: 402 m, or 201 m with that setting. */
    mainKey() { return this.runLength === 201 ? 'em' : 'qm'; }
    /** The quickest run (by the corrected time when corrected is true). */
    best(corrected) {
        const k = this.mainKey();
        let b = null;
        this.runs.forEach((r) => {
            const s = corrected ? r.corrected[k] : r.result[k];
            if (!isNum(s)) return;
            const bs = b ? (corrected ? b.corrected[k] : b.result[k]) : null;
            if (!b || s < bs) b = r;
        });
        return b;
    }
}

/**
 * The demo drive: a car on a strip, standing, a full throttle run every 36 s, coasting back.
 * feed(model, t) sets every channel as the car would (speed at 20 Hz from the caller).
 */
class Demo {
    constructor(t0) { this.t0 = t0 || Date.now(); this.runs = 0; }
    /** Seconds into the current 36 s cycle and which run it is. */
    phase(t) { const s = (t - this.t0) / 1000; return { k: Math.floor(s / 36), s: s % 36 }; }
    speed(t) {
        const p = this.phase(t), heat = Math.min(p.k, 6), s = p.s - 4;
        if (s < 0) return 0;
        // full throttle for 13 s: a curve that reaches about 172 km/h at 402 m, a touch slower when heat soaked
        const vmax = 238 - heat * 2.2;
        if (s < 13.2) return vmax * (1 - Math.exp(-s / (8.6 + heat * 0.08))) * Math.min(1, s / 0.35 + 0.15);
        const v1 = vmax * (1 - Math.exp(-13.2 / (8.6 + heat * 0.08)));
        return Math.max(0, v1 - (s - 13.2) * 14);
    }
    feed(m, t) {
        const p = this.phase(t), s = p.s - 4, heat = Math.min(p.k, 6), on = s >= 0 && s < 13.2;
        const v = this.speed(t);
        const wob = (f, a) => a * Math.sin((t - this.t0) / 1000 * f);
        m.set('outside', 18 + wob(0.01, 0.4), t);
        m.set('intake', 24 + heat * 1.6 + (on ? 2 : 0) + wob(0.05, 0.3), t);
        const chargeBase = 32 + heat * 4.2;
        m.set('charge', chargeBase + (on ? Math.min(14, s * 1.6) : Math.max(0, 14 - (s - 13.2) * 1.2) * (s > 13.2 ? 1 : 0)), t);
        m.set('ambient', 101.2 + wob(0.002, 0.08), t);
        const spool = on ? 1 / (1 + Math.exp(-(s - 1.1) * 3.2)) : 0;
        const target = on ? 101.2 + 145 * spool : 45;
        m.set('boostTarget', on ? 101.2 + 145 : 45, t);
        m.set('manifold', on ? target - 3 + wob(3, 1.5) : 38 + wob(0.7, 2), t);
        m.set('rpm', on ? 3200 + ((s * 1.7) % 1) * 3300 : 900 + v * 12, t);
        m.set('oil', 98 + heat * 1.4 + wob(0.02, 0.4), t);
        m.set('coolant', 92 + heat * 0.6, t);
        m.set('gearbox', 76 + heat * 1.9, t);
        m.set('egt', on ? 620 + s * 38 : 420 + wob(0.1, 6), t);
        const tyreT = 31 + heat * 3.1;
        m.tyre('fl', 2.31 + heat * 0.03, tyreT + 1); m.tyre('fr', 2.33 + heat * 0.03, tyreT + 2);
        m.tyre('rl', 2.38 + heat * 0.05, tyreT + 6); m.tyre('rr', 2.41 + heat * 0.05, tyreT + 7);
        m.tyres.target = 2.3;
        m.speed(t, v);
    }
}

module.exports = { Model, Demo, Hist, CHANNELS, TYRES, SPLITS, saeCf, densityAltitude, correct, isDistKey, isNum };
