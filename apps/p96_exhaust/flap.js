// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
// The safety model and the hold are adapted from idrive7-apps apps/live_adjustments (controller.js, auto.js),
// MIT, Copyright (c) 2026 cauliflowermossgrape; see NOTICE.
'use strict';
/**
 * flap.js - the exhaust flap (D21): what it should do, and the one place a command is decided.
 *
 *   modes     AUTO   the rules decide (rules.js); no rule holding: the car decides
 *             OPEN / CLOSE   held as long as it is picked
 *             CAR    handed back to the engine unit, its own strategy
 *   safety    as upstream's Engine Config: opening the app sends nothing. A command leaves only on a button press, on
 *             a change of what the rules decide, or when the car comes up (ignition on) with OPEN, CLOSE or AUTO kept
 *             from before. Simulated until armed in Settings: then nothing reaches the car at all. Requested,
 *             accepted (the engine unit took it) and confirmed (read back, 22 62 FD) are kept apart, and a request is
 *             never shown as done without the read-back. One command at a time per flap; CAR pressed while one is
 *             under way goes right after it.
 *   hold      the engine unit lets a tester's command go after about 20 s, so OPEN and CLOSE are sent again every 15 s.
 *   rpm guard Close is handed back (CAR) above the "Close: hand back above" engine speed and resumes 500 rpm below it;
 *             armed with a limit and no live engine speed, Close is not held.
 *
 * Two flaps (a V8 with two engine units, each drives its bank's flap): the sides 'left' and 'right', each with its own
 * state; on a car with one engine unit the one side is 'both'.
 */

const HOLD_MS = 15000;
const GUARD_HYST = 500;
const WORD = { OPEN: 'OPEN', CLOSED: 'CLOSED', OEM: 'CAR', UNKNOWN: '--' };

/**
 * The rpm guard for one flap. paused: the guard's state from last time. Resolves { paused, why } where why is
 * 'rpm' (over the limit) or 'nosignal' (armed, a limit and no engine speed).
 */
function guard(wantClosed, paused, rpm, limit, armed) {
    if (!wantClosed || !limit) return { paused: false, why: null };
    if (rpm === null || rpm === undefined) return armed ? { paused: true, why: 'nosignal' } : { paused: false, why: null };
    if (!paused && rpm > limit) return { paused: true, why: 'rpm' };
    if (paused && rpm >= limit - GUARD_HYST) return { paused: true, why: 'rpm' };
    return { paused: false, why: null };
}

/**
 * What one flap should do now. o = { mode: 'AUTO' | 'OPEN' | 'CLOSED' | 'OEM', rule (the rule that decides it, or
 * null), rpm, limit, armed, paused }. Resolves { action, reason, rule, paused, why }.
 */
function decide(o) {
    let action, reason, rule = null;
    if (o.mode === 'OPEN' || o.mode === 'CLOSED') { action = o.mode; reason = 'you picked ' + (o.mode === 'OPEN' ? 'OPEN' : 'CLOSE'); }
    else if (o.mode === 'AUTO') {
        rule = o.rule || null;
        action = rule ? rule.action : 'OEM';
        reason = rule ? rule.name : 'no rule matched';
    } else { action = 'OEM'; reason = 'you picked CAR'; }
    const g = guard(action === 'CLOSED', !!o.paused, o.rpm, o.limit, o.armed);
    if (g.paused) {
        action = 'OEM';
        reason = g.why === 'rpm' ? 'above ' + String(o.limit).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' rpm: the car has it' : 'no engine speed: the car has it';
    }
    return { action: action, reason: reason, rule: rule, paused: g.paused, why: g.why };
}

/**
 * The flaps' state machine. o = { link (exlink.js ExLink, or a test double with send(unit, kind, armed) and
 * readFlap(unit)), armed() (the setting), hold() (Hold on), log, onChange(), holdMs }.
 */
class FlapControl {
    constructor(o) {
        this.link = o.link;
        this.armed = o.armed || (() => false);
        this.hold = o.hold || (() => true);
        this.log = o.log || { info() {}, warn() {} };
        this.onChange = o.onChange || (() => {});
        this.holdMs = o.holdMs || HOLD_MS;
        this.setUnits([]);
    }

    /** The units with a flap (exlink probe()); leftIs: which bank is the left flap (1 or 2, unsure, a setting). */
    setUnits(units, leftIs) {
        const old = this.flaps || {};
        const mk = (name, unit) => Object.assign({ name: name, unit: unit, requested: 'OEM', accepted: null, confirmed: 'UNKNOWN', sent: 'OEM',
            busy: false, error: null, detail: '', timer: null, queued: null, at: 0 }, old[name] ? { requested: old[name].requested, sent: old[name].sent, confirmed: old[name].confirmed } : {});
        this.units = units || [];
        this.flaps = {};
        if (this.units.length >= 2) {
            const b1 = this.units[0], b2 = this.units[1];
            this.flaps.left = mk('left', leftIs === 2 ? b2 : b1);
            this.flaps.right = mk('right', leftIs === 2 ? b1 : b2);
        } else this.flaps.both = mk('both', this.units[0] || null);
        Object.keys(old).forEach((k) => { if (old[k].timer) clearTimeout(old[k].timer); });
    }
    /** 'both', or 'left' and 'right' on a car with two. */
    sides() { return Object.keys(this.flaps); }
    get simulated() { return !this.armed(); }

