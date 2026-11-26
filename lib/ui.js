// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Paget96 Garage UI - the one look every Garage app uses (owner, 2026-11-26, layout B "top tabs").
 * Reference picture: docs/design/ui-B-toptabs.png. Rules: docs/DESIGN.md.
 *
 * Built only on upstream's kit (canvas.js / record.js / gauges.js), so it draws through the same
 * frame surface (a record.js Recorder): the GPU renderer at 60 fps, or the software canvas.
 * The renderer has no blur, so a glow is a halo of stacked shapes with falling alpha. Everything
 * that does not change from frame to frame (glass cards, labels, the tab bar, the title, the ring's
 * track) is recorded once as a cached layer (gauges.layer), as the kit's own widgets do; a frame
 * only records the numbers, the sparklines and the ring's value arc.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 *
 * In an app this file ships as garage_ui.js beside main.js (tools/build.py puts it there):
 *     const UI = require('./garage_ui');
 *     UI.background(cv); UI.title(cv, 'RACE DAY'); UI.tabs(cv, ['Now', 'Runs'], page, { onSelect });
 *     UI.header(cv, { status: 'LIVE', onHelp, onSettings });
 *
 * Every end is round (owner, 2026-11-26): arcs and rings with round caps, bars as pills, every line a
 * smoothed curve with round caps and joins. No square ends anywhere.
 *
 * Nothing jumps (owner, 2026-11-26 17:48): numbers, rings and bars glide, charts slide as samples arrive, the
 * tab pill and the controls slide, the info popup fades and scales in and out, all time based for 60 fps.
 * Every chart shows its values (axes, ranges, scales); every card can carry an (i) that opens an info popup;
 * the How to use and Settings pages are drawn here so they are the same in every app (docs/DESIGN.md).
 */
function kit(name) {
    try { return require('./kit/' + name); }                                 // inside a built app
    catch (e) { return require('../upstream-kit/kit/runtime/' + name); }     // in the Paget96 Garage repo (demo, tests)
}
const G = kit('gauges');
const { withAlpha, mix } = kit('canvas');
// our renderer first, then the kit's (lib/render.js); a copy of this file without it beside (a test) draws as before
const R = (function () {
    const tryReq = (n) => { try { return require(n); } catch (e) { if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).indexOf(n) >= 0) return null; throw e; } };
    return tryReq('./garage_render') || tryReq('./render');
})();

const W = 1600, H = 520;
const HEAD_CY = 50;   // the header row's one centre line (owner, 17:17): tabs, pill and buttons sit on it
const TITLE_CY = 42;  // the app name 8 px higher, the clock under it (owner, 18:26)
const CLOCK_CY = 70;
const CONTENT_TOP = 112; // content starts under the header row and the tab dots
const MARGIN = 28;      // page margin: the title on the left, the Settings button and the content on the right

/*
 * The layout (owner, 2026-11-26 19:44: "aplikacije bi trebale da imaju opciju da li full screen koriste ili ne"): the kit's
 * "layout" setting, Full screen (the default: our picture covers the screen, so the header carries the app name and a
 * clock) or Standard (the car's own title strip with the app name and the car's clock, and the car's button bar; our
 * picture only in the image area between them). In Standard the header leaves out what the car already shows there:
 * no app name, no clock, and the tabs (or the back pill) start at the page margin. setLayout() is called by attach().
 */
const look = { standard: false };
function setLayout(v) { look.standard = v === 'standard'; }
/** True when the car shows its own title and clock above our picture: the Standard layout, or the renderer placed us so. */
function standard(cv) { return look.standard || !!(cv && cv.place && cv.place.full === false); }
/** Where the tabs and the back pill start: right of the app name, or at the margin when the car shows the name. */
function headLeft(cv) { return standard(cv) ? MARGIN : 270; }

/** The palette. Colours are '#rrggbb'; translucent ones go through withAlpha. */
const C = {
    // accent: the chrome only (title, selected tab, arrows, tab dots, the two buttons' glyphs). This one
    // follows the front ambient light (D11, D13). NOTHING that shows data uses it: rings, bars, charts,
    // sparklines, pills and status text keep the fixed colours below, whatever the ambient light does,
    // because their colour carries meaning (red = at the limit or bad, amber = warm, green = ok) (owner, 17:19, D14).
    accent: '#ff8028',
    bgTop: '#101216',       // (16,18,22)
    bgBottom: '#060709',    // (6,7,9)
    orange: '#ff8028',      // (255,128,40) fixed data orange (ring, charts); the chrome uses C.accent
    amber: '#ffba46',       // (255,186,70) warming, second accent
    green: '#46d282',       // (70,210,130) ok, live
    blue: '#50aaff',
    red: '#ff4b3c',
    text: '#ecf0f5',
    dim: '#8c94a0',
    dark: '#141414',        // text on a filled orange tab
    track: '#30343c',       // ring track
    bar: '#14161a',         // the tab bar's colour over the page, for its faded ends
    dotOff: '#464a52',      // a position dot that is not the current tab
    glassFill: [255, 255, 255, 14],     // 6 %
    glassLine: [255, 255, 255, 26],     // 10 %
};
const STATUS = { ok: C.green, warm: C.amber, accent: C.orange, dim: C.dim, bad: C.red, info: C.blue };
const colour = (c) => (c && STATUS[c]) || c || C.orange;

/* ---------- glow: a halo of stacked shapes, falling off like a soft blur ---------- */
const GLOW_STEPS = 8;
/** Alpha of halo step k (1 = closest) for a glow of `strength` (0..1). */
function haloAlpha(k, steps, strength) { const f = 1 - (k - 0.5) / steps; return strength * 0.16 * f * f; }

function glowRoundRect(cv, x, y, w, h, r, c, spread, strength) {
    for (let k = spread; k >= 1; k -= spread / GLOW_STEPS) cv.roundRect(x - k, y - k, w + 2 * k, h + 2 * k, r + k, withAlpha(c, haloAlpha(k * GLOW_STEPS / spread, GLOW_STEPS, strength)));
}
function glowArc(cv, cx, cy, r0, r1, a0, a1, c, spread, strength) {
    for (let k = spread; k >= 1; k -= spread / GLOW_STEPS) {
        cv.arc(cx, cy, Math.max(0, r0 - k), r1 + k, a0, a1, withAlpha(c, haloAlpha(k * GLOW_STEPS / spread, GLOW_STEPS, strength)), { round: true });
    }
}
/** Text with a soft glow: the text again on rings of offsets, faint, then the text itself. */
function glowText(cv, str, x, y, size, c, opts, spread, strength) {
    const o = Object.assign({ literal: true }, opts || {});
    for (let rad = spread; rad >= 1; rad -= spread / 4) {
        const a = withAlpha(c, strength * 0.09 * (1 - rad / (spread + 1)));
        for (let i = 0; i < 8; i++) {
            const t = i * Math.PI / 4;
            cv.text(str, x + Math.cos(t) * rad, y + Math.sin(t) * rad, size, a, o);
        }
    }
    return cv.text(str, x, y, size, c, o);
}

/* ---------- page parts ---------- */

/** The page background: vertical gradient. Cached. */
function background(cv, w, h) {
    w = w || cv.w || W; h = h || cv.h || H;
    cv.blit(G.layer('p96bg|' + w + '|' + h, w, h, (c) => c.gradientRect(0, 0, w, h, [[0, C.bgTop], [1, C.bgBottom]]), cv.textScale), 0, 0);
}

/**
 * App name, top left, orange with a soft glow (cached), and the clock under it (owner, 2026-11-26 18:26): the name's
 * caps centred at y 42, the time centred at y 70. opts: { clock: false } leaves the clock out.
 */
function title(cv, name, x, y, opts) {
    if (standard(cv)) return;               // the car's title strip shows the name and its clock (Standard layout)
    const size = 24;
    x = x == null ? 28 : x; y = y == null ? TITLE_CY + Math.round(size * 0.36) : y;   // baseline that centres the caps on TITLE_CY
    const pad = 16, tw = Math.ceil(cv.textWidth(name, size, { font: 'bold', literal: true }));
    cv.blit(G.layer('p96title|' + name, tw + 2 * pad, size + 2 * pad, (c) => glowText(c, name, pad, pad + size * 0.8, size, C.accent, { font: 'bold' }, 6, 1), cv.textScale), x - pad, y - size * 0.8 - pad);
    if (!(opts && opts.clock === false)) clock(cv, x, CLOCK_CY);
}

/**
 * The time, HH:MM in 24 h (the kit tells no 12 / 24 h choice of the car), bold 17 px, dim, centred on cy. Every digit
 * sits in a slot of the widest digit's width, so a new minute changes one digit and nothing moves.
 */
const CLOCK_SIZE = 17;
let digitW = 0;
function clock(cv, x, cy, now) {
    const o = { font: 'bold', literal: true };
    if (!digitW) for (let d = 0; d <= 9; d++) digitW = Math.max(digitW, Math.ceil(cv.textWidth(String(d), CLOCK_SIZE, o)));
    const t = new Date(now == null ? Date.now() : now), two = (n) => (n < 10 ? '0' : '') + n;
    const str = two(t.getHours()) + ':' + two(t.getMinutes()), base = cy + Math.round(CLOCK_SIZE * 0.36);
    const colonW = Math.ceil(cv.textWidth(':', CLOCK_SIZE, o)) + 2;
    let xx = x;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i], w = ch === ':' ? colonW : digitW;
        cv.text(ch, xx + w / 2, base, CLOCK_SIZE, C.dim, { font: 'bold', literal: true, align: 'center' });
        xx += w;
    }
}

/** Horizontal fade over a bar's ends: the bar colour to clear over `fade` px, so tabs run out softly. */
function fadeEnds(cv, x, y, w, h, r, fade, c) {
    cv.rampRect(x, y, fade, h, 0, [c, withAlpha(c, 0)], x, fade);
    cv.rampRect(x + w - fade, y, fade, h, 0, [withAlpha(c, 0), c], x + w - fade, fade);
}
/** A chevron with round ends: dir -1 left, 1 right. */
function chevron(cv, x, y, size, dir, c) {
    cv.stroke([[x - dir * size * 0.3, y - size * 0.5], [x + dir * size * 0.3, y], [x - dir * size * 0.3, y + size * 0.5]], 3.5, c);
}

/**
 * The page tabs (layout B): pills in a glass bar at the top. The selected one is filled orange with a
 * glow and dark text, the others dim. When the tabs are wider than the bar they scroll sideways: the
 * ends fade out, round-ended arrows show which way there is more, position dots sit under the bar,
 * and the selected tab glides into view. Every tab is a touch and knob target, so the iDrive knob
 * goes through all of them (nextTab() for an app that turns the knob itself).
 * opts: { x, y, w, h, onSelect(i) }. Static parts are cached layers; a frame records the scroll.
 * Draw it right after background(), before title() and header(): it lays the page background back
 * over whatever scrolled out of the bar (the software canvas has no clip).
 * Returns the tab rects as drawn now [{ x, y, w, h }].
 */
