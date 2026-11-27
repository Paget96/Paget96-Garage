// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/** Datalog Bottleneck (T36): what holds the car back under hard load, from hard pulls only. */
const assert = require('assert');
const path = require('path');
const { Bottleneck } = require(path.join(__dirname, '..', 'apps', 'p96_datalog', 'bottleneck'));
let failed = 0;
function test(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } }

/* one hard pull of `secs` s from t0, rpm 2500 to 6000; f(s, k 0..1) changes the sample; then 4 s off */
function pull(bn, t0, secs, f) {
    let t = t0;
    for (let i = 0; i <= secs; i++, t += 1000) {
        const k = i / secs, rpm = 2500 + 3500 * k;
        const s = { t, rpm, pedal: 100, torque: 400 - 40 * k, boost: 1.2, boostTarget: 1.25, wastegate: 30, outside: 15,
            intake: 20, charge: 30, egt: 820, coolant: 95, oil: 105, gearbox: 80, knock: 0.5, lambda: 0.85, rail: 350, misfires: 0 };
        if (f) f(s, k);
        bn.feed(s);
    }
    for (let i = 0; i < 4; i++, t += 1000) bn.feed({ t, rpm: 2000, pedal: 10, torque: 50 });
    return t;
}
const get = (v, k) => v.checks.filter((c) => c.key === k)[0];

