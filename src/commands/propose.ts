/**
 * `ratchet propose "<objective>"`
 *
 * The first headless verb on the change-scoped engine core. It creates exactly
 * one change from a free-text objective with NO batch manifest in sight:
 *   1. Derive the change name from the objective (kebab-case slug) or honour an
 *      explicit `--name`. A blank/unsluggable objective with no `--name` fails
 *      fast with NO spawn.
 *   2. Refuse to clobber an existing change — propose creates, it does not resume
 *      (that is `apply`/`verify` territory).
 *   3. Resolve settings standalone (`flag → project config → default`, no
 *      manifest) and join any `-m` guidance into one block.
 *   4. Build a forced-`propose` `ChangeStepContext` with NO `batch` (run state is
 *      change-local under `.ratchet/changes/<change>/.run/`) and run exactly one
 *      agent via `engine.runChangeStep` — the SAME single-step path batch apply
 *      delegates to.
 *   5. Render the structured result (text or `--json`).
 */

import { existsSync } from 'fs';
import path from 'path';
import { resolveCurrentPlanningHomeSync } from '../core/planning-home.js';
import { RATCHET_DIR_NAME } from '../core/config.js';
import { slugify } from '../core/eval/case-id.js';
import { resolveChangeStepSettings } from '../core/batch/config.js';
import {
  RatchetBatchEngine,
  type ChangeStepContext,
  type EngineDeps,
} from '../core/batch/engine/index.js';
import { readChangeJournalTolerantForLocus } from '../core/batch/engine/run-state.js';
import {
  joinGuidance,
  renderStepResult,
  syntheticPhase,
  type ChangeStepCommonOptions,
} from './change-step-common.js';

export interface ProposeOptions extends ChangeStepCommonOptions {
  /** Explicit change name; short-circuits derivation from the objective. */
  name?: string;
}

/**
 * Derive a change name from a free-text objective: a kebab-case slug, or
 * `undefined` when nothing sluggable remains (blank/punctuation-only) so the
 * caller can fail fast asking for an explicit `--name`.
 */
export function deriveChangeName(objective: string): string | undefined {
  const slug = slugify(objective ?? '');
  return slug.length > 0 ? slug : undefined;
}

export async function proposeCommand(
  objective: string,
  options: ProposeOptions = {},
  deps: EngineDeps = {}
): Promise<void> {
  const projectRoot = deps.projectRoot?.() ?? resolveCurrentPlanningHomeSync().root;

  // 1. Derive or override the change name. A blank/unsluggable objective with no
  // --name fails fast BEFORE any settings resolution or spawn.
  const explicit = options.name?.trim();
  const change = explicit && explicit.length > 0 ? explicit : deriveChangeName(objective);
  if (!change) {
    throw new Error(
      'Could not derive a change name from the objective. Provide a non-empty ' +
        'objective or an explicit --name <change>.'
    );
  }

  // 2. Refuse to clobber an existing change — propose creates, it does not resume.
  const changeDir = path.join(projectRoot, RATCHET_DIR_NAME, 'changes', change);
  if (existsSync(changeDir)) {
    throw new Error(
      `Change "${change}" already exists (${changeDir}). ` +
        'propose creates a NEW change; use apply/verify to advance an existing one, ' +
        'or pass --name <other> to create a different change.'
    );
  }

  // 3. Resolve settings standalone (flag → project config → default). An invalid
  // flag value throws an actionable error here, BEFORE any agent is spawned.
  const settings = resolveChangeStepSettings(projectRoot, {
    agent: options.agent,
    locus: options.locus,
    image: options.image,
  });

  const guidance = joinGuidance(options.message);

  // 4. Build a forced-propose context with NO batch — run state is change-local.
  const context: ChangeStepContext = {
    change,
    changeDone: `The change "${change}" is created with feature files and a plan toward: ${objective.trim()}`,
    transition: 'propose',
    phase: syntheticPhase(
      'propose',
      `Create a single change toward: ${objective.trim()}`,
      'The change directory with feature files and a plan exists.'
    ),
    settings,
    journal: readChangeJournalTolerantForLocus(projectRoot, { change }, change),
    ...(guidance ? { guidance } : {}),
  };

  const engine = new RatchetBatchEngine(deps);
  const result = await engine.runChangeStep(context);

  renderStepResult(change, result, options.json, {
    title: 'Proposed',
    advanced: 'change proposed',
  });
}