function tabs(cv, items, sel, opts) {
    opts = opts || {};
    const x0 = opts.x == null ? headLeft(cv) : opts.x, bh = opts.h || 56, y0 = opts.y == null ? HEAD_CY - bh / 2 : opts.y;
    const size = 20, padX = 28, gap = 8, inset = 6, th = bh - 2 * inset;
    const widths = items.map((str) => Math.ceil(cv.textWidth(str, size, { font: 'bold' })) + 2 * padX);
    const stripW = widths.reduce((a, b) => a + b + gap, 0) - gap;
    // the bar ends where it does in either layout (x 1170): in Standard it also takes the name's place
    const bw = opts.w || (opts.x == null ? 1170 - x0 : 900), inner = bw - 2 * (inset + 4), scrolls = stripW > inner;
    const lefts = [];
    let acc = 0;
    widths.forEach((w) => { lefts.push(acc); acc += w + gap; });
    // scroll: keep the selected tab inside the bar, with a margin for the arrows; glide there
    const margin = scrolls ? 40 : 0;
    let want = 0;
    if (scrolls && sel >= 0 && sel < items.length) {
        want = lefts[sel] + widths[sel] / 2 - inner / 2;
        want = G.clamp(want, -margin, stripW - inner + margin);
    }
    const key = 'p96tabs|' + x0 + '|' + y0, lo = -margin, hi = stripW - inner + margin;
    // a finger swipe (attach) or the arrows move the bar by hand; a new selection glides into view again
    let st = tabScroll.get(key);
    if (!st) { st = { sel: sel, man: null, drag: false }; tabScroll.set(key, st); }
    if (st.sel !== sel) { st.sel = sel; st.man = null; }
    const goal = scrolls && st.man != null ? G.clamp(st.man, lo, hi) : want;
    const off = scrolls ? G.smooth(key, goal, st.drag ? 40 : 10) : 0;
    tabBar = scrolls && opts.onSelect ? { x: x0, y: y0, w: bw, h: bh, st: st, lo: lo, hi: hi, off: off, at: Date.now() } : null;
    const glow = 18;
    // the bar (glass), cached
    cv.blit(G.layer('p96tabbar|' + bw + '|' + bh, bw + 2 * glow, bh + 2 * glow, (c) => glass(c, glow, glow, bw, bh, bh / 2), cv.textScale), x0 - glow, y0 - glow);
    // the strip of pills, cached per selection, moved by the scroll
    const sx = x0 + inset + 4 - Math.round(off), sy = y0 + inset;
    if (cv.clip) cv.clip(x0 + 2, y0 - glow, bw - 4, bh + 2 * glow);
    cv.blit(G.layer('p96tabstrip2|' + items.join('\u0001') + '|' + bh, stripW + 2 * glow, th + 2 * glow, (c) => {
        items.forEach((str, i) => c.text(str, glow + lefts[i] + widths[i] / 2, glow + th / 2 + size * 0.36, size, C.dim, { font: 'bold', align: 'center' }));
    }, cv.textScale), sx - glow, sy - glow);
    // the selected pill slides to a new tab (owner, 17:48: nothing jumps); the label over it turns dark
    if (sel >= 0 && sel < items.length) {
        const px = G.smooth(key + '|px', lefts[sel], 16), pw = G.smooth(key + '|pw', widths[sel], 16);
        glowRoundRect(cv, sx + px, sy, pw, th, th / 2, C.accent, 14, 0.9);
        cv.roundRect(sx + px, sy, pw, th, th / 2, C.accent);
        items.forEach((str, i) => {
            const mid = lefts[i] + widths[i] / 2;
            if (mid > px && mid < px + pw) cv.text(str, sx + mid, sy + th / 2 + size * 0.36, size, C.dark, { font: 'bold', align: 'center' });
        });
    }
    if (scrolls) {
        fadeEnds(cv, x0 + 5, y0 + 3, bw - 10, bh - 6, bh / 2, 110, C.bar);
        if (off > 1) chevron(cv, x0 + 24, y0 + bh / 2, 16, -1, C.accent);
        if (off < stripW - inner - 1) chevron(cv, x0 + bw - 24, y0 + bh / 2, 16, 1, C.accent);
    }
    if (cv.noclip) cv.noclip();
    // the software canvas ignores clip: lay the page background back over what ran out of the bar
    // (so draw tabs() before title() and header())
    const by0 = y0 - glow, by1 = y0 + bh + glow, ph = cv.h || H;
    const bgAt = (y) => mix(C.bgTop, C.bgBottom, G.clamp(y / (ph - 1), 0, 1));
    const band = [[0, bgAt(by0)], [1, bgAt(by1)]];
    if (sx - glow < x0) cv.gradientRect(Math.max(0, sx - glow), by0, x0 - Math.max(0, sx - glow), by1 - by0, band);
    const sr = sx + stripW + glow;
    if (sr > x0 + bw) cv.gradientRect(x0 + bw, by0, sr - x0 - bw, by1 - by0, band);
    if (scrolls) {
        const n = items.length, cx0 = x0 + bw / 2 - (n - 1) * 9;
        for (let i = 0; i < n; i++) cv.circle(cx0 + i * 18, y0 + bh + 9, 3, i === sel ? C.accent : C.dotOff);
    }
    const rects = items.map((str, i) => ({ x: sx + lefts[i], y: sy, w: widths[i], h: th }));
    if (opts.onSelect && cv.target) {
        // the arrows first (the first target under a finger wins): each moves the bar by most of its width
        if (scrolls) {
            const page = (dir) => () => { st.man = G.clamp((st.man != null ? st.man : want) + dir * inner * 0.6, lo, hi); };
            if (off > 1) cv.target(x0, y0, 52, bh, page(-1), 'p96tabsl', bh / 2);
            if (off < stripW - inner - 1) cv.target(x0 + bw - 52, y0, 52, bh, page(1), 'p96tabsr', bh / 2);
        }
        // a tab only where it shows: one scrolled out of the bar is no target (it lay over the status pill)
        rects.forEach((r, i) => {
            const vx = Math.max(r.x, x0 + 4), vw = Math.min(r.x + r.w, x0 + bw - 4) - vx;
            if (vw > 8) cv.target(vx, r.y, vw, r.h, () => opts.onSelect(i), 'p96tab' + i, r.h / 2);
        });
    }
    return rects;
}
/** The bars' hand scroll by key, and the last scrolling bar drawn (attach() swipes it). */
const tabScroll = new Map();
let tabBar = null;
/**
 * A finger on the tab bar (where the kit runs the screen, ctx.onTouch): a swipe moves the bar, a tap without moving
 * presses what is under it (targets: the last frame's). Returns true while the gesture is the bar's.
 */
let tabDrag = null;
function tabTouch(phase, x, y, targets) {
    if (phase === 1) {
        const b = tabBar;
        tabDrag = null;
        if (!b || Date.now() - b.at > 500 || x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) return false;
        tabDrag = { x: x, y: y, start: b.off, b: b, moved: false };
        b.st.drag = true;
        return true;
    }
    const d = tabDrag;
    if (!d) return false;
    if (Math.abs(x - d.x) > 12) d.moved = true;
    if (d.moved) d.b.st.man = G.clamp(d.start - (x - d.x), d.b.lo, d.b.hi);
    if (phase === 3) {
        d.b.st.drag = false;
        tabDrag = null;
        if (!d.moved) {
            const q = (targets || []).filter((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)[0];
            if (q && q.run) q.run();
        }
    }
    return true;
}
/** The tab after (step 1) or before (step -1) sel, round the end: the knob goes through all tabs. */
function nextTab(sel, n, step) { return n ? ((sel + (step || 1)) % n + n) % n : 0; }

/* ---------- top right: status pill and the two mandatory buttons ---------- */

/** The "?" glyph: a round outline and a question mark. */
function helpGlyph(cv, cx, cy, c) {
    cv.arc(cx, cy, 13.5, 16.5, 0, 360, c);
    cv.text('?', cx, cy + 8, 22, c, { font: 'bold', align: 'center', literal: true });
}
/** The gear glyph: eight round-ended teeth, a ring, a hub. */
function gearGlyph(cv, cx, cy, c) {
    for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        cv.line(cx + 11 * Math.cos(a), cy + 11 * Math.sin(a), cx + 17 * Math.cos(a), cy + 17 * Math.sin(a), 6, c);
    }
    cv.arc(cx, cy, 8, 12, 0, 360, c);
    cv.circle(cx, cy, 4, c);
}
/** A round glass icon button, kind 'help' or 'settings'; lit (filled accent, dark glyph) on its own page. No label under it: it would push the button off the header's centre line (owner, 17:17). */
function iconButton(cv, cx, cy, kind, lit) {
    const r = 30, glow = 4, S = r + glow;
    cv.blit(G.layer('p96btn|' + kind + (lit ? '|lit' : ''), 2 * S + 40, 2 * S, (c) => {
        const x = S + 20, g = lit ? C.dark : C.accent;
        if (lit) c.circle(x, S, r, C.accent);
        else { c.circle(x, S, r, C.glassFill); c.arc(x, S, r - 1.5, r, 0, 360, C.glassLine); }
        if (kind === 'help') helpGlyph(c, x, S, g); else gearGlyph(c, x, S, g);
    }, cv.textScale), cx - S - 20, cy - S);
}
/**
 * The top right of every Paget96 Garage page (owner, 2026-11-26): a status pill (LIVE / demo) and two separate
 * round glass buttons, "How to use" (?) and "Settings" (gear). Both pages are mandatory in every app.
 * They sit flush right at the title's margin (28 px); the status pill is left of them.
 * opts: { status: 'LIVE' ('' for none), statusColor: 'ok', onHelp, onSettings, right, lit: 'help' | 'settings' }. All on HEAD_CY, no labels under the buttons.
 */
function header(cv, opts) {
    opts = opts || {};
    // flush right at the title's margin: the Settings button's right edge is the content's right edge
    const right = opts.right == null ? (cv.w || W) - MARGIN : opts.right;
    const setX = right - 30, helpX = setX - 80, pillW = 130, pillX = helpX - 30 - 52 - pillW;
    const st = opts.status == null ? 'LIVE' : opts.status, col = colour(opts.statusColor || 'ok');
    if (st) {
        cv.blit(G.layer('p96pillbg|' + pillW + '|44', pillW, 44, (c) => glass(c, 0, 0, pillW, 44, 22), cv.textScale), pillX, HEAD_CY - 22);
        cv.circle(pillX + 24, HEAD_CY, 6, col);
        cv.text(st, pillX + 40, HEAD_CY + 7, 18, col, { font: 'bold' });
    }
    // the names are not drawn; they are the targets' names for knob focus and screen readers
    iconButton(cv, helpX, HEAD_CY, 'help', opts.lit === 'help');
    iconButton(cv, setX, HEAD_CY, 'settings', opts.lit === 'settings');
    if (cv.target) {
        if (opts.onHelp) cv.target(helpX - 30, HEAD_CY - 30, 60, 60, opts.onHelp, 'p96help', 30);
        if (opts.onSettings) cv.target(setX - 30, HEAD_CY - 30, 60, 60, opts.onSettings, 'p96settings', 30);
    }
}

/** Live / demo state as plain text, for a page without the header: label, dot, note. right = right edge x. */
function status(cv, label, note, c, right, y) {
    right = right == null ? W - 28 : right; y = y == null ? 44 : y;
    const col = colour(c), size = 18, o = { font: 'bold' };
    const nw = note ? cv.textWidth(note, size, o) : 0, lw = cv.textWidth(label, size, o);
    let x = right - nw - (note ? 30 : 0) - lw;
    cv.text(label, x, y, size, col, o); x += lw + 15;
    if (note) { cv.circle(x, y - size * 0.34, 6, col); cv.text(note, x + 15, y, size, col, o); }
}

/* ---------- motion: nothing jumps (owner, 2026-11-26 17:48) ---------- */

/**
 * A 0..1 progress for `key` moving towards target (0 or 1) over `ms`, eased (smoothstep). Time based, so it
 * looks the same at 15, 30 or 60 fps. set(key, v) puts it somewhere first (a popup starts closed).
 */
const tweens = new Map();
function anim(key, target, ms) {
    const now = Date.now();
    let s = tweens.get(key);
    if (!s) { s = { v: target, t: now }; tweens.set(key, s); }
    const dt = Math.min(Math.max(0, now - s.t), 250);
    s.t = now;
    const step = dt / (ms || 200);
    s.v = s.v < target ? Math.min(target, s.v + step) : Math.max(target, s.v - step);
    return s.v * s.v * (3 - 2 * s.v);
}
function animSet(key, v) { tweens.set(key, { v: v, t: Date.now() }); }
/** A value gliding to its new value (the kit's spring), unless g.smooth === false. */
function glide(key, v, g, w) { return g && g.smooth === false ? v : G.smooth(key, v, w || 12); }

/* Scratch point buffers: a frame reuses them instead of making new arrays (the recorder copies the
 * points the moment a line is recorded, so one buffer serves every line in turn). */
const SCR_IN = [], SCR_OUT = [];
function put(buf, i, x, y) { let p = buf[i]; if (!p) { p = buf[i] = [0, 0]; } p[0] = x; p[1] = y; }

