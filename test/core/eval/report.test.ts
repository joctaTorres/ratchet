import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildReport, diffAgainstBaseline } from '../../../src/core/eval/report.js';
import { persistRun, promoteBaseline, toSnapshot, type EvalRun, type CaseRecord } from '../../../src/core/eval/run.js';
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
    tags: [],
  };
}

function mkRun(
  runId: string,
  verdicts: Record<string, { verdict: Verdict; reason?: string; kind?: BindingKind | null }>,
  gate?: ContributorId[]
): EvalRun {
  const ids = Object.keys(verdicts);
  // A judged case is a bound case: pass/fail default to a deterministic binding
  // kind so the aggregation core attributes them to a contributor; unjudged and
  // skipped cases default to unbound (null), as in a real run.
  const kindFor = (v: { verdict: Verdict; kind?: BindingKind | null }): BindingKind | null =>
    v.kind !== undefined ? v.kind : v.verdict === 'unjudged' || v.verdict === 'skipped' ? null : 'deterministic';
  return {
    runId,
    createdAt: new Date().toISOString(),
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

/** Write `.ratchet/evals/invariants.yaml` under a project root. */
function writeManifest(root: string, yaml: string): void {
  const dir = path.join(root, '.ratchet', 'evals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'invariants.yaml'), yaml, 'utf-8');
}

describe('scorecard', () => {
  it('counts pass, fail and unjudged and lists failing evidence', async () => {
    const root = makeProject();
    persistRun(
      root,
      mkRun('r1', {
        'a#pass': { verdict: 'pass' },
        'a#fail': { verdict: 'fail', reason: 'boom' },
        'a#unj': { verdict: 'unjudged' },
      })
    );
    const report = await buildReport(root, 'r1');
    expect(report.scorecard).toMatchObject({ total: 3, pass: 1, fail: 1, unjudged: 1, complete: false });
    expect(report.failing).toHaveLength(1);
    expect(report.failing[0].evidence).toBe('boom');
    expect(report.overall).toBe('fail');
  });

  it('marks a run complete only when nothing is unjudged', async () => {
    const root = makeProject();
    persistRun(root, mkRun('r1', { 'a#p': { verdict: 'pass' } }));
    expect((await buildReport(root, 'r1')).scorecard.complete).toBe(true);
    expect((await buildReport(root, 'r1')).overall).toBe('pass');
  });

  // features/eval-judge/skip-filters.feature — a skipped case is counted in the
  // scorecard's total, separately from unjudged, and never blocks completeness.
  it('counts skipped separately from unjudged and includes it in total', async () => {
    const root = makeProject();
    persistRun(
      root,
      mkRun('r1', {
        'a#pass': { verdict: 'pass' },
        'a#unj': { verdict: 'unjudged' },
        'a#skip': { verdict: 'skipped', reason: 'Skipped: tagged @skip in f.feature.' },
      })
    );
    const report = await buildReport(root, 'r1');
    expect(report.scorecard).toMatchObject({ total: 3, pass: 1, fail: 0, unjudged: 1, skipped: 1 });
  });

  it('does not block completeness or baseline promotion when every case is skipped or judged', async () => {
    const root = makeProject();
    persistRun(
      root,
      mkRun('r1', {
        'a#pass': { verdict: 'pass' },
        'a#skip': { verdict: 'skipped' },
      })
    );
    const report = await buildReport(root, 'r1');
    expect(report.scorecard.complete).toBe(true);
    expect(() => promoteBaseline(root, 'r1')).not.toThrow();
  });
});

// features/eval-verdict-aggregation/aggregation-core.feature
describe('overall verdict routed through the aggregation core', () => {
  it('exposes a per-contributor breakdown and fails via the failing contributor', async () => {
    const root = makeProject();
    persistRun(
      root,
      mkRun('r1', {
        'a#det': { verdict: 'fail', reason: 'boom', kind: 'deterministic' },
        'a#llm': { verdict: 'pass', kind: 'llm-judge' },
      })
    );
    const report = await buildReport(root, 'r1');
    expect(report.overall).toBe('fail');
    // Every contributor is reported; the deterministic one fails and names the case.
    const ids = report.contributors.map((c) => c.id);
    expect(ids).toEqual(['deterministic', 'llm-judge', 'invariants', 'regression']);
    const det = report.contributors.find((c) => c.id === 'deterministic');
    expect(det).toMatchObject({ status: 'fail', failing: ['a#det'] });
    expect(report.contributors.find((c) => c.id === 'llm-judge')?.status).toBe('pass');
  });

  it('reports the regression contributor as the failing one on a baseline regression', async () => {
    const root = makeProject();
    persistRun(root, mkRun('base', { 'a#x': { verdict: 'pass' } }));
    promoteBaseline(root, 'base');
    persistRun(root, mkRun('cur', { 'a#x': { verdict: 'fail', reason: 'broke' } }));
    const report = await buildReport(root, 'cur');
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
  it('excludes a disabled contributor from the AND so the run can still pass', async () => {
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
    const report = await buildReport(root, 'gated');
    // The disabled llm-judge contributor is absent from the breakdown and the AND.
    expect(report.contributors.map((c) => c.id)).toEqual([
      'deterministic',
      'invariants',
      'regression',
    ]);
    expect(report.overall).toBe('pass');
  });

  it('includes the contributor in the AND when it is enabled (control)', async () => {
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
    const report = await buildReport(root, 'enabled');
    expect(report.contributors.find((c) => c.id === 'llm-judge')?.status).toBe('fail');
    expect(report.overall).toBe('fail');
  });
});

describe('baseline diff', () => {
  it('flags a regression: passed in baseline, fails now', async () => {
    const root = makeProject();
    persistRun(root, mkRun('base', { 'status-as-json': { verdict: 'pass' } }));
    promoteBaseline(root, 'base');
    persistRun(root, mkRun('cur', { 'status-as-json': { verdict: 'fail', reason: 'broke' } }));
    const report = await buildReport(root, 'cur');
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

  // features/eval-judge/skip-filters.feature — skipping a case that was passing
  // in the baseline is flagged via skippedRegressions, distinct from regressions
  // (which only fire on a `fail`, never a `skipped`).
  it('flags skippedRegressions for a case that was pass in the baseline and is now skipped', () => {
    const baseline = mkRun('base', { 'a#x': { verdict: 'pass' } });
    const current = mkRun('cur', { 'a#x': { verdict: 'skipped' } });
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.skippedRegressions).toEqual(['a#x']);
    expect(diff.regressions).toEqual([]);
  });

  it('leaves skippedRegressions empty for a case with no entry in the baseline', () => {
    const baseline = mkRun('base', { 'a#other': { verdict: 'pass' } });
    const current = mkRun('cur', { 'a#x': { verdict: 'skipped' } });
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.skippedRegressions).toEqual([]);
  });

  it('leaves skippedRegressions empty for a case that was already failing or unjudged in the baseline', () => {
    const baseline = mkRun('base', { 'a#x': { verdict: 'fail', reason: 'r' } });
    const current = mkRun('cur', { 'a#x': { verdict: 'skipped' } });
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.skippedRegressions).toEqual([]);
  });
});

// features/eval-invariants/contributor.feature — the run-level invariant gate is
// evaluated inside buildReport, run-level, over the manifest's ACTIVE invariants.
describe('invariants gate run-level through buildReport', () => {
  // A monotonic `scenario-count` invariant compares the current run's case count
  // against the promoted baseline's — no command, so the gate runs without bash.
  const MONOTONIC = 'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: true\n    measure: scenario-count\n';

  it('passes the run when an active invariant is satisfied, exposing the breakdown', async () => {
    const root = makeProject();
    // Baseline has 1 case; current has 2 ⇒ scenario-count did not decrease.
    persistRun(root, mkRun('base', { 'a#x': { verdict: 'pass' } }));
    promoteBaseline(root, 'base');
    persistRun(root, mkRun('cur', { 'a#x': { verdict: 'pass' }, 'a#y': { verdict: 'pass' } }));
    writeManifest(root, MONOTONIC);
    const report = await buildReport(root, 'cur');
    expect(report.overall).toBe('pass');
    expect(report.contributors.find((c) => c.id === 'invariants')?.status).toBe('pass');
    // The per-invariant breakdown is present on the report.
    expect(report.invariants.map((o) => o.id)).toEqual(['spec-not-weakened']);
    expect(report.invariants[0].status).toBe('pass');
  });

  it('hard-fails the run run-level when an active invariant is violated', async () => {
    const root = makeProject();
    // Baseline has 2 cases; current has 1 ⇒ scenario-count decreased ⇒ violation.
    persistRun(root, mkRun('base', { 'a#x': { verdict: 'pass' }, 'a#y': { verdict: 'pass' } }));
    promoteBaseline(root, 'base');
    persistRun(root, mkRun('cur', { 'a#x': { verdict: 'pass' } }));
    writeManifest(root, MONOTONIC);
    const report = await buildReport(root, 'cur');
    expect(report.overall).toBe('fail');
    const inv = report.contributors.find((c) => c.id === 'invariants');
    expect(inv?.status).toBe('fail');
    expect(inv?.failing).toEqual(['spec-not-weakened']);
  });

  it('skips an inert invariant: not evaluated, never a vacuous pass', async () => {
    const root = makeProject();
    // The invariant WOULD fail (count decreased) but it is inert.
    persistRun(root, mkRun('base', { 'a#x': { verdict: 'pass' }, 'a#y': { verdict: 'pass' } }));
    promoteBaseline(root, 'base');
    persistRun(root, mkRun('cur', { 'a#x': { verdict: 'pass' } }));
    writeManifest(
      root,
      'invariants:\n  - id: spec-not-weakened\n    kind: monotonic\n    active: false\n    measure: scenario-count\n'
    );
    const report = await buildReport(root, 'cur');
    expect(report.overall).toBe('pass');
    expect(report.contributors.find((c) => c.id === 'invariants')?.status).toBe('pass');
    // The inert invariant is not recorded as a passing invariant.
    expect(report.invariants).toEqual([]);
  });

  it('fails the run closed when an active invariant is unevaluable', async () => {
    const root = makeProject();
    // Monotonic with no promoted baseline ⇒ unevaluable ⇒ violation.
    persistRun(root, mkRun('cur', { 'a#x': { verdict: 'pass' } }));
    writeManifest(root, MONOTONIC);
    const report = await buildReport(root, 'cur');
    expect(report.overall).toBe('fail');
    expect(report.contributors.find((c) => c.id === 'invariants')?.failing).toEqual([
      'spec-not-weakened',
    ]);
    expect(report.invariants[0].status).toBe('unevaluable');
  });

  it('fails the run closed when the manifest is present but unloadable', async () => {
    const root = makeProject();
    persistRun(root, mkRun('cur', { 'a#x': { verdict: 'pass' } }));
    writeManifest(root, 'invariants:\n  - id: bogus\n    kind: not-a-kind\n    active: true\n');
    const report = await buildReport(root, 'cur');
    expect(report.overall).toBe('fail');
    const inv = report.contributors.find((c) => c.id === 'invariants');
    expect(inv?.status).toBe('fail');
    expect(inv?.failing).toEqual(['invariants.yaml']);
    expect(report.loadError).toBeTruthy();
  });

  it('does not evaluate the gate when the invariants contributor is disabled', async () => {
    const root = makeProject();
    // A malformed manifest WOULD fail the gate, but the contributor is disabled
    // via run.gate, so the gate is never evaluated and the run still passes.
    persistRun(
      root,
      mkRun('cur', { 'a#x': { verdict: 'pass' } }, ['deterministic', 'llm-judge', 'regression'])
    );
    writeManifest(root, 'invariants:\n  - id: bogus\n    kind: not-a-kind\n    active: true\n');
    const report = await buildReport(root, 'cur');
    expect(report.overall).toBe('pass');
    expect(report.contributors.map((c) => c.id)).not.toContain('invariants');
    expect(report.invariants).toEqual([]);
    expect(report.loadError).toBeUndefined();
  });
});

// features/eval-judge/structured-evidence-persistence.feature — buildReport
// exposes one CaseDetail per run case: rubric/clauses/votes for a judged case,
// skip source/detail for a skipped case, and empty arrays for a case with no
// judging detail.
describe('cases: CaseDetail[]', () => {
  it('includes one CaseDetail per run case with the expected rubric/clauses/votes/skip', async () => {
    const root = makeProject();
    const judgedRecord: CaseRecord = {
      verdict: 'pass',
      reason: '[pass] it works: saw it',
      source: 'judged',
      rubric: ['it works'],
      clauses: [{ clause: 'it works', pass: true, evidence: 'saw it' }],
      votes: [{ pass: true, clauses: [{ clause: 'it works', pass: true, evidence: 'saw it' }] }],
    };
    const skippedRecord: CaseRecord = {
      verdict: 'skipped',
      reason: 'Skipped: tagged @skip in f/x.feature.',
      source: 'judged',
      skip: { source: 'tag', detail: 'f/x.feature' },
    };
    const unjudgedRecord: CaseRecord = {
      verdict: 'unjudged',
      reason: 'No eval-spec binding for this case; recorded unjudged (never passed).',
      source: 'judged',
    };
    const run: EvalRun = {
      runId: 'r1',
      createdAt: new Date().toISOString(),
      scope: { kind: 'store' },
      cases: [mkCase('a#judged'), mkCase('a#skipped'), mkCase('a#unbound')].map((c, i) =>
        toSnapshot(c, i === 0 ? 'deterministic' : null)
      ),
      verdicts: {
        'a#judged': judgedRecord,
        'a#skipped': skippedRecord,
        'a#unbound': unjudgedRecord,
      },
    };
    persistRun(root, run);
    const report = await buildReport(root, 'r1');

    expect(report.cases).toHaveLength(3);
    const judged = report.cases.find((c) => c.id === 'a#judged');
    expect(judged).toMatchObject({
      verdict: 'pass',
      rubric: ['it works'],
      clauses: judgedRecord.clauses,
      votes: judgedRecord.votes,
    });
    expect(judged?.skip).toBeUndefined();

    const skipped = report.cases.find((c) => c.id === 'a#skipped');
    expect(skipped).toMatchObject({
      verdict: 'skipped',
      rubric: [],
      clauses: [],
      votes: [],
      skip: { source: 'tag', detail: 'f/x.feature' },
    });

    const unbound = report.cases.find((c) => c.id === 'a#unbound');
    expect(unbound).toMatchObject({ verdict: 'unjudged', rubric: [], clauses: [], votes: [] });
    expect(unbound?.skip).toBeUndefined();
  });

  // features/web-failure-evidence/failure-artifacts.feature — the report
  // surfaces a failing case's captured trace/screenshot paths alongside its
  // rubric, clauses, and votes.
  it('includes artifacts for a run whose CaseRecord carries it, and omits it for one that does not', async () => {
    const root = makeProject();
    const withArtifacts: CaseRecord = {
      verdict: 'fail',
      reason: '[fail] spec failed',
      source: 'judged',
      rubric: ["Playwright spec 'e2e/checkout.spec.ts' exits zero"],
      clauses: [{ clause: "Playwright spec 'e2e/checkout.spec.ts' exits zero", pass: false, evidence: 'failed' }],
      votes: [{ pass: false, clauses: [] }],
      artifacts: {
        trace: '.ratchet/evals/runs/r1/artifacts/a#web/trace.zip',
        screenshot: '.ratchet/evals/runs/r1/artifacts/a#web/test-failed-1.png',
      },
    };
    const withoutArtifacts: CaseRecord = { verdict: 'pass', reason: '', source: 'judged' };
    const run: EvalRun = {
      runId: 'r1',
      createdAt: new Date().toISOString(),
      scope: { kind: 'store' },
      cases: [mkCase('a#web'), mkCase('a#other')].map((c) => toSnapshot(c, 'deterministic')),
      verdicts: { 'a#web': withArtifacts, 'a#other': withoutArtifacts },
    };
    persistRun(root, run);
    const report = await buildReport(root, 'r1');

    const web = report.cases.find((c) => c.id === 'a#web');
    expect(web?.artifacts).toEqual(withArtifacts.artifacts);

    const other = report.cases.find((c) => c.id === 'a#other');
    expect(other?.artifacts).toBeUndefined();
  });

  it('leaves the existing overall-verdict/contributor/scorecard assertions unchanged by the new field', async () => {
    const root = makeProject();
    persistRun(
      root,
      mkRun('r1', {
        'a#pass': { verdict: 'pass' },
        'a#fail': { verdict: 'fail', reason: 'boom' },
      })
    );
    const report = await buildReport(root, 'r1');
    expect(report.overall).toBe('fail');
    expect(report.scorecard).toMatchObject({ total: 2, pass: 1, fail: 1 });
    expect(report.cases).toHaveLength(2);
  });
});
