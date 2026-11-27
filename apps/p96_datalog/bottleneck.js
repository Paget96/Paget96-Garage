// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * bottleneck.js - what holds the car back under hard load (T36; owner, 2026-11-27 02:57: "find the bottleneck that
 * keeps the car from being driven hard for long: intercooler, weak plugs, a restrictive exhaust, not enough fuel or
 * air, a small turbo, not enough cooling ... so people who tune know what to upgrade first; the app says what the
 * problem is, and they still see everything that happens").
 *
 * Pure logic: the app feeds it a sample about once a second, it keeps no timers and reads nothing itself.
 *
 *   const bn = new Bottleneck({ pulls, petrol: true });   bn.feed(sample)
 *   bn.verdict() -> { stretches, hardSeconds, first (the check to upgrade first, or null),
 *                     checks: [{ key, label, state: 'limit' | 'watch' | 'ok' | 'nodata', score 0..1, words,
 *                                evidence, upgrade }] }   worst first
 *   bn.saved()   -> the kept hard stretches (JSON, for the next drive)
 *
 * sample = { t (ms), rpm, pedal (%), torque (Nm), gear, boost (bar over outside), boostTarget (bar over outside),
 *            wastegate (% open), wgDuty (%), intake, charge, outside, egt, coolant, oil, gearbox (°C), knock (° retard),
 *            lambda, rail (bar), dp (mbar across the particulate filter), misfires (a counter that only grows) }
 *            any of it may be missing.
 *
 * A hard stretch: the accelerator at 85 % or more (without the pedal: the torque at 85 % of the most seen, above
 * 2 000 rpm) for 3 s or more; it ends after 2 s off. Each stretch is boiled down to the figures below and kept (the
 * newest KEEP), so the verdict grows over several drives.
 *
 * The rules, all estimates from what the engine unit reports (not a dyno and not a workshop diagnosis):
 *   - A check is a limit only when it showed in 2 hard stretches, or in one held 8 s or more; once, it is "watch".
 *   - Turbo: boost under its target with the wastegate shut (no more to give). Short all along the pull, low revs
 *     too, points at a leak more than at the turbo; short only near the top, at the turbo.
 *   - Charge air: hotter than outside by 30 °C or more under load (the intercooler cannot shed the heat).
 *   - Power pull to pull: the same revs give less torque in a later pull of the same drive (another day has other
 *     air); the cause named is what changed with it.
 *   - Knock, misfires, fuel rail falling while the revs climb, lean at full load, EGT and the filter's pressure,
 *     coolant, oil and gearbox heat: each against a plain threshold (THRESH).
 * Node 8: no optional chaining, no object spread.
 */

const HARD_PEDAL = 85;          // % accelerator: hard load
const MIN_S = 3;                // s a stretch must last
const LONG_S = 8;               // s: one stretch this long is enough for a limit
const END_GAP = 2000;           // ms off the pedal that end a stretch
const SPOOL_MS = 1500;          // ms the turbo gets before boost is held against its target
const KEEP = 30;                // stretches kept
const SESSION_MS = 2 * 3600 * 1000;   // pulls closer than this are one drive (Power pull to pull)
const BIN = 500;                // rpm per torque bin (pull to pull)
const ALL_ALONG = 0.8;           // share of a pull short of boost: short all along points at a leak

const THRESH = {
    boostShort: 0.15,           // bar under target
    shutPos: 12,                // % open or less: the wastegate is shut
    shutDuty: 85,               // % duty or more: the wastegate is held shut
    charge: [20, 30],           // °C over outside: watch, limit
    chargeRise: 12,             // °C up within one stretch
    intake: [12, 20],           // °C intake over outside
    knock: [2, 4],              // ° retard
    railDrop: [0.07, 0.12],     // share the rail falls while the revs climb
    lean: [0.95, 1.0],          // lambda at full load (a petrol runs rich there, near 0.8 to 0.9)
    egt: [900, 950],            // °C
    dp: [200, 300],             // mbar across the filter at full load
    coolant: [105, 110],
    oil: [125, 135],
    gearbox: [105, 115],
    torqueLoss: [0.04, 0.07],   // share lost pull to pull at the same revs
};

