// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Lights' pages: pure drawing from the values, so the same code draws the head unit and the screenshots.
 *
 *   draw(cv, v, st, t, act)
 *     v:   { armed, moving (true, false or null: no speed yet), ambient: { state, n, scene }, lamps: { kind, running,
 *          note }, presets, preset, beat (the beat the preview shows), flash: { pattern, rate } }
 *     st:  { page: 'main' | 'help' | 'settings', tab, topic, settings, status, statusColor, demo, now }
 *     act: { tab(i), help(), settings(), back(), topic(i), set(k, v), colour(rgb), effect(kind), bright(d), carOwn(),
 *            pick(i), play(), stop(), flashPattern(p), flashRate(r), flash(), demoOff() }
 *
 * Everything that switches a light goes through the gate in main.js: armed in Settings, the car standing still for
 * the sequences and the flashes. Until it is armed the pages show what would happen on the drawing only.
 */
function ui() {
    try { return require('./garage_ui'); }
    catch (e) { return require('../../lib/ui'); }
}
const UI = ui();
const E = (function () { try { return require('./garage_engine'); } catch (e) { return require('../../lib/engine'); } })();
const PR = require('./presets');
const PF = require('./profiles');
const CVW = require('./carview');
const { drawCarView, MAX_PITCH, MAX_ROLL } = require('./carview');
const LIN = require('./lin');
const C = UI.C, T = UI.CONTENT_TOP, L = UI.MARGIN, R = UI.W - UI.MARGIN;
const lit = { literal: true };
const TITLE = 'LIGHTS';
const TABS = ['Ambient', 'Shows', 'Outside'];

const APP_ROWS = [
    { key: 'doorRed', label: 'Open door red', hint: 'The lights on an open door blink red, as the car\'s own warning does', type: 'choice', default: 'on',
        options: [['on', 'On'], ['off', 'Off']] },
    { key: 'arm', label: 'Light control', hint: 'Simulated: shown on the drawing only, nothing is sent to the car', type: 'choice', default: 'off',
        options: [['off', 'Simulated'], ['on', 'Armed']] },
];

/*
 * The cabin's regions (owner, 2026-11-27 00:38: door pockets, doors, roof, rear doors, under ...): every ambient light
 * the body controller has belongs to one, by its name (lin.js); a region shows only when this car has a light in it.
 */
const REGIONS = [
    ['dash', 'Dash', /^Dash/], ['frontDoors', 'Front doors', /front door (line|decor)|door backlit decor/], ['rearDoors', 'Rear doors', /rear door (line|decor)/],
    ['pockets', 'Door pockets', /pocket/], ['handles', 'Door handles', /handle/], ['console', 'Console', /Console|Centre stack|Gear selector|Cupholder/],
    ['seats', 'Seat backs', /seat back/], ['roof', 'Roof', /Sunroof|Roof/], ['pillars', 'B-pillars', /B-pillar/], ['blades', 'Light blades', /Light blade/],
];
function regionOf(light) { const n = (light && light.name) || ''; const r = REGIONS.filter((q) => q[2].test(n))[0]; return r ? r[0] : 'other'; }
/** The regions this car has: [[key, label]], All first. lights: the body controller's list (none yet: All only). */
function regionsOf(lights) {
    const have = new Set((lights || []).map(regionOf));
    return [['all', 'All']].concat(REGIONS.filter((r) => have.has(r[0])).map((r) => [r[0], r[1]]));
}

const COLOURS = [['Red', [255, 30, 20]], ['Orange', [255, 110, 0]], ['Amber', [255, 170, 30]], ['White', [255, 245, 230]],
    ['Ice', [120, 200, 255]], ['Blue', [30, 80, 255]], ['Purple', [150, 40, 255]], ['Green', [40, 220, 90]]];
const EFFECTS = [['solid', 'Solid'], ['breathing', 'Breathe'], ['rainbow', 'Rainbow'], ['wave', 'Wave']];

/* ---------- the info popups (the (i) on every card, as in the other apps) ---------- */

