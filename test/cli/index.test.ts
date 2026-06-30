import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { makeCliFixture, type CliFixture } from './index-fixture.js';

/**
 * In-process integration tests for the CLI entrypoint.
 * Implements features/cli-index/dispatch-and-flags.feature and
 * features/cli-index/error-and-exit-paths.feature.
 *
 * `src/cli/index.ts` is instrumented by coverage, but the existing
 * `test/cli-e2e/` suite drives a SPAWNED `bin/ratchet.js` in a separate process
 * and never instruments this file. These tests instead drive the in-process
 * `program` via `program.parseAsync([...])` over an isolated tmpdir fixture so
 * the entrypoint's own lines — the `preAction` telemetry hook, `getCommandPath`,
 * global-flag handling, and each registered `.action` catch/exit wrapper — are
 * exercised and measured.
 *
 * Three side effects of driving the real entrypoint are contained:
 * - telemetry: `RATCHET_TELEMETRY=0` (the documented opt-out) so the preAction
 *   hook runs but performs no I/O;
 * - `process.exit`: stubbed to throw a `ProcessExitError` sentinel so an action's
 *   (or commander's) exit is asserted on, not allowed to kill the runner;
 * - singleton `program` state: a fresh module is loaded per scenario via
 *   `vi.resetModules()` + dynamic import so commander option state never leaks.
 */

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

/** Sentinel thrown by the stubbed `process.exit` so the runner is not killed. */
class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

/**
 * Reset the module registry and dynamically import a fresh `program`. Telemetry
 * and the status verb are imported first (same fresh instances the entrypoint
 * will bind to) so a test may spy on them and have the in-process program see
 * the spy.
 */
async function loadProgram() {
  vi.resetModules();
  const telemetry = await import('../../src/telemetry/index.js');
  const trackSpy = vi.spyOn(telemetry, 'trackCommand');
  const workflow = await import('../../src/commands/workflow/index.js');
  const { program } = await import('../../src/cli/index.js');
  return { program, trackSpy, workflow };
}

/**
 * Drive the program and return the exit code the stubbed `process.exit` recorded,
 * or `-1` if the parse completed without exiting.
 */
async function exitCodeOf(
  program: Awaited<ReturnType<typeof loadProgram>>['program'],
  args: string[]
): Promise<number> {
  try {
    await program.parseAsync(['node', 'ratchet', ...args]);
    return -1;
  } catch (error) {
    if (error instanceof ProcessExitError) {
      return error.code;
    }
    throw error;
  }
}

describe('CLI entrypoint (src/cli/index.ts)', () => {
  let fixture: CliFixture;
  let stdout: string[];
  let stderr: string[];
  const envSnapshot: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['RATCHET_TELEMETRY', 'OPEN_SPEC_INTERACTIVE', 'NO_COLOR', 'CI']) {
      envSnapshot[key] = process.env[key];
    }
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(async () => {
    // Telemetry opt-out: the preAction hook still runs, but performs no I/O.
    process.env.RATCHET_TELEMETRY = '0';
    // The batch group's first-run setup hook must stay non-interactive.
    process.env.OPEN_SPEC_INTERACTIVE = '0';
    // Each scenario asserts NO_COLOR itself; start from a clean slate.
    delete process.env.NO_COLOR;

    fixture = await makeCliFixture();

    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(' '));
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExitError(code ?? 0);
    }) as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.cleanup();
  });

  // ── features/cli-index/dispatch-and-flags.feature ────────────────────────

  it('dispatches a known command to its verb over the fixture (status --json)', async () => {
    const { program, trackSpy } = await loadProgram();

    await program.parseAsync(['node', 'ratchet', 'status', '--json']);

    // The status verb ran against the fixture and emitted JSON to stdout.
    const json = JSON.parse(stdout.join('\n'));
    expect(json).toHaveProperty('changes');
    // The preAction telemetry hook resolved the command path for tracking.
    expect(trackSpy).toHaveBeenCalledWith('status', version);
  });

  it('dispatches a grouped subcommand with its command path resolved (batch list)', async () => {
    const { program, trackSpy } = await loadProgram();

    await program.parseAsync(['node', 'ratchet', 'batch', 'list', '--json']);

    // The batch list verb ran against the fixture...
    const json = JSON.parse(stdout.join('\n'));
    expect(json).toHaveProperty('batches');
    // ...and getCommandPath resolved the actionCommand to the colon-joined path.
    expect(trackSpy).toHaveBeenCalledWith('batch:list', version);
  });

  it('parses --json and routes it into the verb', async () => {
    const { program, workflow } = await loadProgram();
    const statusSpy = vi
      .spyOn(workflow, 'statusCommand')
      .mockResolvedValue(undefined as never);

    await program.parseAsync(['node', 'ratchet', 'status', '--json']);

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(statusSpy.mock.calls[0][0]).toMatchObject({ json: true });
  });

  it('sets process.env.NO_COLOR via the global --no-color flag before the command runs', async () => {
    const { program } = await loadProgram();
    expect(process.env.NO_COLOR).toBeUndefined();

    await program.parseAsync(['node', 'ratchet', 'status', '--json', '--no-color']);

    expect(process.env.NO_COLOR).toBe('1');
  });

  it('prints the package version and exits zero for --version', async () => {
    const { program } = await loadProgram();

    const code = await exitCodeOf(program, ['--version']);

    expect(stdout.join('')).toContain(version);
    expect(code).toBe(0);
  });

  // ── features/cli-index/error-and-exit-paths.feature ──────────────────────

  it('reports a throwing verb via ora().fail and exits with code 1', async () => {
    const { program } = await loadProgram();

    // `status --change <ghost>` fails because the change does not exist; the
    // action's catch block reports it via ora().fail and calls process.exit(1).
    const code = await exitCodeOf(program, ['status', '--change', 'does-not-exist']);

    expect(code).toBe(1);
    // The error message was surfaced (ora writes the failure frame to stderr).
    expect(stderr.join('')).toMatch(/does-not-exist|Error/);
  });

  it('rejects an unknown command and exits non-zero', async () => {
    const { program } = await loadProgram();

    const code = await exitCodeOf(program, ['no-such-command']);

    expect(code).toBeGreaterThan(0);
  });

  it('rejects a missing required argument and exits non-zero', async () => {
    const { program } = await loadProgram();

    // `new change <name>` requires a name; omitting it is a commander parse error.
    const code = await exitCodeOf(program, ['new', 'change']);

    expect(code).toBeGreaterThan(0);
  });
});
