// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Exhaust's tests: the rules (hysteresis, priority, the "and", the flaps), the flap state machine (simulated until
 * armed, requested / accepted / confirmed, hold, one at a time, the rpm guard), that the link lets nothing but the
 * flap requests through, regeneration detection, the short drives, the ash estimate, the catalyst warm-up and the
 * sound. Plain node, Node 8 compatible:
 *
 *   node tests/p96_exhaust.test.js
 */
const assert = require('assert');
const path = require('path');
const APP = path.join(__dirname, '..', 'apps', 'p96_exhaust');
const R = require(path.join(APP, 'rules'));
const F = require(path.join(APP, 'flap'));
const M = require(path.join(APP, 'model'));
const { check, REQ } = require(path.join(APP, 'exlink'));
const DEMO = require(path.join(APP, 'demo'));

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const MIN = 60000;

/* ---------- rules ---------- */
test('above with hysteresis: on above 3 000, off only below 2 500', () => {
    const r = new R.Rules([{ id: 1, name: 'a', on: true, action: 'OPEN', when: { kind: 'rpm', op: 'above', value: 3000 } }]);
    const at = (rpm) => { r.tick({ rpm: rpm }); return r.pick('both') ? 'OPEN' : 'CAR'; };
    assert.deepStrictEqual([2900, 3100, 2700, 2501, 2499, 2700, 3001].map(at), ['CAR', 'OPEN', 'OPEN', 'OPEN', 'CAR', 'CAR', 'OPEN']);
});
test('below with hysteresis: coolant below 50 holds until 55', () => {
    const r = new R.Rules([{ id: 1, name: 'q', on: true, action: 'CLOSED', when: { kind: 'coolant', op: 'below', value: 50 } }]);
    const at = (c) => { r.tick({ coolant: c }); return !!r.pick('both'); };
    assert.deepStrictEqual([20, 49, 52, 54.9, 55, 52, 49.9].map(at), [true, true, true, true, false, false, true]);
});
test('priority: the top rule that holds wins, a switched off rule never', () => {
    const list = R.defaults();
    const r = new R.Rules(list);
    r.tick({ coolant: 30, rpm: 3500, load: 90, mode: 1 });
    assert.strictEqual(r.pick('both').name, 'Quiet start');
    r.tick({ coolant: 90, rpm: 3500, load: 90, mode: 1 });
    assert.strictEqual(r.pick('both').name, 'Above 3 000 rpm');
    list[1].on = false;
    r.tick({ coolant: 90, rpm: 3500, load: 90, mode: 1 });
    assert.strictEqual(r.pick('both').name, 'Full throttle');
    r.tick({ coolant: 90, rpm: 1500, load: 20, mode: 'SPORT_DYNAMIC' });
    assert.strictEqual(r.pick('both').name, 'Sport mode');
    r.tick({ coolant: 90, rpm: 1500, load: 20, mode: 4 });
    assert.strictEqual(r.pick('both'), null);
});
test('an unknown value never holds (no engine speed: no rpm rule)', () => {
    const r = new R.Rules([{ id: 1, name: 'a', on: true, action: 'OPEN', when: { kind: 'rpm', op: 'above', value: 3000 } }]);
    r.tick({ rpm: 4000 }); assert.ok(r.pick('both'));
    r.tick({ rpm: null }); assert.strictEqual(r.pick('both'), null);
});
test('the "and" condition: both must hold, each with its own hysteresis', () => {
    const r = new R.Rules([{ id: 1, name: 'a', on: true, action: 'OPEN', when: { kind: 'rpm', op: 'above', value: 3000 }, and: { kind: 'mode', op: 'is', value: 'sport' } }]);
    r.tick({ rpm: 3500, mode: 4 }); assert.strictEqual(r.pick('both'), null);
    r.tick({ rpm: 3500, mode: 1 }); assert.ok(r.pick('both'));
    r.tick({ rpm: 2600, mode: 1 }); assert.ok(r.pick('both'));
    r.tick({ rpm: 2400, mode: 1 }); assert.strictEqual(r.pick('both'), null);
});
test('time of day over midnight, and gear', () => {
    const c = { kind: 'time', op: 'between', value: [22 * 60, 6 * 60] };
    assert.deepStrictEqual([21 * 60, 22 * 60, 23 * 60 + 59, 0, 5 * 60 + 59, 6 * 60].map((m) => R.holds(c, m, false)), [false, true, true, true, true, false]);
    const g = { kind: 'gear', op: 'above', value: 3 };
    assert.deepStrictEqual([2, 3, 4, 6].map((v) => R.holds(g, v, true)), [false, false, true, true]);
});
test('two flaps: a rule for the left flap does not decide the right one', () => {
    const r = new R.Rules([
        { id: 1, name: 'left open', on: true, action: 'OPEN', flap: 'left', when: { kind: 'rpm', op: 'above', value: 2000 } },
        { id: 2, name: 'all closed', on: true, action: 'CLOSED', when: { kind: 'rpm', op: 'above', value: 1000 } },
    ]);
    r.tick({ rpm: 2500 });
    assert.strictEqual(r.pick('left').name, 'left open');
    assert.strictEqual(r.pick('right').name, 'all closed');
});
test('drive modes as three classes, names and numbers, hybrids too', () => {
    assert.deepStrictEqual([1, 3, 4, 7, 10, 15, 20, 0, 'ECO_PRO_EFFICIENT', 'SPORT_DYNAMIC', 'COMFORT'].map(R.modeClass),
        ['sport', 'sport', 'comfort', 'eco', 'comfort', 'sport', 'eco', null, 'eco', 'sport', 'comfort']);
});
test('rule words', () => {
    const d = R.defaults();
    assert.strictEqual(R.describe(d[1]), 'Open above 3 000 rpm, back below 2 500');
    assert.strictEqual(R.describe(d[0]), 'Close while the coolant is below 50 °C, back above 55');
    assert.strictEqual(R.describe(d[4]), 'Close from 22:00 to 06:00');
    assert.strictEqual(R.autoName({ when: { kind: 'speed', op: 'below', value: 40 } }), 'Below 40 km/h');
    const c = R.condFor('time');
    R.stepCond(c, -1, 1);
    assert.deepStrictEqual(c.value, [22 * 60, 5 * 60 + 30]);
});

