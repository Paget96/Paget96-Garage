// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog's reads from the engine unit (DME, address 0x12): intake air, charge air, manifold pressure, outside
 * pressure, the boost target, the engine torque, the accelerator pedal, the exhaust gas model and the electric wastegate
 * (position and actuator duty cycle), with UDS ReadDataByIdentifier (22) only.
 *
 * Read only: every request goes through the kit's ReadOnlyDiag (kit/readonly-diag.js), which refuses anything but
 * 22 and the OBD reads before it reaches the car. And only while Datalog is on the screen: start() when its screen
 * shows, stop() when it goes (stop also drops what is still queued), so nothing goes on the bus while it is hidden.
 *
 * The identifiers go out in two requests in turn (GROUPS; the engine units of B38, B48 and B58 answer several in one
 * reply); one the reply leaves out is then asked on its own, with its OBD form as a second choice, every few
 * seconds. Identifiers and scalings: BMW's DME8FF_R description (as upstream Live Data lists them).
 *
 *   const dme = new DmeReader(link, { onValues(v), log });   link: a ReadOnlyDiag (init() done by the caller)
 *   dme.start(); dme.stop();
 *   values: { intake °C, charge °C, manifold bar abs, kPa, boostTargetAbs bar abs, torque Nm, pedal %, egt °C,
 *             wastegate % open, wgDuty % }
 */
const M = require('./maths');

const ECU = 0x12;
/** The identifiers in one request, with their length and scaling (value = raw * factor + offset). */
const DIDS = {
    '580F': { name: 'intake', bytes: 1, factor: 0.75, offset: -48 },                       // ITANS: intake air after the filter, °C
    '59D4': { name: 'charge', bytes: 2, factor: 0.0234375, offset: -273.15 },             // charge air before the throttle, °C
    '4A2D': { name: 'manifold', bytes: 2, factor: 0.078125 / 1000 },                       // intake manifold pressure, hPa -> bar abs
    '4201': { name: 'kPa', bytes: 2, factor: 0.0390625 / 10 },                             // IPUMG: outside pressure, hPa -> kPa
    '4AB0': { name: 'boostTargetAbs', bytes: 2, factor: 0.0390625 / 1000 },                // boost target, hPa -> bar abs
    '5891': { name: 'torque', bytes: 2, signed: true, factor: 0.5 },                       // IMOKU: actual clutch torque, Nm
    '5814': { name: 'pedal', bytes: 2, signed: true, factor: 0.01220703 },                 // accelerator pedal, %
    '5896': { name: 'egt', bytes: 2, signed: true, factor: 0.1, offset: -273.14 },         // exhaust gas after the catalyst (the engine unit's model), °C
    '5927': { name: 'wastegate', bytes: 1, factor: 0.390625 },                             // I_EWG_POS: electric wastegate position, % (0 closed, 100 open)
    '4AAB': { name: 'wgDuty', bytes: 2, factor: 0.001525878906 },                          // LDS_TV_ENDSTUFE: duty cycle at the wastegate actuator, %
};
/**
 * The identifiers go out in two requests, in turn (the kit takes at most 8 in one, kit/readonly-diag.js MAX_DIDS):
 * the eight above, then the wastegate pair with the manifold pressure again, so the wastegate and the boost of one
 * moment arrive together. The second request stops once this car shows it has no wastegate values.
 */
const GROUPS = [['580F', '59D4', '4A2D', '4201', '4AB0', '5891', '5814', '5896'], ['4A2D', '5927', '4AAB']];

/** The second choice for a value the reply left out: the standard OBD PID (service 01). */
const OBD = {
    intake: { obd: '0F', bytes: 1, factor: 1, offset: -40, min: -40, max: 120 },
    manifold: { obd: '0B', bytes: 1, factor: 0.01, min: 0.1, max: 2.55 },                 // kPa -> bar abs
    kPa: { obd: '33', bytes: 1, factor: 1, min: 50, max: 115 },
};
/** What counts as a reading (outside it: no data, e.g. an unset sensor or FFFF with the engine off). */
const RANGE = { intake: [-40, 90], charge: [-40, 140], manifold: [0.1, 4.5], kPa: [50, 115], boostTargetAbs: [0.3, 4.5], egt: [-40, 1200], torque: [-300, 1500], pedal: [0, 100.5], wastegate: [0, 100], wgDuty: [0, 100] };
/** A value never seen is asked on its own this many times, then only the multi read keeps looking for it (a car without it). */
const SINGLE_TRIES = 3;
const ok = (name, v) => typeof v === 'number' && isFinite(v) && v >= RANGE[name][0] && v <= RANGE[name][1];

class DmeReader {
    constructor(link, opts) {
        this.link = link;
        this.o = opts || {};
        this.on = false;
        this.values = {};
        this.missing = {};           // name -> true while the multi read leaves it out
        this.tries = {};             // name -> single reads that found nothing, while it was never seen
        this.seen = {};              // name -> true once it gave a reading
        this.nextSingle = 0;
        this.gen = 0;
        this.multi = null; this.multiFails = 0; this.lastRaw = {};
    }

