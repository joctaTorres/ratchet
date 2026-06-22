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
export const WIRED_GATES = ['lint', 'test'] as const;

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
}

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

  return { decision, exitCode: decision.allowed ? 0 : 1, lines };
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
  process.exit(result.exitCode);
}
