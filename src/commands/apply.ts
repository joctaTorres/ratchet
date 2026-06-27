/**
 * `ratchet apply <change>`
 *
 * The second headless verb on the change-scoped engine core, a near-mirror of
 * `propose` for the *implement* step of the loop. It advances exactly ONE
 * existing change with NO batch manifest in sight:
 *   1. Enforce preconditions on-disk: the change must exist (always), and unless
 *      `--force` it must have a `plan.md`. A failed precondition throws an
 *      actionable error with NO spawn.
 *   2. Resolve settings standalone (`flag → project config → default`, no
 *      manifest) and join any `-m` guidance into one block.
 *   3. Build a forced-`apply` `ChangeStepContext` with NO `batch` (run state is
 *      change-local under `.ratchet/changes/<change>/.run/`) and run exactly one
 *      agent via `engine.runChangeStep`. `computeNextTransition` is NEVER
 *      consulted — the verb name IS the transition.
 *   4. Render the structured result (text or `--json`).
 */

import { resolveCurrentPlanningHomeSync } from '../core/planning-home.js';
import { resolveChangeStepSettings } from '../core/batch/config.js';
import { RatchetBatchEngine, type EngineDeps } from '../core/batch/engine/index.js';
import {
  assertApplyPreconditions,
  buildChangeStepContext,
  joinGuidance,
  renderStepResult,
  type ChangeStepCommonOptions,
} from './change-step-common.js';

export interface ApplyOptions extends ChangeStepCommonOptions {
  /** Bypass the missing-plan precondition (the existence check still holds). */
  force?: boolean;
}

export async function applyCommand(
  change: string,
  options: ApplyOptions = {},
  deps: EngineDeps = {}
): Promise<void> {
  const projectRoot = deps.projectRoot?.() ?? resolveCurrentPlanningHomeSync().root;

  // 1. Enforce preconditions BEFORE any settings resolution or spawn.
  assertApplyPreconditions(projectRoot, change, options.force ?? false);

  // 2. Resolve settings standalone (flag → project config → default). An invalid
  // flag value throws an actionable error here, BEFORE any agent is spawned.
  const settings = resolveChangeStepSettings(projectRoot, {
    agent: options.agent,
    locus: options.locus,
    image: options.image,
  });

  const guidance = joinGuidance(options.message);

  // 3. Build a forced-apply context with NO batch — run state is change-local.
  const context = buildChangeStepContext({
    projectRoot,
    change,
    transition: 'apply',
    changeDone: `The change "${change}" has all its planned tasks implemented and checked off.`,
    goal: `Implement the planned tasks for change "${change}".`,
    success: 'Every "## Tasks" checkbox in the plan is checked off.',
    settings,
    guidance,
  });

  const engine = new RatchetBatchEngine(deps);
  const result = await engine.runChangeStep(context);

  renderStepResult(change, result, options.json, {
    title: 'Applied',
    advanced: 'change advanced through apply',
  });
}
