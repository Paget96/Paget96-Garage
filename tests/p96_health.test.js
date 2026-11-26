// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Health's tests: the score, fault parsing, the fault history, the CBS mapping and reset gate, tyres, the QR text,
 * and that the diagnostic link lets nothing but its reads and two writes through. Plain node, Node 8 compatible:
 *
 *   node tests/p96_health.test.js
 */
const assert = require('assert');
const path = require('path');
const APP = path.join(__dirname, '..', 'apps', 'p96_health');
const M = require(path.join(APP, 'model'));
const { check, HealthLink } = require(path.join(APP, 'diaglink'));
const DEMO = require(path.join(APP, 'demo'));
const QR = require(path.join(__dirname, '..', 'kit', 'runtime', 'qr'));

let n = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/* ---------- faults ---------- */
test('19 02 reply: records after the echo and the availability mask', () => {
    const r = M.parseDtcReply([0x59, 0x02, 0xFF, 0x12, 0x04, 0x08, 0x08, 0x80, 0x1C, 0x20, 0x09], [0x02, 0x0D], 'fault');
    assert.ok(r.ok);
    assert.deepStrictEqual(r.dtcs, [{ code: '120408', status: 0x08, mem: 'fault' }, { code: '801C20', status: 0x09, mem: 'fault' }]);
});
test('19 17 reply: info memory, three request bytes', () => {
    const r = M.parseDtcReply([0x59, 0x17, 0x01, 0xFF, 0xCD, 0x8E, 0x40, 0x08], [0x17, 0x0C, 0x01], 'info');
    assert.strictEqual(r.dtcs.length, 1);
    assert.strictEqual(r.dtcs[0].code, 'CD8E40');
    assert.strictEqual(r.dtcs[0].mem, 'info');
});
test('19 reply: a refusal, the wrong sub-function, nothing', () => {
    assert.strictEqual(M.parseDtcReply([0x7F, 0x19, 0x31], [0x02, 0x0D]).nrc, 0x31);
    assert.ok(!M.parseDtcReply([0x59, 0x17, 0xFF], [0x02, 0x0D]).ok);
    assert.ok(!M.parseDtcReply(null, [0x02, 0x0D]).ok);
});
test('0A: permanent emission faults as P codes, with and without the count byte', () => {
    assert.deepStrictEqual(M.parsePermanent([0x4A, 0x02, 0x04, 0x20, 0x01, 0x71]).dtcs.map((d) => d.code), ['P0420', 'P0171']);
    assert.deepStrictEqual(M.parsePermanent([0x4A, 0x00]).dtcs, []);
    assert.deepStrictEqual(M.parsePermanent([0x4A, 0x43, 0x00]).dtcs.map((d) => d.code), ['C0300']);
    assert.ok(!M.parsePermanent([0x7F, 0x0A, 0x11]).ok);
});
test('status byte in a word, and its bits in words', () => {
    assert.strictEqual(M.faultState(0x09), 'active');
    assert.strictEqual(M.faultState(0x08), 'stored');
    assert.strictEqual(M.faultState(0x04), 'pending');
    assert.strictEqual(M.faultState(0x00), 'history');
    assert.deepStrictEqual(M.statusWords(0x09), ['Failing at this moment', 'Confirmed and stored']);
});
test('by unit: units with faults first, the right words and colours', () => {
    const rows = M.byUnit(DEMO.units());
    assert.strictEqual(rows[0].name, 'Engine (DME)');
    assert.strictEqual(rows[0].text, '1 fault, 3 info');
    assert.strictEqual(rows[1].text, '1 fault');
    assert.strictEqual(rows[2].text, '2 info');
    assert.strictEqual(rows[2].color, 'info');
    assert.strictEqual(rows[rows.length - 1].text, 'clear');
    assert.strictEqual(M.unitName(0x5A), 'Unit 0x5A');
});

