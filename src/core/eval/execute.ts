/**
 * Orchestrate an eval run: enumerate the in-scope set, resolve bindings, judge
 * every bound case whose contributor is **enabled** through the engine seams
 * against its fixture working copy, and assemble a persisted run.
 *
 * The enabled contributor set (the gate) is the single decision point for which
 * cases run: a bound case whose binding-kind contributor is disabled is recorded
 * `unjudged` (the reason names the disabled contributor) instead of being
 * executed — no fixture is materialized and no judge is spawned for it — so the
 * run stays **incomplete** and cannot be promoted to baseline. Unbound cases are
 * recorded `unjudged` too, never passed. The judge seams are injected so tests
 * never shell out or spawn.
 */

import { enumerateEvalSet, type EvalCase, type EvalScope } from './set.js';
import { loadEvalSpecs, resolveBinding, type ResolvedBinding } from './spec.js';
import { FixtureManager, type FixtureManagerDeps } from './fixture.js';
import { judgeCase, type JudgeDeps } from './judge.js';
import { ALL_CONTRIBUTOR_IDS } from './gate.js';
import type { ContributorId } from './aggregate.js';
import {
  generateRunId,
  persistRun,
  toSnapshot,
  type EvalRun,
  type CaseRecord,
} from './run.js';

export interface RunOptions {
  scope: EvalScope;
  /**
   * The enabled contributor set. A bound case whose binding-kind contributor is
   * not in this set is recorded `unjudged` instead of executed.
   */
  gate: Set<ContributorId>;
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

/** Record a case left unjudged because its binding-kind contributor is disabled. */
function disabledContributor(contributor: ContributorId): CaseRecord {
  return {
    verdict: 'unjudged',
    reason: `Contributor '${contributor}' is disabled for this run; case recorded unjudged (never executed).`,
    source: 'judged',
  };
}

async function judgeBound(
  c: EvalCase,
  bound: ResolvedBinding,
  fixtures: FixtureManager,
  judge: JudgeDeps
): Promise<CaseRecord> {
  const { cwd } = await fixtures.materialize(bound.binding.fixture, bound.binding.setup);
  // The gate already decided this case runs; judge it by its bound kind.
  const verdict = await judgeCase(c, bound.binding, cwd, judge);
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
    scope: { kind: options.scope.kind, target: options.scope.target },
    gate: ALL_CONTRIBUTOR_IDS.filter((id) => options.gate.has(id)),
    cases: [],
    verdicts: {},
  };

  for (const c of cases) {
    const bound = resolveBinding(specs, c.id);
    run.cases.push(toSnapshot(c, bound?.binding.kind ?? null));
    if (!bound) {
      run.verdicts[c.id] = { ...UNBOUND };
      continue;
    }
    // A bound case's contributor is its binding kind (deterministic | llm-judge).
    const contributor = bound.binding.kind as ContributorId;
    run.verdicts[c.id] = options.gate.has(contributor)
      ? await judgeBound(c, bound, fixtures, options.judge ?? {})
      : disabledContributor(contributor);
  }

  const path = persistRun(projectRoot, run);
  return { run, path, warnings: specs.warnings };
}
