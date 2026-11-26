// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
// The drive mode table (modeClass) is adapted from idrive7-apps apps/live_adjustments/auto.js (flapFor),
// MIT, Copyright (c) 2026 cauliflowermossgrape; see NOTICE.
'use strict';
/**
 * Exhaust's flap automation (owner, 2026-11-26 18:02, I13): AUTO runs an ordered list of rules, the top one that
 * holds wins, each rule has its own switch. A rule is
 *
 *   when <engine speed | speed | load | gear | drive mode | coolant temp | time of day | exhaust temp>
 *        is above / below <value> (drive mode: is <Sport | Comfort | Eco Pro>, time of day: from .. to ..)
 *   [and <a second condition>]
 *   then the flap OPEN / CLOSE / CAR DECIDES   [on both flaps, or the left or right one, on a car with two]
 *
 * Every number has hysteresis: "above 3 000 rpm" turns on above 3 000 and off only below 2 500, so the flap does not
 * flap at the edge. No rule holding hands the flap to the car. A value the car does not report (yet) never holds.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */

/** The conditions, their units, the stepper (min, max, step) and the hysteresis each number gets. */
const KINDS = {
    rpm: { label: 'Engine speed', unit: 'rpm', min: 1000, max: 7000, step: 250, hyst: 500, def: 3000 },
    speed: { label: 'Speed', unit: 'km/h', min: 5, max: 250, step: 5, hyst: 10, def: 40 },
    load: { label: 'Load', unit: '%', min: 10, max: 100, step: 5, hyst: 10, def: 80 },
    gear: { label: 'Gear', unit: '', min: 1, max: 8, step: 1, hyst: 0, def: 3 },
    mode: { label: 'Drive mode', choices: [['sport', 'Sport'], ['comfort', 'Comfort'], ['eco', 'Eco Pro']], def: 'sport' },
    coolant: { label: 'Coolant temp', unit: '°C', min: 20, max: 110, step: 5, hyst: 5, def: 50 },
    time: { label: 'Time of day', min: 0, max: 1410, step: 30, def: [22 * 60, 6 * 60] },
    egt: { label: 'Exhaust temp', unit: '°C', min: 100, max: 900, step: 25, hyst: 30, def: 400 },
};
const KIND_ORDER = ['rpm', 'speed', 'load', 'gear', 'mode', 'coolant', 'time', 'egt'];
const ACTIONS = ['OPEN', 'CLOSED', 'OEM'];
const ACTION_WORD = { OPEN: 'OPEN', CLOSED: 'CLOSE', OEM: 'CAR' };

// statusFESVehicleDynamicSwitchHMI.actualValueModeDrivingExperience: the plug-in hybrids' own numbers
const PHEV = { 15: 'sport', 16: 'sport', 23: 'sport', 28: 'sport', 17: 'comfort', 19: 'comfort', 18: 'eco', 20: 'eco', 21: 'eco' };
/** The driving mode (name or number) as one of three: 'sport', 'comfort', 'eco', or null (starting up, unknown). */
function modeClass(raw) {
    if (raw === undefined || raw === null) return null;
    const n = Number(raw);
    if (!isNaN(n) && String(raw).trim() !== '') {
        if (n >= 1 && n <= 3) return 'sport';
        if (n >= 4 && n <= 6) return 'comfort';
        if (n >= 7 && n <= 9) return 'eco';
        if (n === 10) return 'comfort';             // Adaptive
        return PHEV[n] || null;
    }
    const s = String(raw).toUpperCase();
    if (/SPORT|BOOST/.test(s)) return 'sport';
    if (/ECO|ELECTRIC|ELEKTR/.test(s)) return 'eco';
    if (/COMFORT|ADAPTIVE|TRAFFIC|HYBRID/.test(s)) return 'comfort';
    return null;
}
const MODE_NAME = { sport: 'Sport', comfort: 'Comfort', eco: 'Eco Pro' };

