import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildReport, diffAgainstBaseline } from '../../../src/core/eval/report.js';
import { persistRun, promoteBaseline, toSnapshot, type EvalRun } from '../../../src/core/eval/run.js';
import type { EvalCase } from '../../../src/core/eval/set.js';
import type { Verdict } from '../../../src/core/eval/judge.js';
import type { BindingKind } from '../../../src/core/eval/spec.js';
import type { ContributorId } from '../../../src/core/eval/aggregate.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-report-'));
  roots.push(root);
  return root;
}

function mkCase(id: string): EvalCase {
  return {
    id,
    feature: 'F',
    scenario: id,
    source: 'f/x.feature',
    steps: [{ keyword: 'Given', text: 'a' }, { keyword: 'Then', text: 'b' }],
  };
}

function mkRun(
  runId: string,
  verdicts: Record<string, { verdict: Verdict; reason?: string; kind?: BindingKind | null }>,
  gate?: ContributorId[]
): EvalRun {
  const ids = Object.keys(verdicts);
  // A judged case is a bound case: pass/fail default to a deterministic binding
  // kind so the aggregation core attributes them to a contributor; unjudged
  // cases default to unbound (null), as in a real run.
  const kindFor = (v: { verdict: Verdict; kind?: BindingKind | null }): BindingKind | null =>
    v.kind !== undefined ? v.kind : v.verdict === 'unjudged' ? null : 'deterministic';
  return {
    runId,
    createdAt: new Date().toISOString(),
    judgeMode: 'auto',
    scope: { kind: 'store' },
    ...(gate ? { gate } : {}),
    cases: ids.map((id) => toSnapshot(mkCase(id), kindFor(verdicts[id]))),
    verdicts: Object.fromEntries(
      ids.map((id) => [
        id,
        { verdict: verdicts[id].verdict, reason: verdicts[id].reason ?? '', source: 'judged' as const },
      ])
    ),
  };
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('scorecard', () => {
  it('counts pass, fail and unjudged and lists failing evidence', () => {
    const root = makeProject();
    persistRun(
      root,
      mkRun('r1', {
        'a#pass': { verdict: 'pass' },
        'a#fail': { verdict: 'fail', reason: 'boom' },
        'a#unj': { verdict: 'unjudged' },
      })
    );
    const report = buildReport(root, 'r1');
    expect(report.scorecard).toMatchObject({ total: 3, pass: 1, fail: 1, unjudged: 1, complete: false });
    expect(report.failing).toHaveLength(1);
    expect(report.failing[0].evidence).toBe('boom');
    expect(report.overall).toBe('fail');
  });

  it('marks a run complete only when nothing is unjudged', () => {
    const root = makeProject();
    persistRun(root, mkRun('r1', { 'a#p': { verdict: 'pass' } }));
    expect(buildReport(root, 'r1').scorecard.complete).toBe(true);
    expect(buildReport(root, 'r1').overall).toBe('pass');
  });
});

// features/eval-verdict-aggregation/aggregation-core.feature
describe('overall verdict routed through the aggregation core', () => {
  it('exposes a per-contributor breakdown and fails via the failing contributor', () => {
    const root = makeProject();
    persistRun(
      root,
      mkRun('r1', {
        'a#det': { verdict: 'fail', reason: 'boom', kind: 'deterministic' },
        'a#llm': { verdict: 'pass', kind: 'llm-judge' },
      })
    );
    const report = buildReport(root, 'r1');
    expect(report.overall).toBe('fail');
    // Every contributor is reported; the deterministic one fails and names the case.
    const ids = report.contributors.map((c) => c.id);
    expect(ids).toEqual(['deterministic', 'llm-judge', 'invariants', 'regression']);
    const det = report.contributors.find((c) => c.id === 'deterministic');
    expect(det).toMatchObject({ status: 'fail', failing: ['a#det'] });
    expect(report.contributors.find((c) => c.id === 'llm-judge')?.status).toBe('pass');
  });

  it('reports the regression contributor as the failing one on a baseline regression', () => {
    const root = makeProject();
    persistRun(root, mkRun('base', { 'a#x': { verdict: 'pass' } }));
    promoteBaseline(root, 'base');
    persistRun(root, mkRun('cur', { 'a#x': { verdict: 'fail', reason: 'broke' } }));
    const report = buildReport(root, 'cur');
    expect(report.overall).toBe('fail');
    const failing = report.contributors.filter((c) => c.status === 'fail').map((c) => c.id);
    // Both the deterministic check and the regression fire on this case.
    expect(failing).toContain('regression');
    expect(report.contributors.find((c) => c.id === 'regression')?.failing).toEqual(['a#x']);
  });
});

// features/eval-contributor-gate/gate-selection.feature — the report ANDs only
// over the contributors recorded on `run.gate`; a disabled one takes no part.
describe('AND over the enabled contributor set (run.gate)', () => {
  it('excludes a disabled contributor from the AND so the run can still pass', () => {
    const root = makeProject();
    // An llm-judge case fails, but the llm-judge contributor is NOT in run.gate.
    persistRun(
      root,
      mkRun(
        'gated',
        {
          'a#det': { verdict: 'pass', kind: 'deterministic' },
          'a#llm': { verdict: 'fail', reason: 'would fail', kind: 'llm-judge' },
        },
        ['deterministic', 'invariants', 'regression']
      )
    );
    const report = buildReport(root, 'gated');
    // The disabled llm-judge contributor is absent from the breakdown and the AND.
    expect(report.contributors.map((c) => c.id)).toEqual([
      'deterministic',
      'invariants',
      'regression',
    ]);
    expect(report.overall).toBe('pass');
  });

  it('includes the contributor in the AND when it is enabled (control)', () => {
    const root = makeProject();
    persistRun(
      root,
      mkRun(
        'enabled',
        {
          'a#det': { verdict: 'pass', kind: 'deterministic' },
          'a#llm': { verdict: 'fail', reason: 'would fail', kind: 'llm-judge' },
        },
        ['deterministic', 'llm-judge', 'invariants', 'regression']
      )
    );
    const report = buildReport(root, 'enabled');
    expect(report.contributors.find((c) => c.id === 'llm-judge')?.status).toBe('fail');
    expect(report.overall).toBe('fail');
  });
});

describe('baseline diff', () => {
  it('flags a regression: passed in baseline, fails now', () => {
    const root = makeProject();
    persistRun(root, mkRun('base', { 'status-as-json': { verdict: 'pass' } }));
    promoteBaseline(root, 'base');
    persistRun(root, mkRun('cur', { 'status-as-json': { verdict: 'fail', reason: 'broke' } }));
    const report = buildReport(root, 'cur');
    expect(report.diff.regressions).toEqual(['status-as-json']);
    expect(report.overall).toBe('fail');
  });

  it('classifies new and retired cases without counting them as regressions', () => {
    const baseline = mkRun('base', { 'a#kept': { verdict: 'pass' }, 'a#retired': { verdict: 'pass' } });
    const current = mkRun('cur', { 'a#kept': { verdict: 'pass' }, 'a#new': { verdict: 'pass' } });
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.newCases).toEqual(['a#new']);
    expect(diff.retiredCases).toEqual(['a#retired']);
    expect(diff.regressions).toEqual([]);
  });

  it('does not treat a never-passing case that now fails as a regression', () => {
    const baseline = mkRun('base', { 'a#x': { verdict: 'unjudged' } });
    const current = mkRun('cur', { 'a#x': { verdict: 'fail', reason: 'r' } });
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.regressions).toEqual([]);
  });
});
