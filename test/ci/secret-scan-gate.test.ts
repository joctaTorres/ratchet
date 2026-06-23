import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, it, expect } from 'vitest';
import {
  evaluateSecretScan,
  fingerprint,
  readSecretFindings,
  resolveAllowlist,
  runSecretScanGate,
  ALLOWLIST_ENV,
  REPORT_ENV,
  type SecretFinding,
} from '../../src/core/ci/secret-scan-gate.js';
import type { GateSignal } from '../../src/core/ci/release-decision.js';
import {
  loadCiWorkflow,
  ciWorkflowPath,
  findRunStepIndex,
  type WorkflowJob,
} from './helpers/workflow.js';

/**
 * The secret-scan gate is the phase-3 "secret-scan slice": a pure evaluator that
 * turns a parsed secret-scan report into a green/red gate signal (red on any
 * non-allowlisted finding, fail-closed on an unreadable report), plus a thin
 * runner that adapts CI's world to it. These tests prove the decision
 * behaviorally (evaluator + runner exercised directly with fixture reports — no
 * Actions runner) and the CI half structurally (against the parsed workflow model
 * the phase-1 helper exposes). They deliberately assert the signal is NOT yet
 * wired into the release decision — that is the `wire-security-into-release-gate`
 * change's boundary.
 */

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** Write a secret-scan-report fixture; return its path. `content` may be raw text. */
function writeReport(content: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'secret-scan-gate-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'secret-scan-report.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

/** A finding in the lowercase emitter shape, with sensible defaults. */
function finding(partial: Partial<SecretFinding> = {}): SecretFinding {
  return { rule: 'generic-api-key', file: 'src/leak.ts', ...partial };
}

describe('evaluateSecretScan', () => {
  it('is green when the scan reports zero findings, with no reasons', () => {
    const result = evaluateSecretScan({ findings: [] });
    expect(result.signal).toBe('green');
    expect(result.reasons).toEqual([]);
    expect(result.allowlisted).toBe(0);
  });

  it('is red when a finding is present, naming the file and rule', () => {
    const result = evaluateSecretScan({
      findings: [finding({ rule: 'aws-access-key', file: 'src/config.ts', line: 12 })],
    });
    expect(result.signal).toBe('red');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('src/config.ts');
    expect(result.reasons[0]).toContain('aws-access-key');
  });

  it('is red and accounts for every finding when several secrets are present', () => {
    const result = evaluateSecretScan({
      findings: [
        finding({ rule: 'aws-access-key', file: 'src/a.ts' }),
        finding({ rule: 'github-pat', file: 'src/b.ts' }),
        finding({ rule: 'slack-token', file: 'src/c.ts' }),
      ],
    });
    expect(result.signal).toBe('red');
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons.join('\n')).toContain('src/a.ts');
    expect(result.reasons.join('\n')).toContain('src/b.ts');
    expect(result.reasons.join('\n')).toContain('src/c.ts');
  });

  it('is fail-closed red when the findings are null, naming the unreadable report', () => {
    const result = evaluateSecretScan({ findings: null });
    expect(result.signal).toBe('red');
    expect(result.reasons[0]).toMatch(/secret-scan report could not be read/i);
  });

  it('stays green when the only finding is allowlisted by its fingerprint', () => {
    const planted = finding({ rule: 'test-fixture-secret', file: 'test/fixtures/planted.txt' });
    const result = evaluateSecretScan({
      findings: [planted],
      allowlist: new Set([fingerprint(planted)]),
    });
    expect(result.signal).toBe('green');
    expect(result.allowlisted).toBe(1);
    expect(result.reasons).toEqual([]);
  });

  it('allowlists by bare file, but a real leak alongside still goes red', () => {
    const result = evaluateSecretScan({
      findings: [
        finding({ rule: 'test-fixture-secret', file: 'test/fixtures/planted.txt' }),
        finding({ rule: 'aws-access-key', file: 'src/real-leak.ts' }),
      ],
      allowlist: new Set(['test/fixtures/planted.txt']),
    });
    expect(result.signal).toBe('red');
    expect(result.allowlisted).toBe(1);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('src/real-leak.ts');
  });

  it('does NOT exempt a finding by a bare rule id (allowlist is too broad otherwise)', () => {
    // A bare-rule allowlist entry must no longer exempt findings of that rule —
    // allowlisting a whole rule everywhere is a security footgun. Only a precise
    // fingerprint (file:rule) or a bare file exempts.
    const result = evaluateSecretScan({
      findings: [finding({ rule: 'generic-api-key', file: 'src/leak.ts' })],
      allowlist: new Set(['generic-api-key']),
    });
    expect(result.signal).toBe('red');
    expect(result.allowlisted).toBe(0);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('src/leak.ts');
  });

  it('a bare-rule exemption does not hide the same rule in another file', () => {
    const result = evaluateSecretScan({
      findings: [finding({ rule: 'aws-access-key', file: 'src/real-leak.ts' })],
      allowlist: new Set(['aws-access-key']),
    });
    expect(result.signal).toBe('red');
    expect(result.allowlisted).toBe(0);
    expect(result.reasons[0]).toContain('src/real-leak.ts');
  });

  it('returns a signal assignable to the release-decision GateSignal', () => {
    // Type-level integration contract: the secret-scan signal IS the spine's gate
    // signal shape, so the later wiring change feeds it in unchanged.
    const signal: GateSignal = evaluateSecretScan({ findings: [] }).signal;
    expect(['green', 'red']).toContain(signal);
  });
});

