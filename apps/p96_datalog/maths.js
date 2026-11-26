// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog maths: everything a run is measured with, free of the car and the screen so it can be tested
 * (tools/tests/test_datalog.js).
 *
 *   splitsFor(length)            the splits timed for a run length (201, 402 or 804 m)
 *   Reaction                     the time from the throttle opening to the car moving
 *   sae(tempC, kPa)              the SAE J1349 correction factor
 *   densityAltitude(tempC, kPa)  the height in the standard atmosphere with the same air density
 *   correctTime / correctTrap    a time or trap speed to standard air
 *   boost(manifoldBar, ambientBar)
 *   parseMulti(uds, defs)        the values in one 22 reply that asked for several identifiers
 *   wastegateStory(pairs, target) when the wastegate opened and closed, from [boost, position] samples
 *   wastegateWords(story, fmt)   that in one plain sentence
 *   zone(kind, value)            ok / warm / bad for a temperature
 *   tyreNote(p)                  the plain words under the tyres
 *
 * Node 8: no optional chaining, no object spread.
 */

/* ---------- run lengths and splits ---------- */

const MILE_8 = 201.168, MILE_4 = 402.336, MILE_2 = 804.672;
const LENGTHS = { 201: MILE_8, 402: MILE_4, 804: MILE_2 };
const LENGTH_NAME = { 201: '201 m', 402: '402 m', 804: '1/2 mile' };

/**
 * The splits of a run of `length` (201, 402 or 804): speed windows in km/h and distances in metres, in the
 * shape kit/run_timer.js takes. The run ends when the longest distance is reached.
 */
function splitsFor(length) {
    const out = [
        { key: '0-100', label: '0 - 100 km/h', from: 0, to: 100 },
        { key: '60-100', label: '60 - 100 km/h', from: 60, to: 100 },
        { key: 'd201', label: '201 m (1/8 mile)', dist: MILE_8 },
    ];
    if (length >= 402) out.push({ key: 'd402', label: '402 m (1/4 mile)', dist: MILE_4 });
    if (length >= 804) {
        out.push({ key: '100-200', label: '100 - 200 km/h', from: 100, to: 200 });
        out.push({ key: 'd804', label: '804 m (1/2 mile)', dist: MILE_2 });
    }
    return out;
}
/** The key of the run's own distance ('d402'). */
const finalKey = (length) => 'd' + (LENGTHS[length] ? length : 402);
/** True for a distance split (corrected as a distance, it has a trap speed). */
const isDist = (key) => /^d\d+$/.test(key);

/* ---------- reaction ---------- */

/**
 * The reaction: from the moment the throttle opens to the moment the car moves. While the car stands
 * READY the engine idles; the first sample with the rpm `rise` above the idle (or a torque request over
 * `torque` Nm) is the throttle. The time on the timer starts when the car moves, so the reaction is never
 * part of a run's time: it is shown on its own.
 *
 *   const r = new Reaction();
 *   r.feed(tMs, rpm, torque, ready)  every sample while armed
 *   r.launch(tMs) -> seconds or null at the launch
 */
class Reaction {
    constructor(opts) {
        this.rise = (opts && opts.rise) || 400;
        this.torque = (opts && opts.torque) || 150;
        this.reset();
    }
    reset() { this.idle = null; this.n = 0; this.at = null; }
    feed(t, rpm, torque, ready) {
        if (!ready) { this.reset(); return; }
        const num = (x) => typeof x === 'number' && isFinite(x);
        if (this.at === null && num(rpm)) {
            // the idle: a slow average of the rpm while nothing happens
            if (this.idle === null || rpm < this.idle + this.rise) {
                this.n = Math.min(this.n + 1, 40);
                this.idle = this.idle === null ? rpm : this.idle + (rpm - this.idle) / this.n;
            }
            if (this.n >= 3 && rpm >= this.idle + this.rise) this.at = t;
        }
        if (this.at === null && num(torque) && torque >= this.torque && this.n >= 3) this.at = t;
    }
    /** The reaction in seconds when the car moved at tMs, or null (no throttle seen, or not plausible). */
    launch(t) {
        const at = this.at;
        this.reset();
        if (at === null) return null;
        const s = (t - at) / 1000;
        return s >= 0 && s <= 3 ? s : null;
    }
}

/* ---------- air: SAE J1349 ---------- */

