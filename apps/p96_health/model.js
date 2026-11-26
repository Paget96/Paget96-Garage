// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Health: the logic, with no screen and no car in it, so the tests run it with plain node.
 *
 *   faults      the replies of 19 02 / 19 17 (UDS) and 0A (OBD permanent faults) taken apart, grouped by unit
 *   history     every scan kept as events per fault: first seen, seen again, gone by itself, cleared
 *   score       0 to 100 from six checks (faults, 12 V, oil, service, tyres, Check Control)
 *   battery     the verdict on the resting voltage
 *   service     the car's CBS list (KombiInterface_2 cbsDataServiceList) as items with what is left
 *   tyres       a slow leak from the daily cold pressures
 *   report      the plain-text report the Share page puts in a QR code
 *
 * Node 8: no optional chaining, no ??, no object spread.
 */

const DAY = 86400000, WEEK = 7 * DAY;

/* ---------- control units ---------- */

/** The units people know, by diagnostic address: short plain name and the unit's own letters. */
const UNITS = {
    0x01: ['Airbag', 'ACSM'], 0x10: ['Gateway', 'BDC'], 0x12: ['Engine', 'DME'], 0x13: ['Engine 2', 'DME2'],
    0x18: ['Gearbox', 'EGS'], 0x1D: ['Fuel tank', 'TFM'], 0x29: ['Brakes', 'DSC'], 0x30: ['Steering', 'EPS'],
    0x38: ['xDrive', 'VTG'], 0x40: ['Body', 'BDC'], 0x43: ['Lights', 'FLE'], 0x44: ['Lights', 'FLE'],
    0x56: ['Roof', 'FZD'], 0x5D: ['Camera', 'KAFAS'], 0x60: ['Cluster', 'KOMBI'], 0x61: ['Telematics', 'ATM'],
    0x63: ['Head unit', 'HU'], 0x64: ['Parking', 'PDC'], 0x6D: ['Seats', 'SM'], 0x76: ['Dampers', 'VDP'],
    0x78: ['Climate', 'IHKA'], 0x2C: ['Park sensors', 'USS'], 0x21: ['Front radar', 'FRR'],
};
const hex2 = (n) => (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
/** "Engine (DME)", or "Unit 0x5A" for one we do not name. */
function unitName(addr) {
    const u = UNITS[addr];
    return u ? u[0] + ' (' + u[1] + ')' : 'Unit 0x' + hex2(addr);
}

/* ---------- fault replies ---------- */

const hex6 = (n) => ('000000' + (n >>> 0).toString(16).toUpperCase()).slice(-6);

/**
 * A 19 xx reply (59 <sub> <mask> [code(3) status(1)]...) as faults of memory `mem` ('fault' or 'info').
 * params: the request bytes after 19 ([0x02, mask] or [0x17, mask, 0x01]); the records start after them and the
 * availability mask. Returns { ok, nrc, dtcs: [{ code, status, mem }] }.
 */
function parseDtcReply(uds, params, mem) {
    const out = { ok: false, nrc: null, dtcs: [] };
    if (!uds || !uds.length) return out;
    if (uds[0] === 0x7F) { out.nrc = uds[2] === undefined ? null : uds[2]; return out; }
    if (uds[0] !== 0x59 || uds[1] !== params[0]) return out;
    out.ok = true;
    for (let i = 1 + params.length; i + 4 <= uds.length; i += 4) {
        out.dtcs.push({ code: hex6((uds[i] << 16) | (uds[i + 1] << 8) | uds[i + 2]), status: uds[i + 3], mem: mem || 'fault' });
    }
    return out;
}

/** OBD mode 0A (permanent emission faults): 4A <count> [hi lo]... as P0420 style codes. */
function parsePermanent(uds) {
    const out = { ok: false, dtcs: [] };
    if (!uds || uds[0] !== 0x4A) return out;
    out.ok = true;
    // CAN replies carry the count first; a reply without it (old style) has an even number of bytes after 4A
    const hasCount = uds.length >= 2 && (uds.length - 2) === uds[1] * 2;
    for (let i = hasCount ? 2 : 1; i + 2 <= uds.length; i += 2) {
        const a = uds[i], b = uds[i + 1];
        if (!a && !b) continue;
        const code = 'PCBU'[a >> 6] + ((a >> 4) & 3) + hex2(a & 0x0F).slice(1) + hex2(b);
        out.dtcs.push({ code: code, status: 0x08, mem: 'perm' });
    }
    return out;
}

/** The status byte (ISO 14229) in one word: active (failing now), stored, pending, or history. */
function faultState(status) {
    if (status & 0x01) return 'active';
    if (status & 0x08) return 'stored';
    if (status & 0x04) return 'pending';
    return 'history';
}

/** The eight status bits in words, for the details. */
const STATUS_BITS = [
    'Failing at this moment', 'Failed during this drive', 'Pending, not yet confirmed', 'Confirmed and stored',
    'Not tested since cleared', 'Failed since cleared', 'Not tested this drive', 'Asks for a warning light',
];
const statusWords = (b) => STATUS_BITS.filter((s, i) => b & (1 << i));

/**
 * The rows of the By unit card: every unit that answered, with how many faults and info entries it holds,
 * the units with something first. units: [{ addr, dtcs }] (dtcs with mem). Returns [{ addr, name, faults, info, perm, text, color }].
 */
function byUnit(units) {
    const rows = (units || []).map((u) => {
        const n = (m) => u.dtcs.filter((d) => d.mem === m).length;
        const r = { addr: u.addr, name: unitName(u.addr), faults: n('fault'), info: n('info'), perm: n('perm') };
        const parts = [];
        if (r.faults) parts.push(r.faults + (r.faults === 1 ? ' fault' : ' faults'));
        if (r.perm) parts.push(r.perm + ' permanent');
        if (r.info) parts.push(r.info + ' info');
        r.text = parts.length ? parts.join(', ') : 'clear';
        r.color = r.faults || r.perm ? 'warm' : r.info ? 'info' : 'ok';
        if (u.dtcs.some((d) => d.mem === 'fault' && (d.status & 1))) r.color = 'bad';
        return r;
    });
    return rows.sort((a, b) => (b.faults + b.perm) - (a.faults + a.perm) || b.info - a.info || a.addr - b.addr);
}

/** Every fault of one memory ('fault', 'info', 'perm'), with its unit's address, active ones first. */
function listOf(units, mem) {
    const out = [];
    (units || []).forEach((u) => u.dtcs.forEach((d) => { if (d.mem === mem) out.push(Object.assign({ addr: u.addr }, d)); }));
    return out.sort((a, b) => (b.status & 1) - (a.status & 1) || a.addr - b.addr || (a.code < b.code ? -1 : 1));
}

/* ---------- fault history (I9): every scan kept ---------- */

const fkey = (addr, d) => addr + ':' + d.code + ':' + (d.mem || 'fault');

/**
 * Adds one scan to the history log. log: { faults: { key: { addr, code, mem, events: [{ t, km, kind }] } }, last: Set-like
 * array of keys present at the last scan, units: addresses that answered then, clearedAt }. scan: { at, km, units }.
 * Events: 'first' (never seen before), 'again' (back after it had gone, or it failed again this drive while stored),
 * 'gone' (no longer there, nobody cleared it), 'cleared' (gone after a clear by this app). Only units that answered
 * both times count, so a silent unit does not make its faults look gone. Returns the events added.
 */
function addScan(log, scan) {
    log.faults = log.faults || {};
    const before = new Set(log.last || []), answered = new Set(log.units || []);
    const now = new Set(), added = [];
    const ev = (key, f, kind) => {
        const e = { t: scan.at, km: scan.km == null ? null : scan.km, kind: kind };
        f.events.push(e);
        if (f.events.length > 40) f.events.splice(0, f.events.length - 40);
        added.push({ key: key, kind: kind, code: f.code, addr: f.addr, mem: f.mem, t: scan.at });
    };
    (scan.units || []).forEach((u) => u.dtcs.forEach((d) => {
        if (d.mem === 'info') return;                // info memory entries are notes, not faults: no history
        const key = fkey(u.addr, d);
        now.add(key);
        let f = log.faults[key];
        if (!f) {
            f = log.faults[key] = { addr: u.addr, code: d.code, mem: d.mem || 'fault', events: [], status: d.status };
            ev(key, f, 'first');
        } else if (!before.has(key)) {
            // not there at the last scan: back again, if its unit answered then or it had gone before that
            const lastKind = f.events.length ? f.events[f.events.length - 1].kind : '';
            if (answered.has(u.addr) || lastKind === 'gone' || lastKind === 'cleared') ev(key, f, 'again');
        } else if ((d.status & 0x02) && !(f.status & 0x02)) {
            ev(key, f, 'again');                     // still stored, and it failed again during this drive
        }
        f.status = d.status;
    }));
    const nowUnits = new Set((scan.units || []).map((u) => u.addr));
    before.forEach((key) => {
        const f = log.faults[key];
        if (!f || now.has(key) || !nowUnits.has(f.addr)) return;
        ev(key, f, log.clearedAt && log.clearedAt > (log.lastAt || 0) ? 'cleared' : 'gone');
    });
    log.last = Array.from(now);
    log.units = Array.from(nowUnits);
    log.lastAt = scan.at;
    return added;
}
/** Marks that this app cleared the fault memory now: the next scan calls what went missing 'cleared'. */
function markCleared(log, t) { log.clearedAt = t; }

/**
 * The History tab's rows: the faults with events, newest first, each with bars between its events.
 * Returns [{ key, addr, code, mem, events, present }].
 */
function historyRows(log, max) {
    const last = new Set(log.last || []);
    return Object.keys(log.faults || {}).map((k) => Object.assign({ key: k, present: last.has(k) }, log.faults[k]))
        .filter((f) => f.events.length)
        .sort((a, b) => b.events[b.events.length - 1].t - a.events[a.events.length - 1].t)
        .slice(0, max || 6);
}
const EVENT_WORDS = { first: 'First seen', again: 'Seen again', gone: 'Gone by itself', cleared: 'Cleared' };

/* ---------- 12 V battery ---------- */

/** What the resting voltage says. v in volts (null: not known). warn: the warning level (default 12.4 V). */
function batteryVerdict(v, warn) {
    warn = warn || 12.4;
    if (v == null) return { word: 'Not known yet', color: 'dim', text: 'Health reads it after the car has slept. Open the app before you start the engine.' };
    if (v >= 12.6) return { word: 'Healthy', color: 'ok', text: 'Rests above 12.6 V: fully charged.' };
    if (v >= warn) return { word: 'Healthy', color: 'ok', text: 'Rests above ' + warn.toFixed(1) + ' V. No sign of a weak cell.' };
    if (v >= 12.0) return { word: 'Charge it', color: 'warm', text: 'Rests below ' + warn.toFixed(1) + ' V: a long drive or a charger helps.' };
    return { word: 'Weak', color: 'bad', text: 'Rests below 12.0 V: flat or a weak cell. Have it tested.' };
}
/** About how full a lead-acid or AGM battery is at rest (12.0 V empty, 12.7 V full), 0..100. */
function restCharge(v) {
    if (v == null) return null;
    return Math.round(Math.max(0, Math.min(1, (v - 12.0) / 0.7)) * 100);
}
/** The lowest voltage while cranking: normal above 9.6 V. */
function startVerdict(v) {
    if (v == null) return { text: 'measured when you start with the app open', color: 'dim' };
    if (v >= 10.0) return { text: 'cranking dip, normal', color: 'ok' };
    if (v >= 9.6) return { text: 'cranking dip, a bit deep', color: 'warm' };
    return { text: 'deep dip: the battery struggles', color: 'bad' };
}

/* ---------- service (the car's CBS and our own intervals) ---------- */

/** The car's CBS items we show, by CBS id, with a nominal interval for the bar (km and months; either may be 0). */
const CBS = {
    0x01: { name: 'Engine oil', km: 30000, months: 24, reset: true },
    0x02: { name: 'Front brakes', km: 60000, months: 0, reset: true },
    0x06: { name: 'Rear brakes', km: 80000, months: 0, reset: true },
    0x03: { name: 'Brake fluid', km: 0, months: 24, reset: true },
    0x64: { name: 'Vehicle check', km: 60000, months: 24, reset: true },
    0x11: { name: 'Vehicle check', km: 60000, months: 24, reset: false },
    0x0A: { name: 'Spark plugs', km: 60000, months: 0, reset: false },
    0x07: { name: 'Particulate filter', km: 0, months: 0, reset: false },
    0x20: { name: 'Inspection', km: 0, months: 24, reset: false },
    0x23: { name: 'Gearbox oil', km: 0, months: 0, reset: false },
};
/** The ids Health may reset (D20): oil, front and rear brakes, brake fluid, vehicle check; and only when the cluster lets it. */
const RESETTABLE = Object.keys(CBS).map(Number).filter((id) => CBS[id].reset);

/** "4 200 km", "12300km", "-1 500 km", "2 600 mi" -> km (miles converted); null when there is none. */
function parseWay(s) {
    const m = /(-?)\s*([\d][\d\s.,']*)\s*(km|mi|miles)\b/i.exec(String(s || ''));
    if (!m) return null;
    const n = Number(m[2].replace(/[\s.,']/g, ''));
    if (!isFinite(n)) return null;
    const km = /^mi/i.test(m[3]) ? n * 1.609344 : n;
    return Math.round(m[1] ? -km : km);
}
/** "09/2027", "09.2027", "15.09.2027", "2027-09" -> whole months from now (negative: overdue); null when unknown. */
function parseDue(s, now) {
    const str = String(s || '');
    let y, mo;
    let m = /(\d{1,2})[./](\d{4})/.exec(str);
    if (m) { mo = Number(m[1]); y = Number(m[2]); } else if ((m = /(\d{4})-(\d{1,2})/.exec(str))) { y = Number(m[1]); mo = Number(m[2]); } else return null;
    if (!(mo >= 1 && mo <= 12)) return null;
    const d = new Date(now || Date.now());
    return (y - d.getFullYear()) * 12 + (mo - 1 - d.getMonth());
}
const CBS_COLOURS = { DEFAULT: 0, RED: 1, YELLOW: 2, GREEN: 3, ORANGE: 4 };
/**
 * The car's CBS list as our items: [{ id, name, kmLeft, monthsLeft, left (text), frac (0..1 left), color, resettable }],
 * in the order oil, brakes, fluid, check, then the rest. list: [{ id, name, way, date, colour }] as the cluster sends it.
 */
function cbsItems(list, now) {
    const order = [0x01, 0x02, 0x06, 0x03, 0x64, 0x11, 0x0A, 0x20];
    return (list || []).filter((e) => e && e.id != null).map((e) => {
        const def = CBS[e.id] || { name: e.name || 'Service item ' + e.id, km: 0, months: 0 };
        const kmLeft = parseWay(e.way), monthsLeft = parseDue(e.date, now);
        const fr = [];
        if (kmLeft != null && def.km) fr.push(kmLeft / def.km);
        if (monthsLeft != null && def.months) fr.push(monthsLeft / def.months);
        const frac = fr.length ? Math.max(0, Math.min(1, Math.min.apply(null, fr))) : null;
        let left = '';
        if (kmLeft != null && (monthsLeft == null || (def.km && (!def.months || kmLeft / def.km <= monthsLeft / def.months)))) {
            left = kmLeft < 0 ? fmtThousands(-kmLeft) + ' km over' : fmtThousands(kmLeft) + ' km left';
        } else if (monthsLeft != null) {
            left = monthsLeft < 0 ? -monthsLeft + (monthsLeft === -1 ? ' month' : ' months') + ' over'
                : monthsLeft === 0 ? 'this month' : monthsLeft + (monthsLeft === 1 ? ' month' : ' months') + ' left';
        }
        const col = typeof e.colour === 'number' ? e.colour : CBS_COLOURS[String(e.colour)] || 0;
        const due = (kmLeft != null && kmLeft <= 1000) || (monthsLeft != null && monthsLeft <= 1);
        const color = col === 1 || (kmLeft != null && kmLeft < 0) || (monthsLeft != null && monthsLeft < 0) ? 'bad'
            : col === 2 || col === 4 || due ? 'warm' : 'ok';
        return { id: e.id, name: def.name, kmLeft: kmLeft, monthsLeft: monthsLeft, left: left, frac: frac, color: color,
            resettable: RESETTABLE.indexOf(e.id) >= 0 };
    }).sort((a, b) => {
        const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
}
/** 4200 -> "4 200" (a thin gap, as the mockups and the car write it). */
function fmtThousands(n) {
    const s = String(Math.round(Math.abs(n)));
    return (n < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** A cluster reply to 22 10 02 (which items may be reset): 62 10 02 [id reason reserve]... -> ids it allows now. */
function resettableNow(uds) {
    if (!uds || uds[0] !== 0x62 || uds[1] !== 0x10 || uds[2] !== 0x02) return null;
    const ok = [];
    for (let i = 3; i + 3 <= uds.length; i += 3) if (uds[i + 1] === 0 && RESETTABLE.indexOf(uds[i]) >= 0) ok.push(uds[i]);
    return ok;
}
/** The reset request for one item, byte for byte the workshop tool's CBS_RESET (upstream Service app). */
function resetRequest(id) {
    if (RESETTABLE.indexOf(id) < 0) throw new Error('CBS item ' + id + ' may not be reset');
    return [0x10, 0x01, 0x01, id, 0x64, 0x1F, 0x80, 0x00, 0x0F, 0xFF, 0x0F, 0x3F, 0xFF, 0x00];
}

/**
 * Our own intervals (I10): stricter defaults for harder driving, each changeable in Settings. One item is due after
 * `every` km (or years); `used` is how far it is since it was done: from the engine unit where it counts it (oil km
 * 4404, spark plug km 4163), else from the km this app counted since the user marked it done.
 */
const OURS = [
    { key: 'oil', name: 'Engine oil', unit: 'km', every: 10000, setting: 'ivOil' },
    { key: 'plugs', name: 'Spark plugs', unit: 'km', every: 40000, setting: 'ivPlugs' },
    { key: 'air', name: 'Air filter', unit: 'km', every: 30000, setting: 'ivAir' },
    { key: 'gearbox', name: 'Gearbox oil', unit: 'km', every: 60000, setting: 'ivGearbox' },
    { key: 'coolant', name: 'Coolant', unit: 'years', every: 4, setting: 'ivCoolant' },
];
/** [{ key, name, every, left, leftText, everyText, frac (left share), color }]. used: { key: km or years }. */
function ourItems(values, used, caps) {
    // oil and plugs need the engine unit's counters; the others count the km Health sees (the speed signal)
    const src = { oil: 'oilKm', plugs: 'plugKm', air: 'speed', gearbox: 'speed', coolant: null };
    return OURS.filter((o) => !caps || src[o.key] === null || has(caps, src[o.key])).map((o) => {
        const every = values && values[o.setting] != null ? values[o.setting] : o.every;
        const u = used && used[o.key] != null ? used[o.key] : null;
        const left = u == null ? null : every - u;
        const frac = left == null ? null : Math.max(0, Math.min(1, left / every));
        const leftText = left == null ? '--' : o.unit === 'km' ? (left < 0 ? fmtThousands(-left) + ' km over' : fmtThousands(left) + ' km')
            : (left < 0 ? 'over by ' + (-left).toFixed(1) + ' y' : left >= 1 ? Math.round(left) + (Math.round(left) === 1 ? ' year' : ' years') : Math.round(left * 12) + ' months');
        const everyText = 'every ' + (o.unit === 'km' ? fmtThousands(every) + ' km' : every + ' years');
        const color = frac == null ? 'dim' : left < 0 ? 'bad' : frac < 0.34 ? 'warm' : 'ok';
        return { key: o.key, name: o.name, every: every, left: left, leftText: leftText, everyText: everyText, frac: frac, color: color };
    });
}

/** The parts a user can plan for the next service (I10), grouped as the Add a part dialog shows them. */
const PARTS = {
    Engine: ['Oil filter', 'Engine oil', 'Spark plugs', 'Air filter', 'Ignition coils', 'Drive belt'],
    Brakes: ['Front pads', 'Rear pads', 'Front discs', 'Rear discs', 'Brake fluid'],
    Other: ['Cabin filter', 'Wipers', 'Coolant', 'Gearbox oil', '12 V battery'],
};

/* ---------- tyres ---------- */

/** Least squares slope of [[t ms, value]] in value per week; null with fewer than 3 points or under 5 days. */
function slopePerWeek(pts) {
    const p = (pts || []).filter((q) => q && isFinite(q[1]));
    if (p.length < 3 || p[p.length - 1][0] - p[0][0] < 5 * DAY) return null;
    const n = p.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    p.forEach((q) => { const x = q[0] / WEEK; sx += x; sy += q[1]; sxx += x * x; sxy += x * q[1]; });
    const d = n * sxx - sx * sx;
    return d ? (n * sxy - sx * sy) / d : null;
}
const WHEELS = ['FL', 'FR', 'RL', 'RR'];
const WHEEL_NAMES = { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right' };
/**
 * Tyres: which one is low now (warn bar below the average of the others) and which one loses air over the weeks
 * while the others hold. cold: { FL: [[t, bar]] ... } daily cold pressures. Returns
 * { low: wheel | null, lowBy, leak: wheel | null, perWeek, slopes, color, text, hint }.
 */
function tyreCheck(now, cold, warn) {
    warn = warn || 0.1;
    const out = { low: null, lowBy: 0, leak: null, perWeek: 0, slopes: {}, color: 'dim', text: 'no pressures yet', hint: '' };
    const have = WHEELS.filter((w) => now && now[w] != null);
    if (have.length === 4) {
        let worst = null, by = 0;
        WHEELS.forEach((w) => {
            const others = WHEELS.filter((x) => x !== w).map((x) => now[x]);
            const diff = others.reduce((a, b) => a + b, 0) / 3 - now[w];
            if (diff > by) { by = diff; worst = w; }
        });
        if (by >= warn - 1e-9) { out.low = worst; out.lowBy = Math.round(by * 100) / 100; }
    }
    WHEELS.forEach((w) => { out.slopes[w] = slopePerWeek(cold && cold[w]); });
    let leak = null, rate = 0;
    WHEELS.forEach((w) => {
        const s = out.slopes[w];
        if (s == null || s > -0.02) return;
        const others = WHEELS.filter((x) => x !== w).map((x) => out.slopes[x]).filter((x) => x != null);
        if (others.length && others.every((x) => x > -0.01) && s < rate) { rate = s; leak = w; }
    });
    if (leak) { out.leak = leak; out.perWeek = Math.round(-rate * 100) / 100; }
    if (!have.length) return out;
    if (out.leak) {
        out.color = 'warm';
        out.text = 'Losing about ' + out.perWeek.toFixed(2) + ' bar a week while the others hold.';
        out.hint = 'A slow leak is likely: check the valve and tread for a nail.';
    } else if (out.low) {
        out.color = 'warm';
        out.text = WHEEL_NAMES[out.low] + ' is ' + out.lowBy.toFixed(2) + ' bar lower than the others.';
        out.hint = 'Check it cold and fill it to the door pillar value.';
    } else {
        out.color = 'ok';
        out.text = 'All four hold their pressure.';
        out.hint = 'Compared with each other and over the weeks.';
    }
    return out;
}

/* ---------- the score ---------- */

/**
 * The Health score (0 to 100) from six checks. in = {
 *   faults: [{ status, mem }] (fault and perm memory), battery: resting V or null, batteryWarn,
 *   oil: 'ok' | 'low' | null, service: [cbsItems], tyres: tyreCheck result, cc: number of Check Control messages or null }.
 * A check that is not known costs nothing and shows dim. Returns { value, word, color, checks: [{ key, label, color, cost }] }.
 */
function score(inp) {
    inp = inp || {};
    const checks = [];
    const add = (key, label, color, cost) => checks.push({ key: key, label: label, color: color, cost: Math.round(cost) });
    // faults: an active one counts a lot, a stored one a little, a permanent emission fault in between
    const fl = (inp.faults || []).filter((d) => d.mem !== 'info');
    if (inp.faults == null) add('faults', 'Faults', 'dim', 0);
    else {
        const act = fl.filter((d) => d.status & 1).length, perm = fl.filter((d) => d.mem === 'perm').length;
        const stored = fl.length - act - perm;
        const cost = Math.min(40, act * 15) + Math.min(20, perm * 10) + Math.min(16, stored * 4);
        add('faults', 'Faults', act ? 'bad' : fl.length ? 'warm' : 'ok', cost);
    }
    const warn = inp.batteryWarn || 12.4;
    if (inp.battery == null) add('battery', '12 V', 'dim', 0);
    else add('battery', '12 V', inp.battery < 12.0 ? 'bad' : inp.battery < warn ? 'warm' : 'ok', inp.battery < 12.0 ? 20 : inp.battery < warn ? 10 : 0);
    if (inp.oil == null) add('oil', 'Oil', 'dim', 0);
    else add('oil', 'Oil', inp.oil === 'low' ? 'bad' : 'ok', inp.oil === 'low' ? 12 : 0);
    if (!inp.service || !inp.service.length) add('service', 'Service', 'dim', 0);
    else {
        const over = inp.service.filter((s) => s.color === 'bad').length, soon = inp.service.filter((s) => s.color === 'warm').length;
        add('service', 'Service', over ? 'bad' : soon ? 'warm' : 'ok', Math.min(20, over * 10) + Math.min(8, soon * 4));
    }
    const ty = inp.tyres;
    if (!ty || ty.color === 'dim') add('tyres', 'Tyres', 'dim', 0);
    else add('tyres', 'Tyres', ty.color, ty.low || ty.leak ? 6 : 0);    // one tyre to look at, whether low now or losing air
    if (inp.cc == null) add('cc', 'Check Control', 'dim', 0);
    else add('cc', 'Check Control', inp.cc ? 'warm' : 'ok', Math.min(15, inp.cc * 5));
    const value = Math.max(0, Math.min(100, 100 - checks.reduce((a, c) => a + c.cost, 0)));
    const known = checks.some((c) => c.color !== 'dim');
    return { value: known ? value : null, word: !known ? 'NOT CHECKED' : value >= 80 ? 'GOOD' : value >= 60 ? 'FAIR' : 'POOR',
        color: !known ? 'dim' : value >= 80 ? 'ok' : value >= 60 ? 'warm' : 'bad', checks: checks };
}


/* ---------- what this car supports (owner rule, 2026-11-26 18:21) ---------- */

/**
 * Health shows only what this car reports or answers: every card, page, chart line, setting and action appears only
 * once its capability is true. A capability is found at start or on first use and remembered per car: true (the car
 * reports it), false (asked, no answer), missing (not asked yet). Demo data has them all.
 */
const CAPS = ['faults', 'info', 'perm', 'volts', 'soc', 'oilLevel', 'oilTemp', 'coolantTemp', 'oilKm', 'plugKm', 'speed', 'tpms', 'cbs', 'cc'];
const ALL_CAPS = (function () { const o = { cbsIds: null }; CAPS.forEach((k) => { o[k] = true; }); return o; })();
const has = (caps, k) => !!(caps && caps[k] === true);
/** Notes what a reply or a signal showed: sets caps[k] and says whether it changed. A true is never taken back by a miss. */
function found(caps, k, yes) {
    const was = caps[k];
    if (yes) caps[k] = true; else if (was !== true) caps[k] = false;
    return was !== caps[k];
}
/** The pages this car has something for (indexes into the tab list: Overview, Faults, Battery, Service, Tyres, Fluids, History, Share). */
function pagesFor(caps, S) {
    const out = [0];
    if (has(caps, 'faults')) out.push(1);
    if (has(caps, 'volts') || has(caps, 'soc')) out.push(2);
    if (has(caps, 'cbs') || (S && S.ours && S.ours.length)) out.push(3);
    if (has(caps, 'tpms')) out.push(4);
    if (has(caps, 'oilLevel') || has(caps, 'cc') || has(caps, 'oilTemp') || has(caps, 'coolantTemp')) out.push(5);
    out.push(6, 7);
    return out;
}

/* ---------- days, weeks ---------- */

/** One value per week for the last n weeks from [[t, v]] (the week's mean; null for a week without any). */
function weekly(pts, now, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
        const t1 = now - i * WEEK, t0 = t1 - WEEK;
        const v = (pts || []).filter((p) => p[0] > t0 && p[0] <= t1).map((p) => p[1]);
        out.push(v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
    }
    return out;
}
/** "today", "yesterday", "3 days ago", "2 weeks ago" */
function ago(t, now) {
    const d = Math.floor((now - t) / DAY);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 14) return d + ' days ago';
    if (d < 60) return Math.round(d / 7) + ' weeks ago';
    return Math.round(d / 30) + ' months ago';
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateText = (t) => { const d = new Date(t); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
const dayMonth = (t) => { const d = new Date(t); return d.getDate() + ' ' + MON[d.getMonth()]; };

/* ---------- the report (Share) ---------- */

/**
 * The plain-text report for the QR code: short lines a phone camera shows as they are. s = {
 *   at, km, score, faults: [{ addr, code, text, status, count }], battery, batteryVerdict, oil, service: [cbsItems],
 *   tyres: tyreCheck, pressures, parts: [names] }. Stays within one QR code (about 1000 bytes).
 */
function report(s) {
    const L = [];
    const sc = s.score || {};
    L.push('Paget96 Garage Health report');
    L.push('Health ' + (sc.value == null ? '--' : sc.value) + ' of 100, ' + String(sc.word || '').toLowerCase() + '. Checked ' +
        dateText(s.at) + (s.km != null ? ', ' + fmtThousands(s.km) + ' km' : '') + '.');
    const f = (s.faults || []).filter((d) => d.mem !== 'info');
    const act = f.filter((d) => d.status & 1).length;
    if (s.faults) L.push('Faults: ' + (f.length ? f.length + ' stored, ' + (act ? act + ' active' : 'none active') : 'none') + '.');
    if (s.faults) f.slice(0, 6).forEach((d) => L.push('  ' + d.code + ' ' + (d.text || '') + ' (' + (UNITS[d.addr] ? UNITS[d.addr][0].toLowerCase() : unitName(d.addr)) + ')' +
        (d.count ? ', seen ' + (d.count === 1 ? 'once' : d.count + ' times') : '') + '.'));
    if (s.faults && f.length > 6) L.push('  and ' + (f.length - 6) + ' more.');
    if (s.battery != null) L.push('12 V battery: rests at ' + s.battery.toFixed(2) + ' V, ' + String((s.batteryVerdict || batteryVerdict(s.battery)).word).toLowerCase() + '.');
    const svc = (s.service || [])[0];
    const oilL = s.oil === 'low' ? 'Oil: level low.' : s.oil === 'ok' ? 'Oil: level OK.' : '';
    const svcL = svc ? 'Service: ' + svc.name.toLowerCase() + ' ' + svc.left.replace(' left', '') + '.' : '';
    if (oilL || svcL) L.push((oilL + ' ' + svcL).trim());
    const ty = s.tyres;
    if (ty && ty.leak) L.push('Tyres: ' + WHEEL_NAMES[ty.leak].toLowerCase() + ' ' + (s.pressures && s.pressures[ty.leak] != null ? s.pressures[ty.leak].toFixed(2) + ' bar, ' : '') + 'slowly losing air.');
    else if (ty && ty.low) L.push('Tyres: ' + WHEEL_NAMES[ty.low].toLowerCase() + ' ' + ty.lowBy.toFixed(2) + ' bar low.');
    else if (ty && ty.color === 'ok') L.push('Tyres: all four OK.');
    if (s.parts && s.parts.length) L.push('Next service parts: ' + s.parts.join(', ') + '.');
    let text = L.join('\n');
    if (Buffer.byteLength(text, 'utf8') > 1000) text = text.slice(0, 990) + '...';
    return text;
}

/**
 * The derived parts of the page state, the same for live and demo data: service items, our intervals, tyres, the
 * score and the report. S: the raw state (units, battery, cbs, used, pressures, cold, fluids, cc, seen, parts, km).
 * values: the settings. textOf(code): a fault's short words. Returns S, filled in.
 */
function derive(S, values, textOf) {
    const vals = values || {}, now = S.at || Date.now();
    const caps = S.caps = S.caps || ALL_CAPS;
    S.values = vals;
    S.service = has(caps, 'cbs') ? cbsItems(S.cbs, now) : [];
    // an item can be reset only when the cluster lists it (22 10 02, read when the screen first shows)
    S.service.forEach((it) => { if (caps.cbsIds && caps.cbsIds.indexOf(it.id) < 0) it.resettable = false; if (!caps.cbsIds && caps !== ALL_CAPS) it.resettable = false; });
    S.ours = vals.intervals === 'car' ? [] : ourItems(vals, S.used, caps);
    S.tyres = has(caps, 'tpms') ? tyreCheck(S.pressures, S.cold, vals.tyreWarn || 0.1) : null;
    const fl = S.units && has(caps, 'faults') ? listOf(S.units, 'fault').concat(has(caps, 'perm') ? listOf(S.units, 'perm') : []) : null;
    const oil = !has(caps, 'oilLevel') || !S.fluids || S.fluids.oilCl == null ? null : S.fluids.oilCl < 20 ? 'low' : 'ok';
    const bat = has(caps, 'volts') && S.battery ? S.battery.rest : null;
    S.score = score({ faults: fl, battery: bat, batteryWarn: vals.batteryWarn, oil: oil, service: S.service, tyres: S.tyres, cc: has(caps, 'cc') ? S.cc : null });
    S.score.checks = S.score.checks.filter((c) => c.color !== 'dim');
    const rep = fl && fl.map((f) => Object.assign({}, f, { text: textOf ? textOf(f.code) : '', count: S.seen && S.seen[f.code] ? S.seen[f.code].count : null }));
    S.report = report({ at: now, km: S.km, score: S.score, faults: rep, battery: bat, oil: oil, service: S.service, tyres: S.tyres,
        pressures: S.pressures, parts: S.parts });
    S.cards = null;
    return S;
}

module.exports = {
    derive, CAPS, ALL_CAPS, has, found, pagesFor,
    DAY, WEEK, UNITS, unitName, parseDtcReply, parsePermanent, faultState, statusWords, byUnit, listOf,
    fkey, addScan, markCleared, historyRows, EVENT_WORDS,
    batteryVerdict, restCharge, startVerdict,
    CBS, RESETTABLE, parseWay, parseDue, cbsItems, fmtThousands, resettableNow, resetRequest, OURS, ourItems, PARTS,
    slopePerWeek, WHEELS, WHEEL_NAMES, tyreCheck, score, weekly, ago, dateText, dayMonth, report,
};
