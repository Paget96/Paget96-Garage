// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Lights: the car's wiring. The ambient light (lights.js, over the body controller's LIN buses), the light sequences
 * and the high beam flashes (lamps.js and strobe.js, the body controller's own light functions) come from
 * idrive7-apps' Ambient config (MIT; the sequences from Paget96's Exterior Lights, PR #254).
 *
 * The gate (allowed): nothing is sent until Settings, Light control is Armed. Sequences and flashes also need the
 * car to stand still (kit parked.js: the speed, a car that never sent one does not count as standing). The car
 * locked and left: nothing at all. Before anything is armed no request goes to the car, not even a read.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */
const path = require('path');
const mgu = require('./kit/mgu');
const UI = require('./garage_ui');
const Report = require('./garage_report');
const P = require('./pages');
const PR = require('./presets');

const W = 1600, H = 520;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        UI.attach(ctx);
        const val = (k) => { const v = settings.get(k); return v !== undefined && v !== null ? v : P.DEFAULTS[k]; };
        const now = () => Date.now();
        const t0 = now();
        const usingDemo = () => val('demo') === 'on';
        const armed = () => val('arm') === 'on' && !usingDemo();

        /* ---------- the car: speed, locked and left ---------- */
        let speed = null, left = false;
        ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: (v) => { const k = v && v.speedVehicleCentreOfGravity; if (typeof k === 'number' && k !== 65535) speed = k * 0.015625; },
        }, log, { pollMs: 2000 }).catch(() => {});
        ctx.signals.watch('de.bmw.infrastructure.VehicleCondition', '1', {
            VehicleCondition: (v) => { const s = JSON.stringify(v || ''); left = /PARKEN_BN_NIO|SLEEP|PARKEN_BN_IO/i.test(s) && !/WOHNEN|PRUEFEN|FAHREN/i.test(s); },
        }, log).catch(() => {});
        const moving = () => (speed === null ? null : speed > 3);

        /* ---------- the body controller, only once armed ---------- */
        let diag = null, lights = null, lamps = null, linking = null;
        const allowed = (what) => {
            if (!armed()) return 'simulated';
            if (left) return 'the car is locked and left';
            if (what !== 'ambient' && moving() !== false) return moving() ? 'the car is moving' : 'no speed from the car yet';
            return null;
        };
        async function link() {
            if (lamps || linking || !armed()) return linking;
            linking = (async () => {
                try {
                    const { Diag } = require('./kit/diag');
                    const { Lights } = require('./lights');
                    const { Lamps } = require('./lamps');
                    diag = await new Diag(ctx.signals, log).init();
                    lights = new Lights({ diag, log, known: settings.get('lightsKnown') });
                    lights.on('found', () => { try { settings.set('lightsKnown', lights.lights, 'app'); } catch (e) { /* not saved */ } });
                    lamps = new Lamps({ diag, log, allowed: (what) => allowed(what === 'show' || what === 'sequence' || what === 'strobe' ? 'lamps' : what), hold: (on) => lights.hold('strobe', on) });
                    lights.find().catch((e) => log.warn('lights: ' + e));
                    lamps.find().catch((e) => log.warn('lamps: ' + e));
                } catch (e) { log.warn('body controller: ' + e); diag = null; lights = null; lamps = null; }
                linking = null;
            })();
            return linking;
        }

        /* ---------- what is on screen ---------- */
        const st = { page: 'main', tab: 0, topic: 0, settings: {}, status: 'WAIT', statusColor: 'dim', demo: false, now: t0 };
        st.report = Report.forApp(ctx);
        const presets = PR.load(path.join(ctx.dataDir, 'presets.json'));
        const V = { preset: 0, scene: { kind: 'solid', upper: { rgb: P.COLOURS[4][1], bright: 70 }, lower: { rgb: P.COLOURS[4][1], bright: 70 }, speed: 2 },
            flash: { pattern: 'both', rate: 'normal' }, playAt: null };

        const sendScene = () => { if (armed()) link().then(() => { if (lights && !allowed('ambient')) { if (V.scene.own) lights.carColour(); else lights.show(V.scene); } }); };
        const go = (i) => { st.page = 'main'; st.tab = (i + P.TABS.length) % P.TABS.length; };
        const act = {
            tab: (i) => go(i),
            help: () => { st.page = 'help'; },
            settings: () => { st.page = 'settings'; },
            back: () => { st.page = 'main'; },
            topic: (i) => { st.topic = i; },
            set: (k, v) => { settings.set(k, v, 'user'); if (k === 'arm' && v === 'on') link(); if (k === 'arm' && v !== 'on') act.stop(); },
            demoOff: () => settings.set('demo', 'off', 'user'),
            colour: (rgb) => { V.scene = Object.assign({}, V.scene, { own: false, upper: { rgb: rgb, bright: V.scene.upper.bright }, lower: { rgb: rgb, bright: V.scene.upper.bright } }); sendScene(); },
            effect: (kind) => { V.scene = Object.assign({}, V.scene, { kind: kind, own: false }); sendScene(); },
            bright: (d) => {
                const b = Math.max(10, Math.min(100, V.scene.upper.bright + d));
                V.scene = Object.assign({}, V.scene, { own: false, upper: { rgb: V.scene.upper.rgb, bright: b }, lower: { rgb: V.scene.lower.rgb, bright: b } }); sendScene();
            },
            carOwn: () => { V.scene = Object.assign({}, V.scene, { own: true }); sendScene(); },
            pick: (i) => { V.preset = i; },
            play: () => {
                V.playAt = now();
                if (armed()) link().then(() => { if (lamps && !allowed('lamps')) { const p = presets[V.preset]; lamps.play(p.beats, { beatMs: p.beatMs }); } });
            },
            stop: () => { V.playAt = null; if (lamps && lamps.running) lamps.stop(); },
            flashPattern: (p) => { V.flash.pattern = p; },
            flashRate: (r) => { V.flash.rate = r; },
            flash: () => {
                V.playAt = now();
                if (armed()) link().then(() => { if (lamps && !allowed('lamps')) lamps.start({ lights: 'high', pattern: V.flash.pattern, rate: V.flash.rate }); });
            },
        };
        ui.onClick('BTN_PAGE', () => go(st.tab + 1));
        ui.onClick('BTN_PREV', () => go(st.tab - 1));
        ui.onClick('BTN_SETTINGS', () => { st.page = st.page === 'settings' ? 'main' : 'settings'; });
        ctx.onTab((i) => {
            const pick = UI.menuPick(P.TABS, i);
            if (pick === 'help' || pick === 'settings') st.page = pick; else if (pick >= 0) go(pick);
        });
        if (armed()) link();

        function values(t) {
            const p = presets[V.preset] || presets[0];
            const beat = V.playAt != null || !armed() ? Math.floor((t - (V.playAt || t0)) / p.beatMs) % PR.BEATS : 0;
            return {
                armed: armed(), moving: usingDemo() ? false : moving(), presets: presets, preset: V.preset, beat: beat, flash: V.flash,
                ambient: { state: lights ? lights.state : null, n: lights ? lights.lights.length : 0, scene: V.scene },
                lamps: lamps ? { kind: lamps.kind, running: lamps.running, note: lamps.note } : { running: V.playAt != null && !armed() ? null : null },
            };
        }

        const keys = Object.keys(P.DEFAULTS);
        let last = 0;
        async function render() {
            const t = now(), fps = Number(val('fps')) || 60;
            if (t - last < 1000 / fps - 4) return;
            last = t;
            keys.forEach((k) => { st.settings[k] = val(k); });
            st.demo = usingDemo(); st.now = t;
            st.status = armed() ? 'ARMED' : 'SIMULATED'; st.statusColor = armed() ? 'ok' : 'warm';
            if (lamps && !lamps.running && V.playAt != null && armed()) V.playAt = null;      // the car ended it (time, gate)
            const cv = ctx.canvas(W, H);
            if (cv.chrome) cv.chrome.tabs = UI.menu(P.TABS, st.tab, st.page);
            P.draw(cv, values(t), st, (t - t0) / 1000, act);
            await ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 10, render);
        process.on('exit', () => { try { if (lamps && lamps.running) lamps.stop(); if (lights) lights.stop(); } catch (e) { /* leaving */ } });
        log.info('Lights started, ' + (armed() ? 'armed' : 'simulated'));
    },
});
