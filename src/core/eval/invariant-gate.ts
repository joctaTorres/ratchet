/**
 * Run-level invariant gate.
 *
 * The async seam between the loaded invariant manifest and the pure
 * `invariants` contributor in `aggregate.ts`. It loads the manifest **fail
 * closed**, evaluates **only the `active` invariants** through `evaluateInvariant`
 * (each of which may run a `check.run` / `produce.run` command, hence async), and
 * reduces them to one `{ outcomes, failing, loadError? }` result the synchronous
 * aggregation core consumes — exactly as `diffAgainstBaseline` precomputes
 * `diff.regressions` for the `regression` contributor.
 *
 * Two fail-closed layers keep an empty active set from becoming a vacuous pass:
 *   1. The **manifest load** — a present-but-broken manifest
 *      (`InvariantManifestError`) returns a non-empty `failing` plus a
 *      `loadError`, so the contributor fails rather than passing on nothing.
 *   2. The **per-invariant evaluation** — `evaluateInvariant` already records an
 *      uncheckable active invariant as `unevaluable`, which `isInvariantViolation`
 *      counts as a violation exactly like `fail`.
 *
 * An **absent** manifest is the one path to an empty, passing set (nothing
 * declared). Inert (`active: false`) invariants are never evaluated and never
 * counted — so a manifest of only inert invariants yields zero active invariants
 * and passes, without recording any inert invariant as a passing one.
 */

import path from 'node:path';
import {
  loadInvariantManifest,
  invariantsManifestPath,
  InvariantManifestError,
} from './invariants.js';
import {
  evaluateInvariant,
  isInvariantViolation,
  type InvariantOutcome,
  type FileReader,
} from './invariant-evaluator.js';
import type { EvalRun } from './run.js';
import type { BashRunner, Spawner } from '../batch/engine/index.js';

/** The reduced gate result the `invariants` contributor reads. */
export interface InvariantGateResult {
  /** Per-invariant breakdown for the active invariants that were evaluated. */
  outcomes: InvariantOutcome[];
  /** Ids that violated the gate: every active invariant `isInvariantViolation`
   *  flags (both `fail` and `unevaluable`), or the manifest itself when it could
   *  not be loaded. */
  failing: string[];
  /** Set when the manifest was present but could not be loaded (fail-closed). */
  loadError?: string;
}

/** In-memory inputs the gate is evaluated against; `bash`/`readFile` are injectable. */
export interface InvariantGateInput {
  /** Project root: the manifest location and the cwd for invariant commands. */
  projectRoot: string;
  /** The run being gated. */
  run: EvalRun;
  /** The baseline run a monotonic invariant compares against, or `null`. */
  baseline: EvalRun | null;
  bash?: BashRunner;
  readFile?: FileReader;
  spawner?: Spawner;
  agentName?: string;
}

/**
 * Load the manifest fail-closed and evaluate its active invariants run-level,
 * collecting the ids of every violation into `failing`. Inert invariants are
 * skipped. A present-but-unloadable manifest fails the gate with a `loadError`;
 * an absent manifest yields an empty, passing result.
 */
export async function evaluateInvariantGate(
  input: InvariantGateInput
): Promise<InvariantGateResult> {
  let manifest;
  try {
    manifest = loadInvariantManifest(input.projectRoot);
  } catch (err) {
    if (err instanceof InvariantManifestError) {
      // Fail closed: a present-but-broken manifest must not resolve to an empty
      // (vacuous) pass. Name the manifest as the violating "id".
      return {
        outcomes: [],
        failing: [path.basename(invariantsManifestPath(input.projectRoot))],
        loadError: err.message,
      };
    }
    throw err;
  }

  const active = manifest.invariants.filter((inv) => inv.active === true);
  const outcomes: InvariantOutcome[] = [];
  const failing: string[] = [];
  for (const inv of active) {
    const outcome = await evaluateInvariant(inv, {
      projectRoot: input.projectRoot,
      run: input.run,
      baseline: input.baseline,
      bash: input.bash,
      readFile: input.readFile,
      spawner: input.spawner,
      agentName: input.agentName,
    });
    outcomes.push(outcome);
    if (isInvariantViolation(outcome)) failing.push(outcome.id);
  }
  return { outcomes, failing };
}
