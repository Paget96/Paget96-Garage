// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Lights' pages on demo values, as PNGs in docs/media/p96_lights (or the folder named): node tools/lights_shots.js [out]
 * With tools/carframe.js preloaded (node -r ./tools/carframe.js) they come in the car's full screen frame.
 */
const fs = require('fs');
const path = require('path');
const RT = path.join(__dirname, '..', 'kit', 'runtime');
const { Recorder, play } = require(path.join(RT, 'record'));
const { Canvas } = require(path.join(RT, 'canvas'));
const UI = require('../lib/ui');
const P = require('../apps/p96_lights/pages');
const PR = require('../apps/p96_lights/presets');

const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'media', 'p96_lights');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
const st = { page: 'main', tab: 0, topic: 0, settings: Object.assign({}, P.DEFAULTS, { demo: 'on' }), status: 'SIMULATED', statusColor: 'warm', demo: true, now: Date.now() };
const act = new Proxy({}, { get: () => () => {} });
const v = { armed: false, moving: false, presets: PR.DEFAULTS, preset: 0, beat: 13, flash: { pattern: 'both', rate: 'normal' },
    ambient: { scene: { kind: 'solid', upper: { rgb: P.COLOURS[5][1], bright: 80 }, lower: { rgb: P.COLOURS[5][1], bright: 80 } } }, lamps: { running: null } };
function shot(name, set, t) {
    Object.assign(st, { page: 'main' }, set);
    if (global.CF) global.CF.tabs = () => [P.TABS, st.tab, st.page];
    const rec = new Recorder(UI.W, UI.H);
    P.draw(rec, v, st, t || 0, act);
    const cv = new Canvas(UI.W, UI.H);
    play(rec.words(), cv);
    fs.writeFileSync(path.join(out, name + '.png'), cv.png(9));
}
shot('ambient', { tab: 0 }); shot('party', { tab: 1 }, 0.25); shot('flash', { tab: 2 }, 0.35);
shot('help', { page: 'help', topic: 1 }, 1); shot('settings', { page: 'settings' });
// the GIF: Party playing Welcome, then Ambient breathing
const fr = path.join(out, '..', '..', '..', '.stage', 'lights-frames');
if (!fs.existsSync(fr)) fs.mkdirSync(fr, { recursive: true });
fs.readdirSync(fr).forEach((f) => fs.unlinkSync(path.join(fr, f)));
for (let i = 0; i < 64; i++) {
    const t = i * 0.08, gif = i < 40;
    v.beat = Math.floor(t * 1000 / 250) % PR.BEATS;
    v.ambient.scene.kind = 'breathing';
    Object.assign(st, { page: 'main', tab: gif ? 1 : 0 });
    if (global.CF) global.CF.tabs = () => [P.TABS, st.tab, st.page];
    const rec = new Recorder(UI.W, UI.H);
    P.draw(rec, v, st, t, act);
    const cv = new Canvas(UI.W, UI.H);
    play(rec.words(), cv);
    fs.writeFileSync(path.join(fr, ('000' + i).slice(-4) + '.png'), cv.png(1));
}
console.log('5 pictures in ' + out + ', GIF frames in ' + fr);
