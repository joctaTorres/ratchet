import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ValidateCommand } from '../../src/commands/validate.js';
import { CommandFixture, makeCommandFixture } from './change-fixture.js';

/**
 * Integration tests for the `validate` verb's interactive selector branch.
 * Implements features/validate-deep/interactive-selector.feature.
 *
 * `runInteractiveSelector` dynamically imports `@inquirer/prompts`; the module
 * is mocked so `select` resolves a scripted choice without real TTY I/O. The
 * verb resolves interactivity from the environment, so each test forces a TTY
 * and clears `CI`/`OPEN_SPEC_INTERACTIVE` in `beforeEach` and restores them in
 * `afterEach`. The fixture is isolated under os.tmpdir() and torn down per test.
 */

const select = vi.fn();
vi.mock('@inquirer/prompts', () => ({
  select: (...args: unknown[]) => select(...args),
}));

describe('ValidateCommand.execute — interactive selector', () => {
  let fixture: CommandFixture;
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let prevTTY: boolean | undefined;
  let prevCI: string | undefined;
  let prevOpenSpec: string | undefined;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-validate-interactive-');
    cwd = process.cwd();
    process.chdir(fixture.root);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;

    // Force an interactive context so execute() routes into the selector.
    prevTTY = process.stdin.isTTY;
    prevCI = process.env.CI;
    prevOpenSpec = process.env.OPEN_SPEC_INTERACTIVE;
    process.stdin.isTTY = true;
    delete process.env.CI;
    delete process.env.OPEN_SPEC_INTERACTIVE;

    select.mockReset();
  });

  afterEach(async () => {
    process.chdir(cwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
    process.stdin.isTTY = prevTTY as boolean;
    if (prevCI === undefined) delete process.env.CI;
    else process.env.CI = prevCI;
    if (prevOpenSpec === undefined) delete process.env.OPEN_SPEC_INTERACTIVE;
    else process.env.OPEN_SPEC_INTERACTIVE = prevOpenSpec;
    await fixture.cleanup();
  });

  const errorOutput = (): string => errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
  const logOutput = (): string => logSpy.mock.calls.map((c) => String(c[0])).join('\n');
  const allOutput = (): string => `${logOutput()}\n${errorOutput()}`;

  it('choosing "all" routes into bulk validation of changes and specs', async () => {
    await fixture.writeValidChange('good-change');
    await fixture.writeValidSpec('good-spec');
    select.mockResolvedValueOnce('all');

    await new ValidateCommand().execute(undefined, {});

    const out = allOutput();
    expect(out).toContain('change/good-change');
    expect(out).toContain('spec/good-spec');
  });

  it('choosing "changes" routes into bulk validation of changes only', async () => {
    await fixture.writeValidChange('good-change');
    await fixture.writeValidSpec('good-spec');
    select.mockResolvedValueOnce('changes');

    await new ValidateCommand().execute(undefined, {});

    const out = allOutput();
    expect(out).toContain('change/good-change');
    expect(out).not.toContain('spec/good-spec');
  });

  it('choosing "specs" routes into bulk validation of specs only', async () => {
    await fixture.writeValidChange('good-change');
    await fixture.writeValidSpec('good-spec');
    select.mockResolvedValueOnce('specs');

    await new ValidateCommand().execute(undefined, {});

    const out = allOutput();
    expect(out).toContain('spec/good-spec');
    expect(out).not.toContain('change/good-change');
  });

  it('choosing "one" then an item validates that single item', async () => {
    await fixture.writeValidChange('good-change');
    select
      .mockResolvedValueOnce('one')
      .mockResolvedValueOnce({ type: 'change', id: 'good-change' });

    await new ValidateCommand().execute(undefined, {});

    expect(logOutput()).toContain("Change 'good-change' is valid");
    expect(process.exitCode).toBe(0);
  });

  it('choosing "one" with no items reports nothing to validate', async () => {
    select.mockResolvedValueOnce('one');

    await new ValidateCommand().execute(undefined, {});

    expect(errorOutput()).toContain('No items found to validate.');
    expect(process.exitCode).toBe(1);
  });
});
