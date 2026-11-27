// From idrive7-apps, apps/ambient_config/carview.js (MIT: Copyright (c) 2026 cauliflowermossgrape and contributors). See NOTICE.
'use strict';
/**
 * carview.js - the car as a see-through line drawing after a G20 saloon, nose up, seen from straight above or tilted
 * (a finger turns it round like a 3D model: yaw spins it about the upright, pitch leans the view back, roll about its
 * length), with its
 * ambient lights glowing inside at their places. Only the cabin: from the windscreen's foot to the rear window's, with
 * its dash, steering wheel, console, seats and door cards, so the lights' places read.
 *
 *   drawCarView(cv, t, box, lights, colourOf, opts)
 *     box       { x, y, w, h }: the car fits its height, centred
 *     lights    [{ part, x, y, x2, y2, fault }] (lin.js), x 0..1 across from the driver's side, y 0..1 from the dash
 *     colourOf  (light) -> { rgb, bright } | null (null: the car's own colour, drawn dim grey)
 *     opts      { rhd (the driver on the right), yaw (degrees, any), pitch (0 straight above .. MAX_PITCH), roll (-MAX_ROLL .. MAX_ROLL) }
 *
 * The car in metres: x forward, y to the left, z up, the middle at 0. Lines nearer the eye are brighter.
 */
const L = 2.3, W = 0.92;
const MAX_PITCH = 55, MAX_ROLL = 40;

// the plan's half width along the car (v = x / L: 1 nose .. -1 tail): a round nose, a slim waist at the doors,
// the rear haunches a little wider, a squarer tail
const plan = (x) => {
    const v = x / L, p = v > 0 ? 3.2 : 5;
    const base = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(v), p)), 1 / p);
    return W * base * (0.95 + 0.03 * Math.exp(-Math.pow((x + 1.25) / 0.45, 2)) - 0.015 * Math.exp(-Math.pow((x - 0.1) / 0.6, 2)) + 0.02 * (v > 0.6 ? 0 : 1));
};
// the side profile: the top of the body (a short bonnet, the windscreen, the roof, the fastback rear window, a short boot)
const top = (x) => {
    if (x > 2.2) return 0.74 - (x - 2.2) * 2.2;
    if (x > 1.25) return 0.74 + 0.2 * (2.2 - x) / 0.95;
    if (x > 0.5) return 0.94 + 0.46 * Math.sin((1.25 - x) / 0.75 * Math.PI / 2);
    if (x > -0.75) return 1.4 - 0.02 * (0.5 - x) / 1.25;
    if (x > -1.65) return 1.38 - 0.4 * Math.sin((-0.75 - x) / 0.9 * Math.PI / 2);
    if (x > -2.2) return 0.98 - 0.02 * (-1.65 - x) / 0.55;
    return 0.96 - (-2.2 - x) * 2.4;
};
const belt = (x) => Math.min(top(x) - 0.01, 0.9 + 0.04 * (L - x) / (2 * L));
const inCabin = (x) => x < 1.25 && x > -1.65;
// the roof's half width (the glass's top edge), the side glass's foot, over the cabin
const roofW = (x) => plan(x) * (0.7 + 0.06 * Math.cos(((x + 0.2) / 1.45) * Math.PI / 2));

/* The section across the car at x, from the left sill over the top to the right sill: [y, z]. */
function section(x) {
    const hw = plan(x), b = belt(x), t = top(x), tw = inCabin(x) ? Math.min(hw * 0.9, roofW(x)) : hw * 0.86;
    const mid = (b + t) / 2;
    return [[hw * 0.94, 0.28], [hw, 0.5], [hw * 0.995, b], [(hw + tw) / 2 * 1.03, mid], [tw, t], [tw * 0.4, t + 0.02], [0, t + 0.025],
        [-tw * 0.4, t + 0.02], [-tw, t], [-(hw + tw) / 2 * 1.03, mid], [-hw * 0.995, b], [-hw, 0.5], [-hw * 0.94, 0.28]];
}

