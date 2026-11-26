// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Pictures as the car shows them (owner, 2026-11-26 22:18: README pictures must show the side menu, never the old
 * header): preload with `node -r ./tools/carframe.js tools/<app>_shots.js`. Every 1600 x 520 page a shot tool draws is
 * drawn in the side menu layout with the room the iDrive 7 screen has below it, and every picture it writes is the
 * whole 1920 x 720 screen: the HMI's status strip and back arrow column, and the page placed as the kit places it
 * (display.js FULL.bare). A tool tells the menu what to list with CF.tabs = () => [names, page index, mode].
 * GARAGE_FRAME=off leaves the tools as they were.
 */
const path = require('path');
if (process.env.GARAGE_FRAME !== 'off') {
    const RT = path.join(__dirname, '..', 'upstream-kit', 'kit', 'runtime');
    const REC = require(path.join(RT, 'record')), CAN = require(path.join(RT, 'canvas'));
    const UI = require('../lib/ui');
    const SW = 84 + 180 + 1600, SH = 720, LEFT = 84, STRIP = 76, GAP = 6, RAIL = 180, TOP = 100;
    // drawn 1:1 (the software canvas blends scaled layers badly); the car scales the same picture by 1.031
    const S = 1, OX = LEFT + Math.round(RAIL * S), OY = Math.round(STRIP + GAP - TOP * S);
    const EXTRA = Math.floor((SH - GAP - OY) / S - 520);
    UI.useRail(true);
    const CF = module.exports = { tabs: null, clock: '22:10' };
    global.CF = CF;
    const BaseRec = REC.Recorder;
    class Rec extends BaseRec {
        constructor(w, h, o) {
            super(w, h, o);
            if (w === 1600 && h === 520) { this.place = { full: true }; this._extra = EXTRA; }
        }
    }
    REC.Recorder = Rec;
    const BaseCan = CAN.Canvas;
    class Can extends BaseCan {
        constructor(w, h) {
            const frame = w === 1600 && h === 520;
            super(frame ? SW : w, frame ? SH : h);
            this.carFrame = frame;
        }
    }
    CAN.Canvas = Can;
    /** Draws the page's logical coordinates onto the screen canvas: x * S + OX, y * S + OY. */
    class Off {
        constructor(c) { this.c = c; this.w = 1600; this.h = 520; }
        X(v) { return v * S + OX; }
        Y(v) { return v * S + OY; }
        P(pts) { return pts.map((q) => [this.X(q[0]), this.Y(q[1])]); }
        clear() { return this; }
        fillRect(x, y, w, h, c) { this.c.fillRect(this.X(x), this.Y(y), w * S, h * S, c); return this; }
        gradientRect(x, y, w, h, st) { this.c.gradientRect(this.X(x), this.Y(y), w * S, h * S, st); return this; }
        roundRect(x, y, w, h, r, c) { this.c.roundRect(this.X(x), this.Y(y), w * S, h * S, r * S, c); return this; }
        strokeRoundRect(x, y, w, h, r, lw, c) { this.c.strokeRoundRect(this.X(x), this.Y(y), w * S, h * S, r * S, lw * S, c); return this; }
        card(x, y, w, h, r, st) { this.c.card(this.X(x), this.Y(y), w * S, h * S, r * S, st); return this; }
        rampRect(x, y, w, h, r, st, sx, sw) { this.c.rampRect(this.X(x), this.Y(y), w * S, h * S, r * S, st, sx === undefined ? sx : this.X(sx), sw === undefined ? sw : sw * S); return this; }
        arc(cx, cy, r0, r1, a0, a1, c, o) { this.c.arc(this.X(cx), this.Y(cy), r0 * S, r1 * S, a0, a1, c, o); return this; }
        line(xa, ya, xb, yb, lw, c) { this.c.line(this.X(xa), this.Y(ya), this.X(xb), this.Y(yb), lw * S, c); return this; }
        quad(pts, c) { this.c.convex(this.P(pts), c); return this; }
        triangle(pts, c) { this.c.convex(this.P(pts), c); return this; }
        fillPolys(polys, c) { this.c.fillPolys(polys.map((q) => this.P(q)), c); return this; }
        drawImage(src, sw, sh, x, y, w, h) { this.c.drawImage(src, sw, sh, this.X(x), this.Y(y), w * S, h * S); return this; }
        blit(src, x, y) { this.c.blit(src, this.X(x), this.Y(y)); return this; }     // blends (drawImage is opaque)
        _blit(f, gx, gy, gw, gh, dx, dy, sc, col) { this.c._blit(f, gx, gy, gw, gh, this.X(dx), this.Y(dy), sc * S, col); }
    }
    const basePlay = REC.play;
    REC.play = (words, cv) => {
        if (!(cv && cv.carFrame)) return basePlay(words, cv);
        cv.fillRect(0, 0, SW, SH, '#000000');
        basePlay(words, new Off(cv));
        // the HMI around the page: its status strip (home, the clock) and the back arrow column
        const o = new BaseRec(SW, SH);
        o.fillRect(0, 0, SW, STRIP, '#000000');
        o.fillRect(0, STRIP - 2, SW, 2, '#2a2d33');
        o.fillRect(0, 0, LEFT, STRIP - 2, '#15171b');
        o.fill([[42, 22], [62, 38], [56, 38], [56, 54], [28, 54], [28, 38], [22, 38]], '#ffffff');
        o.fillRect(0, STRIP, LEFT, SH - STRIP, '#000000');
        o.stroke([[50, 342], [34, 360], [50, 378]], 4, '#ffffff');
        o.text(CF.clock, SW - 40, 50, 34, '#ffffff', { align: 'right', literal: true });
        return basePlay(o.words(), cv);
    };
    // every page draws its background first: the menu lists the tool's pages with the one shown lit
    const background = UI.background;
    UI.background = function () {
        if (CF.tabs) { const t = CF.tabs(); if (t) UI.menu(t[0], t[1], t[2]); }
        return background.apply(this, arguments);
    };
}