const INFO = {
    ambient: { label: 'Ambient light', title: 'Any colour on the ambient light', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), null, hsv((t * 40) % 360).concat([150])),
        text: 'The ambient lights hang on two light buses of the body controller. Lights writes a colour to every light of a bus at once, then single lights that differ: about five writes a second.\n\nThe car\'s own colour gives every light back to the car, as do Stop all and leaving the app.',
        note: 'In the car now: what the car\'s own Ambient light menu is set to, read from the car (the number is the car\'s colour slot).' },
    party: { label: 'Party', title: 'Light sequences over the car\'s own lamps', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), PR.lit(PR.DEFAULTS[0], Math.floor(t * 4) % PR.BEATS), null),
        text: 'Each beat switches its lamps on for 30 to 150 ms; the body controller switches every one off again by itself. So a lamp is never left on, even if the app stops in the middle.\n\nThe cabin\'s colour row lays a colour over every ambient light on its beats. Flash or Smooth sets whether a beat flashes or fades into the next; on the car only the ambient really fades, the outside lamps switch on and off.\n\nA run stops by itself after 30 s, when the car moves, when you leave the app, or with Stop all.' },
    edit: { label: 'Edit a show', title: 'Beat by beat', draw: null,
        text: 'A row per lamp and one for the cabin\'s colour; tap a beat to switch that lamp on in it, tap the colour row to step through the colours. Beat sets how long each beat lasts: 150 ms is the fastest the car allows. Smooth fades each beat into the next instead of flashing it: the cabin\'s ambient fades on the car too, the outside lamps there only switch on and off (the body controller gives them no brightness), so on the car they still step.\n\nThe ready made shows stay as they are; Copy and edit makes one of yours from any of them.' },
    flash: { label: 'Flash', title: 'High beam flashes', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), new Set(Math.floor(t * 3) % 2 ? ['high'] : []), null),
        text: 'The car\'s own high beam, each flash under 150 ms and switched off by the car itself. For a show on private ground, never on a public road. Stops after 30 s, when the car moves, or with Stop all.' },
    live: { label: 'Lamps now', title: 'Which output is lit, and how bright', draw: null,
        text: 'Read live from the headlight units and the body controller every second or so, reads only: each LED channel of the headlights with its brightness in % (PWM), and the body controller\'s lamp outputs that are on.\n\nSwitch the lights with the car\'s own switch and watch which one changes.' },
    outside: { label: 'Outside lights', title: 'The car\'s own light settings', draw: null,
        text: 'These are settings in the body controller\'s coding, not something the app switches for a moment: both rear fog lights (one is the European rule), how often the indicator flashes on a tap, the lights fully off, and the rear lights with the daytime lights.\n\nLights reads them from your car first. Writing them comes after that, each with a full backup of the coding, a read back and a one-tap undo.' },
};

/* ---------- the car with its lamps ---------- */

// where each light function sits on UI.carTop's G20 (front up, its units: half width 75, length -152 to 153)
const LAMPS = {
    high: [[-46, -146], [46, -146]], fog: [[-52, -150], [52, -150]], cornL: [[-62, -138]], cornR: [[62, -138]],
    indL: [[-68, -126], [-64, 138]], indR: [[68, -126], [64, 138]], parkL: [[-34, -149], [-50, 146]], parkR: [[34, -149], [50, 146]],
    brake: [[-40, 150], [40, 150]], reverse: [[-16, 152]], rearFog: [[16, 152]],
};
const LAMP_COL = { high: [255, 255, 240], fog: [255, 250, 220], cornL: [255, 250, 220], cornR: [255, 250, 220], indL: [255, 160, 20], indR: [255, 160, 20],
    parkL: [255, 245, 230], parkR: [255, 245, 230], brake: [255, 30, 20], reverse: [255, 255, 255], rearFog: [255, 40, 30] };