/* ---------- text helpers ---------- */
const I18N = (function () { try { return kit('i18n'); } catch (e) { return null; } })();
const tr = (s) => (I18N && I18N.t ? I18N.t(String(s)) : String(s));
const wraps = new Map();
/** Lines of str (translated) that fit maxW at size; paragraphs split on blank lines. Cached. */
function wrap(cv, str, size, maxW, font) {
    const key = str + '|' + size + '|' + maxW + '|' + (font || '');
    let lines = wraps.get(key);
    if (lines) return lines;
    lines = [];
    const o = { literal: true, font: font || 'label' };
    String(Array.isArray(str) ? str.join('\n\n') : str).split(/\n\s*\n/).forEach((para, pi) => {
        if (pi) lines.push('');
        let cur = '';
        tr(para.replace(/\s+/g, ' ').trim()).split(' ').forEach((wd) => {
            const next = cur ? cur + ' ' + wd : wd;
            if (cur && cv.textWidth(next, size, o) > maxW) { lines.push(cur); cur = wd; } else cur = next;
        });
        if (cur) lines.push(cur);
    });
    if (wraps.size > 200) wraps.delete(wraps.keys().next().value);
    wraps.set(key, lines);
    return lines;
}
/** Number for an axis: as many decimals as the step needs, never "-0". */
function fmtTick(v, step) {
    const d = step >= 1 || !step ? 0 : step >= 0.1 ? 1 : 2;
    const s = (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(d);
    return s === '-0' ? '0' : s;
}
/** A round range for an axis: { lo, hi, step, n } with lo and hi on whole steps of 1, 2, 2.5 or 5 x 10^k. */
function niceRange(lo, hi, n) {
    n = n || 4;
    if (!(hi - lo > 1e-9)) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    return { lo: a, hi: b, step: step, n: Math.max(1, Math.round((b - a) / step)) };
}

/* ---------- cards ---------- */

/** The (i) on a card: a thin ring and an "i". Tapping the card opens its info popup. */
function infoIcon(cv, cx, cy) {
    cv.arc(cx, cy, 10, 12, 0, 360, '#78808c');
    cv.text('i', cx, cy + 5, 14, '#969ea8', { font: 'bold', align: 'center', literal: true });
}
/** Makes a whole card the touch and knob target that opens info (or runs it, when the app keeps the popup itself). */
function infoTarget(cv, x, y, w, h, info) {
    if (info && cv.target) cv.target(x, y, w, h, typeof info === 'function' ? info : () => openInfo(info), 'p96info|' + Math.round(x) + '|' + Math.round(y), 22);
}
/** A card's info: opts.info, or opts.onInfo (a function that opens the app's own popup). */
const infoOf = (o) => (o ? o.info || (typeof o.onInfo === 'function' ? o.onInfo : null) : null);

/** A glass card: white 6 % fill, 10 % outline, radius 22. Draws straight onto cv (put it in a layer). */
function glass(cv, x, y, w, h, r) {
    r = r == null ? 22 : r;
    cv.roundRect(x, y, w, h, r, C.glassFill);
    cv.strokeRoundRect(x, y, w, h, r, 1.5, C.glassLine);
}
/** Draws a card's label (uppercase, dim) and its (i) into a layer at 0, 0. */
function cardFace(c, w, label, info) {
    if (label) c.text(String(tr(label)).toUpperCase(), 20, 30, 15, C.dim, { font: 'bold', spacing: 1, literal: true });
    if (info) infoIcon(c, w - 24, 24);
}
/**
 * A glass card as a cached layer, with an optional uppercase label. opts: { r, info, infoIcon } (a number is r).
 * With opts.info the card shows a small (i) top right and the whole card opens the info popup; with infoIcon: true
 * only the (i) does, for a card that holds rows or buttons of its own (the first target under a finger wins).
 */
function card(cv, x, y, w, h, label, opts) {
    const o = typeof opts === 'number' ? { r: opts } : (opts || {}), info = infoOf(o);
    cv.blit(G.layer('p96card|' + w + '|' + h + '|' + (label || '') + '|' + (o.r || 22) + '|' + (info ? 'i' : ''), w, h, (c) => {
        glass(c, 0, 0, w, h, o.r);
        cardFace(c, w, label, info);
    }, cv.textScale), x, y);
    if (o.infoIcon) infoTarget(cv, x + w - 56, y, 56, 52, info);
    else infoTarget(cv, x, y, w, h, info);
}

/** Catmull-Rom through pts, `k` steps a segment: every Paget96 Garage line is a smooth curve. out: a buffer to reuse. */
function smoothPts(pts, k, out) {
    const n = pts.length;
    if (!out) out = [];
    if (n < 3) { for (let i = 0; i < n; i++) put(out, i, pts[i][0], pts[i][1]); out.length = n; return out; }
    k = k || 8;
    let o = 0;
    for (let i = 0; i < n - 1; i++) {
        const p0 = pts[i ? i - 1 : 0], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 < n ? i + 2 : n - 1];
        for (let s = 0; s < k; s++) {
            const t = s / k, t2 = t * t, t3 = t2 * t;
            put(out, o++,
                0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3));
        }
    }
    put(out, o++, pts[n - 1][0], pts[n - 1][1]);
    out.length = o;
    return out;
}
/** A line with round caps and round joins along a smoothed curve. */
function curve(cv, pts, width, c) { cv.stroke(smoothPts(pts, 8, SCR_OUT), width, c); }
/** A polyline cut to x0..x1, ending exactly on the edges, copied into the clip buffer. */
const SCR_CLIP = [];
function clipX(pts, x0, x1) {
    let o = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p[0] < x0) {
            const n2 = pts[i + 1];
            if (n2 && n2[0] > x0) put(SCR_CLIP, o++, x0, p[1] + (n2[1] - p[1]) * (x0 - p[0]) / (n2[0] - p[0]));
            continue;
        }
        if (p[0] > x1) {
            const q = i ? pts[i - 1] : null;
            if (q && q[0] <= x1) put(SCR_CLIP, o++, x1, q[1] + (p[1] - q[1]) * (x1 - q[0]) / (p[0] - q[0]));
            break;
        }
        put(SCR_CLIP, o++, p[0], p[1]);
    }
    SCR_CLIP.length = o;
    return SCR_CLIP;
}
/**
 * The points of a series of values in a plot box, smoothed, in the scratch buffer. lo..hi is the value range.
 * off (px) moves the line right (a chart that scrolls as samples arrive); the line is cut to the box.
 */
function seriesPts(vals, x, y, w, h, lo, hi, off) {
    const n = vals.length, dx = n > 1 ? w / (n - 1) : 0;
    let m = 0;
    for (let i = 0; i < n; i++) {
        const v = vals[i];
        if (!G.isNum(v)) continue;
        put(SCR_IN, m++, x + i * dx + (off || 0), y + h - (G.clamp(v, lo, hi) - lo) / (hi - lo) * h);
    }
    SCR_IN.length = m;
    const out = smoothPts(SCR_IN, 8, SCR_OUT);
    return off ? clipX(out, x, x + w) : out;
}

/**
 * The range a small chart shows: the data's, but never narrower than minSpan (and 1 % of the value),
 * so a tiny wobble does not look like a big swing. Glides when it changes.
 */
function stripRange(key, v, minSpan, g) {
    let lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    const m = (lo + hi) / 2, span = Math.max(hi - lo, minSpan, Math.abs(m) * 0.01);
    lo = m - span / 2; hi = m + span / 2;
    return [glide(key + 'lo', lo, g, 8), glide(key + 'hi', hi, g, 8)];
}

/** Sparkline: vals in the box, a smooth 4 px line with round ends. opts: { minSpan, seq }. */
function spark(cv, x, y, w, h, vals, c, opts) {
    opts = opts || {};
    const v = (vals || []).filter(G.isNum);
    if (v.length < 2) return;
    const key = 'p96spark|' + Math.round(x) + '|' + Math.round(y);
    const r = stripRange(key, v, opts.minSpan == null ? 0 : opts.minSpan, opts);
    const off = G.isNum(opts.seq) ? (opts.seq - G.smooth(key + 'seq', opts.seq, 14)) * w / (v.length - 1) : 0;
    cv.stroke(seriesPts(v, x, y, w, h, r[0], r[1], off), 4, colour(c));
}

/** A progress bar with fully round ends: track and fill. frac 0..1; glides when key is given. */
function bar(cv, x, y, w, h, frac, c, key) {
    cv.roundRect(x, y, w, h, h / 2, C.track);
    let f = G.clamp(frac || 0, 0, 1);
    if (key) f = G.clamp(G.smooth('p96bar|' + key, f, 12), 0, 1);
    if (f > 0) cv.roundRect(x, y, Math.max(h, w * f), h, h / 2, colour(c));
}

/**
 * Stat card: g = { label, value, decimals, unit, sub, color, history, info, minSpan, seq, spanLabel, nowLabel }.
 * color names the status ('ok' green, 'warm' amber, 'accent' orange, 'dim', 'bad', 'info' or a '#hex'); it colours
 * the sub line and the small chart. value null shows "--"; a number glides to its new value.
 * The small chart is a strip under the value: its range on the left (never narrower than minSpan, default 2),
 * "-60 s" and "now" under it (spanLabel, nowLabel). seq (the newest sample's number) makes it scroll smoothly.
 * g.info opens the info popup from the whole card.
 */
function stat(cv, x, y, w, h, g) {
    const info = infoOf(g);
    const hist = g.history && g.history.filter(G.isNum).length > 1;
    const sx = 66, sy = 98, sw = w - 90, sh = 30, span = g.spanLabel || '-60 s', now = g.nowLabel || 'now';
    cv.blit(G.layer('p96stat|' + w + '|' + h + '|' + (g.label || '') + '|' + (info ? 'i' : '') + '|' + (hist ? span + '|' + now : ''), w, h, (c) => {
        glass(c, 0, 0, w, h);
        cardFace(c, w, g.label, info);
        if (hist) {
            c.fillRect(sx, sy, sw, 1, '#242830');
            c.fillRect(sx, sy + sh, sw, 1, '#30343c');
            c.text(span, sx, sy + sh + 15, 11, C.dim, { literal: true });
            c.text(now, sx + sw, sy + sh + 15, 11, C.dim, { align: 'right' });
        }
    }, cv.textScale), x, y);
    infoTarget(cv, x, y, w, h, info);
    // keyed by the label too: a card of another page in the same place starts from its own value, not this one's
    const key = 'p96stat|' + (g.label || '') + '|' + Math.round(x) + '|' + Math.round(y);
    const val = G.isNum(g.value) ? glide(key, g.value, g) : g.value;
    const vs = G.isNum(val) ? G.fmt(val, g.decimals) : val != null ? String(val) : '--';
    const vw = cv.text(vs, x + 20, y + 80, 48, val != null ? C.text : C.dim, { font: 'num', literal: true });
    if (g.unit) cv.text(g.unit, x + 28 + vw, y + 76, 18, C.dim);
    if (g.sub) cv.text(g.sub, x + 20, y + h - 13, 15, colour(g.color));
    if (hist) {
        const v = g.history.filter(G.isNum), r = stripRange(key, v, g.minSpan == null ? 2 : g.minSpan, g);
        const step = (r[1] - r[0]) / 2;
        cv.text(fmtTick(r[1], step), x + sx - 8, y + sy + 4, 11, C.dim, { align: 'right', literal: true });
        cv.text(fmtTick(r[0], step), x + sx - 8, y + sy + sh + 4, 11, C.dim, { align: 'right', literal: true });
        const off = G.isNum(g.seq) ? (g.seq - G.smooth(key + 'seq', g.seq, 14)) * sw / (v.length - 1) : 0;
        cv.stroke(seriesPts(v, x + sx, y + sy, sw, sh, r[0], r[1], off), 4, colour(g.color || C.orange));
    }
}

/* ---------- per cylinder ---------- */