/* ---------- history ---------- */
test('history: first, gone, again, cleared; a silent unit makes nothing look gone', () => {
    const log = {};
    const sc = (at, units) => M.addScan(log, { at: at, km: null, units: units });
    const u = (addr, codes) => ({ addr: addr, dtcs: codes.map((c) => ({ code: c, status: 0x08, mem: 'fault' })) });
    let e = sc(1, [u(0x12, ['120408']), u(0x40, [])]);
    assert.deepStrictEqual(e.map((x) => x.kind), ['first']);
    e = sc(2, [u(0x12, []), u(0x40, [])]);
    assert.deepStrictEqual(e.map((x) => x.kind), ['gone']);
    e = sc(3, [u(0x40, [])]);                                  // the engine did not answer
    assert.deepStrictEqual(e, []);
    e = sc(4, [u(0x12, ['120408']), u(0x40, [])]);           // back after it had gone (its unit silent in between)
    assert.deepStrictEqual(e.map((x) => x.kind), ['again']);
    M.markCleared(log, 5);
    e = sc(6, [u(0x12, []), u(0x40, [])]);
    assert.deepStrictEqual(e.map((x) => x.kind), ['cleared']);
    const f = log.faults['18:120408:fault'];
    assert.deepStrictEqual(f.events.map((x) => x.kind), ['first', 'gone', 'again', 'cleared']);
});
test('history: still stored and failing again this drive is "again"; info memory keeps no history', () => {
    const log = {};
    M.addScan(log, { at: 1, units: [{ addr: 0x12, dtcs: [{ code: 'AA0001', status: 0x08, mem: 'fault' }, { code: 'BB', status: 8, mem: 'info' }] }] });
    const e = M.addScan(log, { at: 2, units: [{ addr: 0x12, dtcs: [{ code: 'AA0001', status: 0x0A, mem: 'fault' }] }] });
    assert.deepStrictEqual(e.map((x) => x.kind), ['again']);
    assert.strictEqual(Object.keys(log.faults).length, 1);
});
test('history rows: newest first, present flag', () => {
    const rows = M.historyRows(DEMO.faultLog(Date.now()), 4);
    assert.strictEqual(rows[0].code, '120408');
    assert.ok(rows[0].present);
    assert.ok(!rows.filter((r) => r.code === '2A8200')[0].present);
});

/* ---------- service ---------- */
test('CBS: distance and date parsing', () => {
    assert.strictEqual(M.parseWay('4 200 km'), 4200);
    assert.strictEqual(M.parseWay('-1 500 km'), -1500);
    assert.strictEqual(M.parseWay('1000 mi'), 1609);
    assert.strictEqual(M.parseWay(''), null);
    const now = new Date(2026, 10, 26).getTime();
    assert.strictEqual(M.parseDue('09/2027', now), 10);
    assert.strictEqual(M.parseDue('15.09.2027', now), 10);
    assert.strictEqual(M.parseDue('2026-10', now), -1);
    assert.strictEqual(M.parseDue('soon', now), null);
});
test('CBS: items in order, left text, colours, which are resettable', () => {
    const now = new Date(2026, 10, 26).getTime();
    const it = M.cbsItems([
        { id: 0x03, way: '', date: '07/2027', colour: 3 }, { id: 0x01, way: '4 200 km', date: '09/2027', colour: 'GREEN' },
        { id: 0x02, way: '800 km', date: '', colour: 3 }, { id: 0x20, way: '', date: '10/2026', colour: 1 },
    ], now);
    assert.deepStrictEqual(it.map((x) => x.name), ['Engine oil', 'Front brakes', 'Brake fluid', 'Inspection']);
    assert.strictEqual(it[0].left, '4 200 km left');
    assert.strictEqual(it[0].color, 'ok');
    assert.strictEqual(it[1].color, 'warm');                  // under 1000 km
    assert.strictEqual(it[2].left, '8 months left');
    assert.strictEqual(it[3].color, 'bad');
    assert.ok(it[0].resettable && it[2].resettable && !it[3].resettable);
});
test('CBS reset: the cluster decides, only our five ids, the exact bytes', () => {
    assert.deepStrictEqual(M.resettableNow([0x62, 0x10, 0x02, 0x03, 0x00, 0x00, 0x64, 0x01, 0x00, 0x20, 0x00, 0x00, 0x01, 0x00, 0xFF]), [0x03, 0x01]);
    assert.strictEqual(M.resettableNow([0x7F, 0x22, 0x31]), null);
    assert.deepStrictEqual(M.resetRequest(0x03), [0x10, 0x01, 0x01, 0x03, 0x64, 0x1F, 0x80, 0x00, 0x0F, 0xFF, 0x0F, 0x3F, 0xFF, 0x00]);
    assert.throws(() => M.resetRequest(0x20));
});
test('our intervals: left, colours, a setting overrides the default', () => {
    const o = M.ourItems({ ivOil: 8000 }, { oil: 7200, plugs: 30500, air: null, gearbox: 33000, coolant: 2 });
    assert.strictEqual(o[0].leftText, '800 km');
    assert.strictEqual(o[0].color, 'warm');
    assert.strictEqual(o[2].leftText, '--');
    assert.strictEqual(o[4].leftText, '2 years');
});

