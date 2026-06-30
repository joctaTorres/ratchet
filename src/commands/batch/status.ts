/**
 * `ratchet batch status [name]`
 *
 * Renders batch status derived live from change state on disk, as text or
 * `--json`. JSON includes each phase and change with status, task progress,
 * after edges, the next step, and whether it is gated or blocked.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest } from '../../core/batch/manifest.js';
import {
  computeBatchStatus,
  type BatchStatusInfo,
  type ParkedInfo,
} from '../../core/batch/status.js';
import { resolveBatchSettings } from '../../core/batch/config.js';
import { readRunState } from '../../core/batch/journal.js';
import { resolveBatchName } from './shared.js';

export interface BatchStatusOptions {
  json?: boolean;
}

export async function batchStatusCommand(
  name: string | undefined,
  options: BatchStatusOptions = {}
): Promise<void> {
  const planningHome = resolveCurrentPlanningHomeSync();
  const batchName = resolveBatchName(planningHome.root, name);
  const manifest = loadBatchManifest(planningHome.root, batchName);
  const runState = readRunState(planningHome.root, batchName);
  const status = await computeBatchStatus(planningHome.root, manifest, runState);
  const { settings } = resolveBatchSettings(planningHome.root, manifest);

  if (options.json) {
    console.log(JSON.stringify(toJson(status, settings.gate), null, 2));
    return;
  }

  printText(status);
}

export function toJson(status: BatchStatusInfo, gate: string): unknown {
  return {
    name: status.name,
    status: status.status,
    progress: status.progress,
    changeCount: status.changeCount,
    doneCount: status.doneCount,
    gate,
    next: status.next
      ? {
          ...status.next,
          gated: false,
          blocked: false,
        }
      : null,
    phases: status.phases.map((phase) => ({
      name: phase.name,
      goal: phase.goal,
      success: phase.success,
      status: phase.status,
      gated: phase.gated,
      gatedBy: phase.gatedBy ?? null,
      changes: phase.changes.map((change) => ({
        name: change.name,
        status: change.status,
        // The change's own definition of done — required on every change intent,
        // so always present.
        done: change.done,
        progress: change.progress,
        after: change.after,
        blockedBy: change.blockedBy,
        exists: change.exists,
        archived: change.archived,
        // A change is blocked when its dependencies are unmet OR an agent
        // voluntarily parked it as a blocker awaiting input.
        blocked: change.status === 'blocked',
        awaitingApproval: change.status === 'awaiting-approval',
        // Tasks all checked but the verify gate has not run yet — NOT done.
        awaitingVerify: change.status === 'awaiting-verify',
        parked: change.parked ?? null,
      })),
    })),
  };
}

function symbolFor(statusValue: string): string {
  switch (statusValue) {
    case 'done':
      return chalk.green('✓');
    case 'in-progress':
      return chalk.yellow('◉');
    case 'awaiting-verify':
      // Tasks done, verify gate pending — distinct from done (✓) and approval (⏸).
      return chalk.magenta('⧖');
    case 'ready':
      return chalk.cyan('○');
    case 'blocked':
      return chalk.red('✗');
    case 'awaiting-approval':
      return chalk.cyan('⏸');
    default:
      return chalk.gray('·');
  }
}

/** Render the parked halt (blocker question or approval request) under a step. */
function printParked(parked: ParkedInfo): void {
  if (parked.kind === 'blocked') {
    const tail = parked.answer ? chalk.dim(' (answered — resume on next apply)') : '';
    console.log(chalk.red(`      ⚠ blocked: ${parked.reason}`) + tail);
  } else {
    const tail = parked.feedback
      ? chalk.dim(' (rejected — re-runs propose on next apply)')
      : chalk.dim(' (approve or reject from the batch view)');
    console.log(chalk.cyan(`      ⏸ awaiting approval: ${parked.reason}`) + tail);
  }
}

function printText(status: BatchStatusInfo): void {
  console.log(chalk.bold(`\nBatch: ${status.name}`));
  const pct =
    status.progress.total > 0
      ? Math.round((status.progress.completed / status.progress.total) * 100)
      : 0;
  console.log(
    chalk.dim(
      `Status: ${status.status} · ${status.doneCount}/${status.changeCount} changes done · ${status.progress.completed}/${status.progress.total} tasks (${pct}%)`
    )
  );

  if (status.changeCount === 0) {
    console.log(chalk.dim('\nNo changes yet. Add change intents to the manifest to begin.'));
    return;
  }

  for (const phase of status.phases) {
    const gate = phase.gated ? chalk.red(` (gated by ${phase.gatedBy})`) : '';
    console.log(`\n${chalk.bold(phase.name)} ${chalk.dim(`— ${phase.goal}`)}${gate}`);
    for (const change of phase.changes) {
      const after =
        change.after.length > 0 ? chalk.dim(` after: ${change.after.join(', ')}`) : '';
      const progress =
        change.progress.total > 0
          ? chalk.dim(` [${change.progress.completed}/${change.progress.total}]`)
          : '';
      const blocked =
        change.status === 'blocked' && change.blockedBy.length > 0
          ? chalk.red(` blocked by ${change.blockedBy.join(', ')}`)
          : '';
      console.log(
        `  ${symbolFor(change.status)} ${change.name}${progress}${after}${blocked}`
      );
      if (change.parked) {
        printParked(change.parked);
      }
    }
  }

  if (status.next) {
    const label = status.next.decompose
      ? `decompose phase ${status.next.phase}`
      : `${status.next.change} (phase ${status.next.phase})`;
    console.log(chalk.bold(`\nNext: ${label}`));
  } else if (status.status === 'done') {
    console.log(chalk.green('\nAll changes done.'));
  } else {
    console.log(chalk.dim('\nNo ready step (blocked or gated).'));
  }
}