/**
 * A per-cylinder card (owner rule, 2026-11-26 19:03: sized by the car's own cylinder count, never a fixed 4).
 * g = { label, banks: [{ bank, cylinders: [1, 2, ..] }] (lib/engine.js cylinderBanks()), values: { <cyl>: number },
 *       lo, hi (the bar's scale), mid (a zero line for values that go both ways, e.g. a correction), unit, decimals,
 *       status(v) -> 'ok' | 'warm' | 'bad' (the bar's fixed colour), info, sub }.
 * One bank: one row of bars across the card; two banks (a V8): bank 1 and bank 2 side by side with their names.
 * Bars are round ended, glide to their value, and fill the card at 3, 4, 6, 8 or 12 cylinders alike.
 */
function cylinders(cv, x, y, w, h, g) {
    const info = infoOf(g), banks = (g.banks || []).filter((b) => b.cylinders && b.cylinders.length);
    const two = banks.length === 2, gap = two ? 40 : 0;
    const top = y + (two ? 92 : 72), bottom = y + h - (g.sub ? 62 : 40), bh = Math.max(20, bottom - top - 26);
    cv.blit(G.layer('p96cyl|' + w + '|' + h + '|' + (g.label || '') + '|' + (info ? 'i' : '') + '|' + banks.map((b) => b.cylinders.join(',')).join('/') + '|' + (g.sub ? 's' : ''), w, h, (c) => {
        glass(c, 0, 0, w, h);
        cardFace(c, w, g.label, info);
        if (two) {
            const half = (w - 40 - gap) / 2;
            banks.forEach((b, i) => c.text('BANK ' + b.bank, 20 + i * (half + gap) + half / 2, 58, 13, C.dim, { font: 'bold', align: 'center', spacing: 1, literal: true }));
            c.fillRect(w / 2, 70, 1, h - 120, '#30343c');
        }
    }, cv.textScale), x, y);
    infoTarget(cv, x, y, w, h, info);
    if (!banks.length) { cv.text('not known yet', x + w / 2, y + h / 2 + 6, 17, C.dim, { align: 'center', literal: true }); return; }
    const lo = g.lo == null ? 0 : g.lo, hi = g.hi == null ? 100 : g.hi, span = hi - lo || 1;
    const groupW = two ? (w - 40 - gap) / 2 : w - 40;
    banks.forEach((b, bi) => {
        const n = b.cylinders.length, gx = x + 20 + bi * (groupW + gap);
        const slot = groupW / n, bw = G.clamp(slot * 0.42, 14, 46);
        b.cylinders.forEach((cyl, i) => {
            const cx = gx + slot * (i + 0.5), v = g.values ? g.values[cyl] : null, num = G.isNum(v);
            const val = num ? glide('p96cyl|' + (g.label || '') + '|' + cyl, v, g) : null;
            const bx = cx - bw / 2;
            cv.roundRect(bx, top, bw, bh, bw / 2, C.track);
            if (num) {
                const col = colour(g.status ? g.status(v) : 'ok');
                if (g.mid != null) {
                    const ym = top + bh - (G.clamp(g.mid, lo, hi) - lo) / span * bh, yv = top + bh - (G.clamp(val, lo, hi) - lo) / span * bh;
                    const y0 = Math.min(ym, yv), y1 = Math.max(ym, yv);
                    const hh = Math.max(bw / 2, y1 - y0 + bw / 2);
                    cv.roundRect(bx, y0 - bw / 4, bw, hh, Math.min(bw / 2, hh / 2), col);
                    cv.fillRect(bx - 4, Math.round(ym), bw + 8, 2, '#8c94a0');
                } else if (val > lo + span * 0.002) {
                    // a value above the bottom: at least a round end's worth, so a small count still shows
                    const fh = Math.max(bw, (G.clamp(val, lo, hi) - lo) / span * bh);
                    cv.roundRect(bx, top + bh - fh, bw, fh, bw / 2, col);
                }
            }
            const fs = slot < 56 ? 15 : 18;
            cv.text(num ? G.fmt(val, g.decimals || 0) : '--', cx, top - 8, fs, num ? C.text : C.dim, { font: 'bold', align: 'center', literal: true });
            cv.text(String(cyl), cx, top + bh + 22, 15, C.dim, { align: 'center', literal: true });
        });
    });
    const scale = G.fmt(lo, g.decimals || 0) + ' to ' + G.fmt(hi, g.decimals || 0) + (g.unit ? ' ' + g.unit : '') + ', cylinder number under each bar';
    cv.text(g.sub ? g.sub : scale, x + 20, y + h - 14, 15, g.subColor ? colour(g.subColor) : C.dim, { literal: true });
    if (g.sub) cv.text(scale, x + 20, y + h - 38, 13, C.dim, { literal: true });
}

/* ---------- hero ring ---------- */
const RING_A0 = -135, RING_SPAN = 270;
const polar = (cx, cy, r, a) => [cx + Math.sin(a * Math.PI / 180) * r, cy - Math.cos(a * Math.PI / 180) * r];
/**
 * The hero ring gauge for an app's one main number: dark track, orange arc with a glow, the value
 * big in the middle, a unit line under it and an uppercase label below the ring.
 * g = { value, min, max, decimals, text, unit, label, color, scale, target, info }. The arc and the number glide.
 * scale: { step, decimals } or an array of values: ticks and numbers outside the arc. target: a value, marked
 * across the track with a round-ended line.
 */
function ring(cv, cx, cy, r, g) {
    const th = g.thick || 14, glow = 18, min = g.min || 0, max = g.max == null ? 1 : g.max;
    const ticks = !g.scale ? [] : Array.isArray(g.scale) ? g.scale : (function () {
        const out = [], st = g.scale.step || niceRange(min, max, 4).step;
        for (let v = min; v <= max + st * 1e-6; v += st) out.push(v);
        return out;
    })();
    const sc = ticks.length ? 44 : 0, S = r + glow + 2 + sc;
    const dec = g.scale && g.scale.decimals != null ? g.scale.decimals : null;
    const angOf = (v) => RING_A0 + RING_SPAN * G.clamp((v - min) / (max - min), 0, 1);
    cv.blit(G.layer('p96ring|' + r + '|' + th + '|' + (g.label || '') + '|' + min + '|' + max + '|' + ticks.join(','), 2 * S, 2 * S + 40, (c) => {
        c.arc(S, S, r - th / 2, r + th / 2, RING_A0, RING_A0 + RING_SPAN, C.track, { round: true });
        if (g.label) c.text(String(tr(g.label)).toUpperCase(), S, S + r + 8, 16, C.dim, { font: 'bold', align: 'center', spacing: 1, literal: true });
        const st = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
        ticks.forEach((v) => {
            const a = angOf(v), p0 = polar(S, S, r + th / 2 + 6, a), p1 = polar(S, S, r + th / 2 + 13, a), pl = polar(S, S, r + th / 2 + 28, a);
            c.line(p0[0], p0[1], p1[0], p1[1], 2.5, '#5a606a');
            c.text(dec == null ? fmtTick(v, st) : v.toFixed(dec), pl[0], pl[1] + 5, 13, C.dim, { align: 'center', literal: true });
        });
    }, cv.textScale), cx - S, cy - S);
    const sv = glide('p96ring|' + cx + '|' + cy, g.value, g, 16);
    if (G.isNum(sv)) {
        const f = G.clamp((sv - min) / (max - min), 0, 1), a1 = RING_A0 + RING_SPAN * f, c = colour(g.color);
        if (f > 0.003) {
            glowArc(cv, cx, cy, r - th / 2, r + th / 2, RING_A0, a1, c, glow, 0.9);
            cv.arc(cx, cy, r - th / 2, r + th / 2, RING_A0, a1, c, { round: true });
        }
    }
    if (G.isNum(g.target)) {
        const a = angOf(g.target), p0 = polar(cx, cy, r - th / 2 - 5, a), p1 = polar(cx, cy, r + th / 2 + 5, a);
        cv.line(p0[0], p0[1], p1[0], p1[1], 4, C.text);
    }
    const vs = g.text != null ? g.text : G.isNum(sv) ? G.fmt(sv, g.decimals) : '--';
    cv.text(vs, cx, cy + 8, 72, G.isNum(g.value) || g.text != null ? C.text : C.dim, { font: 'num', align: 'center', literal: true });
    if (g.unit) cv.text(g.unit, cx, cy + 44, 20, C.dim, { align: 'center' });
    infoTarget(cv, cx - r - sc, cy - r - sc, 2 * (r + sc), 2 * (r + sc), infoOf(g));
}

/** A small status pill: tinted fill, coloured text. Returns its width. */
function pill(cv, x, y, text, c, filled) {
    const col = colour(c), size = 15, w = Math.ceil(cv.textWidth(text, size, { font: 'bold' })) + 28, h = 30;
    cv.roundRect(x, y, w, h, h / 2, filled ? col : withAlpha(col, 0.16));
    if (!filled) cv.strokeRoundRect(x, y, w, h, h / 2, 1.5, withAlpha(col, 0.55));
    cv.text(text, x + w / 2, y + h / 2 + size * 0.36, size, filled ? C.dark : col, { font: 'bold', align: 'center' });
    return w;
}

/**
 * A chart card: glass, a round-numbered y axis, x labels, line series with a soft fill under the first.
 * series = [{ values, color, name }]. opts = { label, info, min, max, yTicks (4), yUnit, xLabels, legend, seq }.
 *   yTicks: about how many steps the y axis has; the range is rounded out to whole steps (1, 2, 2.5, 5 x 10^k)
 *   yUnit: written after the top number ("120 °C"); xLabels: spread evenly under the plot ("-10 min" .. "now")
 *   legend: 'bottom' (default when a series has a name) or 'right', with note: a dim line under a right legend
 *   seq: the newest sample's number; when it goes up the lines slide left one step instead of jumping
 *   right: { min, max, unit, color }: a second y axis on the right for the series marked axis: 'right' (a 0 to 100 %
 *   position beside pressures); its numbers sit on the same grid lines, in its colour, the top one with its unit
 * The axes and grid are a cached layer per range; a frame records only the lines.
 */
