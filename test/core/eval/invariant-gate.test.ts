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
import type { EvalRun, CaseSnapshot } from '../../../src/core/eval/run.js';
import type { BashRunner } from '../../../src/core/batch/engine/index.js';

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
  return { runId: 'r', createdAt: 't', judgeMode: 'auto', scope: { kind: 'store' }, cases, verdicts: {} };
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
