// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog demo data: a believable evening at the strip, so every page works in the emulator, the PC preview
 * and a car that sends nothing (Settings, Demo data).
 *
 * A loop of about 50 s: the car stands at idle (READY after 1 s), the throttle opens, a full throttle run from a
 * standstill past the run length (402 m in about 12.9 s, 172 km/h at the line, boost up to about 1.42 bar against
 * a 1.45 bar target), a lift, a stop, idle again. Each run is a little different. The charge air climbs run after
 * run (the intercooler soaks heat) and cools while the car stands; the oil, gearbox and tyres warm up from cold.
 *
 *   const demo = new Demo(seed);
 *   demo.sample(tMs) -> the same fields as the car's values (see main.js now())
 *   seedRuns(RunLog, length, now) -> fills a demo RunLog with a session today and two earlier ones
 */
const M = require('./maths');

const CYCLE_IDLE = 7;        // s standing before the throttle opens
const P_M = 186, DRAG = 0.0012, TRACTION = 5.8;      // W/kg, aero (1/m), the most the tyres take (m/s²)

// the engine and gearbox (a B48 with a ZF 8HP, roughly): torque curve in Nm by rpm, gear ratios, final drive, tyre radius
const CURVE = [[800, 180], [1500, 330], [2000, 420], [3000, 488], [4000, 452], [5000, 382], [6000, 300], [6600, 255]];
const RATIOS = [0, 5.0, 3.2, 2.143, 1.72, 1.313, 1.0, 0.823, 0.64], FINAL = 2.81, WHEEL_R = 0.33, MASS = 1750, SHIFT = 6500;
const rpmFor = (ms, g) => ms / WHEEL_R * 60 / (2 * Math.PI) * RATIOS[g] * FINAL;
function torqueAt(rpm) {
    if (rpm <= CURVE[0][0]) return CURVE[0][1];
    for (let i = 1; i < CURVE.length; i++) {
        if (rpm <= CURVE[i][0]) { const a = CURVE[i - 1], b = CURVE[i]; return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]); }
    }
    return CURVE[CURVE.length - 1][1];
}
/** The gear for a speed while accelerating: the lowest that stays under the shift point. */
function gearFor(ms) { for (let g = 1; g < RATIOS.length; g++) if (rpmFor(ms, g) < SHIFT) return g; return RATIOS.length - 1; }

/** A small repeatable random number generator, so previews look the same every time. */
function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

class Demo {
    /**
     * air: the day's weather { intake (°C after the filter), kPa } (default 20.5 °C, 97.9 kPa, about 300 m up).
     * car: a demo car of lib/engine.js (default the B48): its power, torque, boost and rev limit shape the runs; a diesel
     * has no wastegate (variable vanes) and revs lower; a V8 with two engine units has bank 2's boost too; an electric
     * car has no boost, no engine temperatures and no engine unit torque.
     */
    constructor(seed, t0, air, car) {
        this.car = car || null;
        const c = car || { power: 190, torque: 400, boost: 1.4, redline: 6500 };
        this.ev = car && car.engine === false; this.diesel = !!(car && car.diesel); this.twin = !!(car && car.units === 2);
        this.kW = c.power / 190;                                     // power against the B48 the base figures are for
        this.tqK = c.torque / 400; this.boostTo = c.boost || 1.42;
        this.shift = c.redline ? c.redline - (this.diesel ? 300 : 0) : SHIFT;
        this.rand = rng(seed || 7);
        this.t0 = t0 == null ? Date.now() : t0;
        this.last = null;
        this.v = 0; this.d = 0; this.phase = 'idle'; this.phaseT = 0; this.runNo = 0;
        this.air = air || { intake: 20.5, kPa: 97.9 };
        this.boostNow = -0.55; this.wg = 100; this.charge = 27 + this.air.intake - 20.5; this.intake = this.air.intake; this.oil = 96; this.coolant = 92; this.gearbox = 66;
        this.tyreP = { FL: 2.2, FR: 2.2, RL: 2.12, RR: 2.2 }; this.tyreT = { FL: 19, FR: 19, RL: 18, RR: 19 };
        this.kPaBase = this.air.kPa;
        this.power = P_M; this.grip = TRACTION;
        this.runLen = 402;
    }

