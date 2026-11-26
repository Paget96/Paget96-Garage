// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Standby's model: plain logic with no drawing and no car wiring, so the tests run it on a PC.
 *
 *   clock     timeText(), dateText(), digitSlots(): every digit in a slot of one fixed width, so a new
 *             minute changes a glyph and never moves one
 *   night     isNight() from the setting, the car's day / night signal or the hour; NIGHT_TEXT the warm
 *             dark colour; mixColour() for the glide between day and night
 *   menu      menuAlpha(): the header and tabs stay for the set delay after a tap, then fade out
 *   outside   iceRisk(): below 3 °C the road can freeze
 *   body      doorsOf(), windowsOf(), lockOf(): the car's door panel struct in words
 *   drives    Drives: this drive and today's, from the speed signal, kept across restarts
 *   Seen      which values this car reports (owner rule 2026-11-26: show only what the car supports)
 *   Demo      sample values for the PC preview and Demo data
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */

const isNum = (v) => typeof v === 'number' && isFinite(v);
const pad2 = (n) => (n < 10 ? '0' : '') + n;
const CT = (function () { try { return require('./garage_time'); } catch (e) { return require('../../lib/cartime'); } })();   // the car's time (the head unit keeps UTC)

/* ---------- the clock ---------- */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The time as the big clock shows it: { text, ampm }. fmt '24' gives '07:05'; fmt '12' gives ' 7:05' with
 * 'AM' or 'PM' (the hour's first slot stays, blank, so the colon never moves between 9:59 and 10:00).
 */
function timeText(d, fmt) {
    const h = d.getHours(), m = d.getMinutes();
    if (String(fmt) !== '12') return { text: pad2(h) + ':' + pad2(m), ampm: '' };
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { text: (h12 < 10 ? ' ' : '') + h12 + ':' + pad2(m), ampm: h < 12 ? 'AM' : 'PM' };
}
/** 'Thursday, 26 November'. */
function dateText(d) { return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
/** 'HH:MM' (24 h) or 'h:MM AM' (12 h), for small times in text. */
function shortTime(ms, fmt) {
    const d = CT.carTime(ms), t = timeText(d, fmt);
    return t.ampm ? t.text.trim() + ' ' + t.ampm : t.text;
}

/**
 * The slots of a clock string: every digit (and a blank) gets the width of the widest digit, the colon its own
 * width, so the same string length always has the same slots, whatever the digits are.
 * widthOf(ch) measures one character. Returns { slots: [{ ch, x, w }], w }: x is the slot's left edge from 0.
 */
function digitSlots(text, widthOf, gap) {
    let dw = 0;
    for (let k = 0; k <= 9; k++) dw = Math.max(dw, widthOf(String(k)));
    const cw = widthOf(':'), g = gap || 0;
    const slots = [];
    let x = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i], w = ch === ':' ? cw : dw;
        if (i) x += g;
        slots.push({ ch: ch, x: x, w: w });
        x += w;
    }
    return { slots: slots, w: x };
}

/* ---------- night ---------- */

/** The warm dark colour of the clock at night, and its dim companion for the small text. */
const NIGHT_TEXT = '#965a3c';
const NIGHT_DIM = '#6a4434';
const NIGHT_FROM = 20, NIGHT_TO = 7;     // the hours used when the car does not say day or night

/**
 * Night or day for the big clock. mode: 'auto' | 'on' | 'off' (setting Night dimming). carNight: the car's own
 * day / night (Vehicle.statusDayNightChangeOver, the one that turns the screens dark): true, false or null when
 * the car has not said. Without it, auto follows the hour: night from 20:00 to 07:00.
 */
function isNight(mode, carNight, d) {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    if (carNight === true || carNight === false) return carNight;
    const h = d.getHours();
    return h >= NIGHT_FROM || h < NIGHT_TO;
}
/** The car's day / night value (a name or its number) as true (night), false (day) or null. */
function nightOf(v) {
    const x = v && typeof v === 'object' ? v.dayNightChangeOver : v;
    const n = typeof x === 'string' ? { TAG: 1, NACHT: 2 }[x] : x;
    return n === 2 ? true : n === 1 ? false : null;
}

