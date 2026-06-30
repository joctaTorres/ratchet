/**
 * Eval run persistence.
 *
 * One JSON file per run at `.ratchet/evals/runs/<run-id>.json`. The run id is a
 * UTC timestamp plus a short random suffix (batch-journal style), so runs sort
 * chronologically and never collide. A run embeds the case snapshot (id,
 * feature, scenario, source, steps, binding ref) and a verdict map. `record`
 * does an atomic read-modify-write to override a single case's verdict.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { RATCHET_DIR_NAME } from '../config.js';
import type { EvalCase } from './set.js';
import type { ClauseResult, JurorVote, Verdict } from './judge.js';
import type { BindingKind } from './spec.js';
import { isRunComplete, type ContributorId } from './aggregate.js';

export type VerdictSource = 'judged' | 'manual';

export interface CaseSnapshot {
  id: string;
  feature: string;
  scenario: string;
  source: string;
  steps: { keyword: string; text: string }[];
  /** Binding reference: the kind it was judged by, or null when unbound. */
  bindingKind: BindingKind | null;
}

export interface CaseRecord {
  verdict: Verdict;
  /** Evidence for fail / reason for unjudged / note for pass. */
  reason: string;
  source: VerdictSource;
  /** The resolved rubric used to judge the case. Present only on a judged case. */
  rubric?: string[];
  /** The deciding vote's per-clause result (or `votes[0]` on a clean fail/sub-quorum). Present only on a judged case. */
  clauses?: ClauseResult[];
  /** Every juror's individual vote, in cast order. Present only on a judged case. */
  votes?: JurorVote[];
  /** The skip source/detail this case matched. Present only on a `skipped` record. */
  skip?: { source: 'tag' | 'config'; detail: string };
}

export interface EvalRun {
  runId: string;
  createdAt: string;
  scope: { kind: string; target?: string };
  /**
   * The enabled contributor ids that gated this run, in display order. A case
   * bound to a contributor absent here was recorded `unjudged` rather than
   * executed, and `buildReport` ANDs only over these contributors. Absent on
   * legacy runs persisted before the gate existed ⇒ treated as all-enabled.
   */
  gate?: ContributorId[];
  cases: CaseSnapshot[];
  verdicts: Record<string, CaseRecord>;
}

export function runsDir(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'evals', 'runs');
}

export function runPath(projectRoot: string, runId: string): string {
  return path.join(runsDir(projectRoot), `${runId}.json`);
}

export function baselinePath(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'evals', 'baseline.json');
}

/** Generate a sortable run id: `YYYYMMDDTHHMMSSmmmZ-<suffix>`. */
export function generateRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '');
  const suffix = randomBytes(3).toString('hex');
  return `${stamp}-${suffix}`;
}

export function toSnapshot(c: EvalCase, bindingKind: BindingKind | null): CaseSnapshot {
  return {
    id: c.id,
    feature: c.feature,
    scenario: c.scenario,
    source: c.source,
    steps: c.steps.map((s) => ({ keyword: s.keyword, text: s.text })),
    bindingKind,
  };
}

function ensureRunsDir(projectRoot: string): void {
  const dir = runsDir(projectRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Atomically write a run JSON (write to temp, rename into place). */
export function persistRun(projectRoot: string, run: EvalRun): string {
  ensureRunsDir(projectRoot);
  const target = runPath(projectRoot, run.runId);
  const tmp = `${target}.tmp-${randomBytes(3).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(run, null, 2), 'utf-8');
  renameSync(tmp, target);
  return target;
}

export function loadRun(projectRoot: string, runId: string): EvalRun {
  const file = runPath(projectRoot, runId);
  if (!existsSync(file)) {
    throw new Error(`Run '${runId}' not found under .ratchet/evals/runs.`);
  }
  return JSON.parse(readFileSync(file, 'utf-8')) as EvalRun;
}

export function listRunIds(projectRoot: string): string[] {
  const dir = runsDir(projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export interface RecordRequest {
  runId: string;
  caseId: string;
  verdict: Verdict;
  evidence?: string;
}

const VALID_VERDICTS: Verdict[] = ['pass', 'fail', 'unjudged'];

/**
 * Apply a manual verdict override to a run, atomically. Validates that the case
 * exists, the verdict is valid, and a `fail` carries evidence. Leaves the run
 * unchanged and throws on any rejection.
 */
export function recordVerdict(projectRoot: string, req: RecordRequest): EvalRun {
  const run = loadRun(projectRoot, req.runId);
  if (!run.cases.some((c) => c.id === req.caseId)) {
    throw new Error(`Case '${req.caseId}' is not part of run '${req.runId}'.`);
  }
  if (!VALID_VERDICTS.includes(req.verdict)) {
    throw new Error(`Invalid verdict '${req.verdict}'. Use pass | fail | unjudged.`);
  }
  if (req.verdict === 'fail' && !(req.evidence && req.evidence.trim().length > 0)) {
    throw new Error('Recording a "fail" verdict requires --evidence.');
  }
  run.verdicts[req.caseId] = {
    verdict: req.verdict,
    reason: req.evidence?.trim() ?? '',
    source: 'manual',
  };
  persistRun(projectRoot, run);
  return run;
}

export function loadBaselineRunId(projectRoot: string): string | null {
  const file = baselinePath(projectRoot);
  if (!existsSync(file)) return null;
  try {
    return (JSON.parse(readFileSync(file, 'utf-8')) as { runId?: string }).runId ?? null;
  } catch {
    return null;
  }
}

/**
 * Promote a run to baseline (`baseline.json = { runId }`).
 *
 * An incomplete run (any case still `unjudged`) is rejected through the
 * aggregation core's completeness signal, leaving `baseline.json` unchanged, so
 * an incomplete run can never become the regression baseline future runs are
 * judged against.
 */
export function promoteBaseline(projectRoot: string, runId: string): void {
  // Validate the run exists before promoting.
  const run = loadRun(projectRoot, runId);
  if (!isRunComplete(run)) {
    throw new Error(
      `Run '${runId}' is incomplete (some cases are unjudged) and cannot be promoted to baseline.`
    );
  }
  const file = baselinePath(projectRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ runId }, null, 2), 'utf-8');
}
