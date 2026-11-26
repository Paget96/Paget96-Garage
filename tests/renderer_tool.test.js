// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * The Store tool p96-renderd (renderer/prebuilt, listed in mgu-repo.json): it installs beside the Store's renderer
 * and idrive7-renderd without taking anything of theirs, nothing requires it, and the committed binary is the one
 * the sources build (renderer/tools/prebuilt.py check).
 *   node tests/renderer_tool.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRE = path.join(ROOT, 'renderer', 'prebuilt');
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
/** key = value lines of a renderer conf */
function conf(p) {
    const o = {};
    fs.readFileSync(p, 'utf8').split('\n').forEach((l) => { const m = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m) o[m[1]] = m[2]; });
    return o;
}
const comp = JSON.parse(fs.readFileSync(path.join(PRE, 'component.json'), 'utf8'));
const repo = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-repo.json'), 'utf8'));
const ours = conf(path.join(PRE, 'p96-renderd.conf'));
const theirs = conf(path.join(ROOT, 'renderer', 'mgu-render.conf'));
const unit = fs.readFileSync(path.join(PRE, 'p96-renderd.service'), 'utf8');

check('the binary and the copies match their sources (prebuilt.py check)', () => {
    cp.execFileSync('python3', [path.join(ROOT, 'renderer', 'tools', 'prebuilt.py'), 'check'], { stdio: 'pipe' });
});
check('component.json: an optional, removable tool for iDrive 7, every file it names is there', () => {
    assert.strictEqual(comp.id, 'p96-renderd');
    assert.strictEqual(comp.kind, 'tool');
    assert.ok(/^\d+\.\d+\.\d+$/.test(comp.version));
    assert.strictEqual(comp.optional, true);
    assert.strictEqual(comp.uninstallable, true);
    assert.deepStrictEqual(comp.mguHmi, ['ID7']);
    comp.files.forEach((f) => assert.ok(fs.existsSync(path.join(PRE, f.path)), f.path));
    comp.units.forEach((u) => assert.ok(fs.existsSync(path.join(PRE, u.name)), u.name));
    assert.strictEqual((fs.statSync(path.join(PRE, 'p96-renderd')).mode & 0o111) !== 0, true, 'binary executable in git');
});
check('it changes nothing that is not its own: no drop-ins, no install scripts, no HMI template, no preload', () => {
    ['dropins', 'postInstall', 'activate', 'deactivate', 'preload'].forEach((k) => assert.ok(!(k in comp), k));
    assert.strictEqual(ours.embed, '0', 'embed off: no page template mounted into the HMI');
    assert.ok(!ours.shared_path, 'never the community socket');
    assert.ok(!ours.bridge_path, 'never display-bridge\'s socket');
});
check('it does not claim to be "a renderer": the Store\'s renderer can never be removed because of it', () => {
    assert.ok(!comp.mguProvides);
    const t = (repo.tools || []).find((x) => x.id === 'p96-renderd');
    assert.ok(t, 'listed in mgu-repo.json');
    assert.ok(!t.provides && !t.mguProvides);
    assert.strictEqual(t.path, 'renderer/prebuilt');
    assert.strictEqual(t.optional, true);
});
check('nothing requires it: no app names it', () => {
    fs.readdirSync(path.join(ROOT, 'apps')).forEach((id) => {
        const p = path.join(ROOT, 'apps', id, 'app.json');
        if (fs.existsSync(p)) assert.ok(fs.readFileSync(p, 'utf8').indexOf('p96-renderd') < 0, id);
    });
    assert.ok(JSON.stringify(repo.apps).indexOf('p96-renderd') < 0);
});
check('its own socket, ivi ids and touch table, none of the other renderers\'', () => {
    assert.strictEqual(ours.socket_path, '/run/p96-renderd/render.sock');
    assert.notStrictEqual(ours.socket_path, theirs.socket_path);
    ['/run/mgu-renderd/renderd.sock', '/run/mgu-render/render.sock'].forEach((s) => assert.notStrictEqual(ours.socket_path, s));
    assert.strictEqual(ours.layer_base, '0x50390000');
    assert.strictEqual(ours.touch_table, 'p96_render');
    assert.notStrictEqual(ours.touch_table, theirs.touch_table);
    assert.strictEqual(ours.touch_port, '30574');
    assert.notStrictEqual(ours.touch_port, theirs.touch_port);
    assert.ok(ours.foreground_gate.indexOf('/var/opt/p96-renderd/current/') >= 0);
});
check('popup watch in log mode (the car run reports which popups it sees)', () => {
    assert.strictEqual(ours.popup_watch, 'log');
});
check('the unit runs our binary with our conf and removes only our touch table', () => {
    assert.ok(unit.indexOf('ExecStart=/var/opt/p96-renderd/current/p96-renderd -c /var/opt/p96-renderd/current/p96-renderd.conf') >= 0);
    assert.ok(unit.indexOf('RuntimeDirectory=p96-renderd') >= 0);
    assert.ok(/nft delete table ip p96_render\b/.test(unit));
    assert.ok(!/mgu_render|idrive7_render|mgu-render\b|idrive7-renderd/.test(unit.replace(/^#.*$/mg, '')));
    assert.ok(/StartLimitBurst=\d+/.test(unit), 'a failing renderer gives up');
});
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
