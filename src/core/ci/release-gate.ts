/**
 * Release-gate runner — the workflow's bridge to the release-decision module.
 *
 * The release-decision module is pure: inputs in, decision out. Something has to
 * gather the inputs the workflow actually has — the current branch and the
 * lint/test gate results — and translate the module's verdict into a process
 * exit code the YAML gate step can act on. This runner is that thin, impure
 * bridge and NOTHING more: it reads the branch + wired gate signals from its
 * environment, calls `decideRelease`, prints the outcome (and each denial reason
 * on DENY), and exits `0` on ALLOW / non-zero on DENY.
 *
 * It adds NO new decision logic. The "only when green" rule lives — and is
 * exhaustively unit-tested — in `release-decision.ts`; the runner just adapts the
 * workflow's world to that proven module so the gate is governed by the decision,
 * not by a hand-rolled YAML `if`. Later phases wire more gates by adding signals
 * to `WIRED_GATES` and the environment, never by growing branching here.
 */

import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideRelease,
  type GateSignal,
  type ReleaseDecision,
} from './release-decision.js';

/**
 * The gates this phase wires into the release decision. Each name maps to the
 * environment variable `GATE_<NAME>` (uppercased), whose value is the gate's
 * signal (`green` / `red`). A missing variable yields `undefined`, which the
 * decision module treats as not-green — keeping the runner fail-closed.
 */
export const WIRED_GATES = ['lint', 'test', 'coverage', 'e2e', 'security'] as const;

/**
 * GitHub Actions sets `GITHUB_REF_NAME` to the short branch name (e.g. `main`)
 * for the running build; the runner reads the branch from there.
 */
export const BRANCH_ENV = 'GITHUB_REF_NAME';

/** Outcome of running the gate: the underlying decision plus an exit code. */
export interface ReleaseGateResult {
  decision: ReleaseDecision;
  /** `0` on ALLOW, `1` on DENY — what the workflow gate step acts on. */
  exitCode: number;
  /** Lines to print, describing the outcome and any denial reasons. */
  lines: string[];
  /**
   * The verdict surfaced as a machine-readable signal, mirroring
   * `decision.allowed`. The direct-run path writes this as a
   * `release_allowed=true|false` line to `GITHUB_OUTPUT`, lifting the proven
   * decision into a job-level output a downstream `publish` job can depend on.
   * This adds no new logic — it is exactly `decision.allowed`.
   */
  release_allowed: boolean;
}

/** GitHub Actions step-output mechanism: the file a step appends `key=value` to. */
export const GITHUB_OUTPUT_ENV = 'GITHUB_OUTPUT';

/** Environment variable name carrying the signal for a wired gate. */
function gateEnvVar(gate: string): string {
  return `GATE_${gate.toUpperCase()}`;
}

/**
 * Read the branch and wired gate signals from `env`, consult the release-decision
 * module, and turn its verdict into an exit code plus printable lines. Pure given
 * its `env` argument, so it can be exercised directly in tests without spawning a
 * process or standing up an Actions runner.
 */
export function runReleaseGate(env: NodeJS.ProcessEnv): ReleaseGateResult {
  // Defensive invariant: the release decision is "only when green" over the
  // wired gate set, so an EMPTY set must never reach the decision (the pure
  // module also fail-closes on it). Asserting it here makes a future refactor
  // that drains WIRED_GATES fail loudly rather than silently open the gate. A
  // misconfigured wired set is a programming error, so this throws. (`length` is
  // read through a widened view so the guard survives even if WIRED_GATES is
  // later changed to an empty/dynamic set — today its tuple type is non-empty.)
  const wiredGateCount: number = (WIRED_GATES as readonly string[]).length;
  if (wiredGateCount === 0) {
    throw new Error(
      'release-gate misconfigured: WIRED_GATES is empty — refusing to evaluate a release with no gates.',
    );
  }

  const branch = env[BRANCH_ENV] ?? '';

  const gates: Record<string, GateSignal | undefined> = {};
  for (const gate of WIRED_GATES) {
    // Pass the raw env value straight through: the decision module treats any
    // value other than the literal `green` (including a missing/undefined one)
    // as not-green, which is exactly the fail-closed posture we want.
    gates[gate] = env[gateEnvVar(gate)] as GateSignal | undefined;
  }

  const decision = decideRelease({ branch, gates });

  const lines: string[] = [];
  if (decision.allowed) {
    lines.push(`${decision.outcome}: release permitted — branch is "${branch}" and every wired gate is green.`);
  } else {
    lines.push(`${decision.outcome}: release blocked — the publish path will not run.`);
    for (const reason of decision.reasons) {
      lines.push(`  - ${reason}`);
    }
  }

  return {
    decision,
    exitCode: decision.allowed ? 0 : 1,
    lines,
    release_allowed: decision.allowed,
  };
}

/**
 * Append the `release_allowed` verdict to the file named by `GITHUB_OUTPUT`
 * (GitHub Actions' step-output mechanism), exposing it as a step output the `ci`
 * job can lift into a job-level signal. A no-op when `GITHUB_OUTPUT` is unset
 * (e.g. local runs), so the pure decision path stays mechanism-free — only this
 * impure helper, called solely from the direct-run path, touches the file.
 * Exported so tests can drive it against a scratch `GITHUB_OUTPUT` without
 * spawning a process or standing up an Actions runner.
 */
export function writeReleaseAllowedOutput(env: NodeJS.ProcessEnv, releaseAllowed: boolean): void {
  const outputFile = env[GITHUB_OUTPUT_ENV];
  if (!outputFile) return;
  appendFileSync(outputFile, `release_allowed=${releaseAllowed}\n`);
}

/** True when this module is the process entrypoint (`node release-gate.js`). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

// When invoked directly by the workflow's release-gate step, decide and exit.
// Importing the module (e.g. from tests) does not trigger this.
if (isDirectRun()) {
  const result = runReleaseGate(process.env);
  for (const line of result.lines) {
    console.log(line);
  }
  // Surface the verdict as a job-consumable step output, then exit. The exit
  // code is unchanged; this only adds the machine-readable `release_allowed`.
  writeReleaseAllowedOutput(process.env, result.release_allowed);
  process.exit(result.exitCode);
}
