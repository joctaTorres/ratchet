import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, it, expect } from 'vitest';
import {
  evaluateDependencyAudit,
  readAuditCounts,
  resolveFailOn,
  runDependencyAuditGate,
  DEFAULT_AUDIT_FAIL_ON,
  FAIL_ON_ENV,
  REPORT_ENV,
  type Severity,
  type SeverityCounts,
} from '../../src/core/ci/dependency-audit-gate.js';
import type { GateSignal } from '../../src/core/ci/release-decision.js';
import {
  loadCiWorkflow,
  ciWorkflowPath,
  findRunStepIndex,
  type WorkflowJob,
} from './helpers/workflow.js';

/**
 * The dependency-audit gate is the phase-3 "dependency-audit slice": a pure
 * evaluator that turns a parsed vulnerability audit into a green/red gate signal
 * against a configured severity threshold, plus a thin runner that adapts CI's
 * world to it. These tests prove the decision behaviorally (evaluator + runner
 * exercised directly with fixture reports — no Actions runner) and the CI half
 * structurally (against the parsed workflow model the phase-1 helper exposes).
 * They deliberately assert the signal is NOT yet wired into the release decision
 * — that is the `wire-security-into-release-gate` change's boundary.
 */

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** Build full per-severity counts from a partial spec (absent severities → 0). */
function counts(partial: Partial<SeverityCounts>): SeverityCounts {
  return { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...partial };
}

/** Write an audit-report fixture; return its path. `content` may be raw text. */
function writeReport(content: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-gate-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'audit-report.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

/** A well-formed `pnpm audit --json` report with the given per-severity counts. */
function reportWith(vulns: Partial<SeverityCounts>): unknown {
  return { metadata: { vulnerabilities: counts(vulns) } };
}

describe('evaluateDependencyAudit', () => {
  it('is green when the audit reports zero vulnerabilities, with no reasons', () => {
    const result = evaluateDependencyAudit({ counts: counts({}), failOn: 'high' });
    expect(result.signal).toBe('green');
    expect(result.reasons).toEqual([]);
    expect(result.offending).toEqual([]);
  });

  it('is green when only below-threshold severities are present', () => {
    const result = evaluateDependencyAudit({
      counts: counts({ low: 3, moderate: 1 }),
      failOn: 'high',
    });
    expect(result.signal).toBe('green');
    expect(result.reasons).toEqual([]);
  });

  it('is red when a vulnerability AT the threshold is present, naming severity/count', () => {
    const result = evaluateDependencyAudit({ counts: counts({ high: 2 }), failOn: 'high' });
    expect(result.signal).toBe('red');
    expect(result.offending).toEqual(['high']);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('2');
    expect(result.reasons[0]).toContain('high');
  });

  it('is red when a vulnerability ABOVE the threshold is present', () => {
    const result = evaluateDependencyAudit({ counts: counts({ critical: 1 }), failOn: 'high' });
    expect(result.signal).toBe('red');
    expect(result.offending).toEqual(['critical']);
    expect(result.reasons[0]).toContain('critical');
    // Singular wording for a single vulnerability.
    expect(result.reasons[0]).toMatch(/1 critical vulnerability/);
  });

  it('reports every offending severity, ordered low→high', () => {
    const result = evaluateDependencyAudit({
      counts: counts({ moderate: 5, high: 1, critical: 2 }),
      failOn: 'high',
    });
    expect(result.signal).toBe('red');
    // `moderate` is below `high`, so it does not offend.
    expect(result.offending).toEqual(['high', 'critical']);
  });

  it('is fail-closed red when the counts are null, naming the unreadable report', () => {
    const result = evaluateDependencyAudit({ counts: null, failOn: 'high' });
    expect(result.signal).toBe('red');
    expect(result.reasons[0]).toMatch(/audit report could not be read/i);
  });

  it('respects a raised fail-on threshold: high passes when failing only on critical', () => {
    const result = evaluateDependencyAudit({ counts: counts({ high: 4 }), failOn: 'critical' });
    expect(result.signal).toBe('green');
    expect(result.offending).toEqual([]);
  });

  it('returns a signal assignable to the release-decision GateSignal', () => {
    // Type-level integration contract: the dependency-audit signal IS the spine's
    // gate signal shape, so the later wiring change feeds it in unchanged.
    const signal: GateSignal = evaluateDependencyAudit({
      counts: counts({}),
      failOn: 'high',
    }).signal;
    expect(['green', 'red']).toContain(signal);
  });
});

describe('resolveFailOn', () => {
  it('defaults to DEFAULT_AUDIT_FAIL_ON when no override is set', () => {
    expect(resolveFailOn({})).toBe(DEFAULT_AUDIT_FAIL_ON);
  });

  it('respects a recognized AUDIT_FAIL_ON override', () => {
    expect(resolveFailOn({ [FAIL_ON_ENV]: 'critical' })).toBe('critical');
  });

  it('is case-insensitive and trims the override', () => {
    expect(resolveFailOn({ [FAIL_ON_ENV]: '  Moderate ' })).toBe('moderate');
  });

  it('falls back to the default for an unrecognized override', () => {
    expect(resolveFailOn({ [FAIL_ON_ENV]: 'catastrophic' })).toBe(DEFAULT_AUDIT_FAIL_ON);
  });
});

describe('readAuditCounts', () => {
  it('reads metadata.vulnerabilities from a well-formed report', () => {
    const got = readAuditCounts(writeReport(reportWith({ high: 2, low: 1 })));
    expect(got).toEqual(counts({ high: 2, low: 1 }));
  });

  it('defaults absent severities to 0', () => {
    const got = readAuditCounts(writeReport({ metadata: { vulnerabilities: { high: 1 } } }));
    expect(got).toEqual(counts({ high: 1 }));
  });

  it('returns null for a missing file (fail-closed)', () => {
    expect(readAuditCounts('/no/such/audit-report.json')).toBeNull();
  });

  it('returns null for malformed JSON (fail-closed)', () => {
    expect(readAuditCounts(writeReport('{ not json'))).toBeNull();
  });

  it('returns null when the vulnerabilities block is absent (fail-closed)', () => {
    expect(readAuditCounts(writeReport({ metadata: {} }))).toBeNull();
  });

  it('returns null when a severity count is non-numeric (fail-closed)', () => {
    expect(
      readAuditCounts(writeReport({ metadata: { vulnerabilities: { high: 'lots' } } })),
    ).toBeNull();
  });
});

describe('runDependencyAuditGate', () => {
  it('green + exit 0 when the report has no vulnerabilities at/above the threshold', () => {
    const run = runDependencyAuditGate({ [REPORT_ENV]: writeReport(reportWith({ low: 2 })) });
    expect(run.result.signal).toBe('green');
    expect(run.exitCode).toBe(0);
    expect(run.lines.join('\n')).toMatch(/green/i);
  });

  it('red + exit non-zero when a vulnerability at/above the threshold is present', () => {
    const run = runDependencyAuditGate({ [REPORT_ENV]: writeReport(reportWith({ critical: 1 })) });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).not.toBe(0);
    expect(run.lines.join('\n')).toContain('critical');
  });

  it('is fail-closed: red + exit non-zero when the report is missing', () => {
    const run = runDependencyAuditGate({ [REPORT_ENV]: '/no/such/audit-report.json' });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).not.toBe(0);
    expect(run.lines.join('\n')).toMatch(/could not be read/i);
  });

  it('respects an AUDIT_FAIL_ON override at the runner boundary', () => {
    const report = writeReport(reportWith({ high: 3 }));
    // 3 high vulns fail the default (`high`) but pass when failing only on critical.
    expect(runDependencyAuditGate({ [REPORT_ENV]: report }).result.signal).toBe('red');
    expect(
      runDependencyAuditGate({ [REPORT_ENV]: report, [FAIL_ON_ENV]: 'critical' }).result.signal,
    ).toBe('green');
  });
});

