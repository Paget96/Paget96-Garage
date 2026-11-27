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
    [false, true].forEach((armed) => [false, true, null].forEach((moving) => P.PAGES.map((_, i) => i).forEach((tab) => {
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
const PF = require('../apps/p96_lights/profiles');
test('light shows: every ready made one is 16 beats of known lamps, editing makes a copy, speed stays in range', () => {
    PF.READY.forEach((p) => { assert.strictEqual(p.beats.length, PF.BEATS); p.beats.forEach((b) => b.forEach((f) => assert.ok(PF.ALL.indexOf(f) >= 0, f))); });
    const store = { mine: [], speed: {} }, r = PF.READY[0], m = PF.copy(r, store);
    assert.strictEqual(store.mine.length, 1); assert.ok(!m.ready); PF.toggle(m, 0, 'brake');
    assert.ok(r.beats[0].indexOf('brake') < 0, 'the ready made show is untouched');
    for (let i = 0; i < 40; i++) PF.speedOf(r, store, -1);
    assert.strictEqual(PF.msOf(r, store), PF.MIN_MS); assert.strictEqual(r.beatMs, PF.READY[0].beatMs);
    ['Flash', 'Party', 'Taillight', 'Strobe'].forEach((g) => assert.ok(PF.inGroup(g, store).length > 0, g));
});
test('Shows draws its editor for a show of yours', () => {
    const store = { mine: [] }; PF.copy(PF.READY[1], store);
    const rec = new Recorder(UI.W, UI.H); P.draw(rec, Object.assign({}, base, { presets: store.mine, preset: 0, edit: true }), { page: 'main', tab: 1, settings: P.DEFAULTS }, 1, act);
    assert.ok(rec.targets.some((q) => /^lcell\|amb\|/.test(q.key)));
});
test('regions: only what this car has, by the lights the body controller lists', () => {
    const lights = [{ name: 'Driver front door pocket' }, { name: 'Dash line centre' }, { name: 'Passenger rear door line' }];
    assert.deepStrictEqual(P.regionsOf(lights).map((r) => r[0]), ['all', 'dash', 'rearDoors', 'pockets']);
    assert.deepStrictEqual(P.regionsOf([]).map((r) => r[0]), ['all']);
});
test('Stop all shows only while something of ours runs', () => {
    const keys = (v) => { const rec = new Recorder(UI.W, UI.H); P.draw(rec, Object.assign({}, base, v), { page: 'main', tab: 1, settings: P.DEFAULTS }, 1, act); return rec.targets.map((q) => q.key); };
    assert.ok(keys({ lamps: { running: 'sequence' } }).indexOf('lstopall') >= 0);
    assert.ok(keys({ lamps: { running: null } }).indexOf('lstopall') < 0);
});
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
