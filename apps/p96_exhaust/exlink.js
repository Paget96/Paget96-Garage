// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
// The flap requests, the flap probe and the twin engine unit list are adapted from idrive7-apps
// apps/live_adjustments (diaglink.js, real_adapters.js), MIT, Copyright (c) 2026 cauliflowermossgrape; see NOTICE.
'use strict';
/**
 * exlink.js - Exhaust's only way to the engine unit. Everything goes through check() below.
 *
 * Reads (22 <DID>, the kit's readonly-diag.js, untouched):
 *   the exhaust values (soot, ash, filter load and temperature, exhaust temperature after the catalyst, exhaust VANOS,
 *   engine load), only while Exhaust's screen is shown;
 *   the flap probe (22 F1 50, 62 FD, 64 FD, 63 1E) and the flap read-back (22 62 FD), when the screen is shown or
 *   the flap control is armed.
 *
 * The one write the owner approved (D21): the exhaust flap, BMW's own InputOutputControl on the engine unit, the
 * same bytes upstream's Engine Config sends, and nothing else:
 *   2F 60 FD 03 03 E8   open   (10 % duty, BMW's "Auffahren" band 8 to 12 %)
 *   2F 60 FD 03 23 28   close  (90 % duty, BMW's "Zufahren" band 88 to 92 %)
 *   2F 60 FD 00         hand back to the engine unit (the car decides)
 *   2F 61 1E 03 20 00 / 03 00 00 / 00   the same for the controlled flap of the G-series V8s (GER_EL_AGK),
 *                                       used only for a unit that refuses 60 FD but answers its read 63 1E
 * to the engine unit 0x12, and on a V8 with two engine units also 0x13 (each drives its bank's flap).
 * Each only when the flap control is armed (Settings, Simulated by default); flap.js decides when.
 */
function kit(n) {
    try { return require('./kit/' + n); } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') throw e;
        return require('../../kit/runtime/' + n);
    }
}

