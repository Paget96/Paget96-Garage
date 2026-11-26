// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Datalog texts: the info popup of every card (what it is, where it comes from, why it matters, normal values)
 * and the How to use topics. Plain words; no em or en dash.
 */
const A = require('./art');
const M = require('./maths');

const THERMO = (kind, unit) => A.thermoArt(M.ZONES[kind], unit || '°C', M.ZONES[kind].cold != null ? ['warming', 'ready', 'warm', 'too hot'] : ['', 'cool', 'warm', 'too hot']);

const INFO = {
    boost: {
        label: 'Boost', title: 'How much the turbo pushes in', draw: A.boostArt,
        text: 'The engine reads the absolute pressure in the intake manifold. Boost is that pressure minus the air outside.\n\n' +
            'At idle the throttle chokes the air, so boost is below zero (vacuum). At full throttle the turbo packs the air in. ' +
            'Up a mountain the outside air is thinner, so boost reads higher for the same air inside.',
        note: 'Normal: about -0.5 bar at idle, 1.2 to 1.6 bar at full throttle on a tuned four cylinder; your target is marked on the ring.',
    },
    manifold: {
        label: 'Manifold pressure', title: 'What the engine actually gets', draw: A.boostArt,
        text: 'The absolute pressure in the intake manifold, after the throttle, from the engine unit\'s own sensor.\n\n' +
            'This is the air the cylinders breathe. Boost is this minus the outside pressure.',
        note: 'Normal: 0.3 to 0.5 bar at idle, 2.2 to 2.6 bar absolute at full throttle.',
    },
    ambient: {
        label: 'Ambient pressure', title: 'The air pressure outside', draw: A.pressureArt,
        text: 'The engine unit measures the outside air pressure (it needs it to meter the fuel). Datalog reads it from there.\n\n' +
            'Weather moves it by a few hPa; height moves it a lot: about 12 hPa less every 100 m up. Lower pressure means ' +
            'less oxygen in every breath, so less power.',
        note: 'Normal: 1013 hPa at sea level on an average day, about 900 hPa at 1000 m.',
    },
    outside: {
        label: 'Outside air', title: 'The temperature in the mirror', draw: A.airPath('outside'),
        text: 'The car\'s outside temperature sensor, in the mirror (the one the dashboard shows).\n\n' +
            'It is the reference: the engine\'s own sensors read warmer because of the engine bay and the turbo. ' +
            'In a slow queue or after a stop it reads the road and the body, so it can be too high.',
        note: 'Shown for comparison; the weather correction uses the intake air after the filter.',
    },
    intake: {
        label: 'Intake air', title: 'The air after the filter', draw: A.airPath('intake'),
        text: 'Measured by the engine unit just after the air filter, before the turbo. This is the air the engine ' +
            'really takes in, so the weather correction uses it.\n\n' +
            'It reads a few degrees over the outside air: the engine bay warms the intake. Standing still it climbs, ' +
            'driving it falls back.',
        note: 'Normal: 0 to 8 °C over the outside air while driving.',
    },
    charge: {
        label: 'Charge air', title: 'The air that goes into the engine', draw: A.airPath('charge'),
        text: 'Measured in the intake tract after the intercooler, just before the throttle. The turbo heats the air when ' +
            'it compresses it; the intercooler cools it down again.\n\n' +
            'Cooler air holds more oxygen, so the engine makes more power. When it climbs run after run, the intercooler is ' +
            'heat soaked: wait a minute before the next run.',
        note: 'Normal: 10 to 25 °C above the outside air under load.',
    },
    airChart: {
        label: 'Air temperatures', title: 'Three air temperatures, one path', draw: A.airPath('all'),
        text: 'Outside (mirror), after the filter (intake) and before the throttle (charge air), over the last run.\n\n' +
            'The gap between outside and intake is engine bay heat. The gap between intake and charge air is what the ' +
            'turbo adds and the intercooler did not take away: a wide gap that grows from run to run is heat soak.',
        note: 'Normal: intake a few degrees over outside, charge air 10 to 25 °C over it under load.',
    },
    correction: {
        label: 'Correction', title: 'Times as if the air were standard', draw: A.correctionArt,
        text: 'Cold, dense air gives more power, warm, thin air less. SAE J1349 corrects for it: 25 °C and 99 kPa of dry air count as standard.\n\n' +
            'Datalog uses the intake air and the outside pressure at the launch. A factor over 1: your air was thinner, so the ' +
            'corrected time is a little faster. The car reports no humidity, so the air counts as dry.',
        note: 'The raw time is always shown next to the corrected one. Density altitude: the height with the same air density.',
    },
    run: {
        label: 'Run', title: 'A run from a standstill', draw: A.runArt,
        text: 'Stop the car. After a second Datalog shows READY. Go full throttle: the timer starts the moment the car moves, ' +
            'so your reaction (throttle to moving) is shown on its own and not counted.\n\n' +
            'At the run length (Settings) the run is saved with the air, boost and temperatures of that run. Lifting off ' +
            'early ends it too.',
        note: 'Only on closed roads or a strip. Never in traffic.',
    },
    lastRun: {
        label: 'Last run', title: 'Times and splits', draw: A.splitsArt,
        text: 'The time over the run length, and the moments on the way: 0 to 100 km/h, 60 to 100 km/h, 201 m, the trap ' +
            'speed (the speed at the line) and your reaction.\n\n' +
            'Times are measured from the car\'s own speed, many times a second, and the crossing moments are worked out ' +
            'between samples, so they do not depend on how often the car sends speed.',
        note: 'The green line is the time corrected to standard air (SAE J1349).',
    },
    runsToday: {
        label: 'Runs today', title: 'Every run of this session', draw: A.logArt,
        text: 'Each run with its raw time, the time corrected to standard air, the trap speed and the air at the launch ' +
            '(after the filter / before the throttle).\n\n' +
            'Best marks the fastest corrected run. Heat soak marks a run that started with the charge air 15 °C or more over the intake air.',
        note: 'Older sessions are on the Log page.',
    },
    targetPeak: {
        label: 'Target and peak', title: 'Did the turbo reach its target?', draw: A.boostArt,
        text: 'The target is your boost target from Settings (or the engine unit\'s own target, when it reports one). ' +
            'The peak is the most boost of the last run, and how long after the launch it reached the target.\n\n' +
            'A peak well under target on a warm day, or a slow climb, is the engine protecting itself (charge air too hot, ' +
            'knock) or a boost leak.',
        note: 'Normal: the target within 2 to 3 s of a full throttle launch.',
    },
    pressureChart: {
        label: 'Pressure', title: 'Pressures over the last run', draw: A.boostArt,
        text: 'Manifold pressure (absolute), the outside pressure and the boost (the gap between them), second by second over the last run.',
        note: 'boost = manifold minus outside.',
    },
    tyresNow: {
        label: 'Tyres', title: 'Pressure and temperature of each tyre', draw: A.tyreArt,
        text: 'The car\'s own tyre sensors (TPMS) send each tyre\'s pressure and temperature, about once a minute.\n\n' +
            'Warm tyres have more pressure: about 0.1 bar for every 10 °C. Set your pressures cold, and check them hot ' +
            'here against your target.',
        note: 'Green: within 0.1 bar of your hot target. Amber: further off.',
    },
    coldHot: {
        label: 'Cold to hot', title: 'How much each tyre grew', draw: A.tyreArt,
        text: 'The pressure of each tyre when this session started (cold) and now (hot).\n\n' +
            'A tyre that grows much more than the others works harder (the driven axle, the outside of a fast bend); one ' +
            'that grows less may be losing air.',
        note: 'Normal: 0.15 to 0.3 bar from cold to hot on a strip day.',
    },
    tyreNote: {
        label: 'Note', title: 'The tyre that stands out', draw: A.tyreArt,
        text: 'Datalog compares each tyre with the other three and tells you when one is 0.08 bar or more off.',
        note: 'Check a tyre that stays low when cold: it may have a slow leak.',
    },
    temps: {
        label: 'Temperatures', title: 'Is the car ready, or too hot?', draw: THERMO('oil'),
        text: 'Engine oil, coolant and gearbox oil from the car, intake and charge air from the engine unit. Green is ' +
            'ready, amber is still warming up or getting warm, red is too hot.\n\n' +
            'Wait for the oil to be green before a run: cold oil wears the engine and the engine unit holds power back.',
        note: 'Oil ready from 70 °C, hot over 120 °C. The exhaust gas line shows only when your car reports it.',
    },
    tempsChart: {
        label: 'Last 10 minutes', title: 'How the temperatures moved', draw: THERMO('coolant'),
        text: 'Oil, gearbox and charge air over the last ten minutes. A rising charge air line between runs means the ' +
            'intercooler needs time; a rising oil line during a session is normal up to about 120 °C.',
        note: 'Let the engine idle a minute after hard runs, the turbo cools down.',
    },
    oil: { label: 'Engine oil', title: 'Engine oil temperature', draw: THERMO('oil'),
        text: 'From the car\'s engine signals. Cold oil is thick and protects less; the engine unit limits revs and power until it is warm.',
        note: 'Ready from 70 °C, normal 90 to 120 °C, too hot over 135 °C.' },
    coolant: { label: 'Coolant', title: 'Coolant temperature', draw: THERMO('coolant'),
        text: 'From the car\'s engine signals. The coolant warms first; the oil follows minutes later, so wait for the oil before a run.',
        note: 'Normal 85 to 110 °C; the car runs it hotter when you drive gently.' },
    gearbox: { label: 'Gearbox', title: 'Gearbox oil temperature', draw: THERMO('gearbox'),
        text: 'From the car\'s gearbox signal. An automatic shifts faster when its oil is warm; launch control may wait for it.',
        note: 'Ready from 50 °C, normal 70 to 110 °C. Some cars never send it: then it shows --.' },
    logSessions: {
        label: 'Sessions', title: 'Every evening at the strip', draw: A.logArt,
        text: 'Runs less than two hours apart are one session. Each session shows its date, how many runs, its best time and the air.\n\n' +
            'Tap a session to see its runs on the right.',
        note: 'The newest ' + 300 + ' runs are kept on the head unit.',
    },
    logRuns: {
        label: 'Runs', title: 'The runs of a session', draw: A.logArt,
        text: 'Tap a run to open it: its splits, the air and its boost and speed. Then pick it as A or B for the Compare page.',
        note: 'Demo runs are kept apart from your own and never saved.',
    },
    dyno: {
        label: 'Dyno sheet', title: 'Power and torque over the rev range', draw: A.dynoArt,
        text: 'From a full throttle pull in one gear: the engine unit reports its torque; power is worked out from torque and rpm. ' +
            'Both are corrected to standard air, like the run times.\n\n' +
            'This is at the engine and estimated from the engine unit\'s own figures: not a real dyno, and not at the wheels.',
        note: 'Pull in 2nd or 3rd from about 2 000 rpm to the shift point. Closed roads only.',
    },
    peakPower: { label: 'Peak power', title: 'The most power of the pull', draw: A.dynoArt,
        text: 'Power = torque x rpm (hp = Nm x rpm / 7 121). Estimated at the engine from the engine unit\'s torque, ' +
            'corrected to standard air. A real dyno measures at the wheels, where 10 to 15 % less arrives.',
        note: 'Compare pulls in the same gear on similar days.' },
    peakTorque: { label: 'Peak torque', title: 'The most twisting force', draw: A.dynoArt,
        text: 'The engine unit\'s own torque figure (what it works out from air, fuel and ignition), at the clutch, corrected to standard air.',
        note: 'A turbo engine holds its peak torque over a wide band, then it falls as power peaks.' },
    compare: {
        label: 'Compare', title: 'Two runs side by side', draw: A.compareArt,
        text: 'Run A and run B with every split and the difference. Green: B was faster there, red: slower.\n\n' +
            'Pick the runs on the Log page (open a run, then A or B). Until then A is the best run and B the last one.',
        note: 'Differences under 0.05 s are inside what speed based timing can tell apart.',
    },
    cmpBoost: { label: 'Boost', title: 'Boost of both runs', draw: A.boostArt,
        text: 'The boost of run A and run B from the launch on. A later or lower curve is power the engine did not make.',
        note: 'Run A blue, run B orange.' },
    cmpCharge: { label: 'Charge air', title: 'Charge air of both runs', draw: A.airPath('charge'),
        text: 'The charge air before the throttle, from the launch on. A warmer run makes less power: about 1 % for every 3 °C.',
        note: 'Run A blue, run B orange.' },
    cmpAir: { label: 'Air difference', title: 'Was it the driver or the air?', draw: A.correctionArt,
        text: 'The intake air, outside pressure and correction factor of both runs, and how much of the time difference the air explains.',
        note: 'When the corrected times are closer than the raw ones, the air made the difference.' },
};

