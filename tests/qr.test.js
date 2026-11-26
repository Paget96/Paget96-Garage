// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * lib/qr.js: every module of its codes against another encoder's (tests/fixtures/qr_reference.json, made by
 * tools/qr_reference.py with the Python qrcode package: every level, every mask, versions 1 to 40, ASCII and UTF-8),
 * the capacity table, the version limit, and drawing (whole pixels, a quiet zone). Plain node, Node 8 compatible:
 *
 *   node tests/qr.test.js
 *
 * That a drawn code really scans is checked with a decoder: python3 tools/qr_reference.py --decode <png>.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const QR = require(path.join(__dirname, '..', 'lib', 'qr'));
const { Recorder, play } = require(path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime', 'record'));
const { Canvas } = require(path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime', 'canvas'));

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'qr_reference.json'), 'utf8'));

REF.cases.forEach((c) => {
    test('same matrix as the reference: level ' + c.ecl + ', mask ' + c.mask + ', version ' + c.version + ', ' + Buffer.byteLength(c.text) + ' bytes', () => {
        const q = QR.encode(c.text, { ecl: c.ecl, mask: c.mask });
        assert.strictEqual(q.version, c.version, 'version');
        assert.strictEqual(q.size, c.rows.length);
        const rows = QR.rows(q);
        rows.forEach((r, y) => assert.strictEqual(r, c.rows[y], 'row ' + y));
    });
});

test('every mask is covered by the reference, and every level', () => {
    const masks = {}, levels = {};
    REF.cases.forEach((c) => { masks[c.mask] = 1; levels[c.ecl] = 1; });
    assert.deepStrictEqual(Object.keys(masks).sort(), ['0', '1', '2', '3', '4', '5', '6', '7']);
    assert.deepStrictEqual(Object.keys(levels).sort(), ['H', 'L', 'M', 'Q']);
});

test('the mask chosen by penalty is one of the eight and the result keeps its version', () => {
    REF.cases.forEach((c) => {
        const q = QR.encode(c.text, { ecl: c.ecl });
        assert.ok(q.mask >= 0 && q.mask <= 7);
        assert.strictEqual(q.version, c.version);
    });
});

test('capacity: the table of the standard, byte mode', () => {
    // ISO/IEC 18004 table 7, byte mode
    assert.strictEqual(QR.capacity(1, 'L'), 17);
    assert.strictEqual(QR.capacity(1, 'M'), 14);
    assert.strictEqual(QR.capacity(1, 'Q'), 11);
    assert.strictEqual(QR.capacity(1, 'H'), 7);
    assert.strictEqual(QR.capacity(10, 'M'), 213);
    assert.strictEqual(QR.capacity(15, 'L'), 520);
    assert.strictEqual(QR.capacity(15, 'M'), 412);
    assert.strictEqual(QR.capacity(40, 'L'), 2953);
    assert.strictEqual(QR.capacity(40, 'H'), 1273);
});

test('too long for the largest version allowed: a QR_TOO_LONG error, so the caller can trim', () => {
    assert.throws(() => QR.encode('x'.repeat(413), { ecl: 'M', maxVersion: 15 }), (e) => e.code === 'QR_TOO_LONG');
    assert.strictEqual(QR.encode('x'.repeat(412), { ecl: 'M', maxVersion: 15 }).version, 15);
});

test('drawn: dark on white, whole pixels, a quiet zone of 4 modules all round', () => {
    const q = QR.encode('HELLO WORLD', { ecl: 'M' }), px = 5, n = q.size + 8;
    const rec = new Recorder(n * px + 20, n * px + 20);
    QR.draw(rec, q, 10, 10, px);
    const cv = new Canvas(n * px + 20, n * px + 20);
    play(rec.words(), cv);
    const at = (x, y) => { const i = (y * cv.w + x) * 4; return [cv.d[i], cv.d[i + 1], cv.d[i + 2]]; };
    // quiet zone white
    for (let k = 0; k < 4 * px; k++) assert.deepStrictEqual(at(10 + k, 10 + k), [255, 255, 255]);
    // every module in the middle of its square is exactly dark or exactly light
    for (let y = 0; y < q.size; y++) {
        for (let x = 0; x < q.size; x++) {
            const c = at(10 + (4 + x) * px + 2, 10 + (4 + y) * px + 2);
            assert.deepStrictEqual(c, q.get(x, y) ? [0, 0, 0] : [255, 255, 255], 'module ' + x + ',' + y);
        }
    }
});

test('Node 8: no optional chaining, nullish coalescing or object spread in lib/qr.js', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'qr.js'), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\?\.[a-zA-Z_(]/.test(src) && !/\?\?/.test(src) && !/\{\s*\.\.\./.test(src));
});

(async function () {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
    }
    console.log(tests.length + ' tests, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
