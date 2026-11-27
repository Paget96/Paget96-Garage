// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
// Health Drive check (T35): what must agree is compared in like conditions; one odd moment is never a finding.
const assert = require('assert');
const { DriveCheck, condition } = require('../apps/p96_health/drivecheck');
const tests = [];
const test = (n, f) => tests.push([n, f]);
// a steady warm drive, a sample every 2 s; mod(i, s) changes a sample
function drive(n, mod) {
    const dc = new DriveCheck({ cylinders: 4 });
    let mis = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
        const w = Math.sin(i / 3);
        const s = { t: i * 2000, rpm: 2600 + 100 * w, load: 45 + 5 * w, coolant: 90, oil: 95, knock: 0.4,
            rough: [0.3 * w, -0.2, 0.4, -0.1 * w], ignition: [18.5 + 0.2 * w, 18.3, 18.6, 18.4], misfire: mis.slice(),
            lambda: 1.0 + 0.005 * w, lambdaTarget: 1.0, vanosIn: 20 + w, vanosInTarget: 20, rail: 200, railTarget: 200, boost: 0.6, boostTarget: 0.62 };
        if (mod) mod(i, s, mis);
        dc.feed(s);
    }
    return dc;
}
test('a healthy drive: no findings, every check ok', () => {
    const dc = drive(300);
    assert.deepStrictEqual(dc.findings(), []);
    dc.checks().filter((c) => c.key !== 'vanosEx').forEach((c) => assert.strictEqual(c.state, 'ok', c.key + ' ' + c.state));
    assert.strictEqual(dc.checks().filter((c) => c.key === 'vanosEx')[0].state, 'nodata');
});
test('cylinder 3 rough under load, again and again: a finding about cylinder 3', () => {
    const dc = drive(300, (i, s) => { if (i > 100 && i % 10 === 0) s.rough[2] = 25; });
    const f = dc.findings();
    assert.strictEqual(f.length, 1); assert.strictEqual(f[0].cyl, 3); assert.ok(/cylinder 3 runs rougher/i.test(f[0].words), f[0].words);
    assert.ok(f[0].times >= 3);
});
test('one odd moment is not a finding', () => {
    const dc = drive(300, (i, s) => { if (i === 150) s.rough[1] = 30; });
    assert.deepStrictEqual(dc.findings(), []);
    assert.strictEqual(dc.checks()[0].state, 'watch');
});
test('a cylinder that is always a little different is learned, not flagged', () => {
    // cylinder 2 always 5° later: reported on the first long drive, then learned; on a later drive with what was
    // learned (kept between drives) it is not reported again
    const first = drive(2500, (i, s) => { s.ignition[1] = 13.5; });
    assert.ok(first.findings().some((f) => f.check === 'ignition' && f.cyl === 2));
    const L = first.learned();
    const dc2 = new DriveCheck({ cylinders: 4, learned: L });
    for (let i = 0; i < 300; i++) dc2.feed({ t: i * 2000, rpm: 2600, load: 45, coolant: 90, ignition: [18.5, 13.5, 18.6, 18.4] });
    assert.ok(!dc2.findings().some((f) => f.check === 'ignition'), JSON.stringify(dc2.findings()));
});
test('the mixture off its target for long: a finding; for one sample: none', () => {
    const lean = drive(200, (i, s) => { if (i > 50 && i < 120) s.lambda = 1.12; });
    assert.ok(lean.findings().some((f) => f.check === 'lambda' && /leaner/.test(f.words)));
    const blip = drive(200, (i, s) => { if (i === 60) s.lambda = 1.2; });
    assert.ok(!blip.findings().some((f) => f.check === 'lambda'));
});
test('misfires counted per cylinder', () => {
    const dc = drive(200, (i, s, mis) => { if (i % 12 === 0 && i > 0) mis[3]++; s.misfire = mis.slice(); });
    assert.ok(dc.findings().some((f) => f.check === 'misfire' && f.cyl === 4));
});
test('a cold engine is not judged', () => {
    const dc = drive(200, (i, s) => { s.coolant = 40; if (i % 10 === 0) s.rough[0] = 30; });
    assert.ok(!dc.findings().some((f) => f.check === 'rough'));
});
test('conditions: idle, bands', () => {
    assert.strictEqual(condition({ rpm: 750, load: 15 }), 'idle');
    assert.strictEqual(condition({ rpm: 3000, load: 70 }), 'mid|full');
});
(async function () {
    let failed = 0;
    for (const [name, fn] of tests) { try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); } }
    console.log(tests.length + ' tests, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
