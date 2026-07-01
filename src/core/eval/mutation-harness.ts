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
 * Fail-closed precondition: the harness refuses to seed anything unless the
 * project's git working tree is already clean (`git status --porcelain`), so
 * a seeded fault can never be misattributed to — or destroy — a user's
 * pre-existing uncommitted work.
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
  | { kind: 'completed'; mutants: MutantOutcome[] };

export interface MutationHarnessDeps {
  bash?: BashRunner;
  spawner?: Spawner;
  /** Agent name for the seeding subprocess (default resolves the engine default). */
  agentName?: string;
}

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
 * Build the spawn request for one seed attempt. When `RATCHET_EVAL_AGENT_CMD`
 * is set, that command stands in for the coding-agent binary (used by e2e
 * tests to exercise the agent path deterministically without a real agent).
 * Otherwise the configured adapter is resolved as usual — mirrors `judge.ts`'s
 * `buildVoteRequest` exactly, so there is no agent-specific branch here.
 */
function buildSeedRequest(invariant: MutationInvariant, cwd: string, agentName?: string): AgentSpawnRequest {
  const instructions = buildSeedInstructions(invariant);
  const override = process.env.RATCHET_EVAL_AGENT_CMD;
  if (override && override.trim().length > 0) {
    return { command: 'bash', args: ['-c', override], instructions, cwd, env: process.env };
  }
  const adapter = resolveAdapter(agentName);
  return adapter.buildRequest(seedContext(invariant), instructions, cwd, process.env);
}

/**
 * Fail-closed precondition: the working tree must be a clean git repository
 * before anything is seeded. A non-empty `git status --porcelain` (dirty
 * tree), a non-zero exit (not a git repository, or git unavailable), or a
 * thrown bash call (git binary missing) are all treated as unusable — never
 * distinguished further, since the harness cannot safely proceed on any of
 * them.
 */
async function checkWorkingTree(bash: BashRunner, cwd: string): Promise<{ clean: true } | { clean: false; reason: string }> {
  let result: BashResult;
  try {
    result = await bash('git status --porcelain', cwd);
  } catch (err) {
    return { clean: false, reason: `'git status --porcelain' could not run: ${(err as Error).message}` };
  }
  if (result.exitCode !== 0) {
    return {
      clean: false,
      reason: "'git status --porcelain' exited non-zero; not a usable git working tree (not a git repository, or git is unavailable).",
    };
  }
  if (result.stdout.trim().length > 0) {
    return { clean: false, reason: 'the git working tree has uncommitted changes; refusing to seed mutants against a dirty tree.' };
  }
  return { clean: true };
}

/**
 * Run the mutation harness: for up to `invariant.budget` attempts, spawn the
 * configured agent to seed one fault, detect it via `git diff --cached`
 * (an empty diff is not a mutant and never reaches the oracle), run
 * `invariant.test` as the deterministic oracle, classify
 * `exitCode === 0` as `survived` and non-zero as `killed`, and unconditionally
 * revert with `git reset --hard HEAD && git clean -fd` before the next
 * attempt — leaving the working tree exactly as it started, whether the
 * mutant was killed or survived.
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

  const mutants: MutantOutcome[] = [];
  for (let attempt = 0; attempt < invariant.budget; attempt++) {
    const request = buildSeedRequest(invariant, cwd, deps.agentName);
    await spawner(request);

    await bash('git add -A', cwd);
    const diffResult = await bash('git diff --cached', cwd);
    if (diffResult.stdout.trim().length === 0) {
      // No fault was seeded this attempt: not a mutant, oracle never run.
      continue;
    }

    const testResult = await bash(invariant.test, cwd);
    const outcome: MutantOutcome['outcome'] = testResult.exitCode === 0 ? 'survived' : 'killed';
    mutants.push({ index: attempt, diff: diffResult.stdout, outcome, testResult });

    await bash('git reset --hard HEAD && git clean -fd', cwd);
  }

  return { kind: 'completed', mutants };
}
