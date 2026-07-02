/**
 * Integration tests for the `ratchet eval report` verb.
 *
 * Implements features/eval-command-tests/report.feature: the --json full report
 * (scorecard + diff), the clean text scorecard, regressions surfaced first with
 * their evidence ahead of other failures, the "Run is incomplete" notice, the
 * new/retired baseline diff lines, and the missing-`--run` rejection. Runs are
 * seeded directly through the core `persistRun`/`promoteBaseline` helpers so the
 * test is independent of the run verb. The verb is pointed at an isolated
 * tmpdir fixture by mocking `resolveCurrentPlanningHomeSync`; console.log is
 * spied and the fixture removed in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  persistRun,
  promoteBaseline,
  type EvalRun,
  type Verdict,
  type JurorVote,
  type WebArtifacts,
} from '../../../src/core/eval/index.js';
import { makeEvalFixture, type EvalFixture } from './eval-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { evalReportCommand } from '../../../src/commands/eval/report.js';

type Clause = { clause: string; pass: boolean; evidence: string };

interface Entry {
  id: string;
  verdict: Verdict;
  reason?: string;
  /** The binding kind recorded on the case snapshot (a `web` case carries artifacts). */
  bindingKind?: 'web' | null;
  /** Per-clause pass/fail marks rendered by `printCaseDetail`. */
  clauses?: Clause[];
  /** Juror votes; a length > 1 triggers the rendered jury tally. */
  votes?: JurorVote[];
  /** Captured trace/screenshot paths surfaced onto `CaseDetail.artifacts`. */
  artifacts?: WebArtifacts;
}

function makeRun(runId: string, entries: Entry[]): EvalRun {
  return {
    runId,
    createdAt: '2026-01-01T00:00:00.000Z',
    scope: { kind: 'store' },
    cases: entries.map((e) => ({
      id: e.id,
      feature: 'Feature',
      scenario: e.id,
      source: 'features/x.feature',
      steps: [],
      bindingKind: e.bindingKind ?? null,
    })),
    verdicts: Object.fromEntries(
      entries.map((e) => [
        e.id,
        {
          verdict: e.verdict,
          reason: e.reason ?? '',
          source: 'judged',
          ...(e.clauses ? { clauses: e.clauses } : {}),
          ...(e.votes ? { votes: e.votes } : {}),
          ...(e.artifacts ? { artifacts: e.artifacts } : {}),
        },
      ])
    ),
  };
}

