/**
 * `ratchet eval run [scope] [--gate <ids>] [--only <ids>] [--no-llm-judge] [--judge <mode>] [--json]`
 *
 * Snapshot the in-scope set, judge every bound case whose contributor is enabled
 * through the engine seams against its fixture working copy, persist the run
 * under `.ratchet/evals/runs/` and print the scorecard. A case bound to a
 * disabled contributor — and any unbound case — records `unjudged`. Contributor
 * selection comes from `eval.gate` config overridden by the CLI selectors
 * (`--gate`/`--only`/`--no-llm-judge`); `--judge` is a deprecated legacy alias.
 */

import chalk from 'chalk';
import { executeRun, buildReport, type EvalReport } from '../../core/eval/index.js';
import { projectRoot, resolveScope, resolveContributorGate, type ScopeFlags } from './shared.js';

export interface EvalRunOptions extends ScopeFlags {
  /** `--gate <ids>`: set the enabled contributor set outright. */
  gate?: string;
  /** `--only <ids>`: restrict the run to the listed contributors. */
  only?: string;
  /** `--no-llm-judge` ⇒ `false`; disables the llm-judge contributor. */
  llmJudge?: boolean;
  /** `--no-invariants` ⇒ `false`; disables the invariants contributor. */
  invariants?: boolean;
  /** Legacy `--judge <mode>` alias (deprecated), mapped onto the gate. */
  judge?: string;
  json?: boolean;
}

export async function evalRunCommand(options: EvalRunOptions = {}): Promise<void> {
  const root = projectRoot();
  const scope = resolveScope(options);
  const gate = resolveContributorGate(root, {
    gate: options.gate,
    only: options.only,
    llmJudge: options.llmJudge,
    invariants: options.invariants,
    judge: options.judge,
  });

  const { run, warnings } = await executeRun(root, { scope, gate });
  const report = await buildReport(root, run.runId);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          runId: run.runId,
          overall: report.overall,
          scorecard: report.scorecard,
          contributors: report.contributors,
          // Run-level gate breakdown, surfaced ahead of per-case detail.
          invariants: report.invariants,
          ...(report.loadError ? { invariantLoadError: report.loadError } : {}),
          regressions: report.diff.regressions,
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

/**
 * Surface the two run-level gate violations first — invariants, then regression
 * — as siblings, ahead of the per-case contributor breakdown. A violated
 * invariant (or an unloadable manifest) is therefore the first thing reported.
 */
function renderRunLevelViolations(report: EvalReport): void {
  const violations = report.invariants.filter((o) => o.status !== 'pass');
  if (violations.length > 0 || report.loadError) {
    console.log(chalk.red.bold(`  INVARIANT VIOLATIONS (${violations.length || 1}):`));
    if (report.loadError) {
      console.log(chalk.red(`    - manifest could not be loaded`));
      console.log(chalk.dim(`        ${report.loadError}`));
    }
    for (const v of violations) {
      console.log(chalk.red(`    - ${v.id} (${v.kind}: ${v.status})`));
      console.log(chalk.dim(`        ${v.evidence}`));
    }
  }
  if (report.diff.regressions.length > 0) {
    console.log(chalk.red.bold(`  REGRESSIONS (${report.diff.regressions.length}):`));
    for (const id of report.diff.regressions) console.log(chalk.red(`    - ${id}`));
  }
}

function renderRun(runId: string, report: EvalReport, warnings: string[]): void {
  const { scorecard } = report;
  console.log(chalk.bold(`Eval run ${runId}  [${report.overall.toUpperCase()}]`));
  console.log(
    `  ${chalk.green(`${scorecard.pass} pass`)}  ` +
      `${chalk.red(`${scorecard.fail} fail`)}  ` +
      `${chalk.yellow(`${scorecard.unjudged} unjudged`)}  (of ${scorecard.total})`
  );
  // Run-level gate violations (invariants, then regression) come first.
  renderRunLevelViolations(report);
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
