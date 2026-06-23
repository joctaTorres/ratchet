import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, it, expect } from 'vitest';
import {
  evaluateE2e,
  readE2eResult,
  runE2eGate,
  RESULT_ENV,
  type E2eResult,
} from '../../src/core/ci/e2e-gate.js';
import type { GateSignal } from '../../src/core/ci/release-decision.js';
import {
  loadCiWorkflow,
  ciWorkflowPath,
  findRunStepIndex,
  type WorkflowJob,
} from './helpers/workflow.js';

/**
 * The e2e gate is the phase-2 "e2e slice": a pure evaluator that turns the
 * built-CLI smoke's machine-readable result into a green/red gate signal, plus a
 * thin runner that adapts CI's world to it. These tests prove the decision
 * behaviorally (evaluator + runner exercised directly with fixture results — no
 * Actions runner, no real smoke) and the CI half structurally (against the
 * parsed workflow model the phase-1 helper exposes). They do NOT assert any
 * wiring into the release decision — that is a later change's boundary.
 */

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** Write a result fixture (object or raw string); return its path. */
function writeResult(content: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-gate-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'cli-smoke.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

/** A passing result: every check passed and the run is marked ok. */
const ALL_PASSED: E2eResult = {
  ok: true,
  checks: [
    { name: 'version', passed: true },
    { name: 'help', passed: true },
    { name: 'subcommand', passed: true },
  ],
};

describe('evaluateE2e', () => {
  it('is green when every check passed and the run is ok, with no reasons', () => {
    const result = evaluateE2e(ALL_PASSED);
    expect(result.signal).toBe('green');
    expect(result.reasons).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('is red when any check failed, naming the failing check', () => {
    const result = evaluateE2e({
      ok: false,
      checks: [
        { name: 'version', passed: true },
        { name: 'help', passed: false },
        { name: 'subcommand', passed: true },
      ],
    });
    expect(result.signal).toBe('red');
    expect(result.failures).toEqual(['help']);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('help');
  });

  it('names every failing check when more than one failed', () => {
    const result = evaluateE2e({
      ok: false,
      checks: [
        { name: 'version', passed: false },
        { name: 'help', passed: false },
      ],
    });
    expect(result.signal).toBe('red');
    expect(result.failures).toEqual(['version', 'help']);
  });

  it('is red when the run is not ok even if no check is recorded as failed (crash mid-run)', () => {
    const result = evaluateE2e({ ok: false, checks: [] });
    expect(result.signal).toBe('red');
    expect(result.reasons[0]).toMatch(/did not complete/i);
  });

  it('is fail-closed red when the result is null, naming the unreadable result', () => {
    const result = evaluateE2e(null);
    expect(result.signal).toBe('red');
    expect(result.ok).toBeNull();
    expect(result.reasons[0]).toMatch(/result could not be read/i);
  });

  it('returns a signal assignable to the release-decision GateSignal', () => {
    // Type-level integration contract: the e2e signal IS the spine's gate signal
    // shape, so the later wiring change feeds it in unchanged.
    const signal: GateSignal = evaluateE2e(ALL_PASSED).signal;
    expect(['green', 'red']).toContain(signal);
  });
});

describe('readE2eResult', () => {
  it('reads a well-formed result', () => {
    expect(readE2eResult(writeResult(ALL_PASSED))).toEqual(ALL_PASSED);
  });

  it('returns null for a missing file (fail-closed)', () => {
    expect(readE2eResult('/no/such/cli-smoke.json')).toBeNull();
  });

  it('returns null for malformed JSON (fail-closed)', () => {
    expect(readE2eResult(writeResult('{ not json'))).toBeNull();
  });

  it('returns null when ok is absent or not boolean (fail-closed)', () => {
    expect(readE2eResult(writeResult({ checks: [] }))).toBeNull();
    expect(readE2eResult(writeResult({ ok: 'yes', checks: [] }))).toBeNull();
  });

  it('returns null when checks is absent or malformed (fail-closed)', () => {
    expect(readE2eResult(writeResult({ ok: true }))).toBeNull();
    expect(readE2eResult(writeResult({ ok: true, checks: [{ name: 'x' }] }))).toBeNull();
  });
});

describe('runE2eGate', () => {
  it('green + exit 0 when the result reports every check passed', () => {
    const run = runE2eGate({ [RESULT_ENV]: writeResult(ALL_PASSED) });
    expect(run.result.signal).toBe('green');
    expect(run.exitCode).toBe(0);
    expect(run.lines.join('\n')).toMatch(/green/i);
  });

  it('red + exit non-zero when a check failed, surfacing the failing check', () => {
    const run = runE2eGate({
      [RESULT_ENV]: writeResult({
        ok: false,
        checks: [{ name: 'subcommand', passed: false }],
      }),
    });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).not.toBe(0);
    expect(run.lines.join('\n')).toContain('subcommand');
  });

  it('is fail-closed: red + exit non-zero when the result is missing', () => {
    const run = runE2eGate({ [RESULT_ENV]: '/no/such/cli-smoke.json' });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).not.toBe(0);
    expect(run.lines.join('\n')).toMatch(/could not be read/i);
  });
});

describe('e2e CI step', () => {
  const workflow = loadCiWorkflow();

  function ciJob(): WorkflowJob {
    const job = workflow.jobs[0];
    expect(job, 'workflow defines at least one job').toBeDefined();
    return job;
  }

  it('builds the package so dist/ and bin/ratchet.js are runnable', () => {
    const { steps } = ciJob();
    expect(findRunStepIndex(steps, 'pnpm build')).toBeGreaterThanOrEqual(0);
  });

  it('runs the e2e CLI smoke against the built binary', () => {
    const { steps } = ciJob();
    expect(findRunStepIndex(steps, 'cli-smoke.sh')).toBeGreaterThanOrEqual(0);
  });

  it('invokes the e2e-gate runner after the test step', () => {
    const { steps } = ciJob();
    const test = findRunStepIndex(steps, 'pnpm vitest run');
    const gate = findRunStepIndex(steps, 'e2e-gate.js');
    expect(test).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(test);
  });

  it('wires the e2e signal into the release path from the e2e step outcome', () => {
    // The wire-coverage-e2e-into-release-gate change feeds GATE_E2E into the
    // release-gate runner, sourced from the e2e step's outcome (fail-closed to
    // red). Scan the workflow's executable content (comments stripped) so a
    // comment merely mentioning the var cannot satisfy the assertion.
    const executable = readFileSync(ciWorkflowPath(), 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, ''))
      .join('\n');
    expect(executable).toMatch(/GATE_E2E/i);
    expect(executable).toMatch(/steps\.e2e\.outcome/);
  });
});
