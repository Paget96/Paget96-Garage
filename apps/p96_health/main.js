// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Health (Paget96 Garage, id p96_health): one look at the whole car. Faults by unit with their history, the 12 V
 * battery, the service items, tyres, fluids, a score from 0 to 100 and a report to share.
 *
 * Where the values come from:
 *   broadcast (always, also in the background, nothing is sent to the car):
 *     CDS statusEngineSpeed2, statusEngineTemperature, statusBattery2 (12 V charge %); Vehicle2 statusCarSpeed2 (the
 *     km Health counts itself); TPMS statusTyrePressure (read every 10 s, as BMW's own x_call does)
 *   broadcast, only while the screen is shown (watching the cluster unasked disturbed other apps upstream):
 *     KombiInterface_2 cbsDataServiceList (service items), ccList / newCCMessage (Check Control names);
 *     CheckControlMaster basicList (the messages on now)
 *   diagnostic requests, only while the screen is shown (diaglink.js checks every one):
 *     19 02 / 19 17 to all units (fault and info memory), 0A to the engine (permanent emission faults), 19 03 / 04 /
 *     06 for an opened fault; 01 01 / 01 41 (OBD readiness, only while the Faults page is shown); 22 5853 (12 V voltage), 22 5811 (oil level), 22 4404 (oil km), 22 4163 (spark plug
 *     km) from the engine unit; 22 1001 / 1002 from the cluster before a service reset
 * The 12 V resting voltage has no broadcast signal: Health reads it the first time the screen is shown after the car
 * slept (setting Nightly battery check), never in the background.
 *
 * Writes (D19, D20), each only on a tap and its confirmation, with the engine off, never by itself:
 *   Clear faults    the units the user ticked (the engine unit never ticked for him, I22), the report saved first,
 *                   then 14 FF FF FF to each, a new scan shows what came back
 *   Reset (Service) one of the car's own service items, when the cluster allows it, then the item read again
 *
 * Reminders (I11): the app has no way to put up a notification (FINDINGS), so a service that comes near shows on
 * the home-screen widget and once in a dialog the next time Health is opened.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { ScaledCanvas } = require('./kit/canvas');
const UI = require('./garage_ui');
const M = require('./model');
const T = require('./texts');
const VIEW = require('./view');
const DEMO = require('./demo');
const { HealthLink, ENGINE } = require('./diaglink');

const CDS = 'de.bmw.infotainment.vehicle.CDS', VEH = 'de.bmw.infotainment.vehicle.Vehicle2', TPMS = 'de.bmw.infotainment.vehicle.TPMS';
const KOMBI = 'de.bmw.infotainment.KombiInterface_2', CCM = 'de.bmw.infotainment.checkcontrol.CheckControlMaster';
const HOUR = 3600000, DAY = M.DAY;
const REST_AFTER = 3 * HOUR;          // parked this long: the voltage is a resting voltage
const ENGINE_STOPPED_RPM = 400;       // a hybrid's stopped engine leaves its run-down value (kit/car.js)

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const t0 = Date.now();

        /* ---------- what Health keeps (data/health.json) ---------- */
        const FILE = path.join(ctx.dataDir, 'health.json');
        let P = {};
        try { P = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first start */ }
        P = Object.assign({ log: {}, nights: [], starts: [], socHist: [], cold: {}, km: 0, done: {}, parts: [], partsOff: [], scores: [],
            changes: [], seen: {}, reminded: {}, obd: null, readyLast: null, lastDriveEnd: null, warm: null, rest: null, restAt: null, startMin: null, caps: {}, carKey: 'car' }, P);
        /** What this car supports, remembered per car (by its VIN, read from the engine unit when the screen first shows). */
        const caps = () => (P.caps[P.carKey] = P.caps[P.carKey] || {});
        const found = (k, yes) => { if (M.found(caps(), k, yes)) { save(); changed(); } };
        let saveTimer = null;
        const save = () => {
            if (saveTimer) return;
            saveTimer = setTimeout(() => {
                saveTimer = null;
                try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(P)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { log.warn('save: ' + e); }
            }, 2000);
        };
        const change = (kind, text) => {
            P.changes.unshift({ t: Date.now(), kind: kind, text: text });
            P.changes = P.changes.slice(0, 30);
            save();
        };

        /* ---------- live values ---------- */
        const live = { rpm: null, rpmAt: 0, speed: null, speedAt: 0, oil: null, coolant: null, soc: null, pressures: {}, pAt: 0,
            cbs: null, cc: null, ccNames: new Map(), ccOn: new Map(), units: null, oilCl: null, oilKm: null, plugKm: null, volts: null };
        let shown = false, reading = false, version = 0;
        const changed = () => { version++; if (loop) loop.kick(); };
        const engineStopped = () => live.rpm === 0 && Date.now() - live.rpmAt < 5000 && !(live.speed > 0.5);

        const link = new HealthLink(ctx.signals, log, { engineStopped: engineStopped });
        let linkReady = null;
        const getLink = () => linkReady || (linkReady = link.init().catch((e) => { log.warn('diagnostic link: ' + e); return link; }));

        const demoSetting = () => settings.get('demo') || 'auto';
        const useDemo = () => demoSetting() === 'on' || (demoSetting() === 'auto' && live.rpm == null && live.units == null && !link.available);

        /* ---------- broadcast signals, always ---------- */
        let lastSpeedT = 0;
        const bg = [
            [CDS, {
                statusEngineSpeed2: (v) => {
                    const r = v && v.actualValueRPMEngineCrankshaft;
                    if (typeof r !== 'number' || r === 65535) return;
                    const rpm = r * 0.25 < ENGINE_STOPPED_RPM ? 0 : r * 0.25, was = live.rpm;
                    live.rpm = rpm; live.rpmAt = Date.now();
                    if (rpm > 0) { P.lastDriveEnd = null; }
                    if (rpm === 0 && was > 0) { P.lastDriveEnd = Date.now(); save(); }
                    if (rpm > 0 && was === 0) engineStarted();
                },
                statusEngineTemperature: (v) => {
                    const o = v && v.temperatureEngineOilDrive, c = v && v.temperatureEngineDrive;
                    if (typeof o === 'number' && o !== 255) { live.oil = o - 48; if (!caps().oilTemp) found('oilTemp', true); }
                    if (typeof c === 'number' && c !== 255) { live.coolant = c - 48; if (!caps().coolantTemp) found('coolantTemp', true); }
                },
                statusBattery2: (v) => {
                    const c = v && v.conditionBatteryChargingCondition;
                    if (typeof c !== 'number' || c < 0 || c > 100) return;
                    live.soc = c;
                    if (!caps().soc) found('soc', true);
                    const now = Date.now(), last = P.socHist[P.socHist.length - 1];
                    if (!last || now - last[0] > HOUR) { P.socHist.push([now, c]); P.socHist = P.socHist.slice(-12); save(); }
                },
            }],
            [VEH, {
                statusCarSpeed2: (v) => {
                    const s = v && v.speedVehicleCentreOfGravity;
                    if (typeof s !== 'number' || s === 65535) return;
                    const kmh = s * 0.015625, now = Date.now();
                    if (lastSpeedT && now - lastSpeedT < 5000 && kmh > 0.5) { P.km += kmh * (now - lastSpeedT) / HOUR; if (Math.random() < 0.02) save(); }
                    lastSpeedT = now; live.speed = kmh; live.speedAt = now;
                    if (!caps().speed) found('speed', true);
                },
            }],
            [TPMS, {
                // 0.1 x raw in the car's pressure unit, 65532 and up invalid; kPa and psi told apart by range (car_vitals)
                statusTyrePressure: (v) => {
                    const bar = (raw) => {
                        if (typeof raw !== 'number' || raw >= 65532) return null;
                        const x = raw * 0.1;
                        return x >= 0.5 && x <= 6 ? x : x >= 7 && x < 60 ? x / 14.5038 : x >= 60 && x <= 600 ? x / 100 : null;
                    };
                    const p = { FL: bar(v && v.actualValuePressureTyreFLH), FR: bar(v && v.actualValuePressureTyreFRH),
                        RL: bar(v && v.actualValuePressureTyreRLH), RR: bar(v && v.actualValuePressureTyreRRH) };
                    if (M.WHEELS.every((w) => p[w] == null)) return;
                    live.pressures = p; live.pAt = Date.now();
                    if (!caps().tpms) found('tpms', true);
                    coldReading(p);
                },
            }],
        ];
        Promise.all(bg.map((b) => ctx.signals.watch(b[0], '1', b[1], log, b[0] === TPMS ? { pollMs: 10000 } : undefined)))
            .then((all) => log.info('signals: ' + all.map((s) => s.iface.split('.').pop() + (s.error ? ' (' + s.error + ')' : '')).join(', ')))
            .catch((e) => log.warn('signals: ' + e));

        /** One cold tyre reading a day: parked for hours, or the coolant still cold, standing still. */
        function coldReading(p) {
            const now = Date.now(), parked = P.lastDriveEnd && now - P.lastDriveEnd > REST_AFTER;
            const cold = parked || (live.coolant != null && live.coolant < 35);
            if (!cold || live.speed > 0.5) return;
            const day = Math.floor(now / DAY);
            M.WHEELS.forEach((w) => {
                if (p[w] == null) return;
                const a = P.cold[w] = P.cold[w] || [];
                if (a.length && Math.floor(a[a.length - 1][0] / DAY) === day) return;
                a.push([now, Math.round(p[w] * 1000) / 1000]);
                P.cold[w] = a.slice(-28);
            });
            save();
        }

        /** The warm-up of this drive (oil, coolant every 30 s for 10 min) and the start dip, when the screen shows. */
        let warmTimer = null;
        function engineStarted() {
            const w = P.warm = { when: 'today', at: Date.now(), oil: [], coolant: [], minutes: 10 };
            clearInterval(warmTimer);
            const take = () => {
                if (live.oil != null) w.oil.push(live.oil);
                if (live.coolant != null) w.coolant.push(live.coolant);
                if (w.oil.length > 20 || Date.now() - w.at > 10.5 * 60000) { clearInterval(warmTimer); warmTimer = null; save(); }
            };
            take();
            warmTimer = setInterval(take, 30000);
            if (startProbe) startProbe.started = Date.now();
        }

        /* ---------- while the screen is shown ---------- */
        let fg = null;
        function watchShown(on) {
            if (on && !fg) {
                const walk = (o, fn) => {
                    if (!o || typeof o !== 'object') return;
                    if (Array.isArray(o)) { o.forEach((x) => walk(x, fn)); return; }
                    fn(o);
                    Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object') walk(o[k], fn); });
                };
                const names = (v) => walk(v, (o) => {
                    const id = o.cCIdentifer !== undefined ? o.cCIdentifer : o.cCIdentifier, nm = o.cCShortName || o.cCName;
                    if (id !== undefined && nm) { live.ccNames.set(id, String(nm)); found('cc', true); changed(); }
                });
                const find = (v, key) => {
                    if (!v || typeof v !== 'object') return null;
                    if (key in v) return v;
                    for (const k of Object.keys(v)) { const r = find(v[k], key); if (r) return r; }
                    return null;
                };
                const txt = (x) => String(x == null ? '' : x).replace(/[\x00-\x1f\x7f]/g, '').trim();
                fg = Promise.all([
                    ctx.signals.watch(KOMBI, '1', {
                        ccList: names, newCCMessage: names,
                        cbsDataServiceList: (v) => {
                            const arr = Array.isArray(v) ? v : (v && (v.cbsDataServiceList || v.value)) || [];
                            const list = arr.map((e) => {
                                const s = find(e, 'cBSIdentifier') || {};
                                return { id: s.cBSIdentifier, name: txt(s.cBSServcieName || s.cBSServiceName), way: txt(s.cBSServiceWay), date: txt(s.cBSServiceDate), colour: s.cBSColor };
                            }).filter((e) => e.id !== undefined);
                            serviceSeen(list);
                            if (list.length) found('cbs', true);
                            live.cbs = list; changed();
                        },
                    }, log, { pollMs: 60000 }),
                    ctx.signals.watch(CCM, '1', {
                        basicList: (v) => {
                            walk(v, (o) => {
                                if (o.ccmId === undefined) return;
                                if (o.activeState === 'AKTIV' || o.activeState === 0) live.ccOn.set(o.ccmId, o); else live.ccOn.delete(o.ccmId);
                            });
                            // the list answered (empty or not): this car has Check Control
                            live.cc = live.ccOn.size; found('cc', true); changed();
                        },
                    }, log),
                ]);
            } else if (!on && fg) {
                const f = fg; fg = null;
                f.then((l) => Promise.all(l.map((w) => w && w.shutdown && w.shutdown()))).catch(() => {});
            }
        }
        /** A service item whose distance or date jumped up: it was done (by us or a workshop). */
        function serviceSeen(list) {
            const before = P.cbsLast || {}, now = {};
            M.cbsItems(list, Date.now()).forEach((it) => {
                now[it.id] = it.frac;
                if (before[it.id] != null && it.frac != null && it.frac - before[it.id] > 0.3) change('ok', it.name + ' service done');
            });
            P.cbsLast = now; save();
        }

        /* ---------- scans and reads (only while shown) ---------- */
        async function scan() {
            if (reading || useDemo()) return;
            reading = true; faultMsg = 'Reading the fault memories...'; faultMsgColor = 'info'; changed();
            try {
                await getLink();
                const units = new Map();
                const take = (res, mem) => res.replies.forEach((uds, addr) => {
                    const p = M.parseDtcReply(uds, res.params, mem);
                    const u = units.get(addr) || { addr: addr, dtcs: [] };
                    p.dtcs.forEach((d) => u.dtcs.push(d));
                    units.set(addr, u);
                });
                const fm = await link.readMemory('fault', 0x0D);
                take(fm, 'fault');
                found('faults', units.size > 0);
                // the info memory and permanent faults only where the car answered them before, or has not been asked yet
                if (shown && caps().info !== false) {
                    try {
                        const im = await link.readMemory('info', 0x0C);
                        let ok = false;
                        im.replies.forEach((u) => { if (u && u[0] === 0x59) ok = true; });
                        take(im, 'info');
                        found('info', ok);
                    } catch (e) { log.warn('info memory: ' + e); }
                }
                if (shown && caps().perm !== false) {
                    try {
                        const perm = M.parsePermanent(await link.readPermanent());
                        found('perm', perm.ok);
                        if (perm.ok) { const u = units.get(ENGINE) || { addr: ENGINE, dtcs: [] }; perm.dtcs.forEach((d) => u.dtcs.push(d)); units.set(ENGINE, u); }
                    } catch (e) { log.warn('permanent faults: ' + e); }
                }
                live.units = Array.from(units.values());
                const added = M.addScan(P.log, { at: Date.now(), km: null, units: live.units });
                added.forEach((e) => {
                    const s = P.seen[e.code] = P.seen[e.code] || { count: 0 };
                    if (e.kind === 'first' || e.kind === 'again') { s.count++; s.last = e.t; }
                    const what = T.faultShort(e.code);
                    if (e.kind === 'first') change('warm', what + ' fault stored');
                    if (e.kind === 'gone') change('ok', what + ' fault gone by itself');
                    if (e.kind === 'cleared') change('info', what + ' fault cleared');
                });
                faultMsg = live.units.length ? '' : 'No unit answered: ignition on?';
                faultMsgColor = live.units.length ? null : 'warm';
                save();
            } catch (e) {
                faultMsg = 'Scan failed: ' + (e.message || e); faultMsgColor = 'bad';
                log.warn('scan: ' + e);
            }
            reading = false; changed();
        }
        const u16 = (r) => (r && r[0] === 0x62 && r.length >= 5 ? (r[3] << 8) | r[4] : null);
        const u32 = (r, at) => (r && r[0] === 0x62 && r.length >= 3 + at + 4 ? ((r[3 + at] << 24) | (r[4 + at] << 16) | (r[5 + at] << 8) | r[6 + at]) >>> 0 : null);
        /** The engine unit's values: 12 V voltage (a resting one after the car slept), oil level, oil and spark plug km. */
        async function readEngine() {
            if (useDemo() || !shown) return;
            await getLink();
            try {
                if (!P.vinRead) {
                    const r = await link.read(ENGINE, 0xF190);
                    if (r && r[0] === 0x62 && r.length >= 20) {
                        const vin = String.fromCharCode.apply(null, r.slice(3, 20)).replace(/[^A-Z0-9]/g, '');
                        if (vin.length === 17 && vin !== P.carKey) {
                            // a new car (or the first time the VIN is read): keep what was found so far for it
                            if (P.carKey === 'car' && P.caps.car) { P.caps[vin] = Object.assign(P.caps[vin] || {}, P.caps.car); delete P.caps.car; }
                            P.carKey = vin; save();
                        }
                    }
                    P.vinRead = true;
                }
                const v = u16(await link.read(ENGINE, 0x5853));
                found('volts', v != null && v > 6000 && v < 16000);
                if (v != null && v > 6000 && v < 16000) {
                    live.volts = v / 1000;
                    const parked = P.lastDriveEnd && Date.now() - P.lastDriveEnd > REST_AFTER;
                    if (engineStopped() && parked && settings.get('nightly') !== 'off') restReading(live.volts);
                }
                const ask = (k, did) => (caps()[k] === false ? Promise.resolve(null) : link.read(ENGINE, did));     // not asked again once it did not answer
                const oil = await ask('oilLevel', 0x5811);
                if (caps().oilLevel !== false || oil) found('oilLevel', !!(oil && oil[0] === 0x62 && oil.length >= 4 && oil[3] !== 255));
                if (oil && oil[0] === 0x62 && oil.length >= 4 && oil[3] !== 255) live.oilCl = oil[3];
                const okr = await ask('oilKm', 0x4404), ok = u16(okr);
                if (caps().oilKm !== false || ok != null) found('oilKm', ok != null);
                if (ok != null) live.oilKm = ok * 10;
                const pk = u32(await ask('plugKm', 0x4163), 6);
                if (caps().plugKm !== false || pk != null) found('plugKm', pk != null && pk < 1000000);
                if (pk != null && pk < 1000000) live.plugKm = pk;
                // which service items the cluster knows how to reset (22 10 02, a read): only those get a Reset
                if (caps().cbs && !caps().cbsIds) {
                    const r = await link.cbsResettable();
                    if (r && r[0] === 0x62) { const ids = []; for (let i = 3; i + 3 <= r.length; i += 3) ids.push(r[i]); caps().cbsIds = ids; save(); }
                }
            } catch (e) { log.warn('engine values: ' + e); }
            changed();
        }
        /** OBD readiness (I22), read only through ReadOnlyDiag, only while the Faults page is shown: PID 01 and, when the
         * car answers it, PID 41. What changed since the last read goes to History. */
        async function readReadiness() {
            if (useDemo() || !shown || V.page !== 1 || readingReady || caps().readiness === false) return;
            readingReady = true;
            try {
                await getLink();
                const r01 = M.parseReadiness(await link.readReadiness(0x01), 0x01);
                found('readiness', r01.ok);
                if (!r01.ok) return;
                let r41 = null;
                if (caps().readinessDrive !== false) {
                    r41 = M.parseReadiness(await link.readReadiness(0x41), 0x41, r01.engine);
                    found('readinessDrive', r41.ok);
                }
                P.obd = { r01: r01, r41: r41 && r41.ok ? r41 : null, at: Date.now() };
                const now = M.readiness(r01, r41);
                M.readinessChanges(P.readyLast, now).forEach((c) => change(c.kind, c.text));
                P.readyLast = { mil: now.mil, rows: now.rows.map((r) => ({ key: r.key, complete: r.complete })), ready: now.ready, total: now.total };
                save();
            } catch (e) { log.warn('readiness: ' + e); } finally { readingReady = false; changed(); }
        }
        let readingReady = false, readyTimer = null;
        /** Reads the readiness now and every 15 s while the Faults page is shown; stops when it is left. */
        function watchReadiness() {
            const on = shown && V.page === 1;
            if (on && !readyTimer) { readReadiness(); readyTimer = setInterval(readReadiness, 15000); }
            if (!on && readyTimer) { clearInterval(readyTimer); readyTimer = null; }
        }

        /** One resting voltage a night (the first after the car slept), into the 14 night chart. */
        function restReading(v) {
            const now = Date.now(), day = Math.floor(now / DAY), last = P.nights[P.nights.length - 1];
            P.rest = v; P.restAt = now;
            if (!last || Math.floor(last[0] / DAY) !== day) {
                P.nights.push([now, Math.round(v * 1000) / 1000]);
                P.nights = P.nights.slice(-14);
                const warn = settings.get('batteryWarn') || 12.4;
                if (v < warn) change('warm', '12 V battery rested at ' + v.toFixed(2) + ' V');
            }
            save();
        }
        /** The start dip: while the screen shows with the engine off, the voltage is read twice a second; the lowest in the
         * 4 s after the engine starts is the dip. */
        let startProbe = null;
        function probeStart(on) {
            if (on && !startProbe) {
                startProbe = { min: null, started: null, timer: null };
                const sp = startProbe;
                sp.timer = setInterval(async () => {
                    if (!shown || useDemo() || reading) return;
                    const now = Date.now();
                    if (!engineStopped() && !(sp.started && now - sp.started < 4000)) return;
                    const v = u16(await link.read(ENGINE, 0x5853).catch(() => null));
                    if (v == null) return;
                    if (sp.started && now - sp.started < 4000) sp.min = sp.min == null ? v / 1000 : Math.min(sp.min, v / 1000);
                    else if (sp.started && sp.min != null) {
                        P.startMin = sp.min; P.starts.push([now, sp.min]); P.starts = P.starts.slice(-14);
                        sp.started = null; sp.min = null; save(); changed();
                    }
                }, 500);
            } else if (!on && startProbe) { clearInterval(startProbe.timer); startProbe = null; }
        }

        /* ---------- the state the pages draw ---------- */
        let faultMsg = '', faultMsgColor = null, serviceMsg = '', serviceMsgColor = null, savedText = '';
        let demo = null, demoAt = 0;
        const values = () => {
            const o = {};
            VIEW.APP_ROWS.concat(UI.DISPLAY_SETTINGS).forEach((r) => { o[r.key] = settings.get(r.key); });
            M.OURS.forEach((r) => { o[r.setting] = settings.get(r.setting); });
            return o;
        };
        function build() {
            const now = Date.now(), vals = values(), d = useDemo();
            let S;
            if (d) {
                if (!demo || now - demoAt > 60000) { demo = DEMO.state(now); demoAt = now; }
                S = Object.assign({}, demo, { demo: true, live: false });
                S.used = demo.used;
            } else {
                const coolantLow = live.cc == null ? null : Array.from(live.ccOn.keys()).some((k) => /coolant|kuehlm|kühlm/i.test(live.ccNames.get(k) || ''));
                const washerLow = live.cc == null ? null : Array.from(live.ccOn.keys()).some((k) => /washer|wasch/i.test(live.ccNames.get(k) || ''));
                const done = P.done || {};
                const kmSince = (k) => (done[k] && done[k].km != null ? P.km - done[k].km : null);
                S = {
                    caps: caps(),
                    at: now, km: null, demo: false, live: live.rpm != null || link.available, units: live.units, log: P.log, cc: live.cc,
                    seen: seenFor(now), snapshots: {},
                    battery: { rest: P.rest, restAt: P.restAt, startMin: P.startMin, soc: live.soc, nights: P.nights, starts: P.starts, socHist: P.socHist.map((p) => p[1]) },
                    cbs: live.cbs || [],
                    used: { oil: live.oilKm, plugs: live.plugKm, air: kmSince('air'), gearbox: kmSince('gearbox'),
                        coolant: done.coolant && done.coolant.t ? (now - done.coolant.t) / (365.25 * DAY) : null },
                    parts: P.parts, partsOff: P.partsOff,
                    pressures: live.pressures, cold: P.cold, coldNow: P.lastDriveEnd && now - P.lastDriveEnd > REST_AFTER,
                    fluids: { oilCl: live.oilCl, oilTemp: live.oil, coolantTemp: live.coolant, coolantLow: coolantLow, washerLow: washerLow },
                    warm: P.warm ? { oil: P.warm.oil, coolant: P.warm.coolant, minutes: Math.max(1, P.warm.oil.length / 2), when: M.ago(P.warm.at, now) } : null,
                    scores: P.scores, changes: P.changes, obd: P.obd,
                };
            }
            M.derive(S, vals, T.faultShort);
            S.reading = reading;
            if (d) S.checkedText = 'checked 2 min ago';
            else S.checkedText = lastScanAt ? 'checked ' + (now - lastScanAt < 60000 ? 'just now' : Math.round((now - lastScanAt) / 60000) + ' min ago') : reading ? 'checking...' : 'not checked yet';
            S.faultMsg = faultMsg; S.faultMsgColor = faultMsgColor; S.serviceMsg = serviceMsg; S.serviceMsgColor = serviceMsgColor;
            S.savedText = savedText;
            S.downBecause = d ? 'the rear left tyre and the stored charge air fault.' : '';
            if (!d && S.score.value != null && S.units) dailyScore(S.score.value);
            return S;
        }
        let lastScanAt = null;
        const seenFor = (now) => {
            const o = {};
            Object.keys(P.seen).forEach((c) => { const s = P.seen[c]; o[c] = { count: s.count, lastDays: s.last ? Math.floor((now - s.last) / DAY) : null, km: null }; });
            return o;
        };
        function dailyScore(v) {
            const day = Math.floor(Date.now() / DAY), last = P.scores[P.scores.length - 1];
            if (last && Math.floor(last[0] / DAY) === day) { last[1] = v; return; }
            P.scores.push([Date.now(), v]); P.scores = P.scores.slice(-120); save();
        }

        /* ---------- where the user is, and what the taps do ---------- */
        const V = { page: 0, mode: 'main', mem: 'fault', unit: null, first: 0, detail: null, histSel: 0, dialog: null, helpSel: 0, values: {} };
        let S = null;
        const openDialog = (d) => { V.dialog = { d: d, open: true }; changed(); };
        const closeDialog = () => { if (V.dialog) V.dialog.open = false; changed(); };
        const okDialog = (label, title, text, color) => openDialog({ label: label, labelColor: color || 'dim', title: title, text: text, h: 330,
            buttons: [{ label: 'OK', kind: 'primary', run: closeDialog }] });

        /** Writes the report (and the scan) to data/reports/: kept before a clear, so the mechanic can still see it. */
        function saveReport() {
            const dir = path.join(ctx.dataDir, 'reports');
            try { fs.mkdirSync(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
            const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
            fs.writeFileSync(path.join(dir, 'health-' + stamp + '.txt'), S.report + '\n');
            fs.writeFileSync(path.join(dir, 'scan-' + stamp + '.json'), JSON.stringify(S.units || []));
            const files = fs.readdirSync(dir).sort();
            while (files.length > 20) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch (e) { break; } }
            savedText = 'Report saved ' + M.dateText(Date.now()) + ', ' + new Date().toTimeString().slice(0, 5) + '. It is on the Share page too.';
            return true;
        }

        const A = {
            tab: (i) => { V.page = i; V.detail = null; watchReadiness(); changed(); },
            mem: (m) => { V.mem = m; V.first = 0; V.detail = null; changed(); },
            unit: (a) => { V.unit = V.unit === a ? null : a; V.first = 0; V.detail = null; if (V.mem === 'history') V.mem = 'fault'; changed(); },
            scroll: (d) => { V.first = Math.max(0, V.first + d); changed(); },
            histSel: (i) => { V.histSel = i; changed(); },
            detail: (d) => {
                V.detail = d; V.context = null; changed();
                if (useDemo() || d.mem === 'perm') return;
                V.context = { reading: true };
                getLink().then(() => link.readContext(d.addr, d.code)).then((c) => {
                    const rows = [];
                    if (c.snapshot) {
                        rows.push(['Record ' + c.snapshot.record, 'id ' + ('000' + c.snapshot.did.toString(16).toUpperCase()).slice(-4)]);
                        for (let i = 0; i < c.snapshot.data.length && rows.length < 8; i += 2) rows.push(['Bytes ' + (i + 1) + '-' + (i + 2), c.snapshot.data.slice(i, i + 2).map((b) => ('0' + b.toString(16).toUpperCase()).slice(-2)).join(' ')]);
                    }
                    if (V.detail === d) { V.context = { rows: rows }; changed(); }
                }).catch((e) => { log.warn('fault details: ' + e); if (V.detail === d) { V.context = { rows: [] }; changed(); } });
            },
            back: () => {
                if (V.mode !== 'main') V.mode = 'main'; else V.detail = null;
                changed();
            },
            help: () => { V.mode = V.mode === 'help' ? 'main' : 'help'; changed(); },
            settings: () => { V.mode = V.mode === 'settings' ? 'main' : 'settings'; changed(); },
            helpTopic: (i) => { V.helpSel = i; changed(); },
            setting: (k, v) => { settings.set(k, v, 'user'); changed(); },
            save: () => {
                try { saveReport(); faultMsg = savedText; faultMsgColor = 'ok'; } catch (e) { faultMsg = 'Report not saved: ' + e.message; faultMsgColor = 'bad'; }
                changed();
            },
            askClear: () => {
                const units = (S.units || []).filter((u) => u.dtcs.some((d) => d.mem === 'fault'));
                if (!units.length) return okDialog('Clear fault memory', 'Nothing to clear', 'No unit holds a fault in its fault memory.', 'ok');
                // every unit with a fault is ticked, except the engine unit: it needs its own tick (I22)
                let ticked = M.clearDefaults(units);
                const h = {
                    tick: (a) => { ticked = ticked.indexOf(a) >= 0 ? ticked.filter((x) => x !== a) : ticked.concat([a]); show(); },
                    all: () => { ticked = M.clearDefaults(units); show(); },
                    cancel: closeDialog,
                    run: () => doClear(units.filter((u) => ticked.indexOf(u.addr) >= 0)),
                };
                const show = () => {
                    const d = VIEW.clearDialog(units, ticked, h);
                    if (V.dialog && V.dialog.open && V.dialog.d.ticked) { V.dialog.d = d; changed(); } else openDialog(d);
                };
                show();
            },
            askReset: (it) => askReset(it),
            askDone: (o) => askDone(o),
            togglePart: (p) => {
                const on = P.parts.indexOf(p) >= 0;
                P.parts = P.parts.filter((x) => x !== p); P.partsOff = P.partsOff.filter((x) => x !== p);
                if (on) P.partsOff.unshift(p); else P.parts.push(p);
                P.partsOff = P.partsOff.slice(0, 3);
                if (demo) { demo.parts = P.parts.slice(); demo.partsOff = P.partsOff.slice(); }
                save(); changed();
            },
            addPart: () => {
                const dlg = { label: 'Add a part', title: 'Pick what you plan to change', w: 1080, h: 460, pick: [] };
                dlg.body = VIEW.addPartBody(S, { dialog: dlg }, A);
                dlg.buttons = [{ label: 'Cancel', run: closeDialog }, { label: 'Add', kind: 'primary', run: () => {
                    dlg.pick.forEach((p) => { if (P.parts.indexOf(p) < 0) P.parts.push(p); P.partsOff = P.partsOff.filter((x) => x !== p); });
                    if (demo) demo.parts = P.parts.slice();
                    save(); closeDialog();
                } }];
                openDialog(dlg);
            },
            pick: (p) => {
                const dlg = V.dialog && V.dialog.d;
                if (!dlg || !dlg.pick) return;
                const i = dlg.pick.indexOf(p);
                if (i >= 0) dlg.pick.splice(i, 1); else dlg.pick.push(p);
                dlg.buttons[1].label = dlg.pick.length ? 'Add ' + dlg.pick.length : 'Add';
                changed();
            },
        };

        /** D19: the report saved, a grant (engine off, confirmed), 14 FF FF FF, a new scan, what came back. */
        async function doClear(units) {
            const engine = units.some((u) => M.isEngine(u.addr));
            const names = units.map((u) => M.unitName(u.addr));
            const what = 'Fault memory cleared: ' + names.slice(0, 2).join(', ') + (names.length > 2 ? ' and ' + (names.length - 2) + ' more' : '') + (engine ? ', readiness reset' : '');
            if (useDemo()) {
                openDialog({ label: 'Clear fault memory', labelColor: 'info', title: 'Clearing...', text: 'Demo data: nothing is sent to the car.', h: 300, buttons: [] });
                await new Promise((r) => setTimeout(r, 900));
                const picked = units.map((u) => u.addr);
                demo.units.forEach((u) => { if (picked.indexOf(u.addr) >= 0) u.dtcs = u.dtcs.filter((d) => d.mem !== 'fault' || u.addr === 0x12); });
                if (engine) demo.obd = DEMO.obdAfterClear();
                demo.changes.unshift({ t: Date.now(), kind: 'info', text: what });
                return openDialog({ label: 'Cleared (demo)', labelColor: 'warm', h: engine ? 420 : 330, title: 'Cleared ' + units.length + (units.length === 1 ? ' unit' : ' units'),
                    text: VIEW.clearedText(engine ? [0x12] : [], [], engine),
                    buttons: engine ? [{ label: 'OK', run: closeDialog }, { label: 'See readiness', kind: 'primary', run: () => { closeDialog(); A.tab(1); A.mem('ready'); } }]
                        : [{ label: 'OK', kind: 'primary', run: closeDialog }] });
            }
            if (!engineStopped()) return okDialog('Not cleared', 'Switch the engine off first', 'Clearing works only with the engine off and the ignition on, and never while driving.', 'warm');
            try { saveReport(); } catch (e) { return okDialog('Not cleared', 'The report could not be saved', String(e.message || e) + '\n\nNothing was cleared.', 'bad'); }
            let res;
            try {
                await getLink();
                const grant = link.grant('clear', { confirmed: true, reportSaved: true });
                openDialog({ label: 'Clear fault memory', labelColor: 'bad', title: 'Clearing...', text: 'Asking every unit to clear its fault memory. Keep the engine off.', h: 300, buttons: [] });
                res = await link.clearFaults(grant, units.map((u) => u.addr));
            } catch (e) { log.warn('clear: ' + e); return okDialog('Not cleared', 'Nothing was cleared', String(e.message || e), 'bad'); }
            M.markCleared(P.log, Date.now());
            log.info('clear: ' + res.cleared.length + ' cleared, ' + res.failed.length + ' not');
            const engineCleared = res.cleared.some(M.isEngine);
            if (res.cleared.length) change('info', what.replace(', readiness reset', '') + (engineCleared ? ', readiness reset' : ''));
            await new Promise((r) => setTimeout(r, 1500));
            await scan();
            if (engineCleared) await readReadiness();
            const back = (live.units || []).filter((u) => res.cleared.indexOf(u.addr) >= 0 && u.dtcs.some((d) => d.mem === 'fault')).map((u) => u.addr);
            const text = VIEW.clearedText(back, res.failed, engineCleared);
            openDialog({ label: 'Fault memory cleared', labelColor: back.length || res.failed.length || engineCleared ? 'warm' : 'ok', h: engineCleared ? 420 : 330,
                title: 'Cleared ' + res.cleared.length + ' of ' + units.length + (units.length === 1 ? ' unit' : ' units'), text: text,
                buttons: engineCleared && M.has(caps(), 'readiness') ? [{ label: 'OK', run: closeDialog }, { label: 'See readiness', kind: 'primary', run: () => { closeDialog(); A.tab(1); A.mem('ready'); } }]
                    : [{ label: 'OK', kind: 'primary', run: closeDialog }] });
        }

        /** D20: is the item one Health resets, does the cluster allow it now, then the confirmation. */
        async function askReset(it) {
            if (!it.resettable) return okDialog('Service item', it.name, 'Health does not reset this item. A workshop resets it after the work.', 'dim');
            if (useDemo()) return confirmReset(it);
            if (!engineStopped()) return okDialog('Not now', 'Switch the engine off first', 'A service item is reset only with the engine off and the ignition on.', 'warm');
            try {
                await getLink();
                const ok = M.resettableNow(await link.cbsResettable());
                if (ok == null) return okDialog('Not now', 'The instrument cluster did not answer', 'Try again in a moment, with the ignition on.', 'warm');
                if (ok.indexOf(it.id) < 0) return okDialog('Not now', 'The car does not allow resetting ' + it.name.toLowerCase() + ' now', 'The instrument cluster decides which items may be reset. Some need a workshop or the part changed first.', 'warm');
            } catch (e) { return okDialog('Not now', 'Reset not available', String(e.message || e), 'warm'); }
            confirmReset(it);
        }
        function confirmReset(it) {
            openDialog({ label: 'Reset service item', labelColor: 'warm', h: 360, title: 'Reset ' + it.name.toLowerCase() + '?',
                text: 'Only after the work was done. The car then counts this item down again from today, as after a workshop service.\n\nNow: ' + (it.left || 'not known') + '.',
                note: 'Only with the engine off and the ignition on.',
                buttons: [{ label: 'Cancel', run: closeDialog }, { label: 'Yes, reset', kind: 'bad', run: () => doReset(it) }] });
        }
        async function doReset(it) {
            if (useDemo()) {
                const e = demo.cbs.filter((x) => x.id === it.id)[0];
                if (e) { if (e.way) e.way = M.fmtThousands(M.CBS[it.id].km || 30000) + ' km'; else e.date = (function () { const d = new Date(); d.setMonth(d.getMonth() + (M.CBS[it.id].months || 24)); return ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear(); })(); }
                return okDialog('Reset (demo)', it.name + ' reset', 'Demo data: nothing was sent to the car.', 'ok');
            }
            try {
                await getLink();
                const grant = link.grant('cbs', { confirmed: true });
                openDialog({ label: 'Reset service item', labelColor: 'warm', title: 'Resetting...', text: 'Keep the engine off.', h: 300, buttons: [] });
                const before = await link.cbsRecord().catch(() => null);
                const ok = await link.cbsReset(grant, M.resetRequest(it.id));
                const after = await link.cbsRecord().catch(() => null);
                const a = after && after[it.id], b = before && before[it.id];
                if (!ok) return okDialog('Not reset', it.name + ' was not reset', 'The instrument cluster refused it. Nothing changed.', 'bad');
                change('ok', it.name + ' reset');
                okDialog('Reset', it.name + ' reset', (a ? 'The cluster now says ' + a.avail + ' %' + (b ? ' (service ' + b.count + ' -> ' + a.count + ')' : '') + '. ' : '') + 'The list updates within a minute.', 'ok');
            } catch (e) { log.warn('reset: ' + e); okDialog('Not reset', it.name + ' was not reset', String(e.message || e), 'bad'); }
        }

        /** Our intervals: mark one done today (the km Health counts start again), or change its interval. */
        function askDone(o) {
            const def = M.OURS.filter((x) => x.key === o.key)[0];
            const byEngine = o.key === 'oil' || o.key === 'plugs';
            const step = def.unit === 'km' ? 5000 : 1, min = def.unit === 'km' ? 5000 : 1, max = def.unit === 'km' ? 120000 : 10;
            const dlg = { label: 'Our interval', title: o.name + ', ' + o.everyText, h: 380,
                body: (cv, x, y, w, h) => {
                    UI.wrap(cv, byEngine ? 'The engine unit counts this one itself: it starts again when the car\'s ' + (o.key === 'oil' ? 'oil service' : 'spark plug item') + ' is reset.'
                        : 'Mark it done when the work was done: Health counts the km (or years) again from today.', 17, 560).forEach((ln, i) => cv.text(ln, x, y + 4 + i * 28, 17, '#c8ced6', { literal: true }));
                    cv.text('Interval', x, y + 120, 18, UI.C.text, { font: 'bold', literal: true });
                    UI.stepper(cv, x + 360, y + 114, settings.get(def.setting) || def.every, { decimals: 0, unit: def.unit === 'km' ? 'km' : 'y', key: 'iv|' + o.key,
                        onMinus: () => { settings.set(def.setting, Math.max(min, (settings.get(def.setting) || def.every) - step), 'user'); changed(); },
                        onPlus: () => { settings.set(def.setting, Math.min(max, (settings.get(def.setting) || def.every) + step), 'user'); changed(); } });
                },
                buttons: byEngine ? [{ label: 'Close', kind: 'primary', run: closeDialog }] : [{ label: 'Close', run: closeDialog }, { label: 'Done today', kind: 'primary', run: () => {
                    P.done[o.key] = { km: P.km, t: Date.now() };
                    if (demo) demo.used[o.key] = 0;
                    change('ok', o.name + ' marked done');
                    closeDialog();
                } }] };
            openDialog(dlg);
        }

        /* ---------- reminders (I11): once a day per item, when Health is opened; and the widget ---------- */
        function reminders(S0) {
            const due = [];
            (S0.service || []).forEach((s) => { if (s.color !== 'ok') due.push(s.name + ': ' + s.left); });
            (S0.ours || []).forEach((o) => { if (o.color === 'bad' || (o.frac != null && o.frac < 0.1)) due.push(o.name + ' (our interval): ' + o.leftText); });
            if (S0.tyres && S0.tyres.leak) due.push(M.WHEEL_NAMES[S0.tyres.leak] + ' tyre: losing about ' + S0.tyres.perWeek.toFixed(2) + ' bar a week');
            const bv = M.batteryVerdict(S0.battery && S0.battery.rest, S0.values.batteryWarn);
            if (bv.color === 'warm' || bv.color === 'bad') due.push('12 V battery: ' + bv.word.toLowerCase());
            return due;
        }
        function remindOnOpen() {
            if (useDemo()) return;
            const S0 = build(), day = Math.floor(Date.now() / DAY);
            const fresh = reminders(S0).filter((r) => P.reminded[r.split(':')[0]] !== day);
            if (!fresh.length || V.dialog) return;
            fresh.forEach((r) => { P.reminded[r.split(':')[0]] = day; });
            save();
            okDialog('Reminder', fresh.length === 1 ? 'Coming up' : fresh.length + ' things coming up', fresh.slice(0, 4).join('\n\n'), 'warm');
        }
        const wcan = {};
        function renderWidget(inst) {
            const S0 = build(), sw = ctx.spec.startWidget || {}, size = sw.size || [384, 256];
            const due = reminders(S0);
            if (inst) {
                const cells = { Title: [inst.big ? '' : 'Health', 'Text'],
                    TextRecordings: [inst.big ? '' : 'Score ' + (S0.score.value == null ? '--' : S0.score.value) + (S0.units ? '  .  ' + M.listOf(S0.units, 'fault').length + ' faults' : ''), 'Text'],
                    TextCam: [inst.big ? '' : due[0] || 'Nothing due', 'Text'], ProgressbarVisible: [!inst.big, 'Bool'],
                    Progress: [!inst.big && S0.score.value != null ? S0.score.value / 100 : 0, 'Float'] };
                Object.keys(cells).forEach((k) => ctx.widget.set(inst.spawnId, k, cells[k][0], cells[k][1]));
            }
            const key = size.join('x'), cv = (wcan[key] = wcan[key] || new ScaledCanvas(size[0], size[1], sw.scale || 1)).clear([0, 0, 0, 0]);
            const x0 = Math.round(size[0] * 0.14), y0 = Math.round(size[1] * 0.2), x1 = size[0] - x0;
            const c = { ok: UI.C.green, warm: UI.C.amber, bad: UI.C.red, dim: UI.C.dim }[S0.score.color];
            cv.text('HEALTH', x0, y0 + 14, 16, UI.C.orange, { font: 'bold', spacing: 1.5 });
            cv.text(S0.score.value == null ? '--' : String(S0.score.value), x0, y0 + 76, 56, UI.C.text, { font: 'num' });
            cv.text(S0.score.word, x0 + 92, y0 + 74, 18, c, { font: 'bold' });
            cv.roundRect(x0, y0 + 90, x1 - x0, 8, 4, UI.C.track);
            if (S0.score.value != null) cv.roundRect(x0, y0 + 90, Math.max(8, (x1 - x0) * S0.score.value / 100), 8, 4, c);
            (due.length ? due.slice(0, 2) : ['Nothing due']).forEach((d, i) => cv.text(d.length > 34 ? d.slice(0, 33) + '...' : d, x0, y0 + 126 + i * 24, 16, due.length ? UI.C.amber : UI.C.dim));
            return cv.canvas;
        }
        if (ctx.widget) ctx.widget.loop(1, renderWidget);

        /* ---------- drawing ---------- */
        let lastFrame = 0, drawnVersion = -1;
        async function render() {
            const now = Date.now(), fps = Number(settings.get('fps')) || 60;
            if (now - lastFrame < 1000 / fps - 2) return;
            lastFrame = now;
            S = build();
            V.values = S.values;
            const cv = ctx.canvas(UI.W, UI.H);
            if (cv.chrome) cv.chrome.tabs = { tabs: V.mode === 'main' ? VIEW.TABS : [], sel: V.page, badges: [] };
            if (V.dialog) {
                V.dialog.a = UI.anim('p96health|dialog', V.dialog.open ? 1 : 0, 200);
                if (!V.dialog.open && V.dialog.a <= 0) V.dialog = null;
            }
            VIEW.draw(cv, S, V, A, (now - t0) / 1000);
            drawnVersion = version;
            await ui.image('MAIN_GFX', cv);
        }
        if (ctx.onTab) ctx.onTab((i) => A.tab(i));
        ui.onClick('BTN_PAGE', () => A.tab(UI.nextTab(V.page, VIEW.TABS.length, 1)));
        ui.onClick('BTN_SCAN', () => { scan(); });
        if (ctx.hideButton) { ctx.hideButton('BTN_PAGE'); ctx.hideButton('BTN_SCAN'); }
        var loop = ctx.loop('MAIN', Number(settings.get('fps')) || 60, render);

        let engineTimer = null;
        function setShown(on) {
            if (on === shown) return;
            shown = on;
            link.setShown(on);
            watchShown(on);
            probeStart(on);
            watchReadiness();
            clearInterval(engineTimer); engineTimer = null;
            if (on) {
                getLink().then(() => {
                    if (!shown) return;
                    scan().then(() => { lastScanAt = live.units ? Date.now() : lastScanAt; changed(); return readEngine(); }).then(() => { if (shown) remindOnOpen(); });
                    engineTimer = setInterval(() => { if (shown && !reading) readEngine(); }, 60000);
                });
            } else { V.dialog = null; save(); }
            changed();
        }
        ui.onVisible((name, on) => { if (name === 'MAIN') setShown(on); });
        if (ui.isVisible('MAIN')) setShown(true);
        settings.onChange(() => changed());
        log.info('Health started' + (P.nights.length ? ', ' + P.nights.length + ' nights kept' : ''));
    },
});