const CHECKS = [
    { key: 'turbo', label: 'Turbo and boost', needs: ['boost', 'boostTarget'],
      upgrade: 'Check for a boost leak first (a smoke test is cheap). With no leak the turbo is at its limit: a larger or hybrid turbo, with fuel and intercooling to match.' },
    { key: 'intercooler', label: 'Charge air (intercooler)', needs: ['charge'],
      upgrade: 'A larger intercooler. Until then, give it time to cool between pulls.' },
    { key: 'power', label: 'Same power every pull', needs: ['torque', 'rpm'],
      upgrade: 'Fix what the line above names; the engine unit takes power away to protect the engine.' },
    { key: 'intake', label: 'Intake air', needs: ['intake', 'outside'],
      upgrade: 'Cold air to the filter: a heat shield or an intake that breathes from outside the engine bay.' },
    { key: 'knock', label: 'Knock control', needs: ['knock'],
      upgrade: 'Higher octane fuel first (98 or 100). If it stays: spark plugs one step colder, gapped a little smaller.' },
    { key: 'spark', label: 'Spark under load', needs: ['misfires'], nodataWords: 'Datalog does not read misfires yet; Health shows them per cylinder.',
      upgrade: 'New spark plugs (one step colder on a tuned engine, gap a little smaller), then the coils.' },
    { key: 'fuel', label: 'Fuel delivery', needs: ['rail', 'lambda'], any: true,
      upgrade: 'Rail pressure falling: the high pressure fuel pump. Lean with the rail holding: the low pressure pump or the injectors.' },
    { key: 'exhaust', label: 'Exhaust flow', needs: ['egt', 'dp'], any: true,
      upgrade: 'Check the particulate filter first (a full one chokes the engine). Then a freer downpipe, where it is legal.' },
    { key: 'cooling', label: 'Engine cooling', needs: ['coolant', 'oil'], any: true,
      upgrade: 'An oil cooler or a larger radiator.' },
    { key: 'gearbox', label: 'Gearbox heat', needs: ['gearbox'],
      upgrade: 'A gearbox oil cooler.' },
];

const isNum = (x) => typeof x === 'number' && isFinite(x);
/* how the words write a temperature (abs), a temperature difference and a pressure; verdict(fmt) swaps them */
const METRIC = { temp: (c) => Math.round(c) + ' °C', dtemp: (c) => Math.round(c) + ' °C', press: (b) => b.toFixed(2) + ' bar' };
let F = METRIC;
const r0 = (x) => Math.round(x);
const r2 = (x) => Math.round(x * 100) / 100;

/** An empty stretch summary. */
function blank(t) {
    return {
        at: t, end: t, n: 0, rpmLo: null, rpmHi: null, seen: {},
        post: 0, short: 0, shortMax: 0, shortRpm: null, shutSeen: false,
        chargeOver: null, chargeFirst: null, chargeLast: null, intakeOver: null,
        knock: null, knockN: 0, mis0: null, mis1: null,
        rail0: null, railLast: null, railRpm0: null, lambdaMax: null,
        egt: null, dp: null, coolant: null, oil: null, gearbox: null, bins: {},
    };
}
const maxIn = (a, b) => (isNum(b) ? (isNum(a) ? Math.max(a, b) : b) : a);

class Bottleneck {
    constructor(o) {
        o = o || {};
        this.petrol = o.petrol !== false;
        this.pulls = Array.isArray(o.pulls) ? o.pulls.slice(-KEEP) : [];
        this.cur = null;
        this.offAt = null;
        this.maxTorque = 0;
        this.lastT = null;
    }

    _hard(s) {
        if (isNum(s.pedal)) return s.pedal >= HARD_PEDAL;
        return isNum(s.torque) && isNum(s.rpm) && s.rpm > 2000 && this.maxTorque > 0 && s.torque >= 0.85 * this.maxTorque;
    }

