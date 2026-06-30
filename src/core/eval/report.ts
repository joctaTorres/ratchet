/**
 * Eval scorecard and baseline regression diff.
 *
 * The scorecard counts pass/fail/unjudged/skipped and lists failing cases with
 * their evidence. The baseline diff classifies each case against the promoted
 * baseline run:
 *   - regression = pass in baseline AND fail now (the thing we guard against)
 *   - new        = present only in the current run
 *   - retired    = present only in the baseline (neither is a regression)
 *   - skippedRegressions = pass in baseline AND skipped now (visible, not failed)
 *
 * `unjudged` keeps a run incomplete and never counts as a pass; `skipped` is an
 * intentional, counted exclusion and never blocks completeness. The overall
 * verdict is decided in exactly one place — the verdict-aggregation core
 * (`aggregate.ts`) — as a logical AND over named contributors; `buildReport`
 * routes `overall` through it and exposes the per-contributor breakdown.
 */

import type { EvalRun } from './run.js';
import { loadRun, loadBaselineRunId } from './run.js';
import type { ClauseResult, JurorVote, Verdict } from './judge.js';
import { aggregateRun, DEFAULT_CONTRIBUTORS, type ContributorOutcome } from './aggregate.js';
import { evaluateInvariantGate } from './invariant-gate.js';
import type { InvariantOutcome } from './invariant-evaluator.js';

export interface Scorecard {
  total: number;
  pass: number;
  fail: number;
  unjudged: number;
  /** Cases intentionally excluded by a skip filter; counted in `total`, never unjudged. */
  skipped: number;
  /** A run is complete when no case is unjudged. */
  complete: boolean;
}

export interface FailingCase {
  id: string;
  scenario: string;
  evidence: string;
  source: string;
}

/** The complete structured detail of one run case: judging detail when judged, skip detail when skipped. */
export interface CaseDetail {
  id: string;
  scenario: string;
  verdict: Verdict;
  source: string;
  rubric: string[];
  clauses: ClauseResult[];
  votes: JurorVote[];
  skip?: { source: 'tag' | 'config'; detail: string };
}

export interface BaselineDiff {
  baselineRunId: string | null;
  regressions: string[];
  newCases: string[];
  retiredCases: string[];
  /** Case ids whose baseline verdict was `pass` and are now `skipped`. */
  skippedRegressions: string[];
}

export interface EvalReport {
  runId: string;
  scorecard: Scorecard;
  failing: FailingCase[];
  unjudgedCases: string[];
  /** The complete structured per-case view: rubric, per-clause evidence, per-juror votes, and skip detail. */
  cases: CaseDetail[];
  diff: BaselineDiff;
  /** Overall verdict, decided by the aggregation core as an AND over contributors. */
  overall: 'pass' | 'fail';
  /** Per-contributor breakdown from the aggregation core. */
  contributors: ContributorOutcome[];
  /** Per-invariant breakdown for the active invariants the gate evaluated (empty
   *  when the `invariants` contributor is disabled or nothing is declared). */
  invariants: InvariantOutcome[];
  /** Set when the invariant manifest was present but could not be loaded (fail-closed). */
  loadError?: string;
}

function verdictOf(run: EvalRun, caseId: string): Verdict {
  return run.verdicts[caseId]?.verdict ?? 'unjudged';
}

function scoreRun(run: EvalRun): Scorecard {
  let pass = 0;
  let fail = 0;
  let unjudged = 0;
  let skipped = 0;
  for (const c of run.cases) {
    const v = verdictOf(run, c.id);
    if (v === 'pass') pass++;
    else if (v === 'fail') fail++;
    else if (v === 'skipped') skipped++;
    else unjudged++;
  }
  return { total: run.cases.length, pass, fail, unjudged, skipped, complete: unjudged === 0 };
}

function failingCases(run: EvalRun): FailingCase[] {
  return run.cases
    .filter((c) => verdictOf(run, c.id) === 'fail')
    .map((c) => ({
      id: c.id,
      scenario: c.scenario,
      evidence: run.verdicts[c.id]?.reason ?? '',
      source: c.source,
    }));
}