/** The car from above, the functions in on set lit with a glow; cabin: an ambient colour over the cabin ([r, g, b, a]). */
function carLamps(cv, cx, cy, k, on, cabin) {
    UI.carTop(cv, cx, cy, k);
    if (cabin) cv.roundRect(cx - 46 * 0.84 * k, cy - 60 * k, 92 * 0.84 * k, 140 * k, 20 * k, cabin);
    const kx = k * 0.84;
    Object.keys(LAMPS).forEach((fn) => LAMPS[fn].forEach((q) => {
        const x = cx + q[0] * kx, y = cy + q[1] * k, c = LAMP_COL[fn];
        if (on && on.has(fn)) {
            cv.circle(x, y, 16 * k, [c[0], c[1], c[2], 60]);
            cv.circle(x, y, 7 * k, [c[0], c[1], c[2], 255]);
        } else cv.circle(x, y, 4 * k, '#3a3f48');
    }));
}

/* ---------- the gate, said in words ---------- */

/**
 * Stop all: on every page while anything of ours runs (owner, 2026-11-27 00:37: a safeguard if the app hangs mid-show).
 * It stops the sequence or the flashes and gives the ambient light back to the car.
 */
function stopAll(cv, v, x, y, act) {
    const busy = (v.lamps && v.lamps.running) || (v.ambient && v.ambient.ours);
    if (!busy) return 0;
    const w = 170;
    cv.roundRect(x - w, y, w, 48, 24, C.red);
    cv.text('Stop all', x - w / 2, y + 31, 19, C.text, { font: 'bold', align: 'center', literal: true });
    if (cv.target) cv.target(x - w, y, w, 48, act.stopAll, 'lstopall', 24);
    return w;
}

function gateLine(v, what) {
    if (!v.armed) return ['Simulated: shown on the drawing only. Arm it in Settings.', C.amber];
    if (what !== 'ambient' && v.moving !== false) return [v.moving ? 'Only while the car stands still.' : 'Waiting for the car\'s speed: stand still with the engine on.', C.amber];
    if (v.lamps && v.lamps.note) return [v.lamps.note, C.dim];
    return [what === 'ambient' ? 'Armed: the colour goes to the car.' : 'Armed: the car\'s own lights, only while parked.', C.green];
}

/* ---------- Ambient ---------- */

/** The controller's way to turn the car: round either way, leaning back, straight above (each held 10 s). */
function turnButtons(cv, act) {
    [['<', -1, 0], ['>', 1, 0], ['tilt', 0, 1], ['top', 0, -1]].forEach((b, i) => {
        const bx = L + 24 + i * 58, by = T + UI.hh() - 104, w = b[0].length > 1 ? 52 : 44;
        cv.roundRect(bx, by, w, 40, 20, '#2a2d34');
        cv.text(b[0], bx + w / 2, by + 26, b[0].length > 1 ? 13 : 20, C.accent, { font: 'bold', align: 'center', literal: true });
        if (cv.target) cv.target(bx - 4, by - 6, w + 8, 52, () => act.turn(b[1], b[2]), 'lturn|' + i, 20);
    });
    cv.text('Drag with a finger to turn it', L + UI.pw(640) - 24, T + UI.hh() - 78, 13, C.dim, { align: 'right', literal: true });
}

/** Where the turnable car is drawn on the Ambient page (main.js takes a finger there). */
function viewBox() { return { x: L + 70, y: T + 66, w: 640 - 140, h: UI.hh() - 176 }; }

