// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/** The side menu (lib/ui.js rail): drawn in the car's full screen layout, tappable while in, gone when slid away. */
const assert = require('assert');
const path = require('path');
const UI = require(path.join(__dirname, '..', 'lib', 'ui'));
const { Recorder } = require(path.join(__dirname, '..', 'kit', 'runtime', 'record'));
let failed = 0;
function test(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); } }
UI.useRail(true);
function frame() {
    const r = new Recorder(UI.W, UI.H); r.place = { full: true }; r._extra = 190;
    UI.menu(['Now', 'Runs', 'Dyno'], 1, 'main'); UI.title(r, 'TEST'); UI.header(r, {});
    return r;
}
test('every page and How to use and Settings, each a target left of the page', () => {
    UI.setRailShown(1);
    const t = frame().targets.filter((q) => q.key.indexOf('p96rail|') === 0);
    assert.strictEqual(t.length, 5);
    t.forEach((q) => assert.ok(q.x < 0 && q.x + q.w <= 0, q.key));
});
test('slid away: no targets; half way: none either', () => {
    UI.setRailShown(0);
    assert.strictEqual(frame().targets.filter((q) => q.key.indexOf('p96rail|') === 0).length, 0);
    UI.setRailShown(0.4);
    assert.strictEqual(frame().targets.filter((q) => q.key.indexOf('p96rail|') === 0).length, 0);
    UI.setRailShown(1);
});
test('the room below the page grows the content height', () => {
    frame();
    assert.ok(UI.hh() > 392 && UI.bottom() > 504);
});
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
