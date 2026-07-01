// Implements features/eval-invariants/kinds-evaluator.feature,
// features/mutation-evaluator-fold/mutation-outcome.feature, and
// features/mutation-evidence-recording/replayable-evidence.feature — the
// per-invariant evaluator that computes one pass / fail / unevaluable outcome
// for each of the four invariant kinds, fail-closed on anything it cannot
// evaluate, and (for `mutation`) persists every mutant's diff/oracle output as
// durable run evidence and memoizes the reduced outcome per run.
import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  evaluateInvariant,
  isInvariantViolation,
  MEASURE_RESOLVERS,
} from '../../../src/core/eval/invariant-evaluator.js';
import type {
  DeterministicInvariant,
  MonotonicInvariant,
  SnapshotInvariant,
  MutationInvariant,
} from '../../../src/core/eval/invariants.js';
import type { EvalRun, CaseSnapshot } from '../../../src/core/eval/run.js';
import type { BashRunner, BashResult, Spawner } from '../../../src/core/batch/engine/index.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'invariant-eval-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** A run with `caseCount` cases — the scenario-count measure is `cases.length`. */
function runWith(caseCount: number): EvalRun {
  const cases: CaseSnapshot[] = Array.from({ length: caseCount }, (_, i) => ({
    id: `f/x#${i}`,
    feature: 'F',
    scenario: `S${i}`,
    source: 'f/x.feature',
    steps: [],
    bindingKind: null,
  }));
  return { runId: 'r', createdAt: 't', scope: { kind: 'store' }, cases, verdicts: {} };
}

const bashReturning =
  (stdout: string, exitCode: number | null = 0, stderr = ''): BashRunner =>
  async () => ({ exitCode, stdout, stderr });

const bashThrows: BashRunner = async () => {
  throw new Error('spawn failed');
};

describe('evaluateInvariant: deterministic', () => {
  const inv: DeterministicInvariant = {
    id: 'tests-still-exist',
    kind: 'deterministic',
    active: true,
    check: { run: 'test -d test', pass: 'contains:ok' },
  };

  it('passes when the predicate meets its pass condition, recording the condition', async () => {
    const o = await evaluateInvariant(inv, {
      projectRoot: '/p',
      run: runWith(1),
      baseline: null,
      bash: bashReturning('all ok here'),
    });
    expect(o.status).toBe('pass');
    expect(isInvariantViolation(o)).toBe(false);
    expect(o.evidence).toContain('contains:ok');
  });

  it('runs the predicate at the project root', async () => {
    let usedCwd = '';
    const bash: BashRunner = async (_cmd, cwd) => {
      usedCwd = cwd;
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };
    await evaluateInvariant(inv, { projectRoot: '/proj', run: runWith(1), baseline: null, bash });
    expect(usedCwd).toBe('/proj');
  });

  it('is a violation when the predicate does not meet its condition, recording the output', async () => {
    const o = await evaluateInvariant(inv, {
      projectRoot: '/p',
      run: runWith(1),
      baseline: null,
      bash: bashReturning('nope nothing matched'),
    });
    expect(o.status).toBe('fail');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toContain('nope nothing matched');
  });

  it('fails closed to unevaluable when the predicate cannot run', async () => {
    const o = await evaluateInvariant(inv, {
      projectRoot: '/p',
      run: runWith(1),
      baseline: null,
      bash: bashThrows,
    });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/could not be evaluated/i);
    expect(o.evidence).toContain('spawn failed');
  });
});

