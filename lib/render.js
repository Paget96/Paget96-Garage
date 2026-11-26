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
 *   2. mgu-render    the kit's own list as it was: the Store's renderer, then the community socket
 *   3. software      the kit draws into the HMI's image when no socket answers (as today)
 * A socket file nobody listens on (a stopped renderer) passes to the next one: the kit's own fallback. A car with
 * only the Store's renderer sees no change at all: our socket is not there, so the list is the kit's.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */
function kit(name) {
    try { return require('./kit/' + name); }                                 // inside a built app
    catch (e) { return require('../upstream-kit/kit/runtime/' + name); }     // in the Paget96 Garage repo (demo, tests)
}

const P96_SOCKET = process.env.P96_RENDERD_SOCKET || '/run/p96-renderd/render.sock';

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
    if (list[0] === P96_SOCKET) return true;
    const at = list.indexOf(P96_SOCKET);
    if (at >= 0) list.splice(at, 1);
    list.unshift(P96_SOCKET);
    return true;
}
const installed = preferOurs();

module.exports = { P96_SOCKET, installed, preferOurs };