/* ---------- the flap ---------- */
function fakeLink(opts) {
    const o = opts || {};
    const link = { sent: [], pct: null, send(unit, kind, armed) {
        if (armed !== true) throw new Error('not armed');
        link.sent.push(unit.addr.toString(16) + ' ' + kind);
        link.pct = kind === 'open' ? 10 : kind === 'closed' ? 90 : 50;
        return new Promise((r) => setTimeout(() => r({ ok: o.refuse !== true, detail: o.refuse ? 'not now (conditions)' : 'accepted' }), o.delay || 0));
    }, readFlap() { return Promise.resolve(o.noRead ? null : link.pct); } };
    return link;
}
test('disarmed: simulated, nothing reaches the car', async () => {
    const link = fakeLink(), c = new F.FlapControl({ link: link, armed: () => false });
    c.setUnits([{ addr: 0x12, el: true }]);
    await c.set('both', 'OPEN', true);
    assert.deepStrictEqual(link.sent, []);
    const v = c.view('both');
    assert.strictEqual(v.confirmed, 'OPEN');
    assert.ok(v.simulated);
    assert.strictEqual(F.stateWords(v), 'simulated: nothing is sent to the car');
});
test('armed: requested, accepted, confirmed only from the read-back', async () => {
    const link = fakeLink(), c = new F.FlapControl({ link: link, armed: () => true, hold: () => false });
    c.setUnits([{ addr: 0x12, el: true }]);
    await c.set('both', 'CLOSED', true);
    assert.deepStrictEqual(link.sent, ['12 closed']);
    assert.strictEqual(c.view('both').confirmed, 'CLOSED');
    await c.set('both', 'OEM', true);
    const v = c.view('both');
    assert.strictEqual(v.accepted, true);
    assert.strictEqual(v.confirmed, 'UNKNOWN');                      // handed back: no tester value to read
    assert.strictEqual(F.stateWords(v), 'handed back to the car');
    const link2 = fakeLink({ noRead: true }), c2 = new F.FlapControl({ link: link2, armed: () => true, hold: () => false });
    c2.setUnits([{ addr: 0x12, el: true }]);
    await c2.set('both', 'OPEN', true);
    assert.strictEqual(F.stateWords(c2.view('both')), 'accepted, not read back yet');
});
test('a refused command is shown as refused, never as done', async () => {
    const c = new F.FlapControl({ link: fakeLink({ refuse: true }), armed: () => true, hold: () => false });
    c.setUnits([{ addr: 0x12, el: true }]);
    await c.set('both', 'OPEN', true);
    const v = c.view('both');
    assert.strictEqual(v.accepted, false);
    assert.strictEqual(v.confirmed, 'UNKNOWN');
    assert.strictEqual(F.stateWords(v), 'not sent: not now (conditions)');
});
test('one command at a time: CAR pressed during one goes right after it', async () => {
    const link = fakeLink({ delay: 20 }), c = new F.FlapControl({ link: link, armed: () => true, hold: () => false });
    c.setUnits([{ addr: 0x12, el: true }]);
    const a = c.set('both', 'OPEN', true);
    c.set('both', 'OEM', true);
    await a;
    await new Promise((r) => setTimeout(r, 60));
    assert.deepStrictEqual(link.sent, ['12 open', '12 oem']);
});
test('hold: OPEN sent again every hold period while armed, stops on CAR', async () => {
    const link = fakeLink(), c = new F.FlapControl({ link: link, armed: () => true, hold: () => true, holdMs: 15 });
    c.setUnits([{ addr: 0x12, el: true }]);
    await c.set('both', 'OPEN', true);
    await new Promise((r) => setTimeout(r, 50));
    const n = link.sent.length;
    assert.ok(n >= 3, 'held ' + n);
    await c.set('both', 'OEM', true);
    const m = link.sent.length;
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(link.sent.length, m);
    c.stop();
});
test('two flaps: left and right each to its own engine unit, "both" sends both', async () => {
    const link = fakeLink(), c = new F.FlapControl({ link: link, armed: () => true, hold: () => false });
    c.setUnits([{ addr: 0x12, el: true }, { addr: 0x13, el: true }]);
    assert.deepStrictEqual(c.sides(), ['left', 'right']);
    await c.set('right', 'OPEN', true);
    await c.set('both', 'CLOSED', true);
    assert.deepStrictEqual(link.sent, ['13 open', '12 closed', '13 closed']);
    c.setUnits([{ addr: 0x12, el: true }, { addr: 0x13, el: true }], 2);
    assert.strictEqual(c.flaps.left.unit.addr, 0x13);
});
test('decide: modes, rules and the rpm guard for Close', () => {
    const rule = { name: 'Quiet start', action: 'CLOSED' };
    assert.strictEqual(F.decide({ mode: 'OEM' }).action, 'OEM');
    assert.strictEqual(F.decide({ mode: 'OPEN' }).action, 'OPEN');
    assert.strictEqual(F.decide({ mode: 'AUTO', rule: null }).reason, 'no rule matched');
    let d = F.decide({ mode: 'AUTO', rule: rule, rpm: 2000, limit: 4000, armed: true });
    assert.strictEqual(d.action, 'CLOSED');
    d = F.decide({ mode: 'AUTO', rule: rule, rpm: 4200, limit: 4000, armed: true, paused: d.paused });
    assert.strictEqual(d.action, 'OEM');
    d = F.decide({ mode: 'AUTO', rule: rule, rpm: 3700, limit: 4000, armed: true, paused: d.paused });
    assert.strictEqual(d.action, 'OEM');                             // stays handed back until 500 rpm below
    d = F.decide({ mode: 'AUTO', rule: rule, rpm: 3400, limit: 4000, armed: true, paused: d.paused });
    assert.strictEqual(d.action, 'CLOSED');
    assert.strictEqual(F.decide({ mode: 'CLOSED', rpm: null, limit: 4000, armed: true }).action, 'OEM');
    assert.strictEqual(F.decide({ mode: 'CLOSED', rpm: null, limit: 4000, armed: false }).action, 'CLOSED');
    assert.strictEqual(F.decide({ mode: 'CLOSED', rpm: 6000, limit: 0, armed: true }).action, 'CLOSED');
});

