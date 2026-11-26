// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * engine.js - what engine this car has, for every Paget96 Garage app (owner rule, 2026-11-26 19:03: every app
 * works on every BMW engine and model where the MGU Store runs, nothing taken from one car).
 *
 * A profile says what the car's engine is and therefore what the pages may show:
 *   { id, label, name, fuel: 'petrol' | 'diesel' | 'electric', hybrid, engine (has a combustion engine),
 *     cylinders (0 = not known yet, never assumed), banks (1 or 2), units (engine units: 1, or 2 on a V8),
 *     perBank, turbos (0 = not known), ewg (electric wastegate: true / false / null = not known), vnt (diesel
 *     variable vanes), filter: 'opf' | 'dpf' | null, scr (AdBlue), glow (glow plugs), flaps (0 = none or not known),
 *     flapCmd ('60FD' or '611E'), ignition and knock (petrol only), rail: [lo, hi] bar }
 *
 * On a real car the facts come from the car (detect()): the master engine unit's SGBD index (22 F1 50: a V8 with a
 * second engine unit at 0x13, the list upstream's kit/twin_dme.js keeps), its list of misfire monitors (22 F6 A0: the
 * cylinder count, as upstream Live Data reads it) and the OBD fuel type (01 51: petrol, diesel, electric, hybrid).
 * What a car never answered stays "not known" and the pages that need it stay hidden or generic, never a guess.
 * A head unit's facts are kept in the app's data folder (one file per app, engine.json), so a start already knows.
 *
 * The demo cars (DEMO_CARS) are the layouts every page is drawn and tested in: B48, B58, S58, S63 (V8, two engine
 * units), B57 (diesel), a plug-in hybrid (B48 with an electric motor) and an electric car. Their figures are the
 * makers' published ones where a source is named in reports/garage/2026-11-26-compatibility.md (Company), else marked.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */

/** The V8s' master SGBD indexes with a second engine unit at 0x13 (upstream kit/twin_dme.js, 2026-11). */
const TWIN_INDEXES = ['0F1A10', '0F1A20', '0F242C', '0F242E', '0F2460', '0F26B8', '0F26BC', '0F2E00'];
/** OBD PID 51 fuel types (SAE J1979, as upstream Live Data std.js lists them). */
const OBD_FUEL = { 1: 'petrol', 2: 'petrol', 3: 'petrol', 4: 'diesel', 5: 'petrol', 6: 'petrol', 8: 'electric', 17: 'petrol', 19: 'diesel' };
const OBD_HYBRID = { 17: true, 19: true, 18: true, 20: true };
/** Fuel rail pressure, bar, normal working range shown on scales (petrol direct injection / common rail diesel). */
const RAIL = { petrol: [40, 350], diesel: [250, 2700] };

/** The demo cars, in the order Settings offers them. */
const DEMO_CARS = [
    { id: 'b48', label: 'B48', name: 'B48: 2.0 l four, one twin scroll turbo', fuel: 'petrol', cylinders: 4, banks: 1, units: 1, turbos: 1, ewg: true, filter: 'opf', flaps: 1, flapCmd: '60FD', boost: 1.42, power: 190, torque: 400, redline: 6500 },
    { id: 'b58', label: 'B58', name: 'B58: 3.0 l six, one twin scroll turbo', fuel: 'petrol', cylinders: 6, banks: 1, units: 1, turbos: 1, ewg: true, filter: 'opf', flaps: 1, flapCmd: '60FD', boost: 1.3, power: 285, torque: 500, redline: 7000 },
    { id: 's58', label: 'S58', name: 'S58: 3.0 l six, two turbos', fuel: 'petrol', cylinders: 6, banks: 1, units: 1, turbos: 2, ewg: true, filter: 'opf', flaps: 2, flapCmd: '60FD', boost: 1.7, power: 375, torque: 650, redline: 7200 },
    { id: 's63', label: 'S63 V8', name: 'S63: 4.4 l V8, two turbos, two engine units', fuel: 'petrol', cylinders: 8, banks: 2, units: 2, turbos: 2, ewg: true, filter: 'opf', flaps: 2, flapCmd: '611E', boost: 1.8, power: 460, torque: 750, redline: 7200 },
    { id: 'b57', label: 'B57 diesel', name: 'B57: 3.0 l six diesel, DPF and AdBlue', fuel: 'diesel', cylinders: 6, banks: 1, units: 1, turbos: 1, ewg: false, vnt: true, filter: 'dpf', scr: true, glow: true, flaps: 0, boost: 1.9, power: 210, torque: 650, redline: 4800 },
    { id: 'phev', label: 'PHEV', name: 'Plug-in hybrid: B48 four with an electric motor', fuel: 'petrol', hybrid: true, cylinders: 4, banks: 1, units: 1, turbos: 1, ewg: true, filter: 'opf', flaps: 0, boost: 1.2, power: 135, torque: 300, redline: 6500, hv: 12 },
    { id: 'ev', label: 'EV', name: 'Electric: no engine', fuel: 'electric', engine: false, cylinders: 0, banks: 0, units: 0, turbos: 0, ewg: false, filter: null, flaps: 0, power: 250, torque: 430, hv: 81 },
];
const DEMO_ROW = { key: 'demoCar', label: 'Demo car', hint: 'Which car the demo data shows', type: 'choice', default: 'b48',
    options: DEMO_CARS.map((c) => [c.id, c.label]) };