function chart(cv, x, y, w, h, series, opts) {
    opts = opts || {};
    const all = [];
    const RA = opts.right || null, onRight = (s) => !!(RA && s.axis === 'right');
    series.forEach((s) => { if (!onRight(s)) (s.values || []).forEach((v) => { if (G.isNum(v)) all.push(v); }); });
    const lo0 = opts.min != null ? opts.min : all.length ? Math.min.apply(null, all) : 0;
    const hi0 = opts.max != null ? opts.max : all.length ? Math.max.apply(null, all) : 1;
    const R = niceRange(lo0, hi0, opts.yTicks || 4);
    const named = series.filter((s) => s.name), legend = named.length ? (opts.legend || 'bottom') : null;
    const info = infoOf(opts), xl = opts.xLabels || null, unit = opts.yUnit ? ' ' + opts.yUnit : '';
    const yl = [];
    for (let i = 0; i <= R.n; i++) yl.push(fmtTick(R.hi - i * R.step, R.step) + (i === 0 ? unit : ''));
    const lw = Math.max.apply(null, yl.map((s) => cv.textWidth(s, 13, { literal: true })));
    const yr = [];
    if (RA) for (let i = 0; i <= R.n; i++) yr.push(fmtTick(RA.max - i * (RA.max - RA.min) / R.n, (RA.max - RA.min) / R.n) + (i === 0 && RA.unit ? ' ' + RA.unit : ''));
    const rw = RA ? Math.ceil(Math.max.apply(null, yr.map((s) => cv.textWidth(s, 13, { literal: true }))) + 22) : 0;
    const top = opts.label ? 62 : 24, px = Math.ceil(20 + lw + 12), right = (legend === 'right' ? 200 : 24) + rw;
    const pw = w - px - right, ph = h - top - (xl ? 34 : 18) - (legend === 'bottom' ? 30 : 0);
    const lkey = ['p96chart', w, h, opts.label || '', info ? 'i' : '', R.lo, R.hi, R.step, unit, xl ? xl.join('\u0001') : '', legend || '',
        named.map((s) => s.name + s.color).join('\u0001'), opts.note || '', yr.join('\u0001'), RA ? RA.color || '' : ''].join('|');
    cv.blit(G.layer(lkey, w, h, (c) => {
        glass(c, 0, 0, w, h);
        cardFace(c, w, opts.label, info);
        for (let i = 0; i <= R.n; i++) {
            const gy = top + Math.round(i * ph / R.n);
            c.fillRect(px, gy, pw, 1, i === R.n ? '#3c4048' : '#282c34');
            c.text(yl[i], px - 10, gy + 5, 13, C.dim, { align: 'right', literal: true });
            if (RA) c.text(yr[i], px + pw + 10, gy + 5, 13, colour(RA.color || C.dim), { literal: true });
        }
        if (xl) xl.forEach((s, i) => {
            const gx = px + (xl.length > 1 ? pw * i / (xl.length - 1) : 0);
            c.line(gx, top + ph, gx, top + ph + 5, 1.5, '#3c4048');
            c.text(s, gx, top + ph + 21, 13, C.dim, { align: i === 0 && gx - px < 20 ? 'center' : i === xl.length - 1 ? 'right' : 'center', literal: true });
        });
        if (legend === 'bottom') named.forEach((s, i) => {
            const lx = px + i * 170, ly = h - 24;
            c.roundRect(lx, ly - 3, 20, 6, 3, colour(s.color));
            c.text(s.name, lx + 28, ly + 5, 15, C.dim);
        });
        if (legend === 'right') {
            named.forEach((s, i) => {
                const lx = w - right + rw + 24, ly = top + 6 + i * 34;
                c.roundRect(lx, ly - 3, 20, 6, 3, colour(s.color));
                c.text(s.name, lx + 30, ly + 5, 15, C.dim);
            });
            if (opts.note) wrap(c, opts.note, 14, right - rw - 30, 'label').forEach((ln, i, all) => c.text(ln, w - right + rw + 24, h - 16 - (all.length - 1 - i) * 20, 14, C.dim, { literal: true }));
        }
    }, cv.textScale), x, y);
    infoTarget(cv, x, y, w, h, info);
    const key = 'p96chart|' + Math.round(x) + '|' + Math.round(y);
    const shift = G.isNum(opts.seq) ? opts.seq - G.smooth(key + 'seq', opts.seq, 14) : 0;
    series.forEach((s, si) => {
        const v = s.values || [];
        if (v.length < 2) return;
        const lo = onRight(s) ? RA.min : R.lo, hi = onRight(s) ? RA.max : R.hi;
        const pts = seriesPts(v, x + px, y + top, pw, ph, lo, hi, shift * pw / (v.length - 1));
        if (si === 0 && opts.fill !== false) cv.fillUnder(pts, y + top + ph, withAlpha(colour(s.color), 0.12));
        cv.stroke(pts, 3, colour(s.color));
    });
}

/**
 * A chart card with two y axes: one series against the left axis, one against the right (a dyno sheet: power and
 * torque over rpm). The numbers of each axis are in its series' colour, the top one with its unit.
 * xs: the x value of every point (shared, rising); left / right: { values, color, unit, name, min, max };
 * opts: { label, info, xTicks: [values], xUnit (written under the middle of the axis), marks: [{ side: 'left' |
 * 'right', i, text }], yTicks (5) }. The y ranges are rounded out to whole steps; both share the grid lines. The
 * points glide when the data changes; the grid is a cached layer.
 */
function dualChart(cv, x, y, w, h, xs, left, right, opts) {
    opts = opts || {};
    const n = opts.yTicks || 5, info = infoOf(opts);
    const rng = (sr) => {
        const v = (sr.values || []).filter(G.isNum);
        const hi = sr.max != null ? sr.max : v.length ? Math.max.apply(null, v) : 1;
        const lo = sr.min != null ? sr.min : 0;
        const st0 = niceRange(lo, hi, n).step, st = st0;
        return { lo: lo, hi: Math.max(lo + st * n, Math.ceil(hi / st - 1e-9) * st), step: st };
    };
    const RL = rng(left), RR = rng(right);
    RL.step = (RL.hi - RL.lo) / n; RR.step = (RR.hi - RR.lo) / n;
    const ylab = (R, sr, i) => fmtTick(R.hi - i * R.step, R.step) + (i === 0 && sr.unit ? ' ' + sr.unit : '');
    const wl = [], wr = [];
    for (let i = 0; i <= n; i++) { wl.push(cv.textWidth(ylab(RL, left, i), 13, { literal: true })); wr.push(cv.textWidth(ylab(RR, right, i), 13, { literal: true })); }
    const top = opts.label ? 62 : 24, px = Math.ceil(20 + Math.max.apply(null, wl) + 12), pr = Math.ceil(20 + Math.max.apply(null, wr) + 12);
    const pw = w - px - pr, ph = h - top - 34;
    const x0 = xs.length ? xs[0] : 0, x1 = xs.length ? xs[xs.length - 1] : 1;
    const xa = opts.xRange ? opts.xRange[0] : x0, xb = opts.xRange ? opts.xRange[1] : x1;
    const X = (v) => px + (v - xa) / ((xb - xa) || 1) * pw;
    const ticks = opts.xTicks || [];
    const lkey = ['p96dual', w, h, opts.label || '', info ? 'i' : '', RL.lo, RL.hi, RR.lo, RR.hi, left.unit, right.unit, left.color, right.color,
        xa, xb, ticks.join(','), opts.xUnit || ''].join('|');
    cv.blit(G.layer(lkey, w, h, (c) => {
        glass(c, 0, 0, w, h);
        cardFace(c, w, opts.label, info);
        for (let i = 0; i <= n; i++) {
            const gy = top + Math.round(i * ph / n);
            c.fillRect(px, gy, pw, 1, i === n ? '#3c4048' : '#282c34');
            c.text(ylab(RL, left, i), px - 10, gy + 5, 13, colour(left.color), { align: 'right', literal: true });
            c.text(ylab(RR, right, i), px + pw + 10, gy + 5, 13, colour(right.color), { literal: true });
        }
        ticks.forEach((v) => {
            const gx = X(v);
            c.line(gx, top + ph, gx, top + ph + 5, 1.5, '#3c4048');
            c.text(fmtTick(v, 1), gx, top + ph + 21, 13, C.dim, { align: 'center', literal: true });
        });
        if (opts.xUnit) c.text(opts.xUnit, px + pw / 2, top + ph + 21, 13, C.dim, { align: 'center', literal: true });
    }, cv.textScale), x, y);
    infoTarget(cv, x, y, w, h, info);
    const key = 'p96dual|' + Math.round(x) + '|' + Math.round(y);
    const ptsOf = (sr, R, side) => {
        const out = [];
        (sr.values || []).forEach((v, i) => {
            if (!G.isNum(v) || !G.isNum(xs[i])) return;
            const gv = glide(key + side + i, v, opts, 10);
            out.push([X(xs[i]), y + top + ph - (G.clamp(gv, R.lo, R.hi) - R.lo) / (R.hi - R.lo) * ph]);
        });
        return out.map((p) => [x + p[0], p[1]]);
    };
    const P = { left: ptsOf(left, RL, 'l'), right: ptsOf(right, RR, 'r') };
    if (P.left.length > 1) curve(cv, P.left, 4, colour(left.color));
    if (P.right.length > 1) curve(cv, P.right, 4, colour(right.color));
    (opts.marks || []).forEach((mk) => {
        const sr = mk.side === 'right' ? right : left, pts = P[mk.side === 'right' ? 'right' : 'left'];
        let k = -1, seen = 0;
        (sr.values || []).forEach((v, i) => { if (G.isNum(v) && G.isNum(xs[i])) { if (i === mk.i) k = seen; seen++; } });
        const p = pts[k];
        if (!p) return;
        const col = colour(sr.color);
        cv.circle(p[0], p[1], 7, col);
        const below = mk.below != null ? mk.below : false;
        cv.text(mk.text, p[0], p[1] + (below ? 28 : -14), 15, col, { align: 'center', font: 'bold', literal: true });
    });
}

/* ---------- controls: segmented choice, switch, stepper ---------- */

/**
 * A pill button: glass with the label in the accent, or filled (accent, dark label) for the main action. The whole
 * pill is a touch and knob target that calls onPress. opts: { filled, key, size }. Returns its width.
 */
function button(cv, x, y, label, onPress, opts) {
    opts = opts || {};
    const size = opts.size || 17, h = 44, w = Math.ceil(cv.textWidth(label, size, { font: 'bold' })) + 44;
    cv.blit(G.layer('p96button|' + label + '|' + size + '|' + (opts.filled ? 'f' : ''), w, h, (c) => {
        if (opts.filled) c.roundRect(0, 0, w, h, h / 2, C.accent);
        else glass(c, 0, 0, w, h, h / 2);
        c.text(label, w / 2, h / 2 + size * 0.36, size, opts.filled ? C.dark : C.accent, { font: 'bold', align: 'center' });
    }, cv.textScale), x, y);
    if (onPress && cv.target) cv.target(x, y, w, h, onPress, 'p96button|' + (opts.key || label), h / 2);
    return w;
}

const optList = (options) => options.map((o) => (Array.isArray(o) ? o : [o, String(o)]));

/**
 * A segmented choice, right aligned at `right`, centred on cy. options: [[value, label]] or labels.
 * The selected pill (accent, dark text) slides to a new choice. Every segment is a touch and knob target
 * that calls onChange(value). Returns { x, y, w, h }.
 */
function segmented(cv, right, cy, options, value, onChange, key) {
    const os = optList(options), size = 16, f = { font: 'bold' };
    const ws = os.map((o) => Math.ceil(cv.textWidth(o[1], size, f)) + 40), tw = ws.reduce((a, b) => a + b, 0) + 8, x0 = right - tw;
    const offs = [];
    let acc = 0;
    ws.forEach((w) => { offs.push(acc); acc += w; });
    cv.blit(G.layer('p96seg|' + os.map((o) => o[1]).join('\u0001'), tw, 44, (c) => {
        glass(c, 0, 0, tw, 44, 22);
        os.forEach((o, i) => c.text(o[1], 4 + offs[i] + ws[i] / 2, 22 + size * 0.36, size, C.dim, { font: 'bold', align: 'center' }));
    }, cv.textScale), x0, cy - 22);
    key = 'p96seg|' + (key || Math.round(right) + '|' + Math.round(cy));
    let sel = -1;
    os.forEach((o, i) => { if (String(o[0]) === String(value)) sel = i; });
    if (sel >= 0) {
        const px = G.smooth(key + 'x', offs[sel], 18), pw = G.smooth(key + 'w', ws[sel], 18);
        cv.roundRect(x0 + 4 + px, cy - 18, pw, 36, 18, C.accent);
        os.forEach((o, i) => {
            const mid = offs[i] + ws[i] / 2;
            if (mid > px && mid < px + pw) cv.text(o[1], x0 + 4 + mid, cy + size * 0.36, size, C.dark, { font: 'bold', align: 'center' });
        });
    }
    if (cv.target && onChange) os.forEach((o, i) => cv.target(x0 + 4 + offs[i], cy - 22, ws[i], 44, () => onChange(o[0]), key + '|' + i, 18));
    return { x: x0, y: cy - 22, w: tw, h: 44 };
}

/** A switch 64 x 32, right aligned at `right`, centred on cy: the knob slides and the track fades to the accent. */
function toggle(cv, right, cy, on, onChange, key) {
    key = 'p96tog|' + (key || Math.round(right) + '|' + Math.round(cy));
    const p = G.clamp(G.smooth(key, on ? 1 : 0, 18), 0, 1);
    cv.roundRect(right - 64, cy - 16, 64, 32, 16, mix('#3c4048', C.accent, p));
    cv.circle(right - 48 + 32 * p, cy, 12, '#f0f0f0');
    if (cv.target && onChange) cv.target(right - 64, cy - 22, 64, 44, () => onChange(!on), key, 16);
    return { x: right - 64, y: cy - 16, w: 64, h: 32 };
}

/**
 * A stepper: a glass pill with round-ended minus and plus and the value between them (it glides).
 * opts: { decimals, unit, text, onMinus, onPlus, key }. Right aligned at `right`, centred on cy.
 */