const plausibleAir = (tempC, kPa) => typeof tempC === 'number' && isFinite(tempC) && tempC > -45 && tempC < 80 &&
    typeof kPa === 'number' && isFinite(kPa) && kPa >= 50 && kPa <= 115;

/**
 * The SAE J1349 (2004) power correction factor: CF = 1.176 * (99 / p) * sqrt((T + 273) / 298) - 0.176, with p the
 * dry air pressure in kPa and T the intake air temperature in °C. 25 °C and 99 kPa give 1.000. The car reports no
 * humidity, so the air counts as dry. CF above 1: the air was thinner or warmer than standard, the engine made less
 * than it would have in standard air. null without a plausible temperature and pressure.
 */
function sae(tempC, kPa) {
    if (!plausibleAir(tempC, kPa)) return null;
    return 1.176 * (99 / kPa) * Math.sqrt((tempC + 273) / 298) - 0.176;
}

/** Density altitude in metres (negative: denser than standard sea level air), or null. ISA: 15 °C, 101.325 kPa. */
function densityAltitude(tempC, kPa) {
    if (!plausibleAir(tempC, kPa)) return null;
    const rho = kPa * 1000 / (287.05 * (tempC + 273.15));
    return 44330.8 * (1 - Math.pow(rho / 1.225, 0.234969));
}

/**
 * A time to standard air. A run is limited by power: reaching a speed takes energy, so a speed window goes as
 * 1 / P (t / CF); covering a distance goes as P^-1/3 (t / CF^(1/3)). null without a factor.
 */
function correctTime(s, cf, dist) {
    if (typeof s !== 'number' || !isFinite(s) || typeof cf !== 'number' || !(cf > 0)) return null;
    return dist ? s / Math.cbrt(cf) : s / cf;
}
/** A trap speed to standard air: speed at the line goes as P^1/3. */
function correctTrap(v, cf) {
    if (typeof v !== 'number' || !isFinite(v) || typeof cf !== 'number' || !(cf > 0)) return null;
    return v * Math.cbrt(cf);
}
/** "thinner than standard", "denser than standard" or "standard air" for a factor. */
function airWords(cf) {
    if (typeof cf !== 'number') return 'no air data';
    if (cf > 1.003) return 'thinner than standard';
    if (cf < 0.997) return 'denser than standard';
    return 'standard air';
}

/* ---------- boost ---------- */

/**
 * Boost in bar: the intake manifold's absolute pressure minus the outside air pressure (both bar absolute).
 * Below zero is vacuum (the throttle chokes the air at idle). null without both.
 */
function boost(manifoldBar, ambientBar) {
    if (typeof manifoldBar !== 'number' || !isFinite(manifoldBar) || typeof ambientBar !== 'number' || !isFinite(ambientBar)) return null;
    if (manifoldBar < 0.05 || manifoldBar > 6 || ambientBar < 0.5 || ambientBar > 1.15) return null;
    return manifoldBar - ambientBar;
}
/** The time in s from the launch until the boost first reached `target` (bar), from a run's trace, or null. */
function timeToTarget(trace, target, col) {
    if (!trace || !(target > 0)) return null;
    for (let i = 0; i < trace.length; i++) {
        const b = trace[i][col];
        if (typeof b === 'number' && b >= target - 0.02) return trace[i][0];
    }
    return null;
}

/* ---------- the wastegate ---------- */

/** Below this the wastegate counts as closed, above WG_OPEN as fully open (% open). */
const WG_CLOSED = 15, WG_OPEN = 85;

/**
 * When the wastegate opened and closed, from samples in time order: pairs = [[boost bar, wastegate % open], ...]
 * (a run's trace or the last minute; a sample with a missing value is skipped). target: the boost target (bar).
 *   idle     mean position with the throttle closed (boost under -0.2 bar)
 *   build    mean position while boost climbs (from 0.1 bar to 80 % of the peak)
 *   opensAt  the boost when it first opened (20 % or more) after it was closed under boost
 *   hold     mean position at the top (90 % of the peak or more)
 *   peak     the most boost; over / under: how far the peak went past or stayed short of the target (0.15 bar or more)
 * Every field is null when the samples do not show it (no full throttle in them: build, opensAt, hold are null).
 */
