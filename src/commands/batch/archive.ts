/**
 * `ratchet batch archive <name>`
 *
 * Terminal lifecycle step for a batch: cascade the change-archive flow over every
 * member change, then move the batch directory under `.ratchet/batches/archive/`.
 * The heavy lifting lives in `src/core/batch/archive.ts`; this command only
 * resolves the batch, wires the interactive confirmation, and renders a summary.
 */

import chalk from 'chalk';
import { resolveCurrentPlanningHomeSync } from '../../core/planning-home.js';
import { resolveBatchName } from './shared.js';
import { archiveBatch } from '../../core/batch/archive.js';

export interface BatchArchiveOptions {
  yes?: boolean;
  json?: boolean;
}

export async function batchArchiveCommand(
  name: string | undefined,
  options: BatchArchiveOptions = {}
): Promise<void> {
  const projectRoot = resolveCurrentPlanningHomeSync().root;
  const batch = resolveBatchName(projectRoot, name);

  const result = await archiveBatch(projectRoot, batch, {
    yes: options.yes,
    log: options.json ? () => {} : (message: string) => console.log(message),
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.aborted) {
    return;
  }

  console.log(chalk.green(`\n✓ Batch '${result.batchName}' archived.`));
  if (result.archivedChanges.length > 0) {
    console.log(chalk.dim(`  Changes archived: ${result.archivedChanges.join(', ')}`));
  }
  if (result.skippedArchived.length > 0) {
    console.log(
      chalk.dim(`  Already archived (skipped): ${result.skippedArchived.join(', ')}`)
    );
  }
  if (result.skippedPending.length > 0) {
    console.log(
      chalk.dim(`  Pending / never created (skipped): ${result.skippedPending.join(', ')}`)
    );
  }
}
