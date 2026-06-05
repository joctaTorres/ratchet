import { describe, it, expect } from 'vitest';
import { WELCOME_ANIMATION } from '../../src/ui/ascii-patterns.js';

// Must match ART_COLUMN_WIDTH in src/ui/welcome-screen.ts. Rows contain only
// the art glyphs (no ANSI codes), so `.length` is the true visible width.
const ART_COLUMN_WIDTH = 24;

// Union of both glyph sets (Unicode + ASCII fallback) so the assertion holds
// regardless of which CHARS branch is active at test time.
const GLYPHS = new Set(['██', '░░', '  ', '##', '++']);

describe('WELCOME_ANIMATION', () => {
  const { frames } = WELCOME_ANIMATION;

  it('has more than one frame', () => {
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

  it('every row is built from whole glyph cells only', () => {
    for (const frame of frames) {
      for (const row of frame) {
        // Rows are sequences of 2-char glyph cells, so length must be even.
        expect(row.length % 2).toBe(0);
        for (let i = 0; i < row.length; i += 2) {
          expect(GLYPHS.has(row.slice(i, i + 2))).toBe(true);
        }
      }
    }
  });
});
