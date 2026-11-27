// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
process.env.GARAGE_MENU = 'off';   // these tests check the page's own tab bar and buttons (the header menu is off)
/**
 * Exhaust run whole, on a pretend car: main.js started with the kit's own modules and a fake head unit (signals and a
 * diagnostic link with an engine unit that answers like a B48 with a filter and an electric flap). Checks the safety
 * model end to end:
 *
 *   - opening the app sends no flap command; with the control simulated, pressing buttons sends none either
 *   - armed: AUTO and a rule that holds send BMW's 2F 60 FD open, the hand back follows when it stops holding
 *   - the exhaust values are read only while the screen is shown
 *   - every page draws without an error, live and in demo
 *
 *   node tests/p96_exhaust.smoke.js        (Node 8 or newer; takes about 15 s)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RT = path.join(ROOT, 'kit', 'runtime');
const { Recorder } = require(path.join(RT, 'record'));

/* ---------- the app in a folder as the build lays it out, with a stand-in for kit/mgu.js ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p96ex-'));
const APP = path.join(ROOT, 'apps', 'p96_exhaust');
fs.readdirSync(APP).filter((f) => /\.js(on)?$/.test(f)).forEach((f) => fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(APP, f))));
fs.writeFileSync(path.join(dir, 'garage_ui.js'), fs.readFileSync(path.join(ROOT, 'lib', 'ui.js')));
fs.writeFileSync(path.join(dir, 'garage_engine.js'), fs.readFileSync(path.join(ROOT, 'lib', 'engine.js')));
fs.writeFileSync(path.join(dir, 'garage_render.js'), fs.readFileSync(path.join(ROOT, 'lib', 'render.js')));
fs.writeFileSync(path.join(dir, 'garage_qr.js'), fs.readFileSync(path.join(ROOT, 'lib', 'qr.js')));
fs.writeFileSync(path.join(dir, 'garage_report.js'), fs.readFileSync(path.join(ROOT, 'lib', 'report.js')));
fs.writeFileSync(path.join(dir, 'garage_time.js'), fs.readFileSync(path.join(ROOT, 'lib', 'cartime.js')));
fs.mkdirSync(path.join(dir, 'kit'));
fs.readdirSync(RT).forEach((f) => { if (f !== 'mgu.js') fs.symlinkSync(path.join(RT, f), path.join(dir, 'kit', f)); });
let app = null;
fs.writeFileSync(path.join(dir, 'kit', 'mgu.js'), 'module.exports = { run: (a) => { global.__p96app = a; } };');
fs.mkdirSync(path.join(dir, 'data'));

/* ---------- the pretend car ---------- */
const sent = [];              // every UDS request: 'addr sid data...'
const watchers = {};
const tasuHandlers = [];
let flapPct = 50;
const hx = (n) => (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
const s16 = (v) => { const r = Math.round(v) & 0xFFFF; return [r >> 8, r & 0xFF]; };
const DME_VALUES = {
    0x5774: () => s16(9.1 / 0.001), 0x558B: () => s16(14 / 0.001), 0x558C: () => s16(380), 0x579B: () => s16((560 + 273.14) / 0.1),
    0x5896: () => s16((640 + 273.14) / 0.1), 0x452C: () => s16(125), 0x5813: () => [96], 0x5433: () => s16(4000),
    0xF150: () => [0x0F, 0x26, 0xE8], 0x62FD: () => s16(flapPct * 100), 0x64FD: () => [0x01],
};
function reply(target, sid, data) {
    if (target !== 0x12) return null;
    if (sid === 0x22) {
        const did = (data[0] << 8) | data[1], f = DME_VALUES[did];
        return f ? [0x62, data[0], data[1]].concat(f()) : [0x7F, 0x22, 0x31];
    }
    if (sid === 0x2F) {
        if (data[2] === 0x03) flapPct = ((data[3] << 8) | data[4]) / 100; else flapPct = 50;
        return [0x6F].concat(data.slice(0, 3));
    }
    return [0x7F, sid, 0x11];
}
const signals = {
    watch(iface, inst, handlers) { watchers[iface] = Object.assign(watchers[iface] || {}, handlers); return Promise.resolve({ iface: iface, available: true }); },
    proxy() { return Promise.resolve({ fake: true }); },
    on(p, name, fn) { tasuHandlers.push(fn); return Promise.resolve(); },
    onAvailable(p, fn) { setTimeout(() => fn(true), 10); return Promise.resolve(); },
    call(p, method, req) {
        const data = Array.prototype.slice.call(req.udsData);
        sent.push(hx(req.targetAddress) + ' ' + hx(req.serviceID) + ' ' + data.map(hx).join(' '));
        const r = reply(req.targetAddress, req.serviceID, data);
        if (r) setTimeout(() => tasuHandlers.forEach((h) => h({ udsResponse: Buffer.from([0, 0, 0, 0, 0, 0, req.targetAddress, 0, 0].concat(r)) })), 5);
        return Promise.resolve('NO_ERROR');
    },
};
const store = {};
const changes = [];
const settings = { get: (k) => store[k], set: (k, v) => { store[k] = v; changes.forEach((f) => f(k)); }, onChange: (f) => changes.push(f) };
let lastCv = null, visible = null, renderFn = null;
const clicks = {};
const ctx = {
    log: { info() {}, warn() {}, error() {} }, settings: settings, signals: signals, dataDir: path.join(dir, 'data'),
    spec: JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8')),
    ui: { image: (n, cv) => { lastCv = cv; return Promise.resolve(); }, onClick: (b, f) => { clicks[b] = f; }, onVisible: (f) => { visible = f; }, isVisible: () => false },
    canvas: (w, h) => new Recorder(w, h),
    loop: (name, fps, fn) => { renderFn = fn; return { kick() {} }; },
    onTab() {}, hideButton() {},
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const broadcast = (iface, field, v) => { const w = watchers[iface]; if (w && w[field]) w[field](v); };
const drive = (rpm) => {
    broadcast('de.bmw.infotainment.vehicle.CDS', 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: rpm * 4 });
    broadcast('de.bmw.infotainment.vehicle.CDS', 'statusEngineTemperature', { temperatureEngineDrive: 90 + 48 });
    broadcast('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', { speedVehicleCentreOfGravity: 80 / 0.015625 });
    broadcast('de.bmw.infotainment.drivingexcitement.FES', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: 4 });
};
async function frame() { lastCv = null; await sleep(20); await renderFn(); return lastCv; }
async function tap(key) {
    let cv = await frame();
    // a tab scrolled out of the bar is no target: the bar's right arrow brings it in, as a finger would
    for (let k = 0; k < 12 && /^p96tab\d/.test(key) && !cv.targets.some((q) => q.key === key); k++) {
        const shown = cv.targets.filter((q) => /^p96tab\d/.test(q.key)).map((q) => +q.key.slice(6));
        const left = shown.length && +key.slice(6) < Math.min.apply(null, shown);
        const arrow = cv.targets.filter((q) => q.key === (left ? 'p96tabsl' : 'p96tabsr'))[0];
        if (arrow) arrow.run();
        for (let f = 0; f < 4; f++) cv = await frame();
    }
    const t = cv.targets.filter((q) => q.key === key)[0];
    assert.ok(t, 'no target ' + key + ' (' + cv.targets.map((q) => q.key).join(',') + ')');
    t.run();
}
const flapSent = () => sent.filter((s) => / 2F /.test(s));

