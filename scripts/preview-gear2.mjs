// Prototype: a procedurally-generated gear with SQUARED teeth, rendered with
// Braille sub-pixels. Square-wave tooth profile → flat (squared) tooth tips, no
// pointy tapers. Evaluated analytically per rotation, so every frame is clean
// (no source-bitmap aliasing). Writes gear2-preview.png + prints a Braille frame.
//
// Usage: node scripts/preview-gear2.mjs [teeth] [duty] [toothHeight]

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const DW = 34; // dots wide  (→ 17 braille cols)
const DH = 32; // dots tall  (→ 8 braille rows)
const FRAMES = 8; // frames across one tooth pitch (seamless loop)
const DIRECTION = -1; // anti-clockwise
const SS = 3; // supersample per axis

const N_TEETH = Number(process.argv[2] || 8);
const DUTY = Number(process.argv[3] || 0.55); // tooth angular width fraction (squared teeth)
const TOOTH_H = Number(process.argv[4] || 3.0); // tooth height in dots (smaller = stubbier/squarer)

const cx = (DW - 1) / 2;
const cy = (DH - 1) / 2;
const R_OUTER = Math.min(DW, DH) / 2 - 1; // tooth tip
const R_INNER = R_OUTER - TOOTH_H; // rim (tooth base / ring outer)
const R_HOLLOW = R_OUTER * 0.42; // bore radius
const TWO_PI = Math.PI * 2;

// Is this point inside the gear rotated by `rot`?
function solid(x, y, rot) {
  const r = Math.hypot(x, y);
  if (r < R_HOLLOW) return false; // hollow bore
  if (r <= R_INNER) return true; // solid ring
  if (r > R_OUTER) return false; // outside teeth
  // tooth band: square wave in angle → rectangular teeth with flat tips
  let a = (Math.atan2(y, x) - rot) / TWO_PI; // turns
  a = a - Math.floor(a);
  const phase = (a * N_TEETH) % 1;
  return phase < DUTY;
}

function dotBitmap(rot) {
  const bmp = [];
  for (let dr = 0; dr < DH; dr++) {
    const row = new Array(DW);
    for (let dc = 0; dc < DW; dc++) {
      let hits = 0;
      for (let sj = 0; sj < SS; sj++)
        for (let si = 0; si < SS; si++) {
          const x = dc + (si + 0.5) / SS - 0.5 - cx;
          const y = dr + (sj + 0.5) / SS - 0.5 - cy;
          if (solid(x, y, rot)) hits++;
        }
      row[dc] = hits / (SS * SS) >= 0.5 ? 1 : 0;
    }
    bmp.push(row);
  }
  return bmp;
}

const BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
function toBraille(bmp) {
  const rows = [];
  for (let cr = 0; cr < DH; cr += 4) {
    let line = '';
    for (let cc = 0; cc < DW; cc += 2) {
      let b = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (bmp[cr + y]?.[cc + x]) b |= BITS[y][x];
      line += String.fromCharCode(0x2800 + b);
    }
    rows.push(line);
  }
  return rows;
}

const frames = Array.from({ length: FRAMES }, (_u, f) =>
  dotBitmap((DIRECTION * f * (TWO_PI / N_TEETH)) / FRAMES)
);

// --- PNG of the dot bitmaps -------------------------------------------------
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
    for (let y = 0; y < DOTPX - 1; y++) for (let x = 0; x < DOTPX - 1; x++) { const o = ((oy + dr * DOTPX + y) * PW + (ox + dc * DOTPX + x)) * 3; rgb[o] = ON[0]; rgb[o + 1] = ON[1]; rgb[o + 2] = ON[2]; }
  }
});
writeFileSync(new URL('../gear2-preview.png', import.meta.url), png(PW, PH, rgb));

console.log(`gear2-preview.png — ${N_TEETH} teeth, duty ${DUTY}, toothH ${TOOTH_H} — ${DW}×${DH} dots (${DW / 2}×${DH / 4} cells).\n`);
console.log('frame 0:');
for (const l of toBraille(frames[0])) console.log('  ' + l);
