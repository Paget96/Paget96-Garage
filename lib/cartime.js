// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * The car's time of day, for every time a Garage app shows (owner's car, 2026-11-26 20:12: the clock under the
 * app name showed 19:12 while the car showed 20:12).
 *
 * Why: the head unit keeps its system time in UTC (upstream's Redline log view notes the same on every car seen),
 * so new Date() reads UTC there, not the time the driver sees. No signal an app may subscribe to and no file an
 * app may read is known that tells the user's time zone, so the zone is a setting on the Display card ("Time
 * zone"): Auto uses the head unit's own zone when it keeps one that is not UTC, and Central Europe (CET, CEST in
 * summer) while it keeps UTC, so Serbia is right with no change. Summer time is worked out here (Node 8 on the
 * head unit has no reliable Intl time zones): the EU and UK rule (last Sunday of March to last Sunday of October,
 * at 01:00 UTC) and the US rule (second Sunday of March to first Sunday of November, at 02:00 local).
 *
 * Stored timestamps stay UTC epoch ms. Only what is shown goes through here:
 *     const T = require('./garage_time');      // in an app (tools/build.py puts it there; lib/ui.js re-exports it)
 *     T.source(() => settings.get('timeZone'));  // once, at start
 *     const d = T.carTime(ms);                   // a Date whose getHours(), getDate(), getDay() ... are the car's
 *     T.carNow();                                // the same for now
 *     T.fromCar(d.getTime());                    // back to UTC epoch ms (for "today at 20:00" built on a carTime)
 *
 * Node 8: no optional chaining, no object spread, no Intl.
 */

const MIN = 60000, HOUR = 3600000;

/** Zones: [id, label, standard offset in minutes east of UTC, summer time rule ('eu', 'us' or none)]. */
const ZONES = [
    ['auto', 'Auto', null, null],
    ['cet', 'Central Europe', 60, 'eu'],
    ['wet', 'UK, Ireland, Portugal', 0, 'eu'],
    ['eet', 'Eastern Europe', 120, 'eu'],
    ['msk', 'Moscow, Turkey', 180, null],
    ['gulf', 'Gulf, UTC+4', 240, null],
    ['india', 'India, UTC+5:30', 330, null],
    ['china', 'China, UTC+8', 480, null],
    ['japan', 'Japan, Korea', 540, null],
    ['useast', 'US Eastern', -300, 'us'],
    ['uscentral', 'US Central', -360, 'us'],
    ['usmountain', 'US Mountain', -420, 'us'],
    ['arizona', 'Arizona', -420, null],
    ['uspacific', 'US Pacific', -480, 'us'],
    ['system', 'Head unit', null, null],
];
// plain offsets, whole hours from UTC-12 to UTC+14, no summer time
for (let h = -12; h <= 14; h++) {
    const id = h === 0 ? 'utc' : 'utc' + (h > 0 ? '+' : '') + h;
    ZONES.push([id, h === 0 ? 'UTC' : 'UTC' + (h > 0 ? '+' : '') + h, h * 60, null]);
}
const BY_ID = {};
ZONES.forEach((z) => { BY_ID[z[0]] = z; });
const DEFAULT = 'auto';
const FALLBACK = 'cet';     // what Auto uses while the head unit keeps UTC (Serbia and most of the EU)

/** The setting row for the Display card (lib/ui.js DISPLAY_SETTINGS), drawn as a stepper through the list. */
const ROW = { key: 'timeZone', label: 'Time zone', type: 'choice', list: true, default: DEFAULT,
    options: ZONES.map((z) => [z[0], z[1]]),
    hint: 'Auto: Central Europe while the head unit keeps UTC' };

/** Epoch ms of the n-th (1-based; -1 the last) Sunday of a month (0-based) at hh:00 UTC. */
function nthSunday(year, month, n, hh) {
    if (n < 0) {
        const last = new Date(Date.UTC(year, month + 1, 0));
        return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), hh);
    }
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return Date.UTC(year, month, 1 + (7 - first) % 7 + 7 * (n - 1), hh);
}

/** Whether summer time is on at utcMs under a rule, for a zone of standard offset stdMin. */
function isSummer(rule, stdMin, utcMs) {
    const y = new Date(utcMs).getUTCFullYear();
    if (rule === 'eu') return utcMs >= nthSunday(y, 2, -1, 1) && utcMs < nthSunday(y, 9, -1, 1);
    if (rule === 'us') {
        // 02:00 local standard time in March, 02:00 local summer time (01:00 standard) in November
        const start = nthSunday(y, 2, 2, 0) + 2 * HOUR - stdMin * MIN;
        const end = nthSunday(y, 10, 1, 0) + HOUR - stdMin * MIN;
        return utcMs >= start && utcMs < end;
    }
    return false;
}

/** The head unit's own offset at utcMs, minutes east of UTC (0 on the cars seen so far). */
function systemOffset(utcMs) { return -new Date(utcMs).getTimezoneOffset(); }

/**
 * The car's offset from UTC at utcMs, in minutes east, for a zone id. sysOff (optional, for tests) stands in for the
 * head unit's own offset.
 */
function offsetMinutes(id, utcMs, sysOff) {
    const sys = sysOff == null ? systemOffset(utcMs) : sysOff;
    let z = BY_ID[id] || BY_ID[DEFAULT];
    if (z[0] === 'system') return sys;
    if (z[0] === 'auto') {
        if (sys !== 0) return sys;          // the head unit keeps a zone of its own: trust it
        z = BY_ID[FALLBACK];
    }
    return z[2] + (isSummer(z[3], z[2], utcMs) ? 60 : 0);
}

let getZone = () => DEFAULT;
/** Where the zone id comes from: a function, called each time (e.g. () => settings.get('timeZone')), or an id. */
function source(f) { getZone = typeof f === 'function' ? f : () => f; }
function zone() { let z; try { z = getZone(); } catch (e) { z = null; } return BY_ID[z] ? z : DEFAULT; }

/**
 * A Date whose local getters (getHours, getMinutes, getDate, getDay, getMonth, getFullYear) give the car's wall
 * clock at utcMs. Only for showing: its getTime() is not the real moment (fromCar() turns it back).
 */
function carTime(utcMs, id) {
    const ms = utcMs == null ? Date.now() : +utcMs;
    const shift = (offsetMinutes(id || zone(), ms) - systemOffset(ms)) * MIN;
    return new Date(ms + shift);
}
function carNow(id) { return carTime(Date.now(), id); }

/** The real UTC epoch ms of a carTime()-style value (e.g. new Date(d.getFullYear(), d.getMonth(), d.getDate(), 20, 0)). */
function fromCar(shiftedMs, id) {
    const z = id || zone();
    let ms = +shiftedMs;
    for (let i = 0; i < 3; i++) ms = +shiftedMs - (offsetMinutes(z, ms) - systemOffset(ms)) * MIN;
    return ms;
}

/** "20:12" (24 h) at utcMs in the car's time. */
function hhmm(utcMs, id) {
    const d = carTime(utcMs, id), two = (n) => (n < 10 ? '0' : '') + n;
    return two(d.getHours()) + ':' + two(d.getMinutes());
}

module.exports = { ZONES, ROW, DEFAULT, FALLBACK, nthSunday, isSummer, offsetMinutes, systemOffset, source, zone,
    carTime, carNow, fromCar, hhmm };
