import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateRunId,
  persistRun,
  loadRun,
  recordVerdict,
  toSnapshot,
  promoteBaseline,
  loadBaselineRunId,
  type EvalRun,
} from '../../../src/core/eval/run.js';
import type { EvalCase } from '../../../src/core/eval/set.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-run-'));
  roots.push(root);
  return root;
}

const CASE: EvalCase = {
  id: 'f/x#one',
  feature: 'F',
  scenario: 'One',
  source: 'f/x.feature',
  steps: [{ keyword: 'Given', text: 'a' }, { keyword: 'Then', text: 'b' }],
};

function sampleRun(runId: string): EvalRun {
  return {
    runId,
    createdAt: new Date().toISOString(),
    judgeMode: 'auto',
    scope: { kind: 'store' },
    cases: [toSnapshot(CASE, null)],
    verdicts: { 'f/x#one': { verdict: 'unjudged', reason: 'unbound', source: 'judged' } },
  };
}

/** A run whose single case is judged — i.e. a complete run. */
function completeRun(runId: string): EvalRun {
  const run = sampleRun(runId);
  run.cases = [toSnapshot(CASE, 'deterministic')];
  run.verdicts = { 'f/x#one': { verdict: 'pass', reason: '', source: 'judged' } };
  return run;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('eval run persistence', () => {
  it('generates a sortable, unique run id', () => {
    const a = generateRunId(new Date('2026-01-01T00:00:00Z'));
    const b = generateRunId(new Date('2026-01-02T00:00:00Z'));
    expect(a < b).toBe(true);
    expect(a).not.toBe(generateRunId(new Date('2026-01-01T00:00:00Z')));
  });

  it('persists a run to .ratchet/evals/runs and reloads it', () => {
    const root = makeProject();
    const run = sampleRun('20260101T000000000Z-abc123');
    const file = persistRun(root, run);
    expect(file).toContain(path.join('.ratchet', 'evals', 'runs'));
    expect(existsSync(file)).toBe(true);
    expect(loadRun(root, run.runId).cases[0].id).toBe('f/x#one');
  });
});

describe('recordVerdict', () => {
  it('stores a manual override and marks it manual', () => {
    const root = makeProject();
    const run = sampleRun('r1');
    persistRun(root, run);
    recordVerdict(root, { runId: 'r1', caseId: 'f/x#one', verdict: 'pass', evidence: 'by hand' });
    const updated = loadRun(root, 'r1');
    expect(updated.verdicts['f/x#one']).toEqual({
      verdict: 'pass',
      reason: 'by hand',
      source: 'manual',
    });
  });

  it('rejects an unknown case and leaves the run unchanged', () => {
    const root = makeProject();
    persistRun(root, sampleRun('r1'));
    const before = readFileSync(path.join(root, '.ratchet/evals/runs/r1.json'), 'utf-8');
    expect(() => recordVerdict(root, { runId: 'r1', caseId: 'nope', verdict: 'pass' })).toThrow(
      /not part of run/i
    );
    expect(readFileSync(path.join(root, '.ratchet/evals/runs/r1.json'), 'utf-8')).toBe(before);
  });

  it('rejects an invalid verdict', () => {
    const root = makeProject();
    persistRun(root, sampleRun('r1'));
    expect(() =>
      recordVerdict(root, { runId: 'r1', caseId: 'f/x#one', verdict: 'bogus' as never })
    ).toThrow(/invalid verdict/i);
  });

  it('rejects a fail without evidence and leaves the run unchanged', () => {
    const root = makeProject();
    persistRun(root, sampleRun('r1'));
    const before = readFileSync(path.join(root, '.ratchet/evals/runs/r1.json'), 'utf-8');
    expect(() => recordVerdict(root, { runId: 'r1', caseId: 'f/x#one', verdict: 'fail' })).toThrow(
      /requires --evidence/i
    );
    expect(readFileSync(path.join(root, '.ratchet/evals/runs/r1.json'), 'utf-8')).toBe(before);
  });
});

describe('baseline', () => {
  it('promotes a complete run and reads it back', () => {
    const root = makeProject();
    persistRun(root, completeRun('r1'));
    promoteBaseline(root, 'r1');
    expect(loadBaselineRunId(root)).toBe('r1');
  });

  it('refuses to promote a missing run', () => {
    const root = makeProject();
    expect(() => promoteBaseline(root, 'ghost')).toThrow(/not found/i);
  });

  // features/eval-verdict-aggregation/baseline-promotion-guard.feature
  it('rejects an incomplete run and leaves the baseline unchanged', () => {
    const root = makeProject();
    // Seed an existing baseline, then attempt to promote an incomplete run.
    persistRun(root, completeRun('good'));
    promoteBaseline(root, 'good');
    persistRun(root, sampleRun('incomplete')); // single case is unjudged

    expect(() => promoteBaseline(root, 'incomplete')).toThrow(/incomplete/i);
    // The baseline still points at the previously-promoted complete run.
    expect(loadBaselineRunId(root)).toBe('good');
  });

  it('leaves no baseline behind when an incomplete run is the first promotion', () => {
    const root = makeProject();
    persistRun(root, sampleRun('incomplete'));
    expect(() => promoteBaseline(root, 'incomplete')).toThrow(/incomplete/i);
    expect(loadBaselineRunId(root)).toBeNull();
  });
});
