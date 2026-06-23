/**
 * Dependency-audit gate — the pure "no vulnerability at/above the threshold"
 * evaluator plus its thin runner, mirroring the phase-1 release-decision /
 * release-gate split and the sibling coverage/e2e gate slices.
 *
 * The risky, must-be-correct part is a single question: "does the dependency
 * tree contain a vulnerability at or above the configured severity, fail-closed
 * on the unknown?". That is isolated as the pure `evaluateDependencyAudit` so
 * every branch is unit-testable without running a real audit.
 * `runDependencyAuditGate` is the impure glue: it reads the audit report path +
 * fail-on severity from the environment, parses the per-severity counts, calls
 * the evaluator, prints the verdict, and turns it into a process exit code the
 * CI audit step acts on — adding NO decision logic of its own.
 *
 * Integration contract: `evaluateDependencyAudit` returns
 * `signal: 'green' | 'red'` — exactly the `GateSignal` shape the
 * release-decision spine keys its gates by. This slice only PRODUCES that signal
 * and enforces the threshold in CI; the `wire-security-into-release-gate` change
 * feeds it into `decideRelease` unchanged. Pinning the shape here makes that
 * wiring a small addition.
 *
 * Fail-closed: a missing, unreadable, or malformed report yields `null` from the
 * reader, which the evaluator treats as `red` — an audit that never ran (or
 * crashed before writing its report) must never read as green.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GateSignal } from './release-decision.js';

/**
 * Severity levels in ascending order. The index defines the ordering
 * (`info < low < moderate < high < critical`) the threshold comparison uses —
 * a vulnerability fails the gate when its severity index is at or above the
 * configured `failOn`'s index.
 */
export const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'] as const;

/** One of the recognized severity levels. */
export type Severity = (typeof SEVERITY_ORDER)[number];

/** Per-severity vulnerability counts, the shape `audit --json` reports. */
export type SeverityCounts = Record<Severity, number>;

/**
 * Default minimum severity to fail the gate on: `high` and above — the
 * conventional release-blocking bar. Low/moderate advisories (often unfixable
 * transitive noise) do not turn a green tree red, but a high/critical
 * vulnerability — the kind a release must not ship — trips the gate. Overridable
 * via `AUDIT_FAIL_ON` so the bar is data, not a literal baked into the call site.
 */
export const DEFAULT_AUDIT_FAIL_ON: Severity = 'high';

/** Environment variable that overrides {@link DEFAULT_AUDIT_FAIL_ON}. */
export const FAIL_ON_ENV = 'AUDIT_FAIL_ON';

/**
 * Environment variable pointing at the package manager's machine-readable audit
 * report (`pnpm audit --json` / `npm audit --json` output). Defaults to the
 * conventional location the CI audit step writes.
 */
export const REPORT_ENV = 'AUDIT_REPORT';

/** Conventional path of the dependency-audit JSON report. */
export const DEFAULT_REPORT_PATH = 'audit/audit-report.json';

export interface DependencyAuditInput {
  /**
   * The parsed per-severity vulnerability counts, or `null` when the report
   * could not be read. `null` is treated as fail-closed `red`.
   */
  counts: SeverityCounts | null;
  /** Minimum severity to fail the gate on (this severity and above). */
  failOn: Severity;
}

export interface DependencyAuditResult {
  /** Exactly the release-decision `GateSignal` shape, so the spine consumes it. */
  signal: GateSignal;
  /** The counts echoed back, or `null` when the report was unreadable. */
  counts: SeverityCounts | null;
  /** The threshold the counts were judged against. */
  failOn: Severity;
  /** Severities at or above `failOn` that have a non-zero count; ordered low→high. */
  offending: Severity[];
  /** One reason per failing condition; empty when `green`. */
  reasons: string[];
}

/** True when `severity` is at or above `failOn` in {@link SEVERITY_ORDER}. */
function atOrAbove(severity: Severity, failOn: Severity): boolean {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(failOn);
}

/**
 * Decide a dependency-audit gate signal. `green` iff `counts` is non-null AND
 * zero vulnerabilities exist at any severity at or above `failOn`; otherwise
 * `red` with a precise reason — either naming each offending severity and its
 * count, or that the audit report could not be read (fail-closed). Pure: no I/O,
 * fully branch-testable.
 */
