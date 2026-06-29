import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, it, expect } from 'vitest';
import {
  evaluateCoverage,
  readCoverageTotal,
  resolveThreshold,
  runCoverageGate,
  DEFAULT_COVERAGE_THRESHOLD,
  THRESHOLD_ENV,
  SUMMARY_ENV,
} from '../../src/core/ci/coverage-gate.js';
import type { GateSignal } from '../../src/core/ci/release-decision.js';
import {
  loadCiWorkflow,
  ciWorkflowPath,
  findRunStepIndex,
  type WorkflowJob,
} from './helpers/workflow.js';

/**
 * The coverage gate is the phase-2 "coverage slice": a pure evaluator that turns
 * a measured coverage total into a green/red gate signal against an enforced
 * threshold, plus a thin runner that adapts CI's world to it. These tests prove
 * the decision behaviorally (evaluator + runner exercised directly with fixture
 * summaries — no Actions runner) and the CI half structurally (against the
 * parsed workflow model the phase-1 helper exposes). They do NOT assert any
 * wiring into the release decision — that is a later change's boundary.
 */

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** Write a json-summary fixture with the given total line pct; return its path. */
function writeSummary(content: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cov-gate-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'coverage-summary.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

/** A well-formed v8 json-summary with `total.lines.pct === pct`. */
function summaryWithPct(pct: number): unknown {
  return { total: { lines: { total: 100, covered: pct, skipped: 0, pct } } };
}

describe('evaluateCoverage', () => {
  it('is green when coverage equals the threshold, with no reasons', () => {
    const result = evaluateCoverage({ coverage: 68, threshold: 68 });
    expect(result.signal).toBe('green');
    expect(result.reasons).toEqual([]);
    expect(result.coverage).toBe(68);
    expect(result.threshold).toBe(68);
  });

  it('is green when coverage is above the threshold', () => {
    expect(evaluateCoverage({ coverage: 90.5, threshold: 68 }).signal).toBe('green');
  });

  it('is red below the threshold, naming coverage vs threshold', () => {
    const result = evaluateCoverage({ coverage: 50, threshold: 68 });
    expect(result.signal).toBe('red');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('50');
    expect(result.reasons[0]).toContain('68');
  });

  it('is fail-closed red when the total is null, naming the unreadable summary', () => {
    const result = evaluateCoverage({ coverage: null, threshold: 68 });
    expect(result.signal).toBe('red');
    expect(result.reasons[0]).toMatch(/summary could not be read/i);
  });

  it('is fail-closed red when the total is NaN', () => {
    const result = evaluateCoverage({ coverage: Number.NaN, threshold: 68 });
    expect(result.signal).toBe('red');
    expect(result.reasons[0]).toMatch(/summary could not be read/i);
  });

  it('returns a signal assignable to the release-decision GateSignal', () => {
    // Type-level integration contract: the coverage signal IS the spine's gate
    // signal shape, so the later wiring change feeds it in unchanged.
    const signal: GateSignal = evaluateCoverage({ coverage: 80, threshold: 68 }).signal;
    expect(['green', 'red']).toContain(signal);
  });
});

describe('resolveThreshold', () => {
  it('defaults to DEFAULT_COVERAGE_THRESHOLD when no override is set', () => {
    expect(resolveThreshold({})).toBe(DEFAULT_COVERAGE_THRESHOLD);
  });

  it('respects a numeric COVERAGE_THRESHOLD override', () => {
    expect(resolveThreshold({ [THRESHOLD_ENV]: '85' })).toBe(85);
  });

  it('falls back to the default for a non-numeric override', () => {
    expect(resolveThreshold({ [THRESHOLD_ENV]: 'nope' })).toBe(DEFAULT_COVERAGE_THRESHOLD);
  });
});

describe('raised coverage floor (ratchetable-threshold.feature)', () => {
  // The phase raised the enforced floor above the old 68 baseline to 72. These
  // tests pin the raised default and prove the gate's green-at/above, red-below
  // behavior at it, plus the override and non-numeric-fallback contracts.

  it('resolves the default enforced floor to 72, strictly above the old 68 baseline', () => {
    expect(DEFAULT_COVERAGE_THRESHOLD).toBe(72);
    expect(resolveThreshold({})).toBe(72);
    expect(resolveThreshold({})).toBeGreaterThan(68);
  });

  it('is green + exit 0 when coverage is exactly at the raised floor (72)', () => {
    const run = runCoverageGate({ [SUMMARY_ENV]: writeSummary(summaryWithPct(72)) });
    expect(run.result.signal).toBe('green');
    expect(run.exitCode).toBe(0);
  });

  it('is green + exit 0 when coverage is above the raised floor (80)', () => {
    const run = runCoverageGate({ [SUMMARY_ENV]: writeSummary(summaryWithPct(80)) });
    expect(run.result.signal).toBe('green');
    expect(run.exitCode).toBe(0);
  });

  it('is red + exit 1 below the raised floor, naming the coverage and the 72 threshold', () => {
    const run = runCoverageGate({ [SUMMARY_ENV]: writeSummary(summaryWithPct(68.67)) });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).toBe(1);
    const reason = run.result.reasons.join('\n');
    expect(reason).toContain('68.67');
    expect(reason).toContain('72');
  });

  it('lets a COVERAGE_THRESHOLD override win over the raised default', () => {
    const summary = writeSummary(summaryWithPct(72));
    // 72 clears the raised default but not a higher 95 override.
    expect(runCoverageGate({ [SUMMARY_ENV]: summary }).result.signal).toBe('green');
    expect(
      runCoverageGate({ [SUMMARY_ENV]: summary, [THRESHOLD_ENV]: '95' }).result.signal,
    ).toBe('red');
  });

  it('falls back to the raised default of 72 for a non-numeric override', () => {
    expect(resolveThreshold({ [THRESHOLD_ENV]: 'not-a-number' })).toBe(72);
  });
});

