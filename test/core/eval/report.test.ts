import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildReport, diffAgainstBaseline } from '../../../src/core/eval/report.js';
import { persistRun, promoteBaseline, toSnapshot, type EvalRun } from '../../../src/core/eval/run.js';
import type { EvalCase } from '../../../src/core/eval/set.js';
import type { Verdict } from '../../../src/core/eval/judge.js';

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

function mkRun(runId: string, verdicts: Record<string, { verdict: Verdict; reason?: string }>): EvalRun {
  const ids = Object.keys(verdicts);
  return {
    runId,
    createdAt: new Date().toISOString(),
    judgeMode: 'auto',
    scope: { kind: 'store' },
    cases: ids.map((id) => toSnapshot(mkCase(id), null)),
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