    _newRun() {
        this.runNo++;
        // the air costs power as SAE J1349 says it does (so corrected times agree across days), and so does heat soak
        const cf = M.sae(this.air.intake, this.air.kPa) || 1;
        this.power = P_M * Math.min(2.3, this.kW) * (0.975 + this.rand() * 0.04) / cf * (1 - 0.003 * Math.max(0, this.charge - 30));
        this.react = 0.32 + this.rand() * 0.2;
        this.grip = TRACTION * (0.97 + this.rand() * 0.05);
    }

    /** The exhaust gas after the catalyst (the engine unit's model): about 450 °C at idle, 850 °C at full load. */
    egtNow(throttle, dt) {
        this.egt = this.egt == null ? 460 : this.egt;
        this.egt += ((throttle ? 860 : 450) - this.egt) * Math.min(1, dt * (throttle ? 0.35 : 0.08));
        return this.egt;
    }

    /** Step the simulation to tMs and return the values. */
    sample(t) {
        t = t == null ? Date.now() : t;
        const dt = this.last == null ? 0.05 : Math.max(0, Math.min(0.25, (t - this.last) / 1000));
        this.last = t;
        this.phaseT += dt;
        let throttle = 0, a = 0;
        const runEnd = M.LENGTHS[this.runLen] + 40;
        if (this.phase === 'idle') {
            if (this.phaseT >= CYCLE_IDLE) { this.phase = 'arm'; this.phaseT = 0; this._newRun(); }
        } else if (this.phase === 'arm') {
            throttle = 1;                                       // the throttle is open, the car not moving yet
            if (this.phaseT >= this.react) { this.phase = 'run'; this.phaseT = 0; this.d = 0; }
        } else if (this.phase === 'run') {
            throttle = 1;
            const v = Math.max(0.3, this.v);
            a = Math.min(this.grip * Math.min(1, 0.35 + this.phaseT / 0.5), this.power / v) - DRAG * v * v - 0.12;
            if (this.d >= runEnd) { this.phase = 'lift'; this.phaseT = 0; }
        } else if (this.phase === 'lift') {
            a = -1;
            if (this.phaseT > 1.5) { this.phase = 'brake'; this.phaseT = 0; }
        } else if (this.phase === 'brake') {
            a = this.v > 0 ? -6.5 : 0;
            if (this.v <= 0) { this.phase = 'roll'; this.phaseT = 0; }
        } else if (this.phase === 'roll') {
            // a dyno pull: roll to about 40 km/h in 3rd, then full throttle in 3rd up to the shift point
            a = this.v < 11 ? 2 : 0;
            if (this.v >= 11 && this.phaseT > 6) { this.phase = 'pull'; this.phaseT = 0; }
        } else if (this.phase === 'pull') {
            throttle = 1;
            const rpm3 = rpmFor(this.v, 3), tq = this.torqueAt(rpm3) * this.power / P_M / Math.min(2.3, this.kW);
            a = tq * RATIOS[3] * FINAL * 0.9 / WHEEL_R / MASS - DRAG * this.v * this.v - 0.12;
            // (a weak car that cannot reach the limit in 3rd lifts after 25 s, as a driver would)
            if (rpm3 >= this.shift || this.phaseT > 25) { this.phase = 'lift2'; this.phaseT = 0; }
        } else if (this.phase === 'lift2') {
            a = -1;
            if (this.phaseT > 1) { this.phase = 'brake2'; this.phaseT = 0; }
        } else if (this.phase === 'brake2') {
            a = this.v > 0 ? -6 : 0;
            if (this.v <= 0) { this.phase = 'idle'; this.phaseT = 0; }
        }
        this.v = Math.max(0, this.v + a * dt);
        this.d += this.v * dt;
        const kmh = this.v * 3.6;

        // engine: idle, throttle blip before the car moves, rpm through the gears while running
        const third = this.phase === 'roll' || this.phase === 'pull' || this.phase === 'lift2';
        const gear = this.v < 0.3 ? 0 : third ? 3 : this.gearFor(this.v);
        let rpm = 780 + 15 * Math.sin(t / 310);
        if (this.phase === 'arm') rpm = 780 + Math.min(1, this.phaseT / 0.25) * 2200;
        else if (gear) rpm = Math.max(this.phase === 'run' && gear === 1 ? 3000 : 800, rpmFor(this.v, gear));
        const torque = throttle ? this.torqueAt(rpm) * this.power / P_M / Math.min(2.3, this.kW) + (this.rand() - 0.5) * 6 : 30;

        // boost: vacuum at idle, spools up under throttle (lags), falls when lifting
        const want = throttle ? this.boostTo + 0.03 * Math.sin(this.runNo * 1.7) : this.diesel ? 0.05 : -0.55;
        this.boostNow += (want - this.boostNow) * Math.min(1, dt * (throttle ? 1.3 : 3));
        const ambientBar = (this.kPaBase + 0.05 * Math.sin(t / 60000)) / 100;
        const manifold = ambientBar + this.boostNow;
        // the electric wastegate: open at idle and when lifting (no exhaust held back), shut while the boost builds,
        // then opening as the boost reaches the target to hold it there (more as the rpm and the exhaust flow rise)
        const near = this.boostNow >= want - 0.04;
        const wgWant = !throttle ? 100 : near ? clampN(28 + 30 * (rpm - 3500) / 3500, 22, 62) : 0;
        this.wg += (wgWant - this.wg) * Math.min(1, dt * (throttle && !near ? 9 : 4));

        // air: the charge air climbs under boost and cools at idle; the intake after the filter warms a little
        const soak = Math.min(4, this.runNo);              // the intercooler soaks heat over the first runs
        const dIn = this.air.intake - 20.5, chargeWant = (throttle ? 40 + 3 * soak : 24 + 2 * soak) + dIn;
        this.charge += (chargeWant - this.charge) * Math.min(1, dt * (throttle ? 0.12 : 0.02));
        this.intake += ((this.v > 5 ? -1 : 1) + this.air.intake - this.intake) * Math.min(1, dt * 0.05);
        // fluids warm towards running temperature
        this.oil += ((throttle ? 112 : 103) - this.oil) * Math.min(1, dt * 0.01);
        this.coolant += (96 - this.coolant) * Math.min(1, dt * 0.02);
        this.gearbox += ((throttle ? 90 : 80) - this.gearbox) * Math.min(1, dt * 0.006);
        // tyres: warm with speed, pressure follows temperature (about 0.01 bar per °C)
        M.WHEELS.forEach((k, i) => {
            const want2 = 19 + Math.min(17, kmh * 0.12) + (k === 'RL' ? -3 : 0) + i * 0.4 + Math.min(10, this.runNo * 2);
            this.tyreT[k] += (want2 - this.tyreT[k]) * Math.min(1, dt * 0.03);
            this.tyreP[k] = (k === 'RL' ? 2.07 : 2.18) + (this.tyreT[k] - 19) * 0.0115;
        });
        const r = (x, k) => Math.round(x * k) / k;
        if (this.ev) {
            return {
                demo: true, speed: kmh, gear: gear ? 1 : 0, pedal: throttle ? 100 : 0, coolant: 31 + Math.min(6, this.runNo),
                outside: this.air.intake - 2.5 + 0.3 * Math.sin(t / 90000),
                tyres: {
                    p: { FL: r(this.tyreP.FL, 100), FR: r(this.tyreP.FR, 100), RL: r(this.tyreP.RL, 100), RR: r(this.tyreP.RR, 100) },
                    t: { FL: Math.round(this.tyreT.FL), FR: Math.round(this.tyreT.FR), RL: Math.round(this.tyreT.RL), RR: Math.round(this.tyreT.RR) },
                    target: { FL: 2.5, FR: 2.5, RL: 2.7, RR: 2.7 },
                },
            };
        }
        const twin = this.twin ? { boost2: M.boost(manifold, ambientBar) - 0.03 + 0.02 * Math.sin(t / 700), wastegate2: clampN(this.wg + 4 * Math.sin(t / 900), 0, 100) } : {};
        const out = Object.assign(twin, {
            demo: true, speed: kmh, rpm: rpm, torque: torque, gear: gear, pedal: throttle ? 100 : 0,
            oil: this.oil, coolant: this.coolant, gearbox: this.gearbox, outside: this.air.intake - 2.5 + 0.3 * Math.sin(t / 90000),
            intake: this.intake, charge: this.charge, manifold: manifold, ambient: ambientBar, kPa: ambientBar * 100,
            boost: M.boost(manifold, ambientBar), boostTarget: throttle ? this.boostTo + 0.03 : null, egt: this.egtNow(throttle, dt),
            wastegate: this.wg, wgDuty: throttle ? 18 + 0.55 * (100 - this.wg) : 6,
            tyres: {
                p: { FL: r(this.tyreP.FL, 100), FR: r(this.tyreP.FR, 100), RL: r(this.tyreP.RL, 100), RR: r(this.tyreP.RR, 100) },
                t: { FL: Math.round(this.tyreT.FL), FR: Math.round(this.tyreT.FR), RL: Math.round(this.tyreT.RL), RR: Math.round(this.tyreT.RR) },
                target: { FL: 2.3, FR: 2.3, RL: 2.3, RR: 2.3 },
            },
        });
        if (this.diesel) { delete out.wastegate; delete out.wgDuty; }
        return out;
    }
    torqueAt(rpm) { return torqueAt(rpm * 6500 / Math.max(4000, this.shift + (this.diesel ? 300 : 0))) * this.tqK; }
    gearFor(ms) { for (let g = 1; g < RATIOS.length; g++) if (rpmFor(ms, g) < this.shift) return g; return RATIOS.length - 1; }
}

