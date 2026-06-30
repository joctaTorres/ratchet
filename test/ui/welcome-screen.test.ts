import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Unit tests for the animated welcome screen.
 *
 * Implements features/ui-telemetry/welcome-screen.feature.
 *
 * The render (getWelcomeText, renderFrame), capability gate (canAnimate), and
 * input (waitForEnter, showWelcomeScreen static fallback) paths are exercised at
 * the unit layer with process.stdout / process.stdin / process.env stubbed and
 * restored per test — no spawn, no real terminal — per the testing standard.
 */
import {
  ART_COLUMN_WIDTH,
  getWelcomeText,
  renderFrame,
  canAnimate,
  waitForEnter,
  showWelcomeScreen,
} from '../../src/ui/welcome-screen.js';

// Strip every CSI escape (colour `…m` codes and the clear-line `…K`) so we can
// assert on plain text regardless of chalk's detected colour level.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

describe('ui/welcome-screen', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalIsTTY: boolean | undefined;
  let originalColumns: number | undefined;
  let originalStdinIsTTY: boolean | undefined;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalIsTTY = process.stdout.isTTY;
    originalColumns = process.stdout.columns;
    originalStdinIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.stdout.isTTY = originalIsTTY as boolean;
    process.stdout.columns = originalColumns as number;
    process.stdin.isTTY = originalStdinIsTTY as boolean;
    vi.restoreAllMocks();
  });

  describe('getWelcomeText', () => {
    it('lists the framework, setup items, and quick-start verbs ending with the Enter prompt', () => {
      const text = stripAnsi(getWelcomeText().join('\n'));

      expect(text).toContain('Welcome to Ratchet');
      expect(text).toContain('/rct:propose');
      expect(text).toContain('/rct:apply');
      expect(text).toContain('/rct:archive');
      expect(text.trimEnd().endsWith('Press Enter to select tools...')).toBe(true);
    });
  });

  describe('renderFrame', () => {
    it('pads the art column to ART_COLUMN_WIDTH and prefixes the clear-line escape', () => {
      const output = renderFrame(['xy'], ['TEXT']);
      const lines = output.split('\n');

      // Every line is prefixed with the clear-line escape sequence.
      for (const line of lines) {
        expect(line.startsWith('\x1b[2K')).toBe(true);
      }

      // The short art segment is padded to ART_COLUMN_WIDTH before the text.
      const plain = stripAnsi(output);
      expect(plain).toBe('xy' + ' '.repeat(ART_COLUMN_WIDTH - 2) + 'TEXT');
    });

    it('renders one line per row using the longer of art/text lengths and tolerates missing cells', () => {
      const output = renderFrame(['a', 'b'], ['only-text']);
      const lines = output.split('\n');
      expect(lines).toHaveLength(2);
      // Second row has no text cell; art still padded to the fixed width.
      expect(stripAnsi(lines[1])).toBe('b' + ' '.repeat(ART_COLUMN_WIDTH - 1));
    });
  });

  describe('canAnimate', () => {
    it('reports false when stdout is not a TTY', () => {
      process.stdout.isTTY = false;
      expect(canAnimate()).toBe(false);
    });

    it('reports false when NO_COLOR is set on a TTY', () => {
      process.stdout.isTTY = true;
      process.stdout.columns = 120;
      process.env.NO_COLOR = '1';
      expect(canAnimate()).toBe(false);
    });

    it('reports false on a terminal narrower than the minimum width', () => {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;
      process.stdout.columns = 40;
      expect(canAnimate()).toBe(false);
    });

    it('reports true on a wide colour-capable TTY', () => {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;
      process.stdout.columns = 120;
      expect(canAnimate()).toBe(true);
    });
  });

  describe('waitForEnter', () => {
    it('resolves immediately when stdin is not a TTY', async () => {
      process.stdin.isTTY = false;
      await expect(waitForEnter()).resolves.toBeUndefined();
    });
  });

  describe('showWelcomeScreen', () => {
    it('writes exactly one complete static frame and resolves when animation is unavailable', async () => {
      // Non-TTY stdout → canAnimate() is false → static-fallback branch.
      process.stdout.isTTY = false;
      process.stdin.isTTY = false;
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      await showWelcomeScreen();

      // Exactly one write for the single static frame; no animation interval.
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).not.toHaveBeenCalled();

      const written = stripAnsi(writeSpy.mock.calls[0][0] as string);
      expect(written).toContain('Welcome to Ratchet');
      expect(written).toContain('Press Enter to select tools...');
    });
  });
});
