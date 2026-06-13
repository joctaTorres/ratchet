/**
 * `ratchet eval run [scope] [--judge auto|check|agent] [--json]`
 *
 * Snapshot the in-scope set, judge every bound case through the engine seams
 * against its fixture working copy, persist the run under `.ratchet/evals/runs/`
 * and print the scorecard. Unbound cases record `unjudged`.
 */

import chalk from 'chalk';
import { executeRun, buildReport } from '../../core/eval/index.js';
import { projectRoot, resolveScope, resolveJudgeMode, type ScopeFlags } from './shared.js';

export interface EvalRunOptions extends ScopeFlags {
  judge?: string;
  json?: boolean;
}

export async function evalRunCommand(options: EvalRunOptions = {}): Promise<void> {
  const root = projectRoot();
  const scope = resolveScope(options);
  const mode = resolveJudgeMode(root, options.judge);

  const { run, warnings } = await executeRun(root, { scope, mode });
  const report = buildReport(root, run.runId);

  if (options.json) {
    console.log(JSON.stringify({ runId: run.runId, scorecard: report.scorecard, warnings }, null, 2));
    return;
  }
  renderRun(run.runId, report.scorecard, warnings);
}

function renderRun(
  runId: string,
  scorecard: { pass: number; fail: number; unjudged: number; total: number; complete: boolean },
  warnings: string[]
): void {
  console.log(chalk.bold(`Eval run ${runId}`));
  console.log(
    `  ${chalk.green(`${scorecard.pass} pass`)}  ` +
      `${chalk.red(`${scorecard.fail} fail`)}  ` +
      `${chalk.yellow(`${scorecard.unjudged} unjudged`)}  (of ${scorecard.total})`
  );
  if (!scorecard.complete) {
    console.log(chalk.yellow('  Run is incomplete: some cases are unjudged.'));
  }
  for (const w of warnings) console.log(chalk.dim(`  warn: ${w}`));
}
