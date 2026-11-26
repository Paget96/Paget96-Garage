'use strict';
// Lights: every page draws on demo values, simulated or armed, standing or moving, and the sequences stay as upstream made them
const assert = require('assert');
const path = require('path');
const { Recorder } = require(path.join(__dirname, '..', 'kit', 'runtime', 'record'));
const UI = require('../lib/ui');
const P = require('../apps/p96_lights/pages');
const PR = require('../apps/p96_lights/presets');
let failed = 0;
function test(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e)); } }
const act = new Proxy({}, { get: () => () => {} });
const base = { presets: PR.DEFAULTS, preset: 0, beat: 3, flash: { pattern: 'both', rate: 'fast' }, ambient: { scene: { kind: 'rainbow', upper: { rgb: [1, 2, 3], bright: 50 }, lower: { rgb: [1, 2, 3], bright: 50 } } }, lamps: { running: null } };
test('every page draws, simulated and armed, standing and moving', () => {
    [false, true].forEach((armed) => [false, true, null].forEach((moving) => [0, 1, 2].forEach((tab) => {
        const rec = new Recorder(UI.W, UI.H);
        P.draw(rec, Object.assign({}, base, { armed: armed, moving: moving }), { page: 'main', tab: tab, settings: P.DEFAULTS, status: 'X' }, 1.5, act);
        assert.ok(rec.words().length > 10);
    })));
});
test('How to use and Settings draw', () => {
    ['help', 'settings'].forEach((page) => { const rec = new Recorder(UI.W, UI.H); P.draw(rec, base, { page: page, tab: 0, topic: 1, settings: P.DEFAULTS }, 1, act); });
});
test('light control is simulated by default', () => { assert.strictEqual(P.DEFAULTS.arm, 'off'); });
test('six sequences of 16 beats', () => { assert.strictEqual(PR.DEFAULTS.length, 6); PR.DEFAULTS.forEach((p) => assert.strictEqual(p.beats.length, PR.BEATS)); });
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