function pageAmbient(cv, v, st, t, act) {
    const lw = UI.pw(640), s = (v.ambient && v.ambient.scene) || {}, up = s.upper || { rgb: COLOURS[4][1], bright: 70 };
    UI.card(cv, L, T, lw, UI.hh(), 'Ambient light', { info: INFO.ambient });
    // the cabin seen through, every ambient light at its place in the colour it shows, turnable (owner, 2026-11-27
    // 00:40: rotate the car and see where which colour is): the car's own lights when it listed them, else BMW's set
    const glow = s.kind === 'breathing' ? 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(t * 1.6)) : 1;
    const shown = v.ambient && v.ambient.lights && v.ambient.lights.length ? v.ambient.lights : LIN.sample();
    const rc = v.regionColours || {};
    const colourOf = (light) => {
        const own = rc[regionOf(light)];
        if (own) return { rgb: own.rgb, bright: own.bright };
        if (s.own) return null;
        const rgb = s.kind === 'rainbow' || s.kind === 'wave' ? hsv((t * 40 + (light.y || 0) * 120) % 360) : up.rgb;
        return { rgb: rgb, bright: Math.round(up.bright * glow) };
    };
    const view = v.view || { pitch: 0, roll: 0 };
    drawCarView(cv, t, viewBox(), shown, colourOf, view);
    turnButtons(cv, act);
    // that it turns by finger (owner, 2026-11-27 00:48), right of the buttons
    const g = gateLine(v, 'ambient');
    cv.text(g[0], L + 20, T + UI.hh() - 16, 14, g[1], lit);
    // what the car's own menu says now, and which lights the body controller has (read from the car)
    const carSet = v.carAmbient != null ? 'In the car now: colour ' + v.carAmbient : null, found = v.ambient && v.ambient.n ? v.ambient.n + ' lights found' : null;
    if (carSet || found) cv.text([carSet, found].filter(Boolean).join('   .   '), L + 20, T + 58, 15, C.dim, lit);
    stopAll(cv, v, L + lw - 20, T + UI.hh() - 74, act);
    const x = L + lw + 14, w = R - x;
    UI.card(cv, x, T, w, UI.hh(), 'Colour', { info: INFO.ambient });
    // the regions this car has, as chips: a colour goes to the one picked (All: the whole cabin)
    const regs = regionsOf(v.ambient && v.ambient.lights), reg = v.region || 'all';
    // as many rows as the chips need (a car with every region takes two)
    let cx0 = x + 20, cy0 = T + 46;
    regs.forEach((r) => {
        const ww = Math.ceil(cv.textWidth(r[1], 14, { font: 'bold' })) + 26, on = r[0] === reg;
        if (cx0 + ww > x + w - 20) { cx0 = x + 20; cy0 += 38; }
        cv.roundRect(cx0, cy0, ww, 30, 15, on ? C.accent : '#2a2d34');
        cv.text(r[1], cx0 + ww / 2, cy0 + 20, 14, on ? C.dark : C.dim, { font: 'bold', align: 'center', literal: true });
        if (cv.target) cv.target(cx0, cy0 - 6, ww, 42, () => act.region(r[0]), 'lreg|' + r[0], 15);
        cx0 += ww + 8;
    });
    const gy = cy0 + 46;
    if (regs.length === 1) cv.text(v.armed ? 'Regions appear once the body controller has listed its lights' : 'Regions: listed from the car once armed', x + w - 20, cy0 + 20, 13, C.dim, { align: 'right', literal: true });
    const cols = 4, gap = 14, sw = Math.floor((w - 40 - gap * (cols - 1)) / cols);
    // the swatches give up height when the chips take two rows, so Effect, Brightness and the button keep clear of each other
    const sh = Math.max(36, Math.min(56, Math.floor((T + UI.hh() - 74 - 74 - 14 - 2 * gap - gy) / 2)));
    COLOURS.forEach((c, i) => {
        const cx = x + 20 + (i % cols) * (sw + gap), cy = gy + Math.floor(i / cols) * (sh + gap), sel = !s.own && same(((v.regionColours || {})[reg] || up).rgb || up.rgb, c[1]);
        cv.roundRect(cx, cy, sw, sh, 18, [c[1][0], c[1][1], c[1][2], 230]);
        if (sel) cv.strokeRoundRect(cx - 3, cy - 3, sw + 6, sh + 6, 20, 3, C.text);
        cv.text(c[0], cx + sw / 2, cy + sh / 2 + 6, 16, [20, 20, 24], { font: 'bold', align: 'center', literal: true });
        if (cv.target) cv.target(cx, cy, sw, sh, () => act.colour(c[1]), 'lcol|' + i, 18);
    });
    const ry = gy + 2 * (sh + gap) + 14;
    cv.text('Effect', x + 20, ry + 6, 16, C.dim, lit);
    UI.segmented(cv, x + w - 20, ry, EFFECTS, s.kind || 'solid', act.effect, 'leffect');
    cv.text('Brightness', x + 20, ry + 54, 16, C.dim, lit);
    UI.stepper(cv, x + w - 20, ry + 48, up.bright, { unit: '%', decimals: 0, key: 'lbright', onMinus: () => act.bright(-10), onPlus: () => act.bright(10) });
    UI.button(cv, x + 20, T + UI.hh() - 64, 'The car\'s own colour', act.carOwn, { key: 'lown', filled: !!s.own });
}

