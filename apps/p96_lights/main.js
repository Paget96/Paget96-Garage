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
const PF = require('./profiles');
const CV = require('./carview');

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
        // the car's own Ambient light menu: which colour slot it is on (read only, shown on the Ambient page)
        let carAmbient = null;
        ctx.signals.watch('de.bmw.infotainment.misc.ComfortFunctionIuK', '1', {
            statusAmbientLightInteriorColour: (v) => { carAmbient = typeof v === 'number' ? v : v && typeof v === 'object' ? (v.colour != null ? v.colour : JSON.stringify(v).slice(0, 24)) : v; },
        }, log).catch(() => {});

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
        // the light shows: the ready made ones and the user's own (profiles.js), shown a group at a time
        const PFILE = path.join(ctx.dataDir, 'profiles.json'), store = PF.load(PFILE);
        const listOf = (g) => PF.inGroup(g, store);
        let presets = listOf('Party');
        const V = { view: { yaw: 0, pitch: 30, roll: 0 }, region: 'all', regionColours: {}, paused: null, outsideWant: settings.get('outsideWant') || {}, live: { on: false, rows: [], note: null }, preset: 0, scene: { kind: 'solid', upper: { rgb: P.COLOURS[4][1], bright: 70 }, lower: { rgb: P.COLOURS[4][1], bright: 70 }, speed: 2 },
            flash: { pattern: 'both', rate: 'normal' }, playAt: null };

        const sendScene = () => { if (armed()) link().then(() => { if (lights && !allowed('ambient')) { if (V.scene.own) lights.carColour(); else lights.show(V.scene); } }); };
        const go = (i) => { st.page = 'main'; st.tab = (i + P.TABS.length) % P.TABS.length; };
        // a region's own colour: laid over the lights of that region (lights.js overlay), the rest keep the scene
        const sendRegion = (key) => {
            if (!armed()) return;
            link().then(() => {
                if (!lights || allowed('ambient')) return;
                const c = V.regionColours[key];
                lights.overlay('reg|' + key, c ? (l) => P.regionOf(l) === key : null, () => ({ rgb: c.rgb, bright: c.bright }));
            });
        };
        // Stop all (and every safeguard): the sequence or the flashes stopped, every light given back to the car
        const stopAll = (why) => {
            V.playAt = null; V.paused = null;
            try { if (lamps && lamps.running) lamps.stop(); } catch (e) { /* stopping */ }
            try { if (lights) { lights.overlay('party', null); lights.lights.forEach((l, i) => lights.overlay('flow|' + i, null)); Object.keys(V.regionColours).forEach((k) => lights.overlay('reg|' + k, null)); lights.carColour(); } } catch (e) { /* stopping */ }
            V.regionColours = {}; V.scene = Object.assign({}, V.scene, { own: true }); V.ours = false;
            if (why) log.info('lights: stopped, ' + why);
        };
        /*
         * An open door: every light on that door blinks red (owner, 2026-11-27 00:40: as the car's own warning does on
         * cars that have it), over whatever colour is on, until the door shuts. Setting Open door red; armed only.
         */
        const DOOR_FIELDS = { statusDoorSwitchDRD: /^Driver front door/, statusDoorSwitchPSD: /^Passenger front door/,
            statusDoorSwitchDRDR: /^Driver rear door/, statusDoorSwitchPSDR: /^Passenger rear door/ };
        let openDoors = [];
        ctx.signals.watch('de.bmw.body.DoorsWindowsRoofMirrors', '1', {
            CentralLockingSystemAndPanelStatus: (v) => {
                const now2 = Object.keys(DOOR_FIELDS).filter((k) => v && (v[k] === 1 || /_OFFEN$/.test(String(v[k]))));
                if (now2.join() === openDoors.join()) return;
                const was = openDoors; openDoors = now2;
                if (!armed() || val('doorRed') !== 'on') return;
                link().then(() => {
                    if (!lights) return;
                    was.filter((k) => now2.indexOf(k) < 0).forEach((k) => lights.overlay('door|' + k, null));
                    now2.forEach((k) => lights.overlay('door|' + k, (l) => DOOR_FIELDS[k].test((l && l.name) || ''), (ms) => ({ rgb: [255, 0, 0], bright: Math.floor(ms / 500) % 2 ? 0 : 100 })));
                });
            },
        }, log).catch(() => {});

        /* ---------- the lamps as the car drives them now: reads only, while Lamps now is on ---------- */
        async function readLive() {
            if (!V.live.on || !armed() || !diag || st.tab !== 2) return;
            const rows = [];
            const rd = async (addr, did) => { try { const r = await diag.physical(addr, 0x22, [did >> 8, did & 255], 1500); return r && r[0] === 0x62 ? r : null; } catch (e) { return null; } };
            for (const side of [[0x43, 'Left'], [0x44, 'Right']]) {
                const r = await rd(side[0], 0xD6DB);           // FLM02 (a G20's LED headlights): 15 channels of 5 bytes, PWM % first
                if (!r) continue;
                for (let ch = 0; ch < 15; ch++) { const pwm = r[3 + ch * 5]; if (pwm) rows.push([side[1] + ' headlight, channel ' + (ch + 1), pwm + ' %', true]); }
            }
            const b = await rd(0x40, 0xE3B9);                   // the body controller's lamp outputs (BDC_G05)
            if (b) { let n = 0; for (let i = 4; i < b.length; i++) if (b[i]) n++; rows.push(['Body controller outputs on', String(n), false]); }
            V.live.rows = rows; V.live.note = rows.length ? null : 'No answer from the headlights or the body controller';
        }
        setInterval(() => { readLive().catch(() => {}); }, 1500);
        const act = {
            tab: (i) => go(i),
            help: () => { st.page = 'help'; },
            settings: () => { st.page = 'settings'; },
            back: () => { st.page = 'main'; },
            topic: (i) => { st.topic = i; },
            set: (k, v) => { settings.set(k, v, 'user'); if (k === 'arm' && v === 'on') link(); if (k === 'arm' && v !== 'on') stopAll('disarmed'); },
            stopAll: () => stopAll('Stop all'),
            region: (k) => { V.region = k; },
            // the controller's buttons on the Ambient page: a push round (dir -1 or 1), leaning back (dp 1) or straight above (-1)
            // each holds the car there for 10 s (owner, 2026-11-27 00:59), then it turns on by itself from that pose
            turn: (dir, dp) => {
                const g = SPIN.goal || { yaw: V.view.yaw, pitch: V.view.pitch };
                SPIN.goal = { yaw: dir ? Math.round((g.yaw + dir * 45) / 45) * 45 : g.yaw, pitch: dp < 0 ? 0 : dp ? Math.min(P.MAX_PITCH, Math.max(g.pitch, 0) + 15) : g.pitch };
                SPIN.held = now(); SPIN.vy = 0;
            },
            outside: (k, v) => { V.outsideWant = Object.assign({}, V.outsideWant, { [k]: v }); settings.set('outsideWant', V.outsideWant, 'user'); },
            live: () => { V.live.on = !V.live.on; V.live.rows = []; if (V.live.on) link(); },
            pause: () => {
                const p = presets[V.preset];
                V.paused = V.playAt != null ? Math.floor((now() - V.playAt) / PF.msOf(p, store)) % PF.BEATS : 0;
                V.playAt = null; partyAmbientOff();
                if (lamps && lamps.running) lamps.stop();
            },
            demoOff: () => settings.set('demo', 'off', 'user'),
            colour: (rgb) => {
                V.ours = true;
                if (V.region !== 'all') { V.regionColours[V.region] = { rgb: rgb, bright: V.scene.upper.bright }; sendRegion(V.region); return; }
                V.scene = Object.assign({}, V.scene, { own: false, upper: { rgb: rgb, bright: V.scene.upper.bright }, lower: { rgb: rgb, bright: V.scene.upper.bright } }); sendScene();
            },
            effect: (kind) => { V.scene = Object.assign({}, V.scene, { kind: kind, own: false }); sendScene(); },
            bright: (d) => {
                const b = Math.max(10, Math.min(100, V.scene.upper.bright + d));
                V.scene = Object.assign({}, V.scene, { own: false, upper: { rgb: V.scene.upper.rgb, bright: b }, lower: { rgb: V.scene.lower.rgb, bright: b } }); sendScene();
            },
            carOwn: () => stopAll('the car\'s own colour'),
            pick: (i) => { if (V.playAt == null) { V.preset = i; V.edit = false; } },
            group: (g) => { if (V.playAt != null) return; V.group = g; presets = listOf(g); V.preset = 0; V.edit = false; },
            // editing: a ready made show is copied into Yours first, then that copy is the one edited
            edit: () => {
                if (V.playAt != null) return;
                const p = presets[V.preset]; if (!p) return;
                if (p.ready) { PF.copy(p, store); V.group = 'Yours'; presets = listOf('Yours'); V.preset = store.mine.length - 1; PF.save(PFILE, store); }
                V.edit = !V.edit || p.ready;
            },
            done: () => { V.edit = false; PF.save(PFILE, store); },
            cell: (beat, fn) => { const p = presets[V.preset]; if (!p || p.ready) return; if (fn === 'amb') PF.ambNext(p, beat); else PF.toggle(p, beat, fn); PF.save(PFILE, store); },
            speed: (d) => { const p = presets[V.preset]; if (!p || V.playAt != null) return; PF.speedOf(p, store, d); PF.save(PFILE, store); },
            smooth: (on) => { const p = presets[V.preset]; if (!p || V.playAt != null) return; PF.setSmooth(p, store, on); PF.save(PFILE, store); },
            remove: () => {
                const p = presets[V.preset]; if (!p || p.ready || V.playAt != null) return;
                store.mine.splice(V.preset, 1); PF.save(PFILE, store);
                V.edit = false; V.preset = Math.max(0, V.preset - 1);
                if (!store.mine.length) { V.group = 'Party'; presets = listOf('Party'); V.preset = 0; }
            },
            play: () => {
                // Go on after a pause: the sequence turned so it starts at the beat it stopped on
                const p = presets[V.preset], from = V.paused || 0;
                V.playAt = now() - from * PF.msOf(p, store); V.paused = null;
                const beats = p.beats.slice(from).concat(p.beats.slice(0, from));
                if (armed()) link().then(() => {
                    // a flash show is the strobe's own high beam run (with headlight units: one side held while the other flashes)
                    if (lamps && !allowed('lamps')) {
                        if (p.kind === 'flash') lamps.start({ lights: 'high', pattern: p.pattern, rate: PF.rateOf(PF.msOf(p, store)) });
                        else lamps.play(beats, { beatMs: PF.msOf(p, store) });
                    }
                    // the cabin's colour row: laid over every ambient light on its beats, the rest of the time as it was
                    if (lights && p.kind === 'flow' && !allowed('ambient')) {
                        const at0 = V.playAt, ms = PF.msOf(p, store), rgb = V.scene.upper.rgb;
                        lights.lights.forEach((l, i) => lights.overlay('flow|' + i, (x) => x === l, () => {
                            const w = V.playAt === at0 ? PF.flowW(((now() - at0) / ms) % PF.BEATS) : -1;
                            return { rgb: rgb, bright: Math.round(100 * CV.flowAt(CV.lightU(l), w)) };
                        }));
                    } else if (lights && p.amb && p.amb.some(Boolean) && !allowed('ambient')) {
                        const at0 = V.playAt;
                        const sm = PF.smoothOf(p, store);
                        lights.overlay('party', () => true, () => {
                            const q = V.playAt === at0 ? PF.at(p, ((now() - at0) / PF.msOf(p, store)) % PF.BEATS, sm) : null;
                            return q && q.amb ? { rgb: q.amb, bright: Math.round(100 * q.ambLevel) } : { rgb: [0, 0, 0], bright: 0 };
                        });
                    }
                });
            },
            stop: () => { V.playAt = null; V.paused = null; partyAmbientOff(); if (lamps && lamps.running) lamps.stop(); },
            flashPattern: (p) => { V.flash.pattern = p; },
            flashRate: (r) => { V.flash.rate = r; },
            flash: () => {
                V.playAt = now();
                if (armed()) link().then(() => { if (lamps && !allowed('lamps')) lamps.start({ lights: 'high', pattern: V.flash.pattern, rate: V.flash.rate }); });
            },
        };
        // safeguards beside Stop all: leaving the app stops everything, and so does the car moving (lamps.js also stops
        // a run after 30 s by itself, and the car switches each flash off on its own)
        ui.onVisible((name, on) => { if (name === 'MAIN' && !on) stopAll('the app left the screen'); });
        setInterval(() => { if (lamps && lamps.running && moving() !== false) stopAll('the car moves'); }, 500);
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
            const beatF = V.playAt != null || !armed() ? ((t - (V.playAt || t0)) / PF.msOf(p, store)) % PF.BEATS : 0, beat = Math.floor(beatF);
            return {
                armed: armed(), moving: usingDemo() ? false : moving(), presets: presets, preset: V.preset, beatF: beatF, smoothOf: (q) => PF.smoothOf(q, store), msOf: (q) => PF.msOf(q, store), group: V.group, edit: V.edit, mineCount: store.mine.length, playing: V.playAt != null, beat: beat, flash: V.flash,
                ambient: { state: lights ? lights.state : null, n: lights ? lights.lights.length : 0, lights: lights ? lights.lights : [], scene: V.scene, ours: !!V.ours && armed() },
                carAmbient: carAmbient, view: V.view, region: V.region, regionColours: V.regionColours, paused: V.paused, outsideWant: V.outsideWant, outside: {}, live: V.live,
                lamps: lamps ? { kind: lamps.kind, running: lamps.running, note: lamps.note } : { running: V.playAt != null && !armed() ? null : null },
            };
        }

        function partyAmbientOff() { try { if (lights) { lights.overlay('party', null); lights.lights.forEach((l, i) => lights.overlay('flow|' + i, null)); } } catch (e) { /* stopping */ } }
        V.group = 'Party'; V.edit = false;

        /* ---------- the car on the Ambient page turns like a 3D model (owner, 2026-11-27 00:45) ----------
         * Left alone it goes round slowly and without end, leaning back and up again in a long slow wave; a finger turns
         * it (across: round, up and down: leaning), lets go with the speed it had, and it eases back into its own turn. */
        // it opens seen from straight above (owner, 2026-11-27 00:59), held a moment, then starts to turn and lean
        const CRUISE = 14, REST_MS = 10000, OPEN_MS = 3000;
        const SPIN = { vy: 0, pitch: 0, held: now() - REST_MS + OPEN_MS, goal: { yaw: 0, pitch: 0 }, drag: null, at: now(), free: 0 };
        V.view.pitch = 0;
        function spin(t) {
            const dt = Math.min(0.1, (t - SPIN.at) / 1000); SPIN.at = t;
            if (SPIN.drag) return;
            const free = t - SPIN.held > REST_MS, s = (t - SPIN.free) / 1000;
            if (!free) {
                // held: a button's pose eased to, or a finger's let-go speed dying out where it was left
                if (SPIN.goal) {
                    const dy = ((SPIN.goal.yaw - V.view.yaw) % 360 + 540) % 360 - 180;
                    V.view.yaw = (V.view.yaw + dy * Math.min(1, dt * 4) + 360) % 360;
                    SPIN.pitch += (SPIN.goal.pitch - SPIN.pitch) * Math.min(1, dt * 4);
                } else { SPIN.vy *= Math.max(0, 1 - dt * 1.5); V.view.yaw = (V.view.yaw + SPIN.vy * dt + 360) % 360; }
                V.view.pitch = Math.max(0, Math.min(P.MAX_PITCH, SPIN.pitch));
                SPIN.free = t; SPIN.lean = SPIN.pitch;
                return;
            }
            // on its own: slowly round without end, leaning back and up in a long wave from the pose it was left in
            const cruise = CRUISE + 5 * Math.sin(s * 0.11);               // its own speed drifts a little, never backwards
            SPIN.vy += (cruise - SPIN.vy) * Math.min(1, dt * 0.6);
            V.view.yaw = (V.view.yaw + SPIN.vy * dt) % 360;
            const want = 30 + 16 * Math.sin(s * 0.23) + 5 * Math.sin(s * 0.07);
            SPIN.pitch += (want - SPIN.pitch) * Math.min(1, dt * 0.35);
            V.view.pitch = Math.max(0, Math.min(P.MAX_PITCH, SPIN.pitch));
            SPIN.goal = null;
        }
        if (ctx.onTouch) ctx.onTouch((phase, x, y) => {
            const t = now();
            if (phase === 1) {
                const b = P.viewBox();
                if (st.page !== 'main' || st.tab > 1 || x < b.x || x >= b.x + b.w || y < b.y || y >= b.y + b.h) return false;
                SPIN.drag = { x: x, y: y, t: t }; SPIN.vy = 0;
                return true;
            }
            const d = SPIN.drag;
            if (!d) return false;
            const dt = Math.max(1, t - d.t), dx = x - d.x, dy = y - d.y;
            if (phase === 2) {
                V.view.yaw = (V.view.yaw + dx * 0.45) % 360;
                SPIN.pitch = Math.max(0, Math.min(P.MAX_PITCH, SPIN.pitch - dy * 0.3));     // up leans it back
                V.view.pitch = SPIN.pitch;
                SPIN.vy = SPIN.vy * 0.5 + (dx * 0.45 / dt * 1000) * 0.5;      // what it carries on with when let go
                SPIN.drag = { x: x, y: y, t: t };
            } else {
                if (t - d.t > 120) SPIN.vy = 0;                            // held still before letting go: it stays put
                SPIN.vy = Math.max(-720, Math.min(720, SPIN.vy));
                SPIN.drag = null; SPIN.held = t; SPIN.goal = null;          // 10 s where the finger left it, then on its own
            }
            return true;
        });

        const keys = Object.keys(P.DEFAULTS);
        let last = 0;
        async function render() {
            const t = now(), fps = Number(val('fps')) || 60;
            if (t - last < 1000 / fps - 4) return;
            last = t;
            spin(t);
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
