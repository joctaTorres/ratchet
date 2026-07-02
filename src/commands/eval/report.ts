/**
 * `ratchet eval report --run <id> [--json]`
 *
 * Scorecard (pass/fail/unjudged), failing cases with evidence, and a baseline
 * diff flagging regressions plus new/retired cases. Regressions are surfaced
 * first; the overall verdict fails while any regression or fail exists.
 *
 * Read-only: the report is rendered purely from the run's persisted state via
 * `renderReport`. It never re-evaluates the invariant gate — no check command is
 * re-run, no mutation agent is spawned, and the working tree is never mutated. The
 * gate is evaluated only by `eval run`, whose result is persisted on the run; a
 * run with no persisted gate (invariants disabled, or a legacy run) reports its
 * invariants as "not evaluated".
 */

import chalk from 'chalk';
import { renderReport, type EvalReport } from '../../core/eval/index.js';
import { projectRoot } from './shared.js';

export interface EvalReportOptions {
  run?: string;
  json?: boolean;
}

export async function evalReportCommand(options: EvalReportOptions = {}): Promise<void> {
  if (!options.run) throw new Error('Missing required --run <id>.');
  const root = projectRoot();
  const report = renderReport(root, options.run);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReport(report);
}

function printReport(report: EvalReport): void {
  const { scorecard: s, diff } = report;
  console.log(chalk.bold(`Eval report ${report.runId}  [${report.overall.toUpperCase()}]`));

  // A run with no persisted invariant gate (invariants disabled at run time, or a
  // legacy run predating gate persistence) renders its invariants "not evaluated":
  // a neutral state the report never re-evaluates and that never affects the gate.
  if (!report.invariantsEvaluated) {
    console.log(chalk.dim('  Invariants: not evaluated'));
  }

  if (diff.regressions.length > 0) {
    console.log(chalk.red.bold(`  REGRESSIONS (${diff.regressions.length}):`));
    for (const id of diff.regressions) {
      const f = report.failing.find((x) => x.id === id);
      console.log(chalk.red(`    - ${id}`));
      if (f) {
        console.log(chalk.dim(`        ${f.evidence}`));
        printCaseDetail(report, id);
      }
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
      printCaseDetail(report, f.id);
    }
  }

  if (diff.newCases.length > 0) console.log(chalk.cyan(`  New: ${diff.newCases.join(', ')}`));
  if (diff.retiredCases.length > 0) {
    console.log(chalk.dim(`  Retired: ${diff.retiredCases.join(', ')}`));
  }
}

/** Print a failing case's per-clause pass/fail breakdown, plus a jury tally when more than one vote was cast. */
function printCaseDetail(report: EvalReport, caseId: string): void {
  const detail = report.cases.find((c) => c.id === caseId);
  if (!detail) return;
  for (const cl of detail.clauses) {
    const mark = cl.pass ? chalk.green('[pass]') : chalk.red('[fail]');
    console.log(chalk.dim(`        ${mark} ${cl.clause}`));
  }
  if (detail.votes.length > 1) {
    const passed = detail.votes.filter((v) => v.pass).length;
    console.log(chalk.dim(`        Jury: ${passed}/${detail.votes.length} passed`));
  }
  if (detail.artifacts?.trace) console.log(chalk.dim(`        Trace: ${detail.artifacts.trace}`));
  if (detail.artifacts?.screenshot) console.log(chalk.dim(`        Screenshot: ${detail.artifacts.screenshot}`));
}