/* ---------- the link ---------- */
test('the link lets only the flap requests through', () => {
    Object.keys(REQ).forEach((k) => Object.keys(REQ[k]).forEach((a) => assert.ok(check(0x12, 0x2F, REQ[k][a]))));
    assert.ok(check(0x13, 0x2F, REQ.el.open));
    const no = [[0x12, 0x2F, [0x60, 0xFD, 0x03, 0x13, 0x88]], [0x12, 0x2E, [0x60, 0xFD, 0x00]], [0x12, 0x31, [0x01, 0x02]], [0x40, 0x2F, REQ.el.open],
        [0xDF, 0x2F, REQ.el.oem], [0x12, 0x14, [0xFF, 0xFF, 0xFF]], [0x12, 0x2F, [0x02, 0x01]], [0x12, 0x2F, [0x60, 0xFD, 0x03, 0x03]]];
    no.forEach((q) => assert.throws(() => check(q[0], q[1], q[2])));
});
test('the link refuses to send when not armed', async () => {
    const { ExLink } = require(path.join(APP, 'exlink'));
    const l = Object.create(ExLink.prototype);
    let threw = false;
    try { await l.send({ addr: 0x12, el: true }, 'open', false); } catch (e) { threw = !!e.blocked; }
    assert.ok(threw);
});

