/**
 * `ratchet batch view [name]` and `ratchet batch list`
 *
 * Rich terminal dashboard for a single batch and a list of all batches,
 * mirroring the chalk / status-symbol / progress-bar patterns in
 * `src/core/view.ts`. Status is derived live from change state on disk.
 *
 * Honors `--no-color`: the CLI sets NO_COLOR, which chalk respects, so no ANSI
 * escape codes are emitted.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { loadBatchManifest } from '../../core/batch/manifest.js';
import {
  computeBatchStatus,
  type BatchStatusInfo,
  type ChangeStatusInfo,
} from '../../core/batch/status.js';
import { resolveBatchName, listBatchNames } from './shared.js';

export interface BatchViewOptions {
  json?: boolean;
}

function createProgressBar(completed: number, total: number, width = 20): string {
  if (total === 0) return chalk.dim('─'.repeat(width));
  const percentage = completed / total;
  const filled = Math.round(percentage * width);
  const empty = width - filled;
  return `[${chalk.green('█'.repeat(filled))}${chalk.dim('░'.repeat(empty))}]`;
}

function symbolFor(change: ChangeStatusInfo): string {
  switch (change.status) {
    case 'done':
      return chalk.green('✓');
    case 'in-progress':
      return chalk.yellow('◉');
    case 'ready':
      return chalk.cyan('○');
    case 'blocked':
      return chalk.red('✗');
    default:
      return chalk.gray('·');
  }
}

export async function batchViewCommand(
  name: string | undefined,
  options: BatchViewOptions = {}
): Promise<void> {
  const projectRoot = resolveCurrentPlanningHomeSync().root;
  const batchName = resolveBatchName(projectRoot, name);
  const manifest = loadBatchManifest(projectRoot, batchName);
  const status = await computeBatchStatus(projectRoot, manifest);

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  renderSingleBatch(status);
}

function renderSingleBatch(status: BatchStatusInfo): void {
  console.log(chalk.bold(`\nBatch: ${status.name}`));
  console.log('═'.repeat(60));

  const pct =
    status.progress.total > 0
      ? Math.round((status.progress.completed / status.progress.total) * 100)
      : 0;
  console.log(
    `${createProgressBar(status.progress.completed, status.progress.total)} ${chalk.dim(
      `${pct}% · ${status.doneCount}/${status.changeCount} changes done`
    )}`
  );

  if (status.changeCount === 0) {
    console.log(
      chalk.dim(
        '\nThis batch has no changes yet. Add change intents under a phase in the manifest:'
      )
    );
    console.log(chalk.dim('  phases:\n    - changes:\n        - name: <change-name>'));
    return;
  }

  for (const phase of status.phases) {
    const gate = phase.gated ? chalk.red(`  (gated by ${phase.gatedBy})`) : '';
    console.log(`\n${chalk.bold.cyan(phase.name)} ${chalk.dim(`— ${phase.goal}`)}${gate}`);
    console.log('─'.repeat(60));
    for (const change of phase.changes) {
      const bar = createProgressBar(change.progress.completed, change.progress.total, 12);
      const after =
        change.after.length > 0 ? chalk.dim(`  after: ${change.after.join(', ')}`) : '';
      const blocked =
        change.status === 'blocked'
          ? chalk.red(`  blocked by ${change.blockedBy.join(', ')}`)
          : '';
      console.log(
        `  ${symbolFor(change)} ${chalk.bold(change.name.padEnd(28))} ${bar}${after}${blocked}`
      );
    }
  }

  console.log('\n' + '═'.repeat(60));
  if (status.next) {
    console.log(chalk.bold(`Next: ${status.next.change} (phase ${status.next.phase})`));
  } else if (status.status === 'done') {
    console.log(chalk.green('All changes done.'));
  } else {
    console.log(chalk.dim('No ready step — everything is blocked or gated.'));
  }
}

export async function batchListCommand(options: BatchViewOptions = {}): Promise<void> {
  const projectRoot = resolveCurrentPlanningHomeSync().root;
  const names = listBatchNames(projectRoot);

  const rows: BatchStatusInfo[] = [];
  for (const batchName of names) {
    const manifest = loadBatchManifest(projectRoot, batchName);
    rows.push(await computeBatchStatus(projectRoot, manifest));
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          batches: rows.map((r) => ({
            name: r.name,
            changeCount: r.changeCount,
            doneCount: r.doneCount,
            progress: r.progress,
            status: r.status,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (rows.length === 0) {
    console.log("No batches found. Create one with 'ratchet new batch <name>'.");
    return;
  }

  console.log(chalk.bold('\nBatches'));
  console.log('─'.repeat(60));
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 8);
  for (const row of rows) {
    const pct =
      row.progress.total > 0
        ? Math.round((row.progress.completed / row.progress.total) * 100)
        : 0;
    const bar = createProgressBar(row.progress.completed, row.progress.total, 16);
    const label = row.changeCount === 1 ? 'change' : 'changes';
    console.log(
      `  ${chalk.bold(row.name.padEnd(nameWidth))}  ${bar} ${chalk.dim(
        `${pct}% · ${row.changeCount} ${label}`
      )}`
    );
  }
}