/* ---------- Party ---------- */

function pageParty(cv, v, st, t, act) {
    const list = v.presets || PF.READY, p = list[v.preset || 0] || list[0] || PF.READY[0];
    if (v.edit && p && !p.ready) return partyEditor(cv, v, p, act);
    const lw = UI.pw(640);
    UI.card(cv, L, T, lw, UI.hh(), p.name, { info: p.kind === 'flash' ? INFO.flash : INFO.party });
    // the whole car turning like the cabin on Ambient, its lamps lit on this beat and the cabin in the beat's colour
    // this moment of the show: flashing, each beat's lamps full on; smooth, each beat fading into the next
    const smooth = v.smoothOf ? v.smoothOf(p) : false, now = PF.at(p, v.beatF != null ? v.beatF : v.beat || 0, smooth), on = {};
    Object.keys(now.lamps).forEach((fn) => { on[fn] = (LAMP_COL[fn] || [255, 255, 240]).concat([now.lamps[fn]]); });
    const amb = now.amb, ambB = Math.round(100 * now.ambLevel);
    const cabinLights = v.ambient && v.ambient.lights && v.ambient.lights.length ? v.ambient.lights : LIN.sample();
    if (p.kind === 'flow') {
        // the wave between beats too, so it glides: the lamps and the cabin in the ambient's own colour
        const w = PF.flowW(v.beatF != null ? v.beatF : v.beat || 0), rgb = (v.ambient && v.ambient.scene && v.ambient.scene.upper && v.ambient.scene.upper.rgb) || [120, 200, 255];
        drawCarView(cv, t, viewBox(), cabinLights, (l) => { const b = Math.round(100 * CVW.flowAt(CVW.lightU(l), w)); return b < 5 ? null : { rgb: rgb, bright: b }; },
            Object.assign({}, v.view || { pitch: 0, roll: 0 }, { exterior: true, flow: w, lampCol: LAMP_COL }));
    } else drawCarView(cv, t, viewBox(), cabinLights, () => (amb && ambB >= 5 ? { rgb: amb, bright: ambB } : null), Object.assign({}, v.view || { pitch: 0, roll: 0 }, { exterior: true, lamps: on }));
    turnButtons(cv, act);
    // the beats under the car: the one playing now lit
    const bw = (lw - 40) / PF.BEATS;
    for (let i = 0; i < PF.BEATS; i++) cv.roundRect(L + 20 + i * bw + 2, T + UI.hh() - 46, bw - 4, 8, 4, i === (v.beat || 0) ? C.accent : p.beats[i].length || PF.ambAt(p, i) ? '#4a4f58' : '#2a2d34');
    const g = gateLine(v, 'sequence');
    cv.text(g[0], L + 20, T + UI.hh() - 16, 14, g[1], lit);
    stopAll(cv, v, L + lw - 20, T + 52, act);
    // right: the shows, ready made or yours, in two columns; a ready one is copied into Yours to be edited
    const x = L + lw + 14, w = R - x, mine = v.group === 'Yours';
    UI.card(cv, x, T, w, UI.hh(), 'Light shows', { info: INFO.party });
    UI.segmented(cv, x + w - 20, T + 70, PF.GROUPS.concat([['Yours', 'Yours (' + (v.mineCount || 0) + ')']]), v.group || 'Party', act.group, 'lgroup');
    if (mine && !list.length) cv.text('None yet: pick a ready made show and tap Copy and edit', x + 20, T + 130, 16, C.dim, lit);
    const per = Math.ceil(list.length / 2), cw = (w - 30) / 2, rh = Math.min(48, (UI.hh() - 180) / Math.max(1, per));
    list.forEach((q, i) => {
        const cx = x + 10 + Math.floor(i / per) * (cw + 10), yy = T + 100 + (i % per) * rh, sel = i === (v.preset || 0);
        if (sel) cv.roundRect(cx, yy, cw, rh - 4, 16, '#262a33');
        cv.text(q.name, cx + 16, yy + rh / 2 + 4, 17, sel ? C.text : C.dim, { font: 'bold', literal: true });
        cv.text((v.msOf ? v.msOf(q) : q.beatMs) + ' ms', cx + cw - 16, yy + rh / 2 + 3, 13, C.dim, { align: 'right', literal: true });
        if (cv.target) cv.target(cx, yy, cw, rh - 4, () => act.pick(i), 'lpre|' + (q.id || i), 16);
    });
    // Play, Pause (keeps the beat, Play goes on from it) and Stop; editing while nothing plays
    const running = v.lamps && (v.lamps.running === 'sequence' || v.lamps.running === 'strobe'), paused = v.paused != null, by = T + UI.hh() - 64;
    let bx = x + 20;
    bx += UI.button(cv, bx, by, running || (v.playing && !v.armed) ? 'Pause' : paused ? 'Go on' : 'Play', running || (v.playing && !v.armed) ? act.pause : act.play, { key: 'lplay', filled: true }) + 12;
    if (running || paused || v.playing) bx += UI.button(cv, bx, by, 'Stop', act.stop, { key: 'lstop' }) + 12;
    else if (act.edit) UI.button(cv, bx, by, p.ready ? 'Copy and edit' : 'Edit', act.edit, { key: 'ledit' });
    // how fast it goes: every show, a ready made one too (kept apart, the show stays as it came)
    UI.stepper(cv, x + w - 20, by + 22, v.msOf ? v.msOf(p) : p.beatMs, { unit: 'ms', decimals: 0, key: 'lspd', onMinus: () => act.speed(-1), onPlus: () => act.speed(1) });
    // from beat to beat: a flash, or a fade in and out (the Flow always fades)
    if (p.kind !== 'flow' && p.kind !== 'flash') UI.segmented(cv, x + w - 200, by + 22, [['flash', 'Flash'], ['smooth', 'Smooth']], smooth ? 'smooth' : 'flash', (k) => act.smooth(k === 'smooth'), 'lsmooth');
}

