// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE.
'use strict';
/**
 * qr.js - a QR code encoder for Paget96 Garage (ISO/IEC 18004), plain JavaScript for the head unit (Node 8, no
 * packages). Byte mode, error correction L, M, Q or H, versions 1 to 40, the mask with the lowest penalty.
 *
 *   const QR = require('./garage_qr');                  // in a built app (lib/qr.js in the repo)
 *   const q = QR.encode('https://...', { ecl: 'M', maxVersion: 15 });
 *   q.version, q.size (modules a side, no quiet zone), q.mask, q.get(x, y) (true = dark)
 *   QR.capacity(version, ecl)                           bytes that fit in one code of that version
 *   QR.draw(cv, q, x, y, px)                            dark squares on white with a 4 module quiet zone
 *
 * encode() picks the smallest version that holds the text (from opts.minVersion, default 1). Past opts.maxVersion
 * (default 40) it throws, so a caller can trim its text and try again.
 *
 * Node 8: no optional chaining, no object spread, no class fields.
 */

// error correction codewords per block, and the number of blocks, by level and version (index 0 unused)
const ECC = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
// the two format bits of each level (L 01, M 00, Q 11, H 10)
const LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/** Modules that carry data and error correction in a code of this version (all but the function patterns). */
function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const a = Math.floor(ver / 7) + 2;
        n -= (25 * a - 10) * a - 55;
        if (ver >= 7) n -= 36;
    }
    return n;
}
function dataCodewords(ver, ecl) { return Math.floor(rawModules(ver) / 8) - ECC[ecl][ver] * BLOCKS[ecl][ver]; }
/** Bytes of text that fit in one code: the data codewords less the mode (4 bits) and the count (8 or 16 bits). */
function capacity(ver, ecl) { return dataCodewords(ver, ecl || 'M') - (ver < 10 ? 2 : 3); }

/* ---------- Reed-Solomon over GF(256), polynomial 0x11D ---------- */
function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11D);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
}
/** The generator polynomial of the given degree, highest term left out (it is 1). */
function rsDivisor(degree) {
    const r = [];
    for (let i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < r.length; j++) {
            r[j] = gfMul(r[j], root);
            if (j + 1 < r.length) r[j] ^= r[j + 1];
        }
        root = gfMul(root, 0x02);
    }
    return r;
}
function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (let k = 0; k < data.length; k++) {
        const f = data[k] ^ r.shift();
        r.push(0);
        for (let i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], f);
    }
    return r;
}

/** The data codewords cut into blocks, each with its error correction, interleaved as the code stores them. */
function addEcc(data, ver, ecl) {
    const nb = BLOCKS[ecl][ver], ecLen = ECC[ecl][ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(ecLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
        const len = shortLen - ecLen + (i < nShort ? 0 : 1);
        const dat = data.slice(k, k + len);
        k += len;
        const ec = rsRemainder(dat, div);
        if (i < nShort) dat.push(0);            // a gap, so every block lines up; skipped below
        blocks.push(dat.concat(ec));
    }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) {
        for (let j = 0; j < blocks.length; j++) {
            if (i !== shortLen - ecLen || j >= nShort) out.push(blocks[j][i]);
        }
    }
    return out;
}

/** UTF-8 bytes of a string (or a Buffer / array of bytes as it is). */
function bytesOf(text) {
    if (typeof text !== 'string') return Array.prototype.slice.call(text);
    return Array.prototype.slice.call(Buffer.from(text, 'utf8'));
}

/** The smallest version from lo to hi that holds n bytes at ecl, or 0. */
function fitVersion(n, ecl, lo, hi) {
    for (let v = lo; v <= hi; v++) if (n <= capacity(v, ecl)) return v;
    return 0;
}

/* ---------- the matrix ---------- */
class Matrix {
    constructor(ver) {
        this.version = ver;
        this.size = ver * 4 + 17;
        this.dark = new Uint8Array(this.size * this.size);
        this.fixed = new Uint8Array(this.size * this.size);   // function patterns: no data, no mask
    }
    get(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size && this.dark[y * this.size + x] === 1; }
    set(x, y, on) { this.dark[y * this.size + x] = on ? 1 : 0; this.fixed[y * this.size + x] = 1; }
}

