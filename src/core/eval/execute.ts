/**
 * Orchestrate an eval run: enumerate the in-scope set, resolve bindings, judge
 * every bound case through the engine seams against its fixture working copy,
 * and assemble a persisted run. Unbound cases are recorded `unjudged`, never
 * passed. The judge seams are injected so tests never shell out or spawn.
 */

import { enumerateEvalSet, type EvalCase, type EvalScope } from './set.js';
import { loadEvalSpecs, resolveBinding, type ResolvedBinding } from './spec.js';
import { FixtureManager, type FixtureManagerDeps } from './fixture.js';
import { judgeCase, type JudgeMode, type JudgeDeps } from './judge.js';
import {
  generateRunId,
  persistRun,
  toSnapshot,
  type EvalRun,
  type CaseRecord,
} from './run.js';

export interface RunOptions {
  scope: EvalScope;
  mode: JudgeMode;
  /** Injected judge seams (bash/spawner) for deterministic tests. */
  judge?: JudgeDeps;
  fixtures?: FixtureManagerDeps;
  /** Override the run id / clock (tests). */
  runId?: string;
  now?: Date;
}

export interface RunOutcome {
  run: EvalRun;
  /** Absolute path the run was persisted to. */
  path: string;
  warnings: string[];
}

const UNBOUND: CaseRecord = {
  verdict: 'unjudged',
  reason: 'No eval-spec binding for this case; recorded unjudged (never passed).',
  source: 'judged',
};

async function judgeBound(
  c: EvalCase,
  bound: ResolvedBinding,
  mode: JudgeMode,
  fixtures: FixtureManager,
  judge: JudgeDeps
): Promise<CaseRecord> {
  const { cwd } = await fixtures.materialize(bound.binding.fixture, bound.binding.setup);
  const verdict = await judgeCase(c, bound.binding, cwd, mode, judge);
  return { verdict: verdict.verdict, reason: verdict.reason, source: 'judged' };
}

/** Run the eval over the in-scope set and persist the result. */
export async function executeRun(projectRoot: string, options: RunOptions): Promise<RunOutcome> {
  const cases = enumerateEvalSet(projectRoot, options.scope);
  const specs = loadEvalSpecs(projectRoot);
  const fixtures = new FixtureManager(projectRoot, options.fixtures);

  const run: EvalRun = {
    runId: options.runId ?? generateRunId(options.now),
    createdAt: (options.now ?? new Date()).toISOString(),
    judgeMode: options.mode,
    scope: { kind: options.scope.kind, target: options.scope.target },
    cases: [],
    verdicts: {},
  };

  for (const c of cases) {
    const bound = resolveBinding(specs, c.id);
    run.cases.push(toSnapshot(c, bound?.binding.kind ?? null));
    run.verdicts[c.id] = bound
      ? await judgeBound(c, bound, options.mode, fixtures, options.judge ?? {})
      : { ...UNBOUND };
  }

  const path = persistRun(projectRoot, run);
  return { run, path, warnings: specs.warnings };
}