    feed(s) {
        if (!s || !isNum(s.t)) return;
        this.lastT = s.t;
        if (isNum(s.torque) && s.torque > this.maxTorque) this.maxTorque = s.torque;
        if (this._hard(s)) {
            this.offAt = null;
            if (!this.cur) this.cur = blank(s.t);
            this._add(this.cur, s);
        } else if (this.cur) {
            if (this.offAt == null) this.offAt = s.t;
            if (s.t - this.offAt >= END_GAP) this._close();
        }
    }

    /** Ends the stretch going on (the engine stopped, the app closes). */
    flush() { if (this.cur) this._close(); }

    _close() {
        const c = this.cur;
        this.cur = null; this.offAt = null;
        if (!c || (c.end - c.at) / 1000 < MIN_S) return;
        c.seen = Object.keys(c.seen);
        this.pulls.push(c);
        if (this.pulls.length > KEEP) this.pulls.shift();
    }

    _add(c, s) {
        c.end = s.t; c.n++;
        Object.keys(s).forEach((k) => { if (isNum(s[k])) c.seen[k] = true; });
        if (isNum(s.rpm)) { c.rpmLo = c.rpmLo == null ? s.rpm : Math.min(c.rpmLo, s.rpm); c.rpmHi = maxIn(c.rpmHi, s.rpm); }
        const air = isNum(s.outside) ? s.outside : null;
        // turbo: short of target with nothing left (the wastegate shut), after the turbo had time to spool
        if (isNum(s.boost) && isNum(s.boostTarget) && s.t - c.at >= SPOOL_MS) {
            const short = s.boostTarget - s.boost;
            const shut = isNum(s.wastegate) ? s.wastegate <= THRESH.shutPos : isNum(s.wgDuty) ? s.wgDuty >= THRESH.shutDuty : null;
            if (shut) c.shutSeen = true;
            c.post++;
            if (short >= THRESH.boostShort && shut !== false) {
                c.short++;
                if (short > c.shortMax) { c.shortMax = short; c.shortRpm = isNum(s.rpm) ? s.rpm : null; }
            }
        }
        if (isNum(s.charge)) {
            if (c.chargeFirst == null) c.chargeFirst = s.charge;
            c.chargeLast = s.charge;
            if (air != null) c.chargeOver = maxIn(c.chargeOver, s.charge - air);
        }
        if (isNum(s.intake) && air != null) c.intakeOver = maxIn(c.intakeOver, s.intake - air);
        if (isNum(s.knock)) { const k = Math.abs(s.knock); c.knock = maxIn(c.knock, k); if (k >= THRESH.knock[0]) c.knockN++; }
        if (isNum(s.misfires)) { if (c.mis0 == null) c.mis0 = s.misfires; c.mis1 = s.misfires; }
        if (isNum(s.rail)) {
            if (c.rail0 == null) { c.rail0 = s.rail; c.railRpm0 = isNum(s.rpm) ? s.rpm : null; }
            else c.rail0 = Math.max(c.rail0, s.rail);
            c.railLast = s.rail;
        }
        if (isNum(s.lambda) && s.t - c.at >= SPOOL_MS) c.lambdaMax = maxIn(c.lambdaMax, s.lambda);
        ['egt', 'dp', 'coolant', 'oil', 'gearbox'].forEach((k) => { c[k] = maxIn(c[k], s[k]); });
        if (isNum(s.torque) && isNum(s.rpm) && s.t - c.at >= SPOOL_MS) {
            const b = String(Math.floor(s.rpm / BIN) * BIN);
            c.bins[b] = maxIn(c.bins[b], s.torque);
        }
    }

    saved() { return this.pulls.slice(); }

    /**
     * The value a check is judged on, one per hard pull (the newest n): { kind ('press' | 'dtemp' | 'temp' | 'deg' |
     * 'num' | 'pct' | 'nm' | 'lambda'), lo (watch line), hi (limit line), values: [number or null] } or null.
     */
    series(key, n) {
        const ps = this.pulls.slice(-(n || 20)), pick = SERIES[key];
        if (!pick) return null;
        if (key === 'power') {
            // torque lost against the first pull of the same drive, %, as JUDGE.power counts it (the first: none)
            const loss = lossByPull(this.pulls);
            return { kind: 'pct', lo: 100 * THRESH.torqueLoss[0], hi: 100 * THRESH.torqueLoss[1], label: 'torque lost against the first pull of the drive',
                values: loss.slice(-(n || 20)).map((x) => (isNum(x) ? Math.max(0, 100 * x) : null)) };
        }
        return { kind: pick[1], lo: pick[2], hi: pick[3], label: pick[4], values: ps.map((p) => { const x = pick[0](p); return isNum(x) ? x : null; }) };
    }