/* ---------- battery, tyres ---------- */
test('battery verdicts', () => {
    assert.strictEqual(M.batteryVerdict(12.62).word, 'Healthy');
    assert.strictEqual(M.batteryVerdict(12.3).word, 'Charge it');
    assert.strictEqual(M.batteryVerdict(11.9).word, 'Weak');
    assert.strictEqual(M.batteryVerdict(12.3, 12.2).word, 'Healthy');
    assert.strictEqual(M.batteryVerdict(null).color, 'dim');
    assert.strictEqual(M.restCharge(12.7), 100);
    assert.strictEqual(M.restCharge(12.0), 0);
});
test('tyres: a slow leak in one while the others hold, and a low one', () => {
    const s = DEMO.state(Date.now());
    const ty = M.tyreCheck(s.pressures, s.cold, 0.1);
    assert.strictEqual(ty.leak, 'RL');
    assert.ok(ty.perWeek >= 0.02 && ty.perWeek <= 0.04, 'per week ' + ty.perWeek);
    assert.strictEqual(ty.low, 'RL');
    const even = M.tyreCheck({ FL: 2.2, FR: 2.2, RL: 2.2, RR: 2.21 }, {}, 0.1);
    assert.strictEqual(even.color, 'ok');
    assert.strictEqual(M.tyreCheck({}, {}).color, 'dim');
});

/* ---------- score ---------- */
test('score: the demo car is 86, good', () => {
    const s = DEMO.state(Date.now());
    const fl = M.listOf(s.units, 'fault').concat(M.listOf(s.units, 'perm'));
    const sc = M.score({ faults: fl, battery: s.battery.rest, oil: 'ok', service: M.cbsItems(s.cbs, s.at), tyres: M.tyreCheck(s.pressures, s.cold), cc: 0 });
    assert.strictEqual(sc.value, 86);
    assert.strictEqual(sc.word, 'GOOD');
});
test('score: active faults cost much, capped; unknown checks cost nothing; floors at 0', () => {
    const act = (k) => { const a = []; for (let i = 0; i < k; i++) a.push({ status: 0x09, mem: 'fault' }); return a; };
    assert.strictEqual(M.score({ faults: act(1) }).value, 85);
    assert.strictEqual(M.score({ faults: act(5) }).value, 60);
    assert.strictEqual(M.score({}).value, null);
    assert.strictEqual(M.score({}).word, 'NOT CHECKED');
    const worst = M.score({ faults: act(9).concat([{ status: 8, mem: 'perm' }, { status: 8, mem: 'perm' }, { status: 8, mem: 'fault' }, { status: 8, mem: 'fault' }, { status: 8, mem: 'fault' }, { status: 8, mem: 'fault' }]),
        battery: 11.5, oil: 'low', service: [{ color: 'bad' }, { color: 'bad' }], tyres: { color: 'warm', low: 'RL', leak: 'RL' }, cc: 5 });
    assert.strictEqual(worst.value, 0);
    assert.strictEqual(worst.color, 'bad');
});

