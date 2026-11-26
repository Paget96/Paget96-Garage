// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';

// Datalog (apps/p96_datalog): run timing and splits on synthetic traces, the reaction, the SAE J1349 factor and the
// corrected times, boost, the engine unit reply parser, the read only and only-while-shown engine unit reads, dyno
// pulls and their sheet, tyres, sessions and the saved runs. No car, SDK or head unit needed:
//   node tests/p96_datalog.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'p96_datalog');
const M = require(path.join(APP, 'maths'));
const { RunLog, column } = require(path.join(APP, 'runs'));
const { DmeReader, DIDS } = require(path.join(APP, 'dme'));
const { PullLog, sheet, power } = require(path.join(APP, 'dyno'));
const { check } = require(path.join(ROOT, 'kit', 'runtime', 'readonly-diag'));

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, tol, what) => assert(typeof a === 'number' && Math.abs(a - b) <= tol, (what || '') + ': ' + a + ' (want ' + b + ' +-' + tol + ')');

/**
 * A standing start at a constant acceleration `acc` (m/s²): the car stands 2 s (READY), the throttle opens
 * `react` s before it moves (the rpm rises), then speed = acc * t, samples every `step` ms.
 */
function launch(log, opts) {
    const o = Object.assign({ acc: 5, react: 0.4, step: 50, until: 30, t0: 100000 }, opts);
    let t = o.t0;
    for (; t < o.t0 + 2000; t += o.step) { log.sample(t, { speed: 0, rpm: 800 }); log.idle(t); }
    const tMove = t + o.react * 1000;
    for (; t < tMove; t += o.step) { log.sample(t, { speed: 0, rpm: 3000 }); log.idle(t); }
    const tl = t;
    for (; t < tl + o.until * 1000; t += o.step) {
        const s = (t - tl) / 1000;
        log.sample(t, { speed: o.acc * s * 3.6, rpm: 3000 + s * 200 });
        log.idle(t);
        if (log.state !== 'run' && s > 1) break;
    }
    return { tl: tl };
}

test('splits for each run length', () => {
    assert.deepStrictEqual(M.splitsFor(201).map((s) => s.key), ['0-100', '60-100', 'd201']);
    assert.deepStrictEqual(M.splitsFor(402).map((s) => s.key), ['0-100', '60-100', 'd201', 'd402']);
    assert.deepStrictEqual(M.splitsFor(804).map((s) => s.key), ['0-100', '60-100', 'd201', 'd402', '100-200', 'd804']);
    assert.strictEqual(M.finalKey(804), 'd804');
    assert.strictEqual(M.finalKey(999), 'd402');
    assert(M.isDist('d201') && !M.isDist('0-100'));
});

/** The time to cover d metres from the timer's start (kit/run_timer.js starts it as the car passes 0.5 km/h). */
const v0 = 0.5 / 3.6;
const tDist = (d, a) => (-v0 + Math.sqrt(v0 * v0 + 2 * a * d)) / a;
const tSpeed = (kmh, a) => (kmh / 3.6 - v0) / a;

test('a 402 m run at 5 m/s²: every split, the trap speed and the reaction', () => {
    const done = [];
    const log = new RunLog({ length: () => 402, air: () => ({ intake: 25, kPa: 99, boost: 1.2, manifold: 2.2, ambient: 0.99 }), onDone: (r) => done.push(r) });
    launch(log, { acc: 5, react: 0.4 });
    assert.strictEqual(done.length, 1, 'one run saved');
    const r = done[0].result;
    near(r['0-100'], tSpeed(100, 5), 0.01, '0-100');
    near(r['60-100'], (40 / 3.6) / 5, 0.01, '60-100');
    near(r.d201, tDist(M.MILE_8, 5), 0.01, '201 m');
    near(r.d402, tDist(M.MILE_4, 5), 0.01, '402 m');
    near(done[0].trap.d402, (v0 + 5 * tDist(M.MILE_4, 5)) * 3.6, 0.3, 'trap km/h');
    near(done[0].reaction, 0.4, 0.06, 'reaction');
    near(done[0].cf, 1, 0.0005, 'standard air at the launch');
    assert(done[0].trace.length > 50, 'a trace every 0.2 s');
    near(column(done[0], 't')[1], 0.2, 0.06, 'trace step');
});