(async function () {
    require(path.join(dir, 'main.js'));
    app = global.__p96app;
    await app.start(ctx);
    // the car is on and driving; the screen is not shown yet
    for (let i = 0; i < 8; i++) { drive(3500); await sleep(100); }
    assert.ok(!sent.some((s) => /^12 22 (57 74|55 8C|57 9B)/.test(s)), 'exhaust values read with the screen hidden');
    visible('MAIN', true);
    for (let i = 0; i < 30; i++) { drive(3500); await sleep(100); }
    assert.ok(sent.some((s) => /^12 22 57 74/.test(s)), 'soot not read while shown');
    assert.ok(sent.some((s) => /^12 22 62 FD/.test(s)), 'no flap probe');
    assert.deepStrictEqual(flapSent(), [], 'opening the app sent a flap command');
    // every page draws, live
    for (let p = 0; p < 11; p++) { await tap('p96tab' + p); await frame(); }
    let cv = await frame();
    assert.ok(cv.targets.some((q) => q.key === 'p96help'));
    // a finger on each Flap button presses that button, not the card's info under it (owner, 20:18: the kit presses
    // the first target under a finger; UI.attach puts the buttons first, UI.pressOrder)
    {
        const UIx = require(path.join(dir, 'garage_ui.js'));
        await tap('p96tab0');          // Home: the flap's buttons (owner 2026-11-27 22:20)
        const fc = await frame();
        const order = UIx.pressOrder(fc.targets.slice());
        ['mode|AUTO', 'mode|OPEN', 'mode|CLOSED'].forEach((k) => {
            const t = fc.targets.filter((q) => q.key === k)[0];
            assert.ok(t, 'no ' + k + ' (' + fc.targets.map((q) => q.key).join(',') + ')');
            const x = t.x + t.w / 2, y = t.y + t.h / 2;
            const hit = order.filter((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h)[0];
            assert.strictEqual(hit.key, k, 'a tap on ' + k + ' presses ' + hit.key);
        });
        const info = fc.targets.filter((q) => /^p96info/.test(q.key))[0];
        const ix = info.x + info.w - 20, iy = info.y + 20;
        assert.ok(/^p96info/.test(order.filter((q) => ix >= q.x && ix < q.x + q.w && iy >= q.y && iy < q.y + q.h)[0].key), 'the (i) does not open the info');
    }
    // simulated: the buttons send nothing
    await tap('p96tab0');
    await tap('mode|AUTO');
    for (let i = 0; i < 6; i++) { drive(3500); await sleep(100); }
    await tap('mode|OPEN');
    await sleep(300);
    assert.deepStrictEqual(flapSent(), [], 'simulated, yet a flap command went to the car');
    // armed: AUTO, the rule "Above 3 000 rpm" holds: OPEN; it stops holding: handed back
    settings.set('arm', 'on');
    await tap('mode|AUTO');
    for (let i = 0; i < 8; i++) { drive(3500); await sleep(100); }
    assert.ok(flapSent().some((s) => s === '12 2F 60 FD 03 03 E8'), 'no OPEN: ' + flapSent().join(' | '));
    for (let i = 0; i < 8; i++) { drive(2400); await sleep(100); }
    assert.strictEqual(flapSent()[flapSent().length - 1], '12 2F 60 FD 00', 'not handed back below 2 500 rpm');
    flapSent().forEach((s) => assert.ok(/^12 2F 60 FD (03 03 E8|03 23 28|00)$/.test(s), 'unexpected request ' + s));
    // nothing but reads and the flap ever went out
    // (and the engine's facts: OBD 01 51 the fuel type, 01 85 the AdBlue tank, lib/engine.js; 01 7A, 7B the filter's
    // pressure, 01 3C, 3D the catalysts' temperatures (T33); reads)
    sent.forEach((s) => assert.ok(/^12 (22|2F) /.test(s) || /^12 01 (51|85|7A|7B|3C|3D)$/.test(s), 'unexpected request ' + s));
    // the screen left: no more exhaust value reads
    visible('MAIN', false);
    await sleep(1200);
    const n = sent.filter((s) => /^12 22 57 74/.test(s)).length;
    for (let i = 0; i < 10; i++) { drive(2400); await sleep(100); }
    assert.strictEqual(sent.filter((s) => /^12 22 57 74/.test(s)).length, n, 'read with the screen hidden');
    // a favourite button as the flap's button (owner 2026-11-27 22:20): opening the app opens the flap
    settings.set('openAction', 'open');
    const opened = flapSent().length;
    visible('MAIN', true);
    await sleep(300);
    assert.strictEqual(flapSent().slice(opened)[0], '12 2F 60 FD 03 03 E8', 'opening the app did not open the flap: ' + flapSent().slice(opened).join(' | '));
    settings.set('openAction', 'none');
    visible('MAIN', false);
    await sleep(300);
    // demo: every page draws
    settings.set('demo', 'on');
    for (let p = 0; p < 11; p++) { await tap('p96tab' + p); await frame(); }
    await tap('p96tab2');
    await tap('addrule');
    cv = await frame();
    assert.ok(cv.targets.some((q) => q.key === 'kind|gear'));
    // Settings, Send a report: what goes in first, then the code; nothing goes to the car for it
    const before = sent.length;
    await tap('p96dlg|0');
    for (let i = 0; i < 15; i++) await frame();
    await tap('p96settings');
    await tap('p96button|report');
    cv = await frame();
    assert.ok(cv.targets.some((q) => q.key === 'p96button|repmake'), 'no Make QR code on the report page');
    await tap('p96button|repmake');
    cv = await frame();
    assert.ok(cv.targets.some((q) => q.key === 'p96button|repdone'), 'no Done on the code page');
    await tap('p96button|repdone');
    cv = await frame();
    assert.ok(cv.targets.some((q) => q.key === 'p96button|report'), 'Done did not go back to Settings');
    assert.strictEqual(sent.slice(before).filter((s) => !/^12 22 /.test(s)).length, 0, 'the report sent something to the car');
    console.log('ok   smoke: ' + sent.length + ' requests, flap: ' + flapSent().join(' | '));
    process.exit(0);
})().catch((e) => { console.log('FAIL smoke\n     ' + (e && e.stack || e)); process.exit(1); });
