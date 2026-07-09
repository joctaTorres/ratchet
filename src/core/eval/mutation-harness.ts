/**
 * Mutation harness: seed one fault at a time through the configured coding
 * agent, run the user's own test suite as the deterministic oracle, and
 * classify each mutant killed (oracle now fails) or survived (oracle still
 * passes) — no external mutation framework.
 *
 * Mirrors `judge.ts`'s division of labor: the agent produces the artifact (a
 * judgment there, a seeded fault here) through the same spawn seam
 * (`resolveAdapter` / `AgentAdapter.buildRequest` / `Spawner`), and the
 * harness only orchestrates the call and interprets the result — it never
 * constructs or parses a patch itself. Fault detection and revert use `git`,
 * invoked through the same `BashRunner` seam `evaluateDeterministic` and
 * `judgeCheck` already shell out with — not a new dependency.
 *
 * Fail-closed preconditions, both checked before anything is seeded:
 *
 *   1. Clean working tree — the harness refuses to seed anything unless the
 *      project's git working tree is already clean, so a seeded fault can never
 *      be misattributed to — or destroy — a user's pre-existing uncommitted
 *      work. The cleanliness probe excludes ratchet's own transient run
 *      directory (`.ratchet/evals/runs`), because `eval run` persists the run
 *      record there BEFORE the invariant gate runs — in a repo that tracks
 *      `.ratchet/` that freshly-written record would otherwise count as a dirty
 *      tree and the mutation invariant could never evaluate. Any other
 *      uncommitted path still marks the tree unusable.
 *
 *   2. Green baseline — after the tree is confirmed clean, the harness runs the
 *      invariant's own `test` command ONCE on the unmutated tree and requires it
 *      to exit 0. This is the load-bearing anti-vacuity check: the oracle
 *      classifies a mutant `killed` on a non-zero exit and `survived` on exit 0,
 *      so a suite that is ALREADY red on the clean tree would classify every
 *      seeded mutant `killed` regardless of the mutation, producing zero
 *      survivors and a silently vacuous `pass` — the exact gaming hole the
 *      mutation invariant exists to close. A red baseline therefore seeds
 *      nothing and returns `oracle-not-green`, which the evaluator maps to
 *      `unevaluable` (never `pass`). A baseline oracle that cannot run at all
 *      (throws) is not caught here: it propagates so the evaluator records it as
 *      "harness could not run", distinct from "ran but red".
 *
 * Deliberately NOT wired into `evaluateInvariant`/`evaluateMutation` yet:
 * reducing this harness's per-mutant outcomes into an `InvariantOutcome` with
 * budget/threshold semantics is `mutation-evaluator-fold`'s job, exactly as
 * `web-deterministic-fold` was a separate change from `web-lifecycle-harness`.
 */

import type { MutationInvariant } from './invariants.js';
import {
  realBashRunner,
  realSpawner,
  resolveAdapter,
  buildAgentSpawnRequest,
  type BashRunner,
  type BashResult,
  type Spawner,
  type AgentRequestContext,
  type AgentSpawnRequest,
} from '../batch/engine/index.js';

/** One seeded-and-classified mutant: its diff, kill/survive verdict, and the oracle run that decided it. */
export interface MutantOutcome {
  /** 0-based attempt number within the budget-bounded loop (not re-indexed past skipped no-diff attempts). */
  index: number;
  /** Unified diff of the seeded fault, captured via `git diff --cached`. */
  diff: string;
  outcome: 'killed' | 'survived';
  /** The oracle (`invariant.test`) run that decided the verdict. */
  testResult: BashResult;
}

export type MutationHarnessOutcome =
  | { kind: 'unusable-working-tree'; reason: string }
  | { kind: 'oracle-not-green'; reason: string }
  | { kind: 'completed'; mutants: MutantOutcome[] };

/** The persisted, project-relative form of a `MutantOutcome`'s in-memory `diff`/`testResult`. */
export interface MutantEvidence {
  index: number;
  outcome: 'killed' | 'survived';
  diffPath: string;
  testOutputPath: string;
}

export interface MutationHarnessDeps {
  bash?: BashRunner;
  spawner?: Spawner;
  /** Agent name for the seeding subprocess (default resolves the engine default). */
  agentName?: string;
}

/**
 * Ratchet's own transient run directory, project-relative. `eval run` persists
 * a run record here BEFORE the invariant gate runs, so it is ratchet-owned and
 * off-limits to the harness's dirtiness probe AND to its revert. Both the probe
 * exclusion and the revert's `git clean` exclusion derive from this single
 * constant so they cannot drift apart on the excluded path.
 */
const EVAL_RUNS_RELATIVE_PATH = '.ratchet/evals/runs';

/**
 * The working-tree cleanliness probe. Excludes ratchet's own transient run
 * directory (`.ratchet/evals/runs`) via a git exclude pathspec so a persisted
 * run record does not count as a dirty tree, while any other uncommitted path
 * still does. Runs through `bash -c`, so the pathspec is single-quoted to keep
 * `:(exclude)` intact.
 */
