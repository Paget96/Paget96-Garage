// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * diaglink.js - Health's only way to the car's control units. Everything goes through check() below.
 *
 * Reads (any time the app's screen is shown, never in the background):
 *   22 <DID>        one value from one unit           kit readonly-diag.js (ReadOnlyDiag), untouched
 *   19 02 / 19 17   fault memory / info memory        to all units (0xDF), as BMW's teleservice reads them
 *   19 03 / 04 / 06 a fault's snapshot list, one snapshot (freeze frame), its extended data: one unit
 *   0A              OBD permanent emission faults     the engine unit only
 *
 * The two writes the owner approved (D19, D20), each only with a grant (grant() below): made by a tap and its
 * confirmation, single use, good for 15 s, and only while the engine is off (engine speed 0, checked again here):
 *   clear     14 FF FF FF   the fault memory, to all units, then to each unit that did not confirm; a unit that
 *                           refuses for its session is asked once more in the extended session (10 03, back to 10 01)
 *   cbsReset  2E 10 01 ..   one service item in the instrument cluster (0x60), when its own 22 10 02 allows it
 *
 * Anything else throws before it reaches the transport. The kit's readonly-diag.js has no fault reads (19), so the
 * fault reads go through a Diag kept private here (in a WeakMap, out of reach of the rest of the app).
 */
function kit(n) {
    try { return require('./kit/' + n); } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') throw e;
        return require('../../upstream-kit/kit/runtime/' + n);
    }
}

const ALL = 0xDF, ENGINE = 0x12, KOMBI = 0x60;
const READ_19 = [0x02, 0x17, 0x03, 0x04, 0x06];
const GRANT_MS = 15000;
const byte = (b) => Number.isInteger(b) && b >= 0 && b <= 0xFF;

/**
 * Throws unless the request is one of Health's reads, or (write true) one of its two writes.
 * Exported for the tests. target: address; functional: sent to all units (0xDF).
 */
function check(target, sid, data, functional, write) {
    if (!Array.isArray(data) || !data.every(byte) || !byte(sid) || !byte(target)) throw new Error('health: bad request');
    if (functional !== (target === ALL)) throw new Error('health: 0xDF only as a request to all units');
    if (sid === 0x19) {
        if (READ_19.indexOf(data[0]) < 0) throw new Error('health: 19 ' + data[0] + ' is not used');
        if (functional && data[0] !== 0x02 && data[0] !== 0x17) throw new Error('health: only 19 02 and 19 17 go to all units');
        return 'read';
    }
    if (sid === 0x0A) {
        if (data.length || target !== ENGINE) throw new Error('health: 0A goes to the engine unit, with no data');
        return 'read';
    }
    if (!write) throw new Error('health: service ' + sid.toString(16) + ' is not a read');
    if (sid === 0x14) {
        if (data.length !== 3 || data[0] !== 0xFF || data[1] !== 0xFF || data[2] !== 0xFF) throw new Error('health: only 14 FF FF FF');
        return 'clear';
    }
    if (sid === 0x10) {
        if (functional || data.length !== 1 || (data[0] !== 0x01 && data[0] !== 0x03)) throw new Error('health: only sessions 01 and 03, to one unit');
        return 'clear';
    }
    if (sid === 0x2E) {
        if (target !== KOMBI || data.length !== 14 || data[0] !== 0x10 || data[1] !== 0x01) throw new Error('health: only the cluster CBS reset');
        return 'cbs';
    }
    throw new Error('health: service ' + sid.toString(16) + ' is not allowed');
}

const PRIVATE = new WeakMap();      // HealthLink -> { diag, ro }

