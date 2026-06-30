import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ValidateCommand } from '../../src/commands/validate.js';
import { CommandFixture, makeCommandFixture } from './change-fixture.js';

/**
 * Integration tests for the `validate` verb's batch validation and reporting
 * paths. Implements features/validate-deep/batch-and-reporting.feature.
 *
 * `ValidateCommand.execute` resolves items and the planning home from the
 * working directory, so each test `process.chdir`s into an isolated tmpdir
 * fixture and restores the cwd in `afterEach`. console.log/console.error are
 * captured and `process.exitCode` is reset per test. Scenarios pass
 * `noInteractive` (or `--json`) so no `ora` spinner renders.
 */

describe('ValidateCommand.execute — batch validation and reporting', () => {
  let fixture: CommandFixture;
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeCommandFixture('ratchet-validate-batch-');
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

  it('a well-formed batch manifest validates as a batch item', async () => {
    await fixture.writeValidBatch('feat-batch');

    await new ValidateCommand().execute('feat-batch', { noInteractive: true });

    expect(logOutput()).toContain("Batch 'feat-batch' is valid");
    expect(process.exitCode).toBe(0);
  });

  it('a malformed batch manifest reports the error with its location', async () => {
    await fixture.writeMalformedBatch('broken-batch');

    await new ValidateCommand().execute('broken-batch', { noInteractive: true });

    const out = errorOutput();
    expect(out).toContain("Batch 'broken-batch' has issues");
    expect(out).toContain('[ERROR]');
    expect(out).toContain('proofOfWork');
    expect(process.exitCode).toBe(1);
  });

  it('a batch phase with a cyclic dependency reports a DAG error', async () => {
    await fixture.writeCyclicBatch('cyclic-batch');

    await new ValidateCommand().execute('cyclic-batch', { noInteractive: true });

    const out = errorOutput();
    expect(out).toContain("Batch 'cyclic-batch' has issues");
    expect(out).toContain('phases.phase-1');
    expect(process.exitCode).toBe(1);
  });

  it('a batch manifest validates in JSON mode', async () => {
    await fixture.writeValidBatch('json-batch');

    await new ValidateCommand().execute('json-batch', { json: true });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].type).toBe('batch');
    expect(parsed.items[0].valid).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it('an invalid change reports issues, exit 1, and next-steps guidance', async () => {
    await fixture.writeInvalidChange('bad-change');

    await new ValidateCommand().execute('bad-change', { noInteractive: true });

    const out = errorOutput();
    expect(out).toContain("Change 'bad-change' has issues");
    expect(out).toContain('[ERROR]');
    expect(out).toContain('Next steps:');
    expect(out).toContain('Ensure plan.md has ## Why, ## What Changes, ## Design, and ## Tasks');
    expect(process.exitCode).toBe(1);
  });

  it('an invalid change in JSON mode emits a structured failing report', async () => {
    await fixture.writeInvalidChange('bad-change');

    await new ValidateCommand().execute('bad-change', { json: true });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].type).toBe('change');
    expect(parsed.items[0].valid).toBe(false);
    expect(parsed.items[0].issues.length).toBeGreaterThan(0);
  });

  it('the --type spec override routes validation to the feature store', async () => {
    await fixture.writeValidSpec('cap-one');

    await new ValidateCommand().execute('cap-one', { type: 'spec', noInteractive: true });

    expect(logOutput()).toContain("Specification 'cap-one' is valid");
    expect(process.exitCode).toBe(0);
  });

  it('an invalid spec reports spec-specific next-steps guidance', async () => {
    await fixture.writeInvalidSpec('cap-two');

    await new ValidateCommand().execute('cap-two', { type: 'spec', noInteractive: true });

    const out = errorOutput();
    expect(out).toContain("Specification 'cap-two' has issues");
    expect(out).toContain('Next steps:');
    expect(out).toContain('Re-run with --json to see structured report');
    expect(process.exitCode).toBe(1);
  });
});