function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
}

function finder(m, cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
            if (x >= 0 && y >= 0 && x < m.size && y < m.size) m.set(x, y, d !== 2 && d !== 4);
        }
    }
}

/** Format bits (level, mask) with their BCH code, around the finders. */
function drawFormat(m, ecl, mask) {
    const data = (LEVEL_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = (i) => ((bits >>> i) & 1) === 1, s = m.size;
    for (let i = 0; i <= 5; i++) m.set(8, i, b(i));
    m.set(8, 7, b(6));
    m.set(8, 8, b(7));
    m.set(7, 8, b(8));
    for (let i = 9; i < 15; i++) m.set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) m.set(s - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) m.set(8, s - 15 + i, b(i));
    m.set(8, s - 8, true);                      // the dark module
}

function drawVersion(m) {
    const ver = m.version;
    if (ver < 7) return;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = ver * 4096 + rem;
    for (let i = 0; i < 18; i++) {
        const on = ((bits >>> i) & 1) === 1, a = m.size - 11 + i % 3, b = Math.floor(i / 3);
        m.set(a, b, on);
        m.set(b, a, on);
    }
}

function drawFunctions(m, ecl) {
    const s = m.size;
    for (let i = 0; i < s; i++) { m.set(6, i, i % 2 === 0); m.set(i, 6, i % 2 === 0); }
    finder(m, 3, 3); finder(m, s - 4, 3); finder(m, 3, s - 4);
    const al = alignPositions(m.version), n = al.length;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m.set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }
    drawFormat(m, ecl, 0);                      // reserves the format area; the real bits come with the mask
    drawVersion(m);
}

/** The codewords into the matrix: up and down in two-column strips from the right, skipping the timing column. */
function placeData(m, cw) {
    const s = m.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < s; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j, up = ((right + 1) & 2) === 0, y = up ? s - 1 - vert : vert;
                if (!m.fixed[y * s + x] && i < cw.length * 8) {
                    m.dark[y * s + x] = (cw[i >>> 3] >>> (7 - (i & 7))) & 1;
                    i++;
                }
            }
        }
    }
}

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];
function applyMask(m, k) {
    const s = m.size, f = MASKS[k];
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (!m.fixed[y * s + x] && f(x, y)) m.dark[y * s + x] ^= 1;
}

/** The penalty of a finished matrix (the four rules of the standard): the mask with the lowest wins. */
function penalty(m) {
    const s = m.size, d = m.dark;
    let p = 0;
    // rules 1 and 3, along rows then columns (each line starts on the light quiet zone)
    for (let pass = 0; pass < 2; pass++) {
        for (let a = 0; a < s; a++) {
            const hist = [0, 0, 0, 0, 0, 0, 0];        // run lengths, newest first, for the finder-like rule
            let colour = 0, run = 0;
            for (let b = 0; b < s; b++) {
                const v = pass === 0 ? d[a * s + b] : d[b * s + a];
                if (v === colour) {
                    run++;
                    if (run === 5) p += 3; else if (run > 5) p++;
                } else {
                    finderAdd(hist, run, s);
                    if (colour === 0) p += finderCount(hist) * 40;
                    colour = v; run = 1;
                }
            }
            p += finderEnd(hist, colour, run, s) * 40;
        }
    }
    // rule 2: 2 x 2 blocks of one colour
    for (let y = 0; y < s - 1; y++) {
        for (let x = 0; x < s - 1; x++) {
            const c = d[y * s + x];
            if (c === d[y * s + x + 1] && c === d[(y + 1) * s + x] && c === d[(y + 1) * s + x + 1]) p += 3;
        }
    }
    // rule 4: how far the share of dark modules is from half
    let dark = 0;
    for (let i = 0; i < d.length; i++) dark += d[i];
    const total = s * s, k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    p += Math.max(0, k) * 10;
    return p;
}
// the finder-like pattern 1:1:3:1:1 with 4 light modules on one side, counted on run lengths (light around the code)
function finderAdd(hist, run, s) {
    if (hist[0] === 0) run += s;                // the first run: the light quiet zone before the line
    hist.pop();
    hist.unshift(run);
}
function finderCount(h) {
    const n = h[1], core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
}
function finderEnd(hist, colour, run, s) {
    if (colour === 1) { finderAdd(hist, run, s); run = 0; }
    finderAdd(hist, run + s, s);                // the light quiet zone after the line
    return finderCount(hist);
}