describe('resolveAllowlist', () => {
  it('is an empty set when no override is provided (fail-closed default)', () => {
    expect(resolveAllowlist({}).size).toBe(0);
  });

  it('parses comma-separated entries, trimming and dropping empties', () => {
    const set = resolveAllowlist({ [ALLOWLIST_ENV]: ' test/fixtures/planted.txt , generic-key , ' });
    expect([...set].sort()).toEqual(['generic-key', 'test/fixtures/planted.txt']);
  });
});

describe('readSecretFindings', () => {
  it('reads a top-level array in gitleaks capitalized shape', () => {
    const report = writeReport([
      { RuleID: 'aws-access-key', File: 'src/config.ts', StartLine: 7, Description: 'AWS key' },
    ]);
    expect(readSecretFindings(report)).toEqual([
      { rule: 'aws-access-key', file: 'src/config.ts', line: 7, secretType: 'AWS key' },
    ]);
  });

  it('reads an object with a findings array in the lowercase emitter shape', () => {
    const report = writeReport({ findings: [{ rule: 'github-pat', file: 'src/x.ts' }] });
    expect(readSecretFindings(report)).toEqual([{ rule: 'github-pat', file: 'src/x.ts' }]);
  });

  it('treats an empty array as a clean scan (zero findings)', () => {
    expect(readSecretFindings(writeReport([]))).toEqual([]);
  });

  it('returns null for a missing file (fail-closed)', () => {
    expect(readSecretFindings('/no/such/secret-scan-report.json')).toBeNull();
  });

  it('returns null for malformed JSON (fail-closed)', () => {
    expect(readSecretFindings(writeReport('{ not json'))).toBeNull();
  });

  it('returns null when the JSON is neither an array nor has a findings array', () => {
    expect(readSecretFindings(writeReport({ unexpected: true }))).toBeNull();
  });

  it('returns null when an entry lacks the required rule/file (fail-closed)', () => {
    expect(readSecretFindings(writeReport([{ RuleID: 'aws-access-key' }]))).toBeNull();
  });
});

describe('runSecretScanGate', () => {
  it('green + exit 0 when the report has zero findings', () => {
    const run = runSecretScanGate({ [REPORT_ENV]: writeReport([]) });
    expect(run.result.signal).toBe('green');
    expect(run.exitCode).toBe(0);
    expect(run.lines.join('\n')).toMatch(/green/i);
  });

  it('red + exit non-zero when a finding is present, naming it', () => {
    const report = writeReport([{ RuleID: 'aws-access-key', File: 'src/config.ts' }]);
    const run = runSecretScanGate({ [REPORT_ENV]: report });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).not.toBe(0);
    expect(run.lines.join('\n')).toContain('src/config.ts');
  });

  it('is fail-closed: red + exit non-zero when the report is missing', () => {
    const run = runSecretScanGate({ [REPORT_ENV]: '/no/such/secret-scan-report.json' });
    expect(run.result.signal).toBe('red');
    expect(run.exitCode).not.toBe(0);
    expect(run.lines.join('\n')).toMatch(/could not be read/i);
  });

  it('respects the SECRET_SCAN_ALLOWLIST at the runner boundary', () => {
    const report = writeReport([{ RuleID: 'fixture', File: 'test/fixtures/planted.txt' }]);
    // The planted fixture trips the gate by default, but stays green once allowlisted.
    expect(runSecretScanGate({ [REPORT_ENV]: report }).result.signal).toBe('red');
    expect(
      runSecretScanGate({
        [REPORT_ENV]: report,
        [ALLOWLIST_ENV]: 'test/fixtures/planted.txt',
      }).result.signal,
    ).toBe('green');
  });
});

describe('secret-scan CI step', () => {
  const workflow = loadCiWorkflow();

  function ciJob(): WorkflowJob {
    const job = workflow.jobs[0];
    expect(job, 'workflow defines at least one job').toBeDefined();
    return job;
  }

  it('runs the secret scan and writes a machine-readable JSON report', () => {
    const { steps } = ciJob();
    const scan = steps.find((s) => /gitleaks/.test(s.run ?? ''));
    expect(scan, 'a step runs the secret scanner').toBeDefined();
    expect(scan?.run).toMatch(/--report-format json/);
    expect(scan?.run).toMatch(/\.json/);
  });

  it('invokes the secret-scan-gate runner', () => {
    const { steps } = ciJob();
    expect(findRunStepIndex(steps, 'secret-scan-gate.js')).toBeGreaterThanOrEqual(0);
  });

  it('places the secret-scan-gate step after the test step', () => {
    const { steps } = ciJob();
    const test = findRunStepIndex(steps, 'pnpm vitest run');
    const gate = findRunStepIndex(steps, 'secret-scan-gate.js');
    expect(test).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(test);
  });

  it('folds its outcome into the combined security signal on the release path', () => {
    // `wire-security-into-release-gate` joins this secret-scan step's outcome (with
    // the audit step's) into the single GATE_SECURITY signal the release gate
    // consumes. Scan the workflow's executable content (comments stripped) so a
    // comment mentioning a security var cannot satisfy — or break — the assertion.
    const executable = readFileSync(ciWorkflowPath(), 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, ''))
      .join('\n');
    expect(executable).toMatch(/GATE_SECURITY/);
    expect(executable).toMatch(/steps\.secret-scan\.outcome/);
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