describe('evaluateInvariant: monotonic', () => {
  const inv: MonotonicInvariant = {
    id: 'spec-not-weakened',
    kind: 'monotonic',
    active: true,
    measure: 'scenario-count',
  };

  it('exposes the ecosystem-neutral scenario-count measure', () => {
    expect(MEASURE_RESOLVERS['scenario-count'](runWith(7))).toBe(7);
  });

  it('passes when the current measure has not decreased, recording both values', async () => {
    const o = await evaluateInvariant(inv, {
      projectRoot: '/p',
      run: runWith(12),
      baseline: runWith(10),
    });
    expect(o.status).toBe('pass');
    expect(o.measure).toBe('scenario-count: 12 (baseline 10)');
  });

  it('passes when the current measure equals the baseline', async () => {
    const o = await evaluateInvariant(inv, { projectRoot: '/p', run: runWith(10), baseline: runWith(10) });
    expect(o.status).toBe('pass');
  });

  it('is a violation when the current measure has decreased, recording both values', async () => {
    const o = await evaluateInvariant(inv, { projectRoot: '/p', run: runWith(8), baseline: runWith(10) });
    expect(o.status).toBe('fail');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.measure).toBe('scenario-count: 8 (baseline 10)');
  });

  it('fails closed to unevaluable when there is no baseline measure', async () => {
    const o = await evaluateInvariant(inv, { projectRoot: '/p', run: runWith(12), baseline: null });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/baseline measure .* was missing/i);
  });

  it('fails closed to unevaluable when the measure name cannot be resolved', async () => {
    const unknown: MonotonicInvariant = { ...inv, measure: 'lines-of-code' };
    const o = await evaluateInvariant(unknown, { projectRoot: '/p', run: runWith(12), baseline: runWith(10) });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/unknown measure/i);
  });
});

describe('evaluateInvariant: snapshot', () => {
  function snapshotInvariant(golden: string): SnapshotInvariant {
    return {
      id: 'public-api-unchanged',
      kind: 'snapshot',
      active: true,
      golden,
      produce: { run: 'ratchet api --json' },
    };
  }

  it('passes when the produced output matches the golden', async () => {
    const root = makeProject();
    writeFileSync(path.join(root, 'golden.txt'), 'api surface\n');
    const o = await evaluateInvariant(snapshotInvariant('golden.txt'), {
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash: bashReturning('  api surface  '),
    });
    expect(o.status).toBe('pass');
    expect(o.evidence).toMatch(/matched the golden/i);
  });

  it('is a violation when the produced output differs from the golden', async () => {
    const root = makeProject();
    writeFileSync(path.join(root, 'golden.txt'), 'api surface\n');
    const o = await evaluateInvariant(snapshotInvariant('golden.txt'), {
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash: bashReturning('different surface'),
    });
    expect(o.status).toBe('fail');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/differs from the golden/i);
  });

  it('fails closed to unevaluable when the golden is absent', async () => {
    const root = makeProject();
    const o = await evaluateInvariant(snapshotInvariant('missing.txt'), {
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash: bashReturning('whatever'),
    });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/golden was absent/i);
  });

  it('fails closed to unevaluable when the produce command cannot run', async () => {
    const root = makeProject();
    writeFileSync(path.join(root, 'golden.txt'), 'api surface\n');
    const o = await evaluateInvariant(snapshotInvariant('golden.txt'), {
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash: bashThrows,
    });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/produce command could not run/i);
  });
});

