/**
 * `ratchet eval run [scope] [--judge auto|deterministic|llm-judge] [--json]`
 *
 * Snapshot the in-scope set, judge every bound case through the engine seams
 * against its fixture working copy, persist the run under `.ratchet/evals/runs/`
 * and print the scorecard. Unbound cases record `unjudged`.
 */

import chalk from 'chalk';
import { executeRun, buildReport, type EvalReport } from '../../core/eval/index.js';
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
    console.log(
      JSON.stringify(
        {
          runId: run.runId,
          overall: report.overall,
          scorecard: report.scorecard,
          contributors: report.contributors,
          warnings,
        },
        null,
        2
      )
    );
    return;
  }
  renderRun(run.runId, report, warnings);
}

function renderRun(runId: string, report: EvalReport, warnings: string[]): void {
  const { scorecard } = report;
  console.log(chalk.bold(`Eval run ${runId}  [${report.overall.toUpperCase()}]`));
  console.log(
    `  ${chalk.green(`${scorecard.pass} pass`)}  ` +
      `${chalk.red(`${scorecard.fail} fail`)}  ` +
      `${chalk.yellow(`${scorecard.unjudged} unjudged`)}  (of ${scorecard.total})`
  );
  console.log('  Contributors:');
  for (const c of report.contributors) {
    const mark = c.status === 'pass' ? chalk.green('pass') : chalk.red('fail');
    const detail = c.failing.length > 0 ? chalk.dim(` (${c.failing.join(', ')})`) : '';
    console.log(`    ${c.id}: ${mark}${detail}`);
  }
  if (!scorecard.complete) {
    console.log(chalk.yellow('  Run is incomplete: some cases are unjudged.'));
  }
  for (const w of warnings) console.log(chalk.dim(`  warn: ${w}`));
}