/* The cabin's ends: the windscreen's foot (the dash) and the rear window's; the bonnet and the boot are left out. */
const XF = 1.3, XR = -1.55, XM = (XF + XR) / 2;
const SEATS = [0.42, -0.42];                   // the front seats' middles across

/** The cabin's lines: [[points], kind]. Its shell (body, glass) and what is inside (kind 'inside'). */
function carLines(xf, xr, cabin) {
    const out = [];
    const N = cabin ? 22 : 36, ST = [];
    for (let i = 0; i <= N; i++) ST.push(xf - (xf - xr) * i / N);
    const secs = ST.map((x) => section(x).map(([y, z]) => [x, y, z]));
    for (let k = 0; k < secs[0].length; k++) {
        // (the roof's middle lines left out: they would cross what is inside)
        if (cabin && k >= 5 && k <= 7) continue;
        const kind = k === 0 || k === 12 ? 'sill' : k === 2 || k === 10 ? 'body' : k === 4 || k === 8 ? 'glass' : 'mesh';
        out.push([secs.map((sc) => sc[k]), kind]);
    }
    secs.forEach((pts, i) => { if (i % 4 === 0 && i > 0 && i < N) { out.push([pts.slice(0, 5), 'mesh']); out.push([pts.slice(8), 'mesh']); } });
    out.push([secs[0].slice(0, 5), 'body'], [secs[0].slice(8), 'body'], [secs[N].slice(0, 5), 'body'], [secs[N].slice(8), 'body']);   // the cut ends, up to the glass
    [1, -1].forEach((s) => {
        const xs = []; for (let i = 0; i <= 30; i++) xs.push(1.2 - 2.8 * i / 30);
        out.push([xs.map((x) => [x, s * plan(x) * 0.985, belt(x) + 0.03]), 'glass']);
        out.push([[[0.42, s * roofW(0.42), top(0.42) - 0.01], [0.38, s * plan(0.38) * 0.98, belt(0.38) + 0.03]], 'glass']);   // B pillar
        out.push([[[-0.62, s * roofW(-0.62), top(-0.62) - 0.01], [-0.7, s * plan(-0.7) * 0.98, belt(-0.7) + 0.03]], 'glass']);
        [[1.15, 0.3], [0.05, 0.3], [-1.1, 0.32]].forEach(([x, z]) => out.push([[[x, s * plan(x) * 0.95, z], [x - 0.03, s * plan(x - 0.03), belt(x - 0.03)]], 'mesh']));
        [0.55, -0.55].forEach((x) => out.push([[[x, s * plan(x) * 1.005, 0.82], [x - 0.16, s * plan(x - 0.16) * 1.005, 0.82]], 'body']));
        out.push([[[1.15, s * plan(1.15), 0.96], [1.02, s * (plan(1.02) + 0.2), 0.98], [0.9, s * (plan(0.9) + 0.16), 0.98], [0.95, s * plan(0.95), 0.96]], 'body']);
        if (!cabin) return;
        // the door cards inside: the armrest along each door, its pull handle
        out.push([[[1.0, s * plan(1.0) * 0.9, 0.66], [0.45, s * plan(0.45) * 0.9, 0.68]], 'inside']);
        out.push([[[0.3, s * plan(0.3) * 0.9, 0.68], [-0.6, s * plan(-0.6) * 0.9, 0.68]], 'inside']);
        out.push([[[-0.75, s * plan(-0.75) * 0.9, 0.68], [-1.35, s * plan(-1.35) * 0.88, 0.66]], 'inside']);
    });
    if (!cabin) return out;
    const ac = (x, z, k, kind) => out.push([[[x, k * plan(x), z], [x, 0, z + 0.03], [x, -k * plan(x), z]], kind]);
    ac(1.22, top(1.22) + 0.01, 0.72, 'glass'); ac(0.5, top(0.5) - 0.01, 0.68, 'glass'); ac(-0.78, top(-0.78) - 0.01, 0.7, 'glass'); ac(-1.62, top(-1.62) + 0.01, 0.76, 'glass');
    out.push([[[0.36, 0.36, 1.43], [0.36, -0.36, 1.43], [-0.32, -0.36, 1.42], [-0.32, 0.36, 1.42], [0.36, 0.36, 1.43]], 'glass']);
    INSIDE.forEach(([pts]) => out.push([pts.concat([pts[0]]), 'inside']));
    // the dash's top edge, the steering wheel and its hub, the iDrive knob
    out.push([[[1.12, 0.8, 0.9], [1.06, 0.4, 0.93], [1.05, 0, 0.94], [1.06, -0.4, 0.93], [1.12, -0.8, 0.9]], 'inside']);
    const ring = (cx2, cy2, cz, r, n, flat) => { const pts = []; for (let a = 0; a <= n; a++) { const q = a / n * Math.PI * 2; pts.push(flat ? [cx2 + r * Math.cos(q), cy2 + r * Math.sin(q), cz] : [cx2 + r * 0.45 * Math.sin(q), cy2 + r * Math.cos(q), cz + r * 0.9 * Math.sin(q)]); } return pts; };
    out.push([ring(0.72, SEATS[0], 0.86, 0.19, 28), 'inside'], [ring(0.72, SEATS[0], 0.86, 0.06, 14), 'inside']);
    out.push([ring(0.02, 0, 0.66, 0.045, 14, true), 'inside']);
    return out;
}
/* What is inside, as flat shapes (filled, then outlined): [points, fill]. Seats: cushion, back, headrest. */
const INSIDE = (() => {
    const h = (x0, x1, y0, y1, z) => [[x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z]];
    const back = (x0, x1, y0, y1, z0, z1) => [[x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [x1, y0, z1]];
    const SEAT = [62, 68, 80, 255], BACK = [72, 78, 92, 255], HEAD = [82, 88, 102, 255], TRIM = [44, 48, 57, 255];
    const out = [];
    out.push([h(1.1, 0.78, 0.86, -0.86, 0.9), TRIM]);                                     // the dash's top
    out.push([[[0.98, 0.16, 0.94], [0.98, -0.16, 0.94], [1.02, -0.16, 1.1], [1.02, 0.16, 1.1]], [20, 24, 30, 255]]);   // the centre screen
    out.push([h(0.93, 0.8, SEATS[0] + 0.2, SEATS[0] - 0.2, 0.97), [20, 24, 30, 255]]);  // the instruments' hood
    out.push([h(0.9, -0.62, 0.11, -0.11, 0.6), TRIM]);                                    // the console
    out.push([h(-0.18, -0.6, 0.12, -0.12, 0.7), SEAT]);                                    // its armrest
    out.push([h(0.3, 0.18, 0.05, -0.05, 0.64), [96, 104, 120, 255]]);                    // the gear selector
    SEATS.forEach((y) => {
        out.push([h(0.36, -0.12, y + 0.24, y - 0.24, 0.55), SEAT]);
        out.push([back(-0.12, -0.3, y + 0.23, y - 0.23, 0.6, 1.15), BACK]);
        out.push([h(-0.27, -0.36, y + 0.12, y - 0.12, 1.3), HEAD]);
    });
    out.push([h(-0.66, -1.16, 0.72, -0.72, 0.55), SEAT]);
    out.push([back(-1.16, -1.36, 0.7, -0.7, 0.58, 1.05), BACK]);
    [0.48, 0, -0.48].forEach((y) => out.push([h(-1.32, -1.42, y + 0.12, y - 0.12, 1.12), HEAD]));
    return out;
})();
const LINES = carLines(XF, XR, true);
// the whole car the same way, nose to tail (the light shows), with what makes it a G20 from outside: the slim
// headlights with their notch, the kidneys, the L of the tail lights, the wheels in their arches
const FULL = carLines(L * 0.985, -L * 0.985, true).concat(g20Lines());
function g20Lines() {
    const out = [], P = (x, f, z, s) => [x, s * plan(x) * f, z];
    [1, -1].forEach((s) => {
        // headlight: a slim wedge from the kidney out to the corner, its lower edge notched up in the middle
        out.push([[P(2.2, 0.42, 0.7, s), P(2.14, 0.66, 0.72, s), P(2.04, 0.9, 0.7, s), P(1.98, 0.97, 0.66, s), P(2.06, 0.82, 0.63, s),
            P(2.12, 0.66, 0.66, s), P(2.16, 0.54, 0.62, s), P(2.2, 0.42, 0.7, s)], 'hl']);
        // the kidney grille, one each side of the middle
        out.push([[[2.255, s * 0.06, 0.64], [2.25, s * 0.3, 0.65], [2.25, s * 0.32, 0.5], [2.255, s * 0.07, 0.48], [2.255, s * 0.06, 0.64]], 'grille']);
        // the front intakes low in the corners
        out.push([[P(2.2, 0.55, 0.38, s), P(2.12, 0.82, 0.4, s), P(2.12, 0.82, 0.3, s), P(2.2, 0.55, 0.3, s), P(2.2, 0.55, 0.38, s)], 'mesh']);
        // tail light: the L across the boot lid and round the corner onto the wing
        out.push([[P(-2.19, 0.5, 0.92, s), P(-2.12, 0.86, 0.92, s), P(-1.98, 0.99, 0.9, s), P(-1.98, 0.99, 0.82, s), P(-2.12, 0.88, 0.8, s),
            P(-2.16, 0.66, 0.85, s), P(-2.19, 0.5, 0.86, s), P(-2.19, 0.5, 0.92, s)], 'tl']);
        // the wheels, each in its arch
        [1.42, -1.38].forEach((x) => {
            const ring = (r, f, kind) => { const pts = []; for (let a = 0; a <= 24; a++) { const q = a / 24 * Math.PI * 2; pts.push([x + r * Math.cos(q), s * plan(x) * f, 0.34 + r * Math.sin(q)]); } out.push([pts, kind]); };
            ring(0.33, 1.0, 'wheel'); ring(0.2, 1.01, 'wheel');
            const arch = []; for (let a = 0; a <= 16; a++) { const q = a / 16 * Math.PI; arch.push([x + 0.4 * Math.cos(q), s * plan(x) * 1.0, 0.34 + 0.4 * Math.sin(q)]); }
            out.push([arch, 'body']);
        });
    });
    // the boot lid's edge and the number plate
    out.push([[[-2.2, 0.36, 0.98], [-2.22, 0, 0.99], [-2.2, -0.36, 0.98]], 'body']);
    out.push([[[-2.24, 0.26, 0.74], [-2.24, -0.26, 0.74], [-2.24, -0.26, 0.62], [-2.24, 0.26, 0.62], [-2.24, 0.26, 0.74]], 'mesh']);
    return out;
}

/** The view: a point -> [screen x, screen y (down), depth (larger: nearer the eye)], before fitting. */
function viewer(pitchDeg, rollDeg, yawDeg) {
    const p = pitchDeg * Math.PI / 180, r = rollDeg * Math.PI / 180, cp = Math.cos(p), sp = Math.sin(p), cr = Math.cos(r), sr = Math.sin(r);
    const w = (yawDeg || 0) * Math.PI / 180, cw = Math.cos(w), sw = Math.sin(w);
    return ([x0, y0, z]) => {
        const x = x0 * cw - y0 * sw, y = x0 * sw + y0 * cw;          // spun about the upright
        const y1 = y * cr - z * sr, z1 = y * sr + z * cr;           // rolled about its length
        return [-y1, -(x * cp + z1 * sp), z1 * cp - x * sp];          // leaned back over the boot
    };
}

/** The cabin's light at fx across, fy from the dash, in metres: upper ones at the dash and the doors' tops, lower ones at the floor. */
function lightPoint(fx, fy, part, roof) {
    const x = 1.25 - fy * 2.9;
    // a light in the headliner (a sunroof's frame, the one by the rear reading lamps) sits up under the roof
    return [x, (0.5 - fx) * 2 * W * 0.86, roof ? top(x) - 0.06 : part === 'upper' ? (fy < 0.2 ? 0.98 : 0.92) : 0.38];
}
const isRoof = (l) => /Sunroof|Roof/.test((l && l.name) || '');

const glow = (rgb, bright, a) => { const f = 0.25 + 0.75 * Math.max(0, Math.min(100, bright)) / 100; return [rgb[0], rgb[1], rgb[2], Math.round(255 * a * f)]; };
const COL = { hl: [200, 208, 220], tl: [150, 40, 46], grille: [200, 208, 220], inside: [140, 148, 160], sill: [210, 216, 224], body: [236, 240, 246], edge: [236, 240, 246], mesh: [150, 158, 170], glass: [140, 182, 225], wheel: [190, 196, 204], lamp: [255, 255, 255], tail: [255, 50, 60] };
const WID = { hl: 1.8, tl: 2, grille: 1.6, inside: 1.2, sill: 1.6, body: 2, edge: 1.8, mesh: 1, glass: 1.6, wheel: 1.6, lamp: 3, tail: 3 };

function drawCarView(cv, t, box, lights, colourOf, opts) {
    const o = opts || {};
    const pitch = Math.max(0, Math.min(MAX_PITCH, o.pitch || 0)), roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, o.roll || 0));
    const pr = viewer(pitch, o.rhd ? -roll : roll, o.rhd ? -(o.yaw || 0) : o.yaw || 0);
    // a scale that stays as the view turns: the car's length fits the box whichever way it points
    const ext = !!o.exterior, xf = ext ? L : XF, xr = ext ? -L : XR, xm = ext ? 0 : XM;
    const k = (ext ? Math.min(box.h * 1.15, box.w) / ((xf - xr) * 1.04) : Math.min(box.h, box.w) / ((xf - xr) * 1.12)), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const S = (p) => { const q = pr([p[0] - xm, p[1], p[2]]); return [cx + (o.rhd ? -q[0] : q[0]) * k, cy + (q[1] + 0.55 * Math.sin(pitch * Math.PI / 180)) * k, q[2]]; };
    // its shadow on the ground, then the body's mass: the plan at the belt filled dark
    const strip = (f, z, c) => { for (let i = 0; i < 24; i++) { const xa = xf - (xf - xr) * i / 24, xb = xf - (xf - xr) * (i + 1) / 24; cv.quad([S([xa, f(xa), z]), S([xa, -f(xa), z]), S([xb, -f(xb), z]), S([xb, f(xb), z])].map((q) => [q[0], q[1]]), c); } };
    strip((x) => plan(x) * 1.06, 0, [0, 0, 0, 120]);
    strip(plan, 0.5, [22, 25, 30, 235]);
    // the cabin's floor a shade lighter, what is inside filled, so the lights' places read against them
    strip((x) => plan(x) * 0.9, 0.1, [27, 30, 36, 255]);
    INSIDE.forEach(([pts, c]) => cv.quad(pts.map((q) => { const r = S(q); return [r[0], r[1]]; }), c));
    const segs = [];
    (ext ? FULL : LINES).forEach(([pts, kind]) => { const q = pts.map(S); for (let i = 1; i < q.length; i++) segs.push([q[i - 1], q[i], kind]); });
    let d0 = Infinity, d1 = -Infinity;
    segs.forEach(([a, b]) => { d0 = Math.min(d0, a[2], b[2]); d1 = Math.max(d1, a[2], b[2]); });
    segs.sort((a, b) => (a[0][2] + a[1][2]) - (b[0][2] + b[1][2]));
    const near = (d) => (d - d0) / Math.max(1e-6, d1 - d0);
    // the lights: an upper one a bright strip in a soft spread of its colour; a lower one a pool of light on the floor
    // round it (where a footwell or a door pocket lights), the lamp itself a dot in the middle
    const drawLights = () => {
        const pool = (l, c) => {
            const [x, y, z] = lightPoint(l.x, l.y, l.part, isRoof(l)), rgb = c.rgb, br = c.bright, r = 0.17;
            for (let ring = 3; ring >= 1; ring--) {
                const rr = r * ring / 3, pts = [];
                for (let a = 0; a < 16; a++) { const q = a / 16 * Math.PI * 2; pts.push(S([x + rr * Math.cos(q), y + rr * 0.8 * Math.sin(q), 0.08])); }
                for (let a = 1; a < 15; a++) cv.quad([pts[0], pts[a], pts[a + 1], pts[a + 1]].map((q) => [q[0], q[1]]), glow(rgb, br, 0.2));
            }
            return S([x, y, z]);
        };
        lights.forEach((l) => {
            const c = colourOf(l), rgb = c ? c.rgb : [90, 96, 104], br = c ? c.bright : 30;
            if (c && br <= 0) return;
            if (l.x2 != null) {
                const a = S(lightPoint(l.x, l.y, l.part, isRoof(l))), b = S(lightPoint(l.x2, l.y2, l.part, isRoof(l)));
                if (c) [[22, 0.12], [13, 0.26], [8, 0.5]].forEach(([w, al]) => cv.line(a[0], a[1], b[0], b[1], w, glow(rgb, br, al)));
                cv.line(a[0], a[1], b[0], b[1], 4, glow(rgb, br, c ? 1 : 0.6));
                if (c) cv.line(a[0], a[1], b[0], b[1], 1.5, glow(rgb.map((v) => Math.round(v + (255 - v) * 0.7)), br, 0.95));
            } else {
                const p = c ? pool(l, c) : S(lightPoint(l.x, l.y, l.part, isRoof(l)));
                cv.circle(p[0], p[1], 4, glow(c ? rgb.map((v) => Math.round(v + (255 - v) * 0.5)) : rgb, br, c ? 1 : 0.6));
            }
            if (l.fault) { const p = S(lightPoint(l.x, l.y, l.part, isRoof(l))); cv.circle(p[0], p[1], 6, t.warn || '#ffb000'); }
        });
    };
    // the far lines, the lights inside, then the near lines over them (see-through)
    let lit = false;
    segs.forEach(([a, b, kind]) => {
        const n = near((a[2] + b[2]) / 2);
        if (!lit && n > 0.55) { drawLights(); lit = true; }
        const c = COL[kind], al = kind === 'lamp' || kind === 'tail' ? 0.95 : kind === 'inside' ? 0.75 : kind === 'hl' || kind === 'tl' || kind === 'grille' || kind === 'wheel' ? 0.3 + 0.6 * n : (kind === 'mesh' ? 0.08 : 0.16) + (kind === 'mesh' ? 0.4 : 0.78) * n * n;
        cv.line(a[0], a[1], b[0], b[1], WID[kind], [c[0], c[1], c[2], Math.round(255 * al)]);
    });
    if (!lit) drawLights();
    if (ext) drawLamps(cv, S, o.lamps || {}, o.flow, o.lampCol || {});
}