/** '#rrggbb' a to b by p (0..1). */
function mixColour(a, b, p) {
    const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16), q = Math.max(0, Math.min(1, p));
    let out = '#';
    [16, 8, 0].forEach((s) => {
        const x = Math.round(((A >> s) & 255) * (1 - q) + ((B >> s) & 255) * q);
        out += (x < 16 ? '0' : '') + x.toString(16);
    });
    return out;
}

/* ---------- the menu fades ---------- */

const MENU_FADE_MS = 800;
/**
 * How much of the header and tabs shows (0..1): all of it for delayS seconds after the last tap, then it fades out
 * over MENU_FADE_MS. delayS 0 (Never) keeps it.
 */
function menuAlpha(lastTap, now, delayS) {
    const d = Number(delayS);
    if (!(d > 0)) return 1;
    const left = lastTap + d * 1000 - now;
    if (left >= 0) return 1;
    return Math.max(0, 1 + left / MENU_FADE_MS);
}

/* ---------- outside ---------- */

const ICE_BELOW = 3;
/**
 * The ice warning from the outside temperature: below 3 °C the road can freeze in shaded places and on bridges
 * even when the air is above zero. { level: 'none' | 'possible' | 'likely', text } or null without a value.
 */
function iceRisk(t) {
    if (!isNum(t)) return null;
    if (t < 0) return { level: 'likely', text: 'below freezing, ice likely' };
    if (t < ICE_BELOW) return { level: 'possible', text: 'ice possible below 3 °C' };
    return { level: 'none', text: t >= 25 ? 'warm' : 'no ice risk' };
}

/* ---------- doors, windows, lock ---------- */

/* DoorsWindowsRoofMirrors.CentralLockingSystemAndPanelStatus: each door's switch is 1 or ..._OFFEN when open (as
 * upstream's Ambient config reads it). The windows and the lock are not in upstream's apps: their fields are found
 * by name (any field with Window, or Lock / Locking in it) and only shown once the car has sent one (unsure). */
const DOORS = { statusDoorSwitchDRD: 'driver', statusDoorSwitchPSD: 'passenger', statusDoorSwitchDRDR: 'rear left', statusDoorSwitchPSDR: 'rear right' };
const OPEN = /(^|_)(OFFEN|GEOEFFNET|OPEN|OPENED|AUF)$/;
const isOpen = (x) => x === 1 || x === true || OPEN.test(String(x));
/** The doors as a list of the open ones, or null when the struct has no door field. */
function doorsOf(v) {
    if (!v || typeof v !== 'object') return null;
    const keys = Object.keys(DOORS).filter((k) => v[k] !== undefined && v[k] !== null);
    if (!keys.length) return null;
    return keys.filter((k) => isOpen(v[k])).map((k) => DOORS[k]);
}
/** The windows: { open: n, of: n } from fields named like a window, or null when there are none. */
function windowsOf(v) {
    if (!v || typeof v !== 'object') return null;
    const keys = Object.keys(v).filter((k) => /window/i.test(k) && (typeof v[k] === 'number' || typeof v[k] === 'string'));
    if (!keys.length) return null;
    // a position (0 closed, more is open) or an open / closed name
    const open = keys.filter((k) => { const x = v[k]; return typeof x === 'number' ? x > 0 && x < 255 : isOpen(x); });
    return { open: open.length, of: keys.length };
}
const LOCKED = /(VERRIEGELT|GESICHERT|LOCKED|SECURED)$/, UNLOCKED = /(ENTRIEGELT|UNLOCKED|UNSECURED)$/;
/** Locked (true), unlocked (false) or null: a field named like the lock with a lock name as its value. */
function lockOf(v) {
    if (!v || typeof v !== 'object') return null;
    let out = null;
    Object.keys(v).forEach((k) => {
        if (!/lock/i.test(k)) return;
        const s = String(v[k]);
        if (UNLOCKED.test(s)) out = false;
        else if (LOCKED.test(s) && out === null) out = true;
    });
    return out;
}

