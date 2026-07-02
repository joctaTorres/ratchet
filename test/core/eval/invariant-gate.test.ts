// Implements features/eval-invariants/contributor.feature — the run-level
// invariant gate that loads the manifest fail-closed, evaluates only the ACTIVE
// invariants, and collects every violation (fail or unevaluable) into `failing`,
// so the pure `invariants` contributor can read a precomputed result. Inert
// invariants are skipped and never counted; a present-but-unloadable manifest
// fails closed; an absent manifest yields an empty, passing set. Injected
// `bash`/`readFile`, tmpdir fixture for the manifest — no real spawn.
import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateInvariantGate } from '../../../src/core/eval/invariant-gate.js';
import { WORKING_TREE_PROBE } from '../../../src/core/eval/mutation-harness.js';
import type { EvalRun, CaseSnapshot } from '../../../src/core/eval/run.js';
import type { BashRunner, BashResult, Spawner } from '../../../src/core/batch/engine/index.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'invariant-gate-'));
  roots.push(root);
  return root;
}

/** Write `.ratchet/evals/invariants.yaml` under a project root. */
function writeManifest(root: string, yaml: string): void {
  const dir = path.join(root, '.ratchet', 'evals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'invariants.yaml'), yaml, 'utf-8');
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

describe('evaluateInvariantGate', () => {
  it('passes (no failing) when the only active invariant evaluates to pass', async () => {
    const root = makeProject();
    writeManifest(
      root,
      'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: true\n    measure: scenario-count\n'
    );
    const result = await evaluateInvariantGate({
      projectRoot: root,
      run: runWith(12),
      baseline: runWith(10),
    });
    expect(result.failing).toEqual([]);
    expect(result.loadError).toBeUndefined();
    expect(result.outcomes.map((o) => o.id)).toEqual(['spec-not-weakened']);
    expect(result.outcomes[0].status).toBe('pass');
  });

  it('collects a violated active invariant id into failing', async () => {
    const root = makeProject();
    writeManifest(
      root,
      'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: true\n    measure: scenario-count\n'
    );
    const result = await evaluateInvariantGate({
      projectRoot: root,
      run: runWith(8),
      baseline: runWith(10),
    });
    expect(result.failing).toEqual(['spec-not-weakened']);
    expect(result.outcomes[0].status).toBe('fail');
  });

  it('skips an inert invariant: not evaluated, not counted, gate passes', async () => {
    const root = makeProject();
    // The inert invariant would fail (count decreased) if it were evaluated.
    writeManifest(
      root,
      'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: false\n    measure: scenario-count\n'
    );
    const result = await evaluateInvariantGate({
      projectRoot: root,
      run: runWith(8),
      baseline: runWith(10),
    });
    expect(result.failing).toEqual([]);
    // The inert invariant is never recorded as an outcome (so never a "passing" invariant).
    expect(result.outcomes).toEqual([]);
  });

  it('counts an unevaluable active invariant as a violation (fail-closed)', async () => {
    const root = makeProject();
    // Monotonic with no baseline ⇒ unevaluable per the evaluator.
    writeManifest(
      root,
      'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: true\n    measure: scenario-count\n'
    );
    const result = await evaluateInvariantGate({
      projectRoot: root,
      run: runWith(12),
      baseline: null,
    });
    expect(result.failing).toEqual(['spec-not-weakened']);
    expect(result.outcomes[0].status).toBe('unevaluable');
  });

  it('evaluates an active deterministic invariant through the injected bash', async () => {
    const root = makeProject();
    writeManifest(
      root,
      'invariants:\n  - id: tests-still-exist\n    kind: deterministic\n    active: true\n    check:\n      run: "echo ok"\n      pass: "contains:ok"\n'
    );
    const result = await evaluateInvariantGate({
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash: bashReturning('all ok'),
    });
    expect(result.failing).toEqual([]);
    expect(result.outcomes[0].status).toBe('pass');
  });

  it('threads spawner from InvariantGateInput through to a mutation invariant, failing the gate on a survived mutant', async () => {
    const root = makeProject();
    writeManifest(
      root,
      'invariants:\n  - id: mutants-are-killed\n    kind: mutation\n    active: true\n    test: "pnpm test"\n    budget: 1\n    threshold: 1\n'
    );
    const CLEAN: BashResult = { exitCode: 0, stdout: '', stderr: '' };
    const A_DIFF: BashResult = { exitCode: 0, stdout: 'diff --git a/src/x.ts b/src/x.ts\n-a\n+b\n', stderr: '' };
    const TEST_PASS: BashResult = { exitCode: 0, stdout: 'PASS', stderr: '' };
    const REVERT = 'git reset --hard HEAD && git clean -fd -e .ratchet/evals/runs';
    const bash: BashRunner = async (command) => {
      if (command === WORKING_TREE_PROBE) return CLEAN;
      if (command === 'git add -A') return CLEAN;
      if (command === 'git diff --cached') return A_DIFF;
      if (command === 'pnpm test') return TEST_PASS;
      if (command === REVERT) return CLEAN;
      throw new Error(`fake bash: unexpected command '${command}'`);
    };
    const spawner: Spawner = async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' });

    const result = await evaluateInvariantGate({
      projectRoot: root,
      run: runWith(1),
      baseline: null,
      bash,
      spawner,
    });

    expect(result.failing).toEqual(['mutants-are-killed']);
    expect(result.outcomes[0].status).toBe('fail');
    // features/mutation-evidence-recording/replayable-evidence.feature —
    // persisted evidence surfaces through the gate unchanged.
    expect(result.outcomes[0].artifacts).toHaveLength(1);
  });

  it('fails closed with a loadError when the manifest cannot be loaded', async () => {
    const root = makeProject();
    // Unknown kind ⇒ the loader rejects with InvariantManifestError.
    writeManifest(root, 'invariants:\n  - id: bogus\n    kind: not-a-kind\n    active: true\n');
    const result = await evaluateInvariantGate({
      projectRoot: root,
      run: runWith(1),
      baseline: null,
    });
    expect(result.failing).toEqual(['invariants.yaml']);
    expect(result.loadError).toBeTruthy();
    expect(result.outcomes).toEqual([]);
  });

  it('passes with no failing when the manifest is absent (nothing declared)', async () => {
    const root = makeProject();
    const result = await evaluateInvariantGate({
      projectRoot: root,
      run: runWith(1),
      baseline: null,
    });
    expect(result.failing).toEqual([]);
    expect(result.loadError).toBeUndefined();
    expect(result.outcomes).toEqual([]);
  });
});
