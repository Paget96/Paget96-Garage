// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';

// lib/ui.js motion for every app: the live charts' fixed time axis and steady value axis (owner, 2026-11-26 20:16,
// "dok se ovi grafikoni ne napune skacu stalno") and the gas and turbo phases that follow rpm (20:17, "trokira").
// Plain functions on a clock of the test's own, no canvas:
//   node tests/ui_motion.test.js

const assert = require('assert');
const path = require('path');
const UI = require(path.join(__dirname, '..', 'lib', 'ui'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const FRAME = 1000 / 60;

/** A sample a second for `secs`, drawn at 60 fps: calls frame(now, vals) every frame with the samples so far. */
function drive(secs, valueAt, frame) {
    const vals = [];
    let next = 0;
    for (let now = 0; now <= secs * 1000; now += FRAME) {
        while (next <= now) { vals.push(valueAt(next / 1000)); if (vals.length > 60) vals.shift(); next += 1000; }
        frame(now, vals);
    }
}
const mm = (v) => [Math.min.apply(null, v), Math.max.apply(null, v)];

test('the value range starts round around the first values, never narrower than minSpan', () => {
    const r = UI.liveRange({}, 25, 25, { minSpan: 6, n: 2, hold: true }, 0);
    assert(r.thi - r.tlo >= 6, 'span ' + (r.thi - r.tlo));
    assert(r.tlo <= 25 && r.thi >= 25);
    assert.strictEqual(r.lo, r.tlo); assert.strictEqual(r.hi, r.thi);           // no glide on the first frame
    const p = UI.liveRange({}, 1003, 1003.4, { minSpan: 10, n: 2, hold: true }, 0);
    assert(p.thi - p.tlo >= 10 && p.tlo <= 1003 && p.thi >= 1003.4);
});

test('a filling chart: the range never shrinks within 60 s, glides at most its smoothstep per frame, labels change rarely', () => {
    const s = {};
    let prev = null, last = null, changes = 0, changedAt = 0, maxStepRatio = 0;
    // intake air warming: a wobble of 0.4 and a rise of 7 degrees over the minute
    drive(60, (t) => 24 + 7 * Math.max(0, t - 20) / 40 + 0.4 * Math.sin(t * 3), (now, vals) => {
        const d = mm(vals), r = UI.liveRange(s, d[0], d[1], { minSpan: 6, n: 2, hold: true }, now);
        assert(r.tlo <= d[0] + 1e-9 && r.thi >= d[1] - 1e-9, 'the data is inside the target range');
        if (prev) {
            if (r.tlo !== prev.tlo || r.thi !== prev.thi) {
                changes++; changedAt = now;
                assert(r.tlo <= prev.tlo + 1e-9 && r.thi >= prev.thi - 1e-9, 'shrank at ' + now + ' ms');
                last = { from: { lo: prev.lo, hi: prev.hi }, to: { lo: r.tlo, hi: r.thi } };
            }
            if (last) {
                const span = Math.max(Math.abs(last.to.lo - last.from.lo), Math.abs(last.to.hi - last.from.hi));
                const step = Math.max(Math.abs(r.lo - prev.lo), Math.abs(r.hi - prev.hi));
                if (span > 0) maxStepRatio = Math.max(maxStepRatio, step / span);
            }
        }
        prev = r;
    });
    // smoothstep peaks at a slope of 1.5: per 16.7 ms frame of a 300 ms glide at most 1.5 * 16.7 / 300 of the change
    assert(maxStepRatio <= 1.5 * FRAME / 300 + 1e-6, 'step ratio ' + maxStepRatio);
    assert(changes >= 1 && changes <= 4, 'range changes ' + changes);
    assert(changedAt > 0);
});

test('after a minute without a change a held range fits the data again, gliding', () => {
    const s = {};
    UI.liveRange(s, 20, 40, { minSpan: 6, n: 2, hold: true }, 0);
    let r;
    for (let now = 500; now <= 59000; now += 500) r = UI.liveRange(s, 29, 30, { minSpan: 6, n: 2, hold: true }, now);
    assert(r.thi - r.tlo >= 20, 'still held at 59 s');
    r = UI.liveRange(s, 29, 30, { minSpan: 6, n: 2, hold: true }, 60100);
    assert(r.thi - r.tlo < 20, 'fits again after 60 s: ' + r.tlo + '..' + r.thi);
    assert(r.hi - r.lo > r.thi - r.tlo, 'and glides there');
    r = UI.liveRange(s, 29, 30, { minSpan: 6, n: 2, hold: true }, 60500);
    assert(Math.abs(r.hi - r.lo - (r.thi - r.tlo)) < 1e-9, 'arrived after 300 ms');
});

test('a tiny wobble stays small: 0.2 degrees on a 6 degree minimum span', () => {
    const s = {};
    let r;
    drive(30, (t) => 25 + 0.1 * Math.sin(t), (now, vals) => { const d = mm(vals); r = UI.liveRange(s, d[0], d[1], { minSpan: 6, n: 2, hold: true }, now); });
    assert(0.2 / (r.thi - r.tlo) < 0.05, 'wobble share ' + 0.2 / (r.thi - r.tlo));
});

test('fixed time axis: 5 s of data sit at the right end, a sample keeps its place as more arrive', () => {
    const x = 100, w = 590, S = 60, dx = w / (S - 1);
    assert.strictEqual(UI.slotX(4, 5, x, w, S, 0), x + w);                          // newest at now
    assert(Math.abs(UI.slotX(0, 5, x, w, S, 0) - (x + w - 4 * dx)) < 1e-9);         // the oldest 4 s left of now
    // the same sample one sample later: one step left, whatever n is
    assert(Math.abs(UI.slotX(0, 6, x, w, S, 0) - (UI.slotX(0, 5, x, w, S, 0) - dx)) < 1e-9);
});

test('the head runs on with the clock: the line moves left continuously, never steps', () => {
    const s = {}, x = 0, w = 590, S = 60;
    let prevX = null, maxMove = 0, minMove = Infinity, seq = 10;
    for (let now = 0; now < 10000; now += FRAME) {
        const want = 10 + Math.floor(now / 1000);
        if (want !== seq) seq = want;
        const head = UI.liveHead(s, seq, now, 1000), lag = head - seq;
        assert(lag >= -1 - 1e-9 && lag <= 1e-9, 'lag ' + lag);
        // follow the sample with number 10: index n - 1 - (seq - 10) of n
        const n = 30, i = n - 1 - (seq - 10), px = UI.slotX(i, n, x, w, S, lag);
        if (prevX != null && now > 1100) { const mv = prevX - px; maxMove = Math.max(maxMove, mv); minMove = Math.min(minMove, mv); }
        prevX = px;
    }
    const perFrame = w / (S - 1) * FRAME / 1000;
    assert(minMove >= -1e-9, 'moved right ' + minMove);
    assert(maxMove <= perFrame * 1.2, 'moved ' + maxMove + ' px in a frame (steady ' + perFrame + ')');
});

test('the head measures the sample interval when it is not given', () => {
    const s = {};
    let seq = 0;
    for (let now = 0; now < 30000; now += FRAME) { seq = Math.floor(now / 5000); UI.liveHead(s, seq, now); }
    assert(Math.abs(s.every - 5000) < 100, 'every ' + s.every);
});

test('rpm sets the gas and turbo speed: slow at idle, a gentle curve, capped', () => {
    const idle = UI.flowRate(700), mid = UI.flowRate(2500), top = UI.flowRate(6500), over = UI.flowRate(9000);
    assert(idle < mid && mid < top, [idle, mid, top].join(' '));
    assert.strictEqual(over, top, 'capped');
    assert.strictEqual(UI.flowRate(null), idle, 'no rpm: idle speed');
    assert(mid - idle > top - mid - 0.05, 'the curve: more change low down');
    assert(UI.turboRate(700) < UI.turboRate(3000) && UI.turboRate(3000) < UI.turboRate(3000, 1.2), 'boost adds');
    assert(UI.turboRate(9000, 3) <= 2.4 * 1.4 + 1e-9, 'capped');
});

test('a new rpm changes the speed over 300 ms and never moves the dots', () => {
    const s = {};
    let prev = null, maxDelta = 0;
    for (let now = 0; now < 4000; now += FRAME) {
        // the car sends a new rpm 4 times a second, hunting around idle and then a blip to 4000
        const rpm = now < 2000 ? 700 + 100 * Math.sin(Math.floor(now / 250)) : 4000;
        const p = UI.phaseStep(s, UI.flowRate(rpm), now);
        if (prev != null) maxDelta = Math.max(maxDelta, p - prev);
        assert(prev == null || p >= prev, 'went back');
        prev = p;
    }
    assert(maxDelta <= UI.flowRate(4000) * FRAME / 1000 + 1e-9, 'a frame moved ' + maxDelta);
    // the rate eases: 150 ms after a change it is between the old and the new
    const t = {};
    UI.phaseStep(t, 0.1, 0); UI.phaseStep(t, 0.1, 1000); UI.phaseStep(t, 0.3, 1000);
    const a = UI.phaseStep(t, 0.3, 1150), b = UI.phaseStep(t, 0.3, 1150 + FRAME);
    const rate = (b - a) / FRAME * 1000;
    assert(rate > 0.12 && rate < 0.28, 'rate halfway ' + rate);
});

let failed = 0;
tests.forEach(([name, fn]) => {
    try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
});
console.log(failed ? failed + ' of ' + tests.length + ' failed' : 'all ' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