    start() {
        if (this.on) return;
        this.on = true;
        const gen = ++this.gen;
        this.loop(gen);
    }

    stop() {
        if (!this.on) return;
        this.on = false;
        this.gen++;
        if (this.link && this.link.cancel) this.link.cancel();
    }

    async loop(gen) {
        const keys = Object.keys(DIDS);
        while (this.on && gen === this.gen) {
            let got = {}, asked = keys;
            if (this.multi !== false) {
                // the next request of the two; one whose own values this car never gave is left out
                const groups = GROUPS.filter((g) => g.some((k) => k !== '4A2D' && !this.givenUp(DIDS[k].name)));
                asked = groups[this.round = ((this.round || 0) + 1) % groups.length];
                try {
                    const uds = await this.link.readMany(ECU, asked.map((k) => parseInt(k, 16)), 1500);
                    if (!this.on || gen !== this.gen) return;
                    got = M.parseMulti(uds, DIDS);
                    // refused, or not one value in it twice in a row: this unit takes one identifier a request
                    if (uds && Object.keys(got).length) this.multi = true;
                    else if (uds && this.multi !== true && ++this.multiFails >= 2) {
                        this.multi = false;
                        if (this.o.log) this.o.log.info('dme: one identifier a request (' + uds.map((b) => ('0' + b.toString(16)).slice(-2)).join(' ') + ')');
                    }
                } catch (e) { if (this.o.log) this.o.log.warn('dme: ' + (e && e.message ? e.message : e)); }
            } else {
                // one by one: the manifold pressure every round (the boost), the others in turn
                const k = keys[this.turn = ((this.turn || 0) + 1) % keys.length];
                for (const one of k === '4A2D' ? [k] : ['4A2D', k]) {
                    const uds = await this.link.read(ECU, parseInt(one, 16), 1500);
                    if (!this.on || gen !== this.gen) return;
                    Object.assign(got, M.parseMulti(uds, { [one]: DIDS[one] }));
                }
                keys.forEach((x) => { if (!(x in got) && x !== k && x !== '4A2D' && x in this.lastRaw) got[x] = this.lastRaw[x]; });
            }
            Object.assign(this.lastRaw, got);
            const v = {};
            asked.forEach((k) => {
                const name = DIDS[k].name;
                if (ok(name, got[k])) { v[name] = got[k]; delete this.missing[name]; this.seen[name] = true; } else this.missing[name] = true;
            });
            // a value the reply left out: on its own (its DID, then its OBD PID) every 3 s
            // (one this car never gave, SINGLE_TRIES times in a row: not asked on its own any more, so it costs no time)
            const ask = Object.keys(this.missing).filter((name) => !this.givenUp(name));
            if (Date.now() >= this.nextSingle && ask.length) {
                this.nextSingle = Date.now() + 3000;
                for (const name of ask) {
                    if (!this.on || gen !== this.gen) return;
                    const one = await this.single(name);
                    if (ok(name, one)) { v[name] = one; this.seen[name] = true; } else if (!this.seen[name]) this.tries[name] = (this.tries[name] || 0) + 1;
                }
            }
            if (!this.on || gen !== this.gen) return;
            Object.assign(this.values, v);
            if (this.o.onValues) this.o.onValues(v);
            await new Promise((res) => setTimeout(res, this.o.gapMs == null ? 40 : this.o.gapMs));
        }
    }

    /** A value this car never gave, though it was asked on its own SINGLE_TRIES times. */
    givenUp(name) { return !this.seen[name] && (this.tries[name] || 0) >= SINGLE_TRIES; }

    /** One value on its own: its identifier, else its OBD PID. null when the car has neither. */
    async single(name) {
        const k = Object.keys(DIDS).filter((x) => DIDS[x].name === name)[0];
        try {
            const uds = await this.link.read(ECU, parseInt(k, 16), 1500);
            const one = M.parseMulti(uds, { [k]: DIDS[k] })[k];
            if (ok(name, one)) return one;
            const o = OBD[name];
            if (!o || !this.link.physical) return null;
            const r = await this.link.physical(ECU, 0x01, [parseInt(o.obd, 16)], 1500, (u) => (u[0] === 0x41 && u[1] === parseInt(o.obd, 16)) || (u[0] === 0x7F && u[1] === 0x01));
            if (!r || r[0] !== 0x41 || r.length < 2 + o.bytes) return null;
            let raw = 0;
            for (let i = 0; i < o.bytes; i++) raw = raw * 256 + r[2 + i];
            const val = raw * o.factor + (o.offset || 0);
            return val >= o.min && val <= o.max ? val : null;
        } catch (e) { return null; }
    }
}

module.exports = { DmeReader, DIDS, OBD, ECU, GROUPS, SINGLE_TRIES };