    /** fmt: { temp(°C), dtemp(°C), press(bar) } -> text, for the units setting (default metric). */
    verdict(fmt) {
        F = fmt ? Object.assign({}, METRIC, fmt) : METRIC;
        const ps = this.pulls, has = {};
        ps.forEach((p) => { (p.seen || []).forEach((k) => { has[k] = true; }); });
        const hardSeconds = r0(ps.reduce((a, p) => a + (p.end - p.at) / 1000, 0));
        const checks = CHECKS.map((d) => {
            const ok = d.any ? d.needs.some((k) => has[k]) : d.needs.every((k) => has[k]);
            const out = { key: d.key, label: d.label, upgrade: d.upgrade, state: 'nodata', score: 0, words: '', evidence: '' };
            if (!ps.length) { out.words = 'Drive one hard pull (full throttle for 3 s or more) and this fills in.'; return out; }
            if (!ok) { out.words = d.nodataWords || 'Datalog does not get this value from this car.'; return out; }
            const r = JUDGE[d.key](ps, this) || { hits: 0, score: 0 };
            const long = r.hitPulls ? r.hitPulls.some((p) => (p.end - p.at) / 1000 >= LONG_S) : false;
            out.score = Math.max(0, Math.min(1, r.score || 0));
            out.state = r.hits >= 2 || (r.hits >= 1 && long) ? (out.score >= 0.5 ? 'limit' : 'watch') : r.hits >= 1 || out.score >= 0.25 ? 'watch' : 'ok';
            out.words = out.state === 'ok' ? r.okWords || 'Keeps up under load.' : r.words || '';
            out.evidence = r.evidence || '';
            return out;
        });
        const rank = { limit: 0, watch: 1, ok: 2, nodata: 3 };
        checks.sort((a, b) => rank[a.state] - rank[b.state] || b.score - a.score);
        const first = checks[0] && checks[0].state === 'limit' ? checks[0] : null;
        return { stretches: ps.length, hardSeconds, first, checks };
    }
}

/* 0 under the watch line lo, 0.25 to 0.5 up to the limit line hi, then up to 1 one more step (hi - lo) past it */
function grade(v, lo, hi) {
    if (!isNum(v) || v < lo) return 0;
    const step = Math.max(1e-9, hi - lo);
    return v < hi ? 0.25 + 0.25 * (v - lo) / step : Math.min(1, 0.5 + 0.5 * (v - hi) / step);
}
/* pulls where field f reaches lo, the worst value and the score */
function over(ps, f, lim) {
    const hit = ps.filter((p) => isNum(p[f]) && p[f] >= lim[0]);
    const worst = ps.reduce((a, p) => maxIn(a, p[f]), null);
    return { hitPulls: hit, hits: hit.length, worst, score: grade(worst, lim[0], lim[1]) };
}
const rpmText = (x) => (isNum(x) ? (Math.round(x / 100) * 100).toLocaleString('en-US').replace(/,/g, ' ') + ' rpm' : '');
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times');

const peakTorque = (p) => Object.keys(p.bins || {}).reduce((a, b) => maxIn(a, p.bins[b]), null);
/* per pull: the share of torque lost against the first pull of its drive, at the same revs (null: the first, or too few
   rev bands in common) */
