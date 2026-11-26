// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
'use strict';
/* foreground_gate.js startGate on a mock SOME/IP binding:
 * - a proxy that fails while the HMI still starts is tried again, and logged once (mgu-store PR #156);
 * - an instance that becomes available has its stack read at once, even when the HMI never sends it;
 * - "covered": an app in front whose states lost the HMI's focus, reported once it stayed so, uncovered at once;
 *   a page change inside the app (focus from one state to the next) is not a cover. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startGate } = require('../js/foreground_gate.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-watch-'));
const put = (uid, uuid) => {
    fs.mkdirSync(path.join(root, `oap_${uid}`, 'rhmiData'), { recursive: true });
    fs.writeFileSync(path.join(root, `oap_${uid}`, 'rhmiData', 'application.json'), JSON.stringify({ application: { uuid } }));
};
put(12240, 'u-a');
put(12244, 'u-b');

const inst = {
    I1: { fails: 2, uuid: 'u-a', stack: { ROOT_APP: [10] } },    // the proxy fails twice, then works
    I2: { fails: 0, uuid: 'u-b', stack: { ROOT_APP: [20] } },    // its stack is never sent: read when available
};
const avail = {};
const notify = {};
const stackCb = {};
let builds = 0;
const someip = {
    buildProxy: (cfg, name) => {
        builds++;
        const i = inst[name];
        if (i.fails > 0) {
            i.fails--;
            return Promise.reject(new Error('not offered'));
        }
        return Promise.resolve({
            init: () => Promise.resolve(),
            subscribeToAvailability: (fn) => { avail[name] = fn; },
            subscribe: (s) => {
                if (s.name === 'notify') notify[name] = s.onReceive;
                if (s.name === 'applicationStack') stackCb[name] = s.onReceive;
                return Promise.resolve();
            },
            getValue: (k) => Promise.resolve(k === 'uuid' ? i.uuid : i.stack),
        });
    },
};
const focus = (name, id, on) => notify[name]({ eventType: 'FOCUS', sourceId: id, parameterMap: { 0: { booleanValue: on } } });
const visible = (name, id) => notify[name]({ eventType: 'VISIBLE', sourceId: id, parameterMap: { 0: { booleanValue: true } } });

const lines = [];
const logs = [];
startGate({ someip, interfaceConfig: { instances: { I1: 1, I2: 2 } }, appsDir: root, retryMs: 20, settleMs: 30,
    write: (s) => lines.push(s.trim()), log: (s) => logs.push(s) });
const lastOf = (word) => lines.filter((l) => l.split(' ')[0] === word).pop() || word;   // nothing sent yet: none
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

wait(120).then(() => {
    assert.strictEqual(lastOf('foreground'), 'foreground', 'nothing in front before any instance is available');
    assert.strictEqual(builds, 4, `I1 tried three times, I2 once: ${builds}`);
    assert.strictEqual(logs.filter((l) => /I1: not offered/.test(l)).length, 1, 'a failing proxy is logged once');
    assert.ok(logs.some((l) => /I1: watched after 2 retries/.test(l)), logs.join(' | '));
    avail.I2(true);
    avail.I1(true);
    return wait(20);
}).then(() => {
    assert.strictEqual(lastOf('foreground'), 'foreground 12240 12244', lines.join(' | '));
    assert.strictEqual(lastOf('covered'), 'covered', 'nobody covered yet');

    // a page change in I1's app: the focus goes from state 10 to state 11 in one burst; not covered
    visible('I1', 11);
    focus('I1', 10, true);
    focus('I1', 10, false);
    focus('I1', 11, true);
    return wait(60);
}).then(() => {
    assert.strictEqual(lastOf('covered'), 'covered', 'a page change inside the app counted as a cover');

    // an HMI popup over I2's app: its only state loses the focus and keeps it lost
    focus('I2', 20, true);
    focus('I2', 20, false);
    return wait(10);
}).then(() => {
    assert.strictEqual(lastOf('covered'), 'covered', 'covered before it settled');
    return wait(60);
}).then(() => {
    assert.strictEqual(lastOf('covered'), 'covered 12244', lines.join(' | '));
    // a FOCUS for a state that is not the app's is ignored
    focus('I1', 99, false);
    // the popup goes: uncovered at once
    focus('I2', 20, true);
    assert.strictEqual(lastOf('covered'), 'covered', 'uncovered at once');

    // covered again, then the app leaves the front: it is no longer in the covered list either
    focus('I2', 20, false);
    return wait(60);
}).then(() => {
    assert.strictEqual(lastOf('covered'), 'covered 12244');
    stackCb.I2({ OTHER_APP: [1] });
    assert.strictEqual(lastOf('foreground'), 'foreground 12240', 'out of front');
    assert.strictEqual(lastOf('covered'), 'covered', 'an app out of front is not covered');

    // unavailable: out of front
    avail.I1(false);
    assert.strictEqual(lastOf('foreground'), 'foreground', 'unavailable: out of front');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('test_gate_watch.js: all checks passed');
}).catch((e) => {
    console.error(e);
    process.exit(1);
});
