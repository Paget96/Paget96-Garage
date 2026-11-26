// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Paget96 Garage renderer link: our apps draw through p96-renderd (renderer/) when it is installed and running, and
 * through the renderers they always used when it is not. Loaded once by lib/ui.js; ships as garage_render.js beside
 * an app's main.js (tools/build.py). The kit itself (upstream-kit/) is never edited: this file adds to it at load.
 *
 * Which renderer, in order (the kit's RenderClient goes down its socket list):
 *   1. p96-renderd   /run/p96-renderd/render.sock   ours, beside the others (own socket, ivi ids, touch table)
 *   2. mgu-render    /run/mgu-render/render.sock   the Store's renderer (mgu-render/1: the kit's full layout, touch)
 *   3. the rest of the kit's list (idrive7-renderd, /run/mgu-renderd/renderd.sock, the upstream dialect)
 * The kit's own list has idrive7-renderd first. On the owner's car (2026-11-26 20:37) that meant the upstream
 * dialect: no mgu-render/1, so the kit's standard frame, the page got no touch at all and only the HMI's tabs and
 * the knob worked. With the Store's renderer ahead of it, the kit runs the screen and the page gets touch.
 *   4. software      the kit draws into the HMI's image when no socket answers (as today)
 * A socket file nobody listens on (a stopped renderer) passes to the next one: the kit's own fallback. A car with
 * only the Store's renderer sees no change at all: our socket is not there, so the list is the kit's.
 *
 * P9, our protocol extensions (renderer/src/proto.h): the app asks for them in its HELLO ("p96=1" beside
 * "proto=mgu-render/1"; other renderers ignore the field) and p96-renderd answers P9_READY with what it can draw. Only
 * frames for a connection that got P9_READY carry P9 ops (cv.p96 holds its caps, set per frame in Display.canvas);
 * every other frame, cached layer and renderer gets the kit's own ops, so nothing changes where ours is not running.
 *   poly(cv, pts, width, c)        one polyline, round caps and joins, not darker where see-through segments meet;
 *                                  every cv.stroke / cv.polyline on a P9 frame goes this way by itself
 *   rclip(cv, x, y, w, h, r)       what follows clipped to a rounded rect, until cv.noclip()
 *
 * Performance overlay (setting 'perfOverlay', Display card, off by default): a small pill at the page's bottom left
 * with the frames sent a second and the renderer's fps and ms a frame (its STATS, any renderer), and which renderer
 * draws. Costs a few ops a frame while on, nothing while off.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */
function kit(name) {
    try { return require('./kit/' + name); }                                 // inside a built app
    catch (e) { return require('../upstream-kit/kit/runtime/' + name); }     // in the Paget96 Garage repo (demo, tests)
}

const P96_SOCKET = process.env.P96_RENDERD_SOCKET || '/run/p96-renderd/render.sock';
const MGU_RENDER_SOCKET = '/run/mgu-render/render.sock';   // the Store's renderer

let renderd = null;
try { renderd = kit('renderd'); } catch (e) { renderd = null; }

/**
 * Put our socket first in the kit's list, once. Not when the kit is pointed at one renderer on purpose
 * (MGU_RENDERD_SOCKET: the emulator, a test): that one stays the only one.
 */
function preferOurs() {
    if (!renderd || !Array.isArray(renderd.SOCKETS) || process.env.MGU_RENDERD_SOCKET) return false;
    if (process.env.P96_RENDERD === 'off') return false;
    const list = renderd.SOCKETS;
    // the Store's renderer first, ours after it (2026-11-26 20:57: on the owner's car no page tap arrived with ours
    // first; the Store's renderer 0.6.26 is the one every app there is known to work with)
    [P96_SOCKET, MGU_RENDER_SOCKET].forEach((sock) => {
        const at = list.indexOf(sock);
        if (at >= 0) list.splice(at, 1);
        list.unshift(sock);
    });
    return true;
}
const installed = preferOurs();

/* ---------- P9 ---------- */
const P9_READY = 0x50390101;
const CAP = { POLY: 1, RCLIP: 2, SAME_FRAME: 4 };
const OP_P9_POLY = 0x50390011, OP_P9_RCLIP = 0x50390012;

function patchClient() {
    if (!renderd || !renderd.RenderClient || renderd.RenderClient.prototype._p96) return false;
    const RC = renderd.RenderClient.prototype;
    RC._p96 = true;
    const hello = RC._hello, data = RC._data;
    // a new connection: no P9 until this renderer says so
    RC._hello = function () {
        this.p96 = null;
        const b = hello.call(this);
        return this.opts && this.opts.native && process.env.P96_RENDERD_P9 !== 'off' ? Buffer.concat([b, Buffer.from([0]), Buffer.from('p96=1')]) : b;
    };
    // P9_READY comes before READY; the kit's reader skips a type it does not know, so it is looked for here first
    RC._data = function (d) {
        const buf = this.inbuf && this.inbuf.length ? Buffer.concat([this.inbuf, d]) : d;
        let o = 0;
        while (buf.length - o >= 8) {
            const type = buf.readUInt32LE(o), len = buf.readUInt32LE(o + 4);
            if (buf.length - o < 8 + len) break;
            if (type === P9_READY && len >= 8) {
                this.p96 = { version: buf.readUInt32LE(o + 8), caps: buf.readUInt32LE(o + 12) };
                if (this.log && this.log.info) this.log.info('renderd: p96-renderd, P9 ' + this.p96.version + ' caps ' + this.p96.caps);
            }
            o += 8 + len;
        }
        return data.call(this, d);
    };
    return true;
}