export const WORKING_TREE_PROBE = `git status --porcelain -- . ':(exclude)${EVAL_RUNS_RELATIVE_PATH}'`;

/**
 * The per-attempt revert. Restores tracked state (`git reset --hard HEAD`) and
 * removes untracked files/dirs (`git clean -fd`) — but excludes ratchet's own
 * transient run directory (`-e .ratchet/evals/runs`) so reverting a seeded
 * mutant never deletes the in-progress run record, matching the probe's
 * exclusion. `git clean` already skips gitignored files; the `-e` makes the
 * exclusion hold even when the consuming repo does NOT gitignore the runs dir.
 * The excluded path needs no quoting through `bash -c`.
 */
const REVERT_COMMAND = `git reset --hard HEAD && git clean -fd -e ${EVAL_RUNS_RELATIVE_PATH}`;

/** Build the seed instructions a spawned agent reads from stdin. */
export function buildSeedInstructions(invariant: MutationInvariant): string {
  return [
    'You are an eval MUTATION SEEDER. Introduce exactly ONE small, discrete fault',
    "into this project's existing, non-test source code — the kind of subtle bug a",
    'real regression could introduce (e.g. flip a comparison operator, off-by-one an',
    'index or boundary, invert a boolean, swap an argument order, drop a null check).',
    '',
    'Rules — follow them exactly:',
    '  1. Edit exactly one file, and make the smallest plausible change that',
    '     introduces a real behavioral fault.',
    '  2. NEVER edit a test file, spec file, or anything under a test/spec',
    '     directory — the fault must land in production source only.',
    '  3. Do NOT run the test suite yourself, and do not run any other command.',
    '  4. Do NOT explain the fault, ask questions, or produce any other output.',
    '     Make the edit directly with your file-editing tools, then stop.',
    '',
    `This project's test command is: ${invariant.test}`,
    'It will be run against your seeded fault after you finish; you do not run it.',
  ].join('\n');
}

/** A minimal, fully-typed adapter context; adapters ignore it when building argv. */
function seedContext(invariant: MutationInvariant): AgentRequestContext {
  return { batch: 'eval', change: invariant.id };
}

/**
 * The env var that overrides the mutation seeder's coding-agent spawn. Declared
 * locally so the seeder's override seam is self-documenting; the override GATE
 * itself lives in the shared `buildAgentSpawnRequest` helper so the engine, the
 * judge, and the mutation harness share one override seam (the #67
 * triplication), mirroring `judge.ts`'s `buildVoteRequest` exactly.
 */
const EVAL_AGENT_CMD_ENV = 'RATCHET_EVAL_AGENT_CMD';

/**
 * Build the spawn request for one seed attempt through the shared override-aware
 * helper. When `RATCHET_EVAL_AGENT_CMD` is active, that command stands in for
 * the coding-agent binary (deterministic e2e testing); otherwise the configured
 * adapter is resolved as usual. The override gate exists in exactly one place
 * (`buildAgentSpawnRequest`); the closure here owns only the seeder's
 * site-specific adapter resolution.
 */
function buildSeedRequest(invariant: MutationInvariant, cwd: string, agentName?: string): AgentSpawnRequest {
  const instructions = buildSeedInstructions(invariant);
  const { request } = buildAgentSpawnRequest({
    overrideEnvVar: EVAL_AGENT_CMD_ENV,
    instructions,
    cwd,
    env: process.env,
    buildAdapterRequest: () => resolveAdapter(agentName).buildRequest(seedContext(invariant), instructions, cwd, process.env),
  });
  return request;
}

/**
 * Fail-closed precondition: the working tree must be a clean git repository
 * before anything is seeded. A non-empty `WORKING_TREE_PROBE` (dirty tree
 * outside the excluded runs dir), a non-zero exit (not a git repository, or
 * git unavailable), or a thrown bash call (git binary missing) are all treated
 * as unusable — never distinguished further, since the harness cannot safely
 * proceed on any of them.
 */
async function checkWorkingTree(bash: BashRunner, cwd: string): Promise<{ clean: true } | { clean: false; reason: string }> {
  let result: BashResult;
  try {
    result = await bash(WORKING_TREE_PROBE, cwd);
  } catch (err) {
    return { clean: false, reason: `'${WORKING_TREE_PROBE}' could not run: ${(err as Error).message}` };
  }
  if (result.exitCode !== 0) {
    return {
      clean: false,
      reason: `'${WORKING_TREE_PROBE}' exited non-zero; not a usable git working tree (not a git repository, or git is unavailable).`,
    };
  }
  if (result.stdout.trim().length > 0) {
    return { clean: false, reason: 'the git working tree has uncommitted changes; refusing to seed mutants against a dirty tree.' };
  }
  return { clean: true };
}

