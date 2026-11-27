'use strict';
/**
 * profiles.js - the light shows (owner, 2026-11-27 00:54: profiles like BimmerLight, ready made ones we define and the
 * user's own, each editable, its speed set by the user). A profile is 16 beats; a beat holds the body controller's
 * light functions lit in it (presets.js LIGHTS, the keys strobe.js F knows) and, on its own row, an ambient colour
 * for the cabin (null: the ambient as it is). The ready made ones never change; editing one makes a copy in Yours.
 *
 *   load(file) -> { mine: [profile x <= MINE] }      save(file, store)
 *   READY: [profile]    profile = { id, name, group, beatMs, beats: [[fn, ...] x BEATS], amb: [rgb | null x BEATS], ready }
 *   copy(p, store) -> new profile in store.mine    toggle(p, beat, fn)    ambNext(p, beat)    speed(p, d)
 *   lit(p, beat) -> Set of fn    ambAt(p, beat) -> rgb | null    has(p, fns) -> whether every light it uses is in fns
 */
const fs = require('fs');
const PR = require('./presets');
const CV = require('./carview');

const BEATS = PR.BEATS, MINE = 8;
const MIN_MS = 150, MAX_MS = 1000, STEP_MS = 50;          // the body controller holds a flash at most 150 ms
const AMB = [['Red', [255, 30, 20]], ['Orange', [255, 110, 0]], ['White', [255, 245, 230]], ['Ice', [120, 200, 255]],
    ['Blue', [30, 80, 255]], ['Purple', [150, 40, 255]], ['Green', [40, 220, 90]]];
const ALL = PR.LIGHTS.map((l) => l[0]);
const FRONT = ['high', 'cornL', 'cornR', 'fog', 'parkL', 'parkR'];
const REAR = ['brake', 'reverse', 'rearFog'];
const mk = (f) => Array.from({ length: BEATS }, (_, i) => f(i));
const col = (n) => AMB.filter((a) => a[0] === n)[0][1];

// the ready made shows: the six sequences of presets.js (with a colour beat for the cabin) and the shows after
// BimmerLight's groups (owner's screenshots, 2026-11-27): hazard with every light, the taillight shows, strobes
// the flow: where the wave is on a beat (a little before the nose to a little past the tail), and the lamps it lights
const flowW = (beat) => -0.1 + 1.2 * beat / (BEATS - 1);
const flowBeats = () => mk((i) => ALL.filter((fn) => CV.lampPoints(fn).some((p) => CV.flowAt(CV.flowU(p), flowW(i)) > 0.45)));
const GROUPS = [['Flash', 'Flash'], ['Party', 'Party'], ['Taillight', 'Rear'], ['Strobe', 'Strobe']];
const READY = [
    ...PR.DEFAULTS.map((d, i) => ({ id: 'r' + i, name: d.name, group: 'Party', beatMs: d.beatMs, beats: d.beats.map((b) => b.slice()),
        amb: mk((k) => (i === 0 ? (k % 4 === 0 ? col('White') : null) : i === 5 ? (k % 2 ? null : col('Orange')) : null)) })),
    { id: 'flow', name: 'Flow, front to back', group: 'Party', kind: 'flow', beatMs: 150, beats: flowBeats(), amb: mk(() => null) },
    { id: 'hazAll', name: 'Hazard, every light', group: 'Party', beatMs: 400, beats: mk((i) => (i % 2 ? [] : ALL.slice())), amb: mk((i) => (i % 2 ? null : col('Orange'))) },
    { id: 'disco', name: 'Disco', group: 'Party', beatMs: 250, beats: mk((i) => [['high'], ['parkL', 'parkR'], ['fog'], ['cornL', 'cornR']][i % 4]),
        amb: mk((i) => AMB[i % AMB.length][1]) },
    { id: 'brakePulse', name: 'Brake pulse', group: 'Taillight', beatMs: 200, beats: mk((i) => (i % 4 < 2 && i % 2 === 0 ? ['brake'] : [])), amb: mk(() => null) },
    { id: 'panic', name: 'Panic strobe', group: 'Taillight', beatMs: 150, beats: mk((i) => (i % 2 ? [] : ['brake', 'rearFog'])), amb: mk(() => null) },
    { id: 'cascade', name: 'Rear cascade', group: 'Taillight', beatMs: 200, beats: mk((i) => [['indL'], ['brake'], ['rearFog'], ['reverse'], ['indR'], []][i % 6]), amb: mk(() => null) },
    { id: 'fogFlash', name: 'Fog flash', group: 'Taillight', beatMs: 300, beats: mk((i) => (i % 2 ? ['rearFog'] : ['fog'])), amb: mk(() => null) },
    { id: 'strobe', name: 'Full strobe', group: 'Strobe', beatMs: 150, beats: mk((i) => (i % 2 ? [] : FRONT.concat(REAR))), amb: mk((i) => (i % 2 ? null : col('White'))) },
    { id: 'frontStrobe', name: 'Front strobe', group: 'Strobe', beatMs: 150, beats: mk((i) => (i % 2 ? [] : FRONT.slice())), amb: mk(() => null) },
    // the high beam flashes (strobe.js start(): with headlight units both beams or one side at a time, police bursts)
    { id: 'flBoth', name: 'High beams', group: 'Flash', kind: 'flash', pattern: 'both', beatMs: 300, beats: mk((i) => (i % 2 ? [] : ['high'])), amb: mk(() => null) },
    { id: 'flAlt', name: 'Left and right', group: 'Flash', kind: 'flash', pattern: 'alternate', beatMs: 300, beats: mk((i) => (i % 2 ? ['cornR', 'high'] : ['cornL', 'high'])), amb: mk(() => null) },
    { id: 'flPolice', name: 'Police', group: 'Flash', kind: 'flash', pattern: 'police', beatMs: 180, beats: mk((i) => (i % 6 < 4 && i % 2 === 0 ? ['high'] : [])), amb: mk(() => null) },
].map((p) => Object.assign(p, { ready: true }));

