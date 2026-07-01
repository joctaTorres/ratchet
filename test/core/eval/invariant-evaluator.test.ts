// Implements features/eval-invariants/kinds-evaluator.feature — the per-invariant
// evaluator that computes one pass / fail / unevaluable outcome for each of the
// three invariant kinds, fail-closed on anything it cannot evaluate.
import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import type { BashRunner } from '../../../src/core/batch/engine/index.js';

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

describe('evaluateInvariant: mutation (schema-only placeholder)', () => {
  const inv: MutationInvariant = {
    id: 'mutants-are-killed',
    kind: 'mutation',
    active: true,
    test: 'pnpm test',
    budget: 5,
    threshold: 3,
  };

  it('fails closed to unevaluable, since seeding/oracle evaluation is not implemented yet', async () => {
    const o = await evaluateInvariant(inv, { projectRoot: '/p', run: runWith(1), baseline: null });
    expect(o.status).toBe('unevaluable');
    expect(isInvariantViolation(o)).toBe(true);
    expect(o.evidence).toMatch(/not implemented/i);
  });
});