class HealthLink {
    /** opts: { engineStopped() -> true only when the engine speed is known to be 0 } */
    constructor(signals, log, opts) {
        this.log = log;
        this.opts = opts || {};
        this.shown = false;
        this.grants = new Set();
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

    /** The app's screen shown (true) or left (false): nothing is sent while it is not, and what waits is dropped. */
    setShown(on) {
        this.shown = !!on;
        if (!on) { PRIVATE.get(this).ro.cancel(); this.grants.clear(); }
    }
    _gate() { if (!this.shown) throw new Error('health: the screen is not shown'); }

    _send(kind, target, sid, data, opts, grant) {
        this._gate();
        const functional = target === ALL;
        const what = check(target, sid, data, functional, kind !== 'read');
        if (kind !== what) throw new Error('health: ' + kind + ' request is a ' + what);
        if (kind !== 'read') this._use(grant, kind);
        const diag = PRIVATE.get(this).diag;
        const accept = (u) => (u[0] === sid + 0x40 && (sid !== 0x19 || u[1] === data[0])) || (u[0] === 0x7F && u[1] === sid);
        return functional ? diag.functional(sid, data, opts) : diag.physical(target, sid, data, (opts && opts.timeoutMs) || 4000, accept);
    }

    /* ---------- reads ---------- */

    /** One identifier from one unit (ReadOnlyDiag): the reply bytes or null. */
    read(target, did) { this._gate(); return PRIVATE.get(this).ro.read(target, did); }
    /** Fault memory (mem 'fault', 19 02) or info memory ('info', 19 17) of every unit: Map(address -> reply). */
    readMemory(mem, mask, onReply) {
        const params = mem === 'info' ? [0x17, mask, 0x01] : [0x02, mask];
        return this._send('read', ALL, 0x19, params, { onReply: onReply }).then((m) => ({ params: params, replies: m }));
    }
    /** OBD permanent faults (0A) from the engine unit: the reply or null. */
    readPermanent() { return this._send('read', ENGINE, 0x0A, []); }
    /** What one unit kept about one fault: its snapshot ids, the first snapshot (freeze frame), the extended data. */
    async readContext(addr, code) {
        const n = parseInt(code, 16), cb = [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
        const out = { ids: [], snapshot: null, extended: null };
        const r3 = await this._send('read', addr, 0x19, [0x03]);
        if (r3 && r3[0] === 0x59) for (let i = 2; i + 4 <= r3.length; i += 4) if (r3[i] === cb[0] && r3[i + 1] === cb[1] && r3[i + 2] === cb[2]) out.ids.push(r3[i + 3]);
        if (out.ids.length) {
            const r4 = await this._send('read', addr, 0x19, [0x04].concat(cb, [out.ids[0]]));
            if (r4 && r4[0] === 0x59 && r4.length >= 10) out.snapshot = { record: r4[6], did: (r4[8] << 8) | r4[9], data: r4.slice(10) };
        }
        const r6 = await this._send('read', addr, 0x19, [0x06].concat(cb, [0xFF]));
        if (r6 && r6[0] === 0x59 && r6.length >= 6) out.extended = r6.slice(6);
        return out;
    }

    /* ---------- the two writes ---------- */

    /**
     * A grant for one write ('clear' or 'cbs'), made after the user confirmed it. Refused unless the engine is off,
     * the screen shows and (for a clear) the report was saved first. Single use, 15 s.
     */
    grant(kind, opts) {
        this._gate();
        if (kind !== 'clear' && kind !== 'cbs') throw new Error('health: no such write');
        if (!opts || opts.confirmed !== true) throw new Error('health: not confirmed');
        if (kind === 'clear' && opts.reportSaved !== true) throw new Error('health: save the report first');
        if (!(this.opts.engineStopped && this.opts.engineStopped() === true)) throw new Error('Engine running or not known: switch the engine off, ignition on');
        const g = { kind: kind, until: Date.now() + GRANT_MS };
        this.grants.add(g);
        return g;
    }
    _use(g, kind) {
        if (!g || !this.grants.has(g) || g.kind !== kind || Date.now() > g.until) throw new Error('health: no valid grant for ' + kind);
        if (!(this.opts.engineStopped && this.opts.engineStopped() === true)) throw new Error('Engine running or not known');
    }

    /**
     * Clears the fault memory of `units` (addresses with faults): first to all units at once, then each that did not
     * confirm. Resolves { cleared: [addr], failed: [{ addr, why }] }. The grant is used up.
     */
    async clearFaults(grant, units) {
        this._use(grant, 'clear');
        const cleared = [], failed = [];
        try {
            let all = new Map();
            try { all = await this._send('clear', ALL, 0x14, [0xFF, 0xFF, 0xFF], { idleMs: 5000 }, grant); } catch (e) { this.log.warn('clear all: ' + e); }
            for (const a of units) {
                const r0 = all.get(a);
                if (r0 && r0[0] === 0x54) { cleared.push(a); continue; }
                const ask = () => this._send('clear', a, 0x14, [0xFF, 0xFF, 0xFF], { timeoutMs: 8000 }, grant);
                let r = (await ask()) || (await ask());
                if (r && r[0] === 0x7F && [0x22, 0x31, 0x33, 0x7E, 0x7F].indexOf(r[2]) >= 0) {
                    const ext = await this._send('clear', a, 0x10, [0x03], { timeoutMs: 3000 }, grant);
                    if (ext && ext[0] === 0x50) {
                        r = (await ask()) || r;
                        await this._send('clear', a, 0x10, [0x01], { timeoutMs: 3000 }, grant);
                    }
                }
                if (r && r[0] === 0x54) cleared.push(a);
                else failed.push({ addr: a, why: !r ? 'no answer' : r[0] === 0x7F && r[2] === 0x22 ? 'refused now (engine on?)' : 'refused' });
            }
        } finally { this.grants.delete(grant); }
        return { cleared: cleared, failed: failed };
    }

    /** Which of Health's service items the cluster allows to reset now (22 10 02): the reply bytes, or null. */
    cbsResettable() { return this.read(KOMBI, 0x1002); }
    /** The cluster's CBS record (22 10 01): { id: { avail %, count } } or null. */
    async cbsRecord() {
        const r = await this.read(KOMBI, 0x1001);
        if (!r || r[0] !== 0x62) return null;
        const out = {};
        for (let i = 3; i + 12 <= r.length; i += 12) out[r[i]] = { avail: r[i + 5], count: r[i + 4] & 0x1F };
        return out;
    }
    /** Resets one service item: request = model.resetRequest(id). Resolves true when the cluster confirmed (6E). */
    async cbsReset(grant, request) {
        this._use(grant, 'cbs');
        try {
            const r = await this._send('cbs', KOMBI, 0x2E, request, { timeoutMs: 6000 }, grant);
            return !!(r && r[0] === 0x6E);
        } finally { this.grants.delete(grant); }
    }
}

module.exports = { HealthLink, check, ALL, ENGINE, KOMBI };