/** The How to use topics: [{ title, text, note, draw }]. */
const TOPICS = [
    { title: 'Start a run', draw: A.runArt, note: 'Only on closed roads or a strip. Never in traffic.',
        text: 'Stop the car on a closed road or strip. Datalog shows READY when the car has stood still for a second.\n\n' +
            'Go full throttle. The time starts the moment the car moves, so your reaction is shown on its own and not counted.\n\n' +
            'At the run length (Settings: 201 m, 402 m or 1/2 mile) the run is saved with the air, boost and temperatures.' },
    { title: 'Read the result', draw: A.splitsArt, note: 'Lifting off before the line ends the run early.',
        text: 'Runs shows the last run big, with 0 to 100 km/h, 60 to 100 km/h, 201 m, the trap speed and your reaction.\n\n' +
            'The list on the right has every run of today, the best one marked.' },
    { title: 'Dyno sheet', needs: 'torque', draw: A.dynoArt, note: 'Estimated at the engine, not a real dyno.',
        text: 'In 2nd or 3rd gear, from about 2 000 rpm, go full throttle to the shift point. Datalog keeps the pull and draws ' +
            'power and torque over the rpm, corrected to standard air.\n\nThe Dyno page shows the widest pull of the session, ' +
            'its peaks marked.' },
    { title: 'Weather correction', needs: 'intake', draw: A.correctionArt, note: 'The raw time is always next to the corrected one.',
        text: 'Warm or thin air costs power. Datalog corrects every time to standard air (SAE J1349) from the intake air ' +
            'temperature and the outside pressure, so runs on different days can be compared.\n\n' +
            'Correction shows the three air temperatures, the pressure and the factor.' },
    { title: 'Boost', needs: 'boost', draw: A.boostArt, note: 'Boost = manifold pressure minus outside pressure.',
        text: 'Boost is how much the turbo pushes the air in. Datalog reads the manifold pressure and the outside pressure ' +
            'from the engine unit and shows both, and the boost between them.\n\n' +
            'Set your boost target in Settings; Boost shows when the run reached it.' },
    { title: 'Tyres and temps', needs: 'oil', draw: A.tyreArt, note: 'Set pressures cold, check them hot.',
        text: 'Tyres shows each tyre\'s pressure and temperature from the car\'s tyre sensors, and how much each grew from ' +
            'cold to hot this session.\n\n' +
            'Temps shows oil, coolant, gearbox and the air, green when ready, red when too hot.' },
    { title: 'Log and compare', draw: A.compareArt, note: 'Demo runs are never saved.',
        text: 'Log keeps every run, by session. Tap a run to open it, then pick it as A or B.\n\n' +
            'Compare puts the two runs side by side: every split, their boost and charge air, and the air difference.' },
    { title: 'What the car must report', draw: A.airPath('all'), note: 'Datalog only reads. It never writes to the car.',
        text: 'Speed, rpm, oil, coolant, gearbox, outside temperature and the tyres come from the car\'s own signals.\n\n' +
            'Intake air, charge air, manifold pressure and the outside pressure are read from the engine unit, and only ' +
            'while Datalog is on the screen. A value your car does not report shows as --.' },
];

module.exports = { INFO, TOPICS };
