/**
 * Coverage gate — the pure "coverage >= threshold" evaluator plus its thin
 * runner, mirroring the phase-1 release-decision / release-gate split.
 *
 * The risky, must-be-correct part is a single question: "is the measured
 * coverage total at least the enforced minimum, fail-closed on the unknown?".
 * That is isolated as the pure `evaluateCoverage` so every branch is
 * unit-testable without a coverage run. `runCoverageGate` is the impure glue:
 * it reads the summary file + threshold from the environment, calls the
 * evaluator, prints the verdict, and turns it into a process exit code the CI
 * coverage step acts on — adding NO decision logic of its own.
 *
 * Integration contract: `evaluateCoverage` returns `signal: 'green' | 'red'` —
 * exactly the `GateSignal` shape the release-decision spine keys its gates by.
 * This slice only PRODUCES that signal and enforces the threshold in CI; the
 * `wire-coverage-e2e-into-release-gate` change feeds `GATE_COVERAGE` into
 * `decideRelease` unchanged. Pinning the shape here makes that wiring a one-line
 * addition.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GateSignal } from './release-decision.js';

/**
 * Default minimum line-coverage percentage a build must meet to stay green.
 * Anchored just below the currently measured total (68.67% as of this change)
 * so a green tree stays green and a real regression trips the gate; a threshold
 * above current coverage would turn CI red on the very push that introduces the
 * gate. Overridable via `COVERAGE_THRESHOLD` so the value is data, not a literal
 * baked into the call site.
 *
 * TRACKING NOTE: this floor leaves only ~0.67pp of headroom over the measured
 * 68.67% line coverage, so a real regression and a small measurement wobble can
 * both trip it — ratchet this up as coverage improves. Also, only LINE coverage
 * is gated here (`total.lines.pct`); BRANCH coverage is intentionally not gated
 * yet, so logic can be added with branches untested while line% holds. Adding a
 * branch floor is a deliberate future change, not a silent one.
 */
export const DEFAULT_COVERAGE_THRESHOLD = 68;

/** Environment variable that overrides {@link DEFAULT_COVERAGE_THRESHOLD}. */
export const THRESHOLD_ENV = 'COVERAGE_THRESHOLD';

/**
 * Environment variable pointing at the v8 `json-summary` file. Defaults to the
 * conventional location vitest writes when run with `--coverage`.
 */
export const SUMMARY_ENV = 'COVERAGE_SUMMARY';

/** Conventional path of the v8 `json-summary` reporter output. */
export const DEFAULT_SUMMARY_PATH = 'coverage/coverage-summary.json';

export interface CoverageGateInput {
  /**
   * The measured total coverage percentage (0–100), or `null` when the summary
   * could not be read. `null` (and any non-finite number) is treated as `red`.
   */
  coverage: number | null;
  /** Minimum coverage percentage required for `green`. */
  threshold: number;
}

export interface CoverageGateResult {
  /** Exactly the release-decision `GateSignal` shape, so the spine consumes it. */
  signal: GateSignal;
  /** The measured coverage echoed back (or `null` when unreadable). */
  coverage: number | null;
  /** The threshold the coverage was judged against. */
  threshold: number;
  /** One reason per failing condition; empty when `green`. */
  reasons: string[];
}

/**
 * Decide a coverage gate signal. `green` iff `coverage` is a real (finite)
 * number AND `coverage >= threshold`; otherwise `red` with a precise reason —
 * either the shortfall (coverage vs threshold) or that the summary could not be
 * read (missing/NaN total). Pure: no I/O, fully branch-testable.
 */
export function evaluateCoverage(input: CoverageGateInput): CoverageGateResult {
  const { coverage, threshold } = input;
  const reasons: string[] = [];

  if (coverage === null || !Number.isFinite(coverage)) {
    reasons.push('coverage summary could not be read (missing or malformed total)');
  } else if (coverage < threshold) {
    reasons.push(`coverage ${coverage}% is below the required threshold of ${threshold}%`);
  }

  const signal: GateSignal = reasons.length === 0 ? 'green' : 'red';
  return { signal, coverage, threshold, reasons };
}

/**
 * Resolve the enforced threshold from `env`: the `COVERAGE_THRESHOLD` override
 * when it parses to a finite number, else {@link DEFAULT_COVERAGE_THRESHOLD}.
 */
export function resolveThreshold(env: NodeJS.ProcessEnv): number {
  const raw = env[THRESHOLD_ENV];
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return DEFAULT_COVERAGE_THRESHOLD;
}

/**
 * Read the total coverage percentage from the v8 `json-summary` file at
 * `summaryPath` (`total.lines.pct`). Returns `null` — which the evaluator
 * treats as fail-closed `red` — when the file is missing, unreadable, malformed,
 * or lacks a numeric total. Never throws.
 */
export function readCoverageTotal(summaryPath: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(summaryPath, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const pct = (parsed as { total?: { lines?: { pct?: unknown } } })?.total?.lines?.pct;
  return typeof pct === 'number' && Number.isFinite(pct) ? pct : null;
}

/** Outcome of running the coverage gate: the evaluation plus an exit code. */
export interface CoverageGateRunResult {
  result: CoverageGateResult;
  /** `0` on `green`, `1` on `red` — what the CI coverage step acts on. */
  exitCode: number;
  /** Lines to print, describing the outcome and any reasons. */
  lines: string[];
}

/**
 * Read the summary path + threshold from `env`, read the measured total, consult
 * the pure evaluator, and turn its verdict into an exit code plus printable
 * lines. Pure given its `env` argument (only the file read touches the outside
 * world), so it can be exercised directly in tests with a fixture summary — no
 * Actions runner needed. Adds NO decision logic.
 */
export function runCoverageGate(env: NodeJS.ProcessEnv): CoverageGateRunResult {
  const summaryPath = env[SUMMARY_ENV] || DEFAULT_SUMMARY_PATH;
  const threshold = resolveThreshold(env);
  const coverage = readCoverageTotal(summaryPath);

  const result = evaluateCoverage({ coverage, threshold });

  const lines: string[] = [];
  if (result.signal === 'green') {
    lines.push(
      `green: coverage gate passed — ${coverage}% >= threshold ${threshold}%.`,
    );
  } else {
    lines.push('red: coverage gate failed — the release gate will treat this as not-green.');
    for (const reason of result.reasons) {
      lines.push(`  - ${reason}`);
    }
  }

  return { result, exitCode: result.signal === 'green' ? 0 : 1, lines };
}

/** True when this module is the process entrypoint (`node coverage-gate.js`). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

// When invoked directly by the workflow's coverage step, evaluate and exit.
// Importing the module (e.g. from tests) does not trigger this.
if (isDirectRun()) {
  const run = runCoverageGate(process.env);
  for (const line of run.lines) {
    console.log(line);
  }
  process.exit(run.exitCode);
}
