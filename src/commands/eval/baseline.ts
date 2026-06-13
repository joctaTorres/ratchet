/**
 * `ratchet eval baseline <run-id>`
 *
 * Promote a run to the baseline (`.ratchet/evals/baseline.json` = `{ runId }`).
 * Subsequent reports diff against it to flag regressions.
 */

import chalk from 'chalk';
import { promoteBaseline } from '../../core/eval/index.js';
import { projectRoot } from './shared.js';

export interface EvalBaselineOptions {
  json?: boolean;
}

export async function evalBaselineCommand(
  runId: string | undefined,
  options: EvalBaselineOptions = {}
): Promise<void> {
  if (!runId) throw new Error('Missing required <run-id>.');
  const root = projectRoot();
  promoteBaseline(root, runId);

  if (options.json) {
    console.log(JSON.stringify({ baseline: { runId } }, null, 2));
    return;
  }
  console.log(chalk.green(`Promoted run ${runId} to baseline.`));
}
