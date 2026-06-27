/**
 * `ratchet verify <change>`
 *
 * The third headless verb on the change-scoped engine core, completing the
 * `propose → apply → verify` loop. A near-mirror of `apply` for the *check*
 * step: it verifies exactly ONE existing change with NO batch manifest:
 *   1. Enforce preconditions on-disk: the change must exist (always), and unless
 *      `--force` every `## Tasks` checkbox must be checked (`applied`). A failed
 *      precondition throws an actionable error with NO spawn.
 *   2. Resolve settings standalone (`flag → project config → default`, no
 *      manifest) and join any `-m` guidance into one block.
 *   3. Build a forced-`verify` `ChangeStepContext` with NO `batch` (run state is
 *      change-local under `.ratchet/changes/<change>/.run/`) and run exactly one
 *      agent via `engine.runChangeStep`. `computeNextTransition` is NEVER
 *      consulted — the verb name IS the transition.
 *   4. Render the structured result (text or `--json`).
 */

import { resolveCurrentPlanningHomeSync } from '../core/planning-home.js';
import { resolveChangeStepSettings } from '../core/batch/config.js';
import {
  RatchetBatchEngine,
  type ChangeStepContext,
  type EngineDeps,
} from '../core/batch/engine/index.js';
import { readChangeJournalTolerantForLocus } from '../core/batch/engine/run-state.js';
import {
  assertVerifyPreconditions,
  joinGuidance,
  renderStepResult,
  syntheticPhase,
  type ChangeStepCommonOptions,
} from './change-step-common.js';

export interface VerifyOptions extends ChangeStepCommonOptions {
  /** Bypass the unfinished-tasks precondition (the existence check still holds). */
  force?: boolean;
}

export async function verifyCommand(
  change: string,
  options: VerifyOptions = {},
  deps: EngineDeps = {}
): Promise<void> {
  const projectRoot = deps.projectRoot?.() ?? resolveCurrentPlanningHomeSync().root;

  // 1. Enforce preconditions BEFORE any settings resolution or spawn.
  assertVerifyPreconditions(projectRoot, change, options.force ?? false);

  // 2. Resolve settings standalone (flag → project config → default). An invalid
  // flag value throws an actionable error here, BEFORE any agent is spawned.
  const settings = resolveChangeStepSettings(projectRoot, {
    agent: options.agent,
    locus: options.locus,
    image: options.image,
  });

  const guidance = joinGuidance(options.message);

  // 3. Build a forced-verify context with NO batch — run state is change-local.
  const context: ChangeStepContext = {
    change,
    changeDone: `The change "${change}" is verified against its feature scenarios.`,
    transition: 'verify',
    phase: syntheticPhase(
      'verify',
      `Verify change "${change}" against its feature scenarios.`,
      'The implementation satisfies every feature scenario.'
    ),
    settings,
    journal: readChangeJournalTolerantForLocus(projectRoot, { change }, change),
    ...(guidance ? { guidance } : {}),
  };

  const engine = new RatchetBatchEngine(deps);
  const result = await engine.runChangeStep(context);

  renderStepResult(change, result, options.json, {
    title: 'Verified',
    advanced: 'change verified',
  });
}
