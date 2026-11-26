// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog model: the values now (from the car or the demo), their recent history, the run logs and what the
 * screen shows. main.js feeds it from the car; the PC preview (tools/datalog_preview.js) runs it on demo data.
 *
 *   const m = new Model({ settings, dataDir, log, demo: () => bool });
 *   m.live                      the car's values, main.js writes them (see FIELDS)
 *   m.carSample(tMs, d)         a speed / rpm sample from the car (times the run)
 *   m.tick(tMs)                 every 50 ms: demo step, standstill clock, history
 *   m.v                         the values shown now (demo or live)
 *   m.log()                     the run log shown (the demo's is in memory only, never saved)
 *   m.ui                        page, view ('main' | 'help' | 'settings'), help topic, Log and Compare choices
 */
const fs = require('fs');
const path = require('path');
const M = require('./maths');
const { RunLog } = require('./runs');
const { Demo, seedRuns } = require('./demo');
const { PullLog } = require('./dyno');
function need(local, repo) {
    try { return require(local); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return require(repo); }
}
const E = need('./garage_engine', '../../lib/engine');

/** The values the pages use. Temperatures °C, pressures bar absolute (kPa for the air), speed km/h, wastegate % open. */
const FIELDS = ['speed', 'rpm', 'torque', 'gear', 'oil', 'coolant', 'gearbox', 'outside', 'intake', 'charge', 'manifold',
    'ambient', 'kPa', 'boost', 'boostTarget', 'egt', 'pedal', 'wastegate', 'wgDuty', 'boost2', 'wastegate2'];
const HIST = ['kPa', 'intake', 'outside', 'charge', 'boost', 'manifold', 'ambient', 'oil', 'coolant', 'gearbox', 'speed', 'wastegate', 'boost2', 'wastegate2'];
/**
 * What a demo car reports (lib/engine.js DEMO_CARS): an electric car no engine values at all (no boost, no engine
 * temperatures, no torque from an engine unit, so no Dyno); a diesel no wastegate (its turbo has variable vanes);
 * only a V8 with two engine units bank 2's boost and wastegate.
 */
function demoHas(p, k) {
    if (!p) return true;
    if (p.engine === false) return ['speed', 'gear', 'outside', 'tyres', 'tyreTemp', 'coolant'].indexOf(k) >= 0;
    if (k === 'wastegate' || k === 'wgDuty') return p.ewg !== false;
    if (k === 'boost2' || k === 'wastegate2') return p.units === 2 && (k === 'boost2' || p.ewg !== false);
    return true;
}
const N1 = 60, N10 = 120;            // 60 s at 1 a second, 10 min at one every 5 s

class Model {
    constructor(o) {
        this.o = o || {};
        this.settings = this.o.settings;
        this.live = { tyres: { p: {}, t: {}, target: {} } };
        this.v = { tyres: { p: {}, t: {}, target: {} } };
        this.real = new RunLog({
            file: this.o.dataDir ? path.join(this.o.dataDir, 'datalog_runs.json') : null,
            length: () => this.setting('runLength'), air: () => this.v, log: this.o.log,
        });
        this.realDyno = new PullLog({ file: this.o.dataDir ? path.join(this.o.dataDir, 'datalog_dyno.json') : null, air: () => this.v, log: this.o.log });
        this.demoDyno = null;
        this.demoLog = null;
        this.demo = null;
        this.wasDemo = null;
        this.h1 = {}; this.h10 = {}; this.seq1 = 0; this.seq10 = 0; this.t1 = 0; this.t10 = 0;
        HIST.forEach((k) => { this.h1[k] = []; this.h10[k] = []; });
        this.cold = null;            // tyre pressures when this session started
        // what this car reports (owner rule, 2026-11-26 18:21: show only what the car supports), remembered in the data folder
        this.carFile = this.o.dataDir ? path.join(this.o.dataDir, 'datalog_car.json') : null;
        this.seen = {};
        if (this.carFile) { try { (JSON.parse(fs.readFileSync(this.carFile, 'utf8')).seen || []).forEach((k) => { this.seen[k] = true; }); } catch (e) { /* a new car */ } }
        this.ui = { page: 'Now', view: 'main', topic: 0, logSession: 0, logOff: 0, logRun: null, cmpA: null, cmpB: null };
    }

    /**
     * Does this car report value k (a FIELDS name, or 'tyres', 'tyreTemp')? Seen once, it stays (the file keeps it); the
     * demo shows everything. The pages show a card, a chart line, a tab or a setting only when it does.
     */
    has(k) { return this.isDemo() ? demoHas(this.car(), k) : !!this.seen[k]; }
    /** The engine the pages draw: the demo car of Settings, else what the car answered (lib/engine.js, engine.json). */
    car() {
        if (this.isDemo()) return E.demoCar(this.setting('demoCar'));
        const now = Date.now();
        if (!this._car || now - this._carAt > 5000) { this._car = E.profile(this.o.facts ? this.o.facts() : {}); this._carAt = now; }
        return this._car;
    }
    _see(v) {
        let added = false;
        const mark = (k) => { if (!this.seen[k]) { this.seen[k] = true; added = true; } };
        FIELDS.forEach((k) => { if (typeof v[k] === 'number' && isFinite(v[k])) mark(k); });
        const ty = v.tyres || {};
        if (ty.p && M.WHEELS.some((w) => typeof ty.p[w] === 'number')) mark('tyres');
        if (ty.t && M.WHEELS.some((w) => typeof ty.t[w] === 'number')) mark('tyreTemp');
        if (added && this.carFile) { try { fs.writeFileSync(this.carFile, JSON.stringify({ v: 1, seen: Object.keys(this.seen) })); } catch (e) { if (this.o.log) this.o.log.warn('car: ' + e.message); } }
    }

    setting(k) {
        const v = this.settings && this.settings.get(k);
        if ((v === undefined || v === null) && k === 'boostTarget' && this.isDemo()) { const c = E.demoCar(this.setting('demoCar')); if (c.boost && c.id !== 'b48') return Math.round((c.boost - 0.05) * 20) / 20; }
        return v === undefined || v === null ? DEFAULTS[k] : v;
    }
    /** Demo data on (the setting, D26): never by itself. */
    isDemo() { return !!(this.o.demo && this.o.demo()); }
    /** The car answers (or the demo runs): LIVE in the header, else WAIT. */
    isLive() { return this.isDemo() || !!(this.o.live && this.o.live()); }
    log() { return this.isDemo() && this.demoLog ? this.demoLog : this.real; }

    _demoOn(t) {
        const car = E.demoCar(this.setting('demoCar'));
        if (this.demo && this.demo.car !== car) { this.demo = null; HIST.forEach((k) => { this.h1[k].length = 0; this.h10[k].length = 0; }); }
        if (!this.demo) {
            this.demo = new Demo(7, t, null, car);
            this.demoLog = new RunLog({ file: null, length: () => this.setting('runLength'), air: () => this.v });
            this.demoDyno = new PullLog({ file: null, air: () => this.v });
            seedRuns(this.demoLog, this.setting('runLength'), t, this.demoDyno, car);
            this.demo.last = null;
        }
        this.demo.runLen = this.setting('runLength');
    }

    dyno() { return this.isDemo() && this.demoDyno ? this.demoDyno : this.realDyno; }
    /**
     * The pull the Dyno page shows: the widest (most rpm) of this session's pulls, the newest of equals; else the
     * last one ever.
     */
    shownPull() {
        const ps = this.dyno().pulls, now = this.lastT || Date.now();
        let best = null;
        ps.forEach((p) => { if (now - p.at < 2 * 3600 * 1000 && (!best || p.to - p.from >= best.to - best.from - 100)) best = p; });
        return best || this.dyno().last;
    }

    /** A speed / rpm sample from the car: times the run and the dyno pulls (ignored while the demo runs). */
    carSample(t, d) {
        if (this.isDemo()) return;
        this.real.sample(t, d);
        this.realDyno.feed(t, d);
    }

    tick(t) {
        t = t == null ? Date.now() : t;
        this.lastT = t;
        const demo = this.isDemo();
        if (demo !== this.wasDemo) {
            this.wasDemo = demo; this.cold = null;
            HIST.forEach((k) => { this.h1[k].length = 0; this.h10[k].length = 0; });
        }
        if (demo) {
            this._demoOn(t);
            this.v = this.demo.sample(t);
            this.demoLog.sample(t, this.v);
            this.demoLog.idle(t);
            this.demoDyno.feed(t, this.v);
        } else {
            const L = this.live, v = { demo: false, tyres: L.tyres };
            FIELDS.forEach((k) => { v[k] = L[k]; });
            if (v.manifold != null && v.ambient != null) v.boost = M.boost(v.manifold, v.ambient);
            this.v = v;
            this._see(v);
            this.real.idle(t);
        }
        // tyre pressures when the session started: the first full set
        const p = this.v.tyres && this.v.tyres.p;
        if (!this.cold && p && M.WHEELS.every((k) => typeof p[k] === 'number')) this.cold = Object.assign({}, p);
        // history: one a second for 60 s, one every 5 s for 10 min
        if (t - this.t1 >= 1000) {
            this.t1 = t; this.seq1++;
            HIST.forEach((k) => { const a = this.h1[k]; a.push(num(this.v[k])); if (a.length > N1) a.shift(); });
        }
        if (t - this.t10 >= 5000) {
            this.t10 = t; this.seq10++;
            HIST.forEach((k) => { const a = this.h10[k]; a.push(num(this.v[k])); if (a.length > N10) a.shift(); });
        }
    }

    /** The runs of the session going on now (less than 2 h since the last run), newest last. */
    sessionRuns() {
        const runs = this.log().runs, s = M.sessions(runs)[0];
        if (!s) return [];
        const now = this.lastT || Date.now();
        return now - s.end < 2 * 3600 * 1000 ? s.runs : [];
    }

    /** Find a run by its time. */
    runAt(at) { return this.log().runs.filter((r) => r.at === at)[0] || null; }

    /** Runs A and B of the Compare page: the chosen ones, else the best (corrected) and the last. */
    comparePair() {
        const runs = this.log().runs, len = this.setting('runLength');
        let a = this.ui.cmpA != null ? this.runAt(this.ui.cmpA) : null, b = this.ui.cmpB != null ? this.runAt(this.ui.cmpB) : null;
        const same = runs.filter((r) => r.length === len), pool = same.length ? same : runs;
        if (!a) a = M.bestRun(pool, a || b ? (a || b).length : len, true) || pool[0] || null;
        if (!b) { b = pool[pool.length - 1] || null; if (b === a && pool.length > 1) b = pool[pool.length - 2]; }
        return [a, b];
    }
}
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

/** The app's own settings (after the Display block), in the shape of app.json "settings". */
const APP_ROWS = [
    { key: 'runLength', label: 'Run length', hint: 'The distance a run is timed over', type: 'choice', default: 402, options: [[201, '201 m'], [402, '402 m'], [804, '1/2 mile']] },
    E.LIMIT_ROWS.boostMax,
    { key: 'boostTarget', label: 'Boost target', hint: 'The mark on the boost ring', type: 'number', default: 1.45, min: 0.3, max: 3, step: 0.05, decimals: 2, unit: 'bar' },
    { key: 'tyreTarget', label: 'Tyre target (hot)', hint: 'The Tyres page compares with it', type: 'number', default: 2.4, min: 1.5, max: 3.5, step: 0.05, decimals: 2, unit: 'bar' },
    { key: 'units', label: 'Units', hint: 'Speed, pressure and temperature', type: 'choice', default: 'metric', options: [['metric', 'Metric'], ['imperial', 'Imperial']] },
];
const DEFAULTS = {};
APP_ROWS.forEach((r) => { DEFAULTS[r.key] = r.default; });
Object.assign(DEFAULTS, { renderer: 'auto', fps: 60, layout: 'full', followAmbient: true, demo: 'off', demoCar: 'b48' });

module.exports = { Model, APP_ROWS, DEFAULTS, FIELDS, HIST, demoHas };
