// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * lib/engine.js: the engine found from the car's answers (cylinders, one or two engine units, fuel type, AdBlue),
 * the demo cars and what follows from each (filter name, per-cylinder banks, service parts), and the
 * per-cylinder card of lib/ui.js at 3, 4, 6, 8 and 12 cylinders. Plain node, Node 8 compatible:
 *
 *   node tests/engine.test.js
 */
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '..', 'lib', 'engine'));
const UI = require(path.join(__dirname, '..', 'lib', 'ui'));
const { Recorder } = require(path.join(__dirname, '..', 'kit', 'runtime', 'record'));

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/** 62 F6 A0 with monitors A1 (catalyst) and cylinders 1..n set. */
function cylReply(n) {
    const b = [0, 0, 0, 0];
    const set = (mid) => { b[(mid - 0xA1) >> 3] |= 0x80 >> ((mid - 0xA1) & 7); };
    set(0xA1);
    for (let i = 0; i < n; i++) set(0xA2 + i);
    return [0x62, 0xF6, 0xA0].concat(b);
}

test('cylinder count from the misfire monitor list, never assumed', () => {
    [3, 4, 6, 8, 12].forEach((n) => assert.strictEqual(E.parseCylinders(cylReply(n)), n));
    assert.strictEqual(E.parseCylinders([0x7F, 0x22, 0x31]), 0);
    assert.strictEqual(E.parseCylinders(null), 0);
    assert.strictEqual(E.profile({ fuel: 'petrol' }).cylinders, 0);
});
test('two engine units from the master SGBD index (V8s), one otherwise', () => {
    assert.strictEqual(E.parseIndex([0x62, 0xF1, 0x50, 0x0F, 0x24, 0x2C]), '0F242C');
    assert.ok(E.isTwinIndex('0F242C') && E.isTwinIndex('0F2E00'));
    assert.ok(!E.isTwinIndex('0F1C40'));
});
test('fuel type from OBD 01 51: petrol, diesel, electric, hybrids', () => {
    assert.deepStrictEqual(E.parseFuel([0x41, 0x51, 1]), { fuel: 'petrol', hybrid: false, code: 1 });
    assert.strictEqual(E.parseFuel([0x41, 0x51, 4]).fuel, 'diesel');
    assert.strictEqual(E.parseFuel([0x41, 0x51, 8]).fuel, 'electric');
    assert.ok(E.parseFuel([0x41, 0x51, 17]).hybrid);
    assert.strictEqual(E.parseFuel([0x7F, 0x01, 0x12]), null);
});
test('AdBlue level from OBD 01 85', () => {
    assert.strictEqual(Math.round(E.parseAdBlue([0x41, 0x85, 0x02, 0, 0, 0, 0, 128])), 50);
    assert.strictEqual(E.parseAdBlue([0x41, 0x85, 0]), null);
});
test('the detector asks fuel, index and cylinders once, keeps them, and reads nothing else', async () => {
    const asked = [];
    const answers = { '01 51': [0x41, 0x51, 1], '22 F1 50': [0x62, 0xF1, 0x50, 0x0F, 0x24, 0x2C], '22 F6 A0': cylReply(8) };
    const link = { physical: (addr, sid, data) => { const k = [sid].concat(data).map((b) => ('0' + b.toString(16).toUpperCase()).slice(-2)).join(' '); asked.push(addr.toString(16) + ' ' + k); return Promise.resolve(answers[k] || null); } };
    let kept = null;
    const d = new E.Detector(link, { get: () => null, set: (f) => { kept = JSON.parse(JSON.stringify(f)); } });
    const p = await d.run();
    assert.deepStrictEqual(asked, ['12 01 51', '12 22 F1 50', '12 22 F6 A0']);
    assert.strictEqual(p.cylinders, 8); assert.strictEqual(p.banks, 2); assert.strictEqual(p.units, 2); assert.strictEqual(p.perBank, 4);
    assert.strictEqual(p.turbos, 2); assert.strictEqual(p.flapCmd, '611E'); assert.ok(p.ignition && p.knock);
    assert.strictEqual(kept.cylinders, 8);
    // a second start knows it all and sends nothing
    const again = new E.Detector(link, { get: () => kept, set: () => {} });
    asked.length = 0;
    await again.run();
    assert.deepStrictEqual(asked, []);
});
test('a car that does not answer stays not known (pages hide), never a B48', async () => {
    const d = new E.Detector({ physical: () => Promise.resolve(null) }, null);
    const p = await d.run();
    assert.strictEqual(p.cylinders, 0); assert.strictEqual(p.fuel, null); assert.deepStrictEqual(E.cylinderBanks(p), []);
});
test('every demo car: the layout its pages use', () => {
    const want = {
        b48: [4, 1, 1, 'OPF', false, true], b58: [6, 1, 1, 'OPF', false, true], s58: [6, 1, 2, 'OPF', false, true],
        s63: [8, 2, 2, 'OPF', false, true], b57: [6, 1, 1, 'DPF', true, false], phev: [4, 1, 1, 'OPF', false, true], ev: [0, 0, 0, 'filter', false, false],
    };
    E.DEMO_CARS.forEach((c) => {
        const p = E.demoCar(c.id), w = want[c.id];
        assert.deepStrictEqual([p.cylinders, p.banks, p.turbos, E.filterName(p), p.scr, p.ignition], w, c.id);
    });
    assert.ok(E.demoCar('ev').engine === false && E.demoCar('phev').hybrid);
    assert.strictEqual(E.demoCar('nope').id, 'b48');
});
test('per-cylinder banks: one row inline, bank 1 and bank 2 on a V8', () => {
    assert.deepStrictEqual(E.cylinderBanks(E.demoCar('b48')), [{ bank: 1, cylinders: [1, 2, 3, 4] }]);
    assert.deepStrictEqual(E.cylinderBanks(E.demoCar('b58'))[0].cylinders, [1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(E.cylinderBanks(E.demoCar('s63')), [{ bank: 1, cylinders: [1, 2, 3, 4] }, { bank: 2, cylinders: [5, 6, 7, 8] }]);
    assert.deepStrictEqual(E.cylinderBanks(E.profile({ fuel: 'petrol', cylinders: 3 }))[0].cylinders, [1, 2, 3]);
    assert.deepStrictEqual(E.cylinderBanks(E.demoCar('ev')), []);
});
test('service parts: spark plugs on a petrol, glow plugs and AdBlue on a diesel, none on an EV', () => {
    assert.ok(E.engineParts(E.demoCar('b48')).indexOf('Spark plugs') >= 0);
    const d = E.engineParts(E.demoCar('b57'));
    assert.ok(d.indexOf('Glow plugs') >= 0 && d.indexOf('AdBlue') >= 0 && d.indexOf('Spark plugs') < 0);
    assert.deepStrictEqual(E.engineParts(E.demoCar('ev')), []);
});
test('the per-cylinder card fits 3, 4, 6, 8 and 12 cylinders inside its card', () => {
    [3, 4, 6, 8, 12].forEach((n) => {
        const p = E.profile({ fuel: 'petrol', cylinders: n, units: n === 8 ? 2 : 1, banks: n >= 8 ? 2 : 1 });
        const values = {};
        for (let c = 1; c <= n; c++) values[c] = c * 3;
        const rec = new Recorder(UI.W, UI.H), texts = [], orig = rec.text.bind(rec);
        rec.text = function (str, tx, ty) { texts.push({ s: str, x: tx, y: ty }); return orig.apply(null, arguments); };
        const x = 28, y = 112, w = 760, h = 300;
        UI.cylinders(rec, x, y, w, h, { label: 'Test', banks: E.cylinderBanks(p), values: values, lo: 0, hi: 40, unit: 'x' });
        const words = rec.words();
        assert.ok(words.length > 0);
        // every number and label drawn lies inside the card
        assert.ok(texts.length >= 2 * n, 'a number and a label per cylinder');
        const bad = texts.filter((q) => q.x < x || q.x > x + w || q.y < y || q.y > y + h);
        assert.deepStrictEqual(bad, [], n + ' cylinders');
    });
});

(async function () {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
    }
    console.log(tests.length + ' tests, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
