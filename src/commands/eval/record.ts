/**
 * `ratchet eval record --run <id> --case <id> --verdict <pass|fail|unjudged>
 *  [--evidence <text>]`
 *
 * Manually override a single case's verdict in a persisted run (atomic
 * read-modify-write). A `fail` verdict requires evidence; on any rejection the
 * run is left unchanged and the command exits non-zero.
 */

import chalk from 'chalk';
import { recordVerdict, type Verdict } from '../../core/eval/index.js';
import { projectRoot } from './shared.js';

export interface EvalRecordOptions {
  run?: string;
  case?: string;
  verdict?: string;
  evidence?: string;
  json?: boolean;
}

export async function evalRecordCommand(options: EvalRecordOptions = {}): Promise<void> {
  if (!options.run) throw new Error('Missing required --run <id>.');
  if (!options.case) throw new Error('Missing required --case <id>.');
  if (!options.verdict) throw new Error('Missing required --verdict <pass|fail|unjudged>.');

  const root = projectRoot();
  recordVerdict(root, {
    runId: options.run,
    caseId: options.case,
    verdict: options.verdict as Verdict,
    evidence: options.evidence,
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        { runId: options.run, caseId: options.case, verdict: options.verdict, source: 'manual' },
        null,
        2
      )
    );
    return;
  }
  console.log(
    chalk.green(
      `Recorded manual verdict '${options.verdict}' for ${options.case} in run ${options.run}.`
    )
  );
}
