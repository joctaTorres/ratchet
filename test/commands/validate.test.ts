import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ValidateCommand } from '../../src/commands/validate.js';
import { CommandFixture, makeCommandFixture } from './change-fixture.js';

/**
 * Behavioral tests for the `validate` verb.
 * Implements features/commands-core-verbs/validate.feature.
 *
 * `ValidateCommand.execute` resolves items and the planning home from the
 * working directory, so each test `process.chdir`s into an isolated tmpdir
 * fixture and restores the cwd in `afterEach`. Output (console.log/error) and
 * `process.exitCode` are asserted, mirroring the exit-code style of
 * `doctor.test.ts`.
 */

describe('ValidateCommand.execute', () => {
  let fixture: CommandFixture;
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-validate-');
    cwd = process.cwd();
    process.chdir(fixture.root);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.chdir(cwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
    await fixture.cleanup();
  });

  const errorOutput = (): string => errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
  const logOutput = (): string => logSpy.mock.calls.map((c) => String(c[0])).join('\n');

  it('prints guidance and fails when no item is given in non-interactive mode', async () => {
    await new ValidateCommand().execute(undefined, { noInteractive: true });

    const printed = errorOutput();
    expect(printed).toContain('Nothing to validate');
    expect(printed).toContain('ratchet validate --all');
    expect(printed).toContain('ratchet validate <item-name>');
    expect(process.exitCode).toBe(1);
  });

  it('reports an unknown item with nearest-match suggestions and exit code 1', async () => {
    await fixture.writeMetadata('real-change');

    await new ValidateCommand().execute('rael-change', { noInteractive: true });

    const printed = errorOutput();
    expect(printed).toContain("Unknown item 'rael-change'");
    expect(printed).toMatch(/Did you mean:.*real-change/);
    expect(process.exitCode).toBe(1);
  });

  it('reports a name matching both a change and a spec as ambiguous and exit code 1', async () => {
    await fixture.writeMetadata('dup');
    await fixture.writeSpec('dup');

    await new ValidateCommand().execute('dup', { noInteractive: true });

    const printed = errorOutput();
    expect(printed).toContain("Ambiguous item 'dup'");
    expect(printed).toMatch(/--type/);
    expect(process.exitCode).toBe(1);
  });

  it('validates a structurally valid change without setting a failure exit code', async () => {
    await fixture.writeValidChange('good-change');

    await new ValidateCommand().execute('good-change', { noInteractive: true });

    expect(logOutput()).toContain("Change 'good-change' is valid");
    expect(process.exitCode).toBe(0);
  });
});
