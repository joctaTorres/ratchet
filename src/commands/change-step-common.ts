/**
 * Shared helpers for the headless single-change verbs (`propose`, `apply`,
 * `verify`). Each verb is a thin CLI wrapper that forces exactly one transition
 * on the change-scoped engine core via `runChangeStep` — they share guidance
 * joining, result rendering, a default proof-of-work, and the on-disk
 * precondition guards factored here so the verbs stay near-identical rather than
 * copy-pasted.
 */

import chalk from 'chalk';
import type { ProofOfWork } from '../core/batch/manifest.js';
import type { ChangeStepContext, StepResult } from '../core/batch/engine/index.js';
import { readChangeDiskState } from '../core/batch/engine/transition.js';

/** Options common to every headless single-change verb. */
export interface ChangeStepCommonOptions {
  /** Repeatable `-m, --message` guidance, accumulated into one block. */
  message?: string[];
  /** Standalone settings overrides (flag → project config → default). */
  agent?: string;
  locus?: string;
  image?: string;
  json?: boolean;
}

/**
 * The synthetic single-change proof-of-work. There is no batch manifest, so the
 * verbs frame the step with a default integration proof. `runChangeStep` does
 * not execute proof-of-work (it only spawns the agent), so this is display-only
 * context surfaced in the instructions.
 *
 * The `run`/`pass` strings are deliberately ECOSYSTEM-AGNOSTIC: ratchet runs
 * inside arbitrary user repositories, so a shipped default must name no package
 * manager, test runner, or build tool (see the `generalizable-defaults`
 * standard). There is no project-derived proof-of-work command to source from
 * (project config only carries a proof-of-work *policy*, not a command), so this
 * is a neutral, self-labelled placeholder instructing the agent to use whatever
 * checks the consuming project already defines — never a literal command from
 * ratchet's own toolchain.
 */
export const DEFAULT_PROOF_OF_WORK: ProofOfWork = {
  kind: 'integration',
  run: "this project's own test/check command (use whatever this repository already uses)",
  pass: "this project's own tests and checks report success",
};

/** Join one-or-more `-m` values into a single guidance block (undefined if none). */
export function joinGuidance(messages: string[] | undefined): string | undefined {
  if (!messages || messages.length === 0) return undefined;
  const joined = messages
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .join('\n\n');
  return joined.length > 0 ? joined : undefined;
}

/** Build a synthetic, display-only phase for a standalone single-change verb. */
export function syntheticPhase(
  name: string,
  goal: string,
  success: string
): ChangeStepContext['phase'] {
  return { name, goal, success, proofOfWork: DEFAULT_PROOF_OF_WORK };
}

/**
 * "Change must exist" guard, shared by `apply` and `verify`. Reads on-disk state
 * and throws an actionable error with NO spawn when the change directory is
 * absent. The existence check is never bypassed by `--force` (only the
 * plan/tasks preconditions are).
 */
export function assertChangeExists(projectRoot: string, change: string): void {
  const disk = readChangeDiskState(projectRoot, change);
  if (!disk.exists) {
    throw new Error(
      `Change "${change}" does not exist (.ratchet/changes/${change}/). ` +
        'Run `ratchet propose` to create it first.'
    );
  }
}

/**
 * `apply` precondition: the change must exist (always), and unless `--force` it
 * must have a `plan.md`. A missing plan throws an actionable error hinting at
 * `ratchet propose` / `--force`, with NO spawn.
 */
export function assertApplyPreconditions(
  projectRoot: string,
  change: string,
  force: boolean
): void {
  const disk = readChangeDiskState(projectRoot, change);
  if (!disk.exists) {
    throw new Error(
      `Change "${change}" does not exist (.ratchet/changes/${change}/). ` +
        'Run `ratchet propose` to create it first.'
    );
  }
  if (!force && !disk.hasPlan) {
    throw new Error(
      `Change "${change}" has no plan.md, so there is nothing to apply. ` +
        'Run `ratchet propose` first, or pass --force to apply anyway.'
    );
  }
}

/**
 * `verify` precondition: the change must exist (always), and unless `--force`
 * every `## Tasks` checkbox must be checked (`applied`). Unfinished tasks throw
 * an actionable error hinting at `ratchet apply` / `--force`, with NO spawn.
 */
export function assertVerifyPreconditions(
  projectRoot: string,
  change: string,
  force: boolean
): void {
  const disk = readChangeDiskState(projectRoot, change);
  if (!disk.exists) {
    throw new Error(
      `Change "${change}" does not exist (.ratchet/changes/${change}/). ` +
        'Run `ratchet propose` to create it first.'
    );
  }
  if (!force && !disk.applied) {
    throw new Error(
      `Change "${change}" has unfinished tasks (${disk.tasksComplete}/${disk.tasksTotal} done), ` +
        'so it is not ready to verify. Finish `ratchet apply` first, or pass --force to verify anyway.'
    );
  }
}

/**
 * Render the structured engine result. `runChangeStep` already wrote the outcome
 * journal entry change-locally under `.ratchet/changes/<change>/.run/`, so the
 * command only surfaces the result; a blocked/failed step stays resumable from
 * that journal.
 */
export function renderStepResult(
  change: string,
  result: StepResult,
  json: boolean | undefined,
  labels: { title: string; advanced: string }
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold(`\n${labels.title}: ${change} (${result.transition})`));
  switch (result.state) {
    case 'advanced':
      console.log(chalk.green(`✓ ${labels.advanced} — ${result.message ?? 'step complete'}`));
      break;
    case 'blocked':
      console.log(
        chalk.yellow(`⚠ blocked — ${result.blocker ?? 'needs input'} (resumable)`)
      );
      break;
    case 'awaiting-approval':
      console.log(chalk.cyan(`⏸ awaiting approval — ${result.approvalRequest ?? ''}`));
      break;
    default:
      console.log(chalk.dim(result.message ?? result.state));
  }
}
