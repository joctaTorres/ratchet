/**
 * Unit tests for the mutation harness.
 *
 * Implements features/mutation-harness/seed-and-classify.feature (seed one
 * mutant at a time through the configured agent's spawn seam, run the user's
 * test command as the oracle, classify killed/survived, budget-bound the
 * attempts, and treat a no-diff attempt as not a mutant) and
 * features/mutation-harness/fail-closed-preconditions.feature (refuse to run
 * against a dirty or non-git working tree, and always leave the tree exactly
 * as it found it, including when a mutant survives).
 *
 * Also implements
 * features/mutation-invariant-harness/working-tree-precondition.feature (the
 * cleanliness probe excludes ratchet's own transient `.ratchet/evals/runs`
 * dir, so a freshly persisted run record does not block seeding, while a
 * genuine change outside that dir still does) and
 * features/mutation-invariant-harness/seed-revert-safety.feature (a throw from
 * the oracle or spawner mid-attempt still reverts the seeded mutant before the
 * error propagates).
 *
 * Every seam (`bash`/`spawner`) is injected so no test shells out to a real
 * git command or spawns a real coding agent.
 */
import { describe, it, expect } from 'vitest';
import { runMutationHarness, buildSeedInstructions, WORKING_TREE_PROBE } from '../../../src/core/eval/mutation-harness.js';
import type { MutationInvariant } from '../../../src/core/eval/invariants.js';
import {
  resolveAdapter,
  availableAdapters,
  type BashRunner,
  type BashResult,
  type Spawner,
  type AgentSpawnRequest,
} from '../../../src/core/batch/engine/index.js';

const invariant = (overrides: Partial<MutationInvariant> = {}): MutationInvariant => ({
  id: 'mutants-are-killed',
  kind: 'mutation',
  active: true,
  test: 'pnpm test',
  budget: 1,
  threshold: 1,
  ...overrides,
});

const CLEAN: BashResult = { exitCode: 0, stdout: '', stderr: '' };
const DIRTY: BashResult = { exitCode: 0, stdout: ' M src/x.ts\n', stderr: '' };
const NOT_A_REPO: BashResult = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' };
const A_DIFF: BashResult = { exitCode: 0, stdout: 'diff --git a/src/x.ts b/src/x.ts\n-a\n+b\n', stderr: '' };
const NO_DIFF: BashResult = { exitCode: 0, stdout: '', stderr: '' };
const TEST_PASS: BashResult = { exitCode: 0, stdout: 'PASS', stderr: '' };
const TEST_FAIL: BashResult = { exitCode: 1, stdout: '', stderr: '1 test failed' };

/**
 * Fake `bash`/`spawner` seams that record a single chronological `sequence`
 * across both, so revert-before-next-seed ordering is provable. A response
 * may be a fixed `BashResult`/`Error` (returned every call) or an array
 * (returned in order, one entry consumed per call, the last entry repeating
 * once exhausted) — needed for a command like `git diff --cached` that
 * returns a different result on each budget-loop attempt.
 */
function makeSeams(bashResponses: Record<string, BashResult | Error | Array<BashResult | Error>>) {
  const sequence: string[] = [];
  const spawnRequests: AgentSpawnRequest[] = [];
  const spawner: Spawner = async (req) => {
    spawnRequests.push(req);
    sequence.push('spawn');
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  };
  const cursors: Record<string, number> = {};
  const bashCalls: Array<{ command: string; cwd: string }> = [];
  const bash: BashRunner = async (command, cwd) => {
    bashCalls.push({ command, cwd });
    sequence.push(`bash:${command}`);
    const entry = bashResponses[command];
    if (entry === undefined) {
      throw new Error(`fake bash: no response configured for command '${command}'`);
    }
    let value: BashResult | Error;
    if (Array.isArray(entry)) {
      const i = cursors[command] ?? 0;
      value = entry[Math.min(i, entry.length - 1)]!;
      cursors[command] = i + 1;
    } else {
      value = entry;
    }
    if (value instanceof Error) throw value;
    return value;
  };
  return { bash, spawner, sequence, spawnRequests, bashCalls };
}

const REVERT = 'git reset --hard HEAD && git clean -fd';

