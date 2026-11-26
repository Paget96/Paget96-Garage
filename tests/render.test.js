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
    await check('P9: the HELLO asks for it, P9_READY turns it on, another renderer leaves it off', async () => {
        const hellos = [];
        const mk = (p9) => new Promise((res) => {
            const s = net.createServer((c) => {
                c.on('data', (d) => {
                    if (d.readUInt32LE(0) !== 1) return;
                    hellos.push(d.slice(8, 8 + d.readUInt32LE(4)).toString('latin1').replace(/\0+$/, ''));
                    const out = [];
                    if (p9) { const b = Buffer.alloc(16); b.writeUInt32LE(0x50390101, 0); b.writeUInt32LE(8, 4); b.writeUInt32LE(1, 8); b.writeUInt32LE(7, 12); out.push(b); }
                    const r = Buffer.alloc(24); r.writeUInt32LE(101, 0); r.writeUInt32LE(16, 4); r.writeUInt32LE(4, 8); r.writeUInt32LE(1920, 12); r.writeUInt32LE(720, 16);
                    out.push(r);
                    const all = Buffer.concat(out);
                    c.write(all.slice(0, 5)); setTimeout(() => c.write(all.slice(5)), 20);     // cut in two: the reader joins them
                });
            });
            s.listen(OURS, () => res(s));
        });
        for (const p9 of [true, false]) {
            const s = await mk(p9);
            const c = new renderd.RenderClient('p96_test', log, { native: true });
            const ready = new Promise((res) => c.on('ready', res));
            c.connect();
            await ready;
            assert.ok(/\0proto=mgu-render\/1\0p96=1$/.test(hellos[hellos.length - 1]), 'HELLO carries p96=1 after the native field');
            if (p9) assert.deepStrictEqual(c.p96, { version: 1, caps: 7 });
            else assert.strictEqual(c.p96, null);
            c.close(); await close(s);
        }
        const legacy = new renderd.RenderClient('x', log, {});
        assert.strictEqual(legacy._hello().toString(), 'x', 'a legacy HELLO stays the app id alone');
    });
    await check('P9 frames draw one polyline op; every other recorder the kit\'s line ops', () => {
        const { Recorder } = require('../upstream-kit/kit/runtime/record');
        const pts = [[0, 0], [10, 5], [20, 0]];
        const a = new Recorder(100, 100); a.p96 = R.CAP.POLY;
        a.stroke(pts, 4, '#ff8028');
        const w = a.words();
        assert.strictEqual(w[0], 0x50390011);
        assert.strictEqual(w[3], 3);
        assert.strictEqual(w.length, 4 + 6);
        const b = new Recorder(100, 100);
        b.stroke(pts, 4, '#ff8028');
        assert.strictEqual(b.words()[0], 9, 'LINE');
        assert.strictEqual(b.words().length, 14);
        const c = new Recorder(100, 100); c.p96 = R.CAP.RCLIP;
        c.stroke(pts, 4, '#ff8028');
        assert.strictEqual(c.words()[0], 9, 'no POLY cap: LINE');
        assert.strictEqual(R.rclip(c, 0, 0, 10, 10, 4), true);
        assert.strictEqual(R.rclip(b, 0, 0, 10, 10, 4), false);
    });
    await check('Display.canvas marks a frame P9 only for an active P9 connection', () => {
        const { Display } = require('../upstream-kit/kit/runtime/display');
        const d = Object.create(Display.prototype);
        d.recorders = new Map(); d.place = { scale: 1, full: false }; d.screen = {};
        d.own = () => false;
        let act = true;
        d.active = () => act;
        d.gpu = { p96: { caps: 3 } };
        assert.strictEqual(d.canvas(100, 100).p96, 3);
        d.gpu = { p96: null };
        assert.strictEqual(d.canvas(100, 100).p96, 0);
        d.gpu = { p96: { caps: 3 } }; act = false;
        assert.strictEqual(d.canvas(100, 100).p96, 0, 'software path: never');
    });
    await check('performance overlay text: frames sent, the renderer\'s stats, which renderer', () => {
        const d = { gpuStats: { fps: 60, avgUs: 2100, maxUs: 4000 }, gpu: { p96: { caps: 7 } } };
        R.perfText(d, 1000); R.perfText(d, 1500);
        const t = R.perfText(d, 2001);
        assert.ok(/60 fps {2}2\.1 ms {2}max 4\.0 {2}p96-renderd$/.test(t), t);
    });
    fs.rmSync ? fs.rmSync(dir, { recursive: true, force: true }) : null;
    console.log(failed ? failed + ' failed' : 'all passed');
    process.exit(failed ? 1 : 0);
})();