function clean(p, i) {
    const beats = Array.isArray(p && p.beats) ? p.beats : [], amb = Array.isArray(p && p.amb) ? p.amb : [];
    const ms = Math.round((+(p && p.beatMs) || 250) / STEP_MS) * STEP_MS;
    return {
        id: p && typeof p.id === 'string' ? p.id : 'm' + i,
        name: p && typeof p.name === 'string' && p.name.length < 28 ? p.name : 'Mine ' + (i + 1),
        group: 'Yours', ready: false, smooth: !!(p && p.smooth),
        beatMs: Math.max(MIN_MS, Math.min(MAX_MS, ms)),
        beats: mk((k) => (Array.isArray(beats[k]) ? beats[k].filter((f) => ALL.indexOf(f) >= 0) : [])),
        amb: mk((k) => (Array.isArray(amb[k]) && amb[k].length === 3 ? amb[k].map((n) => Math.max(0, Math.min(255, n | 0))) : null)),
    };
}

function load(file) {
    let s = null;
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { s = null; }
    const speed = {}, smooth = {};
    if (s && s.smooth && typeof s.smooth === 'object') Object.keys(s.smooth).forEach((k) => { if (s.smooth[k] === true) smooth[k] = true; });
    if (s && s.speed && typeof s.speed === 'object') Object.keys(s.speed).forEach((k) => { const v = +s.speed[k]; if (v >= MIN_MS && v <= MAX_MS) speed[k] = v; });
    return { mine: (s && Array.isArray(s.mine) ? s.mine : []).slice(0, MINE).map(clean), speed: speed, smooth: smooth };
}
function save(file, store) { try { fs.writeFileSync(file, JSON.stringify({ mine: store.mine, speed: store.speed || {}, smooth: store.smooth || {} })); return true; } catch (e) { return false; } }
/** A ready made show's beat as the user set it (kept apart, so the show itself never changes), else its own. */
/** Whether a show fades from beat to beat (owner, 2026-11-27 01:23) rather than flashing: yours in itself, a ready
 *  made one in store.smooth beside it, the Flow always. */
