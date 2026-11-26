// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
process.env.GARAGE_MENU = 'off';   // these tests check the page's own tab bar and buttons (the header menu is off)
/**
 * The tab bar of lib/ui.js when the tabs are wider than the bar (owner, 2026-11-26 20:14: "nije scrollable ovaj nas"):
 * the arrows move it, a finger swipe moves it (attach's touch), a tap without moving presses the tab under it, a tab
 * scrolled out of the bar is no target, and a new selection glides into view again. Plain node:
 *
 *   node tests/tabs.test.js
 */
const assert = require('assert');
const path = require('path');
const UI = require(path.join(__dirname, '..', 'lib', 'ui'));
const { Recorder } = require(path.join(__dirname, '..', 'kit', 'runtime', 'record'));

let clock = 1e12;
Date.now = () => clock;
const TABS = ['Now', 'Runs', 'Dyno', 'Correction', 'Tyres', 'Boost', 'Temps', 'Log', 'Compare'];
let sel = 0;
/** n frames at 60 fps; the last one's recorder. */
function frames(n) {
    let r = null;
    for (let i = 0; i < (n || 1); i++) { clock += 17; r = new Recorder(UI.W, UI.H); UI.tabs(r, TABS, sel, { onSelect: (i2) => { sel = i2; } }); }
    return r;
}
const keys = (r) => r.targets.map((q) => q.key);
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('only the tabs that show are targets; the right arrow is one', () => {
    const r = frames(60);
    assert.ok(keys(r).indexOf('p96tab0') >= 0);
    assert.ok(keys(r).indexOf('p96tab8') < 0, 'Compare is out of the bar, yet a target');
    assert.ok(keys(r).indexOf('p96tabsr') >= 0);
    assert.ok(keys(r).indexOf('p96tabsl') < 0);
    r.targets.forEach((q) => { if (/^p96tab\d/.test(q.key)) assert.ok(q.x + q.w <= 1170 && q.x >= 270, q.key + ' outside the bar'); });
});

test('the right arrow brings the last tabs in, the left one back', () => {
    let r = frames(60);
    for (let k = 0; k < 3 && keys(r).indexOf('p96tab8') < 0; k++) { r.targets.filter((q) => q.key === 'p96tabsr')[0].run(); r = frames(60); }
    assert.ok(keys(r).indexOf('p96tab8') >= 0, 'Compare never came in');
    assert.strictEqual(sel, 0, 'an arrow changed the page');
    r.targets.filter((q) => q.key === 'p96tab8')[0].run();
    assert.strictEqual(sel, 8);
    r = frames(60);
    for (let k = 0; k < 3 && keys(r).indexOf('p96tab0') < 0; k++) { r.targets.filter((q) => q.key === 'p96tabsl')[0].run(); r = frames(60); }
    assert.ok(keys(r).indexOf('p96tab0') >= 0, 'Now never came back');
});

test('a new selection glides into view, wherever the bar was moved by hand', () => {
    sel = 0;
    let r = frames(60);
    r.targets.filter((q) => q.key === 'p96tabsr')[0].run();
    frames(60);
    sel = 0; frames(1);
    sel = 7;                       // the knob, or the kit's header tab, picked Log
    r = frames(60);
    assert.ok(keys(r).indexOf('p96tab7') >= 0, 'the selected tab is not in view');
});

test('a finger swipe moves the bar; a tap without moving presses the tab under it', () => {
    sel = 0;
    let r = frames(60);
    const y = 50, x = 1000;
    assert.ok(UI.tabTouch(1, x, y, r.targets), 'the bar did not take the swipe');
    for (let dx = 0; dx <= 600; dx += 60) { UI.tabTouch(2, x - dx, y, r.targets); frames(1); }
    UI.tabTouch(3, x - 600, y, r.targets);
    r = frames(60);
    assert.ok(keys(r).indexOf('p96tab8') >= 0, 'the swipe did not bring Compare in');
    assert.strictEqual(sel, 0, 'a swipe changed the page');
    const t = r.targets.filter((q) => q.key === 'p96tab8')[0];
    assert.ok(UI.tabTouch(1, t.x + 10, t.y + 10, r.targets));
    UI.tabTouch(3, t.x + 12, t.y + 10, r.targets);
    assert.strictEqual(sel, 8, 'a tap on the bar did not press its tab');
    assert.ok(!UI.tabTouch(1, 800, 300, r.targets), 'a touch below the bar was taken');
});

test('a button on a card is pressed before the card (the kit presses the first target under a finger)', () => {
    const run = () => {};
    const t = [{ key: 'tab', x: 300, y: 20, w: 90, h: 44, run }, { key: 'card', x: 28, y: 112, w: 560, h: 392, run }, { key: 'OPEN', x: 178, y: 408, w: 120, h: 44, run },
        { key: 'help', x: 1432, y: 20, w: 60, h: 60, run }];
    const first = (a, x, y) => a.filter((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h)[0].key;
    assert.strictEqual(first(t, 238, 430), 'card');             // as the app records them
    const o = UI.pressOrder(t.slice());
    assert.strictEqual(first(o, 238, 430), 'OPEN');
    assert.strictEqual(first(o, 100, 200), 'card');
    assert.deepStrictEqual(o.map((q) => q.key), ['tab', 'OPEN', 'help', 'card'], 'the rest keeps its order');
});

(async function () {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
    }
    console.log(tests.length + ' tests, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
