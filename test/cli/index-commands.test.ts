import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { makeCliFixture, type CliFixture } from './index-fixture.js';

/**
 * In-process coverage of every registered command's `.action` wrapper in
 * `src/cli/index.ts`. Companion to `index.test.ts` (which covers dispatch,
 * global flags, and the telemetry hooks): this file drives EACH subcommand over
 * an isolated tmpdir fixture with its underlying verb stubbed, asserting both
 * the success path (verb invoked, no exit) and the shared catch/exit wrapper
 * (verb throws -> `ora().fail` + `process.exit(1)`).
 *
 * Implements features/cli-index/dispatch-and-flags.feature and
 * features/cli-index/error-and-exit-paths.feature (per-command coverage).
 *
 * The verb is stubbed so no real agent runs, no network/process spawn happens,
 * and the wrapper's own lines are what gets measured. Function verbs are spied
 * directly; class verbs (`ListCommand`, `ArchiveCommand`, ...) are spied on
 * their `prototype.execute`; `init`/`doctor` resolve through their (cached)
 * dynamically-imported modules, so spying the fresh import reaches the spy the
 * action will call. A fresh module graph is loaded per scenario via
 * `vi.resetModules()` so commander's singleton `program` never leaks state.
 */

/** Sentinel thrown by the stubbed `process.exit` so the runner is not killed. */
class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

/**
 * Reset the module registry and dynamically import a fresh `program` plus every
 * verb module the actions delegate to, so a scenario can spy on the exact
 * instances the in-process program binds to.
 */
async function loadAll() {
  vi.resetModules();
  const telemetry = await import('../../src/telemetry/index.js');
  const workflow = await import('../../src/commands/workflow/index.js');
  const batch = await import('../../src/commands/batch/index.js');
  const evalMod = await import('../../src/commands/eval/index.js');
  const propose = await import('../../src/commands/propose.js');
  const apply = await import('../../src/commands/apply.js');
  const verify = await import('../../src/commands/verify.js');
  const template = await import('../../src/commands/template.js');
  const list = await import('../../src/core/list.js');
  const update = await import('../../src/core/update.js');
  const archive = await import('../../src/core/archive.js');
  const view = await import('../../src/core/view.js');
  const validate = await import('../../src/commands/validate.js');
  const doctor = await import('../../src/commands/doctor.js');
  const init = await import('../../src/core/init.js');
  const { program } = await import('../../src/cli/index.js');
  return {
    program, telemetry, workflow, batch, evalMod, propose, apply, verify,
    template, list, update, archive, view, validate, doctor, init,
  };
}

type Mods = Awaited<ReturnType<typeof loadAll>>;
type Mock = ReturnType<typeof vi.fn>;

async function exitCodeOf(program: Mods['program'], args: string[]): Promise<number> {
  try {
    await program.parseAsync(['node', 'ratchet', ...args]);
    return -1;
  } catch (error) {
    if (error instanceof ProcessExitError) return error.code;
    throw error;
  }
}

interface CommandCase {
  label: string;
  args: string[];
  /** Install a stub for the command's verb and return the mock for assertions. */
  install: (m: Mods) => Mock;
}

/** Spy a class verb's `prototype.execute` (the action does `new X().execute(...)`). */
const onExecute = (klass: { prototype: { execute: (...a: unknown[]) => unknown } }): Mock =>
  vi.spyOn(klass.prototype, 'execute') as unknown as Mock;

