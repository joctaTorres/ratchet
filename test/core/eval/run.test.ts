import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  runArtifactsDir,
  persistCaseArtifacts,
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
  tags: [],
};

function sampleRun(runId: string): EvalRun {
  return {
    runId,
    createdAt: new Date().toISOString(),
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

  // features/eval-judge/structured-evidence-persistence.feature — the structured
  // judging detail (rubric, per-clause evidence, per-juror votes) and a skipped
  // case's skip source/detail round-trip through persistRun/loadRun unchanged.
  it('round-trips rubric/clauses/votes/skip/artifacts on a CaseRecord unchanged', () => {
    const root = makeProject();
    const run = sampleRun('20260101T000000000Z-roundtrip');
    run.verdicts['f/x#one'] = {
      verdict: 'pass',
      reason: '[pass] it works: saw it',
      source: 'judged',
      rubric: ['it works'],
      clauses: [{ clause: 'it works', pass: true, evidence: 'saw it' }],
      votes: [{ pass: true, clauses: [{ clause: 'it works', pass: true, evidence: 'saw it' }] }],
      artifacts: { trace: '.ratchet/evals/runs/20260101T000000000Z-roundtrip/artifacts/f/x#one/trace.zip' },
    };
    persistRun(root, run);
    expect(loadRun(root, run.runId).verdicts['f/x#one']).toEqual(run.verdicts['f/x#one']);

    const skipRun = sampleRun('20260101T000000000Z-skip');
    skipRun.verdicts['f/x#one'] = {
      verdict: 'skipped',
      reason: 'Skipped: tagged @skip in f/x.feature.',
      source: 'judged',
      skip: { source: 'tag', detail: 'f/x.feature' },
    };
    persistRun(root, skipRun);
    expect(loadRun(root, skipRun.runId).verdicts['f/x#one']).toEqual(skipRun.verdicts['f/x#one']);
  });
});

// features/web-failure-evidence/failure-artifacts.feature — ephemeral,
// fixture-cwd-scoped trace/screenshot files become durable run evidence.
describe('persistCaseArtifacts / runArtifactsDir', () => {
  it('copies a real trace and screenshot file into the run\'s artifacts directory and returns project-relative paths to the copies', () => {
    const root = makeProject();
    const runId = '20260101T000000000Z-artifacts';
    const caseId = 'f/x#one';
    const srcDir = mkdtempSync(path.join(tmpdir(), 'eval-web-fixture-'));
    roots.push(srcDir);
    const tracePath = path.join(srcDir, 'trace.zip');
    const screenshotPath = path.join(srcDir, 'test-failed-1.png');
    writeFileSync(tracePath, 'trace-bytes');
    writeFileSync(screenshotPath, 'screenshot-bytes');

    const persisted = persistCaseArtifacts(root, runId, caseId, {
      trace: tracePath,
      screenshot: screenshotPath,
    });

    const dir = runArtifactsDir(root, runId, caseId);
    expect(dir).toBe(path.join(root, '.ratchet', 'evals', 'runs', runId, 'artifacts', caseId));
    expect(persisted).toEqual({
      trace: path.relative(root, path.join(dir, 'trace.zip')),
      screenshot: path.relative(root, path.join(dir, 'test-failed-1.png')),
    });
    expect(persisted?.trace).not.toBe(tracePath);
    expect(existsSync(path.join(root, persisted!.trace!))).toBe(true);
    expect(existsSync(path.join(root, persisted!.screenshot!))).toBe(true);
    expect(readFileSync(path.join(root, persisted!.trace!), 'utf-8')).toBe('trace-bytes');
  });

  it('returns undefined and creates no directory when neither trace nor screenshot is present', () => {
    const root = makeProject();
    const runId = '20260101T000000000Z-empty';
    const caseId = 'f/x#one';

    const persisted = persistCaseArtifacts(root, runId, caseId, {});

    expect(persisted).toBeUndefined();
    expect(existsSync(runArtifactsDir(root, runId, caseId))).toBe(false);
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
    // A manually-overridden verdict carries no judging detail.
    expect(updated.verdicts['f/x#one'].rubric).toBeUndefined();
    expect(updated.verdicts['f/x#one'].clauses).toBeUndefined();
    expect(updated.verdicts['f/x#one'].votes).toBeUndefined();
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

  // features/eval-contributor-gate/disabled-contributor-incompleteness.feature:
  // a run left incomplete by a disabled contributor (its case unjudged) cannot
  // be promoted, leaving any existing baseline untouched.
  it('refuses to promote a run made incomplete by a disabled contributor', () => {
    const root = makeProject();
    persistRun(root, completeRun('good'));
    promoteBaseline(root, 'good');

    // A run whose only llm-judge case is unjudged because llm-judge is disabled.
    const gated: EvalRun = {
      runId: 'gated',
      createdAt: new Date().toISOString(),
      scope: { kind: 'store' },
      gate: ['deterministic', 'invariants', 'regression'],
      cases: [toSnapshot(CASE, 'llm-judge')],
      verdicts: {
        'f/x#one': {
          verdict: 'unjudged',
          reason: "Contributor 'llm-judge' is disabled for this run; case recorded unjudged (never executed).",
          source: 'judged',
        },
      },
    };
    persistRun(root, gated);

    expect(() => promoteBaseline(root, 'gated')).toThrow(/incomplete/i);
    expect(loadBaselineRunId(root)).toBe('good');
  });
});