/** A show of yours, beat by beat: a row per light and one for the cabin's colour, tap a beat to switch it. */
function partyEditor(cv, v, p, act) {
    const w = R - L, hh = UI.hh();
    UI.card(cv, L, T, w, hh, 'Edit: ' + p.name, { info: INFO.edit });
    // its speed, and the way out
    const cy = T + 30;
    cv.text('Beat', L + w - 640, cy + 6, 15, C.dim, lit);
    UI.stepper(cv, L + w - 430, cy, p.beatMs, { unit: 'ms', decimals: 0, key: 'lspeed', onMinus: () => act.speed(-1), onPlus: () => act.speed(1) });
    let bx = L + w - 410;
    bx += UI.button(cv, bx, cy - 20, 'Delete', act.remove, { key: 'ldel' }) + 10;
    UI.button(cv, bx, cy - 20, 'Done', act.done, { key: 'ldone', filled: true });
    const rows = PR.LIGHTS.concat([['amb', 'Cabin colour']]);
    const top = T + 64, lab = 170, rh = Math.floor((hh - 76) / rows.length), cw = (w - 40 - lab) / PF.BEATS;
    for (let b = 0; b < PF.BEATS; b++) if (b % 4 === 0) cv.fillRect(Math.round(L + 20 + lab + b * cw), top - 2, 1, rh * rows.length, [255, 255, 255, 30]);
    rows.forEach((r, i) => {
        const y = top + i * rh, amb = r[0] === 'amb';
        cv.text(r[1], L + 24, y + rh / 2 + 5, 14, C.dim, { literal: true });
        for (let b = 0; b < PF.BEATS; b++) {
            const cx = L + 20 + lab + b * cw, on = amb ? PF.ambAt(p, b) : p.beats[b].indexOf(r[0]) >= 0;
            const fill = amb ? (on ? [on[0], on[1], on[2], 230] : '#22252b') : on ? LAMP_COL[r[0]] || C.accent : '#22252b';
            cv.roundRect(cx + 2, y + 2, cw - 4, rh - 4, 6, fill);
            if (b === (v.beat || 0) && v.playing) cv.strokeRoundRect(cx + 1, y + 1, cw - 2, rh - 2, 7, 2, C.text);
            if (cv.target) cv.target(cx, y, cw, rh, () => act.cell(b, r[0]), 'lcell|' + r[0] + '|' + b, 6);
        }
    });
}