/**
 * Fill a demo RunLog (and a PullLog): two earlier sessions and a few runs today, each one simulated through the real timer, so
 * Runs, Log and Compare have something to show from the first second.
 */
function seedRuns(log, length, now, pulls, car) {
    now = now == null ? Date.now() : now;
    // [start, runs, seed, weather]: a cold dense evening, a warm one, today
    const plan = [[now - 9 * 86400000, 3, 11, { intake: 9, kPa: 101.6 }], [now - 2 * 86400000, 4, 23, { intake: 27, kPa: 99.2 }],
        [now - 25 * 60000, 3, 5, null]];
    plan.forEach((p) => {
        const d = new Demo(p[2], p[0], p[3], car);
        d.runLen = length;
        let t = p[0], got = 0;
        const add = log.o.onDone, air = log.o.air;
        let cur = null;
        log.o.onDone = () => { got++; };
        log.o.air = () => cur;
        const pAir = pulls ? pulls.o.air : null;
        if (pulls) pulls.o.air = () => cur;
        // (one cycle past the last run, so its dyno pull is in too)
        let after = 0;
        while ((got < p[1] || after < 32000) && t - p[0] < 600000) {
            if (got >= p[1]) after += 50;
            cur = d.sample(t);
            log.sample(t, cur);
            log.idle(t);
            if (pulls) pulls.feed(t, cur);
            t += 50;
        }
        log.o.onDone = add; log.o.air = air;
        if (pulls) pulls.o.air = pAir;
    });
    log.reset();
}

module.exports = { Demo, seedRuns, rng, torqueAt, CURVE };
