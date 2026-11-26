// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
'use strict';
/**
 * A recorded session of lib/ui.js drawing (a chart, see-through lines, a rounded clip) for p96-renderd's --replay, with
 * the P9 ops (p9) or the kit's own (plain), so the two can be drawn by the real renderer and looked at side by side.
 *   node renderer/test/p9_session.js <out.bin> [p9|plain]
 *   build/host/mgu-render --replay out.bin --out out.pam      (renderer/README.md, Draw without a car)
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const file = process.argv[2], mode = process.argv[3] || 'p9';
const R = require(path.join(ROOT, 'lib', 'render'));
const UI = require(path.join(ROOT, 'lib', 'ui'));
const { RenderClient } = require(path.join(ROOT, 'kit', 'runtime', 'renderd'));
const { Recorder } = require(path.join(ROOT, 'kit', 'runtime', 'record'));

const gpu = new RenderClient('p96_session', { info() {}, warn() {}, error() {} }, { native: true, file });
gpu.on('ready', () => {
    gpu.place({ x: 0, y: 0, w: 800, h: 300, scale: 1, ox: 0, oy: 0 });
    gpu.show(true);
    const r = new Recorder(800, 300);
    r.p96 = mode === 'p9' ? R.CAP.POLY | R.CAP.RCLIP : 0;
    r.clear([10, 12, 16, 255]);
    UI.chart(r, 20, 20, 380, 200, [{ values: [3, 5, 4, 8, 7, 9, 6, 10, 9, 12], color: 'accent' }], { yUnit: 'bar' });
    // a see-through zigzag, thick: the kit's segments overlap at every corner
    const zig = [];
    for (let i = 0; i < 8; i++) zig.push([430 + i * 45, i % 2 ? 60 : 160]);
    r.stroke(zig, 18, [80, 170, 255, 140]);
    // a rounded clip over a striped square
    if (!R.rclip(r, 440, 190, 160, 90, 30)) r.clip(440, 190, 160, 90);
    for (let i = 0; i < 9; i++) r.fillRect(440 + i * 18, 190, 9, 90, '#ff8028');
    r.noclip();
    gpu.frame(r);
    gpu.close();
});
gpu.connect();
