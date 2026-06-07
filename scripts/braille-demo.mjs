// Live terminal demo of the spinning gear (procedural, SQUARED teeth, Braille
// sub-pixels). Run it in your terminal to watch it spin and check your font:
//     node scripts/braille-demo.mjs
// Animates ~6s then exits.

const DW = 34; // dots wide (→ 17 braille cols)
const DH = 32; // dots tall (→ 8 braille rows)
const FRAMES = 12; // steps across one tooth pitch (seamless loop)
const DIRECTION = -1; // anti-clockwise
const SS = 3; // supersample
const INTERVAL = 70; // ms/frame
const RUN_MS = 6300;

const N_TEETH = 8;
const DUTY = 0.55; // tooth angular width (squared teeth)
const TOOTH_H = 3.0; // tooth height in dots (stubby = squarer)

const cx = (DW - 1) / 2, cy = (DH - 1) / 2;
const R_OUTER = Math.min(DW, DH) / 2 - 1;
const R_INNER = R_OUTER - TOOTH_H;
const R_HOLLOW = R_OUTER * 0.42;
const TWO_PI = Math.PI * 2;

function solid(x, y, rot) {
  const r = Math.hypot(x, y);
  if (r < R_HOLLOW) return false;
  if (r <= R_INNER) return true;
  if (r > R_OUTER) return false;
  let a = (Math.atan2(y, x) - rot) / TWO_PI;
  a -= Math.floor(a);
  return (a * N_TEETH) % 1 < DUTY;
}

const BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
function frame(rot) {
  const bmp = [];
  for (let dr = 0; dr < DH; dr++) {
    const row = new Array(DW);
    for (let dc = 0; dc < DW; dc++) {
      let hits = 0;
      for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
        const x = dc + (si + 0.5) / SS - 0.5 - cx;
        const y = dr + (sj + 0.5) / SS - 0.5 - cy;
        if (solid(x, y, rot)) hits++;
      }
      row[dc] = hits / (SS * SS) >= 0.5 ? 1 : 0;
    }
    bmp.push(row);
  }
  const rows = [];
  for (let cr = 0; cr < DH; cr += 4) {
    let line = '';
    for (let cc = 0; cc < DW; cc += 2) {
      let b = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (bmp[cr + y]?.[cc + x]) b |= BITS[y][x];
      line += String.fromCharCode(0x2800 + b);
    }
    rows.push('   ' + line);
  }
  return rows;
}

const frames = Array.from({ length: FRAMES }, (_u, f) =>
  frame((DIRECTION * f * (TWO_PI / N_TEETH)) / FRAMES)
);
const HEIGHT = frames[0].length;

const CYAN = '\x1b[36m', RESET = '\x1b[0m';
process.stdout.write('\n');
let i = 0, first = true;
const timer = setInterval(() => {
  if (!first) process.stdout.write(`\x1b[${HEIGHT}A`);
  first = false;
  process.stdout.write(frames[i % FRAMES].map((l) => '\x1b[2K' + CYAN + l + RESET).join('\n') + '\n');
  i++;
}, INTERVAL);
setTimeout(() => { clearInterval(timer); process.stdout.write('\nDone.\n'); process.exit(0); }, RUN_MS);