describe('readCoverageTotal', () => {
  it('reads total.lines.pct from a well-formed summary', () => {
    expect(readCoverageTotal(writeSummary(summaryWithPct(73.4)))).toBe(73.4);
  });

  it('returns null for a missing file (fail-closed)', () => {
    expect(readCoverageTotal('/no/such/coverage-summary.json')).toBeNull();
  });

  it('returns null for malformed JSON (fail-closed)', () => {
    expect(readCoverageTotal(writeSummary('{ not json'))).toBeNull();
  });

  it('returns null when the total block is absent (fail-closed)', () => {
    expect(readCoverageTotal(writeSummary({ total: {} }))).toBeNull();
  });
});

describe('runCoverageGate', () => {
  it('green + exit 0 when the measured total meets the threshold', () => {
    const run = runCoverageGate({ [SUMMARY_ENV]: writeSummary(summaryWithPct(80)) });
    expect(run.result.signal).toBe('green');
    expect(run.exitCode).toBe(0);
    expect(run.lines.join('\n')).toMatch(/green/i);
  });

  it('red + exit non-zero when the measured total is below the threshold', () => {
    const run = runCoverageGate({
      [SUMMARY_ENV]: writeSummary(summaryWithPct(10)),
      [THRESHOLD_ENV]: '68',
    });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).not.toBe(0);
    expect(run.lines.join('\n')).toContain('10');
  });

  it('is fail-closed: red + exit non-zero when the summary is missing', () => {
    const run = runCoverageGate({ [SUMMARY_ENV]: '/no/such/coverage-summary.json' });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).not.toBe(0);
    expect(run.lines.join('\n')).toMatch(/could not be read/i);
  });

  it('respects a COVERAGE_THRESHOLD override at the runner boundary', () => {
    const summary = writeSummary(summaryWithPct(73));
    // 73% clears the enforced default (DEFAULT_COVERAGE_THRESHOLD) but not a
    // raised 75% override.
    expect(DEFAULT_COVERAGE_THRESHOLD).toBeLessThanOrEqual(73);
    expect(runCoverageGate({ [SUMMARY_ENV]: summary }).result.signal).toBe('green');
    expect(
      runCoverageGate({ [SUMMARY_ENV]: summary, [THRESHOLD_ENV]: '75' }).result.signal,
    ).toBe('red');
  });
});

describe('coverage CI step', () => {
  const workflow = loadCiWorkflow();

  function ciJob(): WorkflowJob {
    const job = workflow.jobs[0];
    expect(job, 'workflow defines at least one job').toBeDefined();
    return job;
  }

  it('runs the suite with coverage collection', () => {
    const { steps } = ciJob();
    const coverage = steps.find((s) => /--coverage/.test(s.run ?? ''));
    expect(coverage).toBeDefined();
  });

  it('invokes the coverage-gate runner', () => {
    const { steps } = ciJob();
    expect(findRunStepIndex(steps, 'coverage-gate.js')).toBeGreaterThanOrEqual(0);
  });

  it('places the coverage-gate step after the test step', () => {
    const { steps } = ciJob();
    const test = findRunStepIndex(steps, 'pnpm vitest run');
    const gate = findRunStepIndex(steps, 'coverage-gate.js');
    expect(test).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(test);
  });

  it('wires the coverage signal into the release path from the coverage step outcome', () => {
    // The wire-coverage-e2e-into-release-gate change feeds GATE_COVERAGE into the
    // release-gate runner, sourced from the coverage step's outcome (fail-closed
    // to red). Scan the workflow's executable content (comments stripped) so a
    // comment merely mentioning the var cannot satisfy the assertion.
    const executable = readFileSync(ciWorkflowPath(), 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, ''))
      .join('\n');
    expect(executable).toMatch(/GATE_COVERAGE/i);
    expect(executable).toMatch(/steps\.coverage\.outcome/);
  });
});