const thousands = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const hhmm = (m) => ('0' + Math.floor(m / 60) % 24).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
/** A condition's value in words: "3 000 rpm", "50 °C", "22:00 to 06:00", "Sport". */
function valueText(c) {
    const k = KINDS[c.kind];
    if (c.kind === 'mode') return MODE_NAME[c.value] || String(c.value);
    if (c.kind === 'time') return hhmm(c.value[0]) + ' to ' + hhmm(c.value[1]);
    if (c.kind === 'gear') return ['', '1st', '2nd', '3rd'][c.value] || c.value + 'th';
    return thousands(c.value) + (k.unit ? ' ' + k.unit : '');
}
/** The hysteresis of a condition: its own, else its kind's. */
const hystOf = (c) => (c.hyst != null ? c.hyst : (KINDS[c.kind] && KINDS[c.kind].hyst) || 0);
/** "above 3 000 rpm", "coolant below 50 °C", "in Sport", "from 22:00 to 06:00", "in 3rd gear or higher". */
function condText(c, withKind) {
    if (c.kind === 'mode') return 'in ' + valueText(c);
    if (c.kind === 'time') return 'from ' + valueText(c);
    if (c.kind === 'gear') return c.op === 'above' ? 'above ' + valueText(c) + ' gear' : 'below ' + valueText(c) + ' gear';
    const name = { rpm: '', speed: '', load: 'when the load is', coolant: 'while the coolant is', egt: 'while the exhaust is' }[c.kind];
    return (withKind && name ? name + ' ' : '') + c.op + ' ' + valueText(c);
}
/** The line under a rule's name: "Open above 3 000 rpm, back below 2 500". */
function describe(r) {
    const a = { OPEN: 'Open', CLOSED: 'Close', OEM: 'Car decides' }[r.action];
    const c = r.when, h = hystOf(c);
    let s = a + ' ' + condText(c, true);
    if (h && (c.op === 'above' || c.op === 'below')) s += ', back ' + (c.op === 'above' ? 'below ' + thousands(c.value - h) : 'above ' + thousands(c.value + h));
    if (r.and) s += ', and ' + condText(r.and, true);
    if (r.flap && r.flap !== 'both') s += ' (' + r.flap + ' flap)';
    return s;
}
/** A short name for a new rule: "Above 3 000 rpm", "Coolant below 50 °C", "Sport mode", "22:00 to 06:00". */
function autoName(r) {
    const c = r.when;
    if (c.kind === 'mode') return MODE_NAME[c.value] + ' mode';
    if (c.kind === 'time') return valueText(c);
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const pre = { rpm: '', speed: '', load: 'Load ', gear: '', coolant: 'Coolant ', egt: 'Exhaust ' }[c.kind];
    if (c.kind === 'gear') return cap(c.op) + ' ' + valueText(c) + ' gear';
    return pre ? pre + c.op + ' ' + valueText(c) : cap(c.op) + ' ' + valueText(c);
}

/** The rules a new install starts with (all as the owner's design; the Night and Town rules off). */
function defaults() {
    return [
        { id: 1, name: 'Quiet start', on: true, action: 'CLOSED', when: { kind: 'coolant', op: 'below', value: 50 } },
        { id: 2, name: 'Above 3 000 rpm', on: true, action: 'OPEN', when: { kind: 'rpm', op: 'above', value: 3000 } },
        { id: 3, name: 'Full throttle', on: true, action: 'OPEN', when: { kind: 'load', op: 'above', value: 80 } },
        { id: 4, name: 'Sport mode', on: true, action: 'OPEN', when: { kind: 'mode', op: 'is', value: 'sport' } },
        { id: 5, name: 'Night', on: false, action: 'CLOSED', when: { kind: 'time', op: 'between', value: [22 * 60, 6 * 60] } },
        { id: 6, name: 'Town speed', on: false, action: 'CLOSED', when: { kind: 'speed', op: 'below', value: 40 } },
    ];
}

/** The value of a condition's kind from the live values (vals: { rpm, speed, load, gear, mode, coolant, minutes, egt }). */
function valueOf(kind, vals) {
    const v = kind === 'time' ? vals.minutes : vals[kind];
    return v === undefined || v === null || (typeof v === 'number' && !isFinite(v)) ? null : v;
}
/**
 * Does condition c hold for the value v, given that it held last time (was)? Numbers turn on past the value and off
 * only past the value minus (above) or plus (below) the hysteresis. An unknown value never holds.
 */