describe('evaluateInvariant: mutation', () => {
  const REVERT = 'git reset --hard HEAD && git clean -fd';
  const CLEAN: BashResult = { exitCode: 0, stdout: '', stderr: '' };
  const DIRTY: BashResult = { exitCode: 0, stdout: ' M src/x.ts\n', stderr: '' };
  const A_DIFF: BashResult = { exitCode: 0, stdout: 'diff --git a/src/x.ts b/src/x.ts\n-a\n+b\n', stderr: '' };
  const NO_DIFF: BashResult = { exitCode: 0, stdout: '', stderr: '' };
  const TEST_PASS: BashResult = { exitCode: 0, stdout: 'PASS', stderr: '' };
  const TEST_FAIL: BashResult = { exitCode: 1, stdout: '', stderr: '1 test failed' };

  const inv = (overrides: Partial<MutationInvariant> = {}): MutationInvariant => ({
    id: 'mutants-are-killed',
    kind: 'mutation',
    active: true,
    test: 'pnpm test',
    budget: 3,
    threshold: 3,
    ...overrides,
  });

  const noopSpawner: Spawner = async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' });

  /** Fake `bash` seam: a clean tree, a spawn-seeded diff/oracle-result sequence
   *  consumed one entry per budget-loop attempt (repeating the last entry once
   *  exhausted), and a successful revert — mirrors mutation-harness.test.ts's
   *  `makeSeams` pattern, scoped to just what evaluateMutation's reduction needs. */
  function makeMutationBash(
    testCommand: string,
    diffs: BashResult[],
    tests: Array<BashResult | Error>
  ): BashRunner {
    let diffIdx = 0;
    let testIdx = 0;
    return async (command) => {
      if (command === 'git status --porcelain') return CLEAN;
      if (command === 'git add -A') return CLEAN;
      if (command === 'git diff --cached') return diffs[Math.min(diffIdx++, diffs.length - 1)]!;
      if (command === testCommand) {
        const result = tests[Math.min(testIdx++, tests.length - 1)]!;
        if (result instanceof Error) throw result;
        return result;
      }
      if (command === REVERT) return CLEAN;
      throw new Error(`fake bash: no response configured for command '${command}'`);
    };
  }

  it('passes and records the evaluated/killed count when every evaluated mutant is killed', async () => {
    const root = makeProject();
    const invariant = inv({ budget: 3, threshold: 3 });
    const bash = makeMutationBash('pnpm test', [A_DIFF], [TEST_FAIL]);
    const o = await evaluateInvariant(invariant, {
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash,
      spawner: noopSpawner,
    });
    expect(o.status).toBe('pass');
    expect(isInvariantViolation(o)).toBe(false);
    expect(o.evidence).toMatch(/all 3 evaluated mutant\(s\) were killed/i);
    expect(o.measure).toContain('3 evaluated, 0 survived');
    expect(o.artifacts).toHaveLength(3);
    for (const entry of o.artifacts!) {
      expect(entry.outcome).toBe('killed');
      expect(readFileSync(path.join(root, entry.diffPath), 'utf-8')).toBe(A_DIFF.stdout);
      expect(readFileSync(path.join(root, entry.testOutputPath), 'utf-8')).toContain('1 test failed');
    }
  });

  it('is a hard failure naming the survived mutant when even one survives, regardless of threshold', async () => {
    const root = makeProject();
    const invariant = inv({ budget: 3, threshold: 2 });
    const bash = makeMutationBash('pnpm test', [A_DIFF], [TEST_PASS, TEST_FAIL, TEST_FAIL]);
    const o = await evaluateInvariant(invariant, {
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash,
      spawner: noopSpawner,
    });
    expect(o.status).toBe('fail');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/1 of 3 evaluated mutant\(s\) survived/i);
    expect(o.evidence).toContain('attempt #0');
    expect(o.evidence).toContain('diff --git a/src/x.ts');
    expect(o.artifacts).toHaveLength(3);
    const survivedEntry = o.artifacts!.find((e) => e.outcome === 'survived')!;
    expect(survivedEntry.index).toBe(0);
    expect(readFileSync(path.join(root, survivedEntry.diffPath), 'utf-8')).toBe(A_DIFF.stdout);
    expect(readFileSync(path.join(root, survivedEntry.testOutputPath), 'utf-8')).toContain('PASS');
  });

  it('fails closed to unevaluable when fewer mutants are evaluated than the threshold, citing the threshold', async () => {
    const root = makeProject();
    const invariant = inv({ budget: 3, threshold: 3 });
    // Middle attempt seeds no diff (skipped, not a mutant): only 2 of 3 reach a verdict.
    const bash = makeMutationBash('pnpm test', [A_DIFF, NO_DIFF, A_DIFF], [TEST_FAIL, TEST_FAIL]);
    const o = await evaluateInvariant(invariant, {
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash,
      spawner: noopSpawner,
    });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/only 2 of 3 required mutants/i);
    expect(o.artifacts).toHaveLength(2);
  });

  it('fails closed to unevaluable citing the reason when the working tree is unusable before seeding anything', async () => {
    const invariant = inv();
    const bash: BashRunner = async (command) => {
      if (command === 'git status --porcelain') return DIRTY;
      throw new Error(`fake bash: unexpected command '${command}'`);
    };
    const o = await evaluateInvariant(invariant, {
      projectRoot: '/p',
      run: runWith(1),
      baseline: null,
      bash,
      spawner: noopSpawner,
    });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/working tree was not usable/i);
    expect(o.evidence).toContain('uncommitted changes');
    expect(o.artifacts).toBeUndefined();
  });

  it('fails closed to unevaluable with no mutant recorded when the test command throws instead of producing a result', async () => {
    const invariant = inv();
    const bash = makeMutationBash(
      'pnpm test',
      [A_DIFF],
      [new Error('pnpm test: command not found')]
    );
    const o = await evaluateInvariant(invariant, {
      projectRoot: '/p',
      run: runWith(1),
      baseline: null,
      bash,
      spawner: noopSpawner,
    });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/mutation harness could not run/i);
    expect(o.evidence).toContain('pnpm test: command not found');
    expect(o.evidence).not.toMatch(/survived|killed/i);
    expect(o.artifacts).toBeUndefined();
  });

  // features/mutation-evidence-recording/replayable-evidence.feature
  it('evaluating the same invariant twice for the same run.runId reads the persisted outcome, calling the harness only once', async () => {
    const root = makeProject();
    const invariant = inv({ budget: 3, threshold: 3 });
    const bash = makeMutationBash('pnpm test', [A_DIFF], [TEST_FAIL]);
    let bashCalls = 0;
    let spawnerCalls = 0;
    const countingBash: BashRunner = async (...args) => {
      bashCalls++;
      return bash(...args);
    };
    const countingSpawner: Spawner = async (...args) => {
      spawnerCalls++;
      return noopSpawner(...args);
    };
    const run = runWith(1);

    const first = await evaluateInvariant(invariant, {
      projectRoot: root,
      run,
      baseline: null,
      bash: countingBash,
      spawner: countingSpawner,
    });
    const bashCallsAfterFirst = bashCalls;
    const spawnerCallsAfterFirst = spawnerCalls;
    expect(spawnerCallsAfterFirst).toBeGreaterThan(0);

    const second = await evaluateInvariant(invariant, {
      projectRoot: root,
      run,
      baseline: null,
      bash: countingBash,
      spawner: countingSpawner,
    });

    // Only the cache-lookup precondition (none — the outcome is read straight
    // off disk) runs on the second call: no additional harness/agent calls.
    expect(spawnerCalls).toBe(spawnerCallsAfterFirst);
    expect(bashCalls).toBe(bashCallsAfterFirst);
    expect(second).toEqual(first);
  });

  it('evaluating the same invariant for a different run.runId re-invokes the harness and persists evidence under the new run id, independent of the first', async () => {
    const root = makeProject();
    const invariant = inv({ budget: 3, threshold: 3 });
    const bash = makeMutationBash('pnpm test', [A_DIFF], [TEST_FAIL]);
    let spawnerCalls = 0;
    const countingSpawner: Spawner = async (...args) => {
      spawnerCalls++;
      return noopSpawner(...args);
    };

    const runA = runWith(1);
    const runB = { ...runWith(1), runId: 'r2' };

    const first = await evaluateInvariant(invariant, {
      projectRoot: root,
      run: runA,
      baseline: null,
      bash,
      spawner: countingSpawner,
    });
    expect(spawnerCalls).toBeGreaterThan(0);
    const spawnerCallsAfterFirst = spawnerCalls;

    const second = await evaluateInvariant(invariant, {
      projectRoot: root,
      run: runB,
      baseline: null,
      bash,
      spawner: countingSpawner,
    });

    expect(spawnerCalls).toBeGreaterThan(spawnerCallsAfterFirst);
    // Same reduction (status/measure/evidence), but evidence persisted under
    // each run's own directory — never reusing the other run's paths.
    expect(second.status).toBe(first.status);
    expect(second.measure).toBe(first.measure);
    expect(second.evidence).toBe(first.evidence);
    expect(second.artifacts![0]!.diffPath).not.toBe(first.artifacts![0]!.diffPath);
    expect(second.artifacts![0]!.diffPath).toContain(runB.runId);
    expect(first.artifacts![0]!.diffPath).toContain(runA.runId);
  });
});
