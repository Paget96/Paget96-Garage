// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * lib/render.js: our apps try p96-renderd first and fall back to the renderers they always used.
 * Real unix sockets in a temporary folder stand in for the renderers; the kit's own RenderClient connects.
 *   node tests/render.test.js
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p96rd-'));
const OURS = path.join(dir, 'p96.sock'), STORE = path.join(dir, 'store.sock'), COMMUNITY = path.join(dir, 'community.sock');
process.env.P96_RENDERD_SOCKET = OURS;
delete process.env.MGU_RENDERD_SOCKET;

const renderd = require('../upstream-kit/kit/runtime/renderd');
const kitList = renderd.SOCKETS.slice();
const R = require('../lib/render');
let failed = 0;
function check(name, fn) {
    return Promise.resolve().then(fn).then(() => console.log('ok   ' + name), (e) => { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); });
}


const log = { info() {}, warn() {}, error() {} };
function server(p) {
    const s = net.createServer((c) => { s.got = true; c.on('data', () => {}); });
    s.got = false;
    return new Promise((res) => s.listen(p, () => res(s)));
}
function close(s) { return new Promise((res) => s.close(() => res())); }
/** Connect a client; resolve with the name of the stand-in that saw it. */
function whoGets(servers, ms) {
    const c = new renderd.RenderClient('p96_test', log, { native: true });
    c.connect();
    return new Promise((res) => {
        const t0 = Date.now();
        const poll = setInterval(() => {
            const k = Object.keys(servers).find((n) => servers[n].got);
            if (k || Date.now() - t0 > ms) { clearInterval(poll); c.close(); res(k || null); }
        }, 20);
    });
}

(async () => {
    await check('our socket is first, the kit\'s list follows unchanged', () => {
    assert.strictEqual(R.installed, true);
    assert.deepStrictEqual(renderd.SOCKETS, [OURS].concat(kitList));
    R.preferOurs();
    assert.deepStrictEqual(renderd.SOCKETS, [OURS].concat(kitList), 'twice: still once');
});
    // the rest use stand-in renderers in the temp folder, in the same order
    renderd.SOCKETS.splice(0, renderd.SOCKETS.length, OURS, STORE, COMMUNITY);
    await check('ours running: the app connects to p96-renderd', async () => {
        const s = { ours: await server(OURS), store: await server(STORE) };
        assert.strictEqual(renderd.RenderClient.available(), true);
        assert.strictEqual(await whoGets(s, 2000), 'ours');
        await close(s.ours); await close(s.store);
    });
    await check('ours not installed: the Store\'s renderer, as today', async () => {
        const s = { store: await server(STORE) };
        assert.strictEqual(await whoGets(s, 2000), 'store');
        await close(s.store);
    });
    await check('ours stopped (its socket file left behind): the next one', async () => {
        const s = { store: await server(STORE) };
        // a unix socket file nobody listens on (bound, never listened, the process gone)
        require('child_process').execFileSync('python3', ['-c', 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])', OURS]);
        assert.ok(fs.statSync(OURS).isSocket());
        assert.strictEqual(await whoGets(s, 8000), 'store');
        await close(s.store);
        try { fs.unlinkSync(OURS); } catch (e) { /* gone */ }
    });
    await check('no renderer at all: nothing to connect to (the kit draws in software)', () => {
        assert.strictEqual(renderd.RenderClient.available(), false);
    });
    await check('P96_RENDERD=off or MGU_RENDERD_SOCKET leave the kit\'s list alone', () => {
        const list = renderd.SOCKETS.splice(0, renderd.SOCKETS.length, 'a', 'b');
        process.env.P96_RENDERD = 'off';
        assert.strictEqual(R.preferOurs(), false);
        delete process.env.P96_RENDERD;
        process.env.MGU_RENDERD_SOCKET = '/x';
        assert.strictEqual(R.preferOurs(), false);
        delete process.env.MGU_RENDERD_SOCKET;
        assert.deepStrictEqual(renderd.SOCKETS, ['a', 'b']);
        renderd.SOCKETS.splice(0, 2, ...list);
    });
    fs.rmSync ? fs.rmSync(dir, { recursive: true, force: true }) : null;
    console.log(failed ? failed + ' failed' : 'all passed');
    process.exit(failed ? 1 : 0);
})();
