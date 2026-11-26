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
 */
function kit(name) {
    try { return require('./kit/' + name); }                                 // inside a built app
    catch (e) { return require('../upstream-kit/kit/runtime/' + name); }     // in the Paget96 Garage repo (demo, tests)
}
const G = kit('gauges');
const { withAlpha, mix } = kit('canvas');

const W = 1600, H = 520;
const HEAD_CY = 50;   // the header row's one centre line (owner, 17:17): title, tabs, pill and buttons all sit on it
const CONTENT_TOP = 112; // content starts under the header row and the tab dots
const MARGIN = 28;      // page margin: the title on the left, the Settings button and the content on the right

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

/** App name, top left, orange with a soft glow. Cached. */
function title(cv, name, x, y) {
    const size = 24;
    x = x == null ? 28 : x; y = y == null ? HEAD_CY + Math.round(size * 0.36) : y;   // baseline that centres the caps on HEAD_CY
    const pad = 16, tw = Math.ceil(cv.textWidth(name, size, { font: 'bold', literal: true }));
    cv.blit(G.layer('p96title|' + name, tw + 2 * pad, size + 2 * pad, (c) => glowText(c, name, pad, pad + size * 0.8, size, C.accent, { font: 'bold' }, 6, 1), cv.textScale), x - pad, y - size * 0.8 - pad);
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
    const x0 = opts.x == null ? 270 : opts.x, bh = opts.h || 56, y0 = opts.y == null ? HEAD_CY - bh / 2 : opts.y;
    const size = 20, padX = 28, gap = 8, inset = 6, th = bh - 2 * inset;
    const widths = items.map((str) => Math.ceil(cv.textWidth(str, size, { font: 'bold' })) + 2 * padX);
    const stripW = widths.reduce((a, b) => a + b + gap, 0) - gap;
    const bw = opts.w || 900, inner = bw - 2 * (inset + 4), scrolls = stripW > inner;
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
    const key = 'p96tabs|' + x0 + '|' + y0;
    const off = scrolls ? G.smooth(key, want, 10) : 0;
    const glow = 18;
    // the bar (glass), cached
    cv.blit(G.layer('p96tabbar|' + bw + '|' + bh, bw + 2 * glow, bh + 2 * glow, (c) => glass(c, glow, glow, bw, bh, bh / 2), cv.textScale), x0 - glow, y0 - glow);
    // the strip of pills, cached per selection, moved by the scroll
    const sx = x0 + inset + 4 - Math.round(off), sy = y0 + inset;
    if (cv.clip) cv.clip(x0 + 2, y0 - glow, bw - 4, bh + 2 * glow);
    cv.blit(G.layer('p96tabstrip|' + items.join('\u0001') + '|' + sel + '|' + bh, stripW + 2 * glow, th + 2 * glow, (c) => {
        items.forEach((str, i) => {
            const rx = glow + lefts[i], ry = glow;
            if (i === sel) {
                glowRoundRect(c, rx, ry, widths[i], th, th / 2, C.accent, 14, 0.9);
                c.roundRect(rx, ry, widths[i], th, th / 2, C.accent);
            }
            c.text(str, rx + widths[i] / 2, ry + th / 2 + size * 0.36, size, i === sel ? C.dark : C.dim, { font: 'bold', align: 'center' });
        });
    }, cv.textScale), sx - glow, sy - glow);
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
        rects.forEach((r, i) => {
            const vx = Math.max(r.x, x0), vw = Math.min(r.x + r.w, x0 + bw) - vx;
            cv.target(vw > 8 ? vx : r.x, r.y, vw > 8 ? vw : r.w, r.h, () => opts.onSelect(i), 'p96tab' + i, r.h / 2);
        });
    }
    return rects;
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
/** The close glyph: an X of two round-ended strokes. */
function closeGlyph(cv, cx, cy, c) {
    const d = 9;
    cv.line(cx - d, cy - d, cx + d, cy + d, 4, c);
    cv.line(cx - d, cy + d, cx + d, cy - d, 4, c);
}
/** A round glass icon button, kind 'help', 'settings' or 'close'. No label under it: it would push the button off the header's centre line (owner, 17:17). */
function iconButton(cv, cx, cy, kind) {
    const r = 30, glow = 4, S = r + glow;
    cv.blit(G.layer('p96btn|' + kind, 2 * S + 40, 2 * S, (c) => {
        const x = S + 20;
        c.circle(x, S, r, C.glassFill);
        c.arc(x, S, r - 1.5, r, 0, 360, C.glassLine);
        if (kind === 'help') helpGlyph(c, x, S, C.accent);
        else if (kind === 'close') closeGlyph(c, x, S, C.accent);
        else gearGlyph(c, x, S, C.accent);
    }, cv.textScale), cx - S - 20, cy - S);
}
/**
 * The top right of every Paget96 Garage page (owner, 2026-11-26): a status pill (LIVE / demo) and two separate
 * round glass buttons, "How to use" (?) and "Settings" (gear). Both pages are mandatory in every app.
 * They sit flush right at the title's margin (28 px); the status pill is left of them.
 * opts: { status: 'LIVE', statusColor: 'ok', onHelp, onSettings, right }. All on HEAD_CY, no labels under the buttons.
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
    iconButton(cv, helpX, HEAD_CY, 'help');
    iconButton(cv, setX, HEAD_CY, 'settings');
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

/* ---------- cards ---------- */

