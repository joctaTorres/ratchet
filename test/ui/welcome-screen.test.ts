import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Unit tests for the animated welcome screen.
 *
 * Implements features/ui-telemetry/welcome-screen.feature.
 *
 * The render (welcome text + framed layout), the capability gate (TTY / NO_COLOR
 * / terminal-width), and the keypress input path are all exercised through the
 * single public seam `showWelcomeScreen` — there are no testability-only exports.
 * process.stdout / process.stdin / process.env / TTY and timers are stubbed and
 * restored per test (no spawn, no real terminal) per the testing standard.
 */
import { ART_COLUMN_WIDTH, showWelcomeScreen } from '../../src/ui/welcome-screen.js';
import { WELCOME_ANIMATION } from '../../src/ui/ascii-patterns.js';

// Strip every CSI escape (colour `…m` codes and the cursor/clear `…A`/`…K` codes)
// so we can assert on plain text regardless of chalk's detected colour level.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

// Build a fake raw-mode TTY stdin: it records the 'data' listener so a test can
// feed it a keypress, and tracks setRawMode/resume/pause/removeListener so we can
// assert the terminal is left as it was found. This is the stdin that
// `showWelcomeScreen`'s awaited `waitForEnter()` drives on the animated path.
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

  // Put stdout in the state where canAnimate() returns true: a wide colour TTY.
  function enableAnimatableStdout(): void {
    process.stdout.isTTY = true;
    process.stdout.columns = 120;
    delete process.env.NO_COLOR;
  }

  describe('static fallback (canAnimate() is false)', () => {
    it('renders the welcome text + framed layout once when stdout is not a TTY', async () => {
      // Non-TTY stdout → canAnimate() short-circuits false on the first check.
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

      // getWelcomeText() content reaches stdout: the framework line, the
      // quick-start verbs, and the trailing Enter prompt.
      expect(written).toContain('Welcome to Ratchet');
      expect(written).toContain('/rct:propose');
      expect(written).toContain('/rct:apply');
      expect(written).toContain('/rct:archive');
      expect(written).toContain('Press Enter to select tools...');

      // renderFrame() padding reaches stdout: on the first row the art column is
      // padded to ART_COLUMN_WIDTH, so the first text line begins exactly there.
      const lines = written.split('\n').filter((l) => l.length > 0);
      const welcomeLine = lines.find((l) => l.includes('Welcome to Ratchet'))!;
      expect(welcomeLine.indexOf('Welcome to Ratchet')).toBe(ART_COLUMN_WIDTH);

      // renderFrame()'s "missing art cell" branch: the gear has fewer rows than
      // the text column, so later text rows are padded with a full empty art
      // column (ART_COLUMN_WIDTH spaces) before the text.
      const proposeLine = lines.find((l) => l.includes('/rct:propose'))!;
      expect(proposeLine.startsWith(' '.repeat(ART_COLUMN_WIDTH))).toBe(true);
    });

    it('falls back to static when NO_COLOR is set on an otherwise-capable TTY', async () => {
      // TTY + wide, but NO_COLOR set → canAnimate()'s NO_COLOR branch returns false.
      process.stdout.isTTY = true;
      process.stdout.columns = 120;
      process.env.NO_COLOR = '1';
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      await showWelcomeScreen();

      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(stripAnsi(writeSpy.mock.calls[0][0] as string)).toContain(
        'Welcome to Ratchet'
      );
    });

    it('falls back to static on a terminal narrower than the minimum width', async () => {
      // TTY, no NO_COLOR, but too narrow → canAnimate()'s width branch returns false.
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;
      process.stdout.columns = 40;
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      await showWelcomeScreen();

      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('animated path (canAnimate() is true)', () => {
    it('animates frames on a capable TTY and clears the screen after Enter', async () => {
      vi.useFakeTimers();
      enableAnimatableStdout();
      const { fake, calls } = fakeRawStdin(false);
      const restore = withStdin(fake);
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      try {
        const pending = showWelcomeScreen();

        // Initial '\n' is written synchronously before the interval starts, and
        // waitForEnter() has already enabled raw mode + resumed the stream.
        expect(writeSpy).toHaveBeenCalledWith('\n');
        expect(calls.setRawMode).toEqual([true]);
        expect(calls.resumed).toBe(1);
        const writesAfterInitial = writeSpy.mock.calls.length;

        // First tick: first render, NO cursor-up move yet (isFirstRender).
        await vi.advanceTimersByTimeAsync(WELCOME_ANIMATION.interval);
        const firstFrameWrite = writeSpy.mock.calls[writesAfterInitial][0] as string;
        expect(stripAnsi(firstFrameWrite)).toContain('Welcome to Ratchet');
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
        fake.emit('\r');
        await pending;

        // The terminal is restored: data listener removed, raw mode reset to its
        // prior (off) value, stream paused.
        expect(calls.removed).toBe(1);
        expect(calls.setRawMode).toEqual([true, false]);
        expect(fake.isRaw).toBe(false);
        expect(calls.paused).toBe(1);

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
        restore();
        vi.useRealTimers();
      }
    });

    it('restores a previously-raw terminal to raw (not off) after Enter', async () => {
      vi.useFakeTimers();
      enableAnimatableStdout();
      // wasRaw is captured as true → setRawMode(wasRaw) keeps raw on after Enter.
      const { fake, calls } = fakeRawStdin(true);
      const restore = withStdin(fake);
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      try {
        const pending = showWelcomeScreen();
        fake.emit('\n'); // newline also counts as Enter
        await pending;
        expect(calls.setRawMode).toEqual([true, true]);
        expect(fake.isRaw).toBe(true);
      } finally {
        writeSpy.mockRestore();
        restore();
        vi.useRealTimers();
      }
    });

    it('ignores non-Enter keystrokes and keeps waiting until Enter', async () => {
      vi.useFakeTimers();
      enableAnimatableStdout();
      const { fake, hasListener } = fakeRawStdin(false);
      const restore = withStdin(fake);
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      try {
        let resolved = false;
        const pending = showWelcomeScreen().then(() => {
          resolved = true;
        });

        fake.emit('x'); // not Enter / Ctrl+C → ignored, still listening
        await Promise.resolve();
        expect(resolved).toBe(false);
        expect(hasListener()).toBe(true);

        fake.emit('\r');
        await pending;
        expect(resolved).toBe(true);
        expect(hasListener()).toBe(false);
      } finally {
        writeSpy.mockRestore();
        restore();
        vi.useRealTimers();
      }
    });

    it('on Ctrl+C writes a newline and exits the process', async () => {
      vi.useFakeTimers();
      enableAnimatableStdout();
      const { fake } = fakeRawStdin(false);
      const restore = withStdin(fake);
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never);

      try {
        const pending = showWelcomeScreen();
        fake.emit(''); // Ctrl+C
        await pending;
        expect(writeSpy).toHaveBeenCalledWith('\n');
        expect(exitSpy).toHaveBeenCalledWith(0);
      } finally {
        writeSpy.mockRestore();
        restore();
        vi.useRealTimers();
      }
    });

    it('resolves immediately when stdout animates but stdin is not a TTY', async () => {
      vi.useFakeTimers();
      enableAnimatableStdout();
      // canAnimate() gates on stdout only; a non-TTY stdin makes waitForEnter()
      // resolve immediately without enabling raw mode.
      process.stdin.isTTY = false;
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      try {
        // The animated path is taken (interval scheduled) yet the awaited
        // waitForEnter() resolves at once, so showWelcomeScreen() completes.
        await showWelcomeScreen();
        expect(setIntervalSpy).toHaveBeenCalled();
        expect(writeSpy).toHaveBeenCalledWith('\n');
      } finally {
        writeSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});
