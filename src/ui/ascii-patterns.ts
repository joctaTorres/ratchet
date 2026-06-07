/**
 * ASCII art animation patterns for the welcome screen.
 *
 * A procedural cogwheel rendered with Braille sub-pixels (a 2×4 dot grid per
 * cell, U+2800–U+28FF) that spins anti-clockwise one step per frame and loops
 * seamlessly. Braille gives ~8× the resolution of block characters in the same
 * space, so a smooth, round gear with crisp squared teeth fits the welcome
 * column. The maths are ported from `scripts/braille-demo.mjs` (the agreed look).
 *
 * Braille is rendered unconditionally: it is well supported by modern terminal
 * fonts, and there is no reliable runtime way to detect a terminal's font glyph
 * coverage anyway, so a capability heuristic would guess wrong as often as it
 * helped. The welcome screen is cosmetic, so a rare font without Braille glyphs
 * degrades to harmless boxes rather than a broken UI.
 */

// --- Tunable gear parameters ------------------------------------------------
// Dot bitmap size. Braille packs 2 dots wide × 4 dots tall per cell, so the
// rendered art is DOT_W/2 × DOT_H/4 cells (here 17 × 8 chars).
const DOT_W = 34; // dots wide  → 17 Braille columns
const DOT_H = 32; // dots tall  → 8 Braille rows
const SS = 3; // supersample per axis (anti-aliasing)
const DIRECTION = -1; // -1 = anti-clockwise (screen y points down)

const N_TEETH = 8; // number of teeth around the rim
const DUTY = 0.55; // tooth angular width fraction (square wave → squared tips)
const TOOTH_H = 3.0; // tooth height in dots (stubby = squarer)

// Frames sweep exactly ONE tooth pitch (2π/N_TEETH). The gear field is
// 2π/N_TEETH-periodic (see solid() below), so the wrap rotation maps bit-for-bit
// onto frame 0 — the loop is pixel-exact, not merely visually seamless. 12 steps
// across one 45° pitch gives ~3.75° per frame, a smooth spin.
const FRAME_COUNT = 12;

// Derived geometry, in dot units, centred on the bitmap.
const CX = (DOT_W - 1) / 2;
const CY = (DOT_H - 1) / 2;
const R_OUTER = Math.min(DOT_W, DOT_H) / 2 - 1; // tooth tip radius
const R_INNER = R_OUTER - TOOTH_H; // rim (tooth base / ring outer edge)
const R_HOLLOW = R_OUTER * 0.42; // bore radius (hollow centre)
const TWO_PI = Math.PI * 2;

/**
 * Is the point (x, y) — in dot units, relative to the gear centre — inside the
 * gear rotated by `rot` radians?
 *
 * - r < R_HOLLOW            → empty bore (hollow centre)
 * - R_HOLLOW ≤ r ≤ R_INNER  → solid ring
 * - R_INNER < r ≤ R_OUTER   → tooth band: a square wave of the angle with
 *                             N_TEETH periods and a DUTY cycle gives each tooth
 *                             a flat (squared) tip rather than a pointed taper.
 * - r > R_OUTER             → outside the gear
 *
 * The ring/bore depend only on r, and the tooth band is exactly
 * 2π/N_TEETH-periodic in `rot`, which is what makes a one-pitch sweep wrap
 * exactly onto frame 0.
 */
function solid(x: number, y: number, rot: number): boolean {
  const r = Math.hypot(x, y);
  if (r < R_HOLLOW) return false;
  if (r <= R_INNER) return true;
  if (r > R_OUTER) return false;
  let a = (Math.atan2(y, x) - rot) / TWO_PI; // turns
  a -= Math.floor(a);
  return (a * N_TEETH) % 1 < DUTY;
}

// Braille glyphs occupy U+2800–U+28FF; the low 8 bits select which of the cell's
// 8 dots are lit. Exported so tests classify/decode glyphs against one source.
export const BRAILLE_BASE = 0x2800;

// Standard Braille dot-bit layout: BITS[row][col] for a 2×4 (col × row) cell.
//   dots 1,4 / 2,5 / 3,6 / 7,8  →  bits 0x01,0x08 / 0x02,0x10 / 0x04,0x20 / 0x40,0x80
const BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/**
 * Supersampled dot bitmap of the gear at rotation `rot`. Each dot is the average
 * of an SS×SS grid of sub-samples of `solid()` (≥ 0.5 lit → dot on), which keeps
 * the tooth edges smooth across rotation instead of shimmering.
 */
function sampleBitmap(rot: number): number[][] {
  const bmp: number[][] = [];
  for (let dr = 0; dr < DOT_H; dr++) {
    const row = new Array<number>(DOT_W);
    for (let dc = 0; dc < DOT_W; dc++) {
      let hits = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const x = dc + (si + 0.5) / SS - 0.5 - CX;
          const y = dr + (sj + 0.5) / SS - 0.5 - CY;
          if (solid(x, y, rot)) hits++;
        }
      }
      row[dc] = hits / (SS * SS) >= 0.5 ? 1 : 0;
    }
    bmp.push(row);
  }
  return bmp;
}

/**
 * Pack a DOT_W×DOT_H dot bitmap into DOT_W/2 × DOT_H/4 Braille glyphs
 * (`BRAILLE_BASE + bits`), one glyph per 2×4 dot block.
 */
function packBraille(bmp: number[][]): string[] {
  const rows: string[] = [];
  for (let cr = 0; cr < DOT_H; cr += 4) {
    let line = '';
    for (let cc = 0; cc < DOT_W; cc += 2) {
      let b = 0;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 2; x++) {
          if (bmp[cr + y]?.[cc + x]) b |= BITS[y][x];
        }
      }
      line += String.fromCharCode(BRAILLE_BASE + b);
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Render one gear frame, rotated by `rot` radians, as Braille rows: sample the
 * gear field into a dot bitmap, then pack the dots into glyphs.
 */
function gearFrame(rot: number): string[] {
  return packBraille(sampleBitmap(rot));
}

/**
 * Generate the full set of Braille frames: one tooth pitch swept over
 * FRAME_COUNT steps in the anti-clockwise direction. The final wrap rotation
 * (`DIRECTION · 2π/N_TEETH`) maps exactly onto frame 0, so the loop is seamless.
 */
function generateBrailleFrames(): string[][] {
  return Array.from({ length: FRAME_COUNT }, (_unused, f) =>
    gearFrame((DIRECTION * f * (TWO_PI / N_TEETH)) / FRAME_COUNT)
  );
}

/**
 * The rotation one full sweep past the last frame — equals frame 0 by the
 * field's N_TEETH periodicity. Exposed so tests can assert the loop is
 * pixel-exact.
 */
export const WRAP_ROTATION = DIRECTION * (TWO_PI / N_TEETH);

/**
 * Render the gear at an arbitrary rotation. Exposed for tests (e.g. to confirm
 * the wrap rotation deep-equals frame 0).
 */
export function renderGearFrame(rot: number): string[] {
  return gearFrame(rot);
}

/** Animation specification consumed by the welcome screen. */
export interface AnimationSpec {
  /** Milliseconds between frames. */
  interval: number;
  /** Each frame is an array of rows (one character per Braille cell). */
  frames: string[][];
}

/**
 * Welcome animation: a procedural cogwheel spinning anti-clockwise, rendered as
 * Braille (1 char/cell, 17×8) on every platform. interval ≈ 70 ms × 12 frames
 * ≈ 0.84 s per visual revolution (one tooth pitch).
 */
export const WELCOME_ANIMATION: AnimationSpec = {
  interval: 70,
  frames: generateBrailleFrames(),
};