/* ---------- the engine unit's values ---------- */
test('values from the engine unit, and fillers not believed', () => {
    const e = M.CATALOG.pfTemp[0];
    assert.strictEqual(Math.round(M.decode(e, [0x62, 0x57, 0x9B, 0x20, 0x12])), 548);     // 8210 x 0.1 - 273.14
    assert.strictEqual(M.decode(e, [0x62, 0x57, 0x9C, 0x20, 0x12]), null);               // another identifier
    assert.strictEqual(M.decode(e, [0x7F, 0x22, 0x31]), null);
    assert.strictEqual(M.decode(M.CATALOG.soot[0], [0x62, 0x57, 0x74, 0x23, 0x8C]), 9.1);
    assert.strictEqual(M.decode(M.CATALOG.soot[0], [0x62, 0x57, 0x74, 0xFF, 0xFF]), null);  // -0.001 g
    assert.strictEqual(M.decode(M.CATALOG.engLoad[0], [0x62, 0x58, 0x13, 96]), 72);
});

/* ---------- regeneration ---------- */
function drive(reg, t0, mins, f) { for (let s = 0; s <= mins * 60; s += 10) reg.feed(t0 + s * 1000, f(s / 60)); }
test('regeneration: hot filter and falling soot, complete', () => {
    const reg = new M.Regen([]), t0 = Date.UTC(2026, 10, 20, 8);
    drive(reg, t0, 30, (m) => {
        const burning = m > 5 && m < 23;
        const soot = m <= 5 ? 9.1 : m < 23 ? 9.1 - (m - 5) * 0.35 : 2.8;
        return { pfTemp: burning ? 600 + 20 * Math.sin(m) : m < 5 ? 420 : 430, soot: soot, load: soot / 9.1 * 80, km: 100 + m };
    });
    assert.strictEqual(reg.history.length, 1);
    const r = reg.history[0];
    assert.ok(!r.cut);
    assert.ok(r.mins >= 16 && r.mins <= 20, 'mins ' + r.mins);
    assert.ok(r.peak >= 615 && r.peak <= 621, 'peak ' + r.peak);
    assert.ok(r.loadBefore > 78 && r.loadAfter < 30);
    assert.strictEqual(reg.cur, null);
});
test('regeneration: a hot filter alone is not one, nor a small wobble', () => {
    const reg = new M.Regen([]), t0 = Date.UTC(2026, 10, 20, 8);
    drive(reg, t0, 20, (m) => ({ pfTemp: 640, soot: 9 + 0.05 * Math.sin(m * 3), load: 70 }));
    assert.strictEqual(reg.history.length, 0);
    assert.strictEqual(reg.cur, null);
});
test('regeneration: the engine switched off during one: cut short', () => {
    const reg = new M.Regen([]), t0 = Date.UTC(2026, 10, 20, 8);
    drive(reg, t0, 10, (m) => ({ pfTemp: m > 2 ? 610 : 450, soot: m > 2 ? 9 - (m - 2) * 0.3 : 9, load: 80 }));
    assert.ok(reg.cur);
    assert.ok(reg.now(t0 + 10 * MIN).burnt > 2);
    reg.feed(t0 + 30 * MIN, { pfTemp: 300, soot: 6.6, load: 55 });     // the next drive, 20 minutes later
    assert.strictEqual(reg.history.length, 1);
    assert.ok(reg.history[0].cut);
});
test('until the next one: load left and km from the growth', () => {
    const u = M.untilNext(38, [[0, 20], [300, 29], [600, 38]], 80);
    assert.strictEqual(u.left, 42);
    assert.strictEqual(u.km, 1400);
    assert.strictEqual(M.untilNext(38, [], 80).km, null);
    assert.strictEqual(M.untilNext(null, [], 80), null);
});