/**
 * Green-baseline precondition: run the invariant's own `test` command once on
 * the clean, unmutated tree and require exit 0 before any mutant is seeded.
 *
 * This is what stops a vacuous pass. The oracle decides `killed` on a non-zero
 * exit; if the suite is already red on the clean tree, EVERY seeded mutant would
 * exit non-zero and be scored `killed` no matter what was mutated, so the run
 * would report zero survivors and pass while proving nothing. Requiring a green
 * baseline guarantees a subsequent non-zero exit is attributable to the seeded
 * fault, which is the whole premise of the kill/survive classification.
 *
 * The oracle run reverts unconditionally in a `finally` (the same scoped revert
 * the seed loop uses), so any artifact the test command writes cannot leak into
 * the first mutant's `git diff --cached`, and the tree is left exactly as clean
 * as it was found. Only a non-zero EXIT becomes `{ green: false }` here; a
 * thrown bash call (oracle binary missing) is deliberately NOT caught, so it
 * propagates to `runMutationHarness`'s caller as a genuine "could not run at
 * all" failure — distinct from "ran and was red".
 */
async function checkOracleBaseline(
  bash: BashRunner,
  test: string,
  cwd: string
): Promise<{ green: true } | { green: false; reason: string }> {
  let result: BashResult;
  try {
    result = await bash(test, cwd);
  } finally {
    await bash(REVERT_COMMAND, cwd);
  }
  if (result.exitCode !== 0) {
    return {
      green: false,
      reason: `the oracle test command '${test}' did not pass on the clean baseline tree (exit ${result.exitCode}); refusing to seed mutants, because a suite that is already red would score every mutant 'killed' and yield a vacuously passing invariant.`,
    };
  }
  return { green: true };
}

/**
 * Run the mutation harness. Two fail-closed preconditions gate the seed loop,
 * checked in order and seeding nothing if either fails: the working tree must be
 * clean (`unusable-working-tree`), and the invariant's `test` command must pass
 * once on that clean tree (`oracle-not-green`). The green-baseline gate is what
 * prevents a vacuous pass — see `checkOracleBaseline` — since an already-red
 * suite would score every mutant `killed` and report no survivors.
 *
 * Then, for up to `invariant.budget` attempts, spawn the
 * configured agent to seed one fault, detect it via `git diff --cached`
 * (an empty diff is not a mutant and never reaches the oracle), run
 * `invariant.test` as the deterministic oracle, classify
 * `exitCode === 0` as `survived` and non-zero as `killed`, and unconditionally
 * revert with `git reset --hard HEAD && git clean -fd -e .ratchet/evals/runs`
 * before the next attempt — leaving the working tree exactly as it started,
 * whether the mutant was killed, survived, seeded no diff, or the attempt
 * threw. The clean excludes ratchet's transient runs dir (`.ratchet/evals/runs`)
 * so it never deletes the in-progress run record, matching the probe exclusion.
 * The revert lives in a `finally` so a throw from the spawner or the oracle
 * reverts the seeded mutant before propagating, never leaving a fault in the
 * user's tree.
 */
export async function runMutationHarness(
  invariant: MutationInvariant,
  cwd: string,
  deps: MutationHarnessDeps = {}
): Promise<MutationHarnessOutcome> {
  const bash = deps.bash ?? realBashRunner;
  const spawner = deps.spawner ?? realSpawner;

  const treeState = await checkWorkingTree(bash, cwd);
  if (!treeState.clean) {
    return { kind: 'unusable-working-tree', reason: treeState.reason };
  }

  // Green-baseline gate: the oracle must pass on the unmutated tree, or the
  // kill/survive classification is meaningless and every mutant would score
  // `killed` vacuously. Runs AFTER the cleanliness check and reverts itself, so
  // it never dirties the tree the seed loop is about to mutate.
  const baseline = await checkOracleBaseline(bash, invariant.test, cwd);
  if (!baseline.green) {
    return { kind: 'oracle-not-green', reason: baseline.reason };
  }

  const mutants: MutantOutcome[] = [];
  for (let attempt = 0; attempt < invariant.budget; attempt++) {
    try {
      const request = buildSeedRequest(invariant, cwd, deps.agentName);
      await spawner(request);

      await bash('git add -A', cwd);
      const diffResult = await bash('git diff --cached', cwd);
      if (diffResult.stdout.trim().length === 0) {
        // No fault was seeded this attempt: not a mutant, oracle never run.
        // `finally` still reverts (a harmless no-op).
        continue;
      }

      const testResult = await bash(invariant.test, cwd);
      const outcome: MutantOutcome['outcome'] = testResult.exitCode === 0 ? 'survived' : 'killed';
      mutants.push({ index: attempt, diff: diffResult.stdout, outcome, testResult });
    } finally {
      // Unconditional revert: leaves the working tree exactly as it started,
      // whether the mutant was killed/survived, no diff was seeded, or the
      // spawner/oracle threw (in which case the error re-propagates after this).
      await bash(REVERT_COMMAND, cwd);
    }
  }

  return { kind: 'completed', mutants };
}