function unjudgedIds(run: EvalRun): string[] {
  return run.cases.filter((c) => verdictOf(run, c.id) === 'unjudged').map((c) => c.id);
}

/** Build the complete per-case structured view: one `CaseDetail` per case in `run.cases`. */
function caseDetails(run: EvalRun): CaseDetail[] {
  return run.cases.map((c) => {
    const record = run.verdicts[c.id];
    return {
      id: c.id,
      scenario: c.scenario,
      verdict: record?.verdict ?? 'unjudged',
      source: c.source,
      rubric: record?.rubric ?? [],
      clauses: record?.clauses ?? [],
      votes: record?.votes ?? [],
      ...(record?.skip ? { skip: record.skip } : {}),
    };
  });
}

/** Diff a run against the baseline, classifying regressions/new/retired. */
export function diffAgainstBaseline(
  run: EvalRun,
  baseline: EvalRun | null
): BaselineDiff {
  if (!baseline) {
    return { baselineRunId: null, regressions: [], newCases: [], retiredCases: [], skippedRegressions: [] };
  }
  const currentIds = new Set(run.cases.map((c) => c.id));
  const baselineIds = new Set(baseline.cases.map((c) => c.id));

  const regressions: string[] = [];
  const skippedRegressions: string[] = [];
  for (const c of run.cases) {
    if (!baselineIds.has(c.id)) continue;
    const wasPass = (baseline.verdicts[c.id]?.verdict ?? 'unjudged') === 'pass';
    const now = verdictOf(run, c.id);
    if (wasPass && now === 'fail') regressions.push(c.id);
    if (wasPass && now === 'skipped') skippedRegressions.push(c.id);
  }
  const newCases = [...currentIds].filter((id) => !baselineIds.has(id)).sort();
  const retiredCases = [...baselineIds].filter((id) => !currentIds.has(id)).sort();
  return {
    baselineRunId: baseline.runId,
    regressions: regressions.sort(),
    newCases,
    retiredCases,
    skippedRegressions: skippedRegressions.sort(),
  };
}

/** Build the full report for a run, loading the baseline if one is promoted. */
export async function buildReport(projectRoot: string, runId: string): Promise<EvalReport> {
  const run = loadRun(projectRoot, runId);
  const baselineId = loadBaselineRunId(projectRoot);
  const baseline = baselineId ? safeLoad(projectRoot, baselineId) : null;
  const diff = diffAgainstBaseline(run, baseline);
  const scorecard = scoreRun(run);
  // The aggregation core is the single decider of the overall verdict: a logical
  // AND over named contributors. No inline pass/fail expression lives here. The
  // AND runs over exactly the contributors that gated the run — `run.gate` — so a
  // disabled contributor takes no part in the verdict. A legacy run with no gate
  // recorded ANDs over the full built-in set.
  const contributors = run.gate
    ? DEFAULT_CONTRIBUTORS.filter((c) => run.gate!.includes(c.id))
    : DEFAULT_CONTRIBUTORS;
  // The run-level invariant gate is evaluated only when the `invariants`
  // contributor is in the enabled set — a disabled contributor runs no manifest
  // command. The async load/evaluation happens here, once, and feeds the pure
  // aggregation core through the precomputed `invariants` field.
  const invariantsEnabled = contributors.some((c) => c.id === 'invariants');
  const gate = invariantsEnabled
    ? await evaluateInvariantGate({ projectRoot, run, baseline })
    : undefined;
  const aggregate = aggregateRun({ run, diff, invariants: gate }, contributors);
  return {
    runId,
    scorecard,
    failing: failingCases(run),
    unjudgedCases: unjudgedIds(run),
    cases: caseDetails(run),
    diff,
    overall: aggregate.overall,
    contributors: aggregate.contributors,
    invariants: gate?.outcomes ?? [],
    ...(gate?.loadError ? { loadError: gate.loadError } : {}),
  };
}

function safeLoad(projectRoot: string, runId: string): EvalRun | null {
  try {
    return loadRun(projectRoot, runId);
  } catch {
    return null;
  }
}