/* The bonnet and the boot lid: found by name in the same struct (Motorhaube / hood / bonnet, Heckklappe / trunk / boot /
 * tailgate), as the windows are (unsure: their field names were not seen on a car yet). Open (true), shut (false), or
 * null when the struct has no such field. */
function lidOf(v, re) {
    if (!v || typeof v !== 'object') return null;
    const k = Object.keys(v).filter((n) => re.test(n) && (typeof v[n] === 'number' || typeof v[n] === 'string' || typeof v[n] === 'boolean'))[0];
    return k ? isOpen(v[k]) : null;
}
const hoodOf = (v) => lidOf(v, /hood|bonnet|motorhaube|frontlid/i);
const trunkOf = (v) => lidOf(v, /trunk|tailgate|heckklappe|boot|rearlid|luggage/i);

/** Seat heating level 0..3 from the car's number (as upstream eDrive reads it), or null. */
const seatLevel = (v) => (typeof v === 'number' && v >= 0 && v < 15 ? Math.min(3, v) : null);
/** The first value under key anywhere in a struct (the climate structs are lists, one entry per zone). */
function one(v, key) {
    if (!v || typeof v !== 'object') return undefined;
    if (key in v) return v[key];
    const ks = Object.keys(v);
    for (let i = 0; i < ks.length; i++) { const r = one(v[ks[i]], key); if (r !== undefined) return r; }
    return undefined;
}

/* ---------- drives ---------- */