function wastegateStory(pairs, target) {
    const ps = (pairs || []).filter((p) => p && typeof p[0] === 'number' && isFinite(p[0]) && typeof p[1] === 'number' && isFinite(p[1]));
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const out = { idle: null, build: null, opensAt: null, hold: null, peak: null, over: null, under: null };
    if (!ps.length) return out;
    out.idle = mean(ps.filter((p) => p[0] <= -0.2).map((p) => p[1]));
    const peak = Math.max.apply(null, ps.map((p) => p[0]));
    out.peak = peak;
    if (peak < 0.4) return out;
    const build = [];
    let armed = false;
    for (let i = 1; i < ps.length; i++) {
        const b = ps[i][0], w = ps[i][1];
        if (b >= 0.1 && b <= peak * 0.8 && b > ps[i - 1][0]) build.push(w);
        if (b >= 0.3 && w <= WG_CLOSED) armed = true;
        else if (armed && out.opensAt === null && b >= 0.3 && w >= 20) out.opensAt = b;
    }
    out.build = mean(build);
    out.hold = mean(ps.filter((p) => p[0] >= peak * 0.9).map((p) => p[1]));
    if (target > 0 && peak >= target + 0.15) out.over = peak - target;
    if (target > 0 && peak <= target - 0.15) out.under = target - peak;
    return out;
}

/**
 * The story in one plain sentence, and whether it looks right: { text, level: 'ok' | 'warm' | 'dim' }.
 * fmt(bar) writes a pressure with its unit ("1.42 bar").
 *   "Closed while boost builds, opens at 1.42 bar to hold the target, fully open at idle"
 */
function wastegateWords(s, fmt) {
    const parts = [];
    let level = 'ok';
    if (s.over !== null) { parts.push('boost went ' + fmt(s.over) + ' past the target'); level = 'warm'; }
    if (s.under !== null) { parts.push('boost stayed ' + fmt(s.under) + ' short of the target'); level = 'warm'; }
    if (s.build !== null) parts.push(s.build <= WG_CLOSED ? 'closed while boost builds' : 'still ' + Math.round(s.build) + ' % open while boost builds');
    if (s.opensAt !== null && s.over === null) parts.push('opens at ' + fmt(s.opensAt) + ' to hold the target');
    if (s.idle !== null) parts.push(s.idle >= WG_OPEN ? 'fully open at idle' : s.idle <= WG_CLOSED ? 'closed at idle' : Math.round(s.idle) + ' % open at idle');
    if (s.build === null && s.over === null && s.under === null) {
        parts.push('full throttle once to see when it opens');
        if (parts.length === 1) level = 'dim';
    }
    const text = parts.join(', ');
    return { text: text.charAt(0).toUpperCase() + text.slice(1), level: level };
}

/** The position in a word: closed, partly open or open. */
const wastegateState = (w) => (typeof w !== 'number' || !isFinite(w) ? '--' : w <= WG_CLOSED ? 'closed' : w >= WG_OPEN ? 'open' : 'partly open');

/* ---------- reading several identifiers at once ---------- */

/**
 * The values in a positive reply to 22 with several identifiers (62 <DID> <data> <DID> <data> ...).
 * defs: { 'DID hex': { bytes, factor, offset, signed } }. Returns { 'DID hex': value }; an identifier the reply
 * left out is missing. Stops at an identifier it has no definition for (its length is unknown).
 */
function parseMulti(uds, defs) {
    const out = {};
    if (!uds || uds[0] !== 0x62) return out;
    let i = 1;
    while (i + 2 <= uds.length) {
        const id = ((uds[i] << 8) | uds[i + 1]).toString(16).toUpperCase();
        const key = ('0000' + id).slice(-4), d = defs[key];
        if (!d) break;
        const n = d.bytes || 1;
        if (i + 2 + n > uds.length) break;
        let raw = 0;
        for (let k = 0; k < n; k++) raw = raw * 256 + uds[i + 2 + k];
        if (d.signed && raw >= Math.pow(2, 8 * n - 1)) raw -= Math.pow(2, 8 * n);
        if (!(d.invalid != null && raw === d.invalid)) out[key] = raw * (d.factor == null ? 1 : d.factor) + (d.offset || 0);
        i += 2 + n;
    }
    return out;
}

/* ---------- zones ---------- */

/**
 * The colour zones of the temperatures (°C): below `cold` still warming (amber), up to `hot` ok (green), up to
 * `limit` warm (amber), above it red. For the air temperatures lower is better: up to `hot` green.
 */