describe('evalReportCommand', () => {
  let fixture: EvalFixture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixture = await makeEvalFixture();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resolvePlanningHomeMock.mockReturnValue({ root: fixture.root });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fixture.cleanup();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('emits the full report including scorecard and diff as JSON', async () => {
    persistRun(fixture.root, makeRun('run-json', [{ id: 'a', verdict: 'pass' }]));
    await evalReportCommand({ run: 'run-json', json: true });

    const parsed = JSON.parse(output());
    expect(parsed.runId).toBe('run-json');
    expect(parsed.scorecard).toMatchObject({ total: 1, pass: 1, fail: 0, unjudged: 0 });
    expect(parsed.diff).toMatchObject({ regressions: [], newCases: [], retiredCases: [] });
    expect(parsed.overall).toBe('pass');
  });

  it('renders a clean run with its overall verdict and counts', async () => {
    persistRun(
      fixture.root,
      makeRun('run-clean', [
        { id: 'a', verdict: 'pass' },
        { id: 'b', verdict: 'pass' },
      ])
    );
    await evalReportCommand({ run: 'run-clean' });

    const text = output();
    expect(text).toContain('[PASS]');
    expect(text).toContain('2 pass');
    expect(text).toContain('0 fail');
    expect(text).toContain('0 unjudged');
    expect(text).not.toContain('Run is incomplete');
  });

  it('surfaces regressions first with their evidence, ahead of other failures', async () => {
    // Baseline: a passes, b fails. Current: a regresses (was pass→fail), b stays
    // failing (non-regression). The regression must be listed before b.
    persistRun(
      fixture.root,
      makeRun('base', [
        { id: 'a', verdict: 'pass' },
        { id: 'b', verdict: 'fail', reason: 'b was already broken' },
      ])
    );
    persistRun(
      fixture.root,
      makeRun('cur', [
        { id: 'a', verdict: 'fail', reason: 'a regressed: assertion flipped' },
        { id: 'b', verdict: 'fail', reason: 'b still broken' },
      ])
    );
    promoteBaseline(fixture.root, 'base');

    await evalReportCommand({ run: 'cur' });
    const text = output();

    expect(text).toContain('REGRESSIONS');
    expect(text).toContain('a regressed: assertion flipped');
    // The regression (a) is rendered before the non-regression failure (b).
    expect(text.indexOf('REGRESSIONS')).toBeLessThan(text.indexOf('Failing cases'));
    expect(text.indexOf('- a')).toBeLessThan(text.indexOf('- b'));
  });

  it('flags an incomplete run with the "Run is incomplete" notice', async () => {
    persistRun(
      fixture.root,
      makeRun('run-incomplete', [
        { id: 'a', verdict: 'pass' },
        { id: 'b', verdict: 'unjudged' },
      ])
    );
    await evalReportCommand({ run: 'run-incomplete' });
    expect(output()).toContain('Run is incomplete');
  });

  it('reports new and retired cases against the baseline', async () => {
    // Baseline has {a, old}; current has {a, new} — `new` is added, `old` retired.
    persistRun(
      fixture.root,
      makeRun('base2', [
        { id: 'a', verdict: 'pass' },
        { id: 'old', verdict: 'pass' },
      ])
    );
    persistRun(
      fixture.root,
      makeRun('cur2', [
        { id: 'a', verdict: 'pass' },
        { id: 'new', verdict: 'pass' },
      ])
    );
    promoteBaseline(fixture.root, 'base2');

    await evalReportCommand({ run: 'cur2' });
    const text = output();
    expect(text).toContain('New: new');
    expect(text).toContain('Retired: old');
  });

  it('rejects a missing --run', async () => {
    await expect(evalReportCommand({})).rejects.toThrow(/--run/);
  });

  // features/eval-report/read-only-report.feature — a run with no persisted
  // invariant gate is rendered "not evaluated": the read-only report never
  // re-evaluates the gate, and the state never crashes or affects the verdict.
  it('renders a run with no persisted invariant gate as "not evaluated" (text and JSON)', async () => {
    // `makeRun` persists no `invariantGate` — the not-evaluated case.
    persistRun(fixture.root, makeRun('run-noeval', [{ id: 'a', verdict: 'pass' }]));

    await evalReportCommand({ run: 'run-noeval' });
    expect(output()).toContain('Invariants: not evaluated');

    logSpy.mockClear();
    await evalReportCommand({ run: 'run-noeval', json: true });
    const parsed = JSON.parse(output());
    expect(parsed.invariantsEvaluated).toBe(false);
    expect(parsed.invariants).toEqual([]);
    expect(parsed.overall).toBe('pass');
  });

  // features/web-failure-evidence/failure-artifacts.feature — a failing web case's
  // detail surfaces its captured trace/screenshot paths, per-clause pass/fail marks,
  // and a jury tally when more than one juror voted.
  it('renders a failing web case detail with clause marks, jury tally, and artifact paths', async () => {
    persistRun(
      fixture.root,
      makeRun('run-web', [
        {
          id: 'w',
          verdict: 'fail',
          reason: 'spec failed',
          bindingKind: 'web',
          clauses: [
            { clause: 'the page loads', pass: true, evidence: 'ok' },
            { clause: 'the checkout succeeds', pass: false, evidence: 'timeout' },
          ],
          votes: [
            { pass: true, clauses: [] },
            { pass: false, clauses: [] },
          ],
          artifacts: {
            trace: '.ratchet/evals/runs/run-web/artifacts/w/trace.zip',
            screenshot: '.ratchet/evals/runs/run-web/artifacts/w/test-failed-1.png',
          },
        },
      ])
    );

    await evalReportCommand({ run: 'run-web' });
    const text = output();

    // Per-clause marks (both the pass and fail branches of the clause ternary).
    expect(text).toContain('[pass] the page loads');
    expect(text).toContain('[fail] the checkout succeeds');
    // Jury tally rendered because more than one juror voted (1 of 2 passed).
    expect(text).toContain('Jury: 1/2 passed');
    // Artifact paths surfaced from the persisted CaseRecord.
    expect(text).toContain('Trace: .ratchet/evals/runs/run-web/artifacts/w/trace.zip');
    expect(text).toContain(
      'Screenshot: .ratchet/evals/runs/run-web/artifacts/w/test-failed-1.png'
    );
  });

  it('omits artifact and jury lines for a failing case with no artifacts and a single vote', async () => {
    persistRun(
      fixture.root,
      makeRun('run-noart', [
        {
          id: 'p',
          verdict: 'fail',
          reason: 'assertion failed',
          clauses: [{ clause: 'the value matches', pass: false, evidence: 'mismatch' }],
          votes: [{ pass: false, clauses: [] }],
          // No `artifacts`, single vote: the artifact and jury branches render nothing.
        },
      ])
    );

    await evalReportCommand({ run: 'run-noart' });
    const text = output();

    // The failing case is still detailed with its single clause mark.
    expect(text).toContain('[fail] the value matches');
    // But the false branches of the artifact/jury conditionals render no lines.
    expect(text).not.toContain('Trace:');
    expect(text).not.toContain('Screenshot:');
    expect(text).not.toContain('Jury:');
  });
});