    /**
     * Sends action ('OPEN', 'CLOSED', 'OEM') to one flap ('both' on a car with two: both). force: send even when it is
     * what was sent last (a button press, the car coming up). Resolves when it went (or was simulated).
     */
    set(side, action, force) {
        if (side === 'both' && !this.flaps.both) return Promise.all(this.sides().map((s) => this.set(s, action, force)));
        const f = this.flaps[side];
        if (!f) return Promise.resolve();
        if (!force && action === f.sent && !f.busy) return Promise.resolve();
        if (f.busy) {
            // one command at a time: the newest wish goes right after the one under way (CAR is never dropped)
            f.queued = action; f.requested = action;
            return f.flight || Promise.resolve();
        }
        f.flight = this._send(f, action).then(() => {
            const q = f.queued;
            f.queued = null;
            if (q && q !== f.sent) return this.set(side, q, true);
            return null;
        });
        return f.flight;
    }

    async _send(f, action) {
        f.requested = action; f.accepted = null; f.error = null; f.busy = true;
        this._stopHold(f);
        const armed = this.armed() === true;
        try {
            if (!armed) {
                // simulated: nothing goes to the car; the drawing follows the request
                f.accepted = true; f.confirmed = action; f.detail = 'simulated';
            } else if (!f.unit) {
                f.accepted = false; f.confirmed = 'UNKNOWN'; f.error = 'no flap answered on this car';
            } else {
                f.confirmed = 'UNKNOWN';
                const kind = action === 'OPEN' ? 'open' : action === 'CLOSED' ? 'closed' : 'oem';
                const r = await this.link.send(f.unit, kind, true);
                f.accepted = !!r.ok; f.detail = r.detail || '';
                if (!r.ok) f.error = r.detail || 'refused';
                // confirmed only by reading it back: what the engine unit drives the flap to
                if (r.ok && this.link.readFlap) {
                    const pct = await this.link.readFlap(f.unit).catch(() => null);
                    f.confirmed = confirmFrom(pct, action);
                }
            }
            f.sent = action; f.at = Date.now();
            this.log.info('flap ' + f.name + ' ' + action + (armed ? '' : ' (simulated)') + ': accepted ' + f.accepted + ', confirmed ' + f.confirmed);
        } catch (e) {
            f.accepted = false; f.error = e && e.blocked ? String(e.message) : 'no answer';
            this.log.warn('flap ' + f.name + ' ' + action + ': ' + (e && e.message || e));
        } finally { f.busy = false; }
        if (armed && f.accepted && action !== 'OEM' && this.hold()) this._schedule(f);
        this.onChange();
    }

    /** The hold: the same command again every 15 s while it is still what is wanted. */
    _schedule(f) {
        this._stopHold(f);
        f.nextAt = Date.now() + this.holdMs;
        f.timer = setTimeout(() => {
            f.timer = null;
            if (f.sent === 'OEM' || f.busy || !this.armed() || !this.hold()) return;
            this.set(f.name, f.sent, true);
        }, this.holdMs);
    }
    _stopHold(f) { if (f.timer) clearTimeout(f.timer); f.timer = null; f.nextAt = 0; }
    /** The car came up (ignition on): its engine unit starts on its own strategy, so what is wanted goes again. */
    linkUp() { this.sides().forEach((s) => { this.flaps[s].sent = 'OEM'; }); }
    /** Disarmed or Hold off: stop holding. */
    settingsChanged() { this.sides().forEach((s) => { const f = this.flaps[s]; if (!this.armed() || !this.hold()) this._stopHold(f); else if (f.sent !== 'OEM' && !f.timer) this._schedule(f); }); }
    stop() { this.sides().forEach((s) => this._stopHold(this.flaps[s])); }

    /** One flap's state for the screen: { requested, accepted, confirmed, busy, error, simulated, word }. */
    view(side) {
        const f = this.flaps[side] || this.flaps[this.sides()[0]];
        return { side: f.name, requested: f.requested, accepted: f.accepted, confirmed: f.confirmed, busy: f.busy, error: f.error,
            simulated: this.simulated, holding: !!f.timer, word: WORD[f.confirmed !== 'UNKNOWN' ? f.confirmed : f.requested] };
    }
}

/** The read-back (commanded duty %, 22 62 FD) as a state: up to 20 % OPEN, 80 % and more CLOSED; a hand back reads
 * as UNKNOWN (the engine unit's own strategy, no tester value). */
function confirmFrom(pct, action) {
    if (pct === null || pct === undefined) return 'UNKNOWN';
    if (pct <= 20) return 'OPEN';
    if (pct >= 80) return 'CLOSED';
    return 'UNKNOWN';
}

/** The words under the flap's state: "confirmed by the car", "accepted, not read back", "simulated". */
function stateWords(v) {
    if (v.busy) return 'sending...';
    if (v.simulated) return 'simulated: nothing is sent to the car';
    if (v.error) return 'not sent: ' + v.error;
    if (v.accepted === null) return 'the car has it until you pick';
    if (v.confirmed !== 'UNKNOWN') return 'confirmed by the car';
    return v.requested === 'OEM' ? 'handed back to the car' : 'accepted, not read back yet';
}

module.exports = { FlapControl, decide, guard, confirmFrom, stateWords, HOLD_MS, GUARD_HYST, WORD };