const ZONES = {
    oil: { cold: 70, hot: 120, limit: 135, max: 150 },
    coolant: { cold: 70, hot: 110, limit: 118, max: 130 },
    gearbox: { cold: 50, hot: 110, limit: 125, max: 140 },
    intake: { hot: 35, limit: 50, max: 70 },
    charge: { hot: 45, limit: 60, max: 80 },
    egt: { hot: 850, limit: 950, max: 1050 },
};
function zone(kind, v) {
    const z = ZONES[kind];
    if (!z || typeof v !== 'number' || !isFinite(v)) return 'dim';
    if (z.cold != null && v < z.cold) return 'warm';
    if (v <= z.hot) return 'ok';
    if (v <= z.limit) return 'warm';
    return 'bad';
}
/** The words for a zone ('ready', 'warming up', 'hot', 'too hot'). */
function zoneWords(kind, v) {
    const z = ZONES[kind], c = zone(kind, v);
    if (c === 'dim') return 'no data';
    if (c === 'ok') return z.cold != null ? 'ready' : 'cool';
    if (c === 'warm') return z.cold != null && v < z.cold ? 'warming up' : 'warm';
    return 'too hot';
}

/* ---------- tyres ---------- */

const WHEELS = ['FL', 'FR', 'RL', 'RR'];
const WHEEL_NAME = { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right' };
/**
 * The plain words about the four pressures { FL, FR, RL, RR } (bar): the tyre furthest from the other three when
 * it is 0.08 bar or more off, else that they are even. { text, odd (the wheel), diff (bar, signed) }.
 */
function tyreNote(p) {
    const ks = WHEELS.filter((k) => p && typeof p[k] === 'number' && isFinite(p[k]));
    if (ks.length < 4) return { text: 'Waiting for the tyre sensors.', odd: null, diff: 0 };
    let odd = null, diff = 0;
    ks.forEach((k) => {
        const others = ks.filter((x) => x !== k), mean = others.reduce((a, x) => a + p[x], 0) / others.length;
        const d = p[k] - mean;
        if (Math.abs(d) > Math.abs(diff)) { diff = d; odd = k; }
    });
    if (Math.abs(diff) < 0.08) return { text: 'All four tyres are within 0.08 bar of each other.', odd: null, diff: diff };
    return { text: WHEEL_NAME[odd] + ' is ' + Math.abs(diff).toFixed(2) + ' bar ' + (diff < 0 ? 'below' : 'above') + ' the others.', odd: odd, diff: diff };
}

/* ---------- runs ---------- */

/** The best of a list of runs by their final time (the corrected one when corrected is true), or null. */
function bestRun(runs, length, corrected) {
    const k = finalKey(length);
    let best = null, bv = Infinity;
    (runs || []).forEach((r) => {
        if (!r || r.length !== length || !r.result || typeof r.result[k] !== 'number') return;
        const v = corrected && typeof r.cf === 'number' ? correctTime(r.result[k], r.cf, true) : r.result[k];
        if (v < bv) { bv = v; best = r; }
    });
    return best;
}
/** Runs grouped into sessions: runs less than `gapMs` apart (default 2 h) are one session. Newest first. */
function sessions(runs, gapMs) {
    gapMs = gapMs || 2 * 3600 * 1000;
    const list = (runs || []).slice().sort((a, b) => a.at - b.at), out = [];
    let cur = null;
    list.forEach((r) => {
        if (!cur || r.at - cur.end > gapMs) { cur = { start: r.at, end: r.at, runs: [] }; out.push(cur); }
        cur.runs.push(r); cur.end = r.at;
    });
    return out.reverse();
}
/**
 * Heat soak: the charge air at the launch 15 °C or more over the intake air after the filter means the intercooler
 * is heat soaked and the run lost power to warm air.
 */
function heatSoaked(r) { return !!(r && typeof r.charge === 'number' && typeof r.intake === 'number' && r.charge - r.intake >= 15); }

module.exports = {
    MILE_8, MILE_4, MILE_2, LENGTHS, LENGTH_NAME, splitsFor, finalKey, isDist, Reaction,
    sae, densityAltitude, correctTime, correctTrap, airWords, boost, timeToTarget, parseMulti,
    WG_CLOSED, WG_OPEN, wastegateStory, wastegateWords, wastegateState,
    ZONES, zone, zoneWords, WHEELS, WHEEL_NAME, tyreNote, bestRun, sessions, heatSoaked,
};