test('the timing does not depend on how often the car sends speed', () => {
    const a = [], b = [];
    launch(new RunLog({ length: () => 402, onDone: (r) => a.push(r) }), { acc: 6, step: 20 });
    launch(new RunLog({ length: () => 402, onDone: (r) => b.push(r) }), { acc: 6, step: 130 });
    near(a[0].result.d402, b[0].result.d402, 0.02, '402 m at 50 Hz vs 8 Hz');
    near(a[0].result['0-100'], b[0].result['0-100'], 0.02, '0-100 at 50 Hz vs 8 Hz');
});

test('201 m and 1/2 mile run lengths end where they should', () => {
    const d = [];
    launch(new RunLog({ length: () => 201, onDone: (r) => d.push(r) }), { acc: 5 });
    assert.strictEqual(d[0].length, 201);
    assert.strictEqual(d[0].result.d402, undefined);
    const e = [];
    launch(new RunLog({ length: () => 804, onDone: (r) => e.push(r) }), { acc: 4, until: 40 });
    near(e[0].result.d804, tDist(M.MILE_2, 4), 0.02, '804 m');
    near(e[0].result['100-200'], (100 / 3.6) / 4, 0.02, '100-200');
});

test('a creep or a launch given up before 201 m is not saved', () => {
    const d = [];
    const log = new RunLog({ length: () => 402, onDone: (r) => d.push(r) });
    let t = 0;
    for (; t < 2000; t += 50) { log.sample(t, { speed: 0, rpm: 800 }); log.idle(t); }
    log.sample(t, { speed: 2, rpm: 900 }); t += 100;
    log.sample(t, { speed: 3, rpm: 900 }); t += 100;
    log.sample(t, { speed: 0, rpm: 800 });
    for (; t < 5000; t += 50) log.idle(t);
    // a launch to 80 km/h and a lift at 100 m
    for (let s = 0; s < 6; s += 0.05, t += 50) { log.sample(t, { speed: Math.min(80, s * 20) * (s > 4.5 ? 0.5 : 1), rpm: 3000 }); log.idle(t); }
    assert.strictEqual(d.length, 0);
    assert.strictEqual(log.runs.length, 0);
});

test('reaction: rpm rise or torque, none when nothing was seen', () => {
    const r = new M.Reaction();
    for (let t = 0; t < 1000; t += 50) r.feed(t, 790 + (t % 100 ? 10 : 0), 20, true);
    r.feed(1000, 2500, 20, true);
    near(r.launch(1350), 0.35, 1e-9, 'rpm');
    for (let t = 0; t < 500; t += 50) r.feed(t, 800, 20, true);
    r.feed(500, 820, 300, true);
    near(r.launch(800), 0.3, 1e-9, 'torque');
    for (let t = 0; t < 500; t += 50) r.feed(t, 800, 20, true);
    assert.strictEqual(r.launch(600), null, 'no throttle seen');
    for (let t = 0; t < 500; t += 50) r.feed(t, 800, 20, true);
    r.feed(500, 3000, 20, true);
    assert.strictEqual(r.launch(9000), null, 'over 3 s is not a reaction');
});

test('SAE J1349 factor, density altitude and corrected times', () => {
    near(M.sae(25, 99), 1, 1e-9, 'standard air');
    near(M.sae(20.5, 97.9), 1.176 * (99 / 97.9) * Math.sqrt(293.5 / 298) - 0.176, 1e-12, 'formula');
    assert(M.sae(35, 95) > 1 && M.sae(5, 102) < 1, 'warm thin air > 1, cold dense < 1');
    assert.strictEqual(M.sae(null, 99), null);
    assert.strictEqual(M.sae(25, 30), null, 'implausible pressure');
    near(M.densityAltitude(15, 101.325), 0, 2, 'ISA sea level');
    near(M.densityAltitude(8.5, 89.876), 1000, 15, 'ISA 1000 m (8.5 °C there)');
    near(M.correctTime(12.84, 1.03, true), 12.84 / Math.cbrt(1.03), 1e-12, 'distance');
    near(M.correctTime(5.42, 1.03, false), 5.42 / 1.03, 1e-12, 'speed window');
    near(M.correctTrap(172.4, 1.03), 172.4 * Math.cbrt(1.03), 1e-12, 'trap');
    assert.strictEqual(M.correctTime(12.8, null, true), null);
    assert.strictEqual(M.airWords(1.012), 'thinner than standard');
    assert.strictEqual(M.airWords(0.97), 'denser than standard');
    assert.strictEqual(M.airWords(1.001), 'standard air');
});