/*
 * The lamps outside, in metres (x forward, y to the left, z up), a pair each side unless named for one side:
 * where a G20's are, near enough to read which is lit.
 */
const LAMP3D = {
    high: [[2.12, 0.5, 0.68]], parkL: [[2.1, 0.66, 0.67], [-2.18, 0.66, 0.88]], parkR: [[2.1, -0.66, 0.67], [-2.18, -0.66, 0.88]],
    cornL: [[2.02, 0.76, 0.6]], cornR: [[2.02, -0.76, 0.6]], fog: [[2.22, 0.62, 0.36]],
    indL: [[2.0, 0.8, 0.68], [-2.12, 0.8, 0.86]], indR: [[2.0, -0.8, 0.68], [-2.12, -0.8, 0.86]],
    brake: [[-2.2, 0.56, 0.9], [-1.68, 0, 1.02]], reverse: [[-2.24, 0.36, 0.76]], rearFog: [[-2.26, 0.22, 0.42]],
};
const SIDED = { parkL: 1, parkR: 1, cornL: 1, cornR: 1, indL: 1, indR: 1 };
function lampPoints(fn) {
    const out = [];
    (LAMP3D[fn] || []).forEach((p) => { out.push(p); if (!SIDED[fn] && p[1]) out.push([p[0], -p[1], p[2]]); });
    return out;
}
/*
 * The flow (owner, 2026-11-27 01:18): light running over the car from the lowest lamp at the front, up the nose, back
 * through the cabin, and down the tail to the lowest lamp there. flowU(p) is a point's place on that way, 0 at the
 * front fog lights .. 1 at the rear fog light; flowAt(u, w) how lit it is while the wave is at w: a soft bump, so one
 * set is fading out while the next comes up.
 */