function stepper(cv, right, cy, value, opts) {
    opts = opts || {};
    const key = 'p96step|' + (opts.key || Math.round(right) + '|' + Math.round(cy));
    const v = G.isNum(value) ? glide(key, value, opts, 18) : value;
    const s = opts.text != null ? opts.text : (G.isNum(v) ? G.fmt(v, opts.decimals) : '--') + (opts.unit ? ' ' + opts.unit : '');
    const w = 160, x0 = right - w;
    cv.blit(G.layer('p96stepbg|' + w, w, 44, (c) => {
        glass(c, 0, 0, w, 44, 22);
        c.line(14, 22, 26, 22, 3.5, C.accent);
        c.line(w - 26, 22, w - 14, 22, 3.5, C.accent);
        c.line(w - 20, 16, w - 20, 28, 3.5, C.accent);
    }, cv.textScale), x0, cy - 22);
    cv.text(s, x0 + w / 2, cy + 6, 17, C.text, { font: 'bold', align: 'center', literal: true });
    if (cv.target) {
        if (opts.onMinus) cv.target(x0, cy - 22, 48, 44, opts.onMinus, key + '|-', 22);
        if (opts.onPlus) cv.target(right - 48, cy - 22, 48, 44, opts.onPlus, key + '|+', 22);
    }
    return { x: x0, y: cy - 22, w: w, h: 44 };
}

/* ---------- page heads for How to use and Settings ---------- */

/** A glass back pill in place of the tabs: a round-ended chevron and the page name. Tapping it goes back. */
function backPill(cv, label, onBack) {
    const x0 = headLeft(cv), bh = 56, y0 = HEAD_CY - bh / 2, w = 80 + Math.ceil(cv.textWidth(label, 20, { font: 'bold' }));
    cv.blit(G.layer('p96back|' + label, w, bh, (c) => {
        glass(c, 0, 0, w, bh, bh / 2);
        chevron(c, 32, bh / 2, 18, -1, C.accent);
        c.text(label, 50, bh / 2 + 7, 20, C.text, { font: 'bold' });
    }, cv.textScale), x0, y0);
    if (onBack && cv.target) cv.target(x0, y0, w, bh, onBack, 'p96back', bh / 2);
}

/** The credit every copy keeps (NOTICE, term 1). */
const CREDIT = 'Paget96 Garage by Danijel Markov (Paget96)';
/** Where to find the maker (owner, 2026-11-26 19:06): shown at the bottom of every Settings page and in the README.
 * The car cannot open a link, so only the user name on each network is shown (owner, 19:12); the README has the links. */
const LINKS = [
    ['Instagram', '@thedakiness'],
    ['TikTok', '@paget96'],
    ['X', '@Paget96'],
    ['Telegram', '@paget96_projects_channel'],
    ['Web', 'paget96projects.com'],
    ['GitHub', 'Paget96'],
];

/**
 * The How to use page (owner, 2026-11-26): a back pill "How to use" in place of the tabs, the ? button lit,
 * the topics on the left (the selected one slides), the topic's illustration in the middle (topic.draw(cv, x, y,
 * w, h, t) is called every frame with t in seconds, so it can animate), its text on the right, and the credit
 * line at the bottom of the text card. topics = [{ title, text, note, draw }]; text: paragraphs split by a blank
 * line. opts: { title (the app name), onSelect(i), onBack, onSettings, credit }.
 */
function howToUse(cv, topics, sel, t, opts) {
    opts = opts || {};
    background(cv);
    backPill(cv, 'How to use', opts.onBack);
    if (opts.title) title(cv, opts.title);
    header(cv, { status: '', lit: 'help', onHelp: opts.onBack, onSettings: opts.onSettings });
    const top = CONTENT_TOP, hh = 392;
    // topics
    card(cv, 28, top, 380, hh);
    const rowH = 60, fit = Math.floor((hh - 20) / rowH), first = G.clamp(sel - fit + 1, 0, Math.max(0, topics.length - fit));
    const sy = G.smooth('p96topic', (sel - first) * rowH, 18);
    if (sel >= 0 && sel < topics.length) {
        cv.roundRect(40, top + 20 + sy, 356, 48, 24, C.accent);
    }
    for (let i = first; i < Math.min(topics.length, first + fit); i++) {
        const yy = top + 20 + (i - first) * rowH, on = Math.abs(yy - (top + 20 + sy)) < 24;
        cv.text((i + 1) + '  ' + tr(topics[i].title), 62, yy + 30, 18, on ? C.dark : C.dim, { font: on ? 'bold' : 'label', literal: true });
        if (opts.onSelect && cv.target) cv.target(40, yy, 356, 48, () => opts.onSelect(i), 'p96topic|' + i, 24);
    }
    // illustration
    const tp = topics[sel] || {};
    cv.blit(G.layer('p96helpill', 600, hh, (c) => { glass(c, 0, 0, 600, hh); c.roundRect(16, 16, 568, hh - 32, 18, '#0e0f12'); }, cv.textScale), 422, top);
    if (tp.draw) tp.draw(cv, 438, top + 16, 568, hh - 32, t || 0);
    // text
    const tx = 1036, tw = 536;
    cv.blit(G.layer('p96helptext|' + (tp.title || '') + '|' + (tp.text || '') + '|' + (tp.note || '') + '|' + (opts.credit || CREDIT), tw, hh, (c) => {
        glass(c, 0, 0, tw, hh);
        cardFace(c, tw, tp.title, false);
        wrap(c, tp.text || '', 17, tw - 40).forEach((ln, i) => c.text(ln, 20, 70 + i * 28, 17, '#c8ced6', { literal: true }));
        if (tp.note) wrap(c, tp.note, 16, tw - 40, 'bold').forEach((ln, i, a) => c.text(ln, 20, hh - 44 - (a.length - 1 - i) * 24, 16, C.amber, { font: 'bold', literal: true }));
        c.text(opts.credit || CREDIT, 20, hh - 14, 12, '#646a74', { literal: true });
    }, cv.textScale), tx, top);
}

/**
 * The Display block every app's Settings page starts with (owner, 2026-11-26 17:39), in the shape upstream
 * apps declare settings in app.json ("settings": [...]), so an app can copy them there. `hint` is the line under
 * the name on our Settings page.
 */