describe('runMutationHarness seeding, oracle, and classification', () => {
  it('classifies a mutant as survived when the test command still passes, and reverts before returning', async () => {
    const { bash, spawner, bashCalls } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': TEST_PASS,
      [REVERT]: CLEAN,
    });

    const outcome = await runMutationHarness(invariant({ budget: 1 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') throw new Error('unreachable');
    expect(outcome.mutants).toEqual([{ index: 0, diff: A_DIFF.stdout, outcome: 'survived', testResult: TEST_PASS }]);
    expect(bashCalls.at(-1)).toEqual({ command: REVERT, cwd: '/work' });
  });

  it('classifies a mutant as killed when the test command now fails, and reverts before returning', async () => {
    const { bash, spawner, bashCalls } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': TEST_FAIL,
      [REVERT]: CLEAN,
    });

    const outcome = await runMutationHarness(invariant({ budget: 1 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') throw new Error('unreachable');
    expect(outcome.mutants).toEqual([{ index: 0, diff: A_DIFF.stdout, outcome: 'killed', testResult: TEST_FAIL }]);
    expect(bashCalls.at(-1)).toEqual({ command: REVERT, cwd: '/work' });
  });

  it('reverts the first mutant before seeding the second, so the second is seeded against the unmutated project', async () => {
    const { bash, spawner, sequence } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': TEST_PASS,
      [REVERT]: CLEAN,
    });

    await runMutationHarness(invariant({ budget: 2 }), '/work', { bash, spawner });

    expect(sequence).toEqual([
      `bash:${WORKING_TREE_PROBE}`,
      'spawn',
      'bash:git add -A',
      'bash:git diff --cached',
      'bash:pnpm test',
      `bash:${REVERT}`,
      'spawn',
      'bash:git add -A',
      'bash:git diff --cached',
      'bash:pnpm test',
      `bash:${REVERT}`,
    ]);
  });

  it('never seeds more mutants than the invariant budget', async () => {
    const { bash, spawner, spawnRequests } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': TEST_PASS,
      [REVERT]: CLEAN,
    });

    const outcome = await runMutationHarness(invariant({ budget: 3 }), '/work', { bash, spawner });

    expect(spawnRequests).toHaveLength(3);
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') throw new Error('unreachable');
    expect(outcome.mutants).toHaveLength(3);
  });

  it('does not count a no-diff attempt as a mutant, and never runs the oracle for it', async () => {
    const { bash, spawner, bashCalls } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': NO_DIFF,
      [REVERT]: CLEAN,
    });

    const outcome = await runMutationHarness(invariant({ budget: 1 }), '/work', { bash, spawner });

    expect(outcome).toEqual({ kind: 'completed', mutants: [] });
    expect(bashCalls.some((c) => c.command === 'pnpm test')).toBe(false);
    // The revert lives in `finally`, so a no-diff attempt still reverts (a
    // harmless no-op) — the tree is guaranteed clean before the next attempt.
    expect(bashCalls.some((c) => c.command === REVERT)).toBe(true);
  });

  it('seeds through the same resolved agent adapter and spawn seam the llm-judge binding uses, for every registered agent', async () => {
    const inv = invariant({ budget: 1 });
    const instructions = buildSeedInstructions(inv);
    for (const agentName of availableAdapters()) {
      const { bash, spawner, spawnRequests } = makeSeams({
        [WORKING_TREE_PROBE]: CLEAN,
        'git add -A': CLEAN,
        'git diff --cached': A_DIFF,
        'pnpm test': TEST_PASS,
        [REVERT]: CLEAN,
      });

      await runMutationHarness(inv, '/work', { bash, spawner, agentName });

      const expected = resolveAdapter(agentName).buildRequest({ batch: 'eval', change: inv.id }, instructions, '/work', process.env);
      expect(spawnRequests).toEqual([expected]);
    }
  });

  it('the working tree matches its starting state after a full multi-mutant run, including when a mutant survives', async () => {
    const { bash, spawner, bashCalls } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': [TEST_PASS, TEST_FAIL], // first mutant survives, second is killed
      [REVERT]: CLEAN,
    });

    const outcome = await runMutationHarness(invariant({ budget: 2 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') throw new Error('unreachable');
    expect(outcome.mutants.map((m) => m.outcome)).toEqual(['survived', 'killed']);
    expect(bashCalls.filter((c) => c.command === REVERT)).toHaveLength(2);
  });
});

