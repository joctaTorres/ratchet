/**
 * Single verdict-aggregation core for an eval run.
 *
 * One pure function decides a run's overall pass as a logical **AND over named
 * contributors**: the run passes iff every contributor passes. This is the only
 * place a run-level pass is decided — `report.ts` routes its `overall` verdict
 * here and `promoteBaseline` routes its completeness check here, so the gate has
 * a single source of truth.
 *
 * `Contributor` is the defined extension point. A future capability (e.g. the
 * `invariant-set` change) plugs a new gate signal in by implementing this
 * interface and registering it in the contributor set — the aggregation logic
 * does not change. The built-ins are derived purely from already-loaded run
 * state (case verdicts partitioned by binding kind, plus the baseline diff), so
 * the core does no filesystem or process I/O and sits at the bottom of the test
 * pyramid.
 */

import type { EvalRun } from './run.js';
import type { BaselineDiff } from './report.js';
import type { Verdict } from './judge.js';

export type ContributorId = 'deterministic' | 'llm-judge' | 'invariants' | 'regression';

/** In-memory inputs a contributor evaluates — no fs, no spawn. */
export interface ContributorContext {
  run: EvalRun;
  diff: BaselineDiff;
}

/** One contributor's verdict over the run, with the case ids that failed it. */
export interface ContributorOutcome {
  id: ContributorId;
  status: 'pass' | 'fail';
  /** Case ids that caused this contributor to fail (empty on pass). */
  failing: string[];
}

/**
 * The extension point. A gate capability is a named contributor that reduces the
 * run context to a single pass/fail outcome. New capabilities register a
 * contributor here rather than touching the aggregation logic.
 */
export interface Contributor {
  id: ContributorId;
  evaluate(ctx: ContributorContext): ContributorOutcome;
}

export interface RunAggregate {
  overall: 'pass' | 'fail';
  /** A run is complete when no case is unjudged (shared by promotion + report). */
  complete: boolean;
  contributors: ContributorOutcome[];
}

function verdictOf(run: EvalRun, caseId: string): Verdict {
  return run.verdicts[caseId]?.verdict ?? 'unjudged';
}

/** Case ids of `kind`-bound cases whose verdict is `fail`. */
function failingOfKind(run: EvalRun, kind: 'deterministic' | 'llm-judge'): string[] {
  return run.cases
    .filter((c) => c.bindingKind === kind && verdictOf(run, c.id) === 'fail')
    .map((c) => c.id);
}

function outcome(id: ContributorId, failing: string[]): ContributorOutcome {
  return { id, status: failing.length > 0 ? 'fail' : 'pass', failing };
}

/** Fails on any `deterministic`-bound case judged `fail`. */
export const deterministicContributor: Contributor = {
  id: 'deterministic',
  evaluate: (ctx) => outcome('deterministic', failingOfKind(ctx.run, 'deterministic')),
};

/** Fails on any `llm-judge`-bound case judged `fail`. */
export const llmJudgeContributor: Contributor = {
  id: 'llm-judge',
  evaluate: (ctx) => outcome('llm-judge', failingOfKind(ctx.run, 'llm-judge')),
};

/** Fails on any baseline regression (passed in baseline, fails now). */
export const regressionContributor: Contributor = {
  id: 'regression',
  evaluate: (ctx) => outcome('regression', ctx.diff.regressions),
};

/**
 * Neutral placeholder. Registered as a defined extension point with nothing to
 * evaluate yet, so it always reports `pass` and is identity to the AND. The
 * `invariant-set` change fills this in without reshaping the aggregation seam.
 */
export const invariantsContributor: Contributor = {
  id: 'invariants',
  evaluate: () => outcome('invariants', []),
};

/** The built-in contributor set, in display order. */
export const DEFAULT_CONTRIBUTORS: Contributor[] = [
  deterministicContributor,
  llmJudgeContributor,
  invariantsContributor,
  regressionContributor,
];

/** A run is complete when no case is left unjudged. */
export function isRunComplete(run: EvalRun): boolean {
  return run.cases.every((c) => verdictOf(run, c.id) !== 'unjudged');
}

/**
 * Decide a run's overall verdict as the logical AND over `contributors`:
 * `pass` iff every contributor passes. An empty/neutral contributor reports
 * `pass` and is therefore identity to the AND.
 */
export function aggregateRun(
  ctx: ContributorContext,
  contributors: Contributor[] = DEFAULT_CONTRIBUTORS
): RunAggregate {
  const outcomes = contributors.map((c) => c.evaluate(ctx));
  const overall: 'pass' | 'fail' = outcomes.every((o) => o.status === 'pass') ? 'pass' : 'fail';
  return { overall, complete: isRunComplete(ctx.run), contributors: outcomes };
}
