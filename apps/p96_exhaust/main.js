// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
// The gear decoding is adapted from the idrive7-apps kit (kit/runtime/car.js), MIT, Copyright (c) 2026
// cauliflowermossgrape; see NOTICE.
'use strict';
/**
 * Exhaust (Paget96 Garage, id p96_exhaust): the exhaust from the engine to the tail pipe. The flap with your own rules,
 * the particulate filter and its regenerations, the catalyst warm-up, how the sound is made and how to get a better one
 * without changing anything, and a setup page of what the exhaust has.
 *
 * Where the values come from:
 *   broadcast (always, nothing is sent to the car): CDS statusEngineSpeed2, statusEngineTemperature (coolant);
 *     Vehicle2 statusCarSpeed2 (the km Exhaust counts itself); VehicleInformation statusGearboxDrive / DataPowerTrain2
 *     (gear); FES statusFESVehicleDynamicSwitchHMI (drive mode); EnvironmentalInformation ExteriorTemperature
 *   the engine unit, 22 <DID> through the kit's read-only link, only while the screen is shown (exlink.js):
 *     soot, ash, filter load and temperature, exhaust after the catalyst, exhaust camshaft, load (model.js CATALOG)
 *
 * The one write (D21): the exhaust flap, 2F 60 FD on the engine unit (exlink.js check() lets nothing else through),
 * only when the flap control is armed in Settings (Simulated by default), on a button press, a change of what the
 * rules decide or the car coming up. Opening the app sends nothing by itself.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const UI = require('./garage_ui');
const Report = require('./garage_report');
const E = require('./garage_engine');
const M = require('./model');
const R = require('./rules');
const F = require('./flap');
const VIEW = require('./view');
const DEMO = require('./demo');
const { ExLink } = require('./exlink');

const CDS = 'de.bmw.infotainment.vehicle.CDS', VEH = 'de.bmw.infotainment.vehicle.Vehicle2', VI = 'de.bmw.infrastructure.VehicleInformation';
const FES = 'de.bmw.infotainment.drivingexcitement.FES', ENV = 'de.bmw.infrastructure.EnvironmentalInformation';
const HOUR = 3600000, MIN = M.MIN, STALE = 5000;
const ENGINE_STOPPED_RPM = 400;     // a hybrid's stopped engine leaves its run-down value (kit/car.js)
// the gear: names or wire numbers (G1 = 3 .. G10 = 12, R = 1, N_OR_P = 2), and DataPowerTrain2's selection (_1 = 5 ..)
const GEARS = { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5, G6: 6, G7: 7, G8: 8, G9: 9, G10: 10, R: -1, N_OR_P: 0 };
const gearOf = (x) => (typeof x === 'number' ? (x >= 3 && x <= 12 ? x - 2 : x === 1 ? -1 : x === 2 ? 0 : undefined) : GEARS[x]);
const selGear = (x) => { const n = typeof x === 'number' ? x : /^_\d$/.test(String(x)) ? 4 + Number(String(x).slice(1)) : undefined; return n >= 5 && n <= 13 ? n - 4 : n >= 1 && n <= 4 ? 0 : undefined; };
const ORD = ['', '1st', '2nd', '3rd'];

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        UI.attach(ctx);         // the layout setting, and touch in the Standard layout
        const t0 = Date.now();

        /* ---------- what Exhaust keeps (data/exhaust.json) ---------- */
        const FILE = path.join(ctx.dataDir, 'exhaust.json');
        let P = {};
        try { P = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first start */ }
        P = Object.assign({ rules: R.defaults(), modes: {}, flapLog: [], regens: [], loads: [], loadsKm: [], drives: [], ash: [], km: 0,
            warm: null, warmWhen: null, warmOutside: null, lightOffs: [], starts: [], setup: Object.assign({}, M.SETUP_DEFAULT), caps: {}, carKey: 'car' }, P);
        P.setup = M.migrateSetup(P.setup);
        const caps = () => (P.caps[P.carKey] = P.caps[P.carKey] || {});
        let saveTimer = null;
        const save = () => {
            if (saveTimer) return;
            saveTimer = setTimeout(() => {
                saveTimer = null;
                try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(P)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { log.warn('save: ' + e); }
            }, 2000);
        };
        let version = 0, loop = null;
        const changed = () => { version++; if (loop && loop.kick) loop.kick(); };
        const found = (k, yes) => { if (M.found(caps(), k, yes)) { save(); changed(); } };
        /* the engine (lib/engine.js): fuel, cylinders, one or two engine units, asked once and kept (engine.json) */
        const engineStore = E.fileStore(fs, path.join(ctx.dataDir, 'engine.json'));
        let detector = null;
        const engineFacts = () => (detector ? detector.facts : engineStore.get() || {});

        /* ---------- live values ---------- */
        const v = {}, at = {};
        const put = (k, x) => { if (x === null || x === undefined || (typeof x === 'number' && !isFinite(x))) return; v[k] = x; at[k] = Date.now(); };
        const fresh = (k, ms) => (at[k] && Date.now() - at[k] < (ms || STALE) ? v[k] : null);

        const link = new ExLink(ctx.signals, log);
        let linkReady = null;
        const getLink = () => linkReady || (linkReady = link.init().catch((e) => { log.warn('diagnostic link: ' + e); return link; }));
        getLink();
        UI.T.source(() => settings.get('timeZone'));   // times shown in the car's zone (Display card, Time zone)
        let carSeen = false;
        // Demo data is On or Off, Off by default; it never turns on by itself (owner, 2026-11-26 20:20, D26)
        const useDemo = () => UI.demoOn(settings.get('demo'));

        /* ---------- drives, cold starts and the km (always, from the broadcasts) ---------- */
        let drive = null, lastSpeedT = 0, warmRec = null;
        function engineStarted() {
            const now = Date.now(), cl = fresh('coolant', 60000);
            drive = { start: now, coolant: cl };
            if (cl != null && cl < M.COLD_COOLANT) {
                warmRec = { start: now, curve: [], outside: fresh('outside', 600000) };
                log.info('cold start, coolant ' + cl + ' °C');
            }
        }
        function engineStopped() {
            const now = Date.now();
            if (drive) {
                const mins = (now - drive.start) / MIN;
                if (mins > 0.5) {
                    P.drives.unshift({ start: drive.start, mins: Math.round(mins * 10) / 10 });
                    P.drives = P.drives.slice(0, 60);
                    P.starts.unshift({ t: drive.start, coolant: drive.coolant, mins: Math.round(mins * 10) / 10 });
                    P.starts = P.starts.slice(0, 40);
                    save();
                }
            }
            drive = null; warmRec = null;
        }
        const bg = [
            [CDS, {
                statusEngineSpeed2: (x) => {
                    const r = x && x.actualValueRPMEngineCrankshaft;
                    if (typeof r !== 'number' || r === 65535) return;
                    const rpm = r * 0.25 < ENGINE_STOPPED_RPM ? 0 : r * 0.25, was = v.rpm;
                    put('rpm', rpm); carSeen = true;
                    if (!caps().rpm) found('rpm', true);
                    if (rpm > 0 && !(was > 0)) engineStarted();
                    if (rpm === 0 && was > 0) engineStopped();
                },
                statusEngineTemperature: (x) => {
                    const c = x && x.temperatureEngineDrive;
                    if (typeof c === 'number' && c !== 255) { put('coolant', c - 48); if (!caps().coolant) found('coolant', true); }
                },
            }],
            [VEH, {
                statusCarSpeed2: (x) => {
                    const s = x && x.speedVehicleCentreOfGravity;
                    if (typeof s !== 'number' || s === 65535) return;
                    const kmh = s * 0.015625, now = Date.now();
                    if (lastSpeedT && now - lastSpeedT < 5000 && kmh > 0.5) P.km += kmh * (now - lastSpeedT) / HOUR;
                    lastSpeedT = now; put('speed', kmh);
                    if (!caps().speed) found('speed', true);
                },
            }],
            [VI, {
                statusGearboxDrive: (x) => { const g = gearOf(x && x.statusActualGearDrive); if (g !== undefined) { put('gear', g); if (!caps().gear) found('gear', true); } },
                DataPowerTrain2: (x) => { const g = selGear(x && x.statusGearSelectionDrive); if (g !== undefined) { put('gear', g); if (!caps().gear) found('gear', true); } },
            }],
            [FES, {
                statusFESVehicleDynamicSwitchHMI: (x) => {
                    const raw = x && x.actualValueModeDrivingExperience;
                    if (R.modeClass(raw) === null) return;
                    put('mode', raw);
                    if (!caps().mode) found('mode', true);
                },
            }],
            [ENV, {
                ExteriorTemperature: (x) => {
                    const r = x && x.temperatureExterior;
                    if (typeof r !== 'number' || r === 255) return;
                    put('outside', r * 0.5 - 40);
                    if (!caps().outside) found('outside', true);
                },
            }],
        ];
        Promise.all(bg.map((b) => ctx.signals.watch(b[0], '1', b[1], log)))
            .then((all) => log.info('signals: ' + all.map((s) => s.iface.split('.').pop() + (s.error ? ' (' + s.error + ')' : '')).join(', ')))
            .catch((e) => log.warn('signals: ' + e));

        /* ---------- the engine unit's values, only while the screen is shown ---------- */
        let shown = false, reading = false;
        const pick = {};                 // value -> the catalog entry that answered
        async function readValue(key) {
            const list = M.CATALOG[key], c = caps();
            if (c[key] === false && !pick[key]) return null;
            const tries = pick[key] ? [pick[key]] : list;
            let refused = 0;
            for (let i = 0; i < tries.length; i++) {
                const r = await link.value(tries[i].did);
                if (r === undefined || r === null) return null;          // no answer (ignition off) or the screen left
                const x = M.decode(tries[i], r);
                if (x !== null) { pick[key] = tries[i]; found(key, true); return x; }
                if (r[0] === 0x7F) refused++;
            }
            if (refused === tries.length && !pick[key]) found(key, false);
            return null;
        }
        const FAST = ['egt', 'pfTemp', 'soot', 'load', 'engLoad'], SLOW = ['ash', 'exVanos', 'catO2'];
        let slowAt = 0;
        const regen = new M.Regen(P.regens);
        async function readLoop() {
            if (reading) return;
            reading = true;
            await getLink();
            try {
                while (shown) {
                    if (useDemo() || !link.available) { await sleep(1000); continue; }
                    const keys = FAST.concat(Date.now() - slowAt > 30000 ? SLOW : []);
                    if (keys.length > FAST.length) slowAt = Date.now();
                    for (let i = 0; i < keys.length && shown; i++) {
                        const x = await readValue(keys[i]);
                        if (x !== null) put(keys[i], x);
                    }
                    if (keys.length > FAST.length) await readEngine();
                    afterRead();
                    await sleep(700);
                }
            } catch (e) { log.warn('engine values: ' + e); }
            reading = false;
        }
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        /** The engine's facts once a start, and on a diesel the AdBlue tank (OBD 01 85), every 30 s with the slow values. */
        async function readEngine() {
            const el = link.engineLink && link.engineLink();
            if (!el) return;
            if (!detector) detector = new E.Detector(el, engineStore, log);
            if (!detector.known()) { await detector.run(); changed(); }
            if (detector.facts.fuel === 'diesel' && caps().adblue !== false) {
                const r = await el.physical(0x12, 0x01, [0x85], 1500, (x) => (x[0] === 0x41 && x[1] === 0x85) || (x[0] === 0x7F && x[1] === 0x01)).catch(() => null);
                const lv = E.parseAdBlue(r);
                if (lv != null) { put('adblue', lv); found('adblue', true); } else if (r && r[0] === 0x7F) found('adblue', false);
            }
            // the standard OBD values T33 adds: the pressure across the particulate filter per bank (01 7A, 7B) and the
            // catalysts' own temperatures (01 3C bank 1, 3D bank 2); each asked until the car says it has none
            const obd = async (key, pid, parse) => {
                if (caps()[key] === false) return;
                const r = await el.physical(0x12, 0x01, [pid], 1500, (x) => (x[0] === 0x41 && x[1] === pid) || (x[0] === 0x7F && x[1] === 0x01)).catch(() => null);
                const x = parse(r, pid);
                if (x != null) { put(key, x); found(key, true); } else if (r && (r[0] === 0x7F || r[0] === 0x41)) found(key, false);
            };
            if (detector.facts.engine !== false) {
                await obd('dp1', 0x7A, E.parseFilterDp); await obd('dp2', 0x7B, E.parseFilterDp);
                await obd('catT1', 0x3C, E.parseCatTemp); await obd('catT2', 0x3D, E.parseCatTemp);
            }
        }
        let lastLoadAt = 0, lastLoadKm = -1e9, lastAshKm = -1e9;
        function afterRead() {
            const now = Date.now();
            const was = regen.history.length;
            regen.feed(now, { pfTemp: fresh('pfTemp'), soot: fresh('soot'), load: fresh('load'), km: Math.round(P.km) });
            if (regen.history.length !== was) { P.regens = regen.history; save(); }
            const load = fresh('load');
            if (load != null && now - lastLoadAt > 10 * MIN) { lastLoadAt = now; P.loads.push([now, Math.round(load * 10) / 10]); P.loads = P.loads.filter((p) => now - p[0] < 57 * M.DAY).slice(-1400); save(); }
            if (load != null && P.km - lastLoadKm > 10) { lastLoadKm = P.km; P.loadsKm.push([Math.round(P.km), Math.round(load * 10) / 10]); P.loadsKm = P.loadsKm.slice(-300); }
            const ash = fresh('ash', 60000);
            if (ash != null && P.km - lastAshKm > 200) {
                lastAshKm = P.km;
                const last = P.ash[P.ash.length - 1];
                if (!last || Math.abs(last[1] - ash) > 0.01 || P.km - last[0] > 2000) { P.ash.push([Math.round(P.km), Math.round(ash * 100) / 100]); P.ash = P.ash.slice(-200); save(); }
            }
            const cat = fresh('catO2', 60000);
            if (cat != null || fresh('egt') != null) P.setupFound = Object.assign(P.setupFound || {}, { cat: true });
            if (fresh('soot') != null) P.setupFound = Object.assign(P.setupFound || {}, { opf: true });
            // the cold start's warm-up curve, every 5 s for 5 minutes (needs the screen: the exhaust is read only then)
            if (warmRec) {
                const s = Math.round((now - warmRec.start) / 1000), egt = fresh('egt'), cl = fresh('coolant', 60000);
                const lastS = warmRec.curve.length ? warmRec.curve[warmRec.curve.length - 1][0] : -5;
                if (egt != null && s - lastS >= 5) warmRec.curve.push([s, Math.round(egt), cl == null ? null : Math.round(cl)]);
                if (s > 300) {
                    if (warmRec.curve.length > 10) {
                        P.warm = warmRec.curve; P.warmWhen = 'Last cold start, ' + M.clock(warmRec.start); P.warmOutside = warmRec.outside;
                        const lo = M.lightOff(warmRec.curve.map((p) => [p[0], p[1]]));
                        if (lo != null) { P.lightOffs.push(lo); P.lightOffs = P.lightOffs.slice(-10); }
                        save();
                    }
                    warmRec = null;
                }
            }
        }

        /* ---------- the flap ---------- */
        const armed = () => settings.get('arm') === 'on';
        const control = new F.FlapControl({ link: link, armed: armed, hold: () => settings.get('hold') !== false && settings.get('hold') !== 'off', log: log, onChange: changed });
        const demoControl = new F.FlapControl({ link: null, armed: () => false, log: { info() {}, warn() {} }, onChange: changed });
        let demoFlaps = 1;
        demoControl.setUnits([{ addr: 0x12, el: true }]);
        /** The demo car of Settings (lib/engine.js DEMO_CARS): its flaps on the demo flap control. */
        const demoCar = () => E.demoCar(settings.get('demoCar'));
        function demoUnits() {
            const n = demoCar().flaps;
            if (n === demoFlaps) return;
            demoFlaps = n;
            demoControl.setUnits(n === 2 ? [{ addr: 0x12, el: true }, { addr: 0x13, el: true }] : n ? [{ addr: 0x12, el: true }] : [], 1);
        }
        const rules = new R.Rules(P.rules);
        const demoRules = new R.Rules(R.defaults());
        let probed = false;
        async function probe() {
            if (probed) return;
            await getLink();
            if (!link.available) return;
            probed = true;
            try {
                const units = await link.probe();
                found('flap', units.length > 0);
                found('flap2', units.length > 1);
                P.setupFound = Object.assign(P.setupFound || {}, { flaps: units.length });
                // what the engine unit reports fills in only what the driver has not set: a removed flap still answers
                if (units.length && !(P.setupUser || {}).flaps) P.setup.flaps = String(Math.min(2, units.length));
                control.setUnits(units, Number(settings.get('leftIs')) || 1);
                save(); changed();
            } catch (e) { probed = false; log.warn('flap probe: ' + e); }
        }
        link.onAvailable((on) => { if (on) { control.linkUp(); if (armed() || shown) probe(); } changed(); });
        const guard = {}, decided = {};
        const modeOf = (side) => P.modes[side] || P.modes.both || 'OEM';
        /** The rule values now: stale ones are none (an rpm older than 5 s holds no rule). */
        const ruleVals = () => {
            const d = UI.T.carNow();   // the car's time of day (the head unit keeps UTC)
            return { rpm: fresh('rpm'), speed: fresh('speed'), load: fresh('engLoad'), gear: fresh('gear', 10000), mode: fresh('mode', 3600000),
                coolant: fresh('coolant', 60000), minutes: d.getHours() * 60 + d.getMinutes(), egt: fresh('egt') };
        };
        function detailOf(r, vals) {
            if (!r) return 'no rule holds';
            const c = r.when, x = R.valueOf(c.kind, vals);
            if (c.kind === 'rpm') return R.thousands(x) + ' rpm' + (vals.gear > 0 ? ', ' + (ORD[vals.gear] || vals.gear + 'th') + ' gear' : '');
            if (c.kind === 'mode') return (R.MODE_NAME[R.modeClass(x)] || '') + ' selected';
            if (c.kind === 'time') return 'at ' + R.hhmm(x);
            if (c.kind === 'gear') return (ORD[x] || x + 'th') + ' gear';
            const k = R.KINDS[c.kind];
            return k.label.toLowerCase().replace(' temp', '') + ' ' + R.thousands(x) + (k.unit ? ' ' + k.unit : '');
        }
        /** A few times a second: what the rules and the buttons want, and the flap sent there when it changed. */
        function flapTick() {
            const d = useDemo(), ctl = d ? demoControl : control, rs = d ? demoRules : rules;
            const vals = d ? Object.assign({ minutes: 18 * 60 + 42 }, DEMO.values(Date.now())) : ruleVals();
            rs.tick(vals);
            const limit = Number(settings.get('closeLimit') == null ? 4000 : settings.get('closeLimit')) || 0;
            ctl.sides().forEach((side) => {
                const r = rs.pick(side);
                const dd = F.decide({ mode: d ? (demoModes[side] || demoModes.both || 'AUTO') : modeOf(side), rule: r, rpm: vals.rpm, limit: limit, armed: !d && armed(), paused: guard[side] });
                guard[side] = dd.paused;
                decided[side] = dd;
                const f = ctl.flaps[side];
                if (d || !caps().flap) return;
                if (dd.action === f.sent && !f.busy) return;
                if (f.busy && f.requested === dd.action) return;
                if (armed() && !link.available) return;           // the car asleep: goes when it comes up
                const prev = P.flapLog[0];
                ctl.set(side, dd.action);
                if (!prev || prev.action !== dd.action || prev.reason !== dd.reason) {
                    P.flapLog.unshift({ t: Date.now(), action: dd.action, rule: r && dd.action === r.action ? r.name : null, reason: dd.reason, detail: detailOf(r, vals), side: side });
                    P.flapLog = P.flapLog.slice(0, 400);
                    save();
                }
            });
        }
        setInterval(flapTick, 250);

        /* ---------- the state the pages draw ---------- */
        const hist = { egt: [], load: [], rpm: [], seq: 0 };
        setInterval(() => {
            if (useDemo()) return;
            [['egt', 'egt'], ['load', 'load'], ['rpm', 'rpm']].forEach((q) => { const a = hist[q[0]]; a.push(fresh(q[1], 10000)); if (a.length > 60) a.shift(); });
            hist.seq++;
        }, 1000);
        const values = () => {
            const o = {};
            VIEW.APP_ROWS.concat(UI.DISPLAY_SETTINGS, [E.DEMO_ROW]).forEach((r) => { const x = settings.get(r.key); if (x !== undefined) o[r.key] = r.key === 'closeLimit' || r.key === 'leftIs' ? String(x) : x; });
            return o;
        };
        let demoS = null, demoAt = 0, demoSetup = null;
        const demoModes = {};
        const modes = () => (useDemo() ? demoModes : P.modes);
        function build() {
            const now = Date.now(), d = useDemo();
            let S;
            const ctl = d ? demoControl : control, rs = d ? demoRules : rules;
            if (d) {
                if (!demoS || now - demoAt > 1000 || demoS.carId !== settings.get('demoCar')) { demoS = DEMO.state(now, demoCar()); demoS.carId = settings.get('demoCar'); demoAt = now; }
                demoUnits();
                const car = demoCar();
                S = Object.assign({}, demoS, { v: DEMO.values(now, car), setup: demoSetup || DEMO.setupFor(car), caps: M.capsForCar(car), engine: car });
            } else {
                S = { demo: false, at: now, live: carSeen || link.available, caps: caps(), v: {
                    rpm: fresh('rpm'), speed: fresh('speed'), gear: fresh('gear', 10000), mode: fresh('mode', 3600000), coolant: fresh('coolant', 60000),
                    outside: fresh('outside', 600000), soot: fresh('soot', 10000), ash: fresh('ash', 120000), load: fresh('load', 10000), pfTemp: fresh('pfTemp', 10000),
                    egt: fresh('egt', 10000), exVanos: fresh('exVanos', 120000), engLoad: fresh('engLoad', 10000), adblue: fresh('adblue', 120000), dp1: fresh('dp1', 120000), dp2: fresh('dp2', 120000), catT1: fresh('catT1', 120000), catT2: fresh('catT2', 120000) },
                    hist: hist, regens: P.regens, regen: regen.now(now), loads: P.loads, loadsKm: P.loadsKm, drives: P.drives, ash: P.ash, kmNow: Math.round(P.km),
                    warm: P.warm, warmWhen: P.warmWhen, warmOutside: P.warmOutside, lightOffs: P.lightOffs, starts: P.starts,
                    flapLog: P.flapLog, flapWeekLog: P.flapLog, setup: P.setup, setupFound: P.setupFound || {} };
            }
            if (!S.engine) S.engine = M.engineFor(engineFacts(), S.caps, S.setup);
            S.fig = E.filterFigures(S.engine);
            S.until = M.untilNext(S.v.load, S.loadsKm, S.fig.mark);
            S.mark = S.fig.mark;
            S.rules = rs.list; S.held = rs.held;
            S.active = {};
            const views = {};
            ctl.sides().forEach((s) => { views[s] = ctl.view(s); const dd = decided[s]; if (dd && dd.rule && dd.action === dd.rule.action) S.active[s] = dd.rule.id; });
            const sideMode = {};
            ctl.sides().forEach((s) => { sideMode[s] = d ? (demoModes[s] || demoModes.both || 'AUTO') : modeOf(s); });
            S.flap = { sides: ctl.sides(), views: views, decided: Object.assign({}, decided), mode: sideMode[ctl.sides()[0]], sideMode: sideMode, armed: !d && armed() };
            if (d && V.regenDemo) S.regen = DEMO.regenNow();
            return S;
        }

        /* ---------- where the user is, and what the taps do ---------- */
        const V = { page: M.HOME, mode: 'main', side: 'both', ruleFirst: 0, dialog: null, helpSel: 0, edit: null, editPart: 'when', values: {} };
        V.report = Report.forApp(ctx);   // Settings, Send a report (lib/report.js)
        let S = null;
        const openDialog = (d) => { V.dialog = { d: d, open: true }; changed(); };
        const closeDialog = () => { if (V.dialog) V.dialog.open = false; V.edit = null; changed(); };
        const curRules = () => (useDemo() ? demoRules : rules);
        const saveRules = () => { if (!useDemo()) { P.rules = rules.list; save(); } changed(); };
        const editIndex = () => curRules().list.map((r) => r.id).indexOf(V.edit.id);
        const reopen = () => { if (V.edit) { V.dialog = { d: VIEW.ruleDialog(S || build(), V, A, editIndex()), open: true, a: V.dialog ? V.dialog.a : 0 }; changed(); } };
        const cond = () => V.edit[V.editPart === 'and' && V.edit.and ? 'and' : 'when'];

        const A = {
            tab: (i) => { V.page = i; changed(); },
            help: () => { V.mode = V.mode === 'help' ? 'main' : 'help'; changed(); },
            settings: () => { V.mode = V.mode === 'settings' ? 'main' : 'settings'; changed(); },
            back: () => { V.mode = 'main'; changed(); },
            // the DEMO pill in the header: tapped (or pressed with the knob), the demo goes off at once
            demoOff: () => { settings.set('demo', 'off', 'user'); changed(); },
            helpTopic: (i) => { V.helpSel = i; changed(); },
            setting: (k, x) => {
                if (k === 'arm' && x === 'on' && !armed()) return askArm();
                if (k === 'arm' && x === 'off' && armed()) return disarm();
                settings.set(k, x, 'user');
                if (k === 'leftIs') control.setUnits(control.units, Number(x) || 1);
                if (k === 'hold' || k === 'arm') control.settingsChanged();
                changed();
            },
            flapSide: (s) => { V.side = s; changed(); },
            flapMode: (m) => {
                const ctl = useDemo() ? demoControl : control;
                const sides = V.side && V.side !== 'both' && ctl.flaps[V.side] ? [V.side] : ctl.sides();
                const mo = modes();
                sides.forEach((s) => { mo[s] = m; });
                if (ctl.flaps.both) mo.both = m;
                save();
                // a press always sends what it asks (even when it is what was sent last)
                if (!useDemo()) {
                    flapTick();
                    sides.forEach((s) => { const dd = decided[s]; if (dd && (!armed() || link.available)) control.set(s, dd.action, true); });
                } else sides.forEach((s) => { flapTick(); const dd = decided[s]; if (dd) demoControl.set(s, dd.action, true); });
                changed();
            },
            ruleToggle: (id) => { const r = curRules().list.filter((x) => x.id === id)[0]; if (r) { r.on = !r.on; saveRules(); } },
            ruleScroll: (dir) => { V.ruleFirst = Math.max(0, (V.ruleFirst || 0) + dir); changed(); },
            ruleOpen: (id) => {
                const r = id == null ? null : curRules().list.filter((x) => x.id === id)[0];
                V.edit = R.draft(r);
                if (!r) { const k = M.kindsFor(useDemo() ? M.ALL_CAPS : caps()); if (k.indexOf(V.edit.when.kind) < 0) V.edit.when = R.condFor(k[0]); }
                V.editPart = 'when';
                V.dialog = null;
                reopen();
            },
            closeDialog: closeDialog,
            part: (p) => { V.editPart = p; reopen(); },
            kind: (k) => { const p = V.editPart === 'and' && V.edit.and ? 'and' : 'when'; V.edit[p] = R.condFor(k, V.edit[p]); reopen(); },
            op: (o) => { cond().op = o; reopen(); },
            modeValue: (m) => { cond().value = m; reopen(); },
            step: (dir, part) => { R.stepCond(cond(), dir, part); reopen(); },
            action: (a) => { V.edit.action = a; reopen(); },
            flapOf: (s) => { V.edit.flap = s; reopen(); },
            addAnd: () => { V.edit.and = R.condFor(V.edit.when.kind === 'mode' ? 'rpm' : 'mode'); V.editPart = 'and'; reopen(); },
            dropAnd: () => { delete V.edit.and; V.editPart = 'when'; reopen(); },
            ruleSave: () => {
                const rs = curRules(), d = V.edit;
                if (!d.flap || d.flap === 'both') delete d.flap;
                if (d.id == null) { d.id = rs.nextId(); d.name = R.autoName(d); rs.list.push(d); }
                else {
                    const i = editIndex();
                    const old = rs.list[i];
                    if (!old || JSON.stringify(old.when) !== JSON.stringify(d.when) || old.action !== d.action) d.name = old && /^(Quiet start|Full throttle|Night|Town speed)$/.test(old.name) && old.when.kind === d.when.kind ? old.name : R.autoName(d);
                    if (i >= 0) rs.list[i] = d;
                }
                rs.set(rs.list);
                saveRules(); closeDialog();
            },
            ruleDelete: () => { const rs = curRules(), i = editIndex(); if (i >= 0) { rs.list.splice(i, 1); rs.set(rs.list); } saveRules(); closeDialog(); },
            ruleUp: () => { const rs = curRules(), i = editIndex(); if (i > 0) { const x = rs.list[i]; rs.list[i] = rs.list[i - 1]; rs.list[i - 1] = x; rs.set(rs.list); } saveRules(); closeDialog(); },
            setup: (k, x) => {
                if (useDemo()) demoSetup = Object.assign({}, demoSetup || (demoS ? demoS.setup : M.SETUP_DEFAULT), { [k]: x });
                else { P.setup[k] = x; P.setupUser = Object.assign(P.setupUser || {}, { [k]: true }); save(); }
                changed();
            },
        };
        function askArm() {
            openDialog({ label: 'Flap control', labelColor: 'warm', h: 400, title: 'Arm the flap control?',
                text: 'From now on the app commands the real exhaust flap, the way a workshop tester does: BMW\'s own flap control on the engine unit, OPEN, CLOSE and hand back (CAR). The rules on the Flap page decide in AUTO.\n\nCAR always hands it back to the car. The engine unit takes back a command it is not sent again within about 20 s.',
                note: 'Try it standing first. Disarm it before a workshop visit or an emissions test.',
                buttons: [{ label: 'Cancel', run: closeDialog }, { label: 'Yes, arm it', kind: 'bad', run: () => { settings.set('arm', 'on', 'user'); control.settingsChanged(); closeDialog(); probe(); } }] });
        }
        /** Disarming hands every flap that the app holds back to the car first, then sends nothing any more. */
        async function disarm() {
            const held = control.sides().filter((s) => control.flaps[s].sent !== 'OEM');
            if (held.length && link.available) { try { await Promise.all(held.map((s) => control.set(s, 'OEM', true))); } catch (e) { log.warn('hand back: ' + e); } }
            settings.set('arm', 'off', 'user');
            control.settingsChanged();
            changed();
        }

        /* ---------- drawing ---------- */
        let lastFrame = 0;
        async function render() {
            const now = Date.now(), fps = Number(settings.get('fps')) || 60;
            if (now - lastFrame < 1000 / fps - 2) return;
            lastFrame = now;
            S = build();
            V.values = values();
            const cv = UI.zoom(ctx.canvas(UI.RW, UI.RH));
            const pages = M.pagesFor(S.caps, S.engine), names = M.tabsFor(S.engine);
            if (cv.chrome) cv.chrome.tabs = UI.groupMenu(M.groupsFor(S.caps, S.engine), V.page, V.mode);
            void pages; void names;
            if (V.dialog) {
                V.dialog.a = UI.anim('p96exhaust|dialog', V.dialog.open ? 1 : 0, 200);
                if (!V.dialog.open && V.dialog.a <= 0) V.dialog = null;
            }
            VIEW.draw(cv, S, V, A, (now - t0) / 1000);
            await ui.image('MAIN_GFX', cv);
        }
        const pagesNow = () => M.pagesFor(S ? S.caps : caps(), S ? S.engine : null);
        const step = (dir) => { const p = pagesNow(), i = p.indexOf(V.page); V.page = p[UI.nextTab(Math.max(0, i), p.length, dir)]; V.mode = 'main'; changed(); };
        if (ctx.onTab) ctx.onTab((i) => {
            const pick = UI.menuPick(null, i);     // the group's page, or help, settings
            if (pick === 'more') changed();
            else if (pick === 'help' || pick === 'settings') { V.mode = pick; changed(); }
            else if (typeof pick === 'number' && pick >= 0) { V.mode = 'main'; A.tab(pick); }
        });
        ui.onClick('BTN_PAGE', () => step(1));
        ui.onClick('BTN_PREV', () => step(-1));
        ui.onClick('BTN_SETTINGS', () => A.settings());
        if (ctx.hideButton) { ctx.hideButton('BTN_PAGE'); ctx.hideButton('BTN_PREV'); }
        loop = ctx.loop('MAIN', Number(settings.get('fps')) || 60, render);

        let hiddenAt = 0;
        function setShown(on) {
            if (on === shown) return;
            shown = on;
            link.setShown(on);
            if (on) {
                readLoop(); probe();
                // back after a minute or more: Home, the flap's buttons in reach (owner 2026-11-27 22:20, proposed (claude))
                if (hiddenAt && Date.now() - hiddenAt > 60000 && V.mode === 'main' && !V.dialog) V.page = M.HOME;
                openAction();
            } else { V.dialog = null; save(); hiddenAt = Date.now(); }
            changed();
        }
        /** The app opened: what the settings say a press on its favourite button does to the flap. */
        function openAction() {
            const act = settings.get('openAction') || 'none', S0 = S || build();
            if (act === 'none' || !M.has(S0.caps, 'flap')) return;
            const mo = modes(), ctl = useDemo() ? demoControl : control, cur = mo.both || mo[ctl.sides()[0]] || 'AUTO';
            const m = act === 'open' ? 'OPEN' : act === 'close' ? 'CLOSED' : cur === 'OPEN' ? 'AUTO' : 'OPEN';
            V.page = M.HOME; V.mode = 'main'; V.side = 'both';
            log.info('opened: the flap set to ' + m + ' (' + act + ')');
            A.flapMode(m);
        }
        ui.onVisible((name, on) => { if (name === 'MAIN') setShown(on); });
        if (ui.isVisible && ui.isVisible('MAIN')) setShown(true);
        settings.onChange((k) => { if (k === 'arm' || k === 'hold') control.settingsChanged(); if (k === 'arm' && armed()) probe(); changed(); });
        if (armed()) probe();
        log.info('Exhaust started' + (armed() ? ', flap control armed' : ', flap control simulated'));
    },
});
