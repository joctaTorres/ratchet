// Prototype: render the spinning gear with BRAILLE sub-pixels (U+2800), which
// pack a 2×4 dot grid per cell → 8× the resolution of the ██ block art in the
// same cell footprint. Rasterizes the rotating logo into a dot bitmap, packs it
// into Braille chars, and writes braille-preview.png (the dot bitmap, faithful
// to how the Braille glyphs display) so we can judge the look. Also prints two
// real Braille frames.
//
// Usage: node scripts/preview-braille.mjs [dotW] [dotH]

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const DW = Number(process.argv[2] || 30); // dots wide  (→ DW/2 braille cols)
const DH = Number(process.argv[3] || 28); // dots tall  (→ DH/4 braille rows)
const FRAMES = 8;
const DIRECTION = -1; // anti-clockwise
const SS = 2; // supersample per axis
const FILL_AT = 3.5; // averaged intensity ≥ → dot on

// --- Load logo intensity grid (real-space: cell = 1 wide × 2 tall) ----------
const intensityOf = (ch) =>
  ({ ' ': 0, '.': 1, ':': 2, ';': 2, '-': 2, '+': 4, x: 4, '=': 4, X: 5, '*': 6, $: 6, '&': 7, '#': 7 })[ch] ?? 0;
const raw = readFileSync(new URL('./logo.txt', import.meta.url), 'utf8').replace(/\n+$/, '');
const lines = raw.split('\n');
const SH = lines.length;
const SW = Math.max(...lines.map((l) => l.length));
const src = lines.map((l) => { const row = new Array(SW).fill(0); for (let c = 0; c < l.length; c++) row[c] = intensityOf(l[c]); return row; });

let n = 0, cx = 0, cy = 0, minR = SH, maxR = 0, minC = SW, maxC = 0;
for (let r = 0; r < SH; r++) for (let c = 0; c < SW; c++) if (src[r][c]) { n++; cx += c; cy += r; if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c; }
cx /= n; cy /= n;
// real-space (cell width 1, height 2)
const cxR = cx, cyR = cy * 2;
const srcRadius = Math.hypot(maxC - minC + 1, (maxR - minR + 1) * 2) / 2;
const DOT = 0.5; // a braille dot is ~0.5×0.5 cell-widths → square
const outRadius = (Math.min(DW, DH) * DOT) / 2;
const scale = outRadius / srcRadius;

const sample = (col, row) => {
  if (col < 0 || row < 0 || col >= SW - 1 || row >= SH - 1) {
    const c = Math.round(col), r = Math.round(row);
    if (r < 0 || r >= SH || c < 0 || c >= SW) return 0;
    return src[r][c];
  }
  const c0 = Math.floor(col), r0 = Math.floor(row), fc = col - c0, fr = row - r0;
  return src[r0][c0] * (1 - fc) * (1 - fr) + src[r0][c0 + 1] * fc * (1 - fr) + src[r0 + 1][c0] * (1 - fc) * fr + src[r0 + 1][c0 + 1] * fc * fr;
};

function dotBitmap(theta) {
  const ca = Math.cos(theta), sa = Math.sin(theta);
  const bmp = [];
  for (let dr = 0; dr < DH; dr++) {
    const row = new Array(DW);
    for (let dc = 0; dc < DW; dc++) {
      let acc = 0;
      for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
        const ox = (si + 0.5) / SS - 0.5, oy = (sj + 0.5) / SS - 0.5;
        const rx = ((dc + ox - (DW - 1) / 2) * DOT) / scale;
        const ry = ((dr + oy - (DH - 1) / 2) * DOT) / scale;
        const sx = rx * ca + ry * sa, sy = -rx * sa + ry * ca;
        acc += sample(cxR + sx, (cyR + sy) / 2);
      }
      row[dc] = acc / (SS * SS) >= FILL_AT ? 1 : 0;
    }
    bmp.push(row);
  }
  return bmp;
}

// --- Pack a dot bitmap into Braille rows ------------------------------------
const BRAILLE_BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
function toBraille(bmp) {
  const rows = [];
  for (let cr = 0; cr < DH; cr += 4) {
    let line = '';
    for (let cc = 0; cc < DW; cc += 2) {
      let bits = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (bmp[cr + y]?.[cc + x]) bits |= BRAILLE_BITS[y][x];
      line += String.fromCharCode(0x2800 + bits);
    }
    rows.push(line);
  }
  return rows;
}

const frames = Array.from({ length: FRAMES }, (_u, f) => dotBitmap((DIRECTION * f * 2 * Math.PI) / FRAMES));

// --- PNG of the dot bitmaps (square dots → faithful to Braille display) ------
const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const tb = Buffer.from(t, 'ascii'); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([tb, d])), 0); return Buffer.concat([l, tb, d, cr]); };
const png = (w, h, rgb) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const st = w * 3; const rb = Buffer.alloc((st + 1) * h); for (let y = 0; y < h; y++) rgb.copy(rb, y * (st + 1) + 1, y * st, y * st + st); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(rb)), chunk('IEND', Buffer.alloc(0))]); };

const DOTPX = 7, PAD = 10, COLS = 4, BG = [16, 18, 22], ON = [70, 230, 230];
const fW = DW * DOTPX, fH = DH * DOTPX, sc = COLS, sr = Math.ceil(FRAMES / sc);
const PW = PAD + sc * (fW + PAD), PH = PAD + sr * (fH + PAD);
const rgb = Buffer.alloc(PW * PH * 3);
for (let i = 0; i < PW * PH; i++) { rgb[i * 3] = BG[0]; rgb[i * 3 + 1] = BG[1]; rgb[i * 3 + 2] = BG[2]; }
frames.forEach((bmp, fi) => {
  const ox = PAD + (fi % sc) * (fW + PAD), oy = PAD + Math.floor(fi / sc) * (fH + PAD);
  for (let dr = 0; dr < DH; dr++) for (let dc = 0; dc < DW; dc++) if (bmp[dr][dc]) {
    for (let y = 0; y < DOTPX - 1; y++) for (let x = 0; x < DOTPX - 1; x++) { const px = ox + dc * DOTPX + x, py = oy + dr * DOTPX + y, o = (py * PW + px) * 3; rgb[o] = ON[0]; rgb[o + 1] = ON[1]; rgb[o + 2] = ON[2]; }
  }
});
writeFileSync(new URL('../braille-preview.png', import.meta.url), png(PW, PH, rgb));

console.log(`braille-preview.png — ${DW}×${DH} dots = ${DW / 2}×${DH / 4} braille cells, ${FRAMES} frames.\n`);
console.log('frame 0:'); for (const l of toBraille(frames[0])) console.log('  ' + l);
console.log('\nframe 1:'); for (const l of toBraille(frames[1])) console.log('  ' + l);