describe('dependency-audit CI step', () => {
  const workflow = loadCiWorkflow();

  function ciJob(): WorkflowJob {
    const job = workflow.jobs[0];
    expect(job, 'workflow defines at least one job').toBeDefined();
    return job;
  }

  it('runs the dependency vulnerability audit and writes a JSON report', () => {
    const { steps } = ciJob();
    const audit = steps.find((s) => /audit\s+--json/.test(s.run ?? ''));
    expect(audit, 'a step runs `pnpm audit --json`').toBeDefined();
    expect(audit?.run).toMatch(/\.json/);
  });

  it('invokes the dependency-audit-gate runner', () => {
    const { steps } = ciJob();
    expect(findRunStepIndex(steps, 'dependency-audit-gate.js')).toBeGreaterThanOrEqual(0);
  });

  it('places the audit-gate step after the test step', () => {
    const { steps } = ciJob();
    const test = findRunStepIndex(steps, 'pnpm vitest run');
    const gate = findRunStepIndex(steps, 'dependency-audit-gate.js');
    expect(test).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(test);
  });

  it('folds its outcome into the combined security signal on the release path', () => {
    // `wire-security-into-release-gate` joins this audit step's outcome (with the
    // secret-scan step's) into the single GATE_SECURITY signal the release gate
    // consumes. Scan the workflow's executable content (comments stripped) so a
    // comment mentioning a security var cannot satisfy — or break — the assertion.
    const executable = readFileSync(ciWorkflowPath(), 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, ''))
      .join('\n');
    expect(executable).toMatch(/GATE_SECURITY/);
    expect(executable).toMatch(/steps\.audit\.outcome/);
  });

  it('release path now wires lint, test, coverage, e2e, and the combined security signal', () => {
    const executable = readFileSync(ciWorkflowPath(), 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, ''))
      .join('\n');
    const gates = (executable.match(/GATE_[A-Z0-9]+/g) ?? []).sort();
    expect([...new Set(gates)]).toEqual([
      'GATE_COVERAGE',
      'GATE_E2E',
      'GATE_LINT',
      'GATE_SECURITY',
      'GATE_TEST',
    ]);
  });
});

// Compile-time guard: the exported Severity union covers exactly the ordered set.
const _severityCheck: Severity[] = ['info', 'low', 'moderate', 'high', 'critical'];
void _severityCheck;