/** A glass card: white 6 % fill, 10 % outline, radius 22. Draws straight onto cv (put it in a layer). */
function glass(cv, x, y, w, h, r) {
    r = r == null ? 22 : r;
    cv.roundRect(x, y, w, h, r, C.glassFill);
    cv.strokeRoundRect(x, y, w, h, r, 1.5, C.glassLine);
}
/**
 * The small (i) top right of every card (owner, 17:35): a dim ring and an "i". Dim, not the accent:
 * it sits in the card's cached layer and must not change with the ambient light.
 */
function infoDot(cv, cx, cy) {
    cv.arc(cx, cy, 10, 12, 0, 360, C.dim);
    cv.text('i', cx, cy + 5.5, 15, C.dim, { font: 'bold', align: 'center', literal: true });
}
const INFO_DX = 30, INFO_DY = 30;   // the (i)'s centre from the card's top right corner
/** The (i) is on every card; onInfo makes the whole card a touch and knob target that opens its popup. */
function cardInfo(cv, x, y, w, h, onInfo, r) {
    if (typeof onInfo === 'function' && cv.target) cv.target(x, y, w, h, onInfo, 'p96info|' + x + '|' + y, r == null ? 22 : r);
}
/**
 * A glass card as a cached layer, with an optional uppercase label and the (i) top right (owner, 17:35).
 * onInfo: a function opens the card's info popup on a tap (infoPopup()); false leaves the (i) out (a
 * card inside a popup or a page that is itself the explanation).
 */
function card(cv, x, y, w, h, label, r, onInfo) {
    const dot = onInfo !== false;
    cv.blit(G.layer('p96card|' + w + '|' + h + '|' + (label || '') + '|' + (r || 22) + '|' + (dot ? 'i' : ''), w, h, (c) => {
        glass(c, 0, 0, w, h, r);
        if (label) c.text(String(label).toUpperCase(), 20, 30, 15, C.dim, { font: 'bold', spacing: 1 });
        if (dot) infoDot(c, w - INFO_DX, INFO_DY);
    }, cv.textScale), x, y);
    cardInfo(cv, x, y, w, h, onInfo, r);
}

