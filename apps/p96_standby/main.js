// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Standby: the car's wiring. The car's broadcast signals go into live values, the pages (pages.js) draw them.
 * Standby writes nothing to the car, ever.
 *
 * Signals (all read only, each optional: a card shows once its value has come):
 *   EnvironmentalInformation.ExteriorTemperature         outside
 *   CDS.statusBattery2                                   12 V charge in % (the car's own figure)
 *   KombiIF.statusRangeTankStatus                        range, fuel in the tank
 *   KombiIF.statusBordcomputerAverage                    the trip computer's average consumption (trip 1)
 *   Vehicle2.statusCarSpeed2                             speed, for this drive and today
 *   Vehicle.statusDayNightChangeOver                     the car's day / night, for the night colour
 *   DoorsWindowsRoofMirrors.CentralLockingSystemAndPanelStatus   doors (windows and lock when present)
 *   Climate.statusSeatHeatingDR / PS, SteeringWheelClimate.heatingState, ClimateMaster, Climate2   comfort states
 *   VehicleCondition.VehicleCondition                    locked and left: no request at all, so the car can sleep
 * One diagnostic read: the 12 V voltage has no broadcast signal (F8), so it is DME 22 5853 through the kit's
 * ReadOnlyDiag (which refuses anything that is not a read), every 10 s and only while the Clock or Glance page is
 * on the screen.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { DidReader } = require('./kit/dids');
const UI = require('./garage_ui');
const M = require('./model');
const P = require('./pages');

const W = 1600, H = 520;
const HIST_MS = 10000, HIST_N = 60;          // 10 minutes of outside and battery, one sample each 10 s
const VOLT_MS = 10000;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const cfg = ctx.spec.config || {}, S = cfg.scaling || {};
        const sc = (k, raw) => {
            const c = S[k];
            if (!c || typeof raw !== 'number' || raw === c.invalid || (c.max != null && raw >= c.max)) return null;
            return raw * c.factor + (c.offset || 0);
        };
        const val = (k) => {
            const v = settings.get(k);
            return v !== undefined && v !== null ? v : P.DEFAULTS[k];
        };
        const now = () => Date.now();

        /* ---------- saved: what this car reports, today's drives ---------- */
        const FILE = path.join(ctx.dataDir, 'standby.json');
        let saved = {};
        try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { /* first start */ }
        const seen = new M.Seen(saved.seen);
        const drives = new M.Drives(saved.drives);
        let dirty = false;
        function save() {
            if (!dirty && !seen.dirty) return;
            dirty = false; seen.dirty = false;
            try { fs.writeFileSync(FILE + '.tmp', JSON.stringify({ seen: seen.list(), drives: drives.toJSON() })); fs.renameSync(FILE + '.tmp', FILE); }
            catch (e) { log.warn('save: ' + e); }
        }

        /* ---------- live values ---------- */
        const live = { outside: null, volts: null, charge: null, range: null, fuelL: null, fuelAvg: null, speed: null, carNight: null,
            doors: null, windows: null, locked: null, seats: {}, wheel: null, climate: null, ac: null, blower: null, left: false };
        const hist = { outside: [], volts: [] };
        let lastCar = 0;
        const put = (k, v) => { live[k] = v; if (v !== null && v !== undefined) { seen.mark(k); lastCar = now(); } };
        const onOff = (x) => (x === true || x === 1 || /(_EIN|_ON|^EIN|^ON)$/.test(String(x)) ? true : x === false || x === 0 || /(_AUS|_OFF|^AUS|^OFF)$/.test(String(x)) ? false : null);
        const entries = (v, key, out) => {
            out = out || [];
            if (v && typeof v === 'object') { if (key in v) out.push(v); else Object.keys(v).forEach((k) => entries(v[k], key, out)); }
            return out;
        };
        const anyOn = (v, key) => {
            const xs = entries(v, key).map((e) => onOff(e[key])).filter((x) => x !== null);
            return xs.length ? xs.some((x) => x) : null;
        };
        const CONS_L100 = { 1: true, VERBRAUCH_IN_L_S_100KM: true };

        const watches = [
            ['de.bmw.infrastructure.EnvironmentalInformation', { ExteriorTemperature: (v) => put('outside', sc('ambient', v && v.temperatureExterior)) }],
            ['de.bmw.infotainment.vehicle.CDS', { statusBattery2: (v) => {
                const c = v && v.conditionBatteryChargingCondition;
                if (typeof c === 'number' && c >= 0 && c <= 100) put('charge', c);
            } }],
            ['de.bmw.infotainment.KombiIF', {
                statusRangeTankStatus: (v) => {
                    if (!v) return;
                    if (typeof v.range === 'number' && v.range > 0 && v.range < 4095) put('range', v.range);
                    if (typeof v.fluidLevelFuelTank === 'number' && v.fluidLevelFuelTank > 0 && v.fluidLevelFuelTank < 255) put('fuelL', v.fluidLevelFuelTank);
                },
                statusBordcomputerAverage: (v) => {
                    // only in l/100 km: the page writes that unit
                    if (!v || !CONS_L100[v.statusUnitOfMeasurementConsumptionBC]) return;
                    const c = v.consumptionAverage1BC1;
                    if (typeof c === 'number' && c < 65535) live.fuelAvg = c * 0.1;
                },
            }],
            ['de.bmw.infotainment.vehicle.Vehicle2', { statusCarSpeed2: (v) => {
                const k = v && v.speedVehicleCentreOfGravity;
                live.speed = typeof k !== 'number' || k * 0.015625 > 400 ? null : k * 0.015625;
                if (live.speed !== null) lastCar = now();
            } }],
            ['de.bmw.infotainment.vehicle.Vehicle', { statusDayNightChangeOver: (v) => { const n = M.nightOf(v); if (n !== null) live.carNight = n; } }],
            ['de.bmw.body.DoorsWindowsRoofMirrors', { CentralLockingSystemAndPanelStatus: (v) => {
                const d = M.doorsOf(v), w = M.windowsOf(v), l = M.lockOf(v);
                if (d) put('doors', d);
                if (w) live.windows = w;
                if (l !== null) live.locked = l;
            } }],
            ['de.bmw.infotainment.climate.Climate', {
                statusSeatHeatingDR: (v) => { const l = M.seatLevel(M.one(v, 'statusSeatHeaterDR')); if (l !== null) { live.seats.DR = l; put('seats', live.seats); } },
                statusSeatHeatingPS: (v) => { const l = M.seatLevel(M.one(v, 'statusSeatHeaterPS')); if (l !== null) { live.seats.PS = l; put('seats', live.seats); } },
            }],
            ['de.bmw.body.steeringwheelcomfort.SteeringWheelClimate', { heatingState: (v) => { const h = M.one(v, 'heating'); if (typeof h === 'boolean') put('wheel', h); } }],
            ['de.bmw.infotainment.climate.climatemaster.ClimateMaster', {
                statusClimateSystemOn: (v) => { const on = anyOn(v, 'airConditioningOn'); if (on !== null) put('climate', on); },
                statusAirCondAC: (v) => { const on = anyOn(v, 'acButton'); if (on !== null) live.ac = on; },
            }],
            ['de.bmw.infotainment.climate.Climate2', { statusAirConditionDRStatus: (v) => {
                const b = M.one(v, 'statusBlowerSettingDR');
                if (typeof b === 'number' && b < 255) live.blower = b;
            } }],
            ['de.bmw.infrastructure.VehicleCondition', { VehicleCondition: (v) => {
                const raw = v && v.statusConditionVehicle, n = typeof raw === 'number' ? raw : null;
                // 1 to 3: parked, standby (nobody in the car), as upstream's apps read it
                if (n !== null && n >= 1 && n <= 12) live.left = n <= 3;
            } }],
        ];
        const POLL = { Climate: 15000, SteeringWheelClimate: 15000, ClimateMaster: 10000, Climate2: 10000, KombiIF: 15000 };
        const subs = [], t0 = now();
        watches.forEach((w) => {
            const short = w[0].split('.').pop();
            ctx.signals.watch(w[0], '1', w[1], log, POLL[short] ? { pollMs: POLL[short] } : undefined)
                .then((s) => { subs.push(s); log.info('signal ' + short + (s.error ? ' error: ' + s.error : ' subscribed')); })
                .catch((e) => log.warn('signal ' + short + ': ' + (e && e.message || e)));
        });
        const carPresent = () => lastCar > 0 || subs.some((s) => s.available);
        function usingDemo() {
            const d = val('demo');
            return d === 'on' || (d === 'auto' && !carPresent() && now() - t0 > 5000);
        }

        /* ---------- the screen state ---------- */
        const st = { page: 'main', tab: 0, topic: 0, settings: {}, status: 'LIVE', statusColor: 'ok', now: 0, menuA: 1, nightP: 0 };
        let lastTap = now(), shown = false;
        const touch = () => { lastTap = now(); };

        /* ---------- the 12 V voltage: one read, only while Clock or Glance is shown ---------- */
        const dme = cfg.dme || {};
        let link = null, rd = null, linkFailed = false, voltAt = 0, reading = false;
        const wantVolts = () => shown && st.page === 'main' && (st.tab === 0 || st.tab === 1) && !live.left && !usingDemo() && !linkFailed;
        async function readVolts() {
            if (reading || !wantVolts() || now() - voltAt < VOLT_MS || !(dme.volts && dme.volts.length)) return;
            reading = true; voltAt = now();
            try {
                if (!link) {
                    link = new ReadOnlyDiag(ctx.signals, log);
                    try { await link.init(); } catch (e) { linkFailed = true; log.warn('engine unit link: ' + e); return; }
                    rd = new DidReader(link, { ecu: dme.ecu || 18 });
                }
                const v = await rd.value('volts', dme.volts);
                if (M.isNum(v)) put('volts', v);
            } catch (e) { log.warn('12 V read: ' + e); }
            finally { reading = false; }
        }

        /* ---------- the clock: drives, histories, saving ---------- */
        let demoDrives = null, histAt = 0;
        setInterval(() => {
            const t = now();
            if (!usingDemo()) drives.feed(t, live.speed, live.outside, live.fuelAvg);
            if (t - histAt >= HIST_MS) {
                histAt = t;
                const d = usingDemo() ? M.Demo.values(t) : live;
                ['outside', 'volts'].forEach((k) => { hist[k].push(M.isNum(d[k]) ? d[k] : null); if (hist[k].length > HIST_N) hist[k].shift(); });
            }
            readVolts();
        }, 250);
        setInterval(() => { if (drives.cur || drives.list.length) dirty = true; save(); }, 60000);

        /* ---------- the values the pages draw ---------- */
        function values(t) {
            if (usingDemo()) {
                const d = M.Demo.values(t);
                if (!demoDrives) demoDrives = M.Demo.drives(t);
                d.outsideHist = hist.outside.length > 1 ? hist.outside : [d.outside + 1.5, d.outside];
                d.voltsHist = hist.volts.length > 1 ? hist.volts : [d.volts, d.volts];
                d.drives = demoDrives;
                d.has = () => true;
                return d;
            }
            const v = Object.assign({}, live);
            v.outsideHist = hist.outside; v.voltsHist = hist.volts; v.drives = drives;
            v.has = (k) => seen.has(k) && live[k] !== null && live[k] !== undefined;
            return v;
        }

        const go = (i) => { st.page = 'main'; st.tab = (i + P.TABS.length) % P.TABS.length; touch(); };
        const act = {
            tab: (i) => go(i),
            help: () => { st.page = 'help'; touch(); },
            settings: () => { st.page = 'settings'; touch(); },
            back: () => { st.page = 'main'; touch(); },
            topic: (i) => { st.topic = i; },
            set: (k, v) => settings.set(k, v, 'user'),
            wake: () => touch(),
        };
        ui.onClick('BTN_PAGE', () => go(st.tab + 1));
        ui.onClick('BTN_PREV', () => go(st.tab - 1));
        ui.onClick('BTN_SETTINGS', () => { st.page = st.page === 'settings' ? 'main' : 'settings'; touch(); });
        ctx.onTab((i) => go(i));
        ui.onVisible((name, on) => { if (name === 'MAIN') { shown = on; if (on) touch(); else save(); } });
        if (ui.isVisible('MAIN')) { shown = true; touch(); }

        const keys = Object.keys(P.DEFAULTS);
        let last = 0;
        async function render() {
            const t = now(), fps = Number(val('fps')) || 60;
            if (t - last < 1000 / fps - 4) return;
            last = t;
            keys.forEach((k) => { st.settings[k] = val(k); });
            const d = usingDemo();
            st.status = d ? 'DEMO' : 'LIVE'; st.statusColor = d ? 'info' : 'ok'; st.now = t;
            st.menuA = M.menuAlpha(lastTap, t, st.settings.menuDelay);
            st.nightP = UI.anim('sbnight', M.isNight(String(st.settings.night), d ? null : live.carNight, new Date(t)) ? 1 : 0, 1500);
            const cv = ctx.canvas(W, H);
            // where the kit runs the screen, it draws the tabs and routes their taps to ctx.onTab (F10)
            if (cv.chrome) cv.chrome.tabs = { tabs: st.page === 'main' ? P.TABS : [], sel: st.tab, badges: [] };
            P.draw(cv, values(t), st, (t - t0) / 1000, act);
            await ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 10, render);
        process.on('exit', () => { drives.finish(); dirty = true; save(); });
        log.info('Standby started' + (seen.list().length ? ', this car reports: ' + seen.list().join(' ') : ''));
    },
});