function holds(c, v, was) {
    if (v === null || v === undefined) return false;
    if (c.kind === 'mode') return modeClass(v) === c.value;
    if (c.kind === 'time') {
        const a = c.value[0], b = c.value[1];
        return a <= b ? v >= a && v < b : v >= a || v < b;       // 22:00 to 06:00 runs over midnight
    }
    const h = was ? hystOf(c) : 0;
    if (c.op === 'above') return v > c.value - h;
    if (c.op === 'below') return v < c.value + h;
    return false;
}

/**
 * The rules and what holds now. tick(vals) works out every rule (each condition keeps its own latch for the
 * hysteresis); pick(side) is then the top rule that is switched on, holds and applies to that flap.
 */
class Rules {
    constructor(list) { this.set(list || defaults()); }
    set(list) {
        this.list = list;
        this.latch = new Map();     // 'id|0' / 'id|1' -> held last time
        this.held = new Set();      // rule ids that hold now
    }
    tick(vals) {
        const held = new Set();
        this.list.forEach((r) => {
            const keys = [r.id + '|0', r.id + '|1'];
            if (!r.on) { this.latch.delete(keys[0]); this.latch.delete(keys[1]); return; }
            const a = holds(r.when, valueOf(r.when.kind, vals), !!this.latch.get(keys[0]));
            this.latch.set(keys[0], a);
            let b = true;
            if (r.and) { b = holds(r.and, valueOf(r.and.kind, vals), !!this.latch.get(keys[1])); this.latch.set(keys[1], b); }
            if (a && b) held.add(r.id);
        });
        this.held = held;
        return held;
    }
    /** The rule that decides a flap ('both', 'left' or 'right'), or null: no rule holds, the car decides. */
    pick(side) {
        for (let i = 0; i < this.list.length; i++) {
            const r = this.list[i];
            if (!r.on || !this.held.has(r.id)) continue;
            if (side && side !== 'both' && r.flap && r.flap !== 'both' && r.flap !== side) continue;
            return r;
        }
        return null;
    }
    /** The next free id. */
    nextId() { return this.list.reduce((m, r) => Math.max(m, r.id), 0) + 1; }
    /** The kinds the rules use (the values main.js must keep fresh). */
    kinds() {
        const k = {};
        this.list.forEach((r) => { if (r.on) { k[r.when.kind] = true; if (r.and) k[r.and.kind] = true; } });
        return k;
    }
}

/** A rule as the dialog edits it: a copy, with defaults filled in. */
function draft(r) {
    const d = r ? JSON.parse(JSON.stringify(r)) : { id: null, name: '', on: true, action: 'OPEN', when: { kind: 'rpm', op: 'above', value: 3000 } };
    d.flap = d.flap || 'both';
    return d;
}
/** A condition of a new kind, at that kind's default. */
function condFor(kind, old) {
    const k = KINDS[kind];
    if (kind === 'mode') return { kind: kind, op: 'is', value: k.def };
    if (kind === 'time') return { kind: kind, op: 'between', value: k.def.slice() };
    return { kind: kind, op: old && (old.op === 'above' || old.op === 'below') ? old.op : 'above', value: k.def };
}
/** One stepper step for a condition (dir 1 up, -1 down); for time, part 0 is the start, 1 the end. */
function stepCond(c, dir, part) {
    const k = KINDS[c.kind];
    if (c.kind === 'mode') {
        const ch = k.choices.map((x) => x[0]), i = ch.indexOf(c.value);
        c.value = ch[(i + dir + ch.length) % ch.length];
    } else if (c.kind === 'time') {
        const v = c.value.slice();
        v[part || 0] = (v[part || 0] + dir * k.step + 1440) % 1440;
        c.value = v;
    } else c.value = Math.max(k.min, Math.min(k.max, c.value + dir * k.step));
    return c;
}

module.exports = { KINDS, KIND_ORDER, ACTIONS, ACTION_WORD, MODE_NAME, modeClass, holds, valueOf, valueText, condText, describe,
    autoName, defaults, Rules, draft, condFor, stepCond, hystOf, thousands, hhmm };
