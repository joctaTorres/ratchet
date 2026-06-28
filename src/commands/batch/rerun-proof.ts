/**
 * `ratchet batch rerun-proof [name] --phase <phase> [--json]`
 *
 * The supported operator override for a recorded boundary proof-of-work verdict.
 * Once a phase's boundary proof runs, its verdict is journaled durably and the
 * gate never re-runs the proof — so a verdict recorded FAILED for a fixable
 * reason (a misconfigured `pass` condition, a flaky run, an env fix) permanently
 * blocks the next phase. This verb appends a superseding
 * `proof-of-work-invalidated` marker to the append-only run journal so the next
 * `batch apply` re-runs the phase's own configured boundary proof-of-work.
 *
 * The journal is never edited: the original `proof-of-work` record stays in place
 * (audit trail preserved) and the single record fold (`proofRecordsFromEntries`)
 * drops the phase from the current map, so both the phase gate
 * (`computeBatchStatus`) and boundary-step selection (`pickNextStep`) re-open by
 * construction. The marker carries only the phase name — no toolchain detail; the
 * re-run executes the phase's own `proofOfWork.run`.
 *
 * Mirrors `batch report`: optional `[name]` resolved via `resolveBatchName`, a
 * required key flag (`--phase`, like report's `--change`), and `--json`.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest } from '../../core/batch/manifest.js';
import {
  readProofOfWorkByPhase,
  recordProofOfWorkInvalidation,
} from '../../core/batch/journal.js';
import { resolveBatchName } from './shared.js';

export interface BatchRerunProofOptions {
  /** Required: the phase whose recorded proof-of-work to invalidate. */
  phase?: string;
  json?: boolean;
}

/**
 * Test/embedding seam. Production callers pass nothing: the project root is
 * resolved from the planning home. Tests override `projectRoot`.
 */
export interface BatchRerunProofDeps {
  projectRoot?: string;
}

interface RerunProofResult {
  batch: string;
  phase: string;
  /** True when a recorded proof was present and an invalidation marker appended. */
  invalidated: boolean;
}

export async function batchRerunProofCommand(
  name: string | undefined,
  options: BatchRerunProofOptions,
  deps: BatchRerunProofDeps = {}
): Promise<void> {
  const projectRoot = deps.projectRoot ?? resolveCurrentPlanningHomeSync().root;
  const batch = resolveBatchName(projectRoot, name);

  const phase = options.phase;
  if (!phase) {
    throw new Error(
      "Missing required --phase <phase>. Name the phase whose recorded proof-of-work to invalidate."
    );
  }

  // Validate the phase exists in the manifest before touching the journal.
  const manifest = loadBatchManifest(projectRoot, batch);
  if (!manifest.phases.some((p) => p.name === phase)) {
    const known = manifest.phases.map((p) => p.name).join(', ') || '(none)';
    throw new Error(
      `'${phase}' is not a phase of batch '${batch}'. Known phases: ${known}.`
    );
  }

  // No-op when there is no recorded verdict to supersede: nothing is appended.
  const hasRecord = readProofOfWorkByPhase(projectRoot, batch).has(phase);
  if (hasRecord) {
    recordProofOfWorkInvalidation(projectRoot, batch, phase);
  }

  const result: RerunProofResult = { batch, phase, invalidated: hasRecord };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (hasRecord) {
    console.log(
      chalk.green(
        `Invalidated the recorded proof-of-work for '${phase}' in batch '${batch}'. ` +
          `The next 'ratchet batch apply ${batch}' re-runs its boundary proof-of-work.`
      )
    );
  } else {
    console.log(
      chalk.dim(
        `No recorded proof-of-work for '${phase}' in batch '${batch}' to invalidate. ` +
          `The run journal is unchanged.`
      )
    );
  }
}