let display = null;
try { display = kit('display'); } catch (e) { display = null; }

function patchDisplay() {
    if (!display || !display.Display || display.Display.prototype._p96) return false;
    const D = display.Display.prototype;
    D._p96 = true;
    const canvas = D.canvas, send = D._send;
    // what the frame being recorded may use: the caps of a P9 connection it goes to, else nothing
    D.canvas = function (w, h) {
        const r = canvas.call(this, w, h);
        r.p96 = this.active() && this.gpu && this.gpu.p96 ? this.gpu.p96.caps : 0;
        return r;
    };
    D._send = function (name, out, softImage, force) {
        if (this.settings && this.settings.get('perfOverlay') && this.gpu && out && out.words) overlay(this, out);
        return send.call(this, name, out, softImage, force);
    };
    return true;
}

/** One polyline through pts ([[x, y], ...]) on a P9 frame; false: not here (the caller draws it the kit's way). */
function poly(cv, pts, width, c) {
    if (!cv || !(cv.p96 & CAP.POLY) || !cv._grow || !pts || pts.length < 2 || !recmod) return false;
    const n = pts.length;
    cv._grow(4 + n * 2);
    const u = cv.u, f = cv.f;
    let i = cv.n;
    u[i++] = OP_P9_POLY; f[i++] = width; u[i++] = recmod.pack(c); u[i++] = n;
    for (let k = 0; k < n; k++) { f[i++] = pts[k][0]; f[i++] = pts[k][1]; }
    cv.n = i;
    return true;
}
/** What follows clipped to a rounded rect on a P9 frame (ends with cv.noclip()); false: not here. */
function rclip(cv, x, y, w, h, r) {
    if (!cv || !(cv.p96 & CAP.RCLIP) || !cv._grow) return false;
    cv._grow(6);
    const u = cv.u, f = cv.f, i = cv.n;
    u[i] = OP_P9_RCLIP; f[i + 1] = x; f[i + 2] = y; f[i + 3] = w; f[i + 4] = h; f[i + 5] = r;
    cv.n = i + 6;
    return true;
}

let recmod = null;
try { recmod = kit('record'); } catch (e) { recmod = null; }

/* ---------- performance overlay ---------- */
const perf = { t: 0, sent: 0, rate: 0, text: '' };
/** The overlay's text from what the display knows: frames sent a second, the renderer's STATS. */
function perfText(d, now) {
    perf.sent++;
    if (now - perf.t >= 1000) {
        perf.rate = perf.t ? Math.round(perf.sent * 1000 / (now - perf.t)) : 0;
        perf.t = now; perf.sent = 0;
        const g = d.gpuStats, who = d.gpu && d.gpu.p96 ? 'p96-renderd' : d.gpu && d.gpu.path ? String(d.gpu.path).split('/').pop() : 'renderer';
        perf.text = perf.rate + ' sent/s' + (g ? '  ' + g.fps + ' fps  ' + (g.avgUs / 1000).toFixed(1) + ' ms  max ' + (g.maxUs / 1000).toFixed(1) : '') + '  ' + who;
    }
    return perf.text;
}
function overlay(d, out) {
    const txt = perfText(d, Date.now());
    if (!txt || !out.roundRect || !out.text) return;
    const w = Math.ceil(out.textWidth ? out.textWidth(txt, 15, { font: 'bold' }) : txt.length * 8) + 28;
    out.roundRect(14, 520 - 40, w, 28, 14, [0, 0, 0, 190]);
    out.text(txt, 28, 520 - 21, 15, [120, 230, 160, 255], { font: 'bold', literal: true });
}

/* every line the kit, lib/ui.js and the apps draw (Recorder.stroke and polyline: one LINE op a segment, darker where
   see-through segments overlap) is one P9 polyline on a P9 frame */
function patchRecorder() {
    if (!recmod || !recmod.Recorder || recmod.Recorder.prototype._p96) return false;
    const RP = recmod.Recorder.prototype, polyline = RP.polyline;
    RP._p96 = true;
    RP.polyline = function (pts, width, c) { return poly(this, pts, width, c) ? this : polyline.call(this, pts, width, c); };
    return true;
}

const p9 = { client: patchClient(), display: patchDisplay(), recorder: patchRecorder() };

module.exports = { P96_SOCKET, installed, preferOurs, p9, CAP, poly, rclip, perfText };
