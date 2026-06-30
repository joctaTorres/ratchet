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
import { WELCOME_ANIMATION } from '../../src/ui/ascii-patterns.js';

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

    // Build a fake raw-mode TTY stdin: it records the 'data' listener so a test
    // can feed it a keypress, and tracks setRawMode/resume/pause/removeListener
    // so we can assert the terminal is left as it was found.
    function fakeRawStdin(initialRaw = false) {
      let dataListener: ((data: Buffer) => void) | undefined;
      const calls = {
        setRawMode: [] as boolean[],
        resumed: 0,
        paused: 0,
        removed: 0,
      };
      const fake = {
        isTTY: true,
        isRaw: initialRaw,
        setRawMode(value: boolean) {
          calls.setRawMode.push(value);
          fake.isRaw = value;
          return fake;
        },
        resume() {
          calls.resumed += 1;
          return fake;
        },
        pause() {
          calls.paused += 1;
          return fake;
        },
        on(event: string, listener: (data: Buffer) => void) {
          if (event === 'data') dataListener = listener;
          return fake;
        },
        removeListener(event: string, listener: (data: Buffer) => void) {
          if (event === 'data' && listener === dataListener) {
            calls.removed += 1;
            dataListener = undefined;
          }
          return fake;
        },
        emit(char: string) {
          dataListener?.(Buffer.from(char));
        },
      };
      return { fake, calls, hasListener: () => dataListener !== undefined };
    }

    function withStdin(replacement: object): () => void {
      const descriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
      Object.defineProperty(process, 'stdin', {
        value: replacement,
        configurable: true,
      });
      return () => {
        if (descriptor) Object.defineProperty(process, 'stdin', descriptor);
      };
    }

    it('enables raw mode, resolves on a carriage-return, and restores the terminal', async () => {
      const { fake, calls, hasListener } = fakeRawStdin(false);
      const restore = withStdin(fake);
      try {
        const pending = waitForEnter();
        // Raw mode was turned on and the stream resumed for reading.
        expect(calls.setRawMode).toEqual([true]);
        expect(calls.resumed).toBe(1);
        expect(hasListener()).toBe(true);

        fake.emit('\r');
        await expect(pending).resolves.toBeUndefined();

        // The data listener is removed, raw mode restored to its prior value,
        // and the stream paused again.
        expect(calls.removed).toBe(1);
        expect(calls.setRawMode).toEqual([true, false]);
        expect(fake.isRaw).toBe(false);
        expect(calls.paused).toBe(1);
        expect(hasListener()).toBe(false);
      } finally {
        restore();
      }
    });

    it('resolves on a newline as well', async () => {
      const { fake } = fakeRawStdin(false);
      const restore = withStdin(fake);
      try {
        const pending = waitForEnter();
        fake.emit('\n');
        await expect(pending).resolves.toBeUndefined();
      } finally {
        restore();
      }
    });

    it('restores the previously-raw terminal to raw (not off) after Enter', async () => {
      // wasRaw is captured as true → setRawMode(wasRaw) keeps raw on.
      const { fake, calls } = fakeRawStdin(true);
      const restore = withStdin(fake);
      try {
        const pending = waitForEnter();
        fake.emit('\r');
        await pending;
        expect(calls.setRawMode).toEqual([true, true]);
        expect(fake.isRaw).toBe(true);
      } finally {
        restore();
      }
    });

    it('ignores non-Enter keystrokes and keeps waiting', async () => {
      const { fake, hasListener } = fakeRawStdin(false);
      const restore = withStdin(fake);
      try {
        let resolved = false;
        const pending = waitForEnter().then(() => {
          resolved = true;
        });
        fake.emit('x'); // not Enter / Ctrl+C
        await Promise.resolve();
        expect(resolved).toBe(false);
        expect(hasListener()).toBe(true); // still listening

        fake.emit('\r');
        await pending;
        expect(resolved).toBe(true);
      } finally {
        restore();
      }
    });

    it('on Ctrl+C writes a newline and exits the process', async () => {
      const { fake } = fakeRawStdin(false);
      const restore = withStdin(fake);
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never);
      try {
        const pending = waitForEnter();
        fake.emit(''); // Ctrl+C
        await pending;
        expect(writeSpy).toHaveBeenCalledWith('\n');
        expect(exitSpy).toHaveBeenCalledWith(0);
      } finally {
        restore();
      }
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

    it('animates frames on a capable TTY and clears the screen after Enter', async () => {
      vi.useFakeTimers();
      try {
        // canAnimate() → true: TTY stdout, no NO_COLOR, wide terminal.
        process.stdout.isTTY = true;
        process.stdout.columns = 120;
        delete process.env.NO_COLOR;

        // Fake raw-mode stdin so the awaited waitForEnter() can be resolved by
        // feeding it a carriage return.
        let dataListener: ((data: Buffer) => void) | undefined;
        const fakeStdin = {
          isTTY: true,
          isRaw: false,
          setRawMode(v: boolean) {
            this.isRaw = v;
            return this;
          },
          resume() {
            return this;
          },
          pause() {
            return this;
          },
          on(event: string, listener: (data: Buffer) => void) {
            if (event === 'data') dataListener = listener;
            return this;
          },
          removeListener() {
            dataListener = undefined;
            return this;
          },
        };
        const stdinDescriptor = Object.getOwnPropertyDescriptor(
          process,
          'stdin'
        );
        Object.defineProperty(process, 'stdin', {
          value: fakeStdin,
          configurable: true,
        });

        const writeSpy = vi
          .spyOn(process.stdout, 'write')
          .mockImplementation(() => true);

        try {
          const pending = showWelcomeScreen();

          // Initial '\n' is written synchronously before the interval starts.
          expect(writeSpy).toHaveBeenCalledWith('\n');
          const writesAfterInitial = writeSpy.mock.calls.length;

          // First tick: first render, NO cursor-up move yet (isFirstRender).
          await vi.advanceTimersByTimeAsync(WELCOME_ANIMATION.interval);
          const firstFrameWrite = writeSpy.mock.calls[writesAfterInitial][0] as string;
          expect(stripAnsi(firstFrameWrite)).toContain('Welcome to Ratchet');
          // No cursor-up escape (\x1b[<n>A) emitted on the very first frame.
          const cursorUpAfterFirst = writeSpy.mock.calls
            .slice(writesAfterInitial)
            .some((c) => /\x1b\[\d+A/.test(c[0] as string));
          expect(cursorUpAfterFirst).toBe(false);

          // Second tick: subsequent render moves the cursor up by frameHeight.
          await vi.advanceTimersByTimeAsync(WELCOME_ANIMATION.interval);
          const cursorUpEmitted = writeSpy.mock.calls.some((c) =>
            /\x1b\[\d+A/.test(c[0] as string)
          );
          expect(cursorUpEmitted).toBe(true);

          // Drive several more frames to exercise the modulo wrap of frameIndex.
          await vi.advanceTimersByTimeAsync(
            WELCOME_ANIMATION.interval * (WELCOME_ANIMATION.frames.length + 2)
          );

          // Press Enter → waitForEnter resolves → animation stops & cleanup runs.
          dataListener?.(Buffer.from('\r'));
          await pending;

          // Cleanup writes the clear-line escape (\x1b[2K) for the teardown loop.
          const clearedLines = writeSpy.mock.calls.filter(
            (c) => (c[0] as string) === '\x1b[2K\n'
          );
          expect(clearedLines.length).toBeGreaterThan(0);

          // The interval is cleared: advancing time produces no further frames.
          const writesBeforeIdle = writeSpy.mock.calls.length;
          await vi.advanceTimersByTimeAsync(WELCOME_ANIMATION.interval * 5);
          expect(writeSpy.mock.calls.length).toBe(writesBeforeIdle);
        } finally {
          writeSpy.mockRestore();
          if (stdinDescriptor) {
            Object.defineProperty(process, 'stdin', stdinDescriptor);
          }
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
