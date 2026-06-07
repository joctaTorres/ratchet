// Prototype: spin an arbitrary ASCII logo (scripts/logo.txt) anti-clockwise.
//
// ASCII can't be rotated glyph-by-glyph, so we treat the art as an intensity
// bitmap, rotate it geometrically about its centroid (correcting for the ~2:1
// terminal cell aspect), and resample. Writes spin-preview.png (a contact sheet
// of rotation frames) so I can SEE whether rotating this art reads well, and
// prints the 0° and one off-axis frame as ASCII for a sniff test.
//
// Usage: node scripts/preview-spin.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ASPECT = 2.0; // terminal cell height : width
const FRAMES = 12; // frames across a full 360° turn (contact sheet)
const SHEET_COLS = 4;
const RAMP = ' .:-=+*#'; // intensity 0..7 → glyph
const DIRECTION = -1; // -1 = anti-clockwise on screen (screen y is down)

// --- Load the logo into an intensity grid ----------------------------------
const intensityOf = (ch) => {
  switch (ch) {
    case ' ': return 0;
    case '.': return 1;
    case ':': return 2;
    case '-': return 2;
    case '+': return 4;
    case '=': return 4;
    case '*': return 6;
    case '#': return 7;
    default: return 0;
  }
};

const raw = readFileSync(new URL('./logo.txt', import.meta.url), 'utf8').replace(/\n+$/, '');
const lines = raw.split('\n');
const H = lines.length;
const W = Math.max(...lines.map((l) => l.length));
const src = lines.map((l) => {
  const row = new Array(W).fill(0);
  for (let c = 0; c < l.length; c++) row[c] = intensityOf(l[c]);
  return row;
});

// Centroid of the lit cells (rotation pivot).
let sum = 0;
let cx = 0;
let cy = 0;
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++)
    if (src[r][c]) { sum += 1; cx += c; cy += r; }
cx /= sum;
cy /= sum;

// Output canvas big enough to hold the rotated art (pixel-space diagonal).
let minR = H, maxR = 0, minC = W, maxC = 0;
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++)
    if (src[r][c]) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
const diag = Math.ceil(Math.hypot(maxC - minC + 1, (maxR - minR + 1) * ASPECT));
const OW = diag + 2;
const OH = Math.ceil(diag / ASPECT) + 2;
const ocx = (OW - 1) / 2;
const ocy = (OH - 1) / 2;

function sample(col, row) {
  const c = Math.round(col);
  const r = Math.round(row);
  if (r < 0 || r >= H || c < 0 || c >= W) return 0;
  return src[r][c];
}

function rotateFrame(theta) {
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const grid = [];
  for (let r = 0; r < OH; r++) {
    const out = new Array(OW);
    for (let c = 0; c < OW; c++) {
      // output cell → centered pixel space (y stretched by ASPECT)
      const x = c - ocx;
      const y = (r - ocy) * ASPECT;
      // inverse-rotate back into source pixel space
      const sx = x * ca + y * sa;
      const sy = -x * sa + y * ca;
      out[c] = sample(cx + sx, cy + sy / ASPECT);
    }
    grid.push(out);
  }
  return grid;
}

// --- PNG encoder (RGB, no deps) --------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
};
const encodePng = (w, h, rgb) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = w * 3;
  const rowsBuf = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(rowsBuf, y * (stride + 1) + 1, y * stride, y * stride + stride);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rowsBuf)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// --- Rasterize the contact sheet -------------------------------------------
const CW = 7; // px per cell width
const CHt = 14; // px per cell height (≈ ASPECT × CW)
const PAD = 10;
const BG = [16, 18, 22];

const frames = Array.from({ length: FRAMES }, (_u, f) =>
  rotateFrame(DIRECTION * (f * (2 * Math.PI)) / FRAMES)
);

const sheetCols = SHEET_COLS;
const sheetRows = Math.ceil(FRAMES / sheetCols);
const fW = OW * CW;
const fH = OH * CHt;
const PW = PAD + sheetCols * (fW + PAD);
const PH = PAD + sheetRows * (fH + PAD);
const rgb = Buffer.alloc(PW * PH * 3);
for (let i = 0; i < PW * PH; i++) {
  rgb[i * 3] = BG[0];
  rgb[i * 3 + 1] = BG[1];
  rgb[i * 3 + 2] = BG[2];
}
const put = (x, y, v) => {
  if (x < 0 || y < 0 || x >= PW || y >= PH) return;
  const o = (y * PW + x) * 3;
  const b = v / 7;
  rgb[o] = Math.round(BG[0] + (60 - BG[0]) * b * 1.2);
  rgb[o + 1] = Math.round(BG[1] + (230 - BG[1]) * b);
  rgb[o + 2] = Math.round(BG[2] + (230 - BG[2]) * b);
};
frames.forEach((frame, fi) => {
  const ox = PAD + (fi % sheetCols) * (fW + PAD);
  const oy = PAD + Math.floor(fi / sheetCols) * (fH + PAD);
  for (let r = 0; r < OH; r++)
    for (let c = 0; c < OW; c++) {
      const v = frame[r][c];
      if (!v) continue;
      for (let dy = 0; dy < CHt; dy++)
        for (let dx = 0; dx < CW; dx++) put(ox + c * CW + dx, oy + r * CHt + dy, v);
    }
});
writeFileSync(new URL('../spin-preview.png', import.meta.url), encodePng(PW, PH, rgb));

// --- ASCII sniff test: frame 0 and frame 2 (60°) ---------------------------
const toAscii = (grid) =>
  grid.map((row) => row.map((v) => RAMP[Math.min(RAMP.length - 1, v)]).join('').replace(/\s+$/, '')).join('\n');
console.log(`Wrote spin-preview.png — ${FRAMES} frames, full 360°, ${OW}×${OH} cells each.`);
console.log('\n--- frame 0 (0°) ---\n' + toAscii(frames[0]));
console.log('\n--- frame 2 (60°) ---\n' + toAscii(frames[2]));
