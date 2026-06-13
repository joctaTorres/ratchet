/**
 * `ratchet eval report --run <id> [--json]`
 *
 * Scorecard (pass/fail/unjudged), failing cases with evidence, and a baseline
 * diff flagging regressions plus new/retired cases. Regressions are surfaced
 * first; the overall verdict fails while any regression or fail exists.
 */

import chalk from 'chalk';
import { buildReport, type EvalReport } from '../../core/eval/index.js';
import { projectRoot } from './shared.js';

export interface EvalReportOptions {
  run?: string;
  json?: boolean;
}

export async function evalReportCommand(options: EvalReportOptions = {}): Promise<void> {
  if (!options.run) throw new Error('Missing required --run <id>.');
  const root = projectRoot();
  const report = buildReport(root, options.run);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  renderReport(report);
}

function renderReport(report: EvalReport): void {
  const { scorecard: s, diff } = report;
  console.log(chalk.bold(`Eval report ${report.runId}  [${report.overall.toUpperCase()}]`));

  if (diff.regressions.length > 0) {
    console.log(chalk.red.bold(`  REGRESSIONS (${diff.regressions.length}):`));
    for (const id of diff.regressions) {
      const f = report.failing.find((x) => x.id === id);
      console.log(chalk.red(`    - ${id}`));
      if (f) console.log(chalk.dim(`        ${f.evidence}`));
    }
  }

  console.log(
    `  ${chalk.green(`${s.pass} pass`)}  ${chalk.red(`${s.fail} fail`)}  ` +
      `${chalk.yellow(`${s.unjudged} unjudged`)}  (of ${s.total})`
  );
  if (!s.complete) console.log(chalk.yellow('  Run is incomplete: some cases are unjudged.'));

  const nonRegressionFails = report.failing.filter((f) => !diff.regressions.includes(f.id));
  if (nonRegressionFails.length > 0) {
    console.log(chalk.red('  Failing cases:'));
    for (const f of nonRegressionFails) {
      console.log(chalk.red(`    - ${f.id}`));
      console.log(chalk.dim(`        ${f.evidence}`));
    }
  }

  if (diff.newCases.length > 0) console.log(chalk.cyan(`  New: ${diff.newCases.join(', ')}`));
  if (diff.retiredCases.length > 0) {
    console.log(chalk.dim(`  Retired: ${diff.retiredCases.join(', ')}`));
  }
}
