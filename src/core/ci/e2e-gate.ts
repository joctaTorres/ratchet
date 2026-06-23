/**
 * E2e gate — the pure "did the built CLI smoke pass?" evaluator plus its thin
 * runner, mirroring the phase-1 release-decision / release-gate split and the
 * sibling coverage-gate slice.
 *
 * The risky, must-be-correct part is a single question: "did every e2e check
 * pass, fail-closed on the unknown?". That is isolated as the pure
 * `evaluateE2e` so every branch is unit-testable without running the smoke.
 * `runE2eGate` is the impure glue: it reads the smoke's result file path from
 * the environment, parses it, calls the evaluator, prints the verdict, and turns
 * it into a process exit code the CI e2e step acts on — adding NO decision logic
 * of its own.
 *
 * Integration contract: `evaluateE2e` returns `signal: 'green' | 'red'` —
 * exactly the `GateSignal` shape the release-decision spine keys its gates by.
 * This slice only PRODUCES that signal and runs the smoke in CI; the
 * `wire-coverage-e2e-into-release-gate` change feeds `GATE_E2E` into
 * `decideRelease` unchanged. Pinning the shape here makes that wiring a one-line
 * addition.
 *
 * Fail-closed: a missing, unreadable, or malformed result yields `null` from the
 * reader, which the evaluator treats as `red` — a smoke that never ran (or
 * crashed before writing its result) must never read as green.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GateSignal } from './release-decision.js';

/**
 * Environment variable pointing at the smoke's machine-readable result file.
 * Defaults to the conventional location `cli-smoke.sh` writes.
 */
export const RESULT_ENV = 'E2E_RESULT';

/** Conventional path of the e2e smoke's result file. */
export const DEFAULT_RESULT_PATH = 'test/e2e/.results/cli-smoke.json';

/** A single e2e check the smoke ran, with its pass/fail outcome. */
export interface E2eCheck {
  name: string;
  passed: boolean;
}

/**
 * The parsed smoke result: each check's outcome plus an overall `ok`. This is
 * the exact shape `cli-smoke.sh` writes.
 */
export interface E2eResult {
  ok: boolean;
  checks: E2eCheck[];
}

export interface E2eGateResult {
  /** Exactly the release-decision `GateSignal` shape, so the spine consumes it. */
  signal: GateSignal;
  /**
   * The overall `ok` echoed back, or `null` when the result could not be read
   * (fail-closed). `null` always maps to `red`.
   */
  ok: boolean | null;
  /** Names of the checks that failed; empty when `green` or when unreadable. */
  failures: string[];
  /** One reason per failing condition; empty when `green`. */
  reasons: string[];
}

/**
 * Decide an e2e gate signal. `green` iff the result parsed (non-null) AND its
 * `ok` is true AND no check failed; otherwise `red` with a precise reason —
 * naming each failing check, that the run did not complete (`ok` not true with
 * no failed check recorded, e.g. a crash mid-run), or that the result could not
 * be read. Pure: no I/O, fully branch-testable.
 */
export function evaluateE2e(input: E2eResult | null): E2eGateResult {
  const failures: string[] = [];
  const reasons: string[] = [];

  if (input === null) {
    reasons.push('e2e result could not be read (missing or malformed)');
    return { signal: 'red', ok: null, failures, reasons };
  }

  for (const check of input.checks) {
    if (!check.passed) {
      failures.push(check.name);
      reasons.push(`e2e check "${check.name}" failed`);
    }
  }

  // `ok` is the run's own self-report. If it is not true but no specific check
  // was recorded as failing (e.g. the smoke crashed before completing its
  // checks), still deny with a clear reason rather than reading as green.
  if (input.ok !== true && failures.length === 0) {
    reasons.push('e2e run did not complete successfully (ok is not true)');
  }

  const signal: GateSignal = reasons.length === 0 ? 'green' : 'red';
  return { signal, ok: input.ok, failures, reasons };
}

/**
 * Read and parse the smoke's JSON result at `resultPath`. Returns `null` — which
 * the evaluator treats as fail-closed `red` — when the file is missing,
 * unreadable, malformed, or does not match the expected `{ ok, checks[] }`
 * shape. Never throws.
 */
export function readE2eResult(resultPath: string): E2eResult | null {
  let raw: string;
  try {
    raw = readFileSync(resultPath, 'utf8');
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
  const obj = parsed as { ok?: unknown; checks?: unknown };
  if (typeof obj.ok !== 'boolean') return null;
  if (!Array.isArray(obj.checks)) return null;

  const checks: E2eCheck[] = [];
  for (const entry of obj.checks) {
    if (typeof entry !== 'object' || entry === null) return null;
    const check = entry as { name?: unknown; passed?: unknown };
    if (typeof check.name !== 'string' || typeof check.passed !== 'boolean') return null;
    checks.push({ name: check.name, passed: check.passed });
  }

  return { ok: obj.ok, checks };
}

/** Outcome of running the e2e gate: the evaluation plus an exit code. */
export interface E2eGateRunResult {
  result: E2eGateResult;
  /** `0` on `green`, `1` on `red` — what the CI e2e step acts on. */
  exitCode: number;
  /** Lines to print, describing the outcome and any reasons. */
  lines: string[];
}

/**
 * Resolve the result path from `env`, read + parse it, consult the pure
 * evaluator, and turn its verdict into an exit code plus printable lines. Pure
 * given its `env` argument (only the file read touches the outside world), so it
 * can be exercised directly in tests with a fixture result — no Actions runner
 * needed. Adds NO decision logic.
 */
export function runE2eGate(env: NodeJS.ProcessEnv): E2eGateRunResult {
  const resultPath = env[RESULT_ENV] || DEFAULT_RESULT_PATH;
  const parsed = readE2eResult(resultPath);
  const result = evaluateE2e(parsed);

  const lines: string[] = [];
  if (result.signal === 'green') {
    lines.push('green: e2e gate passed — the built CLI smoke ran clean end to end.');
  } else {
    lines.push('red: e2e gate failed — the release gate will treat this as not-green.');
    for (const reason of result.reasons) {
      lines.push(`  - ${reason}`);
    }
  }

  return { result, exitCode: result.signal === 'green' ? 0 : 1, lines };
}

/** True when this module is the process entrypoint (`node e2e-gate.js`). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

// When invoked directly by the workflow's e2e step, evaluate and exit.
// Importing the module (e.g. from tests) does not trigger this.
if (isDirectRun()) {
  const run = runE2eGate(process.env);
  for (const line of run.lines) {
    console.log(line);
  }
  process.exit(run.exitCode);
}
