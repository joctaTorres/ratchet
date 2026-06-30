/**
 * Eval scorecard and baseline regression diff.
 *
 * The scorecard counts pass/fail/unjudged and lists failing cases with their
 * evidence. The baseline diff classifies each case against the promoted
 * baseline run:
 *   - regression = pass in baseline AND fail now (the thing we guard against)
 *   - new        = present only in the current run
 *   - retired    = present only in the baseline (neither is a regression)
 *
 * `unjudged` keeps a run incomplete and never counts as a pass. The overall
 * verdict is decided in exactly one place — the verdict-aggregation core
 * (`aggregate.ts`) — as a logical AND over named contributors; `buildReport`
 * routes `overall` through it and exposes the per-contributor breakdown.
 */

import type { EvalRun } from './run.js';
import { loadRun, loadBaselineRunId } from './run.js';
import type { Verdict } from './judge.js';
import { aggregateRun, type ContributorOutcome } from './aggregate.js';

export interface Scorecard {
  total: number;
  pass: number;
  fail: number;
  unjudged: number;
  /** A run is complete when no case is unjudged. */
  complete: boolean;
}

export interface FailingCase {
  id: string;
  scenario: string;
  evidence: string;
  source: string;
}

export interface BaselineDiff {
  baselineRunId: string | null;
  regressions: string[];
  newCases: string[];
  retiredCases: string[];
}

export interface EvalReport {
  runId: string;
  scorecard: Scorecard;
  failing: FailingCase[];
  unjudgedCases: string[];
  diff: BaselineDiff;
  /** Overall verdict, decided by the aggregation core as an AND over contributors. */
  overall: 'pass' | 'fail';
  /** Per-contributor breakdown from the aggregation core. */
  contributors: ContributorOutcome[];
}

function verdictOf(run: EvalRun, caseId: string): Verdict {
  return run.verdicts[caseId]?.verdict ?? 'unjudged';
}

function scoreRun(run: EvalRun): Scorecard {
  let pass = 0;
  let fail = 0;
  let unjudged = 0;
  for (const c of run.cases) {
    const v = verdictOf(run, c.id);
    if (v === 'pass') pass++;
    else if (v === 'fail') fail++;
    else unjudged++;
  }
  return { total: run.cases.length, pass, fail, unjudged, complete: unjudged === 0 };
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

/** Diff a run against the baseline, classifying regressions/new/retired. */
export function diffAgainstBaseline(
  run: EvalRun,
  baseline: EvalRun | null
): BaselineDiff {
  if (!baseline) {
    return { baselineRunId: null, regressions: [], newCases: [], retiredCases: [] };
  }
  const currentIds = new Set(run.cases.map((c) => c.id));
  const baselineIds = new Set(baseline.cases.map((c) => c.id));

  const regressions: string[] = [];
  for (const c of run.cases) {
    if (!baselineIds.has(c.id)) continue;
    const wasPass = (baseline.verdicts[c.id]?.verdict ?? 'unjudged') === 'pass';
    const nowFail = verdictOf(run, c.id) === 'fail';
    if (wasPass && nowFail) regressions.push(c.id);
  }
  const newCases = [...currentIds].filter((id) => !baselineIds.has(id)).sort();
  const retiredCases = [...baselineIds].filter((id) => !currentIds.has(id)).sort();
  return { baselineRunId: baseline.runId, regressions: regressions.sort(), newCases, retiredCases };
}

/** Build the full report for a run, loading the baseline if one is promoted. */
export function buildReport(projectRoot: string, runId: string): EvalReport {
  const run = loadRun(projectRoot, runId);
  const baselineId = loadBaselineRunId(projectRoot);
  const baseline = baselineId ? safeLoad(projectRoot, baselineId) : null;
  const diff = diffAgainstBaseline(run, baseline);
  const scorecard = scoreRun(run);
  // The aggregation core is the single decider of the overall verdict: a logical
  // AND over named contributors. No inline pass/fail expression lives here.
  const aggregate = aggregateRun({ run, diff });
  return {
    runId,
    scorecard,
    failing: failingCases(run),
    unjudgedCases: unjudgedIds(run),
    diff,
    overall: aggregate.overall,
    contributors: aggregate.contributors,
  };
}

function safeLoad(projectRoot: string, runId: string): EvalRun | null {
  try {
    return loadRun(projectRoot, runId);
  } catch {
    return null;
  }
}