/** A full profile from some facts: everything derivable filled in, the rest "not known". */
function profile(f) {
    f = f || {};
    const p = {};
    Object.keys(f).forEach((k) => { p[k] = f[k]; });
    p.fuel = f.fuel || null;
    p.engine = f.engine === false || p.fuel === 'electric' ? false : true;
    p.hybrid = !!f.hybrid;
    p.units = f.units || (p.engine ? 1 : 0);
    p.banks = f.banks || (p.units === 2 ? 2 : p.engine ? 1 : 0);
    p.cylinders = f.cylinders || 0;
    p.perBank = p.cylinders && p.banks ? Math.ceil(p.cylinders / p.banks) : 0;
    p.turbos = f.turbos != null ? f.turbos : (p.units === 2 ? 2 : 0);
    p.ewg = f.ewg != null ? f.ewg : null;
    p.diesel = p.fuel === 'diesel';
    p.petrol = p.fuel === 'petrol';
    p.filter = f.filter !== undefined ? f.filter : (p.diesel ? 'dpf' : null);
    p.scr = f.scr != null ? !!f.scr : false;
    p.glow = f.glow != null ? !!f.glow : p.diesel;
    p.flaps = f.flaps || 0;
    p.flapCmd = f.flapCmd || (p.units === 2 ? '611E' : p.flaps ? '60FD' : null);
    // a diesel has no spark: no ignition angle, no knock control (a fuel type not known yet: shown only once seen)
    p.ignition = p.engine && !p.diesel;
    p.knock = p.engine && !p.diesel;
    p.rail = p.diesel ? RAIL.diesel : RAIL.petrol;
    p.label = f.label || (p.engine ? (p.cylinders ? p.cylinders + ' cylinders' : 'engine') : 'electric');
    return p;
}

const DEMO_PROFILES = {};
DEMO_CARS.forEach((c) => { DEMO_PROFILES[c.id] = profile(c); });
/** A demo car's profile (an unknown id: the B48). */
function demoCar(id) { return DEMO_PROFILES[id] || DEMO_PROFILES.b48; }

/* ---------- reading the car ---------- */