const COMMANDS: CommandCase[] = [
  { label: 'init', args: ['init', '.', '--tools', 'none'], install: (m) => onExecute(m.init.InitCommand) },
  { label: 'experimental (init alias)', args: ['experimental', '--no-interactive'], install: (m) => onExecute(m.init.InitCommand) },
  { label: 'update', args: ['update', '.'], install: (m) => onExecute(m.update.UpdateCommand) },
  { label: 'list', args: ['list'], install: (m) => onExecute(m.list.ListCommand) },
  { label: 'list --specs', args: ['list', '--specs', '--json'], install: (m) => onExecute(m.list.ListCommand) },
  { label: 'view', args: ['view'], install: (m) => onExecute(m.view.ViewCommand) },
  { label: 'archive', args: ['archive', 'some-change', '--yes'], install: (m) => onExecute(m.archive.ArchiveCommand) },
  { label: 'validate', args: ['validate', '--all'], install: (m) => onExecute(m.validate.ValidateCommand) },
  { label: 'doctor', args: ['doctor', '--json'], install: (m) => vi.spyOn(m.doctor, 'doctorCommand') as unknown as Mock },
  { label: 'status', args: ['status', '--json'], install: (m) => vi.spyOn(m.workflow, 'statusCommand') as unknown as Mock },
  { label: 'instructions <artifact>', args: ['instructions', 'spec', '--change', 'x'], install: (m) => vi.spyOn(m.workflow, 'instructionsCommand') as unknown as Mock },
  { label: 'instructions apply', args: ['instructions', 'apply', '--change', 'x'], install: (m) => vi.spyOn(m.workflow, 'applyInstructionsCommand') as unknown as Mock },
  { label: 'template', args: ['template', 'standard'], install: (m) => vi.spyOn(m.template, 'templateCommand') as unknown as Mock },
  { label: 'new change', args: ['new', 'change', 'foo'], install: (m) => vi.spyOn(m.workflow, 'newChangeCommand') as unknown as Mock },
  { label: 'new batch', args: ['new', 'batch', 'foo'], install: (m) => vi.spyOn(m.batch, 'newBatchCommand') as unknown as Mock },
  { label: 'propose', args: ['propose', 'do a thing'], install: (m) => vi.spyOn(m.propose, 'proposeCommand') as unknown as Mock },
  { label: 'apply', args: ['apply', 'foo'], install: (m) => vi.spyOn(m.apply, 'applyCommand') as unknown as Mock },
  { label: 'verify', args: ['verify', 'foo'], install: (m) => vi.spyOn(m.verify, 'verifyCommand') as unknown as Mock },
  { label: 'batch new', args: ['batch', 'new', 'foo'], install: (m) => vi.spyOn(m.batch, 'newBatchCommand') as unknown as Mock },
  { label: 'batch status', args: ['batch', 'status'], install: (m) => vi.spyOn(m.batch, 'batchStatusCommand') as unknown as Mock },
  { label: 'batch view', args: ['batch', 'view'], install: (m) => vi.spyOn(m.batch, 'batchViewCommand') as unknown as Mock },
  { label: 'batch list', args: ['batch', 'list'], install: (m) => vi.spyOn(m.batch, 'batchListCommand') as unknown as Mock },
  { label: 'batch config', args: ['batch', 'config'], install: (m) => vi.spyOn(m.batch, 'batchConfigCommand') as unknown as Mock },
  { label: 'batch report', args: ['batch', 'report', '--status', 'hi'], install: (m) => vi.spyOn(m.batch, 'batchReportCommand') as unknown as Mock },
  { label: 'batch apply', args: ['batch', 'apply'], install: (m) => vi.spyOn(m.batch, 'batchApplyCommand') as unknown as Mock },
  { label: 'batch archive', args: ['batch', 'archive'], install: (m) => vi.spyOn(m.batch, 'batchArchiveCommand') as unknown as Mock },
  { label: 'eval set', args: ['eval', 'set'], install: (m) => vi.spyOn(m.evalMod, 'evalSetCommand') as unknown as Mock },
  { label: 'eval run', args: ['eval', 'run'], install: (m) => vi.spyOn(m.evalMod, 'evalRunCommand') as unknown as Mock },
  { label: 'eval record', args: ['eval', 'record'], install: (m) => vi.spyOn(m.evalMod, 'evalRecordCommand') as unknown as Mock },
  { label: 'eval report', args: ['eval', 'report'], install: (m) => vi.spyOn(m.evalMod, 'evalReportCommand') as unknown as Mock },
  { label: 'eval baseline', args: ['eval', 'baseline', 'r1'], install: (m) => vi.spyOn(m.evalMod, 'evalBaselineCommand') as unknown as Mock },
];

describe('CLI command actions (src/cli/index.ts)', () => {
  let fixture: CliFixture;
  let stdout: string[];
  let stderr: string[];
  const envSnapshot: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['RATCHET_TELEMETRY', 'OPEN_SPEC_INTERACTIVE', 'NO_COLOR']) {
      envSnapshot[key] = process.env[key];
    }
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    process.env.RATCHET_TELEMETRY = '0';
    process.env.OPEN_SPEC_INTERACTIVE = '0';
    fixture = await makeCliFixture('ratchet-cli-cmd-');
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

  for (const c of COMMANDS) {
    it(`runs the verb for "${c.label}" without exiting`, async () => {
      const mods = await loadAll();
      const spy = c.install(mods);
      spy.mockResolvedValue(undefined as never);

      const code = await exitCodeOf(mods.program, c.args);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(code).toBe(-1);
    });

    it(`reports a thrown verb for "${c.label}" via ora().fail and exits 1`, async () => {
      const mods = await loadAll();
      const spy = c.install(mods);
      spy.mockReset();
      spy.mockRejectedValue(new Error(`boom: ${c.label}`));

      const code = await exitCodeOf(mods.program, c.args);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(code).toBe(1);
      // The catch block surfaced the failure (ora writes its frame to stderr).
      expect(stderr.join('')).toMatch(/boom|Error/);
    });
  }
});
