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
 * (`aggregate.ts`) — as a logical AND over named contributors.
 *
 * The run-level invariant gate is the one async, spawning, tree-touching step in
 * the pipeline, so it is split across two entry points by responsibility:
 *   - `evaluateRun` (run path, `eval run`) evaluates the gate WITH the spawner and
 *     PERSISTS the reduced result (`InvariantGateResult`) onto the run.
 *   - `renderReport` (report path, `eval report`) is PURE: it reads the persisted
 *     gate and computes the report from persisted data, never evaluating the gate,
 *     spawning an agent, running a shell command, or mutating the working tree.
 * A run with no persisted gate (invariants disabled, or a legacy run) renders its
 * invariants "not evaluated" — a neutral, gate-neutral state, never a re-eval.
 */

import type { EvalRun } from './run.js';
import { loadRun, loadBaselineRunId, persistRun } from './run.js';
import type { ClauseResult, JurorVote, Verdict } from './judge.js';
import type { WebArtifacts } from './web-lifecycle.js';
import { aggregateRun, DEFAULT_CONTRIBUTORS, type ContributorOutcome } from './aggregate.js';
import { evaluateInvariantGate, type InvariantGateResult } from './invariant-gate.js';
import type { InvariantOutcome, FileReader } from './invariant-evaluator.js';
import type { BashRunner, Spawner } from '../batch/engine/index.js';
import type { SkipReason } from './skip.js';

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
  skip?: SkipReason;
  artifacts?: WebArtifacts;
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
   *  when the `invariants` contributor is disabled, nothing is declared, or the
   *  run carries no persisted gate). */
  invariants: InvariantOutcome[];
  /**
   * Whether the run carries a persisted invariant gate. `true` when the gate was
   * evaluated at run time (even if it declared nothing — an empty, passing set).
   * `false` for a run whose invariants were disabled or that predates gate
   * persistence: its invariants are rendered "not evaluated" and take no part in
   * the verdict.
   */
  invariantsEvaluated: boolean;
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
      ...(record?.artifacts ? { artifacts: record.artifacts } : {}),
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

/** The enabled contributor set for a run: `run.gate` when recorded, else the full
 *  built-in set (a legacy run with no gate ANDs over every built-in). */
function contributorsFor(run: EvalRun) {
  return run.gate ? DEFAULT_CONTRIBUTORS.filter((c) => run.gate!.includes(c.id)) : DEFAULT_CONTRIBUTORS;
}

/**
 * Assemble the `EvalReport` from already-resolved inputs. This is the pure,
 * I/O-free core shared by the run and report paths: it computes the scorecard,
 * per-case detail, and the overall verdict via the aggregation core, and never
 * evaluates the invariant gate — the gate result is passed in (`gate`), either
 * freshly evaluated (run path) or read back from the run (report path). The
 * overall verdict is decided in exactly one place, the aggregation core, as a
 * logical AND over the contributors that gated the run — a disabled contributor
 * takes no part.
 */
function assembleReport(
  run: EvalRun,
  runId: string,
  diff: BaselineDiff,
  gate: InvariantGateResult | undefined,
  invariantsEvaluated: boolean
): EvalReport {
  const aggregate = aggregateRun({ run, diff, invariants: gate }, contributorsFor(run));
  return {
    runId,
    scorecard: scoreRun(run),
    failing: failingCases(run),
    unjudgedCases: unjudgedIds(run),
    cases: caseDetails(run),
    diff,
    overall: aggregate.overall,
    contributors: aggregate.contributors,
    invariants: gate?.outcomes ?? [],
    invariantsEvaluated,
    ...(gate?.loadError ? { loadError: gate.loadError } : {}),
  };
}

/** Injectable seams for the run path's gate evaluation; all default to the real
 *  runners so `eval run` spawns the real agent while tests inject fakes. */
export interface EvaluateRunDeps {
  bash?: BashRunner;
  readFile?: FileReader;
  spawner?: Spawner;
  agentName?: string;
}

/**
 * Run path (`eval run`). Evaluate the run-level invariant gate WITH the spawner
 * and PERSIST its full result onto the run, then assemble the report. The gate is
 * evaluated only when the `invariants` contributor is in the enabled set — a
 * disabled contributor runs no manifest command — and its reduced result is
 * written back to `run.invariantGate` so the read-only `renderReport` path can
 * later render the same verdict without re-evaluating, re-spawning, or mutating
 * the tree. Preserves `eval run` behavior exactly: it still evaluates, gates, and
 * persists the mutation harness evidence and `outcome.json`.
 */
export async function evaluateRun(
  projectRoot: string,
  runId: string,
  deps: EvaluateRunDeps = {}
): Promise<EvalReport> {
  const run = loadRun(projectRoot, runId);
  const baselineId = loadBaselineRunId(projectRoot);
  const baseline = baselineId ? safeLoad(projectRoot, baselineId) : null;
  const diff = diffAgainstBaseline(run, baseline);
  const invariantsEnabled = contributorsFor(run).some((c) => c.id === 'invariants');
  if (!invariantsEnabled) {
    // The gate is not evaluated and nothing is persisted; the report renders the
    // invariants "not evaluated".
    return assembleReport(run, runId, diff, undefined, false);
  }
  const gate = await evaluateInvariantGate({
    projectRoot,
    run,
    baseline,
    bash: deps.bash,
    readFile: deps.readFile,
    spawner: deps.spawner,
    agentName: deps.agentName,
  });
  run.invariantGate = gate;
  persistRun(projectRoot, run);
  return assembleReport(run, runId, diff, gate, true);
}

/**
 * Report path (`eval report`). PURE and synchronous: read the run and its
 * persisted invariant gate (`run.invariantGate`) and compute the report from
 * persisted data. It never evaluates the gate, spawns an agent, runs a shell
 * command, loads the manifest, or touches the working tree — so reporting a run
 * has no side effects. A run with no persisted gate (invariants disabled, or a
 * legacy run) is rendered `invariantsEvaluated: false` — "not evaluated" — which
 * takes no part in the verdict.
 */
export function renderReport(projectRoot: string, runId: string): EvalReport {
  const run = loadRun(projectRoot, runId);
  const baselineId = loadBaselineRunId(projectRoot);
  const baseline = baselineId ? safeLoad(projectRoot, baselineId) : null;
  const diff = diffAgainstBaseline(run, baseline);
  const gate = run.invariantGate;
  return assembleReport(run, runId, diff, gate, gate !== undefined);
}

function safeLoad(projectRoot: string, runId: string): EvalRun | null {
  try {
    return loadRun(projectRoot, runId);
  } catch {
    return null;
  }
}
