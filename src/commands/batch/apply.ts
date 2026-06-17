/**
 * `ratchet batch apply [name]`
 *
 * Single step: pick the next ready DAG step, hand it to the bundled engine for
 * exactly one transition (propose -> apply -> verify), persist the result,
 * render a rich view, and return. No internal loop. The engine ships inside this
 * package, so apply runs it in-process with no separate install or activation.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest, type Phase } from '../../core/batch/manifest.js';
import { computeBatchStatus } from '../../core/batch/status.js';
import { resolveBatchSettings } from '../../core/batch/config.js';
import {
  RatchetBatchEngine,
  computeNextTransition,
  type ResolvedStepContext,
  type StepResult,
} from '../../core/batch/engine/index.js';
import {
  getParkedStep,
  readJournalForChange,
  parkStep,
  clearParkedStep,
  type ParkedStep,
} from '../../core/batch/journal.js';
import { resolveBatchName } from './shared.js';

export interface BatchApplyOptions {
  json?: boolean;
}

/**
 * If a parked step is unresolved, emit the "did not advance" notice and return
 * true (the step must not advance). Lets the engine own transition derivation;
 * the CLI only blocks on un-actioned halts before building context.
 */
function precheckPark(
  parked: ParkedStep | undefined,
  change: string,
  options: BatchApplyOptions
): boolean {
  if (parked && parked.kind === 'blocked' && !parked.answer) {
    notAdvanced(
      change,
      `blocked: ${parked.reason}`,
      options,
      'record an answer with `ratchet batch report --change ' + change + ' --answer "..."`'
    );
    return true;
  }
  if (parked && parked.kind === 'awaiting-approval' && !parked.approved && !parked.feedback) {
    notAdvanced(
      change,
      `awaiting approval: ${parked.reason}`,
      options,
      'approve or reject from the batch view'
    );
    return true;
  }
  return false;
}

/** Persist parked / cleared state based on the engine's structured result. */
function persistStepOutcome(
  projectRoot: string,
  batch: string,
  change: string,
  result: StepResult
): void {
  if (result.state === 'blocked') {
    parkStep(projectRoot, batch, {
      change,
      kind: 'blocked',
      reason: result.blocker ?? 'blocked',
    });
  } else if (result.state === 'awaiting-approval') {
    parkStep(projectRoot, batch, {
      change,
      kind: 'awaiting-approval',
      reason: result.approvalRequest ?? 'awaiting approval',
    });
  } else if (result.state === 'advanced') {
    clearParkedStep(projectRoot, batch, change);
  }
}

export async function batchApplyCommand(
  name: string | undefined,
  options: BatchApplyOptions = {}
): Promise<void> {
  const projectRoot = resolveCurrentPlanningHomeSync().root;
  const batch = resolveBatchName(projectRoot, name);
  const manifest = loadBatchManifest(projectRoot, batch);
  const { settings } = resolveBatchSettings(projectRoot, manifest);
  const status = await computeBatchStatus(projectRoot, manifest);

  // The engine is bundled into this package; construct it and run in-process.
  const engine = new RatchetBatchEngine();

  // Find the next ready, ungated step.
  const target = pickNextStep(status, manifest.phases);
  if (!target) {
    const text =
      status.status === 'done'
        ? chalk.green('Nothing to do — all changes are done.')
        : chalk.dim('No ready step. Everything is blocked, gated, or parked.');
    if (options.json) {
      console.log(JSON.stringify({ state: 'nothing-ready', message: text }, null, 2));
    } else {
      console.log(text);
    }
    return;
  }

  const { phase, change } = target;

  // Respect halts: a parked step does not advance until input is recorded.
  const parked = getParkedStep(projectRoot, batch, change);
  if (precheckPark(parked, change, options)) return;

  const context: ResolvedStepContext = {
    batch,
    change,
    // Coarse hint only; the engine derives the authoritative transition from
    // richer on-disk state via the same `computeNextTransition` and overrides
    // this. `propose` is the neutral default for a not-yet-created change.
    transition: computeNextTransition(projectRoot, change) ?? 'propose',
    phase: {
      name: phase.name,
      goal: phase.goal,
      success: phase.success,
      proofOfWork: phase.proofOfWork,
    },
    settings,
    journal: readJournalForChange(projectRoot, batch, change),
    resume: parked
      ? {
          kind: parked.kind,
          reason: parked.reason,
          answer: parked.answer,
          feedback: parked.feedback,
        }
      : undefined,
  };

  const result = await engine.runStep(context);

  persistStepOutcome(projectRoot, batch, change, result);

  renderResult(projectRoot, batch, manifest.phases, result, options);
}

function pickNextStep(
  status: Awaited<ReturnType<typeof computeBatchStatus>>,
  manifestPhases: Phase[]
): { phase: Phase; change: string } | undefined {
  for (const phaseStatus of status.phases) {
    if (phaseStatus.gated) continue;
    const phase = manifestPhases.find((p) => p.name === phaseStatus.name);
    if (!phase) continue;
    for (const change of phaseStatus.changes) {
      if (change.status === 'ready' || change.status === 'in-progress') {
        return { phase, change: change.name };
      }
    }
  }
  return undefined;
}

function notAdvanced(
  change: string,
  reason: string,
  options: BatchApplyOptions,
  hint: string
): void {
  if (options.json) {
    console.log(
      JSON.stringify({ state: 'parked', change, reason, hint }, null, 2)
    );
    return;
  }
  console.log(chalk.yellow(`Step '${change}' did not advance (${reason}).`));
  console.log(chalk.dim(`To proceed: ${hint}`));
}

async function renderResult(
  _projectRoot: string,
  _batch: string,
  _phases: Phase[],
  result: StepResult,
  options: BatchApplyOptions
): Promise<void> {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold(`\nRan: ${result.change} (${result.transition})`));
  switch (result.state) {
    case 'advanced':
      console.log(chalk.green(`✓ advanced — ${result.message ?? 'step complete'}`));
      break;
    case 'blocked':
      console.log(chalk.yellow(`⚠ blocked — ${result.blocker ?? 'needs input'}`));
      break;
    case 'awaiting-approval':
      console.log(chalk.cyan(`⏸ awaiting approval — ${result.approvalRequest ?? ''}`));
      break;
    default:
      console.log(chalk.dim(result.message ?? result.state));
  }
}