function lossByPull(ps) {
    let first = null;
    return ps.map((p, i) => {
        if (!first || p.at - ps[i - 1].end > SESSION_MS) { first = p; return null; }
        const bins = Object.keys(p.bins).filter((b) => isNum(first.bins[b]) && first.bins[b] > 0);
        if (bins.length < 2) return null;
        return bins.reduce((a, b) => a + (first.bins[b] - p.bins[b]) / first.bins[b], 0) / bins.length;
    });
}
/* key -> [value of a pull, kind, watch line, limit line, what it is] */
const SERIES = {
    turbo: [(p) => (p.short >= 2 ? p.shortMax : 0), 'press', THRESH.boostShort, 0.3, 'boost short of target'],
    intercooler: [(p) => p.chargeOver, 'dtemp', THRESH.charge[0], THRESH.charge[1], 'charge air over outside'],
    power: [peakTorque, 'nm', null, null, 'most torque'],     // (series() gives the loss instead)
    intake: [(p) => p.intakeOver, 'dtemp', THRESH.intake[0], THRESH.intake[1], 'intake air over outside'],
    knock: [(p) => p.knock, 'deg', THRESH.knock[0], THRESH.knock[1], 'ignition pulled back'],
    spark: [(p) => (isNum(p.mis0) && isNum(p.mis1) ? p.mis1 - p.mis0 : null), 'num', 1, 3, 'misfires'],
    fuel: [(p) => (isNum(p.rail0) && isNum(p.railLast) && p.rail0 > 0 ? 100 * (p.rail0 - p.railLast) / p.rail0 : null), 'pct', 100 * THRESH.railDrop[0], 100 * THRESH.railDrop[1], 'rail pressure fall'],
    exhaust: [(p) => p.egt, 'temp', THRESH.egt[0], THRESH.egt[1], 'exhaust gas'],
    cooling: [(p) => p.oil, 'temp', THRESH.oil[0], THRESH.oil[1], 'engine oil'],
    gearbox: [(p) => p.gearbox, 'temp', THRESH.gearbox[0], THRESH.gearbox[1], 'gearbox oil'],
};

