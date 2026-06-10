/**
 * `ratchet batch apply [name]`
 *
 * Single step: pick the next ready DAG step, hand it to the engine for exactly
 * one transition (propose -> apply -> verify), persist the result, render a rich
 * view, and return. No internal loop. Fails cleanly when no engine is installed;
 * the open commands keep working without it.
 */

import chalk from 'chalk';
import { existsSync } from 'fs';
import path from 'path';
import { RATCHET_DIR_NAME } from '../../core/config.js';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest, type Phase } from '../../core/batch/manifest.js';
import { computeBatchStatus } from '../../core/batch/status.js';
import { resolveBatchSettings } from '../../core/batch/config.js';
import {
  loadBatchEngine,
  ENGINE_ABSENT_MESSAGE,
  engineVersionMismatchMessage,
  type ResolvedStepContext,
  type Transition,
  ENGINE_CONTRACT_VERSION,
} from '../../core/batch/engine.js';
import {
  getParkedStep,
  readJournalForChange,
  parkStep,
  clearParkedStep,
} from '../../core/batch/journal.js';
import { resolveBatchName } from './shared.js';

export interface BatchApplyOptions {
  json?: boolean;
}

/** Compute the next transition for a change from its on-disk state. */
function nextTransition(projectRoot: string, change: string, exists: boolean): Transition {
  if (!exists) return 'propose';
  // If the change exists with a plan, the propose step is done; assume apply.
  // (The engine derives the precise transition from richer state; this is the
  // CLI's coarse view for context-building.)
  const planPath = path.join(projectRoot, RATCHET_DIR_NAME, 'changes', change, 'plan.md');
  return existsSync(planPath) ? 'apply' : 'propose';
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

  // Engine is required to run a step. Resolve it before doing any work so the
  // error message is the first thing the user sees, and the open commands are
  // unaffected.
  const resolution = loadBatchEngine();
  if (resolution.status === 'absent') {
    fail(ENGINE_ABSENT_MESSAGE, options);
    return;
  }
  if (resolution.status === 'version-mismatch') {
    fail(
      engineVersionMismatchMessage(resolution.engineVersion, resolution.cliVersion),
      options
    );
    return;
  }
  const engine = resolution.engine;

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

  const { phase, change, exists } = target;

  // Respect halts: a parked step does not advance until input is recorded.
  const parked = getParkedStep(projectRoot, batch, change);
  if (parked && parked.kind === 'blocked' && !parked.answer) {
    notAdvanced(change, `blocked: ${parked.reason}`, options, 'record an answer with `ratchet batch report --change ' + change + ' --answer "..."`');
    return;
  }
  if (parked && parked.kind === 'awaiting-approval' && !parked.approved && !parked.feedback) {
    notAdvanced(change, `awaiting approval: ${parked.reason}`, options, 'approve or reject from the batch view');
    return;
  }

  const context: ResolvedStepContext = {
    contractVersion: ENGINE_CONTRACT_VERSION,
    batch,
    change,
    transition: nextTransition(projectRoot, change, exists),
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

  // Persist parked/cleared state based on the structured result.
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

  renderResult(projectRoot, batch, manifest.phases, result, options);
}

function pickNextStep(
  status: Awaited<ReturnType<typeof computeBatchStatus>>,
  manifestPhases: Phase[]
): { phase: Phase; change: string; exists: boolean } | undefined {
  for (const phaseStatus of status.phases) {
    if (phaseStatus.gated) continue;
    const phase = manifestPhases.find((p) => p.name === phaseStatus.name);
    if (!phase) continue;
    for (const change of phaseStatus.changes) {
      if (change.status === 'ready' || change.status === 'in-progress') {
        return { phase, change: change.name, exists: change.exists };
      }
    }
  }
  return undefined;
}

function fail(message: string, options: BatchApplyOptions): void {
  if (options.json) {
    console.log(JSON.stringify({ error: message }, null, 2));
  } else {
    console.error(chalk.red(message));
  }
  process.exitCode = 1;
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
  result: Awaited<ReturnType<import('../../core/batch/engine.js').BatchEngine['runStep']>>,
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