/**
 * The code for text (a string, sent as UTF-8, or bytes). opts: { ecl: 'L' | 'M' | 'Q' | 'H' (default M),
 * minVersion, maxVersion, mask (0..7; default the one with the lowest penalty) }.
 */
function encode(text, opts) {
    opts = opts || {};
    const ecl = opts.ecl && ECC[opts.ecl] ? opts.ecl : 'M';
    const data = bytesOf(text);
    const lo = Math.max(1, opts.minVersion || 1), hi = Math.min(40, opts.maxVersion || 40);
    const ver = fitVersion(data.length, ecl, lo, hi);
    if (!ver) {
        const e = new Error('qr: ' + data.length + ' bytes do not fit in version ' + hi + ' at level ' + ecl + ' (' + capacity(hi, ecl) + ' bytes)');
        e.code = 'QR_TOO_LONG';
        throw e;
    }
    // the bit stream: byte mode, the count, the bytes, the terminator, padding
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4);
    put(data.length, ver < 10 ? 8 : 16);
    data.forEach((b) => put(b, 8));
    const cap = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
        cw.push(b);
    }
    const all = addEcc(cw, ver, ecl);
    const m = new Matrix(ver);
    drawFunctions(m, ecl);
    placeData(m, all);
    let mask = opts.mask;
    if (!(mask >= 0 && mask <= 7)) {
        let best = Infinity;
        for (let k = 0; k < 8; k++) {
            applyMask(m, k); drawFormat(m, ecl, k);
            const pen = penalty(m);
            if (pen < best) { best = pen; mask = k; }
            applyMask(m, k);
        }
    }
    applyMask(m, mask);
    drawFormat(m, ecl, mask);
    return { version: ver, size: m.size, ecl: ecl, mask: mask, bytes: data.length, get: (x, y) => m.get(x, y) };
}

/** The code's matrix as rows of '1' (dark) and '0', for tests. */
function rows(q) {
    const out = [];
    for (let y = 0; y < q.size; y++) {
        let r = '';
        for (let x = 0; x < q.size; x++) r += q.get(x, y) ? '1' : '0';
        out.push(r);
    }
    return out;
}

/**
 * Draws q at x, y with px a module: a white square with a quiet zone of 4 modules, then every run of dark modules
 * in a row as one filled rectangle (whole pixels, dark on white: what a phone camera reads best). Returns its width.
 */
function draw(cv, q, x, y, px, opts) {
    opts = opts || {};
    const quiet = opts.quiet == null ? 4 : opts.quiet, n = q.size, w = (n + 2 * quiet) * px;
    x = Math.round(x); y = Math.round(y);
    if (opts.light !== null) cv.fillRect(x, y, w, w, opts.light || '#ffffff');   // light: null when the caller laid the white already
    const ink = opts.dark || '#000000', ox = x + quiet * px, oy = y + quiet * px;
    for (let r = 0; r < n; r++) {
        let c = 0;
        while (c < n) {
            if (!q.get(c, r)) { c++; continue; }
            let e = c;
            while (e < n && q.get(e, r)) e++;
            cv.fillRect(ox + c * px, oy + r * px, (e - c) * px, px, ink);
            c = e;
        }
    }
    return w;
}

module.exports = { encode, capacity, rows, draw, fitVersion };