function flowU(p) {
    const [x, , z] = p, h = Math.max(0, Math.min(1, (z - 0.3) / 0.75));
    if (x > 1.3) return 0.28 * h;                                   // the nose: from the fog lights up to the headlights
    if (x < -1.65) return 0.72 + 0.28 * (1 - h);                   // the tail: from the top down to the rear fog light
    return 0.28 + 0.44 * (1.3 - x) / 2.95;                          // the cabin, front to back
}
const FLOW_W = 0.13;
const flowAt = (u, w) => Math.exp(-Math.pow((u - w) / FLOW_W, 2));
/** A cabin light's place on the way (its middle). */
const lightU = (l) => flowU(lightPoint(l.x2 != null ? (l.x + l.x2) / 2 : l.x, l.y2 != null ? (l.y + l.y2) / 2 : l.y, l.part, isRoof(l)));
/** An outside function's place: the middle of its lamps. */
const fnU = (fn) => { const ps = lampPoints(fn); return ps.reduce((a, p) => a + flowU(p), 0) / Math.max(1, ps.length); };

/** The outside lamps that are lit, glowing at their places (those on the far side of the car fainter). lit: { fn: rgb },
 *  or with o.flow (the wave's place) every lamp at the strength flowAt gives it. */
function drawLamps(cv, S, lit, flow, col) {
    if (flow != null) {
        const mid = S([0, 0, 0.6])[2];
        Object.keys(LAMP3D).forEach((fn) => lampPoints(fn).forEach((p) => {
            const a = flowAt(flowU(p), flow), q = S(p), f = (q[2] < mid - 0.3 ? 0.4 : 1) * a, c = col[fn] || [255, 255, 240];
            if (a < 0.03) return;
            [[24, 0.12], [14, 0.28], [8, 0.55]].forEach(([r, al]) => cv.circle(q[0], q[1], r, [c[0], c[1], c[2], Math.round(255 * al * f)]));
            cv.circle(q[0], q[1], 4, [255, 255, 255, Math.round(240 * f)]);
        }));
        return;
    }
    const mid = S([0, 0, 0.6])[2];
    Object.keys(lit).forEach((fn) => lampPoints(fn).forEach((p) => {
        const c = lit[fn], q = S(p), f = (q[2] < mid - 0.3 ? 0.4 : 1) * (c[3] != null ? c[3] : 1);    // c[3]: how far up (a fade)
        if (f < 0.02) return;
        [[24, 0.12], [14, 0.28], [8, 0.55]].forEach(([r, a]) => cv.circle(q[0], q[1], r, [c[0], c[1], c[2], Math.round(255 * a * f)]));
        cv.circle(q[0], q[1], 4, [255, 255, 255, Math.round(240 * f)]);
    }));
}

module.exports = { drawCarView, MAX_PITCH, MAX_ROLL, LAMP3D, flowU, flowAt, lightU, fnU, lampPoints };