/* ---------- Outside: the coding settings ---------- */

const OUTSIDE = [
    { key: 'rearFog', label: 'Rear fog lights', hint: 'One side is the European rule; both is a coding change', options: [['one', 'Left only'], ['both', 'Both']] },
    { key: 'tipBlink', label: 'Indicator on a tap', hint: 'Flashes when the stalk is tapped, not held', options: [['3', '3'], ['5', '5'], ['7', '7'], ['10', '10']] },
    { key: 'lightsOff', label: 'Lights fully off', hint: 'The light switch may switch everything off', options: [['no', 'Not allowed'], ['yes', 'Allowed']] },
    { key: 'drlRear', label: 'Rear lights with the DRL', hint: 'The tail lights on with the daytime lights', options: [['off', 'Off'], ['on', 'On']] },
    { key: 'drlBright', label: 'Daytime light brightness', hint: 'How bright the DRL ring burns, in %', options: [['low', 'Lower'], ['std', 'Standard'], ['high', 'Higher']] },
];

function pageOutside(cv, v, st, t, act) {
    const lw = UI.pw(1000), o = v.outside || {};
    UI.card(cv, L, T, lw, UI.hh(), 'Outside lights: the car\'s own settings', { info: INFO.outside });
    const rh = Math.min(64, (UI.hh() - 120) / OUTSIDE.length);
    OUTSIDE.forEach((r, i) => {
        const y = T + 56 + i * rh, cur = o[r.key];
        if (i) cv.fillRect(L + 20, Math.round(y - 4), lw - 40, 1, [255, 255, 255, 24]);
        const mid = y - 4 + rh / 2;                                     // the row's middle: the words and the choice centred on it
        cv.text(r.label, L + 24, mid - 3, 19, C.text, { font: 'bold', literal: true });
        cv.text(cur == null ? r.hint : 'the car now: ' + cur, L + 24, mid + 17, 14, cur == null ? C.dim : C.green, lit);
        // a choice is kept, not sent: writing waits for the read of this car's coding (T34 step 3)
        UI.segmented(cv, L + lw - 24, mid, r.options, (v.outsideWant || {})[r.key] || null, (val) => act.outside(r.key, val), 'lout|' + r.key);
    });
    UI.wrap(cv, 'A choice is kept here and not sent yet: writing needs this car\'s coding read first, then every change gets a full backup, a read back and a one-tap undo.', 15, lw - 40)
        .forEach((ln, i) => cv.text(ln, L + 20, T + UI.hh() - 34 + i * 20, 15, C.amber, lit));
    // right: the lamp outputs as the car drives them now, read live, so a change made with the car's own switch
    // shows which output and how bright (owner, 2026-11-27 00:37)
    const x = L + lw + 14, w = R - x, live = v.live || {};
    UI.card(cv, x, T, w, UI.hh(), 'Lamps now', { info: INFO.live });
    const rows = (live.rows || []).slice(0, 9);
    if (!live.on) cv.text('Read the lamp outputs live', x + 20, T + 96, 17, C.dim, lit);
    else if (!rows.length) cv.text(live.note || 'Reading...', x + 20, T + 96, 17, C.dim, lit);
    rows.forEach((r, i) => {
        const y = T + 70 + i * 30;
        cv.text(r[0], x + 20, y, 15, C.dim, lit);
        cv.text(r[1], x + w - 20, y, 16, r[2] ? C.green : C.text, { font: 'bold', align: 'right', literal: true });
    });
    UI.button(cv, x + 20, T + UI.hh() - 64, live.on ? 'Stop reading' : 'Read live', act.live, { key: 'llive', filled: !live.on });
}