const DME = 0x12, DME2 = 0x13;
// a V8's master index (22 F1 50): it has a second engine unit at 0x13, with its bank's own flap (kit/twin_dme.js)
const TWIN = ['0F1A10', '0F1A20', '0F242C', '0F242E', '0F2460', '0F26B8', '0F26BC', '0F2E00'];
const DID = { SGBD: 0xF150, ASW: 0x62FD, ASG: 0x64FD, GER_ASW: 0x631E };
/** The only write requests: [data] per kind, for the electric flap (60 FD) and the controlled flap (61 1E). */
const REQ = {
    el: { open: [0x60, 0xFD, 0x03, 0x03, 0xE8], closed: [0x60, 0xFD, 0x03, 0x23, 0x28], oem: [0x60, 0xFD, 0x00] },
    ger: { open: [0x61, 0x1E, 0x03, 0x20, 0x00], closed: [0x61, 0x1E, 0x03, 0x00, 0x00], oem: [0x61, 0x1E, 0x00] },
};
const ALLOWED = [].concat(Object.keys(REQ.el).map((k) => REQ.el[k]), Object.keys(REQ.ger).map((k) => REQ.ger[k]));
const byte = (b) => Number.isInteger(b) && b >= 0 && b <= 0xFF;
const hex2 = (n) => (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
const NRC = { 0x10: 'refused', 0x11: 'not supported', 0x12: 'not supported', 0x13: 'wrong length', 0x22: 'not now (conditions)',
    0x31: 'out of range', 0x33: 'locked', 0x7E: 'not in this session', 0x7F: 'not in this session' };

/** Throws unless the write is one of the flap requests above, to an engine unit. Exported for the tests. */
function check(target, sid, data) {
    if (!Array.isArray(data) || !data.every(byte) || !byte(sid) || !byte(target)) throw new Error('exhaust: bad request');
    if (sid !== 0x2F) throw new Error('exhaust: service ' + hex2(sid) + ' is not allowed, only the flap (2F)');
    if (target !== DME && target !== DME2) throw new Error('exhaust: the flap only goes to the engine unit');
    const ok = ALLOWED.some((a) => a.length === data.length && a.every((b, i) => b === data[i]));
    if (!ok) throw new Error('exhaust: 2F ' + data.map(hex2).join(' ') + ' is not one of the flap requests');
    return true;
}

const PRIVATE = new WeakMap();      // ExLink -> { diag, ro }

class ExLink {
    constructor(signals, log) {
        this.log = log;
        this.shown = false;
        this.units = null;          // the flap probe: [{ addr, el, ger }]
        const { Diag } = kit('diag');
        const { ReadOnlyDiag } = kit('readonly-diag');
        const diag = new Diag(signals, log);
        diag.quiet = true;
        PRIVATE.set(this, { diag: diag, ro: new ReadOnlyDiag(signals, log), ready: null });
    }
    init() {
        const p = PRIVATE.get(this);
        if (!p.ready) p.ready = Promise.all([p.diag.init(), p.ro.init()]).then(() => this);
        return p.ready;
    }
    get available() { const p = PRIVATE.get(this); return !!(p.diag.p && p.diag.available); }
    /** fn(on) when the link comes up (ignition on) or goes. */
    onAvailable(fn) { PRIVATE.get(this).diag.on('available', (on) => fn(!!on)); }

    /** The screen shown (true) or left: the exhaust values are read only while it is; what waits is dropped. */
    setShown(on) {
        this.shown = !!on;
        if (!on) PRIVATE.get(this).ro.cancel();
    }

    /** One exhaust value (22 <did>) from the engine unit: the reply bytes, or null. Only while the screen shows. */
    value(did, addr) {
        if (!this.shown) return Promise.resolve(null);
        return PRIVATE.get(this).ro.read(addr || DME, did);
    }
    /**
     * The read-only link for the engine's facts (lib/engine.js Detector: 22 F1 50, 22 F6 A0, OBD 01 51 and 01 85), only
     * while the screen is shown; null otherwise. Reads only: the kit's ReadOnlyDiag refuses anything else.
     */
    engineLink() {
        if (!this.shown) return null;
        const ro = PRIVATE.get(this).ro;
        return { physical: (addr, sid, data, ms, ok) => (this.shown ? ro.physical(addr, sid, data, ms, ok) : Promise.resolve(null)) };
    }
    /** A flap read (the probe or the read-back): reads only, allowed when shown or armed. */
    _flapRead(addr, did) { return PRIVATE.get(this).ro.read(addr, did, 2000); }

    /**
     * Which engine units have a flap (22 62 FD or 64 FD answers: the electric flap; 63 1E: the controlled flap), the
     * second unit of a V8 included. Resolves [{ addr, el, ger }]; an empty list: no flap this app can drive.
     */
    async probe() {
        const pos = (r, did) => !!(r && r[0] === 0x62 && ((r[1] << 8) | r[2]) === did);
        const one = async (addr) => {
            const el = pos(await this._flapRead(addr, DID.ASW), DID.ASW) || pos(await this._flapRead(addr, DID.ASG), DID.ASG);
            const ger = pos(await this._flapRead(addr, DID.GER_ASW), DID.GER_ASW);
            return el || ger ? { addr: addr, el: el, ger: ger } : null;
        };
        const units = [];
        const first = await one(DME);
        if (first) units.push(first);
        const sg = await this._flapRead(DME, DID.SGBD);
        const idx = sg && sg[0] === 0x62 && sg.length >= 6 ? sg.slice(3, 6).map(hex2).join('') : '';
        if (TWIN.indexOf(idx) >= 0) { const second = await one(DME2); if (second) units.push(second); }
        this.units = units;
        this.log.info('flap probe: ' + (units.length ? units.map((u) => hex2(u.addr) + (u.el ? ' el' : '') + (u.ger ? ' ger' : '')).join(', ') : 'no flap') + (idx ? ' (index ' + idx + ')' : ''));
        return units;
    }

    /** The flap's commanded duty (22 62 FD), in %: what a tester last drove it to, or null. */
    async readFlap(unit) {
        const r = await this._flapRead(unit.addr, DID.ASW);
        return r && r[0] === 0x62 && r.length >= 5 ? ((r[3] << 8) | r[4]) / 100 : null;
    }

    /**
     * Sends one flap request ('open', 'closed' or 'oem') to one unit. armed must be true (the setting, checked again
     * by the caller); a refused 60 FD goes to the controlled flap (61 1E) where the unit has one, and a hand back goes
     * to what took the flap. Resolves { ok, detail, via }.
     */
    async send(unit, kind, armed) {
        if (armed !== true) { const e = new Error('the flap control is not armed'); e.blocked = true; throw e; }
        if (!REQ.el[kind]) throw new Error('exhaust: no such flap request');
        const diag = PRIVATE.get(this).diag;
        const go = async (data) => {
            check(unit.addr, 0x2F, data);
            this.log.info('flap -> ' + hex2(unit.addr) + ': 2F ' + data.map(hex2).join(' '));
            const echo = data.slice(0, 3);
            const u = await diag.physical(unit.addr, 0x2F, data, 3000, (x) => (x[0] === 0x6F && echo.every((b, i) => x[i + 1] === b)) || (x[0] === 0x7F && x[1] === 0x2F));
            if (!u) return { ok: false, detail: 'no answer' };
            if (u[0] === 0x7F) return { ok: false, detail: NRC[u[2]] || 'refused (' + hex2(u[2]) + ')' };
            return { ok: true, detail: 'accepted' };
        };
        let r = null, via = 'el';
        if (kind === 'oem') {
            if (unit.el) r = await go(REQ.el.oem);
            if (unit.ger && (unit.viaGer || !(r && r.ok))) { const g = await go(REQ.ger.oem); if (!(r && r.ok)) { r = g; via = 'ger'; } }
            unit.viaGer = false;
        } else {
            if (unit.el) r = await go(REQ.el[kind]);
            if (!(r && r.ok) && unit.ger) {
                const first = r;
                r = await go(REQ.ger[kind]); via = 'ger'; unit.viaGer = !!r.ok;
                if (!r.ok && first) r = { ok: false, detail: '60FD ' + first.detail + ', 611E ' + r.detail };
            }
        }
        return Object.assign({ via: via }, r || { ok: false, detail: 'no flap on this unit' });
    }
}

module.exports = { ExLink, check, REQ, DME, DME2, TWIN, DID };
