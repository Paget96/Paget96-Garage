// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog runs: times a run from a standstill with the kit's RunTimer, records what the air, the boost and the
 * temperatures did during it, and keeps the saved runs.
 *
 *   const log = new RunLog({ file, length: () => 402, air: () => ({ ... }) });
 *   log.sample(tMs, { speed, rpm, torque })   every speed / rpm sample (20 Hz or more)
 *   log.idle(tMs)                             every 50 ms between samples (a standing car sends nothing new)
 *   log.state                                 'wait' (moving or not stopped yet), 'ready', 'run'
 *   log.elapsed(tMs)                          the time on the timer
 *   log.last                                  the newest saved run, log.runs all of them (oldest first)
 *
 * A run (saved as JSON):
 *   { at, length, result: { '0-100': s, 'd201': s, ... }, trap: { d201: km/h, ... }, reaction,
 *     intake, charge, outside, kPa, cf, da, boostPeak, boostTarget, trace: [[t, v, boost, manifold, ambient,
 *     intake, charge, outside, wastegate]] } (wastegate % open, null when the car does not report it; older runs lack it)
 * the air (intake, charge, outside in °C, kPa) as it was at the launch; trace every 0.2 s of the run.
 */
const fs = require('fs');
const M = require('./maths');
function kit(name) {
    try { return require('./kit/' + name); }                                       // inside a built app
    catch (e) { return require('../../upstream-kit/kit/runtime/' + name); }        // in the repo (tests, previews)
}
const { RunTimer } = kit('run_timer');

const KEEP = 300;            // runs kept in the file
const TRACE_S = 0.2;         // trace step
const TRACE = ['t', 'v', 'boost', 'manifold', 'ambient', 'intake', 'charge', 'outside', 'wastegate'];

class RunLog {
    /**
     * opts: { file (null: kept in memory only, the demo's), length() (201 / 402 / 804), air() -> the values now
     * { intake, charge, outside, kPa, boost, manifold, ambient, boostTarget }, onDone(run), log }
     */
    constructor(opts) {
        this.o = opts || {};
        this.runs = [];
        this.file = this.o.file || null;
        if (this.file) {
            try {
                const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
                if (Array.isArray(j.runs)) this.runs = j.runs.filter((r) => r && typeof r.at === 'number' && r.result);
            } catch (e) { /* first start */ }
        }
        this.reaction = new M.Reaction();
        this._timer();
    }

    length() { const l = this.o.length ? Number(this.o.length()) : 402; return M.LENGTHS[l] ? l : 402; }

    /** A new timer for the run length now (a changed length takes effect from the next run). */
    _timer() {
        this.len = this.length();
        this.timer = new RunTimer(M.splitsFor(this.len), {
            onLaunch: () => this._launch(),
            onDone: (r) => this._done(r),
        });
        this.trace = null;
    }

    get state() { return this.timer.state === 'done' ? 'wait' : this.timer.state; }
    get last() { return this.runs.length ? this.runs[this.runs.length - 1] : null; }
    elapsed(now) { return this.timer.elapsed(now); }
    /** Speed and distance of the run going on now. */
    live() { return { dist: this.timer.dist || 0, vmax: this.timer.vmax || 0, result: this.timer.result }; }

    sample(t, d) {
        if (this.timer.state !== 'run' && this.len !== this.length()) this._timer();
        this.reaction.feed(t, d.rpm, d.torque, this.timer.state === 'ready');
        this.tLast = t;
        this.timer.feed(t, d.speed);
        if (this.timer.state === 'run' && this.trace && this.timer.t0 !== null) {
            const rt = (t - this.timer.t0) / 1000, tr = this.trace;
            if (!tr.length || rt - tr[tr.length - 1][0] >= TRACE_S - 1e-6) tr.push(this._row(rt, d.speed));
        }
    }
    idle(now) { this.timer.idle(now); }

    _row(rt, v) {
        const a = this.o.air ? this.o.air() || {} : {};
        const r = (x, k) => (typeof x === 'number' && isFinite(x) ? Math.round(x * k) / k : null);
        return [r(rt, 100), r(v, 10), r(a.boost, 1000), r(a.manifold, 1000), r(a.ambient, 1000), r(a.intake, 10), r(a.charge, 10), r(a.outside, 10), r(a.wastegate, 10)];
    }

    _launch() {
        const a = this.o.air ? this.o.air() || {} : {};
        this.atLaunch = { intake: a.intake, charge: a.charge, outside: a.outside, kPa: a.kPa, boostTarget: a.boostTarget };
        this.react = this.reaction.launch(this.tLast != null ? this.tLast : Date.now());
        this.trace = [this._row(0, 0)];
    }

    _done(r) {
        const air = this.atLaunch || {}, trace = this.trace || [];
        let peak = null;
        trace.forEach((row) => { if (typeof row[2] === 'number' && (peak === null || row[2] > peak)) peak = row[2]; });
        const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
        const cf = M.sae(air.intake, air.kPa);
        const run = {
            at: this.tLast != null ? Math.round(this.tLast) : r.at, length: this.len, result: r.result, trap: r.trap, vmax: Math.round(r.vmax * 10) / 10,
            reaction: this.react == null ? null : Math.round(this.react * 100) / 100,
            intake: num(air.intake), charge: num(air.charge), outside: num(air.outside), kPa: num(air.kPa),
            cf: cf === null ? null : Math.round(cf * 10000) / 10000, da: M.densityAltitude(air.intake, air.kPa),
            boostPeak: peak, boostTarget: num(air.boostTarget), trace: trace,
        };
        if (run.da !== null) run.da = Math.round(run.da);
        this.trace = null; this.atLaunch = null;
        // a run that never reached the first distance is not kept (a launch that was given up)
        if (typeof r.result.d201 !== 'number') return;
        this.add(run);
        if (this.o.onDone) this.o.onDone(run);
    }

    add(run) {
        this.runs.push(run);
        if (this.runs.length > KEEP) this.runs.splice(0, this.runs.length - KEEP);
        this.save();
    }

    save() {
        if (!this.file) return;
        try { fs.writeFileSync(this.file, JSON.stringify({ v: 1, runs: this.runs })); }
        catch (e) { if (this.o.log) this.o.log.warn('runs: ' + e.message); }
    }

    /** Throw the run going on away (a reset), wait for the next standstill. */
    reset() { this.timer.reset(); this.trace = null; this.reaction.reset(); }
}

/** A column of a run's trace by name ('t', 'boost', 'charge' ...): its values in order. */
function column(run, name) {
    const i = TRACE.indexOf(name);
    return run && run.trace && i >= 0 ? run.trace.map((row) => row[i]) : [];
}

module.exports = { RunLog, column, TRACE, KEEP };