test('no hard pull: every check waits, nothing is first', () => {
    const bn = new Bottleneck();
    for (let t = 0; t < 30000; t += 1000) bn.feed({ t, rpm: 2000, pedal: 40, torque: 150 });
    const v = bn.verdict();
    assert.strictEqual(v.stretches, 0);
    assert.strictEqual(v.first, null);
    assert.ok(v.checks.every((c) => c.state === 'nodata'));
});
test('a pull under 3 s is not kept', () => {
    const bn = new Bottleneck();
    pull(bn, 0, 2);
    assert.strictEqual(bn.verdict().stretches, 0);
});
test('a healthy car: hard pulls, every check ok, nothing first', () => {
    const bn = new Bottleneck();
    let t = 0;
    for (let i = 0; i < 3; i++) t = pull(bn, t, 6) + 20000;
    const v = bn.verdict();
    assert.strictEqual(v.stretches, 3);
    assert.strictEqual(v.first, null);
    assert.ok(v.checks.every((c) => c.state === 'ok'), JSON.stringify(v.checks.map((c) => c.key + ':' + c.state)));
});
test('turbo: short of target at high revs with the wastegate shut, twice: the limit, the turbo named', () => {
    const bn = new Bottleneck();
    let t = 0;
    for (let i = 0; i < 2; i++) t = pull(bn, t, 6, (s, k) => { if (s.rpm > 4500) { s.boost = 1.0; s.boostTarget = 1.35; s.wastegate = 2; } }) + 20000;
    const v = bn.verdict(), c = get(v, 'turbo');
    assert.strictEqual(c.state, 'limit');
    assert.ok(/nothing more to give/.test(c.words), c.words);
    assert.strictEqual(v.first.key, 'turbo');
});
test('turbo: short already at low revs points at a boost leak', () => {
    const bn = new Bottleneck();
    let t = 0;
    for (let i = 0; i < 2; i++) t = pull(bn, t, 6, (s) => { s.boost = 0.95; s.boostTarget = 1.3; s.wastegate = 0; }) + 20000;
    assert.ok(/boost leak/.test(get(bn.verdict(), 'turbo').words));
});
test('turbo: short while the wastegate is open is the engine unit asking less, not a limit', () => {
    const bn = new Bottleneck();
    let t = 0;
    for (let i = 0; i < 3; i++) t = pull(bn, t, 6, (s) => { s.boost = 0.9; s.boostTarget = 1.3; s.wastegate = 60; }) + 20000;
    assert.strictEqual(get(bn.verdict(), 'turbo').state, 'ok');
});
test('one odd pull is watch, not limit', () => {
    const bn = new Bottleneck();
    pull(bn, 0, 5, (s) => { s.charge = 60; });
    assert.strictEqual(get(bn.verdict(), 'intercooler').state, 'watch');
});
test('one long hold (8 s or more) is enough for a limit', () => {
    const bn = new Bottleneck();
    pull(bn, 0, 9, (s) => { s.charge = 15 + 40; });
    assert.strictEqual(get(bn.verdict(), 'intercooler').state, 'limit');
});
test('heat soak: later pulls make less torque, the hotter charge air named', () => {
    const bn = new Bottleneck();
    let t = 0;
    for (let i = 0; i < 3; i++) {
        t = pull(bn, t, 6, (s) => { s.charge = 30 + 14 * i; s.torque = s.torque * (1 - 0.06 * i); }) + 15000;
    }
    const c = get(bn.verdict(), 'power');
    assert.notStrictEqual(c.state, 'ok');
    assert.ok(/heat soak/.test(c.words), c.words);
});
test('fuel: the rail falling while the revs climb names the pump', () => {
    const bn = new Bottleneck();
    let t = 0;
    for (let i = 0; i < 2; i++) t = pull(bn, t, 6, (s, k) => { s.rail = 350 - 80 * k; }) + 20000;
    const c = get(bn.verdict(), 'fuel');
    assert.strictEqual(c.state, 'limit');
    assert.ok(/fuel pump/.test(c.words));
});
test('fuel: lean at full load on a petrol, never judged on a diesel', () => {
    const lean = (bn) => { let t = 0; for (let i = 0; i < 2; i++) t = pull(bn, t, 6, (s) => { s.lambda = 1.05; }) + 20000; };
    const a = new Bottleneck(); lean(a);
    assert.strictEqual(get(a.verdict(), 'fuel').state, 'limit');
    const d = new Bottleneck({ petrol: false }); lean(d);
    assert.strictEqual(get(d.verdict(), 'fuel').state, 'ok');
});
test('knock, misfires, exhaust, cooling, gearbox each found on their own', () => {
    const bn = new Bottleneck();
    let t = 0;
    for (let i = 0; i < 2; i++) {
        t = pull(bn, t, 6, (s, k) => { s.knock = 5; s.misfires = Math.round(3 * k); s.egt = 980; s.dp = 320; s.coolant = 112; s.oil = 138; s.gearbox = 118; }) + 20000;
    }
    const v = bn.verdict();
    ['knock', 'spark', 'exhaust', 'cooling', 'gearbox'].forEach((k) => assert.strictEqual(get(v, k).state, 'limit', k));
    assert.ok(v.first);
});
test('what the car does not report is nodata, said plainly, and ranks last', () => {
    const bn = new Bottleneck();
    for (let i = 0; i < 2; i++) {
        let tt = i * 30000;
        for (let j = 0; j <= 5; j++, tt += 1000) bn.feed({ t: tt, rpm: 3000 + j * 500, pedal: 100, torque: 380, coolant: 95, charge: 60, outside: 15 });
        for (let j = 0; j < 4; j++, tt += 1000) bn.feed({ t: tt, rpm: 2000, pedal: 0 });
    }
    const v = bn.verdict();
    assert.strictEqual(get(v, 'knock').state, 'nodata');
    assert.ok(/does not get this value/.test(get(v, 'knock').words));
    assert.strictEqual(v.checks[v.checks.length - 1].state, 'nodata');
    assert.strictEqual(v.first.key, 'intercooler');
});
test('no pedal value: hard load is the torque near the most seen, above 2 000 rpm', () => {
    const bn = new Bottleneck();
    let t = 0;
    for (let i = 0; i < 3; i++) { bn.feed({ t, rpm: 1500, torque: 120 }); t += 1000; }
    for (let i = 0; i <= 5; i++, t += 1000) bn.feed({ t, rpm: 3000 + i * 400, torque: 400 });
    for (let i = 0; i < 4; i++, t += 1000) bn.feed({ t, rpm: 2500, torque: 80 });
    assert.strictEqual(bn.verdict().stretches, 1);
});
test('kept stretches come back with the next drive, and stay JSON', () => {
    const a = new Bottleneck();
    pull(a, 0, 6, (s) => { s.charge = 60; });
    const b = new Bottleneck({ pulls: JSON.parse(JSON.stringify(a.saved())) });
    pull(b, 100000, 6, (s) => { s.charge = 60; });
    assert.strictEqual(b.verdict().stretches, 2);
    assert.strictEqual(get(b.verdict(), 'intercooler').state, 'limit');
});

test('another day is not heat soak: power compared within one drive only', () => {
    const bn = new Bottleneck();
    pull(bn, 0, 6);
    pull(bn, 3 * 86400000, 6, (s) => { s.torque *= 0.9; s.charge = 45; });
    assert.strictEqual(get(bn.verdict(), 'power').state, 'ok');
});
test('the units setting writes the evidence', () => {
    const bn = new Bottleneck();
    pull(bn, 0, 9, (s) => { s.charge = 60; });
    const c = get(bn.verdict({ dtemp: (x) => Math.round(x * 9 / 5) + ' °F' }), 'intercooler');
    assert.ok(/81 °F over outside/.test(c.evidence), c.evidence);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
