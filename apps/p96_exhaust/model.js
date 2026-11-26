// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Exhaust's model: the engine unit's values and what they mean. No car, no screen in here, so the tests run it.
 *
 *   CATALOG       the exhaust values the engine unit reports (BMW's DME8FF_R tables, the same Live Data reads)
 *   Regen         a regeneration seen from the outside: filter hot and soot falling (no status signal found)
 *   drives()      the drive lengths of a week and whether the filter gets the chance to clean itself
 *   ashFuture()   how fast ash grows and when the filter is full of it (an estimate)
 *   lightOff()    how long the catalyst took to warm up after a cold start
 *   sound()       how much each part of the exhaust damps the sound, from the Setup page
 *   tips()        a better sound without changing anything, each tip with a live check, and the sound score
 *   flapWeek()    how long the flap was open, closed or the car's, and per rule
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */
const R = require('./rules');
function need(local, repo) {
    try { return require(local); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return require(repo); }
}
const E = need('./garage_engine', '../../lib/engine');
const CT = need('./garage_time', '../../lib/cartime');   // the car's time (the head unit keeps UTC)

const DAY = 86400000, WEEK = 7 * DAY, MIN = 60000;

/**
 * The values, in the order they are tried: the first identifier that answers is used from then on. t: s16, u16, u8;
 * value = raw x k + o. min / max: a value outside is not believed (a unit that answers with a filler).
 * Load is the engine unit's adapted total load of the filter; we read 1.0 as full (unsure: no unit in BMW's table).
 */
const CATALOG = {
    soot: [{ did: 0x5774, t: 's16', k: 0.001, min: 0, max: 100 }, { did: 0x5444, t: 's16', k: 0.01, min: 0, max: 100 }],
    ash: [{ did: 0x558B, t: 's16', k: 0.001, min: 0, max: 300 }],
    load: [{ did: 0x558C, t: 's16', k: 0.1, min: 0, max: 150 }],
    pfTemp: [{ did: 0x579B, t: 's16', k: 0.1, o: -273.14, min: -40, max: 1200 }],
    egt: [{ did: 0x5896, t: 's16', k: 0.1, o: -273.14, min: -40, max: 1200 }, { did: 0x582F, t: 's16', k: 0.1, o: -273.14, min: -40, max: 1200 }],
    exVanos: [{ did: 0x452C, t: 's16', k: 0.1, min: -90, max: 90 }],
    engLoad: [{ did: 0x5813, t: 'u8', k: 0.75, min: 0, max: 192 }],
    catO2: [{ did: 0x5433, t: 'u16', k: 0.1, min: 1, max: 6000 }],
};
/** Reads a value from a 22 reply (62 <did> <data>) with its entry, or null. */
function decode(e, reply) {
    if (!reply || reply[0] !== 0x62 || reply.length < 4 || ((reply[1] << 8) | reply[2]) !== e.did) return null;
    let raw;
    if (e.t === 'u8') raw = reply[3];
    else {
        if (reply.length < 5) return null;
        raw = (reply[3] << 8) | reply[4];
        if (e.t === 's16' && raw & 0x8000) raw -= 0x10000;
    }
    const v = raw * e.k + (e.o || 0);
    return v < e.min || v > e.max ? null : v;
}

/* ---------- regeneration ---------- */

/** The filter temperature above which a falling soot mass counts as burning (unsure: from the regenerations BMW's
 * tables describe, 550 to 650 °C; checked on the car) and the temperature it ends below. */
const REGEN_HOT = 550, REGEN_COOL = 480;
/** Soot that must have gone from the run's highest point before it counts (filters out the sensor's wobble), g. */
const REGEN_DROP = 0.15;
/** A gap in the samples this long: the engine was off (or the screen was not shown). */
const REGEN_GAP = 2 * MIN;

/**
 * Watches the filter for regenerations. feed(t, { pfTemp, soot, load, km }) with the values when they were read; a
 * regeneration starts when the filter is hot and the soot has fallen from its recent high, and ends when the filter
 * cools, the soot stops falling for 3 minutes, or the samples stop (cut short: the engine was switched off while it
 * still ran). history: the finished ones, newest first: { start, end, mins, loadBefore, loadAfter, sootBefore,
 * sootAfter, peak, km, cut }.
 */
class Regen {
    constructor(history) {
        this.history = history || [];
        this.cur = null;            // the regeneration under way
        this.recent = [];           // [t, soot] of the last 5 minutes
        this.last = 0;
        this.loadNow = null;
    }
    feed(t, v) {
        if (this.cur && t - this.last > REGEN_GAP) this._end(this.last, true);
        this.last = t;
        if (v.load != null) this.loadNow = v.load;
        if (v.soot == null || v.pfTemp == null) return this.cur;
        this.recent.push([t, v.soot, v.load]);
        while (this.recent.length && t - this.recent[0][0] > 5 * MIN) this.recent.shift();
        const hi = this.recent.reduce((m, s) => (s[1] >= m[1] ? s : m), this.recent[0]);     // the latest time at the high
        if (!this.cur) {
            if (v.pfTemp >= REGEN_HOT && hi[1] - v.soot >= REGEN_DROP) {
                this.cur = { start: hi[0], sootBefore: hi[1], loadBefore: hi[2] != null ? hi[2] : v.load, peak: v.pfTemp, km: v.km, low: v.soot, lowAt: t };
            }
            return this.cur;
        }
        const c = this.cur;
        c.peak = Math.max(c.peak, v.pfTemp);
        c.now = v.soot; c.load = v.load; c.temp = v.pfTemp;
        if (v.soot < c.low - 0.02) { c.low = v.soot; c.lowAt = t; }
        if (v.pfTemp < REGEN_COOL || t - c.lowAt > 3 * MIN) this._end(t, false);
        return this.cur;
    }
    _end(t, gap) {
        const c = this.cur;
        this.cur = null;
        if (!c) return;
        const mins = Math.max(1, Math.round((Math.min(t, c.lowAt + MIN) - c.start) / MIN));
        const after = c.load != null ? c.load : this.loadNow;
        // cut short: the samples stopped while it still burnt, or it left more than half of the load it found
        const cut = gap || (c.loadBefore != null && after != null && after > c.loadBefore * 0.5);
        this.history.unshift({ start: c.start, end: t, mins: mins, loadBefore: c.loadBefore, loadAfter: after, sootBefore: c.sootBefore,
            sootAfter: c.low, peak: Math.round(c.peak), km: c.km, cut: !!cut });
        this.history = this.history.slice(0, 20);
    }
    /** The one under way: { mins, burnt, temp, from, to } or null. */
    now(t) {
        const c = this.cur;
        if (!c) return null;
        return { mins: Math.max(0, Math.round((t - c.start) / MIN)), burnt: Math.max(0, c.sootBefore - (c.now != null ? c.now : c.low)),
            temp: c.temp != null ? c.temp : c.peak, from: c.sootBefore, to: c.now != null ? c.now : c.low };
    }
}

/**
 * How long until the next regeneration: the load left to the mark (where the car regenerates, unsure: about 80 %),
 * and in km from how fast the load grew over the last weeks (loads: [[km, load %]], km from the app's own count).
 */
function untilNext(loadNow, loads, mark) {
    mark = mark || 80;
    if (loadNow == null) return null;
    const left = Math.max(0, mark - loadNow);
    // the growth between regenerations: only rising stretches count
    let km = 0, gain = 0;
    for (let i = 1; i < (loads || []).length; i++) {
        const dk = loads[i][0] - loads[i - 1][0], dl = loads[i][1] - loads[i - 1][1];
        if (dk > 0 && dl > 0) { km += dk; gain += dl; }
    }
    const perKm = km > 50 && gain > 0 ? gain / km : null;
    return { left: left, km: perKm ? Math.round(left / perKm / 10) * 10 : null, perKm: perKm };
}
/** The average gap between regenerations, in days and km: { days, km } or null. */
function averageGap(history) {
    const h = (history || []).filter((r) => !r.cut);
    if (h.length < 2) return null;
    let days = 0, km = 0, nk = 0;
    for (let i = 1; i < h.length; i++) {
        days += (h[i - 1].start - h[i].start) / DAY;
        if (h[i - 1].km != null && h[i].km != null) { km += h[i - 1].km - h[i].km; nk++; }
    }
    return { days: days / (h.length - 1), km: nk ? km / nk : null };
}

/* ---------- drives: does the filter get to clean itself? ---------- */

const BUCKETS = [[0, 5, '< 5 min'], [5, 10, '5 - 10'], [10, 20, '10 - 20'], [20, 40, '20 - 40'], [40, Infinity, '> 40']];
/**
 * The drives of the last 7 days (drives: [{ start, mins }]) in five lengths. short: the share under 10 minutes, too
 * short for the filter to get hot enough to clean itself. warn when most of them were short (at least 4 drives).
 */
function drives(list, now) {
    const week = (list || []).filter((d) => now - d.start <= WEEK && d.mins > 0.5);
    const counts = BUCKETS.map((b) => week.filter((d) => d.mins >= b[0] && d.mins < b[1]).length);
    const short = week.filter((d) => d.mins < 10).length;
    const share = week.length ? short / week.length : 0;
    return { counts: counts, labels: BUCKETS.map((b) => b[2]), total: week.length, short: short, share: share,
        warn: week.length >= 4 && share >= 0.6, ok: week.length >= 1 && share < 0.6 };
}

/* ---------- ash ---------- */

/** About how much ash a filter takes before a workshop cleans or replaces it, g (unsure: no figure from BMW found). */
const ASH_FULL = 45;
/**
 * The ash so far (samples [[km, g]], km from the app's own count) as a straight line: { now, per1000, kmLeft, full }
 * (kmLeft: about how many km more until full) or null with fewer than two points or no growth yet.
 */
function ashFuture(samples, full) {
    full = full || ASH_FULL;
    const s = (samples || []).filter((p) => p && p[0] != null && p[1] != null);
    if (s.length < 2) return s.length ? { now: s[s.length - 1][1], per1000: null, kmLeft: null, full: full } : null;
    const n = s.length, mx = s.reduce((a, p) => a + p[0], 0) / n, my = s.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0;
    s.forEach((p) => { sxy += (p[0] - mx) * (p[1] - my); sxx += (p[0] - mx) * (p[0] - mx); });
    const slope = sxx > 0 ? sxy / sxx : 0, now = s[n - 1][1];
    if (!(slope > 0)) return { now: now, per1000: 0, kmLeft: null, full: full };
    return { now: now, per1000: slope * 1000, kmLeft: Math.max(0, Math.round((full - now) / slope / 1000) * 1000), full: full };
}

/* ---------- cold start ---------- */

/** The catalyst works from about this exhaust temperature (light-off, unsure: 250 to 350 °C for a petrol catalyst). */
const LIGHT_OFF = 300;
/** Seconds from the start until the exhaust after the catalyst first reached the light-off temperature (curve:
 * [[seconds, °C]]), or null when it did not (yet). */
function lightOff(curve, temp) {
    temp = temp || LIGHT_OFF;
    for (let i = 0; i < (curve || []).length; i++) {
        const p = curve[i];
        if (p[1] >= temp) {
            if (!i) return p[0];
            const q = curve[i - 1];
            return Math.round(q[0] + (temp - q[1]) / (p[1] - q[1]) * (p[0] - q[0]));
        }
    }
    return null;
}
/** A cold start: the engine started with the coolant below this. */
const COLD_COOLANT = 40;
/** The cold starts of the last 7 days (starts: [{ t, coolant, mins }]): { count, short (drives under 5 min) }. */
function coldWeek(starts, now) {
    const w = (starts || []).filter((s) => now - s.t <= WEEK && s.coolant != null && s.coolant < COLD_COOLANT);
    return { count: w.length, short: w.filter((s) => s.mins != null && s.mins < 5).length };
}

/* ---------- the setup and the sound ---------- */

/** The Setup page: each part and its choices; found by itself where the car reports it. */
const SETUP = [
    { key: 'downpipe', name: 'Downpipe', choices: [['stock', 'Stock'], ['catted', 'Catted'], ['decat', 'Decat']] },
    { key: 'cat', name: 'Catalyst', choices: [['stock', 'Stock'], ['highflow', 'High flow'], ['none', 'None']] },
    { key: 'opf', name: 'OPF', choices: [['stock', 'Stock'], ['none', 'None']] },
    { key: 'mid', name: 'Middle silencer', choices: [['stock', 'Stock'], ['resdelete', 'Resonator delete'], ['straight', 'Straight pipe']] },
    { key: 'rear', name: 'Rear silencer', choices: [['stock', 'Stock'], ['aftermarket', 'Aftermarket'], ['valved', 'Valved aftermarket']] },
    { key: 'flaps', name: 'Flaps', choices: [['0', 'None'], ['1', 'One'], ['2', 'Two']] },
];
const SETUP_DEFAULT = { downpipe: 'stock', cat: 'stock', opf: 'stock', mid: 'stock', rear: 'stock', flaps: '1' };

/**
 * How much of the engine's sound is left after each part (1 = all of it), for the drawing on the Sound page. An
 * illustration of the idea, not a measurement: the turbo and the filters smooth the pulses, the silencers take most
 * of the loudness, a closed flap sends the gas the long way through the rear silencer. setup: the Setup page,
 * flap: 'OPEN', 'CLOSED' or 'OEM', fresh: the filter just regenerated (a little less damping).
 */
function sound(setup, flap, fresh, eng) {
    const s = Object.assign({}, SETUP_DEFAULT, setup || {});
    const parts = [];
    let level = 1;
    const add = (key, name, keep) => { level = Math.min(1, level * keep); parts.push({ key: key, name: name, level: level }); };
    parts.push({ key: 'engine', name: 'Engine', level: 1 });
    add('turbo', 'Turbo', s.downpipe === 'decat' ? 0.74 : s.downpipe === 'catted' ? 0.72 : 0.7);
    if (s.cat !== 'none') add('cat', 'Catalyst', s.cat === 'highflow' ? 0.95 : 0.886);
    if (s.opf !== 'none' && !(eng && eng.fuel && !eng.filter)) add('opf', E.filterName(eng && eng.fuel ? eng : { filter: 'opf' }), fresh ? 0.86 : 0.806);
    if (eng && eng.scr) add('scr', 'SCR (AdBlue)', 0.95);
    add('mid', 'Middle silencer', s.mid === 'straight' ? 1 : s.mid === 'resdelete' ? 0.85 : 0.6);
    if (s.flaps !== '0') add('flap', 'Flap', flap === 'OPEN' ? 1 : flap === 'CLOSED' ? 0.62 : 0.85);
    add('rear', 'Rear silencer', s.rear === 'aftermarket' ? 0.75 : s.rear === 'valved' ? (flap === 'OPEN' ? 0.8 : 0.6) : 0.6);
    return parts;
}

/**
 * A better sound without changing anything: five tips, each checked against the live values (null: not known now),
 * and the sound score (0 to 100, an estimate from those checks, not a measurement). v = { flap, egt, load (filter %),
 * rpm, mode, hasFlap, hasOpf }. Nothing here ever advises changing a part of the exhaust.
 */
function tips(v) {
    const list = [];
    if (v.hasFlap) list.push({ key: 'flap', w: 30, title: 'Flap open', ok: v.flap == null ? null : v.flap === 'OPEN',
        text: v.flap === 'OPEN' ? 'It is open now: the shorter way out, less damping' : 'Sport, or OPEN on the Flap page, opens it' });
    list.push({ key: 'warm', w: 20, title: 'Exhaust warm', ok: v.egt == null ? null : v.egt >= 400,
        text: v.egt == null ? 'A warm exhaust sounds deeper' : 'A warm exhaust sounds deeper; it is at ' + Math.round(v.egt) + ' °C' });
    if (v.hasOpf) list.push({ key: 'fresh', w: 15, title: 'Filter fresh', ok: v.load == null ? null : v.load < 25,
        text: 'Right after a regeneration the ' + E.filterName(v.engine && v.engine.fuel ? v.engine : { filter: 'opf' }) + ' damps a little less' + (v.load == null ? '' : '; now ' + Math.round(v.load) + ' % full') });
    list.push({ key: 'revs', w: 20, title: 'Revs 3 000 to 5 000', ok: v.rpm == null ? null : v.rpm >= 3000 && v.rpm <= 5000,
        text: 'Most engines sound fullest under load in this range' });
    list.push({ key: 'sport', w: 15, title: 'Sport mode', ok: v.mode == null ? null : R.modeClass(v.mode) === 'sport',
        text: 'Sport opens the flap on most cars and lets the engine rev higher' });
    const known = list.filter((t) => t.ok !== null);
    const wsum = list.reduce((a, t) => a + t.w, 0);
    const score = known.length ? Math.round(100 * list.reduce((a, t) => a + (t.ok ? t.w : 0), 0) / wsum) : null;
    return { list: list, score: score, ready: list.filter((t) => t.ok).length };
}

/* ---------- the flap log ---------- */

/**
 * The flap's last 7 days from its log (changes: [{ t, action, rule, reason, detail }], newest first): the time open,
 * closed and the car's, and the time each rule held it. now: the end.
 */
function flapWeek(changes, now) {
    const from = now - WEEK, ms = { OPEN: 0, CLOSED: 0, OEM: 0 }, byRule = {};
    const ch = (changes || []).slice().sort((a, b) => a.t - b.t);
    for (let i = 0; i < ch.length; i++) {
        const a = Math.max(from, ch[i].t), b = i + 1 < ch.length ? ch[i + 1].t : now;
        if (b <= a || ch[i].off) continue;
        ms[ch[i].action] = (ms[ch[i].action] || 0) + (b - a);
        if (ch[i].rule) byRule[ch[i].rule] = (byRule[ch[i].rule] || 0) + (b - a);
    }
    const total = ms.OPEN + ms.CLOSED + ms.OEM;
    const rules = Object.keys(byRule).map((k) => ({ name: k, ms: byRule[k] })).sort((a, b) => b.ms - a.ms);
    return { ms: ms, total: total, rules: rules };
}
/** "5 h 10 min", "35 min". */
function hm(ms) {
    const m = Math.round(ms / MIN), h = Math.floor(m / 60);
    return h ? h + ' h ' + (m % 60) + ' min' : m + ' min';
}
/** "5 days ago", "3 weeks ago", "today". */
function ago(t, now) {
    const d = Math.floor((now - t) / DAY);
    if (d < 1) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 14) return d + ' days ago';
    return Math.round(d / 7) + ' weeks ago';
}
/** "18:42". */
const clock = (t) => { const d = CT.carTime(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
const fmtThousands = R.thousands;

/** The load of the last 8 weeks for the History chart: one value a day (the highest), null where none. */
function loadDays(samples, now, days) {
    days = days || 56;
    const out = new Array(days).fill(null);
    (samples || []).forEach((p) => {
        const i = days - 1 - Math.floor((now - p[0]) / DAY);
        if (i >= 0 && i < days) out[i] = out[i] == null ? p[1] : Math.max(out[i], p[1]);
    });
    return out;
}

/* ---------- what this car has ---------- */

/** What the car can report, found when it first answers and remembered per car. Demo shows everything. */
const CAPS = ['rpm', 'speed', 'gear', 'mode', 'coolant', 'outside', 'soot', 'ash', 'load', 'pfTemp', 'egt', 'exVanos', 'engLoad', 'catO2', 'flap', 'flap2', 'adblue'];
const ALL_CAPS = (function () { const o = {}; CAPS.forEach((k) => { o[k] = true; }); return o; })();
const has = (caps, k) => !!(caps && caps[k] === true);
/** Notes a reply: sets caps[k], says whether it changed. A true is never taken back by a miss. */
function found(caps, k, yes) {
    const was = caps[k];
    if (yes) caps[k] = true; else if (was !== true) caps[k] = false;
    return was !== caps[k];
}
const TABS = ['Now', 'Flap', 'Flap log', 'OPF', 'Filter care', 'Cold start', 'Sound', 'Better sound', 'History', 'Setup'];
/** The tab names for this engine: the filter page is OPF on a petrol and DPF on a diesel (lib/engine.js). */
function tabsFor(p) { const n = E.filterName(p); return TABS.map((t) => (t === 'OPF' ? (n === 'filter' ? 'Filter' : n) : t)); }
/**
 * The pages this car has something for (indexes into TABS). An electric car (engine false) has no exhaust: only Now,
 * which says so (owner rule 2026-11-26 19:03: pages that make no sense hide).
 */
function pagesFor(caps, p) {
    if (p && p.engine === false) return [0];
    const out = [0];
    if (has(caps, 'flap')) out.push(1, 2);
    if (has(caps, 'soot') || has(caps, 'load')) out.push(3);
    if (has(caps, 'soot') || has(caps, 'ash') || has(caps, 'speed')) out.push(4);
    if (has(caps, 'egt') || has(caps, 'coolant')) out.push(5);
    out.push(6, 7);
    if (has(caps, 'load') || has(caps, 'soot')) out.push(8);
    out.push(9);
    return out;
}
/**
 * A demo car's caps (lib/engine.js DEMO_CARS): what such a car reports. An electric car reports no engine values;
 * a car without a flap has no Flap pages; only a diesel with SCR has the AdBlue tank.
 */
function capsForCar(p) {
    const o = {};
    CAPS.forEach((k) => { o[k] = true; });
    if (!p || p.engine === false) { ['rpm', 'gear', 'coolant', 'soot', 'ash', 'load', 'pfTemp', 'egt', 'exVanos', 'engLoad', 'catO2', 'flap', 'flap2'].forEach((k) => { o[k] = false; }); return o; }
    if (!p.filter) ['soot', 'ash', 'load', 'pfTemp'].forEach((k) => { o[k] = false; });
    if (p.diesel) ['exVanos', 'catO2'].forEach((k) => { o[k] = false; });
    o.flap = p.flaps > 0; o.flap2 = p.flaps > 1;
    o.adblue = !!p.scr;
    return o;
}
/**
 * The engine of a real car from what it answered (lib/engine.js facts) and what Exhaust found itself (caps): the
 * flaps from the flap probe, the filter from the soot read (OPF or DPF by the fuel type), else the Setup page.
 */
function engineFor(facts, caps, setup) {
    const f = Object.assign({}, facts || {});
    const s = Object.assign({}, SETUP_DEFAULT, setup || {});
    f.flaps = has(caps, 'flap2') ? 2 : has(caps, 'flap') ? 1 : 0;
    const diesel = f.fuel === 'diesel';
    if (has(caps, 'soot') || has(caps, 'load') || (s.opf !== 'none' && f.fuel)) f.filter = diesel ? 'dpf' : 'opf';
    else if (f.fuel) f.filter = null;
    if (has(caps, 'adblue')) f.scr = true;
    return E.profile(f);
}
/** The rule conditions this car can check (the Add a rule dialog offers only these). */
function kindsFor(caps) {
    const need = { rpm: 'rpm', speed: 'speed', load: 'engLoad', gear: 'gear', mode: 'mode', coolant: 'coolant', time: null, egt: 'egt' };
    return R.KIND_ORDER.filter((k) => !need[k] || has(caps, need[k]));
}

module.exports = { CT, CATALOG, decode, Regen, untilNext, averageGap, REGEN_HOT, REGEN_COOL, drives, BUCKETS, ashFuture, ASH_FULL, lightOff,
    LIGHT_OFF, COLD_COOLANT, coldWeek, SETUP, SETUP_DEFAULT, sound, tips, flapWeek, hm, ago, clock, fmtThousands, loadDays,
    CAPS, ALL_CAPS, has, found, TABS, tabsFor, pagesFor, kindsFor, capsForCar, engineFor, DAY, WEEK, MIN };
