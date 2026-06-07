import { describe, it, expect } from 'vitest';
import {
  WELCOME_ANIMATION,
  WRAP_ROTATION,
  renderGearFrame,
} from '../../src/ui/ascii-patterns.js';
import { ART_COLUMN_WIDTH } from '../../src/ui/welcome-screen.js';

// Each frame row is one character per Braille cell (no ANSI codes), so a row's
// string length is its true visible width — directly comparable to the
// renderer's ART_COLUMN_WIDTH.

const BRAILLE_BASE = 0x2800;
const BRAILLE_MAX = 0x28ff;

// Count the lit dots in a frame by popcounting each Braille glyph's bits.
function dotMass(frame: string[]): number {
  let mass = 0;
  for (const row of frame) {
    for (const ch of row) {
      const code = ch.charCodeAt(0);
      if (code >= BRAILLE_BASE && code <= BRAILLE_MAX) {
        let bits = code - BRAILLE_BASE;
        while (bits) {
          mass += bits & 1;
          bits >>= 1;
        }
      }
    }
  }
  return mass;
}

describe('WELCOME_ANIMATION (Braille cogwheel)', () => {
  const { frames } = WELCOME_ANIMATION;

  it('has multiple frames so the gear can rotate', () => {
    expect(frames.length).toBeGreaterThan(1);
  });

  it('every frame has the same row count as the first frame', () => {
    const rowCount = frames[0].length;
    for (const frame of frames) {
      expect(frame.length).toBe(rowCount);
    }
  });

  it('every row fits within the art column width', () => {
    for (const frame of frames) {
      for (const row of frame) {
        expect(row.length).toBeLessThanOrEqual(ART_COLUMN_WIDTH);
      }
    }
  });

  it('every character is a space or a Braille pattern (U+2800–U+28FF)', () => {
    for (const frame of frames) {
      for (const row of frame) {
        for (const ch of row) {
          const code = ch.charCodeAt(0);
          const isSpace = ch === ' ';
          const isBraille = code >= BRAILLE_BASE && code <= BRAILLE_MAX;
          expect(isSpace || isBraille).toBe(true);
        }
      }
    }
  });

  it('every frame is distinct — the gear actually rotates', () => {
    const serialized = new Set(frames.map((f) => f.join('\n')));
    expect(serialized.size).toBe(frames.length);
  });

  it('every frame has substantial, roughly-constant lit-dot mass', () => {
    // Catches empty or collapsed frames. The gear field is rotation-stable in
    // area, so dot mass stays in a tight band frame to frame.
    const masses = frames.map(dotMass);
    const min = Math.min(...masses);
    const max = Math.max(...masses);
    // A 34×32 dot gear lights ~470 dots; assert a generous floor and a tight
    // band so a degenerate frame (empty / half-drawn) fails.
    expect(min).toBeGreaterThan(300);
    expect(max - min).toBeLessThan(min * 0.1);
  });

  it('loops seamlessly: the wrap rotation deep-equals frame 0 (pixel-exact)', () => {
    // The tooth band in solid() is exactly 2π/N_TEETH-periodic, so sweeping one
    // full tooth pitch lands bit-for-bit back on frame 0.
    const wrapFrame = renderGearFrame(WRAP_ROTATION);
    expect(wrapFrame).toEqual(frames[0]);
  });
});
