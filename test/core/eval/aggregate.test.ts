/**
 * Unit tests for the verdict-aggregation core.
 *
 * Implements features/eval-verdict-aggregation/aggregation-core.feature: the run
 * passes only when every contributor passes (logical AND), a single failing
 * contributor fails the whole run and names the offending case ids, a regression
 * alone fails the run, a neutral contributor is identity to the AND, and the
 * completeness signal mirrors "no case unjudged". Pure in-memory inputs — no
 * filesystem, no spawn.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateRun,
  isRunComplete,
  DEFAULT_CONTRIBUTORS,
  invariantsContributor,
  type Contributor,
  type ContributorContext,
} from '../../../src/core/eval/aggregate.js';
import { toSnapshot, type EvalRun } from '../../../src/core/eval/run.js';
import type { BaselineDiff } from '../../../src/core/eval/report.js';
import type { InvariantGateResult } from '../../../src/core/eval/invariant-gate.js';
import type { EvalCase } from '../../../src/core/eval/set.js';
import type { Verdict } from '../../../src/core/eval/judge.js';
import type { BindingKind } from '../../../src/core/eval/spec.js';

type CaseSpec = { verdict: Verdict; kind: BindingKind | null };

function mkCase(id: string): EvalCase {
  return {
    id,
    feature: 'F',
    scenario: id,
    source: 'f/x.feature',
    steps: [{ keyword: 'Given', text: 'a' }, { keyword: 'Then', text: 'b' }],
    tags: [],
  };
}

function mkRun(cases: Record<string, CaseSpec>): EvalRun {
  const ids = Object.keys(cases);
  return {
    runId: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
    scope: { kind: 'store' },
    cases: ids.map((id) => toSnapshot(mkCase(id), cases[id].kind)),
    verdicts: Object.fromEntries(
      ids.map((id) => [id, { verdict: cases[id].verdict, reason: '', source: 'judged' as const }])
    ),
  };
}

const NO_DIFF: BaselineDiff = {
  baselineRunId: null,
  regressions: [],
  newCases: [],
  retiredCases: [],
};

function ctx(
  run: EvalRun,
  diff: BaselineDiff = NO_DIFF,
  invariants?: InvariantGateResult
): ContributorContext {
  return { run, diff, invariants };
}

describe('aggregateRun', () => {
  it('passes only when every contributor passes', () => {
    const run = mkRun({
      'a#det': { verdict: 'pass', kind: 'deterministic' },
      'a#llm': { verdict: 'pass', kind: 'llm-judge' },
    });
    const agg = aggregateRun(ctx(run));
    expect(agg.overall).toBe('pass');
    // Every contributor is listed with its own pass status.
    expect(agg.contributors.map((c) => c.id)).toEqual([
      'deterministic',
      'llm-judge',
      'invariants',
      'regression',
    ]);
    expect(agg.contributors.every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails the whole run when one contributor fails (logical AND), naming the cases', () => {
    const run = mkRun({
      'a#det': { verdict: 'fail', kind: 'deterministic' },
      'a#llm': { verdict: 'pass', kind: 'llm-judge' },
    });
    const agg = aggregateRun(ctx(run));
    expect(agg.overall).toBe('fail');
    const det = agg.contributors.find((c) => c.id === 'deterministic');
    expect(det?.status).toBe('fail');
    expect(det?.failing).toEqual(['a#det']);
    // The other contributors still pass.
    expect(agg.contributors.find((c) => c.id === 'llm-judge')?.status).toBe('pass');
  });

  it('partitions failures by binding kind', () => {
    const run = mkRun({
      'a#det': { verdict: 'pass', kind: 'deterministic' },
      'a#llm': { verdict: 'fail', kind: 'llm-judge' },
    });
    const agg = aggregateRun(ctx(run));
    expect(agg.contributors.find((c) => c.id === 'deterministic')?.status).toBe('pass');
    expect(agg.contributors.find((c) => c.id === 'llm-judge')?.failing).toEqual(['a#llm']);
  });

  it('fails on a regression alone even when no case failed this run', () => {
    const run = mkRun({ 'a#det': { verdict: 'pass', kind: 'deterministic' } });
    const diff: BaselineDiff = { ...NO_DIFF, baselineRunId: 'base', regressions: ['a#det'] };
    const agg = aggregateRun(ctx(run, diff));
    expect(agg.overall).toBe('fail');
    const failing = agg.contributors.filter((c) => c.status === 'fail');
    expect(failing.map((c) => c.id)).toEqual(['regression']);
    expect(failing[0].failing).toEqual(['a#det']);
  });

  it('treats a neutral contributor as identity to the AND', () => {
    const run = mkRun({ 'a#det': { verdict: 'pass', kind: 'deterministic' } });
    // The neutral invariants contributor reports pass with nothing to evaluate.
    expect(invariantsContributor.evaluate(ctx(run)).status).toBe('pass');
    // The overall verdict equals the AND of the remaining contributors: dropping
    // the neutral contributor does not change the result.
    const withNeutral = aggregateRun(ctx(run));
    const withoutNeutral = aggregateRun(
      ctx(run),
      DEFAULT_CONTRIBUTORS.filter((c) => c.id !== 'invariants')
    );
    expect(withNeutral.overall).toBe(withoutNeutral.overall);
  });

  it('fails the invariants contributor on a precomputed gate violation, naming it', () => {
    const run = mkRun({ 'a#det': { verdict: 'pass', kind: 'deterministic' } });
    const gate: InvariantGateResult = { outcomes: [], failing: ['spec-not-weakened'] };
    const agg = aggregateRun(ctx(run, NO_DIFF, gate));
    expect(agg.overall).toBe('fail');
    const inv = agg.contributors.find((c) => c.id === 'invariants');
    expect(inv?.status).toBe('fail');
    expect(inv?.failing).toEqual(['spec-not-weakened']);
  });

  it('passes the invariants contributor when the gate result is absent or empty', () => {
    const run = mkRun({ 'a#det': { verdict: 'pass', kind: 'deterministic' } });
    // Absent gate result.
    expect(invariantsContributor.evaluate(ctx(run)).status).toBe('pass');
    // Present but empty (no active invariants / all passed).
    const empty: InvariantGateResult = { outcomes: [], failing: [] };
    expect(invariantsContributor.evaluate(ctx(run, NO_DIFF, empty)).status).toBe('pass');
    // Identity to the AND: a passing invariants gate does not change the verdict.
    expect(aggregateRun(ctx(run, NO_DIFF, empty)).overall).toBe('pass');
  });

  it('passes with an empty contributor set (AND over nothing is true)', () => {
    const run = mkRun({ 'a#det': { verdict: 'fail', kind: 'deterministic' } });
    expect(aggregateRun(ctx(run), []).overall).toBe('pass');
  });

  it('supports a registered custom contributor as an extension point', () => {
    const run = mkRun({ 'a#det': { verdict: 'pass', kind: 'deterministic' } });
    const veto: Contributor = {
      id: 'invariants',
      evaluate: () => ({ id: 'invariants', status: 'fail', failing: ['policy#x'] }),
    };
    const agg = aggregateRun(ctx(run), [veto]);
    expect(agg.overall).toBe('fail');
    expect(agg.contributors[0].failing).toEqual(['policy#x']);
  });
});

describe('completeness signal', () => {
  it('is complete only when no case is unjudged', () => {
    const complete = mkRun({
      'a#p': { verdict: 'pass', kind: 'deterministic' },
      'a#f': { verdict: 'fail', kind: 'deterministic' },
    });
    const incomplete = mkRun({
      'a#p': { verdict: 'pass', kind: 'deterministic' },
      'a#u': { verdict: 'unjudged', kind: null },
    });
    expect(isRunComplete(complete)).toBe(true);
    expect(aggregateRun(ctx(complete)).complete).toBe(true);
    expect(isRunComplete(incomplete)).toBe(false);
    expect(aggregateRun(ctx(incomplete)).complete).toBe(false);
  });
});