test('boost is manifold minus outside, vacuum below zero', () => {
    near(M.boost(2.43, 1.01), 1.42, 1e-9, 'full throttle');
    near(M.boost(0.45, 1.01), -0.56, 1e-9, 'idle');
    assert.strictEqual(M.boost(2.4, null), null);
    assert.strictEqual(M.boost(9, 1.0), null, 'implausible manifold');
    assert.strictEqual(M.boost(2.0, 0.2), null, 'implausible ambient');
    const trace = [[0, 0, -0.5], [0.2, 2, 0.4], [1.0, 20, 1.2], [2.1, 40, 1.44], [3, 60, 1.46]];
    near(M.timeToTarget(trace, 1.45, 2), 2.1, 1e-9, 'time to target');
    assert.strictEqual(M.timeToTarget(trace, 1.6, 2), null);
});

test('one reply with several identifiers', () => {
    const uds = [0x62, 0x58, 0x0F, 0x5C, 0x59, 0xD4, 0x30, 0x00, 0x4A, 0x2D, 0x79, 0x80, 0x42, 0x01, 0x61, 0xA8, 0x58, 0x96, 0x80];
    const v = M.parseMulti(uds, DIDS);
    near(v['580F'], 0x5C * 0.75 - 48, 1e-9, 'intake');
    near(v['59D4'], 0x3000 * 0.0234375 - 273.15, 1e-9, 'charge air');
    near(v['4A2D'], 0x7980 * 0.078125 / 1000, 1e-9, 'manifold bar');
    near(v['4201'], 0x61A8 * 0.0390625 / 10, 1e-9, 'outside kPa');
    assert(!('5896' in v), 'a cut off value is left out');
    assert.deepStrictEqual(M.parseMulti([0x7F, 0x22, 0x31], DIDS), {}, 'a refusal');
    near(M.parseMulti([0x62, 0x58, 0x91, 0xFF, 0x38], DIDS)['5891'], -100, 1e-9, 'signed torque');
});