const smoothOf = (p, store) => (p.kind === 'flow' ? true : p.ready ? !!(store && store.smooth && store.smooth[p.id]) : !!p.smooth);
function setSmooth(p, store, on) {
    if (p.kind === 'flow') return;
    if (p.ready) { store.smooth = store.smooth || {}; if (on) store.smooth[p.id] = true; else delete store.smooth[p.id]; } else p.smooth = !!on;
}
const ease = (f) => f * f * (3 - 2 * f);
/** How lit each lamp and the cabin are at a fractional beat: { lamps: { fn: 0..1 }, amb: rgb | null, ambLevel 0..1 }.
 *  Flashing: the beat's lamps full on. Smooth: each beat fades into the next. */
function at(p, beatF, smooth) {
    const i = Math.floor(beatF) % BEATS, j = (i + 1) % BEATS, f = smooth ? ease(beatF - Math.floor(beatF)) : 0;
    const lamps = {};
    p.beats[i].forEach((fn) => { lamps[fn] = (lamps[fn] || 0) + (1 - f); });
    if (smooth) p.beats[j].forEach((fn) => { lamps[fn] = Math.min(1, (lamps[fn] || 0) + f); });
    const a = ambAt(p, i), b = smooth ? ambAt(p, j) : null;
    const amb = a && b ? a.map((v, k) => Math.round(v * (1 - f) + b[k] * f)) : a || b;
    const ambLevel = a && b ? 1 : a ? 1 - f : b ? f : 0;
    return { lamps, amb, ambLevel };
}
const msOf = (p, store) => (p.ready && store && store.speed && store.speed[p.id]) || p.beatMs;
/** One step faster (d -1) or slower (+1): yours in itself, a ready made one in store.speed. */
function speedOf(p, store, d) {
    const v = Math.max(MIN_MS, Math.min(MAX_MS, msOf(p, store) + d * STEP_MS));
    if (p.ready) { store.speed = store.speed || {}; if (v === p.beatMs) delete store.speed[p.id]; else store.speed[p.id] = v; } else p.beatMs = v;
}
const inGroup = (g, store) => (g === 'Yours' ? store.mine : READY.filter((p) => p.group === g));
/** The strobe's rate for a flash show's beat. */
const rateOf = (ms) => (ms <= 220 ? 'fast' : ms <= 420 ? 'normal' : 'slow');

/** A copy of p in store.mine (the oldest of yours goes when it is full); its name says where it came from. */
function copy(p, store) {
    const mine = store.mine;
    const n = Object.assign(clean(Object.assign(JSON.parse(JSON.stringify(p)), { beatMs: msOf(p, store) }), mine.length), { id: 'm' + Date.now().toString(36), name: (p.ready ? p.name : p.name.replace(/ copy$/, '')) + ' copy' });
    if (mine.length >= MINE) mine.shift();
    mine.push(n);
    return n;
}
function toggle(p, beat, fn) { const b = p.beats[beat], i = b.indexOf(fn); if (i >= 0) b.splice(i, 1); else b.push(fn); }
/** The cabin's colour on a beat, one step on: none, then each colour, then none again. */
function ambNext(p, beat) {
    const c = p.amb[beat], i = c ? AMB.findIndex((a) => a[1].every((v, k) => v === c[k])) : -1;
    p.amb[beat] = i + 1 < AMB.length ? AMB[i + 1][1].slice() : null;
}
function speed(p, d) { p.beatMs = Math.max(MIN_MS, Math.min(MAX_MS, p.beatMs + d * STEP_MS)); }
const lit = (p, beat) => new Set(p && p.beats[beat] ? p.beats[beat] : []);
const ambAt = (p, beat) => (p && p.amb && p.amb[beat]) || null;
const uses = (p) => { const s = new Set(); p.beats.forEach((b) => b.forEach((f) => s.add(f))); return s; };
const has = (p, fns) => { for (const f of uses(p)) if (fns.indexOf(f) < 0) return false; return true; };

module.exports = { smoothOf, setSmooth, at, flowW, GROUPS, msOf, speedOf, inGroup, rateOf, BEATS, MINE, MIN_MS, MAX_MS, STEP_MS, AMB, ALL, READY, load, save, copy, toggle, ambNext, speed, lit, ambAt, uses, has, clean };