export function evaluateDependencyAudit(input: DependencyAuditInput): DependencyAuditResult {
  const { counts, failOn } = input;

  if (counts === null) {
    return {
      signal: 'red',
      counts: null,
      failOn,
      offending: [],
      reasons: ['audit report could not be read (missing or malformed)'],
    };
  }

  const offending: Severity[] = [];
  const reasons: string[] = [];
  for (const severity of SEVERITY_ORDER) {
    const count = counts[severity] ?? 0;
    if (count > 0 && atOrAbove(severity, failOn)) {
      offending.push(severity);
      reasons.push(
        `${count} ${severity} vulnerabilit${count === 1 ? 'y' : 'ies'} at or above the "${failOn}" threshold`,
      );
    }
  }

  const signal: GateSignal = reasons.length === 0 ? 'green' : 'red';
  return { signal, counts, failOn, offending, reasons };
}

/** Type guard: is `value` one of the recognized severity levels? */
export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITY_ORDER as readonly string[]).includes(value);
}

/**
 * Resolve the fail-on severity from `env`: the `AUDIT_FAIL_ON` override when it
 * is a recognized severity, else {@link DEFAULT_AUDIT_FAIL_ON}.
 */
export function resolveFailOn(env: NodeJS.ProcessEnv): Severity {
  const raw = env[FAIL_ON_ENV];
  if (raw !== undefined) {
    const normalized = raw.trim().toLowerCase();
    if (isSeverity(normalized)) return normalized;
  }
  return DEFAULT_AUDIT_FAIL_ON;
}

/**
 * Read the per-severity vulnerability counts from the audit JSON at
 * `reportPath` (`metadata.vulnerabilities`, the block `pnpm audit --json` /
 * `npm audit --json` writes). Returns `null` — which the evaluator treats as
 * fail-closed `red` — when the file is missing, unreadable, malformed, or lacks
 * the expected per-severity numbers. Never throws. Unknown extra keys (e.g.
 * `total`) are ignored; any recognized severity that is absent counts as 0.
 */
export function readAuditCounts(reportPath: string): SeverityCounts | null {
  let raw: string;
  try {
    raw = readFileSync(reportPath, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const vulns = (parsed as { metadata?: { vulnerabilities?: unknown } }).metadata?.vulnerabilities;
  if (typeof vulns !== 'object' || vulns === null) return null;

  const source = vulns as Record<string, unknown>;
  const counts: SeverityCounts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const severity of SEVERITY_ORDER) {
    const value = source[severity];
    // A missing severity defaults to 0; a present-but-non-numeric value is
    // malformed, so fail closed.
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    counts[severity] = value;
  }

  return counts;
}

/** Outcome of running the dependency-audit gate: the evaluation plus an exit code. */
export interface DependencyAuditRunResult {
  result: DependencyAuditResult;
  /** `0` on `green`, `1` on `red` — what the CI audit step acts on. */
  exitCode: number;
  /** Lines to print, describing the outcome and any reasons. */
  lines: string[];
}

/**
 * Resolve the report path + fail-on severity from `env`, read the counts,
 * consult the pure evaluator, and turn its verdict into an exit code plus
 * printable lines. Pure given its `env` argument (only the file read touches the
 * outside world), so it can be exercised directly in tests with a fixture report
 * — no Actions runner needed. Adds NO decision logic.
 */
export function runDependencyAuditGate(env: NodeJS.ProcessEnv): DependencyAuditRunResult {
  const reportPath = env[REPORT_ENV] || DEFAULT_REPORT_PATH;
  const failOn = resolveFailOn(env);
  const counts = readAuditCounts(reportPath);

  const result = evaluateDependencyAudit({ counts, failOn });

  const lines: string[] = [];
  if (result.signal === 'green') {
    lines.push(
      `green: dependency-audit gate passed — no vulnerabilities at or above "${failOn}".`,
    );
  } else {
    lines.push('red: dependency-audit gate failed — the release gate will treat this as not-green.');
    for (const reason of result.reasons) {
      lines.push(`  - ${reason}`);
    }
  }

  return { result, exitCode: result.signal === 'green' ? 0 : 1, lines };
}

/** True when this module is the process entrypoint (`node dependency-audit-gate.js`). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

// When invoked directly by the workflow's audit step, evaluate and exit.
// Importing the module (e.g. from tests) does not trigger this.
if (isDirectRun()) {
  const run = runDependencyAuditGate(process.env);
  for (const line of run.lines) {
    console.log(line);
  }
  process.exit(run.exitCode);
}
