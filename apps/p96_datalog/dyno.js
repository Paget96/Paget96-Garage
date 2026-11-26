// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog dyno: a dyno sheet from a full throttle pull in one gear (owner, 2026-11-26 18:15).
 *
 * While the car drives, every sample at full throttle (the accelerator pedal at 90 % or more; without the pedal: the
 * engine near the most torque seen), in one gear from 2nd up (1st is traction and launch control limited), with the
 * rpm climbing, is a piece of a pull. A pull ends when the gear changes, the torque drops (lift) or the rpm stops climbing; one that
 * covered 1 500 rpm or more is kept. Its torque is binned every 250 rpm and smoothed; power comes from torque and
 * rpm (hp = Nm x rpm / 7 121, mechanical hp). Both are corrected to standard air with the SAE J1349 factor of the
 * air at the pull, like the run times.
 *
 * Torque is the engine unit's own figure (clutch torque, or the car's torque signal): an estimate at the engine,
 * not a dyno measurement and not at the wheels.
 *
 *   const dyno = new PullLog({ file, air: () => ({ intake, kPa }) });
 *   dyno.feed(tMs, { rpm, torque, gear, pedal })     every sample (pedal %: optional)
 *   dyno.last                                 { at, gear, cf, rpm: [..], torque: [..] (Nm, measured), from, to }
 *   sheet(pull) -> { rpm, torque, power (corrected), peakPower: { v, rpm }, peakTorque: { v, rpm } }
 */
const fs = require('fs');
const M = require('./maths');

const HP = 7120.9;           // Nm x rpm / HP = mechanical hp (745.7 W)
const BIN = 250;             // rpm per point of the sheet
const MIN_SPAN = 1500;       // rpm a pull must cover
const KEEP = 20;

/** hp from torque (Nm) and rpm. */
const power = (nm, rpm) => nm * rpm / HP;

class PullLog {
    constructor(opts) {
        this.o = opts || {};
        this.pulls = [];
        this.file = this.o.file || null;
        if (this.file) {
            try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (Array.isArray(j.pulls)) this.pulls = j.pulls; } catch (e) { /* none yet */ }
        }
        this.maxTorque = 0;
        this.cur = null;
    }
    get last() { return this.pulls.length ? this.pulls[this.pulls.length - 1] : null; }

    /** Full throttle now: the pedal at 90 % or more; without a pedal reading, at least 150 Nm and 60 % of the most torque seen. */
    full(nm, pedal) {
        if (typeof pedal === 'number' && isFinite(pedal)) return pedal >= 90 && nm >= 100;
        return nm >= 150 && nm >= 0.6 * this.maxTorque;
    }

    feed(t, d) {
        const rpm = d.rpm, nm = d.torque, gear = d.gear;
        if (typeof rpm !== 'number' || typeof nm !== 'number' || !isFinite(rpm) || !isFinite(nm)) return;
        if (nm > this.maxTorque) this.maxTorque = nm;
        const c = this.cur;
        const going = typeof gear === 'number' && gear >= 2 && this.full(nm, d.pedal);
        if (c && (!going || gear !== c.gear || rpm < c.top - 80)) { this._end(t); }
        if (!going) return;
        if (!this.cur) {
            const a = this.o.air ? this.o.air() || {} : {};
            this.cur = { at: t, gear: gear, top: rpm, rpm: [], torque: [], intake: a.intake, kPa: a.kPa };
        }
        const p = this.cur;
        if (rpm >= p.top) p.top = rpm;
        p.rpm.push(Math.round(rpm)); p.torque.push(Math.round(nm * 10) / 10);
    }

    _end(t) {
        const p = this.cur;
        this.cur = null;
        if (!p || p.rpm.length < 10 || p.top - p.rpm[0] < MIN_SPAN) return;
        const cf = M.sae(p.intake, p.kPa);
        const pull = { at: Math.round(t), gear: p.gear, cf: cf === null ? null : Math.round(cf * 10000) / 10000, from: p.rpm[0], to: p.top, rpm: p.rpm, torque: p.torque };
        this.pulls.push(pull);
        if (this.pulls.length > KEEP) this.pulls.splice(0, this.pulls.length - KEEP);
        if (this.file) { try { fs.writeFileSync(this.file, JSON.stringify({ v: 1, pulls: this.pulls })); } catch (e) { if (this.o.log) this.o.log.warn('dyno: ' + e.message); } }
        if (this.o.onPull) this.o.onPull(pull);
    }
}

/**
 * The sheet of a pull: torque averaged in 250 rpm bins and smoothed (three points), corrected by the pull's factor,
 * power from it; the peaks. null without a pull.
 */
function sheet(pull) {
    if (!pull || !pull.rpm || pull.rpm.length < 2) return null;
    const bins = {};
    pull.rpm.forEach((r, i) => {
        const b = Math.round(r / BIN) * BIN;
        (bins[b] = bins[b] || []).push(pull.torque[i]);
    });
    const rpm = Object.keys(bins).map(Number).sort((a, b) => a - b);
    const raw = rpm.map((r) => bins[r].reduce((a, x) => a + x, 0) / bins[r].length);
    const cf = typeof pull.cf === 'number' && pull.cf > 0 ? pull.cf : 1;
    const torque = raw.map((v, i) => {
        const a = raw[i - 1] == null ? v : raw[i - 1], b = raw[i + 1] == null ? v : raw[i + 1];
        return (a + 2 * v + b) / 4 * cf;
    });
    const pw = torque.map((nm, i) => power(nm, rpm[i]));
    let pp = 0, pt = 0;
    pw.forEach((v, i) => { if (v > pw[pp]) pp = i; });
    torque.forEach((v, i) => { if (v > torque[pt]) pt = i; });
    return { rpm: rpm, torque: torque, power: pw, cf: cf, corrected: cf !== 1,
        peakPower: { v: pw[pp], rpm: rpm[pp] }, peakTorque: { v: torque[pt], rpm: rpm[pt] } };
}

module.exports = { PullLog, sheet, power, HP, BIN, MIN_SPAN };