/** A fake ReadOnlyDiag: answers with fixed replies, checks every request with the kit's own read only check. */
function fakeLink(multi) {
    const L = { sent: [], cancelled: 0 };
    const reply = (dids) => {
        const out = [0x62];
        dids.forEach((did) => {
            const k = ('000' + did.toString(16).toUpperCase()).slice(-4), d = DIDS[k];
            const raw = Object.assign({ '580F': 0x5C, '59D4': 0x3000, '4A2D': 0x7980, '4201': 0x61A8, '4AB0': 0x9500, '5891': 0x0300, '5814': 0x1F40, '5896': 0x2710, '5927': 0x80, '4AAB': 0x5000 }, L.raw || {})[k];
            if (raw === null) return;                 // this car does not have it: left out of the reply
            out.push(did >> 8, did & 0xFF);
            for (let i = d.bytes - 1; i >= 0; i--) out.push((raw >> (8 * i)) & 0xFF);
        });
        return out;
    };
    L.readMany = (target, dids) => {
        const data = [];
        dids.forEach((d) => data.push(d >> 8, d & 0xFF));
        check(target, 0x22, data, false);
        L.sent.push([target, 0x22].concat(data));
        return Promise.resolve(multi ? reply(dids) : [0x7F, 0x22, 0x13]);
    };
    L.read = (target, did) => {
        check(target, 0x22, [did >> 8, did & 0xFF], false);
        L.sent.push([target, 0x22, did >> 8, did & 0xFF]);
        const r = reply([did]);
        return Promise.resolve(r.length > 1 ? r : [0x7F, 0x22, 0x31]);
    };
    L.physical = (target, sid, data) => { check(target, sid, data, false); L.sent.push([target, sid].concat(data)); return Promise.resolve(null); };
    L.cancel = () => { L.cancelled++; };
    return L;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('engine unit: reads only, values scaled, nothing after stop()', async () => {
    const link = fakeLink(true), got = [];
    const dme = new DmeReader(link, { gapMs: 5, onValues: (v) => got.push(v) });
    dme.start();
    await wait(60);
    dme.stop();
    const n = link.sent.length;
    await wait(60);
    assert(n > 2, 'it polled while shown (' + n + ')');
    assert.strictEqual(link.sent.length, n, 'nothing sent after stop()');
    assert(link.cancelled >= 1, 'the queue was dropped');
    assert(link.sent.every((q) => q[1] === 0x22 || q[1] === 0x01), 'only 22 and OBD reads');
    const v = Object.assign.apply(null, [{}].concat(got));    // the two requests in turn: everything seen
    assert(link.sent.some((q) => q.length === 2 + 2 * 8) && link.sent.some((q) => q.length === 2 + 2 * 3), 'both requests went out, 8 identifiers at most');
    near(v.intake, 21, 1e-9, 'intake °C');
    near(v.manifold, 2.43, 0.01, 'manifold bar abs');
    near(v.kPa, 97.66, 0.01, 'outside kPa');
    near(v.torque, 384, 1e-9, 'torque Nm');
    near(v.pedal, 0x1F40 * 0.01220703, 1e-6, 'pedal %');
    near(v.wastegate, 0x80 * 0.390625, 1e-9, 'wastegate % open');
    near(v.wgDuty, 0x5000 * 0.001525878906, 1e-6, 'wastegate actuator duty %');
});

test('engine unit: a car without the wastegate is not asked for it again and again', async () => {
    const link = fakeLink(true), got = [];
    link.raw = { '5927': null, '4AAB': null };
    const dme = new DmeReader(link, { gapMs: 1, onValues: (v) => got.push(v) });
    const realNow = Date.now;
    let fake = realNow();
    Date.now = () => fake;                           // every loop is 4 s later: a single read is due each time
    const tick = setInterval(() => { fake += 4000; }, 1);
    dme.start();
    await wait(120);
    dme.stop();
    clearInterval(tick); Date.now = realNow;
    const asked = link.sent.filter((q) => q.length === 4 && q[2] === 0x59 && q[3] === 0x27).length;
    assert(asked === 3, 'asked on its own 3 times, then not any more (' + asked + ')');
    const many = link.sent.filter((q) => q.length > 4), lastWg = many.map((q) => q.length === 2 + 2 * 3).lastIndexOf(true);
    assert(lastWg >= 0 && lastWg < many.length - 3, 'the wastegate request stopped (' + lastWg + ' of ' + many.length + ')');
    assert(got.every((v) => !('wastegate' in v)), 'no wastegate value made up');
    assert(got.some((v) => typeof v.manifold === 'number'), 'the rest still arrives');
});

test('wastegate: when it opens and closes, in words', () => {
    // idle open, shut while the boost climbs, opens at 1.4 bar, holds part open, open again after lifting
    const run = [[-0.5, 100], [-0.5, 99], [0.3, 0], [0.8, 0], [1.2, 2], [1.4, 30], [1.45, 45], [1.45, 40], [0.2, 95], [-0.5, 100]];
    const s = M.wastegateStory(run, 1.45);
    near(s.idle, 299 / 3, 1e-9, 'idle');
    near(s.build, 0, 1e-9, 'while it builds');
    near(s.opensAt, 1.4, 1e-9, 'opens at');
    near(s.peak, 1.45, 1e-9, 'peak');
    assert(s.over === null && s.under === null, 'on target');
    const fmt = (b) => b.toFixed(2) + ' bar';
    assert.deepStrictEqual(M.wastegateWords(s, fmt), { text: 'Closed while boost builds, opens at 1.40 bar to hold the target, fully open at idle', level: 'ok' });
    // stuck shut: never opens and the boost shoots past the target
    const shut = M.wastegateStory([[-0.5, 0], [0.5, 0], [1.2, 0], [1.8, 0], [1.75, 0]], 1.45);
    assert.strictEqual(shut.opensAt, null, 'never opened');
    near(shut.over, 0.35, 1e-9, 'past the target');
    const w = M.wastegateWords(shut, fmt);
    assert.strictEqual(w.level, 'warm');
    assert.strictEqual(w.text, 'Boost went 0.35 bar past the target, closed while boost builds, closed at idle');
    // stuck open: the boost stays short
    const open = M.wastegateStory([[-0.5, 100], [0.3, 70], [0.7, 70], [0.9, 72]], 1.45);
    near(open.under, 0.55, 1e-9, 'short of the target');
    assert.strictEqual(M.wastegateWords(open, fmt).text, 'Boost stayed 0.55 bar short of the target, still 70 % open while boost builds, fully open at idle');
    // only idle seen: asks for a full throttle; nothing at all: still a sentence
    assert.strictEqual(M.wastegateWords(M.wastegateStory([[-0.5, 100], [-0.4, 100]], 1.45), fmt).text, 'Fully open at idle, full throttle once to see when it opens');
    const none = M.wastegateWords(M.wastegateStory([], 1.45), fmt);
    assert.strictEqual(none.level, 'dim');
    assert.strictEqual(M.wastegateStory([[null, 3], [0.5, null]]).peak, null, 'samples with a gap are skipped');
    assert.deepStrictEqual([0, 50, 100, null].map(M.wastegateState), ['closed', 'partly open', 'open', '--']);
});

test('wastegate: in the run trace, on the Boost page only when the car reports it', () => {
    const { Model } = require(path.join(APP, 'model'));
    const P = require(path.join(APP, 'pages'));
    const { Recorder } = require(path.join(ROOT, 'kit', 'runtime', 'record'));
    let air = { boost: 1, manifold: 2, ambient: 1, wastegate: 37.25 };
    const log = new RunLog({ file: null, air: () => air });
    launch(log, { acc: 6 });
    assert(column(log.last, 'wastegate').every((x) => x === 37.3), 'the position is in the trace, to 0.1 %');
    air = { boost: 1 };
    const log2 = new RunLog({ file: null, air: () => air });
    launch(log2, { acc: 6 });
    assert(column(log2.last, 'wastegate').every((x) => x === null), 'null when the car does not report it');
    const vals = { demo: 'off' }, settings = { get: (k) => vals[k], set: (k, v) => { vals[k] = v; } };
    const draw = (m) => { const r = new Recorder(1600, 520); m.ui.page = 'Boost'; P.draw(r, m, 1); return r.targets.map((q) => q.key).join(' '); };
    const m = new Model({ settings, demo: () => false });
    m.live.manifold = 1.2; m.live.ambient = 0.99;
    m.tick(1000);
    const without = draw(m);
    m.live.wastegate = 0;
    m.tick(2000);
    assert(m.has('wastegate'), 'seen');
    const withWg = draw(m);
    assert(withWg.split(' ').length > without.split(' ').length, 'one more card with its (i): ' + without + ' / ' + withWg);
});

test('engine unit: one identifier a request when several are refused', async () => {
    const link = fakeLink(false), got = [];
    const dme = new DmeReader(link, { gapMs: 1, onValues: (v) => got.push(v) });
    dme.start();
    await wait(80);
    dme.stop();
    assert.strictEqual(dme.multi, false, 'switched to single reads');
    const singles = link.sent.filter((q) => q.length === 4);
    assert(singles.length > 4, 'single reads went out');
    assert(got.some((v) => typeof v.manifold === 'number'), 'the manifold pressure still arrives');
});

test('the kit refuses a write before it reaches the car', () => {
    assert.throws(() => check(0x12, 0x2E, [0x58, 0x0F, 0x00], false), /not allowed/);
    assert.throws(() => check(0x12, 0x14, [0xFF, 0xFF, 0xFF], false), /not allowed/);
});

test('dyno: a pull in one gear, binned, corrected, peaks and power', () => {
    near(power(488, 3000), 205.6, 0.1, 'hp from Nm and rpm');
    const pl = new PullLog({ air: () => ({ intake: 25, kPa: 99 }) });
    const tq = (r) => 488 - 0.00012 * Math.pow(r - 3000, 2) / 10;
    let t = 0;
    // 1st gear is never a pull (launch, traction)
    for (let r = 2000; r < 6000; r += 40, t += 50) pl.feed(t, { rpm: r, torque: tq(r), gear: 1, pedal: 100 });
    pl.feed(t += 50, { rpm: 6000, torque: 30, gear: 1, pedal: 0 });
    assert.strictEqual(pl.pulls.length, 0, 'no pull in 1st');
    for (let r = 2000; r <= 6500; r += 40, t += 50) pl.feed(t, { rpm: r, torque: tq(r), gear: 3, pedal: 100 });
    pl.feed(t += 50, { rpm: 6400, torque: 20, gear: 3, pedal: 0 });
    assert.strictEqual(pl.pulls.length, 1, 'one pull');
    const sh = sheet(pl.last);
    assert.strictEqual(sh.rpm[1] - sh.rpm[0], 250, '250 rpm bins');
    near(sh.peakTorque.rpm, 3000, 250, 'torque peak rpm');
    near(sh.peakTorque.v, 488, 3, 'torque peak Nm');
    const best = sh.power.reduce((a, v) => Math.max(a, v), 0);
    near(sh.peakPower.v, best, 1e-9, 'peak power is the highest point');
    // corrected to standard air like the run times
    const pl2 = new PullLog({ air: () => ({ intake: 35, kPa: 95 }) });
    for (let r = 2000; r <= 6500; r += 40, t += 50) pl2.feed(t, { rpm: r, torque: tq(r), gear: 3, pedal: 100 });
    pl2.feed(t += 50, { rpm: 6400, torque: 20, gear: 3, pedal: 0 });
    const s2 = sheet(pl2.last);
    near(s2.peakTorque.v / sh.peakTorque.v, M.sae(35, 95), 1e-3, 'corrected by the factor');
    // a short pull is not kept; a gear change ends one
    const pl3 = new PullLog({});
    for (let r = 3000; r <= 4000; r += 40, t += 50) pl3.feed(t, { rpm: r, torque: 400, gear: 2, pedal: 100 });
    pl3.feed(t += 50, { rpm: 3000, torque: 400, gear: 3, pedal: 100 });
    assert.strictEqual(pl3.pulls.length, 0, 'under 1500 rpm');
});

test('tyres: the one that stands out', () => {
    assert.strictEqual(M.tyreNote({ FL: 2.42, FR: 2.44, RL: 2.31, RR: 2.4 }).text, 'Rear left is 0.11 bar below the others.');
    assert.strictEqual(M.tyreNote({ FL: 2.4, FR: 2.42, RL: 2.38, RR: 2.41 }).odd, null);
    assert.strictEqual(M.tyreNote({ FL: 2.4 }).text, 'Waiting for the tyre sensors.');
});

test('zones', () => {
    assert.strictEqual(M.zone('oil', 60), 'warm');
    assert.strictEqual(M.zone('oil', 104), 'ok');
    assert.strictEqual(M.zone('oil', 140), 'bad');
    assert.strictEqual(M.zone('charge', 38), 'ok');
    assert.strictEqual(M.zone('charge', 52), 'warm');
    assert.strictEqual(M.zoneWords('oil', 60), 'warming up');
    assert.strictEqual(M.zone('egt', null), 'dim');
});

test('sessions, best run, heat soak, saved and loaded again', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')), 'runs.json');
    const log = new RunLog({ file, length: () => 402 });
    const run = (at, s, cf, intake, charge) => ({ at, length: 402, result: { d402: s, d201: s * 0.66 }, trap: {}, cf, intake, charge });
    const H = 3600 * 1000;
    [run(0, 13.4, 1.0, 20, 30), run(10 * 60000, 13.2, 1.03, 20, 40), run(30 * H, 13.0, 0.95, 10, 20)].forEach((r) => log.add(r));
    const ses = M.sessions(log.runs);
    assert.strictEqual(ses.length, 2, 'two sessions');
    assert.strictEqual(ses[0].runs.length, 1, 'newest first');
    assert.strictEqual(M.bestRun(ses[1].runs, 402, true).at, 10 * 60000, 'best corrected');
    assert.strictEqual(M.bestRun(log.runs, 402, false).at, 30 * H, 'best raw');
    assert(M.heatSoaked(log.runs[1]) && !M.heatSoaked(log.runs[0]));
    const again = new RunLog({ file, length: () => 402 });
    assert.strictEqual(again.runs.length, 3, 'loaded from the file');
});

