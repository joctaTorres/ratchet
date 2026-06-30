import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ValidateCommand } from '../../src/commands/validate.js';
import { CommandFixture, makeCommandFixture } from './change-fixture.js';

/**
 * Integration tests for the `validate` verb's bulk-validation paths.
 * Implements features/validate-deep/bulk-validation.feature.
 *
 * `ValidateCommand.execute` resolves items and the planning home from the
 * working directory, so each test `process.chdir`s into an isolated tmpdir
 * fixture and restores the cwd in `afterEach`. console.log/console.error are
 * captured and `process.exitCode` is reset per test. Bulk scenarios pass
 * `noInteractive` (or `--json`) so no `ora` spinner renders.
 */

describe('ValidateCommand.execute — bulk validation', () => {
  let fixture: CommandFixture;
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-validate-bulk-');
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
  const allOutput = (): string => `${logOutput()}\n${errorOutput()}`;

  it('--all validates both changes and specs and reports a totals line', async () => {
    await fixture.writeValidChange('good-change');
    await fixture.writeValidSpec('good-spec');

    await new ValidateCommand().execute(undefined, { all: true, noInteractive: true });

    const out = allOutput();
    expect(out).toContain('✓ change/good-change');
    expect(out).toContain('✓ spec/good-spec');
    expect(logOutput()).toMatch(/Totals: \d+ passed, \d+ failed \(\d+ items\)/);
    expect(logOutput()).toContain('Totals: 2 passed, 0 failed (2 items)');
    expect(process.exitCode).toBe(0);
  });

  it('--changes restricts the scope to changes only', async () => {
    await fixture.writeValidChange('good-change');
    await fixture.writeValidSpec('good-spec');

    await new ValidateCommand().execute(undefined, { changes: true, noInteractive: true });

    const out = allOutput();
    expect(out).toContain('change/good-change');
    expect(out).not.toContain('spec/good-spec');
    expect(process.exitCode).toBe(0);
  });

  it('--specs restricts the scope to specs only', async () => {
    await fixture.writeValidChange('good-change');
    await fixture.writeValidSpec('good-spec');

    await new ValidateCommand().execute(undefined, { specs: true, noInteractive: true });

    const out = allOutput();
    expect(out).toContain('spec/good-spec');
    expect(out).not.toContain('change/good-change');
  });

  it('a failing item drives a non-zero exit and a failed marker', async () => {
    await fixture.writeInvalidChange('bad-change');

    await new ValidateCommand().execute(undefined, { changes: true, noInteractive: true });

    expect(errorOutput()).toContain('✗ change/bad-change');
    expect(logOutput()).toContain('Totals: 0 passed, 1 failed (1 items)');
    expect(process.exitCode).toBe(1);
  });

  it('an empty scope returns success with a no-items message', async () => {
    await new ValidateCommand().execute(undefined, { all: true, noInteractive: true });

    expect(logOutput()).toContain('No items found to validate.');
    expect(process.exitCode).toBe(0);
  });

  it('an empty scope in JSON mode emits a zeroed summary', async () => {
    await new ValidateCommand().execute(undefined, { all: true, json: true });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.items).toEqual([]);
    expect(parsed.summary.totals).toEqual({ items: 0, passed: 0, failed: 0 });
    expect(process.exitCode).toBe(0);
  });

  it('JSON mode emits a structured report with a typed summary', async () => {
    await fixture.writeValidChange('good-change');
    await fixture.writeValidSpec('good-spec');

    await new ValidateCommand().execute(undefined, { all: true, json: true });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.summary.totals).toEqual({ items: 2, passed: 2, failed: 0 });
    expect(parsed.version).toBe('1.0');
  });

  it('an explicit concurrency option bounds the validation queue', async () => {
    await fixture.writeValidChange('change-a');
    await fixture.writeValidChange('change-b');
    await fixture.writeValidChange('change-c');

    await new ValidateCommand().execute(undefined, {
      changes: true,
      concurrency: '2',
      noInteractive: true,
    });

    const out = allOutput();
    expect(out).toContain('✓ change/change-a');
    expect(out).toContain('✓ change/change-b');
    expect(out).toContain('✓ change/change-c');
    expect(logOutput()).toContain('Totals: 3 passed, 0 failed (3 items)');
    expect(process.exitCode).toBe(0);
  });
});
