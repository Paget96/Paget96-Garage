// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/** The car's own limits (lib/engine.js limits, Company D27): Auto from the engine, a setting wins. */
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '..', 'lib', 'engine'));
let failed = 0;
function test(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } }

test('Auto: each engine its own rail scale, redline and boost scale', () => {
    assert.deepStrictEqual(E.limits(E.demoCar('b48')), { rail: 350, redline: 6500, boostMax: 2 });
    assert.strictEqual(E.limits(E.demoCar('b57')).rail, 2700);
    assert.strictEqual(E.limits(E.demoCar('b57')).redline, 4800);
    assert.strictEqual(E.limits(E.demoCar('s58')).boostMax, 2.5);
});
test('a number set in Settings wins; auto, empty or odd values keep the engine figure', () => {
    const set = { railMax: 500, redline: '7500', boostMax: 'auto' };
    assert.deepStrictEqual(E.limits(E.demoCar('b48'), (k) => set[k]), { rail: 500, redline: 7500, boostMax: 2 });
    assert.strictEqual(E.limits(E.demoCar('b48'), () => 'x').rail, 350);
    assert.strictEqual(E.limits(E.demoCar('b48'), () => -1).redline, 6500);
});
test('an unknown car: petrol figures, a diesel its own', () => {
    assert.strictEqual(E.limits({}).rail, 350);
    assert.strictEqual(E.limits({ diesel: true }).rail, 2700);
});
test('the Settings rows default to Auto', () => {
    Object.keys(E.LIMIT_ROWS).forEach((k) => {
        const r = E.LIMIT_ROWS[k];
        if (r.type === 'number') { assert.strictEqual(r.default, 0, k); assert.strictEqual(r.zero, 'Auto', k); return; }    // a stepper: 0 is Auto
        assert.strictEqual(r.default, 'auto', k); assert.strictEqual(r.options[0][0], 'auto', k);
    });
    // the boost stepper at 0 and an old saved 'auto' both follow the engine
    assert.strictEqual(E.limits({ boost: 1.3 }, () => 0).boostMax, E.limits({ boost: 1.3 }, () => 'auto').boostMax);
    assert.strictEqual(E.limits({ boost: 1.3 }, (k) => (k === 'boostMax' ? 2.25 : null)).boostMax, 2.25);
});
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
