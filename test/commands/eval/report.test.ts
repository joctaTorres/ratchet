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
} from '../../../src/core/eval/index.js';
import { makeEvalFixture, type EvalFixture } from './eval-fixture.js';

const { resolvePlanningHomeMock } = vi.hoisted(() => ({
  resolvePlanningHomeMock: vi.fn(),
}));

vi.mock('../../../src/core/planning-home.js', () => ({
  resolveCurrentPlanningHomeSync: resolvePlanningHomeMock,
}));

import { evalReportCommand } from '../../../src/commands/eval/report.js';

interface Entry {
  id: string;
  verdict: Verdict;
  reason?: string;
}

function makeRun(runId: string, entries: Entry[]): EvalRun {
  return {
    runId,
    createdAt: '2026-01-01T00:00:00.000Z',
    judgeMode: 'auto',
    scope: { kind: 'store' },
    cases: entries.map((e) => ({
      id: e.id,
      feature: 'Feature',
      scenario: e.id,
      source: 'features/x.feature',
      steps: [],
      bindingKind: null,
    })),
    verdicts: Object.fromEntries(
      entries.map((e) => [e.id, { verdict: e.verdict, reason: e.reason ?? '', source: 'judged' }])
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
});
