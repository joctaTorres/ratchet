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
 * Every seam (`bash`/`spawner`) is injected so no test shells out to a real
 * git command or spawns a real coding agent.
 */
import { describe, it, expect } from 'vitest';
import { runMutationHarness, buildSeedInstructions } from '../../../src/core/eval/mutation-harness.js';
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
      'git status --porcelain': CLEAN,
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
      'git status --porcelain': CLEAN,
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
      'git status --porcelain': CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': A_DIFF,
      'pnpm test': TEST_PASS,
      [REVERT]: CLEAN,
    });

    await runMutationHarness(invariant({ budget: 2 }), '/work', { bash, spawner });

    expect(sequence).toEqual([
      'bash:git status --porcelain',
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
      'git status --porcelain': CLEAN,
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
      'git status --porcelain': CLEAN,
      'git add -A': CLEAN,
      'git diff --cached': NO_DIFF,
    });

    const outcome = await runMutationHarness(invariant({ budget: 1 }), '/work', { bash, spawner });

    expect(outcome).toEqual({ kind: 'completed', mutants: [] });
    expect(bashCalls.some((c) => c.command === 'pnpm test')).toBe(false);
    expect(bashCalls.some((c) => c.command === REVERT)).toBe(false);
  });

  it('seeds through the same resolved agent adapter and spawn seam the llm-judge binding uses, for every registered agent', async () => {
    const inv = invariant({ budget: 1 });
    const instructions = buildSeedInstructions(inv);
    for (const agentName of availableAdapters()) {
      const { bash, spawner, spawnRequests } = makeSeams({
        'git status --porcelain': CLEAN,
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
      'git status --porcelain': CLEAN,
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
      'git status --porcelain': DIRTY,
    });

    const outcome = await runMutationHarness(invariant({ budget: 3 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('unusable-working-tree');
    expect(spawnRequests).toHaveLength(0);
    expect(bashCalls.some((c) => c.command === 'pnpm test')).toBe(false);
  });

  it('reports the working tree as unusable and seeds nothing when the directory is not a git repository', async () => {
    const { bash, spawner, spawnRequests } = makeSeams({
      'git status --porcelain': NOT_A_REPO,
    });

    const outcome = await runMutationHarness(invariant({ budget: 3 }), '/work', { bash, spawner });

    expect(outcome.kind).toBe('unusable-working-tree');
    expect(spawnRequests).toHaveLength(0);
  });
});
