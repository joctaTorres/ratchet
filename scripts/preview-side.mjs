// Prototype: the logo spin DOWNSAMPLED to the welcome screen's side art column.
//
// Rasterizes the rotating logo straight into a small TW×TH cell grid (honoring
// the ~2:1 terminal cell aspect so it reads round, not squashed) and thresholds
// intensity into full/dim/empty glyphs — exactly what will go into
// WELCOME_ANIMATION. Writes side-preview.png with the real terminal aspect so I
// can judge it truthfully, and prints frame 0 as glyphs.
//
// Usage: node scripts/preview-side.mjs [width] [height]

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ASPECT = 2.0;
const DIRECTION = -1; // anti-clockwise
const FRAMES = 8;
const TW = Number(process.argv[2] || 12); // target cols
const TH = Number(process.argv[3] || 11); // target rows
const FULL_AT = 4.5; // intensity ≥ → full glyph
const DIM_AT = 1.5; // intensity ≥ → dim glyph

// --- Load logo intensity grid ----------------------------------------------
const intensityOf = (ch) =>
  ({ ' ': 0, '.': 1, ':': 2, ';': 2, '-': 2, '+': 4, 'x': 4, '=': 4, 'X': 5, '*': 6, '$': 6, '&': 7, '#': 7 })[ch] ?? 0;
const raw = readFileSync(new URL('./logo.txt', import.meta.url), 'utf8').replace(/\n+$/, '');
const lines = raw.split('\n');
const H = lines.length;
const W = Math.max(...lines.map((l) => l.length));
const src = lines.map((l) => {
  const row = new Array(W).fill(0);
  for (let c = 0; c < l.length; c++) row[c] = intensityOf(l[c]);
  return row;
});
let sum = 0, cx = 0, cy = 0, minR = H, maxR = 0, minC = W, maxC = 0;
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++)
    if (src[r][c]) {
      sum++; cx += c; cy += r;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
    }
cx /= sum; cy /= sum;

// Source half-extent (pixel space) and output half-extent → scale to fit.
const srcRadius = Math.hypot(maxC - minC + 1, (maxR - minR + 1) * ASPECT) / 2;
const outRadius = Math.min(TW, TH * ASPECT) / 2;
const scale = outRadius / srcRadius;

const sampleBilinear = (col, row) => {
  if (col < 0 || row < 0 || col >= W - 1 || row >= H - 1) {
    const c = Math.round(col), r = Math.round(row);
    if (r < 0 || r >= H || c < 0 || c >= W) return 0;
    return src[r][c];
  }
  const c0 = Math.floor(col), r0 = Math.floor(row);
  const fc = col - c0, fr = row - r0;
  return (
    src[r0][c0] * (1 - fc) * (1 - fr) +
    src[r0][c0 + 1] * fc * (1 - fr) +
    src[r0 + 1][c0] * (1 - fc) * fr +
    src[r0 + 1][c0 + 1] * fc * fr
  );
};

function frameIntensity(theta) {
  const ca = Math.cos(theta), sa = Math.sin(theta);
  const grid = [];
  for (let r = 0; r < TH; r++) {
    const row = new Array(TW);
    for (let c = 0; c < TW; c++) {
      const x = (c - (TW - 1) / 2) / scale;
      const y = ((r - (TH - 1) / 2) * ASPECT) / scale;
      const sx = x * ca + y * sa;
      const sy = -x * sa + y * ca;
      row[c] = sampleBilinear(cx + sx, cy + sy / ASPECT);
    }
    grid.push(row);
  }
  return grid;
}

const toGlyph = (v) => (v >= FULL_AT ? 2 : v >= DIM_AT ? 1 : 0); // 0 empty 1 dim 2 full
const frames = Array.from({ length: FRAMES }, (_u, f) =>
  frameIntensity(DIRECTION * (f * 2 * Math.PI) / FRAMES).map((row) => row.map(toGlyph))
);

// --- PNG (terminal aspect: cells 2× taller than wide) ----------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const tb = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0); return Buffer.concat([len, tb, data, crc]); };
const encodePng = (w, h, rgb) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const stride = w * 3; const rb = Buffer.alloc((stride + 1) * h); for (let y = 0; y < h; y++) rgb.copy(rb, y * (stride + 1) + 1, y * stride, y * stride + stride); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rb)), chunk('IEND', Buffer.alloc(0))]); };

const CW = 16, CHt = 32, PAD = 12, BG = [16, 18, 22]; // 1 cell = 16×32 px (2:1)
const COL = { 1: [26, 110, 120], 2: [70, 230, 230] };
const sheetCols = 4, sheetRows = Math.ceil(FRAMES / sheetCols);
const fW = TW * CW, fH = TH * CHt;
const PW = PAD + sheetCols * (fW + PAD), PH = PAD + sheetRows * (fH + PAD);
const rgb = Buffer.alloc(PW * PH * 3);
for (let i = 0; i < PW * PH; i++) { rgb[i * 3] = BG[0]; rgb[i * 3 + 1] = BG[1]; rgb[i * 3 + 2] = BG[2]; }
const put = (x, y, col) => { if (x < 0 || y < 0 || x >= PW || y >= PH) return; const o = (y * PW + x) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2]; };
frames.forEach((frame, fi) => {
  const ox = PAD + (fi % sheetCols) * (fW + PAD);
  const oy = PAD + Math.floor(fi / sheetCols) * (fH + PAD);
  for (let r = 0; r < TH; r++) for (let c = 0; c < TW; c++) {
    const g = frame[r][c]; if (!g) continue;
    for (let dy = 0; dy < CHt; dy++) for (let dx = 0; dx < CW; dx++) put(ox + c * CW + dx, oy + r * CHt + dy, COL[g]);
  }
});
writeFileSync(new URL('../side-preview.png', import.meta.url), encodePng(PW, PH, rgb));

const GL = ['  ', '░░', '██'];
console.log(`side-preview.png — ${TW}×${TH} cells, ${FRAMES} frames (each cell shown 2:1).`);
console.log('\nframe 0:');
for (const row of frames[0]) console.log('  |' + row.map((g) => GL[g]).join('') + '|');