const DISPLAY_SETTINGS = [
    { key: 'renderer', label: 'Renderer', type: 'choice', default: 'auto', options: [['auto', 'GPU'], ['software', 'Software']],
        hint: 'GPU draws smoothly; Software if the screen flickers' },
    { key: 'fps', label: 'Frame rate', type: 'choice', default: 60, options: [[15, '15'], [30, '30'], [60, '60 fps']],
        hint: '60 fps is the default; lower saves the head unit work' },
    // the kit's own setting (kit/runtime/display.js "layout"): every app.json declares it, so the kit follows it
    { key: 'layout', label: 'Full screen', type: 'choice', default: 'full', options: [['full', 'On'], ['standard', 'Off']],
        hint: 'Needs the GPU renderer; Off: the car\'s own title and buttons' },
    { key: 'followAmbient', label: 'Follow ambient lighting', type: 'bool', default: true,
        hint: 'Accent colour follows the front ambient light' },
    { key: 'demo', label: 'Demo data', type: 'choice', default: 'auto', options: [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']],
        hint: 'Shows sample values when the car sends none' },
];
const DISPLAY_DEFAULTS = {};
DISPLAY_SETTINGS.forEach((s) => { DISPLAY_DEFAULTS[s.key] = s.default; });

/** The value one step up (dir 1) or down (-1) for a number row: through row.steps, else by row.step in min..max. */
function stepValue(row, v, dir) {
    if (row.steps && row.steps.length) {
        let i = 0;
        row.steps.forEach((s, k) => { if (Math.abs(s - v) < Math.abs(row.steps[i] - v)) i = k; });
        return row.steps[G.clamp(i + dir, 0, row.steps.length - 1)];
    }
    const st = row.step || 1, d = Math.max(0, -Math.floor(Math.log10(st) + 1e-9));
    const n = Math.round((v + dir * st) * Math.pow(10, d)) / Math.pow(10, d);
    return G.clamp(n, row.min == null ? -Infinity : row.min, row.max == null ? Infinity : row.max);
}
/** Where a row's name sits in a row of this pitch: the name and its hint centred, clear of the divider at any row count. */
function rowLabelY(pitch) { return Math.round((pitch - 3) / 2 + 1); }
/** One card of setting rows: names and hints cached, the controls right aligned. */
function settingsCard(cv, x, y, w, h, label, rows, values, onChange) {
    const pitch = Math.min(80, Math.floor((h - 56) / Math.max(1, rows.length)));
    cv.blit(G.layer('p96setcard|' + w + '|' + h + '|' + label + '|' + rows.map((r) => r.label + '\u0002' + (r.hint || '')).join('\u0001'), w, h, (c) => {
        glass(c, 0, 0, w, h);
        cardFace(c, w, label, false);
        rows.forEach((r, i) => {
            const yy = 56 + i * pitch, ly = rowLabelY(pitch);
            c.text(r.label, 20, yy + ly, 20, C.text, { font: 'bold' });
            if (r.hint) c.text(r.hint, 20, yy + ly + 23, 15, C.dim);
            if (i < rows.length - 1) c.fillRect(20, yy + pitch - 3, w - 40, 1, '#282c34');
        });
    }, cv.textScale), x, y);
    rows.forEach((r, i) => {
        const cy = y + 56 + i * pitch + rowLabelY(pitch) - 5, right = x + w - 20;
        const v = values && values[r.key] !== undefined ? values[r.key] : r.default;
        const set = (nv) => { if (onChange) onChange(r.key, nv); };
        if (r.type === 'bool') toggle(cv, right, cy, !!v, set, 'set|' + r.key);
        else if (r.type === 'number') stepper(cv, right, cy, v, { decimals: r.decimals, unit: r.unit, key: 'set|' + r.key,
            onMinus: () => set(stepValue(r, v, -1)), onPlus: () => set(stepValue(r, v, 1)) });
        else segmented(cv, right, cy, r.options || [], v, set, 'set|' + r.key);
    });
}
/**
 * The standard Settings page (owner, 2026-11-26 17:39): a back pill "Settings" in place of the tabs, the gear
 * lit, on the left the Display card (DISPLAY_SETTINGS, the same in every app), on the right the app's own rows.
 * appRows use the same shape: { key, label, hint, type: 'choice' | 'bool' | 'number', default, options,
 * steps | min, max, step, unit, decimals }. values: the current values by key (a missing one shows the default).
 * onChange(key, value) is called by every control. opts: { title (app name), appLabel, onBack, onHelp, onReport }.
 * With onReport the header carries the "Send a report" button where the status pill sits on the other pages.
 */
function settingsPage(cv, appRows, values, onChange, opts) {
    opts = opts || {};
    background(cv);
    backPill(cv, 'Settings', opts.onBack);
    if (opts.title) title(cv, opts.title);
    header(cv, { status: '', lit: 'settings', onHelp: opts.onHelp, onSettings: opts.onBack });
    if (opts.onReport) reportButton(cv, opts.onReport);
    const has = appRows && appRows.length, lw = has ? 764 : (cv.w || W) - 2 * MARGIN;
    // Full screen does nothing on the Software renderer (the car's own frame is all there is): not offered there
    const disp = values && values.renderer === 'software' ? DISPLAY_SETTINGS.filter((r) => r.key !== 'layout') : DISPLAY_SETTINGS;
    settingsCard(cv, MARGIN, CONTENT_TOP, lw, 356, 'Display', disp, values, onChange);
    if (has) settingsCard(cv, MARGIN + lw + 14, CONTENT_TOP, (cv.w || W) - 2 * MARGIN - lw - 14, 356, opts.appLabel || opts.title || 'This app', appRows, values, onChange);
    makerLine(cv, CONTENT_TOP + 356 + 30);
}
/** The maker line under the Settings cards: the credit on the left, the links on the right (cached once). */
function makerLine(cv, cy) {
    const w = (cv.w || W) - 2 * MARGIN;
    cv.blit(G.layer('p96maker|' + w, w, 30, (c) => {
        c.text(CREDIT, 0, 21, 15, '#8a909a', { literal: true });
        let x = w;
        for (let i = LINKS.length - 1; i >= 0; i--) {
            const v = LINKS[i][1], k = LINKS[i][0] + ' ';
            x -= c.textWidth(v, 15, { font: 'bold', literal: true });
            c.text(v, x, 21, 15, C.text, { font: 'bold', literal: true });
            x -= c.textWidth(k, 15, { literal: true });
            c.text(k, x, 21, 15, '#646a74', { literal: true });
            x -= 26;
        }
    }, cv.textScale), MARGIN, cy - 15);
}

/* ---------- the info popup ---------- */

const pop = { info: null, open: false };
/** Opens the info popup for a card (cards with opts.info call this when tapped). */
function openInfo(info) { if (!pop.info || !pop.open) animSet('p96pop', 0); pop.info = info; pop.open = true; }
function closeInfo() { pop.open = false; }

const PX = 150, PY = 40, PW = 1300, PH = 440;
/** The popup panel, its text, X and Got it, at scale s about the screen centre (s 1: the cached layer). */
/** The body text of an info: text, or sections [{ head, text }] as paragraphs ("Head: text"). */
function infoText(info) {
    if (info.text != null) return info.text;
    return (info.sections || []).map((x) => (x.head ? tr(x.head) + ': ' : '') + tr(x.text || '')).join('\n\n');
}
function popupPanel(c, info, ox, oy, s) {
    const S = (v) => v * s, cx = PW / 2, cy = PH / 2, X = (v) => ox + cx + (v - cx) * s, Y = (v) => oy + cy + (v - cy) * s;
    c.roundRect(X(0), Y(0), S(PW), S(PH), S(28), [24, 26, 31, 250]);
    c.strokeRoundRect(X(0), Y(0), S(PW), S(PH), S(28), 1.5, [255, 255, 255, 30]);
    c.roundRect(X(24), Y(24), S(630), S(PH - 48), S(20), '#0e0f12');
    const tx = 690, tw = PW - tx - 40;
    if (info.label) c.text(String(tr(info.label)).toUpperCase(), X(tx), Y(58), 15, C.dim, { font: 'bold', spacing: 1, literal: true });
    const head = wrap(c, info.title || '', 26, tw - 50, 'bold');
    head.forEach((ln, i) => c.text(ln, X(tx), Y(95 + i * 32), 26, C.text, { font: 'bold', literal: true }));
    const by = 138 + (head.length - 1) * 32;
    wrap(c, infoText(info), 17, tw).forEach((ln, i) => c.text(ln, X(tx), Y(by + i * 27), 17, '#c8ced6', { literal: true }));
    if (info.note) wrap(c, info.note, 16, tw - 170).forEach((ln, i, a) => c.text(ln, X(tx), Y(346 - (a.length - 1 - i) * 24), 16, C.amber, { literal: true }));
    // close X: a round button with a round-ended cross
    const xx = X(PW - 40), xy = Y(40);
    c.circle(xx, xy, S(20), '#282b32');
    c.line(xx - S(7), xy - S(7), xx + S(7), xy + S(7), 3, C.text);
    c.line(xx - S(7), xy + S(7), xx + S(7), xy - S(7), 3, C.text);
    // Got it
    c.roundRect(X(PW - 180), Y(PH - 74), S(140), S(48), S(24), C.accent);
    c.text('Got it', X(PW - 110), Y(PH - 50) + 7, 18, C.dark, { font: 'bold', align: 'center' });
}
/**
 * The info popup (owner, 2026-11-26 17:35): the page dimmed, a panel with an illustration area on the left
 * (info.draw(cv, x, y, w, h, t), called every frame with t in seconds, so an app can animate), the label,
 * heading, text and a note (amber) on the right, a round X and a "Got it" button; both close it.
 * info = { label, title, text (or sections [{ head, text }]), note, draw (or art) }. opts: { a (0..1, how far it is open; 1 by default), onClose }.
 * Opening and closing fade and scale it over about 200 ms (overlay() does that for popups opened from cards).
 * While it is open it takes all touch and knob targets of the page.
 */
function infoPopup(cv, info, t, opts) {
    opts = opts || {};
    const a = opts.a == null ? 1 : opts.a;
    if (!info || a <= 0) return;
    const onClose = opts.onClose || closeInfo, s = 0.94 + 0.06 * a;
    if (cv.targets) cv.targets.length = 0;          // the page under it can not be pressed
    const fade = a < 0.999 && cv.alpha;
    cv.fillRect(0, 0, cv.w || W, cv.h || H, [0, 0, 0, Math.round(170 * a)]);
    if (fade) cv.alpha(a);
    if (a >= 0.999) {
        cv.blit(G.layer('p96pop|' + (info.label || '') + '|' + (info.title || '') + '|' + infoText(info) + '|' + (info.note || ''), PW, PH, (c) => popupPanel(c, info, 0, 0, 1), cv.textScale), PX, PY);
    } else popupPanel(cv, info, PX, PY, s);
    const sx = (v) => PX + PW / 2 + (v - PW / 2) * s, sy = (v) => PY + PH / 2 + (v - PH / 2) * s;
    const draw = info.draw || info.art;
    if (draw) draw(cv, sx(24), sy(24), 630 * s, (PH - 48) * s, t != null ? t : info.since ? (Date.now() - info.since) / 1000 : 0);
    if (fade) cv.alpha(1);
    if (cv.target && a > 0.5) {
        cv.target(PX + PW - 60, PY + 20, 40, 40, onClose, 'p96popx', 20);
        cv.target(PX + PW - 180, PY + PH - 74, 140, 48, onClose, 'p96popok', 24);
    }
}
/**
 * Draw last in every frame: the info popup a card opened, fading and scaling in and out (200 ms).
 */
function overlay(cv, t) {
    if (!pop.info) return;
    const a = anim('p96pop', pop.open ? 1 : 0, 200);
    if (!pop.open && a <= 0) { pop.info = null; return; }
    infoPopup(cv, pop.info, t, { a: a, onClose: closeInfo });
}

/* ---------- a dialog: confirm, pick, report a result ---------- */

/** A pill button for dialogs: kind 'bad' (red, for what cannot be undone), 'primary' (accent) or plain glass. Returns its width. */
function dialogButton(cv, right, y, label, kind) {
    const size = 18, w = Math.ceil(cv.textWidth(label, size, { font: 'bold' })) + 64, h = 48, x = right - w;
    if (kind === 'bad') cv.roundRect(x, y, w, h, h / 2, C.red);
    else if (kind === 'primary') cv.roundRect(x, y, w, h, h / 2, C.accent);
    else { cv.roundRect(x, y, w, h, h / 2, '#2a2d34'); cv.strokeRoundRect(x, y, w, h, h / 2, 1.5, C.glassLine); }
    cv.text(label, x + w / 2, y + h / 2 + 7, size, kind ? C.dark : C.text, { font: 'bold', align: 'center' });
    return w;
}
/**
 * A dialog over the page (the page dimmed and not pressable while it is open): a coloured label, a heading, text,
 * a note (amber), chips (small tags, [{ text, color }]) and buttons on the bottom right ([{ label, kind, run }], the
 * last one the main one). d.body(cv, x, y, w, h, t) draws extra content under the heading instead of the text
 * (a list to pick from), and may add its own targets. d = { label, labelColor, title, text, note, chips, buttons,
 * body, w, h }. opts: { a (0..1, how far it is open; it fades and scales like the info popup) }.
 */
function dialog(cv, d, t, opts) {
    const a = opts && opts.a != null ? opts.a : 1;
    if (!d || a <= 0) return;
    if (cv.targets) cv.targets.length = 0;
    const PWd = d.w || 940, PHd = d.h || 400, s = 0.94 + 0.06 * a;
    const W0 = cv.w || W, H0 = cv.h || H, x = Math.round(W0 / 2 - PWd * s / 2), y = Math.round(H0 / 2 - PHd * s / 2);
    cv.fillRect(0, 0, W0, H0, [0, 0, 0, Math.round(170 * a)]);
    const fade = a < 0.999 && cv.alpha;
    if (fade) cv.alpha(a);
    const pw = PWd * s, ph = PHd * s, lc = colour(d.labelColor || 'dim');
    cv.roundRect(x, y, pw, ph, 28 * s, '#181a1f');
    cv.strokeRoundRect(x, y, pw, ph, 28 * s, 1.5, d.labelColor === 'bad' ? withAlpha(C.red, 0.55) : [255, 255, 255, 30]);
    const ix = x + 36, iw = pw - 72;
    let yy = y + 48;
    if (d.label) { cv.text(String(tr(d.label)).toUpperCase(), ix, yy, 15, lc, { font: 'bold', spacing: 1, literal: true }); yy += 36; }
    if (d.title) wrap(cv, d.title, 28, iw, 'bold').forEach((ln) => { cv.text(ln, ix, yy, 28, C.text, { font: 'bold', literal: true }); yy += 36; });
    const by = y + ph - 70;
    if (d.body) d.body(cv, ix, yy, iw, by - yy - 10, t || 0);
    else if (d.text) {
        const lines = wrap(cv, d.text, 17, Math.min(iw, 600));
        lines.forEach((ln, i) => cv.text(ln, ix, yy + 4 + i * 28, 17, '#c8ced6', { literal: true }));
    }
    if (d.note) wrap(cv, d.note, 17, iw - 360).forEach((ln, i, all) => cv.text(ln, ix, by - 6 - (all.length - 1 - i) * 24 - (d.chips && d.chips.length ? 28 : 0), 17, C.amber, { literal: true }));
    let cx = ix;
    (d.chips || []).forEach((c) => {
        const col = colour(c.color || 'accent');
        cv.roundRect(cx, by + 6, 22, 22, 6, col);
        cv.text('v', cx + 11, by + 22, 14, C.dark, { font: 'bold', align: 'center', literal: true });
        cx += 32 + cv.text(c.text, cx + 32, by + 23, 17, C.text, { literal: true }) + 40;
    });
    let right = x + pw - 36;
    const bts = d.buttons || [];
    for (let i = bts.length - 1; i >= 0; i--) {
        const b = bts[i], bw = dialogButton(cv, right, by, b.label, b.kind);
        if (cv.target && b.run && a > 0.5) cv.target(right - bw, by, bw, 48, b.run, 'p96dlg|' + i, 24);
        right -= bw + 16;
    }
    if (fade) cv.alpha(1);
}

/* ---------- the layout, followed; touch in the Standard layout ---------- */

/**
 * The kit presses the FIRST target under a finger. A card that opens its info popup from the whole card is recorded
 * before the buttons drawn on it, so on the car a tap on OPEN on Exhaust's Flap card opened the card's info instead
 * (owner, 2026-11-26 20:18: "Ne mogu da kliknem da otvorim"). Every target that holds another one goes after it, in
 * place and otherwise in order (the knob's order stays the drawing's): the button on a card wins over the card.
 */
function pressOrder(targets) {
    const n = targets.length, holds = [];
    for (let i = 0; i < n; i++) {
        const t = targets[i];
        let h = false;
        for (let j = 0; j < n && !h; j++) {
            if (i === j) continue;
            const u = targets[j], cx = u.x + u.w / 2, cy = u.y + u.h / 2;
            h = u.w * u.h < t.w * t.h && cx >= t.x && cx < t.x + t.w && cy >= t.y && cy < t.y + t.h;
        }
        holds.push(h);
    }
    const inner = [], outer = [];
    targets.forEach((t, i) => (holds[i] ? outer : inner).push(t));
    targets.length = 0;
    inner.concat(outer).forEach((t) => targets.push(t));
    return targets;
}

const BRIDGE = 1000;     // "tab" numbers from here on are the page's own targets (attach)
/**
 * Call once in start(), before ctx.onTab: the header follows the "layout" setting (setLayout), and in the Standard
 * layout every target on the page stays pressable. There the kit hands the renderer only the tabs it is told of
 * (recorder.tabRects) and sends every other tap to the car, so our buttons, cards and Settings controls would not
 * answer (F, Company projects/garage/docs/FINDINGS.md). attach() gives the kit each target of the frame as a tab
 * numbered from 1000 and runs it when that tab is tapped; the app's own ctx.onTab(fn) still gets its real tabs.
 */
function attach(ctx) {
    const s = ctx.settings;
    const follow = () => setLayout(s && s.get ? s.get('layout') : null);
    follow();
    if (s && s.onChange) s.onChange((k) => { if (k === 'layout') follow(); });
    const d = ctx.display, ui = ctx.ui;
    if (!d || !ui || typeof ui.image !== 'function') return;
    let appTab = null, pressable = [], lastTargets = [], appTouch = null;
    ctx.onTab = (fn) => { appTab = fn; };
    // a swipe on our tab bar scrolls it (where the kit runs the screen); every other gesture stays the app's
    ctx.onTouch = (fn) => { appTouch = fn; };
    let mine = false;
    d.onTouch = (phase, x, y) => {
        if (phase === 1) mine = tabTouch(1, x, y, lastTargets);
        else if (mine) tabTouch(phase, x, y, lastTargets);
        if (mine) { if (phase === 3) mine = false; return true; }
        return appTouch ? appTouch(phase, x, y) : false;
    };
    d.onTab = (i, closed) => {
        if (i >= BRIDGE) { const q = pressable[i - BRIDGE]; return q && q.run ? q.run() : undefined; }
        return appTab ? appTab(i, closed) : undefined;
    };
    const image = ui.image.bind(ui);
    ui.image = (name, cv, cell) => {
        if (cv && cv.targets) { pressOrder(cv.targets); lastTargets = cv.targets.slice(); }
        if (cv && cv.targets && cv.place && standard(cv)) {
            pressable = cv.targets.slice();
            cv.tabRects = pressable.map((q, k) => ({ i: BRIDGE + k, x: q.x, y: q.y, w: q.w, h: q.h }));
        }
        return image(name, cv, cell);
    };
}

/* ---------- Send a report (owner, 2026-11-26 19:41 and 19:43, variant A; the facts: lib/report.js) ---------- */

/** The "Send a report" button, in the header of the Settings page where the status pill sits on the other pages. */
function reportButton(cv, onPress) {
    const label = 'Send a report', size = 17, w = Math.ceil(cv.textWidth(label, size, { font: 'bold' })) + 44;
    const right = (cv.w || W) - MARGIN - 30 - 80 - 30 - 22;
    button(cv, right - w, HEAD_CY - 22, label, onPress, { key: 'report' });
}

/** A numbered step: a round accent dot with its number, and wrapped text beside it. Returns the y under it. */
function stepRow(cv, n, x, y, w, str) {
    cv.circle(x + 16, y + 16, 16, C.accent);
    cv.text(String(n), x + 16, y + 22, 17, C.dark, { font: 'bold', align: 'center', literal: true });
    const lines = wrap(cv, str, 18, w - 48);
    lines.forEach((ln, i) => cv.text(ln, x + 48, y + 23 + i * 25, 18, C.text, { literal: true }));
    return y + Math.max(36, lines.length * 25 + 8) + 10;
}

let repStep = null;
/**
 * The report screens: flow is a lib/report.js Flow (step 'explain' or 'qr', facts, built, vin). Step one says how it
 * works and shows every line the link will carry, with "Make QR code" and "Cancel"; step two the code and how to send
 * it. opts: { title (the app name), onClose (back to Settings), onHelp }. Draw it instead of the Settings page while
 * flow.active().
 */
function reportPage(cv, flow, t, opts) {
    opts = opts || {};
    if (flow.drawn) flow.drawn();
    const close = () => { flow.close(); if (opts.onClose) opts.onClose(); };
    const back = () => { if (flow.step === 'qr') flow.back(); else close(); };
    background(cv);
    backPill(cv, 'Send a report', back);
    if (opts.title) title(cv, opts.title);
    header(cv, { status: '', onHelp: opts.onHelp, onSettings: close });
    if (repStep !== flow.step) { repStep = flow.step; animSet('p96rep', 0); }
    const a = anim('p96rep', 1, 220), fade = a < 0.999 && cv.alpha;
    if (fade) cv.alpha(a);
    const top = CONTENT_TOP, hh = 392, R = (cv.w || W) - MARGIN, b = flow.built || { lines: [], qr: null };
    if (flow.step !== 'qr') {
        // how it works, the VIN tick, the buttons
        const lw = 540;
        card(cv, MARGIN, top, lw, hh, 'How it works');
        let y = top + 52;
        y = stepRow(cv, 1, MARGIN + 20, y, lw - 40, 'The car needs no internet and no account.');
        y = stepRow(cv, 2, MARGIN + 20, y, lw - 40, 'Your phone sends it, from your own GitHub account.');
        y = stepRow(cv, 3, MARGIN + 20, y, lw - 40, 'It helps us fix things faster.');
        wrap(cv, 'Nothing leaves the car here: the next step shows a QR code, and only your phone sends it, after you check it.', 15, lw - 40)
            .forEach((ln, i) => cv.text(ln, MARGIN + 20, y + 6 + i * 21, 15, C.dim, { literal: true }));
        const by = top + hh - 20 - 44;
        if (flow.facts && flow.facts.vin) {
            const vy = by - 50;
            cv.text('Add the VIN', MARGIN + 20, vy, 18, C.text, { font: 'bold' });
            cv.text('Off: the VIN is never sent', MARGIN + 20, vy + 21, 14, C.dim);
            toggle(cv, MARGIN + lw - 20, vy - 6, !!flow.vin, () => flow.toggleVin(), 'repvin');
        }
        const mw = Math.ceil(cv.textWidth('Make QR code', 17, { font: 'bold' })) + 44;
        button(cv, MARGIN + lw - 20 - mw, by, 'Make QR code', () => flow.makeQr(), { filled: true, key: 'repmake' });
        button(cv, MARGIN + 20, by, 'Cancel', close, { key: 'repcancel' });
        // exactly what the link carries, line by line
        const rx = MARGIN + lw + 14, rw = R - rx;
        card(cv, rx, top, rw, hh, 'What will be sent');
        let ly = top + 66;
        cv.text('Title: ' + (b.title || ''), rx + 20, ly, 16, C.text, { font: 'bold', literal: true });
        ly += 28;
        b.lines.forEach((ln) => {
            if (!ln) { ly += 8; return; }
            cv.text(ln, rx + 20, ly, 15, '#c8ced6', { literal: true });
            ly += 21;
        });
        const code = b.qr ? 'QR code: version ' + b.qr.version + ', level ' + b.ecl + ', ' + b.qr.bytes + ' bytes' : '';
        cv.text(code, rx + rw - 20, top + hh - 16, 13, '#646a74', { align: 'right', literal: true });
    } else {
        // the code as big as the page allows: dark on white, whole pixels, the quiet zone of 4 modules inside the white
        // square, whose corners are round (the radius stays inside the quiet zone)
        const q = b.qr, n = q ? q.size + 8 : 1, px = Math.max(2, Math.floor(hh / n)), side = n * px;
        const qx = MARGIN + Math.round((392 - side) / 2), qy = top + Math.round((hh - side) / 2);
        cv.roundRect(qx, qy, side, side, Math.min(18, 3 * px), '#ffffff');
        if (q) QR_().draw(cv, q, qx, qy, px, { light: null });
        const rx = MARGIN + 392 + 14, rw = R - rx;
        card(cv, rx, top, rw, hh, 'Send it from your phone');
        let y = top + 52;
        y = stepRow(cv, 1, rx + 20, y, rw - 40, 'Scan the code with your phone camera.');
        y = stepRow(cv, 2, rx + 20, y, rw - 40, 'Sign in to GitHub if it asks. No account? Make a free one at github.com/signup: an email, a password and a user name.');
        y = stepRow(cv, 3, rx + 20, y, rw - 40, 'Check the text, write what happened, and press Submit.');
        wrap(cv, 'The code holds only the link. Nothing is sent until you press Submit on the phone.', 15, rw - 40)
            .forEach((ln, i) => cv.text(ln, rx + 20, y + 6 + i * 21, 15, C.dim, { literal: true }));
        const by = top + hh - 20 - 44;
        if (b.trimmed) cv.text('The log was shortened to fit the code.', rx + 20, by - 14, 15, C.amber, { literal: true });
        const dw = Math.ceil(cv.textWidth('Done', 17, { font: 'bold' })) + 44;
        button(cv, rx + rw - 20 - dw, by, 'Done', close, { filled: true, key: 'repdone' });
        button(cv, rx + 20, by, 'Back', () => flow.back(), { key: 'repback' });
        if (q) cv.text('version ' + q.version + ', level ' + b.ecl, rx + rw - 20 - dw - 20, by + 28, 13, '#646a74', { align: 'right', literal: true });
    }
    if (fade) cv.alpha(1);
}
let qrLib = null;
function QR_() {
    if (!qrLib) { try { qrLib = require('./garage_qr'); } catch (e) { qrLib = require('./qr'); } }
    return qrLib;
}

/**
 * The How to use topic every app adds to its own (owner, 19:41: the README and the apps say that reports speed up
 * development). Its picture: a phone moving over a QR code, its scan line sweeping, then a tick.
 */
const REPORT_TOPIC = {
    title: 'Send a report',
    text: 'Something wrong, or a value missing? Settings, Send a report. First a screen shows every line that goes in: the app and ' +
        'its version, iDrive and firmware, the engine as the app found it, your changed settings and the last warnings and errors ' +
        'of the app. No location, nothing about your phone, and the VIN only if you tick it.\n\nThen a QR code: scan it with your ' +
        'phone camera, sign in to GitHub (free), check the text and press Submit. The car needs no internet and no account, and ' +
        'every report helps us fix things faster.',
    note: 'Nothing is sent until you press Submit on your phone.',
    draw: reportArt,
};
let artCode = null;
function reportArt(cv, x, y, w, h, t) {
    if (!artCode) artCode = QR_().encode('https://github.com/Paget96/Paget96-Garage', { ecl: 'M' });
    const q = artCode, px = 6, side = (q.size + 8) * px, qx = Math.round(x + w * 0.3 - side / 2), qy = Math.round(y + (h - side) / 2);
    cv.roundRect(qx - 6, qy - 6, side + 12, side + 12, 16, '#ffffff');
    QR_().draw(cv, q, qx, qy, px);
    // the phone glides over the code and back, its scan line sweeping; a tick when it has read it
    const cyc = t % 4, k = cyc < 1.6 ? cyc / 1.6 : cyc < 2.6 ? 1 : 1 - (cyc - 2.6) / 1.4, e = k * k * (3 - 2 * k);
    const pw = 150, ph = 270, px0 = x + w * 0.78 - pw / 2, pxx = px0 + (qx + side / 2 - pw / 2 - px0) * e * 0.55, py = y + (h - ph) / 2;
    cv.roundRect(pxx, py, pw, ph, 26, '#1b1e24');
    cv.strokeRoundRect(pxx, py, pw, ph, 26, 3, '#8c94a0');
    cv.roundRect(pxx + 10, py + 30, pw - 20, ph - 60, 12, '#0b0c0f');
    const sy = py + 40 + ((t * 120) % (ph - 80));
    if (cyc < 2.6) cv.line(pxx + 18, sy, pxx + pw - 18, sy, 3, withAlpha(C.accent, 0.9));
    if (cyc >= 1.6 && cyc < 2.6) {
        const cx = pxx + pw / 2, cy = py + ph / 2;
        cv.circle(cx, cy, 34, C.green);
        cv.stroke([[cx - 15, cy + 1], [cx - 4, cy + 12], [cx + 16, cy - 11]], 6, C.dark);
    }
    cv.text('github.com', pxx + pw / 2, py + ph - 12, 13, C.dim, { align: 'center', literal: true });
}

module.exports = {
    dialog, dialogButton,
    W, H, MARGIN, HEAD_CY, TITLE_CY, CLOCK_CY, CONTENT_TOP, C, STATUS, CREDIT, LINKS, DISPLAY_SETTINGS, DISPLAY_DEFAULTS,
    setLayout, standard, attach, reportPage, reportButton, REPORT_TOPIC, tabTouch, pressOrder,
    background, title, clock, tabs, nextTab, header, iconButton, backPill, status, glass, card, stat, cylinders, spark, curve, smoothPts, bar, ring, pill, chart, dualChart,
    button, segmented, toggle, stepper, settingsPage, howToUse, infoPopup, openInfo, closeInfo, overlay,
    niceRange, fmtTick, wrap, anim, glide, glowRoundRect, glowArc, glowText,
};