/* ---------- report and QR ---------- */
test('report: plain text, the lines a mechanic needs, fits one QR code', () => {
    const s = DEMO.state(Date.now());
    const fl = M.listOf(s.units, 'fault').map((f) => Object.assign({ text: 'Charge air pressure', count: 3 }, f));
    const ty = M.tyreCheck(s.pressures, s.cold);
    const txt = M.report({ at: s.at, km: s.km, score: { value: 86, word: 'GOOD' }, faults: fl, battery: 12.62, oil: 'ok',
        service: M.cbsItems(s.cbs, s.at), tyres: ty, pressures: s.pressures, parts: s.parts });
    assert.ok(/^Paget96 Garage Health report\nHealth 86 of 100, good\. Checked .*48 150 km\./.test(txt), txt);
    assert.ok(txt.indexOf('Faults: 2 stored, none active.') >= 0);
    assert.ok(txt.indexOf('12 V battery: rests at 12.62 V, healthy.') >= 0);
    assert.ok(txt.indexOf('rear left 2.10 bar, slowly losing air') >= 0);
    assert.ok(txt.indexOf('Next service parts: Oil filter') >= 0);
    const dashes = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');   // built, so no dash is in this file
    assert.ok(!dashes.test(txt));
    const q = QR.encode(Buffer.from(txt, 'utf8'), { ecl: 'L' });
    assert.ok(q.size >= 21 && q.version <= 20, 'QR version ' + q.version);
    const long = M.report({ at: 0, score: {}, faults: new Array(200).fill({ addr: 0x12, code: '120408', status: 8, mem: 'fault', text: 'x'.repeat(50) }) });
    assert.ok(Buffer.byteLength(long) <= 1000);
});

/* ---------- the diagnostic gate ---------- */
test('gate: reads pass, everything else throws', () => {
    assert.strictEqual(check(0xDF, 0x19, [0x02, 0x0D], true), 'read');
    assert.strictEqual(check(0xDF, 0x19, [0x17, 0x0C, 0x01], true), 'read');
    assert.strictEqual(check(0x12, 0x19, [0x04, 0x12, 0x04, 0x08, 0x01], false), 'read');
    assert.strictEqual(check(0x12, 0x0A, [], false), 'read');
    assert.throws(() => check(0xDF, 0x19, [0x04, 1, 2, 3, 1], true));          // details only from one unit
    assert.throws(() => check(0x40, 0x0A, [], false));                         // 0A only to the engine
    assert.throws(() => check(0x12, 0x14, [0xFF, 0xFF, 0xFF], false));         // a clear is not a read
    assert.throws(() => check(0x12, 0x31, [0x01, 0x02, 0x03], false, true));   // routines never
    assert.throws(() => check(0x12, 0x2E, [0x10, 0x01], false, true));         // writes only to the cluster's CBS
    assert.throws(() => check(0x12, 0x11, [0x01], false, true));               // no resets
    assert.throws(() => check(0x12, 0x14, [0xFF, 0x00, 0x00], false, true));   // only the whole memory
    assert.throws(() => check(0xDF, 0x10, [0x03], true, true));                // no session change to all units
    assert.throws(() => check(0xDF, 0x14, [0xFF, 0xFF, 0xFF], true, true));     // never a clear to all units (I22)
    assert.strictEqual(check(0x40, 0x14, [0xFF, 0xFF, 0xFF], false, true), 'clear');
    assert.strictEqual(check(0x60, 0x2E, M.resetRequest(0x01), false, true), 'cbs');
});
test('gate: no request while the screen is hidden; writes need a grant, a confirmation, the report and the engine off', async () => {
    const sent = [];
    const fake = { proxy: async () => ({}), on: async () => {}, onAvailable: async (p, fn) => fn(true),
        call: async (p, m, a) => { sent.push([a.targetAddress, a.serviceID].concat(Array.from(a.udsData))); return 'NO_ERROR'; } };
    const quiet = { info() {}, warn() {}, error() {} };
    let engineOff = false;
    const link = new HealthLink(fake, quiet, { engineStopped: () => engineOff });
    await link.init();
    assert.throws(() => link.readPermanent(), /not shown/);
    link.setShown(true);
    assert.throws(() => link.grant('clear', { confirmed: true, reportSaved: true }), /Engine/);
    engineOff = true;
    assert.throws(() => link.grant('clear', { confirmed: true }), /report/);
    assert.throws(() => link.grant('clear', {}), /confirmed/);
    assert.throws(() => link.grant('write', { confirmed: true }), /no such write/);
    const g = link.grant('cbs', { confirmed: true });
    // a cbs grant does not clear (Node 8 has no assert.rejects: checked by hand)
    let threw = false;
    try { await link.clearFaults(g, [0x12]); } catch (e) { threw = true; }
    assert.ok(threw);
    assert.strictEqual(sent.length, 0, 'nothing went out');
    // a grant is single use and stops working when the screen goes
    const g2 = link.grant('cbs', { confirmed: true });
    link.setShown(false);
    link.setShown(true);
    threw = false;
    try { await link.cbsReset(g2, M.resetRequest(0x03)); } catch (e) { threw = true; }
    assert.ok(threw);
    assert.strictEqual(sent.length, 0);
});

