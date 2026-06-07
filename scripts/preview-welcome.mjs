// Dev previewer for the welcome-screen animation.
//
// I (the agent) can't watch a live TTY, but I can read images and text. This
// turns the shipped WELCOME_ANIMATION (Braille frames, 1 char/cell) into
// artifacts I can inspect:
//   - a PNG "contact sheet" with every frame's dot bitmap laid out in order, so
//     the gear shape and rotation read at a glance (preview == shipped output).
//   - a plain-text dump of each frame's Braille rows for quick legibility.
//
// Usage:
//   pnpm build && node scripts/preview-welcome.mjs
// Writes welcome-preview.png and prints the text dump to stdout.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { WELCOME_ANIMATION } from '../dist/ui/ascii-patterns.js';

const { frames, interval } = WELCOME_ANIMATION;

// --- Decode each Braille cell back into its 2×4 dot block ------------------
// Standard Braille dot-bit layout (matches ascii-patterns.ts).
const BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

// Returns the lit dots of a frame as a flat DH×DW grid (1 = lit). Frames are
// rows of Braille chars; each char is 2 dots wide × 4 dots tall.
function frameToDots(frame) {
  const cellRows = frame.length;
  const cellCols = [...frame[0]].length;
  const DW = cellCols * 2;
  const DH = cellRows * 4;
  const dots = Array.from({ length: DH }, () => new Array(DW).fill(0));
  frame.forEach((row, cr) => {
    [...row].forEach((ch, cc) => {
      const b = ch.charCodeAt(0) - 0x2800;
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 2; x++)
          if (b & BITS[y][x]) dots[cr * 4 + y][cc * 2 + x] = 1;
    });
  });
  return { dots, DW, DH };
}

// --- Text dump (read directly from stdout) ---------------------------------
function textDump() {
  const lines = [];
  lines.push(`interval=${interval}ms  frames=${frames.length}  (Braille rows, 1 char/cell)`);
  frames.forEach((frame, fi) => {
    lines.push('');
    lines.push(`frame ${fi}:`);
    for (const row of frame) lines.push('  ' + row);
  });
  return lines.join('\n');
}

// --- Minimal PNG encoder (RGB, no deps) ------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Rasterize the contact sheet (one dot = DOTPX px) ----------------------
const DOTPX = 7;
const PAD = 12;
const COLS = 6;
const BG = [16, 18, 22];
const ON = [60, 220, 220];

function buildContactSheet() {
  const sheets = frames.map(frameToDots);
  const { DW, DH } = sheets[0];
  const fW = DW * DOTPX;
  const fH = DH * DOTPX;
  const sheetCols = Math.min(COLS, frames.length);
  const sheetRows = Math.ceil(frames.length / sheetCols);
  const W = PAD + sheetCols * (fW + PAD);
  const H = PAD + sheetRows * (fH + PAD);

  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = BG[0];
    rgb[i * 3 + 1] = BG[1];
    rgb[i * 3 + 2] = BG[2];
  }
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    rgb[o] = c[0];
    rgb[o + 1] = c[1];
    rgb[o + 2] = c[2];
  };

  sheets.forEach(({ dots }, fi) => {
    const ox = PAD + (fi % sheetCols) * (fW + PAD);
    const oy = PAD + Math.floor(fi / sheetCols) * (fH + PAD);
    dots.forEach((row, dr) => {
      row.forEach((lit, dc) => {
        if (!lit) return;
        for (let dy = 0; dy < DOTPX - 1; dy++)
          for (let dx = 0; dx < DOTPX - 1; dx++)
            put(ox + dc * DOTPX + dx, oy + dr * DOTPX + dy, ON);
      });
    });
  });

  return encodePng(W, H, rgb);
}

const png = buildContactSheet();
writeFileSync(new URL('../welcome-preview.png', import.meta.url), png);
console.log(textDump());
console.error(
  `\nWrote welcome-preview.png (${frames.length} frames, reading order: left→right, top→bottom)`
);