describe('runMutationHarness fail-closed preconditions', () => {
  it('reports the working tree as unusable and seeds nothing when the tree has uncommitted changes', async () => {
    const { bash, spawner, spawnRequests, bashCalls } = makeSeams({
      [WORKING_TREE_PROBE]: DIRTY,
    });

    const outcome = await runMutationHarness(invariant({ budget: 3 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('unusable-working-tree');
    expect(spawnRequests).toHaveLength(0);
    expect(bashCalls.some((c) => c.command === 'pnpm test')).toBe(false);
  });

  it('reports the working tree as unusable and seeds nothing when the directory is not a git repository', async () => {
    const { bash, spawner, spawnRequests } = makeSeams({
      [WORKING_TREE_PROBE]: NOT_A_REPO,
    });

    const outcome = await runMutationHarness(invariant({ budget: 3 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('unusable-working-tree');
    expect(spawnRequests).toHaveLength(0);
  });
});

// features/mutation-invariant-harness/working-tree-precondition.feature
describe('runMutationHarness working-tree precondition scopes out ratchet transient runs', () => {
  it('probes with a command that excludes .ratchet/evals/runs so a persisted run record does not count as dirty', async () => {
    // The stubbed probe returns CLEAN — modelling git reporting nothing dirty
    // because the only change (a persisted run record) is excluded by the
    // pathspec — so the harness proceeds to seed rather than reporting unevaluable.
    const { bash, spawner, bashCalls } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': TEST_PASS,
      [REVERT]: CLEAN,
    });

    const outcome = await runMutationHarness(invariant({ budget: 1 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('completed');
    // The probe used must be the runs-dir-excluding form, not the bare `git status --porcelain`.
    expect(bashCalls[0]!.command).toBe(WORKING_TREE_PROBE);
    expect(WORKING_TREE_PROBE).toContain(":(exclude).ratchet/evals/runs");
  });

  it('still reports the tree unusable when a genuine change outside the runs dir is present', async () => {
    // The excluding probe still reports the change, since it lives outside .ratchet/evals/runs.
    const { bash, spawner, spawnRequests } = makeSeams({
      [WORKING_TREE_PROBE]: DIRTY,
    });

    const outcome = await runMutationHarness(invariant({ budget: 1 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('unusable-working-tree');
    if (outcome.kind !== 'unusable-working-tree') throw new Error('unreachable');
    expect(outcome.reason).toContain('git working tree has uncommitted changes');
    expect(spawnRequests).toHaveLength(0);
  });
});

// features/mutation-invariant-harness/seed-revert-safety.feature
describe('runMutationHarness reverts the seeded mutant even when an attempt throws', () => {
  it('reverts the working tree then re-propagates when the oracle throws mid-attempt', async () => {
    const oracleError = new Error('oracle exploded mid-attempt');
    const { bash, spawner, bashCalls } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': oracleError,
      [REVERT]: CLEAN,
    });

    await expect(runMutationHarness(invariant({ budget: 1 }), '/work', { bash, spawner })).rejects.toThrow(
      'oracle exploded mid-attempt'
    );

    // The seeded mutant was reverted before the error propagated.
    expect(bashCalls.at(-1)).toEqual({ command: REVERT, cwd: '/work' });
  });

  it('reverts the working tree then re-propagates when the spawner throws mid-attempt', async () => {
    const spawnError = new Error('agent spawn failed');
    const { bash, bashCalls } = makeSeams({
      [WORKING_TREE_PROBE]: CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': TEST_PASS,
      [REVERT]: CLEAN,
    });
    const spawner: Spawner = async () => {
      throw spawnError;
    };

    await expect(runMutationHarness(invariant({ budget: 1 }), '/work', { bash, spawner })).rejects.toThrow(
      'agent spawn failed'
    );

    // Even though seeding never staged anything, the finally revert still ran.
    expect(bashCalls.at(-1)).toEqual({ command: REVERT, cwd: '/work' });
  });
});
