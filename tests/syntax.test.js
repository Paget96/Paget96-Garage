// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * Every app and lib file parses (node --check). A merge once left Datalog's main.js with two `const UI` lines: the
 * tests passed (they never load main.js) and the app did not start on the car.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let bad = 0, n = 0;
['lib'].concat(fs.readdirSync(path.join(ROOT, 'apps')).map((a) => path.join('apps', a))).forEach((d) => {
    fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.js$/.test(f)).forEach((f) => {
        n++;
        try { execFileSync(process.execPath, ['--check', path.join(ROOT, d, f)], { stdio: 'pipe' }); } catch (e) {
            bad++; console.log('FAIL ' + path.join(d, f) + ': ' + String(e.stderr || e).split('\n').slice(0, 4).join(' '));
        }
    });
});
console.log(n + ' files, ' + (bad ? bad + ' failed' : 'all parse'));
if (bad) process.exit(1);