const MOVING = 2;             // km/h: above this the car is driving
const END_MS = 3 * 60000;     // a drive ends after the car stood this long
const GAP_MS = 10000;         // samples further apart than this are not integrated (no data in between)
const TRACK_MS = 60000;       // one point of the today chart a minute
const dayKey = (ms) => { const d = CT.carTime(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };

/**
 * This drive and today's drives, from the car's speed. A drive starts when the car moves and ends when it has
 * stood for 3 minutes. Each drive keeps its distance (km, the speed integrated), its time (start to the last
 * moment it moved), the lowest and highest outside temperature, and the car's own trip average consumption at
 * its end when the car reports one. Today: the drives started today (local time), oldest first.
 */
class Drives {
    constructor(saved) {
        this.list = [];
        this.cur = null;
        this.last = null;            // [t, speed] of the last sample
        if (saved && Array.isArray(saved.list)) this.list = saved.list.filter((x) => x && isNum(x.start));
    }
    /** One speed sample (km/h) at t, with the outside temperature and the trip average (either may be null). */
    feed(t, speed, outside, fuelAvg) {
        if (!isNum(speed)) { this.last = null; return; }
        const prev = this.last;
        this.last = [t, speed];
        const moving = speed > MOVING;
        if (moving && !this.cur) {
            this.cur = { start: t, end: t, km: 0, lo: null, hi: null, fuel: null, track: [[t, 0]] };
            this.list.push(this.cur);
        }
        const c = this.cur;
        if (!c) return;
        if (prev && t - prev[0] <= GAP_MS && t > prev[0]) c.km += (prev[1] + speed) / 2 * (t - prev[0]) / 3600000;
        if (moving) c.end = t;
        if (isNum(outside)) { c.lo = c.lo === null ? outside : Math.min(c.lo, outside); c.hi = c.hi === null ? outside : Math.max(c.hi, outside); }
        if (isNum(fuelAvg)) c.fuel = fuelAvg;
        const tl = c.track[c.track.length - 1];
        if (t - tl[0] >= TRACK_MS) c.track.push([t, Math.round(c.km * 100) / 100]);
        if (!moving && t - c.end >= END_MS) this.finish();
    }
    /** Ends the drive under way (also when the app stops). */
    finish() {
        const c = this.cur;
        if (!c) return;
        c.track.push([c.end, Math.round(c.km * 100) / 100]);
        this.cur = null;
        if (c.km < 0.05) this.list.splice(this.list.indexOf(c), 1);    // a roll in the car park is no drive
    }
    /** The drive under way, else the last one. */
    latest() { return this.cur || (this.list.length ? this.list[this.list.length - 1] : null); }
    /** Today's drives (local time), oldest first. Older days are dropped. */
    today(now) {
        const k = dayKey(now);
        this.list = this.list.filter((x) => dayKey(x.start) === k || x === this.cur);
        return this.list;
    }
    /** This drive in numbers: { km, min, avg, fuel, lo, hi, live } or null. */
    summary(now) {
        const c = this.latest();
        if (!c) return null;
        const ms = Math.max(0, (c === this.cur ? Math.max(c.end, Math.min(now, c.end + END_MS)) : c.end) - c.start);
        const h = ms / 3600000;
        return { km: c.km, min: ms / 60000, avg: h > 1 / 120 ? c.km / h : null, fuel: c.fuel, lo: c.lo, hi: c.hi, live: c === this.cur, start: c.start };
    }
    /** Today in numbers and the chart's points [[t, km so far today]]: { n, km, min, pts }. */
    day(now) {
        const list = this.today(now);
        let km = 0, min = 0;
        const pts = [];
        list.forEach((x) => {
            const base = km;
            if (!pts.length) pts.push([x.start, 0]);
            x.track.forEach((p) => pts.push([p[0], base + p[1]]));
            if (x === this.cur) pts.push([now, base + x.km]);
            km += x.km;
            min += Math.max(0, x.end - x.start) / 60000;
        });
        return { n: list.length, km: km, min: min, pts: pts };
    }
    toJSON() { return { list: this.list.slice(-40) }; }
}

/* ---------- what this car reports ---------- */

/** The values this car has sent at least once (kept in the data folder); the pages show only these. */
class Seen {
    constructor(saved) { this.keys = {}; (saved || []).forEach((k) => { this.keys[k] = true; }); this.dirty = false; }
    mark(k) { if (!this.keys[k]) { this.keys[k] = true; this.dirty = true; } }
    has(k) { return !!this.keys[k]; }
    list() { return Object.keys(this.keys); }
}

/* ---------- demo ---------- */

/**
 * Sample values for the preview and the Demo data setting: a cold evening, the car parked after its third drive of
 * the day. at(): the live values; drives(t): today's three drives.
 */
const Demo = {
    /** car: a demo car of lib/engine.js; an electric car shows its range without fuel. */
    values(t, car) {
        const s = (t / 1000) % 600;
        const v = {
            outside: 2.4 - s / 600 * 0.6, volts: 12.6 + 0.02 * Math.sin(t / 7000), charge: 82, range: 410, fuelL: 41,
            doors: [], hood: false, trunk: false, windows: { open: 0, of: 4 }, locked: true, lockedAt: null,
            seats: { DR: 2, PS: 1 }, wheel: true, climate: true, ac: false, blower: 3, night: null,
        };
        if (car && car.engine === false) { delete v.fuelL; v.range = 362; }
        else if (car && car.diesel) { v.range = 780; v.fuelL = 52; }
        return v;
    },
    drives(now) {
        const d = CT.carTime(now), at = (h, m) => CT.fromCar(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime());
        const mk = (sh, sm, mins, km, lo, hi, fuel) => {
            const start = at(sh, sm), end = start + mins * 60000, track = [];
            for (let k = 0; k <= mins; k++) {
                const f = k / mins, ease = f * f * (3 - 2 * f) * 0.6 + f * 0.4;
                track.push([start + k * 60000, Math.round(km * ease * 100) / 100]);
            }
            return { start: start, end: end, km: km, lo: lo, hi: hi, fuel: fuel, track: track };
        };
        return new Drives({ list: [mk(7, 52, 22, 14.1, 2, 3, 8.1), mk(12, 40, 12, 6.2, 5, 6, 7.9), mk(18, 50, 38, 22.3, 4, 6, 7.4)] });
    },
};

module.exports = {
    isNum, timeText, dateText, shortTime, digitSlots,
    NIGHT_TEXT, NIGHT_DIM, isNight, nightOf, mixColour,
    MENU_FADE_MS, menuAlpha, ICE_BELOW, iceRisk,
    doorsOf, windowsOf, lockOf, hoodOf, trunkOf, seatLevel, one,
    Drives, Seen, Demo, dayKey,
};