/* ---------- only what the car supports (owner, 18:21) ---------- */
test('capabilities: found once, a miss never takes a yes back, pages follow them', () => {
    const c = {};
    assert.strictEqual(M.found(c, 'tpms', false), true);
    assert.strictEqual(c.tpms, false);
    assert.strictEqual(M.found(c, 'tpms', true), true);
    assert.strictEqual(M.found(c, 'tpms', false), false);
    assert.strictEqual(c.tpms, true);
    assert.deepStrictEqual(M.pagesFor({}, {}), [0, 6, 7]);
    assert.deepStrictEqual(M.pagesFor({ faults: true, soc: true }, {}), [0, 1, 2, 6, 7]);
    assert.deepStrictEqual(M.pagesFor(M.ALL_CAPS, {}), [0, 1, 2, 3, 4, 5, 8, 6, 7]);
});
test('capabilities: what the car does not report is left out of items, score and report', () => {
    const s = DEMO.state(Date.now());
    s.caps = { faults: true, cbs: true, cbsIds: [0x03], speed: true };
    M.derive(s, {}, () => 'x');
    assert.strictEqual(s.tyres, null);
    assert.deepStrictEqual(s.service.filter((i) => i.resettable).map((i) => i.id), [0x03]);
    assert.deepStrictEqual(s.ours.map((o) => o.key), ['air', 'gearbox', 'coolant']);
    assert.deepStrictEqual(s.score.checks.map((c) => c.key), ['faults', 'service']);
    assert.ok(s.report.indexOf('Tyres') < 0 && s.report.indexOf('12 V') < 0 && s.report.indexOf('Oil:') < 0, s.report);
    const none = DEMO.state(Date.now());
    none.caps = { cbs: true };
    M.derive(none, {});
    assert.ok(none.service.every((i) => !i.resettable), 'no reset before the cluster listed its items');
});

