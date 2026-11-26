// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
'use strict';
/* foreground_gate.js findInterface: with no description where the app manager usually keeps it, the first
 * RemoteHmiApplication description in a src-gen folder of a package under the library root, two levels deep at
 * most (MainApp 6.5.5's single bundle; the case of mgu-store PR #134). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findInterface } = require('../js/foreground_gate.js');

const ID7 = 'de_bmw_infotainment_hmi_remote_RemoteHmiApplication.json';
const ID8 = 'de_bmw_infotainment_hmi_remote2_RemoteHmiApplication2.json';
const mk = (root, rel, name) => {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, name), '{"instances":{}}');
};
const known = ['/usr/lib/oap-mainapp/src-gen/' + ID7, '/usr/lib/oap-mainapp21/src-gen/someip/' + ID8];
if (known.some((f) => fs.existsSync(f))) {
    console.log('test_gate_iface: this machine has a real description, skipped');
    process.exit(0);
}

const a = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-iface-'));
mk(a, 'other/lib', 'x.json');
mk(a, 'oap-mainapp-6.5.5/src-gen/someip', ID7);
assert.strictEqual(findInterface(a), path.join(a, 'oap-mainapp-6.5.5/src-gen/someip', ID7), 'one level under src-gen');

const b = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-iface-'));
mk(b, 'oap-x/src-gen/a/b/c', ID7);
assert.strictEqual(findInterface(b), null, 'deeper than two levels under src-gen: not taken');
mk(b, 'oap-y/src-gen', ID8);
assert.strictEqual(findInterface(b), path.join(b, 'oap-y/src-gen', ID8), 'the iDrive 8 name too');

const c = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-iface-'));
mk(c, 'oap-z', ID7);
assert.strictEqual(findInterface(c), null, 'outside a src-gen folder: not taken');
assert.strictEqual(findInterface(path.join(c, 'missing')), null, 'no library root: none');

[a, b, c].forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
console.log('test_gate_iface: 5 checks pass');