const hex2 = (b) => (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
/** 62 F1 50 i1 i2 i3 -> '0F242C', else null. */
function parseIndex(r) {
    if (!r || r[0] !== 0x62 || r[1] !== 0xF1 || r[2] !== 0x50 || r.length < 6) return null;
    return hex2(r[3]) + hex2(r[4]) + hex2(r[5]);
}
const isTwinIndex = (idx) => !!idx && TWIN_INDEXES.indexOf(String(idx).toUpperCase()) >= 0;
/**
 * 62 F6 A0 b1 b2 b3 b4: the engine unit's misfire monitors as a bit map of OBD monitor ids A1 .. C0 (b1's top bit
 * A1); A2 .. are cylinders 1 .. (upstream Live Data main.js cylCheck()). The count, or 0.
 */
function parseCylinders(r) {
    if (!r || r[0] !== 0x62 || r[1] !== 0xF6 || r[2] !== 0xA0 || r.length < 7) return 0;
    const has = (mid) => (r[3 + ((mid - 0xA1) >> 3)] & (0x80 >> ((mid - 0xA1) & 7))) !== 0;
    let n = 0;
    while (n < 12 && has(0xA2 + n)) n++;
    return n;
}
/** 41 51 xx -> { fuel, hybrid } or null. */
function parseFuel(r) {
    if (!r || r[0] !== 0x41 || r[1] !== 0x51 || r.length < 3) return null;
    const fuel = OBD_FUEL[r[2]];
    return fuel ? { fuel: fuel, hybrid: !!OBD_HYBRID[r[2]], code: r[2] } : null;
}
/**
 * 41 85 A B C D E F ...: SAE J1979 PID 85, the NOx reagent (AdBlue) system; F = tank level, F * 100 / 255 %.
 * (unsure: not read on a BMW diesel yet.) The level, or null.
 */
function parseAdBlue(r) {
    if (!r || r[0] !== 0x41 || r[1] !== 0x85 || r.length < 8) return null;
    if (!(r[2] & 0x02) && r[2] !== 0) { /* support bit for the level not set: some units leave it clear, still read */ }
    const v = r[7] * 100 / 255;
    return v >= 0 && v <= 100 ? v : null;
}

/**
 * Finds the engine once (a link with physical(addr, sid, data, ms, accept), kit/readonly-diag.js) and keeps the
 * answers: store = { get(), set(facts) } (the app's data file). Never throws; a fact not answered stays not known
 * and is asked again at the next start.
 *   const d = new Detector(link, store, log); await d.run(); d.profile()
 */
class Detector {
    constructor(link, store, log) {
        this.link = link;
        this.store = store || { get: () => null, set: () => {} };
        this.log = log;
        this.facts = Object.assign({}, this.store.get() || {});
        this.running = false;
    }
    profile() { return profile(this.facts); }
    known() { return !!(this.facts.cylinders && this.facts.fuel); }
    _note(k, v) { if (v === null || v === undefined || this.facts[k] === v) return false; this.facts[k] = v; return true; }
    async run() {
        if (this.running || !this.link || !this.link.physical) return this.profile();
        this.running = true;
        let changed = false;
        const ask = (addr, sid, data, okFn) => this.link.physical(addr, sid, data, 1500, okFn).catch(() => null);
        try {
            if (!this.facts.fuel) {
                const r = await ask(0x12, 0x01, [0x51], (x) => (x[0] === 0x41 && x[1] === 0x51) || (x[0] === 0x7F && x[1] === 0x01));
                const f = parseFuel(r);
                if (f) { changed = this._note('fuel', f.fuel) || changed; changed = this._note('hybrid', f.hybrid) || changed; }
            }
            if (!this.facts.index) {
                const idx = parseIndex(await ask(0x12, 0x22, [0xF1, 0x50], (x) => (x[0] === 0x62 && x[1] === 0xF1 && x[2] === 0x50) || (x[0] === 0x7F && x[1] === 0x22)));
                if (idx) {
                    changed = this._note('index', idx) || changed;
                    const twin = isTwinIndex(idx);
                    changed = this._note('units', twin ? 2 : 1) || changed;
                    if (twin) { changed = this._note('banks', 2) || changed; changed = this._note('turbos', 2) || changed; }
                }
            }
            if (!this.facts.cylinders) {
                const n = parseCylinders(await ask(0x12, 0x22, [0xF6, 0xA0], (x) => (x[0] === 0x62 && x[1] === 0xF6 && x[2] === 0xA0) || (x[0] === 0x7F && x[1] === 0x22)));
                if (n) changed = this._note('cylinders', n) || changed;
            }
        } finally { this.running = false; }
        if (changed) {
            try { this.store.set(this.facts); } catch (e) { if (this.log) this.log.warn('engine: ' + e.message); }
            if (this.log) this.log.info('engine: ' + JSON.stringify(this.facts));
        }
        return this.profile();
    }
    /** A value the app saw (the wastegate, the soot, a second flap): kept as a fact. */
    saw(k, v) { if (this._note(k, v)) { try { this.store.set(this.facts); } catch (e) { /* kept for this start */ } } }
}

/** A store in a JSON file (fs, path given by the app). */
function fileStore(fs, file) {
    return {
        get() { try { return JSON.parse(fs.readFileSync(file, 'utf8')).facts || null; } catch (e) { return null; } },
        set(f) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ v: 1, facts: f })); fs.renameSync(tmp, file); },
    };
}

/* ---------- what follows from the profile ---------- */

/** The particulate filter's name: 'OPF' (petrol), 'DPF' (diesel), 'filter' when the fuel is not known. */
function filterName(p) { return p && p.filter === 'dpf' ? 'DPF' : p && p.filter === 'opf' ? 'OPF' : 'filter'; }
/** Its long name. */
function filterLong(p) { return p && p.filter === 'dpf' ? 'diesel particulate filter' : p && p.filter === 'opf' ? 'petrol particulate filter' : 'particulate filter'; }
/**
 * The filter's figures for the pages: soot that counts as full (g), the load mark where the car regenerates (%),
 * the regeneration temperatures. A petrol filter regenerates passively at speed; a diesel one is burnt actively by
 * extra injection (unsure: from published descriptions, BMW gives no figures; marked on the pages as estimates).
 */
function filterFigures(p) {
    if (p && p.filter === 'dpf') return { sootFull: 40, sootScale: 50, mark: 80, hot: 550, cool: 450, regenText: 'The engine unit burns the soot off with extra fuel at 550 to 650 °C, usually on a longer drive' };
    return { sootFull: 12, sootScale: 15, mark: 80, hot: 550, cool: 480, regenText: 'The soot burns off by itself when the filter is hot and air reaches it, at speed or when you lift off' };
}