/** Catmull-Rom through pts, `k` steps a segment: every Paget96 Garage line is a smooth curve. */
function smoothPts(pts, k) {
    if (pts.length < 3) return pts;
    const P = [pts[0]].concat(pts, [pts[pts.length - 1]]), out = [];
    k = k || 8;
    for (let i = 1; i < P.length - 2; i++) {
        const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
        for (let s = 0; s < k; s++) {
            const t = s / k, t2 = t * t, t3 = t2 * t;
            out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
}
/** A line with round caps and round joins along a smoothed curve. */
function curve(cv, pts, width, c) { cv.stroke(smoothPts(pts), width, c); }

/** Sparkline: vals scaled into the box, a smooth 4 px line with round ends in the status colour. */
function spark(cv, x, y, w, h, vals, c) {
    const v = (vals || []).filter(G.isNum);
    if (v.length < 2) return;
    let lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pts = v.map((n, i) => [x + i * w / (v.length - 1), y + h - (n - lo) / (hi - lo) * h]);
    curve(cv, pts, 4, colour(c));
}

/** A progress bar with fully round ends: track and fill. frac 0..1. */
function bar(cv, x, y, w, h, frac, c) {
    cv.roundRect(x, y, w, h, h / 2, C.track);
    const f = G.clamp(frac || 0, 0, 1);
    if (f > 0) cv.roundRect(x, y, Math.max(h, w * f), h, h / 2, colour(c));
}

/**
 * Stat card: g = { label, value, decimals, unit, sub, color, history }. color names the status
 * ('ok' green, 'warm' amber, 'accent' orange, 'dim', 'bad', 'info' or a '#hex'); it colours the sub
 * line and the sparkline. value null shows "--". g.onInfo opens the card's info popup (see card()).
 */
function stat(cv, x, y, w, h, g) {
    card(cv, x, y, w, h, g.label, null, g.onInfo);
    const vs = G.isNum(g.value) ? G.fmt(g.value, g.decimals) : g.value != null ? String(g.value) : '--';
    const vw = cv.text(vs, x + 20, y + 80, 48, G.isNum(g.value) || g.value != null ? C.text : C.dim, { font: 'num', literal: true });
    if (g.unit) cv.text(g.unit, x + 28 + vw, y + 76, 18, C.dim);
    if (g.sub) cv.text(g.sub, x + 20, y + h - 20, 15, colour(g.color));
    if (g.history) spark(cv, x + w - 130, y + 52, 110, 40, g.history, g.color || C.orange);   // under the (i)
}

/* ---------- hero ring ---------- */
const RING_A0 = -135, RING_SPAN = 270;
/**
 * The hero ring gauge for an app's one main number: dark track, orange arc with a glow, the value
 * big in the middle, a unit line under it and an uppercase label below the ring.
 * g = { value, min, max, decimals, text, unit, label, color }. The arc glides (gauges.smooth).
 */
function ring(cv, cx, cy, r, g) {
    const th = g.thick || 14, glow = 18, S = r + glow + 2;
    const min = g.min || 0, max = g.max == null ? 1 : g.max;
    cv.blit(G.layer('p96ring|' + r + '|' + th + '|' + (g.label || ''), 2 * S, 2 * S + 40, (c) => {
        c.arc(S, S, r - th / 2, r + th / 2, RING_A0, RING_A0 + RING_SPAN, C.track, { round: true });
        if (g.label) c.text(String(g.label).toUpperCase(), S, S + r + 8, 16, C.dim, { font: 'bold', align: 'center', spacing: 1 });
    }, cv.textScale), cx - S, cy - S);
    const sv = g.smooth === false ? g.value : G.smooth('p96ring|' + cx + '|' + cy, g.value);
    if (G.isNum(sv)) {
        const f = G.clamp((sv - min) / (max - min), 0, 1), a1 = RING_A0 + RING_SPAN * f, c = colour(g.color);
        if (f > 0.003) {
            glowArc(cv, cx, cy, r - th / 2, r + th / 2, RING_A0, a1, c, glow, 0.9);
            cv.arc(cx, cy, r - th / 2, r + th / 2, RING_A0, a1, c, { round: true });
        }
    }
    const vs = g.text != null ? g.text : G.isNum(g.value) ? G.fmt(g.value, g.decimals) : '--';
    cv.text(vs, cx, cy + 8, 72, G.isNum(g.value) || g.text != null ? C.text : C.dim, { font: 'num', align: 'center', literal: true });
    if (g.unit) cv.text(g.unit, cx, cy + 44, 20, C.dim, { align: 'center' });
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
 * A chart in the same style: glass card, faint grid, line series with a soft fill under the first.
 * series = [{ values, color }], opts = { label, min, max, gridLines (4), onInfo } (onInfo: see card()).
 */
function chart(cv, x, y, w, h, series, opts) {
    opts = opts || {};
    const dot = opts.onInfo !== false;
    const top = opts.label || dot ? 48 : 20, px = x + 20, py = y + top, pw = w - 40, ph = h - top - 20, n = opts.gridLines || 4;
    cv.blit(G.layer('p96chart|' + w + '|' + h + '|' + (opts.label || '') + '|' + n + '|' + (dot ? 'i' : ''), w, h, (c) => {
        glass(c, 0, 0, w, h);
        if (opts.label) c.text(String(opts.label).toUpperCase(), 20, 30, 15, C.dim, { font: 'bold', spacing: 1 });
        if (dot) infoDot(c, w - INFO_DX, INFO_DY);
        for (let i = 0; i <= n; i++) c.fillRect(20, top + Math.round(i * ph / n), pw, 1, [255, 255, 255, 18]);
    }, cv.textScale), x, y);
    cardInfo(cv, x, y, w, h, opts.onInfo);
    const all = [];
    series.forEach((s) => (s.values || []).forEach((v) => { if (G.isNum(v)) all.push(v); }));
    if (!all.length) return;
    let lo = opts.min == null ? Math.min.apply(null, all) : opts.min, hi = opts.max == null ? Math.max.apply(null, all) : opts.max;
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    series.forEach((s, si) => {
        const v = s.values || [];
        if (v.length < 2) return;
        const pts = smoothPts(v.map((n2, i) => [px + i * pw / (v.length - 1), py + ph - (G.clamp(n2, lo, hi) - lo) / (hi - lo) * ph]));
        if (si === 0) cv.fillUnder(pts, py + ph, withAlpha(colour(s.color), 0.12));
        cv.stroke(pts, 3, colour(s.color));
    });
}

/* ---------- explaining: the info popup and the How to use page (owner, 2026-11-26 17:35) ---------- */

const tr = kit('i18n').t;
const fitText = kit('text-layout').fitText;
const wrapped = new Map();
/** str (translated first, so whole sentences are translated) broken into lines that fit width. Memoised. */
function wrap(cv, str, size, width, opts) {
    const o = Object.assign({}, opts || {}, { literal: true });
    const key = size + '|' + width + '|' + (o.font || '') + '|' + str;
    if (wrapped.has(key)) return wrapped.get(key);
    const out = [];
    String(tr(String(str))).split('\n').forEach((para) => {
        let line = '';
        para.split(/\s+/).filter(Boolean).forEach((word) => {
            const next = line ? line + ' ' + word : word;
            if (!line || cv.textWidth(next, size, o) <= width) line = next;
            else { out.push(line); line = word; }
        });
        out.push(line);
    });
    if (wrapped.size > 400) wrapped.clear();
    wrapped.set(key, out);
    return out;
}

/**
 * The explanation text: sections [{ head, text }] (what it is, where it comes from, why it matters,
 * normal values), or one plain text. Heads uppercase dim, text wrapped. Stops before maxY; the last
 * line that still fits ends in "...". Returns the y under the last line.
 */
function explain(cv, x, y, w, maxY, sections) {
    const list = typeof sections === 'string' ? [{ text: sections }] : (sections || []);
    const size = 18, lh = 25, o = { literal: true };
    for (let s = 0; s < list.length; s++) {
        if (list[s].head) {
            if (y + 20 > maxY) return y;
            cv.text(String(tr(String(list[s].head))).toUpperCase(), x, y + 15, 14, C.dim, { font: 'bold', spacing: 1, literal: true });
            y += 26;
        }
        const lines = wrap(cv, list[s].text || '', size, w);
        for (let i = 0; i < lines.length; i++) {
            if (y + lh > maxY) {
                cv.text(fitText(cv, lines[i] + '...', size, w, o), x, y + size, size, C.text, o);
                return y + lh;
            }
            cv.text(lines[i], x, y + size, size, C.text, o);
            y += lh;
        }
        y += 14;
    }
    return y;
}

/** Seconds since `since` (ms), the clock an explanation's animation runs on. */
const sinceOpen = (since) => (Date.now() - (since || 0)) / 1000;

/** An overlay takes the knob and the touches: the page's targets under it go. */
function modal(cv) { if (cv.targets) cv.targets.length = 0; }

/** The filled accent button ("Got it"): a pill with a glow, dark bold text. Chrome, so C.accent. */
function button(cv, x, y, w, h, text, run, key) {
    cv.blit(G.layer('p96button|' + w + '|' + h + '|' + text, w + 32, h + 32, (c) => {
        glowRoundRect(c, 16, 16, w, h, h / 2, C.accent, 12, 0.8);
        c.roundRect(16, 16, w, h, h / 2, C.accent);
        c.text(text, 16 + w / 2, 16 + h / 2 + 7, 19, C.dark, { font: 'bold', align: 'center' });
    }, cv.textScale), x - 16, y - 16);
    if (run && cv.target) cv.target(x, y, w, h, run, key || 'p96button|' + text, h / 2);
}

/** When an explanation has no animation yet: a slow pulsing (i). */
function defaultArt(cv, x, y, w, h, t) {
    const cx = x + w / 2, cy = y + h / 2, r = 46 + 6 * Math.sin(t * 2.4);
    cv.arc(cx, cy, r - 5, r, 0, 360, C.dim);
    cv.text('i', cx, cy + 22, 64, C.dim, { font: 'bold', align: 'center', literal: true });
}

const POP = { x: 120, y: 26, w: 1360, h: 468 };
/**
 * The info popup a card opens (owner, 17:35): the page dims, a glass panel shows an animation on the
 * left (what the value is and how it works) and plain text on the right, with a close X top right and
 * a "Got it" button. Draw it last, over the page; it takes the knob and touches while open.
 * p = { title, sections: [{ head, text }] or text, art(cv, x, y, w, h, t), since (ms it opened),
 *       onClose, gotIt ('Got it') }. art draws into the box each frame; t is seconds since `since`.
 */
function infoPopup(cv, p) {
    p = p || {};
    modal(cv);
    const pw = cv.w || W, ph = cv.h || H, b = POP;
    cv.fillRect(0, 0, pw, ph, [0, 0, 0, 170]);
    const ax = b.x + 24, ay = b.y + 24, aw = 480, ah = b.h - 48;
    cv.blit(G.layer('p96pop|' + b.w + '|' + b.h, b.w, b.h, (c) => {
        c.roundRect(0, 0, b.w, b.h, 28, C.bgTop);
        glass(c, 0, 0, b.w, b.h, 28);
        glass(c, 24, 24, aw, ah, 20);
    }, cv.textScale), b.x, b.y);
    (p.art || defaultArt)(cv, ax, ay, aw, ah, sinceOpen(p.since));
    const tx = ax + aw + 36;
    if (p.title) cv.text(p.title, tx, b.y + 64, 28, C.text, { font: 'bold' });
    const bh = 52, bw = 180, by = b.y + b.h - 24 - bh;
    explain(cv, tx, b.y + 92, b.x + b.w - 36 - tx, by - 12, p.sections != null ? p.sections : p.text);
    iconButton(cv, b.x + b.w - 54, b.y + 54, 'close');
    if (p.onClose && cv.target) cv.target(b.x + b.w - 84, b.y + 24, 60, 60, p.onClose, 'p96popclose', 30);
    button(cv, b.x + b.w - 36 - bw, by, bw, bh, p.gotIt || 'Got it', p.onClose, 'p96popok');
}

/**
 * The How to use page behind the ? button (owner, 17:35): the same pattern as the popup on a whole
 * page. Topics on the left (touch and knob targets), the selected topic's animation in the middle,
 * its explanation on the right, a close X top right where the Settings button sits. Up to 6 topics.
 * p = { topics: [{ title, sections or text, art }], sel, onSelect(i), onClose, since, name ('HOW TO USE') }.
 * since: ms the topic was opened, so its animation starts from the beginning.
 */
function helpPage(cv, p) {
    p = p || {};
    modal(cv);
    const topics = p.topics || [], sel = G.clamp(p.sel || 0, 0, Math.max(0, topics.length - 1));
    const pw = cv.w || W, ph = cv.h || H, top = CONTENT_TOP, bottom = ph - 16;
    background(cv, pw, ph);
    title(cv, p.name || 'HOW TO USE');
    const cx = pw - MARGIN - 30;
    iconButton(cv, cx, HEAD_CY, 'close');
    if (p.onClose && cv.target) cv.target(cx - 30, HEAD_CY - 30, 60, 60, p.onClose, 'p96helpclose', 30);
    // topics
    const lx = MARGIN, lw = 340, rh = 54, gap = 10;
    topics.slice(0, 6).forEach((tp, i) => {
        const ry = top + i * (rh + gap), on = i === sel;
        cv.blit(G.layer('p96topic|' + lw + '|' + rh + '|' + tp.title + '|' + (on ? 1 : 0), lw + 28, rh + 28, (c) => {
            if (on) { glowRoundRect(c, 14, 14, lw, rh, rh / 2, C.accent, 12, 0.8); c.roundRect(14, 14, lw, rh, rh / 2, C.accent); }
            else glass(c, 14, 14, lw, rh, rh / 2);
            c.text(fitText(c, tp.title, 19, lw - 48, { font: 'bold' }), 14 + 24, 14 + rh / 2 + 7, 19, on ? C.dark : C.text, { font: 'bold', literal: true });
        }, cv.textScale), lx - 14, ry - 14);
        if (p.onSelect && cv.target) cv.target(lx, ry, lw, rh, () => p.onSelect(i), 'p96topic' + i, rh / 2);
    });
    // the animation, then the text
    const ax = lx + lw + 24, aw = 520, ah = bottom - top;
    card(cv, ax, top, aw, ah, null, 22, false);
    const tp = topics[sel] || {};
    (tp.art || defaultArt)(cv, ax + 16, top + 16, aw - 32, ah - 32, sinceOpen(p.since));
    const tx = ax + aw + 24, tw = pw - MARGIN - tx;
    card(cv, tx, top, tw, ah, null, 22, false);
    if (tp.title) cv.text(tp.title, tx + 28, top + 48, 26, C.text, { font: 'bold' });
    explain(cv, tx + 28, top + 70, tw - 56, bottom - 18, tp.sections != null ? tp.sections : tp.text);
}

module.exports = {
    W, H, MARGIN, HEAD_CY, CONTENT_TOP, C, STATUS, background, title, tabs, nextTab, header, iconButton, status, glass, card, stat, spark, curve, smoothPts, bar, ring, pill, chart,
    infoDot, infoPopup, helpPage, explain, wrap, button,
    glowRoundRect, glowArc, glowText,
};
