// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog (Paget96 Garage): 402 m runs from a standstill with their splits, the air they were run in and the times
 * corrected to standard air, a dyno sheet from a full throttle pull, boost, the three air temperatures, tyres cold
 * to hot, fluid temperatures, a log of every run and two runs compared.
 *
 * Read only. The car's broadcast signals (speed, rpm, torque, gear, oil, coolant, gearbox, outside temperature,
 * tyres) are only listened to. The engine unit's values (intake and charge air, manifold and outside pressure, the
 * boost target, torque, pedal) are read with UDS 22 through the kit's ReadOnlyDiag, and only while Datalog's screen
 * is shown: nothing goes on the bus while it is hidden, and nothing is ever written.
 *
 * The pages: pages.js. The values and the run logs: model.js. Runs: runs.js; dyno pulls: dyno.js; the engine unit:
 * dme.js; demo data: demo.js. Node 8.
 */
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { Model } = require('./model');
const { DmeReader, Bank2Reader } = require('./dme');
const fs = require('fs');
const path = require('path');
const E = require('./garage_engine');
const CT = require('./garage_time');   // the car's time (the head unit keeps UTC)
const UI = require('./garage_ui');
const P = require('./pages');
const UI = require('./garage_ui');
const Report = require('./garage_report');

const W = 1600, H = 520;
const SCREEN = 'MAIN';

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        UI.attach(ctx);         // the layout setting, and touch in the Standard layout
        CT.source(() => settings.get('timeZone'));   // times shown in the car's zone (Display card, Time zone)
        let car = null;
        /* the engine (lib/engine.js): asked once, kept in engine.json; a V8's second engine unit gives bank 2 */
        const engineStore = E.fileStore(fs, path.join(ctx.dataDir, 'engine.json'));
        let detector = null, bank2 = null;
        // Demo data is On or Off, Off by default; it never turns on by itself (owner, 2026-11-26 20:20, D26). The kit's
        // car.js would start its demo drive when no car answers within 5 s ("auto"): it sees only 'on' or 'off'.
        const m = new Model({ settings, dataDir: ctx.dataDir, log, demo: () => UI.demoOn(settings.get('demo')),
            live: () => !!(car && car.carPresent()),
            facts: () => (detector ? detector.facts : engineStore.get() || {}) });
        // Settings, Send a report (lib/report.js), with the engine as found on this car
        m.report = Report.forApp(ctx, { engineFacts: () => (detector ? detector.facts : engineStore.get()) });
        const L = m.live;

        /* ---------- broadcast signals: only listened to ---------- */
        const extra = {
            'de.bmw.infrastructure.EnvironmentalInformation': {
                // the mirror sensor: 0.5 °C a step from -40, 255 = no value (as Drag Timer reads it)
                ExteriorTemperature: (v) => { const raw = v && v.temperatureExterior; if (typeof raw === 'number' && raw !== 255) L.outside = raw * 0.5 - 40; },
            },
            'de.bmw.infrastructure.analytics.BasicDataSet': {
                // gearbox oil, °C + 48, 255 = no value; a car that never fills it stays at one number (shown as --)
                basicDataSet: (v) => {
                    const raw = v && v.valueTemperatureTransmissionOil;
                    if (typeof raw !== 'number' || raw === 255) return;
                    const c = raw - 48;
                    if (L.gearboxFirst === undefined) L.gearboxFirst = c;
                    if (c !== L.gearboxFirst) L.gearboxMoved = true;
                    if (L.gearboxMoved) L.gearbox = c;
                },
            },
        };
        const carCtx = Object.create(ctx);
        carCtx.settings = UI.demoSettings(settings);
        car = new Car(carCtx, ['rpm', 'speed', 'temps', 'torque', 'gear'], extra);
        const fresh = (t) => typeof t === 'number' && Date.now() - t < 1500;
        car.onSample((d, t) => {
            if (d.demo) return;
            L.speed = d.speed; L.rpm = d.rpm; L.gear = d.gear; L.oil = d.oil; L.coolant = d.coolant;
            // torque: the engine unit's own while it is read (the screen shown), else the car's torque signal
            L.torque = fresh(L.dmeT) && typeof L.torqueDme === 'number' ? L.torqueDme : d.torque;
            m.carSample(t, { speed: d.speed, rpm: d.rpm, gear: d.gear, torque: L.torque, pedal: fresh(L.dmeT) ? L.pedal : undefined });
        });

        // tyres: the car's TPMS, pressure 0.1 a step in the car's own unit, temperature + 40 (as M Vitals reads them)
        const tyreP = (raw) => {
            if (typeof raw !== 'number' || raw >= 65532) return null;
            const v = raw * 0.1;
            if (v >= 0.5 && v <= 6) return v;                  // bar
            if (v >= 7 && v < 60) { L.psi = true; return v / 14.5038; }
            if (v >= 60 && v <= 600) return v / 100;            // kPa
            return null;
        };
        const tyreT = (raw) => {
            if (typeof raw !== 'number' || raw >= 65535) return null;
            const v = raw - 40, c = L.psi ? (v - 32) * 5 / 9 : v;
            return c > -40 && c < 150 ? c : null;
        };
        const ty = L.tyres;
        ctx.signals.watch('de.bmw.infotainment.vehicle.TPMS', '1', {
            statusTyrePressure: (v) => { ty.p = { FL: tyreP(v.actualValuePressureTyreFLH), FR: tyreP(v.actualValuePressureTyreFRH), RL: tyreP(v.actualValuePressureTyreRLH), RR: tyreP(v.actualValuePressureTyreRRH) }; },
            statusTyreTemperature: (v) => { ty.t = { FL: tyreT(v.actualValueTemperatureTyreFLH), FR: tyreT(v.actualValueTemperatureTyreFRH), RL: tyreT(v.actualValueTemperatureTyreRLH), RR: tyreT(v.actualValueTemperatureTyreRRH) }; },
            statusTargetTyrePressure: (v) => { ty.target = { FL: tyreP(v.targetPressureTyreFLH), FR: tyreP(v.targetPressureTyreFRH), RL: tyreP(v.targetPressureTyreRLH), RR: tyreP(v.targetPressureTyreRRH) }; },
        }, log, { pollMs: 10000 }).then((s) => log.info('signal TPMS ' + (s.error ? 'error: ' + s.error : 'subscribed')));

        /* ---------- the engine unit: read only, only while shown ---------- */
        let link = null, dme = null, shown = false, opening = null;
        const onValues = (v) => {
            L.dmeT = Date.now();
            ['intake', 'charge', 'manifold', 'kPa', 'egt', 'pedal', 'wastegate', 'wgDuty'].forEach((k) => { if (k in v) L[k] = v[k]; });
            if ('torque' in v) L.torqueDme = v.torque;
            if (typeof L.kPa === 'number') L.ambient = L.kPa / 100;
            if ('boostTargetAbs' in v && typeof L.ambient === 'number') L.boostTarget = v.boostTargetAbs - L.ambient;
        };
        const onBank2 = (v) => {
            if ('charge2' in v && typeof L.ambient === 'number') L.boost2 = v.charge2 - L.ambient;
            if ('wastegate2' in v) L.wastegate2 = v.wastegate2;
        };
        async function dmeOn() {
            if (!shown || m.isDemo()) return;
            if (!dme) {
                if (!opening) {
                    opening = (async () => {
                        link = new ReadOnlyDiag(ctx.signals, log);
                        await link.init();
                        dme = new DmeReader(link, { log, onValues });
                        detector = new E.Detector(link, engineStore, log);
                        log.info('engine unit: read only link ready');
                    })().catch((e) => { log.warn('engine unit: ' + (e && e.message ? e.message : e)); opening = null; });
                }
                await opening;
            }
            if (dme && shown && !m.isDemo()) dme.start();
            if (detector && !detector.known()) await detector.run();
            if (detector && detector.facts.units === 2 && shown && !m.isDemo()) { if (!bank2) bank2 = new Bank2Reader(link, { onValues: onBank2 }); bank2.start(); }
        }
        const dmeOff = () => { if (dme) dme.stop(); if (bank2) bank2.stop(); };
        ui.onVisible((name, v) => {
            if (name !== SCREEN) return;
            shown = !!v;
            if (shown) dmeOn(); else dmeOff();
        });
        if (ui.isVisible(SCREEN)) { shown = true; dmeOn(); }

        /* ---------- the model's clock: runs, demo, history ---------- */
        setInterval(() => {
            m.tick(Date.now());
            // the demo came or went (Settings, or the car answered): reads follow it
            if (dme) { if (m.isDemo() && dme.on) dmeOff(); else if (!m.isDemo() && shown && !dme.on) dmeOn(); }
            else if (shown && !m.isDemo() && !opening) dmeOn();
        }, 50);

        /* ---------- drawing: every screen refresh, at the frame rate set ---------- */
        const t0 = Date.now();
        let last = 0;
        async function render() {
            const fps = Number(settings.get('fps')) || 60, now = Date.now();
            if (now - last < 1000 / fps - 4) return null;
            last = now;
            const cv = ctx.canvas(W, H);
            // where the kit runs the screen, it draws the tabs in its header too and routes their taps to ctx.onTab
            if (cv.chrome) {
                const tabs = m.ui.view === 'main' ? P.tabsFor(m) : [];
                cv.chrome.tabs = { tabs: tabs, sel: tabs.indexOf(m.ui.page), badges: [] };
            }
            P.draw(cv, m, (now - t0) / 1000);
            return ui.image(SCREEN + '_GFX', cv);
        }
        // a tab of the kit's header (tapped, or the iDrive knob turned onto it and pressed)
        ctx.onTab((i) => { const tabs = P.tabsFor(m); if (i >= 0 && i < tabs.length) { m.ui.view = 'main'; m.ui.page = tabs[i]; } });
        ctx.loop(SCREEN, 30, render);
        log.info('Datalog started (' + (ctx.spec.version || '') + ')');
    },
});