/* ---------- helpers ---------- */

function same(a, b) { return !!a && !!b && a.every((x, i) => Math.abs(x - b[i]) < 4); }
function hsv(h) {
    const f = (n) => { const kk = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(kk, 4 - kk, 1)))); };
    return [f(5), f(3), f(1)];
}

/* ---------- How to use ---------- */

const TOPICS = [
    { title: 'Ambient light', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), null, [...hsv((t * 40) % 360), 150]),
        text: 'Pick a colour, an effect and how bright: the car\'s ambient lights take it. The car\'s own colour gives every light back to the car.\n\nThe colour goes out over the body controller, about five writes a second, so a moving effect is gentle rather than fast.' },
    { title: 'Party', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), PR.lit(PR.DEFAULTS[0], Math.floor(t * 4) % PR.BEATS), null),
        text: 'Six light sequences over the car\'s own lamps: high beam, cornering, fog, indicators, parking lights, brake, reverse and rear fog. Each beat switches its lamps on for a moment; the car switches them off by itself.\n\nOnly while the car stands still, and only once you arm it in Settings.' },
    { title: 'Flash', draw: (cv, x, y, w, h, t) => carLamps(cv, x + w / 2, y + h / 2, Math.min(1, (h - 40) / 320), new Set(Math.floor(t * 3) % 2 ? ['high'] : []), null),
        text: 'High beam flashes, both or left and right, for a show on private ground. Never on a public road.' },
    { title: 'Simulated until armed', draw: null,
        text: 'Out of the box nothing is sent: the drawing shows what would happen. Settings, Light control, Armed: from then on the app switches the car\'s lights the way a workshop tester does, and gives them back when it stops.' },
    UI.DEMO_TOPIC,
];
const HELP_TOPICS = TOPICS.concat([UI.REPORT_TOPIC]);
const PAGES = [pageAmbient, pageParty, pageOutside];

function head(cv, st, act) {
    UI.background(cv);
    UI.tabs(cv, TABS, st.tab, { onSelect: act.tab });
    UI.title(cv, TITLE, null, null, { clock: false });
    UI.header(cv, { status: st.status, statusColor: st.statusColor, demo: !!st.demo, onDemo: act.demoOff, onHelp: act.help, onSettings: act.settings });
    if (UI.railOn && UI.railOn(cv)) UI.setRailShown(1);
}

function draw(cv, v, st, t, act) {
    if (st.page === 'help') {
        UI.howToUse(cv, HELP_TOPICS, st.topic || 0, t, { title: TITLE, onSelect: act.topic, onBack: act.back, onSettings: act.settings });
    } else if (st.page === 'settings' && st.report && st.report.active()) {
        UI.reportPage(cv, st.report, t, { title: TITLE, onHelp: () => { st.report.close(); act.help(); } });
    } else if (st.page === 'settings') {
        UI.settingsPage(cv, APP_ROWS, st.settings, act.set, { title: TITLE, appLabel: 'Lights', onBack: act.back, onHelp: act.help,
            onReport: st.report ? () => st.report.open() : null, onLog: st.report ? () => st.report.openLog() : null });
    } else {
        head(cv, st, act);
        PAGES[st.tab || 0](cv, v, st, t, act);
    }
    UI.overlay(cv, t);
}

const DEFAULTS = {};
UI.DISPLAY_SETTINGS.concat(APP_ROWS).forEach((r) => { DEFAULTS[r.key] = r.default; });

module.exports = { viewBox, MAX_PITCH, MAX_ROLL, regionOf, regionsOf, REGIONS, draw, TABS, TOPICS, APP_ROWS, PAGES, DEFAULTS, COLOURS, TITLE, carLamps, INFO, OUTSIDE };