test('only what the car reports: tabs, and remembered per car', () => {
    const { Model } = require(path.join(APP, 'model'));
    const P = require(path.join(APP, 'pages'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-car-')), vals = { demo: 'off' };
    const settings = { get: (k) => vals[k], set: (k, v) => { vals[k] = v; } };
    const m = new Model({ settings, dataDir: dir, demo: () => false });
    m.live.speed = 0; m.live.rpm = 800;
    m.tick(1000);
    assert.deepStrictEqual(P.tabsFor(m), ['Now', 'Runs', 'Log', 'Compare'], 'a car with only speed and rpm');
    m.live.oil = 90; m.live.manifold = 1.2; m.live.ambient = 0.99; m.live.torque = 300;
    m.tick(1100);
    assert.deepStrictEqual(P.tabsFor(m), ['Now', 'Runs', 'Dyno', 'Boost', 'Temps', 'Log', 'Compare']);
    assert(!m.has('egt') && !m.has('tyres'), 'never reported, never shown');
    const again = new Model({ settings, dataDir: dir, demo: () => false });
    assert(again.has('torque') && again.has('boost'), 'remembered for this car');
    const demo = new Model({ settings, demo: () => true });
    assert.strictEqual(P.tabsFor(demo).length, P.TABS.length, 'the demo shows everything');
});

test('Log: a tap on a run row opens the run, not the card\'s info', () => {
    const { Model } = require(path.join(APP, 'model'));
    const P = require(path.join(APP, 'pages'));
    const { Recorder } = require(path.join(ROOT, 'kit', 'runtime', 'record'));
    const vals = { demo: 'on' }, m = new Model({ settings: { get: (k) => vals[k], set: (k, v) => { vals[k] = v; } }, demo: () => true });
    m.tick(Date.now());
    m.ui.page = 'Log';
    const r = new Recorder(1600, 520);
    P.draw(r, m, 0);
    const at = (x, y) => r.targets.filter((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h)[0];
    assert(/^dlrow\|/.test(at(900, 253).key), 'a row: ' + at(900, 253).key);
    assert(/^dlses\|/.test(at(200, 200).key), 'a session: ' + at(200, 200).key);
    at(900, 253).run();
    assert(m.ui.logRun !== null, 'the run is open');
});

test('no em or en dash in the app', () => {
    const bad = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
    fs.readdirSync(APP).filter((f) => /\.(js|json|md)$/.test(f)).forEach((f) => {
        const s = fs.readFileSync(path.join(APP, f), 'utf8');
        assert(!bad.some((d) => s.indexOf(d) >= 0), f);
    });
});

/* ---------- every engine (owner rule 2026-11-26 19:03) ---------- */
const E = require(path.join(__dirname, '..', 'lib', 'engine'));
const DM = require(path.join(APP, 'demo'));
const DY = require(path.join(APP, 'dyno'));
const MD = require(path.join(APP, 'model'));
test('each demo car: what it reports (EV no boost or Dyno, diesel no wastegate, V8 bank 2)', () => {
    const has = (id, k) => MD.demoHas(E.demoCar(id), k);
    assert(has('b48', 'boost') && has('b48', 'wastegate') && !has('b48', 'boost2'));
    assert(has('s63', 'boost2') && has('s63', 'wastegate2'));
    assert(has('b57', 'boost') && !has('b57', 'wastegate'));
    assert(!has('ev', 'boost') && !has('ev', 'torque') && !has('ev', 'oil') && has('ev', 'speed') && has('ev', 'tyres'));
});
test('demo runs per car: the boost each reaches, bank 2 on a V8, none on an EV', () => {
    const peak = (id) => {
        const d = new DM.Demo(7, 0, null, E.demoCar(id));
        let b = -9, b2 = null, wg = false, v = null;
        for (let t = 0; t < 40000; t += 50) { v = d.sample(t); if (v.boost > b) b = v.boost; if (typeof v.boost2 === 'number') b2 = v.boost2; if ('wastegate' in v) wg = true; }
        return { b: b, b2: b2, wg: wg, v: v };
    };
    const s63 = peak('s63'), b57 = peak('b57'), ev = peak('ev');
    assert(s63.b > 1.7 && s63.b2 !== null && s63.wg);
    assert(b57.b > 1.8 && !b57.wg);
    assert(ev.v.boost === undefined && ev.v.rpm === undefined && ev.v.speed >= 0);
});
test('a dyno pull that never ends is cut, its arrays never grow without end', () => {
    const p = new DY.PullLog({});
    for (let i = 0; i < 5000; i++) p.feed(i * 50, { rpm: 3000 + i * 0.01, torque: 400, gear: 3, pedal: 100 });
    assert(!p.cur || p.cur.rpm.length < 3000);
});

(async () => {
    for (const [name, fn] of tests) {
        try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n')[0]); }
    }
    console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
    process.exit(failed ? 1 : 0);
})();