/* ---------- readiness and the clear dialog (I22) ---------- */
test('readiness PID 01: engine light, emission fault count, spark monitors supported and complete', () => {
    // MIL on, 2 faults; misfire, fuel, components supported, fuel not complete; catalyst, evap, O2, O2 heater, EGR/VVT supported, catalyst and evap not complete
    const r = M.parseReadiness([0x41, 0x01, 0x82, 0x27, 0xE5, 0x05], 0x01);
    assert.ok(r.ok);
    assert.strictEqual(r.mil, true);
    assert.strictEqual(r.dtcCount, 2);
    assert.strictEqual(r.engine, 'spark');
    assert.deepStrictEqual(r.monitors.map((m) => m.key), ['misfire', 'fuel', 'components', 'catalyst', 'evap', 'o2', 'o2Heater', 'egr']);
    const by = {}; r.monitors.forEach((m) => { by[m.key] = m.complete; });
    assert.deepStrictEqual(by, { misfire: true, fuel: false, components: true, catalyst: false, evap: false, o2: true, o2Heater: true, egr: true });
    assert.ok(r.monitors.filter((m) => m.continuous).length === 3);
    // engine light off, nothing supported but the continuous ones: only what the car has is listed
    const r2 = M.parseReadiness([0x41, 0x01, 0x00, 0x07, 0x00, 0x00], 0x01);
    assert.strictEqual(r2.mil, false);
    assert.deepStrictEqual(r2.monitors.map((m) => m.key), ['misfire', 'fuel', 'components']);
});
test('readiness PID 01: a compression ignition engine names its own monitors', () => {
    const r = M.parseReadiness([0x41, 0x01, 0x00, 0x0F, 0xC3, 0x40], 0x01);
    assert.strictEqual(r.engine, 'compression');
    assert.deepStrictEqual(r.monitors.filter((m) => !m.continuous).map((m) => m.key + (m.complete ? '+' : '-')), ['nmhc+', 'nox+', 'pm-', 'egr+']);
});
test('readiness: refusals and wrong replies give nothing; PID 41 shows this drive beside it', () => {
    assert.ok(!M.parseReadiness([0x7F, 0x01, 0x12], 0x01).ok);
    assert.ok(!M.parseReadiness([0x41, 0x41, 0, 0, 0, 0], 0x01).ok);
    assert.ok(!M.parseReadiness(null, 0x01).ok);
    assert.strictEqual(M.readiness(M.parseReadiness(null, 0x01), null), null);
    const d = DEMO.obd(), r = M.readiness(d.r01, d.r41);
    assert.strictEqual(r.total, 8);
    assert.strictEqual(r.ready, 7);
    assert.strictEqual(r.word, '1 NOT READY');
    assert.strictEqual(r.color, 'warm');
    const row = (k) => r.rows.filter((x) => x.key === k)[0];
    assert.strictEqual(row('evap').drive, 'off');
    assert.strictEqual(row('egr').drive, 'running');
    assert.strictEqual(row('catalyst').drive, 'done');
    const noDrive = M.readiness(d.r01, null);
    assert.strictEqual(noDrive.drive, false);
    assert.strictEqual(noDrive.rows[0].drive, null);
});
test('readiness: never part of the score; History gets reset, ready again and the engine light', () => {
    const s = DEMO.state(Date.now());
    M.derive(s, {}, () => 'x');
    const before = s.score.value;
    s.obd = DEMO.obdAfterClear();
    M.derive(s, {}, () => 'x');
    assert.strictEqual(s.score.value, before);
    assert.ok(s.score.checks.every((c) => c.key !== 'readiness'));
    assert.ok(/Readiness: 3 of 8 ready \(not: catalyst/.test(s.report), s.report);
    const d = DEMO.obd(), after = M.readiness(DEMO.obdAfterClear().r01), now = M.readiness(d.r01);
    assert.deepStrictEqual(M.readinessChanges(now, after).map((c) => c.text), ['Readiness reset: 4 monitors not ready']);
    assert.deepStrictEqual(M.readinessChanges(after, now).map((c) => c.text).slice(0, 2), ['Catalyst monitor ready again', 'Oxygen sensors monitor ready again']);
    const all = M.readiness(M.parseReadiness([0x41, 0x01, 0x00, 0x07, 0xE5, 0x00], 0x01));
    assert.deepStrictEqual(M.readinessChanges(now, all).map((c) => c.text), ['All readiness monitors ready again']);
    const mil = M.readiness(M.parseReadiness([0x41, 0x01, 0x81, 0x07, 0xE5, 0x04], 0x01));
    assert.deepStrictEqual(M.readinessChanges(now, mil).map((c) => c.text), ['Engine light came on']);
    assert.deepStrictEqual(M.readinessChanges(null, now), []);
});
test('clear dialog: the engine unit is not ticked, also not by All but the engine; the others are', () => {
    const units = DEMO.units().filter((u) => u.dtcs.some((d) => d.mem === 'fault'));
    units.push({ addr: 0x13, dtcs: [{ code: '111111', status: 8, mem: 'fault' }] }, { addr: 0x29, dtcs: [{ code: '222222', status: 8, mem: 'info' }] });
    assert.deepStrictEqual(M.clearDefaults(units), [0x40]);
    assert.ok(M.isEngine(0x12) && M.isEngine(0x13) && !M.isEngine(0x40));
    assert.strictEqual(M.clearWarning([0x40]), null);
    assert.strictEqual(M.clearWarning([]), null);
    assert.ok(/not ready/.test(M.clearWarning([0x40, 0x12])) && /drive cycle/.test(M.clearWarning([0x12])));
    assert.ok(/should not be cleared/.test(M.CLEAR_ENGINE_WARNING));
});
/** A stand-in canvas that keeps every text drawn and every target. */
function textCanvas() {
    const texts = [], targets = [];
    const cv = new Proxy({ textScale: 1, w: 1600, h: 520 }, { get: (o, k) => {
        if (k in o) return o[k];
        if (k === 'text') return (s) => { texts.push(String(s)); return String(s).length * 8; };
        if (k === 'textWidth') return (s, size) => String(s).length * (size || 16) * 0.5;
        if (k === 'target') return (x, y, w, h, fn, key) => targets.push({ key: key, fn: fn });
        if (k === 'targets') return targets;
        return () => 0;
    } });
    return { cv: cv, texts: texts, targets: targets };
}
test('clear dialog drawn: the warning only while the engine unit is ticked; ticking it, All but the engine', () => {
    const VIEW = require(path.join(APP, 'view'));
    const UI = require(path.join(__dirname, '..', 'lib', 'ui'));
    const units = DEMO.units().filter((u) => u.dtcs.some((d) => d.mem === 'fault'));
    let ticked = M.clearDefaults(units);
    const h = { tick: (a) => { ticked = ticked.indexOf(a) >= 0 ? ticked.filter((x) => x !== a) : ticked.concat([a]); },
        all: () => { ticked = M.clearDefaults(units); }, cancel: () => {}, run: () => {} };
    const drawn = () => { const c = textCanvas(); UI.dialog(c.cv, VIEW.clearDialog(units, ticked, h), 0, { a: 1 }); return c; };
    const warned = (c) => c.texts.some((t) => /READINESS GOES BACK/.test(t));
    let c = drawn();
    assert.deepStrictEqual(ticked, [0x40]);
    assert.ok(!warned(c), 'no warning while the engine unit is not ticked');
    assert.ok(c.texts.indexOf('needs its own tick') >= 0);
    assert.ok(c.texts.indexOf('Clear 1 fault in 1 unit?') >= 0, c.texts.join('|'));
    c.targets.filter((q) => q.key === 'tick|' + 0x12)[0].fn();
    c = drawn();
    assert.ok(warned(c), 'the warning shows once the engine unit is ticked');
    assert.ok(c.texts.indexOf('Clear 2 faults in 2 units?') >= 0);
    c.targets.filter((q) => q.key === 'clearall')[0].fn();
    c = drawn();
    assert.deepStrictEqual(ticked, [0x40]);
    assert.ok(!warned(c));
    c.targets.filter((q) => q.key === 'tick|' + 0x40)[0].fn();
    c = drawn();
    assert.ok(c.texts.indexOf('Tick the units to clear') >= 0);
    assert.ok(!c.targets.some((q) => q.key === 'p96dlg|1'), 'Yes, clear cannot be pressed with nothing ticked');
    assert.ok(/readiness is reset/.test(VIEW.clearedText([], [], true)) && !/readiness/.test(VIEW.clearedText([0x40], [], false)));
});
test('clear goes to each ticked unit, never to all units at once; readiness reads only 01 01 / 01 41', async () => {
    const sent = [];
    const fake = { proxy: async () => ({}), on: async () => {}, onAvailable: async (p, fn) => fn(true),
        call: async (p, m, a) => { sent.push([a.targetAddress, a.serviceID].concat(Array.from(a.udsData))); return 'NO_ERROR'; } };
    const quiet = { info() {}, warn() {}, error() {} };
    const link = new HealthLink(fake, quiet, { engineStopped: () => true });
    await link.init();
    link.setShown(true);
    const g = link.grant('clear', { confirmed: true, reportSaved: true });
    const res = await Promise.race([link.clearFaults(g, [0x40]), new Promise((r) => setTimeout(() => r('timeout'), 30000))]);
    assert.ok(sent.length > 0, 'the clear went out');
    assert.ok(sent.every((q) => q[0] === 0x40), 'only to the ticked unit: ' + JSON.stringify(sent));
    assert.ok(sent.some((q) => q[1] === 0x14));
    assert.ok(res === 'timeout' || res.failed.length === 1);
    assert.throws(() => link.readReadiness(0x02), /PID 01 or 41/);
});

/* ---------- every engine (owner rule 2026-11-26 19:03) ---------- */
const E = require(path.join(__dirname, '..', 'lib', 'engine'));
test('Engine page: shown for cars with an engine, gone on an electric car', () => {
    const pages = (id) => M.pagesFor(M.capsForCar(E.demoCar(id)), { engine: E.demoCar(id) });
    ['b48', 'b58', 's58', 's63', 'b57', 'phev'].forEach((id) => assert.ok(pages(id).indexOf(8) >= 0, id));
    assert.strictEqual(pages('ev').indexOf(8), -1);
    assert.ok(pages('ev').indexOf(5) >= 0, 'an EV still has Fluids (coolant, washer)');
});
test('per-cylinder reads follow the cylinder count, never a fixed 4', () => {
    const count = (id, kind) => M.cylinderReads(E.demoCar(id)).filter((r) => r.kind === kind).length;
    assert.strictEqual(count('b48', 'misfire'), 4);
    assert.strictEqual(count('b58', 'misfire'), 6);
    assert.strictEqual(count('s63', 'misfire'), 8);
    assert.strictEqual(count('b57', 'ignition'), 0, 'a diesel has no ignition angle');
    assert.strictEqual(M.cylinderReads(E.demoCar('ev')).length, 0);
    // a V8: bank 2's ignition angles from the second engine unit, as cylinders 5..8
    const v8 = M.cylinderReads(E.demoCar('s63')).filter((r) => r.kind === 'ignition');
    assert.deepStrictEqual(v8.map((r) => r.cyl + '@' + r.addr.toString(16)), ['1@12', '2@12', '3@12', '4@12', '5@13', '6@13', '7@13', '8@13']);
    // a three cylinder
    assert.strictEqual(M.cylinderReads(E.profile({ fuel: 'petrol', cylinders: 3 })).filter((r) => r.kind === 'rough').length, 3);
});
test('engine values decode with BMW\'s scalings and the demo has a bar per cylinder', () => {
    assert.strictEqual(M.decodeNum(M.CYL_FMT.rough, 0x4A30, [0x62, 0x4A, 0x30, 0x00, 0x20]), 2);
    assert.strictEqual(M.decodeNum(M.ENGINE_DIDS.rail, 0x58EF, [0x62, 0x58, 0xEF, 0x7D, 0x00]), 160);
    assert.strictEqual(M.decodeNum(M.ENGINE_DIDS.knock, 0x554C, [0x62, 0x55, 0x4C, 0xFE]), -0.75);
    const v = DEMO.engineValues(0, E.demoCar('s63'));
    assert.strictEqual(Object.keys(v.cyl.misfire).length, 8);
    assert.strictEqual(Object.keys(DEMO.engineValues(0, E.demoCar('b57')).cyl.ignition).length, 0);
    assert.ok(DEMO.engineValues(0, E.demoCar('b57')).rail > 1000);
});
test('service parts per engine: glow plugs on a diesel, no engine parts on an EV', () => {
    assert.ok(M.partsFor(E.demoCar('b57')).Engine.indexOf('Glow plugs') >= 0);
    assert.strictEqual(M.partsFor(E.demoCar('ev')).Engine, undefined);
    assert.ok(M.partsFor(E.demoCar('b48')).Engine.indexOf('Spark plugs') >= 0);
});

(async () => {
    for (const t of tests) {
        n++;
        try { await t[1](); console.log('ok   ' + t[0]); } catch (e) { failed++; console.log('FAIL ' + t[0] + '\n     ' + (e && e.stack || e)); }
    }
    console.log(n + ' tests, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
