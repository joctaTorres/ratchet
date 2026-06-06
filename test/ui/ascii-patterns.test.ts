import { describe, it, expect } from 'vitest';
import { WELCOME_ANIMATION } from '../../src/ui/ascii-patterns.js';
import { ART_COLUMN_WIDTH } from '../../src/ui/welcome-screen.js';

// Rows contain only the art glyphs (no ANSI codes), so `.length` is the true
// visible width — directly comparable to the renderer's ART_COLUMN_WIDTH.

// Union of both glyph sets (Unicode + ASCII fallback) so the assertions hold
// regardless of which CHARS branch is active at test time. The "empty" cell is
// two spaces in both branches.
const FULL = new Set(['██', '##']);
const DIM = new Set(['░░', '++']);
const EMPTY = '  ';
const GLYPHS = new Set([...FULL, ...DIM, EMPTY]);

// Split a row into its 2-char glyph cells.
function cells(row: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < row.length; i += 2) out.push(row.slice(i, i + 2));
  return out;
}

describe('WELCOME_ANIMATION', () => {
  const { frames } = WELCOME_ANIMATION;

  it('has 8 frames, one per tooth position', () => {
    // Locked exactly: the seamless loop depends on frames === tooth count.
    expect(frames.length).toBe(8);
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
        for (const cell of cells(row)) {
          expect(GLYPHS.has(cell)).toBe(true);
        }
      }
    }
  });

  it('every frame is distinct — the gear actually rotates', () => {
    // Guards against gearFrame() ignoring `lead` and emitting identical frames
    // (which would pass every structural check above but show no motion).
    const serialized = new Set(frames.map((f) => f.join('\n')));
    expect(serialized.size).toBe(frames.length);
  });

  it('every frame is a complete gear with exactly one highlighted tooth', () => {
    // The gear body (full) and the 7 unlit teeth (dim) are identical across
    // frames; only which single tooth is lit moves. So the full-cell and
    // dim-cell counts must be constant frame to frame, and there must be a
    // stable count of dim teeth — proving each frame highlights one and only
    // one tooth rather than e.g. lighting all of them or none.
    const histogram = (frame: string[]): { full: number; dim: number } => {
      let full = 0;
      let dim = 0;
      for (const row of frame) {
        for (const cell of cells(row)) {
          if (FULL.has(cell)) full++;
          else if (DIM.has(cell)) dim++;
        }
      }
      return { full, dim };
    };

    const first = histogram(frames[0]);
    expect(first.dim).toBe(7); // 7 unlit teeth every frame
    for (const frame of frames) {
      expect(histogram(frame)).toEqual(first);
    }
  });
});