/**
 * The rows of a per-cylinder view: cylinders 1..n, in banks (one bank: one row; a V8: bank 1 cylinders 1-4, bank 2
 * 5-8, as BMW numbers them). Never a fixed 4: n from the profile, 0 = nothing to show.
 */
function cylinderBanks(p) {
    const n = p ? p.cylinders || 0 : 0;
    if (!n) return [];
    const banks = p.banks === 2 ? 2 : 1, per = Math.ceil(n / banks), out = [];
    for (let b = 0; b < banks; b++) {
        const row = [];
        for (let c = b * per + 1; c <= Math.min(n, (b + 1) * per); c++) row.push(c);
        out.push({ bank: b + 1, cylinders: row });
    }
    return out;
}

/** The engine's own service items (Health's Service page): spark plugs on a petrol, glow plugs and AdBlue on a diesel. */
function engineParts(p) {
    if (p && p.engine === false) return [];
    const base = ['Oil filter', 'Engine oil'];
    if (p && p.diesel) return base.concat(['Glow plugs', 'Fuel filter', 'Air filter', 'AdBlue', 'Drive belt'].filter((x) => x !== 'AdBlue' || p.scr));
    if (p && p.petrol) return base.concat(['Spark plugs', 'Air filter', 'Ignition coils', 'Drive belt']);
    return base.concat(['Air filter', 'Drive belt']);
}

/** One line for the README and How to use: what the app does on this engine. */
function describe(p) {
    if (!p.engine) return 'electric: no engine pages';
    const bits = [p.cylinders ? p.cylinders + ' cylinders' : 'cylinders not known yet'];
    if (p.banks === 2) bits.push('two banks');
    if (p.turbos) bits.push(p.turbos === 2 ? 'two turbos' : 'one turbo');
    if (p.filter) bits.push(filterName(p));
    if (p.scr) bits.push('AdBlue');
    if (p.hybrid) bits.push('hybrid');
    return bits.join(', ');
}

/*
 * The car's own limits (owner, 2026-11-26 22:20, Company D27: every pressure, redline and target is the car's; read it
 * where the car tells it, else the user sets it). Auto takes the engine's figure (its fuel type and engine code, read
 * from the car: OBD PID 51 and the engine unit), a number set in Settings wins. Every app that draws one of these
 * offers the rows below in its Settings.
 */
const LIMIT_ROWS = {
    railMax: { key: 'railMax', label: 'Fuel rail scale', hint: 'Top of the rail pressure gauge; Auto: the engine type', type: 'choice', default: 'auto',
        options: [['auto', 'Auto'], [200, '200 bar'], [350, '350 bar'], [500, '500 bar'], [2000, '2 000 bar'], [2500, '2 500 bar'], [3000, '3 000 bar']] },
    redline: { key: 'redline', label: 'Redline', hint: 'Where the rev scales turn red; Auto: the engine', type: 'choice', default: 'auto',
        options: [['auto', 'Auto'], [4500, '4 500'], [5000, '5 000'], [5500, '5 500'], [6000, '6 000'], [6500, '6 500'], [7000, '7 000'], [7500, '7 500'], [8000, '8 000']] },
    // a stepper like Boost target beside it (owner, 2026-11-26 23:57: six buttons ran off the row); 0 is Auto
    boostMax: { key: 'boostMax', label: 'Boost scale', hint: 'Top of the boost gauge; Auto: the engine', type: 'number', default: 0,
        min: 0, max: 4, step: 0.25, decimals: 2, unit: 'bar', zero: 'Auto' },
};
/** The limits for this engine profile; get(key) reads a setting ('auto', a missing or odd value: the engine's figure). */
function limits(p, get) {
    p = p || {};
    const val = (k) => { const v = get ? get(k) : null; const n = Number(v); return v === 'auto' || v == null || v === '' || !isFinite(n) || n <= 0 ? null : n; };
    const rail = val('railMax') || (p.rail ? p.rail[1] : (p.diesel ? RAIL.diesel[1] : RAIL.petrol[1]));
    const redline = val('redline') || p.redline || (p.diesel ? 5000 : 7000);
    const boostMax = val('boostMax') || Math.max(1, Math.ceil(((p.boost || 1.5) + 0.35) * 2) / 2);
    return { rail: rail, redline: redline, boostMax: boostMax };
}

module.exports = { LIMIT_ROWS, limits, TWIN_INDEXES, DEMO_CARS, DEMO_ROW, RAIL, profile, demoCar, parseIndex, isTwinIndex, parseCylinders, parseFuel,
    parseAdBlue, Detector, fileStore, filterName, filterLong, filterFigures, cylinderBanks, engineParts, describe };
