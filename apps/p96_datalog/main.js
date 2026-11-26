// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog: the car's wiring. Signals and the engine unit's values go into the model (model.js), the
 * pages (pages.js) draw it. Everything here only reads: the engine unit through the kit's ReadOnlyDiag,
 * which refuses any request that is not a read before it leaves the head unit.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { DidReader } = require('./kit/dids');
const { Model, Demo, TYRES } = require('./model');
const P = require('./pages');

const W = 1600, H = 520;
const POS = { fl: 'FLH', fr: 'FRH', rl: 'RLH', rr: 'RRH' };

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const cfg = ctx.spec.config || {}, S = cfg.scaling || {};
        const sc = (k, raw) => {
            const c = S[k];
            if (!c || raw === undefined || raw === null || raw === c.invalid || (c.invalidFrom != null && raw >= c.invalidFrom)) return null;
            return raw * c.factor + (c.offset || 0);
        };
        const val = (k) => {
            const v = settings.get(k);
            return v !== undefined && v !== null ? v : P.DEFAULTS[k];
        };

        /* ---------- the model, the saved runs ---------- */
        const m = new Model({ runLength: Number(val('runLength')) });
        const RUNS_FILE = path.join(ctx.dataDir, 'runs.json');
        try {
            const saved = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'));
            if (Array.isArray(saved)) { m.runs = saved.slice(0, 30); log.info('runs loaded: ' + m.runs.length); }
        } catch (e) { /* none yet */ }
        let savedCount = m.runs.length ? m.runs[0].n : 0;
        function saveRuns() {
            const top = m.runs.length ? m.runs[0].n : 0;
            if (top === savedCount) return;
            savedCount = top;
            try { fs.writeFileSync(RUNS_FILE + '.tmp', JSON.stringify(m.runs)); fs.renameSync(RUNS_FILE + '.tmp', RUNS_FILE); }
            catch (e) { log.warn('runs save: ' + e); }
        }

        /* ---------- the car's signals ---------- */
        let lastCar = 0;
        const now = () => Date.now();
        const live = (fn) => (v) => { lastCar = now(); if (!usingDemo()) fn(v || {}); };
        const tyreP = (raw) => {                       // 0.1 x raw in the car's unit; each unit's range lies apart
            const v = sc('tyrePress', raw);
            if (v === null) return null;
            return v < 7 ? v : v < 60 ? v / 14.5038 : v / 100;
        };
        const watches = [
            ['de.bmw.infotainment.vehicle.Vehicle2', { statusCarSpeed2: live((v) => m.speed(now(), sc('speed', v.speedVehicleCentreOfGravity))) }],
            ['de.bmw.infotainment.vehicle.CDS', {
                statusEngineSpeed2: live((v) => m.set('rpm', sc('rpm', v.actualValueRPMEngineCrankshaft), now())),
                statusEngineTemperature: live((v) => {
                    m.set('coolant', sc('engineTemp', v.temperatureEngineDrive), now());
                    m.set('oil', sc('engineTemp', v.temperatureEngineOilDrive), now());
                }),
            }],
            ['de.bmw.infrastructure.EnvironmentalInformation', { ExteriorTemperature: live((v) => m.set('outside', sc('ambient', v.temperatureExterior), now())) }],
            ['de.bmw.infrastructure.analytics.BasicDataSet', { basicDataSet: live((v) => m.set('gearbox', sc('gearboxTemp', v.valueTemperatureTransmissionOil), now())) }],
            ['de.bmw.infotainment.vehicle.TPMS', {
                statusTyrePressure: live((v) => TYRES.forEach((k) => m.tyre(k, tyreP(v['actualValuePressureTyre' + POS[k]]), undefined))),
                statusTyreTemperature: live((v) => TYRES.forEach((k) => m.tyre(k, undefined, sc('tyreTemp', v['actualValueTemperatureTyre' + POS[k]])))),
                statusTargetTyrePressure: live((v) => { const p = tyreP(v.targetPressureTyreFLH); if (p !== null) m.tyres.target = p; }),
            }],
        ];
        const subs = [], t0 = now();
        Promise.all(watches.map((w) => ctx.signals.watch(w[0], '1', w[1], log, /\.TPMS$/.test(w[0]) ? { pollMs: 10000 } : undefined)
            .then((s) => { subs.push(s); return s; })))
            .then((all) => log.info('signals: ' + all.map((s) => s.iface.split('.').pop() + (s.error ? '(err)' : '')).join(' ')))
            .catch((e) => log.warn('signals: ' + e));
        const carPresent = () => lastCar > 0 || subs.some((s) => s.available);
        function usingDemo() {
            const d = val('demo');
            return d === 'on' || (d === 'auto' && !carPresent() && now() - t0 > 5000);
        }

        /* ---------- the engine unit, read only ---------- */
        const dme = Object.assign({ ecu: 18 }, cfg.dme || {});
        const link = new ReadOnlyDiag(ctx.signals, log);
        const rd = new DidReader(link, { ecu: dme.ecu });
        const FAST = ['manifold', 'boostTarget', 'charge', 'intake'], SLOW = ['ambient', 'egt'];
        let slowAt = 0, stopped = false;
        async function readLoop() {
            try { await link.init(); } catch (e) { log.warn('engine unit link: ' + e); return; }
            while (!stopped) {
                if (usingDemo()) { await sleep(1000); continue; }
                const t = now(), keys = FAST.concat(t - slowAt > 5000 ? SLOW : []);
                if (keys.length > FAST.length) slowAt = t;
                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    if (!dme[k] || !dme[k].length) continue;
                    try { m.set(k, await rd.value(k, dme[k]), now()); } catch (e) { log.warn('read ' + k + ': ' + e); }
                }
                await sleep(m.state() === 'run' ? 20 : 200);
            }
        }
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        readLoop();

        /* ---------- the clock: demo, histories, saving ---------- */
        const demo = new Demo(now());
        let wasDemo = false;
        setInterval(() => {
            const t = now(), d = usingDemo();
            if (d !== wasDemo) { m.event('info', d ? 'Demo data on' : 'Car data on', t); wasDemo = d; }
            if (d) demo.feed(m, t);
            m.tick(t);
            saveRuns();
        }, 50);

        /* ---------- the screen ---------- */
        const st = { page: 'main', tab: 0, topic: 0, settings: {}, status: 'LIVE', statusColor: 'ok', now: 0 };
        const go = (i) => { st.page = 'main'; st.tab = (i + P.TABS.length) % P.TABS.length; };
        const act = {
            tab: (i) => go(i),
            help: () => { st.page = 'help'; },
            settings: () => { st.page = 'settings'; },
            back: () => { st.page = 'main'; },
            topic: (i) => { st.topic = i; },
            set: (k, v) => settings.set(k, v, 'user'),
            compare: (n) => { m.compareWith = n; go(7); },
        };
        settings.onChange((k) => { if (k === 'runLength') m.setRunLength(Number(val('runLength'))); });
        ui.onClick('BTN_PAGE', () => go(st.tab + 1));
        ui.onClick('BTN_PREV', () => go(st.tab - 1));
        ui.onClick('BTN_SETTINGS', () => { st.page = st.page === 'settings' ? 'main' : 'settings'; });
        ctx.onTab((i) => go(i));

        const keys = Object.keys(P.DEFAULTS);
        let last = 0;
        async function render() {
            const t = now(), fps = Number(val('fps')) || 60;
            if (t - last < 1000 / fps - 4) return;
            last = t;
            keys.forEach((k) => { st.settings[k] = val(k); });
            const d = usingDemo();
            st.status = d ? 'DEMO' : 'LIVE'; st.statusColor = d ? 'info' : 'ok'; st.now = t;
            const cv = ctx.canvas(W, H);
            P.draw(cv, m, st, (t - t0) / 1000, act);
            await ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 10, render);
        log.info('Datalog started');
    },
});