const JUDGE = {
    turbo(ps) {
        const hit = ps.filter((p) => p.short >= 2);
        const worst = ps.reduce((a, p) => maxIn(a, p.short >= 2 ? p.shortMax : null), null);
        const shut = ps.some((p) => p.shutSeen);
        const low = hit.filter((p) => p.post && p.short / p.post >= ALL_ALONG).length;
        if (!hit.length) return { hits: 0, score: 0, okWords: 'Boost reaches its target in every hard pull.' };
        const at = hit.reduce((a, p) => (p.shortMax === worst ? p.shortRpm : a), null);
        const why = !shut ? 'This car does not say whether the wastegate is shut, so it may also be the engine unit holding boost back.'
            : low * 2 >= hit.length ? 'Short all along the pull with the wastegate shut, low revs too: that points at a boost leak more than at the turbo.'
                : 'Short at high revs with the wastegate shut: the turbo has nothing more to give.';
        return { hitPulls: hit, hits: hit.length, score: grade(worst, THRESH.boostShort, 0.3),
            words: 'Boost stays under its target. ' + why,
            evidence: 'Up to ' + F.press(r2(worst)) + ' short' + (at ? ' at ' + rpmText(at) : '') + ', ' + times(hit.length) + ' in ' + ps.length + ' hard pulls.' };
    },
    intercooler(ps) {
        const r = over(ps, 'chargeOver', THRESH.charge);
        const rise = ps.filter((p) => isNum(p.chargeFirst) && isNum(p.chargeLast) && p.chargeLast - p.chargeFirst >= THRESH.chargeRise);
        const hitPulls = r.hitPulls.concat(rise.filter((p) => r.hitPulls.indexOf(p) < 0));
        const maxRise = ps.reduce((a, p) => maxIn(a, isNum(p.chargeFirst) && isNum(p.chargeLast) ? p.chargeLast - p.chargeFirst : null), null);
        if (!hitPulls.length) return { hits: 0, score: 0, okWords: isNum(r.worst) ? 'Charge air stays within ' + F.dtemp(r.worst) + ' of outside.' : 'Charge air stays cool.' };
        return { hitPulls, hits: hitPulls.length, score: Math.max(r.score, grade(maxRise, THRESH.chargeRise, 20)),
            words: 'The air after the intercooler gets hot under load, so the engine unit takes ignition and boost away.',
            evidence: (isNum(r.worst) ? 'Up to ' + F.dtemp(r.worst) + ' over outside' : '') + (isNum(maxRise) && maxRise >= THRESH.chargeRise ? (isNum(r.worst) ? ', ' : '') + F.dtemp(maxRise) + ' up within one pull' : '') + '.' };
    },
    power(ps) {
        // only within one session (pulls less than SESSION_MS apart): another day has other air, which is no fault
        const loss = lossByPull(ps);
        let first = null, worst = 0, worstP = null, worstFirst = null, pairs = 0;
        const hit = [];
        ps.forEach((p, i) => {
            if (!first || p.at - ps[i - 1].end > SESSION_MS) first = p;
            if (!isNum(loss[i])) return;
            pairs++;
            if (loss[i] >= THRESH.torqueLoss[0]) hit.push(p);
            if (loss[i] > worst) { worst = loss[i]; worstP = p; worstFirst = first; }
        });
        if (!pairs) return { hits: 0, score: 0, okWords: 'Needs two hard pulls in one drive to compare.' };
        if (!hit.length) return { hits: 0, score: 0, okWords: 'The same revs give the same torque pull after pull.' };
        first = worstFirst;
        // what changed with it
        const d = (k) => (isNum(worstP[k]) && isNum(first[k]) ? worstP[k] - first[k] : null);
        const cause = (d('chargeLast') || 0) >= 8 ? 'the charge air was ' + F.dtemp(d('chargeLast')) + ' hotter (heat soak)'
            : (d('egt') || 0) >= 40 ? 'the exhaust was ' + F.dtemp(d('egt')) + ' hotter'
                : (d('coolant') || 0) >= 5 || (d('oil') || 0) >= 8 ? 'the engine was hotter'
                    : (d('knock') || 0) >= 1.5 ? 'knock control pulled more timing'
                        : 'nothing this app sees changed with it (unsure)';
        return { hitPulls: hit, hits: hit.length, score: grade(worst, THRESH.torqueLoss[0], THRESH.torqueLoss[1]),
            words: 'Later pulls make less torque at the same revs: ' + cause + '.',
            evidence: 'Up to ' + r0(worst * 100) + ' % less than the first pull, ' + times(hit.length) + '.' };
    },
    intake(ps) {
        const r = over(ps, 'intakeOver', THRESH.intake);
        if (!r.hits) return { hits: 0, score: 0, okWords: 'The engine breathes air close to outside temperature.' };
        return Object.assign(r, { words: 'The filter takes in warm air from the engine bay, which costs power before the turbo even starts.',
            evidence: 'Intake air up to ' + F.dtemp(r.worst) + ' over outside, ' + times(r.hits) + '.' });
    },
    knock(ps) {
        const hit = ps.filter((p) => p.knockN >= 2 && p.knock >= THRESH.knock[0]);
        const worst = ps.reduce((a, p) => maxIn(a, p.knock), null);
        if (!hit.length) return { hits: 0, score: 0, okWords: 'No knock worth naming under load.' };
        return { hitPulls: hit, hits: hit.length, score: grade(worst, THRESH.knock[0], THRESH.knock[1]),
            words: 'The engine knocks under load and its engine unit pulls ignition back, which costs power and heat.',
            evidence: 'Up to ' + worst.toFixed(1) + '° pulled back, ' + times(hit.length) + '.' };
    },
    spark(ps) {
        const hit = ps.filter((p) => isNum(p.mis0) && isNum(p.mis1) && p.mis1 > p.mis0);
        const most = ps.reduce((a, p) => Math.max(a, isNum(p.mis0) && isNum(p.mis1) ? p.mis1 - p.mis0 : 0), 0);
        if (!hit.length) return { hits: 0, score: 0, okWords: 'No misfires under load.' };
        return { hitPulls: hit, hits: hit.length, score: grade(most, 1, 3),
            words: 'Cylinders miss a stroke under boost: typical of worn or too hot spark plugs, or a weak coil.',
            evidence: most + ' misfire' + (most === 1 ? '' : 's') + ' in one pull, ' + times(hit.length) + '.' };
    },
    fuel(ps, bn) {
        const drops = ps.map((p) => (isNum(p.rail0) && isNum(p.railLast) && p.rail0 > 0 && (p.rpmHi || 0) - (p.railRpm0 || 0) > 800 ? (p.rail0 - p.railLast) / p.rail0 : null));
        const dropHit = ps.filter((p, i) => isNum(drops[i]) && drops[i] >= THRESH.railDrop[0]);
        const worstDrop = drops.reduce((a, x) => maxIn(a, x), null);
        const lean = bn.petrol ? over(ps, 'lambdaMax', THRESH.lean) : { hits: 0, hitPulls: [], score: 0, worst: null };
        const hitPulls = dropHit.concat(lean.hitPulls.filter((p) => dropHit.indexOf(p) < 0));
        if (!hitPulls.length) return { hits: 0, score: 0, okWords: 'Fuel keeps up: the rail holds and the mixture stays rich at full load.' };
        const parts = [];
        if (dropHit.length) parts.push('the rail pressure falls ' + r0(worstDrop * 100) + ' % while the revs climb');
        if (lean.hits) parts.push('lambda reaches ' + lean.worst.toFixed(2) + ' at full load');
        return { hitPulls, hits: hitPulls.length, score: Math.max(grade(worstDrop, THRESH.railDrop[0], THRESH.railDrop[1]), lean.score),
            words: dropHit.length ? 'The fuel pump cannot keep up at full load.' : 'The engine runs lean at full load: not enough fuel for the air.',
            evidence: parts.join(', and ').replace(/^./, (c) => c.toUpperCase()) + '; ' + times(hitPulls.length) + '.' };
    },
    exhaust(ps) {
        const e = over(ps, 'egt', THRESH.egt), p = over(ps, 'dp', THRESH.dp);
        const hitPulls = e.hitPulls.concat(p.hitPulls.filter((x) => e.hitPulls.indexOf(x) < 0));
        if (!hitPulls.length) return { hits: 0, score: 0, okWords: 'The exhaust lets the gas out: temperatures and back pressure stay normal.' };
        const parts = [];
        if (e.hits) parts.push('exhaust gas up to ' + F.temp(e.worst));
        if (p.hits) parts.push(r0(p.worst) + ' mbar across the particulate filter');
        return { hitPulls, hits: hitPulls.length, score: Math.max(e.score, p.score),
            words: p.hits ? 'The exhaust pushes back: the gas cannot leave fast enough, which heats the turbo and costs power.' : 'The exhaust gas runs very hot: the engine unit adds fuel to cool it and takes power away.',
            evidence: parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + ', ' + times(hitPulls.length) + '.' };
    },
    cooling(ps) {
        const c = over(ps, 'coolant', THRESH.coolant), o = over(ps, 'oil', THRESH.oil);
        const hitPulls = c.hitPulls.concat(o.hitPulls.filter((x) => c.hitPulls.indexOf(x) < 0));
        if (!hitPulls.length) return { hits: 0, score: 0, okWords: 'Coolant and oil stay in their range under load.' };
        const parts = [];
        if (c.hits) parts.push('coolant up to ' + F.temp(c.worst));
        if (o.hits) parts.push('oil up to ' + F.temp(o.worst));
        return { hitPulls, hits: hitPulls.length, score: Math.max(c.score, o.score),
            words: 'The engine gets hot under load; past this the engine unit takes power away to protect it.',
            evidence: parts.join(', ').replace(/^./, (x) => x.toUpperCase()) + ', ' + times(hitPulls.length) + '.' };
    },
    gearbox(ps) {
        const r = over(ps, 'gearbox', THRESH.gearbox);
        if (!r.hits) return { hits: 0, score: 0, okWords: 'Gearbox oil stays in its range.' };
        return Object.assign(r, { words: 'The gearbox oil gets hot; the gearbox then shifts softer and can limit torque.',
            evidence: 'Up to ' + F.temp(r.worst) + ', ' + times(r.hits) + '.' });
    },
};

module.exports = { Bottleneck, CHECKS, THRESH, HARD_PEDAL, MIN_S, LONG_S, KEEP };