/* ---------- drives, ash, warm-up ---------- */
test('short drives: mostly under 10 minutes warns', () => {
    const now = Date.UTC(2026, 10, 26, 18);
    const list = [3, 4, 2, 6, 8, 4, 9, 7, 12, 25].map((m, i) => ({ start: now - (i + 1) * 12 * 3600000, mins: m }));
    list.push({ start: now - 8 * 86400000, mins: 1 });
    const d = M.drives(list, now);
    assert.deepStrictEqual(d.counts, [4, 4, 1, 1, 0]);
    assert.strictEqual(d.total, 10);           // the eleventh was more than a week ago
    assert.ok(d.warn);
    assert.ok(!M.drives(list.slice(0, 3), now).warn);   // three drives are too few to say
});
test('ash: grows in a straight line, full in about so many km', () => {
    const a = M.ashFuture([[0, 0], [10000, 3], [20000, 6]], 45);
    assert.strictEqual(Math.round(a.per1000 * 10) / 10, 0.3);
    assert.strictEqual(a.kmLeft, 130000);
    assert.strictEqual(M.ashFuture([[0, 5]], 45).kmLeft, null);
    assert.strictEqual(M.ashFuture([], 45), null);
});
test('catalyst warm-up: the time to 300 °C', () => {
    assert.strictEqual(M.lightOff([[0, 20], [60, 120], [120, 240], [180, 360]], 300), 150);
    assert.strictEqual(M.lightOff([[0, 20], [60, 120]], 300), null);
    const now = Date.UTC(2026, 10, 26, 18);
    assert.deepStrictEqual(M.coldWeek([{ t: now - 3600000, coolant: 10, mins: 4 }, { t: now - 7200000, coolant: 80, mins: 4 }, { t: now - 1e5, coolant: 30, mins: 20 }], now), { count: 2, short: 1 });
});

/* ---------- sound, tips, the flap log ---------- */
test('sound: each part damps, a closed flap more, the setup counts', () => {
    const s = M.sound(M.SETUP_DEFAULT, 'OPEN').map((p) => Math.round(p.level * 100));
    assert.deepStrictEqual(s, [100, 70, 62, 50, 30, 30, 18]);
    const closed = M.sound(M.SETUP_DEFAULT, 'CLOSED');
    assert.ok(closed[closed.length - 1].level < 0.18);
    const noOpf = M.sound(Object.assign({}, M.SETUP_DEFAULT, { opf: 'none', flaps: '0' }), 'OPEN');
    assert.deepStrictEqual(noOpf.map((p) => p.key), ['engine', 'turbo', 'cat', 'mid', 'rear']);
});
test('tips: live checks, an estimate score, never advice to remove a part', () => {
    const t = M.tips({ hasFlap: true, hasOpf: true, flap: 'OPEN', egt: 640, load: 38, rpm: 3400, mode: 1 });
    assert.deepStrictEqual(t.list.map((x) => x.ok), [true, true, false, true, true]);
    assert.strictEqual(t.score, 85);
    assert.strictEqual(M.tips({ hasFlap: false, hasOpf: false }).score, null);
    t.list.forEach((x) => assert.ok(!/remov|delete|decat|straight/i.test(x.title + x.text)));
});
test('the flap log: time per state and per rule over the week', () => {
    const now = Date.UTC(2026, 10, 26, 18);
    const w = M.flapWeek([
        { t: now - 3 * 3600000, action: 'CLOSED', rule: 'Quiet start' },
        { t: now - 2 * 3600000, action: 'OPEN', rule: 'Above 3 000 rpm' },
        { t: now - 1 * 3600000, action: 'OEM' },
    ], now);
    assert.strictEqual(w.ms.OPEN, 3600000);
    assert.strictEqual(w.ms.CLOSED, 3600000);
    assert.strictEqual(w.ms.OEM, 3600000);
    assert.deepStrictEqual(w.rules.map((r) => r.name).sort(), ['Above 3 000 rpm', 'Quiet start']);
    assert.strictEqual(M.hm(5 * 3600000 + 10 * MIN), '5 h 10 min');
});
test('pages and rule conditions follow what the car reports', () => {
    assert.deepStrictEqual(M.pagesFor({ rpm: true }), [0, 6, 7, 9]);
    assert.deepStrictEqual(M.pagesFor(M.ALL_CAPS), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepStrictEqual(M.kindsFor({ rpm: true, coolant: true }), ['rpm', 'coolant', 'time']);
});
test('demo data covers every page', () => {
    const S = DEMO.state(Date.UTC(2026, 10, 26, 17, 40));
    assert.ok(S.regens.length >= 5 && S.drives.length >= 10 && S.ash.length >= 2 && S.warm.length > 10);
    assert.ok(S.flapLog.length >= 5);
});

(async function () {
    let failed = 0;
    for (let i = 0; i < tests.length; i++) {
        try { await tests[i][1](); console.log('ok   ' + tests[i][0]); }
        catch (e) { failed++; console.log('FAIL ' + tests[i][0] + '\n     ' + (e && e.stack || e)); }
    }
    console.log(tests.length + ' tests, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
